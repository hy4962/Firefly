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

	if (content.msgtype === "m.image" && content.url) {
		image = `${base}/api/media?u=${enc(content.url)}`;
		text = text || "发了一张图片";
	}

	avatar = avatar.startsWith("mxc://") ? `${base}/api/media?u=${enc(avatar)}` : avatar;

	return { id: ev.event_id, sender, ts: ev.origin_server_ts || Date.now(), nick, site, avatar, text, image };
}

// ── 限流 ────────────────────────────────────────────────────────────
const memory = new Map();

async function rateCheck(env, ip, kind = "send") {
	const now = Date.now();
	const gap = kind === "enter" ? RATE.enterGap : RATE.minGap;

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

	const localpart = randomLocalpart(c.prefix);
	const userId = `@${localpart}:matrix.0dm.cn`;
	const password = crypto.randomUUID().replace(/-/g, "") + "Aa1!";
	const displayname = `${nick} · ${c.siteName}`;

	const created = await mxJson(c, `/_synapse/admin/v2/users/${enc(userId)}`, {
		token: c.adminToken,
		method: "PUT",
		body: { password, displayname, admin: false },
	});
	if (!created.ok) throw new Error(`开号失败：${created.data.error || created.status}`);

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

// ── 接口 ────────────────────────────────────────────────────────────
async function handleHistory(c, url, base, token) {
	const room = roomOf(c, url);
	const limit = Math.min(Number(url.searchParams.get("limit") || 50) || 50, LIMITS.history);
	const members = await getMembers(c, room.id);
	const res = await mx(c, `/_matrix/client/v3/rooms/${enc(room.id)}/messages?dir=b&limit=${limit}`, { token });
	const data = await res.json();
	const messages = (data.chunk || [])
		.map((ev) => (ev.type === "m.room.message" ? normalize(ev, members, c, base) : null))
		.filter(Boolean)
		.reverse();
	return json(200, { ok: true, room: { key: room.key, name: room.name, desc: room.desc }, messages, end: data.end || null });
}

async function handleSync(c, url, base, token) {
	const room = roomOf(c, url);
	const since = url.searchParams.get("since") || "";
	const filter = JSON.stringify({
		room: { rooms: [room.id], timeline: { limit: 50 }, state: { lazy_load_members: true } },
	});
	const path = `/_matrix/client/v3/sync?timeout=0&filter=${enc(filter)}` + (since ? `&since=${enc(since)}` : "");
	const res = await mx(c, path, { token });
	const data = await res.json();
	const members = await getMembers(c, room.id);
	const timeline = data.rooms?.join?.[room.id]?.timeline?.events || [];
	const messages = timeline
		.map((ev) => (ev.type === "m.room.message" ? normalize(ev, members, c, base) : null))
		.filter(Boolean);
	return json(200, { ok: true, messages, next: data.next_batch || since || null });
}

async function handleRoom(c, base, room) {
	const [members, active] = await Promise.all([getMembers(c, room.id), getActiveSenders(c, room.id)]);
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
		room: { key: room.key, name: room.name, desc: room.desc, id: room.id },
		members: unique,
		online: unique.filter((m) => m.online).length,
	});
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
	if (!text) return fail(400, "空消息发不出去");

	const txn = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	const res = await mx(c, `/_matrix/client/v3/rooms/${enc(room.id)}/send/m.room.message/${txn}`, {
		token,
		method: "PUT",
		body: { msgtype: "m.text", body: text },
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) return fail(res.status === 403 ? 403 : 502, data.error || "发送失败");
	return json(200, { ok: true, id: data.event_id, ts: Date.now() });
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
			out = await handleRoom(c, url.origin, roomOf(c, url));
		} else if (path === "/api/history" && request.method === "GET") {
			out = await handleHistory(c, url, url.origin, visitorToken || c.bridgeToken);
		} else if (path === "/api/sync" && request.method === "GET") {
			out = await handleSync(c, url, url.origin, visitorToken || c.bridgeToken);
		} else if (path === "/api/media" && request.method === "GET") {
			out = await handleMedia(c, url);
		} else if (path === "/api/send" && request.method === "POST") {
			const denied = await rateCheck(env, ip, "send");
			out = denied ? fail(429, denied) : await handleSend(c, request, visitorToken, roomOf(c, url));
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
