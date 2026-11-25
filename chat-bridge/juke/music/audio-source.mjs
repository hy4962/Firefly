export const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
  Referer: 'https://y.qq.com/',
  'Accept-Encoding': 'identity'
};

export function isAllowedStreamTarget(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return ['http:', 'https:'].includes(url.protocol) && !url.port &&
      !url.username && !url.password &&
      (host.endsWith('.stream.qqmusic.qq.com') || host.endsWith('.music.tc.qq.com') ||
        host.endsWith('.music.qq.com') || host.endsWith('.music.gtimg.com') ||
        host.endsWith('.music.126.net') || host.endsWith('.126.net') ||
        host.endsWith('.kugou.com') || host.endsWith('.googlevideo.com') ||
        host.endsWith('.youtube.com') || host === 'youtube.com');
  } catch {
    return false;
  }
}

export async function fetchAudio(url, { range, signal } = {}) {
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!isAllowedStreamTarget(url)) throw new Error('untrusted audio host');
    const host = new URL(url).hostname.toLowerCase();
    const referer = (host.endsWith('.126.net') || host.endsWith('.music.126.net')) ? 'https://music.163.com/'
      : host.endsWith('.kugou.com') ? 'https://www.kugou.com/'
      : host.endsWith('.googlevideo.com') ? 'https://www.youtube.com/' : HEADERS.Referer;
    const headers = { ...HEADERS, Referer: referer, ...(range && { Range: range }) };
    const response = await fetch(url, { headers, signal, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) break;
    url = new URL(location, url).href;
  }
  throw new Error('invalid audio redirect');
}

export function identifyAudio(bytes) {
  if (bytes.length < 4) return null;
  if (bytes.subarray(0, 3).toString() === 'ID3') return 'audio/mpeg';
  if (bytes.subarray(4, 8).toString() === 'ftyp') return 'audio/mp4';
  if (bytes.subarray(0, 4).toString() === 'fLaC') return 'audio/flac';
  if (bytes.subarray(0, 4).toString() === 'OggS') return 'audio/ogg';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'audio/webm';
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return (bytes[1] & 0x06) === 0 ? 'audio/aac' : 'audio/mpeg';
  }
  return null;
}

export async function probeAudio(url, { signal, requireRange = false, minTotalBytes = 0 } = {}) {
  const response = await fetchAudio(url, {
    range: 'bytes=0-4095',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(2200)]) : AbortSignal.timeout(2200)
  });
  const contentRange = response.headers.get('content-range') || '';
  if (!response.ok || !response.body || (requireRange && response.status !== 206) ||
      (response.status === 206 && !/^bytes 0-\d+\/\d+$/.test(contentRange))) {
    await response.body?.cancel();
    throw new Error('audio probe HTTP ' + response.status);
  }
  if (minTotalBytes > 0 && response.status === 206) {
    const totalBytes = Number(contentRange.split('/')[1]);
    if (Number.isFinite(totalBytes) && totalBytes < minTotalBytes) {
      await response.body?.cancel();
      throw new Error('audio stream too short (' + totalBytes + ' bytes < ' + minTotalBytes + ')');
    }
  }
  const reader = response.body.getReader();
  let prefix = Buffer.alloc(0);
  try {
    while (prefix.length < 12) {
      const { done, value } = await reader.read();
      if (done) break;
      prefix = Buffer.concat([prefix, Buffer.from(value.subarray(0, 12 - prefix.length))]);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const mimeType = identifyAudio(prefix);
  if (!mimeType) throw new Error('invalid audio header');
  return mimeType;
}
