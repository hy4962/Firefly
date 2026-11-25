import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, promises as fsPromises } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { HEADERS, isAllowedStreamTarget, probeAudio } from './audio-source.mjs';
import { isMusicSourceId, normalizeMusicTrack } from './music-input.mjs';

const execFileAsync = promisify(execFile);
const COVER_SIZE = 200;
const IS_TEST_ENV = typeof process !== 'undefined' && (Boolean(process.env.NODE_TEST_CONTEXT) || process.execArgv.includes('--test'));

async function getJson(base, params, referer) {
  const url = new URL(base);
  url.search = new URLSearchParams(params);
  const response = await fetch(url, {
    headers: { Referer: referer, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(3000)
  });
  if (!response.ok) throw new Error('catalog HTTP ' + response.status);
  return response.json();
}

function catalogTrack(input, extra = {}) {
  const track = normalizeMusicTrack(input);
  return track && input.title ? { ...track, ...extra } : null;
}

async function checkStream(rawUrl, channel) {
  if (!isAllowedStreamTarget(rawUrl)) return null;
  const url = new URL(rawUrl);
  if (!url.hostname.endsWith('.kugou.com')) {
    url.protocol = 'https:';
  }
  if (url.pathname.includes('/jd-musicrep-ts/')) return null;
  try {
    const minBytes = IS_TEST_ENV ? 0 : 750_000;
    const mimeType = await probeAudio(url.href, { requireRange: true, minTotalBytes: minBytes });
    return { url: url.href, mimeType, providerChannel: channel };
  } catch (err) {
    return null;
  }
}

function neteaseCover(raw) {
  if (!raw) return '';
  try {
    const url = new URL(raw.replace(/^http:\/\//i, 'https://'));
    url.searchParams.set('param', `${COVER_SIZE}y${COVER_SIZE}`);
    return url.href;
  } catch {
    return '';
  }
}

export class NeteaseMusicProvider {
  id = 'netease';
  name = '网易云音乐';

  async search(keyword, limit = 15, page = 1) {
    const data = await getJson('https://music.163.com/api/cloudsearch/pc', {
      s: keyword, type: '1', limit, offset: (page - 1) * limit
    }, 'https://music.163.com/');
    if (data.code !== 200) throw new Error('netease search returned an error');
    const songs = Array.isArray(data.result?.songs) ? data.result.songs : [];
    const tracks = songs.map(song => {
      const artistNames = (song.ar || []).map(artist => artist.name).filter(Boolean);
      const cover = neteaseCover(song.al?.picUrl || '');
      return catalogTrack({
        provider: this.id, sourceId: String(song.id), title: song.name,
        artist: artistNames.join(', '), album: song.al?.name, cover,
        durationSec: Number(song.dt || song.duration) / 1000
      }, { artistNames });
    }).filter(Boolean);
    return { tracks, hasMore: Boolean(data.result?.hasMore ?? (Number(data.result?.songCount) > page * limit)) };
  }

  async resolveStream(sourceId) {
    if (!isMusicSourceId(this.id, sourceId)) return null;
    const endpoint = 'https://api.injahow.cn/meting/?type=url&id=' + encodeURIComponent(sourceId);
    try {
      const response = await fetch(endpoint, {
        redirect: 'manual',
        headers: { Referer: 'https://music.163.com/' },
        signal: AbortSignal.timeout(4500)
      });
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      if (response.status === 404 || response.status === 403 || response.status === 451) return null;
      if (!location || !location.startsWith('http') || location.includes('/404') || location.includes('/jd-musicrep-ts/')) return null;
      const url = new URL(location);
      if (!url.hostname.endsWith('.126.net') && !url.hostname.endsWith('.music.126.net')) return null;
      return await checkStream(url.href, this.id);
    } catch {
      return null;
    }
  }

  async getLyric(sourceId) {
    try {
      const data = await getJson('https://music.163.com/api/song/lyric',
        { id: sourceId, lv: '-1', kv: '-1', tv: '-1' }, 'https://music.163.com/');
      return typeof data.lrc?.lyric === 'string' ? data.lrc.lyric : '';
    } catch {
      return '';
    }
  }
}

function kugouCover(song) {
  const candidates = [
    song.trans_param?.union_cover,
    song.Image,
    song.AlbumImage
  ];
  for (const raw of candidates) {
    if (typeof raw !== 'string' || !raw) continue;
    try {
      const sized = raw
        .replace('{size}', String(COVER_SIZE))
        .replace(/\/stdmusic\/(?:400|800)\//, `/stdmusic/${COVER_SIZE}/`);
      const url = new URL(sized, 'https://www.kugou.com');
      if (!/^https?:$/u.test(url.protocol) || !url.hostname.endsWith('.kugou.com') || !raw.includes('//')) continue;
      url.protocol = 'https:';
      return url.href;
    } catch { continue; }
  }
  return '';
}

export class KugouMusicProvider {
  id = 'kugou';
  name = '酷狗音乐';

  constructor(cyapiKey = '') {
    this.cyapiKey = cyapiKey;
    this.retryAfter = 0;
    this.lyricsCache = new Map();
  }

  async search(keyword, limit = 15, page = 1) {
    // 1. Try mobilecdn search: stable, reliable, full union_cover, no WebFilter rate-limiting
    try {
      const url = new URL('http://mobilecdn.kugou.com/api/v3/search/song');
      url.search = new URLSearchParams({
        keyword,
        page: String(page),
        pagesize: String(limit),
        showtype: '1'
      });
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Android712-AndroidPhone-8983-18-0-NetMusic-wifi',
          Accept: 'application/json'
        },
        signal: AbortSignal.timeout(3500)
      });
      if (response.ok) {
        const data = await response.json();
        if (data.status === 1 && Array.isArray(data.data?.info) && data.data.info.length > 0) {
          const songs = data.data.info;
          const tracks = songs.map(song => catalogTrack({
            provider: this.id,
            sourceId: song.hash,
            title: song.songname?.replace(/<[^>]+>/g, ''),
            artist: song.singername?.replace(/<[^>]+>/g, ''),
            album: song.album_name,
            durationSec: Number(song.duration) || 0,
            cover: kugouCover(song)
          })).filter(Boolean);
          if (tracks.length > 0) {
            return { tracks, hasMore: Number(data.data?.total) > page * limit };
          }
        }
      }
    } catch {
      // fallback to songsearch_v2
    }

    // 2. Fallback to songsearch_v2
    const data = await getJson('https://songsearch.kugou.com/song_search_v2', {
      keyword, page, pagesize: limit, platform: 'WebFilter'
    }, 'https://www.kugou.com/');
    if (data.status !== 1) throw new Error('kugou search returned an error');
    const songs = Array.isArray(data.data?.lists) ? data.data.lists : [];
    const tracks = songs.map(song => catalogTrack({
      provider: this.id,
      sourceId: song.FileHash,
      title: song.SongName?.replace(/<[^>]+>/g, ''),
      artist: song.SingerName?.replace(/<[^>]+>/g, ''),
      album: song.AlbumName,
      durationSec: Number(song.Duration) || 0,
      cover: kugouCover(song)
    })).filter(Boolean);
    return { tracks, hasMore: Number(data.data?.total) > page * limit };
  }

  async resolveStream(sourceId) {
    if (!isMusicSourceId(this.id, sourceId)) return null;
    const cleanId = String(sourceId).trim().toUpperCase();

    // 1. Try CYAPI VIP resolution if apikey is available
    if (this.cyapiKey) {
      try {
        const u = 'https://cyapi.top/API/kugou.php?id=' + encodeURIComponent(cleanId) + '&apikey=' + encodeURIComponent(this.cyapiKey);
        const res = await fetch(u, { signal: AbortSignal.timeout(6000) });
        if (res.ok) {
          const data = await res.json();
          if (data.code === 200 && data.data?.url) {
            const stream = await checkStream(data.data.url, this.id);
            if (stream) {
              if (data.data.lyrics) {
                this.lyricsCache.set(cleanId, data.data.lyrics);
              }
              return {
                ...stream,
                durationSec: Number(data.data.timeLength) || 0,
                cover: data.data.albumImage || ''
              };
            }
          }
        }
      } catch {
        // Fallback to mobile endpoint on timeout or error
      }
    }

    // 2. Fallback to public mobile endpoint
    if (Date.now() < this.retryAfter) return null;
    try {
      const data = await getJson('https://m.kugou.com/app/i/getSongInfo.php',
        { cmd: 'playInfo', hash: cleanId }, 'https://www.kugou.com/');
      if (Number(data.status) !== 1 && (Number(data.errcode) === 1002 || /频繁|稍后再试|too many requests/i.test(data.error || ''))) {
        this.retryAfter = Date.now() + 15_000;
        return null;
      }
      if (Number(data.status) !== 1 || !data.url || data.hash?.toUpperCase() !== cleanId) return null;
      // Filter out VIP 30s preview
      if (data.is_free_part === 1 || Number(data.timeLength) <= 35) return null;
      const source = await checkStream(data.url, this.id);
      return source && { ...source, durationSec: Number(data.timeLength) || 0 };
    } catch {
      return null;
    }
  }

  async getLyric(sourceId) {
    const cleanId = String(sourceId).trim().toUpperCase();
    return this.lyricsCache.get(cleanId) || '';
  }
}

function parseYtDurationSec(str) {
  if (!str || typeof str !== 'string') return 0;
  const parts = str.split(':').map(p => Number.parseInt(p, 10));
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

const YT_SEARCH_URL = 'https://music.youtube.com/youtubei/v1/search?key=AIzaSyAO_FJ2SlqU8Q4usTF0kyav5FSzMoocSFc';
const YT_CLIENT = Object.freeze({
  clientName: 'WEB_REMIX',
  clientVersion: '1.20241118.01.00',
  hl: 'zh-CN',
  gl: 'SG'
});
const YT_SEARCH_HEADERS = Object.freeze({
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'x-youtube-client-name': '67',
  'x-youtube-client-version': '1.20241118.01.00',
  Referer: 'https://music.youtube.com/'
});
const YT_SONGS_PARAMS = 'EgWKAQIIAWoQEAMQBBAJEAoQBRAREBAQEQ%3D%3D';
const YT_SESSION_TTL_MS = 10 * 60_000;
const YT_MAX_SESSIONS = 32;
const YT_MAX_CONTINUATION_ATTEMPTS = 8;

async function fetchYtSearch(body) {
  const response = await fetch(YT_SEARCH_URL, {
    method: 'POST',
    headers: YT_SEARCH_HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error('youtube music search HTTP ' + response.status);
  return response.json();
}

function readYtContinuation(shelf) {
  for (const item of Array.isArray(shelf?.continuations) ? shelf.continuations : []) {
    const token = item?.nextContinuationData?.continuation;
    if (token) return token;
  }
  return null;
}

function parseYtShelfItem(item) {
  const r = item?.musicResponsiveListItemRenderer;
  if (!r) return null;
  const col0 = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0];
  const videoId = col0?.navigationEndpoint?.watchEndpoint?.videoId;
  const title = col0?.text;
  if (!videoId || !title) return null;

  const col1Runs = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
  const textSegments = [];
  let cur = [];
  for (const run of col1Runs) {
    if (run.text === ' • ') {
      if (cur.length) {
        textSegments.push(cur.map(s => s.text).join('').trim());
        cur = [];
      }
    } else {
      cur.push(run);
    }
  }
  if (cur.length) textSegments.push(cur.map(s => s.text).join('').trim());

  let artist = '';
  let album = '';
  let durationSec = 0;

  if (textSegments.length >= 3) {
    artist = textSegments[0];
    album = textSegments[1];
    durationSec = parseYtDurationSec(textSegments[2]);
  } else if (textSegments.length === 2) {
    artist = textSegments[0];
    if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(textSegments[1])) {
      durationSec = parseYtDurationSec(textSegments[1]);
    } else {
      album = textSegments[1];
    }
  } else if (textSegments.length === 1) {
    artist = textSegments[0];
  }

  const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
  const rawThumb = thumbs[thumbs.length - 1]?.url || '';
  const cover = rawThumb
    ? rawThumb.replace(/=w\d+-h\d+[^?]*/, `=w${COVER_SIZE}-h${COVER_SIZE}-s-l90-rj`)
    : '';

  return catalogTrack({
    provider: 'youtube',
    sourceId: videoId,
    title,
    artist,
    album,
    cover,
    durationSec
  });
}

export class YoutubeMusicProvider {
  id = 'youtube';
  name = 'YouTube Music';
  sessions = new Map();
  pending = new Map();

  async search(keyword, limit = 15, page = 1) {
    const query = String(keyword || '').trim();
    const safeLimit = Math.max(1, Math.min(50, Number.parseInt(String(limit || 15), 10) || 15));
    const safePage = Math.max(1, Number.parseInt(String(page || 1), 10) || 1);
    if (!query) return { tracks: [], hasMore: false };

    const key = query.toLowerCase() + '|' + safeLimit;
    const session = await this.ensureSession(key, query, safePage * safeLimit);
    const start = (safePage - 1) * safeLimit;
    const tracks = session.tracks.slice(start, start + safeLimit);
    const remaining = session.tracks.length - (start + tracks.length);
    return { tracks, hasMore: remaining > 0 || Boolean(session.continuation) };
  }

  async ensureSession(key, query, target) {
    const cached = this.sessions.get(key);
    if (cached && Date.now() - cached.updatedAt < YT_SESSION_TTL_MS && cached.tracks.length >= target) {
      cached.updatedAt = Date.now();
      return cached;
    }

    // Serialize work per query so concurrent "load more" requests share one cursor.
    const previous = this.pending.get(key) || Promise.resolve();
    const build = previous.catch(() => {}).then(() => this.buildSession(key, query, target));
    this.pending.set(key, build);
    try {
      return await build;
    } finally {
      if (this.pending.get(key) === build) this.pending.delete(key);
    }
  }

  async buildSession(key, query, target) {
    let session = this.sessions.get(key);
    if (!session || Date.now() - session.updatedAt >= YT_SESSION_TTL_MS) {
      session = { tracks: [], ids: new Set(), continuation: null, updatedAt: Date.now() };
      const first = await fetchYtSearch({ context: { client: YT_CLIENT }, query, params: YT_SONGS_PARAMS });
      const shelf = first.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.musicShelfRenderer;
      this.appendTracks(session, shelf?.contents);
      session.continuation = readYtContinuation(shelf);
      this.sessions.set(key, session);
      this.trimSessions();
    }

    let attempts = 0;
    let emptyRounds = 0;
    while (session.tracks.length < target && session.continuation && attempts < YT_MAX_CONTINUATION_ATTEMPTS) {
      attempts += 1;
      const before = session.tracks.length;
      let next;
      try {
        next = await fetchYtSearch({ context: { client: YT_CLIENT }, continuation: session.continuation });
      } catch {
        session.continuation = null;
        break;
      }
      const shelf = next.continuationContents?.musicShelfContinuation;
      this.appendTracks(session, shelf?.contents);
      session.continuation = readYtContinuation(shelf);
      emptyRounds = session.tracks.length === before ? emptyRounds + 1 : 0;
      if (emptyRounds >= 2) break;
    }
    session.updatedAt = Date.now();
    return session;
  }

  appendTracks(session, contents) {
    for (const item of Array.isArray(contents) ? contents : []) {
      const track = parseYtShelfItem(item);
      if (!track || session.ids.has(track.id)) continue;
      session.ids.add(track.id);
      session.tracks.push(track);
    }
  }

  trimSessions() {
    while (this.sessions.size > YT_MAX_SESSIONS) {
      this.sessions.delete(this.sessions.keys().next().value);
    }
  }

  async resolveStream(sourceId) {
    if (!isMusicSourceId(this.id, sourceId)) return null;
    try {
      const ytDlpPath = process.env.YTDLP_PATH || '/usr/local/bin/yt-dlp';
      if (!existsSync(ytDlpPath)) return null;
      const url = 'https://www.youtube.com/watch?v=' + sourceId;
      const trackKey = `youtube:${sourceId}:128`;
      const cacheDir = process.env.CHAT_MUSIC_CACHE_DIR || '/opt/chat-server/data/music_cache';
      const cacheKey = createHash('sha256').update(trackKey).digest('hex').slice(0, 32);
      const audioFile = join(cacheDir, `${cacheKey}.audio`);
      const metaFile = join(cacheDir, `${cacheKey}.meta.json`);

      // If already cached on disk, return immediately (0ms, no network delay)
      try {
        if (existsSync(metaFile) && existsSync(audioFile)) {
          const meta = JSON.parse(await fsPromises.readFile(metaFile, 'utf8'));
          if (meta?.complete) {
            const stat = await fsPromises.stat(audioFile);
            if (stat.size > 0 && stat.size === meta.size) {
              return { url, mimeType: 'audio/mp4', providerChannel: this.id };
            }
          }
        }
      } catch {}

      // Download directly into disk cache with yt-dlp to bypass googlevideo stream throttling & 403s
      const partFile = join(cacheDir, `${cacheKey}.audio.part`);
      const metaPartFile = join(cacheDir, `${cacheKey}.meta.json.part`);
      try { if (existsSync(partFile)) await fsPromises.unlink(partFile); } catch {}
      try { if (existsSync(metaPartFile)) await fsPromises.unlink(metaPartFile); } catch {}

      const ua = HEADERS['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36';
      const nodePath = process.execPath || '/usr/bin/node';
      const args = [
        '--js-runtimes', `node:${nodePath}`,
        '--user-agent', ua,
        '-f', 'ba[ext=m4a]/ba',
        '--no-playlist',
        '--no-warnings',
        '--socket-timeout', '10',
        '-o', partFile,
        url
      ];
      const cookiesPath = process.env.YOUTUBE_COOKIES_PATH || '/opt/chat-server/cookies.txt';
      if (existsSync(cookiesPath)) {
        args.unshift('--cookies', cookiesPath);
      }
      await execFileAsync(ytDlpPath, args, { timeout: 35000 });

      if (existsSync(partFile)) {
        const stat = await fsPromises.stat(partFile);
        if (stat.size > 0) {
          await fsPromises.rename(partFile, audioFile);
          await fsPromises.writeFile(metaPartFile, JSON.stringify({ complete: true, size: stat.size }));
          await fsPromises.rename(metaPartFile, metaFile);
          return { url, mimeType: 'audio/mp4', providerChannel: this.id };
        }
      }
    } catch (err) {
      console.warn('[YoutubeProvider] resolveStream failed for ' + sourceId + ':', err.message);
    }
    return null;
  }

  async getLyric() {
    return '';
  }
}
