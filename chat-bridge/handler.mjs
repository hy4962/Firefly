/**
 * 茶室桥接服务 —— 每个访客一个真实 Matrix 账号。
 *
 * 访客填昵称 + 邮箱 → 后台在 matrix.0dm.cn 上开一个 @teaXXXXXX 账号，
 * 显示名「昵称 · 站点名」，头像按邮箱哈希从 weavatar 拉取后上传成账号头像，
 * 再邀请进房间。之后收发消息都用访客自己的 token，不再共用转发账号。
 *
 * 两个令牌：
 *   ADMIN_TOKEN  —— 服务器管理员（开号 / 改资料）
 *   BRIDGE_TOKEN —— 房间成员（匿名读历史、拉成员、邀请、代理媒体）
 *
 * 点歌台（/api/juke/*）：歌曲元数据与队列存在房间状态事件里；搜歌走
 * QQ / 网易云 / 酷狗公开接口，播放前现取直链，跨域或防盗链时走签名代理。
 */

import {
	normalizeTrack,
	resolveTrack,
	searchMusic,
	importPlaylist,
	proxyUrl,
	verifyProxy,
	proxyAudio,
	setCyapiKey,
} from "./music.mjs";

const DEFAULTS = {
	MATRIX_HS: "https://matrix.0dm.cn",
	ROOM_ID: "!CKQYQ95MT69FlskJmkcEbSmkd72I6CTgnf_nITckm4I",
	CHAT_ROOM_ID: "!SKwkPyDSYsvMsjJWCi:matrix.0dm.cn",
	INDEX_ROOM_ID: "!rrPkhRAMIwcCDHUpTC:matrix.0dm.cn",
	SITE_NAME: "折腾进行时",
	SITE_URL: "https://www.0dm.cn",
	ALLOW_ORIGINS: "https://www.0dm.cn,https://0dm.cn,https://www.9ll.uk,https://9ll.uk,http://localhost:4399,http://127.0.0.1:4399",
	IDENTITY_PREFIX: "tea",
};

// 正文上限放宽到 4000：Markdown 图片语法本身要占百来字符，500 字时图文根本配不了几句话。
// 仍远低于 Matrix 单事件 64 KiB 上限。
const LIMITS = { text: 4000, nick: 8, email: 120, website: 120, history: 80 };
const RATE = { minGap: 2000, perMinute: 12, perHour: 60, enterGap: 20_000 };

const SITE_BY_SERVER = {
	"matrix.rainzt.cn": "听雨茶室",
	"matrix.yybb.us": "AIOVTUE-雪",
	"chat.gbk.ink": "Somoe",
	"matrix.leenet.xyz": "leenet",
};

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
// 规范（Appendices / Event IDs）：$ 开头的不透明串，早期房间带 :server 后缀、新房间是 base64。
// 只认 [\w-] 会把带冒号的联邦事件 ID 判成非法。
const isEventId = (s) => /^\$[^\s/]{1,250}$/.test(String(s ?? ""));

const cfg = (env) => ({
	hs: (env.MATRIX_HS || DEFAULTS.MATRIX_HS).replace(/\/$/, ""),
	room: env.ROOM_ID || DEFAULTS.ROOM_ID,
	chatRoom: env.CHAT_ROOM_ID || DEFAULTS.CHAT_ROOM_ID,
	indexRoom: env.INDEX_ROOM_ID || DEFAULTS.INDEX_ROOM_ID,
	adminToken: env.ADMIN_TOKEN || "",
	bridgeToken: env.BRIDGE_TOKEN || "",
	siteName: env.SITE_NAME || DEFAULTS.SITE_NAME,
	siteUrl: env.SITE_URL || DEFAULTS.SITE_URL,
	prefix: env.IDENTITY_PREFIX || DEFAULTS.IDENTITY_PREFIX,
	ownerId: env.OWNER_ID || "",
	walineApi: env.WALINE_API || "", 
	origins: (env.ALLOW_ORIGINS || DEFAULTS.ALLOW_ORIGINS).split(",").map((s) => s.trim()).filter(Boolean),
});

const ROOM_META = {
	chat: { name: "闲聊", desc: "随便聊聊日常与折腾", local: true },
	lobby: { name: "互联茶室", desc: "和其他站点的朋友一起聊天", local: false },
};

function roomOf(c, url) {
	const key = url.searchParams.get("room");
	const k = key && ROOM_META[key] ? key : "lobby";
	return { key: k, id: k === "chat" ? c.chatRoom : c.room, ...ROOM_META[k] };
}

const json = (status, data, headers = {}) =>
	new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
	});

// 规范（Standard error response）：429 响应 SHOULD 带 Retry-After 头。
const fail = (status, error) =>
	json(status, { ok: false, error }, status === 429 ? { "Retry-After": "10" } : {});

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
			const s = S[(i >> 4) * 4 + (i % 4)];
			B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0;
		}
		a0 = (a0 + A) >>> 0;
		b0 = (b0 + B) >>> 0;
		c0 = (c0 + C) >>> 0;
		d0 = (d0 + D) >>> 0;
	}

	const hex = (n) => [...new Uint8Array(new Uint32Array([n]).buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
	return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

// ── Matrix 调用 ─────────────────────────────────────────────────────
async function mx(c, path, { token, method = "GET", body, raw, headers = {} } = {}) {
	return fetch(c.hs + path, {
		method,
		headers: {
			Authorization: `Bearer ${token || c.bridgeToken}`,
			...((body || raw) && { "Content-Type": headers["Content-Type"] || "application/json" }),
			...headers,
		},
		body: raw || (body ? JSON.stringify(body) : undefined),
	});
}

async function mxJson(c, path, opts) {
	const res = await mx(c, path, opts);
	let data = {};
	try {
		data = await res.json();
	} catch (_) {}
	return { ok: res.ok, status: res.status, data };
}

// token → user_id 缓存。typing 只能替自己发、sync 要把自己从 typing 列表里剔掉，
// 这两件事都得先知道 token 是谁，别每次都多打一跳 whoami。
const whoCache = new Map();
async function whoAmI(c, token) {
	if (!token) return "";
	const hit = whoCache.get(token);
	if (hit && Date.now() - hit.at < 5 * 60_000) return hit.id;
	const { ok, data } = await mxJson(c, "/_matrix/client/v3/account/whoami", { token });
	const id = ok && typeof data.user_id === "string" ? data.user_id : "";
	if (whoCache.size > 500) whoCache.clear();
	whoCache.set(token, { at: Date.now(), id });
	return id;
}

let memberCache = { at: 0, map: new Map(), room: "" };

// 规范（v1.19 / Calculating the display name for a user）：
// displayname 在 join / invite 成员中不唯一时 MUST 用 user id 消歧，否则同名可以互相当冒充。
function memberProfile(ev) {
	const raw = ev.content?.displayname;
	const uid = ev.state_key || "";
	if (raw === undefined || raw === null || raw === "") return { base: uid, nick: uid, site: "" };
	const text = String(raw);
	const dot = text.indexOf(" · ");
	return {
		base: text,
		nick: dot > 0 ? text.slice(0, dot).trim() : text,
		site: dot > 0 ? text.slice(dot + 3).trim() : "",
	};
}

async function getMembers(c, roomId, force = false) {
	if (!force && Date.now() - memberCache.at < 60_000 && memberCache.room === roomId && memberCache.map.size) {
		return memberCache.map;
	}
	const { ok, data } = await mxJson(c, `/_matrix/client/v3/rooms/${enc(roomId)}/members`);
	if (!ok) throw new Error(data.error || "members failed");

	// 先统计冲突：join + invite 一起算（规范要求），展示时只给 join。
	const rows = [];
	const counts = new Map();
	for (const ev of data.chunk || []) {
		if (ev.type !== "m.room.member") continue;
		const membership = ev.content?.membership;
		if (membership !== "join" && membership !== "invite") continue;
		const p = memberProfile(ev);
		rows.push({ ev, p, membership });
		counts.set(p.base, (counts.get(p.base) || 0) + 1);
	}

	const map = new Map();
	for (const { ev, p, membership } of rows) {
		if (membership !== "join") continue;
		// 规范示例「display name (@id:homeserver.org)」：撞名时挂完整 user id。
		const nick = (counts.get(p.base) || 0) > 1 ? `${p.nick} (${ev.state_key})` : p.nick;
		map.set(ev.state_key, {
			nick,
			site: p.site,
			avatar: ev.content?.avatar_url || "",
		});
	}
	memberCache = { at: Date.now(), map, room: roomId };
	return map;
}

// m.receipt 在 sync 的 ephemeral 里：content = { "$eventId": { "m.read": { "@user": { ts, thread_id } } } }
// 顺手把 Matrix 用户映射成房间成员资料。
function readReceipts(data, roomId, members, c, base) {
	const events = data?.rooms?.join?.[roomId]?.ephemeral?.events || [];
	// 规范（v1.19 / Receipts）：/sync 下发的是增量，一次同步可能带回多条 m.receipt，
	// 要按 user_id + receipt_type 合并覆盖，只取最后一条会漏人。
	const snapshot = {};
	for (const ev of events) {
		if (ev.type !== "m.receipt" || !ev.content) continue;
		for (const [eventId, reads] of Object.entries(ev.content)) {
			const users = reads?.["m.read"];
			if (!users) continue;
			const target = snapshot[eventId] || (snapshot[eventId] = {});
			target["m.read"] = { ...(target["m.read"] || {}), ...users };
		}
	}
	const map = new Map();
	for (const [eventId, reads] of Object.entries(snapshot)) {
		const users = reads?.["m.read"] || {};
		const readers = Object.entries(users)
			.map(([id, info]) => {
				const m = members.get(id) || {};
				const nick = m.nick || id;
				const avatar = m.avatar
					? m.avatar.startsWith("mxc://")
						? `${base}/api/media?u=${enc(m.avatar)}`
						: m.avatar
					: "";
				return {
					id,
					nick,
					site: m.site || SITE_BY_SERVER[id.split(":")[1]] || "",
					avatar,
					ts: info?.ts || 0,
				};
			})
			.sort((a, b) => b.ts - a.ts);
		if (readers.length) map.set(eventId, { count: readers.length, readers });
	}
	return map;
}

// 精确回执：eventId -> 实际在该事件上留下 m.read 的人。
// 各客户端（Element）就是这样显示的；不要用时间水位倒推，否则会多算。
const receiptCache = new Map();

function mergeReceiptCache(roomId, map) {
	const changed = new Set();
	for (const [eventId, rec] of map) {
		const key = `${roomId}|${eventId}`;
		const prev = receiptCache.get(key);
		if (!prev) {
			receiptCache.set(key, { ...rec, updatedAt: Date.now() });
			changed.add(eventId);
			continue;
		}
		const byId = new Map(prev.readers.map((r) => [r.id, r]));
		let added = false;
		for (const r of rec.readers)
			if (!byId.has(r.id)) {
				byId.set(r.id, r);
				added = true;
			}
		const readers = [...byId.values()].sort((a, b) => b.ts - a.ts);
		receiptCache.set(key, { count: readers.length, readers: readers.slice(0, 12), updatedAt: Date.now() });
		if (added && readers.length > prev.count) changed.add(eventId);
	}
	if (receiptCache.size > 3000) {
		const oldest = [...receiptCache.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt).slice(0, 1000);
		for (const [k] of oldest) receiptCache.delete(k);
	}
	return changed;
}

function exactReceipt(roomId, eventId, sender) {
	const rec = receiptCache.get(`${roomId}|${eventId}`);
	if (!rec) return null;
	const readers = rec.readers.filter((r) => r.id !== sender);
	if (!readers.length) return null;
	return { count: readers.length, readers: readers.slice(0, 12) };
}

function receiptForMessage(m, watermarks) {
	if (!m || !m.ts || !watermarks.length) return null;
	const readers = watermarks
		.filter((r) => r.id !== m.sender && r.ts >= m.ts)
		.sort((a, b) => b.ts - a.ts);
	if (!readers.length) return null;
	return { count: readers.length, readers: readers.slice(0, 12) };
}

let activeCache = { at: 0, set: new Set(), room: "" };

async function getActiveSenders(c, roomId) {
	if (Date.now() - activeCache.at < 60_000 && activeCache.room === roomId) return activeCache.set;
	const res = await mx(c, `/_matrix/client/v3/rooms/${enc(roomId)}/messages?dir=b&limit=120`);
	const data = await res.json();
	// 只看最近 3 分钟：这条以前被当成「在线」，于是说过话的人半小时内都挂着在线
	const cutoff = Date.now() - 3 * 60 * 1000;
	const set = new Set();
	for (const ev of data.chunk || []) {
		if (ev.type !== "m.room.message") continue;
		if (!ev.origin_server_ts || ev.origin_server_ts < cutoff) continue;
		set.add(ev.sender);
	}
	activeCache = { at: Date.now(), set, room: roomId };
	return set;
}

// 真实在线状态：presenceCache 是主动探测的结果（有 20s 缓存）；
// livePresence 是 /sync 里联邦推来的 presence 事件——外站账号在不发言时，
// 只有这条流能看到人家在自己站点上还醒着。以前把它扔了，外站就永远离线。
let presenceCache = { at: 0, room: "", key: "", map: new Map() };
const livePresence = new Map(); // id -> { presence, last_active_ago, currently_active, at }
const LIVE_TTL = 3 * 60_000;
function applyPresenceEvents(events) {
	for (const ev of events || []) {
		if (!ev || ev.type !== "m.presence" || !ev.sender) continue;
		const c = ev.content || {};
		livePresence.set(ev.sender, {
			presence: c.presence || "offline",
			last_active_ago: Number(c.last_active_ago) || 0,
			currently_active: c.currently_active === true,
			at: Date.now(),
		});
	}
	// 偶尔清一次过期项，别让它无限长
	if (livePresence.size > 400) {
		const cutoff = Date.now() - 30 * 60_000;
		for (const [id, p] of livePresence) if (p.at < cutoff) livePresence.delete(id);
	}
}

// 「人还在不在」自己算一份：只要客户端还在轮询，桥接就一定看得见。
// 茶室的访客全靠桥接代发 /sync，Synapse 那边的 presence 状态不可靠。
const seenAt = new Map();
const SEEN_TTL = 90_000;
let seenSweepAt = 0;
function touchSeen(uid) {
	if (!uid) return;
	seenAt.set(uid, Date.now());
	if (Date.now() - seenSweepAt > 120_000) {
		seenSweepAt = Date.now();
		const cutoff = Date.now() - 30 * 60_000;
		for (const [k, v] of seenAt) if (v < cutoff) seenAt.delete(k);
	}
}

async function getPresenceMap(c, roomId, ids) {
	const key = ids.join("|");
	if (Date.now() - presenceCache.at < 20_000 && presenceCache.room === roomId && presenceCache.key === key) {
		return presenceCache.map;
	}
	const out = new Map();
	const withTimeout = (p, ms) =>
		Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
	await Promise.all(
		ids.map(async (id) => {
			try {
				// 联邦 presence 是尽力而为：对方服务器不响应时不能把房间接口一起拖死
				const { ok, data } = await withTimeout(
					mxJson(c, `/_matrix/client/v3/presence/${enc(id)}/status`, {
						token: c.bridgeToken,
					}),
					2500,
				);
				if (ok && data && typeof data === "object") out.set(id, data);
			} catch (_) {}
		}),
	);
	presenceCache = { at: Date.now(), room: roomId, key, map: out };
	return out;
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

// 规范（v1.19 / Sending custom emotes）：自定义表情是 m.text 的 formatted_body 里
// 带 data-mx-emoticon 属性的 <img>，属性存在才算表情，属性值必须忽略。
// 旧版本茶室把 data-mx-emoticon 塞进 m.image 的 content 里，历史消息仍要认。
function customEmoteOf(content) {
	if (content.format === "org.matrix.custom.html" && typeof content.formatted_body === "string") {
		const html = content.formatted_body.trim();
		const tag = html.match(/^<img\b[^>]*\bdata-mx-emoticon\b[^>]*\/?>$/i);
		if (tag) {
			const pick = (name) => {
				const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag[0]);
				return m ? m[1] ?? m[2] ?? "" : "";
			};
			const src = pick("src");
			if (/^mxc:\/\//.test(src)) return { src, code: pick("title") || pick("alt") };
		}
	}
	if (content["data-mx-emoticon"] === true && typeof content.url === "string" && /^mxc:\/\//.test(content.url)) {
		return { src: content.url, code: "" };
	}
	return null;
}

function normalize(ev, members, c, base, eventMap) {
	const content = ev.content || {};
	if (!content.body && !content.url) return null;
	// 规范：不认识的 msgtype 也要拿 body 兜底显示，不能整条丢掉。
	// m.file / m.audio / m.video 至少让用户知道「有人发了东西」。
	// m.sticker 是独立事件类型（Element 发的表情/贴纸），没有 msgtype，别整条丢掉。
	const isSticker = ev.type === "m.sticker";
	const msgtype = String(content.msgtype || (isSticker ? "m.sticker" : ""));
	const TYPE_ICON = { "m.file": "📎", "m.audio": "🎵", "m.video": "🎬" };
	if (!msgtype) return null;
	const isMessage = ["m.text", "m.emote", "m.notice", "m.image", "m.file", "m.audio", "m.video"].includes(msgtype);
	if (!isMessage && !TYPE_ICON[msgtype]) {
		if (typeof content.body !== "string" || !content.body) return null;
	}

	const sender = ev.sender || "";
	const domain = sender.split(":")[1] || "";
	const member = members.get(sender) || {};
	// 规范：m.room.member 没有 displayname 时用原始 user id 当显示名。
	let nick = member.nick || sender;
	let site = member.site || SITE_BY_SERVER[domain] || (domain === "matrix.0dm.cn" ? c.siteName : "");
	let avatar = member.avatar || "";
	let text = typeof content.body === "string" ? content.body : "";
	let image = "";
	// m.image 的 info.w/h 交给前端做占位尺寸，避免未加载时塌成 2×2 露出 alt。
	const info = content.info && typeof content.info === "object" ? content.info : {};
	const imageW = Number(info.w) || 0;
	const imageH = Number(info.h) || 0;

	// 视频：规范（m.video）把播放地址放 url、元数据放 info（VideoInfo：
	// w/h/duration/mimetype/size/thumbnail_url）。能拿到就交给前端出 <video> 预览，
	// 拿不到再退回「🎬 文件名」的纯文本，别整条丢掉。
	let video = "";
	let poster = "";
	let videoInfo = null;
	if (msgtype === "m.video" && content.url && /^mxc:\/\//.test(content.url)) {
		video = `${base}/api/media?u=${enc(content.url)}`;
		const thumb =
			typeof info.thumbnail_url === "string" && /^mxc:\/\//.test(info.thumbnail_url) ? info.thumbnail_url : "";
		if (thumb) poster = `${base}/api/media?u=${enc(thumb)}`;
		videoInfo = {
			w: imageW,
			h: imageH,
			duration: Number(info.duration) || 0,
			mimetype: typeof info.mimetype === "string" ? info.mimetype : "",
			size: Number(info.size) || 0,
		};
		// v1.10 起 body 可以是「说明文字」：只有 filename 存在且和 body 不同，
		// body 才是说明；否则 body 就是文件名，不该当正文显示。
		const fn = typeof content.filename === "string" ? content.filename : "";
		text = fn && fn !== text ? text : "";
	}
	if (!video && TYPE_ICON[msgtype] && content.url && /^mxc:\/\//.test(content.url)) {
		// 文件/语音：先给一个可点开的链接提示，正文用 body 兜底
		text = `${TYPE_ICON[msgtype]} ${text || msgtype}`;
	}

	// 别的站点用共享账号转发时，靠协议头还原身份
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

	// Matrix 引用回复：body 开头是连续的 "> <@user> 原文" 行，后面才是正文
	let reply = null;
	const lines = text.split("\n");
	const quoted = [];
	let qi = 0;
	while (qi < lines.length && /^>\s?/.test(lines[qi])) {
		quoted.push(lines[qi].replace(/^>\s?/, ""));
		qi++;
	}
	if (quoted.length) {
		const first = quoted[0];
		const rm = first.match(/^<@([^>]+)>\s*(.*)$/);
		// Matrix 正文里是 <@localpart:server>，members 索引带 @ 前缀
		const uid = rm ? (rm[1].startsWith("@") ? rm[1] : "@" + rm[1]) : "";
		const quotedText = [rm ? rm[2] : first, ...quoted.slice(1)].join("\n").trim();
		let who = uid.replace(/^@/, "").split(":")[0];
		if (uid) {
			const mem = members.get(uid) || {};
			who = mem.nick || who;
			const d = who.indexOf(" · ");
			if (d > 0) who = who.slice(0, d).trim();
		}
		reply = { id: content["m.relates_to"]?.["m.in_reply_to"]?.event_id || "", who: who || "茶友", text: quotedText };
		text = lines.slice(qi).join("\n").replace(/^\n+/, "");
	}
	// Element 有时不带 Matrix 文本回退，只剩 m.relates_to：按 event_id 反查目标事件
	if (!reply) {
		const targetId = content["m.relates_to"]?.["m.in_reply_to"]?.event_id;
		const target = targetId && eventMap?.get(targetId);
		if (target) {
			const tc = target.content || {};
			const targetMember = members.get(target.sender) || {};
			let who = targetMember.nick || String(target.sender || "").split(":")[0].replace(/^@/, "");
			const dot = who.indexOf(" · ");
			if (dot > 0) who = who.slice(0, dot).trim();
			const raw = typeof tc.body === "string" ? tc.body : "";
			const quote = raw
				.split("\n")
				.filter((line) => !line.startsWith(">"))
				.join(" ")
				.trim() || (tc.msgtype === "m.image" ? "图片" : "");
			reply = { id: targetId, who: who || "茶友", text: quote.slice(0, 160) };
		}
	}

	const emote = customEmoteOf(content);
	if (emote) {
		image = `${base}/api/media?u=${enc(emote.src)}`;
		text = emote.code || text;
	} else if ((content.msgtype === "m.image" || isSticker) && content.url) {
		image = `${base}/api/media?u=${enc(content.url)}`;
		text = text || (isSticker ? "发了一个表情" : "发了一张图片");
	}
	// 规范表情（formatted_body 的 img）与旧版 m.image 标记统一成前端的 emoticon 布尔
	const emoticon = !!emote;

	avatar = avatar.startsWith("mxc://") ? `${base}/api/media?u=${enc(avatar)}` : avatar;

	// Matrix 原生线程（MSC3440）：m.relates_to.rel_type = "m.thread"，event_id 指向根事件
	const relates = content["m.relates_to"];
	const threadRoot = relates && relates.rel_type === "m.thread" && relates.event_id ? relates.event_id : "";

	return {
		id: ev.event_id,
		sender,
		ts: ev.origin_server_ts || Date.now(),
		nick,
		site,
		avatar,
		text,
		image,
		imageW,
		imageH,
		video,
		poster,
		videoInfo,
		reply,
		emoticon,
		threadRoot,
	};
}

// m.reaction 用 m.relates_to 指向目标事件，按 event_id 聚合后附给前端
function collectReactions(events, members) {
	const map = new Map();
	for (const ev of events || []) {
		if (ev.type !== "m.reaction") continue;
		const rel = ev.content?.["m.relates_to"];
		if (rel?.rel_type !== "m.annotation" || !rel.event_id) continue;
		const list = map.get(rel.event_id) || [];
		const key = String(rel.key || "").slice(0, 32);
		const existing = list.find((r) => r.key === key);
		if (existing) {
			existing.count++;
		} else {
			const m = members.get(ev.sender) || {};
			list.push({ key, count: 1, nick: m.nick || ev.sender, senders: [] });
		}
		list.find((r) => r.key === key).senders.push(ev.sender);
		map.set(rel.event_id, list);
	}
	return map;
}

// ── 限流 ────────────────────────────────────────────────────────────
const memory = new Map();

async function rateCheck(env, ip, kind = "send") {
	const now = Date.now();
	const gap =
		kind === "enter" ? RATE.enterGap : kind === "juke" ? 800 : kind === "link" ? 350 : kind === "search" ? 600 : kind === "receipt" ? 800 : RATE.minGap;

	const b = memory.get(`${kind}:${ip}`) || { last: 0, minute: [], hour: [] };
	if (now - b.last < gap) return `手速有点快，${Math.ceil((gap - (now - b.last)) / 1000)} 秒后再试。`;
	b.last = now;
	if (kind === "send") {
		b.minute = b.minute.filter((x) => now - x < 60_000);
		b.hour = b.hour.filter((x) => now - x < 3_600_000);
		if (b.minute.length >= RATE.perMinute) return "一分钟说得有点多，喘口气。";
		if (b.hour.length >= RATE.perHour) return "这一小时的额度用完了，晚点再来。";
		b.minute.push(now);
		b.hour.push(now);
	}
	memory.set(`${kind}:${ip}`, b);
	return "";
}

// ── 访客账号 ────────────────────────────────────────────────────────
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const randomLocalpart = (prefix) => {
	const bytes = new Uint8Array(7);
	crypto.getRandomValues(bytes);
	return prefix + [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
};

// 访客账号统一 user0001、user0002… 递增；从 Synapse 用户列表里取当前最大编号。
async function nextUserLocalpart(c) {
	let max = 0;
	let from = 0;
	for (let page = 0; page < 20; page++) {
		const { ok, data } = await mxJson(
			c,
			`/_synapse/admin/v1/users?from=${from}&limit=100&guests=false&deactivated=false`,
			{ token: c.adminToken },
		);
		if (!ok) break;
		for (const u of data.users || []) {
			const m = String(u.name || "").match(/^@uid(\d+):/);
			if (m) max = Math.max(max, Number(m[1]) || 0);
		}
		const next = Number(data.next_token || 0);
		const total = Number(data.total || 0);
		if (!next || (total && next >= total)) break;
		from = next;
	}
	return `uid${String(max + 1).padStart(2, "0")}`;
}

async function uploadAvatar(c, email) {
	if (!email) return "";
	try {
		const md5 = md5Hex(email.trim().toLowerCase());
		const res = await fetch(`https://weavatar.com/avatar/${md5}?s=128&d=mp`, { headers: { "User-Agent": "tea-room-bridge" } });
		if (!res.ok) return "";
		const type = res.headers.get("content-type") || "image/webp";
		const buf = await res.arrayBuffer();
		if (buf.byteLength > 200_000) return "";
		const up = await mx(c, "/_matrix/media/v3/upload?filename=avatar.webp", {
			token: c.adminToken,
			method: "POST",
			raw: buf,
			headers: { "Content-Type": type },
		});
		if (!up.ok) return "";
		const data = await up.json();
		return data.content_uri || "";
	} catch {
		return "";
	}
}

const WALINE_DEFAULT = "https://waline.0dm.cn";

// 身份索引存在 Synapse 的私有房间里，state_key = md5(邮箱)。
// 规范（Appendices / Common Namespaced Identifier Grammar）：自定义事件类型按 Java 包名反向
// 域名命名，0dm.cn 反写是 cn.0dm。旧类型 com.0dm.* 属于历史错误命名，只保留读兼容。
const ID_EVENT_TYPE = "cn.0dm.tea.identity";
const LEGACY_ID_EVENT_TYPE = "com.0dm.tea.identity";
const idKey = (email) => md5Hex(email.trim().toLowerCase());

// ── 成员标识 ────────────────────────────────────────────────────────
// 站长 / 认证 不是 Matrix 自带的概念，得自己记：在索引房间放一份 uid → 标识
// 的聚合状态事件（一次读全量，别给每个成员单独发一条 state）。
//   admin  —— 留言板管理员（Waline type=administrator）或 OWNER_ID
//   waline —— 用留言板账号登录的注册用户（等价「认证」，实名审核不存在）
const BADGE_EVENT_TYPE = "cn.0dm.tea.badges";
const BADGE_STATE_KEY = "v1";
let badgeCache = { at: 0, index: "", map: new Map() };

async function readBadges(c, force = false) {
	if (!c.indexRoom) return new Map();
	if (!force && Date.now() - badgeCache.at < 60_000 && badgeCache.index === c.indexRoom) return badgeCache.map;
	const res = await mxJson(c, `/_matrix/client/v3/rooms/${enc(c.indexRoom)}/state/${BADGE_EVENT_TYPE}/${BADGE_STATE_KEY}`, {
		token: c.adminToken,
	});
	const map = new Map();
	if (res.ok && res.data && typeof res.data === "object") {
		for (const [uid, v] of Object.entries(res.data)) if (v && typeof v === "object") map.set(uid, v);
	}
	badgeCache = { at: Date.now(), index: c.indexRoom, map };
	return map;
}

async function markBadge(c, uid, kind) {
	if (!uid || !kind || !c.adminToken || !c.indexRoom) return;
	try {
		const map = await readBadges(c, true);
		const cur = map.get(uid) || {};
		if (cur.a === kind) return;
		map.set(uid, { ...cur, a: kind, t: Date.now() });
		const body = Object.fromEntries(map);
		const res = await mxJson(c, `/_matrix/client/v3/rooms/${enc(c.indexRoom)}/state/${BADGE_EVENT_TYPE}/${BADGE_STATE_KEY}`, {
			token: c.adminToken,
			method: "PUT",
			body,
		});
		if (res.ok) badgeCache = { at: Date.now(), index: c.indexRoom, map };
	} catch (_) {}
}

async function readIdentity(c, email) {
	if (!email || !c.indexRoom) return null;
	for (const type of [ID_EVENT_TYPE, LEGACY_ID_EVENT_TYPE]) {
		const res = await mx(c, `/_matrix/client/v3/rooms/${enc(c.indexRoom)}/state/${type}/${enc(idKey(email))}`, {
			token: c.adminToken,
		});
		if (!res.ok) continue;
		try {
			return await res.json();
		} catch {
			return null;
		}
	}
	return null;
}

async function writeIdentity(c, email, data) {
	if (!email || !c.indexRoom) return;
	await mxJson(c, `/_matrix/client/v3/rooms/${enc(c.indexRoom)}/state/${ID_EVENT_TYPE}/${enc(idKey(email))}`, {
		token: c.adminToken,
		method: "PUT",
		body: data,
	});
}

/** 同一邮箱复用同一个 Matrix 账号；没有就新建。 */
async function provisionIdentity(c, env, profile, base) {
	const { nick, email, website, admin, auth } = profile;
	const badgeKind = admin ? "admin" : auth === "waline" ? "waline" : "";
	if (!c.adminToken) throw new Error("bridge 未配置 ADMIN_TOKEN");

	const stored = await readIdentity(c, email);
	if (stored && stored.uid && stored.pw) {
		const login = await mxJson(c, "/_matrix/client/v3/login", {
			token: "",
			method: "POST",
			body: {
				type: "m.login.password",
				identifier: { type: "m.id.user", user: stored.uid },
				password: stored.pw,
				initial_device_display_name: "茶室网页",
			},
		});
		if (login.ok && login.data.access_token) {
			if (stored.nick !== nick || (website && stored.website !== website)) {
				await mxJson(c, `/_synapse/admin/v2/users/${enc(stored.uid)}`, {
					token: c.adminToken,
					method: "PUT",
					body: { displayname: `${nick} · ${c.siteName}` },
				});
				await writeIdentity(c, email, { ...stored, nick, website: website || stored.website });
			}
			if (badgeKind) await markBadge(c, stored.uid, badgeKind);
			return {
				user: {
					id: stored.uid,
					nick,
					avatar: stored.mxc ? `${base}/api/media?u=${enc(stored.mxc)}` : "",
					admin: !!admin,
				},
				token: login.data.access_token,
			};
		}
	}

	let localpart = await nextUserLocalpart(c);
	const password = crypto.randomUUID().replace(/-/g, "") + "Aa1!";
	const displayname = `${nick} · ${c.siteName}`;
	let userId = `@${localpart}:matrix.0dm.cn`;
	let created = null;
	for (let i = 0; i < 8; i++) {
		userId = `@${localpart}:matrix.0dm.cn`;
		created = await mxJson(c, `/_synapse/admin/v2/users/${enc(userId)}`, {
			token: c.adminToken,
			method: "PUT",
			body: { password, displayname, admin: false },
		});
		if (created.ok) break;
		const next = Number(String(localpart).replace(/^uid/, "")) || 0;
		localpart = `uid${String(next + 1).padStart(2, "0")}`;
	}
	if (!created || !created.ok) throw new Error(`开号失败：${created?.data?.error || created?.status || "unknown"}`);

	const avatarUrl = await uploadAvatar(c, email);
	if (avatarUrl) {
		await mxJson(c, `/_synapse/admin/v2/users/${enc(userId)}`, {
			token: c.adminToken,
			method: "PUT",
			body: { avatar_url: avatarUrl },
		});
	}

	// 互联茶室：邀请制，由房间管理员发邀请
	await mxJson(c, `/_matrix/client/v3/rooms/${enc(c.room)}/invite`, {
		token: c.bridgeToken,
		method: "POST",
		body: { user_id: userId },
	});

	const login = await mxJson(c, "/_matrix/client/v3/login", {
		token: "",
		method: "POST",
		body: {
			type: "m.login.password",
			identifier: { type: "m.id.user", user: localpart },
			password,
			initial_device_display_name: "茶室网页",
		},
	});
	if (!login.ok || !login.data.access_token) throw new Error("登录新账号失败");
	const token = login.data.access_token;

	// 本站闲聊房是公开的，直接进；互联茶室已收到邀请，再 join
	await mxJson(c, `/_matrix/client/v3/join/${enc(c.chatRoom)}`, { token, method: "POST", body: {} });
	await mxJson(c, `/_matrix/client/v3/join/${enc(c.room)}`, { token, method: "POST", body: {} });

	await writeIdentity(c, email, { uid: userId, pw: password, nick, website, mxc: avatarUrl || "", ts: Date.now() });
	if (badgeKind) await markBadge(c, userId, badgeKind);

	return {
		user: { id: userId, nick, avatar: avatarUrl ? `${base}/api/media?u=${enc(avatarUrl)}` : "", admin: !!admin },
		token,
	};
}

async function handleEnter(c, env, request, ip) {
	let body;
	try {
		body = await request.json();
	} catch {
		return fail(400, "请求格式不对");
	}
	const nick = clean(body.nick, LIMITS.nick);
	const email = clean(body.email, LIMITS.email);
	const website = clean(body.website, LIMITS.website);

	if (!nick) return fail(400, "先起个昵称");
	if (email && !isEmail(email)) return fail(400, "邮箱格式不对");

	const denied = await rateCheck(env, ip, "enter");
	if (denied) return fail(429, denied);

	try {
		const out = await provisionIdentity(c, env, { nick, email, website }, requestOrigin(request));
		return json(200, { ok: true, ...out });
	} catch (e) {
		return fail(502, e.message || "开座位失败");
	}
}

async function handleWaline(c, env, request, ip, base) {
	let body;
	try {
		body = await request.json();
	} catch {
		return fail(400, "请求格式不对");
	}
	const email = clean(body.email, LIMITS.email);
	const password = String(body.password || "");
	if (!email || !isEmail(email)) return fail(400, "邮箱格式不对");
	if (!password) return fail(400, "请输入 Waline 密码");

	const denied = await rateCheck(env, ip, "enter");
	if (denied) return fail(429, denied);

	const api = (c.walineApi || WALINE_DEFAULT).replace(/\/$/, "");
	let payload;
	try {
		const res = await fetch(`${api}/api/token`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, password }),
		});
		payload = await res.json();
	} catch {
		return fail(502, "Waline 暂时连不上");
	}

	if (payload.errno !== 0) {
		const err = String(payload.errmsg || "");
		if (err === "LOGIN_FAILED") return fail(401, "邮箱或密码不对，或者这个邮箱还没在留言板注册过");
		if (err === "TWO_FACTOR_AUTH_ERROR") return fail(401, "这个账号开了两步验证，请用昵称方式进入");
		return fail(401, err || "Waline 登录失败");
	}

	const data = payload.data || {};
	const nick = clean(data.display_name || data.nick || email.split("@")[0], LIMITS.nick);
	const website = clean(data.url || data.link || "", LIMITS.website);

	try {
		const out = await provisionIdentity(c, env, { nick, email, website, admin: data.type === "administrator", auth: "waline" }, base);
		// 把 Waline 自己的 token 一起回给前端：茶室登录完顺手写进评论区的存储键，
		// 同一浏览器下博客那边直接就是已登录状态（两边同源，共用 localStorage）。
		return json(200, { ok: true, ...out, waline: { token: data.token || "", user: walineUser(data, email, nick, website) } });
	} catch (e) {
		return fail(502, e.message || "开座位失败");
	}
}

/** 只保留客户端要用的字段，别把 2fa、密码哈希之类的塞进 localStorage。 */
function walineUser(data, email, nick, website) {
	return {
		objectId: data.objectId || "",
		email,
		display_name: nick,
		url: website,
		avatar: data.avatar || "",
		type: data.type || "guest",
		label: data.label || "",
	};
}

/**
 * 留言板已登录 → 茶室免密入座。
 * Waline 没有「校验 token」的专用接口，但 GET /api/token 带上 Authorization
 * 返回的就是当前账号（见服务端 logic/base.js 的 userInfo 解析），拿它验票最稳。
 */
async function handleWalineSso(c, env, request, ip, base) {
	let body;
	try {
		body = await request.json();
	} catch {
		return fail(400, "请求格式不对");
	}
	const token = String(body.token || "").trim().slice(0, 2000);
	if (!token) return fail(400, "缺少留言板登录凭证");

	const api = (c.walineApi || WALINE_DEFAULT).replace(/\/$/, "");
	let payload;
	try {
		const res = await fetch(`${api}/api/token`, {
			headers: { Authorization: `Bearer ${token}`, "User-Agent": "tea-bridge/sso" },
		});
		payload = await res.json();
	} catch {
		return fail(502, "Waline 暂时连不上");
	}

	const data = payload?.errno === 0 ? payload.data || {} : {};
	const email = clean(data.email, LIMITS.email);
	if (!email || !isEmail(email)) return fail(401, "留言板登录已失效，请重新登录");

	const nick = clean(data.display_name || data.nick || email.split("@")[0], LIMITS.nick);
	const website = clean(data.url || data.link || "", LIMITS.website);
	try {
		const out = await provisionIdentity(c, env, { nick, email, website, admin: data.type === "administrator", auth: "waline" }, base);
		return json(200, { ok: true, ...out, waline: { token, user: walineUser(data, email, nick, website) } });
	} catch (e) {
		return fail(502, e.message || "开座位失败");
	}
}

/** 退出：把 Matrix 上的设备 token 一起废掉，前端再清本地存储。 */
async function handleLogout(c, request) {
	const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
	if (!token || token === c.bridgeToken) return json(200, { ok: true });
	try {
		await mxJson(c, "/_matrix/client/v3/logout", { token, method: "POST", body: {} });
	} catch (_) {}
	return json(200, { ok: true });
}

/** 用已有的 Matrix 账号登录（比如站长自己的管理员号） */
async function handleMatrixLogin(c, request, ip) {
	let body;
	try {
		body = await request.json();
	} catch {
		return fail(400, "请求格式不对");
	}
	const hs = String(body.homeserver || "").replace(/\/$/, "");
	if (hs !== c.hs) return fail(400, "目前只支持本站服务器");

	const denied = await rateCheck({}, ip, "enter");
	if (denied) return fail(429, denied);

	const username = clean(body.username, 120);
	const password = String(body.password || "");
	if (!username || !password) return fail(400, "服务器、用户名和密码都要填");

	const login = await mxJson(c, "/_matrix/client/v3/login", {
		token: "",
		method: "POST",
		body: {
			type: "m.login.password",
			identifier: { type: "m.id.user", user: username },
			password,
			initial_device_display_name: "茶室网页",
		},
	});
	if (!login.ok || !login.data.access_token) {
		return fail(login.status === 403 ? 401 : 502, login.data.error || "登录失败");
	}

	const uid = login.data.user_id;
	const profile = await mxJson(c, `/_matrix/client/v3/profile/${enc(uid)}`, { token: login.data.access_token });
	const rawAvatar = profile.data?.avatar_url || "";
	return json(200, {
		ok: true,
		token: login.data.access_token,
		user: {
			id: uid,
			nick: clean(profile.data?.displayname || username, 60),
			avatar: rawAvatar.startsWith("mxc://")
				? `${requestOrigin(request)}/api/media?u=${enc(rawAvatar)}`
				: "",
			admin: !!c.ownerId && uid === c.ownerId,
		},
	});
}

/** 收集 m.room.redaction 事件，前端据此把原消息换成「XX 撤回了一条消息」 */
function collectRedactions(events, members) {
	const list = [];
	for (const ev of events || []) {
		if (ev.type !== "m.room.redaction") continue;
		const target = ev.content?.redacts || ev.redacts || "";
		if (!target) continue;
		const sender = ev.sender || "";
		const m = members.get(sender) || {};
		const nick = m.nick || sender;
		const site = m.site || SITE_BY_SERVER[sender.split(":")[1]] || "";
		list.push({ id: target, by: nick, site, ts: ev.origin_server_ts || Date.now() });
	}
	return list;
}

// 引用回复：v1.13+ 不再要求 body 里带 "> <@user>" 回退文本，只能靠 m.in_reply_to
// 反查目标事件。sync 一次只带 50 条 timeline，被回复的老消息常常不在里面，
// 结果引用气泡要刷新走 /api/history 才出现。按房间缓存近期事件供反查。
const replyEventCache = new Map();
function cacheRoomEvents(roomId, events) {
	let map = replyEventCache.get(roomId);
	if (!map) {
		map = new Map();
		replyEventCache.set(roomId, map);
	}
	for (const ev of events || []) {
		if (ev && ev.event_id) map.set(ev.event_id, ev);
	}
	if (map.size > 600) {
		for (const k of [...map.keys()].slice(0, map.size - 600)) map.delete(k);
	}
	return map;
}

// ── 聊天记录搜索 ────────────────────────────────────────────────────
// 联邦房间翻 /messages 很慢（一页 1000 条实测 3 秒），一次请求扫完必撞
// 边缘节点的 30 秒超时。所以做成后台增量任务：
//   POST /api/search  起一个 job，立刻返回已有结果
//   GET  /api/search?job=xxx  拉进度，前端边翻边追加
// 容器是常驻 node 进程，响应发出去之后后台循环还能继续跑。
const SEARCH = {
	pageSize: 1000,
	maxPages: 60,
	maxHits: 60,
	jobBudget: 120_000,
	jobTtl: 300_000,
	cacheTtl: 60_000,
	cacheSize: 16,
	maxJobs: 12,
};
const searchJobs = new Map();
const searchCache = new Map();
const searchSeq = { n: 0 };

// 日期（YYYY-MM-DD）按北京时间当日 0 点换算；NAS 机器时区不一定是东八区
const dayStart = (s) => {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
	if (!m) return 0;
	const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00+08:00`);
	return Number.isFinite(t) ? t : 0;
};

/** Synapse 的全文检索，只对西文有效（中文分词不行）。失败返回 null。 */
async function matrixSearch(c, roomId, term, limit) {
	const body = {
		search_categories: {
			room_events: {
				search_term: term,
				keys: ["content.body"],
				order_by: "recent",
				// 只按房间过滤：origin_server_ts 的 range 各版本支持不一，日期在本地再筛
				filter: { rooms: [roomId] },
			},
		},
	};
	const res = await mxJson(c, `/_matrix/client/v3/search?batch=${limit}`, { token: c.bridgeToken, method: "POST", body });
	if (!res.ok) return null;
	const cat = res.data && res.data.search_categories && res.data.search_categories.room_events;
	if (!cat || !Array.isArray(cat.results)) return null;
	return cat.results.map((r) => r && r.result).filter(Boolean);
}

/** 单条事件是否符合条件；符合就入队。 */
function acceptEvent(job, ev) {
	if (job.hits.length >= SEARCH.maxHits) return;
	const ts = ev.origin_server_ts || 0;
	if (job.fromTs && ts < job.fromTs) return;
	if (job.toTs && ts > job.toTs) return;
	if (ev.type !== "m.room.message" && ev.type !== "m.sticker") return;
	const body = ev.content?.body;
	if (typeof body !== "string" || !body) return;
	if (job.q && !body.toLowerCase().includes(job.q)) return;
	if (job.nick) {
		const info = job.members.get(ev.sender) || {};
		const rawNick = String(info.nick || ev.sender || "").toLowerCase();
		const site = String(info.site || "").toLowerCase();
		if (!rawNick.includes(job.nick) && !site.includes(job.nick)) return;
	}
	if (!ev.event_id || job.seen.has(ev.event_id)) return;
	job.seen.add(ev.event_id);
	job.hits.push(ev);
	if (job.hits.length >= SEARCH.maxHits) job.truncated = true;
}

function jobPayload(job) {
	const map = new Map(job.hits.map((ev) => [ev.event_id, ev]));
	const messages = job.hits.map((ev) => normalize(ev, job.members, job.c, job.base, map)).filter(Boolean);
	return {
		ok: true,
		job: job.id,
		done: job.done,
		error: job.error,
		scanned: job.scanned,
		truncated: job.truncated,
		via: job.via,
		total: messages.length,
		messages,
	};
}

async function runSearchJob(job) {
	try {
		job.members = await getMembers(job.c, job.roomId);

		// 1) 西文先试 Synapse 索引，命中了就是秒回
		if (job.q && !/[\u3400-\u9fff]/.test(job.q)) {
			const found = await matrixSearch(job.c, job.roomId, job.q, SEARCH.maxHits * 3);
			if (found && found.length) {
				job.via = "matrix";
				for (const ev of found) acceptEvent(job, ev);
				job.done = true;
				return finishJob(job);
			}
		}

		// 2) 逐页往旧翻，每页结束前端就能多看到几条
		let from = "";
		let pages = 0;
		const started = Date.now();
		while (pages < SEARCH.maxPages && job.hits.length < SEARCH.maxHits) {
			if (job.cancelled) return;
			if (Date.now() - started > SEARCH.jobBudget) {
				job.truncated = true;
				break;
			}
			const qs = `dir=b&limit=${SEARCH.pageSize}${from ? `&from=${enc(from)}` : ""}`;
			const res = await mxJson(job.c, `/_matrix/client/v3/rooms/${enc(job.roomId)}/messages?${qs}`, {
				token: job.c.bridgeToken,
			});
			if (!res.ok) {
				if (!job.scanned) job.error = res.data?.error || "翻记录失败了";
				break;
			}
			const chunk = res.data.chunk || [];
			if (!chunk.length) break;
			let passedStart = false;
			for (const ev of chunk) {
				job.scanned++;
				const ts = ev.origin_server_ts || 0;
				if (job.fromTs && ts && ts < job.fromTs) {
					passedStart = true;
					break;
				}
				acceptEvent(job, ev);
				if (job.hits.length >= SEARCH.maxHits) break;
			}
			from = res.data.end;
			pages++;
			if (passedStart || !from) break;
		}
		if (pages >= SEARCH.maxPages) job.truncated = true;
		job.done = true;
		finishJob(job);
	} catch (e) {
		job.error = e.message || "翻记录失败了";
		job.done = true;
		finishJob(job);
	}
}

function finishJob(job) {
	// 成功的查询进缓存，同样条件再来一次直接出结果
	if (!job.error) {
		const data = jobPayload(job);
		if (searchCache.size >= SEARCH.cacheSize) searchCache.delete(searchCache.keys().next().value);
		searchCache.set(job.cacheKey, { at: Date.now(), data });
	}
}

function pruneJobs() {
	const now = Date.now();
	for (const [id, job] of searchJobs) {
		if (job.done && now - job.touchedAt > SEARCH.jobTtl) searchJobs.delete(id);
	}
	if (searchJobs.size > SEARCH.maxJobs) {
		for (const [id, job] of searchJobs) {
			if (job.done) searchJobs.delete(id);
			if (searchJobs.size <= SEARCH.maxJobs) break;
		}
	}
}

/** 起一个搜索任务；相同条件命中缓存就直接返回 done */
async function handleSearchStart(c, request, ip) {
	let body;
	try {
		body = await request.json();
	} catch {
		return fail(400, "请求格式不对");
	}
	const key = body.room === "chat" ? "chat" : "lobby";
	const roomId = key === "chat" ? c.chatRoom : c.room;
	const q = clean(body.q, 60).toLowerCase();
	const nick = clean(body.nick, 40).toLowerCase();
	const fromTs = dayStart(body.from);
	const toRaw = dayStart(body.to);
	const toTs = toRaw ? toRaw + 86_400_000 - 1 : 0;
	if (!q && !nick) return fail(400, "至少给个关键词或者昵称");
	if (fromTs && toTs && fromTs > toTs) return fail(400, "开始日期比结束日期还晚");

	const cacheKey = `${roomId}|${q}|${nick}|${fromTs}|${toTs}`;
	const cached = searchCache.get(cacheKey);
	if (cached && Date.now() - cached.at < SEARCH.cacheTtl) return json(200, { ...cached.data, cached: true });

	pruneJobs();
	const job = {
		id: `s${Date.now().toString(36)}${(searchSeq.n = (searchSeq.n + 1) % 1e4)}`,
		c,
		base: requestOrigin(request),
		roomId,
		q,
		nick,
		fromTs,
		toTs,
		cacheKey,
		hits: [],
		seen: new Set(),
		members: new Map(),
		scanned: 0,
		truncated: false,
		via: "scan",
		done: false,
		error: "",
		cancelled: false,
		touchedAt: Date.now(),
	};
	searchJobs.set(job.id, job);
	runSearchJob(job);
	return json(200, jobPayload(job));
}

/** 拉任务进度 */
function handleSearchPoll(c, url) {
	const id = String(url.searchParams.get("job") || "");
	const job = searchJobs.get(id);
	if (!job) return fail(404, "这次翻找已经过期了，重新搜一次");
	job.touchedAt = Date.now();
	return json(200, jobPayload(job));
}

/** 定位单条消息：取它前后各一段，供前端「回到这条消息」渲染 */
async function handleAround(c, url, base) {
	const room = roomOf(c, url);
	const eventId = String(url.searchParams.get("event") || "");
	if (!isEventId(eventId)) return fail(400, "消息 id 不对");

	// 规范（GET /rooms/{roomId}/context/{eventId}）：直接给上下文，
	// 不要拿 event id 当 /messages 的 from token —— Synapse 不认，会返回空。
	const res = await mxJson(c, `/_matrix/client/v3/rooms/${enc(room.id)}/context/${enc(eventId)}?limit=30`, {
		token: c.bridgeToken,
	});
	if (!res.ok) return fail(404, "这条消息可能已经被撤回了");
	const events = [res.data.event, ...(res.data.events_before || []), ...(res.data.events_after || [])].filter(Boolean);
	if (!res.data.event) return fail(404, "这条消息可能已经被撤回了");

	const members = await getMembers(c, room.id);
	const map = new Map(events.map((ev) => [ev.event_id, ev]));
	const messages = events
		.sort((a, b) => (a.origin_server_ts || 0) - (b.origin_server_ts || 0))
		.map((ev) => normalize(ev, members, c, base, map))
		.filter(Boolean);
	return json(200, { ok: true, target: eventId, messages, hasOlder: !!res.data.start, hasNewer: !!res.data.end });
}

// ── 接口 ────────────────────────────────────────────────────────────
async function handleHistory(c, url, base, token) {
	const room = roomOf(c, url);
	const limit = Math.min(Number(url.searchParams.get("limit") || 50) || 50, LIMITS.history);
	// 成员、消息、回执快照并行拉，别串成三次公网往返
	const membersP = getMembers(c, room.id);
	const msgP = mx(c, `/_matrix/client/v3/rooms/${enc(room.id)}/messages?dir=b&limit=${limit}`, { token });
	const filter = JSON.stringify({ room: { rooms: [room.id], ephemeral: { types: ["m.receipt"] } } });
	const snapP = mx(c, `/_matrix/client/v3/sync?timeout=0&filter=${enc(filter)}`, { token }).catch(() => null);
	const members = await membersP;
	const res = await msgP;
	const data = await res.json();
	// 回执只在 sync 的 ephemeral 里；快照给历史消息带上已读名单。
	try {
		const snap = await snapP;
		if (snap?.ok) mergeReceiptCache(room.id, readReceipts(await snap.json(), room.id, members, c, base));
	} catch (_) {}
	const cached = cacheRoomEvents(room.id, data.chunk);
	const eventMap = new Map([...cached, ...(data.chunk || []).map((ev) => [ev.event_id, ev])]);
	const messages = (data.chunk || [])
		.map((ev) => (ev.type === "m.room.message" || ev.type === "m.sticker" ? normalize(ev, members, c, base, eventMap) : null))
		.filter(Boolean)
		.reverse()
		.map((m) => ({ ...m, receipt: exactReceipt(room.id, m.id, m.sender) }));
	const redactions = collectRedactions(data.chunk || [], members);
	return json(200, { ok: true, room: { key: room.key, name: room.name, desc: room.desc }, messages, redactions, end: data.end || null });
}

async function handleSync(c, url, base, token) {
	const room = roomOf(c, url);
	const since = url.searchParams.get("since") || "";
	const filter = JSON.stringify({
		room: {
			rooms: [room.id],
			timeline: { limit: 50 },
			state: { lazy_load_members: true },
			ephemeral: { types: ["m.receipt", "m.typing"] },
		},
		// 联邦 presence 事件：外站成员在线状态的唯一实时来源，别过滤掉
		presence: { types: ["m.presence"] },
	});
	// 长轮询：客户端传 timeout（毫秒）表示「没新消息就挂起等，最多等这么久」，
	// 上限 30 秒；不传或传 0 保持老行为（立即返回），兼容旧前端。
	const want = Math.min(Math.max(Number(url.searchParams.get("timeout")) || 0, 0), 30_000);
	const path = `/_matrix/client/v3/sync?timeout=${want}&filter=${enc(filter)}` + (since ? `&since=${enc(since)}` : "");
	const membersP = getMembers(c, room.id);
	const res = await mx(c, path, { token });
	const data = await res.json();
	const members = await membersP;
	// 接住 /sync 带回的联邦 presence：外站在线状态全靠这条流
	applyPresenceEvents(data.presence?.events);
	const receiptMap = readReceipts(data, room.id, members, c, base);
	const changedReceipts = mergeReceiptCache(room.id, receiptMap);
	// 已读回执会随 sync 的 ephemeral 快照更新，但对应事件往往早就不在 timeline 里了。
	// 单独回传一份，让前端就地刷新「N 人已读」，不用整页重载；只推真的多出读者的。
	const receipts = {};
	for (const id of changedReceipts) {
		const rec = receiptCache.get(`${room.id}|${id}`);
		if (rec) receipts[id] = { count: rec.count, readers: rec.readers.slice(0, 12) };
	}
	const timeline = data.rooms?.join?.[room.id]?.timeline?.events || [];
	const reactions = collectReactions(timeline, members);
	const cached = cacheRoomEvents(room.id, timeline);
	const eventMap = new Map([...cached, ...timeline.map((ev) => [ev.event_id, ev])]);
	const messages = timeline
		.map((ev) => (ev.type === "m.room.message" || ev.type === "m.sticker" ? normalize(ev, members, c, base, eventMap) : null))
		.filter(Boolean)
		.map((m) => ({ ...m, receipt: exactReceipt(room.id, m.id, m.sender), reactions: reactions.get(m.id) || [] }));
	// reaction 更新可能指向历史消息，单独返回让前端就地合并
	const reactionUpdates = Object.fromEntries(reactions.entries());
	const redactions = collectRedactions(timeline, members);
	// m.typing 的 user_ids 里是当前正在输入的人
	const typingEv = (data.rooms?.join?.[room.id]?.ephemeral?.events || [])
		.filter((ev) => ev.type === "m.typing")
		.pop();
	// m.typing 的 user_ids 是全量快照，规范要求客户端整份替换；自己不能出现在提醒里
	const me = await whoAmI(c, token);
	const typing = (typingEv?.content?.user_ids || [])
		.filter((id) => id !== me)
		.map((id) => (members.get(id) || {}).nick || id)
		.filter(Boolean);
	return json(200, { ok: true, messages, next: data.next_batch || since || null, typing, reactions: reactionUpdates, receipts, redactions });
}

// 读取房间真实头像（m.room.avatar），统一走本站媒体代理，避免跨域 mxc://
const roomAvatarCache = new Map();
async function roomAvatar(c, base, roomId) {
	const hit = roomAvatarCache.get(roomId);
	if (hit && Date.now() - hit.at < 5 * 60_000) return hit.url;
	try {
		const { ok, data } = await mxJson(c, `/_matrix/client/v3/rooms/${enc(roomId)}/state/m.room.avatar`);
		const mxc = ok && data?.url;
		if (typeof mxc === "string" && mxc.startsWith("mxc://")) {
			const url = `${base}/api/media?u=${enc(mxc)}`;
			roomAvatarCache.set(roomId, { at: Date.now(), url });
			return url;
		}
	} catch (_) {}
	return "";
}

async function handleRoom(c, base, room, url) {
	if (url?.searchParams.get("light") === "1") {
		const avatar = await roomAvatar(c, base, room.id);
		return json(200, {
			ok: true,
			room: { key: room.key, name: room.name, desc: room.desc, id: room.id, avatar },
			members: [],
			online: 0,
		});
	}
	const [members, active, avatar, badges] = await Promise.all([
		getMembers(c, room.id),
		getActiveSenders(c, room.id),
		roomAvatar(c, base, room.id),
		readBadges(c).catch(() => new Map()),
	]);
	// 在线判定优先级：桥接心跳 > Synapse presence > 刚说过话。
	// 以前是「30 分钟内说过话」一律在线，于是人走了半小时还挂着；
	// Synapse 的 currently_active 关页后也能挂很久，只能在确实活跃时才信。
	// 探测名单：外站成员也要探，不能只探本站+刚发言的——
	// 人家在自己站点挂着不说话，恰恰是「其他站点在线」最常见的样子。
	// getPresenceMap 有 20s 缓存 + 单请求 2.5s 超时并行，100+ 人也不会拖死接口。
	const probeIds = [...members.keys()].slice(0, 140);
	const presence = await getPresenceMap(c, room.id, probeIds);
	const isOnline = (p) =>
		p && Number(p.last_active_ago) <= 2 * 60 * 1000 && (p.presence === "online" || p.currently_active === true);
	const isPresent = (id) => {
		const seen = seenAt.get(id);
		if (seen && Date.now() - seen < SEEN_TTL) return true;
		// 两个来源任一说「刚活跃且在线」就算在线。别因为其中一个过期就 return false，
		// 否则会挡掉另一个来源的有效结果。
		const live = livePresence.get(id);
		if (live && Date.now() - live.at < LIVE_TTL && isOnline(live)) return true;
		if (isOnline(presence.get(id))) return true;
		// 都没有就退到「刚说过话」兜底
		return active.has(id);
	};
	const list = [...members.entries()].map(([id, m]) => {
		const domain = id.split(":")[1] || "";
		return {
			id,
			nick: m.nick,
			site: m.site || SITE_BY_SERVER[domain] || (domain === "matrix.0dm.cn" ? c.siteName : ""),
			avatar: m.avatar.startsWith("mxc://") ? `${base}/api/media?u=${enc(m.avatar)}` : m.avatar,
			online: isPresent(id),
			badge: (badges.get(id) || {}).a || "",
		};
	});

	// 不能按昵称去重：同名是两个人，合并展示就违反「显示名必须消歧」，还给了冒名空间。
	list.sort((a, b) => {
		if (a.online !== b.online) return a.online ? -1 : 1;
		const aMine = a.site === c.siteName;
		const bMine = b.site === c.siteName;
		if (aMine !== bMine) return aMine ? -1 : 1;
		return a.nick.localeCompare(b.nick, "zh");
	});

	const out = {
		ok: true,
		room: { key: room.key, name: room.name, desc: room.desc, id: room.id, avatar },
		members: list,
		online: list.filter((m) => m.online).length,
	};
	// ?debug=1 时把在线判定依据带出来，排查「人走了还显示在线」用
	if (url?.searchParams.get("debug") === "1") {
		const now = Date.now();
		out.debug = list.map((m) => {
			const p = presence.get(m.id) || {};
			const live = livePresence.get(m.id) || {};
			const seen = seenAt.get(m.id) || 0;
			return {
				id: m.id,
				nick: m.nick,
				online: m.online,
				local: m.id.endsWith(":matrix.0dm.cn"),
				presence: p.presence || "",
				last_ago: p.last_active_ago ?? null,
				live_presence: live.presence || "",
				live_ago: live.last_active_ago ?? null,
				live_age_s: live.at ? Math.round((now - live.at) / 1000) : null,
				spoke: active.has(m.id),
				seen_ago_s: seen ? Math.round((now - seen) / 1000) : null,
			};
		});
	}
	return json(200, out);
}

/**
 * 线程相关 API（Matrix 原生线程 MSC3440）。
 * 实测本机 Synapse：/thread/{root} 端点未启用（M_UNRECOGNIZED），
 * 但 relations 端点和事件 unsigned.m.relations.m.thread 摘要都可用。
 * 策略：主线 /messages -> 看 unsigned.m.relations.m.thread 找线程根 + count/latest，
 *       /relations/{root}?rel_type=m.thread 拉全部回复，/event/{root} 取根消息。
 */
const threadCache = { at: 0, key: "", threads: [] };

/** 从主线历史里收集带线程的根事件（靠 unsigned.m.relations.m.thread 摘要） */
async function collectThreadRoots(c, roomId) {
	const res = await mx(c, `/_matrix/client/v3/rooms/${enc(roomId)}/messages?dir=b&limit=200`, {
		token: c.bridgeToken,
	});
	const data = await res.json().catch(() => ({}));
	const roots = new Map();
	for (const ev of data.chunk || []) {
		const summary = ev.unsigned?.["m.relations"]?.["m.thread"];
		if (!summary || !(Number(summary.count) > 0)) continue;
		roots.set(ev.event_id, {
			id: ev.event_id,
			ts: ev.origin_server_ts || 0,
			count: Number(summary.count),
			latest: summary.latest_event || null,
			rootEvent: ev,
		});
	}
	return roots;
}

/** 取单个线程的完整回复（含根消息） */
async function fetchThread(c, roomId, rootId, members, base, rootHint, countHint) {
	const [relRes, rootRes] = await Promise.all([
		mx(c, `/_matrix/client/v1/rooms/${enc(roomId)}/relations/${enc(rootId)}?rel_type=m.thread&limit=80`, {
			token: c.bridgeToken,
		}),
		rootHint
			? Promise.resolve(null)
			: mx(c, `/_matrix/client/v3/rooms/${enc(roomId)}/event/${enc(rootId)}`, { token: c.bridgeToken }),
	]);
	const relData = relRes.ok ? await relRes.json().catch(() => ({})) : {};
	const rootEv =
		rootHint ||
		(rootRes && rootRes.ok ? await rootRes.json().catch(() => null) : null);
	const threadEvents = [rootEv, ...(relData.chunk || [])].filter(Boolean);
	const eventMap = new Map(threadEvents.map((ev) => [ev.event_id, ev]));
	const root = rootEv ? normalize(rootEv, members, c, base, eventMap) : null;
	const replies = (relData.chunk || [])
		.map((ev) => normalize(ev, members, c, base, eventMap))
		.filter(Boolean)
		.sort((a, b) => a.ts - b.ts);
	if (!root && !replies.length) return null;
	return { root, replies, countHint: countHint || 0 };
}

async function handleThreads(c, url, base) {
	const room = roomOf(c, url);
	const key = room.id;
	if (Date.now() - threadCache.at < 20_000 && threadCache.key === key) {
		return json(200, { ok: true, threads: threadCache.threads });
	}
	try {
		const members = await getMembers(c, room.id);
		const roots = await collectThreadRoots(c, room.id);
		const threads = [];
		// 并发但有上限，避免一次开几十个请求打爆 Synapse
		const list = [...roots.values()].sort((a, b) => b.ts - a.ts).slice(0, 30);
		for (let i = 0; i < list.length; i += 6) {
			const batch = list.slice(i, i + 6);
			const got = await Promise.all(
				batch.map(async (r) => {
					const t = await fetchThread(c, room.id, r.id, members, base, r.rootEvent, r.count);
					if (!t) return null;
					const root = t.root || {};
					const latest = t.replies[t.replies.length - 1] || null;
					const participants = [];
					for (const m of [t.root, ...t.replies].filter(Boolean)) {
						if (participants.length >= 4) break;
						if (participants.some((p) => p.id === m.sender)) continue;
						participants.push({ id: m.sender, name: m.nick || "茶友", avatar: m.avatar || "" });
					}
					return {
						rootUid: root.id || r.id,
						root: root.id ? root : null,
						summary: {
							count: Math.max(t.replies.length, t.countHint || 0),
							latestReply: latest
								? {
										msgUid: latest.id,
										name: latest.nick || "茶友",
										avatar: latest.avatar || "",
										content: String(latest.text || latest.image || "").replace(/\s+/g, " ").trim().slice(0, 120),
										createdAt: latest.ts || 0,
									}
								: null,
							participants,
						},
					};
				}),
			);
			threads.push(...got.filter(Boolean));
		}
		threads.sort((a, b) => (b.summary.latestReply?.createdAt || 0) - (a.summary.latestReply?.createdAt || 0));
		threadCache.at = Date.now();
		threadCache.key = key;
		threadCache.threads = threads;
		return json(200, { ok: true, threads });
	} catch (err) {
		return fail(502, "线程列表暂时取不到");
	}
}

async function handleThreadDetail(c, url, base) {
	const room = roomOf(c, url);
	const rootUid = url.searchParams.get("rootUid") || "";
	if (!isEventId(rootUid)) return fail(400, "线程标识不对");
	try {
		const members = await getMembers(c, room.id);
		const t = await fetchThread(c, room.id, rootUid, members, base, null, 0);
		if (!t) return fail(404, "这个线程找不到了");
		return json(200, {
			ok: true,
			rootUid,
			root: t.root,
			messages: t.replies.map((m) => ({ ...m, reactions: [] })),
			room: { key: room.key, name: room.name },
		});
	} catch (err) {
		return fail(502, "线程暂时打不开");
	}
}

/**
 * 置顶消息（Matrix 原生 m.room.pinned_events 状态事件）。
 * 联邦事件用 /event/{id} 常常查不到（本机只存历史副本），所以翻主线历史匹配 event_id。
 * 缓存 60 秒，避免每条请求都翻上千条历史。
 */
const pinCache = { at: 0, key: "", pins: [] };

async function handlePins(c, url, base) {
	const room = roomOf(c, url);
	if (Date.now() - pinCache.at < 60_000 && pinCache.key === room.id) {
		return json(200, { ok: true, pins: pinCache.pins });
	}
	try {
		const st = await mxJson(c, `/_matrix/client/v3/rooms/${enc(room.id)}/state/m.room.pinned_events`, {
			token: c.bridgeToken,
		});
		const ids = Array.isArray(st.data?.pinned) ? st.data.pinned.slice(0, 12) : [];
		if (!ids.length) {
			pinCache.at = Date.now();
			pinCache.key = room.id;
			pinCache.pins = [];
			return json(200, { ok: true, pins: [] });
		}
		const wanted = new Set(ids);
		const members = await getMembers(c, room.id);
		const found = new Map();
		let from = "";
		// 最多翻 4 页（每页 500），置顶通常是建站初期的老消息
		for (let page = 0; page < 4 && found.size < wanted.size; page++) {
			const q = `/_matrix/client/v3/rooms/${enc(room.id)}/messages?dir=b&limit=500${from ? `&from=${enc(from)}` : ""}`;
			const res = await mx(c, q, { token: c.bridgeToken });
			const data = await res.json().catch(() => ({}));
			const eventMap = new Map((data.chunk || []).map((ev) => [ev.event_id, ev]));
			for (const ev of data.chunk || []) {
				if (wanted.has(ev.event_id)) {
					const m = normalize(ev, members, c, base, eventMap);
					if (m) found.set(m.id, m);
				}
			}
			from = data.end || "";
			if (!from) break;
		}
		const pins = ids.map((id) => found.get(id)).filter(Boolean);
		pinCache.at = Date.now();
		pinCache.key = room.id;
		pinCache.pins = pins;
		return json(200, { ok: true, pins });
	} catch (err) {
		return fail(502, "置顶消息暂时取不到");
	}
}

async function handleRecall(c, request, token, room) {
	if (!token) return fail(401, "还没入座");
	let body;
	try {
		body = await request.json();
	} catch {
		return fail(400, "请求格式不对");
	}
	const eventId = clean(body.eventId, 120);
	if (!isEventId(eventId)) return fail(400, "消息标识不对");
	const txn = `recall-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const res = await mx(c, `/_matrix/client/v3/rooms/${enc(room.id)}/redact/${enc(eventId)}/${txn}`, {
		token,
		method: "PUT",
		body: { reason: "撤回" },
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) return fail(res.status === 403 ? 403 : 502, data.error || "撤回失败");
	return json(200, { ok: true, id: data.event_id });
}

async function handleSend(c, request, token, room) {
	if (!token) return fail(401, "还没入座");
	let body;
	try {
		body = await request.json();
	} catch {
		return fail(400, "请求格式不对");
	}
	const text = clean(body.text, LIMITS.text);
	const replyTo = clean(body.replyTo, 120);
	const threadRoot = clean(body.threadRoot, 120);
	const threadLatest = clean(body.threadLatest, 120);
	const imageUrl = clean(body.imageUrl, 400);
	const videoUrl = clean(body.videoUrl, 400);
	const filename = clean(body.filename, 120);
	if (!text && !imageUrl && !videoUrl) return fail(400, "空消息发不出去");

	let content;
	if (imageUrl && body.emoticon === true) {
		// 规范（v1.19 / Sending custom emotes）：表情是 m.text 的 formatted_body 里
		// 带 data-mx-emoticon 的 <img>，height MUST 存在；不再是 m.image 上的自定义字段。
		const code = clean(body.shortcode, 40) || ":emote:";
		const attr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
		content = {
			msgtype: "m.text",
			body: code,
			format: "org.matrix.custom.html",
			formatted_body: `<img data-mx-emoticon src="${attr(imageUrl)}" alt="${attr(code)}" title="${attr(code)}" height="32" />`,
		};
	} else if (imageUrl) {
		content = { msgtype: "m.image", body: text || filename || "图片", url: imageUrl };
	} else if (videoUrl) {
		// 规范（m.video）：url 放视频本体，info 是 VideoInfo（w/h/duration/mimetype/size）。
		// v1.10 起 body 可以是说明文字，原始文件名单独放 filename。
		// 数值逐个夹一遍，别把前端传来的脏数据原样写进事件。
		const vi = body.info && typeof body.info === "object" ? body.info : {};
		const num = (v, cap) => {
			const n = Math.round(Number(v));
			return Number.isFinite(n) && n > 0 && n <= cap ? n : 0;
		};
		const info = {};
		if (num(vi.w, 20000)) info.w = num(vi.w, 20000);
		if (num(vi.h, 20000)) info.h = num(vi.h, 20000);
		if (num(vi.duration, 24 * 60 * 60 * 1000)) info.duration = num(vi.duration, 24 * 60 * 60 * 1000);
		if (num(vi.size, 512 * 1024 * 1024)) info.size = num(vi.size, 512 * 1024 * 1024);
		const mime = String(vi.mimetype || "");
		if (/^video\/[a-z0-9.+-]{1,40}$/i.test(mime)) info.mimetype = mime;
		content = { msgtype: "m.video", body: text || filename || "视频", url: videoUrl };
		if (filename) content.filename = filename;
		if (Object.keys(info).length) content.info = info;
	} else {
		content = { msgtype: "m.text", body: text };
	}
	// 提及：规范（MSC3952 / m.mentions）把被点名的人放进 content["m.mentions"]，
	// 客户端靠它决定要不要给这个人加提醒；正文里的 "@某人" 只是给人看的。
	// 只收合法 user id，别把前端传的脏串原样写进事件。
	const mentionIds = Array.isArray(body.mentions)
		? [...new Set(body.mentions.filter((x) => typeof x === "string" && /^@[^\s:]+:[^\s]+$/.test(x)))].slice(0, 50)
		: [];
	const mentionRoom = body.mentionRoom === true;
	if (mentionIds.length || mentionRoom) {
		const mentions = {};
		if (mentionIds.length) mentions.user_ids = mentionIds;
		if (mentionRoom) mentions.room = true;
		content["m.mentions"] = mentions;
	}
	// Matrix 原生线程：rel_type=m.thread + is_falling_back + m.in_reply_to。
	// 规范（Fallback for unthreaded clients）：is_falling_back 为 true 时，
	// m.in_reply_to MUST 指向「客户端已知的线程内最新一条消息」，而不是线程根。
	if (isEventId(threadRoot)) {
		const target = isEventId(threadLatest) ? threadLatest : threadRoot;
		content["m.relates_to"] = {
			rel_type: "m.thread",
			event_id: threadRoot,
			is_falling_back: true,
			"m.in_reply_to": { event_id: target },
		};
	} else if (isEventId(replyTo)) {
		// v1.13 起富回复不再要求 body 里带 "> <@user>" 引用块，只留关系字段即可。
		content["m.relates_to"] = { "m.in_reply_to": { event_id: replyTo } };
	}
	// 规范（Transaction identifiers）：同一个 txnId 重传必须幂等，
	// 所以重试要复用前端给的 txnId，不能每次重新生成。
	const txn = clean(body.txnId, 80) || `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	const res = await mx(c, `/_matrix/client/v3/rooms/${enc(room.id)}/send/m.room.message/${enc(txn)}`, {
		token,
		method: "PUT",
		body: content,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) return fail(res.status === 403 ? 403 : 502, data.error || "发送失败");
	return json(200, { ok: true, id: data.event_id, txnId: txn, ts: Date.now() });
}

// 图片/表情/视频上传：先存到 Matrix media，再由前端发 m.image / m.video
async function handleUpload(c, request, token) {
	if (!token) return fail(401, "还没入座");
	const type = (request.headers.get("content-type") || "image/png").split(";")[0].trim();
	const isImage = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(type);
	const isVideo = /^video\/(mp4|webm|quicktime|ogg)$/.test(type);
	if (!isImage && !isVideo) return fail(400, "只支持图片和视频");
	// 家里那条上行带宽撑不住更大的文件，也别把 homeserver 的 media 仓库塞爆。
	const cap = isVideo ? 48 * 1024 * 1024 : 8 * 1024 * 1024;
	const buf = await request.arrayBuffer();
	if (buf.byteLength > cap) return fail(413, isVideo ? "视频最大 48 MB" : "图片最大 8 MB");
	const name = type.replace("/", ".");
	const res = await mx(c, `/_matrix/media/v3/upload?filename=${enc(name)}`, {
		token,
		method: "POST",
		raw: buf,
		headers: { "Content-Type": type },
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) return fail(502, data.error || "上传失败");
	return json(200, { ok: true, url: data.content_uri });
}

// typing 上报：Matrix 的 typing 是短时状态，前端定时续期
async function handleTyping(c, request, token, room) {
	if (!token) return fail(401, "还没入座");
	let body;
	try {
		body = await request.json();
	} catch {
		return fail(400, "请求格式不对");
	}
	// typing 只能替自己发（服务端会校验 userId = 认证用户），身份从 token 现查，别信前端。
	const active = body.active === true;
	const uid = await whoAmI(c, token);
	if (!uid) return fail(401, "登录状态失效了，重新入座试试");
	// 规范：客户端持续输入时间隔续期，服务器超时建议 20-30 秒。
	await mx(c, `/_matrix/client/v3/rooms/${enc(room.id)}/typing/${enc(uid)}`, {
		token,
		method: "PUT",
		body: { typing: active, timeout: active ? 20_000 : 0 },
	});
	return json(200, { ok: true });
}

// 已读回执：规范（Receipts）要求客户端确认消息已展示后上报 m.read，
// 且不应对自己发的消息发回执。前端的「N 人已读」全靠这里。
async function handleReceipt(c, request, token, room) {
	if (!token) return fail(401, "还没入座");
	let body;
	try {
		body = await request.json();
	} catch {
		return fail(400, "请求格式不对");
	}
	const eventId = clean(body.eventId, 120);
	if (!isEventId(eventId)) return fail(400, "消息标识不对");
	const res = await mx(c, `/_matrix/client/v3/rooms/${enc(room.id)}/receipt/m.read/${enc(eventId)}`, {
		token,
		method: "POST",
		body: {},
	});
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		return fail(res.status === 403 ? 403 : 502, data.error || "回执上报失败");
	}
	return json(200, { ok: true, id: eventId });
}

// 回应（reaction）：Matrix m.reaction，带 m.relates_to
async function handleReaction(c, request, token, room) {
	if (!token) return fail(401, "还没入座");
	let body;
	try {
		body = await request.json();
	} catch {
		return fail(400, "请求格式不对");
	}
	const key = clean(body.key, 32);
	const target = clean(body.eventId, 120);
	if (!key || !isEventId(target)) return fail(400, "参数不对");
	const content = {
		"m.relates_to": { rel_type: "m.annotation", event_id: target, key },
	};
	const txn = clean(body.txnId, 80) || `rx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	const res = await mx(c, `/_matrix/client/v3/rooms/${enc(room.id)}/send/m.reaction/${txn}`, {
		token,
		method: "PUT",
		body: content,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) return fail(502, data.error || "回应失败");
	return json(200, { ok: true, id: data.event_id });
}

async function handleMedia(c, request, url) {
	const mxc = url.searchParams.get("u") || "";
	const m = mxc.match(/^mxc:\/\/([^/]+)\/([A-Za-z0-9_-]+)$/);
	if (!m) return fail(400, "bad mxc");
	// 视频/音频必须支持 Range：浏览器要 206 才能拖动进度条、才能跳过 moov 在尾部的等待，
	// 一律返 200 整段会让大视频卡在首帧。
	const range = request.headers.get("range") || "";
	const upstream = await mx(c, `/_matrix/client/v1/media/download/${enc(m[1])}/${enc(m[2])}`, {
		token: c.bridgeToken,
		headers: range ? { range } : {},
	});
	if (!upstream.ok && upstream.status !== 206) return fail(upstream.status, "media failed");
	const headers = new Headers();
	headers.set("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
	headers.set("Cache-Control", "public, max-age=86400");
	for (const name of ["content-length", "content-range", "accept-ranges"]) {
		const v = upstream.headers.get(name);
		if (v) headers.set(name, v);
	}
	if (upstream.status === 206) headers.set("Accept-Ranges", "bytes");
	return new Response(upstream.body, { status: upstream.status, headers });
}

// ── 个人资料：显示名/头像走 Matrix profile，扩展字段存 account_data ──
async function handleProfile(c, request, token) {
	if (!token) return fail(401, "先入座，再改资料");
	const who = await mxJson(c, "/_matrix/client/v3/account/whoami", { token });
	if (!who.ok || !who.data.user_id) return fail(401, "登录状态失效了，重新入座试试");
	const uid = who.data.user_id;
	const dataPath = `/_matrix/client/v3/user/${enc(uid)}/account_data/uk.9ll.profile`;

	if (request.method === "GET") {
		const { ok, data } = await mxJson(c, dataPath, { token });
		return json(200, { ok: true, profile: ok && data && typeof data === "object" ? data : {} });
	}

	let body;
	try {
		body = await request.json();
	} catch {
		return fail(400, "请求格式不对");
	}
	const nick = clean(body.nick, 20);
	if (!nick) return fail(400, "昵称不能为空");
	const signature = clean(body.signature, 80);
	const website = clean(body.website, 120);
	const avatarUrl = clean(body.avatarUrl, 600);
	const status = clean(body.status, 40);
	const emailNotify = body.emailNotify === true;
	// 三档推送：off / mention / all；老客户端只发 push 布尔值，按 mention 兼容
	const pushMode = ["off", "mention", "all"].includes(String(body.pushMode || ""))
		? String(body.pushMode)
		: body.push === true
			? "mention"
			: "off";
	const push = pushMode !== "off";

	const displayname = `${nick} · ${c.siteName}`;
	const nameRes = await mx(c, `/_matrix/client/v3/profile/${enc(uid)}/displayname`, {
		token,
		method: "PUT",
		body: { displayname },
	});
	if (!nameRes.ok) {
		const err = await nameRes.json().catch(() => ({}));
		return fail(502, err.error || "改昵称失败");
	}

	let avatarMxc = "";
	if (/^https?:\/\//i.test(avatarUrl)) {
		try {
			const img = await fetch(avatarUrl, { redirect: "follow" });
			const type = (img.headers.get("content-type") || "").split(";")[0].trim();
			if (img.ok && /^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(type)) {
				const buf = await img.arrayBuffer();
				if (buf.byteLength <= 2 * 1024 * 1024) {
					const up = await mx(c, `/_matrix/media/v3/upload?filename=avatar`, {
						token,
						method: "POST",
						raw: buf,
						headers: { "Content-Type": type },
					});
					const upData = await up.json().catch(() => ({}));
					if (up.ok && upData.content_uri) {
						avatarMxc = upData.content_uri;
						await mx(c, `/_matrix/client/v3/profile/${enc(uid)}/avatar_url`, {
							token,
							method: "PUT",
							body: { avatar_url: avatarMxc },
						});
					}
				}
			}
		} catch (_) {}
	}

	const profile = { nick, signature, website, avatarUrl, status, emailNotify, push, pushMode, updatedAt: Date.now() };
	await mx(c, dataPath, { token, method: "PUT", body: profile });
	memberCache.at = 0;
	return json(200, {
		ok: true,
		user: {
			id: uid,
			nick,
			status,
			avatar: avatarMxc ? `${requestOrigin(request)}/api/media?u=${enc(avatarMxc)}` : "",
		},
		profile,
	});
}

// ── 点歌台 v2：队列、歌单、轮播都存在 Matrix 房间状态事件里 ──────────
// 不依赖 isolate 内存，重启不丢；写入需要访客 token，读取公开。
// 队列只存歌曲元数据，播放前再解析直链，避免 vkey 过期。
const JUKE_STATE_TYPE = "uk.9ll.juke.state";
const JUKE_STATE_KEY = "juke";
const JUKE_PLAYLISTS_TYPE = "uk.9ll.juke.playlists";
const JUKE_PLAYLIST_TYPE = "uk.9ll.juke.playlist";
const JUKE_ROTATION_TYPE = "uk.9ll.juke.rotation";
const JUKE_LIMITS = { queue: 40, history: 25, perUser: 10, tracks: 60, playlists: 8 };
const JUKE_VERSION = 2;

const jukeEmpty = () => ({
	v: JUKE_VERSION,
	current: null,
	queue: [],
	history: [],
	votes: {},
	rotation: null,
	seq: 0,
	updatedAt: 0,
});

const jukeUid = () => `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const jukePlaylistId = () => `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** 队列/歌单里的歌曲只保留可公开复现的元数据，直链在播放时现取 */
function jukeTrack(raw) {
	const t = normalizeTrack(raw);
	if (!t || !t.title) return null;
	if (t.source === "local" && !/^\/assets\//.test(t.url || "")) return null;
	return t;
}

function jukeEntry(raw) {
	const t = jukeTrack(raw);
	if (!t) return null;
	return {
		...t,
		uid: clean(raw?.uid, 40) || jukeUid(),
		requester: clean(raw?.requester, 30),
		requesterId: clean(raw?.requesterId, 90),
		addedAt: Number(raw?.addedAt) || 0,
		startAt: Number(raw?.startAt) || 0,
		playedAt: Number(raw?.playedAt) || 0,
		by: clean(raw?.by, 30),
		kind: raw?.kind === "rotation" ? "rotation" : "request",
	};
}

function jukePreview(rot) {
	if (!rot || !Array.isArray(rot.tracks) || !rot.tracks.length) return [];
	const order = Array.isArray(rot.order) && rot.order.length === rot.tracks.length ? rot.order : rot.tracks.map((_, i) => i);
	const out = [];
	let i = Number(rot.index) || 0;
	while (out.length < 5 && i < order.length) {
		const t = rot.tracks[order[i]];
		if (t) out.push({ key: t.key, title: t.title, artist: t.artist });
		i++;
	}
	return out;
}

async function jukeStateGet(c, room, type, key = "") {
	const path = `/_matrix/client/v3/rooms/${enc(room.id)}/state/${enc(type)}/${enc(key)}`;
	const { ok, status, data } = await mxJson(c, path);
	if (status === 404) return null;
	if (!ok) throw new Error(data.error || "juke state read failed");
	return data;
}

async function jukeStatePut(c, room, type, key, body) {
	const path = `/_matrix/client/v3/rooms/${enc(room.id)}/state/${enc(type)}/${enc(key)}`;
	const res = await mx(c, path, { method: "PUT", body });
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.error || "juke state write failed");
}

async function jukeRead(c, room) {
	const raw = await jukeStateGet(c, room, JUKE_STATE_TYPE, JUKE_STATE_KEY);
	if (!raw || typeof raw !== "object") return jukeEmpty();

	// v1 迁移：当时队列里存的是站点歌单的 id + Meting 直链
	if (raw.v !== JUKE_VERSION) {
		const migrate = (t) => {
			if (!t || typeof t !== "object") return null;
			const oldId = clean(t.id, 80);
			const url = clean(t.url, 600);
			const numeric = /^\d+$/.test(oldId);
			const local = /^\/assets\//.test(url);
			const t2 = jukeTrack({
				title: t.title,
				artist: t.artist,
				cover: t.cover,
				source: numeric ? "netease" : local ? "local" : "",
				sourceId: numeric ? oldId : "",
				key: numeric ? `netease:${oldId}` : "",
				url: local ? url : "",
			});
			if (!t2) return null;
			return {
				...t2,
				uid: clean(t.uid, 40) || jukeUid(),
				requester: clean(t.requester, 30),
				requesterId: clean(t.requesterId, 90),
				addedAt: Number(t.addedAt) || 0,
				startAt: Number(t.startAt) || 0,
				playedAt: Number(t.playedAt) || 0,
				kind: "request",
			};
		};
		const queue = Array.isArray(raw.queue) ? raw.queue.map(migrate).filter(Boolean) : [];
		const history = Array.isArray(raw.history) ? raw.history.map(migrate).filter(Boolean) : [];
		return {
			...jukeEmpty(),
			current: raw.current ? migrate(raw.current) : null,
			queue,
			history,
			seq: Number(raw.seq) || 0,
			updatedAt: Number(raw.updatedAt) || 0,
		};
	}

	const current = raw.current ? jukeEntry(raw.current) : null;
	const queue = Array.isArray(raw.queue) ? raw.queue.map(jukeEntry).filter(Boolean).slice(0, JUKE_LIMITS.queue) : [];
	const history = Array.isArray(raw.history) ? raw.history.map(jukeEntry).filter(Boolean).slice(0, JUKE_LIMITS.history) : [];
	const votes = raw.votes && typeof raw.votes === "object" ? raw.votes : {};
	const rotation = raw.rotation && typeof raw.rotation === "object"
		? {
				playlistId: clean(raw.rotation.playlistId, 40),
				name: clean(raw.rotation.name, 80),
				trackCount: Number(raw.rotation.trackCount) || 0,
				preview: Array.isArray(raw.rotation.preview)
					? raw.rotation.preview.slice(0, 6).map((x) => ({
							key: clean(x?.key, 80),
							title: clean(x?.title, 100),
							artist: clean(x?.artist, 120),
						}))
					: [],
			}
		: null;
	return {
		v: JUKE_VERSION,
		current,
		queue,
		history,
		votes,
		rotation,
		seq: Number(raw.seq) || 0,
		updatedAt: Number(raw.updatedAt) || 0,
	};
}

async function jukeWrite(c, room, state) {
	state.v = JUKE_VERSION;
	state.updatedAt = Date.now();
	// Matrix 单个状态事件有 64KB 上限；超了就丢最早的历史和队尾，保住正在播的歌
	if (JSON.stringify(state).length > 56_000) {
		state.history = state.history.slice(0, 8);
		state.queue = state.queue.slice(0, 20);
	}
	if (JSON.stringify(state).length > 62_000) {
		state.history = [];
		state.queue = state.queue.slice(0, 10);
	}
	await jukeStatePut(c, room, JUKE_STATE_TYPE, JUKE_STATE_KEY, state);
}

// ── 访客身份与站长判定 ──────────────────────────────────────────────
const jukeWhoCache = new Map();

async function jukeWho(c, room, token) {
	const ck = `${token}|${room.id}`;
	const hit = jukeWhoCache.get(ck);
	if (hit && Date.now() - hit.at < 5 * 60_000) return hit.who;

	let who = { id: "", name: "茶友", admin: false };
	const { ok, data } = await mxJson(c, "/_matrix/client/v3/account/whoami", { token });
	if (ok && data.user_id) {
		const id = data.user_id;
		const local = id.split(":")[0].replace(/^@/, "");
		let name = local.startsWith("tea") ? "茶友" : local;
		try {
			const prof = await mxJson(c, `/_matrix/client/v3/profile/${enc(id)}`, {});
			const dn = prof.data?.displayname;
			if (dn) name = String(dn).split(" · ")[0].slice(0, 20);
		} catch (_) {}
		let admin = false;
		try {
			const pl = await mxJson(c, `/_matrix/client/v3/rooms/${enc(room.id)}/state/m.room.power_levels/`, {});
			if (pl.ok && pl.data && typeof pl.data === "object") {
				const users = pl.data.users || {};
				admin = Number(users[id] ?? pl.data.users_default ?? 0) >= 50 || (!!c.ownerId && id === c.ownerId);
			}
		} catch (_) {}
		who = { id, name, admin };
	}
	if (jukeWhoCache.size > 500) jukeWhoCache.clear();
	jukeWhoCache.set(ck, { at: Date.now(), who });
	return who;
}

// ── 歌单 ────────────────────────────────────────────────────────────
async function jukePlaylistsRead(c, room) {
	const raw = await jukeStateGet(c, room, JUKE_PLAYLISTS_TYPE, "");
	const items = Array.isArray(raw?.items)
		? raw.items
				.slice(0, JUKE_LIMITS.playlists)
				.map((x) => ({
					id: clean(x?.id, 40),
					name: clean(x?.name, 80),
					platform: clean(x?.platform, 24),
					creator: clean(x?.creator, 60),
					cover: /^https?:\/\//.test(String(x?.cover || "")) ? String(x.cover).replace(/^http:/i, "https:") : "",
					trackCount: Number(x?.trackCount) || 0,
					by: clean(x?.by, 30),
					addedAt: Number(x?.addedAt) || 0,
				}))
				.filter((x) => x.id && x.name)
		: [];
	return { v: 1, items };
}

async function jukePlaylistRead(c, room, id) {
	if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) return null;
	const raw = await jukeStateGet(c, room, JUKE_PLAYLIST_TYPE, id);
	if (!raw || typeof raw !== "object") return null;
	const tracks = Array.isArray(raw.tracks) ? raw.tracks.map(jukeTrack).filter(Boolean).slice(0, JUKE_LIMITS.tracks) : [];
	if (!tracks.length) return null;
	return {
		id,
		name: clean(raw.name, 80) || "导入的歌单",
		platform: clean(raw.platform, 24),
		creator: clean(raw.creator, 60),
		cover: /^https?:\/\//.test(String(raw.cover || "")) ? String(raw.cover).replace(/^http:/i, "https:") : "",
		by: clean(raw.by, 30),
		addedAt: Number(raw.addedAt) || 0,
		tracks,
	};
}

// ── 轮播 ────────────────────────────────────────────────────────────
function jukeShuffle(n, lastKey, tracks) {
	const order = Array.from({ length: n }, (_, i) => i);
	for (let i = n - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[order[i], order[j]] = [order[j], order[i]];
	}
	if (n > 1 && lastKey && tracks[order[0]]?.key === lastKey) {
		const j = 1 + Math.floor(Math.random() * (n - 1));
		[order[0], order[j]] = [order[j], order[0]];
	}
	return order;
}

async function jukeRotationRead(c, room) {
	const raw = await jukeStateGet(c, room, JUKE_ROTATION_TYPE, "juke");
	if (!raw || typeof raw !== "object") return null;
	const tracks = Array.isArray(raw.tracks) ? raw.tracks.map(jukeTrack).filter(Boolean).slice(0, JUKE_LIMITS.tracks) : [];
	if (!tracks.length) return null;
	const order = Array.isArray(raw.order)
		? raw.order.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < tracks.length)
		: [];
	return {
		v: 1,
		playlistId: clean(raw.playlistId, 40),
		name: clean(raw.name, 80) || "轮播歌单",
		tracks,
		order,
		index: Number(raw.index) || 0,
		lastKey: clean(raw.lastKey, 80),
	};
}

async function jukeRotationWrite(c, room, rot) {
	await jukeStatePut(c, room, JUKE_ROTATION_TYPE, "juke", {
		v: 1,
		playlistId: rot.playlistId,
		name: rot.name,
		tracks: rot.tracks,
		order: rot.order,
		index: rot.index,
		lastKey: rot.lastKey,
	});
}

async function jukeRotationNext(c, room, rot) {
	if (!rot || !rot.tracks.length) return null;
	let order = Array.isArray(rot.order) && rot.order.length === rot.tracks.length ? rot.order.slice() : [];
	if (order.length !== rot.tracks.length) order = jukeShuffle(rot.tracks.length, rot.lastKey, rot.tracks);
	let index = Number(rot.index) || 0;
	if (index >= order.length) {
		order = jukeShuffle(rot.tracks.length, rot.lastKey, rot.tracks);
		index = 0;
	}
	const track = rot.tracks[order[index]];
	if (!track) return null;
	rot.order = order;
	rot.index = index + 1;
	rot.lastKey = track.key;
	await jukeRotationWrite(c, room, rot);
	return { ...track, kind: "rotation", uid: jukeUid() };
}

const jukeRotationMeta = (rot) =>
	rot
		? {
				playlistId: rot.playlistId,
				name: rot.name,
				trackCount: rot.tracks.length,
				preview: jukePreview(rot),
			}
		: null;

function jukeAdvance(state, next, who) {
	if (state.current) {
		state.history.unshift({
			...state.current,
			playedAt: Date.now(),
			by: state.current.requester || "",
		});
		state.history = state.history.slice(0, JUKE_LIMITS.history);
	}
	if (next) {
		const kind = next.kind === "rotation" ? "rotation" : "request";
		state.current = {
			...next,
			uid: next.uid || jukeUid(),
			startAt: Date.now() + 700,
			requester: kind === "rotation" ? "" : next.requester || who?.name || "茶友",
			requesterId: kind === "rotation" ? "" : next.requesterId || who?.id || "",
			kind,
		};
	} else {
		state.current = null;
	}
	state.votes = {};
	state.seq = (Number(state.seq) || 0) + 1;
	state.updatedAt = Date.now();
	return state;
}

async function jukeNext(c, room, state, rot, who) {
	const next = state.queue.shift() || (await jukeRotationNext(c, room, rot));
	jukeAdvance(state, next, who);
	return next;
}

// ── 接口 ────────────────────────────────────────────────────────────
async function handleJukeState(c, room, token) {
	const state = await jukeRead(c, room);
	const who = token ? await jukeWho(c, room, token) : { admin: false, id: "", name: "茶友" };
	return json(200, { ok: true, ...state, serverNow: Date.now(), room: room.key, admin: !!who.admin, me: who.id });
}

async function handleJukeSearch(url, ip, env) {
	const denied = await rateCheck(env, ip, "search");
	if (denied) return fail(429, denied);
	const q = clean(url.searchParams.get("q"), 60);
	if (!q) return fail(400, "想听什么？先输入歌名或歌手");
	const rawSource = clean(url.searchParams.get("source"), 12) || "all";
	const source = rawSource === "all" || ["qq", "netease", "kugou", "youtube"].includes(rawSource) ? rawSource : "all";
	const limit = Math.max(4, Math.min(20, Number(url.searchParams.get("limit")) || 12));
	try {
		const items = await searchMusic(source, q, limit);
		return json(200, { ok: true, items, source, q, serverNow: Date.now() });
	} catch (err) {
		return fail(502, `曲库暂时不通：${String(err.message || err).slice(0, 60)}`);
	}
}

async function handleJukeLink(request, url, ip, env) {
	const denied = await rateCheck(env, ip, "link");
	if (denied) return fail(429, denied);
	const track = jukeTrack({
		key: clean(url.searchParams.get("key"), 80),
		title: clean(url.searchParams.get("title"), 100),
		artist: clean(url.searchParams.get("artist"), 140),
		source: clean(url.searchParams.get("source"), 12),
		sourceId: clean(url.searchParams.get("id"), 80),
		durationSec: Number(url.searchParams.get("duration")) || 0,
		url: clean(url.searchParams.get("url"), 600),
	});
	if (!track) return fail(400, "缺少歌曲信息");
	try {
		const got = await resolveTrack(track);
		const origin = requestOrigin(request);
		const secret = env.MUSIC_SECRET || env.BRIDGE_TOKEN || "";
		const local = got.source === "local" || /^\/assets\//.test(got.url);
		const proxied = local ? "" : await proxyUrl(got.url, secret, origin);
		return json(200, {
			ok: true,
			url: local ? got.url : /^https:\/\//i.test(got.url) ? got.url : proxied,
			direct: got.url,
			proxy: proxied,
			source: got.source,
			sourceId: got.sourceId,
			lrc: got.lrc || "",
			serverNow: Date.now(),
		});
	} catch (err) {
		return fail(404, String(err.message || err).slice(0, 100) || "找不到可播的音源");
	}
}

async function handleJukeStream(request, url, env) {
	const secret = env.MUSIC_SECRET || env.BRIDGE_TOKEN || "";
	const target = await verifyProxy(url.searchParams, secret);
	if (!target) return fail(403, "这条音频链接已经过期，重新点一次歌吧");
	try {
		return await proxyAudio(request, target);
	} catch (_) {
		return fail(502, "音频代理暂时不通，稍后再试");
	}
}

async function handleJukePlaylists(c, room) {
	const idx = await jukePlaylistsRead(c, room);
	const state = await jukeRead(c, room);
	return json(200, { ok: true, items: idx.items, rotation: state.rotation, serverNow: Date.now() });
}

async function handleJukePlaylist(c, room, url) {
	const id = clean(url.searchParams.get("id"), 40);
	const pl = await jukePlaylistRead(c, room, id);
	if (!pl) return fail(404, "歌单不存在或已经删了");
	return json(200, { ok: true, playlist: pl, serverNow: Date.now() });
}

async function handleJukeRotation(c, room) {
	const rot = await jukeRotationRead(c, room);
	return json(200, {
		ok: true,
		rotation: rot
			? {
					playlistId: rot.playlistId,
					name: rot.name,
					trackCount: rot.tracks.length,
					index: rot.index,
					tracks: rot.order.length === rot.tracks.length ? rot.order.map((i) => rot.tracks[i]).filter(Boolean) : rot.tracks,
					next: jukePreview(rot),
				}
			: null,
		serverNow: Date.now(),
	});
}

async function handleJukeImport(c, request, token, ip, env, room) {
	if (!token) return fail(401, "先入座，再导歌单");
	const denied = await rateCheck(env, ip, "import");
	if (denied) return fail(429, denied);
	let body;
	try {
		body = await request.json();
	} catch {
		return fail(400, "请求格式不对");
	}
	const who = await jukeWho(c, room, token);
	const idx = await jukePlaylistsRead(c, room);
	if (idx.items.length >= JUKE_LIMITS.playlists) return fail(400, "这间房的导入歌单已经满了");
	let pl;
	try {
		pl = await importPlaylist(body.url);
	} catch (err) {
		return fail(400, String(err.message || err).slice(0, 120) || "歌单解析失败");
	}
	const id = jukePlaylistId();
	const record = {
		v: 1,
		id,
		name: pl.name,
		platform: pl.platform,
		creator: pl.creator,
		cover: pl.cover,
		by: who.name,
		addedAt: Date.now(),
		tracks: pl.tracks,
	};
	await jukeStatePut(c, room, JUKE_PLAYLIST_TYPE, id, record);
	const item = {
		id,
		name: record.name,
		platform: record.platform,
		creator: record.creator,
		cover: record.cover,
		trackCount: record.tracks.length,
		by: record.by,
		addedAt: record.addedAt,
	};
	idx.items.unshift(item);
	await jukeStatePut(c, room, JUKE_PLAYLISTS_TYPE, "", { v: 1, items: idx.items.slice(0, JUKE_LIMITS.playlists) });
	return json(200, {
		ok: true,
		playlist: { ...item },
		items: idx.items,
		serverNow: Date.now(),
	});
}

async function handleJukeWrite(c, request, url, token, ip, env, room) {
	const denied = await rateCheck(env, ip, "juke");
	if (denied) return fail(429, denied);
	let body;
	try {
		body = await request.json();
	} catch {
		return fail(400, "请求格式不对");
	}
	const action = clean(body.action, 20);
	// 未入座的旁观者也可以收听；一首歌自然播完后允许他们推动队列，手动切歌仍需身份
	if (!token && action !== "ended") return fail(401, "先入座，再点歌");
	const who = token ? await jukeWho(c, room, token) : { id: "", name: "茶友", admin: false };
	const state = await jukeRead(c, room);
	const rot = await jukeRotationRead(c, room);
	let vote = null;

	if (action === "enqueue" || action === "random") {
		const track = jukeTrack(body.track);
		if (!track) return fail(400, "这首歌的信息不完整");
		if (state.current?.key === track.key || state.queue.some((t) => t.key === track.key)) {
			return json(200, { ok: true, duplicate: true, state, serverNow: Date.now(), admin: !!who.admin });
		}
		const mine = state.queue.filter((t) => t.requesterId && t.requesterId === who.id).length;
		if (mine >= JUKE_LIMITS.perUser) return fail(400, `一次最多排 ${JUKE_LIMITS.perUser} 首，等前面的放完再来`);
		if (state.queue.length >= JUKE_LIMITS.queue) return fail(400, "队列已经排满了，等一会儿再点");
		const entry = {
			...track,
			uid: jukeUid(),
			requester: who.name,
			requesterId: who.id,
			addedAt: Date.now(),
			kind: "request",
		};
		if (!state.current || state.current.kind === "rotation") {
			jukeAdvance(state, entry, who);
		} else {
			state.queue.push(entry);
			state.seq += 1;
			state.updatedAt = Date.now();
		}
	} else if (action === "play") {
		const uid = clean(body.uid, 40);
		const idx = state.queue.findIndex((t) => t.uid === uid);
		if (idx < 0) return fail(404, "队列里没找到这首歌");
		const [next] = state.queue.splice(idx, 1);
		jukeAdvance(state, next, who);
	} else if (action === "next" || action === "ended") {
		if (!state.current) return json(200, { ok: true, state, serverNow: Date.now(), admin: !!who.admin });
		const from = clean(body.from, 40);
		if (action === "ended" && !from) return fail(400, "缺少当前曲目信息");
		if (action === "ended" && from && state.current.uid !== from) {
			return json(200, { ok: true, stale: true, state, serverNow: Date.now(), admin: !!who.admin });
		}
		const next = state.queue.shift() || (await jukeRotationNext(c, room, rot));
		jukeAdvance(state, next, who);
		if (rot) state.rotation = jukeRotationMeta(rot);
	} else if (action === "skip") {
		if (!state.current) return json(200, { ok: true, state, serverNow: Date.now(), admin: !!who.admin });
		const cur = state.current;
		const listeners = Math.max(1, Math.min(99, Number(body.listeners) || 1));
		const immediate =
			cur.kind === "rotation" ||
			!cur.requesterId ||
			cur.requesterId === who.id ||
			who.admin ||
			listeners <= 2;
		if (immediate) {
			const next = state.queue.shift() || (await jukeRotationNext(c, room, rot));
			jukeAdvance(state, next, who);
			if (rot) state.rotation = jukeRotationMeta(rot);
			vote = { skipped: true, votes: 0, required: 0 };
		} else {
			// 收听人数不好精确统计，超过 3 人时固定最多要 3 票，避免大房间里永远凑不齐
			const required = Math.min(3, Math.floor(listeners / 2) + 1);
			const key = cur.uid;
			const voters = Array.isArray(state.votes[key]) ? state.votes[key].slice(0, 50) : [];
			if (who.id && !voters.includes(who.id)) voters.push(who.id);
			state.votes = { [key]: voters };
			if (voters.length >= required) {
				const next = state.queue.shift() || (await jukeRotationNext(c, room, rot));
				jukeAdvance(state, next, who);
				if (rot) state.rotation = jukeRotationMeta(rot);
				vote = { skipped: true, votes: voters.length, required };
			} else {
				state.seq += 1;
				state.updatedAt = Date.now();
				vote = { skipped: false, votes: voters.length, required };
			}
		}
	} else if (action === "remove") {
		const uid = clean(body.uid, 40);
		const idx = state.queue.findIndex((t) => t.uid === uid);
		if (idx < 0) return fail(404, "队列里没找到这首歌");
		const target = state.queue[idx];
		if (target.requesterId && target.requesterId !== who.id && !who.admin) return fail(403, "只能撤自己点的歌");
		state.queue.splice(idx, 1);
		state.seq += 1;
		state.updatedAt = Date.now();
	} else if (action === "rotation") {
		if (!who.admin) return fail(403, "只有站长能换轮播歌单");
		const playlistId = clean(body.playlistId, 40);
		if (!playlistId) {
			await jukeStatePut(c, room, JUKE_ROTATION_TYPE, "juke", {
				v: 1,
				playlistId: "",
				name: "",
				tracks: [],
				order: [],
				index: 0,
				lastKey: "",
			});
			state.rotation = null;
			state.seq += 1;
			state.updatedAt = Date.now();
		} else {
			const pl = await jukePlaylistRead(c, room, playlistId);
			if (!pl) return fail(404, "歌单不存在");
			const nextRot = {
				v: 1,
				playlistId,
				name: pl.name,
				tracks: pl.tracks,
				order: jukeShuffle(pl.tracks.length, "", pl.tracks),
				index: 0,
				lastKey: "",
			};
			await jukeRotationWrite(c, room, nextRot);
			state.rotation = jukeRotationMeta(nextRot);
			if (!state.current || state.current.kind === "rotation") {
				const next = await jukeRotationNext(c, room, nextRot);
				jukeAdvance(state, next, who);
				state.rotation = jukeRotationMeta(nextRot);
			} else {
				state.seq += 1;
				state.updatedAt = Date.now();
			}
		}
	} else {
		return fail(400, "不支持的操作");
	}

	await jukeWrite(c, room, state);
	return json(200, { ok: true, state, serverNow: Date.now(), admin: !!who.admin, vote });
}

// 反代（ESA → Lucky → 本容器）之后，Node 侧看到的请求永远是 http://，
// 直接拿 origin 拼媒体地址会得到 http://tea.0dm.cn/...，https 页面会被混合内容拦掉。
// 优先用反代给的 x-forwarded-proto；没有就按 Host 判断：本机/内网走 http，其余按 https。
function requestOrigin(request) {
	const u = new URL(request.url);
	const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || u.host;
	const fwd = (request.headers.get("x-forwarded-proto") || "").split(",")[0].trim().toLowerCase();
	const local = /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(host);
	const proto = fwd === "https" || fwd === "http" ? fwd : local ? "http" : "https";
	return `${proto}://${host}`;
}

// ── 入口 ────────────────────────────────────────────────────────────
export async function handleRequest(request, env = {}) {
	const c = cfg(env);
	// CYAPI 联调凭据：环境变量优先，便于随时轮换；未设置时用内置默认值
	if (env.CYAPI_KEY) setCyapiKey(env.CYAPI_KEY);
	const url = new URL(request.url);
	const path = url.pathname.replace(/\/+$/, "") || "/";
	const origin = request.headers.get("origin") || "";

	const corsHeaders = {
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Access-Control-Max-Age": "86400",
		Vary: "Origin",
	};
	if (c.origins.includes(origin)) corsHeaders["Access-Control-Allow-Origin"] = origin;

	if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

	const ip =
		request.headers.get("cf-connecting-ip") ||
		(request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
		"unknown";
	const auth = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
	const visitorToken = auth && auth !== c.bridgeToken ? auth : "";
	// 任何带访客 token 的请求都算一次心跳；whoami 有 5 分钟缓存，不额外打请求
	if (visitorToken) whoAmI(c, visitorToken).then(touchSeen).catch(() => {});
	const base = requestOrigin(request);

	let out;
	try {
		if (path === "/" || path === "/api/health") {
			out = json(200, { ok: true, room: c.room, site: c.siteName, mode: "individual", time: Math.floor(Date.now() / 1000) });
		} else if (path === "/api/enter" && request.method === "POST") {
			out = await handleEnter(c, env, request, ip);
		} else if (path === "/api/waline" && request.method === "POST") {
			out = await handleWaline(c, env, request, ip, base);
		} else if (path === "/api/waline-sso" && request.method === "POST") {
			out = await handleWalineSso(c, env, request, ip, base);
		} else if (path === "/api/logout" && request.method === "POST") {
			out = await handleLogout(c, request);
		} else if (path === "/api/matrix-login" && request.method === "POST") {
			out = await handleMatrixLogin(c, request, ip);
		} else if (path === "/api/room" && request.method === "GET") {
			out = await handleRoom(c, base, roomOf(c, url), url);
		} else if (path === "/api/pins" && request.method === "GET") {
			out = await handlePins(c, url, base);
		} else if (path === "/api/threads" && request.method === "GET") {
			out = await handleThreads(c, url, base);
		} else if (path === "/api/thread" && request.method === "GET") {
			out = await handleThreadDetail(c, url, base);
		} else if (path === "/api/history" && request.method === "GET") {
			out = await handleHistory(c, url, base, visitorToken || c.bridgeToken);
		} else if (path === "/api/search" && request.method === "POST") {
			const denied = await rateCheck(env, ip, "search");
			out = denied ? fail(429, denied) : await handleSearchStart(c, request, ip);
		} else if (path === "/api/search" && request.method === "GET") {
			out = handleSearchPoll(c, url);
		} else if (path === "/api/around" && request.method === "GET") {
			out = await handleAround(c, url, base);
		} else if (path === "/api/sync" && request.method === "GET") {
			out = await handleSync(c, url, base, visitorToken || c.bridgeToken);
		} else if (path === "/api/media" && request.method === "GET") {
			out = await handleMedia(c, request, url);
		} else if (path === "/api/recall" && request.method === "POST") {
			out = await handleRecall(c, request, visitorToken, roomOf(c, url));
		} else if (path === "/api/send" && request.method === "POST") {
			const denied = await rateCheck(env, ip, "send");
			out = denied ? fail(429, denied) : await handleSend(c, request, visitorToken, roomOf(c, url));
		} else if (path === "/api/upload" && request.method === "POST") {
			out = await handleUpload(c, request, visitorToken);
		} else if (path === "/api/typing" && request.method === "POST") {
			out = await handleTyping(c, request, visitorToken, roomOf(c, url));
		} else if (path === "/api/receipt" && request.method === "POST") {
			const denied = await rateCheck(env, ip, "receipt");
			out = denied ? fail(429, denied) : await handleReceipt(c, request, visitorToken, roomOf(c, url));
		} else if (path === "/api/reaction" && request.method === "POST") {
			out = await handleReaction(c, request, visitorToken, roomOf(c, url));
		} else if (path === "/api/profile" && (request.method === "GET" || request.method === "POST")) {
			out = await handleProfile(c, request, visitorToken);
		} else if (path === "/api/juke/time" && request.method === "GET") {
			out = json(200, { ok: true, serverNow: Date.now() });
		} else if (path === "/api/juke/state" && request.method === "GET") {
			out = await handleJukeState(c, roomOf(c, url), visitorToken);
		} else if (path === "/api/juke/action" && request.method === "POST") {
			out = await handleJukeWrite(c, request, url, visitorToken, ip, env, roomOf(c, url));
		} else if (path === "/api/juke/search" && request.method === "GET") {
			out = await handleJukeSearch(url, ip, env);
		} else if (path === "/api/juke/link" && request.method === "GET") {
			out = await handleJukeLink(request, url, ip, env);
		} else if (path === "/api/juke/stream" && request.method === "GET") {
			out = await handleJukeStream(request, url, env);
		} else if (path === "/api/juke/playlists" && request.method === "GET") {
			out = await handleJukePlaylists(c, roomOf(c, url));
		} else if (path === "/api/juke/playlist" && request.method === "GET") {
			out = await handleJukePlaylist(c, roomOf(c, url), url);
		} else if (path === "/api/juke/rotation" && request.method === "GET") {
			out = await handleJukeRotation(c, roomOf(c, url));
		} else if (path === "/api/juke/import" && request.method === "POST") {
			out = await handleJukeImport(c, request, visitorToken, ip, env, roomOf(c, url));
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
