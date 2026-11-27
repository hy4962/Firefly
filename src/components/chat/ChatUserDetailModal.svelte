<script lang="ts">
import { untrack } from "svelte";
import type { InterconnectSite } from "@/types/chatConfig";
import ChatAvatar from "./ChatAvatar.svelte";
import ChatModal from "./ChatModal.svelte";
import {
	fetchUserDetailProfile,
	fetchUserDetailTracks,
	isExternalMatrixIdentity,
	readStoredWalineToken,
	resolveExternalOrigin,
	sanitizeChatUrl,
	saveMemberBadges,
} from "./chatClient";
import type {
	ChatCustomBadge,
	ChatMessageRecord,
	ChatOnlineMember,
	ChatSessionUser,
	ChatUserDetailProfile,
	ChatUserDetailSeed,
	ChatUserRecentMessage,
	ChatUserRequestedTrackItem,
	ChatUserTopArtistItem,
	ChatUserTopTrackItem,
	MusicHistoryLogEntry,
	PlaylistSummary,
} from "./chatTypes";
import type { ChatMusicTrack } from "./musicTypes";
import { formatPlatformLabel } from "./playlistClient";

interface Props {
	open: boolean;
	seed: ChatUserDetailSeed | null;
	roomId: string;
	chatServerUrl: string;
	currentUser: ChatSessionUser | null;
	onlineMembers: ChatOnlineMember[];
	messages: ChatMessageRecord[];
	musicHistoryLogs?: MusicHistoryLogEntry[];
	interconnectSites?: InterconnectSite[];
	walineToken?: string;
	onClose: () => void;
	onMention: (name: string, userKey?: string) => void;
	onEditSelf: () => void;
	onEnqueueTrack?: (track: ChatMusicTrack, anchor?: HTMLElement) => void;
	onOpenPlaylist?: (
		playlistId: string,
		summary?: Partial<PlaylistSummary>,
	) => void;
	onJumpToMessage?: (msgUid: string) => void;
	onUpdateMemberBadges?: (
		targetUserKey: string,
		badges: ChatCustomBadge[],
	) => Promise<boolean> | boolean;
	onToast?: (message: string, tone?: "default" | "error" | "success") => void;
}

const TRACK_PAGE_SIZE = 50;
const userDetailCache = new Map<
	string,
	{ profile: ChatUserDetailProfile; fetchedAt: number }
>();

const {
	open,
	seed,
	roomId,
	chatServerUrl,
	currentUser = null,
	onlineMembers = [],
	messages = [],
	musicHistoryLogs = [],
	interconnectSites = [],
	walineToken,
	onClose,
	onMention,
	onEditSelf,
	onEnqueueTrack,
	onOpenPlaylist,
	onJumpToMessage,
	onUpdateMemberBadges,
	onToast,
}: Props = $props();

let remoteProfile = $state<ChatUserDetailProfile | null>(null);
let remoteTracks = $state<ChatUserRequestedTrackItem[]>([]);
let remoteHasMore = $state(false);
let remoteNextBeforeId = $state(0);
let isLoading = $state(false);
let isLoadingMore = $state(false);
let tracksLoadFailed = $state(false);
let localVisibleLimit = $state(TRACK_PAGE_SIZE);
let trackTab = $state<"recent" | "top">("recent");
let bodyContainerEl: HTMLDivElement | null = $state(null);
let lockedMinHeight = $state(0);
const relayOriginInfo = $derived.by(() => {
	const raw = seed?.userKey || "";
	const match = raw.match(/#relay:([^:#]+):([^#]+)$/i);
	if (!match) return null;
	return {
		siteKey: match[1],
		userId: match[2],
	};
});

const matrixUserId = $derived.by(() => {
	if (!seed?.userKey) return "";
	const base = seed.userKey.split("#")[0] || seed.userKey;
	if (base.startsWith("matrix:")) {
		return base.slice("matrix:".length);
	}
	if (base.startsWith("@") && base.includes(":")) {
		return base;
	}
	return "";
});

const isExternalUser = $derived.by(() => {
	if (matrixUserId) return true;
	if (!seed?.userKey) return false;
	return isExternalMatrixIdentity(seed);
});

const isSpectator = $derived.by(() => {
	if (!seed?.userKey) return false;
	return (
		seed.userKey.startsWith("spectator") ||
		seed.userKey.startsWith("observer") ||
		seed.userKey.startsWith("spec_") ||
		seed.badge === "旁观" ||
		seed.badge === "历史访客"
	);
});

function formatConnectedDuration(ts?: number): string {
	if (!ts) return "刚刚进入";
	const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
	if (diffSec < 60) return `已停留 ${diffSec} 秒`;
	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return `已在线 ${diffMin} 分钟`;
	const diffHour = Math.floor(diffMin / 60);
	return `已在线 ${diffHour} 小时 ${diffMin % 60} 分钟`;
}

function formatSecondsDuration(sec?: number): string {
	if (!sec || sec < 0) return "0 秒";
	if (sec < 60) return `${sec} 秒`;
	if (sec < 3600) return `${Math.floor(sec / 60)} 分钟 ${sec % 60} 秒`;
	return `${Math.floor(sec / 3600)} 小时 ${Math.floor((sec % 3600) / 60)} 分钟`;
}

function formatFullDate(ts?: number): string {
	if (!ts) return "未知时间";
	const d = new Date(ts);
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	const hh = String(d.getHours()).padStart(2, "0");
	const min = String(d.getMinutes()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

// 每条日志代表这个人的一次点歌；日志里的 requestCount 是全站次数。
function aggregateRequestedTracks(
	logs: ChatUserRequestedTrackItem[],
): ChatUserRequestedTrackItem[] {
	const tracks = new Map<string, ChatUserRequestedTrackItem>();
	for (const log of logs) {
		const key = log.track.id;
		const previous = tracks.get(key);
		if (!previous) {
			tracks.set(key, { ...log, requestCount: 1 });
		} else {
			previous.requestCount += 1;
			if (log.requestedAt > previous.requestedAt) {
				previous.track = log.track;
				previous.requestedAt = log.requestedAt;
				previous.logId = log.logId;
			}
		}
	}
	return [...tracks.values()].sort((a, b) => b.requestedAt - a.requestedAt);
}

const fallbackData = $derived.by<{
	profile: ChatUserDetailProfile;
	allTracks: ChatUserRequestedTrackItem[];
	topTracks: ChatUserTopTrackItem[];
	topArtists: ChatUserTopArtistItem[];
	recentMessages: ChatUserRecentMessage[];
} | null>(() => {
	if (!seed) return null;
	if (isSpectator) {
		const isOnline = seed.online !== false;
		const spectatorProfile: ChatUserDetailProfile = {
			userKey: seed.userKey,
			name: seed.name || (isOnline ? "旁观者" : "历史访客"),
			avatar: seed.avatar || "",
			authType: "guest",
			badge: isOnline ? "旁观" : "历史访客",
			badgeType: "tag",
			status: seed.status || (isOnline ? "只读旁观" : "已离线"),
			bio: seed.bio || (isOnline ? "正在只读浏览聊天室" : "曾访问聊天室"),
			location: seed.location || "",
			online: isOnline,
			isFocused: isOnline ? seed.isFocused !== false : false,
			lastSeenAt: seed.disconnectedAt || seed.connectedAt || Date.now(),
		};
		return {
			profile: spectatorProfile,
			allTracks: [],
			topTracks: [],
			topArtists: [],
			recentMessages: [],
		};
	}
	const onlineMatch = onlineMembers.find((m) => m.userKey === seed.userKey);
	const isSelf = Boolean(
		currentUser?.userKey &&
			currentUser.userKey === seed.userKey &&
			!isExternalUser &&
			!matrixUserId &&
			!seed.userKey.startsWith("matrix:") &&
			!seed.userKey.startsWith("@"),
	);
	const selfUser = isSelf ? currentUser : null;
	const userMessages = messages.filter(
		(m) => m.kind === "user" && m.userKey === seed.userKey,
	);
	const latestMsg = userMessages[userMessages.length - 1];

	const authType: "waline" | "guest" =
		onlineMatch?.authType ??
		selfUser?.authType ??
		seed.authType ??
		(seed.userKey.startsWith("waline:") ? "waline" : "guest");
	const isAdmin = Boolean(
		onlineMatch?.isAdmin ??
			selfUser?.isAdmin ??
			seed.isAdmin ??
			latestMsg?.isAdmin,
	);
	const badge = isAdmin
		? "站长"
		: seed.badge ||
			onlineMatch?.badge ||
			(authType === "waline" ? "认证" : "访客");
	const badgeType = isAdmin
		? "host"
		: seed.badgeType ||
			onlineMatch?.badgeType ||
			(authType === "waline" ? "accent" : "tag");

	const userLogs = musicHistoryLogs.filter(
		(l) => l.requesterKey === seed.userKey,
	);
	const allTracks = aggregateRequestedTracks(
		userLogs.map((log) => ({
			logId: log.id,
			track: log.track,
			requestedAt: log.requestedAt,
			requestCount: 1,
		})),
	);

	const topMap = new Map<string, ChatUserTopTrackItem>();
	const artistMap = new Map<string, number>();
	for (const log of userLogs) {
		const prev = topMap.get(log.track.id);
		if (prev) {
			prev.requestCount += 1;
			if (log.requestedAt > prev.lastRequestedAt) {
				prev.lastRequestedAt = log.requestedAt;
			}
		} else {
			topMap.set(log.track.id, {
				track: log.track,
				requestCount: 1,
				lastRequestedAt: log.requestedAt,
			});
		}
		const artist = (log.track.artist || "").trim();
		if (artist && artist !== "未知歌手") {
			artistMap.set(artist, (artistMap.get(artist) ?? 0) + 1);
		}
	}

	const topTracks = Array.from(topMap.values())
		.sort(
			(a, b) =>
				b.requestCount - a.requestCount ||
				b.lastRequestedAt - a.lastRequestedAt,
		)
		.slice(0, 50);

	const topArtists = Array.from(artistMap.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([artist, count]) => ({ artist, count }));

	const recentMessages: ChatUserRecentMessage[] = userMessages
		.slice(-10)
		.reverse()
		.map((m) => ({
			msgUid: m.msgUid,
			content: m.content,
			hasImage: Array.isArray(m.attachments) && m.attachments.length > 0,
			createdAt: m.createdAt,
		}));

	return {
		profile: {
			userKey: seed.userKey,
			authType,
			name:
				onlineMatch?.name ||
				selfUser?.name ||
				seed.name ||
				latestMsg?.name ||
				"房友",
			avatar:
				onlineMatch?.avatar ||
				selfUser?.avatar ||
				seed.avatar ||
				latestMsg?.avatar ||
				"",
			url:
				onlineMatch?.url || selfUser?.url || seed.url || latestMsg?.url || "",
			badge,
			badgeType,
			customBadges:
				onlineMatch?.customBadges ??
				selfUser?.customBadges ??
				seed.customBadges ??
				latestMsg?.customBadges ??
				[],
			isAdmin,
			online: Boolean(onlineMatch ?? seed.online),
			isFocused: onlineMatch
				? onlineMatch.isFocused !== false
				: seed.isFocused !== false,
			presenceMode: onlineMatch?.presenceMode ?? seed.presenceMode,
			status: cleanCustomStatus(
				onlineMatch?.status || selfUser?.status || seed.status,
			),
			bio: onlineMatch?.bio ?? selfUser?.bio ?? seed.bio ?? "",
			location:
				onlineMatch?.location || selfUser?.location || seed.location || "",
			firstSeenAt: userMessages[0]?.createdAt || 0,
			lastSeenAt: onlineMatch ? Date.now() : latestMsg?.createdAt || 0,
			matrixUser:
				onlineMatch?.matrixUser ||
				selfUser?.matrixUser ||
				seed.matrixUser ||
				(isAdmin ? "lengxiqwq" : null),
			matrixId:
				onlineMatch?.matrixId ||
				selfUser?.matrixId ||
				seed.matrixId ||
				(isAdmin ? "@lengxiqwq:matrix.lengxiqwq.com" : null),
			matrixServer:
				onlineMatch?.matrixServer ||
				selfUser?.matrixServer ||
				seed.matrixServer ||
				"matrix.lengxiqwq.com",
			stats: {
				messageCount: userMessages.length,
				songRequestCount: userLogs.length,
			},
			recentTracks: allTracks.slice(0, TRACK_PAGE_SIZE),
			tracksHasMore: allTracks.length > TRACK_PAGE_SIZE,
			tracksNextBeforeId: 0,
			topTracks,
			topArtists,
			recentMessages,
			playlists: [],
		},
		allTracks,
		topTracks,
		topArtists,
		recentMessages,
	};
});

const profile = $derived(remoteProfile ?? fallbackData?.profile ?? null);

const localMatrixInfo = $derived.by<{
	username: string;
	matrixId: string;
	server: string;
} | null>(() => {
	if (roomId !== "interconnect") return null;
	if (isExternalUser || matrixUserId || isSpectator) return null;

	const targetKey = profile?.userKey || seed?.userKey || "";
	if (!targetKey) return null;

	const pMatrixId = remoteProfile?.matrixId || profile?.matrixId;
	const pMatrixUser = remoteProfile?.matrixUser || profile?.matrixUser;
	const pMatrixServer = remoteProfile?.matrixServer || profile?.matrixServer;

	const onlineMatch = onlineMembers.find((m) => m.userKey === targetKey);
	const omMatrixId = onlineMatch?.matrixId;
	const omMatrixUser = onlineMatch?.matrixUser;
	const omMatrixServer = onlineMatch?.matrixServer;

	const sMatrixId = seed?.matrixId;
	const sMatrixUser = seed?.matrixUser;
	const sMatrixServer = seed?.matrixServer;

	const isAdmin = Boolean(
		profile?.isAdmin ||
			seed?.isAdmin ||
			onlineMatch?.isAdmin ||
			(currentUser?.isAdmin && currentUser?.userKey === targetKey) ||
			targetKey === "waline:1",
	);

	let matrixId = pMatrixId || omMatrixId || sMatrixId || "";
	let username = pMatrixUser || omMatrixUser || sMatrixUser || "";
	let server = pMatrixServer || omMatrixServer || sMatrixServer || "";

	if (isAdmin) {
		if (!username) username = "lengxiqwq";
		if (!server) server = "matrix.lengxiqwq.com";
		if (!matrixId) matrixId = `@${username}:${server}`;
	} else {
		const qwqMatch = targetKey.match(/qwq(\d+)/i);
		if (!username && qwqMatch) {
			username = qwqMatch[0].toLowerCase();
		}
		if (!server) {
			if (matrixId?.includes(":")) {
				server = matrixId.split(":")[1] || "matrix.lengxiqwq.com";
			} else {
				server = "matrix.lengxiqwq.com";
			}
		}
		if (!matrixId && username) {
			matrixId = `@${username}:${server}`;
		}
	}

	if (!username && matrixId) {
		username = matrixId.split(":")[0].replace(/^@/, "");
	}
	if (!server && matrixId?.includes(":")) {
		server = matrixId.split(":")[1] || "matrix.lengxiqwq.com";
	}

	if (!username && !matrixId) {
		if (isLoading) {
			return {
				username: "同步中...",
				matrixId: "",
				server: "matrix.lengxiqwq.com",
			};
		}
		return null;
	}

	return {
		username: username || "待分配",
		matrixId:
			matrixId ||
			(username ? `@${username}:${server || "matrix.lengxiqwq.com"}` : ""),
		server: server || "matrix.lengxiqwq.com",
	};
});
let managedBadges = $state<ChatCustomBadge[]>([]);
let isSavingBadges = $state(false);
let badgeSaveNotice = $state("");
let managedInitUserKey = "";
let managedSyncedRemote = false;
let managedDirty = false;

$effect(() => {
	if (!open) {
		managedInitUserKey = "";
		managedSyncedRemote = false;
		managedDirty = false;
		badgeSaveNotice = "";
		return;
	}
	if (!profile) return;
	if (managedInitUserKey !== profile.userKey) {
		managedInitUserKey = profile.userKey;
		managedSyncedRemote = Boolean(remoteProfile);
		managedDirty = false;
		managedBadges = (profile.customBadges || []).map((b) => ({ ...b }));
		badgeSaveNotice = "";
	} else if (remoteProfile && !managedSyncedRemote && !managedDirty) {
		managedSyncedRemote = true;
		managedBadges = (remoteProfile.customBadges || []).map((b) => ({ ...b }));
	}
});

const effectiveCustomBadges = $derived.by<ChatCustomBadge[]>(() => {
	return profile?.customBadges ?? [];
});

async function handleSaveBadges() {
	if (
		!profile ||
		!currentUser?.isAdmin ||
		isExternalUser ||
		matrixUserId ||
		profile.userKey.startsWith("matrix:") ||
		profile.userKey.startsWith("@")
	) {
		return;
	}
	const sanitized: ChatCustomBadge[] = managedBadges
		.map((b) => ({
			text: (b.text || "").trim().slice(0, 8),
			color: b.color === "gold" ? ("gold" as const) : ("gray" as const),
		}))
		.filter((b) => Boolean(b.text))
		.slice(0, 3);

	isSavingBadges = true;
	badgeSaveNotice = "";
	try {
		let ok = false;
		if (onUpdateMemberBadges) {
			ok = await onUpdateMemberBadges(profile.userKey, sanitized);
		} else {
			const walineToken = readStoredWalineToken();
			ok = await saveMemberBadges(
				chatServerUrl,
				roomId,
				profile.userKey,
				sanitized,
				walineToken,
			);
		}
		if (ok) {
			if (remoteProfile) {
				remoteProfile = {
					...remoteProfile,
					customBadges: sanitized,
				};
			}
			userDetailCache.delete(`${roomId}:${profile.userKey}`);
			managedDirty = false;
			managedBadges = sanitized.map((b) => ({ ...b }));
			badgeSaveNotice = "头衔已更新";
			setTimeout(() => {
				if (badgeSaveNotice === "头衔已更新") {
					badgeSaveNotice = "";
				}
			}, 3000);
		} else {
			badgeSaveNotice = "保存失败，请重试";
		}
	} catch {
		badgeSaveNotice = "网络异常，保存失败";
	} finally {
		isSavingBadges = false;
	}
}

function handleAddBadge() {
	if (managedBadges.length >= 3) return;
	managedDirty = true;
	managedBadges = [...managedBadges, { text: "", color: "gold" }];
}

function handleRemoveBadge(index: number) {
	managedDirty = true;
	managedBadges = managedBadges.filter((_, i) => i !== index);
}

const isSelf = $derived(
	Boolean(
		currentUser &&
			profile &&
			currentUser.userKey === profile.userKey &&
			!isExternalUser &&
			!matrixUserId &&
			!profile.userKey.startsWith("matrix:") &&
			!profile.userKey.startsWith("@"),
	),
);
const displayedTracks = $derived.by<ChatUserRequestedTrackItem[]>(() => {
	if (remoteProfile)
		return aggregateRequestedTracks(remoteTracks).slice(0, localVisibleLimit);
	return (fallbackData?.allTracks ?? []).slice(0, localVisibleLimit);
});
const topTracks = $derived.by<ChatUserTopTrackItem[]>(() => {
	if (remoteProfile)
		return aggregateRequestedTracks(remoteTracks)
			.map((item) => ({
				track: item.track,
				requestCount: item.requestCount,
				lastRequestedAt: item.requestedAt,
			}))
			.sort(
				(a, b) =>
					b.requestCount - a.requestCount ||
					b.lastRequestedAt - a.lastRequestedAt,
			)
			.slice(0, 50);
	return fallbackData?.topTracks ?? [];
});
const topArtists = $derived.by<ChatUserTopArtistItem[]>(() => {
	if (remoteProfile?.topArtists) return remoteProfile.topArtists;
	return fallbackData?.topArtists ?? [];
});
const recentMessages = $derived.by<ChatUserRecentMessage[]>(() => {
	if (
		remoteProfile?.recentMessages &&
		remoteProfile.recentMessages.length > 0
	) {
		return remoteProfile.recentMessages;
	}
	return fallbackData?.recentMessages ?? [];
});
const hasMoreTracks = $derived.by<boolean>(() => {
	if (trackTab !== "recent") return false;
	if (remoteProfile)
		return (
			remoteHasMore ||
			aggregateRequestedTracks(remoteTracks).length > localVisibleLimit
		);
	return (fallbackData?.allTracks.length ?? 0) > localVisibleLimit;
});
const totalSongCount = $derived.by<number>(() => {
	if (!profile) return 0;
	return remoteProfile
		? aggregateRequestedTracks(remoteTracks).length
		: (fallbackData?.allTracks.length ?? 0);
});

$effect(() => {
	const currentOpen = open;
	const targetUserKey = seed?.userKey ?? "";
	const targetRoom = roomId;
	const targetServerUrl = chatServerUrl;
	const externalSkip = untrack(
		() =>
			matrixUserId ||
			isExternalUser ||
			isSpectator ||
			targetUserKey.startsWith("matrix:") ||
			targetUserKey.startsWith("@") ||
			targetUserKey.startsWith("name:") ||
			targetUserKey === "system:fallback",
	);

	localVisibleLimit = TRACK_PAGE_SIZE;
	remoteTracks = [];
	remoteHasMore = false;
	remoteNextBeforeId = 0;
	isLoadingMore = false;
	tracksLoadFailed = false;
	trackTab = "recent";
	lockedMinHeight = 0;

	if (!currentOpen || !targetUserKey) {
		remoteProfile = null;
		isLoading = false;
		return;
	}

	remoteProfile = null;
	if (externalSkip) {
		isLoading = false;
		return;
	}

	const detailCacheKey = `${targetRoom}:${targetUserKey}`;
	const cachedEntry = userDetailCache.get(detailCacheKey);

	if (cachedEntry) {
		const liveOnline = untrack(() =>
			onlineMembers.find((m) => m.userKey === targetUserKey),
		);
		const seedOnline = untrack(() => seed?.online);
		const seedPresence = untrack(() => seed?.presenceMode);
		const isWaline = targetUserKey.startsWith("waline:");
		const mergedProfile: ChatUserDetailProfile = {
			...cachedEntry.profile,
			authType: isWaline ? "waline" : cachedEntry.profile.authType,
			badge:
				isWaline && cachedEntry.profile.badge === "访客"
					? "认证"
					: cachedEntry.profile.badge || (isWaline ? "认证" : "访客"),
			badgeType:
				isWaline && cachedEntry.profile.badgeType === "tag"
					? "accent"
					: cachedEntry.profile.badgeType || (isWaline ? "accent" : "tag"),
			name: liveOnline?.name || cachedEntry.profile.name,
			avatar: liveOnline?.avatar || cachedEntry.profile.avatar,
			url: liveOnline?.url ?? cachedEntry.profile.url,
			status: cleanCustomStatus(
				liveOnline?.status || cachedEntry.profile.status,
			),
			bio: liveOnline?.bio ?? cachedEntry.profile.bio,
			location: liveOnline?.location || cachedEntry.profile.location,
			online: Boolean(liveOnline ?? seedOnline),
			isFocused: liveOnline
				? liveOnline.isFocused !== false
				: cachedEntry.profile.isFocused,
			presenceMode:
				liveOnline?.presenceMode ??
				cachedEntry.profile.presenceMode ??
				seedPresence,
		};
		remoteProfile = mergedProfile;
		remoteTracks = mergedProfile.recentTracks ?? [];
		remoteHasMore = Boolean(mergedProfile.tracksHasMore);
		remoteNextBeforeId = Number(mergedProfile.tracksNextBeforeId || 0);
	}

	let cancelled = false;
	isLoading = true;
	void fetchUserDetailProfile(
		targetServerUrl,
		targetRoom,
		targetUserKey,
		TRACK_PAGE_SIZE,
		readStoredWalineToken(),
	).then((res) => {
		if (cancelled) return;
		isLoading = false;
		if (res) {
			userDetailCache.set(detailCacheKey, {
				profile: res,
				fetchedAt: Date.now(),
			});
			remoteProfile = res;
			remoteTracks = res.recentTracks ?? [];
			remoteHasMore = Boolean(res.tracksHasMore);
			remoteNextBeforeId = Number(res.tracksNextBeforeId || 0);
		}
	});
	return () => {
		cancelled = true;
	};
});

async function loadMoreTracks() {
	if (
		isLoading ||
		isLoadingMore ||
		!(remoteProfile ? remoteHasMore || hasMoreTracks : hasMoreTracks) ||
		!seed?.userKey
	) {
		return;
	}
	if (!remoteProfile || !remoteHasMore) {
		localVisibleLimit += TRACK_PAGE_SIZE;
		return;
	}
	if (remoteNextBeforeId <= 0) {
		tracksLoadFailed = true;
		return;
	}
	const targetKey = seed.userKey;
	const targetRoom = roomId;
	const targetProfile = remoteProfile;
	tracksLoadFailed = false;
	isLoadingMore = true;
	try {
		const page = await fetchUserDetailTracks(
			chatServerUrl,
			roomId,
			targetKey,
			remoteNextBeforeId,
			TRACK_PAGE_SIZE,
		);
		if (
			!open ||
			seed?.userKey !== targetKey ||
			roomId !== targetRoom ||
			remoteProfile !== targetProfile
		)
			return;
		if (
			!page ||
			(page.hasMore &&
				(page.nextBeforeId <= 0 || page.nextBeforeId >= remoteNextBeforeId))
		) {
			tracksLoadFailed = true;
			return;
		}
		const seenLogIds = new Set(
			remoteTracks
				.map((item) => item.logId)
				.filter((id): id is number => typeof id === "number" && id > 0),
		);
		const appended = page.items.filter(
			(item) => !item.logId || !seenLogIds.has(item.logId),
		);
		remoteTracks = [...remoteTracks, ...appended];
		remoteHasMore = page.hasMore && page.nextBeforeId > 0;
		remoteNextBeforeId = page.nextBeforeId;
	} finally {
		if (
			seed?.userKey === targetKey &&
			roomId === targetRoom &&
			remoteProfile === targetProfile
		) {
			isLoadingMore = false;
		}
	}
}

// 读取全部分页后才能统计每首歌的真实个人次数。
$effect(() => {
	if (
		open &&
		remoteProfile &&
		remoteHasMore &&
		!isLoading &&
		!isLoadingMore &&
		!tracksLoadFailed
	) {
		void loadMoreTracks();
	}
});

function handleSwitchTrackTab(nextTab: "recent" | "top") {
	if (nextTab === trackTab) return;
	const cardEl = bodyContainerEl?.closest(
		".chat-dialog-card",
	) as HTMLElement | null;
	if (cardEl) {
		const currentHeight = Math.round(cardEl.getBoundingClientRect().height);
		if (currentHeight > lockedMinHeight) {
			lockedMinHeight = currentHeight;
		}
	}
	trackTab = nextTab;
}

function handleScrollNearBottom(el: HTMLElement) {
	if (trackTab !== "recent" || !hasMoreTracks || isLoadingMore) return;
	if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) {
		void loadMoreTracks();
	}
}

function formatJoinTime(ts: number): string {
	if (!ts) return "近期来访";
	const d = new Date(ts);
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

function cleanCustomStatus(status?: string | null): string {
	const trimmed = (status ?? "").trim();
	return trimmed === "在线" ? "" : trimmed;
}

function formatLastSeen(ts: number): string {
	if (!ts) return "离线";
	const diff = Date.now() - ts;
	if (diff < 60_000) return "刚刚活跃";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前活跃`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前活跃`;
	const d = new Date(ts);
	return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} 活跃`;
}

function formatActiveStat(online: boolean, ts: number): string {
	if (online) return "在线中";
	if (!ts) return "离线";
	const diff = Date.now() - ts;
	if (diff < 60_000) return "刚刚";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
	const d = new Date(ts);
	return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTrackTime(ts: number): string {
	if (!ts) return "";
	const d = new Date(ts);
	const now = new Date();
	const hh = String(d.getHours()).padStart(2, "0");
	const min = String(d.getMinutes()).padStart(2, "0");
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	if (d.toDateString() === now.toDateString()) {
		return `今天 ${hh}:${min}`;
	}
	if (d.getFullYear() === now.getFullYear()) {
		return `${mm}-${dd} ${hh}:${min}`;
	}
	return `${d.getFullYear()}-${mm}-${dd}`;
}

function formatMessageSummary(msg: ChatUserRecentMessage): string {
	const text = (msg.content || "").replace(/\s+/g, " ").trim();
	if (text) return text;
	return msg.hasImage ? "[发送了图片]" : "[消息]";
}
</script>

<ChatModal
  open={open && Boolean(profile || matrixUserId || isExternalUser || (isSpectator && currentUser?.isAdmin))}
  title="成员名片"
  mobile="expandable"
  ariaLabel={seed ? `${seed.name} 的个人资料` : "成员名片"}
  size={matrixUserId || isExternalUser || isSpectator ? "md" : "lg"}
  fillHeightOnDesktop={!(matrixUserId || isExternalUser || isSpectator)}
  topPriority={true}
  {lockedMinHeight}
  {onClose}
>
  {#snippet headerExtra()}
    {#if isLoading}
      <span class="text-[11px] text-[var(--chat-meta-color)] shrink-0">同步中...</span>
    {/if}
  {/snippet}

  {#if (matrixUserId || isExternalUser) && seed}
    {@const origin = resolveExternalOrigin({ name: seed.name, userKey: seed.userKey, badge: seed.badge, site: seed.site, siteUrl: seed.siteUrl, url: seed.url }, interconnectSites)}
    {@const cleanName = origin.cleanName || seed.name}
    {@const matchedSite = origin.site}
    {@const userMessages = messages.filter((m) => m.kind === "user" && m.userKey === seed.userKey)}
    {@const onlineMatch = onlineMembers.find((m) => m.userKey === seed.userKey)}
    {@const isOnline = Boolean(onlineMatch ?? seed.online)}
    {@const firstSeenAt = userMessages[0]?.createdAt || 0}
    {@const latestMsg = userMessages[userMessages.length - 1]}
    {@const lastSeenAt = onlineMatch ? Date.now() : (latestMsg?.createdAt || 0)}
    {@const recentMsgs = userMessages.slice(-5).reverse()}
    {@const canMentionExternal = Boolean(currentUser) && roomId === "interconnect"}
    {@const extFullId = matrixUserId || seed.userKey}

    <div class="flex-1 overflow-y-auto custom-scrollbar p-3.5 sm:p-4 space-y-3 min-h-0">
      <!-- 1. 顶部身份卡片 -->
      <div class="rounded-xl bg-(--btn-regular-bg) p-3 border border-black/5 dark:border-white/10 space-y-2.5">
        <div class="flex items-center gap-3">
          <div class="relative shrink-0">
            <ChatAvatar
              src={seed.avatar}
              alternateSrc={onlineMatch?.avatar || latestMsg?.avatar}
              name={cleanName}
              size="lg"
            />
            {#if isOnline}
              {@const extModalFocused = onlineMatch ? onlineMatch.isFocused !== false : (profile?.isFocused !== false)}
              {@const extPresenceMode = onlineMatch?.presenceMode ?? profile?.presenceMode ?? seed.presenceMode}
              {@const isExtFallback = extPresenceMode === "fallback"}
              <span
                title={isExtFallback ? "在线" : extModalFocused ? "在线" : "离开"}
                class="chat-online-dot {isExtFallback ? 'chat-online-dot--fallback' : extModalFocused ? '' : 'chat-online-dot--away'} absolute -bottom-0.5 -right-0.5 border-[1.5px] border-white/80 dark:border-neutral-900/80"
              ></span>
            {/if}
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-base font-bold text-[var(--deep-text)] dark:text-white/90 break-words">
                {cleanName}
              </span>
              <span class="chat-role-badge chat-role-badge--tag">🍵 互联茶友</span>
              {#if seed.customBadges && seed.customBadges.length > 0}
                {#each seed.customBadges as b, idx (`${b.text}:${idx}`)}
                  <span class="chat-role-badge chat-role-badge--{b.color}">{b.text}</span>
                {/each}
              {/if}
            </div>
            <div class="flex items-center gap-1.5 text-xs text-[var(--chat-meta-color)] mt-0.5 flex-wrap">
              {#if !isOnline}
                <span>{formatLastSeen(lastSeenAt)}</span>
                <span>·</span>
              {:else if (onlineMatch?.presenceMode ?? profile?.presenceMode ?? seed.presenceMode) !== "fallback" && (onlineMatch ? onlineMatch.isFocused === false : profile?.isFocused === false)}
                <span>离开</span>
                <span>·</span>
              {/if}
              <span>Matrix 联邦中继</span>
            </div>
          </div>

          <!-- @该茶友 快捷按钮（互联茶室且已登录时可用） -->
          <button
            type="button"
            disabled={!canMentionExternal}
            class={canMentionExternal
              ? "chat-send-btn px-3! py-1.5! h-auto! rounded-lg! text-xs! shrink-0 flex items-center gap-1 cursor-pointer"
              : "px-2.5 py-1.5 text-xs text-[var(--chat-meta-color)] bg-black/5 dark:bg-white/5 rounded-lg shrink-0 flex items-center gap-1 cursor-not-allowed opacity-50 border-none select-none"}
            aria-label={canMentionExternal
              ? `在聊天中提及 ${cleanName}`
              : !currentUser
                ? "登录后即可提及茶友"
                : "仅互联茶室可提及"}
            onclick={() => {
              if (!canMentionExternal) return;
              onClose();
              onMention(cleanName, seed.userKey);
            }}
          >
            {#if canMentionExternal}
              <span>@ {cleanName}</span>
            {:else if !currentUser}
              <span>登录后可提及</span>
            {:else}
              <span>仅互联茶室可提及</span>
            {/if}
          </button>
        </div>
      </div>

      <!-- 2. 🍵 归属互联茶室 / 博客卡片 -->
      <div class="rounded-xl bg-(--btn-regular-bg) p-3 border border-black/5 dark:border-white/10 space-y-2">
        <div class="flex items-center justify-between text-xs font-semibold text-[var(--chat-meta-color)]">
          <span class="flex items-center gap-1.5">
            <span>🍵</span>
            <span>归属互联茶室</span>
          </span>
          {#if matchedSite?.owner}
            <span class="text-[0.6875rem] font-normal opacity-75">
              站长: {matchedSite.owner}
            </span>
          {/if}
        </div>

        <div class="flex items-center justify-between gap-3 bg-black/3 dark:bg-white/5 p-2.5 rounded-lg border border-black/5 dark:border-white/5">
          <div class="flex items-center gap-2.5 min-w-0">
            {#if matchedSite?.avatar}
              <img
                src={matchedSite.avatar}
                alt={matchedSite.name}
                class="w-8 h-8 rounded-full object-cover shrink-0"
              />
            {:else}
              <div class="w-8 h-8 rounded-full bg-(--primary)/15 text-[var(--chat-accent-text)] flex items-center justify-center font-bold text-xs shrink-0">
                🍵
              </div>
            {/if}
            <div class="min-w-0">
              <div class="font-bold text-xs text-[var(--deep-text)] dark:text-white/90 truncate">
                {origin.siteName}
              </div>
              <div class="text-[0.6875rem] text-[var(--chat-meta-color)] truncate">
                {matchedSite?.desc || `来自 ${origin.siteName} 互联聊天节点`}
              </div>
            </div>
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            {#if matchedSite?.siteUrl || seed.url}
              <a
                href={matchedSite?.siteUrl || seed.url}
                target="_blank"
                rel="noopener noreferrer"
                class="chat-btn-ghost px-2.5 py-1 text-xs shrink-0 text-[var(--chat-accent-text)] bg-(--primary)/10 hover:bg-(--primary)/20 rounded-lg no-underline font-medium transition-colors inline-flex items-center gap-0.5"
                title="访问对方网站主页"
              >
                <span>访问主页</span>
                <span class="text-[10px] opacity-70">↗</span>
              </a>
            {/if}
            {#if matchedSite?.chatUrl && matchedSite.chatUrl !== matchedSite.siteUrl}
              <a
                href={matchedSite.chatUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="chat-btn-ghost px-2.5 py-1 text-xs shrink-0 text-[var(--chat-meta-color)] hover:text-[var(--chat-accent-text)] bg-black/5 dark:bg-white/10 hover:bg-(--primary)/15 rounded-lg no-underline font-medium transition-colors inline-flex items-center gap-0.5"
                title="前往对方公开茶室"
              >
                <span>前往茶室</span>
                <span class="text-[10px] opacity-70">↗</span>
              </a>
            {/if}
          </div>
        </div>
      </div>

      <!-- 3. 足迹统计与联邦网络信息 -->
      <div class="rounded-xl bg-(--btn-regular-bg) p-3 border border-black/5 dark:border-white/10">
        <div class="grid grid-cols-2 gap-2 text-center">
          <div class="bg-black/3 dark:bg-white/5 p-2 rounded-lg">
            <div class="text-[0.6875rem] text-[var(--chat-meta-color)]">茶室发言</div>
            <div class="font-bold text-sm text-[var(--deep-text)] dark:text-white/90 mt-0.5">
              {userMessages.length} 条
            </div>
          </div>
          <div class="bg-black/3 dark:bg-white/5 p-2 rounded-lg">
            <div class="text-[0.6875rem] text-[var(--chat-meta-color)]">初次相识</div>
            <div class="font-bold text-sm text-[var(--deep-text)] dark:text-white/90 mt-0.5 truncate">
              {firstSeenAt ? formatJoinTime(firstSeenAt) : "本次会话"}
            </div>
          </div>
        </div>

        <div class="mt-2.5 pt-2 border-t border-[var(--chat-divider-color)]/60 text-[0.6875rem] text-[var(--chat-meta-color)] space-y-1">
          <div class="flex items-center justify-between gap-2">
            <span class="shrink-0">{relayOriginInfo ? "代发节点:" : "Matrix 账号:"}</span>
            <a
              href={`https://matrix.to/#/${encodeURIComponent(extFullId)}`}
              target="_blank"
              rel="noopener noreferrer"
              class="text-[var(--chat-accent-text)] hover:underline truncate font-mono"
            >
              {extFullId}
            </a>
          </div>
          {#if relayOriginInfo && !relayOriginInfo.userId.startsWith("n_")}
            <div class="flex items-center justify-between gap-2">
              <span class="shrink-0">原站用户 ID:</span>
              <span class="truncate">{relayOriginInfo.userId}</span>
            </div>
          {/if}
          {#if origin.host}
            <div class="flex items-center justify-between gap-2">
              <span class="shrink-0">服务器:</span>
              <span class="truncate font-mono">{origin.host}</span>
            </div>
          {/if}
        </div>
      </div>

      <!-- 4. 最近茶室发言 -->
      <div class="rounded-xl bg-(--btn-regular-bg) p-3.5 border border-black/5 dark:border-white/10 space-y-2">
        <div class="text-xs font-semibold text-[var(--chat-meta-color)] flex items-center justify-between">
          <span>最近在茶室说了什么</span>
          <span class="text-[0.6875rem] font-normal opacity-75">
            共 {userMessages.length} 条
          </span>
        </div>

        {#if recentMsgs.length === 0}
          <div class="py-4 text-center text-xs text-[var(--chat-meta-color)]">
            该茶友在当前加载记录中暂无发言~
          </div>
        {:else}
          <div class="space-y-1.5">
            {#each recentMsgs as m (m.msgUid)}
              <div class="flex items-center justify-between gap-2 p-2 rounded-lg bg-black/3 dark:bg-white/5 hover:bg-black/5 dark:hover:bg-white/8 transition-colors">
                <div class="min-w-0 flex-1">
                  <div class="text-xs text-[var(--deep-text)] dark:text-white/90 truncate">
                    {m.content || (Array.isArray(m.attachments) && m.attachments.length > 0 ? "[发送了图片]" : "...")}
                  </div>
                  <div class="text-[0.625rem] text-[var(--chat-meta-color)] mt-0.5">
                    {formatTrackTime(m.createdAt)}
                  </div>
                </div>
                {#if onJumpToMessage}
                  <button
                    type="button"
                    class="text-[0.6875rem] text-[var(--chat-accent-text)] hover:underline shrink-0 px-1 py-0.5 border-none bg-transparent cursor-pointer"
                    onclick={() => {
                      onJumpToMessage(m.msgUid);
                      onClose();
                    }}
                  >
                    定位 ↑
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {:else if isSpectator && seed}
    {@const isOnline = seed.online !== false}
    {@const roomTitle = seed.roomId === "interconnect" ? "互联茶室" : seed.roomId === "chat" ? "闲聊" : (seed.roomId ? `#${seed.roomId}` : "当前房间")}
    {@const isFocused = isOnline && seed.isFocused !== false}
    {@const visits = seed.totalVisits || seed.visitCount || 1}
    {@const isReturning = visits > 1}

    <div class="flex-1 overflow-y-auto custom-scrollbar p-3.5 sm:p-4 space-y-3 min-h-0">
      <!-- 1. 顶部身份卡片 -->
      <div class="rounded-xl bg-(--btn-regular-bg) p-3 border border-black/5 dark:border-white/10 space-y-2.5">
        <div class="flex items-center gap-3">
          <div class="relative shrink-0">
            <ChatAvatar
              src={seed.avatar}
              name={seed.userKey || seed.name || "旁观者"}
              size="lg"
            />
            {#if isOnline}
              <span
                class="chat-online-dot {isFocused ? '' : 'chat-online-dot--away'} absolute -bottom-0.5 -right-0.5 border-[1.5px] border-white/80 dark:border-neutral-900/80"
              ></span>
            {:else}
              <span
                class="w-2.5 h-2.5 rounded-full bg-neutral-400 absolute -bottom-0.5 -right-0.5 border-[1.5px] border-white/80 dark:border-neutral-900/80"
              ></span>
            {/if}
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-base font-bold text-[var(--deep-text)] dark:text-white/90 break-words">
                {seed.name || (isOnline ? "旁观者" : "历史访客")}
              </span>
              <span class="chat-role-badge chat-role-badge--tag">{isOnline ? "👁️ 旁观访客" : "🕒 历史访客"}</span>
              {#if isReturning && currentUser?.isAdmin}
                <span class="chat-role-badge chat-role-badge--accent">常客 · 第 {visits} 次来访</span>
              {/if}
            </div>
            <div class="flex items-center gap-1.5 text-xs text-[var(--chat-meta-color)] mt-0.5 flex-wrap">
              {#if isOnline}
                <span>当前在线</span>
                <span>·</span>
                <span>{isReturning ? `第 ${visits} 次来访` : "初次到访"}</span>
                <span>·</span>
                <span>{isFocused ? "窗口活跃浏览中" : "切至后台"}</span>
              {:else}
                <span>已离线离开</span>
                <span>·</span>
                <span>{isReturning ? `累计来访 ${visits} 次` : "初次到访"}</span>
                {#if seed.durationFormatted}
                  <span>·</span>
                  <span>本次停留 {seed.durationFormatted}</span>
                {/if}
                {#if seed.disconnectedAt}
                  <span>·</span>
                  <span>{formatLastSeen(seed.disconnectedAt)}</span>
                {/if}
              {/if}
            </div>
          </div>

          <!-- @提及 快捷按钮（未登录置灰禁用） -->
          <button
            type="button"
            disabled
            class="px-2.5 py-1.5 text-xs text-[var(--chat-meta-color)] bg-black/5 dark:bg-white/5 rounded-lg shrink-0 flex items-center gap-1 cursor-not-allowed opacity-50 border-none select-none"
            aria-label="旁观者未登录，暂不支持提及"
          >
            <span class="font-bold opacity-60">@</span>
            <span>未登录无法提及</span>
          </button>
        </div>
      </div>

      <!-- 2. 基本信息网格卡片 -->
      <div class="rounded-xl bg-(--btn-regular-bg) p-3 border border-black/5 dark:border-white/10 space-y-2">
        <div class="text-xs font-semibold text-[var(--chat-meta-color)] flex items-center gap-1.5">
          <span>📋</span>
          <span>{isOnline ? "访客在线与来访信息" : "历史访问足迹"}</span>
        </div>

        <div class="grid grid-cols-2 gap-2 text-xs">
          <!-- 所在/游历房间 -->
          <div class="bg-black/3 dark:bg-white/5 p-2.5 rounded-lg flex flex-col justify-between">
            <span class="text-[0.6875rem] text-[var(--chat-meta-color)] flex items-center gap-1">
              <span>📍</span>
              <span>{isOnline ? "当前所在房间" : "离开前所在房间"}</span>
            </span>
            <span class="font-bold text-sm text-[var(--deep-text)] dark:text-white/90 mt-1 truncate">
              {roomTitle}
            </span>
          </div>

          <!-- IP 属地 -->
          <div class="bg-black/3 dark:bg-white/5 p-2.5 rounded-lg flex flex-col justify-between">
            <span class="text-[0.6875rem] text-[var(--chat-meta-color)] flex items-center gap-1">
              <span>🌏</span>
              <span>IP 归属地</span>
            </span>
            <span class="font-bold text-sm text-[var(--deep-text)] dark:text-white/90 mt-1 truncate">
              {seed.location || "未知归属地"}
            </span>
          </div>

          <!-- 操作系统 -->
          <div class="bg-black/3 dark:bg-white/5 p-2.5 rounded-lg flex flex-col justify-between">
            <span class="text-[0.6875rem] text-[var(--chat-meta-color)] flex items-center gap-1">
              <span>💻</span>
              <span>操作系统</span>
            </span>
            <span class="font-bold text-xs text-[var(--deep-text)] dark:text-white/90 mt-1 truncate">
              {seed.device || "未知系统"}
            </span>
          </div>

          <!-- 来访频次与次数 -->
          <div class="bg-black/3 dark:bg-white/5 p-2.5 rounded-lg flex flex-col justify-between">
            <span class="text-[0.6875rem] text-[var(--chat-meta-color)] flex items-center gap-1">
              <span>🔢</span>
              <span>来访频次</span>
            </span>
            <span class="font-bold text-xs {isReturning ? 'text-(--primary)' : 'text-[var(--deep-text)] dark:text-white/90'} mt-1 truncate">
              {isReturning ? `累计来访 ${visits} 次` : "初次到访 (第 1 次)"}
            </span>
          </div>

          <!-- 本次停留时长 -->
          <div class="bg-black/3 dark:bg-white/5 p-2.5 rounded-lg flex flex-col justify-between">
            <span class="text-[0.6875rem] text-[var(--chat-meta-color)] flex items-center gap-1">
              <span>⏱️</span>
              <span>{isOnline ? "本次在线时长" : "本次停留时长"}</span>
            </span>
            <span class="font-bold text-xs text-[var(--deep-text)] dark:text-white/90 mt-1 truncate">
              {#if isOnline}
                {seed.connectedAt ? formatConnectedDuration(seed.connectedAt) : "刚刚进入"}
              {:else}
                {seed.durationFormatted || (seed.connectedAt ? formatConnectedDuration(seed.connectedAt) : "未知")}
              {/if}
            </span>
          </div>

          <!-- 累计在站时长 -->
          <div class="bg-black/3 dark:bg-white/5 p-2.5 rounded-lg flex flex-col justify-between">
            <span class="text-[0.6875rem] text-[var(--chat-meta-color)] flex items-center gap-1">
              <span>⏳</span>
              <span>累计停留时长</span>
            </span>
            <span class="font-bold text-xs text-[var(--deep-text)] dark:text-white/90 mt-1 truncate">
              {seed.totalDurationFormatted || (seed.totalDurationSec ? formatSecondsDuration(seed.totalDurationSec) : (seed.durationFormatted || (seed.connectedAt ? formatConnectedDuration(seed.connectedAt) : "本次即首次")))}
            </span>
          </div>

          <!-- 首次到访时间 -->
          <div class="bg-black/3 dark:bg-white/5 p-2.5 rounded-lg flex flex-col justify-between">
            <span class="text-[0.6875rem] text-[var(--chat-meta-color)] flex items-center gap-1">
              <span>📅</span>
              <span>首次到访</span>
            </span>
            <span class="font-bold text-xs text-[var(--deep-text)] dark:text-white/90 mt-1 truncate">
              {seed.firstSeenAt ? formatFullDate(seed.firstSeenAt) : "本次会话"}
            </span>
          </div>

          <!-- 点歌台广播收听状态 -->
          <div class="bg-black/3 dark:bg-white/5 p-2.5 rounded-lg flex flex-col justify-between">
            <span class="text-[0.6875rem] text-[var(--chat-meta-color)] flex items-center gap-1">
              <span>🎵</span>
              <span>点歌台收听</span>
            </span>
            <span class="font-bold text-xs {seed.isMuted === false ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--chat-meta-color)]'} mt-1 truncate">
              {#if isOnline}
                {seed.isMuted === false ? "正在收听广播" : "已静音"}
              {:else}
                {seed.isMuted === false ? "曾收听广播" : "未收听广播"}
              {/if}
            </span>
          </div>

          <!-- 浏览/连接状态 -->
          <div class="bg-black/3 dark:bg-white/5 p-2.5 rounded-lg flex flex-col justify-between col-span-2 sm:col-span-1">
            <span class="text-[0.6875rem] text-[var(--chat-meta-color)] flex items-center gap-1">
              <span>👀</span>
              <span>{isOnline ? "浏览状态" : "连接状态"}</span>
            </span>
            {#if isOnline}
              <span class="font-bold text-xs {isFocused ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'} mt-1 truncate">
                {isFocused ? "窗口活跃" : "离开 (后台)"}
              </span>
            {:else}
              <span class="font-bold text-xs text-[var(--chat-meta-color)] mt-1 truncate">
                已离线断开
              </span>
            {/if}
          </div>
        </div>

        {#if seed.roomsVisited && seed.roomsVisited.length > 0}
          <div class="mt-2.5 pt-2 border-t border-[var(--chat-divider-color)]/60 text-[0.6875rem] text-[var(--chat-meta-color)] flex items-center justify-between gap-2">
            <span class="shrink-0">游历房间:</span>
            <span class="truncate font-medium text-[var(--deep-text)] dark:text-white/80">
              {seed.roomsVisited.map((r) => (r === "interconnect" ? "互联茶室" : r === "chat" ? "闲聊" : r)).join("、")}
            </span>
          </div>
        {/if}
      </div>

      <!-- 3. 权限与状态说明 -->
      <div class="rounded-xl bg-(--btn-regular-bg) p-3 border border-black/5 dark:border-white/10 space-y-1.5 text-xs text-[var(--chat-meta-color)] leading-relaxed">
        <div class="font-semibold text-[var(--deep-text)] dark:text-white/90 flex items-center gap-1.5">
          <span>💡</span>
          <span>{isOnline ? "访客权限与来访记录" : "历史访客记录说明"}</span>
        </div>
        <p class="m-0 text-[11px] opacity-85">
          {#if isReturning}
            该访客为多次回访常客（已累计来访 {visits} 次，累计驻留 {seed.totalDurationFormatted || (seed.totalDurationSec ? formatSecondsDuration(seed.totalDurationSec) : '一段时间')}）。系统已持续关联其设备标识与访问足迹。
          {:else}
            {isOnline
              ? "该访客当前处于初次只读旁观状态，拥有聊天室消息实时查阅与点歌台广播同步收听权限。在聊天输入框登录或登记昵称后，即可参与发言和点歌互动。"
              : "该记录为访客离线前自动留存的访问足迹。系统已持久化归档其驻留时长、IP 归属地与游历房间，供回溯查阅。"}
          {/if}
        </p>
      </div>
    </div>
  {:else if profile}
    {@const safeProfileUrl = sanitizeChatUrl(profile.url, false)}
    {@const liveProfileOnline = onlineMembers.find((m) => m.userKey === profile.userKey)}
    {@const profileIsOnline = Boolean(liveProfileOnline ?? profile.online)}
    {@const profileIsFocused = liveProfileOnline ? liveProfileOnline.isFocused !== false : (profile.isFocused !== false)}
    {@const profilePresenceMode = liveProfileOnline?.presenceMode ?? profile.presenceMode}
    {@const profileIsFallback = profileIsOnline && profilePresenceMode === "fallback"}
    <!-- 主体：手机端单流平滑滚动，平板/桌面端 42%:58% 左右双栏独立滚动且高度随内容自适应 -->
    <div
      bind:this={bodyContainerEl}
      class="flex-1 min-h-0 flex flex-col md:grid md:grid-cols-[minmax(18.5rem,42%)_minmax(0,58%)] md:grid-rows-[minmax(0,1fr)] overflow-y-auto md:overflow-hidden custom-scrollbar"
      onscroll={(e) => handleScrollNearBottom(e.currentTarget)}
    >
      <!-- 左栏：名片核心、互动四格统计、常点歌手、歌单与最近发言 -->
      <div class="w-full md:min-h-0 md:overflow-y-auto custom-scrollbar p-3.5 sm:p-4 space-y-3 border-b md:border-b-0 md:border-r border-(--chat-divider-color)">
        <!-- 头部名片与签名 -->
        <div class="rounded-xl bg-(--btn-regular-bg) p-3 space-y-2.5">
          <div class="flex items-center gap-3">
            <div class="relative shrink-0">
              <ChatAvatar
                src={profile.avatar}
                alternateSrc={seed?.avatar || fallbackData?.profile.avatar}
                name={profile.name}
                size="lg"
              />
              {#if profileIsOnline}
                <span
                  title={profileIsFallback ? "在线" : profileIsFocused ? "在线" : "离开"}
                  class="chat-online-dot {profileIsFallback ? 'chat-online-dot--fallback' : profileIsFocused ? '' : 'chat-online-dot--away'} w-3! h-3! absolute bottom-0 right-0 border-2 border-white dark:border-neutral-900"
                ></span>
              {:else}
                <span
                  title="离线"
                  class="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-neutral-900 bg-neutral-400"
                ></span>
              {/if}
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 min-w-0 flex-wrap">
                <span class="text-sm font-bold text-[var(--deep-text)] truncate">
                  {profile.name}
                </span>
                <span class="chat-role-badge chat-role-badge--{profile.badgeType}">
                  {profile.badge}
                </span>
                {#if effectiveCustomBadges.length > 0}
                  {#each effectiveCustomBadges as b, idx (`${b.text}:${idx}`)}
                    <span class="chat-role-badge chat-role-badge--{b.color}">
                      {b.text}
                    </span>
                  {/each}
                {/if}
              </div>
              <div class="text-[11px] text-[var(--chat-meta-color)] mt-0.5 truncate flex items-center gap-1.5 flex-wrap">
                <span>{profileIsOnline ? (profileIsFallback || profileIsFocused ? "在线" : "离开") : formatLastSeen(profile.lastSeenAt)}</span>

                {#if cleanCustomStatus(profile.status)}
                  <span class="opacity-40 select-none">·</span>
                  <span>{cleanCustomStatus(profile.status)}</span>
                {/if}

                {#if profile.location}
                  <span class="opacity-40 select-none">·</span>
                  <span
                    class="inline-flex items-center gap-1 font-medium text-[var(--chat-meta-color)]"
                  >
                    <svg
                      class="w-3 h-3 shrink-0 opacity-70"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    <span>{profile.location}</span>
                  </span>
                {/if}

                {#if roomId === "interconnect"}
                  <span class="opacity-40 select-none">·</span>
                  <span>本站 Matrix 节点</span>
                {/if}
              </div>
            </div>
          </div>

          <div class="chat-user-detail-subcard text-xs leading-relaxed text-[var(--deep-text)]/90 px-2.5 py-2 rounded-lg break-words">
            <div class="chat-member-card-bio">
              {#if profile.bio?.trim()}
                {profile.bio.trim()}
              {:else}
                <span class="text-[var(--chat-meta-color)] opacity-80">这个人很懒，还没有填写个人简介~</span>
              {/if}
            </div>
          </div>

          {#if safeProfileUrl}
            <a
              href={safeProfileUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="chat-user-detail-subcard flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs text-[var(--chat-accent-text)] hover:border-(--primary)/50 transition-colors no-underline"
            >
              <span class="truncate">{safeProfileUrl}</span>
              <span class="text-[10px] shrink-0 opacity-85">访问主页 ↗</span>
            </a>
          {/if}

          {#if roomId === "interconnect" && localMatrixInfo}
            <div class="mt-2.5 pt-2 border-t border-[var(--chat-divider-color)]/60 text-[0.6875rem] text-[var(--chat-meta-color)] space-y-1">
              <div class="flex items-center justify-between gap-2">
                <span class="shrink-0">Matrix 账号:</span>
                {#if localMatrixInfo.matrixId}
                  <a
                    href={`https://matrix.to/#/${encodeURIComponent(localMatrixInfo.matrixId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-[var(--chat-accent-text)] hover:underline truncate font-mono"
                  >
                    {localMatrixInfo.matrixId}
                  </a>
                {:else}
                  <span class="truncate font-mono">待分配</span>
                {/if}
              </div>
              <div class="flex items-center justify-between gap-2">
                <span class="shrink-0">服务器:</span>
                <span class="truncate font-mono">{localMatrixInfo.server}</span>
              </div>
            </div>
          {/if}
        </div>

        <!-- 快捷操作 -->
        <div class="flex items-center">
          {#if isSelf}
            <button
              type="button"
              class="chat-send-btn flex-1 h-9! rounded-xl! text-xs!"
              onclick={() => {
                onClose();
                onEditSelf();
              }}
            >
              编辑我的资料
            </button>
          {:else}
            {@const isExternalProfile = Boolean(isExternalUser || matrixUserId || isExternalMatrixIdentity(profile))}
            {@const mentionDisabled = isExternalProfile && roomId !== "interconnect"}
            {@const mentionDisplayName = isExternalProfile
              ? resolveExternalOrigin({ name: profile.name, userKey: profile.userKey, badge: profile.badge, site: profile.site, siteUrl: profile.siteUrl, url: profile.url }, interconnectSites).cleanName || profile.name
              : profile.name}
            <button
              type="button"
              disabled={mentionDisabled}
              class="{mentionDisabled ? 'chat-dialog-secondary-action bg-black/5 dark:bg-white/5 text-[var(--chat-meta-color)] opacity-50 cursor-not-allowed select-none' : 'chat-send-btn'} flex-1 h-9! rounded-xl! text-xs! truncate px-3!"
              aria-label={mentionDisabled ? "仅可在互联茶室中提及站外茶友" : `在聊天中 @${mentionDisplayName}`}
              onclick={() => {
                if (mentionDisabled) return;
                onClose();
                onMention(mentionDisplayName, profile.userKey);
              }}
            >
              {#if mentionDisabled}
                仅互联茶室可提及
              {:else}
                @ {mentionDisplayName}
              {/if}
            </button>
          {/if}
        </div>

        <!-- 站长专属：身份头衔管理（严格隔离：绝不允许设置站外/互联用户） -->
        {#if currentUser?.isAdmin && profile && !isExternalUser && !matrixUserId && !profile.userKey.startsWith("matrix:") && !profile.userKey.startsWith("@")}
          <div class="rounded-xl bg-(--btn-regular-bg) p-3 space-y-2.5 border border-amber-500/25 dark:border-amber-400/25">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 min-w-0">
                <svg class="w-3.5 h-3.5 text-amber-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
                <span class="text-xs font-bold text-[var(--deep-text)] truncate">身份头衔管理</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold shrink-0">站长视角</span>
              </div>
              <span class="text-[11px] text-[var(--chat-meta-color)] shrink-0 font-medium">
                {managedBadges.length}/3
              </span>
            </div>

            <!-- 系统固定头衔只读 -->
            <div class="flex items-center justify-between text-xs py-1.5 px-2.5 rounded-lg bg-black/5 dark:bg-white/5 gap-2">
              <span class="text-[11px] text-[var(--chat-meta-color)]">系统固定头衔：</span>
              <div class="flex items-center gap-1.5">
                <span class="chat-role-badge chat-role-badge--{profile.badgeType}">
                  {profile.badge}
                </span>
                <span class="text-[10px] text-[var(--chat-meta-color)] opacity-70">（固定头衔，不可修改）</span>
              </div>
            </div>

            <!-- 自定义头衔列表编辑 -->
            <div class="space-y-2">
              <div class="text-[11px] font-medium text-[var(--chat-meta-color)] flex items-center justify-between">
                <span>自定义头衔（最多 3 个）：</span>
                {#if managedBadges.length < 3}
                  <button
                    type="button"
                    class="text-[11px] text-[var(--primary)] hover:underline bg-transparent border-none cursor-pointer p-0 font-medium inline-flex items-center gap-0.5"
                    onclick={handleAddBadge}
                  >
                    <span>+ 添加头衔</span>
                  </button>
                {/if}
              </div>

              {#if managedBadges.length === 0}
                <div class="text-[11px] text-[var(--chat-meta-color)] opacity-70 py-1 px-1">
                  暂未添加自定义头衔，点击右上角“+ 添加头衔”即可为该成员添加头衔。
                </div>
              {:else}
                <div class="space-y-2">
                  {#each managedBadges as badge, idx (idx)}
                    <div class="p-2 rounded-lg bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 space-y-1.5">
                      <div class="flex items-center gap-2">
                        <input
                          type="text"
                          maxlength={8}
                          bind:value={managedBadges[idx].text}
                          oninput={() => (managedDirty = true)}
                          placeholder="输入头衔（最多 8 字）"
                          class="chat-auth-input text-xs py-1 px-2 h-7.5 flex-1 min-w-0"
                        />
                        <button
                          type="button"
                          class="text-neutral-400 hover:text-red-500 p-1 rounded transition-colors bg-transparent border-none cursor-pointer shrink-0"
                          onclick={() => handleRemoveBadge(idx)}
                          aria-label="删除此头衔"
                        >
                          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                          </svg>
                        </button>
                      </div>

                      <div class="flex items-center justify-between text-[11px] pt-0.5">
                        <span class="text-[var(--chat-meta-color)]">头衔颜色：</span>
                        <div class="flex items-center gap-1.5">
                          <button
                            type="button"
                            class="px-2 py-0.5 rounded text-[11px] font-medium border cursor-pointer transition-all flex items-center gap-1
                              {badge.color === 'gold'
                                ? 'chat-role-badge--gold border-amber-500/50 shadow-xs font-semibold'
                                : 'bg-transparent text-[var(--chat-meta-color)] border-transparent opacity-60 hover:opacity-100'}"
                            onclick={() => {
                              managedDirty = true;
                              managedBadges[idx].color = 'gold';
                            }}
                          >
                            <span class="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"></span>
                            <span>金色</span>
                          </button>
                          <button
                            type="button"
                            class="px-2 py-0.5 rounded text-[11px] font-medium border cursor-pointer transition-all flex items-center gap-1
                              {badge.color === 'gray'
                                ? 'chat-role-badge--gray border-neutral-400/50 shadow-xs font-semibold'
                                : 'bg-transparent text-[var(--chat-meta-color)] border-transparent opacity-60 hover:opacity-100'}"
                            onclick={() => {
                              managedDirty = true;
                              managedBadges[idx].color = 'gray';
                            }}
                          >
                            <span class="w-1.5 h-1.5 rounded-full bg-neutral-400 inline-block"></span>
                            <span>灰色</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>

            <!-- 保存按钮与提示 -->
            <div class="flex items-center justify-between pt-1 gap-2">
              {#if badgeSaveNotice}
                <span class="text-[11px] {badgeSaveNotice === '头衔已更新' ? 'text-emerald-500' : 'text-red-400'} font-medium truncate">
                  {badgeSaveNotice}
                </span>
              {:else}
                <span></span>
              {/if}
              <button
                type="button"
                class="chat-send-btn h-7.5! px-3! rounded-lg! text-xs! font-medium cursor-pointer shrink-0 disabled:opacity-50"
                disabled={isSavingBadges}
                onclick={handleSaveBadges}
              >
                {isSavingBadges ? "保存中..." : "保存头衔修改"}
              </button>
            </div>
          </div>
        {/if}

        <!-- 2x2 互动与活跃统计 -->
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded-xl bg-(--btn-regular-bg) px-3 py-2 flex items-center justify-between gap-2">
            <span class="text-[11px] text-[var(--chat-meta-color)]">聊天发言</span>
            <span class="text-xs font-bold text-[var(--deep-text)] tabular-nums">
              {profile.stats.messageCount}
            </span>
          </div>
          <div class="rounded-xl bg-(--btn-regular-bg) px-3 py-2 flex items-center justify-between gap-2">
            <span class="text-[11px] text-[var(--chat-meta-color)]">累计点歌</span>
            <span class="text-xs font-bold text-[var(--deep-text)] tabular-nums">
              {remoteProfile ? (remoteHasMore ? "统计中" : remoteTracks.length) : profile.stats.songRequestCount}
            </span>
          </div>
          <div class="rounded-xl bg-(--btn-regular-bg) px-3 py-2 flex items-center justify-between gap-2">
            <span class="text-[11px] text-[var(--chat-meta-color)]">初次来访</span>
            <span class="text-[11px] font-bold text-[var(--deep-text)] tabular-nums truncate">
              {formatJoinTime(profile.firstSeenAt)}
            </span>
          </div>
          <div class="rounded-xl bg-(--btn-regular-bg) px-3 py-2 flex items-center justify-between gap-2">
            <span class="text-[11px] text-[var(--chat-meta-color)]">最近活跃</span>
            <span class="text-[11px] font-bold tabular-nums truncate {profileIsOnline ? (profileIsFallback ? 'text-[var(--chat-meta-color)]' : profileIsFocused ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400') : 'text-[var(--deep-text)]'}">
              {profileIsOnline ? (profileIsFallback || profileIsFocused ? formatActiveStat(true, profile.lastSeenAt) : "离开") : formatActiveStat(false, profile.lastSeenAt)}
            </span>
          </div>
        </div>

        <!-- 常点歌手偏好 -->
        {#if topArtists.length > 0}
          <div class="space-y-1.5">
            <div class="text-[11px] font-semibold text-[var(--chat-meta-color)] px-0.5">
              常点歌手
            </div>
            <div class="flex flex-wrap gap-1.5">
              {#each topArtists as item (item.artist)}
                <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-(--btn-regular-bg) text-[11px] font-medium text-[var(--deep-text)]">
                  <span class="truncate max-w-[9rem]">{item.artist}</span>
                  <span class="text-[10px] text-[var(--chat-accent-text)] font-semibold tabular-nums">
                    {item.count} 次
                  </span>
                </span>
              {/each}
            </div>
          </div>
        {/if}

        <!-- TA 导入的歌单（Waline 已认证用户） -->
        {#if profile.playlists.length > 0}
          <div class="space-y-1.5">
            <div class="text-[11px] font-semibold text-[var(--chat-meta-color)] px-0.5">
              导入的歌单
            </div>
            <div class="rounded-xl bg-(--btn-regular-bg) p-1.5 space-y-1">
              {#each profile.playlists as pl, idx (`${pl.id}:${idx}`)}
                <button
                  type="button"
                  class="w-full flex items-center gap-2 p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-left bg-transparent border-none cursor-pointer"
                  onclick={() => {
                    onClose();
                    onOpenPlaylist?.(pl.id, pl);
                  }}
                >
                  <div class="w-8 h-8 rounded-md overflow-hidden shrink-0 bg-(--primary)/12 flex items-center justify-center">
                    {#if pl.coverUrl}
                      <img src={pl.coverUrl} alt="" loading="lazy" class="w-full h-full object-cover" />
                    {:else}
                      <span class="text-xs text-(--primary)">♪</span>
                    {/if}
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="text-xs font-semibold text-[var(--deep-text)] truncate">{pl.title}</div>
                    <div class="text-[10px] text-[var(--chat-meta-color)] truncate">
                      {formatPlatformLabel(pl.platform)} · {pl.trackCount} 首
                    </div>
                  </div>
                  <span class="text-[10px] font-semibold text-[var(--chat-accent-text)] shrink-0">查看 →</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <!-- 最近发言动态（点击跳转定位至原消息） -->
        {#if recentMessages.length > 0}
          <div class="space-y-1.5">
            <div class="text-[11px] font-semibold text-[var(--chat-meta-color)] px-0.5">
              最近发言
            </div>
            <div class="rounded-xl bg-(--btn-regular-bg) p-1.5 space-y-1">
              {#each recentMessages as msg (msg.msgUid)}
                <button
                  type="button"
                  class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors bg-transparent border-none cursor-pointer flex items-center justify-between gap-2"
                  onclick={() => {
                    onClose();
                    onJumpToMessage?.(msg.msgUid);
                  }}
                >
                  <span class="text-xs text-[var(--deep-text)]/90 truncate min-w-0 flex-1">
                    {formatMessageSummary(msg)}
                  </span>
                  <span class="text-[10px] text-[var(--chat-meta-color)] tabular-nums shrink-0">
                    {formatTrackTime(msg.createdAt)}
                  </span>
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <!-- 右栏：TA 点过的歌（按时间 50 首起无限滚 / 按次数排行） -->
      <div class="w-full md:min-w-0 md:min-h-0 flex flex-col">
        <div class="shrink-0 flex items-center justify-between gap-2 px-3.5 sm:px-4 py-2.5 border-b border-(--chat-divider-color) md:overflow-y-auto custom-scrollbar chat-scrollbar-stable">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-xs font-bold text-[var(--deep-text)]">
              点过的歌
            </span>
            <span class="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-(--primary)/12 text-[var(--chat-accent-text)] tabular-nums">
              {tracksLoadFailed ? "统计未完成" : remoteHasMore ? "正在统计" : `共 ${totalSongCount} 首`}
            </span>
          </div>

          <div class="inline-flex items-center gap-0.5 rounded-lg bg-(--btn-regular-bg) p-0.5 shrink-0" role="tablist" aria-label="点歌视图切换">
            <button
              type="button"
              role="tab"
              aria-selected={trackTab === "recent"}
              class="px-2 py-0.5 rounded-md text-[11px] font-medium border-none cursor-pointer transition-colors {trackTab === 'recent' ? 'bg-(--primary) text-white' : 'bg-transparent text-[var(--chat-meta-color)] hover:text-[var(--deep-text)]'}"
              onclick={() => handleSwitchTrackTab("recent")}
            >
              按时间
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={trackTab === "top"}
              class="px-2 py-0.5 rounded-md text-[11px] font-medium border-none cursor-pointer transition-colors {trackTab === 'top' ? 'bg-(--primary) text-white' : 'bg-transparent text-[var(--chat-meta-color)] hover:text-[var(--deep-text)]'}"
              onclick={() => handleSwitchTrackTab("top")}
            >
              按次数
            </button>
          </div>
        </div>

        <div
          class="md:flex-1 md:min-h-0 md:overflow-y-auto custom-scrollbar chat-scrollbar-stable px-3.5 sm:px-4 py-3 space-y-1.5"
          onscroll={(e) => handleScrollNearBottom(e.currentTarget)}
        >
          {#if trackTab === "recent"}
            {#if displayedTracks.length === 0}
              <div class="flex flex-col items-center justify-center py-8 px-4 text-center rounded-xl bg-(--btn-regular-bg)/60">
                <div class="w-9 h-9 rounded-full bg-(--primary)/12 flex items-center justify-center text-sm text-(--primary) mb-2">
                  ♪
                </div>
                <div class="text-xs font-medium text-[var(--deep-text)]/80">
                  暂无点歌记录
                </div>
                <div class="text-[11px] text-[var(--chat-meta-color)] mt-0.5">
                  TA 还没有在本房间点过歌~
                </div>
              </div>
            {:else}
              <div class="space-y-1.5" style="contain: layout style;">
                {#each displayedTracks as item, idx (item.logId ? `log-${item.logId}` : `local-${idx}-${item.track.id}-${item.requestedAt}`)}
                  <div class="flex items-center gap-2.5 p-2 rounded-xl bg-(--btn-regular-bg)/70 hover:bg-(--btn-regular-bg) transition-colors">
                    <span class="w-5 text-center text-[10px] font-semibold text-[var(--chat-meta-color)] tabular-nums shrink-0">
                      {idx + 1}
                    </span>
                    <div class="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-(--primary)/12 flex items-center justify-center">
                      {#if item.track.cover}
                        <img src={item.track.cover} alt="" loading="lazy" class="w-full h-full object-cover" />
                      {:else}
                        <span class="text-xs text-(--primary)">♪</span>
                      {/if}
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="text-xs font-semibold text-[var(--deep-text)] truncate">
                        {item.track.title}
                      </div>
                      <div class="text-[11px] text-[var(--chat-meta-color)] truncate mt-0.5">
                        {item.track.artist}
                        {#if item.requestedAt}
                          · {formatTrackTime(item.requestedAt)}
                        {/if}
                        {#if item.requestCount > 1}
                          · 点过 {remoteHasMore ? "至少 " : ""}{item.requestCount} 次
                        {/if}
                      </div>
                    </div>
                    {#if onEnqueueTrack}
                      <button
                        type="button"
                        class="chat-queue-toggle-btn text-[11px]! px-2.5! py-1! shrink-0"
                        onclick={(event) => {
                          onEnqueueTrack(item.track, event.currentTarget);
                        }}
                      >
                        + 点歌
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>

              <div class="pt-2 pb-1 flex items-center justify-center">
                {#if isLoadingMore}
                  <span class="text-[11px] text-[var(--chat-meta-color)]">
                    正在加载更多点歌记录...
                  </span>
                {:else if tracksLoadFailed}
                  <button type="button" class="btn-regular h-8 px-3.5 rounded-lg text-[11px] font-medium cursor-pointer border-none" onclick={() => void loadMoreTracks()}>
                    加载失败，点击重试
                  </button>
                {:else if hasMoreTracks}
                  <button
                    type="button"
                    class="btn-regular h-8 px-3.5 rounded-lg text-[11px] font-medium cursor-pointer border-none"
                    onclick={() => void loadMoreTracks()}
                  >
                    向下滚动或点击加载更多
                  </button>
                {:else}
                  <span class="text-[11px] text-[var(--chat-meta-color)] opacity-80">
                    已展示全部 {displayedTracks.length} 首点歌记录
                  </span>
                {/if}
              </div>
            {/if}
          {:else if trackTab === "top"}
            {#if topTracks.length === 0}
              <div class="flex flex-col items-center justify-center py-8 px-4 text-center rounded-xl bg-(--btn-regular-bg)/60">
                <div class="w-9 h-9 rounded-full bg-(--primary)/12 flex items-center justify-center text-sm text-(--primary) mb-2">
                  ♪
                </div>
                <div class="text-xs font-medium text-[var(--deep-text)]/80">
                  暂无点歌排行
                </div>
                <div class="text-[11px] text-[var(--chat-meta-color)] mt-0.5">
                  点过的歌曲会在这里自动统计次数~
                </div>
              </div>
            {:else}
              <div class="space-y-1.5" style="contain: layout style;">
                {#each topTracks as item, idx (`${item.track.id}:${idx}`)}
                  <div class="flex items-center gap-2.5 p-2 rounded-xl bg-(--btn-regular-bg)/70 hover:bg-(--btn-regular-bg) transition-colors">
                    <span class="w-5 text-center text-[10px] font-bold tabular-nums shrink-0 {idx < 3 ? 'text-[var(--chat-accent-text)]' : 'text-[var(--chat-meta-color)]'}">
                      #{idx + 1}
                    </span>
                    <div class="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-(--primary)/12 flex items-center justify-center">
                      {#if item.track.cover}
                        <img src={item.track.cover} alt="" loading="lazy" class="w-full h-full object-cover" />
                      {:else}
                        <span class="text-xs text-(--primary)">♪</span>
                      {/if}
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="text-xs font-semibold text-[var(--deep-text)] truncate">
                        {item.track.title}
                      </div>
                      <div class="text-[11px] text-[var(--chat-meta-color)] truncate mt-0.5">
                        {item.track.artist} · 点过 {remoteHasMore ? "至少 " : ""}{item.requestCount} 次
                      </div>
                    </div>
                    {#if onEnqueueTrack}
                      <button
                        type="button"
                        class="chat-queue-toggle-btn text-[11px]! px-2.5! py-1! shrink-0"
                        onclick={(event) => {
                          onEnqueueTrack(item.track, event.currentTarget);
                        }}
                      >
                        + 点歌
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      </div>
    </div>
  {/if}
</ChatModal>
