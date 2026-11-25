/**
 * 茶室点歌台 · 音乐聚合层
 *
 * 只做四件事：
 *   1. 搜歌（QQ 音乐 / 网易云 / 酷狗 / YouTube Music，统一成一份结构）
 *   2. 找可播音源（优先原平台，失败就按歌名 + 歌手 + 时长去别的平台对齐）
 *   3. 解析公开歌单（Playlist Out）
 *   4. 给跨域/防盗链的音频做签名代理
 *
 * 取链在官方接口之外接入 CYAPI 聚合源做竞速与兜底：
 *   - QQ：vkeys（主，快）与 CYAPI 320k（备，带歌词）谁先返回用谁；
 *   - 酷狗：官方 play/getdata 若命中 30 秒试听（is_free_part），自动降级 CYAPI 拿完整音源（320k/FLAC）。
 * 所有上游都是公开接口，Worker 只做转发与归一化，不落盘、不存音频。
 */

const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const enc = encodeURIComponent;
const SOURCES = new Set(["qq", "netease", "kugou", "youtube", "local"]);
const SOURCE_LABEL = { qq: "QQ 音乐", netease: "网易云", kugou: "酷狗", youtube: "YouTube Music" };

// CYAPI 聚合源：仅服务端用于解析直链/歌词，从不下发到浏览器。
// 凭据不写进源码（仓库公开），由部署环境通过 CYAPI_KEY 注入，便于随时轮换。
const CYAPI_BASE = "https://cyapi.top/API";
let cyapiKey = "";
export function setCyapiKey(value) {
	cyapiKey = String(value || "").trim();
}
function cyapiKeyOf() {
	return cyapiKey;
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));
const text = (v, max) =>
	String(v ?? "")
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, max);

/** FNV-1a，只用来生成稳定短键，不承担安全职责 */
function hashKey(input) {
	let h = 0x811c9dc5;
	const s = String(input || "");
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36);
}

export function trackKey(track) {
	if (track?.key) return track.key;
	if (track?.source && track?.sourceId) return `${track.source}:${track.sourceId}`;
	return `h:${hashKey(`${track?.title || ""}|${track?.artist || ""}|${Math.round(Number(track?.durationSec) || 0)}`)}`;
}

/** 统一歌曲结构。外部 URL 只允许 https 与站内 /assets。 */
export function normalizeTrack(raw, fallback = {}) {
	const title = text(raw?.title ?? raw?.name ?? fallback.title, 100);
	if (!title) return null;
	const source = SOURCES.has(raw?.source) ? raw.source : SOURCES.has(fallback.source) ? fallback.source : "";
	const sourceId = text(raw?.sourceId ?? raw?.id ?? fallback.sourceId, 80);
	const artist = text(raw?.artist ?? raw?.author ?? fallback.artist, 140) || "未知歌手";
	const album = text(raw?.album ?? fallback.album, 80);
	const durationSec = clamp(raw?.durationSec ?? raw?.duration ?? (raw?.durationMs ? raw.durationMs / 1000 : 0), 0, 3600);
	const rawCover = String(raw?.cover ?? raw?.coverUrl ?? raw?.pic ?? fallback.cover ?? "").slice(0, 300);
	const cover = /^https?:\/\//i.test(rawCover) || rawCover.startsWith("/assets/") ? rawCover.replace(/^http:/i, "https:") : "";
	const rawUrl = String(raw?.url ?? "").slice(0, 300);
	const url = /^\/assets\//.test(rawUrl) || /^https:\/\//i.test(rawUrl) ? rawUrl : "";
	const platform = text(raw?.platform ?? raw?.originPlatform ?? fallback.platform, 24);
	const key = text(raw?.key, 80) || (source && sourceId ? `${source}:${sourceId}` : `h:${hashKey(`${title}|${artist}|${Math.round(durationSec)}`)}`);
	return {
		key,
		title,
		artist,
		album,
		cover: cover || "",
		durationSec: Math.round(durationSec * 10) / 10,
		source,
		sourceId,
		platform: platform || source,
		...(url ? { url } : {}),
	};
}

// ── 网络 ─────────────────────────────────────────────────────────────

async function fetchWithTimeout(url, { headers = {}, timeout = 8000, redirect = "follow", method = "GET", body } = {}) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeout);
	try {
		return await fetch(url, {
			method,
			body,
			headers: { "User-Agent": UA, ...headers },
			redirect,
			signal: ctrl.signal,
		});
	} finally {
		clearTimeout(timer);
	}
}

async function getJson(url, headers, timeout = 8000) {
	const res = await fetchWithTimeout(url, { headers, timeout });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}

const cache = new Map();
function cacheGet(key) {
	const hit = cache.get(key);
	if (!hit) return null;
	if (hit.exp <= Date.now()) {
		cache.delete(key);
		return null;
	}
	return hit.value;
}
function cacheSet(key, value, ttl = 10 * 60_000) {
	cache.set(key, { value, exp: Date.now() + ttl });
	if (cache.size > 600) {
		const now = Date.now();
		for (const [k, v] of cache) if (v.exp <= now) cache.delete(k);
	}
	return value;
}

// ── 搜索 ─────────────────────────────────────────────────────────────

async function searchQQ(q, limit, page = 1) {
	const url = `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?p=${page}&n=${limit}&w=${enc(q)}&format=json&inCharset=utf8&outCharset=utf-8`;
	const data = await getJson(url, { Referer: "https://y.qq.com/" });
	const list = data?.data?.song?.list || [];
	return list
		.map((s) =>
			normalizeTrack({
				source: "qq",
				sourceId: s.songmid,
				title: s.songname,
				artist: (s.singer || []).map((x) => x.name).filter(Boolean).join(" / "),
				album: s.albumname,
				durationSec: s.interval,
				cover: s.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.albummid}.jpg` : "",
			}),
		)
		.filter((t) => t && t.sourceId);
}

async function searchNetease(q, limit, page = 1) {
	const url = `https://music.163.com/api/cloudsearch/pc?s=${enc(q)}&type=1&limit=${limit}&offset=${(page - 1) * limit}`;
	const data = await getJson(url, { Referer: "https://music.163.com/", Accept: "application/json" });
	const list = data?.result?.songs || [];
	return list
		.map((s) =>
			normalizeTrack({
				source: "netease",
				sourceId: s.id,
				title: s.name,
				artist: (s.ar || []).map((x) => x.name).filter(Boolean).join(" / "),
				album: s.al?.name,
				durationSec: s.dt ? s.dt / 1000 : 0,
				cover: s.al?.picUrl,
			}),
		)
		.filter((t) => t && t.sourceId);
}

async function searchKugou(q, limit, page = 1) {
	// 主通道：移动端 CDN（自带高清封面，不被频控拦）
	const primary = `http://mobilecdn.kugou.com/api/v3/search/song?keyword=${enc(q)}&page=${page}&pagesize=${limit}&showtype=1`;
	let data;
	try {
		data = await getJson(primary, { Accept: "application/json" });
	} catch (_) {
		// 备用通道：complexsearch，主通道偶发异常时回退
		const fallback = `https://complexsearch.kugou.com/v2/search/song?keyword=${enc(q)}&page=${page}&pagesize=${limit}&bitrate=0&isfuse=0`;
		data = await getJson(fallback, { Accept: "application/json" });
	}
	const list = data?.data?.info || [];
	return list
		.map((s) => {
			const cover = String(s.trans_param?.union_cover || "").replace("{size}", "400");
			return normalizeTrack({
				source: "kugou",
				sourceId: s.hash,
				title: s.songname,
				artist: s.singername,
				album: s.album_name,
				durationSec: s.duration,
				cover: /^https:\/\//.test(cover) ? cover : "",
			});
		})
		.filter((t) => t && t.sourceId);
}

async function searchYouTube(q, limit, page = 1) {
	// InnerTube 没有简单的 offset，翻页需要 continuation 游标；首页已够兜底用。
	if (page > 1) return [];
	// YouTube Music 内部 InnerTube Web API。
	// 注意：文章里那个 params（只看 Songs）过滤串已被官方改动，现在只会返回专辑，
	// 所以这里不传 params，直接从返回的 itemSectionRenderer 里挑音乐条目。
	const body = {
		context: {
			client: { clientName: "WEB_REMIX", clientVersion: "1.20240101.01.00", hl: "zh-CN", gl: "US" },
		},
		query: q,
	};
	const res = await fetchWithTimeout("https://music.youtube.com/youtubei/v1/search?prettyPrint=false", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Referer: "https://music.youtube.com/",
			Origin: "https://music.youtube.com",
			Accept: "application/json",
		},
		body: JSON.stringify(body),
		timeout: 10000,
	});
	if (!res.ok) throw new Error(`YouTube Music HTTP ${res.status}`);
	const data = await res.json();
	const sections = data?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
	const runText = (x) => (Array.isArray(x?.runs) ? x.runs.map((y) => y.text).join("") : x?.simpleText || "");
	const durSec = (s) => {
		const parts = String(s || "").split(":").map(Number);
		if (parts.some((n) => !Number.isFinite(n))) return 0;
		return parts.reduce((acc, n) => acc * 60 + n, 0);
	};
	const out = [];
	for (const sec of sections) {
		const containers = [
			...(sec?.itemSectionRenderer?.contents || []),
			...(sec?.musicShelfRenderer?.contents || []),
		];
		for (const item of containers) {
			const r = item?.musicResponsiveListItemRenderer || item?.songRenderer;
			if (!r) continue;
			const videoId =
				r.playlistItemData?.videoId ||
				r.navigationEndpoint?.watchEndpoint?.videoId ||
				r.videoId;
			if (!videoId) continue;
			const cols = r.flexColumns || [];
			const title = runText(cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text) || runText(r.title);
			const metaRuns = cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
			// 只收「歌曲」，把普通视频 / 歌单混排结果挡在外面
			if (!metaRuns.some((x) => x.text === "歌曲")) continue;
			const artist =
				metaRuns.find((x) => x.text && x.text !== "歌曲" && x.text !== " • " && !/播放次数|次播放/.test(x.text))?.text || "";
			const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || r.thumbnail?.thumbnails || [];
			const thumb = thumbs.slice(-1)[0]?.url || "";
			const dur = durSec(r.lengthText?.simpleText) || Number(r.lengthSeconds || 0);
			const t = normalizeTrack({
				source: "youtube",
				sourceId: videoId,
				title,
				artist,
				durationSec: dur,
				cover: /^https:\/\//.test(thumb) ? thumb : "",
			});
			if (t) out.push(t);
			if (out.length >= limit) break;
		}
		if (out.length >= limit) break;
	}
	return out;
}

const SEARCHERS = { qq: searchQQ, netease: searchNetease, kugou: searchKugou, youtube: searchYouTube };

export async function searchMusic(source, query, limit = 12, page = 1) {
	const q = text(query, 60);
	if (!q) return [];
	const key = `search:${source}:${q}:${limit}:${page}`;
	const hit = cacheGet(key);
	if (hit) return hit;

	let items = [];
	if (source === "all") {
		const results = await Promise.allSettled([
			searchQQ(q, Math.min(limit, 8), page),
			searchNetease(q, Math.min(limit, 8), page),
			searchKugou(q, Math.min(limit, 8), page),
			searchYouTube(q, Math.min(limit, 8), page),
		]);
		const buckets = results.map((r) => (r.status === "fulfilled" ? r.value : []));
		// 轮流出结果，避免第一屏全是同一个平台
		const max = Math.max(...buckets.map((b) => b.length), 0);
		for (let i = 0; i < max && items.length < limit; i++) {
			for (const bucket of buckets) {
				if (bucket[i] && items.length < limit) items.push(bucket[i]);
			}
		}
	} else if (SEARCHERS[source]) {
		items = (await SEARCHERS[source](q, limit, page)).slice(0, limit);
	}
	return cacheSet(key, items, 2 * 60_000);
}

// ── 歌曲名清洗与跨平台对齐 ───────────────────────────────────────────

const VERSION_WORDS = [
	["live", /(?:live|现场|演唱会)/i],
	["remix", /(?:remix|混音|dj)/i],
	["instrumental", /(?:instrumental|伴奏|off\s*vocal|karaoke)/i],
	["acoustic", /(?:acoustic|不插电)/i],
	["cover", /(?:cover|翻唱|翻自)/i],
	["remaster", /(?:remaster|重制|母带)/i],
];

function versionTags(s) {
	const out = new Set();
	for (const [name, re] of VERSION_WORDS) if (re.test(s)) out.add(name);
	return out;
}

function baseTitle(s) {
	return String(s || "")
		.replace(/[（(\[【][^）)\]】]*[）)\]】]/g, " ")
		.replace(/\s*[-–—]\s*(?:live|remix|instrumental|acoustic|remaster|伴奏|现场|翻唱).*$/i, " ")
		.replace(/\s+/g, " ")
		.trim();
}

// 跨平台对齐时统一繁简体与常见中英别名，避免「周杰倫」对不上「周杰伦 / Jay Chou」
const SIMPLIFIED_MAP = {
	倫: "伦", 傑: "杰", 會: "会", 愛: "爱", 頭: "头", 時: "时", 無: "无", 專: "专",
	輯: "辑", 樂: "乐", 聲: "声", 點: "点", 國: "国", 華: "华", 風: "风", 雲: "云",
	夢: "梦", 離: "离", 開: "开", 關: "关", 來: "来", 個: "个", 為: "为", 與: "与",
	這: "这", 說: "说", 對: "对", 發: "发", 現: "现", 經: "经", 過: "过", 還: "还",
	從: "从", 亞: "亚", 爾: "尔", 內: "内", 萬: "万", 復: "复", 興: "兴", 盡: "尽",
};
const ARTIST_ALIASES = [
	[/^(?:周杰伦|周杰倫|jay\s*chou)$/i, "周杰伦"],
	[/^(?:林俊杰|林俊傑|jj\s*lin)$/i, "林俊杰"],
	[/^(?:陈奕迅|陳奕迅|eason\s*chan)$/i, "陈奕迅"],
	[/^(?:aimer|エメ)$/i, "aimer"],
	[/^(?:五月天|mayday)$/i, "五月天"],
	[/^(?:蔡依林|蔡依琳|jolin\s*tsai)$/i, "蔡依林"],
];
function norm(s) {
	let v = baseTitle(s).replace(/[倫傑會愛頭時無專輯樂聲點國華風雲夢離開關來個為與這說對發現經過還從亞爾內萬復興盡]/g, (ch) => SIMPLIFIED_MAP[ch] || ch);
	for (const [re, to] of ARTIST_ALIASES) if (re.test(v.trim())) v = to;
	return v
		.toLowerCase()
		.replace(/[\s\-_.·・,，、/\\&+~!！?？:：'"“”‘’()（）[\]【】]/g, "")
		.replace(/feat\.?.*$/, "")
		.trim();
}

function artistParts(s) {
	return String(s || "")
		.split(/[\/,，、&;；]|\sfeat\.?\s|\sft\.?\s/i)
		.map((x) => norm(x.replace(/\(.*?\)/g, "")))
		.filter((x) => x && x.length > 1);
}

function scoreCandidate(want, cand) {
	const wt = norm(want.title);
	const ct = norm(cand.title);
	if (!wt || !ct) return -Infinity;
	const wv = versionTags(want.title);
	const cv = versionTags(cand.title);
	let score = 0;
	if (wt === ct) score += 12;
	else if (wt.length > 3 && (ct.includes(wt) || wt.includes(ct))) score += 6;
	else return -Infinity;

	const mismatch = [...wv].filter((x) => !cv.has(x)).length + [...cv].filter((x) => !wv.has(x)).length;
	score -= mismatch * 5;

	const wa = artistParts(want.artist);
	const ca = artistParts(cand.artist);
	if (wa.length && ca.length) {
		const hit = wa.some((a) => ca.some((b) => a === b || (a.length > 3 && b.includes(a)) || (b.length > 3 && a.includes(b))));
		score += hit ? 7 : -4;
	}

	const wd = Number(want.durationSec) || 0;
	const cd = Number(cand.durationSec) || 0;
	if (wd && cd) {
		const diff = Math.abs(wd - cd);
		if (diff <= 2) score += 9;
		else if (diff <= 4) score += 4;
		else if (diff <= 8) score += 1;
		else if (diff > 20) score -= 8;
	}
	return score;
}

// ── 取直链 ───────────────────────────────────────────────────────────

/** 从 vkeys 取 QQ 直链（主源，快） */
async function vkeysQqLink(id, quality = 6) {
	const data = await getJson(`https://api.vkeys.cn/music/tencent/song/link?quality=${quality}&mid=${enc(id)}`, {}, 7000);
	let url = String(data?.data?.url || "").replace(/^http:/i, "https:");
	if (!/^https:\/\//i.test(url)) throw new Error("vkeys 没有返回直链");
	return url;
}

/** 从 CYAPI 取 QQ 直链（备用源，320k/FLAC，附带歌词） */
async function cyapiQqLink(id, quality = "320") {
	const key = cyapiKeyOf();
	if (!key) throw new Error("CYAPI 凭据未配置");
	const data = await getJson(
		`${CYAPI_BASE}/qq_music.php?type=json&quality=${quality}&mid=${enc(id)}&apikey=${enc(key)}`,
		{},
		9000,
	);
	let url = String(data?.url || "").replace(/^http:/i, "https:");
	if (!/^https:\/\//i.test(url)) throw new Error("CYAPI 没有返回直链");
	const lrc = String(data?.lyric?.text || "");
	if (lrc) cacheSet(`lrc:qq:${id}`, lrc, 60 * 60_000);
	return url;
}

async function qqLink(id) {
	const key = `link:qq:${id}`;
	const hit = cacheGet(key);
	if (hit) return hit;

	// 双源竞速：谁先拿到有效直链用谁。CYAPI 返回 320k 且带歌词，vkeys 延迟更低。
	const winner = await Promise.any([
		vkeysQqLink(id, 6),
		cyapiQqLink(id, "320"),
	]).catch(() => "");
	if (winner) return cacheSet(key, winner, 15 * 60_000);

	// 两个源都失败时再逐个低码率兜底，尽量把歌唱出来
	for (const step of [
		() => vkeysQqLink(id, 2),
		() => cyapiQqLink(id, "128"),
	]) {
		try {
			const url = await step();
			if (url) return cacheSet(key, url, 15 * 60_000);
		} catch (_) {}
	}
	return "";
}

async function neteaseLink(id) {
	const key = `link:netease:${id}`;
	const hit = cacheGet(key);
	if (hit) return hit;
	const apis = [
		`https://api.injahow.cn/meting/?type=url&id=${enc(id)}`,
		`https://api.injahow.cn/meting/?server=netease&type=url&id=${enc(id)}`,
		`https://api.i-meto.com/meting/api?server=netease&type=url&id=${enc(id)}`,
	];
	for (const api of apis) {
		try {
			const res = await fetchWithTimeout(api, {
				headers: { Referer: "https://music.163.com/", Accept: "*/*" },
				timeout: 7000,
				redirect: "manual",
			});
			const loc = res.headers.get("location") || "";
			if (loc && /^https?:\/\//i.test(loc)) {
				try {
					await res.body?.cancel();
				} catch (_) {}
				return cacheSet(key, loc.replace(/^http:/i, "https:"), 15 * 60_000);
			}
			const type = res.headers.get("content-type") || "";
			if (res.ok && type.includes("json")) {
				const data = await res.json().catch(() => null);
				const url = String((Array.isArray(data) ? data[0]?.url : data?.url) || "");
				if (/^https?:\/\//i.test(url)) return cacheSet(key, url.replace(/^http:/i, "https:"), 15 * 60_000);
			}
			if (res.ok && type.includes("audio")) {
				const url = res.url || api;
				try {
					await res.body?.cancel();
				} catch (_) {}
				return cacheSet(key, url, 15 * 60_000);
			}
			try {
				await res.body?.cancel();
			} catch (_) {}
		} catch (_) {}
	}
	return "";
}

async function kugouLink(hash) {
	const key = `link:kugou:${hash}`;
	const hit = cacheGet(key);
	if (hit) return hit;

	// 先走官方免费接口；VIP 歌会返回 is_free_part=1 并截断成 30 秒试听
	const mid = String(Math.floor(Math.random() * 900000 + 100000));
	const url = `https://wwwapi.kugou.com/yy/index.php?r=play/getdata&hash=${enc(hash)}&dfid=-&mid=${mid}&platid=4&_=${Date.now()}`;
	try {
		const data = await getJson(url, {
			Referer: "https://www.kugou.com/",
			Accept: "application/json",
			Cookie: `kg_mid=${mid}; kg_dfid=${mid}`,
		});
		const partial = Number(data?.data?.is_free_part) === 1;
		const raw = String(data?.data?.play_url || data?.data?.play_backup_url || "");
		if (!partial && /^https?:\/\//i.test(raw)) {
			return cacheSet(key, raw.replace(/^http:/i, "https:"), 10 * 60_000);
		}
	} catch (_) {}

	// 官方源不通或只有试听片段 → CYAPI 拿完整音源（320k / FLAC）
	const apikey = cyapiKeyOf();
	if (!apikey) return "";
	try {
		const data = await getJson(
			`${CYAPI_BASE}/kugou.php?id=${enc(hash)}&apikey=${enc(apikey)}`,
			{},
			9000,
		);
		const raw = String(data?.data?.url || "");
		if (/^https?:\/\//i.test(raw)) {
			const lrc = String(data?.data?.lyrics || "");
			if (lrc) cacheSet(`lrc:kugou:${hash}`, lrc, 60 * 60_000);
			return cacheSet(key, raw, 15 * 60_000);
		}
	} catch (_) {}
	return "";
}

async function lyricsFor(source, id) {
	const key = `lrc:${source}:${id}`;
	const hit = cacheGet(key);
	if (hit !== null) return hit;
	let lrc = "";
	try {
		if (source === "qq") {
			const data = await getJson(
				`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${enc(id)}&format=json&nobase64=1`,
				{ Referer: "https://y.qq.com/" },
				5000,
			);
			lrc = String(data?.lyric || "");
		} else if (source === "netease") {
			const data = await getJson(
				`https://music.163.com/api/song/lyric?id=${enc(id)}&lv=-1&kv=-1&tv=-1`,
				{ Referer: "https://music.163.com/" },
				5000,
			);
			lrc = String(data?.lrc?.lyric || "");
		}
	} catch (_) {}
	lrc = lrc
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.slice(0, 20_000);
	return cacheSet(key, lrc, 60 * 60_000);
}

async function directResolve(track) {
	if (track.source === "local") return track.url ? { url: track.url, source: "local", sourceId: track.key } : null;
	if (!SOURCES.has(track.source) || !track.sourceId) return null;
	let url = "";
	if (track.source === "qq") url = await qqLink(track.sourceId);
	else if (track.source === "netease") url = await neteaseLink(track.sourceId);
	else if (track.source === "kugou") url = await kugouLink(track.sourceId);
	if (!url) return null;
	return { url, source: track.source, sourceId: track.sourceId };
}

const NO_SOURCE = "这首歌暂时找不到可播的音源，换一首试试。";

/**
 * 解析一首歌的可播地址。原平台不行就跨平台对齐，最后返回直链 + 歌词。
 * @returns {Promise<{url:string, source:string, sourceId:string, lrc:string}>}
 */
export async function resolveTrack(track) {
	if (!track || !track.title) throw new Error(NO_SOURCE);
	const key = `resolve:${trackKey(track)}`;
	const hit = cacheGet(key);
	if (hit) return hit;

	const own = await directResolve(track).catch(() => null);
	if (own) {
		const lrc = await lyricsFor(own.source, own.sourceId);
		return cacheSet(key, { ...own, lrc }, 12 * 60_000);
	}

	// 跨平台对齐：按歌名 + 歌手 + 时长挑前几个候选，谁先拿到直链用谁
	const query = `${baseTitle(track.title)} ${artistParts(track.artist)[0] || ""}`.trim();
	const buckets = await Promise.allSettled([
		searchQQ(query, 8),
		searchNetease(query, 8),
		searchKugou(query, 8),
	]);
	const candidates = buckets
		.flatMap((r) => (r.status === "fulfilled" ? r.value : []))
		.map((c) => ({ c, score: scoreCandidate(track, c) }))
		.filter((x) => x.score >= 14)
		.sort((a, b) => b.score - a.score)
		.slice(0, 5)
		.map((x) => x.c);

	for (const cand of candidates) {
		const got = await directResolve(cand).catch(() => null);
		if (!got) continue;
		const lrc = await lyricsFor(got.source, got.sourceId);
		return cacheSet(key, { ...got, lrc }, 12 * 60_000);
	}
	throw new Error(NO_SOURCE);
}

// ── 歌单导入 ─────────────────────────────────────────────────────────

const PLAYLIST_HOSTS = [
	/(^|\.)music\.163\.com$/,
	/(^|\.)y\.qq\.com$/,
	/(^|\.)qq\.com$/,
	/(^|\.)music\.apple\.com$/,
	/(^|\.)open\.spotify\.com$/,
	/(^|\.)spotify\.com$/,
	/(^|\.)youtube\.com$/,
	/(^|\.)youtu\.be$/,
	/(^|\.)kugou\.com$/,
];

export async function importPlaylist(input) {
	let raw = text(input, 600);
	const short = raw.match(/https?:\/\/[^\s]+/i);
	if (short) raw = short[0];
	let parsed;
	try {
		parsed = new URL(raw);
	} catch (_) {
		throw new Error("这不是一个有效的歌单链接");
	}
	if (!/^https?:$/.test(parsed.protocol) || !PLAYLIST_HOSTS.some((re) => re.test(parsed.hostname))) {
		throw new Error("暂时只支持网易云 / QQ / Apple Music / Spotify / YouTube / 酷狗的歌单链接");
	}

	const cacheKey = `playlist:${raw}`;
	const hit = cacheGet(cacheKey);
	if (hit) return hit;

	const data = await getJson(
		`https://playlistout-api.lengxiqwq.com/api/v1/resolve?q=${enc(raw)}`,
		{ Accept: "application/json" },
		18_000,
	);
	if (!data?.success) throw new Error(text(data?.error, 120) || "歌单解析失败，检查一下链接是不是公开的");
	const result = data?.data?.result || data?.data || {};
	const tracksRaw = Array.isArray(result.tracks) ? result.tracks : [];
	if (!tracksRaw.length) throw new Error("这个歌单里没有读到歌曲");

	const platform = text(result.platform || "", 24);
	const playablePlatform = platform === "netease" || platform === "qq" ? platform : "";
	const tracks = tracksRaw
		.slice(0, 100)
		.map((t) =>
			normalizeTrack(
				{
					source: playablePlatform,
					sourceId: playablePlatform ? t.id : "",
					title: t.title,
					artist: t.artist,
					album: t.album,
					durationSec: t.durationSec || (t.durationMs ? t.durationMs / 1000 : 0),
					cover: t.coverUrl || t.cover,
					platform,
				},
				{ platform },
			),
		)
		.filter(Boolean);

	return cacheSet(
		cacheKey,
		{
			name: text(result.name || "导入的歌单", 80),
			platform,
			creator: text(result.creator, 60),
			cover: /^https?:\/\//.test(String(result.coverUrl || "")) ? String(result.coverUrl).replace(/^http:/i, "https:") : "",
			trackCount: tracks.length,
			tracks,
		},
		30 * 60_000,
	);
}

// ── 签名代理 ─────────────────────────────────────────────────────────

const AUDIO_HOSTS = [
	/(^|\.)stream\.qqmusic\.qq\.com$/,
	/(^|\.)ws\.stream\.qqmusic\.qq\.com$/,
	/(^|\.)isure\.stream\.qqmusic\.qq\.com$/,
	/(^|\.)dl\.stream\.qqmusic\.qq\.com$/,
	/(^|\.)music\.126\.net$/,
	/(^|\.)kugou\.com$/,
	/(^|\.)kglh\.kugou\.com$/,
	/(^|\.)api\.injahow\.cn$/,
	/(^|\.)api\.i-meto\.com$/,
];

function b64url(input) {
	const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s) {
	const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
	const bin = atob(pad);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return new TextDecoder().decode(bytes);
}

async function hmac(secret, payload) {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
		"sign",
	]);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
	return b64url(new Uint8Array(sig)).slice(0, 24);
}

/** 生成带过期时间的代理地址；secret 为空时退化为固定串（仍不可被随意改写） */
export async function proxyUrl(url, secret, origin, ttl = 3 * 60 * 60_000) {
	const exp = Date.now() + ttl;
	const u = b64url(url);
	const sig = await hmac(secret || "tea-juke", `${u}.${exp}`);
	return `${origin}/api/juke/stream?u=${u}&e=${exp}&s=${sig}`;
}

export async function verifyProxy(query, secret) {
	const u = String(query.get("u") || "");
	const exp = Number(query.get("e") || 0);
	const sig = String(query.get("s") || "");
	if (!u || !exp || exp < Date.now() || exp > Date.now() + 24 * 60 * 60_000) return "";
	const expect = await hmac(secret || "tea-juke", `${u}.${exp}`);
	if (sig !== expect) return "";
	let url = "";
	try {
		url = unb64url(u);
	} catch (_) {
		return "";
	}
	let host = "";
	try {
		host = new URL(url).hostname;
	} catch (_) {
		return "";
	}
	if (!/^https?:\/\//i.test(url) || !AUDIO_HOSTS.some((re) => re.test(host))) return "";
	return url;
}

function refererFor(url) {
	try {
		const host = new URL(url).hostname;
		if (/qqmusic\.qq\.com$/.test(host)) return "https://y.qq.com/";
		if (/music\.126\.net$/.test(host)) return "https://music.163.com/";
		if (/kugou\.com$/.test(host)) return "https://www.kugou.com/";
	} catch (_) {}
	return "https://www.0dm.cn/";
}

export async function proxyAudio(request, target) {
	const headers = { "User-Agent": UA, Referer: refererFor(target), Accept: "*/*" };
	const range = request.headers.get("range");
	if (range) headers.Range = range;
	const res = await fetch(target, { headers, redirect: "follow" });
	if (!res.ok && res.status !== 206) throw new Error(`上游音频 ${res.status}`);
	const out = new Headers();
	for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
		const v = res.headers.get(name);
		if (v) out.set(name, v);
	}
	out.set("Cache-Control", "public, max-age=3600");
	out.set("Access-Control-Allow-Origin", "*");
	return new Response(res.body, { status: res.status, headers: out });
}

export { SOURCE_LABEL };
