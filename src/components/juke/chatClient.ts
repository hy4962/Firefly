import { interconnectSites as defaultInterconnectSites } from "@/config/interconnectConfig";
import type { InterconnectSite } from "@/types/chatConfig";
import { extractCleanHostname } from "@/utils/interconnect";
import type {
	ChatActiveThreadItem,
	ChatCustomBadge,
	ChatMentionCandidate,
	ChatMentionEntity,
	ChatMessageRecord,
	ChatMessageSourceResponse,
	ChatOnlineMember,
	ChatReadReceipt,
	ChatSessionUser,
	ChatUserDetailProfile,
	ChatUserTracksPage,
	FetchMusicHistoryParams,
	FetchMusicHistoryResponse,
	RoomMusicState,
	RotationOffer,
} from "./chatTypes";
import type { ChatMusicTrack } from "./musicTypes";

export { getDiceBearGlassAvatar } from "@/utils/avatar-utils";
export {
	checkEmailDeliverability,
	checkGuestRegistrationEmail,
	type EmailDeliverabilityResult,
	isTrustedFastPassDomain,
	isUndeliverableEmail,
	verifyEmailRemote,
} from "../../utils/email-validation";

export const GUEST_TOKEN_STORAGE_KEY = "fireflyChatGuestToken";
export const GUEST_EMAIL_STORAGE_KEY = "fireflyChatGuestMeta";
export const WALINE_USER_META_KEY = "WALINE_USER_META";
export const CHAT_SESSION_USER_KEY = "fireflyChatSessionUser";

export interface StoredGuestMeta {
	nickname: string;
	email: string;
	url: string;
}

export interface RoomInitPacket {
	type: "room:init";
	interconnected?: boolean;
	roomId: string;
	self: ChatSessionUser | null;
	mergedGuestHistory?: boolean;
	messages: ChatMessageRecord[];
	activeThreads?: ChatActiveThreadItem[];
	oldestHistoryId?: number;
	hasMoreHistory?: boolean;
	lastReadAt?: number;
	unreadCount?: number;
	unreadUserCount?: number;
	pinnedUids?: string[];
	pinnedDetails?: ChatMessageRecord[];
	topic?: string;
	roomAvatar?: string;
	roomAvatars?: Record<string, string>;
	readReceipts?: Record<string, ChatReadReceipt[]>;
	members: ChatOnlineMember[];
	observers?: ChatOnlineMember[];
	mentionMembers?: ChatMentionCandidate[];
	observerCount: number;
	totalCount: number;
	totalChatters?: number;
	music: RoomMusicState;
	musicAudience?: MusicAudience;
}

export interface MusicAudience {
	onlineCount: number;
	listeningCount: number;
	skipAudienceCount?: number;
}

export type ServerPacket =
	| RoomInitPacket
	| { type: "pong"; serverTime: number; id?: number }
	| {
			type: "auth:result";
			user: ChatSessionUser | null;
			mergedGuestHistory?: boolean;
			roomId?: string;
			lastReadAt?: number;
			unreadCount?: number;
			unreadUserCount?: number;
			readReceipts?: Record<string, ChatReadReceipt[]>;
	  }
	| {
			type: "member:merged";
			roomId: string;
			fromUserKeys: string[];
			user: ChatSessionUser;
	  }
	| {
			type: "member:badges_updated";
			roomId: string;
			userKey: string;
			customBadges: ChatCustomBadge[];
	  }
	| {
			type: "presence:update";
			roomId: string;
			members: ChatOnlineMember[];
			observers?: ChatOnlineMember[];
			mentionMembers?: ChatMentionCandidate[];
			observerCount: number;
			totalCount: number;
			totalChatters?: number;
			musicAudience?: MusicAudience;
	  }
	| {
			type: "chat:message" | "chat:updated";
			roomId: string;
			message: ChatMessageRecord;
	  }
	| {
			type: "chat:history_batch";
			roomId: string;
			messages: ChatMessageRecord[];
			oldestHistoryId?: number;
			hasMoreHistory: boolean;
			jumpTarget?: boolean;
	  }
	| { type: "chat:deleted"; roomId: string; msgUid: string; recalled?: boolean }
	| {
			type: "chat:recalled";
			roomId: string;
			msgUid: string;
			notice?: ChatMessageRecord;
	  }
	| {
			type: "chat:reaction_updated";
			roomId: string;
			msgUid: string;
			key: string;
			reactions: Record<string, string[]>;
	  }
	| {
			type: "chat:edited";
			roomId: string;
			msgUid: string;
			content: string;
			mentionKeys?: string[];
			mentionEntities?: ChatMentionEntity[];
			isEdited?: boolean;
			editedAt?: number;
	  }
	| {
			type: "chat:pinned_update";
			roomId: string;
			pinnedUids: string[];
			pinnedDetails?: ChatMessageRecord[];
	  }
	| { type: "chat:topic_update"; roomId: string; topic: string }
	| { type: "chat:room_avatar_update"; roomId: string; avatar: string }
	| {
			type: "chat:typing";
			roomId: string;
			userKey?: string;
			userName?: string;
			users?: string[];
			typing?: boolean;
	  }
	| {
			type: "chat:poll_updated";
			roomId: string;
			msgUid: string;
			votes: Record<string, string[]>;
			ended?: boolean;
	  }
	| {
			type: "chat:receipt_update";
			roomId: string;
			reader: ChatReadReceipt;
	  }
	| ({ type: "music:state"; roomId: string } & RoomMusicState)
	| {
			type: "music:rotation_result";
			roomId: string;
			requestId: string;
			ok: boolean;
			code?: string;
			error?: string;
			offer?: RotationOffer;
	  }
	| { type: "music:request_wait"; roomId: string; requestId: string; waiting: boolean }
	| {
			type: "music:request_result";
			roomId: string;
			requestId: string;
			ok: boolean;
			error?: string;
			code?: string;
			position?: number;
			playImmediately?: boolean;
			offer?: RotationOffer;
			randomTrack?: { title: string; artist: string; replacement?: { title: string } };
	  }
	| { type: "playlist:updated" | "playlists:updated"; roomId: string }
	| {
			type: "error";
			code?: string;
			authKind?: "waline" | "guest";
			message: string;
	  };

export function normalizeServerUrl(raw?: string): string {
	return (raw || "").trim().replace(/\/+$/, "");
}

export function formatClockSeconds(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

const CHAT_WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function formatChatDividerDate(
	ts: number,
	nowMs: number = Date.now(),
): string {
	if (!ts || !Number.isFinite(ts)) return "";
	const d = new Date(ts);
	const now = new Date(nowMs);

	const todayStart = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
	).getTime();
	const targetDayStart = new Date(
		d.getFullYear(),
		d.getMonth(),
		d.getDate(),
	).getTime();
	const diffDays = Math.round((todayStart - targetDayStart) / 86_400_000);

	const month = d.getMonth() + 1;
	const day = d.getDate();
	const weekday = CHAT_WEEKDAYS[d.getDay()] ?? "";

	if (diffDays === 0) {
		return `今天 ${month}月${day}日 ${weekday}`;
	}
	if (diffDays === 1) {
		return `昨天 ${month}月${day}日 ${weekday}`;
	}
	if (diffDays === 2) {
		return `前天 ${month}月${day}日 ${weekday}`;
	}
	if (d.getFullYear() === now.getFullYear()) {
		return `${month}月${day}日 ${weekday}`;
	}
	return `${d.getFullYear()}年${month}月${day}日`;
}

export function formatChatMessageTime(
	ts: number,
	nowMs: number = Date.now(),
): string {
	if (!ts || !Number.isFinite(ts)) return "";
	const d = new Date(ts);
	const now = new Date(nowMs);

	const todayStart = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
	).getTime();
	const targetDayStart = new Date(
		d.getFullYear(),
		d.getMonth(),
		d.getDate(),
	).getTime();
	const diffDays = Math.round((todayStart - targetDayStart) / 86_400_000);

	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	const timePart = `${hh}:${mm}`;

	if (diffDays === 0) {
		return `今天 ${timePart}`;
	}
	if (diffDays === 1) {
		return `昨天 ${timePart}`;
	}
	if (diffDays === 2) {
		return `前天 ${timePart}`;
	}
	if (d.getFullYear() === now.getFullYear()) {
		const month = String(d.getMonth() + 1).padStart(2, "0");
		const day = String(d.getDate()).padStart(2, "0");
		return `${month}-${day} ${timePart}`;
	}
	const y = d.getFullYear();
	const month = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${month}-${day} ${timePart}`;
}

export function formatChatFullDateTime(ts: number): string {
	if (!ts || !Number.isFinite(ts)) return "";
	const d = new Date(ts);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	const ss = String(d.getSeconds()).padStart(2, "0");
	const weekday = CHAT_WEEKDAYS[d.getDay()] ?? "";
	return `${y}-${m}-${day} ${hh}:${mm}:${ss} (${weekday})`;
}

const VISITOR_ID_STORAGE_KEY = "lengxi_chat_visitor_id";

export function getOrCreateVisitorId(): string {
	if (typeof localStorage === "undefined") return "";
	try {
		let vid = localStorage.getItem(VISITOR_ID_STORAGE_KEY)?.trim() || "";
		if (!vid) {
			vid = `v_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
			localStorage.setItem(VISITOR_ID_STORAGE_KEY, vid);
		}
		return vid;
	} catch {
		return "";
	}
}

export function buildWsUrl(
	serverUrl: string,
	roomId: string,
	auth?: { kind: "waline" | "guest"; token: string } | null,
	lastReadAt = 0,
	isFocused = true,
): string {
	const cleanBase = normalizeServerUrl(serverUrl);
	const wsBase = cleanBase
		.replace(/^https:\/\//i, "wss://")
		.replace(/^http:\/\//i, "ws://");
	const params = new URLSearchParams({ room: roomId });
	params.set("focused", isFocused ? "1" : "0");
	if (auth?.token) {
		params.set("authKind", auth.kind);
		params.set("token", auth.token);
	}
	const vid = getOrCreateVisitorId();
	if (vid) params.set("visitorId", vid);
	if (lastReadAt > 0) {
		params.set("lastReadAt", String(Math.floor(lastReadAt)));
	}
	return `${wsBase}/ws?${params.toString()}`;
}

export function isMobileLikeBrowser(): boolean {
	if (typeof navigator === "undefined") return false;
	const ua = navigator.userAgent || "";
	return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|MicroMessenger|QQ\//i.test(
		ua,
	);
}

function dispatchWalineUserStorageEvent(
	newValue: string | null,
	oldValue: string | null,
): void {
	if (typeof window === "undefined" || typeof StorageEvent === "undefined") {
		return;
	}
	try {
		window.dispatchEvent(
			new StorageEvent("storage", {
				key: "WALINE_USER",
				newValue,
				oldValue,
				storageArea: localStorage,
			}),
		);
	} catch {
		// Ignore synthetic StorageEvent errors
	}
}

export function readStoredWalineToken(): string {
	if (typeof localStorage !== "undefined") {
		try {
			const rawUser = localStorage.getItem("WALINE_USER");
			if (rawUser) {
				const parsed = JSON.parse(rawUser) as { token?: unknown };
				if (typeof parsed.token === "string" && parsed.token.trim()) {
					return parsed.token.trim();
				}
			}
			const adminToken = localStorage.getItem("WALINE_ADMIN_TOKEN");
			if (adminToken?.trim()) return adminToken.trim();
			const token = localStorage.getItem("TOKEN");
			if (token?.trim()) return token.trim();
		} catch {
			// Ignore invalid localStorage
		}
	}
	if (typeof window !== "undefined") {
		try {
			const urlToken = new URLSearchParams(window.location.search)
				.get("token")
				?.trim();
			if (urlToken) return urlToken;
		} catch {
			// Ignore invalid URL
		}
	}
	return "";
}

export function resolveWorkingAvatarUrl(
	rawAvatar?: string,
	email?: string,
	mailMd5?: string,
): string {
	let avatar = (rawAvatar || "").trim();
	if (avatar.includes("gravatar.com")) {
		avatar = avatar.replace(
			/https?:\/\/[a-zA-Z0-9._-]*gravatar\.com/i,
			"https://cravatar.cn",
		);
	}
	if (avatar) return avatar;

	const cleanEmail = (email || "").trim().toLowerCase();
	if (cleanEmail) {
		const qqMatch = cleanEmail.match(/^([1-9]\d{4,10})@qq\.com$/);
		if (qqMatch) {
			return `https://q1.qlogo.cn/g?b=qq&nk=${qqMatch[1]}&s=100`;
		}
	}
	if (mailMd5 && /^[a-f0-9]{32}$/i.test(mailMd5.trim())) {
		return "";
	}
	return "";
}

export function persistWalineAuth(userData: {
	token: string;
	display_name?: string;
	email?: string;
	type?: string;
	avatar?: string;
	url?: string;
	label?: string;
	objectId?: string | number;
	mailMd5?: string;
}): void {
	if (typeof localStorage === "undefined") return;
	try {
		const prevValue = localStorage.getItem("WALINE_USER");
		let prevUser: Record<string, unknown> = {};
		if (prevValue) {
			try {
				prevUser = JSON.parse(prevValue);
			} catch {
				prevUser = {};
			}
		}
		const existingChatAvatar = readStoredChatUser()?.avatar;

		const normalizedAvatar = resolveWorkingAvatarUrl(
			userData.avatar || existingChatAvatar || (typeof prevUser.avatar === "string" ? prevUser.avatar : ""),
			userData.email || (typeof prevUser.email === "string" ? prevUser.email : ""),
			userData.mailMd5 || (typeof prevUser.mailMd5 === "string" ? prevUser.mailMd5 : ""),
		);

		const normalizedData = {
			...prevUser,
			...userData,
			avatar: normalizedAvatar,
		};

		const serialized = JSON.stringify(normalizedData);
		localStorage.setItem("WALINE_USER", serialized);
		localStorage.setItem("TOKEN", userData.token);
		if (userData.type === "administrator" || userData.type === "admin") {
			localStorage.setItem("WALINE_ADMIN_TOKEN", userData.token);
		} else {
			localStorage.removeItem("WALINE_ADMIN_TOKEN");
		}
		if (userData.display_name || userData.email || userData.url) {
			persistWalineCommentMeta({
				nickname: userData.display_name || "",
				email: userData.email || "",
				url: userData.url || "",
			});
		}
		dispatchWalineUserStorageEvent(serialized, prevValue);
	} catch {
		// Ignore storage limits
	}
}

export function syncChatUserToWalineStorage(user: ChatSessionUser): void {
	if (typeof localStorage === "undefined" || !user) return;
	try {
		const rawWaline = localStorage.getItem("WALINE_USER");
		let prevUser: Record<string, unknown> = {};
		if (rawWaline) {
			try {
				prevUser = JSON.parse(rawWaline);
			} catch {
				prevUser = {};
			}
		}
		const token = readStoredWalineToken() || (typeof prevUser.token === "string" ? prevUser.token : "");
		if (!token && user.authType !== "waline") return;

		const normalizedAvatar = resolveWorkingAvatarUrl(
			user.avatar || (typeof prevUser.avatar === "string" ? prevUser.avatar : ""),
			user.email || (typeof prevUser.email === "string" ? prevUser.email : ""),
			typeof prevUser.mailMd5 === "string" ? prevUser.mailMd5 : "",
		);

		const updatedWalineUser = {
			...prevUser,
			token: token || prevUser.token,
			display_name: user.name || prevUser.display_name || "",
			avatar: normalizedAvatar,
			url: user.url !== undefined ? user.url : (prevUser.url || ""),
			type: user.isAdmin ? "administrator" : (prevUser.type || "guest"),
		};

		const serialized = JSON.stringify(updatedWalineUser);
		if (serialized !== rawWaline) {
			localStorage.setItem("WALINE_USER", serialized);
			dispatchWalineUserStorageEvent(serialized, rawWaline);
		}
	} catch {
		// Ignore
	}
}

export function clearWalineAuth(): void {
	if (typeof localStorage === "undefined") return;
	try {
		const prevValue = localStorage.getItem("WALINE_USER");
		localStorage.removeItem("WALINE_USER");
		localStorage.removeItem("WALINE_ADMIN_TOKEN");
		localStorage.removeItem("TOKEN");
		const storedUser = readStoredChatUser();
		if (storedUser?.authType === "waline") {
			clearStoredChatUser();
		}
		dispatchWalineUserStorageEvent(null, prevValue);
	} catch {
		// Ignore
	}
}

export async function consumeUrlWalineToken(
	walineServerUrl: string,
): Promise<{ token: string } | null> {
	if (typeof window === "undefined") return null;
	let urlToken = "";
	try {
		const currentUrl = new URL(window.location.href);
		urlToken = currentUrl.searchParams.get("token")?.trim() || "";
		if (!urlToken) return null;
		currentUrl.searchParams.delete("token");
		window.history.replaceState(
			null,
			"",
			currentUrl.pathname +
				(currentUrl.searchParams.toString()
					? `?${currentUrl.searchParams.toString()}`
					: "") +
				currentUrl.hash,
		);
	} catch {
		return null;
	}

	try {
		localStorage.setItem("TOKEN", urlToken);
	} catch {
		// Ignore storage limits
	}

	const base = normalizeServerUrl(walineServerUrl);
	if (!base) {
		return { token: urlToken };
	}

	try {
		const resp = await fetch(`${base}/api/token`, {
			headers: { Authorization: `Bearer ${urlToken}` },
		});
		const payload = (await resp.json().catch(() => null)) as {
			errno?: number;
			data?: {
				display_name?: string;
				email?: string;
				type?: string;
				avatar?: string;
				url?: string;
				label?: string;
				objectId?: string | number;
				mailMd5?: string;
			};
		} | null;

		if (
			resp.ok &&
			payload &&
			payload.errno === 0 &&
			payload.data &&
			payload.data.objectId !== undefined
		) {
			persistWalineAuth({
				token: urlToken,
				display_name: payload.data.display_name,
				email: payload.data.email,
				type: payload.data.type,
				avatar: payload.data.avatar,
				url: payload.data.url,
				label: payload.data.label,
				objectId: payload.data.objectId,
				mailMd5: payload.data.mailMd5,
			});
			return { token: urlToken };
		}

		if (resp.status === 401 || (payload && payload.errno !== 0)) {
			clearWalineAuth();
			return null;
		}
	} catch {
		// Keep TOKEN so WS handshake or later fetch can still use it on transient network errors
	}

	return { token: urlToken };
}

export function readStoredGuestToken(): string {
	if (typeof localStorage === "undefined") return "";
	try {
		return localStorage.getItem(GUEST_TOKEN_STORAGE_KEY)?.trim() || "";
	} catch {
		return "";
	}
}

export function readWalineCommentMeta(): StoredGuestMeta {
	if (typeof localStorage === "undefined") {
		return { nickname: "", email: "", url: "" };
	}
	try {
		const raw = localStorage.getItem(WALINE_USER_META_KEY);
		if (!raw) return { nickname: "", email: "", url: "" };
		const parsed = JSON.parse(raw) as {
			nick?: unknown;
			mail?: unknown;
			link?: unknown;
		};
		return {
			nickname: typeof parsed.nick === "string" ? parsed.nick.trim() : "",
			email: typeof parsed.mail === "string" ? parsed.mail.trim() : "",
			url: typeof parsed.link === "string" ? parsed.link.trim() : "",
		};
	} catch {
		return { nickname: "", email: "", url: "" };
	}
}

export function persistWalineCommentMeta(meta: StoredGuestMeta): void {
	if (typeof localStorage === "undefined") return;
	try {
		const existing = readWalineCommentMeta();
		localStorage.setItem(
			WALINE_USER_META_KEY,
			JSON.stringify({
				nick: meta.nickname.trim() || existing.nickname,
				mail: meta.email.trim() || existing.email,
				link: meta.url.trim() || existing.url,
			}),
		);
	} catch {
		// Ignore
	}
}

export function persistGuestAuth(
	token: string,
	meta: StoredGuestMeta,
	options?: { skipCommentMeta?: boolean },
): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, token);
		localStorage.setItem(GUEST_EMAIL_STORAGE_KEY, JSON.stringify(meta));
		if (!options?.skipCommentMeta) {
			persistWalineCommentMeta(meta);
		}
	} catch {
		// Ignore
	}
}

export function clearGuestAuth(): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.removeItem(GUEST_TOKEN_STORAGE_KEY);
		const storedUser = readStoredChatUser();
		if (storedUser?.authType === "guest") {
			clearStoredChatUser();
		}
	} catch {
		// Ignore
	}
}

/**
 * 校验并持久化已认证的聊天会话用户实体。
 * 在接收到 room:init / auth:result / 更新个人资料 时调用，
 * 确保页面刷新或重载时可首帧秒级恢复已登录态。
 */
export function persistStoredChatUser(user: ChatSessionUser): void {
	if (typeof localStorage === "undefined") return;
	try {
		if (
			!user ||
			typeof user !== "object" ||
			typeof user.userKey !== "string" ||
			!user.userKey.trim() ||
			(user.authType !== "waline" && user.authType !== "guest")
		) {
			return;
		}
		localStorage.setItem(CHAT_SESSION_USER_KEY, JSON.stringify(user));
	} catch {
		// Ignore storage errors (quota, incognito, etc.)
	}
}

/**
 * 读取本地缓存的聊天会话用户实体。
 */
export function readStoredChatUser(): ChatSessionUser | null {
	if (typeof localStorage === "undefined") return null;
	try {
		const raw = localStorage.getItem(CHAT_SESSION_USER_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<ChatSessionUser>;
		if (
			parsed &&
			typeof parsed.userKey === "string" &&
			parsed.userKey.trim() &&
			(parsed.authType === "waline" || parsed.authType === "guest") &&
			typeof parsed.name === "string" &&
			parsed.name.trim()
		) {
			return parsed as ChatSessionUser;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * 清除本地缓存的聊天会话用户实体。
 */
export function clearStoredChatUser(): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.removeItem(CHAT_SESSION_USER_KEY);
	} catch {
		// Ignore
	}
}

/**
 * 从本地凭证多层推导与恢复首帧会话用户。
 * 1. 若存在 CHAT_SESSION_USER_KEY 且与当前 token 匹配，直接返回完整实体；
 * 2. 若无专用缓存但有 WALINE_USER / 访客信息，即时合成保底合法用户，确保 0 延迟首帧已登录；
 * 3. 若无凭据则返回 null。
 */
export function readInitialCachedUser(): ChatSessionUser | null {
	if (typeof window === "undefined" || typeof localStorage === "undefined") {
		return null;
	}
	const currentAuth = resolveInitialAuth();
	if (!currentAuth) {
		clearStoredChatUser();
		return null;
	}

	// 1. 优先读取完整缓存的 ChatSessionUser
	const storedUser = readStoredChatUser();
	if (storedUser && storedUser.authType === currentAuth.kind) {
		return storedUser;
	}

	// 2. 二级保底：从 WALINE_USER 推导（例如刚在评论区登录或升级后的首访）
	if (currentAuth.kind === "waline") {
		try {
			const rawWaline = localStorage.getItem("WALINE_USER");
			if (rawWaline) {
				const walineData = JSON.parse(rawWaline) as {
					token?: string;
					display_name?: string;
					email?: string;
					type?: string;
					avatar?: string;
					url?: string;
					label?: string;
					objectId?: string | number;
					mailMd5?: string;
				};
				const name =
					(typeof walineData.display_name === "string" &&
						walineData.display_name.trim()) ||
					"用户";
				const isAdmin =
					walineData.type === "administrator" || walineData.type === "admin";
				const rawAvatar =
					typeof walineData.avatar === "string" && walineData.avatar.trim()
						? walineData.avatar.trim()
						: "";
				const synthesizedUser: ChatSessionUser = {
					userKey:
						walineData.objectId !== undefined
							? `waline:${walineData.objectId}`
							: "waline:me",
					authType: "waline",
					name,
					avatar: rawAvatar,
					url: typeof walineData.url === "string" ? walineData.url.trim() : "",
					badge: isAdmin
						? "站长"
						: (typeof walineData.label === "string" &&
								walineData.label.trim()) ||
							"用户",
					badgeType: isAdmin ? "host" : "accent",
					isAdmin,
					status: "",
					email:
						typeof walineData.email === "string" ? walineData.email.trim() : "",
				};
				return synthesizedUser;
			}
		} catch {
			// Ignore
		}
	}

	// 3. 二级保底：从 Guest 元数据推导
	if (currentAuth.kind === "guest") {
		const guestMeta = readStoredGuestMeta();
		if (guestMeta.nickname) {
			const synthesizedGuest: ChatSessionUser = {
				userKey: "guest",
				authType: "guest",
				name: guestMeta.nickname,
				avatar: guestMeta.email ? previewAvatarFromEmail(guestMeta.email) : "",
				url: guestMeta.url || "",
				badge: "访客",
				badgeType: "tag",
				isAdmin: false,
				status: "",
				email: guestMeta.email || "",
			};
			return synthesizedGuest;
		}
	}

	return null;
}

export function resolveCurrentUserEmail(user: ChatSessionUser | null): string {
	if (user?.email && typeof user.email === "string" && user.email.trim()) {
		return user.email.trim();
	}
	if (typeof localStorage === "undefined") return "";
	if (user?.authType === "waline") {
		try {
			const rawWaline = localStorage.getItem("WALINE_USER");
			if (rawWaline) {
				const parsed = JSON.parse(rawWaline) as { email?: unknown };
				if (typeof parsed.email === "string" && parsed.email.trim()) {
					return parsed.email.trim();
				}
			}
		} catch {
			// Ignore
		}
		const commentMeta = readWalineCommentMeta();
		if (commentMeta.email?.trim()) return commentMeta.email.trim();
	}
	if (user?.authType === "guest") {
		const guestMeta = readStoredGuestMeta();
		if (guestMeta.email?.trim()) return guestMeta.email.trim();
	}
	const fallbackMeta = readWalineCommentMeta();
	return fallbackMeta.email?.trim() || "";
}

export function readStoredGuestMeta(): StoredGuestMeta {
	if (typeof localStorage === "undefined") {
		return { nickname: "", email: "", url: "" };
	}
	const commentMeta = readWalineCommentMeta();
	try {
		const raw = localStorage.getItem(GUEST_EMAIL_STORAGE_KEY);
		if (!raw) return commentMeta;
		const parsed = JSON.parse(raw) as Partial<StoredGuestMeta>;
		return {
			nickname:
				(typeof parsed.nickname === "string" ? parsed.nickname.trim() : "") ||
				commentMeta.nickname,
			email:
				(typeof parsed.email === "string" ? parsed.email.trim() : "") ||
				commentMeta.email,
			url:
				(typeof parsed.url === "string" ? parsed.url.trim() : "") ||
				commentMeta.url,
		};
	} catch {
		return commentMeta;
	}
}

export function resolveInitialAuth(): {
	kind: "waline" | "guest";
	token: string;
} | null {
	const walineToken = readStoredWalineToken();
	if (walineToken) {
		return { kind: "waline", token: walineToken };
	}
	const guestToken = readStoredGuestToken();
	if (guestToken) {
		return { kind: "guest", token: guestToken };
	}
	return null;
}

export function buildWalineLoginUrl(walineServerUrl: string): string {
	const base = normalizeServerUrl(walineServerUrl);
	if (!base) return "";
	const redirect = typeof window !== "undefined" ? window.location.href : "";
	return `${base}/ui/login?lng=zh-CN${redirect ? `&redirect=${encodeURIComponent(redirect)}` : ""}`;
}

export function openWalineLoginPopup(
	walineServerUrl: string,
	onSuccess: (token: string) => void,
	onCancel?: () => void,
	onBlocked?: () => void,
): () => void {
	const base = normalizeServerUrl(walineServerUrl);
	const loginUrl = buildWalineLoginUrl(walineServerUrl);
	if (!base || !loginUrl) {
		onBlocked?.();
		onCancel?.();
		return () => {};
	}
	let walineOrigin = "";
	try {
		walineOrigin = new URL(base).origin;
	} catch {
		walineOrigin = "";
	}
	const initialToken = readStoredWalineToken();
	const width = 960;
	const height = 620;
	const left = Math.max(
		0,
		Math.floor((window.innerWidth - width) / 2 + (window.screenX || 0)),
	);
	const top = Math.max(
		0,
		Math.floor((window.innerHeight - height) / 2 + (window.screenY || 0)),
	);

	if (isMobileLikeBrowser()) {
		window.location.href = loginUrl;
		return () => {};
	}

	const popup = window.open(
		loginUrl,
		"waline_chat_login",
		`width=${width},height=${height},left=${left},top=${top},menubar=no,status=no,toolbar=no,scrollbars=yes,resizable=yes`,
	);

	if (!popup) {
		if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 1) {
			window.location.href = loginUrl;
			return () => {};
		}
		onBlocked?.();
		onCancel?.();
		return () => {};
	}

	let finished = false;
	const cleanup = () => {
		window.removeEventListener("message", onMessage);
		window.removeEventListener("storage", onStorageOrVisible);
		document.removeEventListener("visibilitychange", onStorageOrVisible);
		window.clearInterval(pollTimer);
	};

	const checkStoredFallback = () => {
		if (finished) return false;
		const maybeToken = readStoredWalineToken();
		if (maybeToken && maybeToken !== initialToken) {
			finished = true;
			cleanup();
			try {
				if (!popup.closed) popup.close();
			} catch {
				// Ignore close failure
			}
			onSuccess(maybeToken);
			return true;
		}
		return false;
	};

	const onStorageOrVisible = () => {
		checkStoredFallback();
	};

	const onMessage = (event: MessageEvent) => {
		if (walineOrigin && event.origin !== walineOrigin) return;
		if (event.source && event.source !== popup) return;
		const payload = event.data as {
			type?: string;
			data?: {
				token?: string;
				display_name?: string;
				nick?: string;
				email?: string;
				type?: string;
				avatar?: string;
				url?: string;
				label?: string;
				objectId?: string | number;
				mailMd5?: string;
			};
		};
		if (
			payload &&
			typeof payload === "object" &&
			payload.type === "userInfo" &&
			payload.data?.token
		) {
			finished = true;
			cleanup();
			persistWalineAuth({
				token: payload.data.token,
				display_name: payload.data.display_name || payload.data.nick,
				email: payload.data.email,
				type: payload.data.type,
				avatar: payload.data.avatar,
				url: payload.data.url,
				label: payload.data.label,
				objectId: payload.data.objectId,
				mailMd5: payload.data.mailMd5,
			});
			try {
				if (!popup.closed) popup.close();
			} catch {
				// Ignore close failure
			}
			onSuccess(payload.data.token);
		}
	};

	window.addEventListener("message", onMessage);
	window.addEventListener("storage", onStorageOrVisible);
	document.addEventListener("visibilitychange", onStorageOrVisible);

	const pollTimer = window.setInterval(() => {
		if (checkStoredFallback()) return;
		if (popup.closed && !finished) {
			finished = true;
			cleanup();
			onCancel?.();
		}
	}, 600);

	return () => {
		finished = true;
		cleanup();
	};
}

export async function registerGuestSession(
	chatServerUrl: string,
	input: StoredGuestMeta & { room?: string; allowSplitGuest?: boolean },
): Promise<{
	ok: boolean;
	token?: string;
	user?: ChatSessionUser;
	error?: string;
	code?: string;
	allowSplitGuest?: boolean;
}> {
	const base = normalizeServerUrl(chatServerUrl);
	if (!base) {
		return { ok: false, error: "聊天室后端地址未配置" };
	}
	try {
		const resp = await fetch(`${base}/api/auth/guest`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		});
		const data = (await resp.json()) as {
			ok?: boolean;
			token?: string;
			user?: ChatSessionUser;
			error?: string;
			code?: string;
			allowSplitGuest?: boolean;
		};
		if (!resp.ok || !data.ok || !data.token || !data.user) {
			return {
				ok: false,
				error: data.error || "访客认证失败",
				code: data.code,
				allowSplitGuest: resp.status === 403 ? false : data.allowSplitGuest,
			};
		}
		persistGuestAuth(
			data.token,
			{
				nickname: input.nickname,
				email: input.email,
				url: input.url,
			},
			{
				skipCommentMeta: Boolean(data.user.isolated || input.allowSplitGuest),
			},
		);
		return { ok: true, token: data.token, user: data.user };
	} catch {
		return { ok: false, error: "网络异常，无法连接聊天室服务端" };
	}
}

export interface MusicSearchResponse {
	tracks: ChatMusicTrack[];
	hasMore: boolean;
	page: number;
}

export async function searchOnlineMusic(
	chatServerUrl: string,
	keyword: string,
	options?: { signal?: AbortSignal; limit?: number; page?: number; provider?: "qq" | "netease" | "kugou" | "youtube" },
): Promise<MusicSearchResponse> {
	const base =
		normalizeServerUrl(chatServerUrl) || "https://chat-server.lengxiqwq.com";
	const q = keyword.trim();
	if (!q) return { tracks: [], hasMore: false, page: 1 };
	const limit = Math.min(30, Math.max(1, options?.limit ?? 15));
	const page = Math.max(1, options?.page ?? 1);

	const controller = new AbortController();
	const timeoutId = window.setTimeout(
		() => controller.abort("timeout"),
		options?.provider === "kugou" ? 13_000 : 10_000,
	);
	const onExternalAbort = () => controller.abort(options?.signal?.reason);
	if (options?.signal) {
		if (options.signal.aborted) {
			window.clearTimeout(timeoutId);
			controller.abort(options.signal.reason);
		} else {
			options.signal.addEventListener("abort", onExternalAbort, { once: true });
		}
	}

	try {
		const resp = await fetch(
			`${base}/api/music/search?q=${encodeURIComponent(q)}&limit=${limit}&page=${page}&provider=${options?.provider ?? "qq"}`,
			{ signal: controller.signal, cache: "no-store" },
		);
		const data = (await resp.json().catch(() => null)) as {
			ok?: boolean;
			error?: string;
			hasMore?: boolean;
			page?: number;
			tracks?: ChatMusicTrack[];
		} | null;
		if (!resp.ok || !data?.ok || !Array.isArray(data.tracks)) {
			throw new Error(data?.error || `搜索请求失败 (${resp.status})`);
		}
		const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
		return {
			tracks,
			hasMore: Boolean(data?.hasMore ?? tracks.length >= limit),
			page: typeof data?.page === "number" ? data.page : page,
		};
	} catch (err) {
		if (controller.signal.aborted && controller.signal.reason === "timeout") {
			throw new Error("搜索超时，请稍后重试");
		}
		throw err;
	} finally {
		window.clearTimeout(timeoutId);
		options?.signal?.removeEventListener("abort", onExternalAbort);
	}
}

export async function fetchMusicHistory(
	chatServerUrl: string,
	params: FetchMusicHistoryParams = {},
	options?: { signal?: AbortSignal },
): Promise<FetchMusicHistoryResponse> {
	const base =
		normalizeServerUrl(chatServerUrl) || "https://chat-server.lengxiqwq.com";
	const roomId = params.roomId || "interconnect";
	const type = params.type || "all";
	const sort = params.sort || "recent";
	const offset = Math.max(0, params.offset ?? 0);
	const limit = Math.min(100, Math.max(1, params.limit ?? 100));
	const requesterKey = params.requesterKey || "";

	const searchParams = new URLSearchParams({
		roomId,
		type,
		sort,
		offset: String(offset),
		limit: String(limit),
	});
	if (requesterKey && type !== "rotation") {
		searchParams.set("requesterKey", requesterKey);
	}

	const controller = new AbortController();
	const timeoutId = window.setTimeout(
		() => controller.abort("timeout"),
		10_000,
	);
	const onExternalAbort = () => controller.abort(options?.signal?.reason);
	if (options?.signal) {
		if (options.signal.aborted) {
			window.clearTimeout(timeoutId);
			controller.abort(options.signal.reason);
		} else {
			options.signal.addEventListener("abort", onExternalAbort, { once: true });
		}
	}

	try {
		const resp = await fetch(
			`${base}/api/music/history?${searchParams.toString()}`,
			{
				signal: controller.signal,
				cache: "no-store",
			},
		);
		const data = (await resp.json().catch(() => null)) as FetchMusicHistoryResponse | null;
		if (!resp.ok || !data?.ok || !Array.isArray(data.items)) {
			throw new Error(data?.error || `获取历史记录失败 (${resp.status})`);
		}
		return data;
	} catch (err) {
		if (controller.signal.aborted && controller.signal.reason === "timeout") {
			throw new Error("加载历史记录超时，请稍后重试");
		}
		throw err;
	} finally {
		window.clearTimeout(timeoutId);
		options?.signal?.removeEventListener("abort", onExternalAbort);
	}
}

export async function uploadChatImage(
	file: File,
	walineServerUrl: string,
): Promise<{ url: string }> {
	const base = normalizeServerUrl(walineServerUrl);
	if (!base) {
		throw new Error("未配置图片上传服务");
	}
	const allowedTypes = new Set([
		"image/jpeg",
		"image/png",
		"image/webp",
		"image/gif",
		"image/avif",
	]);
	if (!allowedTypes.has(file.type.toLowerCase())) {
		throw new Error("仅支持 JPG / PNG / WebP / GIF / AVIF 图片");
	}

	if (file.size > 5 * 1024 * 1024) {
		throw new Error("图片超过 5MB 限制");
	}

	const formData = new FormData();
	formData.append("file", file);

	const headers: Record<string, string> = {};
	const token = readStoredWalineToken();
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}

	const resp = await fetch(`${base}/api/upload`, {
		method: "POST",
		headers,
		body: formData,
	});
	const data = (await resp.json()) as {
		errno?: number;
		errmsg?: string;
		data?: { url?: string };
	};
	if (!resp.ok || data.errno !== 0 || !data.data?.url) {
		throw new Error(data.errmsg || "图片上传失败");
	}
	return { url: data.data.url };
}

export async function uploadChatMedia(
	file: File,
	chatServerUrl: string,
	customToken?: string,
): Promise<{
	url: string;
	name: string;
	size: number;
	type: "image" | "audio" | "video" | "file";
}> {
	const base = normalizeServerUrl(chatServerUrl);
	if (!base) {
		throw new Error("未配置多媒体上传服务");
	}

	if (file.size > 100 * 1024 * 1024) {
		throw new Error("文件大小超过 100MB 限制");
	}

	const token = customToken?.trim() || readStoredWalineToken();
	const headers: Record<string, string> = {
		"Content-Type": file.type || "application/octet-stream",
	};
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}

	const queryParam = token ? `&token=${encodeURIComponent(token)}` : "";
	const resp = await fetch(
		`${base}/api/upload?name=${encodeURIComponent(file.name)}${queryParam}`,
		{
			method: "POST",
			headers,
			body: file,
		},
	);

	const data = (await resp.json()) as {
		ok?: boolean;
		error?: string;
		data?: {
			url: string;
			name: string;
			size: number;
			type: "image" | "audio" | "video" | "file";
		};
	};

	if (!resp.ok || !data.ok || !data.data?.url) {
		throw new Error(data.error || "文件上传失败");
	}

	return data.data;
}

export function getAvatarInitials(name?: string, fallback = "?"): string {
	const cleaned = (name || "").replace(/\s+/g, "").trim();
	if (!cleaned) return fallback;
	return Array.from(cleaned).slice(0, 2).join("");
}

function rewriteDefaultAvatarQuery(rawUrl: string): string {
	const trimmed = rawUrl.trim();
	if (
		!trimmed.startsWith("http://") &&
		!trimmed.startsWith("https://") &&
		!trimmed.startsWith("/")
	) {
		return "";
	}
	try {
		const origin =
			typeof window !== "undefined"
				? window.location.origin
				: "https://example.invalid";
		const parsed = new URL(trimmed, origin);
		const proxiedTarget = parsed.searchParams.get("url");
		if (proxiedTarget) {
			const rewrittenInner = rewriteDefaultAvatarQuery(proxiedTarget);
			if (rewrittenInner && rewrittenInner !== proxiedTarget) {
				parsed.searchParams.set("url", rewrittenInner);
				return trimmed.startsWith("/")
					? `${parsed.pathname}${parsed.search}${parsed.hash}`
					: parsed.toString();
			}
			return trimmed;
		}

		const isAvatarService =
			parsed.hostname.includes("cravatar") ||
			parsed.hostname.includes("gravatar") ||
			parsed.hostname.includes("libravatar") ||
			parsed.hostname.includes("weavatar") ||
			parsed.pathname.includes("/avatar/");
		if (isAvatarService) {
			const dParam = (parsed.searchParams.get("d") || "").toLowerCase();
			const defaultParam = (
				parsed.searchParams.get("default") || ""
			).toLowerCase();
			const isUnwantedPattern = (val: string) =>
				val === "mp" ||
				val === "mm" ||
				val === "mystery" ||
				val === "identicon" ||
				val === "retro" ||
				val === "monsterid" ||
				val === "wavatar" ||
				val === "robohash";

			if (isUnwantedPattern(dParam) || (!dParam && !defaultParam)) {
				parsed.searchParams.set("d", "404");
				return parsed.toString();
			}
			if (isUnwantedPattern(defaultParam)) {
				parsed.searchParams.set("default", "404");
				return parsed.toString();
			}
		}
		return trimmed;
	} catch {
		return trimmed.replace(
			/([?&](?:d|default)=)(?:mp|mm|mystery|identicon|retro|monsterid|wavatar|robohash)(?=&|$)/gi,
			"$1404",
		);
	}
}

export function resolveChatAvatarUrl(raw?: string): string {
	if (!raw) return "";
	if (raw.includes("chat-api.lengxiqwq.com/api/interconnect/media/")) {
		return "";
	}
	const trimmed = raw.trim();
	try {
		const origin =
			typeof window !== "undefined"
				? window.location.origin
				: "https://example.invalid";
		const parsed = new URL(trimmed, origin);
		const dParam =
			parsed.searchParams.get("d") || parsed.searchParams.get("default");
		// Skip generic avatar placeholders so ChatAvatar can use its local fallback.
		const isAvatarService =
			parsed.hostname.includes("cravatar") ||
			parsed.hostname.includes("gravatar") ||
			parsed.hostname.includes("libravatar");
		if (isAvatarService) {
			const d = (dParam || "").toLowerCase();
			if (
				d === "mp" ||
				d === "mm" ||
				d === "mystery" ||
				d === "identicon" ||
				d === "retro" ||
				d === "monsterid" ||
				d === "wavatar" ||
				d === "robohash"
			) {
				return "";
			}
		}
	} catch {}
	return rewriteDefaultAvatarQuery(raw);
}

export function resolveChatAvatarFallbackUrl(raw?: string): string {
	if (!raw) return "";
	try {
		const avatar = new URL(raw);
		if (
			!["cravatar", "gravatar", "libravatar", "weavatar"].some((service) =>
				avatar.hostname.includes(service),
			)
		) {
			return "";
		}
		return sanitizeChatUrl(
			avatar.searchParams.get("d") || avatar.searchParams.get("default") || "",
			false,
		);
	} catch {
		return "";
	}
}

export function previewAvatarFromEmail(email: string): string {
	const trimmed = email.trim().toLowerCase();
	const qqMatch = trimmed.match(/^([1-9]\d{4,10})@qq\.com$/);
	if (qqMatch) {
		return `https://q1.qlogo.cn/g?b=qq&nk=${qqMatch[1]}&s=100`;
	}
	return "";
}

export async function fetchUserDetailProfile(
	chatServerUrl: string,
	roomId: string,
	userKey: string,
	tracksLimit = 50,
	walineToken = "",
): Promise<ChatUserDetailProfile | null> {
	const base = normalizeServerUrl(chatServerUrl);
	const cleanKey = userKey.trim();
	if (!base || !cleanKey) return null;
	try {
		const headers: Record<string, string> = {};
		if (walineToken.trim()) {
			headers.Authorization = `Bearer ${walineToken.trim()}`;
		}
		const resp = await fetch(
			`${base}/api/rooms/member?room=${encodeURIComponent(roomId)}&userKey=${encodeURIComponent(cleanKey)}&tracksLimit=${encodeURIComponent(String(tracksLimit))}&_t=${Date.now()}`,
			{ headers, cache: "no-store" },
		);
		if (!resp.ok) return null;
		const data = (await resp.json()) as {
			ok?: boolean;
			profile?: ChatUserDetailProfile;
		};
		if (!data.ok || !data.profile) return null;
		return {
			...data.profile,
			recentTracks: (data.profile.recentTracks ?? []).map(
				normalizeUserTrackLog,
			),
		};
	} catch {
		return null;
	}
}

function normalizeUserTrackLog(
	item: ChatUserTracksPage["items"][number],
): ChatUserTracksPage["items"][number] {
	const log = item as typeof item & { id?: number };
	return { ...item, logId: item.logId ?? log.id };
}

export async function fetchUserDetailTracks(
	chatServerUrl: string,
	roomId: string,
	userKey: string,
	beforeId: number,
	limit = 50,
): Promise<ChatUserTracksPage | null> {
	const base = normalizeServerUrl(chatServerUrl);
	const cleanKey = userKey.trim();
	if (!base || !cleanKey) return null;
	try {
		const resp = await fetch(
			`${base}/api/rooms/member/tracks?room=${encodeURIComponent(roomId)}&userKey=${encodeURIComponent(cleanKey)}&limit=${encodeURIComponent(String(limit))}&beforeId=${encodeURIComponent(String(beforeId))}&_t=${Date.now()}`,
			{ cache: "no-store" },
		);
		if (!resp.ok) return null;
		const data = (await resp.json()) as {
			ok?: boolean;
			items?: ChatUserTracksPage["items"];
			tracks?: ChatUserTracksPage["items"];
			hasMore?: boolean;
			nextBeforeId?: number;
		};
		const items = data.items ?? data.tracks;
		if (!data.ok || !Array.isArray(items)) return null;
		return {
			items: items.map(normalizeUserTrackLog),
			hasMore: Boolean(data.hasMore),
			nextBeforeId: Number(data.nextBeforeId || 0),
		};
	} catch {
		return null;
	}
}

export async function saveMemberBadges(
	chatServerUrl: string,
	roomId: string,
	targetUserKey: string,
	customBadges: ChatCustomBadge[],
	walineToken = "",
): Promise<boolean> {
	const base = normalizeServerUrl(chatServerUrl);
	const cleanKey = targetUserKey.trim();
	if (!base || !cleanKey) return false;
	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (walineToken.trim()) {
			headers.Authorization = `Bearer ${walineToken.trim()}`;
		}
		const resp = await fetch(`${base}/api/rooms/member/badges`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				room: roomId,
				userKey: cleanKey,
				customBadges,
			}),
		});
		if (!resp.ok) return false;
		const data = (await resp.json()) as { ok?: boolean };
		return Boolean(data.ok);
	} catch {
		return false;
	}
}

export interface ExternalOriginInfo {
	cleanName: string;
	siteName: string;
	site?: InterconnectSite;
	host: string;
}

function getKnownInterconnectBadges(
	sites: InterconnectSite[] = defaultInterconnectSites,
): Set<string> {
	const badges = new Set<string>();
	for (const s of sites) {
		if (s.name) badges.add(s.name.trim().toLowerCase());
		if (s.badge) badges.add(s.badge.trim().toLowerCase());
		if (Array.isArray(s.aliases)) {
			for (const a of s.aliases) {
				const trimmed = a.trim().toLowerCase();
				if (trimmed) badges.add(trimmed);
			}
		}
	}
	return badges;
}

const defaultKnownBadges = getKnownInterconnectBadges(defaultInterconnectSites);

export function isExternalMatrixIdentity(
	entry: {
		source?: string;
		userKey?: string;
		badge?: string;
		site?: string;
	},
	customSites?: InterconnectSite[],
): boolean {
	if (!entry) return false;
	const key = (entry.userKey || "").trim();
	const badge = (entry.badge || "").trim();
	const site = (entry.site || "").trim();
	const badgeLower = badge.toLowerCase();

	if (
		entry.source === "matrix" ||
		key.startsWith("matrix:") ||
		(key.startsWith("@") && key.includes(":")) ||
		site ||
		badge === "互联茶友"
	) {
		return true;
	}

	if (!badge) return false;
	if (customSites && customSites.length > 0) {
		const customBadges = getKnownInterconnectBadges(customSites);
		if (customBadges.has(badgeLower)) return true;
	}
	return defaultKnownBadges.has(badgeLower);
}

function hasAsciiControlChars(value: string): boolean {
	for (let i = 0; i < value.length; i += 1) {
		const code = value.charCodeAt(i);
		if (code < 32 || code === 127) return true;
	}
	return false;
}

export function sanitizeChatUrl(rawUrl?: string, allowRelative = true): string {
	const trimmed = (rawUrl || "").trim();
	if (!trimmed || hasAsciiControlChars(trimmed)) return "";
	if (allowRelative && trimmed.startsWith("/") && !trimmed.startsWith("//")) {
		return trimmed;
	}
	try {
		const parsed = new URL(trimmed);
		return parsed.protocol === "https:" || parsed.protocol === "http:"
			? trimmed
			: "";
	} catch {
		return "";
	}
}

export function isMentionedForUser(
	msg: ChatMessageRecord,
	user: ChatSessionUser | null,
): boolean {
	if (!user || msg.kind !== "user" || msg.userKey === user.userKey) return false;
	return Boolean(
		msg.mentionEntities &&
		msg.mentionKeys?.some((key) => key === user.userKey || key === "room"),
	);
}

export function getLocalSiteName(sites: InterconnectSite[] = []): string {
	return sites.find((s) => s.isSelf)?.name?.trim() || "本站";
}

function extractHostname(rawUrl?: string): string {
	const trimmed = (rawUrl || "").trim();
	if (!trimmed) return "";
	try {
		return new URL(trimmed).hostname.toLowerCase();
	} catch {
		return "";
	}
}

function matchSiteByHostname(
	rawHost: string,
	sites: InterconnectSite[],
): InterconnectSite | undefined {
	const clean = extractCleanHostname(rawHost);
	if (!clean) return undefined;
	for (const site of sites) {
		if (site.isSelf && clean.includes("lengxiqwq.com")) {
			return site;
		}
		// 1. 优先精准匹配 homeserver 域名（Matrix 原生节点）
		if (site.homeserver) {
			const hsHost = extractCleanHostname(site.homeserver);
			if (
				hsHost &&
				(clean === hsHost ||
					clean.endsWith(`.${hsHost}`) ||
					hsHost.endsWith(`.${clean}`))
			) {
				return site;
			}
		}
		// 2. 匹配 siteUrl 与 chatUrl 域名
		const siteUrlHost = extractCleanHostname(site.siteUrl || site.url);
		if (siteUrlHost) {
			if (
				clean === siteUrlHost ||
				clean.includes(siteUrlHost) ||
				siteUrlHost.includes(clean)
			) {
				return site;
			}
			const hostParts = clean.split(".").slice(-2).join(".");
			const siteParts = siteUrlHost.split(".").slice(-2).join(".");
			if (hostParts && hostParts === siteParts) {
				return site;
			}
		}
		const chatUrlHost = extractCleanHostname(site.chatUrl);
		if (
			chatUrlHost &&
			(clean === chatUrlHost || clean.includes(chatUrlHost))
		) {
			return site;
		}
		// 3. 匹配 aliases 别名
		if (Array.isArray(site.aliases)) {
			for (const alias of site.aliases) {
				const cleanAlias = alias.trim().toLowerCase();
				if (
					cleanAlias &&
					(clean === cleanAlias ||
						clean.includes(cleanAlias) ||
						cleanAlias.includes(clean))
				) {
					return site;
				}
			}
		}
	}
	return undefined;
}

function matchSiteByHint(
	hint: string,
	sites: InterconnectSite[],
): InterconnectSite | undefined {
	const clean = hint.trim().toLowerCase();
	if (!clean) return undefined;
	for (const s of sites) {
		const name = (s.name || "").toLowerCase();
		const badge = (s.badge || "").toLowerCase();
		const owner = (s.owner || "").toLowerCase();
		const hsHost = extractCleanHostname(s.homeserver);
		const siteHost = extractCleanHostname(s.siteUrl || s.url);
		const chatHost = extractCleanHostname(s.chatUrl);
		const aliases = Array.isArray(s.aliases)
			? s.aliases.map((a) => a.trim().toLowerCase()).filter(Boolean)
			: [];
		if (
			(name && (name.includes(clean) || clean.includes(name))) ||
			(badge && (badge.includes(clean) || clean.includes(badge))) ||
			(owner && (owner.includes(clean) || clean.includes(owner))) ||
			(hsHost && (hsHost.includes(clean) || clean.includes(hsHost))) ||
			(siteHost && (siteHost.includes(clean) || clean.includes(siteHost))) ||
			(chatHost && (chatHost.includes(clean) || clean.includes(chatHost))) ||
			aliases.some((a) => a.includes(clean) || clean.includes(a))
		) {
			return s;
		}
	}
	return undefined;
}

function matchSiteByUrl(
	rawUrl: string,
	sites: InterconnectSite[],
): InterconnectSite | undefined {
	const trimmed = (rawUrl || "").trim();
	if (
		!trimmed ||
		trimmed.includes("matrix.to/") ||
		trimmed.includes("lengxiqwq.com")
	) {
		return undefined;
	}
	const targetHost = extractCleanHostname(trimmed);
	return targetHost ? matchSiteByHostname(targetHost, sites) : undefined;
}

export function normalizeDotSpacing(name: string): string {
	const raw = (name || "").trim();
	if (!raw) return "";
	const match = raw.match(/^(.+?)\s*[·•・]\s*(.+)$/);
	if (!match) return raw;
	const cleanName = match[1].trim();
	const siteSuffix = match[2].trim();
	if (!cleanName || !siteSuffix) return raw;
	return `${cleanName} · ${siteSuffix}`;
}

export function resolveExternalOrigin(
	member: {
		name: string;
		userKey?: string;
		source?: string;
		badge?: string;
		site?: string;
		siteUrl?: string;
		url?: string;
	},
	sites: InterconnectSite[] = [],
): ExternalOriginInfo {
	const rawName = (member.name || "").trim();
	const rawUserKey = (member.userKey || "").trim();
	const baseUserKey = rawUserKey.split("#")[0] || rawUserKey;
	const relayMatch = rawUserKey.match(/#relay:([^:#]+)(?::([^#]*))?/i);
	const relaySiteKey = relayMatch ? relayMatch[1].trim() : "";

	// 1. 优先从昵称中的分隔符（· 或 • 或 ・）拆分：例如 "朝朝听雨 · 听雨茶室" -> name: "朝朝听雨", site: "听雨茶室"
	const separatorMatch = rawName.match(/^(.+?)\s*[·•・]\s*(.+)$/);
	let cleanName = rawName;
	let siteFromSuffix = "";

	if (separatorMatch) {
		cleanName = separatorMatch[1].trim();
		siteFromSuffix = separatorMatch[2].trim();
	}

	// 2. 提取真实底层 Matrix 节点域名（去除 #relay:... 后缀再匹配）
	const hostMatch =
		baseUserKey.match(/@.+?:([^/:]+)/) || baseUserKey.match(/matrix:([^/:]+)/);
	const host = hostMatch ? hostMatch[1].toLowerCase() : "";

	let matchedSite: InterconnectSite | undefined;
	const genericBadges = new Set(["互联茶友", "茶友", "站长", "访客", "认证"]);
	const rawExplicitSite = (member.site || "").trim();
	const explicitSite = genericBadges.has(rawExplicitSite)
		? ""
		: rawExplicitSite;
	const explicitSiteUrl = (member.siteUrl || "").trim();
	const explicitBadge =
		member.badge && !genericBadges.has(member.badge.trim())
			? member.badge.trim()
			: "";

	// 2.1 代发 / 显式归属站点优先（避免把借助其他站 Matrix 节点代发的用户误判到宿主站）
	if (explicitSiteUrl) {
		matchedSite = matchSiteByUrl(explicitSiteUrl, sites);
	}
	if (!matchedSite && member.url) {
		matchedSite = matchSiteByUrl(member.url, sites);
	}
	if (!matchedSite && explicitSite) {
		matchedSite = matchSiteByHint(explicitSite, sites);
	}
	if (!matchedSite && relaySiteKey) {
		matchedSite = matchSiteByHint(relaySiteKey, sites);
	}
	if (!matchedSite && explicitBadge) {
		matchedSite = matchSiteByHint(explicitBadge, sites);
	}

	// 若消息/成员明确携带了代发归属或非宿主域名直链，即使未列入 interconnectSites 也优先构造独立站点信息
	const hasExplicitRelaySite = Boolean(
		explicitSite ||
			explicitSiteUrl ||
			relaySiteKey ||
			baseUserKey.toLowerCase().includes("@aiprate:matrix.rainzt.cn"),
	);
	if (!matchedSite && hasExplicitRelaySite) {
		const isAiovtueRelay =
			relaySiteKey.toLowerCase() === "aiovtue" ||
			explicitSite.toLowerCase() === "aiovtue" ||
			explicitBadge.toLowerCase() === "aiovtue" ||
			baseUserKey.toLowerCase().includes("@aiprate:matrix.rainzt.cn");
		if (isAiovtueRelay) {
			matchedSite = matchSiteByHint("aiovtue", sites);
		}
	}

	// 3. 普通独立 Matrix 账号：按用户 Matrix 域名（含配置 aliases）匹配站点
	if (!matchedSite && !hasExplicitRelaySite && host) {
		matchedSite = matchSiteByHostname(host, sites);
	}

	if (!matchedSite && !hasExplicitRelaySite && (host === "lengxiqwq.com" || host.endsWith(".lengxiqwq.com"))) {
		matchedSite = sites.find((s) => s.isSelf);
	}

	if (!matchedSite && siteFromSuffix) {
		matchedSite = matchSiteByHint(siteFromSuffix, sites);
	}

	if (!matchedSite && !hasExplicitRelaySite && !host) {
		for (const site of sites) {
			if (
				site.owner &&
				cleanName.toLowerCase().includes(site.owner.toLowerCase())
			) {
				matchedSite = site;
				break;
			}
			if (
				cleanName.includes("雪") ||
				cleanName.toLowerCase().includes("aiovtue")
			) {
				if (
					site.name.toLowerCase().includes("aiovtue") ||
					site.name.includes("雪") ||
					site.owner.includes("雪")
				) {
					matchedSite = site;
					break;
				}
			}
		}
	}

	// 未知站点：优先提取用户网站或 Matrix 节点的服务器域名
	const unknownServerHost =
		extractHostname(explicitSiteUrl) ||
		(!member.url?.includes("matrix.to/") ? extractHostname(member.url) : "") ||
		host;

	// 优先使用对方原本自带的规范站点后缀；没有时才使用匹配到的官方全名或域名兜底
	const siteName =
		siteFromSuffix ||
		matchedSite?.name ||
		matchedSite?.badge ||
		unknownServerHost ||
		explicitSite ||
		explicitBadge ||
		"外部站点";

	return {
		cleanName: cleanName || rawName,
		siteName,
		site: matchedSite,
		host,
	};
}

export async function fetchMessageSource(
	serverUrl: string,
	roomId: string,
	msgUid: string,
): Promise<ChatMessageSourceResponse> {
	const base = normalizeServerUrl(serverUrl);
	if (!base) {
		throw new Error("未配置聊天室服务端地址");
	}
	const params = new URLSearchParams({
		room: roomId || "interconnect",
		msgUid,
	});
	const res = await fetch(`${base}/api/message/source?${params.toString()}`, {
		method: "GET",
		cache: "no-store",
	});
	const data = (await res
		.json()
		.catch(() => null)) as ChatMessageSourceResponse | null;
	if (!res.ok || !data?.ok) {
		throw new Error(data?.error || `获取消息源码失败 (${res.status})`);
	}
	return data;
}

export interface ChatThreadDetailResponse {
	ok: boolean;
	room: string;
	rootUid: string;
	rootMessage: ChatMessageRecord | null;
	replies: ChatMessageRecord[];
	error?: string;
}

export async function fetchThreadMessages(
	serverUrl: string,
	roomId: string,
	rootUid: string,
): Promise<ChatThreadDetailResponse> {
	const base = normalizeServerUrl(serverUrl);
	if (!base) {
		throw new Error("未配置聊天室服务端地址");
	}
	const params = new URLSearchParams({
		room: roomId || "interconnect",
		rootUid,
	});
	const res = await fetch(`${base}/api/chat/thread?${params.toString()}`, {
		method: "GET",
		cache: "no-store",
	});
	const data = (await res
		.json()
		.catch(() => null)) as ChatThreadDetailResponse | null;
	if (!res.ok || !data?.ok) {
		throw new Error(data?.error || `获取线程回复失败 (${res.status})`);
	}
	return data;
}

export async function fetchActiveThreads(
	serverUrl: string,
	roomId: string,
): Promise<ChatActiveThreadItem[]> {
	const base = normalizeServerUrl(serverUrl);
	if (!base) return [];
	const params = new URLSearchParams({
		room: roomId || "interconnect",
	});
	const res = await fetch(`${base}/api/chat/threads?${params.toString()}`, {
		method: "GET",
		cache: "no-store",
	});
	const data = (await res.json().catch(() => null)) as {
		ok?: boolean;
		threads?: ChatActiveThreadItem[];
	} | null;
	if (!res.ok || !data?.ok || !Array.isArray(data.threads)) return [];
	return data.threads;
}
