const LABEL_MAX = 240;
const MAX_PLAYLIST_BYTES = 8 * 1024 * 1024;

function label(value, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, LABEL_MAX) || fallback : fallback;
}

function coverUrl(value) {
  if (typeof value !== 'string' || value.length > 1024) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export function normalizeIsrc(value) {
  const code = typeof value === 'string' ? value.toUpperCase().replace(/[\s-]/g, '') : '';
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(code) ? code : undefined;
}

export function normalizeMusicTrack(input) {
  const idParts = typeof input?.id === 'string' ? input.id.split(':', 2) : [];
  const platform = input?.provider || input?.sourcePlatform || idParts[0];
  const provider = platform === 'qqmusic' ? 'qq' : platform;
  const sourceId = input?.sourceId || input?.sourceTrackId || (idParts[0] === provider ? idParts[1] : '');
  if (!isMusicSourceId(provider, sourceId)) return null;
  const canonicalId = provider === 'kugou' ? sourceId.toUpperCase() : sourceId;
  const durationSec = Number(input.durationSec || input.duration);
  return {
    id: provider + ':' + canonicalId,
    sourceId: canonicalId,
    provider,
    title: label(input.title, '未知曲目'),
    artist: label(input.artist, '未知歌手'),
    album: label(input.album) || undefined,
    cover: coverUrl(input.cover || input.pic),
    durationSec: Number.isFinite(durationSec) && durationSec > 0 && durationSec <= 86400 ? durationSec : 0
  };
}

// Positions change on refresh and in filtered favorites. Prefer a catalog identity.
export function findPlaylistRequestTrack(tracks, input) {
  if (!Array.isArray(tracks) || !input) return null;
  const atPosition = Number.isSafeInteger(input.position)
    ? tracks.find(track => track.position === input.position) : null;
  const nativeId = normalizeMusicTrack(input)?.id;
  const matches = track => {
    if (nativeId) return track.id === nativeId || track.matchedTrack?.id === nativeId ||
      normalizeMusicTrack(track)?.id === nativeId;
    if (input.sourcePlatform && track.sourcePlatform !== input.sourcePlatform) return false;
    if (input.title && input.title !== track.title) return false;
    if (input.artist && input.artist !== track.artist) return false;
    if (input.sourceId && track.sourceTrackId) return String(track.sourceTrackId) === input.sourceId;
    return Boolean(input.title && input.artist);
  };
  if (atPosition && matches(atPosition)) return atPosition;
  const found = tracks.filter(matches);
  return found.length === 1 ? found[0] : null;
}

export function isMusicSourceId(provider, sourceId) {
  if (typeof sourceId !== 'string') return false;
  if (provider === 'qq') return /^[A-Za-z0-9]{1,32}$/.test(sourceId);
  if (provider === 'netease') return /^[1-9]\d{0,17}$/.test(sourceId);
  if (provider === 'kugou') return /^[a-f0-9]{32}$/i.test(sourceId);
  if (provider === 'youtube') return /^[A-Za-z0-9_-]{11}$/.test(sourceId);
  return false;
}

export async function readPlaylistJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_PLAYLIST_BYTES) {
      req.resume();
      throw Object.assign(new Error('playlist body too large'), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
