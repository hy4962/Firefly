/**
 * 茶室桥接核心逻辑 —— 同时给 Cloudflare Worker 和本地调试入口复用。
 *
 * 职责：持有一个「转发账号」的 access token，替访客把消息发进 Matrix 房间，
 * 并把房间消息整理成前端要的精简结构。访客身份通过消息体里的
 * `[ID:昵称];[URL:头像]` 协议头传递（听雨茶室互联文档里的「共享转发账号」方案）。
 *
 * 不落库、不存消息副本：消息的唯一真相在 Matrix 房间。
 */

const DEFAULTS = {
	MATRIX_HS: "https://matrix.0dm.cn",
	ROOM_ID: "!CKQYQ95MT69FlskJmkcEbSmkd72I6CTgnf_nITckm4I",
	SITE_NAME: "折腾进行时",
	SITE_URL: "https://www.0dm.cn",
	FALLBACK_AVATAR: "https://www.9ll.uk/gallery/blog/avatar.avif",
	ALLOW_ORIGINS: "https://www.0dm.cn,https://0dm.cn,https://www.9ll.uk,https://9ll.uk,http://localhost:4399,http://127.0.0.1:4399",
};

const LIMITS = { text: 500, nick: 8, email: 120, website: 120, history: 80 };
const RATE = { minGap: 2500, perMinute: 12, perHour: 60 };

const SITE_BY_SERVER = {
	"matrix.rainzt.cn": "听雨茶室",
	"matrix.yybb.us": "AIOVTUE-雪",
	"chat.gbk.ink": "Somoe",
	"matrix.leenet.xyz": "leenet",
};

// 站点域名 → 站名（结构化协议里 site 传的是首页 URL）
const SITE_BY_HOST = {
	"rainzt.cn": "听雨茶室",
	"detached.online": "Detached",
	"yybb.us": "AIOVTUE-雪",
	"lengxiqwq.com": "冷汐的杂货铺",
	"gbk.ink": "Somoe",
	"somoe.xyz": "Somoe",
	"0dm.cn": "折腾进行时",
	"9ll.uk": "折腾进行时",
};

const enc = encodeURIComponent;
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

const cfg = (env) => ({
	hs: (env.MATRIX_HS || DEFAULTS.MATRIX_HS).replace(/\/$/, ""),
	room: env.ROOM_ID || DEFAULTS.ROOM_ID,
	token: env.BRIDGE_TOKEN || "",
	siteName: env.SITE_NAME || DEFAULTS.SITE_NAME,
	siteUrl: env.SITE_URL || DEFAULTS.SITE_URL,
	fallbackAvatar: env.FALLBACK_AVATAR || DEFAULTS.FALLBACK_AVATAR,
	origins: (env.ALLOW_ORIGINS || DEFAULTS.ALLOW_ORIGINS).split(",").map((s) => s.trim()).filter(Boolean),
});

const json = (status, data, headers = {}) =>
	new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
	});

const fail = (status, error) => json(status, { ok: false, error });

// ── md5（给 weavatar 算头像）─────────────────────────────────────────
const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));

export function md5Hex(input) {
	const utf8 = new TextEncoder().encode(input);
	const len = utf8.length;
	const words = new Uint32Array(Math.ceil((len + 9) / 64) * 16);
	for (let i = 0; i < len; i++) words[i >> 2] |= utf8[i] << ((i % 4) * 8);
	words[len >> 2] |= 0x80 << ((len % 4) * 8);
	words[words.length - 2] = len * 8;

	let a0 = 0x67452301,
		b0 = 0xefcdab89,
		c0 = 0x98badcfe,
		d0 = 0x10325476;

	for (let chunk = 0; chunk < words.length; chunk += 16) {
		let A = a0,
			B = b0,
			C = c0,
			D = d0;
		for (let i = 0; i < 64; i++) {
			let F, g;
			if (i < 16) {
				F = (B & C) | (~B & D);
				g = i;
			} else if (i < 32) {
				F = (D & B) | (~D & C);
				g = (5 * i + 1) % 16;
			} else if (i < 48) {
				F = B ^ C ^ D;
				g = (3 * i + 5) % 16;
			} else {
				F = C ^ (B | ~D);
				g = (7 * i) % 16;
			}
			F = (F + A + K[i] + words[chunk + g]) >>> 0;
			A = D;
			D = C;
			C = B;
			B = (B + ((F << S[(i >> 4) * 4 + (i % 4)]) | (F >>> (32 - S[(i >> 4) * 4 + (i % 4)])))) >>> 0;
		}
		a0 = (a0 + A) >>> 0;
		b0 = (b0 + B) >>> 0;
		c0 = (c0 + C) >>> 0;
		d0 = (d0 + D) >>> 0;
	}

	const hex = (n) => [...new Uint8Array(new Uint32Array([n]).buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
	return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

// ── 成员表（每实例缓存 60s）──────────────────────────────────────────
let memberCache = { at: 0, map: new Map(), room: "" };

async function mx(c, path, opts = {}) {
	const res = await fetch(c.hs + path, {
		...opts,
		headers: {
			Authorization: `Bearer ${c.token}`,
			...(opts.body ? { "Content-Type": "application/json" } : {}),
			...(opts.headers || {}),
		},
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`matrix ${res.status}: ${text.slice(0, 180)}`);
	}
	return res;
}

async function getMembers(c, force = false) {
	if (!force && Date.now() - memberCache.at < 60_000 && memberCache.room === c.room && memberCache.map.size) {
		return memberCache.map;
	}
	const res = await mx(c, `/_matrix/client/v3/rooms/${enc(c.room)}/members`);
	const data = await res.json();
	const map = new Map();
	for (const ev of data.chunk || []) {
		if (ev.type !== "m.room.member" || ev.content?.membership !== "join") continue;
		map.set(ev.state_key, {
			nick: ev.content.displayname || ev.state_key.split(":")[0].replace(/^@/, ""),
			avatar: ev.content.avatar_url || "",
		});
	}
	memberCache = { at: Date.now(), map, room: c.room };
	return map;
}

function siteLabel(url, c) {
	try {
		const host = new URL(url).hostname.replace(/^www\./, "");
		for (const [k, v] of Object.entries(SITE_BY_HOST)) {
			if (host === k || host.endsWith("." + k)) return v;
		}
		for (const [k, v] of Object.entries(SITE_BY_SERVER)) {
			if (host === k || host.endsWith("." + k)) return v;
		}
		return host;
	} catch {
		return "";
	}
}

function normalize(ev, members, c, base) {
	const content = ev.content || {};
	if (!content.body && !content.url) return null;
	// 入房/退房之类的系统通知（m.notice）直接丢掉，别混进聊天流
	if (!["m.text", "m.image", "m.emote"].includes(content.msgtype)) return null;

	const sender = ev.sender || "";
	const domain = sender.split(":")[1] || "";
	const member = members.get(sender) || {};
	let nick = member.nick || sender.split(":")[0].replace(/^@/, "");
	let site = SITE_BY_SERVER[domain] || (domain === "matrix.0dm.cn" ? c.siteName : "");
	let avatar = member.avatar || "";
	let text = typeof content.body === "string" ? content.body : "";
	let image = "";

	const bridge = content["org.tea-room.bridge"];
	if (bridge && typeof bridge === "object") {
		if (bridge.actor?.nick) nick = bridge.actor.nick;
		if (bridge.site) site = siteLabel(bridge.site, c);
		if (typeof bridge.text === "string") text = bridge.text;
	}

	const head = text.match(/^\[ID:([^\]]*)\];\[URL:([^\]]*)\]\s*\n?/);
	if (head) {
		nick = head[1].trim() || nick;
		const url = head[2].trim();
		if (url && !avatar) avatar = url;
		text = text.slice(head[0].length);
	}

	const dot = nick.indexOf(" · ");
	if (dot > 0) {
		site = nick.slice(dot + 3).trim();
		nick = nick.slice(0, dot).trim();
	}

	if (content.msgtype === "m.image" && content.url) {
		image = `${base}/api/media?u=${enc(content.url)}`;
		text = text || "发了一张图片";
	}

	avatar = avatar.startsWith("mxc://") ? `${base}/api/media?u=${enc(avatar)}` : avatar;

	return { id: ev.event_id, ts: ev.origin_server_ts || Date.now(), nick, site, avatar, text, image };
}

// ── 限流：有 KV 就用 KV，本地跑就用内存 ─────────────────────────────
const memory = new Map();

async function rateCheck(env, ip) {
	const now = Date.now();
	if (env.TEA_KV) {
		const gapKey = `gap:${ip}`;
		if (await env.TEA_KV.get(gapKey)) {
			return `说太快啦，${Math.ceil(RATE.minGap / 1000)} 秒后再发。`;
		}
		const minuteKey = `m:${ip}:${Math.floor(now / 60000)}`;
		const hourKey = `h:${ip}:${Math.floor(now / 3600000)}`;
		const [minute, hour] = await Promise.all([
			env.TEA_KV.get(minuteKey),
			env.TEA_KV.get(hourKey),
		]);
		if (Number(minute || 0) >= RATE.perMinute) return "一分钟说得有点多，喘口气。";
		if (Number(hour || 0) >= RATE.perHour) return "这一小时的额度用完了，晚点再来。";
		await Promise.all([
			env.TEA_KV.put(gapKey, "1", { expirationTtl: 3 }),
			env.TEA_KV.put(minuteKey, String(Number(minute || 0) + 1), { expirationTtl: 120 }),
			env.TEA_KV.put(hourKey, String(Number(hour || 0) + 1), { expirationTtl: 3700 }),
		]);
		return "";
	}

	const b = memory.get(ip) || { last: 0, minute: [], hour: [] };
	if (now - b.last < RATE.minGap) return `说太快啦，${Math.ceil((RATE.minGap - (now - b.last)) / 1000)} 秒后再发。`;
	b.minute = b.minute.filter((x) => now - x < 60_000);
	b.hour = b.hour.filter((x) => now - x < 3_600_000);
	if (b.minute.length >= RATE.perMinute) return "一分钟说得有点多，喘口气。";
	if (b.hour.length >= RATE.perHour) return "这一小时的额度用完了，晚点再来。";
	b.last = now;
	b.minute.push(now);
	b.hour.push(now);
	memory.set(ip, b);
	return "";
}

// ── 接口 ────────────────────────────────────────────────────────────
async function handleHistory(c, url, base) {
	const limit = Math.min(Number(url.searchParams.get("limit") || 50) || 50, LIMITS.history);
	const members = await getMembers(c);
	const res = await mx(c, `/_matrix/client/v3/rooms/${enc(c.room)}/messages?dir=b&limit=${limit}`);
	const data = await res.json();
	const messages = (data.chunk || [])
		.map((ev) => (ev.type === "m.room.message" ? normalize(ev, members, c, base) : null))
		.filter(Boolean)
		.reverse();
	return json(200, { ok: true, messages, end: data.end || null });
}

async function handleSync(c, url, base) {
	const since = url.searchParams.get("since") || "";
	const filter = JSON.stringify({
		room: { rooms: [c.room], timeline: { limit: 50 }, state: { lazy_load_members: true } },
	});
	const path = `/_matrix/client/v3/sync?timeout=0&filter=${enc(filter)}` + (since ? `&since=${enc(since)}` : "");
	const res = await mx(c, path);
	const data = await res.json();
	const members = await getMembers(c);
	const timeline = data.rooms?.join?.[c.room]?.timeline?.events || [];
	const messages = timeline
		.map((ev) => (ev.type === "m.room.message" ? normalize(ev, members, c, base) : null))
		.filter(Boolean);
	return json(200, { ok: true, messages, next: data.next_batch || since || null });
}

// 最近 30 分钟发过言的，算「在线」，用来给成员列表点灯
let activeCache = { at: 0, set: new Set(), room: "" };

async function getActiveSenders(c) {
	if (Date.now() - activeCache.at < 60_000 && activeCache.room === c.room) return activeCache.set;
	const res = await mx(c, `/_matrix/client/v3/rooms/${enc(c.room)}/messages?dir=b&limit=120`);
	const data = await res.json();
	const cutoff = Date.now() - 30 * 60 * 1000;
	const set = new Set();
	for (const ev of data.chunk || []) {
		if (ev.type !== "m.room.message") continue;
		if (!ev.origin_server_ts || ev.origin_server_ts < cutoff) continue;
		set.add(ev.sender);
	}
	activeCache = { at: Date.now(), set, room: c.room };
	return set;
}

async function handleRoom(c, base) {
	const [members, active] = await Promise.all([getMembers(c), getActiveSenders(c)]);
	const list = [...members.entries()].map(([id, m]) => {
		const domain = id.split(":")[1] || "";
		const dot = m.nick.indexOf(" · ");
		return {
			id,
			nick: dot > 0 ? m.nick.slice(0, dot) : m.nick,
			site: dot > 0 ? m.nick.slice(dot + 3) : SITE_BY_SERVER[domain] || (domain === "matrix.0dm.cn" ? c.siteName : ""),
			avatar: m.avatar.startsWith("mxc://") ? `${base}/api/media?u=${enc(m.avatar)}` : m.avatar,
			online: active.has(id),
		};
	});
	// 同一个昵称 + 同一站点只留一个（有人开着小号或多设备，列表里会重复）
	const seen = new Map();
	for (const item of list) {
		const key = `${item.nick}|${item.site}`;
		const prev = seen.get(key);
		if (!prev || (!prev.online && item.online)) seen.set(key, item);
	}
	const unique = [...seen.values()];

	unique.sort((a, b) => {
		if (a.online !== b.online) return a.online ? -1 : 1;
		const aMine = a.site === c.siteName;
		const bMine = b.site === c.siteName;
		if (aMine !== bMine) return aMine ? -1 : 1;
		return a.nick.localeCompare(b.nick, "zh");
	});

	return json(200, { ok: true, room: { name: "大厅" }, members: unique, online: unique.filter((m) => m.online).length });
}

async function handleSend(c, request) {
	let body;
	try {
		body = await request.json();
	} catch {
		return fail(400, "请求格式不对");
	}
	const nick = clean(body.nick, LIMITS.nick);
	const email = clean(body.email, LIMITS.email);
	const website = clean(body.website, LIMITS.website);
	const text = clean(body.text, LIMITS.text);

	if (!nick) return fail(400, "先起个昵称");
	if (!text) return fail(400, "空消息发不出去");
	if (email && !isEmail(email)) return fail(400, "邮箱格式不对");

	const avatar = email ? `https://weavatar.com/avatar/${md5Hex(email.trim().toLowerCase())}?s=96&d=mp` : c.fallbackAvatar;

	const payload = {
		msgtype: "m.text",
		body: `[ID:${nick}];[URL:${avatar}]\n${text}`,
		"org.tea-room.bridge": {
			version: 1,
			site: c.siteUrl,
			actor: { id: `guest-${md5Hex(nick + "|" + (email || "")).slice(0, 10)}`, nick },
			text,
			...(website ? { website } : {}),
		},
	};

	const txn = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	const res = await mx(c, `/_matrix/client/v3/rooms/${enc(c.room)}/send/m.room.message/${txn}`, {
		method: "PUT",
		body: JSON.stringify(payload),
	});
	const data = await res.json();
	return json(200, { ok: true, id: data.event_id, ts: Date.now(), nick });
}

async function handleMedia(c, url) {
	const mxc = url.searchParams.get("u") || "";
	const m = mxc.match(/^mxc:\/\/([^/]+)\/([A-Za-z0-9_-]+)$/);
	if (!m) return fail(400, "bad mxc");
	const upstream = await mx(c, `/_matrix/client/v1/media/download/${enc(m[1])}/${enc(m[2])}`);
	const headers = new Headers();
	headers.set("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
	headers.set("Cache-Control", "public, max-age=86400");
	return new Response(upstream.body, { status: 200, headers });
}

// ── 入口 ────────────────────────────────────────────────────────────
export async function handleRequest(request, env = {}) {
	const c = cfg(env);
	const url = new URL(request.url);
	const path = url.pathname.replace(/\/+$/, "") || "/";
	const origin = request.headers.get("origin") || "";

	const corsHeaders = {
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Access-Control-Max-Age": "86400",
		Vary: "Origin",
	};
	if (c.origins.includes(origin)) corsHeaders["Access-Control-Allow-Origin"] = origin;

	if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

	const ip =
		request.headers.get("cf-connecting-ip") ||
		(request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
		"unknown";

	let out;
	try {
		if (!c.token) return withCors(fail(500, "bridge 未配置 BRIDGE_TOKEN"), corsHeaders);

		if (path === "/" || path === "/api/health") {
			out = json(200, { ok: true, room: c.room, site: c.siteName, time: Math.floor(Date.now() / 1000) });
		} else if (path === "/api/room" && request.method === "GET") {
			out = await handleRoom(c, url.origin);
		} else if (path === "/api/history" && request.method === "GET") {
			out = await handleHistory(c, url, url.origin);
		} else if (path === "/api/sync" && request.method === "GET") {
			out = await handleSync(c, url, url.origin);
		} else if (path === "/api/media" && request.method === "GET") {
			out = await handleMedia(c, url);
		} else if (path === "/api/send" && request.method === "POST") {
			const denied = await rateCheck(env, ip);
			out = denied ? fail(429, denied) : await handleSend(c, request);
		} else {
			out = fail(404, "not found");
		}
	} catch (err) {
		out = fail(502, "上游暂时不通，稍后再试");
		out = new Response(out.body, {
			status: 502,
			headers: { ...Object.fromEntries(out.headers), "X-Tea-Error": String(err.message || err).slice(0, 120) },
		});
	}
	return withCors(out, corsHeaders);
}

function withCors(res, headers) {
	const merged = new Headers(res.headers);
	for (const [k, v] of Object.entries(headers)) merged.set(k, v);
	return new Response(res.body, { status: res.status, headers: merged });
}
