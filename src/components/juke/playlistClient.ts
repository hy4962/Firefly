import { normalizeServerUrl } from "./chatClient";
import type {
	CollectiveFavoritesResponse,
	FavoriteTrackStatusResponse,
	PlaylistDetail,
	PlaylistImportPayload,
	PlaylistSummary,
	PlaylistsResponse,
	PlaylistTrackItem,
	RoomRotation,
	ToggleFavoriteResponse,
	UserFavoritesResponse,
} from "./chatTypes";
import type { ChatMusicTrack } from "./musicTypes";

export const DEFAULT_PLAYLISTOUT_API_URL =
	"https://playlistout-api.lengxiqwq.com";
export const MAX_PLAYLIST_TRACKS = 3000;

interface RawPlaylistOutTrack {
	title?: unknown;
	artist?: unknown;
	album?: unknown;
	id?: unknown;
	isrc?: unknown;
	durationMs?: unknown;
	sourceUrl?: unknown;
	coverUrl?: unknown;
}

interface RawPlaylistOutPlaylist {
	platform?: unknown;
	id?: unknown;
	name?: unknown;
	creator?: unknown;
	coverUrl?: unknown;
	sourceUrl?: unknown;
	tracks?: unknown;
	retrieval?: {
		mode?: unknown;
		message?: unknown;
	};
}

export interface UserPlaylistCandidate {
	id: string;
	name: string;
	coverUrl: string;
	trackCount: number;
	sourceUrl: string;
	platform: string;
}

export interface AmbiguousResolveCandidate {
	id: string;
	kind: "playlist" | "user";
	platform: string;
	title: string;
	subtitle?: string;
	trackCount?: number;
	coverUrl?: string;
}

export type PlaylistOutResolveResult =
	| {
			kind: "playlist";
			payload: PlaylistImportPayload;
			retrievalMessage?: string;
	  }
	| {
			kind: "user";
			platform: string;
			nickname: string;
			playlists: UserPlaylistCandidate[];
	  }
	| {
			kind: "ambiguous";
			query: string;
			candidates: AmbiguousResolveCandidate[];
	  };

const PLATFORM_LABELS: Record<string, string> = {
	qq: "QQ 音乐",
	qqmusic: "QQ 音乐",
	netease: "网易云音乐",
	kugou: "酷狗音乐",
	kuwo: "酷我音乐",
	qishui: "汽水音乐",
	migu: "咪咕音乐",
	applemusic: "Apple Music",
	apple_music: "Apple Music",
	apple: "Apple Music",
	spotify: "Spotify",
	youtubemusic: "YouTube Music",
	youtube_music: "YouTube Music",
	ytmusic: "YouTube Music",
	youtube: "YouTube Music",
	local: "站内",
	collective: "茶室",
};

export function formatPlatformLabel(platform: string): string {
	const key = platform.trim().toLowerCase();
	return PLATFORM_LABELS[key] || (platform ? platform.toUpperCase() : "外链");
}

function normalizePlaylistOutPlaylist(
	raw: RawPlaylistOutPlaylist,
	fallbackInputUrl: string,
): { payload: PlaylistImportPayload; retrievalMessage?: string } {
	const platform =
		typeof raw.platform === "string" && raw.platform.trim()
			? raw.platform.trim().toLowerCase()
			: "external";
	const title =
		typeof raw.name === "string" && raw.name.trim()
			? raw.name.trim().slice(0, 80)
			: "未命名歌单";
	const sourceUrl =
		typeof raw.sourceUrl === "string" && raw.sourceUrl.trim()
			? raw.sourceUrl.trim()
			: fallbackInputUrl.trim();
	const coverUrl =
		typeof raw.coverUrl === "string" && raw.coverUrl.startsWith("https://")
			? raw.coverUrl
			: "";
	const creator =
		typeof raw.creator === "string" ? raw.creator.trim().slice(0, 80) : "";
	const retrievalMode =
		raw.retrieval?.mode === "preview" ? "preview" : ("full" as const);
	const retrievalMessage =
		typeof raw.retrieval?.message === "string" && raw.retrieval.message.trim()
			? raw.retrieval.message.trim()
			: undefined;

	const rawTracks = Array.isArray(raw.tracks)
		? (raw.tracks as RawPlaylistOutTrack[])
		: [];
	const truncatedNotice =
		rawTracks.length > MAX_PLAYLIST_TRACKS
			? `原歌单共 ${rawTracks.length} 首，已保留前 ${MAX_PLAYLIST_TRACKS} 首`
			: undefined;

	const tracks = rawTracks
		.slice(0, MAX_PLAYLIST_TRACKS)
		.map((item) => {
			const trackTitle =
				typeof item.title === "string" ? item.title.trim().slice(0, 120) : "";
			if (!trackTitle) return null;
			const artist =
				(typeof item.artist === "string"
					? item.artist.trim().slice(0, 120)
					: "") || "未知歌手";
			const album =
				typeof item.album === "string" ? item.album.trim().slice(0, 120) : "";
			const sourceTrackId =
				typeof item.id === "string" || typeof item.id === "number"
					? String(item.id).trim().slice(0, 80)
					: "";
			const cover =
				typeof item.coverUrl === "string" &&
				item.coverUrl.startsWith("https://")
					? item.coverUrl
					: "";
			const durationMs =
				typeof item.durationMs === "number" && Number.isFinite(item.durationMs)
					? item.durationMs
					: 0;
			const durationSec =
				durationMs > 0 ? Math.min(7200, Math.round(durationMs / 1000)) : 0;
			const trackSourceUrl =
				typeof item.sourceUrl === "string" &&
				item.sourceUrl.startsWith("https://")
					? item.sourceUrl
					: "";

			return {
				sourcePlatform: platform,
				sourceTrackId,
				isrc: typeof item.isrc === "string" ? item.isrc : undefined,
				title: trackTitle,
				artist,
				album,
				cover,
				durationSec,
				sourceUrl: trackSourceUrl,
			};
		})
		.filter((t): t is NonNullable<typeof t> => Boolean(t));

	if (tracks.length === 0) {
		throw new Error("未能在该链接中解析到任何歌曲，请检查歌单是否公开");
	}

	return {
		payload: {
			title,
			platform,
			sourceUrl,
			coverUrl: coverUrl || tracks.find((t) => t.cover)?.cover || "",
			creator,
			retrievalMode,
			tracks,
		},
		retrievalMessage: retrievalMessage || truncatedNotice,
	};
}

/**
 * Call PlaylistOut public API directly from the browser to parse a playlist link or user profile.
 */
export async function resolvePlaylistFromPlaylistOut(
	apiBaseUrl: string,
	rawInput: string,
	options?: { type?: "playlist" | "user"; platform?: string },
): Promise<PlaylistOutResolveResult> {
	const base = normalizeServerUrl(apiBaseUrl) || DEFAULT_PLAYLISTOUT_API_URL;
	const q = rawInput.trim();
	if (!q) {
		throw new Error("请粘贴歌单链接或分享文本");
	}

	const params = new URLSearchParams({ q });
	if (options?.type) params.set("type", options.type);
	if (options?.platform) params.set("platform", options.platform);

	let resp: Response;
	try {
		resp = await fetch(`${base}/api/v1/resolve?${params.toString()}`, {
			method: "GET",
			signal: AbortSignal.timeout(20000),
		});
	} catch {
		throw new Error("无法连接 Playlist Out 解析服务，请稍后再试");
	}

	const json = (await resp.json().catch(() => null)) as {
		success?: boolean;
		data?: {
			kind?: string;
			platform?: string;
			result?: unknown;
		};
		error?: {
			code?: string;
			message?: string;
			details?: {
				candidates?: AmbiguousResolveCandidate[];
			};
		};
	} | null;

	if (
		resp.status === 409 &&
		json?.error?.code === "AMBIGUOUS_INPUT" &&
		Array.isArray(json.error.details?.candidates) &&
		json.error.details.candidates.length > 0
	) {
		return {
			kind: "ambiguous",
			query: q,
			candidates: json.error.details.candidates,
		};
	}

	if (!resp.ok || !json?.success || !json.data) {
		throw new Error(
			json?.error?.message || `歌单解析失败（${resp.status || "网络错误"}）`,
		);
	}

	if (json.data.kind === "playlist") {
		const normalized = normalizePlaylistOutPlaylist(
			(json.data.result || {}) as RawPlaylistOutPlaylist,
			q,
		);
		return {
			kind: "playlist",
			payload: normalized.payload,
			retrievalMessage: normalized.retrievalMessage,
		};
	}

	if (json.data.kind === "user") {
		const userResult = (json.data.result || {}) as {
			platform?: string;
			nickname?: string;
			playlists?: Array<{
				id?: string;
				name?: string;
				coverUrl?: string;
				trackCount?: number;
				sourceUrl?: string;
			}>;
		};
		const platform =
			(typeof userResult.platform === "string" && userResult.platform) ||
			json.data.platform ||
			"external";
		const playlists = (userResult.playlists ?? [])
			.filter((p) => p && typeof p.sourceUrl === "string" && p.sourceUrl)
			.map((p) => ({
				id: String(p.id || ""),
				name: String(p.name || "未命名歌单"),
				coverUrl:
					typeof p.coverUrl === "string" && p.coverUrl.startsWith("https://")
						? p.coverUrl
						: "",
				trackCount: typeof p.trackCount === "number" ? p.trackCount : 0,
				sourceUrl: String(p.sourceUrl || ""),
				platform,
			}));
		if (playlists.length === 0) {
			throw new Error("该用户主页下没有找到公开歌单");
		}
		return {
			kind: "user",
			platform,
			nickname: String(userResult.nickname || "音乐用户"),
			playlists,
		};
	}

	throw new Error("暂不支持该链接类型的解析结果");
}

/**
 * Fetch a specific playlist by URL/ID directly from PlaylistOut `/api/playlist`.
 */
export async function fetchPlaylistByUrlFromPlaylistOut(
	apiBaseUrl: string,
	sourceUrl: string,
	platform?: string,
): Promise<{ payload: PlaylistImportPayload; retrievalMessage?: string }> {
	const base = normalizeServerUrl(apiBaseUrl) || DEFAULT_PLAYLISTOUT_API_URL;
	const params = new URLSearchParams({ url: sourceUrl });
	if (platform) params.set("platform", platform);

	let resp: Response;
	try {
		resp = await fetch(`${base}/api/playlist?${params.toString()}`, {
			method: "GET",
			signal: AbortSignal.timeout(20000),
		});
	} catch {
		throw new Error("无法连接 Playlist Out 解析服务，请稍后再试");
	}

	const json = (await resp.json().catch(() => null)) as {
		success?: boolean;
		data?: RawPlaylistOutPlaylist;
		error?: { message?: string };
	} | null;

	if (!resp.ok || !json?.success || !json.data) {
		throw new Error(
			json?.error?.message || `歌单拉取失败（${resp.status || "网络错误"}）`,
		);
	}

	return normalizePlaylistOutPlaylist(json.data, sourceUrl);
}

export interface PlaylistAuth {
	kind: "guest" | "waline";
	token: string;
}

function buildAuthHeaders(auth?: PlaylistAuth, hasBody = false): HeadersInit {
	const headers: Record<string, string> = {};
	if (hasBody) {
		headers["Content-Type"] = "application/json";
	}
	if (auth?.token.trim()) {
		headers.Authorization = `Bearer ${auth.token.trim()}`;
		headers["X-Auth-Kind"] = auth.kind;
	}
	return headers;
}

export async function fetchRoomPlaylists(
	chatServerUrl: string,
	roomId: string,
	auth?: PlaylistAuth,
	options?: { includeTracks?: boolean },
): Promise<PlaylistsResponse> {
	const base = normalizeServerUrl(chatServerUrl);
	if (!base) return { featured: [], mine: [], members: [] };
	const includeTracks = Boolean(options?.includeTracks);
	const resp = await fetch(
		`${base}/api/playlists?room=${encodeURIComponent(roomId)}${includeTracks ? "&includeTracks=1" : ""}`,
		{
			method: "GET",
			headers: buildAuthHeaders(auth),
		},
	);
	const json = (await resp.json().catch(() => null)) as {
		ok?: boolean;
		featured?: PlaylistSummary[];
		mine?: PlaylistSummary[];
		members?: PlaylistSummary[];
		details?: Record<string, PlaylistDetail>;
		rotation?: RoomRotation;
		error?: string;
	} | null;
	if (!resp.ok || !json?.ok) {
		if (resp.status === 404) {
			throw new Error("聊天室歌单服务暂时不可用");
		}
		throw new Error(json?.error || "获取歌单列表失败");
	}
	return {
		featured: Array.isArray(json.featured) ? json.featured : [],
		mine: Array.isArray(json.mine) ? json.mine : [],
		members: Array.isArray(json.members) ? json.members : [],
		rotation: json.rotation,
		details:
			json.details && typeof json.details === "object"
				? json.details
				: undefined,
	};
}

export async function saveRoomRotation(
	chatServerUrl: string,
	roomId: string,
	auth: PlaylistAuth,
	rotation: RoomRotation,
): Promise<RoomRotation> {
	const base = normalizeServerUrl(chatServerUrl);
	const response = await fetch(
		`${base}/api/playlists/rotation?room=${encodeURIComponent(roomId)}`,
		{
			method: "POST",
			headers: buildAuthHeaders(auth, true),
			body: JSON.stringify(rotation),
			signal: AbortSignal.timeout(10_000),
		},
	);
	const result = (await response.json().catch(() => null)) as {
		ok?: boolean;
		error?: string;
		rotation?: RoomRotation;
	} | null;
	if (!response.ok || !result?.ok || !result.rotation) {
		throw new Error(result?.error || "保存轮播设置失败，请重试");
	}
	return result.rotation;
}

export async function fetchPlaylistDetail(
	chatServerUrl: string,
	roomId: string,
	playlistId: string,
	auth?: PlaylistAuth,
	filterUser?: string,
	onPartial?: (detail: PlaylistDetail) => void,
): Promise<PlaylistDetail> {
	const base = normalizeServerUrl(chatServerUrl);
	const q = new URLSearchParams({
		room: roomId,
		id: playlistId,
		...(filterUser ? { filterUser } : {}),
	});
	const resp = await fetch(`${base}/api/playlists/detail?${q.toString()}`, {
		method: "GET",
		headers: buildAuthHeaders(auth),
		signal: AbortSignal.timeout(15_000),
	});
	const json = (await resp.json().catch(() => null)) as {
		ok?: boolean;
		playlist?: PlaylistDetail;
		error?: string;
	} | null;
	if (!resp.ok || !json?.ok || !json.playlist) {
		throw new Error(json?.error || "加载歌单详情失败");
	}
	if (playlistId === "pl_collective_favorites" && json.playlist.tracks.length < json.playlist.trackCount) {
		const playlist = json.playlist;
		if (playlist.tracks.length > 0) onPartial?.({ ...playlist, tracks: [...playlist.tracks] });
		const tracks: PlaylistTrackItem[] = [];
		let total = json.playlist.trackCount;
		while (tracks.length < total) {
			const page = await fetchCollectiveFavorites({
				chatServerUrl,
				filterUser,
				offset: tracks.length,
				limit: 200,
			});
			if (!page.ok || (page.items.length === 0 && tracks.length < page.total)) {
				throw new Error(page.error || "加载共享收藏失败，请重试");
			}
			total = page.total;
			for (const track of page.items) {
				tracks.push({
					position: tracks.length + 1,
					sourcePlatform: track.sourcePlatform || track.provider || "qqmusic",
					sourceTrackId: track.sourceId || track.id,
					title: track.title,
					artist: track.artist,
					album: track.album || "",
					cover: track.cover || "",
					durationSec: track.durationSec || 0,
					sourceUrl: track.url || "",
					matchedTrack: track,
					favCount: track.favCount,
					lastFavoritedAt: track.lastFavoritedAt,
					favoritedUsers: track.favoritedUsers,
				});
			}
			if (tracks.length > 0) onPartial?.({ ...playlist, trackCount: total, tracks: [...tracks] });
			if (page.items.length === 0) break;
		}
		json.playlist.tracks = tracks;
		json.playlist.trackCount = total;
	}
	return json.playlist;
}

export async function saveImportedPlaylist(
	chatServerUrl: string,
	roomId: string,
	auth: PlaylistAuth,
	payload: PlaylistImportPayload,
): Promise<{ playlist: PlaylistSummary; updatedExisting: boolean }> {
	const base = normalizeServerUrl(chatServerUrl);
	const resp = await fetch(
		`${base}/api/playlists/import?room=${encodeURIComponent(roomId)}`,
		{
			method: "POST",
			headers: buildAuthHeaders(auth, true),
			body: JSON.stringify(payload),
		},
	);
	const json = (await resp.json().catch(() => null)) as {
		ok?: boolean;
		playlist?: PlaylistSummary;
		updatedExisting?: boolean;
		error?: string;
	} | null;
	if (!resp.ok || !json?.ok || !json.playlist) {
		throw new Error(json?.error || "保存歌单失败");
	}
	return {
		playlist: json.playlist,
		updatedExisting: Boolean(json.updatedExisting),
	};
}

export async function refreshSavedPlaylist(
	chatServerUrl: string,
	roomId: string,
	auth: PlaylistAuth,
	playlistId: string,
	payload: PlaylistImportPayload,
): Promise<PlaylistSummary> {
	const base = normalizeServerUrl(chatServerUrl);
	const resp = await fetch(
		`${base}/api/playlists/refresh?room=${encodeURIComponent(roomId)}`,
		{
			method: "POST",
			headers: buildAuthHeaders(auth, true),
			body: JSON.stringify({ playlistId, playlist: payload }),
		},
	);
	const json = (await resp.json().catch(() => null)) as {
		ok?: boolean;
		playlist?: PlaylistSummary;
		error?: string;
	} | null;
	if (!resp.ok || !json?.ok || !json.playlist) {
		throw new Error(json?.error || "刷新歌单失败");
	}
	return json.playlist;
}

export async function updatePlaylistFlags(
	chatServerUrl: string,
	roomId: string,
	auth: PlaylistAuth,
	playlistId: string,
	flags: { isPublic?: boolean; isFeatured?: boolean; isFallback?: boolean },
): Promise<PlaylistSummary> {
	const base = normalizeServerUrl(chatServerUrl);
	const resp = await fetch(
		`${base}/api/playlists/flags?room=${encodeURIComponent(roomId)}`,
		{
			method: "POST",
			headers: buildAuthHeaders(auth, true),
			body: JSON.stringify({ playlistId, ...flags }),
		},
	);
	const json = (await resp.json().catch(() => null)) as {
		ok?: boolean;
		playlist?: PlaylistSummary;
		error?: string;
	} | null;
	if (!resp.ok || !json?.ok || !json.playlist) {
		throw new Error(json?.error || "更新歌单设置失败");
	}
	return json.playlist;
}

export async function deleteSavedPlaylist(
	chatServerUrl: string,
	roomId: string,
	auth: PlaylistAuth,
	playlistId: string,
): Promise<void> {
	const base = normalizeServerUrl(chatServerUrl);
	const resp = await fetch(
		`${base}/api/playlists/delete?room=${encodeURIComponent(roomId)}`,
		{
			method: "POST",
			headers: buildAuthHeaders(auth, true),
			body: JSON.stringify({ playlistId }),
		},
	);
	const json = (await resp.json().catch(() => null)) as {
		ok?: boolean;
		error?: string;
	} | null;
	if (!resp.ok || !json?.ok) {
		throw new Error(json?.error || "删除歌单失败");
	}
}

/**
 * Convert a stored playlist track into a ChatMusicTrack ready for music:enqueue.
 */
export function toEnqueueableTrack(
	item: PlaylistTrackItem,
	playlistId: string,
): ChatMusicTrack {
	const platform = item.sourcePlatform === "qqmusic" ? "qq" : item.sourcePlatform;
	if (item.sourceTrackId && (platform === "qq" || platform === "netease" || platform === "kugou")) {
		const sourceId = platform === "kugou" ? item.sourceTrackId.toUpperCase() : item.sourceTrackId;
		return {
			id: `${platform}:${sourceId}`,
			provider: platform,
			sourceId,
			sourcePlatform: item.sourcePlatform,
			playlistId,
			position: item.position,
			title: item.title,
			artist: item.artist,
			album: item.album || undefined,
			cover: item.cover,
			durationSec: item.durationSec,
		};
	}
	if (item.matchedTrack?.id) {
		return {
			...item.matchedTrack,
			playlistId,
			position: item.position,
			title: item.title,
			artist: item.artist,
			cover: item.matchedTrack.cover || item.cover,
			durationSec: item.durationSec || item.matchedTrack.durationSec,
		};
	}
	return {
		id: `ext:${playlistId}:${item.position}`,
		provider: "external",
		sourceId: item.sourceTrackId || String(item.position),
		sourcePlatform: item.sourcePlatform,
		playlistId,
		position: item.position,
		title: item.title,
		artist: item.artist,
		album: item.album || undefined,
		cover: item.cover,
		durationSec: item.durationSec,
	};
}

/**
 * 切换歌曲收藏状态（支持已登录账号与临时访客）
 */
export async function toggleFavoriteTrack(params: {
	chatServerUrl: string;
	token?: string;
	authKind?: "waline" | "guest";
	track: ChatMusicTrack;
	userKey?: string;
	userName?: string;
	userAvatar?: string;
}): Promise<ToggleFavoriteResponse> {
	const base = normalizeServerUrl(params.chatServerUrl);
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (params.token?.trim()) {
		headers.Authorization = `Bearer ${params.token.trim()}`;
		if (params.authKind) {
			headers["x-auth-kind"] = params.authKind;
		}
	}
	const resp = await fetch(`${base}/api/music/favorite/toggle`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			track: params.track,
			userKey: params.userKey,
			userName: params.userName,
			userAvatar: params.userAvatar,
		}),
	});
	const json = (await resp
		.json()
		.catch(() => null)) as ToggleFavoriteResponse | null;
	if (!resp.ok || !json?.ok) {
		throw new Error(json?.error || "收藏操作失败");
	}
	return json;
}

/**
 * 查询单曲收藏状态与收藏人数
 */
export async function fetchFavoriteTrackStatus(params: {
	chatServerUrl: string;
	token?: string;
	trackId: string;
	userKey?: string;
}): Promise<FavoriteTrackStatusResponse> {
	const base = normalizeServerUrl(params.chatServerUrl);
	const headers: Record<string, string> = {};
	if (params.token?.trim()) {
		headers.Authorization = `Bearer ${params.token.trim()}`;
	}
	const q = new URLSearchParams({
		trackId: params.trackId,
		...(params.userKey ? { userKey: params.userKey } : {}),
	});
	const resp = await fetch(
		`${base}/api/music/favorite/status?${q.toString()}`,
		{
			headers,
		},
	);
	const json = (await resp
		.json()
		.catch(() => null)) as FavoriteTrackStatusResponse | null;
	return (
		json ?? {
			ok: false,
			isFavorited: false,
			favCount: 0,
			favoritedUsers: [],
		}
	);
}

/**
 * 移出/取消收藏（支持自己取消或管理员全量/定向移出）
 */
export async function removeFavoriteTrack(params: {
	chatServerUrl: string;
	token?: string;
	authKind?: "waline" | "guest";
	trackId: string;
	targetUserKey?: string;
	userKey?: string;
}): Promise<{ ok: boolean; favCount?: number; error?: string }> {
	const base = normalizeServerUrl(params.chatServerUrl);
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (params.token?.trim()) {
		headers.Authorization = `Bearer ${params.token.trim()}`;
		if (params.authKind) {
			headers["x-auth-kind"] = params.authKind;
		}
	}
	const resp = await fetch(`${base}/api/music/favorite/remove`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			trackId: params.trackId,
			targetUserKey: params.targetUserKey,
			userKey: params.userKey,
		}),
	});
	const json = (await resp.json().catch(() => null)) as {
		ok: boolean;
		favCount?: number;
		error?: string;
	} | null;
	if (!resp.ok || !json?.ok) {
		throw new Error(json?.error || "取消收藏失败");
	}
	return json;
}

/**
 * 获取全站「茶室星愿」共同收藏列表与筛选成员
 */
export async function fetchCollectiveFavorites(params: {
	chatServerUrl: string;
	filterUser?: string;
	sort?: "recent" | "count";
	offset?: number;
	limit?: number;
}): Promise<CollectiveFavoritesResponse> {
	const base = normalizeServerUrl(params.chatServerUrl);
	const q = new URLSearchParams();
	if (params.filterUser) q.set("filterUser", params.filterUser);
	if (params.sort) q.set("sort", params.sort);
	if (params.offset !== undefined) q.set("offset", String(params.offset));
	if (params.limit !== undefined) q.set("limit", String(params.limit));

	const resp = await fetch(
		`${base}/api/music/favorites/public?${q.toString()}`,
		{ signal: AbortSignal.timeout(15_000) },
	);
	const json = (await resp
		.json()
		.catch(() => null)) as CollectiveFavoritesResponse | null;
	if (!resp.ok || !json?.ok) {
		throw new Error(json?.error || "加载共享收藏失败");
	}
	return json;
}

/**
 * 获取指定用户的个人收藏列表
 */
export async function fetchUserFavorites(params: {
	chatServerUrl: string;
	userKey: string;
	offset?: number;
	limit?: number;
}): Promise<UserFavoritesResponse> {
	const base = normalizeServerUrl(params.chatServerUrl);
	const q = new URLSearchParams({
		userKey: params.userKey,
		...(params.offset !== undefined ? { offset: String(params.offset) } : {}),
		...(params.limit !== undefined ? { limit: String(params.limit) } : {}),
	});
	const resp = await fetch(`${base}/api/music/favorites/user?${q.toString()}`);
	const json = (await resp
		.json()
		.catch(() => null)) as UserFavoritesResponse | null;
	return json ?? { ok: false, total: 0, offset: 0, limit: 50, items: [] };
}

export interface UserFavoriteKeysResponse {
	ok: boolean;
	trackIds: string[];
	titleArtists: string[];
}

/**
 * 获取当前登录成员所有已收藏的 trackId 与 title:::artist 键集合，用于全站歌曲匹配
 */
export async function fetchUserFavoriteKeys(params: {
	chatServerUrl: string;
	token?: string;
	authKind?: "guest" | "waline";
	userKey?: string;
}): Promise<UserFavoriteKeysResponse> {
	const base = normalizeServerUrl(params.chatServerUrl);
	const q = new URLSearchParams();
	if (params.userKey) q.set("userKey", params.userKey);
	const headers: Record<string, string> = {};
	if (params.token?.trim()) {
		headers.Authorization = `Bearer ${params.token.trim()}`;
		if (params.authKind) {
			headers["x-auth-kind"] = params.authKind;
		}
	}
	const resp = await fetch(
		`${base}/api/music/favorites/user-keys?${q.toString()}`,
		{ headers },
	);
	const json = (await resp
		.json()
		.catch(() => null)) as UserFavoriteKeysResponse | null;
	return json ?? { ok: false, trackIds: [], titleArtists: [] };
}
