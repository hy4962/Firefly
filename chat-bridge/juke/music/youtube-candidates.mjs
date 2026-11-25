const FRESH_MS = 10 * 60_000;
const MAX_CACHED_QUERIES = 100;
const MAX_CONCURRENT = 2;

export class YoutubeCandidates {
  constructor(apiKey) {
    this.apiKey = apiKey?.trim();
    this.cache = new Map();
    this.pending = new Map();
    this.recentUsers = new Map();
  }

  get enabled() {
    return Boolean(this.apiKey);
  }

  async search(query, userKey) {
    const cacheKey = query.normalize('NFKC').toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached?.expiresAt > Date.now()) return cached.videos;
    const existing = this.pending.get(cacheKey);
    if (existing) return existing;
    const now = Date.now();
    if (this.pending.size >= MAX_CONCURRENT || now - (this.recentUsers.get(userKey) || 0) < 15_000) {
      throw Object.assign(new Error('YouTube is busy'), { statusCode: 429 });
    }
    if (this.recentUsers.size >= 200) this.recentUsers.delete(this.recentUsers.keys().next().value);
    this.recentUsers.set(userKey, now);
    const request = this.fetchCandidates(query).then(videos => {
      if (this.cache.size >= MAX_CACHED_QUERIES) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(cacheKey, { videos, expiresAt: Date.now() + FRESH_MS });
      return videos;
    }).finally(() => this.pending.delete(cacheKey));
    this.pending.set(cacheKey, request);
    return request;
  }

  async fetchCandidates(query) {
    const params = new URLSearchParams({
      key: this.apiKey, part: 'snippet', type: 'video', videoCategoryId: '10',
      maxResults: '3', q: query
    });
    const response = await fetch('https://www.googleapis.com/youtube/v3/search?' + params, {
      redirect: 'error', signal: AbortSignal.timeout(2300)
    });
    if (!response.ok) throw new Error('YouTube search HTTP ' + response.status);
    const data = await response.json();
    return (Array.isArray(data.items) ? data.items : []).flatMap(({ id, snippet }) => {
      if (!/^[A-Za-z0-9_-]{11}$/.test(id?.videoId || '') || typeof snippet?.title !== 'string') return [];
      return [{ id: id.videoId, title: snippet.title.slice(0, 240), channel: String(snippet.channelTitle || '').slice(0, 120) }];
    }).slice(0, 3);
  }
}
