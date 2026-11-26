import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeMusicTrack } from "./music/music-input.mjs";
import { MusicManager } from "./music/music-manager.mjs";
import { MusicRegistry } from "./music/registry.mjs";
import { QQMusicProvider } from "./music/qq-music.mjs";
import { KugouMusicProvider, NeteaseMusicProvider, YoutubeMusicProvider } from "./music/catalog-providers.mjs";
import { handleStreamProxyRequest, maintainAudioCache } from "./music/stream-cache.mjs";
import { verifyStreamProxyToken } from "./music/stream-signer.mjs";

const DATA_DIR = process.env.JUKE_DATA_DIR || "/tmp/tea-juke";
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(join(DATA_DIR, "music_cache"), { recursive: true });

const SIGN_SECRET = process.env.MUSIC_SECRET || process.env.BRIDGE_TOKEN || process.env.ADMIN_TOKEN || "tea-juke-local";
// SITE_URL 是博客主站，不是音频网关；流代理必须落在 tea-bridge 的公网入口。
const SERVER_ORIGIN = (
	process.env.JUKE_PUBLIC_ORIGIN ||
	process.env.TEA_PUBLIC_ORIGIN ||
	"https://tea.0dm.cn"
).replace(/\/+$/, "");
const DEFAULT_ALLOW_ORIGINS = [
	"https://www.0dm.cn",
	"https://0dm.cn",
	"https://www.9ll.uk",
	"https://9ll.uk",
	"http://localhost:4321",
	"http://127.0.0.1:4321",
	"http://localhost:4399",
	"http://127.0.0.1:4399",
].join(",");
const allowOrigins = new Set(
	String(process.env.ALLOW_ORIGINS || DEFAULT_ALLOW_ORIGINS)
		.split(",")
		.map((origin) => origin.trim().replace(/\/+$/, ""))
		.filter(Boolean),
);
const YTDLP_PATH = process.env.YTDLP_PATH || "/usr/local/bin/yt-dlp";

function readCyapiKey() {
	if (process.env.CYAPI_KEY) return process.env.CYAPI_KEY;
	try {
		const path = fileURLToPath(new URL("../.cyapi-key", import.meta.url));
		return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
	} catch {
		return "";
	}
}

const cyapiKey = readCyapiKey();

const jsonTimers = new Map();
function loadJson(name, fallback) {
	const path = join(DATA_DIR, name);
	if (!existsSync(path)) return structuredClone(fallback);
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return structuredClone(fallback);
	}
}

function saveJson(name, value) {
	if (jsonTimers.has(name)) clearTimeout(jsonTimers.get(name));
	jsonTimers.set(name, setTimeout(() => {
		jsonTimers.delete(name);
		try {
			writeFileSync(join(DATA_DIR, name), JSON.stringify(value, null, 2), "utf8");
		} catch (error) {
			console.warn("[juke] save", name, error.message);
		}
	}, 250));
}

const matchStore = {
	getKv(key) {
		return matchData.kv?.[key] ?? null;
	},
	setKv(key, value) {
		matchData.kv ||= {};
		matchData.kv[key] = value;
		saveJson("music_matches.json", matchData);
	},
};

const matchData = loadJson("music_matches.json", { kv: {} });
const playlistData = loadJson("juke-playlists.json", { details: {}, rotations: {} });
const favoriteData = loadJson("juke-favorites.json", { tracks: {} });

const providers = [
	new QQMusicProvider(cyapiKey),
	new KugouMusicProvider(cyapiKey),
	new NeteaseMusicProvider(),
	new YoutubeMusicProvider(),
];
const registry = new MusicRegistry(providers, { matchStore });

const clients = new Set();
const managers = new Map();
const usersByToken = new Map();

function roomOf(url, fallback = "chat") {
	// 历史接口的前端用 roomId，其余接口/WSS 用 room；两边都接受，避免读错房间的记录。
	const raw = String(
		url?.searchParams?.get("room") ||
		url?.searchParams?.get("roomId") ||
		fallback ||
		"chat",
	).trim().toLowerCase();
	return /^[a-z0-9_-]{1,48}$/.test(raw) ? raw : "chat";
}

function getManager(roomId) {
	if (!managers.has(roomId)) {
		const manager = new MusicManager({
			roomId,
			dataDir: DATA_DIR,
			musicRegistry: registry,
			signSecret: SIGN_SECRET,
			serverOrigin: SERVER_ORIGIN,
			getListeners: () => [...clients].filter((client) => client.room === roomId && client.isMuted === false).map((client) => client.user?.userKey).filter(Boolean),
			onStateChanged: () => broadcast(roomId, { type: "music:state", ...managerSnapshot(roomId) }),
		});
		managers.set(roomId, manager);
	}
	return managers.get(roomId);
}

function managerSnapshot(roomId) {
	const keys = new Set([...clients].filter((client) => client.room === roomId && client.user?.userKey).map((client) => client.user.userKey));
	return getManager(roomId).getSnapshot(keys);
}

function broadcast(roomId, packet) {
	const text = JSON.stringify({ ...packet, roomId });
	for (const client of clients) {
		if (client.room === roomId && client.readyState === 1) client.send(text);
	}
}

function broadcastPresence(roomId) {
	const members = [...clients]
		.filter((client) => client.room === roomId && client.user)
		.map((client) => ({ ...client.user, isMuted: client.isMuted }));
	const listeningCount = members.filter((member) => !member.isMuted).length;
	broadcast(roomId, {
		type: "presence:update",
		members,
		mentionMembers: members,
		musicAudience: { onlineCount: members.length, listeningCount },
	});
}

function sendState(roomId, client) {
	const packet = JSON.stringify({ type: "music:state", roomId, ...managerSnapshot(roomId) });
	if (client) {
		if (client.readyState === 1) client.send(packet);
	} else {
		for (const item of clients) {
			if (item.room === roomId && item.readyState === 1) item.send(packet);
		}
	}
}

function summary(playlist) {
	const { tracks: _tracks, ...rest } = playlist;
	return rest;
}

function visiblePlaylist(playlist, user) {
	if (!playlist) return false;
	return Boolean(playlist.isPublic || user?.isAdmin || (user && playlist.ownerKey === user.userKey));
}

function rotationFor(roomId) {
	return playlistData.rotations?.[roomId] || { mode: "off" };
}

function rotationTracks(setting) {
	const details = playlistData.details || {};
	if (!setting || setting.mode === "off") return null;
	const ids = setting.mode === "all"
		? Object.keys(details).filter((id) => details[id]?.isPublic && details[id]?.tracks?.length)
		: (setting.playlistIds || (setting.playlistId ? [setting.playlistId] : []));
	const all = setting.mode === "all";
	const tracks = [];
	for (const id of ids) {
		const playlist = details[id];
		if (!playlist?.isPublic || !Array.isArray(playlist.tracks)) continue;
		for (const item of playlist.tracks) {
			const provider = item.sourcePlatform === "qqmusic" ? "qq" : item.sourcePlatform;
			const sourceId = provider === "kugou" ? String(item.sourceTrackId || "").toUpperCase() : item.sourceTrackId;
			if (!sourceId || !["qq", "netease", "kugou", "youtube"].includes(provider)) continue;
			tracks.push(normalizeMusicTrack({
				id: `${provider}:${sourceId}`,
				provider,
				sourceId,
				sourcePlatform: item.sourcePlatform,
				playlistId: id,
				position: item.position,
				title: item.title,
				artist: item.artist,
				album: item.album,
				cover: item.cover,
				durationSec: item.durationSec,
				sourcePlaylistTitle: playlist.title,
				sourcePlaylistId: id,
				sourcePlaylistCover: playlist.coverUrl,
			}));
		}
	}
	return { tracks, all, ids, label: all ? "全部公开歌单 (轮播)" : (details[ids[0]]?.title || "歌单轮播") };
}

function syncRotation(roomId, { start = true } = {}) {
	const setting = rotationFor(roomId);
	const result = rotationTracks(setting);
	const manager = getManager(roomId);
	if (!result) {
		manager.setFallbackPlaylist(null, [], null, { start: false });
	} else {
		manager.setFallbackPlaylist(result.all ? null : result.ids.join(","), result.tracks, result.label, {
			start,
			all: result.all,
			playlistCount: result.ids.length,
		});
	}
	sendState(roomId);
}

const startupRooms = new Set([
	"chat",
	"interconnect",
	"lobby",
	...Object.keys(playlistData.rotations || {}),
]);
for (const roomId of startupRooms) {
	getManager(roomId);
	syncRotation(roomId, { start: false });
}
void maintainAudioCache().catch((error) => console.warn("[juke] cache maintenance", error.message));

function favoriteUsersFor(trackId) {
	const entry = favoriteData.tracks?.[trackId];
	return Object.entries(entry?.users || {}).map(([userKey, user]) => ({
		userKey,
		userName: user.name || "茶友",
		userAvatar: user.avatar || "",
		createdAt: user.createdAt || 0,
	}));
}

function favoriteTrack(trackId) {
	const entry = favoriteData.tracks?.[trackId];
	if (!entry) return null;
	return { ...entry.track, favCount: Object.keys(entry.users || {}).length, lastFavoritedAt: Math.max(0, ...Object.values(entry.users || {}).map((u) => u.createdAt || 0)), favoritedUsers: favoriteUsersFor(trackId) };
}

function requestUser(req, body) {
	const auth = String(req.headers.authorization || "");
	const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
	if (!token) return null;
	const cached = usersByToken.get(token);
	if (cached) return cached;
	const kind = String(req.headers["x-auth-kind"] || "waline");
	return {
		userKey: body?.userKey || `${kind}:${token.slice(0, 12)}`,
		authType: kind === "guest" ? "guest" : "waline",
		name: body?.userName || "茶友",
		avatar: body?.userAvatar || "",
		url: "",
		badge: "茶友",
		badgeType: "tag",
		isAdmin: false,
	};
}

function json(res, status, data) {
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
	res.end(JSON.stringify(data));
}

function text(res, status, value) {
	res.writeHead(status, {
		"Content-Type": "text/plain; charset=utf-8",
		"Cache-Control": "public, max-age=3600",
	});
	res.end(value);
}

function applyJukeCors(req, res) {
	const origin = String(req.headers.origin || "").replace(/\/+$/, "");
	res.setHeader("Vary", "Origin");
	if (allowOrigins.has(origin)) {
		res.setHeader("Access-Control-Allow-Origin", origin);
		res.setHeader("Access-Control-Allow-Credentials", "true");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.setHeader(
			"Access-Control-Allow-Headers",
			"Authorization, Content-Type, X-Auth-Kind, Range",
		);
		res.setHeader(
			"Access-Control-Expose-Headers",
			"Accept-Ranges, Content-Length, Content-Range",
		);
	}
	if (String(req.method || "").toUpperCase() === "OPTIONS") {
		res.writeHead(204);
		res.end();
		return true;
	}
	return false;
}

async function handleSearch(url) {
	const q = String(url.searchParams.get("q") || "").trim();
	const provider = String(url.searchParams.get("provider") || "qq").trim();
	const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
	const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
	if (!q) return { ok: false, error: "请输入歌名或歌手" };
	const known = new Set(providers.map((item) => item.id));
	const result = known.has(provider)
		? await registry.search(q, limit, provider, page)
		: await registry.search(q, limit, "qq", page);
	const tracks = (result.tracks || []).map((track) => normalizeMusicTrack(track));
	return { ok: true, tracks, hasMore: Boolean(result.hasMore), page };
}

function handleHistory(roomId, url) {
	const manager = getManager(roomId);
	return {
		ok: true,
		...manager.getHistoryPage({
			type: String(url.searchParams.get("type") || "all"),
			sort: String(url.searchParams.get("sort") || "recent"),
			requesterKey: String(url.searchParams.get("requesterKey") || ""),
			offset: Number(url.searchParams.get("offset")) || 0,
			limit: Number(url.searchParams.get("limit")) || 100,
		}),
	};
}

function collectiveFavorites(url) {
	const filterUser = String(url.searchParams.get("filterUser") || "");
	const sort = String(url.searchParams.get("sort") || "recent");
	const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
	const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
	let items = Object.keys(favoriteData.tracks || {}).map(favoriteTrack).filter(Boolean);
	if (filterUser) items = items.filter((item) => item.favoritedUsers?.some((user) => user.userKey === filterUser));
	items.sort((a, b) => sort === "count"
		? (b.favCount || 0) - (a.favCount || 0)
		: (b.lastFavoritedAt || 0) - (a.lastFavoritedAt || 0));
	const favoriterMap = new Map();
	for (const item of items) {
		for (const user of item.favoritedUsers || []) {
			favoriterMap.set(user.userKey, { ...user, trackCount: (favoriterMap.get(user.userKey)?.trackCount || 0) + 1 });
		}
	}
	return {
		ok: true,
		total: items.length,
		offset,
		limit,
		items: items.slice(offset, offset + limit),
		favoriters: [...favoriterMap.values()],
	};
}

function handlePlaylists(roomId, url, user, body, method) {
	const details = playlistData.details || (playlistData.details = {});
	if (url.pathname === "/api/playlists" && method === "GET") {
		const all = Object.values(details);
		const result = {
			ok: true,
			featured: all.filter((item) => item.isPublic && item.isFeatured).map(summary),
			mine: all.filter((item) => user && item.ownerKey === user.userKey).map(summary),
			members: all.filter((item) => item.isPublic && (!user || item.ownerKey !== user.userKey)).map(summary),
			rotation: rotationFor(roomId),
		};
		if (url.searchParams.get("includeTracks") === "1") {
			result.details = Object.fromEntries(Object.entries(details).map(([id, item]) => [id, { ...item, tracks: item.tracks || [] }]));
		}
		return result;
	}
	if (url.pathname === "/api/playlists/detail" && method === "GET") {
		const id = String(url.searchParams.get("id") || "");
		if (id === "pl_collective_favorites") {
			const page = collectiveFavorites(new URLSearchParams({ sort: "recent", limit: "1000" }));
			return {
				ok: true,
				playlist: {
					id,
					ownerKey: "system",
					ownerName: "全站茶友",
					title: "全站收藏",
					platform: "collective",
					sourceUrl: "",
					coverUrl: "",
					creator: "全站茶友",
					trackCount: page.total,
					retrievalMode: "full",
					isPublic: true,
					isFeatured: true,
					isFallback: false,
					createdAt: 0,
					updatedAt: Date.now(),
					tracks: page.items.map((item, index) => ({
						position: index + 1,
						sourcePlatform: item.sourcePlatform || item.provider || "qqmusic",
						sourceTrackId: item.sourceId || item.id,
						title: item.title,
						artist: item.artist,
						album: item.album || "",
						cover: item.cover || "",
						durationSec: item.durationSec || 0,
						sourceUrl: item.url || "",
						matchedTrack: item,
						favCount: item.favCount,
						lastFavoritedAt: item.lastFavoritedAt,
						favoritedUsers: item.favoritedUsers,
					})),
					favoriters: page.favoriters,
				},
			};
		}
		const playlist = details[id];
		if (!playlist || !visiblePlaylist(playlist, user)) return { ok: false, error: "歌单不存在或无权访问" };
		return { ok: true, playlist: { ...playlist, tracks: playlist.tracks || [] } };
	}
	if (!user) return { ok: false, code: "AUTH_REQUIRED", error: "先在茶室入座，再管理歌单" };
	if (url.pathname === "/api/playlists/import" && method === "POST") {
		const payload = body?.playlist || body;
		const tracks = Array.isArray(payload?.tracks) ? payload.tracks : [];
		const sourceUrl = String(payload?.sourceUrl || "");
		const existing = Object.values(details).find((item) => item.ownerKey === user.userKey && item.sourceUrl === sourceUrl);
		const id = existing?.id || `pl_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
		const playlist = {
			id,
			ownerKey: user.userKey,
			ownerName: user.name,
			ownerAvatar: user.avatar || "",
			title: String(payload?.title || "未命名歌单").slice(0, 120),
			platform: String(payload?.platform || "qqmusic"),
			sourceUrl,
			coverUrl: String(payload?.coverUrl || ""),
			creator: String(payload?.creator || user.name).slice(0, 120),
			trackCount: tracks.length,
			retrievalMode: payload?.retrievalMode === "preview" ? "preview" : "full",
			isPublic: existing?.isPublic ?? true,
			isFeatured: existing?.isFeatured ?? false,
			isFallback: existing?.isFallback ?? false,
			createdAt: existing?.createdAt || Date.now(),
			updatedAt: Date.now(),
			tracks: tracks.map((item, index) => ({
				position: Number(item.position) || index + 1,
				sourcePlatform: String(item.sourcePlatform || "qqmusic"),
				sourceTrackId: String(item.sourceTrackId || ""),
				title: String(item.title || "未知曲目"),
				artist: String(item.artist || "未知歌手"),
				album: String(item.album || ""),
				cover: String(item.cover || ""),
				durationSec: Number(item.durationSec) || 0,
				sourceUrl: String(item.sourceUrl || ""),
				matchedTrack: null,
			})),
		};
		details[id] = playlist;
		saveJson("juke-playlists.json", playlistData);
		syncRotation(roomId, { start: false });
		broadcast(roomId, { type: "playlists:updated", roomId });
		return { ok: true, playlist: summary(playlist), updatedExisting: Boolean(existing) };
	}
	if (url.pathname === "/api/playlists/refresh" && method === "POST") {
		const id = String(body?.playlistId || "");
		const playlist = details[id];
		if (!playlist || (playlist.ownerKey !== user.userKey && !user.isAdmin)) return { ok: false, error: "无权刷新该歌单" };
		const payload = body?.playlist || {};
		const tracks = Array.isArray(payload.tracks) ? payload.tracks : [];
		playlist.tracks = tracks.map((item, index) => ({
			position: Number(item.position) || index + 1,
			sourcePlatform: String(item.sourcePlatform || "qqmusic"),
			sourceTrackId: String(item.sourceTrackId || ""),
			title: String(item.title || "未知曲目"),
			artist: String(item.artist || "未知歌手"),
			album: String(item.album || ""),
			cover: String(item.cover || ""),
			durationSec: Number(item.durationSec) || 0,
			sourceUrl: String(item.sourceUrl || ""),
			matchedTrack: null,
		}));
		playlist.trackCount = playlist.tracks.length;
		playlist.updatedAt = Date.now();
		saveJson("juke-playlists.json", playlistData);
		syncRotation(roomId, { start: false });
		broadcast(roomId, { type: "playlists:updated", roomId });
		return { ok: true, playlist: summary(playlist) };
	}
	if (url.pathname === "/api/playlists/flags" && method === "POST") {
		const playlist = details[String(body?.playlistId || "")];
		if (!playlist || (playlist.ownerKey !== user.userKey && !user.isAdmin)) return { ok: false, error: "无权修改该歌单" };
		for (const key of ["isPublic", "isFeatured", "isFallback"]) {
			if (typeof body?.[key] === "boolean") playlist[key] = body[key];
		}
		playlist.updatedAt = Date.now();
		saveJson("juke-playlists.json", playlistData);
		syncRotation(roomId, { start: false });
		broadcast(roomId, { type: "playlists:updated", roomId });
		return { ok: true, playlist: summary(playlist) };
	}
	if (url.pathname === "/api/playlists/delete" && method === "POST") {
		const id = String(body?.playlistId || "");
		const playlist = details[id];
		if (!playlist || (playlist.ownerKey !== user.userKey && !user.isAdmin)) return { ok: false, error: "无权删除该歌单" };
		delete details[id];
		saveJson("juke-playlists.json", playlistData);
		syncRotation(roomId, { start: false });
		broadcast(roomId, { type: "playlists:updated", roomId });
		return { ok: true };
	}
	if (url.pathname === "/api/playlists/rotation" && method === "POST") {
		if (!user.isAdmin) return { ok: false, code: "FORBIDDEN", error: "只有站长能修改轮播设置" };
		const mode = String(body?.mode || "off");
		const setting = mode === "playlist"
			? { mode, playlistIds: Array.isArray(body?.playlistIds) ? body.playlistIds.filter((id) => details[id]) : [] }
			: { mode: mode === "all" ? "all" : "off" };
		playlistData.rotations ||= {};
		playlistData.rotations[roomId] = setting;
		saveJson("juke-playlists.json", playlistData);
		syncRotation(roomId);
		return { ok: true, rotation: setting };
	}
	return { ok: false, error: "未知歌单操作" };
}

function handleFavorites(url, user, body, method) {
	const tracks = favoriteData.tracks || (favoriteData.tracks = {});
	if (url.pathname === "/api/music/favorite/toggle" && method === "POST") {
		const track = normalizeMusicTrack(body?.track || {});
		if (!track?.id) return { ok: false, error: "歌曲信息不完整" };
		const userKey = String(body?.userKey || user?.userKey || "anonymous");
		if (!tracks[track.id]) tracks[track.id] = { track, users: {} };
		tracks[track.id].track = track;
		const existed = Boolean(tracks[track.id].users[userKey]);
		if (existed) delete tracks[track.id].users[userKey];
		else tracks[track.id].users[userKey] = {
			name: String(body?.userName || user?.name || "茶友"),
			avatar: String(body?.userAvatar || user?.avatar || ""),
			createdAt: Date.now(),
		};
		if (!Object.keys(tracks[track.id].users).length) delete tracks[track.id];
		saveJson("juke-favorites.json", favoriteData);
		return {
			ok: true,
			favorited: !existed,
			track,
			favCount: favoriteUsersFor(track.id).length,
			favoritedUsers: favoriteUsersFor(track.id),
		};
	}
	if (url.pathname === "/api/music/favorite/status" && method === "GET") {
		const id = String(url.searchParams.get("trackId") || "");
		const userKey = String(url.searchParams.get("userKey") || user?.userKey || "");
		const users = favoriteUsersFor(id);
		return {
			ok: true,
			isFavorited: Boolean(userKey && users.some((item) => item.userKey === userKey)),
			favCount: users.length,
			favoritedUsers: users,
		};
	}
	if (url.pathname === "/api/music/favorite/remove" && method === "POST") {
		const id = String(body?.trackId || "");
		const userKey = String(body?.targetUserKey || body?.userKey || user?.userKey || "");
		if (tracks[id]?.users) delete tracks[id].users[userKey];
		if (tracks[id] && !Object.keys(tracks[id].users).length) delete tracks[id];
		saveJson("juke-favorites.json", favoriteData);
		return { ok: true, favCount: favoriteUsersFor(id).length };
	}
	if (url.pathname === "/api/music/favorites/public" && method === "GET") {
		return collectiveFavorites(url);
	}
	if (url.pathname === "/api/music/favorites/user" && method === "GET") {
		const userKey = String(url.searchParams.get("userKey") || "");
		const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
		const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
		const items = Object.entries(tracks)
			.filter(([, entry]) => entry.users?.[userKey])
			.map(([, entry]) => ({ ...entry.track, favoritedAt: entry.users[userKey].createdAt || 0 }))
			.sort((a, b) => b.favoritedAt - a.favoritedAt);
		return { ok: true, total: items.length, offset, limit, items: items.slice(offset, offset + limit) };
	}
	if (url.pathname === "/api/music/favorites/user-keys" && method === "GET") {
		const userKey = String(url.searchParams.get("userKey") || user?.userKey || "");
		const trackIds = [];
		const titleArtists = [];
		for (const [id, entry] of Object.entries(tracks)) {
			if (!entry.users?.[userKey]) continue;
			trackIds.push(id);
			const title = String(entry.track?.title || "").toLowerCase().replace(/\s+/g, " ").trim();
			const artist = String(entry.track?.artist || "").toLowerCase().replace(/\s+/g, " ").trim();
			titleArtists.push(`${title}:::${artist}`);
		}
		return { ok: true, trackIds, titleArtists };
	}
	return { ok: false, error: "未知收藏操作" };
}

export async function handleJukeHttp(req, res, url, body) {
	const method = String(req.method || "GET").toUpperCase();
	try {
		if (applyJukeCors(req, res)) return;
		if (url.pathname === "/api/music/search") return json(res, 200, await handleSearch(url));
		if (url.pathname === "/api/music/lyric") {
			const provider = String(url.searchParams.get("provider") || "qq").trim();
			const id = String(url.searchParams.get("id") || "").trim();
			if (!id) return text(res, 400, "");
			const lyric = await registry.getLyric(provider, id);
			return text(res, 200, typeof lyric === "string" ? lyric : "");
		}
		if (url.pathname === "/api/juke/health") {
			return json(res, 200, {
				ok: true,
				rooms: [...managers.keys()],
				providers: {
					youtubeNative: existsSync(YTDLP_PATH),
				},
			});
		}
		if (url.pathname.startsWith("/api/music/stream")) {
			const token = String(url.searchParams.get("token") || "");
			const verified = verifyStreamProxyToken(token, SIGN_SECRET);
			if (!verified) return json(res, 403, { ok: false, error: "音源签名无效或已过期" });
			await handleStreamProxyRequest(req, res, new URL(verified.url), verified.referer, verified.mimeType, verified.trackKey);
			return;
		}
		const roomId = roomOf(url, "chat");
		if (url.pathname === "/api/music/history") return json(res, 200, handleHistory(roomId, url));
		const parsedBody = body?.length ? JSON.parse(Buffer.from(body).toString("utf8")) : {};
		const user = requestUser(req, parsedBody);
		if (url.pathname.startsWith("/api/playlists")) {
			return json(res, 200, handlePlaylists(roomId, url, user, parsedBody, method));
		}
		if (url.pathname.startsWith("/api/music/favorite")) {
			return json(res, 200, handleFavorites(url, user, parsedBody, method));
		}
		return json(res, 404, { ok: false, error: "未找到点歌台接口" });
	} catch (error) {
		console.warn("[juke http]", url.pathname, error.message);
		return json(res, 500, { ok: false, error: error.message || "点歌台服务异常" });
	}
}

function actorOf(client) {
	return client.user || { userKey: "anonymous", name: "匿名茶友", avatar: "", authType: "guest", isAdmin: false };
}

function reply(client, packet) {
	if (client.readyState === 1) client.sendJson(packet);
}

function roomAudience(roomId) {
	const roomClients = [...clients].filter((client) => client.room === roomId && client.readyState === 1);
	const listening = new Set(roomClients.filter((client) => client.isMuted === false && client.user?.userKey).map((client) => client.user.userKey));
	return { onlineCount: roomClients.length, listeningCount: listening.size };
}

async function enqueuePacket(client, packet) {
	const roomId = client.room;
	const manager = getManager(roomId);
	const requestId = String(packet.requestId || "");
	const done = (result) => reply(client, {
		type: "music:request_result",
		roomId,
		requestId,
		ok: Boolean(result.ok),
		code: result.code,
		error: result.error,
		position: result.position,
		playImmediately: result.playImmediately,
	});
	if (!client.user) return done({ ok: false, code: "AUTH_REQUIRED", error: "先在茶室入座，再来点歌" });
	if (client.pendingSongRequest) return done({ ok: false, error: "上一首还在处理，请稍候" });
	client.pendingSongRequest = true;
	try {
		let track = null;
		if (packet.randomPlaylistId) {
			const playlist = playlistData.details?.[String(packet.randomPlaylistId)];
			const pool = rotationTracks({ mode: "playlist", playlistIds: [String(packet.randomPlaylistId)] }).tracks;
			if (!playlist?.isPublic || !pool.length) return done({ ok: false, error: "这个歌单暂时没有可点的歌曲" });
			track = pool[Math.floor(Math.random() * pool.length)];
		} else if (packet.track) {
			track = normalizeMusicTrack(packet.track);
		}
		if (!track?.id) return done({ ok: false, error: "歌曲信息不完整" });
		if (track.provider === "youtube" && !existsSync(YTDLP_PATH)) {
			const query = [track.title, track.artist].filter(Boolean).join(" ");
			for (const provider of ["qq", "kugou"]) {
				try {
					let timer;
					const fallback = await Promise.race([
						registry.search(query, 5, provider, 1),
						new Promise((resolve) => {
							timer = setTimeout(() => resolve({ tracks: [] }), 4_000);
						}),
					]).finally(() => clearTimeout(timer));
					const candidate = fallback.tracks?.[0];
					if (candidate) {
						track = normalizeMusicTrack(candidate);
						break;
					}
				} catch {
					// Try the next playable catalog.
				}
			}
		}
		let timeoutId;
		const result = await Promise.race([
			manager.enqueueTrack(track, actorOf(client)),
			new Promise((resolve) => {
				timeoutId = setTimeout(() => resolve({
					ok: false,
					code: "SOURCE_TEMPORARY",
					error: "音源解析超时，请换一个音源或稍后再试",
				}), 50_000);
			}),
		]).finally(() => clearTimeout(timeoutId));
		done(result);
		if (result.ok) broadcast(roomId, { type: "chat:notice", message: `${actorOf(client).name} 点播了《${track.title}》` });
	} catch (error) {
		console.warn("[juke enqueue]", error.message);
		done({ ok: false, error: "点歌失败，请稍后重试" });
	} finally {
		client.pendingSongRequest = false;
	}
}

async function handleMusicPacket(client, packet) {
	const roomId = client.room;
	const manager = getManager(roomId);
	const audience = roomAudience(roomId);
	const actor = actorOf(client);
	switch (packet.type) {
		case "music:enqueue":
			await enqueuePacket(client, packet);
			return;
		case "music:skip":
			if (packet.playUid && packet.playUid !== manager.current?.uid) return;
			manager.skip(actor, audience.onlineCount, audience.listeningCount);
			return;
		case "music:vote_skip":
			if (packet.playUid && packet.playUid !== manager.current?.uid) return;
			manager.voteSkip(actor, audience.onlineCount, audience.listeningCount);
			return;
		case "music:remove":
			manager.removeQueue(String(packet.uid || ""), actor);
			return;
		case "music:play_queued":
			manager.playQueued(String(packet.uid || ""), actor, audience.listeningCount, packet.playUid);
			return;
		case "music:report_duration":
			manager.reportDuration(String(packet.playUid || ""), Number(packet.durationSec) || 0);
			return;
		case "music:ended":
			if (client.isMuted === false) manager.ended(String(packet.playUid || ""));
			return;
		case "music:report_error":
			await manager.reportError(String(packet.playUid || ""), actor.userKey, Number(packet.revision) || 0);
			return;
		case "music:rotation_shuffle":
			manager.shuffleRotation(actor);
			return;
		case "music:rotation_remove": {
			const result = manager.removeRotation({ entryId: String(packet.entryId || "") }, actor);
			reply(client, { type: "music:rotation_result", roomId, ok: Boolean(result?.ok), error: result?.error, entryId: String(packet.entryId || "") });
			return;
		}
		case "music:play_rotation": {
			const entryId = String(packet.entryId || "");
			const result = await manager.playRotationTrack(entryId, actor, audience.listeningCount);
			reply(client, {
				type: "music:rotation_result",
				roomId,
				entryId,
				ok: Boolean(result?.ok),
				code: result?.code,
				error: result?.error,
				offer: result?.offer,
			});
			return;
		}
		case "music:state_request":
			sendState(roomId, client);
			return;
		default:
			return;
	}
}

export function handleJukeSocket(client, url) {
	client.room = roomOf(url, "chat");
	clients.add(client);
	client.on("message", async (text) => {
		let packet;
		try {
			packet = JSON.parse(text);
		} catch {
			return;
		}
		if (!packet || typeof packet.type !== "string") return;
		if (packet.type === "auth") {
			client.user = packet.user && packet.user.userKey
				? { ...packet.user, isAdmin: Boolean(packet.user.isAdmin) }
				: null;
			const token = String(url.searchParams.get("token") || "");
			if (token && client.user) usersByToken.set(token, client.user);
			client.isMuted = false;
			sendState(client.room, client);
			broadcastPresence(client.room);
			return;
		}
		if (packet.type === "clock:sync") {
			reply(client, { type: "pong", id: packet.id, serverTime: Date.now() });
			return;
		}
		if (packet.type === "presence:audio" || packet.type === "music:listen") {
			client.isMuted = packet.type === "music:listen" ? !Boolean(packet.listening) : Boolean(packet.isMuted);
			broadcastPresence(client.room);
			return;
		}
		if (packet.type.startsWith("music:")) {
			try {
				await handleMusicPacket(client, packet);
			} catch (error) {
				console.warn("[juke ws]", packet.type, error.message);
			}
		}
	});
	client.on("close", () => {
		clients.delete(client);
		broadcastPresence(client.room);
	});
	sendState(client.room, client);
	broadcastPresence(client.room);
}
