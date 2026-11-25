import { isAllowedStreamTarget, probeAudio } from './audio-source.mjs';

const QQ_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Referer: 'https://y.qq.com/'
};

const QQ_COVER_SIZE = 150;

function normalizeQqCover(raw) {
  return raw.replace(/(T00[12])R\d+x\d+M000/, `$1R${QQ_COVER_SIZE}x${QQ_COVER_SIZE}M000`);
}

function buildAlbumCoverUrl(albumMid) {
  if (!albumMid) return '';
  return `https://y.gtimg.cn/music/photo_new/T002R${QQ_COVER_SIZE}x${QQ_COVER_SIZE}M000${encodeURIComponent(albumMid)}.jpg`;
}

function readArtistCredit(singer) {
  const name = typeof singer?.name === 'string' ? singer.name.trim().slice(0, 240) : '';
  if (!name) return null;
  const mid = typeof singer.mid === 'string' ? singer.mid.trim() : '';
  const id = /^[A-Za-z0-9]{1,32}$/.test(mid) && mid !== '0'
    ? 'mid:' + mid
    : Number.isSafeInteger(singer.id) && singer.id > 0 ? 'id:' + singer.id : '';
  const alias = typeof singer.transname === 'string' ? singer.transname.trim().slice(0, 240) : '';
  return { name, ...(id && { id }), ...(id && alias && alias !== name && { alias }) };
}

function extractCoverUrl(raw) {
  if (typeof raw === 'string' && raw.startsWith('http')) return normalizeQqCover(raw);
  if (raw && typeof raw === 'object') {
    for (const key of ['medium', 'large', 'small']) {
      if (typeof raw[key] === 'string' && raw[key].startsWith('http')) return normalizeQqCover(raw[key]);
    }
  }
  return undefined;
}

function decodeBase64Utf8(b64) {
  const clean = b64.replace(/\s+/g, '');
  return Buffer.from(clean, 'base64').toString('utf8');
}

function decodeHtmlEntities(input) {
  return input
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    })
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const SEARCH_CACHE_TTL_MS = 60_000;
const SEARCH_CACHE_MAX_SIZE = 200;

export class QQMusicProvider {
  constructor(cyapiKey) {
    this.id = 'qq';
    this.name = '在线曲库';
    this.cyapiKey = cyapiKey;
    this.searchCache = new Map();
    this.accountRetryAt = 0;
    this.artistAliases = new Map();
    this.pendingArtists = new Map();
    this.inFlightSearches = new Map();
  }

  async getArtistAliases(id) {
    if (!/^mid:[a-zA-Z0-9]{1,32}$/.test(id)) return [];
    const cached = this.artistAliases.get(id);
    if (cached?.expiresAt > Date.now()) return cached.names;
    if (this.pendingArtists.has(id)) return this.pendingArtists.get(id);
    if (this.pendingArtists.size >= 8) return [];
    const pending = (async () => {
      const url = new URL('https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_singer_desc.fcg');
      url.search = new URLSearchParams({ singermid: id.slice(4), utf8: '1', outCharset: 'utf-8', format: 'xml' });
      const response = await fetch(url, { headers: QQ_HEADERS, signal: AbortSignal.timeout(1800) });
      if (!response.ok) { await response.body?.cancel(); return []; }
      const xml = await response.text();
      const names = [];
      for (const field of xml.matchAll(/<key>\s*<!\[CDATA\[(?:外文名|英文名|别名|本名)\]\]>\s*<\/key>\s*<value>\s*<!\[CDATA\[([^\]]+)\]\]>/gu)) {
        names.push(...field[1].split(/[、，,;；/]/u).map(name => name.trim()).filter(Boolean));
      }
      if (this.artistAliases.size >= 256) this.artistAliases.delete(this.artistAliases.keys().next().value);
      this.artistAliases.set(id, { names, expiresAt: Date.now() + 86400_000 });
      return names;
    })().finally(() => this.pendingArtists.delete(id));
    this.pendingArtists.set(id, pending);
    return pending;
  }

  async search(keyword, limit = 30, page = 1) {
    const trimmed = (keyword || '').trim();
    if (!trimmed) return { tracks: [], hasMore: false };
    const safeLimit = Math.min(30, Math.max(1, limit));
    const safePage = Math.max(1, Number.parseInt(String(page || 1), 10) || 1);
    const cacheKey = `${trimmed.toLowerCase()}:${safeLimit}:${safePage}`;

    const cached = this.searchCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < SEARCH_CACHE_TTL_MS) {
      return cached.result;
    }

    const existing = this.inFlightSearches.get(cacheKey);
    if (existing) {
      return existing;
    }

    if (this.inFlightSearches.size >= 24) throw new Error('在线曲库繁忙，请稍后重试');

    const promise = (async () => {
      const primary = await this.searchViaClientSearch(trimmed, safeLimit, safePage);
      if (primary.ok) {
        this.setSearchCache(cacheKey, primary);
        return primary;
      }

      if (safePage === 1) {
        const fallback = await this.searchViaSmartbox(trimmed, safeLimit);
        if (fallback.ok) {
          this.setSearchCache(cacheKey, fallback);
          return fallback;
        }
      }

      throw new Error('在线曲库搜索暂时不可用，请稍后重试');
    })();

    this.inFlightSearches.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.inFlightSearches.delete(cacheKey);
    }
  }

  setSearchCache(cacheKey, result) {
    if (this.searchCache.size >= SEARCH_CACHE_MAX_SIZE) {
      const oldestKey = this.searchCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.searchCache.delete(oldestKey);
      }
    }
    this.searchCache.set(cacheKey, { result, fetchedAt: Date.now() });
  }

  async searchViaClientSearch(keyword, limit, page = 1) {
    try {
      const url = `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?p=${page}&n=${limit}&w=${encodeURIComponent(keyword)}&format=json`;
      const resp = await fetch(url, {
        headers: QQ_HEADERS,
        signal: AbortSignal.timeout(3500)
      });
      if (!resp.ok) return { ok: false, tracks: [] };
      const data = await resp.json();
      if (typeof data?.code === 'number' && data.code !== 0) {
        return { ok: false, tracks: [] };
      }
      const song = data.data?.song;
      if (!Array.isArray(song?.list)) return { ok: false, tracks: [] };
      const list = song.list;
      const tracks = [];
      const seenIds = new Set();
      for (const item of list) {
        const mid = (item.songmid || '').trim();
        const title = (item.songname || '').trim();
        const trackId = `qq:${mid}`;
        if (!mid || !title || seenIds.has(trackId)) continue;
        seenIds.add(trackId);
        const artistCredits = Array.isArray(item.singer)
          ? item.singer.map(readArtistCredit).filter(Boolean)
          : [];
        const artistNames = artistCredits.map(credit => credit.name);
        const albumMid = (item.albummid || '').trim();
        const albumName = (item.albumname || '').trim();
        const durationSec =
          typeof item.interval === 'number' && Number.isFinite(item.interval) && item.interval > 0
            ? Math.round(item.interval)
            : 0;

        tracks.push({
          id: `qq:${mid}`,
          provider: this.id,
          sourceId: mid,
          title,
          artist: artistNames.join(' / ') || '未知歌手',
          artistNames,
          ...(artistCredits.length && { artistCredits }),
          album: albumName || undefined,
          cover: buildAlbumCoverUrl(albumMid),
          durationSec
        });
      }
      const total = Number(song.totalnum);
      const hasMore = total > 0 ? page * limit < total : list.length >= limit;
      return { ok: true, tracks: tracks.slice(0, limit), hasMore };
    } catch {
      return { ok: false, tracks: [] };
    }
  }

  async searchViaSmartbox(keyword, limit) {
    try {
      const url = `https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?key=${encodeURIComponent(keyword)}&format=json&inCharset=utf8&outCharset=utf-8`;
      const resp = await fetch(url, {
        headers: QQ_HEADERS,
        signal: AbortSignal.timeout(3500)
      });
      if (!resp.ok) return { ok: false, tracks: [] };
      const data = await resp.json();
      if (typeof data?.code === 'number' && data.code !== 0) {
        return { ok: false, tracks: [] };
      }
      const items = data.data?.song?.itemlist;
      if (!data.data || (items != null && !Array.isArray(items))) return { ok: false, tracks: [] };
      const tracks = [];
      const seenIds = new Set();
      for (const item of (items || []).slice(0, limit)) {
        const mid = (item.mid || '').trim();
        const title = (item.name || '').trim();
        const trackId = `qq:${mid}`;
        if (!mid || !title || seenIds.has(trackId)) continue;
        seenIds.add(trackId);
        tracks.push({
          id: `qq:${mid}`,
          provider: this.id,
          sourceId: mid,
          title,
          artist: (item.singer || '').trim() || '未知歌手',
          cover: '',
          durationSec: 0
        });
      }
      return { ok: true, tracks, hasMore: false };
    } catch {
      return { ok: false, tracks: [] };
    }
  }

  async trySource(mid, source) {
    try {
      const response = await fetch(source.endpoint, {
        headers: QQ_HEADERS,
        signal: AbortSignal.timeout(source.timeoutMs || 5000)
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 404) return null;
        throw new Error('resolver HTTP ' + response.status);
      }
      const json = await response.json();
      if (json?.code === 110001 || json?.code === 110002) {
        const errMsg = `上游账号风控 (${json.message || 'code ' + json.code})`;
        const err = new Error(errMsg);
        err.isRiskControl = true;
        throw err;
      }
      const data = source.read(json);
      if (data == null || typeof data !== 'object') return null;
      if (typeof data.url !== 'string' || !data.url.trim()) return null;
      if (!isAllowedStreamTarget(data.url)) throw new Error('untrusted audio host');
      const mimeType = await probeAudio(data.url);
      const durationVal = Number(data.interval || data.duration);
      return {
        url: data.url,
        mimeType,
        cover: extractCoverUrl(data.cover || data.pic),
        durationSec: Number.isFinite(durationVal) && durationVal > 0 ? Math.round(durationVal) : undefined,
        providerChannel: source.name
      };
    } catch (error) {
      if (!error.isRiskControl && mid && mid !== '0') {
        console.warn('[MusicSource]', source.name, mid, error.message);
      }
      throw error;
    }
  }

  async resolveStream(mid) {
    const cleanMid = (mid || '').trim();
    if (!cleanMid || cleanMid === '0') return null;
    const id = encodeURIComponent(cleanMid);

    // Prefer the 128 kbps QQ Music stream from vkeys.
    const vkeys128Source = {
      name: 'vkeys-128',
      timeoutMs: 3000,
      endpoint: 'https://api.vkeys.cn/music/tencent/song/link?quality=6&mid=' + id,
      read: data => data?.data
    };

    // Keep the secondary supplier for the same QQ Music track.
    const cyapiSource = this.cyapiKey ? {
      name: 'cyapi',
      timeoutMs: 6500,
      endpoint: 'https://cyapi.top/API/qq_music.php?type=json&quality=128&mid=' + id +
        '&apikey=' + encodeURIComponent(this.cyapiKey),
      read: data => data
    } : null;

    let temporaryFailure = false;
    let lastFailureReason = '';
    const attempt = source => this.trySource(cleanMid, source).catch(err => {
      if (source === vkeys128Source && err.isRiskControl && Date.now() >= this.accountRetryAt) {
        this.accountRetryAt = Date.now() + 60_000;
        console.warn('[MusicSource] vkeys-128 上游账号暂时受限，一分钟后重试');
      }
      temporaryFailure = true;
      lastFailureReason = err?.message || '上游音源服务响应异常';
      return null;
    });
    if (Date.now() < this.accountRetryAt) {
      if (!cyapiSource) throw new Error('Music source temporarily unavailable');
      const source = await this.trySource(cleanMid, cyapiSource);
      if (!source) throw new Error('Music source temporarily unavailable');
      return source;
    }
    const primaryPromise = attempt(vkeys128Source);
    let hedgeTimer;
    const earlyResult = await Promise.race([
      primaryPromise,
      new Promise(resolve => {
        hedgeTimer = setTimeout(() => resolve('HEDGE_TIMEOUT'), 300);
      })
    ]);
    clearTimeout(hedgeTimer);

    if (earlyResult && earlyResult !== 'HEDGE_TIMEOUT') {
      return earlyResult;
    }

    // If the preferred supplier is slow, wind-controlled, or unavailable, race the remaining sources.
    const candidates = [];
    if (earlyResult === 'HEDGE_TIMEOUT') {
      candidates.push(primaryPromise);
    }

    if (cyapiSource) {
      candidates.push(attempt(cyapiSource));
    }

    try {
      const winner = await Promise.any(
        candidates.map(async p => {
          const res = await p;
          if (!res) throw new Error('null source');
          return res;
        })
      );
      if (winner) return winner;
    } catch {
      if (temporaryFailure) throw new Error('Music source temporarily unavailable: ' + (lastFailureReason || '上游接口响应异常'));
    }

    return null;
  }

  async getLyric(mid) {
    const cleanMid = (mid || '').trim();
    if (!cleanMid) return null;

    try {
      const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(cleanMid)}&format=json&nobase64=1`;
      const resp = await fetch(url, {
        headers: QQ_HEADERS,
        signal: AbortSignal.timeout(6000)
      });
      if (!resp.ok) return null;

      const rawText = await resp.text();
      const jsonText = rawText
        .trim()
        .replace(/^MusicJsonCallback\(/, '')
        .replace(/\);?$/, '');
      const data = JSON.parse(jsonText);
      if (typeof data.lyric !== 'string' || !data.lyric.trim()) {
        return null;
      }

      let lyricText = data.lyric.trim();
      if (!lyricText.includes('[') && /^[A-Za-z0-9+/=\r\n]+$/.test(lyricText)) {
        try {
          lyricText = decodeBase64Utf8(lyricText);
        } catch {}
      }

      return decodeHtmlEntities(lyricText);
    } catch {
      return null;
    }
  }
}
