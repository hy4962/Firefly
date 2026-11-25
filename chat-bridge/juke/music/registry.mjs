import { createHash } from 'node:crypto';
import { signStreamProxyUrl, verifyStreamProxyToken } from './stream-signer.mjs';
import { probeAudio } from './audio-source.mjs';
import { hasCachedAudio } from './stream-cache.mjs';
import { isMusicSourceId, normalizeIsrc, normalizeMusicTrack } from './music-input.mjs';
import { lookupPreferredProviders } from './provider-routing.mjs';

const RESOLVED_CACHE_TTL_MS = 30 * 60_000; // 30 minutes (QQ Music vkey TTL is 2+ hours)
const PARTNER_STREAM_TTL_MS = 10 * 60_000;
const FAILED_CACHE_TTL_MS = 15_000; // A supplier miss may recover on the next request.
const UNMATCHED_PLAYLIST_TTL_MS = 30 * 60_000;

const ROTATION_RELATIONS = ['same_artist_version', 'same_title', 'same_artist_other'];
const RECORDING_DURATION_TOLERANCE_SEC = 5;
const MAX_SOURCE_CHECKS = 6;
const TRACK_MATCH_TTL_MS = 24 * 60 * 60_000;
const TRACK_MATCH_LIMIT = 512;
const STORED_MATCH_TTL_MS = 30 * 24 * 60 * 60_000;
const PREMATCH_RETRY_MS = 3 * 24 * 60 * 60_000;
const LIVE_ALBUM = /(?:\blive\s+(?:at|in|from|on|version|recording)\b|\(live\)|现场实录|現場實錄|演唱会|演唱會|ライブ音源)/iu;
const TRAILING_NOTE = /\s*(?:\(([^()]*)\)|\[([^\[\]]*)\]|【([^【】]*)】|\s+[-‐‑‒–—]\s+((?:(?!\s+[-‐‑‒–—]\s).)+))$/u;
const VERSION_LABEL = /^(?:(?:19|20)\d{2}\s+)?(?:live\b|acoustic\b|cover\b|instrumental\b|karaoke\b|demo\b|rerecord(?:ed)?\b|re-record(?:ed)?\b|radio edit\b|studio\b|remix\b|alternate lyrics\b|alternative lyrics\b|all lyrics\b|original(?: version| lyrics)?$|ライブ|现场|現場|演唱会|演唱會|伴奏|翻唱|重录|重錄|录音室|錄音室|不插电|不插電|不同歌词|不同歌詞)/iu;
const MASTERING_LABEL = /^(?:(?:19|20)\d{2}\s*)?(?:remaster(?:ed)?(?:\s+(?:(?:19|20)\d{2}|edition|version))?|重[制製](?:版)?|リマスター(?:版)?)(?:\s+(?:19|20)\d{2})?$/iu;
const FEATURE_CREDIT = /\s*[(\[【]\s*(?:feat(?:uring)?|ft)(?:\.\s*|\s+)([^)\]】]+)[)\]】]|\s+(?:feat(?:uring)?|ft)(?:\.\s*|\s+)(.+)$/giu;
const ARTIST_SEPARATOR = /\s*[,、;/&]\s*/u;

function musicText(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, '');
}


// Selected localized artist credits from MusicBrainz. Keep the source IDs so
// ambiguous stage names and unrelated acts can be checked when extending it.
const artistKeys = new Map();
for (const names of [
  ["上白石萌音", "Mone Kamishiraishi"], // https://musicbrainz.org/artist/ee56fb00-f5ae-4b39-84be-fbf456106ea2
  ["『ユイカ』", "Yuika"], // https://musicbrainz.org/artist/6f0d9ace-971c-47df-9e81-cf8ef0655079
  ["周杰倫", "周杰伦", "Jay Chou", "ジェイ・チョウ", "Zhou Jielun"], // https://musicbrainz.org/artist/a223958d-5c56-4b2c-a30a-87e357bc121b
  ["Aimer", "エメ"], // https://musicbrainz.org/artist/9388cee2-7d57-4598-905f-106019b267d3
  ["中島美嘉", "中岛美嘉", "Mika Nakashima", "Nakashima Mika", "なかしまみか"], // https://musicbrainz.org/artist/f8d6e5df-069e-4b8d-9a13-cc7e0a558dd1
  ["藤井風", "Fujii Kaze"], // https://musicbrainz.org/artist/c3a4aeca-8f02-4d22-b1ff-693434ab09a8
  ["陳奕迅", "陈奕迅", "Eason Chan", "Chen Yixun"], // https://musicbrainz.org/artist/86119d30-d930-4e65-a97a-e31e22388166
]) {
  for (const name of names) artistKeys.set(musicText(name), musicText(names[0]));
}

function artistKey(name) {
  const key = musicText(name);
  return artistKeys.get(key) || key;
}

// Look up artist metadata only for a plausible cross-script recording. One
// shared request per name, globally spaced; verified results survive restarts.
export class ArtistDirectory {
  constructor(store, request = fetch) {
    this.store = store;
    this.request = request;
    this.nextLookup = 0;
    this.pending = new Map();
    this.cache = new Map();
  }

  async names(name) {
    const key = 'music:artist-alias:v1:' + musicText(name);
    const cached = this.cache.get(key) || this.store?.getKv?.(key);
    if (cached?.expiresAt > Date.now()) return cached.names;
    if (this.pending.has(key)) return this.pending.get(key);
    if (Date.now() < this.nextLookup) return [];
    this.nextLookup = Date.now() + 1100;
    const lookup = this.lookup(name).then(names => {
      const entry = { names, expiresAt: Date.now() + (names.length ? STORED_MATCH_TTL_MS : 86400_000) };
      if (this.cache.size >= 512) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, entry);
      if (names.length) this.store?.setKv?.(key, entry);
      return names;
    }).catch(() => []).finally(() => this.pending.delete(key));
    this.pending.set(key, lookup);
    return lookup;
  }

  async lookup(name) {
    const url = new URL('https://musicbrainz.org/ws/2/artist/');
    const escaped = name.replace(/["\\]/gu, '\\$&');
    url.search = new URLSearchParams({ query: '(artist:"' + escaped + '" OR alias:"' + escaped + '")', fmt: 'json', limit: '5' });
    const response = await this.request(url, { signal: AbortSignal.timeout(1100),
      headers: { 'User-Agent': 'LengxiJukebox/1.0 (https://lengxiqwq.com)' } });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Artist directory unavailable');
    }
    const { artists } = await response.json();
    const exact = (artists || []).filter(artist => Number(artist.score) === 100);
    if (exact.length !== 1) return [];
    const artist = exact[0];
    const names = [artist.name, ...(artist.aliases || [])
      .filter(alias => alias.type === 'Artist name' || alias.primary === true)
      .map(alias => alias.name)].filter(Boolean);
    return names.some(alias => musicText(alias) === musicText(name)) ? names : [];
  }
}

// Allow a small spelling difference only with independent release evidence.
// Compare letters only so track numbers, mix labels and short names stay distinct.
function closeSpelling(a, b) {
  if (!/^[a-z]{5,80}$/u.test(a) || !/^[a-z]{5,80}$/u.test(b)) return false;
  const limit = Math.min(2, Math.floor(Math.max(a.length, b.length) / 5));
  if (Math.abs(a.length - b.length) > limit) return false;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next.push(Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(a[i - 1] !== b[j - 1])));
    }
    row = next;
  }
  return row[b.length] <= limit;
}

function splitArtists(value) {
  return String(value ?? '').normalize('NFKC').split(ARTIST_SEPARATOR).map(name => name.trim()).filter(Boolean);
}

function recordingMetadata(track) {
  let title = String(track.title ?? '').normalize('NFKC').trim();
  const versions = [];
  let mastering = '';
  const collectVersions = () => {
    let note;
    while ((note = title.match(TRAILING_NOTE))) {
      const label = (note[1] ?? note[2] ?? note[3] ?? note[4]).trim();
      const annotations = label.split(/\s*[|/]\s*/u);
      if (!annotations.every(part => VERSION_LABEL.test(part) || MASTERING_LABEL.test(part))) break;
      for (const part of annotations) {
        if (MASTERING_LABEL.test(part)) mastering ||= musicText(part);
        else versions.push(musicText(part.replace(/(?:\s+version|版)$/iu, '')));
      }
      title = title.slice(0, note.index).trimEnd();
    }
  };
  collectVersions();
  const artists = Array.isArray(track.artistNames) && track.artistNames.length
    ? track.artistNames.flatMap(name => String(name).normalize('NFKC').split(/\s*[;、]\s*/u))
    : splitArtists(track.artist);
  title = title.replace(FEATURE_CREDIT, (_match, bracketed, trailing) => {
    artists.push(...splitArtists(bracketed ?? trailing));
    return '';
  }).trim();
  collectVersions();
  const artistNames = [...new Set(artists.map(artistKey).filter(Boolean))].sort();
  return {
    title,
    titleKey: musicText(title),
    artistNames: artistNames.includes('未知歌手') ? [] : artistNames,
    artistCredits: track.provider === 'qq' && Array.isArray(track.artistCredits) ? track.artistCredits : [],
    artists,
    versionKey: [...new Set([...versions,
      ...(LIVE_ALBUM.test(String(track.album || track.albumName || '').normalize('NFKC')) &&
        !versions.some(version => version.startsWith('live')) ? ['live'] : [])
    ])].sort().join('/'),
    mastering,
    albumKey: musicText(String(track.album || track.albumName || '').normalize('NFKC')
      .replace(/\s*(?:\(|\[)(?:deluxe(?: edition)?|expanded(?: edition)?|explicit|clean|(?:\d{4}\s+)?remaster(?:ed)?)(?:\)|\])/giu, '')),
    durationSec: Number(track.durationSec) || 0,
    isrc: normalizeIsrc(track.isrc)
  };
}

// Use only search-provider credits. A name shared by multiple artist IDs is ambiguous.
function indexArtistNames(tracks) {
  const idsByName = new Map();
  for (const track of tracks) {
    if (track.provider !== 'qq' || !Array.isArray(track.artistCredits)) continue;
    for (const { id, name, alias } of track.artistCredits) {
      if (!id) continue;
      for (const label of [name, alias]) {
        const key = artistKey(label);
        if (!key) continue;
        if (!idsByName.has(key)) idsByName.set(key, id);
        else if (idsByName.get(key) !== id) idsByName.set(key, null);
      }
    }
  }
  return idsByName;
}

function sameArtistRoster(original, candidate, artistIds) {
  if (!original.artistNames.length || original.artistNames.length !== candidate.artistNames.length) return false;
  if (original.artistNames.every((name, index) => name === candidate.artistNames[index])) return true;

  const remaining = new Set(candidate.artistNames);
  const namesToResolve = original.artistNames.filter(name => !remaining.delete(name));
  for (const name of namesToResolve) {
    const id = artistIds.get(name);
    if (!id) return false;
    const credit = candidate.artistCredits.find(artist => artist.id === id);
    if (!credit || !remaining.delete(artistKey(credit.name))) return false;
  }
  return remaining.size === 0;
}

// Imported titles sometimes pair the original with a Latin translation.
function matchingTitle(a, b) {
  if (a.titleKey && a.titleKey === b.titleKey) return true;
  const translated = (full, short) => {
    const parts = full.title.split(/\s+[-–—]\s+/u);
    if (parts.length !== 2) return false;
    const [native, latin] = parts;
    return /[\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}\p{Script=Hangul}]/u.test(native) &&
      /^[\p{Script=Latin}\p{M}\s'’.-]+$/u.test(latin) && !VERSION_LABEL.test(latin) &&
      (musicText(native) === short.titleKey || musicText(latin) === short.titleKey);
  };
  return translated(a, b) || translated(b, a);
}

function compareRecording(original, candidate, artistIds) {
  let titleMatches = matchingTitle(original, candidate);
  let artistsMatch = sameArtistRoster(original, candidate, artistIds);
  if (original.albumKey && original.albumKey === candidate.albumKey &&
      original.durationSec > 0 && candidate.durationSec > 0 &&
      Math.abs(original.durationSec - candidate.durationSec) <= 2 &&
      original.versionKey === candidate.versionKey) {
    if (titleMatches && original.artistNames.length === 1 && candidate.artistNames.length === 1) {
      artistsMatch ||= closeSpelling(original.artistNames[0], candidate.artistNames[0]);
    } else if (artistsMatch && original.isrc && original.isrc === candidate.isrc) {
      titleMatches ||= closeSpelling(original.titleKey, candidate.titleKey);
    }
  }
  const relation = titleMatches
    ? (artistsMatch ? 'same_artist_version' : 'same_title')
    : (artistsMatch ? 'same_artist_other' : null);
  const albumMatch = Boolean(original.albumKey && original.albumKey === candidate.albumKey);
  const durationDiff = original.durationSec > 0 && candidate.durationSec > 0
    ? Math.abs(original.durationSec - candidate.durationSec)
    : Infinity;
  let confidence = 0;
  const sameVersion = original.versionKey === candidate.versionKey;
  const masteringMatch = Boolean(original.mastering && original.mastering === candidate.mastering);
  const plainStudio = !original.versionKey || original.versionKey === 'original' || original.versionKey === 'originallyrics';
  if (titleMatches && artistsMatch && sameVersion) {
    if (original.isrc && candidate.isrc) {
      if (original.isrc === candidate.isrc) confidence = 3;
    } else if (durationDiff <= RECORDING_DURATION_TOLERANCE_SEC ||
        (plainStudio && albumMatch && durationDiff <= 7)) {
      confidence = 1;
      if (durationDiff <= 2 && (albumMatch || masteringMatch ||
          (plainStudio && original.versionKey && durationDiff <= 1))) confidence = 2;
    }
  }
  return { relation, confidence, masteringMatch, albumMatch, durationDiff,
    isrc: candidate.isrc, versionKey: candidate.versionKey, mastering: candidate.mastering,
    durationSec: candidate.durationSec };
}

function preferRecording(a, b) {
  return b.confidence - a.confidence || Number(b.masteringMatch) - Number(a.masteringMatch) ||
    Number(b.albumMatch) - Number(a.albumMatch) ||
    (a.durationDiff === b.durationDiff ? 0 : a.durationDiff - b.durationDiff);
}

function preferRotationAlternative(original, a, b) {
  const score = option => option.versionKey === original.versionKey ? 2 :
    (!option.versionKey && !original.versionKey?.startsWith('live') ? 1 : 0);
  return score(b) - score(a) || Number(b.albumMatch) - Number(a.albumMatch) ||
    (a.durationDiff === b.durationDiff ? 0 : a.durationDiff - b.durationDiff);
}

function sameReleaseRecording(a, b) {
  if (a.versionKey !== b.versionKey) return false;
  if (a.isrc && b.isrc) return a.isrc === b.isrc;
  if (a.mastering && b.mastering && a.mastering !== b.mastering) return false;
  return a.durationSec > 0 && b.durationSec > 0 && Math.abs(a.durationSec - b.durationSec) <= 1;
}

function clearMatch(recordings, complete) {
  const [best, ...others] = recordings;
  if (!best) return null;
  if (best.confidence === 3) return best;
  if (!complete) return null;
  if (new Set(recordings.map(option => option.isrc).filter(Boolean)).size > 1) return null;
  const closest = [...recordings].sort((a, b) => b.confidence - a.confidence ||
    Number(b.masteringMatch) - Number(a.masteringMatch) || a.durationDiff - b.durationDiff ||
    Number(b.albumMatch) - Number(a.albumMatch))[0];
  if (new Set(recordings.map(option => option.mastering).filter(Boolean)).size <= 1 &&
      recordings.every(option => option === closest || sameReleaseRecording(closest, option))) return closest;
  if (best.confidence >= 2 && others.every(option =>
    sameReleaseRecording(best, option) ||
    (!(best.isrc && option.isrc && best.isrc !== option.isrc) &&
      (best.masteringMatch && !option.masteringMatch ||
        best.confidence > option.confidence && option.durationDiff - best.durationDiff >= 3)))) return best;
  return null;
}

export function musicTrackMatchKey(item) {
  const platform = item.sourcePlatform || item.provider;
  const sourceId = item.sourceTrackId || item.sourceId;
  if (!platform || !sourceId) return null;
  return JSON.stringify([platform === 'qqmusic' ? 'qq' : platform, sourceId, item.title, item.artist, item.album, item.durationSec, item.isrc]);
}

export function withPlaybackSelection(track, original, mode) {
  return {
    ...track,
    playbackSelection: {
      mode,
      original: {
        title: String(original.title || '').slice(0, 240),
        artist: String(original.artist || '').slice(0, 240),
        platform: String(original.sourcePlatform || original.provider || '').slice(0, 48)
      }
    }
  };
}

export class MusicRegistry {
  constructor(providers = [], { matchStore, lookupArtistAliases = false } = {}) {
    this.providers = new Map();
    this.defaultOrder = [];
    this.resolved = new Map();
    this.resolving = new Map();
    this.trackMatches = new Map();
    this.searchRoutes = new Map();
    this.matchStore = matchStore;
    this.artistDirectory = lookupArtistAliases ? new ArtistDirectory(matchStore) : null;
    for (const p of providers) {
      this.providers.set(p.id, p);
      this.defaultOrder.push(p.id);
    }
  }

  isKnownUnplayable(trackKey) {
    if (!trackKey) return false;
    const key = trackKey.includes(':') ? trackKey : 'qq:' + trackKey;
    const entry = this.resolved.get(key);
    return Boolean(entry && !entry.source && entry.expiresAt > Date.now());
  }

  listProviders() {
    return this.defaultOrder
      .map((id) => this.providers.get(id))
      .filter(Boolean)
      .map((p) => ({ id: p.id, name: p.name }));
  }

  async search(keyword, limit = 30, providerId, page = 1) {
    if (providerId) {
      return this.providers.get(providerId)?.search(keyword, limit, page) ?? { tracks: [], hasMore: false };
    }
    const key = JSON.stringify([keyword.trim().toLowerCase(), limit]);
    const route = this.searchRoutes.get(key);
    if (page > 1 && route?.expiresAt > Date.now()) {
      return this.providers.get(route.id).search(keyword, limit, page);
    }
    let failure;
    let answered = false;
    for (const [id, provider] of this.providers) {
      let first;
      try {
        first = await provider.search(keyword, limit, 1);
        answered = true;
      } catch (error) {
        failure = error;
        continue;
      }
      if (!first.tracks?.length) continue;
      if (this.searchRoutes.size >= 256) this.searchRoutes.delete(this.searchRoutes.keys().next().value);
      this.searchRoutes.set(key, { id, expiresAt: Date.now() + 15 * 60_000 });
      return page === 1 ? first : provider.search(keyword, limit, page);
    }
    if (failure && !answered) throw failure;
    return { tracks: [], hasMore: false };
  }

  // A catalog hit is metadata. Expose only the same recording with verified
  // audio, and give enqueue its playable catalog ID so it reuses the lookup.
  async searchPlayablePage(keyword, limit, page, origin, secret) {
    const found = await this.search(keyword, limit, 'kugou', page);
    const results = await Promise.all(found.tracks.slice(0, limit).map(async original => {
      const result = await this.resolveRotationTrack(original,
        track => this.resolvePlayable(track, origin, secret),
        { exactOnly: true, alternatives: true, budgetMs: 9000 });
      if (!result.playable) return null;
      return normalizeMusicTrack({ ...result.playable, cover: original.cover || result.playable.cover });
    }));
    const unique = new Map();
    for (const track of results) if (track && !unique.has(track.id)) unique.set(track.id, track);
    return { tracks: [...unique.values()], hasMore: found.hasMore };
  }

  async resolvePlaylistTrack(item) {
    if (!item || typeof item !== 'object') return null;
    const native = normalizeMusicTrack({
      ...item, provider: item.sourcePlatform || item.provider, sourceId: item.sourceTrackId || item.sourceId
    });
    if (native && this.providers.has(native.provider)) return native;
    const existing = normalizeMusicTrack(item.matchedTrack);
    if (existing) return existing;
    const sourceId = item.sourceTrackId || item.sourceId || (typeof item.id === 'string' && item.id.startsWith('qq:') ? item.id.replace(/^qq:/, '') : '');
    const platform = item.sourcePlatform || item.provider;
    if ((platform === 'qqmusic' || platform === 'qq' || (!platform && typeof item.id === 'string' && item.id.startsWith('qq:'))) && sourceId) {
      const direct = {
        id: 'qq:' + sourceId,
        provider: 'qq',
        sourceId,
        title: item.title,
        artist: item.artist,
        album: item.album || item.albumName || undefined,
        cover: item.cover,
        durationSec: item.durationSec
      };
      item.matchedTrack = direct;
      return direct;
    }
    if (item._unmatchedAt && Date.now() - item._unmatchedAt < UNMATCHED_PLAYLIST_TTL_MS) {
      return null;
    }
    const cleanStr = (value) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s\-_·.,'"!?！？，。、()（）/&]+/g, '');
    const cleanTitle = cleanStr(item.title);
    const primaryArtist = cleanStr((item.artist || '').split(/[/,&、;；]+/)[0]);
    const providers = this.providerOrder(item);
    for (const providerId of providers) {
      try {
        const { tracks: matches } = await this.search(item.title + ' ' + (item.artist || ''), 10, providerId);
        if (!matches || matches.length === 0) continue;

        const match = matches.find((candidate) => {
          const cTitle = cleanStr(candidate.title);
          const cArtist = cleanStr(candidate.artist);
          const titleMatch = Boolean(cleanTitle && cTitle === cleanTitle);
          const artistMatch = Boolean(primaryArtist && cArtist && (cArtist.includes(primaryArtist) || primaryArtist.includes(cArtist)));
          const durMatch = !(candidate.durationSec > 0 && item.durationSec > 0) || Math.abs(candidate.durationSec - item.durationSec) <= 12;
          return titleMatch && artistMatch && durMatch;
        });

        if (match) {
          item.matchedTrack = match;
          return match;
        }
      } catch {
        // try next provider
      }
    }
    item._unmatchedAt = Date.now();
    return null;
  }

  matchStorageKey(item, providerId) {
    const sourceKey = musicTrackMatchKey(item);
    if (!sourceKey) return null;
    return 'music:verified-match:v2:' + createHash('sha256').update(JSON.stringify([sourceKey, providerId])).digest('hex');
  }

  readMatch(key) {
    if (!key) return null;
    const local = this.trackMatches.get(key);
    if (local?.expiresAt > Date.now()) return local;
    try {
      return this.matchStore?.getKv?.(key) ?? null;
    } catch {
      return null;
    }
  }

  saveMatch(key, track, ttlMs) {
    if (!key) return;
    const record = { track, expiresAt: Date.now() + ttlMs };
    if (this.trackMatches.size >= TRACK_MATCH_LIMIT) this.trackMatches.delete(this.trackMatches.keys().next().value);
    this.trackMatches.set(key, { ...record, expiresAt: Date.now() + Math.min(ttlMs, TRACK_MATCH_TTL_MS) });
    try {
      this.matchStore?.setKv?.(key, record);
    } catch {
      // An unavailable match store must not block playback.
    }
  }

  providerOrder(item, preferredTrack) {
    const rawPlatform = String(item?.sourcePlatform || item?.provider || '').trim().toLowerCase();
    let platformProvider = null;
    if (['qq', 'qqmusic', 'tencent'].includes(rawPlatform)) {
      platformProvider = 'qq';
    } else if (['netease', '163', 'cloudmusic'].includes(rawPlatform)) {
      platformProvider = 'netease';
    } else if (['kugou', 'kg'].includes(rawPlatform)) {
      platformProvider = 'kugou';
    } else if (['youtube', 'ytmusic', 'youtubemusic', 'yt'].includes(rawPlatform)) {
      platformProvider = 'youtube';
    }

    const isOverseasCatalog = ['applemusic', 'apple_music', 'apple', 'itunes', 'spotify'].includes(rawPlatform);

    let priorityOrder;
    if (isOverseasCatalog) {
      // Apple Music and Spotify default to YouTube Music, then fallback to domestic (qq, netease, kugou)
      priorityOrder = ['youtube', 'qq', 'netease', 'kugou'];
    } else if (platformProvider) {
      // Prioritize the native platform of the playlist/track, then others
      const rest = ['qq', 'netease', 'kugou', 'youtube'].filter(id => id !== platformProvider);
      priorityOrder = [platformProvider, ...rest];
    } else {
      // Default order
      priorityOrder = ['qq', 'netease', 'kugou', 'youtube'];
    }

    const original = normalizeMusicTrack({
      ...item, provider: platformProvider || rawPlatform, sourceId: item.sourceTrackId || item.sourceId
    });

    const possible = [...new Set([preferredTrack?.provider, ...priorityOrder, ...this.defaultOrder])];
    const available = possible.filter(id => this.providers.has(id));
    if (original || preferredTrack || isOverseasCatalog || platformProvider) return available;
    // Reuse a previously verified cross-catalog match before repeating a search.
    const known = available.filter(id => this.readMatch(this.matchStorageKey(item, id))?.expiresAt > Date.now());
    return [...known, ...available.filter(id => !known.includes(id))];
  }

  async preMatchPlaylists(playlists, resolve, limit = 8) {
    const alreadyConsidered = new Set();
    let checked = 0;
    for (const playlist of playlists) {
      for (const track of playlist.tracks || []) {
        if (checked >= limit) return checked;
        if (this.resolving.size >= 4) return checked;
        const source = normalizeMusicTrack(track);
        if (source && this.providers.has(source.provider)) continue;
        const attemptKey = this.matchStorageKey(track, 'background');
        if (!attemptKey || alreadyConsidered.has(attemptKey)) continue;
        alreadyConsidered.add(attemptKey);
        if (this.readMatch(attemptKey)?.expiresAt > Date.now() ||
            this.defaultOrder.some(id => this.readMatch(this.matchStorageKey(track, id))?.expiresAt > Date.now())) continue;
        checked++;
        const result = await this.resolveRotationTrack(track, resolve, { alternatives: true, random: true, budgetMs: 4200 });
        this.saveMatch(attemptKey, null, result.temporaryFailure ? 60 * 60_000 : PREMATCH_RETRY_MS);
      }
    }
    return checked;
  }

  async resolveRotationTrack(item, resolve, options = {}) {
    const ordered = this.providerOrder(item, options.preferredTrack);
    const budgetMs = options.budgetMs ?? (options.alternatives ? (ordered.length > 1 && !options.exactOnly ? 6500 : 10_500) : 2800);
    if (!ordered.length) return { temporaryFailure: false };
    const deadline = Date.now() + budgetMs;
    const lookup = (id, signal) => this.resolveProviderRecording(item, resolve, id, {
      ...options, alternatives: options.alternatives || options.autoSelectAlternative, deadline, signal
    });
    const result = ordered.length === 1
      ? await lookup(ordered[0])
      : await lookupPreferredProviders(ordered, lookup, budgetMs, options.autoSelectAlternative ? Infinity : 3);
    if (result.verifiedMatch) {
      const track = normalizeMusicTrack(result.playable);
      if (track) this.saveMatch(this.matchStorageKey(item, track.provider), track, STORED_MATCH_TTL_MS);
    }
    if (!result.playable && options.autoSelectAlternative) {
      const original = recordingMetadata(item);
      const noAliases = new Map();
      const alternatives = (result.alternatives || [])
        .filter(option => option.relation === 'same_artist_version')
        .map(({ track }) => ({ track, ...compareRecording(original, recordingMetadata(track), noAliases) }))
        .sort((a, b) => preferRotationAlternative(original, a, b));
      const best = alternatives[0]?.track;
      if (best) {
        const replacement = { ...best, rotationReplacement: { title: item.title, artist: item.artist } };
        return { playable: withPlaybackSelection(replacement, item, 'automatic-alternative') };
      }
    }
    if (result.playable) {
      const mode = result.usedPreference ? 'saved-choice'
        : result.nativeMatch ? 'original' : 'same-version';
      return { ...result, playable: withPlaybackSelection(result.playable, item, mode) };
    }
    return result;
  }

  async resolveProviderRecording(item, resolve, providerId, {
    alternatives = false, autoSelectAlternative = false, exactOnly = false, exclude = () => false, budgetMs, preferredTrack, random = false, deadline, signal
  }) {
    const platform = item.sourcePlatform || item.provider;
    const sourceId = item.sourceTrackId || item.sourceId ||
      (item.id?.startsWith('qq:') ? item.id.slice(3) : '');
    const provider = platform === 'qqmusic' ? 'qq' : platform || (item.id?.startsWith('qq:') ? 'qq' : '');
    const direct = provider === providerId && sourceId
      ? normalizeMusicTrack({ ...item, id: provider + ':' + sourceId, provider, sourceId })
      : null;
    const seen = new Set();
    let temporaryFailure = false;
    let lastFailureDetail = '';
    const uncertainSources = new Set();
    const bounded = async (operation, maxMs, stage) => {
      const started = performance.now();
      const remaining = Math.min(maxMs, deadline - Date.now());
      if (remaining <= 0 || signal?.aborted) throw new Error('Music lookup budget exhausted');
      let timer;
      try {
        return await Promise.race([
          operation(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Rotation lookup timed out')), remaining);
          })
        ]);
      } finally {
        clearTimeout(timer);
        const elapsedMs = Math.round(performance.now() - started);
        if (stage && elapsedMs >= 2000) console.info('[MusicLookup]', { provider: providerId, stage, elapsedMs });
      }
    };
    const check = async (track, maxMs = exactOnly ? 7500 : 3500) => {
      if (!track || exclude(track) || seen.has(track.id)) return null;
      seen.add(track.id);
      try {
        return await bounded(() => resolve(track), maxMs, 'audio');
      } catch (err) {
        temporaryFailure = true;
        uncertainSources.add(track.id);
        lastFailureDetail = err?.message || '音源检查超时';
        return null;
      }
    };
    const checkedOriginals = new Set();
    const checkOriginal = async (track, maxMs) => {
      const result = await check(track, maxMs);
      if (result || !exactOnly || !track || !uncertainSources.has(track.id) ||
          checkedOriginals.has(track.id) || deadline - Date.now() < 500 || signal?.aborted) return result;
      checkedOriginals.add(track.id);
      seen.delete(track.id);
      uncertainSources.delete(track.id);
      return check(track, maxMs);
    };
    const search = async (keyword) => {
      if (!keyword.trim()) return [];
      try {
        const result = await bounded(() => this.search(keyword, providerId === 'kugou' ? 20 : 15, providerId), budgetMs ? 2500 : 4000, 'catalog');
        return result.tracks || [];
      } catch (err) {
        temporaryFailure = true;
        lastFailureDetail = err?.message || '搜索上游响应超时';
        return [];
      }
    };
    const preference = await check(preferredTrack?.provider === providerId ? preferredTrack : null, 1500);
    if (preference) return { playable: preference, usedPreference: true };
    const directPlayable = await checkOriginal(direct, exactOnly ? 7500 : budgetMs ? 3500 : alternatives ? 5600 : 3500);
    if (directPlayable) return { playable: directPlayable, nativeMatch: true };

    const matchKey = this.matchStorageKey(item, providerId);
    const cached = this.readMatch(matchKey);
    if (cached?.track?.provider === providerId && cached.expiresAt > Date.now()) {
      const playable = await checkOriginal(cached.track, exactOnly ? 7500 : 5600);
      if (playable) return { playable };
      if (!exclude(cached.track) && !uncertainSources.has(cached.track.id)) {
        this.saveMatch(matchKey, null, 0);
      }
    }
    const remember = playable => ({ playable, verifiedMatch: true });

    const original = recordingMetadata(item);
    const searchTitle = (original.title || item.title || '').replace(/["\p{Pi}\p{Pf}]/gu, '').trim();
    const titleAndArtists = [searchTitle, ...original.artists].filter(Boolean).join(' ');
    const stored = normalizeMusicTrack(item.matchedTrack);
    const matched = stored?.provider === providerId && {
      ...stored,
      artistNames: item.matchedTrack.artistNames,
      isrc: item.matchedTrack.isrc
    };
    const rank = async (searchTracks) => {
      const artistIds = indexArtistNames(searchTracks);
      const tracks = new Map();
      for (const track of [...searchTracks, ...(matched ? [matched] : [])]) {
        if (!tracks.has(track.id) && !exclude(track)) tracks.set(track.id, track);
      }
      const provider = this.providers.get(providerId);
      if (provider?.getArtistAliases && original.artistNames.length) {
        const ids = new Set();
        for (const track of tracks.values()) {
          const candidate = recordingMetadata(track);
          if (!matchingTitle(original, candidate) || original.versionKey !== candidate.versionKey ||
              original.artistNames.length !== candidate.artistNames.length ||
              sameArtistRoster(original, candidate, artistIds) ||
              Math.abs(original.durationSec - candidate.durationSec) > RECORDING_DURATION_TOLERANCE_SEC) continue;
          for (const credit of candidate.artistCredits) if (credit.id) ids.add(credit.id);
        }
        if (ids.size <= MAX_SOURCE_CHECKS) await Promise.all([...ids].map(async id => {
          let aliases;
          try { aliases = await bounded(() => provider.getArtistAliases(id), 1900); }
          catch { temporaryFailure = true; return; }
          for (const alias of aliases) {
            const name = artistKey(alias);
            if (!artistIds.has(name)) artistIds.set(name, id);
            else if (artistIds.get(name) !== id) artistIds.set(name, null);
          }
        }));
      }
      const candidates = [...tracks.values()];
      const score = track => ({ track, ...compareRecording(original, recordingMetadata(track), artistIds) });
      const ranked = candidates.map(score);
      if (!this.artistDirectory || original.artists.length !== 1 || ranked.some(option => option.confidence > 0)) return ranked;
      const originalName = original.artists[0];
      const cjk = /[\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}\p{Script=Hangul}]/u;
      const possible = ranked.filter(option => {
        const candidate = recordingMetadata(option.track);
        return candidate.artists.length === 1 && cjk.test(originalName) !== cjk.test(candidate.artists[0]) &&
          matchingTitle(original, candidate) && original.versionKey === candidate.versionKey &&
          option.durationDiff <= RECORDING_DURATION_TOLERANCE_SEC;
      });
      if (!possible.length || deadline - Date.now() < 250 || signal?.aborted) return ranked;
      let aliases;
      try { aliases = await bounded(() => this.artistDirectory.names(originalName), 1150); }
      catch { return ranked; }
      const known = new Set(aliases.map(artistKey));
      for (const option of possible) {
        const candidate = recordingMetadata(option.track);
        if (!known.has(candidate.artistNames[0])) continue;
        const mapped = { ...candidate, artistNames: original.artistNames };
        Object.assign(option, compareRecording(original, mapped, artistIds));
      }
      return ranked;
    };

    const primary = await search(titleAndArtists);
    const primaryRanked = await rank(primary);
    const primaryMatches = primaryRanked.filter(option => option.confidence > 0).sort(preferRecording);
    const primaryChoice = clearMatch(primaryMatches, true);
    if (primaryChoice) {
      const playable = await checkOriginal(primaryChoice.track, exactOnly ? 7500 : 3500);
      if (playable) return remember(playable);
    }

    const titleResults = alternatives && titleAndArtists !== searchTitle ? await search(searchTitle) : [];
    const ranked = titleResults.length ? await rank([...primary, ...titleResults]) : primaryRanked;
    const recordings = ranked.filter(option => option.confidence > 0).sort(preferRecording);
    const checkedRecordings = (await Promise.all(recordings.slice(0, MAX_SOURCE_CHECKS).map(async option => {
      const track = await check(option.track);
      return track ? { ...option, track } : null;
    }))).filter(Boolean);
    // A shared recording code is sufficient even if the same recording has several releases.
    const completeCheck = recordings.length <= MAX_SOURCE_CHECKS &&
      !recordings.some(option => uncertainSources.has(option.track.id));
    const choice = clearMatch(checkedRecordings, completeCheck);
    if (choice) return remember(choice.track);
    if (exactOnly || !alternatives || random) return { temporaryFailure, error: lastFailureDetail };

    const remaining = ranked
      .filter(option => option.relation && !seen.has(option.track.id) &&
        (!autoSelectAlternative || option.relation === 'same_artist_version'))
      .sort((a, b) => ROTATION_RELATIONS.indexOf(a.relation) - ROTATION_RELATIONS.indexOf(b.relation) ||
        (autoSelectAlternative ? preferRotationAlternative(original, a, b) : preferRecording(a, b)));
    const alternativeLimit = autoSelectAlternative ? 3 : Math.max(0, MAX_SOURCE_CHECKS - recordings.length);
    const checked = await Promise.all(remaining.slice(0, alternativeLimit).map(async option => {
      const track = await check(option.track);
      return track ? { track, relation: option.relation } : null;
    }));
    const distinctRecordings = checkedRecordings.filter((option, index) => !checkedRecordings.slice(0, index)
      .some(previous => sameReleaseRecording(previous, option)));
    return {
      alternatives: [...distinctRecordings.map(({ track, relation }) => ({ track, relation })), ...checked.filter(Boolean)]
        .slice(0, autoSelectAlternative ? Infinity : 3),
      temporaryFailure,
      error: lastFailureDetail
    };
  }

  async resolvePlayable(track, origin, signSecret, { fresh = false } = {}) {
    const provider = this.providers.get(track.provider);
    const id = track.sourceId;
    if (!provider || !isMusicSourceId(track.provider, id)) return null;
    const key = provider.id + ':' + id;
    let resolved = fresh ? null : this.resolved.get(key);
    if (!resolved || resolved.expiresAt <= Date.now()) {
      let pending = this.resolving.get(key);
      if (!pending) {
        if (this.resolving.size >= 16) throw new Error('Music source resolution is busy');
        pending = provider.resolveStream(id).then(source => {
          if (this.resolved.size >= 256) this.resolved.delete(this.resolved.keys().next().value);
          const result = {
            source,
            expiresAt: Date.now() + (source
              ? (provider.id === 'qq' ? RESOLVED_CACHE_TTL_MS : PARTNER_STREAM_TTL_MS)
              : FAILED_CACHE_TTL_MS)
          };
          this.resolved.set(key, result);
          return result;
        }).finally(() => this.resolving.delete(key));
        this.resolving.set(key, pending);
      }
      resolved = await pending;
    }
    const source = resolved.source;
    if (!source) return null;
    const base = origin.replace(/\/+$/, '');
    const referer = provider.id === 'netease' ? 'https://music.163.com/'
      : provider.id === 'kugou' ? 'https://www.kugou.com/'
      : provider.id === 'youtube' ? 'https://www.youtube.com/'
      : 'https://y.qq.com/';
    const proxyUrl = signStreamProxyUrl(base, source.url, signSecret, referer, source.mimeType, key + ':128');
    const directUrl = provider.id === 'qq' && typeof source.url === 'string' && source.url.startsWith('http')
      ? source.url.replace(/^http:\/\//i, 'https://')
      : '';
    const primaryStreamUrl = directUrl || proxyUrl;

    if (!resolved.streamUrl || resolved.streamOrigin !== base) {
      resolved.streamOrigin = base;
      resolved.streamUrl = primaryStreamUrl;
      resolved.proxyUrl = proxyUrl;
      resolved.directUrl = directUrl;
    }
    return {
      ...track,
      id: key,
      cover: track.cover || normalizeMusicTrack({ ...track, cover: source.cover })?.cover || '',
      durationSec: source.durationSec || track.durationSec || 0,
      streamUrl: primaryStreamUrl,
      proxyUrl,
      directUrl,
      audioSource: {
        checked: Boolean(source.providerChannel && source.mimeType),
        channel: source.providerChannel || '',
        mimeType: source.mimeType || ''
      },
      lrcUrl: base + '/api/music/lyric?provider=' + provider.id + '&id=' + encodeURIComponent(id)
    };
  }

  async isCached(track, secret) {
    try {
      const urlToVerify = track.proxyUrl || track.streamUrl;
      const token = new URL(urlToVerify).searchParams.get('token');
      const verified = verifyStreamProxyToken(token, secret);
      return Boolean(verified && await hasCachedAudio(verified.url, verified.trackKey));
    } catch {
      return false;
    }
  }

  async isHealthy(track, secret) {
    try {
      const urlToVerify = track.proxyUrl || track.streamUrl;
      const token = new URL(urlToVerify).searchParams.get('token');
      const verified = verifyStreamProxyToken(token, secret);
      if (!verified) return false;
      if (await hasCachedAudio(verified.url, verified.trackKey)) return true;
      await probeAudio(verified.url);
      return true;
    } catch {
      return false;
    }
  }

  async getLyric(providerId, sourceId) {
    const provider = this.providers.get(providerId || 'qq');
    if (!provider) return null;
    return provider.getLyric(sourceId);
  }
}
