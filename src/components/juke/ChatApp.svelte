<script lang="ts">
import { onMount, tick, untrack } from "svelte";
import {
	chatPushUnavailableReason,
	disableChatPush,
	enableChatPush,
	isIOSDevice,
	prepareChatPush,
	readChatPushSettings,
	requestNotificationPermission,
	supportsChatPush,
	testChatPush,
	updateChatPushMode,
} from "./chatPush";
import type { ChatRoomMeta, InterconnectSite } from "@/types/chatConfig";
import ChatWindow from "./ChatWindow.svelte";
import ChatModal from "./ChatModal.svelte";
import { positionChatFloating } from "./chatFloating";
import ChatInterconnectPopover from "./ChatInterconnectPopover.svelte";
import {
	type ChatAppearanceSettings,
	type ChatPanelSlot,
	type ChatWallpaperConfig,
	isChatPanelSlot,
	isMusicNoticeMessage,
	loadChatAppearanceSettings,
	loadDevPanelWallpaperPreviews,
	resolveSlotWallpaperSrc,
	saveDevPanelWallpaperPreview,
	setRuntimeChatWallpaperCatalog,
	trackBgImgAspectRatio,
} from "./chatAppearance";
import {
	buildWsUrl,
	CHAT_SESSION_USER_KEY,
	clearGuestAuth,
	clearStoredChatUser,
	clearWalineAuth,
	consumeUrlWalineToken,
	getOrCreateVisitorId,
	GUEST_TOKEN_STORAGE_KEY,
	formatClockSeconds,
	isMentionedForUser,
	normalizeServerUrl,
	persistStoredChatUser,
	persistWalineCommentMeta,
	readInitialCachedUser,
	readStoredChatUser,
	readStoredWalineToken,
	resolveChatAvatarUrl,
	resolveCurrentUserEmail,
	resolveInitialAuth,
	syncChatUserToWalineStorage,
	type ServerPacket,
	type MusicAudience,
	saveMemberBadges,
	searchOnlineMusic,
} from "./chatClient";
import type {
	ChatActiveThreadItem,
	ChatCustomBadge,
	ChatDesktopNotificationMode,
	ChatMentionCandidate,
	ChatMentionEntity,
	ChatMessageRecord,
	ChatOnlineMember,
	ChatProfileDraft,
	ChatReadReceipt,
	ChatSessionUser,
	ChatSpectatorRecord,
	ChatUserDetailSeed,
	ConnectionState,
	ImageAttachment,
	PlaylistSummary,
	RotationAction,
	RotationOffer,
	RotationQueueItem,
	RoomMusicState,
} from "./chatTypes";
import { recordMusicEvent, updatePlaybackDiagnostic } from "./musicTrace";
import { MusicClock } from "./musicClock";
import type { ChatMusicTrack } from "./musicTypes";
import { formatPlatformLabel } from "./playlistClient";
import RoomPanel from "./RoomPanel.svelte";
import type { AudioStatus, LocalAudioDiagnostic } from "./roomAudioPlayer";
import {
	buildStickerLookup,
	loadStickerPacks,
	type StickerPack,
	getChatAttachmentKind,
} from "./stickerLoader";

interface Props {
	chatServerUrl?: string;
	walineServerUrl?: string;
	playlistOutApiUrl?: string;
	rooms?: ChatRoomMeta[];
	enableImageUpload?: boolean;
	stickerPackUrls?: string[];
	musicTracks?: ChatMusicTrack[];
	initialMusicVolume?: number;
	interconnectSites?: InterconnectSite[];
	siteAvatar?: string;
}

const {
	chatServerUrl = "",
	walineServerUrl = "",
	playlistOutApiUrl = "https://playlistout-api.lengxiqwq.com",
	rooms = [{ id: "chat", name: "闲聊", subtitle: "随便聊聊日常与折腾" }],
	enableImageUpload = true,
	stickerPackUrls = ["/assets/stickers/qq", "/assets/stickers/bmoji", "/assets/stickers/miku"],
	musicTracks = [],
	initialMusicVolume = 1,
	interconnectSites = [],
	siteAvatar = "",
}: Props = $props();

const LAST_SEEN_PREFIX = "lengxi_chat_last_seen:";
const LAST_ROOM_STORAGE_KEY = "lengxi_chat_last_room";

let mobileDrawer = $state<"none" | "room" | "music">("none");
const roomPanelId = "chat-room-panel";
let isMobileLayout = $state(false);
const splitLayoutBreakpoint = 1100;
let stageContentRect = $state<DOMRectReadOnly>();
const isSplitLayout = $derived(
	!isMobileLayout &&
		stageContentRect !== undefined &&
		stageContentRect.width < splitLayoutBreakpoint,
);
let splitRoomOpen = $state(false);
const isChatPaneActive = $derived(
	mobileDrawer === "none" && !(isSplitLayout && splitRoomOpen),
);
let roomPanelEl: HTMLDivElement;
let splitRoomTrigger: HTMLButtonElement | undefined;
let currentRoom = $state(rooms[0]?.id || "chat");
let connectionState = $state<ConnectionState>("idle");
function isDocumentActivelyVisibleAndFocused(): boolean {
	if (typeof document === "undefined") return false;
	if (document.hidden || document.visibilityState !== "visible") return false;
	if (typeof document.hasFocus === "function" && !document.hasFocus()) {
		return false;
	}
	return true;
}

let isWindowFocused = $state(false);
let isIdleAway = $state(false);
const isEffectiveFocused = $derived(isWindowFocused && !isIdleAway);
let currentAuth = $state.raw<ReturnType<typeof resolveInitialAuth>>(resolveInitialAuth());
let currentUser = $state<ChatSessionUser | null>(readInitialCachedUser());
let walineToken = $state(
	currentAuth?.kind === "waline" ? currentAuth.token : "",
);
let onlineMembers = $state<ChatOnlineMember[]>([]);
let observers = $state<ChatOnlineMember[]>([]);
function uniqueObservers(list: ChatOnlineMember[]): ChatOnlineMember[] {
	return [
		...new Map(list.map((observer) => [observer.userKey, observer])).values(),
	];
}

let spectatorHistory = $state<ChatSpectatorRecord[]>([]);

$effect(() => {
	if (currentUser?.isAdmin) {
		void refreshSpectatorHistory();
	} else {
		spectatorHistory = [];
	}
});
let roomOnlineMembers = $state<ChatOnlineMember[]>([]);
let hasGlobalPresence = false;
let roomMentionMembers = $state<ChatMentionCandidate[]>([]);
let globalMemberDirectory = $state<ChatMentionCandidate[]>([]);
const mentionMembers = $derived.by<ChatMentionCandidate[]>(() => {
	const onlineKeys = new Set(onlineMembers.map((member) => member.userKey));
	const merged = new Map<string, ChatMentionCandidate>();
	for (const member of globalMemberDirectory) {
		merged.set(member.userKey, {
			...member,
			online: onlineKeys.has(member.userKey),
		});
	}
	for (const member of roomMentionMembers) {
		const previous = merged.get(member.userKey);
		merged.set(member.userKey, {
			...previous,
			...member,
			avatar: member.avatar || previous?.avatar || "",
			bio: member.bio || previous?.bio,
			status: member.status || previous?.status,
			customBadges: member.customBadges || previous?.customBadges,
			lastSeenAt: Math.max(member.lastSeenAt || 0, previous?.lastSeenAt || 0),
			online: onlineKeys.has(member.userKey),
		});
	}
	return [...merged.values()].sort((a, b) => {
		if (a.online !== b.online) return a.online ? -1 : 1;
		if (a.online && b.online) {
			if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
			return a.name.localeCompare(b.name, "zh-CN");
		}
		const aTime = a.lastSeenAt || 0;
		const bTime = b.lastSeenAt || 0;
		if (aTime !== bTime) {
			return bTime - aTime;
		}
		if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
		return a.name.localeCompare(b.name, "zh-CN");
	});
});
let totalOnlineCount = $state(0);
let messages = $state<ChatMessageRecord[]>([]);
const MAX_CACHED_MSGS_PER_ROOM = 120;
const roomMessageCache = new Map<string, ChatMessageRecord[]>();

function cacheRoomMessages(roomKey: string, list: ChatMessageRecord[]): void {
	roomMessageCache.set(
		roomKey,
		list.length > MAX_CACHED_MSGS_PER_ROOM
			? list.slice(-MAX_CACHED_MSGS_PER_ROOM)
			: list,
	);
}

function mergeRoomMessages(
	serverMessages: ChatMessageRecord[],
	cachedMessages: ChatMessageRecord[],
	hasMoreHistory: boolean,
): ChatMessageRecord[] {
	if (!hasMoreHistory || cachedMessages.length === 0) return serverMessages;
	const seen = new Set(serverMessages.map((message) => message.msgUid));
	const oldest = serverMessages[0]?.createdAt ?? Number.MAX_SAFE_INTEGER;
	const older = cachedMessages.filter(
		(message) => !seen.has(message.msgUid) && message.createdAt < oldest,
	);
	if (older.length === 0) return serverMessages;
	return [...older, ...serverMessages].sort(
		(a, b) => a.createdAt - b.createdAt,
	);
}
let hasMoreHistory = $state(false);
let oldestHistoryId = $state(0);
let isLoadingHistory = $state(false);
let historyLoadTimeoutTimer: number | null = null;

function clearHistoryLoadTimer() {
	if (historyLoadTimeoutTimer !== null) {
		window.clearTimeout(historyLoadTimeoutTimer);
		historyLoadTimeoutTimer = null;
	}
}
let sessionUnreadSince = $state(0);
let serverUnreadCount = $state(0);
let serverUnreadUserCount = $state(0);
let unreadJumpSeq = $state(0);
let roomInitSeq = $state(0);
let isRoomReady = $state(false);
let pinnedUids = $state<string[]>([]);
let pinnedDetails = $state<ChatMessageRecord[]>([]);
let roomTopic = $state<string>("");
let roomAvatars = $state<Record<string, string>>({});
let typingUsers = $state<string[]>([]);
const typingUserTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearAllTypingTimers() {
	for (const timer of typingUserTimers.values()) {
		clearTimeout(timer);
	}
	typingUserTimers.clear();
	typingUsers = [];
}
let readReceipts = $state<Record<string, ChatReadReceipt[]>>({});
let musicState = $state<RoomMusicState | null>(null);
let localAudioDiagnostic = $state.raw<LocalAudioDiagnostic | null>(null);
let musicAudience = $state<MusicAudience>({ onlineCount: 0, listeningCount: 0 });
const songRequests = new Map<
	string,
	{
		room: string;
		track?: ChatMusicTrack;
		anchor?: HTMLElement;
		randomPlaylistId?: string;
		fromOffer: boolean;
		finish: (ok: boolean) => void;
		setWaiting: (waiting: boolean) => void;
	}
>();
let pendingRandomRequestId = $state<string | null>(null);

function clearPendingSongRequests() {
	for (const pending of songRequests.values()) pending.finish(false);
}

let isSkippingTrack = $state(false);
let skipPendingTimer: number | null = null;
let clockOffsetMs = $state(0);
let hasClockSample = false;
const musicClock = new MusicClock();
const serverNow = () => musicClock.now();
let clockPingSeq = 0;
let clockBurstRemaining = 0;
const pendingClockPings = new WeakMap<
	WebSocket,
	{ wall: number; monotonic: number; id: number }
>();
let chatAudio: HTMLAudioElement | null = $state(null);
let noticeText = $state("");
let noticeVisible = $state(false);
let noticeTone = $state<"default" | "error" | "success">("default");
let targetMessageUid = $state("");
let showInterconnect = $state(false);
let activeThreads = $state<ChatActiveThreadItem[]>([]);
let totalChatterCount = $state(0);
let playlistRefreshSeq = $state(0);
let musicPanelRef: {
	toggleListenControl?: () => void;
	startListeningControl?: () => void;
	openPlayerTab?: () => void;
} | null = $state(null);
let pendingSongListen = $state<{ room: string; playUid: string } | null>(null);
let mobilePlaybackStatus = $state<{
	isListening: boolean;
	audioStatus?: AudioStatus;
	isMuted: boolean;
	elapsedSec: number;
	durationSec: number;
	canDirectSkip: boolean;
	isSoloCoolingDown: boolean;
	soloCooldownRemainSec: number;
	hasVotedSkip: boolean;
	volume?: number;
	currentLyric?: string;
}>({
	isListening: false,
	isMuted: true,
	elapsedSec: 0,
	durationSec: 0,
	canDirectSkip: false,
	isSoloCoolingDown: false,
	soloCooldownRemainSec: 0,
	hasVotedSkip: false,
	volume: initialMusicVolume,
	currentLyric: "",
});

// 全局收听意愿管理（仅在同一次页面会话内跨房间切换时保持，刚进页面默认未收听）
let isListeningIntent = $state(false);
let lastListenPacket = "";
let memoryVolume = $state(initialMusicVolume);
let hasAppMounted = false;

const NOTIFICATION_MODE_STORAGE_KEY = "fireflyChatDesktopNotificationMode";
const NOTIFICATION_STORAGE_KEY = "fireflyChatDesktopNotification";
let preparedPush: Awaited<ReturnType<typeof prepareChatPush>> | undefined;
let pushPreparation: Promise<Awaited<ReturnType<typeof prepareChatPush>>> | undefined;
let pushSaving = $state(false);
let pushTesting = $state(false);
let pushTestUntil = $state(0);
let pushTestSeconds = $state(0);

$effect(() => {
	const until = pushTestUntil;
	let timer: ReturnType<typeof setTimeout>;
	function tickCooldown() {
		const remaining = Math.max(0, until - Date.now());
		pushTestSeconds = Math.ceil(remaining / 1000);
		if (remaining) timer = setTimeout(tickCooldown, remaining % 1000 || 1000);
	}
	tickCooldown();
	return () => clearTimeout(timer);
});
let pushLoggingOut = false;
let pendingPushMode: {
	server: string;
	auth: NonNullable<typeof currentAuth>;
	userKey: string;
	mode: ChatDesktopNotificationMode;
} | undefined;
let pushNeedsMigration = $state(false);
let pushOperation: Promise<void> | undefined;
let desktopNotificationMode = $state<ChatDesktopNotificationMode>("off");
let desktopNotificationPermission = $state<NotificationPermission>("default");
const desktopNotificationEnabled = $derived(desktopNotificationMode !== "off");
let roomUnreadUids = $state<Record<string, string[]>>({});
const roomUnreadCounts = $derived.by<Record<string, number>>(() => {
	const counts: Record<string, number> = {};
	for (const [rId, uids] of Object.entries(roomUnreadUids)) {
		if (uids && uids.length > 0) {
			counts[rId] = uids.length;
		}
	}
	return counts;
});
const otherRoomsUnreadCount = $derived.by(() =>
	Object.entries(roomUnreadCounts).reduce(
		(acc, [rId, cnt]) => (rId !== currentRoom ? acc + (cnt || 0) : acc),
		0,
	),
);

let stageTouchStart: { x: number; y: number; time: number } | null = null;
let previousMobileDrawer: "none" | "room" | "music" = "none";

$effect.pre(() => {
	const next = mobileDrawer;
	if (isMobileLayout && previousMobileDrawer !== "none" && next === "none") {
		const panel = document.querySelector(
			`.chat-panel-${previousMobileDrawer === "room" ? "left" : "right"}`,
		);
		if (
			panel?.contains(document.activeElement) &&
			!document.querySelector(".chat-modal-backdrop")
		) {
			const label =
				previousMobileDrawer === "room"
					? "打开房间与成员抽屉"
					: "打开点歌与听歌抽屉";
			document
				.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
				?.focus({ preventScroll: true });
		}
	}
	previousMobileDrawer = next;
});

$effect(() => {
	if (!isMobileLayout || mobileDrawer === "none") return;
	function closeOnEscape(event: KeyboardEvent) {
		if (
			event.key === "Escape" &&
			!event.defaultPrevented &&
			!event.isComposing &&
			!document.querySelector(".chat-modal-backdrop")
		) {
			event.preventDefault();
			mobileDrawer = "none";
		}
	}
	document.addEventListener("keydown", closeOnEscape);
	return () => document.removeEventListener("keydown", closeOnEscape);
});

$effect(() => {
	if (!isSplitLayout) splitRoomOpen = false;
});

function closeSplitRoom(restoreFocus = false) {
	if (!splitRoomOpen) return;
	splitRoomOpen = false;
	if (restoreFocus) splitRoomTrigger?.focus({ preventScroll: true });
}

async function toggleSplitRoom(
	event: MouseEvent & { currentTarget: HTMLButtonElement },
) {
	if (splitRoomOpen) {
		closeSplitRoom(true);
		return;
	}
	splitRoomTrigger = event.currentTarget;
	splitRoomOpen = true;
	if (event.detail === 0) {
		await tick();
		if (isSplitLayout && splitRoomOpen) {
			roomPanelEl
				.querySelector<HTMLButtonElement>(".chat-split-room-close")
				?.focus();
		}
	}
}

$effect(() => {
	if (!isSplitLayout || !splitRoomOpen) return;

	function handleOutsidePointer(event: PointerEvent) {
		if (
			event.target instanceof Element &&
			!roomPanelEl.contains(event.target) &&
			!splitRoomTrigger?.contains(event.target) &&
			!event.target.closest(".chat-modal-backdrop")
		) {
			closeSplitRoom();
		}
	}

	function handleEscape(event: KeyboardEvent) {
		if (
			event.key === "Escape" &&
			!event.defaultPrevented &&
			!event.isComposing &&
			!document.querySelector(".chat-modal-backdrop")
		) {
			closeSplitRoom(true);
		}
	}

	document.addEventListener("pointerdown", handleOutsidePointer, true);
	document.addEventListener("keydown", handleEscape);
	return () => {
		document.removeEventListener("pointerdown", handleOutsidePointer, true);
		document.removeEventListener("keydown", handleEscape);
	};
});

function handleStageTouchStart(e: TouchEvent) {
	if (typeof window === "undefined" || e.touches.length !== 1) return;
	if (!window.matchMedia("(width < 768px)").matches) return;
	const target = e.target as HTMLElement | null;
	if (
		target?.closest(
			"input, textarea, .chat-slim-slider, .chat-slider-control, .chat-picker-tabs, .chat-md-table-wrap, pre, code",
		)
	) {
		stageTouchStart = null;
		return;
	}
	const t = e.touches[0];
	stageTouchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
}

function handleStageTouchEnd(e: TouchEvent) {
	if (!stageTouchStart || e.changedTouches.length !== 1) return;
	const start = stageTouchStart;
	stageTouchStart = null;
	const t = e.changedTouches[0];
	const dx = t.clientX - start.x;
	const dy = t.clientY - start.y;
	const dt = Date.now() - start.time;
	if (dt > 600 || Math.abs(dx) < 56 || Math.abs(dy) > Math.abs(dx) * 0.65) {
		return;
	}
	const vw = window.innerWidth || 375;
	if (mobileDrawer === "none") {
		if (dx > 0 && start.x < Math.min(96, vw * 0.28)) {
			mobileDrawer = "room";
		} else if (dx < 0 && start.x > vw - Math.min(96, vw * 0.28)) {
			mobileDrawer = "music";
		}
	} else if (mobileDrawer === "room" && dx < -48) {
		mobileDrawer = "none";
	} else if (mobileDrawer === "music" && dx > 48) {
		mobileDrawer = "none";
	}
}

let lastMarkedServerReadAt = 0;
let lastMarkedServerReadUid = "";
let lastReportedAudioKey = "";
const socketHandshakeAuth = new WeakMap<WebSocket, string>();

$effect(() => {
	const userKey = currentUser?.userKey || "spectator";
	const muted = mobilePlaybackStatus.isMuted;
	if (connectionState !== "connected") {
		lastReportedAudioKey = "";
		return;
	}
	const key = `${currentRoom}:${userKey}:${muted ? 1 : 0}`;
	if (key === lastReportedAudioKey) return;
	if (ws && ws.readyState === WebSocket.OPEN) {
		lastReportedAudioKey = key;
		ws.send(JSON.stringify({ type: "presence:audio", isMuted: muted }));
	}
});

let lastReportedFocusKey = "";
/** 同步上报当前焦点/离开状态至网关，避免切标签页时仅依赖微任务 $effect 而延误发送 */
function reportFocusState(force = false) {
	if (connectionState !== "connected") {
		lastReportedFocusKey = "";
		return;
	}
	if (!ws || ws.readyState !== WebSocket.OPEN) return;
	const focused = isWindowFocused && !isIdleAway;
	const userKey = currentUser?.userKey || "spectator";
	const key = `${currentRoom}:${userKey}:${focused ? 1 : 0}`;
	if (!force && key === lastReportedFocusKey) return;
	lastReportedFocusKey = key;
	ws.send(JSON.stringify({ type: "presence:focus", isFocused: focused }));
}

$effect(() => {
	// 订阅响应式依赖变化（房间、身份、连接状态、有效焦点）作为兜底同步
	void currentRoom;
	void currentUser?.userKey;
	void connectionState;
	void isEffectiveFocused;
	reportFocusState();
});

function mergeRoomPresence(
	roomId: string,
	members: ChatOnlineMember[],
	totalCount?: number,
) {
	const memberMap = new Map(onlineMembers.map((m) => [m.userKey, m]));
	for (const m of members) {
		const existing = memberMap.get(m.userKey);
		memberMap.set(m.userKey, {
			...existing,
			...m,
			roomId: m.roomId || existing?.roomId || roomId,
		});
	}
	onlineMembers = [...memberMap.values()];
	if (typeof totalCount === "number" && totalCount > 0) {
		totalOnlineCount = Math.max(totalCount, onlineMembers.length);
	}
}

function readUserLastSeen(roomId: string, userKey: string): number {
	if (typeof localStorage === "undefined") return 0;
	try {
		const specific = Number(
			localStorage.getItem(
				`${LAST_SEEN_PREFIX}${roomId}:${userKey || "guest"}`,
			) || 0,
		);
		return Number.isFinite(specific) && specific > 0 ? specific : 0;
	} catch {
		return 0;
	}
}

function applyUnreadInitState(
	roomId: string,
	userKey: string,
	roomMessages: ChatMessageRecord[],
	lastReadAt = 0,
	unreadCount = 0,
	unreadUserCount = 0,
	hasMore = false,
) {
	const localSeen = readUserLastSeen(roomId, userKey);
	const baseline = Math.max(lastReadAt, localSeen);
	const visibleUnreadInBatch = roomMessages.some(
		(m) => m.createdAt > baseline && !isMusicNoticeMessage(m),
	);
	const serverVisibleUnread = unreadUserCount;
	const oldestLoadedTs = roomMessages[0]?.createdAt ?? 0;
	const hasOlderUnloadedUnread =
		baseline > 0 &&
		hasMore &&
		oldestLoadedTs > 0 &&
		baseline < oldestLoadedTs &&
		serverVisibleUnread > 0;
	const hasNewSinceBaseline =
		baseline > 0 && (visibleUnreadInBatch || hasOlderUnloadedUnread);
	sessionUnreadSince = hasNewSinceBaseline ? baseline : 0;
	serverUnreadCount = unreadCount;
	serverUnreadUserCount = unreadUserCount;
	if (!hasNewSinceBaseline && lastReadAt > 0 && lastReadAt > localSeen) {
		persistUserLastSeen(roomId, userKey, lastReadAt);
	}
}

function persistUserLastSeen(roomId: string, userKey: string, ts: number) {
	if (typeof localStorage === "undefined" || !Number.isFinite(ts) || ts <= 0) {
		return;
	}
	try {
		const key = `${LAST_SEEN_PREFIX}${roomId}:${userKey || "guest"}`;
		const prev = Number(localStorage.getItem(key) || 0);
		if (ts > prev) {
			localStorage.setItem(key, String(ts));
		}
	} catch {
		// Ignore
	}
}

function readStoredRoom(): string {
	if (typeof localStorage === "undefined") return "";
	try {
		return localStorage.getItem(LAST_ROOM_STORAGE_KEY)?.trim() || "";
	} catch {
		return "";
	}
}

function persistStoredRoom(roomId: string) {
	if (typeof localStorage === "undefined" || !roomId) return;
	try {
		localStorage.setItem(LAST_ROOM_STORAGE_KEY, roomId);
	} catch {
		// Ignore
	}
}

// 切换房间后同步 URL 上的 room 参数，避免刷新时被旧参数带回上一个房间
function syncRoomUrl(roomId: string) {
	if (typeof window === "undefined" || !roomId) return;
	try {
		const url = new URL(window.location.href);
		if (url.searchParams.get("room") === roomId) return;
		url.searchParams.set("room", roomId);
		window.history.replaceState(
			null,
			"",
			`${url.pathname}${url.search}${url.hash}`,
		);
	} catch {
		// Ignore
	}
}

let showProfileModal = $state(false);
let chatAppearance = $state<ChatAppearanceSettings>(
	loadChatAppearanceSettings(),
);
let catalogRevision = $state(0);
let devPanelPreviews = $state<Partial<Record<ChatPanelSlot, string>>>({});
let failedPanelBg = $state<Record<ChatPanelSlot, boolean>>({
	left: false,
	center: false,
	right: false,
	input: false,
});
let sideDragActive = $state<{ left: boolean; right: boolean }>({
	left: false,
	right: false,
});
const sideDragCounters = { left: 0, right: 0 };

const effectivePanelBgUrls = $derived.by(() => {
	void catalogRevision;
	return {
		left: resolveSlotWallpaperSrc("left", chatAppearance, devPanelPreviews),
		center: resolveSlotWallpaperSrc("center", chatAppearance, devPanelPreviews),
		right: resolveSlotWallpaperSrc("right", chatAppearance, devPanelPreviews),
		input: resolveSlotWallpaperSrc("input", chatAppearance, devPanelPreviews),
	};
});

const preloadedImageUrls = new Set<string>();

function preloadImageUrl(url: string) {
	if (!url || preloadedImageUrls.has(url) || typeof Image === "undefined")
		return;
	preloadedImageUrls.add(url);
	const img = new Image();
	img.decoding = "async";
	img.fetchPriority = "low";
	img.src = url;
}

$effect(() => {
	if (!panelBgReady) return;
	const urls: string[] = [
		effectivePanelBgUrls.left,
		effectivePanelBgUrls.center,
		effectivePanelBgUrls.right,
		effectivePanelBgUrls.input,
	];
	const pending = urls.filter((u) => u && !preloadedImageUrls.has(u));
	if (pending.length === 0) return;

	const run = () => {
		for (const url of pending) {
			preloadImageUrl(url);
		}
	};
	if (typeof window !== "undefined" && "requestIdleCallback" in window) {
		const id = window.requestIdleCallback(run, { timeout: 1200 });
		return () => window.cancelIdleCallback(id);
	}
	const timer = setTimeout(run, 100);
	return () => clearTimeout(timer);
});

function handleSidePanelDragEnter(slot: "left" | "right", e: DragEvent) {
	if (!import.meta.env.DEV) return;
	if (!e.dataTransfer?.types?.includes("Files")) return;
	e.preventDefault();
	e.stopPropagation();
	sideDragCounters[slot] += 1;
	sideDragActive = { ...sideDragActive, [slot]: true };
}

function handleSidePanelDragOver(slot: "left" | "right", e: DragEvent) {
	if (!import.meta.env.DEV) return;
	if (!e.dataTransfer?.types?.includes("Files")) return;
	e.preventDefault();
	e.stopPropagation();
	if (e.dataTransfer) {
		e.dataTransfer.dropEffect = "copy";
	}
	if (!sideDragActive[slot]) {
		sideDragActive = { ...sideDragActive, [slot]: true };
	}
}

function handleSidePanelDragLeave(slot: "left" | "right", e: DragEvent) {
	if (!import.meta.env.DEV) return;
	e.preventDefault();
	e.stopPropagation();
	sideDragCounters[slot] = Math.max(0, sideDragCounters[slot] - 1);
	if (sideDragCounters[slot] === 0) {
		sideDragActive = { ...sideDragActive, [slot]: false };
	}
}

async function handleSidePanelDrop(slot: "left" | "right", e: DragEvent) {
	if (!import.meta.env.DEV) return;
	e.preventDefault();
	e.stopPropagation();
	sideDragCounters[slot] = 0;
	sideDragActive = { ...sideDragActive, [slot]: false };
	const files = Array.from(e.dataTransfer?.files || []);
	const imageFile = files.find((f) => f.type.startsWith("image/"));
	if (!imageFile) {
		showNotice("请拖入图片文件以预览面板壁纸");
		return;
	}
	await saveDevPanelWallpaperPreview(slot, imageFile);
	showNotice(
		slot === "left"
			? `已更新左侧面板壁纸预览：${imageFile.name}`
			: `已更新右侧面板壁纸预览：${imageFile.name}`,
	);
}
let showAuthModal = $state(false);
let showUserDetailModal = $state(false);
let showPollCreateModal = $state(false);

// 非首屏必需的弹窗与点歌台面板按需动态加载，减小聊天页首包 JS 体积
let MusicPanelComp = $state<
	typeof import("./MusicPanel.svelte").default | null
>(null);
let musicPanelLoading = false;
let pendingOpenPlayerTab = false;

function ensureMusicPanelLoaded() {
	if (MusicPanelComp || musicPanelLoading || isUnmounted) return;
	musicPanelLoading = true;
	void import("./MusicPanel.svelte")
		.then((mod) => {
			if (!isUnmounted) {
				MusicPanelComp = mod.default;
			}
		})
		.catch((err) => {
			console.error("[chat] Failed to load MusicPanel:", err);
			pendingOpenPlayerTab = false;
		})
		.finally(() => {
			musicPanelLoading = false;
		});
}

$effect(() => {
	if (!musicPanelRef) return;
	if (pendingOpenPlayerTab) {
		pendingOpenPlayerTab = false;
		musicPanelRef.openPlayerTab?.();
	}
});

$effect(() => {
	if (!pendingSongListen) return;
	const { room, playUid } = pendingSongListen;
	if (room !== currentRoom || musicState?.current?.uid !== playUid) {
		pendingSongListen = null;
	} else if (musicPanelRef) {
		pendingSongListen = null;
		void tick().then(() => {
			if (room === currentRoom && musicState?.current?.uid === playUid) {
				musicPanelRef?.startListeningControl?.();
			}
		});
	}
});

let ChatAuthModalComp = $state<
	typeof import("./ChatAuthModal.svelte").default | null
>(null);
let ChatPollCreateModalComp = $state<
	typeof import("./ChatPollCreateModal.svelte").default | null
>(null);
let ChatProfileModalComp = $state<
	typeof import("./ChatProfileModal.svelte").default | null
>(null);
let ChatUserDetailModalComp = $state<
	typeof import("./ChatUserDetailModal.svelte").default | null
>(null);

$effect(() => {
	if (showAuthModal && !ChatAuthModalComp) {
		void import("./ChatAuthModal.svelte")
			.then((mod) => {
				ChatAuthModalComp = mod.default;
			})
			.catch((err) => {
				console.error("[chat] Failed to load ChatAuthModal:", err);
				showAuthModal = false;
				showNotice("登录弹窗加载失败，请检查网络后重试", "error");
			});
	}
});
$effect(() => {
	if (showPollCreateModal && !ChatPollCreateModalComp) {
		void import("./ChatPollCreateModal.svelte")
			.then((mod) => {
				ChatPollCreateModalComp = mod.default;
			})
			.catch((err) => {
				console.error("[chat] Failed to load ChatPollCreateModal:", err);
				showPollCreateModal = false;
				showNotice("投票弹窗加载失败，请检查网络后重试", "error");
			});
	}
});
$effect(() => {
	if (showProfileModal && !ChatProfileModalComp) {
		void import("./ChatProfileModal.svelte")
			.then((mod) => {
				ChatProfileModalComp = mod.default;
			})
			.catch((err) => {
				console.error("[chat] Failed to load ChatProfileModal:", err);
				showProfileModal = false;
				showNotice("资料编辑弹窗加载失败，请检查网络后重试", "error");
			});
	}
});
$effect(() => {
	if (showUserDetailModal && !ChatUserDetailModalComp) {
		void import("./ChatUserDetailModal.svelte")
			.then((mod) => {
				ChatUserDetailModalComp = mod.default;
			})
			.catch((err) => {
				console.error("[chat] Failed to load ChatUserDetailModal:", err);
				showUserDetailModal = false;
				showNotice("用户资料卡加载失败，请检查网络后重试", "error");
			});
	}
});

function openAuthModal() {
	showUserDetailModal = false;
	showProfileModal = false;
	mobileDrawer = "none";
	closeSplitRoom();
	showAuthModal = true;
}

$effect(() => {
	if (showAuthModal) {
		showUserDetailModal = false;
		showProfileModal = false;
		mobileDrawer = "none";
		closeSplitRoom();
	}
	if (
		showAuthModal ||
		showProfileModal ||
		showUserDetailModal ||
		showPollCreateModal
	) {
		if (mobileDrawer !== "none") {
			mobileDrawer = "none";
		}
	}
});
let userDetailSeed = $state<ChatUserDetailSeed | null>(null);
let externalPlaylistRequest = $state<
	| { playlistId: string; seq: number; summary?: Partial<PlaylistSummary> }
	| undefined
>(undefined);
let mentionEvent = $state<
	{ name: string; userKey?: string; seq: number } | undefined
>(undefined);
let stickerPacks = $state<StickerPack[]>([]);

let mentionSeq = 0;
let externalPlaylistSeq = 0;
let baseDocumentTitle = "";

function cleanDocumentTitle(title: string): string {
	return (title || "")
		.replace(/^(\[(?:有人提到了你|提到了你)\]\s*)+/gu, "")
		.trim();
}

function isDocumentHidden(): boolean {
	if (typeof document === "undefined") return false;
	return document.hidden || document.visibilityState !== "visible";
}

function updateMentionDocumentTitle(): void {
	if (typeof document === "undefined") return;
	const clean =
		cleanDocumentTitle(baseDocumentTitle || document.title) || "聊天室";
	baseDocumentTitle = clean;
	if (!document.title.startsWith("[提到了你]")) {
		document.title = `[提到了你] ${clean}`;
	}
}

function restoreDocumentTitle(): void {
	if (typeof document === "undefined") return;
	const clean =
		cleanDocumentTitle(baseDocumentTitle || document.title) || "聊天室";
	baseDocumentTitle = clean;
	if (document.title !== clean) {
		document.title = clean;
	}
}
let ws: WebSocket | null = null;
let pendingCloseSocket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let noticeTimer: number | null = null;
let reconnectAttempt = 0;
let isUnmounted = false;
let secondaryStartupDone = false;
let secondaryStartupTimer: number | null = null;
let panelBgReady = $state(false);

function enablePanelBackgroundsSoon() {
	if (panelBgReady || isUnmounted) return;
	if (
		typeof window !== "undefined" &&
		typeof window.requestAnimationFrame === "function"
	) {
		window.requestAnimationFrame(() => {
			if (!isUnmounted) panelBgReady = true;
		});
	} else {
		panelBgReady = true;
	}
}

function runSecondaryStartup() {
	if (secondaryStartupDone || isUnmounted) return;
	secondaryStartupDone = true;
	if (secondaryStartupTimer !== null) {
		window.clearTimeout(secondaryStartupTimer);
		secondaryStartupTimer = null;
	}
	enablePanelBackgroundsSoon();
	ensureMusicPanelLoaded();
	// 闲时后台预载常用弹窗组件，确保用户点击名片或资料编辑时毫无网络卡顿感
	void import("./ChatUserDetailModal.svelte").then((mod) => {
		if (!isUnmounted && !ChatUserDetailModalComp)
			ChatUserDetailModalComp = mod.default;
	}).catch(() => {});
	void import("./ChatProfileModal.svelte").then((mod) => {
		if (!isUnmounted && !ChatProfileModalComp)
			ChatProfileModalComp = mod.default;
	}).catch(() => {});
	void loadStickerPacks(stickerPackUrls).then((packs) => {
		if (!isUnmounted) stickerPacks = packs;
	});
	void refreshGlobalPresence();
	void refreshMemberDirectory();
}

$effect(() => {
	if (mobileDrawer !== "none") {
		panelBgReady = true;
	}
	if (mobileDrawer === "music") {
		ensureMusicPanelLoaded();
	}
	if (mobileDrawer === "room" && !secondaryStartupDone) {
		runSecondaryStartup();
	}
});

$effect(() => {
	if (externalPlaylistRequest || musicState?.current) {
		ensureMusicPanelLoaded();
	}
});

const stickerMap = $derived(buildStickerLookup(stickerPacks));
const activeMeta = $derived(
	rooms.find((r) => r.id === currentRoom) ??
		rooms[0] ?? { id: "chat", name: "闲聊", subtitle: "随便聊聊日常与折腾" },
);

$effect(() => {
	updatePlaybackDiagnostic(musicState?.current ?? null, localAudioDiagnostic, activeMeta.name, connectionState === "connected");
});
const normalizedChatServer = $derived(normalizeServerUrl(chatServerUrl));

function clearSkipPending() {
	isSkippingTrack = false;
	if (skipPendingTimer !== null) {
		window.clearTimeout(skipPendingTimer);
		skipPendingTimer = null;
	}
}

function startSkipPending() {
	isSkippingTrack = true;
	if (skipPendingTimer !== null) {
		window.clearTimeout(skipPendingTimer);
	}
	skipPendingTimer = window.setTimeout(() => {
		isSkippingTrack = false;
		skipPendingTimer = null;
	}, 4500);
}

function handleSkipTrack() {
	if (!currentUser) {
		openAuthModal();
		return;
	}
	if (isSkippingTrack) return;
	recordMusicEvent("command-skip", musicState?.current?.uid);
	if (sendPacket({ type: "music:skip", playUid: musicState?.current?.uid })) {
		startSkipPending();
		showNotice("已跳过当前播放", "success");
	}
}

function handleVoteSkip() {
	if (!currentUser) {
		openAuthModal();
		return;
	}
	if (isSkippingTrack) return;
	recordMusicEvent("command-vote_skip", musicState?.current?.uid);
	const hasVoted = Boolean(
		musicState?.current?.skipVotes.includes(currentUser.userKey),
	);
	const willPass =
		!hasVoted &&
		(musicState?.voteCount ?? 0) + 1 >= (musicState?.voteThreshold ?? 2);
	if (
		sendPacket({
			type: "music:vote_skip",
			playUid: musicState?.current?.uid,
		})
	) {
		if (willPass) {
			startSkipPending();
			showNotice("投票切歌已通过，正在切歌", "success");
		} else if (!hasVoted) {
			showNotice(
				`已投票切歌（当前 ${(musicState?.voteCount ?? 0) + 1}/${musicState?.voteThreshold ?? 2} 票）`,
				"default",
			);
		}
	}
}

function handlePlayQueued(uid: string) {
	if (!currentUser) {
		openAuthModal();
		return;
	}
	recordMusicEvent("command-play_queued", musicState?.current?.uid);
	if (
		sendPacket({
			type: "music:play_queued",
			uid,
			playUid: musicState?.current?.uid,
		})
	) {
		startSkipPending();
		showNotice("已切换为播放该曲目", "success");
	}
}

let rotationAction = $state<RotationAction | null>(null);
let rotationOrigin = $state<RotationQueueItem | null>(null);
let rotationOfferOpen = $state(false);
let songOfferOrigin = $state<ChatMusicTrack | null>(null);
let fallbackSearch = $state<{ query: string; seq: number } | undefined>(undefined);
let fallbackSearchSeq = 0;
let versionAnchor = $state.raw<HTMLElement | undefined>(undefined);
let versionPopover: HTMLElement | undefined = $state.raw(undefined);
let rotationRequestId = "";
let rotationRequestTimer: number | undefined;
let rotationOfferTimer: number | undefined;
let rotationOfferPlayUid = "";

$effect(() => {
	if (rotationAction?.offer && !musicState?.rotationQueue?.some(item =>
		(item.entryId ?? item.id) === rotationAction?.entryId
	)) {
		rotationOfferOpen = true;
	}
});

const versionLabels: [RegExp, string][] = [
	[/^(?:live\b|现场|現場|演唱会|演唱會)/iu, "现场版"],
	[/^(?:acoustic\b|不插电|不插電)/iu, "不插电版"],
	[/^(?:instrumental\b|karaoke\b|伴奏)/iu, "伴奏版"],
	[/^(?:re-?record(?:ed)?\b|重录|重錄)/iu, "重录版"],
	[/^(?:remaster(?:ed)?\b|重制|重製)/iu, "重制版"],
	[/^(?:cover\b|翻唱)/iu, "翻唱版"],
	[/^(?:remix\b|混音)/iu, "混音版"],
];

function describeVersionDifference(
	original: RotationQueueItem,
	track: ChatMusicTrack,
	relation: RotationOffer["choices"][number]["relation"],
): string {
	if (relation === "same_artist_other") return "同歌手的另一首歌";
	const ending = track.title
		.normalize("NFKC")
		.match(/(?:\(([^()]+)\)|\[([^\[\]]+)\]|【([^【】]+)】|\s[-–—]\s+([^\n]+))$/u);
	const version = (ending?.[1] ?? ending?.[2] ?? ending?.[3] ?? ending?.[4] ?? "").trim()
		.replace(/^(?:19|20)\d{2}\s+/u, "");
	const versionLabel = versionLabels.find(([pattern]) => pattern.test(version))?.[1];
	if (relation === "same_title") {
		return versionLabel ? versionLabel + " · 歌手署名不同" : "歌手署名不同";
	}
	if (versionLabel) return versionLabel;
	if (original.album && track.album && original.album !== track.album) return "收录专辑不同";
	return "录音版本待确认";
}

function describeVersionDuration(original: number | undefined, duration: number | undefined): string {
	if (!duration || duration <= 0 || !Number.isFinite(duration)) return "";
	const time = formatClockSeconds(duration);
	if (!original || original <= 0 || !Number.isFinite(original)) return time;
	const difference = Math.round(duration - original);
	if (!difference) return time;
	return time + " · " + (difference > 0 ? "长 " : "短 ") + Math.abs(difference) + " 秒";
}

function clearRotationRequest() {
	window.clearTimeout(rotationRequestTimer);
	rotationRequestTimer = undefined;
	rotationRequestId = "";
}

function closeRotationOffer() {
	if (rotationAction?.pending) return;
	const anchor = versionAnchor;
	if (versionPopover?.contains(document.activeElement) && anchor?.isConnected) {
		const button = anchor.matches("button") ? anchor : anchor.querySelector<HTMLElement>("button:not([disabled])");
		button?.focus({ preventScroll: true });
	}
	clearRotationAction();
}

function clearRotationAction() {
	clearRotationRequest();
	window.clearTimeout(rotationOfferTimer);
	rotationOfferTimer = undefined;
	rotationAction = null;
	rotationOrigin = null;
	songOfferOrigin = null;
	rotationOfferOpen = false;
	versionAnchor = undefined;
	rotationOfferPlayUid = "";
}

function sendRotationRequest(track: RotationQueueItem, choiceId?: string) {
	if (!currentUser) {
		openAuthModal();
		return;
	}
	if (rotationRequestId) return;
	const entryId = track.entryId ?? track.id;
	const offer = choiceId ? rotationAction?.offer : undefined;
	if (choiceId && !offer) return;
	const requestId = crypto.randomUUID();
	const playUid = musicState?.current?.uid ?? "";
	const command = offer
		? { type: "music:confirm_rotation", offerId: offer.token, choiceId }
		: {
				type: "music:play_rotation",
				entryId: track.entryId,
				trackId: track.id,
				track: {
					id: track.id,
					title: track.title,
					artist: track.artist,
					album: track.album,
					durationSec: track.durationSec,
					pic: track.pic,
					source: track.sourcePlatform,
					sourceTrackId: track.sourceTrackId,
					sourceId: track.sourceTrackId,
				},
			};
	const sent = sendPacket({
		...command,
		requestId,
		playUid,
	});
	if (!sent) {
		rotationAction = { entryId, offer, code: "SOURCE_TEMPORARY", message: "连接暂时不可用，请重试" };
		return;
	}
	recordMusicEvent(choiceId ? "command-confirm_rotation" : "command-play_rotation", track.id);
	rotationOrigin = track;
	if (!choiceId) rotationOfferPlayUid = playUid;
	rotationAction = { entryId, offer, pending: true };
	rotationRequestId = requestId;
	rotationRequestTimer = window.setTimeout(() => {
		clearRotationRequest();
		rotationAction = { entryId, offer, code: "SOURCE_TEMPORARY", message: "未收到切播结果，请检查当前播放后重试" };
	}, track.entryId ? 13_000 : 6000);
}

function handlePlayRotationTrack(track: RotationQueueItem, anchor?: HTMLElement) {
	if (!rotationRequestId) versionAnchor = anchor;
	sendRotationRequest(track);
}

function showVersionOffer(offer: RotationOffer) {
	const entryId = rotationAction?.entryId;
	if (!entryId) return;
	rotationOfferOpen = true;
	void tick().then(() => {
		if (rotationAction?.offer?.token !== offer.token) return;
		const focused = document.activeElement;
		if (focused === document.body || versionAnchor?.contains(focused)) {
			versionPopover?.querySelector<HTMLElement>("[data-version-choice]")?.focus({ preventScroll: true });
		}
	});
	window.clearTimeout(rotationOfferTimer);
	rotationOfferTimer = window.setTimeout(() => {
		if (rotationAction?.offer?.token !== offer.token || rotationAction.pending) return;
		rotationAction = { entryId, code: "OFFER_EXPIRED", message: "可播版本已过期，请重新查找" };
	}, Math.max(0, offer.expiresAt - serverNow()));
}

function submitVersionOffer(choiceId?: string) {
	if (rotationAction?.pending) return;
	if (!songOfferOrigin) {
		if (rotationOrigin) sendRotationRequest(rotationOrigin, choiceId);
		return;
	}
	const origin = songOfferOrigin;
	const offer = choiceId ? rotationAction?.offer : undefined;
	if (choiceId && !offer) return;
	if (!currentUser) {
		clearRotationAction();
		openAuthModal();
		return;
	}
	rotationAction = { entryId: origin.id, offer, pending: true };
	void sendSongRequest(origin, { anchor: versionAnchor, fromOffer: true, offerId: offer?.token, choiceId });
}

function searchForAnotherVersion() {
	if (!rotationOrigin || rotationAction?.pending) return;
	const query = [rotationOrigin.title, rotationOrigin.artist].filter(Boolean).join(" ");
	clearRotationAction();
	showUserDetailModal = false;
	fallbackSearch = { query, seq: ++fallbackSearchSeq };
	mobileDrawer = "music";
	closeSplitRoom();
	ensureMusicPanelLoaded();
}

function openRotationOffer() {
	if (!rotationAction?.offer || rotationAction.pending) return;
	rotationOfferOpen = true;
}

function handleVersionPopoverKeys(event: KeyboardEvent) {
	if (event.key !== "Escape" || rotationAction?.pending || !(event.target instanceof Node)) return;
	if (!versionPopover?.contains(event.target) && !versionAnchor?.contains(event.target)) return;
	closeRotationOffer();
}

function placeVersionPopover(node: HTMLDivElement, anchor?: HTMLElement) {
	function place(reference?: HTMLElement) {
		const layer = reference?.closest('[role="dialog"]') ?? document.getElementById("chat-modal-layer");
		if (layer && node.parentElement !== layer) layer.appendChild(node);
	}
	place(anchor);
	return { update: place, destroy: () => node.remove() };
}

function placeGlobalToast(node: HTMLDivElement) {
	document.body.appendChild(node);
	return {
		destroy() {
			node.remove();
		},
	};
}

function showNotice(msg: string, tone?: "default" | "error" | "success") {
	noticeText = msg;
	noticeTone =
		tone ??
		(/(失败|不可用|异常|错误|无法|未找到|超时|拒绝|拦截|未授予|无效|不能|失效)/.test(msg)
			? "error"
			: /(成功|已加入|已点播|已收藏|已导入|已刷新|已保存|已删除|已更新|已跳过|已重新洗牌|已开启|已复制|已同步|已移出|已切换)/.test(msg)
				? "success"
				: "default");
	noticeVisible = true;
	if (noticeTimer !== null) window.clearTimeout(noticeTimer);
	noticeTimer = window.setTimeout(() => {
		noticeVisible = false;
	}, 3600);
}

function pushTestStorageKey(userKey: string) {
	return `fireflyChatPushTestUntil:${userKey}`;
}

function refreshPushDisplay() {
	const saved = readChatPushSettings();
	const permission = typeof Notification !== "undefined" ? Notification.permission :
		saved && saved.userKey === currentUser?.userKey && saved.mode !== "off" ? "granted" : "default";
	desktopNotificationPermission = permission;
	if (!pushSaving) {
		desktopNotificationMode = saved && saved.userKey === currentUser?.userKey &&
			permission === "granted" ? saved.mode : "off";
	}
	try {
		const userKey = currentUser?.userKey;
		pushTestUntil = userKey ? Number(localStorage.getItem(pushTestStorageKey(userKey))) || 0 : 0;
		const legacyMode = localStorage.getItem(NOTIFICATION_MODE_STORAGE_KEY);
		pushNeedsMigration = !saved && (legacyMode === "all" || legacyMode === "mention" ||
			(!legacyMode && localStorage.getItem(NOTIFICATION_STORAGE_KEY) === "true"));
	} catch {}
}

function preparePushSettings() {
	pushPreparation ??= prepareChatPush(normalizedChatServer)
		.then((prepared) => {
			preparedPush = prepared;
			return prepared;
		})
		.finally(() => { pushPreparation = undefined; });
	return pushPreparation;
}

$effect(() => {
	const userKey = currentUser?.userKey;
	if (!hasAppMounted || !userKey) return;
	untrack(() => {
		refreshPushDisplay();
		const saved = readChatPushSettings();
		if (saved && saved.userKey !== userKey) {
			void (async () => {
				await pushOperation;
				const previous = readChatPushSettings();
				if (previous && previous.userKey !== currentUser?.userKey) {
					await disableChatPush(normalizedChatServer, previous);
					preparedPush = undefined;
				}
				refreshPushDisplay();
			})().catch(() => showNotice("旧账号的推送尚未关闭，请重试开启或关闭浏览器通知权限"));
		} else if (!saved && !preparedPush && normalizedChatServer && supportsChatPush()) {
			// Prepare before the click so the first subscribe call can run in the browser's user gesture.
			void preparePushSettings().catch(() => {});
		}
	});
});

async function savePushMode(
	server: string,
	auth: NonNullable<typeof currentAuth>,
	userKey: string,
	mode: ChatDesktopNotificationMode,
) {
	const saved = readChatPushSettings();
	const owned = saved?.userKey === userKey ? saved : null;
	const result = owned ? await updateChatPushMode(server, userKey, mode) : "missing";
	if (result === "updated") return;
	if (mode === "off") {
		if (owned) {
			await disableChatPush(server, owned);
			preparedPush = undefined;
		}
		return;
	}
	if (saved && !owned) {
		await disableChatPush(server, saved);
		preparedPush = undefined;
	}
	const prepared = preparedPush ?? await preparePushSettings();
	if (currentUser?.userKey !== userKey || !currentAuth) return;
	if (result === "missing" && owned && prepared.subscription) {
		await prepared.subscription.unsubscribe();
		prepared.subscription = null;
	}
	await enableChatPush(server, auth, userKey, getOrCreateVisitorId(), mode, prepared);
}

async function setDesktopNotificationMode(mode: ChatDesktopNotificationMode) {
	const auth = currentAuth;
	const userKey = currentUser?.userKey;
	const server = normalizedChatServer;
	if (!auth || !userKey || !server || pushLoggingOut || (pushSaving && mode === desktopNotificationMode)) return;
	const unavailable = mode === "off" ? null : chatPushUnavailableReason();
	if (unavailable) {
		showNotice(unavailable);
		return;
	}
	if (mode !== "off" && typeof Notification !== "undefined") {
		if (Notification.permission === "denied") {
			showNotice("浏览器已拦截通知权限，请在地址栏网站权限中设为允许后重试");
			return;
		}
		if (Notification.permission === "default") {
			const perm = await requestNotificationPermission();
			desktopNotificationPermission = perm;
			if (perm !== "granted") {
				if (perm === "denied") {
					showNotice("浏览器已拦截通知权限，请在地址栏网站权限中设为允许后重试");
				} else {
					showNotice("未授予通知权限，无法启用浏览器推送");
				}
				refreshPushDisplay();
				return;
			}
		}
	}
	desktopNotificationMode = mode;
	pendingPushMode = { server, auth, userKey, mode };
	if (pushSaving) return;
	pushSaving = true;
	const saveLatestMode = async () => {
		while (pendingPushMode) {
			const requested = pendingPushMode;
			pendingPushMode = undefined;
			if (currentUser?.userKey !== requested.userKey) continue;
			try {
				await savePushMode(requested.server, requested.auth, requested.userKey, requested.mode);
				try {
					localStorage.removeItem(NOTIFICATION_MODE_STORAGE_KEY);
					localStorage.removeItem(NOTIFICATION_STORAGE_KEY);
				} catch {}
			} catch (error) {
				if (pendingPushMode || currentUser?.userKey !== requested.userKey) continue;
				const reason = error instanceof Error ? error.message : "";
				if (
					(typeof Notification !== "undefined" && Notification.permission === "denied") ||
					(error instanceof Error && error.name === "NotAllowedError")
				) {
					showNotice("浏览器未授予通知权限，请检查地址栏网站权限");
				} else if (reason === "worker") {
					showNotice("浏览器推送脚本未能启动，请刷新后重试");
				} else if (reason === "push-api") {
					showNotice(
						isIOSDevice()
							? "iOS 需在 Safari 点击【分享】->【添加到主屏幕】打开后使用推送"
							: "当前浏览器环境未开放后台推送接口",
					);
				} else if (reason === "endpoint") {
					showNotice("当前浏览器的推送服务暂未适配");
				} else if (error instanceof Error && error.name === "AbortError") {
					showNotice("无法连接到浏览器的推送服务（FCM），请检查网络后重试");
				} else {
					showNotice("同步推送设置失败，请重试");
				}
			}
		}
	};
	pushOperation = saveLatestMode().finally(() => {
		pendingPushMode = undefined;
		pushOperation = undefined;
		pushSaving = false;
		refreshPushDisplay();
	});
}

async function sendTestPush() {
	const auth = currentAuth;
	const userKey = currentUser?.userKey;
	if (!auth || !userKey || pushSaving || pushTesting || pushTestUntil > Date.now()) return;
	pushTesting = true;
	try {
		const { status, cooldownMs } = await testChatPush(normalizedChatServer, auth, userKey);
		const until = Date.now() + cooldownMs;
		try { localStorage.setItem(pushTestStorageKey(userKey), String(until)); } catch {}
		if (currentUser?.userKey !== userKey) return;
		pushTestUntil = until;
		if (status === "sent") showNotice("测试推送已发出，请查看系统通知");
		if (status === "failed") showNotice("测试推送未发出，请检查订阅状态");
	} catch {
		showNotice("测试推送未发出，请检查订阅状态后重试");
	} finally {
		pushTesting = false;
	}
}

async function handleToggleDesktopNotification() {
	if (!currentUser) {
		openAuthModal();
		return;
	}
	const next = { off: "mention", mention: "all", all: "off" } as const;
	await setDesktopNotificationMode(next[desktopNotificationMode]);
}

function sendPacket(packet: Record<string, unknown>): boolean {
	if (!ws || ws.readyState !== WebSocket.OPEN) {
		showNotice(
			navigator.onLine
				? "正在重新连接聊天室，请稍候..."
				: "网络已断开，请检查网络连接",
		);
		return false;
	}
	ws.send(JSON.stringify(packet));
	return true;
}

function getFixedRoleBadge(user: ChatSessionUser): string {
	if (user.isAdmin) return "站长";
	return user.authType === "waline" ? "认证" : "访客";
}

function sampleRoomClock(socket: WebSocket | null, refresh = false) {
	if (refresh && socket?.readyState === WebSocket.OPEN) {
		musicClock.resetSamples();
		pendingClockPings.delete(socket);
		clockBurstRemaining = 3;
	}
	if (socket?.readyState !== WebSocket.OPEN || pendingClockPings.has(socket))
		return;
	const sample = {
		wall: Date.now(),
		monotonic: performance.now(),
		id: ++clockPingSeq,
	};
	pendingClockPings.set(socket, sample);
	socket.send(
		JSON.stringify({
			type: "ping",
			id: sample.id,
			musicSyncVersion: 2,
			musicListening:
				isListeningIntent && !mobilePlaybackStatus.isMuted && mobilePlaybackStatus.audioStatus !== "blocked",
			musicPlayUid: musicState?.current?.uid || "",
			musicSourceRevision: musicState?.current?.sourceRevision ?? 0,
		}),
	);
	window.setTimeout(() => {
		if (pendingClockPings.get(socket) === sample)
			pendingClockPings.delete(socket);
	}, 5000);
}

function clearReconnectTimer() {
	if (reconnectTimer !== null) {
		window.clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
}

function handleNetworkOffline() {
	if (isUnmounted) return;
	connectionState = "offline";
	clearReconnectTimer();
	const socket = ws;
	ws = null;
	closePendingSocket();
	clearSkipPending();
	clearRotationAction();
	clearPendingSongRequests();
	socket?.close(1000, "offline");
}

function handleNetworkOnline() {
	if (isUnmounted || connectionState !== "offline" || !normalizedChatServer)
		return;
	reconnectAttempt = 1;
	connectRoom(currentRoom);
}

function connectRoom(roomId: string) {
	if (isUnmounted) return;
	if (!navigator.onLine) {
		handleNetworkOffline();
		return;
	}
	clearReconnectTimer();
	if (ws) {
		// 先保留旧连接，等新房间握手成功后再断开，避免切换瞬间从在线列表里消失。
		closePendingSocket();
		pendingCloseSocket = ws;
		ws = null;
	}

	if (!normalizedChatServer) {
		closePendingSocket();
		connectionState = "offline";
		showNotice("聊天室后端地址尚未配置（请在内容仓配置 chatConfig.serverURL）");
		return;
	}

	connectionState = reconnectAttempt > 0 ? "reconnecting" : "connecting";
	isRoomReady = false;
	lastMarkedServerReadAt = 0;
	lastMarkedServerReadUid = "";
	const storedLastRead = readUserLastSeen(roomId, currentUser?.userKey || "");
	const wsUrl = buildWsUrl(
		normalizedChatServer,
		roomId,
		currentAuth,
		storedLastRead,
		isEffectiveFocused,
	);
	const handshakeSig = currentAuth
		? `${currentAuth.kind}:${currentAuth.token}`
		: "none:";
	const socket = new WebSocket(wsUrl);
	socketHandshakeAuth.set(socket, handshakeSig);
	ws = socket;

	socket.addEventListener("open", () => {
		if (ws !== socket) return;
		connectionState = "connected";
		reconnectAttempt = 0;
		closePendingSocket();
		reportFocusState(true);

		const currentSig = currentAuth
			? `${currentAuth.kind}:${currentAuth.token}`
			: "none:";
		if (currentSig !== socketHandshakeAuth.get(socket)) {
			if (currentAuth) {
				sendPacket({
					type: "auth:sync",
					authKind: currentAuth.kind,
					token: currentAuth.token,
				});
			} else {
				sendPacket({ type: "auth:logout" });
			}
		}

		sendPacket({
			type: "room:register_fallback",
			tracks: musicTracks,
		});
	});

	socket.addEventListener("message", (event) => {
		if (ws !== socket || typeof event.data !== "string") return;
		let packet: ServerPacket;
		try {
			packet = JSON.parse(event.data) as ServerPacket;
		} catch {
			return;
		}

		switch (packet.type) {
			case "room:init": {
				currentUser = packet.self;
				if (packet.self) {
					persistStoredChatUser(packet.self);
					if (packet.self.authType === "waline") {
						syncChatUserToWalineStorage(packet.self);
					}
				} else if (currentAuth) {
					clearStoredChatUser();
					if (currentAuth.kind === "waline") {
						clearWalineAuth();
					} else {
						clearGuestAuth();
					}
					currentAuth = null;
					walineToken = "";
				}
				messages = mergeRoomMessages(
					packet.messages,
					roomMessageCache.get(packet.roomId) ?? [],
					Boolean(packet.hasMoreHistory),
				);
				hasMoreHistory = Boolean(packet.hasMoreHistory);
				clearHistoryLoadTimer();
				isLoadingHistory = false;
				const userKey = packet.self?.userKey || "guest";
				lastMarkedServerReadAt = 0;
				lastMarkedServerReadUid = "";
				if (roomUnreadUids[packet.roomId]?.length) {
					const nextUnread = { ...roomUnreadUids };
					delete nextUnread[packet.roomId];
					roomUnreadUids = nextUnread;
				}
				applyUnreadInitState(
					packet.roomId,
					userKey,
					messages,
					packet.lastReadAt ?? 0,
					packet.unreadCount ?? 0,
					packet.unreadUserCount ?? 0,
					hasMoreHistory,
				);

				roomOnlineMembers = packet.members.filter(
					(m) => !m.roomId || m.roomId === packet.roomId,
				);
				onlineMembers = packet.members;
				observers = uniqueObservers(packet.observers ?? []);
				if (typeof packet.totalCount === "number" && packet.totalCount > 0) {
					totalOnlineCount = packet.totalCount;
				}
				roomMentionMembers = packet.mentionMembers ?? [];
				if (
					typeof packet.totalChatters === "number" &&
					packet.totalChatters > 0
				) {
					totalChatterCount = packet.totalChatters;
				} else if (packet.mentionMembers && packet.mentionMembers.length > 0) {
					totalChatterCount = Math.max(
						totalChatterCount,
						packet.mentionMembers.length,
					);
				}
				musicState = packet.music;
				if (packet.musicAudience) musicAudience = packet.musicAudience;
				oldestHistoryId = messages[0]?.id ?? packet.oldestHistoryId ?? 0;
				activeThreads = packet.activeThreads ?? [];
				pinnedUids = packet.pinnedUids ?? [];
				pinnedDetails = packet.pinnedDetails ?? [];
				roomTopic = packet.topic ?? "";
				if (packet.roomAvatars || typeof packet.roomAvatar === "string") {
					roomAvatars = {
						...roomAvatars,
						...(packet.roomAvatars ?? {}),
						...(typeof packet.roomAvatar === "string"
							? { [packet.roomId]: packet.roomAvatar }
							: {}),
					};
				}
				readReceipts = packet.readReceipts ?? {};
				clearAllTypingTimers();
				clearSkipPending();
				roomInitSeq += 1;
				isRoomReady = true;
				musicClock.seed(packet.music.serverTime);
				if (!hasClockSample)
					clockOffsetMs = packet.music.serverTime - Date.now();
				sampleRoomClock(socket, true);
				if (packet.mergedGuestHistory) {
					showNotice("已自动合并同邮箱的历史访客记录至当前账号");
				}
				if (!secondaryStartupDone) {
					window.setTimeout(runSecondaryStartup, 0);
				}
				break;
			}
			case "chat:history_batch": {
				if (packet.roomId === currentRoom) {
					clearHistoryLoadTimer();
					isLoadingHistory = false;
					hasMoreHistory = Boolean(packet.hasMoreHistory);
					if (packet.messages.length > 0) {
						const existingIds = new Set(messages.map((m) => m.msgUid));
						const prepended = packet.messages.filter(
							(m) => !existingIds.has(m.msgUid),
						);
						if (prepended.length > 0) {
							messages = [...prepended, ...messages].sort(
								(a, b) => a.createdAt - b.createdAt,
							);
						}
					}
					if (messages.length > 0) {
						oldestHistoryId = messages[0].id;
					} else if (packet.oldestHistoryId) {
						oldestHistoryId = packet.oldestHistoryId;
					}
					if (packet.jumpTarget) {
						unreadJumpSeq += 1;
					}
				}
				break;
			}
			case "pong": {
				const sent = pendingClockPings.get(socket);
				if (!sent || (packet.id !== undefined && packet.id !== sent.id)) break;
				pendingClockPings.delete(socket);
				if (musicClock.sample(packet.serverTime, sent.monotonic)) {
					clockOffsetMs = musicClock.now() - Date.now();
					hasClockSample = true;
				}
				// Collect a small initial burst; prefer low-RTT samples over network outliers.
				if (clockBurstRemaining > 0) {
					clockBurstRemaining--;
					window.setTimeout(() => sampleRoomClock(socket), 150);
				}
				break;
			}
			case "auth:result": {
				currentUser = packet.user;
				if (packet.user) {
					persistStoredChatUser(packet.user);
					if (packet.user.authType === "waline") {
						syncChatUserToWalineStorage(packet.user);
					}
				} else {
					clearStoredChatUser();
				}
				if (packet.user?.authType !== "waline") {
					walineToken = "";
				}
				lastMarkedServerReadAt = 0;
				lastMarkedServerReadUid = "";
				playlistRefreshSeq += 1;
				if (!packet.user) {
					sessionUnreadSince = 0;
					serverUnreadCount = 0;
					serverUnreadUserCount = 0;
					roomInitSeq += 1;
				} else if (!packet.roomId || packet.roomId === currentRoom) {
					if (packet.readReceipts) {
						readReceipts = packet.readReceipts;
					}
					applyUnreadInitState(
						currentRoom,
						packet.user.userKey,
						messages,
						packet.lastReadAt ?? 0,
						packet.unreadCount ?? 0,
						packet.unreadUserCount ?? 0,
						hasMoreHistory,
					);
					roomInitSeq += 1;
				}
				if (packet.mergedGuestHistory) {
					showNotice("已自动合并同邮箱的历史访客记录至当前账号");
				}
				if (!secondaryStartupDone) {
					window.setTimeout(runSecondaryStartup, 0);
				}
				break;
			}
			case "member:merged": {
				if (packet.roomId === currentRoom && packet.fromUserKeys.length > 0) {
					const fromSet = new Set(packet.fromUserKeys);
					const targetUser = packet.user;
					const remapList = (keys?: string[]) => {
						if (!keys || keys.length === 0) return keys;
						const seen = new Set<string>();
						const out: string[] = [];
						for (const k of keys) {
							const mapped = fromSet.has(k) ? targetUser.userKey : k;
							if (!mapped || seen.has(mapped)) continue;
							seen.add(mapped);
							out.push(mapped);
						}
						return out;
					};
					messages = messages.map((m) => {
						const isSender = fromSet.has(m.userKey);
						const isReplyTarget = m.replyTo && fromSet.has(m.replyTo.userKey);
						const hasMention =
							m.mentionKeys?.some((k) => fromSet.has(k)) ||
							m.mentionEntities?.some((entity) => fromSet.has(entity.userKey));
						if (!isSender && !isReplyTarget && !hasMention) return m;
						return {
							...m,
							...(isSender
								? {
										userKey: targetUser.userKey,
										name: targetUser.name,
										avatar: targetUser.avatar,
										url: targetUser.url,
										badge: targetUser.badge,
										badgeType: targetUser.badgeType,
										isAdmin: targetUser.isAdmin,
									}
								: {}),
							...(isReplyTarget && m.replyTo
								? {
										replyTo: {
											...m.replyTo,
											userKey: targetUser.userKey,
											name: targetUser.name,
										},
									}
								: {}),
							...(hasMention
								? {
										mentionKeys: remapList(m.mentionKeys),
										mentionEntities: m.mentionEntities?.map((entity) =>
											fromSet.has(entity.userKey) ? { ...entity, userKey: targetUser.userKey } : entity,
										),
									}
								: {}),
						};
					});
					if (musicState) {
						musicState = {
							...musicState,
							current: musicState.current
								? {
										...musicState.current,
										...(!musicState.current.isFallback &&
										fromSet.has(musicState.current.requesterKey)
											? {
													requesterKey: targetUser.userKey,
													requesterName: targetUser.name,
												}
											: {}),
										skipVotes: remapList(musicState.current.skipVotes) ?? [],
									}
								: null,
							queue: musicState.queue.map((q) =>
								fromSet.has(q.requesterKey)
									? {
											...q,
											requesterKey: targetUser.userKey,
											requesterName: targetUser.name,
										}
									: q,
							),
							historyLogs: (musicState.historyLogs ?? []).map((h) =>
								fromSet.has(h.requesterKey)
									? {
											...h,
											requesterKey: targetUser.userKey,
											requesterName: targetUser.name,
											requesterAvatar: targetUser.avatar,
										}
									: h,
							),
						};
					}
					if (userDetailSeed && fromSet.has(userDetailSeed.userKey)) {
						userDetailSeed = {
							...userDetailSeed,
							userKey: targetUser.userKey,
							authType: targetUser.authType,
							name: targetUser.name,
							avatar: targetUser.avatar,
							url: targetUser.url,
							badge: targetUser.badge,
							badgeType: targetUser.badgeType,
							isAdmin: targetUser.isAdmin,
						};
					}
					const remappedReceipts: Record<string, ChatReadReceipt[]> = {};
					let seenTargetReceipt: ChatReadReceipt | null = null;
					for (const [uid, list] of Object.entries(readReceipts)) {
						const kept: ChatReadReceipt[] = [];
						for (const r of list) {
							if (fromSet.has(r.userKey) || r.userKey === targetUser.userKey) {
								if (!seenTargetReceipt || r.ts > seenTargetReceipt.ts) {
									seenTargetReceipt = {
										...r,
										userKey: targetUser.userKey,
										name: targetUser.name,
										avatar: targetUser.avatar || r.avatar,
									};
								}
							} else {
								kept.push(r);
							}
						}
						if (kept.length > 0) remappedReceipts[uid] = kept;
					}
					if (seenTargetReceipt?.msgUid) {
						remappedReceipts[seenTargetReceipt.msgUid] = [
							seenTargetReceipt,
							...(remappedReceipts[seenTargetReceipt.msgUid] || []),
						];
					}
					readReceipts = remappedReceipts;
				}
				break;
			}
			case "playlist:updated":
			case "playlists:updated": {
				if (!packet.roomId || packet.roomId === currentRoom) {
					playlistRefreshSeq += 1;
				}
				break;
			}
			case "member:badges_updated": {
				const { userKey, customBadges } = packet;
				if (currentUser && currentUser.userKey === userKey) {
					currentUser = {
						...currentUser,
						customBadges,
					};
				}
				roomOnlineMembers = roomOnlineMembers.map((m) =>
					m.userKey === userKey ? { ...m, customBadges } : m,
				);
				roomMentionMembers = roomMentionMembers.map((m) =>
					m.userKey === userKey ? { ...m, customBadges } : m,
				);
				globalMemberDirectory = globalMemberDirectory.map((m) =>
					m.userKey === userKey ? { ...m, customBadges } : m,
				);
				messages = messages.map((m) =>
					m.userKey === userKey ? { ...m, customBadges } : m,
				);
				if (userDetailSeed && userDetailSeed.userKey === userKey) {
					userDetailSeed = {
						...userDetailSeed,
						customBadges,
					};
				}
				break;
			}
			case "presence:update": {
				if (packet.roomId === currentRoom) {
					if (packet.musicAudience) musicAudience = packet.musicAudience;
					roomOnlineMembers = packet.members.filter(
						(m) => !m.roomId || m.roomId === currentRoom,
					);
					onlineMembers = packet.members;
					if (packet.observers) {
						observers = uniqueObservers(packet.observers);
					}
					if (typeof packet.totalCount === "number" && packet.totalCount > 0) {
						totalOnlineCount = packet.totalCount;
					}
					if (packet.mentionMembers) {
						roomMentionMembers = packet.mentionMembers;
					}
					if (
						typeof packet.totalChatters === "number" &&
						packet.totalChatters > 0
					) {
						totalChatterCount = packet.totalChatters;
					}
				}
				break;
			}
			case "chat:message": {
				// 撤回提示随 chat:recalled 原位替换；兼容旧客户端的广播不应追加到末尾。
				if (packet.message.recalledMsgUid) break;
				const isCurrent = packet.roomId === currentRoom;
				if (isCurrent) {
					if (!messages.some((m) => m.msgUid === packet.message.msgUid)) {
						messages = [...messages, packet.message];
						if (
							isDocumentHidden() &&
							isMentionedForUser(packet.message, currentUser)
						) {
							updateMentionDocumentTitle();
						}
					}
				} else {
					const cached = roomMessageCache.get(packet.roomId);
					if (
						cached &&
						!cached.some((m) => m.msgUid === packet.message.msgUid)
					) {
						cacheRoomMessages(packet.roomId, [...cached, packet.message]);
					}
					if (packet.message.kind !== "system") {
						const prevUids = roomUnreadUids[packet.roomId] || [];
						if (!prevUids.includes(packet.message.msgUid)) {
							roomUnreadUids = {
								...roomUnreadUids,
								[packet.roomId]: [...prevUids, packet.message.msgUid],
							};
						}
					}
					if (
						isDocumentHidden() &&
						isMentionedForUser(packet.message, currentUser)
					) {
						updateMentionDocumentTitle();
					}
				}
				break;
			}
			case "chat:updated": {
				if (packet.roomId !== currentRoom) break;
				const updated = packet.message;
				messages = messages.map((message) => {
					if (message.msgUid === updated.msgUid) return updated;
					if (message.replyTo?.msgUid !== updated.msgUid) return message;
					return {
						...message,
						replyTo: {
							...message.replyTo,
							content: updated.content
								.replace(/\s+/g, " ")
								.trim()
								.slice(0, 120),
							attachmentKind: getChatAttachmentKind(updated.attachments),
						},
					};
				});
				break;
			}
			case "chat:deleted":
			case "chat:recalled": {
				const notice =
					packet.type === "chat:recalled" ? packet.notice : undefined;
				if (packet.roomId === currentRoom) {
					messages = messages
						.flatMap((m) =>
							m.msgUid === packet.msgUid ? (notice ? [notice] : []) : [m],
						)
						.map((m) =>
							m.replyTo?.msgUid === packet.msgUid
								? {
										...m,
										replyTo: {
											...m.replyTo,
											userKey: m.replyTo.userKey || "",
											content: "",
											attachmentKind: null,
											hasImage: false,
											isRecalled: true,
										},
									}
								: m,
						);
					if (readReceipts[packet.msgUid]) {
						const nextReceipts = { ...readReceipts };
						delete nextReceipts[packet.msgUid];
						readReceipts = nextReceipts;
					}
				} else {
					const cached = roomMessageCache.get(packet.roomId);
					if (cached) {
						roomMessageCache.set(
							packet.roomId,
							cached.flatMap((m) =>
								m.msgUid === packet.msgUid ? (notice ? [notice] : []) : [m],
							),
						);
					}
					const prevUids = roomUnreadUids[packet.roomId];
					if (prevUids?.includes(packet.msgUid)) {
						roomUnreadUids = {
							...roomUnreadUids,
							[packet.roomId]: prevUids.filter((id) => id !== packet.msgUid),
						};
					}
				}
				break;
			}
			case "chat:reaction_updated": {
				if (packet.roomId === currentRoom) {
					messages = messages.map((m) =>
						m.msgUid === packet.msgUid
							? { ...m, reactions: packet.reactions }
							: m,
					);
				}
				break;
			}
			case "chat:edited": {
				if (packet.roomId === currentRoom) {
					const editedPreview = packet.content
						.replace(/\s+/g, " ")
						.trim()
						.slice(0, 120);
					messages = messages.map((m) => {
						if (m.msgUid === packet.msgUid) {
							return {
								...m,
								content: packet.content,
								mentionKeys: packet.mentionKeys,
								mentionEntities: packet.mentionEntities,
								isEdited: true,
								editedAt: packet.editedAt,
							};
						}
						if (m.replyTo && m.replyTo.msgUid === packet.msgUid) {
							return {
								...m,
								replyTo: { ...m.replyTo, content: editedPreview },
							};
						}
						return m;
					});
				}
				break;
			}
			case "chat:pinned_update": {
				if (packet.roomId === currentRoom) {
					pinnedUids = packet.pinnedUids || [];
					if (packet.pinnedDetails) {
						pinnedDetails = packet.pinnedDetails;
					}
				}
				break;
			}
			case "chat:topic_update": {
				if (packet.roomId === currentRoom) {
					roomTopic = packet.topic || "";
				}
				break;
			}
			case "chat:room_avatar_update": {
				if (packet.roomId) {
					roomAvatars = {
						...roomAvatars,
						[packet.roomId]: packet.avatar || "",
					};
				}
				break;
			}
			case "chat:typing": {
				if (packet.roomId === currentRoom) {
					const myName = currentUser?.name?.trim();
					if (Array.isArray(packet.users)) {
						const matrixUsers = packet.users
							.map((u: string) => u?.trim())
							.filter((u: string) => Boolean(u) && (!myName || u !== myName));
						const localUsers = Array.from(typingUserTimers.keys());
						typingUsers = Array.from(new Set([...matrixUsers, ...localUsers]));
					} else if (packet.userName) {
						const targetName = packet.userName.trim();
						if (!targetName || (myName && targetName === myName)) {
							break;
						}
						const existingTimer = typingUserTimers.get(targetName);
						if (packet.typing) {
							if (existingTimer) {
								clearTimeout(existingTimer);
							}
							if (!typingUsers.includes(targetName)) {
								typingUsers = [...typingUsers, targetName];
							}
							const timer = setTimeout(() => {
								typingUserTimers.delete(targetName);
								typingUsers = typingUsers.filter((u) => u !== targetName);
							}, 6000);
							typingUserTimers.set(targetName, timer);
						} else {
							if (existingTimer) {
								clearTimeout(existingTimer);
								typingUserTimers.delete(targetName);
							}
							typingUsers = typingUsers.filter((u) => u !== targetName);
						}
					}
				}
				break;
			}
			case "chat:poll_updated": {
				if (packet.roomId === currentRoom) {
					messages = messages.map((m) =>
						m.msgUid === packet.msgUid && m.poll
							? {
									...m,
									poll: {
										...m.poll,
										votes: packet.votes,
										ended: Boolean(packet.ended),
									},
								}
							: m,
					);
				}
				break;
			}
			case "chat:receipt_update": {
				if (packet.roomId === currentRoom && packet.reader?.userKey) {
					const nextMap: Record<string, ChatReadReceipt[]> = {};
					for (const [uid, list] of Object.entries(readReceipts)) {
						const filtered = list.filter(
							(r) => r.userKey !== packet.reader.userKey,
						);
						if (filtered.length > 0) nextMap[uid] = filtered;
					}
					if (packet.reader.msgUid) {
						const targetList = nextMap[packet.reader.msgUid] || [];
						nextMap[packet.reader.msgUid] = [packet.reader, ...targetList].sort(
							(a, b) => (b.ts || 0) - (a.ts || 0),
						);
					}
					readReceipts = nextMap;
				}
				break;
			}
			case "music:request_wait": {
				const pending = songRequests.get(packet.requestId);
				if (pending?.room === packet.roomId) pending.setWaiting(packet.waiting);
				break;
			}
			case "music:request_result": {
				const pending = songRequests.get(packet.requestId);
				if (!pending || pending.room !== packet.roomId) break;
				pending.finish(packet.ok);
				if (packet.roomId !== currentRoom) break;
				if (packet.code === "AUTH_REQUIRED") {
					if (pending.fromOffer) clearRotationAction();
					openAuthModal();
					break;
				}
				if (pending.randomPlaylistId) {
					if (packet.ok) {
						const status = packet.playImmediately ? "正在播放" : "已加入待播";
						const song = packet.randomTrack;
						showNotice(
							song
								? `随机抽到《${song.title}》${song.artist ? " · " + song.artist : ""}，${status}${song.replacement ? "（替代《" + song.replacement.title + "》）" : ""}`
								: `随机点歌成功，${status}`,
							"success",
						);
						if (packet.playImmediately) listenAfterSongRequest(packet.roomId);
					} else {
						showNotice(packet.error ?? "这次没抽到可播曲目，可以再抽一次", "error");
					}
					break;
				}
				if (!pending.track) break;
				if (packet.offer) {
					clearRotationAction();
					versionAnchor = pending.anchor;
					songOfferOrigin = pending.track;
					rotationOrigin = pending.track;
					rotationAction = { entryId: pending.track.id, offer: packet.offer };
					showVersionOffer(packet.offer);
				} else if (!packet.ok) {
					const message = packet.error || "点歌失败，请重试";
					if (packet.code === "NO_SOURCE") {
						clearRotationAction();
						versionAnchor = pending.anchor;
						songOfferOrigin = pending.track;
						rotationOrigin = pending.track;
						rotationAction = { entryId: pending.track.id, code: packet.code, message };
						rotationOfferOpen = true;
					} else if (pending.fromOffer && songOfferOrigin) {
						rotationAction = {
							entryId: pending.track.id,
							code: packet.code,
							offer: packet.code === "SOURCE_TEMPORARY" ? rotationAction?.offer : undefined,
							message,
						};
					} else {
						showNotice(message, packet.code === "SOURCE_TEMPORARY" ? "default" : "error");
					}
				} else {
					if (pending.fromOffer) clearRotationAction();
					if (packet.playImmediately) {
						listenAfterSongRequest(packet.roomId);
						showNotice(`点歌成功，正在为您播放《${pending.track.title}》`, "success");
					} else if (packet.position) {
						showNotice(`点歌成功，已加入待播队列（第 ${packet.position} 首）`, "success");
					} else {
						showNotice(`点歌成功，已加入待播队列《${pending.track.title}》`, "success");
					}
				}
				break;
			}
			case "music:rotation_result": {
				if (packet.roomId !== currentRoom || packet.requestId !== rotationRequestId || !rotationAction) break;
				clearRotationRequest();
				if (packet.ok) {
					const title = rotationOrigin?.title;
					clearRotationAction();
					showNotice(title ? `已切换播放《${title}》` : "已切换播放选定曲目", "success");
					break;
				}
				if (packet.code === "AUTH_REQUIRED") openAuthModal();
				const previousOffer = rotationAction.offer;
				const offer = packet.offer ?? (packet.code === "SOURCE_TEMPORARY" ? previousOffer : undefined);
				rotationAction = {
					entryId: rotationAction.entryId,
					code: packet.code,
					message: packet.error ?? (offer ? undefined : "切播失败，请重试"),
					offer,
				};
				if (packet.offer) showVersionOffer(packet.offer);
				else if (packet.code === "NO_SOURCE") rotationOfferOpen = true;
				if (!rotationOfferOpen && !offer && !musicState?.rotationQueue?.some(item =>
					(item.entryId ?? item.id) === rotationAction?.entryId
				)) showNotice(packet.error ?? "轮播列表已更新", packet.code === "SOURCE_TEMPORARY" ? "default" : "error");
				break;
			}
			case "music:state": {
				if (packet.roomId === currentRoom) {
					const prevUid = musicState?.current?.uid ?? "";
					const nextUid = packet.current?.uid ?? "";
					const prevVotes = musicState?.voteCount ?? 0;
					if (
						!nextUid ||
						nextUid !== prevUid ||
						packet.voteCount !== prevVotes
					) {
						clearSkipPending();
					}
					if (!songOfferOrigin && rotationAction?.offer && !rotationAction.pending && nextUid !== rotationOfferPlayUid) {
						rotationAction = { entryId: rotationAction.entryId, code: "PLAYBACK_CHANGED", message: "房间播放已变化，请重新查找" };
					}
					if (
						rotationAction?.pending &&
						rotationOrigin &&
						nextUid !== prevUid &&
						packet.current?.track.id === rotationOrigin.id
					) {
						clearRotationAction();
					}
					if (nextUid && nextUid !== prevUid) {
						recordMusicEvent("broadcast", nextUid, {
							previous: prevUid,
							serverSent: packet.serverTime,
							deadline: packet.current?.startedAt ?? 0,
							selectionStartedAt: packet.current?.selectionStartedAt ?? 0,
							clock: Math.round(serverNow()),
						});
					}
					musicClock.seed(packet.serverTime);
					if (!hasClockSample) clockOffsetMs = packet.serverTime - Date.now();
					musicState = {
						protocolVersion: packet.protocolVersion,
						stateVersion: packet.stateVersion,
						next: packet.next,
						current: packet.current,
						queue: packet.queue,
						rotationQueue: packet.rotationQueue ?? musicState?.rotationQueue ?? [],
						rotationDeckTotal: packet.rotationDeckTotal ?? musicState?.rotationDeckTotal ?? 0,
						rotationPoolTotal: packet.rotationPoolTotal ?? musicState?.rotationPoolTotal ?? 0,
						fallbackPlaylistName: packet.fallbackPlaylistName ?? musicState?.fallbackPlaylistName ?? "歌单轮播",
						fallbackPlaylistId: packet.fallbackPlaylistId ?? musicState?.fallbackPlaylistId,
						history: packet.history ?? musicState?.history ?? [],
						historyLogs: packet.historyLogs ?? musicState?.historyLogs ?? [],
						requesterOnline: packet.requesterOnline,
						voteCount: packet.voteCount,
						voteThreshold: packet.voteThreshold,
						skipVoteNames: packet.skipVoteNames ?? [],
						soloCooldownUntil: packet.soloCooldownUntil,
						serverTime: packet.serverTime,
					};
				}
				break;
			}
			case "error": {
				if (rotationAction?.pending) {
					clearRotationRequest();
					rotationAction = { entryId: rotationAction.entryId, message: packet.message };
				}
				clearSkipPending();
				if (packet.code === "AUTH_REQUIRED") {
					showAuthModal = true;
				} else if (packet.code === "WALINE_LOGIN_REQUIRED") {
					clearGuestAuth();
					if (currentAuth?.kind === "guest") {
						currentAuth = null;
					}
					lastMarkedServerReadAt = 0;
					lastMarkedServerReadUid = "";
					showAuthModal = true;
				} else if (packet.code === "TOKEN_INVALID") {
					const invalidKind = packet.authKind ?? currentAuth?.kind;
					clearStoredChatUser();
					if (invalidKind === "waline") {
						clearWalineAuth();
						walineToken = "";
						if (currentAuth?.kind === "waline") {
							currentAuth = null;
							currentUser = null;
						}
					} else if (invalidKind === "guest") {
						clearGuestAuth();
						if (currentAuth?.kind === "guest") {
							currentAuth = null;
							currentUser = null;
						}
					}
					lastMarkedServerReadAt = 0;
					lastMarkedServerReadUid = "";
				}
				if (packet.message) {
					showNotice(packet.message, "error");
				}
				break;
			}
		}
	});

	socket.addEventListener("close", () => {
		if (ws !== socket || isUnmounted) return;
		if (!navigator.onLine) {
			handleNetworkOffline();
			return;
		}
		closePendingSocket();
		ws = null;
		clearSkipPending();
		clearRotationAction();
		clearPendingSongRequests();
		connectionState = "reconnecting";
		const delay = Math.min(10000, 1000 * 2 ** Math.min(4, reconnectAttempt));
		reconnectAttempt += 1;
		reconnectTimer = window.setTimeout(() => {
			connectRoom(currentRoom);
		}, delay);
	});

	socket.addEventListener("error", () => {
		// close handler manages reconnect
	});
}

function closePendingSocket() {
	const stale = pendingCloseSocket;
	pendingCloseSocket = null;
	if (!stale) return;
	try {
		stale.close(1000, "switch");
	} catch {
		// Ignore
	}
}

function handleRoomSelect(roomId: string) {
	showInterconnect = false;
	closeSplitRoom(roomPanelEl?.contains(document.activeElement));
	if (roomUnreadUids[roomId]?.length) {
		const nextUnread = { ...roomUnreadUids };
		delete nextUnread[roomId];
		roomUnreadUids = nextUnread;
	}
	if (roomId === currentRoom) {
		mobileDrawer = "none";
		return;
	}
	cacheRoomMessages(currentRoom, messages);
	clearPendingSongRequests();
	fallbackSearch = undefined;
	isRoomReady = false;
	currentRoom = roomId;
	persistStoredRoom(roomId);
	syncRoomUrl(roomId);
	if (currentUser) {
		const currentKey = currentUser.userKey;
		onlineMembers = onlineMembers.map((m) =>
			m.userKey === currentKey ? { ...m, roomId } : m,
		);
	}
	messages = roomMessageCache.get(roomId) ?? [];
	hasMoreHistory = false;
	oldestHistoryId = 0;
	clearHistoryLoadTimer();
	isLoadingHistory = false;
	pinnedUids = [];
	pinnedDetails = [];
	roomTopic = "";
	readReceipts = {};
	clearAllTypingTimers();
	sessionUnreadSince = 0;
	serverUnreadCount = 0;
	serverUnreadUserCount = 0;
	lastMarkedServerReadAt = 0;
	lastMarkedServerReadUid = "";
	roomOnlineMembers = [];
	musicState = null;
	musicAudience = { onlineCount: 0, listeningCount: 0 };
	clearSkipPending();
	clearRotationAction();
	reconnectAttempt = 0;
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({ type: "room:switch", roomId }));
	} else {
		if (ws) {
			try {
				ws.close(1000, "switch");
			} catch {
				// Ignore
			}
			ws = null;
		}
		connectRoom(roomId);
	}
	mobileDrawer = "none";
}

function handleMentionUser(name: string, userKey?: string) {
	if (!currentUser) {
		openAuthModal();
		return;
	}
	mentionSeq += 1;
	mentionEvent = { name, ...(userKey ? { userKey } : {}), seq: mentionSeq };
	mobileDrawer = "none";
	closeSplitRoom();
}

function handleAuthenticated(
	auth: { kind: "waline" | "guest"; token: string },
	user?: ChatSessionUser,
) {
	if (auth.kind === "waline") {
		clearGuestAuth();
	} else {
		// 切换或确认为访客登录时清理可能失效的旧 Waline 凭证，防止刷新被拉回旁观态
		clearWalineAuth();
	}
	currentAuth = auth;
	walineToken = auth.kind === "waline" ? auth.token : "";
	lastMarkedServerReadAt = 0;
	lastMarkedServerReadUid = "";
	if (user) {
		currentUser = user;
		persistStoredChatUser(user);
		if (user.authType === "waline") {
			syncChatUserToWalineStorage(user);
		}
	} else {
		const cached = readInitialCachedUser();
		if (cached) {
			currentUser = cached;
			persistStoredChatUser(cached);
			if (cached.authType === "waline") {
				syncChatUserToWalineStorage(cached);
			}
		}
	}
	playlistRefreshSeq += 1;
	sendPacket({
		type: "auth:sync",
		authKind: auth.kind,
		token: auth.token,
	});
}

async function handleLogout() {
	if (pushLoggingOut) return;
	pushLoggingOut = true;
	try {
		await pushOperation;
		await disableChatPush(normalizedChatServer);
		preparedPush = undefined;
	} catch {
		showNotice("关闭此浏览器的推送失败，请重试退出");
		return;
	} finally {
		pushLoggingOut = false;
	}
	if (currentAuth?.kind === "waline") {
		clearWalineAuth();
	} else if (currentAuth?.kind === "guest") {
		clearGuestAuth();
	}
	clearStoredChatUser();
	currentAuth = null;
	walineToken = "";
	currentUser = null;
	lastMarkedServerReadAt = 0;
	lastMarkedServerReadUid = "";
	playlistRefreshSeq += 1;
	sendPacket({ type: "auth:logout" });
	showNotice("已退出当前聊天身份，进入只读旁观模式");
}

function handleOpenUserProfile(seed: ChatUserDetailSeed) {
	if (!seed.userKey && !seed.name) return;
	const isSpectatorSeed =
		seed.userKey?.startsWith("spectator") ||
		seed.userKey?.startsWith("observer") ||
		seed.userKey?.startsWith("spec_") ||
		seed.badge === "旁观" ||
		seed.badge === "历史访客";
	if (isSpectatorSeed && !currentUser?.isAdmin) {
		return;
	}
	let enriched: ChatUserDetailSeed = { ...seed };
	const needsKey =
		!enriched.userKey ||
		enriched.userKey.startsWith("name:") ||
		enriched.userKey === "system:fallback";
	if (needsKey && enriched.name) {
		const onlineMatch = onlineMembers.find((m) => m.name === enriched.name);
		const mentionMatch = mentionMembers.find((m) => m.name === enriched.name);
		const selfMatch =
			currentUser && currentUser.name === enriched.name ? currentUser : null;
		const msgMatch = [...messages]
			.reverse()
			.find((m) => m.kind === "user" && m.name === enriched.name && m.userKey);
		const match = onlineMatch || mentionMatch || selfMatch || msgMatch;
		if (match) {
			enriched = {
				...enriched,
				userKey: match.userKey,
				authType:
					enriched.authType ||
					("authType" in match ? match.authType : undefined) ||
					(match.userKey.startsWith("waline:") ? "waline" : "guest"),
				avatar: enriched.avatar || match.avatar,
				url: enriched.url || match.url,
				badge: enriched.badge || match.badge,
				badgeType: enriched.badgeType || match.badgeType,
				isAdmin: enriched.isAdmin ?? match.isAdmin,
				location:
					enriched.location ||
					("location" in match ? match.location : undefined),
			};
		}
	}
	userDetailSeed = enriched;
	showUserDetailModal = true;
}

function handleOpenPlaylistFromProfile(
	playlistId: string,
	summary?: Partial<PlaylistSummary>,
) {
	if (!currentUser) {
		openAuthModal();
		return;
	}
	showUserDetailModal = false;
	externalPlaylistSeq += 1;
	externalPlaylistRequest = { playlistId, seq: externalPlaylistSeq, summary };
	mobileDrawer = "music";
	closeSplitRoom();
}

function handleUpdateProfile(draft: ChatProfileDraft) {
	if (!currentUser) return;
	const cleanNick = draft.nickname.trim().slice(0, 16) || currentUser.name;
	const cleanBadge = getFixedRoleBadge(currentUser);
	const rawStatus = draft.status.trim().slice(0, 16);
	const cleanStatus = rawStatus === "在线" ? "" : rawStatus;
	const cleanUrl = draft.url.trim().slice(0, 200);
	const cleanBio = (draft.bio ?? "").trim().slice(0, 80);
	const packet: Record<string, unknown> = {
		type: "auth:update_profile",
		nickname: cleanNick,
		badge: cleanBadge,
		status: cleanStatus,
		url: cleanUrl,
		bio: cleanBio,
	};
	if (typeof draft.avatar === "string") {
		packet.avatar = draft.avatar.trim().slice(0, 400);
	}
	if (typeof draft.notifyEmail === "boolean") {
		packet.notifyEmail = draft.notifyEmail;
	}
	const updatedUser: ChatSessionUser = {
		...currentUser,
		name: cleanNick,
		badge: cleanBadge,
		status: cleanStatus,
		url: cleanUrl,
		bio: cleanBio,
		...(typeof draft.avatar === "string" && draft.avatar.trim()
			? { avatar: draft.avatar.trim().slice(0, 400) }
			: {}),
		...(typeof draft.notifyEmail === "boolean"
			? { notifyEmail: draft.notifyEmail }
			: {}),
	};
	currentUser = updatedUser;
	persistStoredChatUser(updatedUser);
	if (currentUser.authType === "waline") {
		syncChatUserToWalineStorage(updatedUser);
		if (walineToken && walineServerUrl) {
			void fetch(`${normalizeServerUrl(walineServerUrl)}/api/user`, {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${walineToken}`,
				},
				body: JSON.stringify({
					display_name: cleanNick,
					url: cleanUrl,
					avatar: updatedUser.avatar || "",
				}),
			}).catch(() => {});
		}
	} else if (currentUser.authType === "guest") {
		persistWalineCommentMeta({
			nickname: cleanNick,
			email: resolveCurrentUserEmail(currentUser),
			url: cleanUrl,
		});
	}
	if (sendPacket(packet)) {
		showNotice("个人资料已更新");
	}
}

async function handleUpdateMemberBadges(
	targetUserKey: string,
	badges: ChatCustomBadge[],
): Promise<boolean> {
	if (!currentUser?.isAdmin) return false;
	const token = readStoredWalineToken();
	const httpOk = await saveMemberBadges(
		normalizedChatServer,
		currentRoom,
		targetUserKey,
		badges,
		token,
	);
	if (httpOk) {
		if (currentUser.userKey === targetUserKey) {
			currentUser = { ...currentUser, customBadges: badges };
			persistStoredChatUser(currentUser);
		}
		roomOnlineMembers = roomOnlineMembers.map((m) =>
			m.userKey === targetUserKey ? { ...m, customBadges: badges } : m,
		);
		roomMentionMembers = roomMentionMembers.map((m) =>
			m.userKey === targetUserKey ? { ...m, customBadges: badges } : m,
		);
		globalMemberDirectory = globalMemberDirectory.map((m) =>
			m.userKey === targetUserKey ? { ...m, customBadges: badges } : m,
		);
		messages = messages.map((m) =>
			m.userKey === targetUserKey ? { ...m, customBadges: badges } : m,
		);
		if (userDetailSeed && userDetailSeed.userKey === targetUserKey) {
			userDetailSeed = { ...userDetailSeed, customBadges: badges };
		}
		showNotice("头衔已更新");
		return true;
	}
	return false;
}

function handleSendMessage(
	content: string,
	attachments: ImageAttachment[],
	mentionEntities: ChatMentionEntity[] = [],
	replyToUid = "",
	threadRootUid = "",
) {
	if (!currentUser) {
		showAuthModal = true;
		return;
	}
	const packet: Record<string, unknown> = {
		type: "chat:send",
		content,
		attachments,
		mentionEntities,
	};
	if (replyToUid) {
		packet.replyToUid = replyToUid;
	}
	if (threadRootUid) {
		packet.threadRootUid = threadRootUid;
	}
	sendPacket(packet);
}

function handleLoadHistory(sinceCreatedAt = 0, jumpTarget = false) {
	if (isLoadingHistory) return;
	const oldestMsg = messages[0];
	const oldestId = oldestMsg?.id || oldestHistoryId || 0;
	const beforeUid = oldestMsg?.msgUid || "";
	const beforeCreatedAt = oldestMsg?.createdAt || 0;
	if (!beforeUid && !oldestId) return;
	isLoadingHistory = true;
	clearHistoryLoadTimer();
	historyLoadTimeoutTimer = window.setTimeout(() => {
		isLoadingHistory = false;
		historyLoadTimeoutTimer = null;
	}, 10000);
	const ok = sendPacket({
		type: "chat:load_history",
		beforeId: oldestId,
		beforeUid: beforeUid || undefined,
		beforeCreatedAt: beforeCreatedAt > 0 ? beforeCreatedAt : undefined,
		sinceCreatedAt: sinceCreatedAt > 0 ? sinceCreatedAt : undefined,
		jumpTarget,
	});
	if (!ok) {
		clearHistoryLoadTimer();
		isLoadingHistory = false;
	}
}

function handleMarkRead(timestamp: number, msgUid?: string) {
	if (!isRoomReady || !Number.isFinite(timestamp) || timestamp <= 0) return;
	// 严格门控：仅在连接正常、前台可见、窗口真正聚焦、未处于离开态、且聊天面板未被抽屉/分屏侧栏遮挡时才允许标记已读
	if (
		connectionState !== "connected" ||
		!isChatPaneActive ||
		!isEffectiveFocused ||
		!isDocumentActivelyVisibleAndFocused()
	) {
		return;
	}
	if (!currentUser) {
		persistUserLastSeen(currentRoom, "guest", timestamp);
		return;
	}
	if (ws?.readyState !== WebSocket.OPEN) return;
	const shouldSend =
		timestamp > lastMarkedServerReadAt ||
		(Boolean(msgUid) &&
			msgUid !== lastMarkedServerReadUid &&
			timestamp >= lastMarkedServerReadAt);
	if (!shouldSend) return;
	// 确保服务端先收到当前连接的聚焦状态，再收到 chat:mark_read
	reportFocusState();
	lastMarkedServerReadAt = Math.max(lastMarkedServerReadAt, timestamp);
	if (msgUid) {
		lastMarkedServerReadUid = msgUid;
	}
	persistUserLastSeen(currentRoom, currentUser.userKey, timestamp);
	ws.send(
		JSON.stringify({
			type: "chat:mark_read",
			timestamp,
			...(msgUid ? { msgUid } : {}),
		}),
	);
}

function handleRecallMessage(msgUid: string) {
	sendPacket({ type: "chat:recall", msgUid });
}

function handleDeleteMessage(msgUid: string) {
	sendPacket({ type: "chat:delete", msgUid });
}

function handleReaction(msgUid: string, key: string) {
	if (!currentUser) {
		openAuthModal();
		return;
	}
	sendPacket({ type: "chat:reaction", msgUid, key });
}

function handleEditMessage(msgUid: string, content: string, mentionEntities: ChatMentionEntity[]) {
	sendPacket({ type: "chat:edit", msgUid, content, mentionEntities });
}

function handlePinMessage(msgUid: string, unpin?: boolean) {
	sendPacket({ type: "chat:pin", msgUid, unpin });
}

function handleVotePoll(pollUid: string, answerId: string) {
	if (!currentUser) {
		openAuthModal();
		return;
	}
	sendPacket({ type: "chat:poll_vote", pollUid, answerId });
}

function handleEndPoll(pollUid: string) {
	if (!currentUser) {
		openAuthModal();
		return;
	}
	sendPacket({ type: "chat:poll_end", pollUid });
}

function handleSetTopic(topic: string) {
	if (!currentUser?.isAdmin) return;
	const clean = topic.trim();
	if (!clean) return;
	sendPacket({ type: "chat:set_topic", topic: clean });
}

function handleCreatePoll(
	question: string,
	answers: string[],
	maxSelections: number,
) {
	if (!currentUser) {
		openAuthModal();
		return;
	}
	sendPacket({
		type: "chat:poll_create",
		question,
		answers,
		maxSelections,
	});
}

function handleTyping(typing: boolean) {
	if (!currentUser || ws?.readyState !== WebSocket.OPEN) return;
	sendPacket({ type: "chat:typing", typing });
}

async function handleSearchOnline(
	keyword: string,
	options?: { signal?: AbortSignal; page?: number; provider?: "qq" | "netease" | "kugou" | "youtube" },
) {
	return searchOnlineMusic(normalizedChatServer, keyword, options);
}

function listenAfterSongRequest(room: string) {
	const current = musicState?.current;
	if (!current || room !== currentRoom || current.requesterKey !== currentUser?.userKey) return;
	pendingSongListen = { room, playUid: current.uid };
	ensureMusicPanelLoaded();
}

function handleEnqueueTrack(track: ChatMusicTrack, anchor?: HTMLElement): Promise<boolean> {
	return sendSongRequest(track, { anchor });
}

function handleRandomEnqueue(playlistId: string): Promise<boolean> {
	if (pendingRandomRequestId) return Promise.resolve(false);
	return sendSongRequest(undefined, { randomPlaylistId: playlistId });
}

async function sendSongRequest(
	track: ChatMusicTrack | undefined,
	{ anchor, fromOffer = false, offerId, choiceId, randomPlaylistId }: {
		anchor?: HTMLElement;
		fromOffer?: boolean;
		offerId?: string;
		choiceId?: string;
		randomPlaylistId?: string;
	},
): Promise<boolean> {
	if (!currentUser) {
		openAuthModal();
		return false;
	}
	const room = currentRoom;
	const requestId = crypto.randomUUID();
	return new Promise<boolean>((resolve) => {
		const reportUnsent = (message: string) => {
			if (room !== currentRoom) return;
			if (fromOffer && songOfferOrigin && track) rotationAction = { entryId: track.id, message };
			else showNotice(message, "error");
		};
		let timer: number | undefined;
		const setWaiting = (waiting: boolean) => {
			window.clearTimeout(timer);
			if (!waiting) timer = window.setTimeout(() => {
				finish(false);
				reportUnsent("点歌未收到回应，请先查看待播队列");
			}, 15_000);
		};
		const finish = (ok: boolean) => {
			window.clearTimeout(timer);
			songRequests.delete(requestId);
			if (pendingRandomRequestId === requestId) pendingRandomRequestId = null;
			resolve(ok);
		};
		songRequests.set(requestId, { room, track, anchor, randomPlaylistId, fromOffer, finish, setWaiting });
		setWaiting(false);
		if (randomPlaylistId) pendingRandomRequestId = requestId;
		const packet = {
			type: "music:enqueue",
			requestId,
			allowAlternatives: true,
			offerId,
			choiceId,
			randomPlaylistId,
			track: track && {
				id: track.id,
				provider: track.provider,
				sourceId: track.sourceId,
				sourcePlatform: track.sourcePlatform,
				playlistId: track.playlistId,
				position: track.position,
				title: track.title,
				artist: track.artist,
				album: track.album,
				cover: track.cover,
				durationSec: track.durationSec ?? 0,
			},
		};
		try {
			if (sendPacket(packet)) return;
		} catch (error) {
			console.warn("Unable to send song request", error);
		}
		finish(false);
		reportUnsent("连接暂时不可用，请重试");
	});
}

let lastPresenceRaw = "";
let lastMemberDirectoryRaw = "";

async function refreshGlobalPresence() {
	if (!normalizedChatServer || isUnmounted) return;
	const reqRoom = currentRoom;
	try {
		const separator = normalizedChatServer.includes("?") ? "&" : "?";
		const response = await fetch(
			`${normalizedChatServer}/api/presence${separator}room=${encodeURIComponent(reqRoom)}&_t=${Date.now()}`,
			{ cache: "no-store" },
		);
		if (!response.ok) return;
		const rawText = await response.text();
		const cacheKey = `${reqRoom}:${rawText}`;
		if (cacheKey === lastPresenceRaw) return;
		const data = JSON.parse(rawText) as {
			members: ChatOnlineMember[];
			observers?: ChatOnlineMember[];
			totalCount: number;
		};
		if (
			!isUnmounted &&
			currentRoom === reqRoom &&
			Array.isArray(data.members)
		) {
			lastPresenceRaw = cacheKey;
			hasGlobalPresence = true;
			const currentKey = currentUser?.userKey;
			onlineMembers = data.members.map((m) => {
				if (currentKey && m.userKey === currentKey) {
					return { ...m, roomId: currentRoom };
				}
				return m;
			});
			if (Array.isArray(data.observers)) {
				observers = uniqueObservers(data.observers);
			}
			totalOnlineCount = data.totalCount;
		}
	} catch {
		// Keep the most recent snapshot until the next refresh.
	}
}

async function refreshMemberDirectory() {
	if (!normalizedChatServer || isUnmounted) return;
	try {
		const separator = normalizedChatServer.includes("?") ? "&" : "?";
		const response = await fetch(
			`${normalizedChatServer}/api/members${separator}_t=${Date.now()}`,
			{ cache: "no-store" },
		);
		if (!response.ok) return;
		const rawText = await response.text();
		if (rawText === lastMemberDirectoryRaw) return;
		const data = JSON.parse(rawText) as {
			members: Array<{
				userKey: string;
				authType: "waline" | "guest";
				name: string;
				avatar: string;
				url: string;
				badge: string;
				badgeType: ChatMentionCandidate["badgeType"];
				isAdmin: boolean;
				bio: string;
				status: string;
				location?: string;
				lastSeenAt: number;
			}>;
		};
		if (isUnmounted || !Array.isArray(data.members)) return;
		lastMemberDirectoryRaw = rawText;
		globalMemberDirectory = data.members.map((member) => ({
			userKey: member.userKey,
			authType: member.authType,
			name: member.name,
			avatar: member.avatar || "",
			url: member.url || "",
			badge: member.badge || "",
			badgeType: member.badgeType,
			isAdmin: Boolean(member.isAdmin),
			online: false,
			status: member.status || "",
			bio: member.bio || "",
			location: member.location || "",
			lastSeenAt: member.lastSeenAt || 0,
		}));
	} catch {
		// 名录拉取失败时保留上一份数据
	}
}

async function refreshSpectatorHistory() {
	if (!normalizedChatServer || isUnmounted || !currentUser?.isAdmin) {
		spectatorHistory = [];
		return;
	}
	try {
		const separator = normalizedChatServer.includes("?") ? "&" : "?";
		const response = await fetch(
			`${normalizedChatServer}/api/spectators/history${separator}limit=30&_t=${Date.now()}`,
			{ cache: "no-store" },
		);
		if (!response.ok) return;
		const data = (await response.json()) as {
			ok: boolean;
			records: ChatSpectatorRecord[];
		};
		if (!isUnmounted && Array.isArray(data.records)) {
			spectatorHistory = data.records;
		}
	} catch {
		// 历史旁观记录拉取失败保留上一份数据
	}
}

onMount(() => {
	isUnmounted = false;
	const mobileLayoutQuery = window.matchMedia("(width < 768px)");
	isMobileLayout = mobileLayoutQuery.matches;
	const handleMobileLayoutChange = () => {
		isMobileLayout = mobileLayoutQuery.matches;
		mobileDrawer = "none";
		stageTouchStart = null;
	};
	mobileLayoutQuery.addEventListener("change", handleMobileLayoutChange);
	// 切入聊天室时立即停止全站侧栏/顶栏音乐播放器，避免与点歌台同时发声
	window.__fireflyMusic?.stop?.();
	baseDocumentTitle = cleanDocumentTitle(document.title);
	currentAuth = resolveInitialAuth();
	walineToken = currentAuth?.kind === "waline" ? currentAuth.token : "";
	if (!currentUser) {
		currentUser = readInitialCachedUser();
	}

	void consumeUrlWalineToken(walineServerUrl).then((res) => {
		if (res?.token) {
			if (
				!isUnmounted &&
				(currentAuth?.kind !== "waline" || currentAuth.token !== res.token)
			) {
				handleAuthenticated({ kind: "waline", token: res.token });
			}
			return;
		}
		if (
			!isUnmounted &&
			currentAuth?.kind === "waline" &&
			!readStoredWalineToken()
		) {
			clearWalineAuth();
			currentAuth = resolveInitialAuth();
			walineToken = currentAuth?.kind === "waline" ? currentAuth.token : "";
			connectRoom(currentRoom);
		}
	});

	hasAppMounted = true;

	refreshPushDisplay();

	const urlParams = new URLSearchParams(window.location.search);
	const paramRoom = urlParams.get("room")?.trim().toLowerCase() || "";
	const storedRoom = readStoredRoom();
	if (paramRoom && rooms.some((r) => r.id === paramRoom)) {
		currentRoom = paramRoom;
	} else if (storedRoom && rooms.some((r) => r.id === storedRoom)) {
		currentRoom = storedRoom;
	}
	persistStoredRoom(currentRoom);
	const paramMsg = urlParams.get("msg")?.trim() || "";
	if (paramMsg) {
		targetMessageUid = paramMsg;
	}

	// 建连前先同步真实的窗口可见/聚焦状态，避免后台打开或恢复标签页时握手误报 focused=1
	isWindowFocused = isDocumentActivelyVisibleAndFocused();

	// 优先建连房间 WebSocket；电脑端右侧点歌台首屏直接可见，紧随建连并行加载（0 延迟）；
	// 手机端点歌台在抽屉中，与表情包/全局名录一同延后到首屏到达后或按需加载
	connectRoom(currentRoom);
	if (!isMobileLayout) {
		ensureMusicPanelLoaded();
	}
	secondaryStartupTimer = window.setTimeout(runSecondaryStartup, 600);

	let presenceTick = 0;
	const presenceTimer = window.setInterval(() => {
		if (!document.hidden) {
			presenceTick += 1;
			sampleRoomClock(ws);
			// WebSocket 已连上时会实时推 presence:update，HTTP 兜底降频到 45s 一次
			if (connectionState !== "connected" || presenceTick % 3 === 0) {
				void refreshGlobalPresence();
			}
		}
	}, 15000);
	let memberTick = 0;
	const memberTimer = window.setInterval(() => {
		if (!document.hidden) {
			memberTick += 1;
			if (connectionState !== "connected" || memberTick % 4 === 0) {
				void refreshMemberDirectory();
				void refreshSpectatorHistory();
			}
		}
	}, 15000);

	// 低频自增歌单刷新序列（仅在页面前台活跃时触发，避免后台休眠时无意义刷新）
	const playlistTimer = window.setInterval(() => {
		if (!document.hidden) {
			playlistRefreshSeq += 1;
		}
	}, 30000);

	const IDLE_AWAY_MS = 60 * 1000;
	let idleAwayTimer: number | null = null;
	let lastActivityResetAt = 0;
	let lastMouseX = -1;
	let lastMouseY = -1;

	const resetIdleTimer = (event?: Event) => {
		// 仅在页面真正前台可见且聚焦时才认可用户活跃，避免鼠标划过失焦/副屏窗口误解除离开态
		if (!isDocumentActivelyVisibleAndFocused()) return;
		if (event instanceof MouseEvent && event.type === "mousemove") {
			if (
				lastMouseX >= 0 &&
				Math.abs(event.clientX - lastMouseX) +
					Math.abs(event.clientY - lastMouseY) <
					4
			) {
				return;
			}
			lastMouseX = event.clientX;
			lastMouseY = event.clientY;
		}

		const now = Date.now();
		if (isIdleAway) {
			isIdleAway = false;
			reportFocusState();
		} else if (now - lastActivityResetAt < 1000) {
			return;
		}
		lastActivityResetAt = now;
		if (idleAwayTimer !== null) window.clearTimeout(idleAwayTimer);
		idleAwayTimer = window.setTimeout(() => {
			isIdleAway = true;
			reportFocusState();
		}, IDLE_AWAY_MS);
	};

	const computeFocusedState = () => isDocumentActivelyVisibleAndFocused();

	const syncFocusState = () => {
		const focused = computeFocusedState();
		isWindowFocused = focused;
		reportFocusState();
		if (focused) {
			resetIdleTimer();
			restoreDocumentTitle();
		}
	};

	const handleWindowFocus = () => {
		restoreDocumentTitle();
		refreshPushDisplay();
		syncFocusState();
	};

	const handleWindowBlur = () => {
		isWindowFocused = false;
		reportFocusState();
	};

	const handlePageHide = () => {
		isWindowFocused = false;
		reportFocusState();
	};

	const handlePageFreeze = () => {
		isWindowFocused = false;
		reportFocusState();
	};

	const handlePageShowOrResume = () => {
		syncFocusState();
	};

	const handleVisibility = () => {
		if (isDocumentHidden()) {
			isWindowFocused = false;
			reportFocusState();
		} else {
			isWindowFocused =
				typeof document.hasFocus === "function" ? document.hasFocus() : true;
			reportFocusState();
			if (isWindowFocused) {
				resetIdleTimer();
			}
			restoreDocumentTitle();
			void refreshGlobalPresence();
			void refreshMemberDirectory();
			void refreshSpectatorHistory();
			if (ws && ws.readyState === WebSocket.OPEN) {
				sampleRoomClock(ws, true);
			} else if (!ws && !isUnmounted) {
				connectRoom(currentRoom);
			}
		}
	};
	syncFocusState();
	const focusSyncTimer = window.setInterval(() => {
		if (isDocumentHidden()) {
			if (isWindowFocused) {
				isWindowFocused = false;
				reportFocusState();
			}
			return;
		}
		if (typeof document.hasFocus === "function") {
			const focused = document.hasFocus();
			if (focused !== isWindowFocused) {
				isWindowFocused = focused;
				reportFocusState();
				if (focused) resetIdleTimer();
			}
		}
	}, 800);
	const handleWalineStorageSync = (e: StorageEvent) => {
		if (isUnmounted) return;
		if (
			e.key !== "WALINE_USER" &&
			e.key !== "TOKEN" &&
			e.key !== "WALINE_ADMIN_TOKEN" &&
			e.key !== GUEST_TOKEN_STORAGE_KEY &&
			e.key !== CHAT_SESSION_USER_KEY
		) {
			return;
		}

		// 跨标签页主动退出登录
		if (
			!e.newValue &&
			(e.key === "WALINE_USER" ||
				e.key === "TOKEN" ||
				e.key === GUEST_TOKEN_STORAGE_KEY ||
				e.key === CHAT_SESSION_USER_KEY)
		) {
			const activeAuth = resolveInitialAuth();
			if (!activeAuth && currentUser) {
				currentAuth = null;
				walineToken = "";
				currentUser = null;
				clearStoredChatUser();
				sendPacket({ type: "auth:logout" });
			}
			return;
		}

		// 跨标签页更新了个人会话与资料
		if (e.key === CHAT_SESSION_USER_KEY && e.newValue) {
			try {
				const parsed = JSON.parse(e.newValue) as ChatSessionUser;
				if (parsed?.userKey) {
					currentUser = parsed;
				}
			} catch {
				// Ignore
			}
			return;
		}

		const nextToken = readStoredWalineToken();
		if (
			nextToken &&
			(currentAuth?.kind !== "waline" || currentAuth.token !== nextToken)
		) {
			showAuthModal = false;
			handleAuthenticated({ kind: "waline", token: nextToken });
		}
	};

	document.addEventListener("visibilitychange", handleVisibility);
	document.addEventListener("freeze", handlePageFreeze);
	document.addEventListener("resume", handlePageShowOrResume);
	window.addEventListener("focus", handleWindowFocus);
	window.addEventListener("blur", handleWindowBlur);
	window.addEventListener("pagehide", handlePageHide);
	window.addEventListener("pageshow", handlePageShowOrResume);
	window.addEventListener("offline", handleNetworkOffline);
	window.addEventListener("online", handleNetworkOnline);
	window.addEventListener("storage", handleWalineStorageSync);
	window.addEventListener("storage", refreshPushDisplay);
	window.addEventListener("mousemove", resetIdleTimer, { passive: true });
	window.addEventListener("pointerdown", resetIdleTimer, { passive: true });
	window.addEventListener("keydown", resetIdleTimer, { passive: true });
	window.addEventListener("wheel", resetIdleTimer, { passive: true });
	window.addEventListener("touchstart", resetIdleTimer, { passive: true });

	const handleDevBgPreviewChange = (e: Event) => {
		if (!import.meta.env.DEV) return;
		const ce = e as CustomEvent<{
			slot?: ChatPanelSlot | "all";
			url?: string;
			cleared?: boolean;
		}>;
		const slot = ce.detail?.slot;
		if (ce.detail?.cleared) {
			if (slot === "all" || !slot) {
				for (const oldUrl of Object.values(devPanelPreviews)) {
					if (oldUrl?.startsWith("blob:")) URL.revokeObjectURL(oldUrl);
				}
				devPanelPreviews = {};
				failedPanelBg = {
					left: false,
					center: false,
					right: false,
					input: false,
				};
			} else {
				const oldUrl = devPanelPreviews[slot];
				if (oldUrl?.startsWith("blob:")) URL.revokeObjectURL(oldUrl);
				const next = { ...devPanelPreviews };
				delete next[slot];
				devPanelPreviews = next;
				failedPanelBg = { ...failedPanelBg, [slot]: false };
			}
			return;
		}
		if (isChatPanelSlot(slot) && ce.detail?.url) {
			const oldUrl = devPanelPreviews[slot];
			if (oldUrl?.startsWith("blob:") && oldUrl !== ce.detail.url) {
				URL.revokeObjectURL(oldUrl);
			}
			devPanelPreviews = { ...devPanelPreviews, [slot]: ce.detail.url };
			failedPanelBg = { ...failedPanelBg, [slot]: false };
		}
	};

	const handleChatAppearanceSync = (e: Event) => {
		const ce = e as CustomEvent<ChatAppearanceSettings | undefined>;
		chatAppearance = ce.detail
			? { ...ce.detail }
			: loadChatAppearanceSettings();
		failedPanelBg = { left: false, center: false, right: false, input: false };
	};

	const handleCatalogChange = (e: Event) => {
		const ce = e as CustomEvent<ChatWallpaperConfig | undefined>;
		if (ce.detail) {
			setRuntimeChatWallpaperCatalog(ce.detail);
		}
		catalogRevision += 1;
		chatAppearance = loadChatAppearanceSettings();
		failedPanelBg = { left: false, center: false, right: false, input: false };
	};

	window.addEventListener("chatAppearanceChange", handleChatAppearanceSync);
	window.addEventListener(
		"chat-wallpapers-catalog-change",
		handleCatalogChange,
	);

	if (import.meta.env.DEV) {
		void loadDevPanelWallpaperPreviews().then((loaded) => {
			if (!isUnmounted && Object.keys(loaded).length > 0) {
				devPanelPreviews = loaded;
				failedPanelBg = {
					left: false,
					center: false,
					right: false,
					input: false,
				};
			}
		});
		window.addEventListener("chat-bg-preview-change", handleDevBgPreviewChange);
	}

	return () => {
		window.removeEventListener(
			"chatAppearanceChange",
			handleChatAppearanceSync,
		);
		window.removeEventListener(
			"chat-wallpapers-catalog-change",
			handleCatalogChange,
		);
		if (import.meta.env.DEV) {
			window.removeEventListener(
				"chat-bg-preview-change",
				handleDevBgPreviewChange,
			);
			for (const oldUrl of Object.values(devPanelPreviews)) {
				if (oldUrl?.startsWith("blob:")) URL.revokeObjectURL(oldUrl);
			}
		}
		isUnmounted = true;
		updatePlaybackDiagnostic(null, null, "", false);
		clearHistoryLoadTimer();
		clearAllTypingTimers();
		if (secondaryStartupTimer !== null) {
			window.clearTimeout(secondaryStartupTimer);
			secondaryStartupTimer = null;
		}
		clearPendingSongRequests();
		window.clearInterval(presenceTimer);
		window.clearInterval(memberTimer);
		window.clearInterval(playlistTimer);
		window.clearInterval(focusSyncTimer);
		if (idleAwayTimer !== null) window.clearTimeout(idleAwayTimer);
		document.removeEventListener("visibilitychange", handleVisibility);
		document.removeEventListener("freeze", handlePageFreeze);
		document.removeEventListener("resume", handlePageShowOrResume);
		window.removeEventListener("focus", handleWindowFocus);
		window.removeEventListener("blur", handleWindowBlur);
		window.removeEventListener("pagehide", handlePageHide);
		window.removeEventListener("pageshow", handlePageShowOrResume);
		window.removeEventListener("offline", handleNetworkOffline);
		window.removeEventListener("online", handleNetworkOnline);
		window.removeEventListener("storage", handleWalineStorageSync);
		window.removeEventListener("storage", refreshPushDisplay);
		window.removeEventListener("mousemove", resetIdleTimer);
		window.removeEventListener("pointerdown", resetIdleTimer);
		window.removeEventListener("keydown", resetIdleTimer);
		window.removeEventListener("wheel", resetIdleTimer);
		window.removeEventListener("touchstart", resetIdleTimer);
		mobileLayoutQuery.removeEventListener("change", handleMobileLayoutChange);
		clearReconnectTimer();
		if (noticeTimer !== null) window.clearTimeout(noticeTimer);
		if (skipPendingTimer !== null) window.clearTimeout(skipPendingTimer);
		clearRotationAction();
		closePendingSocket();
		if (ws) {
			try {
				ws.close(1000, "unmount");
			} catch {
				// Ignore
			}
			ws = null;
		}
	};
});
</script>

<svelte:window onkeydown={handleVersionPopoverKeys} />

<div class="flex flex-col h-full w-full min-h-0">
  <div
    class="chat-mobile-stage flex flex-1 min-h-0 gap-0"
    bind:contentRect={stageContentRect}
    data-chat-split-layout={isSplitLayout ? "" : undefined}
    ontouchstart={handleStageTouchStart}
    ontouchend={handleStageTouchEnd}
  >
    {#if mobileDrawer !== "none"}
      <button
        type="button"
        class="chat-mobile-drawer-backdrop md:hidden"
        aria-label="关闭侧边抽屉"
        onclick={() => (mobileDrawer = "none")}
      ></button>
    {/if}

    <div
      class="chat-panel chat-panel-left {mobileDrawer === 'room' ? 'mobile-drawer-open' : ''}"
      class:chat-split-room-open={isSplitLayout && splitRoomOpen}
      id={roomPanelId}
      bind:this={roomPanelEl}
      inert={(isMobileLayout && mobileDrawer !== "room") || (isSplitLayout && !splitRoomOpen)}
      ondragenter={(e) => handleSidePanelDragEnter("left", e)}
      ondragover={(e) => handleSidePanelDragOver("left", e)}
      ondragleave={(e) => handleSidePanelDragLeave("left", e)}
      ondrop={(e) => void handleSidePanelDrop("left", e)}
    >
      <div class="chat-panel-bg-layer" aria-hidden="true">
        {#if panelBgReady && effectivePanelBgUrls.left}
          <img
            src={effectivePanelBgUrls.left}
            alt=""
            loading="eager"
            fetchpriority="low"
            decoding="async"
            class="chat-panel-bg-img"
            use:trackBgImgAspectRatio={effectivePanelBgUrls.left}
            style:display={failedPanelBg.left ? "none" : undefined}
            onerror={() => { failedPanelBg = { ...failedPanelBg, left: true }; }}
          />
        {/if}
        <div class="chat-panel-bg-scrim"></div>
      </div>
      {#if import.meta.env.DEV && sideDragActive.left}
        <div class="chat-panel-dev-drop-overlay" role="presentation">
          <div class="chat-panel-dev-drop-box">
            <span class="text-xs font-bold text-[var(--skin-accent)]">松开替换为左侧面板壁纸</span>
            <span class="text-[11px] text-[var(--chat-meta-color)]">仅本地开发预览</span>
          </div>
        </div>
      {/if}
      <RoomPanel
        rooms={rooms}
        currentRoom={currentRoom}
        onlineMembers={onlineMembers}
        observers={observers}
        spectatorHistory={spectatorHistory}
        mentionMembers={mentionMembers}
        totalOnlineCount={totalOnlineCount}
        totalChatterCount={totalChatterCount}
        currentUser={currentUser}
        selfMuted={mobilePlaybackStatus.isMuted}
        connectionState={connectionState}
        isWindowFocused={isEffectiveFocused}
        interconnectSites={interconnectSites}
        desktopNotificationEnabled={desktopNotificationEnabled}
        desktopNotificationMode={desktopNotificationMode}
        desktopNotificationPermission={desktopNotificationPermission}
        roomUnreadCounts={roomUnreadCounts}
        roomAvatars={roomAvatars}
        siteAvatar={siteAvatar}
        onRoomSelect={handleRoomSelect}
        onCloseSplitRoom={isSplitLayout && splitRoomOpen
          ? () => closeSplitRoom(true)
          : isMobileLayout
            ? () => { mobileDrawer = "none"; }
            : undefined}
        onOpenUserProfile={handleOpenUserProfile}
        onOpenProfile={() => (showProfileModal = true)}
        onOpenAuth={openAuthModal}
        onToggleDesktopNotification={handleToggleDesktopNotification}
      />
    </div>

    <div
      class="chat-panel-center relative flex flex-col min-w-0 min-h-0 mobile-active"
      inert={isMobileLayout && mobileDrawer !== "none"}
    >
      <div class="chat-panel chat-panel-center-inner flex-1 min-h-0 w-full">
        <div class="chat-panel-bg-layer" aria-hidden="true">
          {#if panelBgReady && effectivePanelBgUrls.center}
            <img
              src={effectivePanelBgUrls.center}
              alt=""
              loading="eager"
              fetchpriority="low"
              decoding="async"
              class="chat-panel-bg-img"
              use:trackBgImgAspectRatio={effectivePanelBgUrls.center}
              style:display={failedPanelBg.center ? "none" : undefined}
              onerror={() => { failedPanelBg = { ...failedPanelBg, center: true }; }}
            />
          {/if}
          <div class="chat-panel-bg-scrim"></div>
        </div>
        <ChatWindow
          roomId={currentRoom}
          roomName={activeMeta.name}
          roomSubtitle={activeMeta.subtitle}
          roomAvatar={roomAvatars[currentRoom] || activeMeta.avatar || (currentRoom !== "interconnect" ? siteAvatar : "")}
          inputBgUrl={panelBgReady ? effectivePanelBgUrls.input : ""}
          failedInputBg={failedPanelBg.input}
          onInputBgError={() => { failedPanelBg = { ...failedPanelBg, input: true }; }}
          onlineCount={totalOnlineCount}
          messages={messages}
          hasMoreHistory={hasMoreHistory}
          isLoadingHistory={isLoadingHistory}
          sessionUnreadSince={sessionUnreadSince}
          serverUnreadCount={serverUnreadCount}
          serverUnreadUserCount={serverUnreadUserCount}
          unreadJumpSeq={unreadJumpSeq}
          roomReady={isRoomReady}
          roomInitSeq={roomInitSeq}
          currentUser={currentUser}
          onlineMembers={onlineMembers}
          roomOnlineMembers={roomOnlineMembers}
          observers={observers}
          mentionMembers={mentionMembers}
          isChatTabActive={isChatPaneActive}
          isWindowFocused={isEffectiveFocused}
          targetMessageUid={targetMessageUid}
          clockOffsetMs={clockOffsetMs}
          musicState={musicState}
          isSkippingTrack={isSkippingTrack}
          onSkipTrack={handleSkipTrack}
          onVoteSkip={handleVoteSkip}
          onPlayQueued={handlePlayQueued}
          onLoadHistory={handleLoadHistory}
          onMarkRead={handleMarkRead}
          onClearTargetMessage={() => {
            targetMessageUid = "";
            if (typeof window !== "undefined") {
              const url = new URL(window.location.href);
              if (url.searchParams.has("msg")) {
                url.searchParams.delete("msg");
                window.history.replaceState({}, "", url.toString());
              }
            }
          }}
          stickerPacks={stickerPacks}
          stickerMap={stickerMap}
          enableImageUpload={enableImageUpload}
          walineServerUrl={walineServerUrl}
          walineToken={walineToken}
          chatServerUrl={normalizedChatServer}
          mentionEvent={mentionEvent}
          showInterconnect={showInterconnect}
          isInterconnectRoom={currentRoom === "interconnect"}
          interconnectSites={interconnectSites}
          totalChatterCount={totalChatterCount}
          pinnedUids={pinnedUids}
          pinnedDetails={pinnedDetails}
          activeThreads={activeThreads}
          roomTopic={roomTopic}
          typingUsers={typingUsers}
          readReceipts={readReceipts}
          onReaction={handleReaction}
          onEditMessage={handleEditMessage}
          onPinMessage={handlePinMessage}
          onVotePoll={handleVotePoll}
          onEndPoll={handleEndPoll}
          onSetTopic={handleSetTopic}
          onOpenPollModal={() => (showPollCreateModal = true)}
          onCreatePoll={handleCreatePoll}
          onTyping={handleTyping}
          onToggleInterconnect={() => {
            showInterconnect = !showInterconnect;
          }}
          onSendMessage={handleSendMessage}
          onRecallMessage={handleRecallMessage}
          onDeleteMessage={handleDeleteMessage}
          onNotify={showNotice}
          onRequireAuth={openAuthModal}
          onMentionUser={handleMentionUser}
          onOpenUserProfile={handleOpenUserProfile}
          otherRoomsUnreadCount={otherRoomsUnreadCount}
          mobilePlaybackStatus={mobilePlaybackStatus}
          onOpenRoomDrawer={() => (mobileDrawer = "room")}
          splitRoomPanelId={roomPanelId}
          splitRoomOpen={isSplitLayout && splitRoomOpen}
          onToggleSplitRoom={toggleSplitRoom}
          onOpenMusicDrawer={() => {
            mobileDrawer = "music";
            ensureMusicPanelLoaded();
          }}
          onOpenLyricsDrawer={() => {
            mobileDrawer = "music";
            if (musicPanelRef) {
              musicPanelRef.openPlayerTab?.();
            } else {
              pendingOpenPlayerTab = true;
              ensureMusicPanelLoaded();
            }
          }}
          onToggleListen={() => musicPanelRef?.toggleListenControl?.()}
        />
      </div>

      <ChatInterconnectPopover
        open={showInterconnect}
        sites={interconnectSites}
        onClose={() => (showInterconnect = false)}
      />
    </div>

    <div
      class="chat-panel chat-panel-right {mobileDrawer === 'music' ? 'mobile-drawer-open' : ''}"
      inert={isMobileLayout && mobileDrawer !== "music"}
      ondragenter={(e) => handleSidePanelDragEnter("right", e)}
      ondragover={(e) => handleSidePanelDragOver("right", e)}
      ondragleave={(e) => handleSidePanelDragLeave("right", e)}
      ondrop={(e) => void handleSidePanelDrop("right", e)}
    >
      <div class="chat-panel-bg-layer" aria-hidden="true">
        {#if panelBgReady && effectivePanelBgUrls.right}
          <img
            src={effectivePanelBgUrls.right}
            alt=""
            loading="eager"
            fetchpriority="low"
            decoding="async"
            class="chat-panel-bg-img"
            use:trackBgImgAspectRatio={effectivePanelBgUrls.right}
            style:display={failedPanelBg.right ? "none" : undefined}
            onerror={() => { failedPanelBg = { ...failedPanelBg, right: true }; }}
          />
        {/if}
        <div class="chat-panel-bg-scrim"></div>
      </div>
      {#if import.meta.env.DEV && sideDragActive.right}
        <div class="chat-panel-dev-drop-overlay" role="presentation">
          <div class="chat-panel-dev-drop-box">
            <span class="text-xs font-bold text-[var(--skin-accent)]">松开替换为右侧面板壁纸</span>
            <span class="text-[11px] text-[var(--chat-meta-color)]">仅本地开发预览</span>
          </div>
        </div>
      {/if}
      <audio bind:this={chatAudio} preload="metadata" playsinline></audio>
      {#if MusicPanelComp}
      {#key currentRoom}
      <MusicPanelComp
        bind:this={musicPanelRef}
        audioEl={chatAudio}
        serverNow={serverNow}
        roomId={currentRoom}
        chatServerUrl={normalizedChatServer}
        playlistOutApiUrl={playlistOutApiUrl}
        playlistAuth={currentAuth ?? undefined}
        walineToken={walineToken}
        playlistRefreshSeq={playlistRefreshSeq}
        externalPlaylistRequest={externalPlaylistRequest}
        {fallbackSearch}
        fallbackTracks={musicTracks}
        musicState={musicState}
        currentUser={currentUser}
        onlineMemberCount={musicAudience.onlineCount || roomOnlineMembers.length}
        listeningMemberCount={musicAudience.skipAudienceCount ?? musicAudience.listeningCount}
        onlineMembers={roomOnlineMembers}
        mentionMembers={mentionMembers}
        clockOffsetMs={clockOffsetMs}
        initialVolume={memoryVolume}
        initialListening={isListeningIntent}
        onSearchOnline={handleSearchOnline}
        onEnqueueTrack={handleEnqueueTrack}
        onRandomEnqueue={handleRandomEnqueue}
        isRandomizing={pendingRandomRequestId !== null}
        onNotify={showNotice}
        onOpenUserProfile={handleOpenUserProfile}
        onClose={isMobileLayout ? () => { mobileDrawer = "none"; } : undefined}
        onPlaybackStatusChange={(status) => {
          mobilePlaybackStatus = status;
          const listening = Boolean(status.listenIntent && !status.isMuted && status.audioStatus !== "blocked");
          const listenKey = currentRoom + ":" + listening;
          if (ws?.readyState === WebSocket.OPEN && listenKey !== lastListenPacket) {
            ws.send(JSON.stringify({ type: "music:listen", listening }));
            lastListenPacket = listenKey;
          }
          if (!hasAppMounted) return;
          if (typeof status.listenIntent === "boolean") {
            isListeningIntent = status.listenIntent;
          }
          if (typeof status.volume === "number") {
            memoryVolume = status.volume;
          }
        }}
        onAudioDiagnosticChange={(diagnostic) => { localAudioDiagnostic = diagnostic; }}
        onRemoveQueue={(uid) => {
          if (!currentUser) {
            openAuthModal();
            return;
          }
          sendPacket({ type: "music:remove", uid });
          showNotice("已从待播队列中移除", "success");
        }}
        onRemoveRotationTrack={(track) => {
          if (!currentUser) {
            openAuthModal();
            return;
          }
          sendPacket({
            type: "music:remove_rotation",
            entryId: track.entryId,
            trackId: track.id,
          });
          showNotice(`已跳过这轮播放《${track.title}》`, "success");
        }}
        onShuffleRotation={() => {
          if (!currentUser) {
            openAuthModal();
            return;
          }
          if (sendPacket({ type: "music:shuffle_rotation" })) {
            showNotice("已重新洗牌轮播队列", "success");
          }
        }}
        onPlayQueued={handlePlayQueued}
        onPlayRotationTrack={handlePlayRotationTrack}
        onOpenRotationOffer={openRotationOffer}
        {rotationAction}
        isSkippingTrack={isSkippingTrack}
        onSkipTrack={handleSkipTrack}
        onVoteSkip={handleVoteSkip}
        onReportDuration={(playUid, durationSec) =>
          sendPacket({ type: "music:report_duration", playUid, durationSec })
        }
        onTrackEnded={(playUid) => sendPacket({ type: "music:ended", playUid })}
        onReportError={(playUid, sourceRevision) =>
          sendPacket({ type: "music:report_error", playUid, sourceRevision })
        }
        onRequestAuth={openAuthModal}
      />
      {/key}
      {:else}
        <div class="relative z-10 flex flex-1 flex-col items-center justify-center gap-2.5 p-6 text-xs text-[var(--chat-meta-color)]">
          <svg class="w-5 h-5 animate-spin text-(--primary)" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
            <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
          </svg>
          <span>正在载入点歌台...</span>
        </div>
      {/if}
    </div>
  </div>

  {#if (showProfileModal && !ChatProfileModalComp) || (showUserDetailModal && !ChatUserDetailModalComp) || (showAuthModal && !ChatAuthModalComp) || (showPollCreateModal && !ChatPollCreateModalComp)}
    <ChatModal
      open={true}
      title={showAuthModal ? "登录" : showPollCreateModal ? "发起投票" : showProfileModal ? "编辑资料" : "用户资料"}
      topPriority={showAuthModal}
      onClose={() => {
        showAuthModal = false;
        showPollCreateModal = false;
        showProfileModal = false;
        showUserDetailModal = false;
      }}
    >
      <div class="flex items-center justify-center gap-2 py-10 text-sm text-[var(--chat-meta-color)]" role="status">
        <svg class="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" opacity="0.25"/><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <span>正在加载...</span>
      </div>
    </ChatModal>
  {/if}

  {#snippet versionCover(url: string | undefined)}
    <span class="chat-version-cover" aria-hidden="true">
      <svg class="size-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 17.5V6l11-2v11.5" />
        <ellipse cx="6.5" cy="17.5" rx="2.5" ry="2" />
        <ellipse cx="17.5" cy="15.5" rx="2.5" ry="2" />
      </svg>
      {#if url}
        {#key url}
          <img src={url} alt="" decoding="async" onerror={(event) => { event.currentTarget.hidden = true; }} />
        {/key}
      {/if}
    </span>
  {/snippet}

  {#if rotationOfferOpen && rotationOrigin}
    <div
      bind:this={versionPopover}
      use:placeVersionPopover={versionAnchor}
      use:positionChatFloating={{
        reference: versionAnchor,
        placement: "top-end",
        gap: 8,
        fitViewport: true,
        onReferenceHidden: () => { versionAnchor = undefined; },
      }}
      data-chat-floating={versionAnchor?.isConnected ? "" : undefined}
      role="region"
      aria-label="可播版本"
      class="chat-version-popover"
      class:chat-version-popover--unanchored={!versionAnchor?.isConnected}
      aria-busy={rotationAction?.pending ?? false}
    >
      <div class="chat-version-row chat-version-original">
        {@render versionCover("cover" in rotationOrigin && typeof rotationOrigin.cover === "string"
          ? rotationOrigin.cover
          : rotationOrigin.pic)}
        <div class="min-w-0">
          <p class="chat-version-identity" title={rotationOrigin.title + " · " + rotationOrigin.artist}>
            <strong>{rotationOrigin.title}</strong>
            <span>{rotationOrigin.artist}</span>
          </p>
          <p class="chat-version-detail">
            <span>原选曲目</span>
            {#if rotationOrigin.durationSec}
              <span class="chat-version-duration">{formatClockSeconds(rotationOrigin.durationSec)}</span>
            {/if}
          </p>
        </div>
        <button type="button" class="chat-queue-icon-btn shrink-0" aria-label="关闭版本选择" disabled={rotationAction?.pending} onclick={closeRotationOffer}>
          <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      {#if rotationAction?.offer}
        <div class="divide-y divide-[var(--chat-divider-color)] border-t border-[var(--chat-divider-color)]">
          {#each rotationAction.offer.choices as { track, relation } (track.id)}
            {@const difference = describeVersionDifference(rotationOrigin, track, relation)}
            {@const duration = describeVersionDuration(rotationOrigin.durationSec, track.durationSec)}
            <div class="chat-version-row">
              {@render versionCover(track.cover)}
              <div class="min-w-0">
                <p class="chat-version-identity" title={track.title + " · " + track.artist}>
                  <strong>{track.title}</strong>
                  <span>{track.artist}</span>
                </p>
                <p class="chat-version-detail">
                  <span title={difference}>{difference}</span>
                  {#if track.provider}
                    <span>{formatPlatformLabel(track.provider)}</span>
                  {/if}
                  {#if duration}
                    <span class="chat-version-duration">{duration}</span>
                  {/if}
                </p>
              </div>
              <button
                type="button"
                data-version-choice
                class="btn-regular chat-version-play text-xs font-semibold text-[var(--chat-accent-text)] disabled:opacity-45"
                aria-label={(songOfferOrigin ? "点播 " : "切播 ") + track.title + " · " + track.artist}
                disabled={rotationAction.pending}
                onclick={() => submitVersionOffer(track.id)}
              >{songOfferOrigin ? "点播" : "切播"}</button>
            </div>
          {/each}
        </div>
      {/if}
      {#if rotationAction?.pending || rotationAction?.message}
        <p class="m-0 px-3 py-2 text-xs text-[var(--chat-meta-color)]" role="status">
          {rotationAction.pending ? "正在处理…" : rotationAction.message}
        </p>
      {/if}
      {#if !rotationAction?.offer && !rotationAction?.pending}
        <div class="px-3 pb-2.5">
          {#if rotationAction?.code === "NO_SOURCE"}
            <button type="button" class="btn-regular rounded-lg px-2.5 py-2 text-xs font-semibold text-[var(--chat-accent-text)]" onclick={searchForAnotherVersion}>搜索其他版本</button>
          {:else}
            <button type="button" class="btn-regular rounded-lg px-2.5 py-2 text-xs font-semibold text-[var(--chat-accent-text)]" onclick={() => submitVersionOffer()}>重新查找</button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if ChatProfileModalComp}
    <ChatProfileModalComp
      open={showProfileModal}
      currentUser={currentUser}
      walineServerUrl={walineServerUrl}
      desktopNotificationMode={desktopNotificationMode}
      desktopNotificationPermission={desktopNotificationPermission}
      onChangeDesktopNotificationMode={setDesktopNotificationMode}
      notificationSaving={pushSaving}
      notificationTesting={pushTesting}
      notificationTestSeconds={pushTestSeconds}
      notificationNeedsMigration={pushNeedsMigration}
      onTestNotification={sendTestPush}
      onSave={handleUpdateProfile}
      onClose={() => (showProfileModal = false)}
      onLogout={handleLogout}
    />
  {/if}

  <!-- 用户详细资料卡弹窗 -->
  {#if ChatUserDetailModalComp}
    <ChatUserDetailModalComp
      open={showUserDetailModal}
      seed={userDetailSeed}
      roomId={currentRoom}
      chatServerUrl={normalizedChatServer}
      currentUser={currentUser}
      onlineMembers={onlineMembers}
      messages={messages}
      musicHistoryLogs={musicState?.historyLogs ?? []}
      interconnectSites={interconnectSites}
      walineToken={walineToken}
      onToast={showNotice}
      onClose={() => (showUserDetailModal = false)}
      onMention={handleMentionUser}
      onEditSelf={() => {
        showUserDetailModal = false;
        showProfileModal = true;
      }}
      onEnqueueTrack={handleEnqueueTrack}
      onOpenPlaylist={handleOpenPlaylistFromProfile}
      onUpdateMemberBadges={handleUpdateMemberBadges}
      onJumpToMessage={(msgUid) => {
        showUserDetailModal = false;
        targetMessageUid = msgUid;
        mobileDrawer = "none";
        closeSplitRoom();
      }}
    />
  {/if}

  <!-- 身份准入二选一弹窗（最高层级，唤起时自动收起其他底层弹窗） -->
  {#if ChatAuthModalComp}
    <ChatAuthModalComp
      open={showAuthModal}
      roomId={currentRoom}
      chatServerUrl={normalizedChatServer}
      walineServerUrl={walineServerUrl}
      onAuthenticated={handleAuthenticated}
      onClose={() => (showAuthModal = false)}
    />
  {/if}

  <!-- 发起投票弹窗（顶级外层，免受 .chat-mobile-stage 高斯模糊影响） -->
  {#if ChatPollCreateModalComp}
    <ChatPollCreateModalComp
      open={showPollCreateModal}
      onClose={() => (showPollCreateModal = false)}
      onSubmit={handleCreatePoll}
    />
  {/if}

  <!-- 全局底部悬浮提示气泡（挂载至 body 顶层，避免被弹窗/抽屉/壁纸遮挡） -->
  <div
    use:placeGlobalToast
    class="fixed bottom-8 left-1/2 -translate-x-1/2 z-[2147483647] px-4 py-2.5 rounded-xl text-white text-xs sm:text-sm font-medium shadow-2xl backdrop-blur-md transition-all duration-300 max-w-[90vw] text-center border pointer-events-none select-none inline-flex items-center gap-2 {noticeTone === 'error' ? 'bg-red-600/95 dark:bg-red-600/90 border-red-400/50 shadow-red-950/35' : noticeTone === 'success' ? 'bg-emerald-600/95 dark:bg-emerald-600/90 border-emerald-400/50 shadow-emerald-950/35' : 'bg-black/85 dark:bg-neutral-800/90 border-white/10'} {noticeVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-95'}"
    role="status"
    aria-live="polite"
    aria-hidden={!noticeVisible}
  >
    {#if noticeTone === "error"}
      <svg class="w-4 h-4 shrink-0 text-red-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    {:else if noticeTone === "success"}
      <svg class="w-4 h-4 shrink-0 text-emerald-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    {/if}
    <span>{noticeText}</span>
  </div>
</div>
