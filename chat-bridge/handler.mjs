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
 */

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

const LIMITS = { text: 500, nick: 8, email: 120, website: 120, history: 80 };
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

let memberCache = { at: 0, map: new Map(), room: "" };

async function getMembers(c, roomId, force = false) {
	if (!force && Date.now() - memberCache.at < 60_000 && memberCache.room === roomId && memberCache.map.size) {
		return memberCache.map;
	}
	const { ok, data } = await mxJson(c, `/_matrix/client/v3/rooms/${enc(roomId)}/members`);
	if (!ok) throw new Error(data.error || "members failed");
	const map = new Map();
	for (const ev of data.chunk || []) {
		if (ev.type !== "m.room.member" || ev.content?.membership !== "join") continue;
		map.set(ev.state_key, {
			nick: ev.content.displayname || ev.state_key.split(":")[0].replace(/^@/, ""),
			avatar: ev.content.avatar_url || "",
		});
	}
	memberCache = { at: Date.now(), map, room: roomId };
	return map;
}

// m.receipt 在 sync 的 ephemeral 里是一条「全量快照」事件：
// content = { "$eventId": { "m.read": { "@user": { ts, thread_id } } } }
// 取最近一条即可；顺手把 Matrix 用户映射成房间成员资料。
function readReceipts(data, roomId, members, c, base) {
	const events = data?.rooms?.join?.[roomId]?.ephemeral?.events || [];
	const snapshot = [...events].reverse().find((ev) => ev.type === "m.receipt")?.content || {};
	const map = new Map();
	for (const [eventId, reads] of Object.entries(snapshot)) {
		const users = reads?.["m.read"] || {};
		const readers = Object.entries(users)
			.map(([id, info]) => {
				const m = members.get(id) || {};
				const nick = m.nick || id.split(":")[0].replace(/^@/, "");
				const dot = nick.indexOf(" · ");
				const avatar = m.avatar
					? m.avatar.startsWith("mxc://")
						? `${base}/api/media?u=${enc(m.avatar)}`
						: m.avatar
					: "";
				return {
					id,
					nick: dot > 0 ? nick.slice(0, dot) : nick,
					site: dot > 0 ? nick.slice(dot + 3) : SITE_BY_SERVER[id.split(":")[1]] || "",
					avatar,
					ts: info?.ts || 0,
				};
			})
			.sort((a, b) => b.ts - a.ts);
		if (readers.length) map.set(eventId, { count: readers.length, readers });
	}
	return map;
}

// Matrix 的 m.receipt 是「最新一条」快照，旧事件的回执会消失。
// 这里按每个读者的最新已读时间做水位线：时间早于水位的消息都算已读。
function readWatermarks(data, roomId, members, c, base) {
	const events = data?.rooms?.join?.[roomId]?.ephemeral?.events || [];
	const snapshot = [...events].reverse().find((ev) => ev.type === "m.receipt")?.content || {};
	const byUser = new Map();
	for (const reads of Object.values(snapshot)) {
		const users = reads?.["m.read"] || {};
		for (const [id, info] of Object.entries(users)) {
			if (!id || id === c.selfUserId) continue;
			const ts = Number(info?.ts) || 0;
			if (!ts) continue;
			const prev = byUser.get(id);
			if (!prev || ts > prev.ts) {
				const m = members.get(id) || {};
				const nick = m.nick || id.split(":")[0].replace(/^@/, "");
				const dot = nick.indexOf(" · ");
				byUser.set(id, {
					id,
					nick: dot > 0 ? nick.slice(0, dot) : nick,
					site: dot > 0 ? nick.slice(dot + 3) : SITE_BY_SERVER[id.split(":")[1]] || "",
					avatar: m.avatar ? (m.avatar.startsWith("mxc://") ? `${base}/api/media?u=${enc(m.avatar)}` : m.avatar) : "",
					ts,
				});
			}
		}
	}
	return [...byUser.values()];
}

// 精确回执：eventId -> 实际在该事件上留下 m.read 的人。
// 各客户端（Element）就是这样显示的；不要用时间水位倒推，否则会多算。
const receiptCache = new Map();

function mergeReceiptCache(roomId, map) {
	for (const [eventId, rec] of map) {
		const key = `${roomId}|${eventId}`;
		const prev = receiptCache.get(key);
		if (!prev) {
			receiptCache.set(key, { ...rec, updatedAt: Date.now() });
			continue;
		}
		const byId = new Map(prev.readers.map((r) => [r.id, r]));
		for (const r of rec.readers) if (!byId.has(r.id)) byId.set(r.id, r);
		const readers = [...byId.values()].sort((a, b) => b.ts - a.ts);
		receiptCache.set(key, { count: readers.length, readers: readers.slice(0, 12), updatedAt: Date.now() });
	}
	if (receiptCache.size > 3000) {
		const oldest = [...receiptCache.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt).slice(0, 1000);
		for (const [k] of oldest) receiptCache.delete(k);
	}
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
	const cutoff = Date.now() - 30 * 60 * 1000;
	const set = new Set();
	for (const ev of data.chunk || []) {
		if (ev.type !== "m.room.message") continue;
		if (!ev.origin_server_ts || ev.origin_server_ts < cutoff) continue;
		set.add(ev.sender);
	}
	activeCache = { at: Date.now(), set, room: roomId };
	return set;
}

// 真实在线状态：只探测本站成员 + 最近发言的人，避免 100+ 成员逐个请求拖慢房间接口。
let presenceCache = { at: 0, room: "", key: "", map: new Map() };

async function getPresenceMap(c, roomId, ids) {
	const key = ids.join("|");
	if (Date.now() - presenceCache.at < 20_000 && presenceCache.room === roomId && presenceCache.key === key) {
		return presenceCache.map;
	}
	const out = new Map();
	await Promise.all(
		ids.map(async (id) => {
			try {
				const { ok, data } = await mxJson(c, `/_matrix/client/v3/presence/${enc(id)}/status`, {
					token: c.bridgeToken,
				});
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

function normalize(ev, members, c, base) {
	const content = ev.content || {};
	if (!content.body && !content.url) return null;
	if (!["m.text", "m.image", "m.emote"].includes(content.msgtype)) return null;

	const sender = ev.sender || "";
	const domain = sender.split(":")[1] || "";
	const member = members.get(sender) || {};
	let nick = member.nick || sender.split(":")[0].replace(/^@/, "");
	let site = SITE_BY_SERVER[domain] || (domain === "matrix.0dm.cn" ? c.siteName : "");
	let avatar = member.avatar || "";
	let text = typeof content.body === "string" ? content.body : "";
	let image = "";

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

	if (content.msgtype === "m.image" && content.url) {
		image = `${base}/api/media?u=${enc(content.url)}`;
		text = text || "发了一张图片";
	}
	// 表情包是 m.image + 自定义标记，前端按小图渲染
	const emoticon = content["data-mx-emoticon"] ? true : false;

	avatar = avatar.startsWith("mxc://") ? `${base}/api/media?u=${enc(avatar)}` : avatar;

	// Matrix 原生线程（MSC3440）：m.relates_to.rel_type = "m.thread"，event_id 指向根事件
	const relates = content["m.relates_to"];
	const threadRoot = relates && relates.rel_type === "m.thread" && relates.event_id ? relates.event_id : "";

	return { id: ev.event_id, sender, ts: ev.origin_server_ts || Date.now(), nick, site, avatar, text, image, reply, emoticon, threadRoot };
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
			list.push({ key, count: 1, nick: (m.nick || "").split(" · ")[0], senders: [] });
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
	const gap = kind === "enter" ? RATE.enterGap : kind === "juke" ? 800 : RATE.minGap;

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

// 身份索引存在 Synapse 的私有房间里：状态事件类型 com.0dm.tea.identity，state_key = md5(邮箱)
const ID_EVENT_TYPE = "com.0dm.tea.identity";
const idKey = (email) => md5Hex(email.trim().toLowerCase());

async function readIdentity(c, email) {
	if (!email || !c.indexRoom) return null;
	const res = await mx(c, `/_matrix/client/v3/rooms/${enc(c.indexRoom)}/state/${ID_EVENT_TYPE}/${enc(idKey(email))}`, {
		token: c.adminToken,
	});
	if (!res.ok) return null;
	try {
		return await res.json();
	} catch {
		return null;
	}
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
	const { nick, email, website } = profile;
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
			return {
				user: {
					id: stored.uid,
					nick,
					avatar: stored.mxc ? `${base}/api/media?u=${enc(stored.mxc)}` : "",
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

	return {
		user: { id: userId, nick, avatar: avatarUrl ? `${base}/api/media?u=${enc(avatarUrl)}` : "" },
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
		const out = await provisionIdentity(c, env, { nick, email, website }, new URL(request.url).origin);
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
		const out = await provisionIdentity(c, env, { nick, email, website }, base);
		return json(200, { ok: true, ...out, waline: { nick } });
	} catch (e) {
		return fail(502, e.message || "开座位失败");
	}
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
				? `${new URL(request.url).origin}/api/media?u=${enc(rawAvatar)}`
				: "",
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
		let nick = members.get(sender)?.nick || sender.split(":")[0].replace(/^@/, "");
		const dot = nick.indexOf(" · ");
		const site = dot > 0 ? nick.slice(dot + 3).trim() : SITE_BY_SERVER[sender.split(":")[1]] || "";
		if (dot > 0) nick = nick.slice(0, dot).trim();
		list.push({ id: target, by: nick, site, ts: ev.origin_server_ts || Date.now() });
	}
	return list;
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
	const messages = (data.chunk || [])
		.map((ev) => (ev.type === "m.room.message" ? normalize(ev, members, c, base) : null))
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
	});
	const path = `/_matrix/client/v3/sync?timeout=0&filter=${enc(filter)}` + (since ? `&since=${enc(since)}` : "");
	const membersP = getMembers(c, room.id);
	const res = await mx(c, path, { token });
	const data = await res.json();
	const members = await membersP;
	mergeReceiptCache(room.id, readReceipts(data, room.id, members, c, base));
	const timeline = data.rooms?.join?.[room.id]?.timeline?.events || [];
	const reactions = collectReactions(timeline, members);
	const messages = timeline
		.map((ev) => (ev.type === "m.room.message" ? normalize(ev, members, c, base) : null))
		.filter(Boolean)
		.map((m) => ({ ...m, receipt: exactReceipt(room.id, m.id, m.sender), reactions: reactions.get(m.id) || [] }));
	// reaction 更新可能指向历史消息，单独返回让前端就地合并
	const reactionUpdates = Object.fromEntries(reactions.entries());
	const redactions = collectRedactions(timeline, members);
	// m.typing 的 user_ids 里是当前正在输入的人
	const typingEv = (data.rooms?.join?.[room.id]?.ephemeral?.events || [])
		.filter((ev) => ev.type === "m.typing")
		.pop();
	const typing = (typingEv?.content?.user_ids || [])
		.filter((id) => id !== c.selfUserId)
		.map((id) => {
			const m = members.get(id) || {};
			const nick = m.nick || id.split(":")[0].replace(/^@/, "");
			const dot = nick.indexOf(" · ");
			return dot > 0 ? nick.slice(0, dot).trim() : nick;
		})
		.filter(Boolean);
	return json(200, { ok: true, messages, next: data.next_batch || since || null, typing, reactions: reactionUpdates, redactions });
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
	const [members, active, avatar] = await Promise.all([
		getMembers(c, room.id),
		getActiveSenders(c, room.id),
		roomAvatar(c, base, room.id),
	]);
	// 只探本站账号：外站 presence 常被对方服务器拖到超时，外站成员用“最近发言”判断在线
	const localIds = [...members.keys()].filter((id) => id.endsWith(":matrix.0dm.cn"));
	const probeIds = localIds.slice(0, 30);
	const presence = await getPresenceMap(c, room.id, probeIds);
	const isPresent = (id) => {
		const p = presence.get(id);
		if (!p) return false;
		if (p.presence === "online") return true;
		if (p.currently_active === true) return true;
		return Number(p.last_active_ago) > 0 && Number(p.last_active_ago) < 5 * 60 * 1000;
	};
	const list = [...members.entries()].map(([id, m]) => {
		const domain = id.split(":")[1] || "";
		const dot = m.nick.indexOf(" · ");
		return {
			id,
			nick: dot > 0 ? m.nick.slice(0, dot) : m.nick,
			site: dot > 0 ? m.nick.slice(dot + 3) : SITE_BY_SERVER[domain] || (domain === "matrix.0dm.cn" ? c.siteName : ""),
			avatar: m.avatar.startsWith("mxc://") ? `${base}/api/media?u=${enc(m.avatar)}` : m.avatar,
			online: active.has(id) || isPresent(id),
		};
	});

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

	return json(200, {
		ok: true,
		room: { key: room.key, name: room.name, desc: room.desc, id: room.id, avatar },
		members: unique,
		online: unique.filter((m) => m.online).length,
	});
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
	const root = rootEv ? normalize(rootEv, members, c, base) : null;
	const replies = (relData.chunk || [])
		.map((ev) => normalize(ev, members, c, base))
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
	if (!/^\$[\w-]+$/.test(rootUid)) return fail(400, "线程标识不对");
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
			for (const ev of data.chunk || []) {
				if (wanted.has(ev.event_id)) {
					const m = normalize(ev, members, c, base);
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
	if (!/^\$[\w-]+$/.test(eventId)) return fail(400, "消息标识不对");
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
	const imageUrl = clean(body.imageUrl, 400);
	if (!text && !imageUrl) return fail(400, "空消息发不出去");

	let content;
	if (imageUrl) {
		content = {
			msgtype: "m.image",
			body: text || "发了一张图片",
			url: imageUrl,
			"data-mx-emoticon": body.emoticon === true,
		};
	} else {
		content = { msgtype: "m.text", body: text };
	}
	// Matrix 原生线程（MSC3440）：rel_type=m.thread + is_falling_back + m.in_reply_to。
	// 线程回复在主流不可见，客户端需按 threadRoot 单独拉取。
	if (threadRoot && /^\$[\w-]+$/.test(threadRoot)) {
		content["m.relates_to"] = {
			rel_type: "m.thread",
			event_id: threadRoot,
			is_falling_back: true,
			"m.in_reply_to": { event_id: threadRoot },
		};
	} else if (replyTo && /^\$[\w-]+$/.test(replyTo)) {
		// 普通 Matrix 回复关系，客户端按 body 的 "> <@user> 原文" 渲染引用块
		content["m.relates_to"] = { "m.in_reply_to": { event_id: replyTo } };
	}
	const txn = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	const res = await mx(c, `/_matrix/client/v3/rooms/${enc(room.id)}/send/m.room.message/${txn}`, {
		token,
		method: "PUT",
		body: content,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) return fail(res.status === 403 ? 403 : 502, data.error || "发送失败");
	return json(200, { ok: true, id: data.event_id, ts: Date.now() });
}

// 图片/表情上传：先存到 Matrix media，再由前端发 m.image
async function handleUpload(c, request, token) {
	if (!token) return fail(401, "还没入座");
	const type = (request.headers.get("content-type") || "image/png").split(";")[0].trim();
	if (!/^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(type)) return fail(400, "只支持图片");
	const buf = await request.arrayBuffer();
	if (buf.byteLength > 8 * 1024 * 1024) return fail(413, "图片最大 8 MB");
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
	const active = body.active === true;
	const uid = clean(body.userId, 200);
	if (!uid) return fail(400, "缺少用户标识");
	await mx(c, `/_matrix/client/v3/rooms/${enc(room.id)}/typing/${enc(uid)}`, {
		token,
		method: "PUT",
		body: { typing: active, timeout: active ? 5000 : 0 },
	});
	return json(200, { ok: true });
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
	if (!key || !/^\$[\w-]+$/.test(target)) return fail(400, "参数不对");
	const content = {
		"m.relates_to": { rel_type: "m.annotation", event_id: target, key },
	};
	const txn = `rx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	const res = await mx(c, `/_matrix/client/v3/rooms/${enc(room.id)}/send/m.reaction/${txn}`, {
		token,
		method: "PUT",
		body: content,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) return fail(502, data.error || "回应失败");
	return json(200, { ok: true, id: data.event_id });
}

async function handleMedia(c, url) {
	const mxc = url.searchParams.get("u") || "";
	const m = mxc.match(/^mxc:\/\/([^/]+)\/([A-Za-z0-9_-]+)$/);
	if (!m) return fail(400, "bad mxc");
	const upstream = await mx(c, `/_matrix/client/v1/media/download/${enc(m[1])}/${enc(m[2])}`, { token: c.bridgeToken });
	if (!upstream.ok) return fail(upstream.status, "media failed");
	const headers = new Headers();
	headers.set("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
	headers.set("Cache-Control", "public, max-age=86400");
	return new Response(upstream.body, { status: 200, headers });
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
	const push = body.push === true;

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

	const profile = { nick, signature, website, avatarUrl, status, emailNotify, push, updatedAt: Date.now() };
	await mx(c, dataPath, { token, method: "PUT", body: profile });
	memberCache.at = 0;
	return json(200, {
		ok: true,
		user: {
			id: uid,
			nick,
			status,
			avatar: avatarMxc ? `${new URL(request.url).origin}/api/media?u=${enc(avatarMxc)}` : "",
		},
		profile,
	});
}

// ── 点歌台：队列存在 Matrix 房间状态事件里 ──────────────────────────
// 不分 isolate 内存、重启不丢；写入需要访客 token，读取公开。
const JUKE_STATE_TYPE = "uk.9ll.juke.state";
const JUKE_STATE_KEY = "juke";
const JUKE_LIMITS = { queue: 40, history: 40 };

const jukeEmpty = () => ({ v: 1, current: null, queue: [], history: [], seq: 0, updatedAt: 0 });

function jukeTrack(raw) {
	const id = clean(raw?.id, 40).replace(/[^A-Za-z0-9_-]/g, "");
	const title = clean(raw?.title, 80);
	const artist = clean(raw?.artist, 80);
	const url = clean(raw?.url, 600);
	const cover = clean(raw?.cover, 600);
	const lrc = clean(raw?.lrc, 600);
	if (!id || !title) return null;
	const good = (v) => !v || /^\/assets\//.test(v) || /^https:\/\/api\.i-meto\.com\/meting\/api\?/.test(v);
	if (!good(url) || !good(cover)) return null;
	return { id, title, artist, url, cover, lrc, kind: raw?.kind === "rotation" ? "rotation" : "request" };
}

async function jukeRead(c, room) {
	const path = `/_matrix/client/v3/rooms/${enc(room.id)}/state/${JUKE_STATE_TYPE}/${JUKE_STATE_KEY}`;
	const { ok, status, data } = await mxJson(c, path);
	if (!ok && status !== 404) throw new Error(data.error || "juke state read failed");
	const s = status === 404 ? null : data;
	if (!s || typeof s !== "object" || s.v !== 1) return jukeEmpty();
	return {
		v: 1,
		current: s.current && typeof s.current === "object" ? s.current : null,
		queue: Array.isArray(s.queue) ? s.queue.slice(0, JUKE_LIMITS.queue) : [],
		history: Array.isArray(s.history) ? s.history.slice(0, JUKE_LIMITS.history) : [],
		seq: Number(s.seq) || 0,
		updatedAt: Number(s.updatedAt) || 0,
	};
}

async function jukeWrite(c, room, state) {
	const path = `/_matrix/client/v3/rooms/${enc(room.id)}/state/${JUKE_STATE_TYPE}/${JUKE_STATE_KEY}`;
	const res = await mx(c, path, { method: "PUT", body: state });
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.error || "juke state write failed");
}

async function jukeWho(c, token) {
	const { ok, data } = await mxJson(c, "/_matrix/client/v3/account/whoami", { token });
	if (!ok || !data.user_id) return "茶友";
	const local = data.user_id.split(":")[0].replace(/^@/, "");
	return local.startsWith("tea") ? "茶友" : local;
}

const jukeUid = () => `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function jukeAdvance(state, next, who) {
	if (state.current) {
		state.history.unshift({ ...state.current, playedAt: Date.now(), by: state.current.requester || "" });
		state.history = state.history.slice(0, JUKE_LIMITS.history);
	}
	state.current = next ? { ...next, uid: next.uid || jukeUid(), startAt: Date.now() + 500, requester: who } : null;
	state.seq += 1;
	state.updatedAt = Date.now();
	return state;
}

async function handleJukeState(c, url, room) {
	const state = await jukeRead(c, room);
	return json(200, { ok: true, ...state, serverNow: Date.now(), room: room.key });
}

async function handleJukeWrite(c, request, url, token, ip, env, room) {
	if (!token) return fail(401, "先入座，再点歌");
	const denied = await rateCheck(env, ip, "juke");
	if (denied) return fail(429, denied);
	let body;
	try {
		body = await request.json();
	} catch {
		return fail(400, "请求格式不对");
	}
	const who = await jukeWho(c, token);
	const state = await jukeRead(c, room);
	const action = clean(body.action, 20);

	if (action === "enqueue" || action === "random") {
		const track = jukeTrack(body.track);
		if (!track) return fail(400, "这首歌不在本站歌单里");
		if (action === "random") track.kind = "rotation";
		if (state.current?.id === track.id || state.queue.some((t) => t.id === track.id)) {
			return json(200, { ok: true, duplicate: true, state });
		}
		state.queue.push({ ...track, uid: jukeUid(), requester: who, addedAt: Date.now() });
		if (state.queue.length > JUKE_LIMITS.queue) state.queue = state.queue.slice(-JUKE_LIMITS.queue);
		state.seq += 1;
		state.updatedAt = Date.now();
	} else if (action === "play") {
		const uid = clean(body.uid, 40);
		const idx = state.queue.findIndex((t) => t.uid === uid);
		if (idx < 0) return fail(404, "队列里没找到这首歌");
		const [next] = state.queue.splice(idx, 1);
		jukeAdvance(state, next, who);
	} else if (action === "next") {
		const next = state.queue.shift() || null;
		jukeAdvance(state, next, who);
	} else if (action === "remove") {
		const uid = clean(body.uid, 40);
		const idx = state.queue.findIndex((t) => t.uid === uid);
		if (idx < 0) return fail(404, "队列里没找到这首歌");
		state.queue.splice(idx, 1);
		state.seq += 1;
		state.updatedAt = Date.now();
	} else {
		return fail(400, "不支持的操作");
	}

	await jukeWrite(c, room, state);
	return json(200, { ok: true, state, serverNow: Date.now() });
}

// ── 入口 ────────────────────────────────────────────────────────────
export async function handleRequest(request, env = {}) {
	const c = cfg(env);
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

	let out;
	try {
		if (path === "/" || path === "/api/health") {
			out = json(200, { ok: true, room: c.room, site: c.siteName, mode: "individual", time: Math.floor(Date.now() / 1000) });
		} else if (path === "/api/enter" && request.method === "POST") {
			out = await handleEnter(c, env, request, ip);
		} else if (path === "/api/waline" && request.method === "POST") {
			out = await handleWaline(c, env, request, ip, url.origin);
		} else if (path === "/api/matrix-login" && request.method === "POST") {
			out = await handleMatrixLogin(c, request, ip);
		} else if (path === "/api/room" && request.method === "GET") {
			out = await handleRoom(c, url.origin, roomOf(c, url), url);
		} else if (path === "/api/pins" && request.method === "GET") {
			out = await handlePins(c, url, url.origin);
		} else if (path === "/api/threads" && request.method === "GET") {
			out = await handleThreads(c, url, url.origin);
		} else if (path === "/api/thread" && request.method === "GET") {
			out = await handleThreadDetail(c, url, url.origin);
		} else if (path === "/api/history" && request.method === "GET") {
			out = await handleHistory(c, url, url.origin, visitorToken || c.bridgeToken);
		} else if (path === "/api/sync" && request.method === "GET") {
			out = await handleSync(c, url, url.origin, visitorToken || c.bridgeToken);
		} else if (path === "/api/media" && request.method === "GET") {
			out = await handleMedia(c, url);
		} else if (path === "/api/recall" && request.method === "POST") {
			out = await handleRecall(c, request, visitorToken, roomOf(c, url));
		} else if (path === "/api/send" && request.method === "POST") {
			const denied = await rateCheck(env, ip, "send");
			out = denied ? fail(429, denied) : await handleSend(c, request, visitorToken, roomOf(c, url));
		} else if (path === "/api/upload" && request.method === "POST") {
			out = await handleUpload(c, request, visitorToken);
		} else if (path === "/api/typing" && request.method === "POST") {
			out = await handleTyping(c, request, visitorToken, roomOf(c, url));
		} else if (path === "/api/reaction" && request.method === "POST") {
			out = await handleReaction(c, request, visitorToken, roomOf(c, url));
		} else if (path === "/api/profile" && (request.method === "GET" || request.method === "POST")) {
			out = await handleProfile(c, request, visitorToken);
		} else if (path === "/api/juke/state" && request.method === "GET") {
			out = await handleJukeState(c, url, roomOf(c, url));
		} else if (path === "/api/juke/action" && request.method === "POST") {
			out = await handleJukeWrite(c, request, url, visitorToken, ip, env, roomOf(c, url));
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
