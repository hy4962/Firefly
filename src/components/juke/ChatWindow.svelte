<script lang="ts">
import ChatModal from "./ChatModal.svelte";
import ChatShareModal from "./ChatShareModal.svelte";
import { flushSync, onMount, tick } from "svelte";
import type { InterconnectSite } from "@/types/chatConfig";
import ChatAvatar, {
	canCorsDownscaleAvatar,
	downscaleImgElementInPlace,
	getDownscaledAvatarUrl,
} from "./ChatAvatar.svelte";
import ChatMarkdownContent from "./ChatMarkdownContent.svelte";
import ChatMessage from "./ChatMessage.svelte";
import ChatStickerPicker from "./ChatStickerPicker.svelte";
import ChatTooltip from "./ChatTooltip.svelte";
import { QUICK_REACTION_PRESETS } from "./chatReactions";
import {
	ensureLottieLibrary,
	preloadLottieData,
} from "./LottieSticker.svelte";
import {
	isMusicNoticeMessage,
	parseMusicNoticeContent,
	type ParsedMusicNotice,
	saveDevPanelWallpaperPreview,
	trackBgImgAspectRatio,
} from "./chatAppearance";
import {
	getLocalSiteName,
	isExternalMatrixIdentity,
	isMentionedForUser,
	normalizeDotSpacing,
	resolveExternalOrigin,
	sanitizeChatUrl,
	uploadChatImage,
	uploadChatMedia,
} from "./chatClient";
import { positionChatFloating } from "./chatFloating";
import {
	type ChatImageQuality,
	formatChatFileSize,
	loadChatImageQuality,
	prepareChatImageForSend,
	saveChatImageQuality,
} from "./chatImageCompress";
import {
	type ChatDraft,
	deleteChatMentionBeforeCaret,
	getChatMentionQuery,
	insertChatMention,
	readChatComposer,
	trimChatDraft,
	writeChatComposer,
} from "./chatMentions";
import {
	chatImageLayout,
	type ChatImageDimensions,
	type ChatImageResizeDetail,
	getChatImageDimensions,
} from "./chatImageLayout";
import { setChatLightboxSourceProvider } from "./chatLightbox";
import { getChatMarkdownLayout, getChatMessageAttachments } from "./chatMarkdown";
import { closeChatActionSheet, fadeChatSheetBackdrop } from "./chatSheetMotion";
import type {
	ChatActiveThreadItem,
	ChatMentionCandidate,
	ChatMentionEntity,
	ChatMessageRecord,
	ChatOnlineMember,
	ChatReadReceipt,
	ChatSessionUser,
	ChatThreadSummary,
	ChatUserDetailSeed,
	ImageAttachment,
	RoomMusicState,
} from "./chatTypes";
import MiniPlayerBar from "./MiniPlayerBar.svelte";
import {
	formatChatReplyPreview,
	getChatAttachmentKind,
	getChatReplyAttachmentKind,
	LOTTIE_SPRITE_URL,
	type StickerItem,
	type StickerPack,
} from "./stickerLoader";

interface Props {
	roomId: string;
	roomName: string;
	roomSubtitle: string;
	roomAvatar?: string;
	inputBgUrl?: string;
	failedInputBg?: boolean;
	onInputBgError?: () => void;
	onlineCount: number;
	messages: ChatMessageRecord[];
	hasMoreHistory?: boolean;
	isLoadingHistory?: boolean;
	sessionUnreadSince?: number;
	serverUnreadCount?: number;
	serverUnreadUserCount?: number;
	unreadJumpSeq?: number;
	roomReady?: boolean;
	roomInitSeq?: number;
	currentUser: ChatSessionUser | null;
	onlineMembers?: ChatOnlineMember[];
	roomOnlineMembers?: ChatOnlineMember[];
	observers?: ChatOnlineMember[];
	mentionMembers?: ChatMentionCandidate[];
	isChatTabActive?: boolean;
	isWindowFocused?: boolean;
	targetMessageUid?: string;
	clockOffsetMs?: number;
	musicState?: RoomMusicState | null;
	isSkippingTrack?: boolean;
	onSkipTrack?: () => void;
	onVoteSkip?: () => void;
	onPlayQueued?: (uid: string) => void;
	onClearTargetMessage?: () => void;
	onLoadHistory?: (sinceCreatedAt?: number, jumpTarget?: boolean) => void;
	onMarkRead?: (timestamp: number, msgUid?: string) => void;
	stickerPacks: StickerPack[];
	stickerMap: Map<string, StickerItem>;
	enableImageUpload: boolean;
	walineServerUrl: string;
	walineToken?: string;
	chatServerUrl?: string;
	mentionEvent?: { name: string; userKey?: string; seq: number };
	showInterconnect?: boolean;
	isInterconnectRoom?: boolean;
	interconnectSites?: InterconnectSite[];
	totalChatterCount?: number;
	pinnedUids?: string[];
	pinnedDetails?: ChatMessageRecord[];
	activeThreads?: ChatActiveThreadItem[];
	roomTopic?: string;
	typingUsers?: string[];
	readReceipts?: Record<string, ChatReadReceipt[]>;
	onReaction?: (msgUid: string, key: string) => void;
	onEditMessage?: (msgUid: string, content: string, entities: ChatMentionEntity[]) => void;
	onPinMessage?: (msgUid: string, unpin?: boolean) => void;
	onVotePoll?: (pollUid: string, answerId: string) => void;
	onEndPoll?: (pollUid: string) => void;
	onSetTopic?: (topic: string) => void;
	onOpenPollModal?: () => void;
	onCreatePoll?: (
		question: string,
		answers: string[],
		maxSelections: number,
	) => void;
	onTyping?: (typing: boolean) => void;
	onToggleInterconnect?: () => void;
	onSendMessage: (
		content: string,
		attachments: ImageAttachment[],
		mentionEntities: ChatMentionEntity[],
		replyToUid?: string,
		threadRootUid?: string,
	) => void;
	onRecallMessage?: (msgUid: string) => void;
	onDeleteMessage: (msgUid: string) => void;
	onNotify?: (msg: string, tone?: "default" | "error" | "success") => void;
	onRequireAuth: () => void;
	onOpenUserProfile?: (seed: ChatUserDetailSeed) => void;
	onMentionUser: (name: string, userKey?: string) => void;
	otherRoomsUnreadCount?: number;
	mobilePlaybackStatus?: {
		isListening: boolean;
		audioStatus?: import("./roomAudioPlayer").AudioStatus;
		isMuted: boolean;
		elapsedSec: number;
		durationSec: number;
		canDirectSkip: boolean;
		isSoloCoolingDown: boolean;
		soloCooldownRemainSec: number;
		hasVotedSkip: boolean;
		volume?: number;
		currentLyric?: string;
	};
	onOpenRoomDrawer?: () => void;
	splitRoomPanelId: string;
	splitRoomOpen: boolean;
	onToggleSplitRoom: (
		event: MouseEvent & { currentTarget: HTMLButtonElement },
	) => void;
	onOpenMusicDrawer?: () => void;
	onOpenLyricsDrawer?: () => void;
	onToggleListen?: () => void;
}

const {
	roomId = "chat",
	roomName = "闲聊",
	roomSubtitle = "随便聊聊日常与折腾",
	roomAvatar = "",
	inputBgUrl = "",
	failedInputBg = false,
	onInputBgError,
	onlineCount = 0,
	messages = [],
	hasMoreHistory = false,
	isLoadingHistory = false,
	sessionUnreadSince = 0,
	serverUnreadCount = 0,
	serverUnreadUserCount = 0,
	unreadJumpSeq = 0,
	roomReady = true,
	roomInitSeq = 0,
	currentUser = null,
	onlineMembers = [],
	roomOnlineMembers = [],
	observers = [],
	mentionMembers = [],
	isChatTabActive = true,
	isWindowFocused = false,
	targetMessageUid = "",
	clockOffsetMs = 0,
	musicState = null,
	isSkippingTrack = false,
	onSkipTrack,
	onVoteSkip,
	onPlayQueued,
	onClearTargetMessage,
	onLoadHistory,
	onMarkRead,
	stickerPacks = [],
	stickerMap,
	enableImageUpload = true,
	walineServerUrl = "",
	walineToken = "",
	chatServerUrl = "",
	mentionEvent,
	showInterconnect = false,
	isInterconnectRoom = false,
	interconnectSites = [],
	totalChatterCount = 0,
	pinnedUids = [],
	pinnedDetails = [],
	activeThreads = [],
	roomTopic = "",
	typingUsers = [],
	readReceipts = {},
	onReaction,
	onEditMessage,
	onPinMessage,
	onVotePoll,
	onEndPoll,
	onSetTopic,
	onOpenPollModal,
	onCreatePoll,
	onTyping,
	onToggleInterconnect,
	onSendMessage,
	onRecallMessage,
	onDeleteMessage,
	onNotify,
	onRequireAuth,
	onOpenUserProfile,
	onMentionUser,
	otherRoomsUnreadCount = 0,
	mobilePlaybackStatus,
	onOpenRoomDrawer,
	splitRoomPanelId,
	splitRoomOpen,
	onToggleSplitRoom,
	onOpenMusicDrawer,
	onOpenLyricsDrawer,
	onToggleListen,
}: Props = $props();

let inputText = $state("");
let inputMentionEntities = $state<ChatMentionEntity[]>([]);
let pendingImages = $state<ImageAttachment[]>([]);
let replyingTo = $state<ChatMessageRecord | null>(null);
let editingMessage = $state<ChatMessageRecord | null>(null);
let activePinIndex = $state(0);
let typingTimer: ReturnType<typeof setTimeout> | null = null;
let isUploadingImage = $state(false);
let isUploadingMedia = $state(false);
// 发送「原图」时，压缩版其实已经传好，这里只在发送这一刻补传原图
let isSendingAttachments = $state(false);
let isPreviewingMarkdown = $state(false);
let showShareModal = $state(false);

const effectiveSubtitle = $derived(roomTopic ? roomTopic : roomSubtitle);
const localSiteName = $derived(
	getLocalSiteName(interconnectSites) || "冷汐的杂货铺",
);
let failedRoomAvatars = $state<Record<string, boolean>>({});
const effectiveRoomAvatar = $derived((roomAvatar || "").trim());
const hasRoomAvatar = $derived(
	Boolean(effectiveRoomAvatar) && !failedRoomAvatars[effectiveRoomAvatar],
);
const pinnedMessages = $derived.by(() => {
	if (!pinnedUids || pinnedUids.length === 0) return [];
	return pinnedUids
		.map(
			(uid) =>
				messages.find((m) => m.msgUid === uid) ??
				pinnedDetails.find((m) => m.msgUid === uid),
		)
		.filter((m): m is ChatMessageRecord => Boolean(m));
});
const currentPinnedMsg = $derived.by(() => {
	if (pinnedMessages.length === 0) return null;
	const safeIndex = activePinIndex % pinnedMessages.length;
	return pinnedMessages[safeIndex] ?? pinnedMessages[0];
});
let uploadError = $state("");
let uploadNote = $state("");
let imageQuality = $state<ChatImageQuality>("compressed");
const hasPendingImage = $derived(pendingImages.some((att) => att.type === "image"));
// 已上传图片的原始文件，切换画质时用于重新上传（key 为当前附件地址）
let pendingImageSources = new Map<
	string,
	{ file: File; prefer: "waline" | "chat" }
>();
let isDraggingFiles = $state(false);
let dragCounter = 0;
let inputDragActive = $state(false);
let inputDragCounter = 0;

function handleInputBgDragEnter(e: DragEvent) {
	if (!import.meta.env.DEV) return;
	if (!e.dataTransfer?.types?.includes("Files")) return;
	e.preventDefault();
	e.stopPropagation();
	inputDragCounter += 1;
	inputDragActive = true;
	isDraggingFiles = false;
	dragCounter = 0;
}

function handleInputBgDragOver(e: DragEvent) {
	if (!import.meta.env.DEV) return;
	if (!e.dataTransfer?.types?.includes("Files")) return;
	e.preventDefault();
	e.stopPropagation();
	if (e.dataTransfer) {
		e.dataTransfer.dropEffect = "copy";
	}
	inputDragActive = true;
	isDraggingFiles = false;
}

function handleInputBgDragLeave(e: DragEvent) {
	if (!import.meta.env.DEV) return;
	e.preventDefault();
	e.stopPropagation();
	inputDragCounter = Math.max(0, inputDragCounter - 1);
	if (inputDragCounter === 0) {
		inputDragActive = false;
	}
}

async function handleInputBgDrop(e: DragEvent) {
	if (!import.meta.env.DEV) return;
	e.preventDefault();
	e.stopPropagation();
	inputDragCounter = 0;
	inputDragActive = false;
	isDraggingFiles = false;
	dragCounter = 0;
	const files = Array.from(e.dataTransfer?.files || []);
	const imageFile = files.find((f) => f.type.startsWith("image/"));
	if (!imageFile) {
		onNotify?.("请拖入图片文件以预览输入框壁纸");
		return;
	}
	await saveDevPanelWallpaperPreview("input", imageFile);
	onNotify?.(`已更新输入框壁纸预览：${imageFile.name}`);
}

function handleDragEnter(e: DragEvent) {
	e.preventDefault();
	e.stopPropagation();
	if (e.dataTransfer?.types?.includes("Files")) {
		dragCounter++;
		isDraggingFiles = true;
	}
}

function handleDragOver(e: DragEvent) {
	e.preventDefault();
	e.stopPropagation();
	if (e.dataTransfer) {
		e.dataTransfer.dropEffect = "copy";
	}
}

function handleDragLeave(e: DragEvent) {
	e.preventDefault();
	e.stopPropagation();
	dragCounter--;
	if (dragCounter <= 0) {
		dragCounter = 0;
		isDraggingFiles = false;
	}
}

function handleDrop(e: DragEvent) {
	e.preventDefault();
	e.stopPropagation();
	isDraggingFiles = false;
	dragCounter = 0;

	if (!currentUser) {
		onRequireAuth();
		return;
	}

	const files = e.dataTransfer?.files;
	if (!files || files.length === 0) return;

	const fileList = Array.from(files);
	const imageFiles = fileList.filter((f) => f.type.startsWith("image/"));
	const otherFiles = fileList.filter((f) => !f.type.startsWith("image/"));

	if (imageFiles.length > 0) {
		void processImageFiles(imageFiles);
	}
	if (otherFiles.length > 0) {
		void processMediaFiles(otherFiles);
	}
}
let activePopover = $state<"none" | "emoji">("none");
let composerPickerMounted = $state(false);

function onSelectEmojiOrSticker(code: string, url?: string, lottieName?: string) {
	insertAtCursor(code);
	activePopover = "none";
	// 选定表情即时预载：用户打字或按发送键前，贴纸原图/动图已被静默载入本地缓存，发送后秒显无需等待
	if (url && typeof window !== "undefined") {
		const preloadImg = new Image();
		preloadImg.src = url;
	}
	if (lottieName) {
		void preloadLottieData(lottieName, chatServerUrl).catch(() => {});
	}
}

let mentionMenuOpen = $state(false);
let mentionQuery = $state("");
let mentionActiveIndex = $state(-1);

let showMentionHistory = $state(false);
let showThreadListMenu = $state(false);
/**
 * 点歌记录顶栏功能开关：
 * 设为 false 时，不加载组件、不渲染 DOM、不执行排序与未读数计算，完全节省空间与内存。
 * 以后想重新启用时，只需将此值改为 true 即可一键恢复。
 */
const ENABLE_HEADER_MUSIC_NOTICES = false;
let showMusicNoticeMenu = $state(false);
let lastSeenMusicNoticeTs = $state<number>(0);
let musicNoticeWrapEl: HTMLDivElement | null = $state(null);
let showMobileMoreMenu = $state(false);
let mobileMoreMenuWrapEl: HTMLDivElement | null = $state(null);
let mobileMoreTrigger: HTMLButtonElement | null = $state(null);
let chatHeaderWidth = $state(0);
let chatHeaderStackHeight = $state(54);
let mobileHeaderEndWidth = $state(0);
let mobileRoomContentWidth = $state(0);
let threadListWrapEl: HTMLDivElement | null = $state(null);
let sourceModalMessage = $state<ChatMessageRecord | null>(null);
let activeThreadRootUid = $state("");
let activeThreadInitialRoot = $state<ChatMessageRecord | null>(null);
let ChatThreadModalComp = $state<
	typeof import("./ChatThreadModal.svelte").default | null
>(null);
let ChatMessageSourceModalComp = $state<
	typeof import("./ChatMessageSourceModal.svelte").default | null
>(null);

$effect(() => {
	if (activeThreadRootUid && !ChatThreadModalComp) {
		void import("./ChatThreadModal.svelte")
			.then((mod) => {
				ChatThreadModalComp = mod.default;
			})
			.catch((err) => {
				console.error("[chat] Failed to load ChatThreadModal:", err);
				activeThreadRootUid = "";
				activeThreadInitialRoot = null;
				onNotify?.("话题串弹窗加载失败，请检查网络后重试", "error");
			});
	}
});

$effect(() => {
	if (sourceModalMessage && !ChatMessageSourceModalComp) {
		void import("./ChatMessageSourceModal.svelte")
			.then((mod) => {
				ChatMessageSourceModalComp = mod.default;
			})
			.catch((err) => {
				console.error("[chat] Failed to load ChatMessageSourceModal:", err);
				sourceModalMessage = null;
				onNotify?.("消息源弹窗加载失败，请检查网络后重试", "error");
			});
	}
});
let mobileActionTarget = $state<{
	message: ChatMessageRecord;
	isSelf: boolean;
	senderDisplayName: string;
	canRecall: boolean;
	canEdit: boolean;
	canDelete: boolean;
	isPinned: boolean;
} | null>(null);
let mobileActionDialog = $state<HTMLDialogElement | null>(null);
let pressedActionBackdrop: HTMLButtonElement | null = null;
let unreadMentionUids = $state<string[]>([]);
let alertBannerUid = $state<string | null>(null);
let highlightedMsgUid = $state("");
let editingTopic = $state(false);
let topicDraft = $state("");

function openMobileActionDialog(dialog: HTMLDialogElement) {
	dialog.showModal();
	return {
		destroy() {
			if (dialog.open) dialog.close();
		},
	};
}

let mobileShowMoreReactions = $state(false);

function closeMobileActions() {
	mobileActionTarget = null;
	pressedActionBackdrop = null;
	mobileShowMoreReactions = false;
}

function releaseMobileActions() {
	// 已选的动作可能立即打开另一面板，或将焦点交给软键盘。
	if (mobileActionDialog?.open) mobileActionDialog.close();
	closeMobileActions();
}

let unreadBarDismissed = $state(false);
let unfocusedArrivalUids: string[] = [];
let unfocusedBanner = $state<{
	firstUid: string;
	count: number;
} | null>(null);
let isLocatingTargetMessage = $state(false);
let targetMessageNotFound = $state(false);
let isJumpingToTarget = false;
let isUnreadDividerInView = $state(false);
let hasVisitedUnreadDivider = $state(false);
let highlightUnreadDivider = $state(false);
let showScrollBottomBtn = $state(false);
let newMessagesWhileScrolled = $state(0);
let maxKnownCreatedAt = 0;
let historyScrollAnchor: {
	anchorUid: string;
	anchorOffsetInViewport: number | null;
	prevScrollHeight: number;
	prevScrollTop: number;
	manualClick: boolean;
} | null = null;
let topSentinelEl: HTMLDivElement | null = $state(null);

const skipVoteBanner = $derived.by(() => {
	const current = musicState?.current ?? null;
	const voteCount = musicState?.voteCount ?? 0;
	const voteThreshold = musicState?.voteThreshold ?? 2;
	if (!current || voteCount <= 0) return null;

	const names = (musicState?.skipVoteNames ?? []).filter(Boolean);
	const voterLabel =
		names.length === 0
			? "房友"
			: names.length <= 2
				? names.join("、")
				: `${names.slice(0, 2).join("、")} 等`;
	const hasVotedSkip = Boolean(
		currentUser && current.skipVotes.includes(currentUser.userKey),
	);
	const canDirectSkip = Boolean(currentUser && mobilePlaybackStatus?.canDirectSkip);

	return {
		voterLabel,
		title: current.track.title,
		voteCount,
		voteThreshold,
		canDirectSkip,
		hasVotedSkip,
	};
});

const queueVoteBanners = $derived.by(() => {
	const queue = musicState?.queue ?? [];
	const items = queue.filter((item) => (item.playVotes?.length ?? 0) > 0);
	if (items.length === 0) return [];

	const voteThreshold = musicState?.voteThreshold ?? 2;
	const nameMap = new Map<string, string>();
	for (const m of [...onlineMembers, ...roomOnlineMembers, ...observers]) {
		if (m.userKey && m.name) nameMap.set(m.userKey, m.name);
	}
	if (currentUser?.userKey && currentUser?.name) {
		nameMap.set(currentUser.userKey, currentUser.name);
	}

	return items.map((item) => {
		const votes = item.playVotes ?? [];
		const names = votes
			.map((key) => nameMap.get(key))
			.filter((n): n is string => Boolean(n));
		const voterLabel =
			names.length === 0
				? "房友"
				: names.length <= 2
					? names.join("、")
					: `${names.slice(0, 2).join("、")} 等`;
		const hasVoted = Boolean(
			currentUser && votes.includes(currentUser.userKey),
		);
		return {
			uid: item.uid,
			voterLabel,
			title: item.track.title,
			voteCount: votes.length,
			voteThreshold,
			hasVoted,
		};
	});
});

const RECALL_WINDOW_MS = 5 * 60_000;
const LAST_SEEN_PREFIX = "lengxi_chat_last_seen:";

let nowMs = $state(Date.now());

let messageContainer: HTMLDivElement | null = $state(null);
let messageContentEl: HTMLDivElement | null = $state(null);
let inputEl: HTMLDivElement | null = $state(null);
let mediaFileInputEl: HTMLInputElement | null = $state(null);
let dockEl: HTMLDivElement | null = $state(null);
let mentionHistoryWrapEl: HTMLDivElement | null = $state(null);
let lastMentionSeq = 0;
let lastUnreadJumpSeq = 0;
let initializedRoom = "";
let hydratedRoomKey = "";
let hasInitialBottomScrolledForRoom = false;
let seenMessageUids = new Set<string>();
let alertAutoHideTimer: number | null = null;
let highlightClearTimer: number | null = null;
let unreadHighlightTimer: number | null = null;
const BOTTOM_SCROLL_TOLERANCE = 2;
const BOTTOM_REENGAGE_GAP_PX = 24;
const BOTTOM_RELEASE_GAP_PX = 48;
const EMPTY_READ_RECEIPTS: ChatReadReceipt[] = [];
let isStickyAtBottom = $state(true);
let suppressStickyScrollUntil = 0;
const followsLayoutAtBottom = $derived(
	isStickyAtBottom &&
		!targetMessageUid &&
		!highlightedMsgUid &&
		!highlightUnreadDivider,
);
let lastScrollHeight = 0;
let lastClientHeight = 0;
let prevObservedScrollTop = 0;
let programmaticScrollUntil = 0;
let isUserTouching = false;
let touchMinY = 0;
let touchDraggedUp = false;
let isSmoothScrolling = false;

const pinnedUidSet = $derived(new Set(pinnedUids));

function handleOpenMobileActions(
	message: ChatMessageRecord,
	meta: {
		isSelf: boolean;
		senderDisplayName: string;
		canRecall: boolean;
		canEdit: boolean;
		canDelete: boolean;
		isPinned: boolean;
	},
) {
	mobileActionTarget = { message, ...meta };
}

function handleViewSource(message: ChatMessageRecord) {
	sourceModalMessage = message;
}

function handleOpenThread(message: ChatMessageRecord) {
	const rootUid = message.threadRootUid || message.msgUid;
	const rootMsg = message.threadRootUid
		? (messages.find(
				(m) =>
					m.msgUid === message.threadRootUid ||
					m.matrixEventId === message.threadRootUid,
			) ?? null)
		: message;
	activeThreadRootUid = rootUid;
	activeThreadInitialRoot = rootMsg;
	showThreadListMenu = false;
}

function handleOpenThreadByUid(
	rootUid: string,
	knownRoot?: ChatMessageRecord | null,
) {
	if (!rootUid) return;
	activeThreadRootUid = rootUid;
	activeThreadInitialRoot =
		knownRoot ??
		messages.find((m) => m.msgUid === rootUid || m.matrixEventId === rootUid) ??
		null;
	showThreadListMenu = false;
}

function getLastSeenStorageKey(rId: string, uKey: string): string {
	return `${LAST_SEEN_PREFIX}${rId}:${uKey}`;
}

function readLastSeenAt(rId: string, uKey: string): number {
	try {
		const raw = localStorage.getItem(getLastSeenStorageKey(rId, uKey));
		const parsed = raw ? Number(raw) : 0;
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
	} catch {
		return 0;
	}
}

function writeLastSeenAt(rId: string, uKey: string, ts: number): void {
	if (!uKey || !Number.isFinite(ts) || ts <= 0) return;
	try {
		const key = getLastSeenStorageKey(rId, uKey);
		const prev = readLastSeenAt(rId, uKey);
		if (ts > prev) {
			localStorage.setItem(key, String(ts));
		}
	} catch {
		// 忽略存储写入异常
	}
}

function isChatPaneFocused(): boolean {
	if (typeof document === "undefined" || typeof window === "undefined") {
		return false;
	}
	if (document.hidden || document.visibilityState !== "visible") return false;
	if (typeof document.hasFocus === "function" && !document.hasFocus()) {
		return false;
	}
	if (!isWindowFocused) return false;
	if (!isChatTabActive) return false;
	if (document.querySelector(".fancybox__container, .chat-modal-backdrop")) {
		return false;
	}
	return true;
}

const baseFilteredMessages = $derived(
	messages.filter((msg) => !isMusicNoticeMessage(msg)),
);

const musicNoticeMessages = $derived.by(() => {
	if (!ENABLE_HEADER_MUSIC_NOTICES) return [];
	return messages.filter((msg) => isMusicNoticeMessage(msg));
});

const sortedMusicNotices = $derived.by(() => {
	if (!ENABLE_HEADER_MUSIC_NOTICES) return [];
	return musicNoticeMessages.slice().sort((a, b) => b.createdAt - a.createdAt);
});

const unreadMusicNoticeCount = $derived.by(() => {
	if (!ENABLE_HEADER_MUSIC_NOTICES) return 0;
	return musicNoticeMessages.filter((m) => m.createdAt > lastSeenMusicNoticeTs)
		.length;
});

const loadedMainRootIds = $derived.by(() => {
	const set = new Set<string>();
	for (const msg of baseFilteredMessages) {
		if (msg.threadRootUid) continue;
		if (msg.msgUid) set.add(msg.msgUid);
		if (msg.matrixEventId) set.add(msg.matrixEventId);
	}
	return set;
});

const liveThreadSummaryMap = $derived.by(() => {
	const idToCanonicalRoot = new Map<string, string>();
	const rootMsgByUid = new Map<string, ChatMessageRecord>();
	for (const m of messages) {
		if (m.threadRootUid) continue;
		if (m.msgUid) {
			idToCanonicalRoot.set(m.msgUid, m.msgUid);
			rootMsgByUid.set(m.msgUid, m);
		}
		if (m.matrixEventId) {
			idToCanonicalRoot.set(m.matrixEventId, m.msgUid);
		}
	}

	const repliesByRoot = new Map<string, ChatMessageRecord[]>();
	for (const m of messages) {
		if (!m.threadRootUid) continue;
		const canonical = idToCanonicalRoot.get(m.threadRootUid) || m.threadRootUid;
		let arr = repliesByRoot.get(canonical);
		if (!arr) {
			arr = [];
			repliesByRoot.set(canonical, arr);
		}
		arr.push(m);
	}

	const result = new Map<string, ChatThreadSummary>();
	const allRootKeys = new Set<string>();
	for (const m of messages) {
		if (!m.threadRootUid && m.threadSummary && m.threadSummary.count > 0) {
			allRootKeys.add(m.msgUid);
		}
	}
	for (const key of repliesByRoot.keys()) {
		allRootKeys.add(key);
	}

	for (const rootKey of allRootKeys) {
		const rootMsg = rootMsgByUid.get(rootKey);
		const serverSummary = rootMsg?.threadSummary ?? null;
		const liveReplies = (repliesByRoot.get(rootKey) ?? [])
			.slice()
			.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

		if (liveReplies.length === 0) {
			if (serverSummary && serverSummary.count > 0) {
				result.set(rootKey, serverSummary);
			}
			continue;
		}

		const latestLive = liveReplies[liveReplies.length - 1];
		const serverLatestTs = serverSummary?.latestReply?.createdAt || 0;
		const newerThanServerCount = serverSummary
			? liveReplies.filter(
					(r) =>
						(r.createdAt || 0) > serverLatestTs &&
						r.msgUid !== serverSummary.latestReply?.msgUid,
				).length
			: 0;
		const count = serverSummary
			? Math.max(liveReplies.length, serverSummary.count + newerThanServerCount)
			: liveReplies.length;

		const latestReply =
			!serverSummary?.latestReply ||
			(latestLive.createdAt || 0) >= serverLatestTs
				? {
						msgUid: latestLive.msgUid,
						userKey: latestLive.userKey || "",
						name: latestLive.name || "房友",
						avatar: latestLive.avatar || "",
						content: (latestLive.content || "")
							.replace(/\s+/g, " ")
							.trim()
							.slice(0, 120),
						attachmentKind: getChatAttachmentKind(latestLive.attachments),
						createdAt: latestLive.createdAt || 0,
					}
				: serverSummary.latestReply;

		const participantsMap = new Map<
			string,
			{ userKey: string; name: string; avatar: string }
		>();
		for (const p of serverSummary?.participants ?? []) {
			const pKey = p.userKey || p.name;
			if (pKey && !participantsMap.has(pKey) && participantsMap.size < 4) {
				participantsMap.set(pKey, p);
			}
		}
		for (const r of liveReplies) {
			const pKey = r.userKey || r.name || r.msgUid;
			if (pKey && !participantsMap.has(pKey) && participantsMap.size < 4) {
				participantsMap.set(pKey, {
					userKey: r.userKey || "",
					name: r.name || "房友",
					avatar: r.avatar || "",
				});
			}
		}

		result.set(rootKey, {
			count,
			latestReply,
			participants: Array.from(participantsMap.values()),
		});
	}

	return result;
});

function getThreadSummaryForMessage(
	msg: ChatMessageRecord,
): ChatThreadSummary | null {
	if (msg.threadRootUid) return null;
	return (
		liveThreadSummaryMap.get(msg.msgUid) ??
		(msg.matrixEventId ? liveThreadSummaryMap.get(msg.matrixEventId) : null) ??
		msg.threadSummary ??
		null
	);
}

const mergedActiveThreads = $derived.by<ChatActiveThreadItem[]>(() => {
	const byRoot = new Map<string, ChatActiveThreadItem>();
	for (const item of activeThreads) {
		if (!item?.rootUid || !item.summary || item.summary.count <= 0) continue;
		byRoot.set(item.rootUid, item);
	}
	const rootMsgMap = new Map<string, ChatMessageRecord>();
	for (const m of messages) {
		if (!m.threadRootUid) {
			rootMsgMap.set(m.msgUid, m);
			if (m.matrixEventId) rootMsgMap.set(m.matrixEventId, m);
		}
	}
	for (const [rootUid, summary] of liveThreadSummaryMap.entries()) {
		if (!summary || summary.count <= 0) continue;
		const existing = byRoot.get(rootUid);
		const rootMessage =
			rootMsgMap.get(rootUid) ?? existing?.rootMessage ?? null;
		const canonicalUid = rootMessage?.msgUid || rootUid;
		byRoot.set(canonicalUid, {
			rootUid: canonicalUid,
			rootMessage,
			summary,
		});
	}
	return Array.from(byRoot.values()).sort(
		(a, b) =>
			(b.summary.latestReply?.createdAt || 0) -
			(a.summary.latestReply?.createdAt || 0),
	);
});

const visibleMessages = $derived.by(() =>
	baseFilteredMessages.filter((msg) => {
		if (!msg.threadRootUid) return true;
		// 若原主题消息就在当前时间线中，则线程回复收纳到线程弹窗中显示，避免主时间线重复刷屏
		return !loadedMainRootIds.has(msg.threadRootUid);
	}),
);

const hasTouchPointer =
	typeof window !== "undefined" &&
	typeof window.matchMedia === "function" &&
	window.matchMedia("(any-pointer: coarse)").matches;
// 触屏优先保留已加载的消息行，减少惯性滚动中的 DOM 换窗。
const VIRTUAL_ENABLE_THRESHOLD = hasTouchPointer ? 240 : 75;
const VIRTUAL_DISABLE_THRESHOLD = hasTouchPointer ? 180 : 60;
const WINDOW_TARGET_COUNT = 52;
const WINDOW_HALF_COUNT = 26;
const WINDOW_MAX_COUNT = 76;
const EDGE_IMMEDIATE_BUFFER_PX = 380;
const EDGE_IDLE_BUFFER_PX = 820;
const SCROLL_SETTLE_DELAY_MS = hasTouchPointer ? 300 : 220;
const EDGE_CHECK_STEP_PX = 96;
const MAX_MEASURED_HEIGHTS = 4000;

const measuredMsgHeights = new Map<string, number>();
let virtualEnabled = $state(false);
let windowStart = $state(0);
let windowEnd = $state(0);
let estimatedImageWidth = $state(224);
let rootFontSize = $state(16);
let isShiftingWindow = false;
let scrollEndTimer: number | null = null;
let isActivelyScrolling = false;
let scrollDeviation = 0;
let lastEdgeCheckScrollTop = -1;
let prevVisibleCount = 0;
let windowTopMarkerEl: HTMLDivElement | null = $state(null);
let windowBottomMarkerEl: HTMLDivElement | null = $state(null);

function estimateImageHeight(
	url: string,
	metadata?: Partial<ChatImageDimensions>,
): number {
	const { ratio, intrinsicWidth, maxWidthRem } = chatImageLayout(
		getChatImageDimensions(url, metadata),
	);
	const width = Math.min(
		intrinsicWidth,
		maxWidthRem * rootFontSize,
		estimatedImageWidth,
	);
	return width / ratio + 2;
}

function estimateRowHeight(msg: ChatMessageRecord): number {
	if (msg.kind === "system") return 46;
	let h = 76;
	if (firstUnreadMsgUid === msg.msgUid) h += 34;
	if (msg.replyTo) h += 44;
	const { imageUrls, textLength } = getChatMarkdownLayout(
		msg.content,
		stickerMap,
	);
	if (textLength > 160) h += 84;
	else if (textLength > 70) h += 40;
	for (const url of imageUrls) {
		h += estimateImageHeight(url, msg.inlineImageDimensions?.[url]);
		h += 0.5 * rootFontSize; // Markdown preview margins
	}
	const attachments = getChatMessageAttachments(msg, stickerMap);
	for (const att of attachments) {
		if (att.type === "image" && !att.isSticker) h += estimateImageHeight(att.url, att);
		else if (att.type === "image") h += 120;
		else if (att.type === "video") h += 180;
		else h += 44;
	}
	if (attachments.length > 0) {
		const gaps = attachments.length - 1 + Number(Boolean(msg.replyTo || msg.content.trim()));
		h += gaps * 0.5 * rootFontSize;
	}
	if (msg.poll) h += 140;
	if (msg.reactions && Object.keys(msg.reactions).length > 0) h += 32;
	if (msg.threadSummary && msg.threadSummary.count > 0) h += 38;
	return h;
}

function getRowSlotHeight(msg: ChatMessageRecord): number {
	return measuredMsgHeights.get(msg.msgUid) ?? estimateRowHeight(msg);
}

function recordRowHeight(uid: string, h: number) {
	if (h <= 0) return;
	if (
		measuredMsgHeights.size >= MAX_MEASURED_HEIGHTS &&
		!measuredMsgHeights.has(uid)
	) {
		const oldestUid = measuredMsgHeights.keys().next().value;
		if (oldestUid !== undefined) measuredMsgHeights.delete(oldestUid);
	}
	measuredMsgHeights.set(uid, h);
}

function measureMountedRows() {
	if (!messageContainer) return;
	const rows =
		messageContainer.querySelectorAll<HTMLElement>("[data-vrow-uid]");
	for (const row of rows) {
		const uid = row.dataset.vrowUid;
		if (!uid) continue;
		const h = row.getBoundingClientRect().height;
		if (h > 0) recordRowHeight(uid, h);
	}
}

const renderedWindow = $derived.by(() => {
	const list = visibleMessages;
	const len = list.length;
	if (!virtualEnabled || len === 0) {
		return {
			start: 0,
			end: len,
			topSpacerPx: 0,
			bottomSpacerPx: 0,
		};
	}
	const start = Math.max(0, Math.min(windowStart, len));
	const end = Math.max(start, Math.min(windowEnd, len));
	let topSpacerPx = 0;
	for (let i = 0; i < start; i++) {
		topSpacerPx += getRowSlotHeight(list[i]);
	}
	let bottomSpacerPx = 0;
	for (let i = end; i < len; i++) {
		bottomSpacerPx += getRowSlotHeight(list[i]);
	}
	return {
		start,
		end,
		topSpacerPx: Math.round(topSpacerPx),
		bottomSpacerPx: Math.round(bottomSpacerPx),
	};
});

const renderedMessages = $derived(
	visibleMessages.slice(renderedWindow.start, renderedWindow.end),
);

function clearScrollEndTimer() {
	if (scrollEndTimer !== null) {
		window.clearTimeout(scrollEndTimer);
		scrollEndTimer = null;
	}
}

function applyStageTransform(px: number) {
	scrollDeviation = Math.abs(px) < 0.25 ? 0 : px;
	if (messageContentEl) {
		messageContentEl.style.transform =
			scrollDeviation !== 0 ? `translate3d(0, ${scrollDeviation}px, 0)` : "";
	}
}

function commitScrollDeviation() {
	if (scrollDeviation === 0 || !messageContainer) return;
	const offset = scrollDeviation;
	// 同步在同一帧清除 GPU 位移并结算进 scrollTop，屏幕画面 0 像素闪烁
	applyStageTransform(0);
	setScrollTopProgrammatically(messageContainer.scrollTop - offset);
}

function maybeTriggerAutoLoadOlderHistory(allowCommitDeviation = false) {
	if (
		!messageContainer ||
		!hasMoreHistory ||
		isLoadingHistory ||
		!hasInitialBottomScrolledForRoom ||
		followsLayoutAtBottom ||
		isShiftingWindow ||
		(hasTouchPointer && (isActivelyScrolling || isUserTouching)) ||
		renderedWindow.start !== 0
	) {
		return;
	}
	const visualScrollTop = Math.max(
		0,
		messageContainer.scrollTop - scrollDeviation,
	);
	if (visualScrollTop > 180) return;
	if (scrollDeviation !== 0 && !allowCommitDeviation && visualScrollTop > 40) {
		return;
	}
	triggerAutoLoadOlderHistory();
}

function handleScrollSettled() {
	clearScrollEndTimer();
	if (isUserTouching || isSmoothScrolling || isShiftingWindow) {
		if (!isUserTouching) {
			scheduleScrollSettled();
		}
		return;
	}
	isActivelyScrolling = false;
	commitScrollDeviation();
	if (followsLayoutAtBottom) snapScrollToBottom();
	lastEdgeCheckScrollTop = -1;
	checkVirtualWindowEdges(false);
	maybeTriggerAutoLoadOlderHistory(true);
}

function scheduleScrollSettled() {
	clearScrollEndTimer();
	scrollEndTimer = window.setTimeout(
		handleScrollSettled,
		SCROLL_SETTLE_DELAY_MS,
	);
}

function findVisibleViewportAnchor(
	nextStart: number,
	nextEnd: number,
): { uid: string; contentTop: number } | null {
	if (!messageContainer) return null;
	const cRect = messageContainer.getBoundingClientRect();
	const scrollTop = messageContainer.scrollTop;
	const viewCenterY = cRect.top + cRect.height / 2;
	const rows =
		messageContainer.querySelectorAll<HTMLElement>("[data-vrow-uid]");
	const allowedUids = new Set<string>();
	for (let i = nextStart; i < nextEnd; i++) {
		const msg = visibleMessages[i];
		if (msg) allowedUids.add(msg.msgUid);
	}
	let best: { uid: string; contentTop: number; dist: number } | null = null;
	for (const row of rows) {
		const uid = row.dataset.vrowUid;
		if (!uid || !allowedUids.has(uid)) continue;
		const rect = row.getBoundingClientRect();
		if (rect.bottom < cRect.top || rect.top > cRect.bottom) continue;
		const dist = Math.abs(rect.top + rect.height / 2 - viewCenterY);
		if (!best || dist < best.dist) {
			best = { uid, contentTop: rect.top - cRect.top + scrollTop, dist };
		}
	}
	return best ? { uid: best.uid, contentTop: best.contentTop } : null;
}

function compensateLayoutDrift(drift: number) {
	if (!messageContainer || Math.abs(drift) <= 0.5) return;
	if (isActivelyScrolling || isUserTouching) {
		// Defer scrollTop writes until touch and momentum scrolling have settled.
		applyStageTransform(scrollDeviation - drift);
		scheduleScrollSettled();
		return;
	}
	const pendingOffset = scrollDeviation;
	if (pendingOffset !== 0) applyStageTransform(0);
	setScrollTopProgrammatically(messageContainer.scrollTop - pendingOffset + drift);
}

async function shiftWindowWithAnchor(
	nextStart: number,
	nextEnd: number,
	enableVirtual = virtualEnabled,
) {
	if (!messageContainer || isShiftingWindow) return;
	const len = visibleMessages.length;
	const clampedStart = Math.max(0, Math.min(nextStart, len));
	const clampedEnd = Math.max(clampedStart, Math.min(nextEnd, len));
	if (
		enableVirtual === virtualEnabled &&
		clampedStart === windowStart &&
		clampedEnd === windowEnd
	) {
		return;
	}

	isShiftingWindow = true;
	try {
		measureMountedRows();
		const anchor = findVisibleViewportAnchor(clampedStart, clampedEnd);
		virtualEnabled = enableVirtual;
		windowStart = clampedStart;
		windowEnd = clampedEnd;
		await tick();
		if (!messageContainer) return;
		measureMountedRows();
		if (anchor) {
			const el = messageContainer.querySelector<HTMLElement>(
				`[data-vrow-uid="${CSS.escape(anchor.uid)}"]`,
			);
			if (el) {
				const cRect = messageContainer.getBoundingClientRect();
				// 换窗前后在内容坐标中比较，避免把 tick 期间的惯性滚动算成布局偏移。
				const nextContentTop =
					el.getBoundingClientRect().top -
					cRect.top +
					messageContainer.scrollTop;
				compensateLayoutDrift(nextContentTop - anchor.contentTop);
			}
		}
	} finally {
		isShiftingWindow = false;
	}
	if (clampedStart === 0) {
		maybeTriggerAutoLoadOlderHistory(!isActivelyScrolling);
	}
}

function computeTargetWindowAroundViewport(): {
	start: number;
	end: number;
} | null {
	if (!messageContainer) return null;
	const list = visibleMessages;
	const len = list.length;
	if (len === 0) return null;

	const cRect = messageContainer.getBoundingClientRect();
	const viewCenterY = cRect.top + cRect.height / 2;
	const rows =
		messageContainer.querySelectorAll<HTMLElement>("[data-vrow-uid]");
	let centerUid = "";
	let minDist = Number.POSITIVE_INFINITY;
	for (const row of rows) {
		const rect = row.getBoundingClientRect();
		if (rect.bottom < cRect.top - 120 || rect.top > cRect.bottom + 120) {
			continue;
		}
		const dist = Math.abs(rect.top + rect.height / 2 - viewCenterY);
		if (dist < minDist) {
			minDist = dist;
			centerUid = row.dataset.vrowUid || "";
		}
	}

	let centerIdx = centerUid
		? list.findIndex((m) => m.msgUid === centerUid)
		: -1;

	// 用户大幅拖动滚动条跳入 spacer 区域时，按累计高度估算目标索引
	if (centerIdx < 0) {
		const targetY =
			Math.max(0, messageContainer.scrollTop - scrollDeviation) +
			messageContainer.clientHeight / 2;
		let acc = 0;
		centerIdx = len - 1;
		for (let i = 0; i < len; i++) {
			acc += getRowSlotHeight(list[i]);
			if (acc >= targetY) {
				centerIdx = i;
				break;
			}
		}
	}

	let nextStart = Math.max(0, centerIdx - WINDOW_HALF_COUNT);
	let nextEnd = Math.min(len, nextStart + WINDOW_TARGET_COUNT);
	if (nextEnd === len) {
		nextStart = Math.max(0, len - WINDOW_TARGET_COUNT);
	}
	return { start: nextStart, end: nextEnd };
}

function checkVirtualWindowEdges(duringActiveScroll = true) {
	if (
		!virtualEnabled ||
		!messageContainer ||
		isShiftingWindow ||
		isSmoothScrolling
	) {
		return;
	}
	const len = visibleMessages.length;
	const curStart = renderedWindow.start;
	const curEnd = renderedWindow.end;
	const canExtendTop = curStart > 0;
	const canExtendBottom = curEnd < len;
	if (!canExtendTop && !canExtendBottom) {
		return;
	}

	if (!windowTopMarkerEl || !windowBottomMarkerEl) return;

	const cRect = messageContainer.getBoundingClientRect();
	const topBufferPx = cRect.top - windowTopMarkerEl.getBoundingClientRect().top;
	const bottomBufferPx =
		windowBottomMarkerEl.getBoundingClientRect().bottom - cRect.bottom;

	const threshold = duringActiveScroll
		? EDGE_IMMEDIATE_BUFFER_PX
		: EDGE_IDLE_BUFFER_PX;
	const needTop = canExtendTop && topBufferPx < threshold;
	const needBottom = canExtendBottom && bottomBufferPx < threshold;
	const trimTouchWindow =
		hasTouchPointer &&
		!duringActiveScroll &&
		curEnd - curStart > WINDOW_MAX_COUNT;
	if (needTop || needBottom || trimTouchWindow) {
		const target = computeTargetWindowAroundViewport();
		if (target) {
			// 长历史仍按需挂载，但惯性滚动期间只补行，停下来再移除远处的行。
			const keepMounted =
				hasTouchPointer && (isActivelyScrolling || isUserTouching);
			const start = keepMounted
				? Math.min(curStart, target.start)
				: target.start;
			const end = keepMounted ? Math.max(curEnd, target.end) : target.end;
			void shiftWindowWithAnchor(start, end, true);
		}
	}
}

function collectChatImageSources(): Array<{ src: string }> {
	const items: Array<{ src: string }> = [];
	const mdImgRe = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
	for (const msg of visibleMessages) {
		if (msg.attachments) {
			for (const att of msg.attachments) {
				if (att.type === "image" && !att.isSticker && att.url) {
					items.push({ src: att.url });
				}
			}
		}
		if (msg.content?.includes("![")) {
			mdImgRe.lastIndex = 0;
			let m = mdImgRe.exec(msg.content);
			while (m !== null) {
				const safe = sanitizeChatUrl(m[1]);
				if (safe && !safe.includes("/assets/stickers/")) {
					items.push({ src: safe });
				}
				m = mdImgRe.exec(msg.content);
			}
		}
	}
	return items;
}

const hasUnloadedUnread = $derived(
	Boolean(
		sessionUnreadSince > 0 &&
			messages.length > 0 &&
			sessionUnreadSince < messages[0].createdAt &&
			hasMoreHistory,
	),
);

const firstUnreadMsgUid = $derived.by(() => {
	if (!sessionUnreadSince) return "";
	const found = visibleMessages.find((m) => m.createdAt > sessionUnreadSince);
	return found?.msgUid || "";
});

const unreadBadgeCount = $derived.by(() => {
	if (!sessionUnreadSince) return 0;
	const loadedCount = visibleMessages.filter(
		(m) => m.createdAt > sessionUnreadSince,
	).length;
	const serverCount = serverUnreadUserCount ?? 0;
	return hasUnloadedUnread ? Math.max(loadedCount, serverCount) : loadedCount;
});

const showUnreadJumpBar = $derived(
	Boolean(
		sessionUnreadSince > 0 &&
			unreadBadgeCount > 0 &&
			!unreadBarDismissed &&
			!unfocusedBanner &&
			isStickyAtBottom &&
			(hasUnloadedUnread || !isUnreadDividerInView),
	),
);

function formatUnreadTime(ts: number): string {
	if (!ts) return "";
	const d = new Date(ts);
	const now = new Date();
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	const timePart = `${hh}:${mm}`;

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
	if (diffDays === 0) return `今天 ${timePart}`;
	if (diffDays === 1) return `昨天 ${timePart}`;
	return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${timePart}`;
}

async function handleCenterWallpaperDrop(e: DragEvent) {
	if (!import.meta.env.DEV) return;
	e.preventDefault();
	e.stopPropagation();
	isDraggingFiles = false;
	dragCounter = 0;
	const files = Array.from(e.dataTransfer?.files || []);
	const imageFile = files.find((f) => f.type.startsWith("image/"));
	if (!imageFile) {
		onNotify?.("请拖入图片文件以预览聊天区壁纸");
		return;
	}
	await saveDevPanelWallpaperPreview("center", imageFile);
	onNotify?.(`已更新中间聊天区壁纸预览：${imageFile.name}`);
}

function isMentionedToMe(msg: ChatMessageRecord): boolean {
	return isMentionedForUser(msg, currentUser);
}

function isReplyToMe(msg: ChatMessageRecord): boolean {
	if (
		!currentUser ||
		msg.kind !== "user" ||
		msg.userKey === currentUser.userKey
	) {
		return false;
	}
	if (!msg.replyTo) return false;
	return Boolean(
		msg.replyTo.userKey &&
			(msg.replyTo.userKey === currentUser.userKey ||
				(currentUser.isAdmin &&
					(msg.replyTo.userKey === "waline:1" ||
						msg.replyTo.userKey === "@lengxiqwq:matrix.lengxiqwq.com" ||
						msg.replyTo.userKey === "matrix:@lengxiqwq:matrix.lengxiqwq.com"))),
	);
}

function isDirectToMe(msg: ChatMessageRecord): boolean {
	return isMentionedToMe(msg) || isReplyToMe(msg);
}

const mentionsToMe = $derived(messages.filter(isMentionedToMe));
const hasHeaderThreads = $derived(mergedActiveThreads.length > 0);
const hasHeaderMentions = $derived(Boolean(currentUser && mentionsToMe.length));
const mobileOnlineLabel = $derived(
	`${onlineCount}/${totalChatterCount > 0 ? totalChatterCount : "—"} 人在线`,
);
const mobileHeaderTarget = 44;
// 扣除右端的点歌和网站菜单、更多按钮，以及顶栏的左右内边距和间距。
const mobileRoomBudget = $derived(
	chatHeaderWidth - mobileHeaderEndWidth - mobileHeaderTarget - 36,
);
const mobileRoomButtonWidth = $derived(mobileRoomContentWidth + 8);
const threadInMore = $derived(mobileHeaderEndWidth > 0 && hasHeaderThreads);
const mentionsInMore = $derived(
	mobileHeaderEndWidth > 0 &&
		hasHeaderMentions &&
		unreadMentionUids.length === 0 &&
		mobileRoomButtonWidth + mobileHeaderTarget > mobileRoomBudget,
);
const musicNoticesInMore = $derived(
	ENABLE_HEADER_MUSIC_NOTICES &&
		mobileHeaderEndWidth > 0 &&
		unreadMusicNoticeCount === 0 &&
		mobileRoomButtonWidth + mobileHeaderTarget > mobileRoomBudget,
);
const fitsMobileRoomAvatar = $derived(
	mobileHeaderEndWidth > 0 &&
		mobileRoomButtonWidth + (hasHeaderMentions ? mobileHeaderTarget : 0) + 40 <=
			mobileRoomBudget,
);

function formatOfflineTime(ts?: number): string {
	if (!ts || !Number.isFinite(ts) || ts <= 0) return "离线";
	const diff = Date.now() - ts;
	if (diff < 60_000) return "刚刚离线";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前离线`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前离线`;
	const d = new Date(ts);
	const now = new Date();
	if (d.getFullYear() === now.getFullYear()) {
		return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} 离线`;
	}
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} 离线`;
}

const mergedMentionCandidates = $derived.by<ChatMentionCandidate[]>(() => {
	const allowExternal = roomId === "interconnect";
	const map = new Map<string, ChatMentionCandidate>();
	if (currentUser?.isAdmin) {
		map.set("room", {
			userKey: "room",
			authType: "waline",
			name: "全体成员",
			avatar: "",
			badge: "全员提醒",
			badgeType: "host",
			isAdmin: false,
			online: true,
			lastSeenAt: 0,
		});
	}
	for (const m of mentionMembers) {
		if (!m.userKey || m.userKey === currentUser?.userKey) continue;
		const isExt = isExternalMatrixIdentity(m);
		if (isExt && !allowExternal) continue;
		map.set(m.userKey, m);
	}
	for (const m of onlineMembers) {
		if (!m.userKey || m.userKey === currentUser?.userKey) continue;
		const isExt = isExternalMatrixIdentity(m);
		if (isExt && !allowExternal) continue;
		const prev = map.get(m.userKey);
		map.set(m.userKey, {
			userKey: m.userKey,
			authType: m.authType,
			name: m.name,
			avatar: m.avatar,
			url: m.url,
			site: m.site,
			siteUrl: m.siteUrl,
			badge: m.badge,
			badgeType: m.badgeType,
			isAdmin: m.isAdmin,
			online: true,
			connectedAt: m.connectedAt,
			isFocused: m.isFocused,
			presenceMode: m.presenceMode,
			lastSeenAt: prev?.lastSeenAt ?? 0,
		});
	}
	return Array.from(map.values()).sort((a, b) => {
		if (a.userKey === "room") return -1;
		if (b.userKey === "room") return 1;
		// 组别：0=在线且专注, 1=在线但离开(away), 2=离线
		const aGroup = !a.online ? 2 : a.isFocused === false ? 1 : 0;
		const bGroup = !b.online ? 2 : b.isFocused === false ? 1 : 0;
		if (aGroup !== bGroup) return aGroup - bGroup;
		if (aGroup <= 1) {
			// 在线用户：最新连接的排在最下面（column-reverse 下数组越靠前视觉越靠下，故时间降序）
			const aTime = a.connectedAt || 0;
			const bTime = b.connectedAt || 0;
			return bTime - aTime || a.name.localeCompare(b.name, "zh-CN");
		}
		// 离线用户：最近离线的排在最下面（column-reverse 下数组越靠前视觉越靠下，故时间降序）
		const aTime = a.lastSeenAt || 0;
		const bTime = b.lastSeenAt || 0;
		return bTime - aTime || a.name.localeCompare(b.name, "zh-CN");
	});
});

const filteredMentionCandidates = $derived.by<ChatMentionCandidate[]>(() => {
	const q = mentionQuery.trim().toLowerCase();
	if (!q) return mergedMentionCandidates;
	return mergedMentionCandidates.filter((c) => {
		if (c.userKey === "room") {
			return (
				"room".includes(q) ||
				"all".includes(q) ||
				"全体成员".includes(q) ||
				"所有人".includes(q)
			);
		}
		return (
			formatCandidateMentionName(c).toLowerCase().includes(q) ||
			c.userKey.toLowerCase().includes(q)
		);
	});
});

const repeatedMentionLabels = $derived.by(() => {
	const seen = new Set<string>();
	const repeated = new Set<string>();
	for (const candidate of filteredMentionCandidates) {
		const label = formatCandidateMentionName(candidate);
		if (seen.has(label)) repeated.add(label);
		seen.add(label);
	}
	return repeated;
});

const unreadMentionSet = $derived(new Set(unreadMentionUids));

let userProfileMap = $state.raw<Map<string, ChatUserDetailSeed>>(new Map());
let userNameMap = $state.raw<Map<string, string>>(new Map());
let profileCacheRoomTag = "";
const seenProfileMsgUids = new Set<string>();
const cachedProfileMap = new Map<string, ChatUserDetailSeed>();
const cachedNameMap = new Map<string, string>();

$effect(() => {
	const tag = `${roomId}:${roomInitSeq}`;
	let profileChanged = false;
	let nameChanged = false;

	if (profileCacheRoomTag !== tag) {
		profileCacheRoomTag = tag;
		seenProfileMsgUids.clear();
		cachedProfileMap.clear();
		cachedNameMap.clear();
		profileChanged = true;
		nameChanged = true;
	}

	const mergeSeed = (seed: ChatUserDetailSeed) => {
		if (!seed.userKey) return;
		const prev = cachedProfileMap.get(seed.userKey);
		const merged: ChatUserDetailSeed = {
			userKey: seed.userKey,
			name: seed.name || prev?.name || "",
			avatar: seed.avatar || prev?.avatar,
			url: seed.url || prev?.url,
			site: seed.site || prev?.site,
			siteUrl: seed.siteUrl || prev?.siteUrl,
			badge: seed.badge || prev?.badge,
			badgeType: seed.badgeType || prev?.badgeType,
			isAdmin: seed.isAdmin ?? prev?.isAdmin,
			authType: seed.authType || prev?.authType,
		};
		if (
			prev &&
			prev.name === merged.name &&
			prev.avatar === merged.avatar &&
			prev.url === merged.url &&
			prev.site === merged.site &&
			prev.siteUrl === merged.siteUrl &&
			prev.badge === merged.badge &&
			prev.badgeType === merged.badgeType &&
			prev.isAdmin === merged.isAdmin &&
			prev.authType === merged.authType
		) {
			return;
		}
		cachedProfileMap.set(seed.userKey, merged);
		if (seed.userKey.startsWith("matrix:")) {
			cachedProfileMap.set(seed.userKey.slice(7), merged);
		} else if (seed.userKey.startsWith("@") && seed.userKey.includes(":")) {
			cachedProfileMap.set(`matrix:${seed.userKey}`, merged);
		}
		profileChanged = true;
	};

	const mergeName = (key?: string, name?: string) => {
		if (!key || !name) return;
		if (cachedNameMap.get(key) === name) return;
		cachedNameMap.set(key, name);
		nameChanged = true;
	};

	if (currentUser?.userKey && currentUser?.name) {
		mergeName(currentUser.userKey, currentUser.name);
	}
	for (const m of messages) {
		if (seenProfileMsgUids.has(m.msgUid)) continue;
		seenProfileMsgUids.add(m.msgUid);
		if (m.userKey && m.name) {
			mergeName(m.userKey, m.name);
			mergeSeed({
				userKey: m.userKey,
				name: m.name,
				avatar: m.avatar,
				url: m.url,
				site: m.site,
				siteUrl: m.siteUrl,
				badge: m.badge,
				badgeType: m.badgeType,
				isAdmin: m.isAdmin,
				authType:
					m.source === "matrix" ||
					m.userKey.startsWith("matrix:") ||
					m.userKey.startsWith("@")
						? undefined
						: m.userKey.startsWith("waline:")
							? "waline"
							: "guest",
			});
		}
	}
	for (const m of mentionMembers) {
		if (m.userKey && m.name) {
			mergeName(m.userKey, m.name);
			mergeSeed({
				userKey: m.userKey,
				name: m.name,
				avatar: m.avatar,
				url: m.url,
				site: m.site,
				siteUrl: m.siteUrl,
				isAdmin: m.isAdmin,
			});
		}
	}
	for (const m of onlineMembers) {
		if (m.userKey && m.name) {
			mergeName(m.userKey, m.name);
			mergeSeed({
				userKey: m.userKey,
				name: m.name,
				avatar: m.avatar,
				url: m.url,
				site: m.site,
				siteUrl: m.siteUrl,
				badge: m.badge,
				badgeType: m.badgeType,
				isAdmin: m.isAdmin,
				authType: m.authType,
			});
		}
	}
	for (const m of roomOnlineMembers) {
		if (m.userKey && m.name) {
			mergeName(m.userKey, m.name);
			mergeSeed({
				userKey: m.userKey,
				name: m.name,
				avatar: m.avatar,
				url: m.url,
				site: m.site,
				siteUrl: m.siteUrl,
				badge: m.badge,
				badgeType: m.badgeType,
				isAdmin: m.isAdmin,
				authType: m.authType,
			});
		}
	}
	if (currentUser?.userKey && currentUser?.name) {
		mergeSeed({
			userKey: currentUser.userKey,
			name: currentUser.name,
			avatar: currentUser.avatar,
			url: currentUser.url,
			isAdmin: currentUser.isAdmin,
			authType: currentUser.authType,
		});
	}

	if (profileChanged) {
		userProfileMap = new Map(cachedProfileMap);
	}
	if (nameChanged) {
		userNameMap = new Map(cachedNameMap);
	}
});

const displayTypingUsers = $derived.by<string[]>(() => {
	const myName = currentUser?.name?.trim();
	return (typingUsers || []).filter((name) => name && name.trim() !== myName);
});

const typingDisplayText = $derived.by<string>(() => {
	const count = displayTypingUsers.length;
	if (count === 0) return "";
	if (count === 1) return `${displayTypingUsers[0]} 正在输入...`;
	if (count === 2)
		return `${displayTypingUsers[0]}、${displayTypingUsers[1]} 正在输入...`;
	return `${count} 人正在输入...`;
});

const activeAlertMessage = $derived.by<ChatMessageRecord | null>(() => {
	const targetUid =
		alertBannerUid ??
		(unreadMentionUids.length > 0
			? unreadMentionUids[unreadMentionUids.length - 1]
			: null);
	if (!targetUid) return null;
	return messages.find((m) => m.msgUid === targetUid) ?? null;
});

function getScrollGap(): number {
	if (!messageContainer) return 0;
	return Math.max(
		0,
		messageContainer.scrollHeight -
			messageContainer.scrollTop -
			messageContainer.clientHeight,
	);
}

function setScrollTopProgrammatically(nextTop: number) {
	if (!messageContainer) return;
	const maxScroll = Math.max(
		0,
		messageContainer.scrollHeight - messageContainer.clientHeight,
	);
	const clamped = Math.max(0, Math.min(nextTop, maxScroll));
	programmaticScrollUntil = performance.now() + 140;
	messageContainer.scrollTop = clamped;
	prevObservedScrollTop = Math.min(
		maxScroll,
		Math.max(0, messageContainer.scrollTop),
	);
	lastScrollHeight = messageContainer.scrollHeight;
	lastClientHeight = messageContainer.clientHeight;
}

function cancelProgrammaticScroll() {
	jumpSeq += 1;
	isSmoothScrolling = false;
	programmaticScrollUntil = 0;
}

function detachFromBottom() {
	isStickyAtBottom = false;
	showScrollBottomBtn = getScrollGap() > 180 || newMessagesWhileScrolled > 0;
}

function snapScrollToBottom() {
	if (!messageContainer) return;
	const { scrollHeight, clientHeight, scrollTop } = messageContainer;
	// The CSS-pixel heights are rounded, while scrollTop can be fractional.
	if (scrollHeight - clientHeight - scrollTop > BOTTOM_SCROLL_TOLERANCE) {
		setScrollTopProgrammatically(scrollHeight);
	} else {
		const maxScroll = Math.max(0, scrollHeight - clientHeight);
		prevObservedScrollTop = Math.min(maxScroll, Math.max(0, scrollTop));
		lastScrollHeight = scrollHeight;
		lastClientHeight = clientHeight;
	}
	isStickyAtBottom = true;
	showScrollBottomBtn = false;
	newMessagesWhileScrolled = 0;
}

const READ_FOCUS_SETTLE_MS = 800;
let lastWrittenSeenMsgKey = "";
let paneFocusedSince = 0;
let readSettleTimer: number | null = null;

function clearReadSettleTimer(): void {
	if (readSettleTimer !== null) {
		window.clearTimeout(readSettleTimer);
		readSettleTimer = null;
	}
}

function getLatestReadTargets(): {
	tailTs: number;
	receiptMsg: ChatMessageRecord | undefined;
} {
	const tailTs = messages.reduce(
		(max, m) => Math.max(max, m.createdAt || 0),
		0,
	);
	let receiptMsg: ChatMessageRecord | undefined;
	for (let i = visibleMessages.length - 1; i >= 0; i--) {
		const m = visibleMessages[i];
		if ((m.kind === "user" || m.kind === "poll") && !m.recalled) {
			receiptMsg = m;
			break;
		}
	}
	if (!receiptMsg) {
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if ((m.kind === "user" || m.kind === "poll") && !m.recalled) {
				receiptMsg = m;
				break;
			}
		}
	}
	return { tailTs, receiptMsg };
}

function hasUnreadBlockingAutoRead(): boolean {
	if (sessionUnreadSince <= 0 || unreadBadgeCount <= 0 || unreadBarDismissed) {
		return false;
	}
	return (
		hasUnloadedUnread || (!isUnreadDividerInView && !hasVisitedUnreadDivider)
	);
}

function markCurrentRoomReadIfReady(forceIgnoreSticky = false): void {
	if (!roomReady || !currentUser) return;
	// 无论是否强制忽略粘底状态，只要界面未真正处于前台聚焦，绝不标记已读
	if (!isChatPaneFocused()) {
		paneFocusedSince = 0;
		clearReadSettleTimer();
		return;
	}
	if (!forceIgnoreSticky) {
		if (targetMessageUid || !isStickyAtBottom) {
			return;
		}
		// 切回界面时要求持续聚焦满 READ_FOCUS_SETTLE_MS，防止切标签页路过误标已读
		const now = Date.now();
		if (paneFocusedSince <= 0) {
			paneFocusedSince = now;
		}
		const elapsed = now - paneFocusedSince;
		if (elapsed < READ_FOCUS_SETTLE_MS) {
			if (readSettleTimer === null && typeof window !== "undefined") {
				readSettleTimer = window.setTimeout(
					() => {
						readSettleTimer = null;
						markCurrentRoomReadIfReady();
					},
					READ_FOCUS_SETTLE_MS - elapsed + 20,
				);
			}
			return;
		}
	} else {
		clearReadSettleTimer();
	}
	const { tailTs, receiptMsg } = getLatestReadTargets();
	const readTs = Math.max(tailTs, receiptMsg?.createdAt || 0);
	if (readTs <= 0) return;
	const seenKey = `${roomId}:${currentUser.userKey}:${receiptMsg?.msgUid || ""}:${readTs}`;
	if (seenKey === lastWrittenSeenMsgKey && !forceIgnoreSticky) return;
	lastWrittenSeenMsgKey = seenKey;
	writeLastSeenAt(roomId, currentUser.userKey, readTs);
	onMarkRead?.(readTs, receiptMsg?.msgUid);
	unreadBarDismissed = true;
}

function handleMessageScroll() {
	if (!messageContainer) return;
	const sh = messageContainer.scrollHeight;
	const ch = messageContainer.clientHeight;
	const maxScroll = Math.max(0, sh - ch);
	const st = Math.min(maxScroll, Math.max(0, messageContainer.scrollTop));
	const gap = Math.max(0, maxScroll - st);

	const viewportHeightChanged = lastClientHeight > 0 && ch !== lastClientHeight;
	const layoutChanged =
		viewportHeightChanged || (lastScrollHeight > 0 && sh !== lastScrollHeight);
	const movedUpward = st < prevObservedScrollTop - 2;
	// 视口变高时，浏览器会把旧滚动位置限制到新的底部，即使用户没有滑动。
	const clampedByViewport =
		viewportHeightChanged &&
		ch > lastClientHeight &&
		prevObservedScrollTop > maxScroll &&
		gap <= BOTTOM_SCROLL_TOLERANCE &&
		!isSmoothScrolling;
	const isProgrammaticEcho =
		!isUserTouching &&
		!isSmoothScrolling &&
		performance.now() < programmaticScrollUntil &&
		Math.abs(st - prevObservedScrollTop) <= 4;

	lastScrollHeight = sh;
	lastClientHeight = ch;
	prevObservedScrollTop = st;

	if (isProgrammaticEcho || isShiftingWindow) {
		return;
	}

	if (
		layoutChanged &&
		followsLayoutAtBottom &&
		(!movedUpward || clampedByViewport) &&
		!isUserTouching
	) {
		return;
	}

	// 标记活跃滚动并延期结算 GPU 位移；若撞到顶部/底部边界则立刻结算，防止假天花板/假地板
	isActivelyScrolling = true;
	scheduleScrollSettled();
	if (
		(renderedWindow.start === 0 && st <= 2 && scrollDeviation < 0) ||
		(renderedWindow.end >= visibleMessages.length &&
			gap <= 2 &&
			scrollDeviation > 0)
	) {
		commitScrollDeviation();
	}

	if (gap >= 120) {
		suppressStickyScrollUntil = 0;
	}

	if (Date.now() < suppressStickyScrollUntil) {
		isStickyAtBottom = false;
	} else if (
		gap <= BOTTOM_REENGAGE_GAP_PX &&
		!isSmoothScrolling &&
		!touchDraggedUp &&
		scrollDeviation === 0
	) {
		ensureTailWindowForBottom();
		isStickyAtBottom = true;
	} else if (
		gap > BOTTOM_RELEASE_GAP_PX ||
		(movedUpward && gap > BOTTOM_REENGAGE_GAP_PX)
	) {
		isStickyAtBottom = false;
	}

	if (isStickyAtBottom) {
		newMessagesWhileScrolled = 0;
		showScrollBottomBtn = false;
		if (gap <= 4) {
			unfocusedBanner = null;
		}
		markCurrentRoomReadIfReady();
	} else {
		showScrollBottomBtn = gap > 180 || newMessagesWhileScrolled > 0;
	}

	// 每移动 ~96px 才做一次 O(1) 边界检测，接近顶部时及时补窗避免漏触发自动翻页
	if (
		virtualEnabled &&
		(st <= 220 ||
			lastEdgeCheckScrollTop < 0 ||
			Math.abs(st - lastEdgeCheckScrollTop) >= EDGE_CHECK_STEP_PX)
	) {
		lastEdgeCheckScrollTop = st;
		checkVirtualWindowEdges(true);
	}

	// 向上滚动到最旧已加载消息附近时，自动触发加载更早历史消息
	maybeTriggerAutoLoadOlderHistory(false);
}

function ensureTailWindowForBottom() {
	const len = visibleMessages.length;
	if (!virtualEnabled || renderedWindow.end >= len) return;
	measureMountedRows();
	windowEnd = len;
	windowStart = Math.max(0, len - WINDOW_TARGET_COUNT);
}

async function scrollToBottom(smooth = false) {
	suppressStickyScrollUntil = 0;
	clearScrollEndTimer();
	isActivelyScrolling = false;
	lastEdgeCheckScrollTop = -1;
	if (!smooth) {
		applyStageTransform(0);
		ensureTailWindowForBottom();
		await tick();
		if (!messageContainer) return;
		snapScrollToBottom();
		measureMountedRows();
		if (typeof window !== "undefined") {
			window.requestAnimationFrame(() => {
				if (isStickyAtBottom && messageContainer) {
					snapScrollToBottom();
				}
			});
		}
		return;
	}

	commitScrollDeviation();
	const seq = ++jumpSeq;
	showScrollBottomBtn = false;
	newMessagesWhileScrolled = 0;
	ensureTailWindowForBottom();
	await tick();
	if (seq !== jumpSeq || !messageContainer) return;
	measureMountedRows();

	const container = messageContainer;
	const maxStartGap = Math.max(800, container.clientHeight * 1.6);
	const preTarget = Math.max(
		0,
		container.scrollHeight - container.clientHeight - maxStartGap,
	);
	if (container.scrollTop < preTarget) {
		setScrollTopProgrammatically(preTarget);
	}
	const targetTop = Math.max(
		0,
		container.scrollHeight - container.clientHeight,
	);
	const completed = await smoothScrollContainerTo(
		container,
		targetTop,
		seq,
		true,
	);
	if (seq !== jumpSeq) return;
	if (completed) {
		snapScrollToBottom();
	}
}

let jumpSeq = 0;

function smoothScrollContainerTo(
	container: HTMLElement,
	targetTop: number,
	seq: number,
	trackBottom = false,
): Promise<boolean> {
	const startTop = container.scrollTop;
	const initialTarget = trackBottom
		? Math.max(0, container.scrollHeight - container.clientHeight)
		: targetTop;
	const delta = initialTarget - startTop;
	if (Math.abs(delta) <= 8) return Promise.resolve(true);

	const duration = Math.min(
		480,
		Math.max(240, Math.round(Math.abs(delta) * 0.22)),
	);
	isSmoothScrolling = true;
	return new Promise((resolve) => {
		const startTime = performance.now();
		const step = (now: number) => {
			if (seq !== jumpSeq) {
				isSmoothScrolling = false;
				resolve(false);
				return;
			}
			const elapsed = now - startTime;
			const progress = Math.min(1, elapsed / duration);
			const eased = 1 - (1 - progress) ** 3;
			const endTop = trackBottom
				? Math.max(0, container.scrollHeight - container.clientHeight)
				: targetTop;
			setScrollTopProgrammatically(startTop + (endTop - startTop) * eased);
			if (progress < 1) {
				requestAnimationFrame(step);
			} else {
				setScrollTopProgrammatically(endTop);
				isSmoothScrolling = false;
				resolve(true);
			}
		};
		requestAnimationFrame(step);
	});
}

function ensureTargetIndexInWindow(targetIdx: number) {
	if (!virtualEnabled || targetIdx < 0) return;
	const len = visibleMessages.length;
	if (targetIdx >= renderedWindow.start && targetIdx < renderedWindow.end) {
		return;
	}
	measureMountedRows();
	let nextStart = Math.max(0, targetIdx - WINDOW_HALF_COUNT);
	const nextEnd = Math.min(len, nextStart + WINDOW_TARGET_COUNT);
	if (nextEnd === len) {
		nextStart = Math.max(0, len - WINDOW_TARGET_COUNT);
	}
	windowStart = nextStart;
	windowEnd = nextEnd;
}

async function jumpToMessage(msgUid: string) {
	const seq = ++jumpSeq;
	clearScrollEndTimer();
	isActivelyScrolling = false;
	commitScrollDeviation();
	closeAllHeaderMenus();
	suppressStickyScrollUntil = Date.now() + 2500;
	isStickyAtBottom = false;
	const targetMsg = messages.find((m) => m.msgUid === msgUid);
	if (currentUser && targetMsg) {
		writeLastSeenAt(roomId, currentUser.userKey, targetMsg.createdAt);
	}
	unreadMentionUids = unreadMentionUids.filter((id) => id !== msgUid);
	if (alertBannerUid === msgUid) {
		alertBannerUid = null;
	}
	if (alertAutoHideTimer !== null) {
		window.clearTimeout(alertAutoHideTimer);
		alertAutoHideTimer = null;
	}
	highlightedMsgUid = "";
	if (highlightClearTimer !== null) {
		window.clearTimeout(highlightClearTimer);
		highlightClearTimer = null;
	}
	const targetIdx = visibleMessages.findIndex((m) => m.msgUid === msgUid);
	ensureTargetIndexInWindow(targetIdx);
	await tick();
	if (seq !== jumpSeq) return;
	measureMountedRows();
	const container = messageContainer;
	let el = container?.querySelector<HTMLElement>(
		`[data-msg-uid="${CSS.escape(msgUid)}"]`,
	);
	if (!el || !container) {
		return;
	}

	const cRect = container.getBoundingClientRect();
	const eRect = el.getBoundingClientRect();
	const rawTargetTop =
		container.scrollTop +
		(eRect.top + eRect.height / 2) -
		(cRect.top + cRect.height / 2);
	const maxScroll = Math.max(
		0,
		container.scrollHeight - container.clientHeight,
	);
	const targetTop = Math.max(0, Math.min(maxScroll, rawTargetTop));

	const maxGlide = Math.max(800, container.clientHeight * 1.6);
	if (Math.abs(targetTop - container.scrollTop) > maxGlide) {
		const dir = targetTop > container.scrollTop ? -1 : 1;
		setScrollTopProgrammatically(targetTop + dir * maxGlide);
	}

	const completed = await smoothScrollContainerTo(container, targetTop, seq);
	if (!completed || seq !== jumpSeq) return;

	// 二阶段真实 DOM 物理居中微调校准
	await tick();
	if (seq !== jumpSeq) return;
	el = container.querySelector<HTMLElement>(
		`[data-msg-uid="${CSS.escape(msgUid)}"]`,
	);
	if (el) {
		const fcRect = container.getBoundingClientRect();
		const feRect = el.getBoundingClientRect();
		const finalDiff =
			feRect.top + feRect.height / 2 - (fcRect.top + fcRect.height / 2);
		if (Math.abs(finalDiff) > 1.5) {
			setScrollTopProgrammatically(container.scrollTop + finalDiff);
		}
	}

	highlightedMsgUid = msgUid;
	highlightClearTimer = window.setTimeout(() => {
		if (seq === jumpSeq) {
			highlightedMsgUid = "";
		}
	}, 3800);
}

async function scrollToUnreadDivider() {
	const seq = ++jumpSeq;
	clearScrollEndTimer();
	isActivelyScrolling = false;
	commitScrollDeviation();
	suppressStickyScrollUntil = Date.now() + 900;
	isStickyAtBottom = false;
	hasVisitedUnreadDivider = true;
	unreadBarDismissed = true;
	if (firstUnreadMsgUid) {
		const idx = visibleMessages.findIndex(
			(m) => m.msgUid === firstUnreadMsgUid,
		);
		ensureTargetIndexInWindow(idx);
	}
	await tick();
	if (seq !== jumpSeq) return;
	measureMountedRows();
	const container = messageContainer;
	const dividerEl = container?.querySelector<HTMLElement>(
		"[data-unread-divider]",
	);
	if (dividerEl && container) {
		const cRect = container.getBoundingClientRect();
		const dRect = dividerEl.getBoundingClientRect();
		const rawTargetTop =
			container.scrollTop +
			(dRect.top + dRect.height / 2) -
			(cRect.top + cRect.height / 2);
		const maxScroll = Math.max(
			0,
			container.scrollHeight - container.clientHeight,
		);
		const targetTop = Math.max(0, Math.min(maxScroll, rawTargetTop));
		const maxGlide = Math.max(800, container.clientHeight * 1.6);
		if (Math.abs(targetTop - container.scrollTop) > maxGlide) {
			const dir = targetTop > container.scrollTop ? -1 : 1;
			setScrollTopProgrammatically(targetTop + dir * maxGlide);
		}
		await smoothScrollContainerTo(container, targetTop, seq);
		if (seq !== jumpSeq) return;
	} else if (container) {
		await smoothScrollContainerTo(container, 0, seq);
		if (seq !== jumpSeq) return;
	}
	highlightUnreadDivider = true;
	if (unreadHighlightTimer !== null) {
		window.clearTimeout(unreadHighlightTimer);
	}
	unreadHighlightTimer = window.setTimeout(() => {
		highlightUnreadDivider = false;
	}, 2200);
}

function handleJumpToUnread() {
	suppressStickyScrollUntil = Date.now() + 900;
	isStickyAtBottom = false;
	if (hasUnloadedUnread) {
		onLoadHistory?.(sessionUnreadSince, true);
		return;
	}
	void scrollToUnreadDivider();
}

function dismissUnreadBar() {
	unreadBarDismissed = true;
	markCurrentRoomReadIfReady(true);
}

function handleJumpToUnfocusedStart() {
	if (!unfocusedBanner?.firstUid) return;
	const uid = unfocusedBanner.firstUid;
	unfocusedBanner = null;
	void jumpToMessage(uid);
}

function triggerAutoLoadOlderHistory(manualClick = false) {
	if (!hasMoreHistory || isLoadingHistory || !messageContainer) return;
	clearScrollEndTimer();
	commitScrollDeviation();
	isStickyAtBottom = false;
	measureMountedRows();
	let anchorUid = visibleMessages[0]?.msgUid || messages[0]?.msgUid || "";
	let anchorOffsetInViewport: number | null = null;
	const cRect = messageContainer.getBoundingClientRect();
	const rowEls =
		messageContainer.querySelectorAll<HTMLElement>("[data-vrow-uid]");
	for (const el of rowEls) {
		const rect = el.getBoundingClientRect();
		if (rect.bottom > cRect.top) {
			anchorUid = el.dataset.vrowUid || anchorUid;
			anchorOffsetInViewport = rect.top - cRect.top;
			break;
		}
	}
	historyScrollAnchor = {
		anchorUid,
		anchorOffsetInViewport,
		prevScrollHeight: messageContainer.scrollHeight,
		prevScrollTop: messageContainer.scrollTop,
		manualClick,
	};
	onLoadHistory?.();
}

function dismissAlertBanner() {
	if (activeAlertMessage) {
		if (currentUser) {
			writeLastSeenAt(
				roomId,
				currentUser.userKey,
				activeAlertMessage.createdAt,
			);
		}
		unreadMentionUids = unreadMentionUids.filter(
			(id) => id !== activeAlertMessage.msgUid,
		);
	}
	alertBannerUid = null;
	if (alertAutoHideTimer !== null) {
		window.clearTimeout(alertAutoHideTimer);
		alertAutoHideTimer = null;
	}
}

function fitBalancedTopicWidth(node: HTMLElement, _dep?: unknown) {
	let rafId = 0;
	const measure = () => {
		cancelAnimationFrame(rafId);
		rafId = requestAnimationFrame(() => {
			node.style.width = "auto";
			const range = document.createRange();
			range.selectNodeContents(node);
			const rects = Array.from(range.getClientRects());
			if (rects.length > 1) {
				let maxW = 0;
				for (const r of rects) {
					if (r.width > maxW) maxW = r.width;
				}
				if (maxW > 0) {
					node.style.width = `${Math.ceil(maxW) + 2}px`;
				}
			}
		});
	};

	measure();

	const ro = new ResizeObserver(() => {
		measure();
	});
	if (node.parentElement?.parentElement) {
		ro.observe(node.parentElement.parentElement);
	}

	return {
		update(_nextDep?: unknown) {
			measure();
		},
		destroy() {
			cancelAnimationFrame(rafId);
			ro.disconnect();
		},
	};
}

function formatShortTime(ts: number): string {
	if (!ts) return "";
	const d = new Date(ts);
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function handleOpenNoticeUserProfile(
	name: string,
	userKey?: string,
	avatar?: string,
) {
	if (!onOpenUserProfile) return;
	const cleanName = (name || "").trim();
	onOpenUserProfile({
		userKey: userKey || "",
		name: cleanName || "成员",
		avatar: avatar || undefined,
		authType: userKey
			? userKey.startsWith("waline:")
				? "waline"
				: "guest"
			: undefined,
	});
}

function getSongExtraInfo(songTitle?: string) {
	if (!songTitle) return null;
	if (musicState?.current?.track?.title === songTitle) {
		return musicState.current.track;
	}
	const fromHistory = (musicState?.historyLogs ?? []).find(
		(h) => h.track?.title === songTitle,
	);
	return fromHistory?.track ?? null;
}

function resolveMusicNoticeAvatar(
	item: ChatMessageRecord,
	parsed: ParsedMusicNotice,
): string {
	if (item.avatar && typeof item.avatar === "string" && item.avatar.trim()) {
		return item.avatar.trim();
	}
	const actorName = (parsed.actorName || item.name || "").trim();
	if (!actorName) return "";

	// 1. 如果匹配到当前登录用户
	if (
		currentUser &&
		(currentUser.name === actorName ||
			(item.userKey && item.userKey === currentUser.userKey))
	) {
		if (currentUser.avatar) return currentUser.avatar;
	}

	// 2. 从服务器点歌流水 historyLogs 查找
	const fromHistory = (musicState?.historyLogs ?? []).find(
		(h) =>
			h.requesterName === actorName ||
			(item.userKey && h.requesterKey === item.userKey),
	);
	if (fromHistory?.requesterAvatar) {
		return fromHistory.requesterAvatar;
	}

	// 3. 从当前播放查找
	if (
		musicState?.current &&
		musicState.current.requesterName === actorName &&
		musicState.current.requesterAvatar
	) {
		return musicState.current.requesterAvatar;
	}

	// 4. 从成员名录 (mergedMentionCandidates / onlineMembers) 查找
	const fromCandidate = mergedMentionCandidates.find(
		(m) =>
			m.name === actorName ||
			(item.userKey && m.userKey === item.userKey),
	);
	if (fromCandidate?.avatar) {
		return fromCandidate.avatar;
	}

	// 5. 从历史聊天消息查找该发送者发言时的头像
	const fromRecentMsg = messages.find(
		(m) => m.name === actorName && m.avatar,
	);
	if (fromRecentMsg?.avatar) {
		return fromRecentMsg.avatar;
	}

	return "";
}


onMount(() => {
	imageQuality = loadChatImageQuality();
	setChatLightboxSourceProvider(collectChatImageSources);

	// 预热外部贴纸与动效 CDN 连接（DNS + TLS 提前握手，消除网络初次冷启动延迟）
	const stickerCdnDomains = [
		"https://rainzt.cn",
		"https://daily.yybb.us",
		"https://chat-server.lengxiqwq.com",
	];
	for (const domain of stickerCdnDomains) {
		const existing = document.querySelector(`link[rel="preconnect"][href="${domain}"]`);
		if (!existing) {
			const link = document.createElement("link");
			link.rel = "preconnect";
			link.href = domain;
			link.crossOrigin = "anonymous";
			document.head.appendChild(link);
		}
	}

	// 预热 Lottie 雪碧图与 Lottie 播放器库（空闲时后台静默加载）
	const spriteImg = new Image();
	spriteImg.src = LOTTIE_SPRITE_URL;
	const idleLottieTimer = window.setTimeout(() => {
		void ensureLottieLibrary();
	}, 1200);

	const updateImageConstraints = () => {
		if (!messageContentEl?.clientWidth) return;
		const style = getComputedStyle(messageContentEl);
		const bubbleWidth = messageContentEl.clientWidth *
			(parseFloat(style.getPropertyValue("--chat-message-bubble-max-width")) / 100);
		const padding = parseFloat(style.getPropertyValue("--chat-message-bubble-padding-x"));
		const maxImageWidth = Math.max(1, bubbleWidth - 2 * padding - 2);
		const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
		if (maxImageWidth === estimatedImageWidth && rem === rootFontSize) return;
		measuredMsgHeights.clear();
		estimatedImageWidth = maxImageWidth;
		rootFontSize = rem;
		measureMountedRows();
	};
	updateImageConstraints();
	void scrollToBottom();

	const followBottomAfterLayout = () => {
		updateImageConstraints();
		if (
			followsLayoutAtBottom &&
			!isUserTouching &&
			!isActivelyScrolling &&
			!isSmoothScrolling &&
			!isShiftingWindow
		) {
			snapScrollToBottom();
		}
	};

	const resizeObserver =
		typeof ResizeObserver !== "undefined"
			? new ResizeObserver(followBottomAfterLayout)
			: null;
	if (messageContainer) {
		resizeObserver?.observe(messageContainer);
	}
	if (messageContentEl) {
		resizeObserver?.observe(messageContentEl);
	}

	const handleImageResize = (event: Event) => {
		const { apply } = (event as CustomEvent<ChatImageResizeDetail>).detail;
		const row = (event.target as HTMLElement).closest<HTMLElement>("[data-vrow-uid]");
		if (!row?.dataset.vrowUid || !messageContainer) return;

		event.preventDefault();
		const container = messageContainer;
		// Window changes already capture their own anchor across the Svelte update.
		const anchor = virtualEnabled && !isShiftingWindow && !followsLayoutAtBottom
			? findVisibleViewportAnchor(renderedWindow.start, renderedWindow.end)
			: null;
		flushSync(apply);
		recordRowHeight(row.dataset.vrowUid, row.getBoundingClientRect().height);
		if (anchor) {
			const el = container.querySelector<HTMLElement>(
				`[data-vrow-uid="${CSS.escape(anchor.uid)}"]`,
			);
			if (el) {
				const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top
					+ container.scrollTop;
				compensateLayoutDrift(top - anchor.contentTop);
			}
		}
		followBottomAfterLayout();
	};
	messageContainer?.addEventListener("chat-image-resize", handleImageResize);

	const handleMediaLoad = (e: Event) => {
		const target = e.target as HTMLElement | null;
		if (target?.classList.contains("chat-msg-image")) return;
		if (target && (target.tagName === "IMG" || target.tagName === "VIDEO")) {
			const row = target.closest<HTMLElement>("[data-vrow-uid]");
			if (row?.dataset.vrowUid) {
				const h = row.getBoundingClientRect().height;
				if (h > 0) recordRowHeight(row.dataset.vrowUid, h);
			}
			followBottomAfterLayout();
		}
	};
	messageContainer?.addEventListener("load", handleMediaLoad, true);

	const handleContainerPointerDown = () => {
		cancelProgrammaticScroll();
	};

	const handleContainerWheel = (e: WheelEvent) => {
		cancelProgrammaticScroll();
		if (e.deltaY < 0) {
			detachFromBottom();
		}
	};

	const handleContainerTouchStart = (e: TouchEvent) => {
		cancelProgrammaticScroll();
		if (e.touches.length === 1) {
			isUserTouching = true;
			touchDraggedUp = false;
			touchMinY = e.touches[0].clientY;
		}
	};

	const handleContainerTouchMove = (e: TouchEvent) => {
		if (!isUserTouching || e.touches.length !== 1) return;
		const curY = e.touches[0].clientY;
		if (curY < touchMinY) {
			touchMinY = curY;
		}
		if (curY - touchMinY > 6) {
			touchDraggedUp = true;
			detachFromBottom();
		}
	};

	const handleContainerTouchEnd = () => {
		isUserTouching = false;
		touchDraggedUp = false;
		scheduleScrollSettled();
	};

	const handleContainerScrollEnd = () => {
		if (!isUserTouching && !isSmoothScrolling && !isShiftingWindow) {
			handleScrollSettled();
		}
	};

	messageContainer?.addEventListener(
		"pointerdown",
		handleContainerPointerDown,
		{
			passive: true,
		},
	);
	messageContainer?.addEventListener("wheel", handleContainerWheel, {
		passive: true,
	});
	messageContainer?.addEventListener("touchstart", handleContainerTouchStart, {
		passive: true,
	});
	messageContainer?.addEventListener("touchmove", handleContainerTouchMove, {
		passive: true,
	});
	messageContainer?.addEventListener("touchend", handleContainerTouchEnd, {
		passive: true,
	});
	messageContainer?.addEventListener("touchcancel", handleContainerTouchEnd, {
		passive: true,
	});
	messageContainer?.addEventListener("scrollend", handleContainerScrollEnd, {
		passive: true,
	});

	const handlePointerDown = (e: PointerEvent) => {
		const target = e.target as HTMLElement | null;
		if (!target) return;
		if (!dockEl?.contains(target)) {
			activePopover = "none";
			mentionMenuOpen = false;
		}

		const insideMore = mobileMoreMenuWrapEl?.contains(target);
		const insideMention = mentionHistoryWrapEl?.contains(target);
		const insideThread = threadListWrapEl?.contains(target);
		const insideMusicNotice =
			ENABLE_HEADER_MUSIC_NOTICES && musicNoticeWrapEl?.contains(target);

		// 仅当点击真正发生在所有顶栏菜单及触发器外部时，才在 pointerdown 阶段关闭。
		// 如果点击命中任何一个顶栏菜单包装容器（包含其触发按钮），交给按钮自身的点击事件原子切换，
		// 避免移动端触屏在 pointerdown 阶段提前销毁 DOM 打断后续 click 事件导致必须按两次或切换冲突。
		if (!insideMore && !insideMention && !insideThread && !insideMusicNotice) {
			closeAllHeaderMenus();
		}
	};

	const handleDocKeydown = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			if (
				e.target instanceof Node &&
				mobileMoreMenuWrapEl?.contains(e.target)
			) {
				mobileMoreTrigger?.focus({ preventScroll: true });
			}
			closeAllHeaderMenus();
			closeMobileActions();
		}
	};

	const preventWindowDrag = (e: DragEvent) => {
		if (e.dataTransfer?.types?.includes("Files")) {
			e.preventDefault();
		}
	};

	window.addEventListener("dragover", preventWindowDrag);
	window.addEventListener("drop", preventWindowDrag);
	document.addEventListener("pointerdown", handlePointerDown);
	document.addEventListener("keydown", handleDocKeydown);
	return () => {
		window.clearTimeout(idleLottieTimer);
		window.removeEventListener("dragover", preventWindowDrag);
		window.removeEventListener("drop", preventWindowDrag);
		resizeObserver?.disconnect();
		messageContainer?.removeEventListener("load", handleMediaLoad, true);
		messageContainer?.removeEventListener("chat-image-resize", handleImageResize);
		messageContainer?.removeEventListener(
			"pointerdown",
			handleContainerPointerDown,
		);
		messageContainer?.removeEventListener("wheel", handleContainerWheel);
		messageContainer?.removeEventListener(
			"touchstart",
			handleContainerTouchStart,
		);
		messageContainer?.removeEventListener(
			"touchmove",
			handleContainerTouchMove,
		);
		messageContainer?.removeEventListener("touchend", handleContainerTouchEnd);
		messageContainer?.removeEventListener(
			"touchcancel",
			handleContainerTouchEnd,
		);
		messageContainer?.removeEventListener(
			"scrollend",
			handleContainerScrollEnd,
		);
		document.removeEventListener("pointerdown", handlePointerDown);
		document.removeEventListener("keydown", handleDocKeydown);
		clearScrollEndTimer();
		clearReadSettleTimer();
		if (alertAutoHideTimer !== null) window.clearTimeout(alertAutoHideTimer);
		if (highlightClearTimer !== null) window.clearTimeout(highlightClearTimer);
		if (unreadHighlightTimer !== null)
			window.clearTimeout(unreadHighlightTimer);
		setChatLightboxSourceProvider(null);
	};
});

$effect(() => {
	const currentRoomId = roomId;
	const msgs = messages;
	const visMsgs = visibleMessages;
	const visLen = visMsgs.length;
	const userKey = currentUser?.userKey || "";
	const initSeq = roomInitSeq;
	const ready = roomReady;

	if (initializedRoom !== currentRoomId) {
		initializedRoom = currentRoomId;
		hydratedRoomKey = "";
		hasInitialBottomScrolledForRoom = false;
		lastWrittenSeenMsgKey = "";
		seenMessageUids = new Set();
		measuredMsgHeights.clear();
		clearScrollEndTimer();
		clearReadSettleTimer();
		isActivelyScrolling = false;
		lastEdgeCheckScrollTop = -1;
		applyStageTransform(0);
		virtualEnabled = false;
		windowStart = 0;
		windowEnd = visLen;
		prevVisibleCount = visLen;
		historyScrollAnchor = null;
		prevObservedScrollTop = 0;
		lastScrollHeight = 0;
		lastClientHeight = 0;
		isStickyAtBottom = true;
		unreadMentionUids = [];
		alertBannerUid = null;
		replyingTo = null;
		sourceModalMessage = null;
		activeThreadRootUid = "";
		activeThreadInitialRoot = null;
		showThreadListMenu = false;
		unreadBarDismissed = false;
		isUnreadDividerInView = false;
		hasVisitedUnreadDivider = false;
		highlightUnreadDivider = false;
		showScrollBottomBtn = false;
		newMessagesWhileScrolled = 0;
		maxKnownCreatedAt = 0;
		unfocusedArrivalUids = [];
		unfocusedBanner = null;
		if (!targetMessageUid) {
			void scrollToBottom();
		}
	}

	if (!ready) {
		return;
	}

	const roomHydrationTag = `${currentRoomId}:${userKey}:${initSeq}`;
	if (msgs.length > 0 && hydratedRoomKey !== roomHydrationTag) {
		hydratedRoomKey = roomHydrationTag;
		const isFirstHydration = !hasInitialBottomScrolledForRoom;
		hasInitialBottomScrolledForRoom = true;
		lastWrittenSeenMsgKey = "";
		unreadBarDismissed = false;
		isUnreadDividerInView = false;
		hasVisitedUnreadDivider = false;
		seenMessageUids = new Set(msgs.map((m) => m.msgUid));
		maxKnownCreatedAt = msgs.reduce((max, m) => Math.max(max, m.createdAt), 0);
		const latestCreatedAt = maxKnownCreatedAt;

		if (visLen > VIRTUAL_ENABLE_THRESHOLD) {
			virtualEnabled = true;
			const targetIdx = targetMessageUid
				? visMsgs.findIndex((m) => m.msgUid === targetMessageUid)
				: -1;
			if (targetIdx >= 0) {
				let nextStart = Math.max(0, targetIdx - WINDOW_HALF_COUNT);
				const nextEnd = Math.min(visLen, nextStart + WINDOW_TARGET_COUNT);
				if (nextEnd === visLen) {
					nextStart = Math.max(0, visLen - WINDOW_TARGET_COUNT);
				}
				windowStart = nextStart;
				windowEnd = nextEnd;
			} else if (isFirstHydration || isStickyAtBottom) {
				windowEnd = visLen;
				windowStart = Math.max(0, visLen - WINDOW_TARGET_COUNT);
			} else {
				windowEnd = Math.min(windowEnd, visLen);
				windowStart = Math.min(windowStart, windowEnd);
			}
		} else {
			virtualEnabled = false;
			windowStart = 0;
			windowEnd = visLen;
		}
		prevVisibleCount = visLen;

		if (userKey) {
			const savedLastSeen = readLastSeenAt(currentRoomId, userKey);
			// 优先采用服务端已读与本地已读的较新时间戳
			const baselineSeen = Math.max(sessionUnreadSince, savedLastSeen);
			if (baselineSeen > 0) {
				// 仅当离线期间确实有未读且有人 @自己 或 回复自己 时，才在初次进入时弹出横幅
				const missedMentions = msgs.filter(
					(m) =>
						isDirectToMe(m) &&
						m.createdAt > baselineSeen &&
						m.msgUid !== targetMessageUid,
				);
				if (missedMentions.length > 0) {
					unreadMentionUids = missedMentions.map((m) => m.msgUid);
					alertBannerUid = missedMentions[missedMentions.length - 1].msgUid;
				} else {
					unreadMentionUids = [];
					alertBannerUid = null;
				}
			} else if (
				latestCreatedAt > 0 &&
				isChatPaneFocused() &&
				isStickyAtBottom
			) {
				writeLastSeenAt(currentRoomId, userKey, latestCreatedAt);
			}
		}

		// 仅首次进入房间，或同房间静默重连时用户原本就在底部，才滚动到底部；
		// 避免手机切后台重连时把正在翻看历史消息的用户突然拉回底部。
		if (!targetMessageUid && (isFirstHydration || isStickyAtBottom)) {
			void scrollToBottom();
		}
	} else if (hydratedRoomKey === roomHydrationTag) {
		// 严密区分：历史向上插入批次 vs 底部实时推送的新消息
		const olderBatch: ChatMessageRecord[] = [];
		const liveIncoming: ChatMessageRecord[] = [];

		for (const m of msgs) {
			if (!seenMessageUids.has(m.msgUid)) {
				seenMessageUids.add(m.msgUid);
				if (m.createdAt >= maxKnownCreatedAt) {
					liveIncoming.push(m);
				} else {
					olderBatch.push(m);
				}
			}
		}

		// 1. 向上翻看历史加载出的消息批次：
		// 使用可见消息锚点精确还原视口位置，同时在消息量超过阈值时无缝维持有界窗口
		if (olderBatch.length > 0) {
			if (historyScrollAnchor && messageContainer) {
				const anchor = historyScrollAnchor;
				historyScrollAnchor = null;
				measureMountedRows();
				const anchorIdx = anchor.anchorUid
					? visMsgs.findIndex((m) => m.msgUid === anchor.anchorUid)
					: -1;
				if (visLen > VIRTUAL_ENABLE_THRESHOLD || virtualEnabled) {
					virtualEnabled = true;
					if (anchorIdx >= 0) {
						const nextStart = Math.max(0, anchorIdx - WINDOW_HALF_COUNT);
						const nextEnd = Math.min(
							visLen,
							Math.max(
								anchorIdx + WINDOW_HALF_COUNT,
								nextStart + WINDOW_TARGET_COUNT,
							),
						);
						windowStart = nextStart;
						windowEnd = nextEnd;
					} else {
						windowStart = 0;
						windowEnd = Math.min(visLen, WINDOW_TARGET_COUNT);
					}
				} else {
					windowStart = 0;
					windowEnd = visLen;
				}
				void tick().then(() => {
					if (!messageContainer) return;
					measureMountedRows();
					const anchorEl = anchor.anchorUid
						? messageContainer.querySelector<HTMLElement>(
								`[data-vrow-uid="${CSS.escape(anchor.anchorUid)}"]`,
							)
						: null;
					if (anchorEl && anchor.anchorOffsetInViewport !== null) {
						const cRect = messageContainer.getBoundingClientRect();
						const nextOffset = anchorEl.getBoundingClientRect().top - cRect.top;
						let drift = nextOffset - anchor.anchorOffsetInViewport;
						if (isActivelyScrolling || isUserTouching) {
							// Compare content coordinates so movement since the request stays intact.
							compensateLayoutDrift(
								drift + messageContainer.scrollTop - anchor.prevScrollTop - scrollDeviation,
							);
							return;
						}
						if (
							anchor.manualClick &&
							anchor.prevScrollTop <= 40 &&
							drift > 120
						) {
							drift -= 120;
						}
						if (Math.abs(drift) > 0.5) {
							setScrollTopProgrammatically(messageContainer.scrollTop + drift);
						} else {
							const maxScroll = Math.max(
								0,
								messageContainer.scrollHeight - messageContainer.clientHeight,
							);
							prevObservedScrollTop = Math.min(
								maxScroll,
								Math.max(0, messageContainer.scrollTop),
							);
							lastScrollHeight = messageContainer.scrollHeight;
							lastClientHeight = messageContainer.clientHeight;
						}
					} else {
						const newScrollHeight = messageContainer.scrollHeight;
						const delta = newScrollHeight - anchor.prevScrollHeight;
						if (isActivelyScrolling || isUserTouching) {
							compensateLayoutDrift(delta);
							return;
						}
						const targetTop =
							anchor.manualClick && anchor.prevScrollTop <= 40 && delta > 120
								? Math.max(0, anchor.prevScrollTop + delta - 120)
								: anchor.prevScrollTop + delta;
						setScrollTopProgrammatically(targetTop);
					}
				});
			} else if (visLen > VIRTUAL_ENABLE_THRESHOLD || virtualEnabled) {
				virtualEnabled = true;
				const delta = Math.max(0, visLen - prevVisibleCount);
				windowStart = Math.min(visLen, windowStart + delta);
				windowEnd = Math.min(visLen, windowEnd + delta);
			} else {
				windowStart = 0;
				windowEnd = visLen;
			}
			prevVisibleCount = visLen;
		} else if (!isLoadingHistory && historyScrollAnchor) {
			historyScrollAnchor = null;
		}

		// 2. 真正的新到达消息（底部实时推送）：
		if (liveIncoming.length > 0) {
			const canAutoReadLive =
				isChatPaneFocused() && isStickyAtBottom && !hasUnreadBlockingAutoRead();
			for (const m of liveIncoming) {
				if (m.createdAt > maxKnownCreatedAt) {
					maxKnownCreatedAt = m.createdAt;
				}
				if (isDirectToMe(m)) {
					if (!canAutoReadLive) {
						unreadMentionUids = [...unreadMentionUids, m.msgUid];
						alertBannerUid = m.msgUid;
					}
				}
			}

			if (canAutoReadLive) {
				markCurrentRoomReadIfReady();
			}

			if (!virtualEnabled && visLen > VIRTUAL_ENABLE_THRESHOLD) {
				if (isStickyAtBottom) {
					measureMountedRows();
					virtualEnabled = true;
					windowEnd = visLen;
					windowStart = Math.max(0, visLen - WINDOW_TARGET_COUNT);
				} else {
					const target = computeTargetWindowAroundViewport();
					if (target) {
						void shiftWindowWithAnchor(target.start, target.end, true);
					}
				}
			} else if (virtualEnabled) {
				if (isStickyAtBottom) {
					windowEnd = visLen;
					if (windowEnd - windowStart > WINDOW_MAX_COUNT) {
						measureMountedRows();
						windowStart = Math.max(0, windowEnd - WINDOW_TARGET_COUNT);
					}
				} else if (windowEnd >= prevVisibleCount - 2) {
					windowEnd = visLen;
				}
			} else {
				windowStart = 0;
				windowEnd = visLen;
			}
			prevVisibleCount = visLen;

			const visibleIncomingCount = liveIncoming.filter(
				(m) => !isMusicNoticeMessage(m),
			).length;
			if (visibleIncomingCount > 0) {
				const currentGap = getScrollGap();
				const wasAtBottom =
					isStickyAtBottom || currentGap <= BOTTOM_REENGAGE_GAP_PX;
				if (wasAtBottom && !isUserTouching && !targetMessageUid) {
					isStickyAtBottom = true;
					showScrollBottomBtn = false;
					newMessagesWhileScrolled = 0;
					void scrollToBottom();
					if (!isChatPaneFocused()) {
						for (const m of liveIncoming) {
							if (!isMusicNoticeMessage(m)) {
								unfocusedArrivalUids.push(m.msgUid);
							}
						}
					}
				} else {
					// 用户在上方翻看历史消息：整体不用动，保留新消息提示
					newMessagesWhileScrolled += visibleIncomingCount;
					showScrollBottomBtn = true;
				}
			}
		} else if (olderBatch.length === 0 && visLen !== prevVisibleCount) {
			// 处理显示/隐藏点歌通知或删除消息导致的可见条数变化
			if (virtualEnabled && visLen <= VIRTUAL_DISABLE_THRESHOLD) {
				virtualEnabled = false;
				windowStart = 0;
				windowEnd = visLen;
			} else if (!virtualEnabled && visLen > VIRTUAL_ENABLE_THRESHOLD) {
				if (isStickyAtBottom) {
					measureMountedRows();
					virtualEnabled = true;
					windowEnd = visLen;
					windowStart = Math.max(0, visLen - WINDOW_TARGET_COUNT);
				} else {
					const target = computeTargetWindowAroundViewport();
					if (target) {
						void shiftWindowWithAnchor(target.start, target.end, true);
					}
				}
			} else if (virtualEnabled) {
				if (isStickyAtBottom) {
					windowEnd = visLen;
					windowStart = Math.max(0, visLen - WINDOW_TARGET_COUNT);
				} else {
					windowEnd = Math.min(windowEnd, visLen);
					windowStart = Math.min(windowStart, windowEnd);
				}
			} else {
				windowStart = 0;
				windowEnd = visLen;
			}
			prevVisibleCount = visLen;
		}
	}

	if (replyingTo && !msgs.some((m) => m.msgUid === replyingTo?.msgUid)) {
		replyingTo = null;
	}
	if (
		mobileActionTarget &&
		!msgs.some((m) => m.msgUid === mobileActionTarget?.message.msgUid)
	) {
		closeMobileActions();
	}
});

$effect(() => {
	const focused = isChatPaneFocused();
	if (!focused) {
		paneFocusedSince = 0;
		clearReadSettleTimer();
		return;
	}
	if (paneFocusedSince <= 0) {
		paneFocusedSince = Date.now();
	}
	if (unfocusedArrivalUids.length > 0) {
		const uids = [...unfocusedArrivalUids];
		unfocusedArrivalUids = [];
		const firstUid = uids[0];
		void tick().then(() => {
			if (!messageContainer || !isStickyAtBottom) return;
			const el = messageContainer.querySelector<HTMLElement>(
				`[data-msg-uid="${CSS.escape(firstUid)}"]`,
			);
			const cRect = messageContainer.getBoundingClientRect();
			const isOffscreenAbove =
				!el || el.getBoundingClientRect().bottom < cRect.top + 20;
			if (isOffscreenAbove) {
				unfocusedBanner = {
					firstUid,
					count: uids.length,
				};
			} else {
				unfocusedBanner = null;
			}
		});
	}
	void visibleMessages;
	void messages;
	void isUnreadDividerInView;
	void hasVisitedUnreadDivider;
	void unreadBarDismissed;
	void isStickyAtBottom;
	markCurrentRoomReadIfReady();
});

$effect(() => {
	const el = topSentinelEl;
	const container = messageContainer;
	if (
		!el ||
		!container ||
		!hasMoreHistory ||
		typeof IntersectionObserver === "undefined"
	) {
		return;
	}
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					maybeTriggerAutoLoadOlderHistory(false);
				}
			}
		},
		{ root: container, rootMargin: "200px 0px 0px 0px" },
	);
	observer.observe(el);
	return () => observer.disconnect();
});

$effect(() => {
	const userKey = currentUser?.userKey || "";
	const isAdmin = Boolean(currentUser?.isAdmin);
	const offset = clockOffsetMs;
	const serverNow = nowMs + offset;
	if (!userKey || isAdmin) return;

	let earliestExpireLocal = Number.POSITIVE_INFINITY;
	for (const m of renderedMessages) {
		if (m.kind !== "user" || m.userKey !== userKey) continue;
		const expireServer = m.createdAt + RECALL_WINDOW_MS;
		if (expireServer > serverNow) {
			const expireLocal = expireServer - offset;
			if (expireLocal < earliestExpireLocal) {
				earliestExpireLocal = expireLocal;
			}
		}
	}

	if (!Number.isFinite(earliestExpireLocal)) return;
	const waitMs = Math.min(
		60_000,
		Math.max(50, earliestExpireLocal - Date.now() + 30),
	);
	const timer = window.setTimeout(() => {
		nowMs = Date.now();
	}, waitMs);
	return () => window.clearTimeout(timer);
});

$effect(() => {
	if (unreadJumpSeq > 0 && unreadJumpSeq !== lastUnreadJumpSeq) {
		lastUnreadJumpSeq = unreadJumpSeq;
		void scrollToUnreadDivider();
	}
});

$effect(() => {
	const container = messageContainer;
	const markerUid = firstUnreadMsgUid;
	void renderedMessages;
	if (
		!container ||
		!markerUid ||
		hasUnloadedUnread ||
		typeof IntersectionObserver === "undefined"
	) {
		isUnreadDividerInView = false;
		return;
	}
	const dividerEl = container.querySelector<HTMLElement>(
		"[data-unread-divider]",
	);
	if (!dividerEl) {
		isUnreadDividerInView = false;
		return;
	}
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					isUnreadDividerInView = true;
					hasVisitedUnreadDivider = true;
					observer.disconnect();
				}
			}
		},
		{ root: container, threshold: 0.25 },
	);
	observer.observe(dividerEl);
	return () => observer.disconnect();
});

$effect(() => {
	const deepTarget = targetMessageUid;
	if (!deepTarget) {
		isLocatingTargetMessage = false;
		return;
	}

	// 只要存在定位目标，锁定粘底逻辑，防止任何异步重排将视口扯回最底部
	isStickyAtBottom = false;
	suppressStickyScrollUntil = Date.now() + 2500;

	const found = messages.some((m) => m.msgUid === deepTarget);
	if (found) {
		isLocatingTargetMessage = false;
		targetMessageNotFound = false;
		if (!isJumpingToTarget) {
			isJumpingToTarget = true;
			void tick().then(async () => {
				await jumpToMessage(deepTarget);
				isJumpingToTarget = false;
				onClearTargetMessage?.();
			});
		}
		return;
	}

	// 目标尚未在当前列表中：若房间已就绪且还有更早历史，自动追溯拉取更早批次历史
	if (roomReady && messages.length > 0) {
		if (hasMoreHistory) {
			isLocatingTargetMessage = true;
			targetMessageNotFound = false;
			if (!isLoadingHistory) {
				onLoadHistory?.();
			}
		} else if (!isLoadingHistory) {
			// 已全部加载完毕仍未找到：说明该消息已被撤回或物理删除
			isLocatingTargetMessage = false;
			targetMessageNotFound = true;
			onClearTargetMessage?.();
		}
	}
});

$effect(() => {
	const container = messageContainer;
	const pending = unreadMentionUids;
	void renderedMessages;
	if (
		!container ||
		pending.length === 0 ||
		typeof IntersectionObserver === "undefined"
	) {
		return;
	}
	const observer = new IntersectionObserver(
		(entries) => {
			const viewed: string[] = [];
			for (const entry of entries) {
				if (entry.isIntersecting) {
					const uid = (entry.target as HTMLElement).dataset.msgUid;
					if (uid) viewed.push(uid);
				}
			}
			if (viewed.length > 0) {
				const viewedSet = new Set(viewed);
				unreadMentionUids = unreadMentionUids.filter(
					(id) => !viewedSet.has(id),
				);
				if (alertBannerUid && viewedSet.has(alertBannerUid)) {
					alertBannerUid = null;
				}
			}
		},
		{ root: container, threshold: 0.5 },
	);

	for (const uid of pending) {
		const el = container.querySelector<HTMLElement>(
			`[data-msg-uid="${CSS.escape(uid)}"]`,
		);
		if (el) observer.observe(el);
	}

	return () => observer.disconnect();
});

let mentionSavedRange: Range | null = null;

function focusInput(toEnd = true): void {
	if (!inputEl) return;
	inputEl.focus();
	if (toEnd) {
		const sel = window.getSelection();
		if (sel) {
			const range = document.createRange();
			range.selectNodeContents(inputEl);
			range.collapse(false);
			sel.removeAllRanges();
			sel.addRange(range);
		}
	}
}

function placeCaretAfter(node: Node): void {
	const sel = window.getSelection();
	if (!sel) return;
	const range = document.createRange();
	range.setStartAfter(node);
	range.collapse(true);
	sel.removeAllRanges();
	sel.addRange(range);
}

function getDraftStorageKey(rId: string): string {
	return `chat_input_draft:${rId || "chat"}`;
}

function saveRoomDraft(rId: string, draft: ChatDraft): void {
	if (typeof window === "undefined" || !rId || editingMessage) return;
	const key = getDraftStorageKey(rId);
	if (!draft.content.trim()) {
		try {
			localStorage.removeItem(key);
		} catch {}
	} else {
		try {
			localStorage.setItem(key, JSON.stringify({ version: 2, ...draft }));
		} catch {}
	}
}

function loadRoomDraft(rId: string): void {
	if (typeof window === "undefined" || !rId) return;
	try {
		const saved = localStorage.getItem(getDraftStorageKey(rId));
		if (saved?.trim()) {
			let draft: ChatDraft = { content: saved, mentionEntities: [] };
			try {
				const parsed = JSON.parse(saved);
				if (parsed?.version === 2 && typeof parsed.content === "string" && Array.isArray(parsed.mentionEntities)) {
					draft = parsed;
				}
			} catch {}
			setInputDraft(draft, false);
		} else if (inputEl && !editingMessage) {
			clearInput();
		}
	} catch {}
}

function clearRoomDraft(rId: string): void {
	if (typeof window === "undefined" || !rId) return;
	try {
		localStorage.removeItem(getDraftStorageKey(rId));
	} catch {}
}

function syncInputState(): void {
	if (!inputEl) return;
	const draft = readChatComposer(inputEl);
	inputText = draft.content;
	inputMentionEntities = draft.mentionEntities;
	const hasPills = inputEl.querySelector(".chat-mention-pill") !== null;
	const isEffectivelyEmpty = !inputText.trim() && !hasPills;
	if (isEffectivelyEmpty) {
		inputEl.dataset.empty = "true";
		if (
			inputEl.innerHTML === "<br>" ||
			inputEl.innerHTML === "<div><br></div>" ||
			inputEl.innerHTML === "<p><br></p>"
		) {
			inputEl.innerHTML = "";
		}
		if (typingTimer) clearTimeout(typingTimer);
		onTyping?.(false);
		lastTypingSentAt = 0;
	} else {
		delete inputEl.dataset.empty;
		triggerTyping();
	}
	saveRoomDraft(roomId, draft);
	syncMentionTrigger();
}

function insertAtCursor(snippet: string): void {
	if (!inputEl) {
		inputText += snippet;
		return;
	}
	focusInput(false);
	const sel = window.getSelection();
	if (sel && sel.rangeCount > 0 && inputEl.contains(sel.anchorNode)) {
		const range = sel.getRangeAt(0);
		range.deleteContents();
		const node = document.createTextNode(snippet);
		range.insertNode(node);
		placeCaretAfter(node);
	} else {
		const node = document.createTextNode(snippet);
		inputEl.appendChild(node);
		placeCaretAfter(node);
	}
	syncInputState();
}

function insertNewlineAtCursor(): void {
	if (!inputEl) return;
	focusInput(false);

	// 优先使用浏览器的原生换行命令，由排版引擎自动处理光标在末尾的换行渲染与折叠
	if (document.execCommand("insertLineBreak")) {
		syncInputState();
		return;
	}

	// 降级：如果 execCommand 失败，则通过 Range 插入
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0 || !inputEl.contains(sel.anchorNode)) return;
	const range = sel.getRangeAt(0);
	range.deleteContents();

	const br = document.createElement("br");
	range.insertNode(br);

	// 关键防护：如果插入的 br 是容器末尾，HTML 规范会将孤立 br 折叠导致看不到换行
	// 必须补充一个 trailing dummy br，并将光标定位于首个 br 之后
	let next = br.nextSibling;
	while (next && next.nodeType === Node.TEXT_NODE && next.nodeValue === "") {
		next = next.nextSibling;
	}
	if (!next) {
		const dummy = document.createElement("br");
		br.after(dummy);
	}

	const rangeAfter = document.createRange();
	rangeAfter.setStartAfter(br);
	rangeAfter.collapse(true);
	sel.removeAllRanges();
	sel.addRange(rangeAfter);
	syncInputState();
}

function formatCandidateMentionName(candidate: {
	name: string;
	userKey?: string;
	badge?: string;
	site?: string;
	siteUrl?: string;
	url?: string;
}): string {
	if (candidate.userKey === "room") return "全体成员";
	const rawName = (candidate.name || "").trim();
	const hasDot =
		rawName.includes("·") || rawName.includes("•") || rawName.includes("・");
	if (hasDot) {
		return normalizeDotSpacing(rawName);
	}
	if (isInterconnectRoom) {
		const isExt = isExternalMatrixIdentity(candidate);
		if (isExt) {
			const extOrigin = resolveExternalOrigin(candidate, interconnectSites);
			if (extOrigin?.cleanName && extOrigin.siteName) {
				return `${extOrigin.cleanName} · ${extOrigin.siteName}`;
			}
		} else {
			const suffix = ` · ${localSiteName}`;
			return rawName.endsWith(suffix) ? rawName : rawName + suffix;
		}
	}
	return normalizeDotSpacing(rawName);
}

$effect(() => {
	if (mentionEvent && mentionEvent.seq !== lastMentionSeq) {
		lastMentionSeq = mentionEvent.seq;
		const userKey = mentionEvent.userKey;
		if (!inputEl || !userKey) return;
		const candidate = mergedMentionCandidates.find((member) => member.userKey === userKey);
		const label = formatCandidateMentionName(candidate ?? { name: mentionEvent.name, userKey });
		insertChatMention(inputEl, label, userKey);
		syncInputState();
	}
});

let lastDraftRoomId = "";
$effect(() => {
	const currentRId = roomId;
	const el = inputEl;
	if (el && currentRId !== lastDraftRoomId) {
		lastDraftRoomId = currentRId;
		if (!editingMessage) {
			loadRoomDraft(currentRId);
		}
	}
});

function syncMentionTrigger(): void {
	const match = getChatMentionQuery(inputEl);
	mentionSavedRange = match?.range ?? null;
	mentionMenuOpen = Boolean(match && mergedMentionCandidates.length);
	mentionQuery = match?.query ?? "";
	mentionActiveIndex = -1;
	if (mentionMenuOpen) activePopover = "none";
}

function selectMentionCandidate(candidate: ChatMentionCandidate): void {
	if (!inputEl || !mentionSavedRange) return;
	insertChatMention(inputEl, formatCandidateMentionName(candidate), candidate.userKey, mentionSavedRange);
	syncInputState();
}

function setInputDraft(draft: ChatDraft, shouldFocus = true): void {
	if (!inputEl) return;
	writeChatComposer(inputEl, draft);
	syncInputState();
	if (shouldFocus) focusInput(true);
}

function clearInput(): void {
	inputText = "";
	inputMentionEntities = [];
	if (inputEl) {
		inputEl.replaceChildren();
		inputEl.dataset.empty = "true";
	}
	mentionSavedRange = null;
	mentionMenuOpen = false;
	mentionQuery = "";
}

function handleStartReply(msg: ChatMessageRecord) {
	if (!currentUser) {
		onRequireAuth();
		return;
	}
	replyingTo = msg;
	void tick().then(() => {
		focusInput(false);
	});
}

function handleStartEdit(msg: ChatMessageRecord) {
	editingMessage = msg;
	setInputDraft({ content: msg.content, mentionEntities: msg.mentionEntities ?? [] });
	focusInput(true);
}

function handleJumpToReply(msgUid: string) {
	if (messages.some((m) => m.msgUid === msgUid)) {
		void jumpToMessage(msgUid);
		return;
	}
	onNotify?.("原消息较早或已撤回");
}

let lastTypingSentAt = 0;
function triggerTyping() {
	if (onTyping) {
		const now = Date.now();
		if (now - lastTypingSentAt > 2500) {
			lastTypingSentAt = now;
			onTyping(true);
		}
		if (typingTimer) clearTimeout(typingTimer);
		typingTimer = setTimeout(() => {
			onTyping?.(false);
			lastTypingSentAt = 0;
		}, 4500);
	}
}

async function handleSend() {
	if (isSendingAttachments) return;
	const { content: trimmed, mentionEntities } = trimChatDraft({ content: inputText, mentionEntities: inputMentionEntities });
	if (!trimmed && pendingImages.length === 0) return;
	if (!currentUser) {
		onRequireAuth();
		return;
	}

	if (typingTimer) clearTimeout(typingTimer);
	onTyping?.(false);
	lastTypingSentAt = 0;

	if (editingMessage) {
		onEditMessage?.(editingMessage.msgUid, trimmed, mentionEntities);
		editingMessage = null;
		clearInput();
		loadRoomDraft(roomId);
		pendingImages = [];
		pendingImageSources = new Map();
		uploadNote = "";
		replyingTo = null;
		return;
	}

	let attachments = pendingImages;
	// 压缩版在选图时就传好了；只有勾了「原图发送」才在发送这一刻补传原图
	if (
		imageQuality === "original" &&
		pendingImages.some((att) => att.type === "image" && pendingImageSources.has(att.url))
	) {
		isSendingAttachments = true;
		uploadError = "";
		uploadNote = "正在上传原图…";
		try {
			attachments = await uploadPendingOriginals();
		} catch (err) {
			uploadError = err instanceof Error ? err.message : "原图上传失败";
			uploadNote = describePendingImages();
			return;
		} finally {
			isSendingAttachments = false;
		}
	}

	const replyToUid = replyingTo?.msgUid || "";
	onSendMessage(trimmed, attachments, mentionEntities, replyToUid || undefined);
	clearInput();
	clearRoomDraft(roomId);
	pendingImages = [];
	pendingImageSources = new Map();
	isPreviewingMarkdown = false;
	replyingTo = null;
	uploadError = "";
	uploadNote = "";
	// 画质是「这一批附件」的选择，发完回到默认的压缩
	imageQuality = "compressed";
	saveChatImageQuality(imageQuality);
	activePopover = "none";
	unreadBarDismissed = true;
	unfocusedBanner = null;
	unfocusedArrivalUids = [];
	isStickyAtBottom = true;
	void scrollToBottom();
}

function handleShareBlogContent(payload: string) {
	if (!currentUser) {
		onRequireAuth();
		return;
	}
	const replyToUid = replyingTo?.msgUid || "";
	onSendMessage(payload, [], [], replyToUid || undefined);
	replyingTo = null;
	isStickyAtBottom = true;
	void scrollToBottom();
}

function toggleMarkdownPreview() {
	isPreviewingMarkdown = !isPreviewingMarkdown;
	if (!isPreviewingMarkdown) {
		void tick().then(() => {
			focusInput(false);
		});
	}
}

function handleKeydown(e: KeyboardEvent) {
	if (e.isComposing) return;

	if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) {
		e.preventDefault();
		toggleMarkdownPreview();
		return;
	}

	if (mentionMenuOpen && filteredMentionCandidates.length > 0) {
		const count = filteredMentionCandidates.length;
		// 弹窗用 column-reverse 渲染：数组第 0 项在最下面（贴输入框），所以“向上”= 索引 +1
		if (e.key === "ArrowUp") {
			e.preventDefault();
			mentionActiveIndex = (mentionActiveIndex + 1) % count;
			return;
		}
		if (e.key === "ArrowDown") {
			e.preventDefault();
			mentionActiveIndex = mentionActiveIndex < 0 ? 0 : (mentionActiveIndex - 1 + count) % count;
			return;
		}
		const picked = filteredMentionCandidates[mentionActiveIndex];
		if (picked && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
			e.preventDefault();
			selectMentionCandidate(picked);
			return;
		}
		if (e.key === "Escape") {
			e.preventDefault();
			mentionMenuOpen = false;
			return;
		}
	}

	if (e.key === "Backspace" && deleteChatMentionBeforeCaret(inputEl)) {
		e.preventDefault();
		syncInputState();
		return;
	}

	if (e.key === "Escape") {
		if (isPreviewingMarkdown) {
			e.preventDefault();
			isPreviewingMarkdown = false;
			return;
		}
		if (editingMessage) {
			e.preventDefault();
			editingMessage = null;
			clearInput();
			loadRoomDraft(roomId);
			return;
		}
		if (replyingTo) {
			e.preventDefault();
			replyingTo = null;
			return;
		}
	}

	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		handleSend();
		return;
	}

	if (e.key === "Enter" && e.shiftKey) {
		e.preventDefault();
		insertNewlineAtCursor();
	}
}

// 勾选/取消「原图发送」只记录选择，不发请求；真正传哪一版在发送那一刻决定
function toggleImageQuality() {
	if (isSendingAttachments) return;
	imageQuality = imageQuality === "compressed" ? "original" : "compressed";
	saveChatImageQuality(imageQuality);
	uploadError = "";
	uploadNote = describePendingImages();
}

// 就着当前附件算体积说明：压缩版已经传好，原图版用本地文件大小
function describePendingImages(): string {
	const images = pendingImages.filter((att) => att.type === "image");
	if (images.length === 0) return "";
	let original = 0;
	let output = 0;
	for (const att of images) {
		original += pendingImageSources.get(att.url)?.file.size ?? att.size ?? 0;
		output += att.size ?? 0;
	}
	if (imageQuality === "original") {
		return `原图 ${images.length} 张 · ${formatChatFileSize(original)}`;
	}
	if (original <= output) {
		return `图片 ${images.length} 张 · ${formatChatFileSize(output)}`;
	}
	return `图片 ${images.length} 张 · ${formatChatFileSize(original)} → ${formatChatFileSize(output)}`;
}

async function uploadImageAttachment(
	file: File,
	prefer: "waline" | "chat",
	quality: ChatImageQuality = imageQuality,
): Promise<{
	attachment: ImageAttachment;
	originalSize: number;
	outputSize: number;
}> {
	const prepared = await prepareChatImageForSend(file, quality);
	const chatBase = (chatServerUrl || "https://chat-server.lengxiqwq.com").trim();

	// 粘贴/拖拽走 Waline（R2 + CDN），但原图超过 5MB 时只能回落到聊天网关
	const useWaline =
		prefer === "waline" &&
		Boolean(walineServerUrl) &&
		prepared.file.size <= 5 * 1024 * 1024;

	if (useWaline) {
		const { url } = await uploadChatImage(prepared.file, walineServerUrl);
		return {
			attachment: {
				type: "image",
				url,
				name: prepared.file.name,
				size: prepared.size,
				width: prepared.width,
				height: prepared.height,
			},
			originalSize: prepared.originalSize,
			outputSize: prepared.size,
		};
	}

	if (!chatBase) {
		throw new Error("未配置图片上传服务");
	}
	const res = await uploadChatMedia(prepared.file, chatBase, walineToken);
	return {
		attachment: {
			type: "image",
			url: res.url,
			name: res.name || prepared.file.name,
			size: res.size || prepared.size,
			width: prepared.width,
			height: prepared.height,
		},
		originalSize: prepared.originalSize,
		outputSize: res.size || prepared.size,
	};
}

// 发送时补传原图：只有勾了「原图发送」才会走到这里，压缩版在那之前已经传好了
async function uploadPendingOriginals(): Promise<ImageAttachment[]> {
	const uploaded: ImageAttachment[] = [];
	for (const att of pendingImages) {
		const source = att.type === "image" ? pendingImageSources.get(att.url) : null;
		if (!source) {
			uploaded.push(att);
			continue;
		}
		const result = await uploadImageAttachment(source.file, source.prefer, "original");
		// 原图分支不做解码，宽高沿用选图时压缩版量到的值，避免消息气泡布局抖动
		uploaded.push({
			...result.attachment,
			width: result.attachment.width ?? att.width,
			height: result.attachment.height ?? att.height,
		});
	}
	return uploaded;
}

async function processImageFiles(files: FileList | File[]) {
	if (!currentUser) {
		onRequireAuth();
		return;
	}
	if (!enableImageUpload || !walineServerUrl) {
		uploadError = "当前未启用图片上传服务";
		return;
	}
	const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
	if (list.length === 0) return;

	const MAX_FILE_SIZE = 100 * 1024 * 1024;
	const oversized = list.find((f) => f.size > MAX_FILE_SIZE);
	if (oversized) {
		uploadError = `图片“${oversized.name}”超过 100MB 上传限制`;
		return;
	}

	const remaining = Math.max(0, 3 - pendingImages.length);
	if (remaining === 0) {
		uploadError = "单条消息最多附带 3 张图片";
		return;
	}

	uploadError = "";
	uploadNote = "";
	isUploadingImage = true;
	try {
		for (const file of list.slice(0, remaining)) {
			const result = await uploadImageAttachment(file, "waline");
			pendingImages = [...pendingImages, result.attachment];
			pendingImageSources.set(result.attachment.url, {
				file,
				prefer: "waline",
			});
			uploadNote = describePendingImages();
		}
	} catch (err) {
		uploadError = err instanceof Error ? err.message : "图片上传失败";
	} finally {
		isUploadingImage = false;
	}
}

async function processMediaFiles(files: FileList | File[]) {
	if (!currentUser) {
		onRequireAuth();
		return;
	}
	const list = Array.from(files);
	if (list.length === 0) return;

	const MAX_FILE_SIZE = 100 * 1024 * 1024;
	const oversized = list.find((f) => f.size > MAX_FILE_SIZE);
	if (oversized) {
		uploadError = `文件“${oversized.name}”超过 100MB 上传限制`;
		if (mediaFileInputEl) {
			mediaFileInputEl.value = "";
		}
		return;
	}

	const remaining = Math.max(0, 3 - pendingImages.length);
	if (remaining === 0) {
		uploadError = "单条消息最多附带 3 个附件";
		return;
	}

	uploadError = "";
	uploadNote = "";
	isUploadingMedia = true;
	const chatBase = chatServerUrl || "https://chat-server.lengxiqwq.com";
	try {
		for (const file of list.slice(0, remaining)) {
			const isImage = file.type.startsWith("image/");
			const prepared = isImage
				? await prepareChatImageForSend(file, imageQuality)
				: null;
			const res = await uploadChatMedia(
				prepared?.file ?? file,
				chatBase,
				walineToken,
			);
			const attachment: ImageAttachment = {
				type: res.type,
				url: res.url,
				name: prepared?.file.name || res.name,
				size: res.size || prepared?.size,
				width: prepared?.width,
				height: prepared?.height,
			};
			pendingImages = [...pendingImages, attachment];
			if (isImage) {
				pendingImageSources.set(attachment.url, { file, prefer: "chat" });
				uploadNote = describePendingImages();
			}
		}
	} catch (err) {
		uploadError = err instanceof Error ? err.message : "附件上传失败";
	} finally {
		isUploadingMedia = false;
		if (mediaFileInputEl) {
			mediaFileInputEl.value = "";
		}
	}
}

function handlePaste(e: ClipboardEvent) {
	const items = e.clipboardData?.files;
	if (items && items.length > 0) {
		const files = Array.from(items);
		const imageFiles = files.filter((f) => f.type.startsWith("image/"));
		const otherFiles = files.filter((f) => !f.type.startsWith("image/"));
		if (imageFiles.length > 0) {
			e.preventDefault();
			void processImageFiles(imageFiles);
			return;
		}
		if (otherFiles.length > 0) {
			e.preventDefault();
			void processMediaFiles(otherFiles);
			return;
		}
	}

	// 纯文本粘贴防护：强制剥离所有网页样式，只粘贴纯文本
	if (e.clipboardData) {
		e.preventDefault();
		const text = e.clipboardData.getData("text/plain");
		if (text) {
			insertAtCursor(text);
		}
	}
}

function openSitePanel(
	triggerId: string,
	panelId: string,
	returnTriggerId: string,
) {
	const panel = document.getElementById(panelId);
	if (panel) {
		const ids = new Set(
			(panel.dataset.floatingPanelTrigger || "").split(/\s+/).filter(Boolean),
		);
		ids.add(returnTriggerId);
		panel.dataset.floatingPanelTrigger = [...ids].join(" ");
	}
	document.getElementById(triggerId)?.click();
}

function closeAllHeaderMenus() {
	showMobileMoreMenu = false;
	showMentionHistory = false;
	showThreadListMenu = false;
	showMusicNoticeMenu = false;
}

function toggleMobileMoreMenu() {
	const isCurrentTriggerOpen =
		showMobileMoreMenu ||
		(threadInMore && showThreadListMenu) ||
		(mentionsInMore && showMentionHistory) ||
		(ENABLE_HEADER_MUSIC_NOTICES &&
			musicNoticesInMore &&
			showMusicNoticeMenu);
	if (isCurrentTriggerOpen) {
		closeAllHeaderMenus();
	} else {
		closeAllHeaderMenus();
		showMobileMoreMenu = true;
	}
}

function toggleHeaderList(
	list: "threads" | "mentions" | "musicNotices",
	fromMore = false,
) {
	if (list === "threads") {
		const willOpen = !showThreadListMenu;
		closeAllHeaderMenus();
		showThreadListMenu = willOpen;
	} else if (list === "mentions") {
		const willOpen = !showMentionHistory;
		closeAllHeaderMenus();
		showMentionHistory = willOpen;
	} else if (list === "musicNotices") {
		if (!ENABLE_HEADER_MUSIC_NOTICES) return;
		const willOpen = !showMusicNoticeMenu;
		closeAllHeaderMenus();
		showMusicNoticeMenu = willOpen;
		if (willOpen) {
			lastSeenMusicNoticeTs = Date.now();
		}
	}
	if (fromMore) {
		mobileMoreTrigger?.focus({ preventScroll: true });
	}
}

onMount(() => {
	const panel = document.getElementById("nav-menu-panel");
	const restoreFocus = () => {
		if (!window.matchMedia("(width < 768px)").matches) return;
		if (
			document.activeElement === document.body ||
			panel?.contains(document.activeElement)
		) {
			document
				.getElementById("chat-site-navigation-trigger")
				?.focus({ preventScroll: true });
		}
	};
	panel?.addEventListener("floating-panel:close", restoreFocus);
	return () => panel?.removeEventListener("floating-panel:close", restoreFocus);
});

function removePendingImage(index: number) {
	const removed = pendingImages[index];
	if (removed) {
		pendingImageSources.delete(removed.url);
	}
	pendingImages = pendingImages.filter((_, i) => i !== index);
	uploadNote = describePendingImages();
}
</script>

<div
  class="flex flex-col h-full w-full min-h-0 relative"
  style:--chat-header-stack-height={`${chatHeaderStackHeight || 54}px`}
  ondragenter={handleDragEnter}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <!-- 视窗全屏拖拽放置提示层 -->
  {#if isDraggingFiles}
    <div class="chat-drag-overlay" role="presentation">
      {#if import.meta.env.DEV}
        <div class="chat-drag-dual-wrap">
          <div class="chat-drag-box flex-1">
            <div class="w-11 h-11 rounded-2xl bg-[var(--skin-accent)]/15 text-[var(--skin-accent)] flex items-center justify-center mb-2 animate-bounce">
              <svg class="w-5.5 h-5.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <span class="text-sm font-bold text-[var(--deep-text)]">添加为消息附件</span>
            <span class="text-xs text-[var(--chat-meta-color)] mt-1">拖放到聊天窗口其余区域</span>
          </div>
          <div
            class="chat-drag-box chat-drag-box--wallpaper flex-1"
            role="region"
            aria-label="设为中间聊天区壁纸预览"
            ondragover={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
            }}
            ondrop={(e) => void handleCenterWallpaperDrop(e)}
          >
            <div class="w-11 h-11 rounded-2xl bg-[var(--primary)]/18 text-[var(--primary)] flex items-center justify-center mb-2">
              <svg class="w-5.5 h-5.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
            <span class="text-sm font-bold text-[var(--primary)]">设为聊天区壁纸预览</span>
            <span class="text-xs text-[var(--chat-meta-color)] mt-1">松开图片替换中间背景（本地开发）</span>
          </div>
        </div>
      {:else}
        <div class="chat-drag-box">
          <div class="w-12 h-12 rounded-2xl bg-[var(--skin-accent)]/15 text-[var(--skin-accent)] flex items-center justify-center mb-2 animate-bounce">
            <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <span class="text-sm font-bold text-[var(--deep-text)]">拖拽文件到此处添加为附件</span>
          <span class="text-xs text-[var(--chat-meta-color)] mt-1">支持照片、音视频、文档或压缩包</span>
        </div>
      {/if}
    </div>
  {/if}
  {#snippet headerThreadList(reference?: HTMLElement | null)}
    <div data-chat-floating use:positionChatFloating={{ placement: "bottom-end", gap: 8, reference }} class="chat-requester-menu chat-mention-history-menu custom-scrollbar" role="menu" aria-label="活跃线程回复列表">
      <div class="px-2 py-1 text-[11px] md:text-[10px] font-semibold text-[var(--chat-meta-color)] flex items-center justify-between">
        <span>活跃线程回复</span>
        <span>{mergedActiveThreads.length} 个</span>
      </div>
      <div class="my-0.5 border-t border-black/5 dark:border-white/10"></div>
      {#each mergedActiveThreads as item (item.rootUid)}
        {@const rootMsg = item.rootMessage}
        {@const latest = item.summary.latestReply}
        <button
          type="button"
          role="menuitem"
          class="chat-requester-option items-start! py-2! md:py-1.5!"
          onclick={() => handleOpenThreadByUid(item.rootUid, rootMsg)}
        >
          <div class="flex items-start gap-2 min-w-0 flex-1">
            <ChatAvatar
              src={rootMsg?.avatar || latest?.avatar || ""}
              name={rootMsg?.name || latest?.name || "线程"}
              size="xs"
              class="mt-0.5"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-1">
                <span class="font-semibold truncate text-xs md:text-[11px]">
                  {rootMsg?.name || "主题消息"}
                </span>
                <span class="text-[11px] md:text-[10px] text-[var(--primary)] font-semibold tabular-nums shrink-0">
                  {item.summary.count} 条回复
                </span>
              </div>
              <div class="text-xs md:text-[11px] opacity-80 truncate mt-0.5">
                {rootMsg
                  ? formatChatReplyPreview(rootMsg.content, stickerMap, getChatAttachmentKind(rootMsg.attachments))
                  : (latest?.content || "点击查看线程")}
              </div>
              {#if latest}
                <div class="text-[11px] md:text-[10px] opacity-65 truncate mt-0.5">
                  最新 {latest.name}：{formatChatReplyPreview(latest.content, stickerMap, getChatReplyAttachmentKind(latest))}
                </div>
              {/if}
            </div>
          </div>
        </button>
      {/each}
    </div>
  {/snippet}

  {#snippet headerMentionList(reference?: HTMLElement | null)}
    <div data-chat-floating use:positionChatFloating={{ placement: "bottom-end", gap: 8, reference }} class="chat-requester-menu chat-mention-history-menu custom-scrollbar" role="menu" aria-label="被提及的消息列表">
      <div class="px-2 py-1 text-[11px] md:text-[10px] font-semibold text-[var(--chat-meta-color)] flex items-center justify-between">
        <span>近期提及你的消息</span>
        <span>{mentionsToMe.length}条</span>
      </div>
      <div class="my-0.5 border-t border-black/5 dark:border-white/10"></div>
      {#each mentionsToMe.slice().reverse() as item (item.msgUid)}
        {@const isUnread = unreadMentionSet.has(item.msgUid)}
        <button
          type="button"
          role="menuitem"
          class="chat-requester-option items-start! py-2! md:py-1.5! {isUnread ? 'active' : ''}"
          onclick={() => void jumpToMessage(item.msgUid)}
        >
          <div class="flex items-start gap-2 min-w-0 flex-1">
            <ChatAvatar
              src={item.avatar}
              name={item.name}
              size="xs"
              class="mt-0.5"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-1">
                <span class="font-semibold truncate text-xs md:text-[11px]">{item.name}</span>
                <span class="text-[11px] md:text-[10px] opacity-70 tabular-nums shrink-0">{formatShortTime(item.createdAt)}</span>
              </div>
              <div class="text-xs md:text-[11px] opacity-80 truncate mt-0.5">
                {item.content || "[图片消息]"}
              </div>
            </div>
          </div>
        </button>
      {/each}
    </div>
  {/snippet}

  {#snippet headerMusicNoticeList(reference?: HTMLElement | null)}
    <div
      data-chat-floating
      use:positionChatFloating={{ placement: "bottom-end", gap: 8, reference }}
      class="chat-music-notice-menu custom-scrollbar"
      role="menu"
      aria-label="点歌记录列表"
    >
      <div class="chat-music-notice-header">
        <div class="flex items-center gap-1.5 min-w-0">
          <svg class="w-4 h-4 text-[var(--primary)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
          <span class="font-semibold text-xs text-[var(--deep-text)] dark:text-white/90">房间点歌动态</span>
          <span class="chat-music-notice-pill">{sortedMusicNotices.length} 条</span>
        </div>
        {#if onOpenMusicDrawer}
          <button
            type="button"
            class="chat-music-notice-action-btn"
            onclick={() => {
              closeAllHeaderMenus();
              onOpenMusicDrawer?.();
            }}
          >
            <span>打开点歌台</span>
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        {/if}
      </div>

      <div class="my-1.5 border-t border-[var(--chat-divider-color)]"></div>

      {#if sortedMusicNotices.length === 0}
        <div class="chat-music-notice-empty">
          <div class="w-12 h-12 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center mb-2">
            <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <p class="text-xs font-semibold text-[var(--deep-text)] dark:text-white/90 m-0">暂无点歌动态</p>
          <p class="text-[11px] text-[var(--chat-meta-color)] mt-1 mb-2.5">点一首喜欢的歌，全房同步播放</p>
          {#if onOpenMusicDrawer}
            <button
              type="button"
              class="px-3.5 py-1 text-xs rounded-full bg-[var(--primary)] text-white hover:opacity-90 transition-opacity border-none cursor-pointer font-medium"
              onclick={() => {
                closeAllHeaderMenus();
                onOpenMusicDrawer?.();
              }}
            >点一首歌</button>
          {/if}
        </div>
      {:else}
        <div class="chat-music-notice-list flex flex-col gap-2">
          {#each sortedMusicNotices as item (item.msgUid)}
            {@const parsed = parseMusicNoticeContent(item.content)}
            {@const extraTrack = getSongExtraInfo(parsed.songTitle)}
            {@const actorAvatar = resolveMusicNoticeAvatar(item, parsed)}
            {@const actorDisplayName = parsed.actorName || item.name || "成员"}
            {@const isReq = parsed.actionType === "request"}
            {@const isSkip = parsed.actionType === "skip" || parsed.actionType === "vote_skip"}
            {@const isErr = parsed.actionType === "error"}
            {@const isPlayingNow = Boolean(parsed.songTitle && musicState?.current?.track?.title === parsed.songTitle)}
            <div class="chat-music-notice-card group">
              <!-- 卡片顶部：点歌人 + 动作标签 + 时间 -->
              <div class="flex items-center justify-between gap-1.5 mb-1.5">
                <div class="flex items-center gap-1.5 min-w-0">
                  <button
                    type="button"
                    class="chat-music-notice-avatar-btn shrink-0"
                    title={`查看 ${actorDisplayName} 的资料`}
                    onclick={() => {
                      handleOpenNoticeUserProfile(actorDisplayName, item.userKey, actorAvatar);
                    }}
                  >
                    <ChatAvatar
                      src={actorAvatar}
                      name={actorDisplayName}
                      size="xs"
                    />
                  </button>

                  <button
                    type="button"
                    class="font-semibold text-xs text-[var(--deep-text)] dark:text-white/90 hover:text-[var(--primary)] hover:underline truncate bg-transparent border-none p-0 cursor-pointer text-left transition-colors"
                    onclick={() => {
                      handleOpenNoticeUserProfile(actorDisplayName, item.userKey, actorAvatar);
                    }}
                  >
                    {actorDisplayName}
                  </button>

                  <span class="chat-notice-tag {isReq ? 'tag-request' : isSkip ? 'tag-skip' : isErr ? 'tag-error' : 'tag-system'}">
                    {parsed.actionLabel}
                  </span>
                </div>

                <span class="text-[10px] text-[var(--chat-meta-color)] tabular-nums shrink-0 opacity-70">
                  {formatShortTime(item.createdAt)}
                </span>
              </div>

              <!-- 卡片主体：歌曲封面与详情 -->
              <div class="chat-music-notice-track-body">
                <!-- 封面图 -->
                <div class="chat-music-notice-cover-wrap shrink-0">
                  {#if extraTrack?.coverUrl}
                    <img
                      src={extraTrack.coverUrl}
                      alt={parsed.songTitle || "封面"}
                      class="w-full h-full object-cover"
                      loading="lazy"
                    />
                  {:else}
                    <div class="w-full h-full flex items-center justify-center bg-[var(--primary)]/10 text-[var(--primary)]">
                      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                    </div>
                  {/if}
                  {#if isPlayingNow}
                    <div class="absolute inset-0 bg-black/45 flex items-center justify-center" aria-hidden="true">
                      <span class="chat-eq-bars chat-eq-bars--light">
                        <span class="chat-eq-bar"></span>
                        <span class="chat-eq-bar"></span>
                        <span class="chat-eq-bar"></span>
                      </span>
                    </div>
                  {/if}
                </div>

                <!-- 歌名与歌手 -->
                <div class="min-w-0 flex-1">
                  <div class="font-bold text-[13px] leading-tight text-[var(--deep-text)] dark:text-white/95 truncate {isErr ? 'text-red-500/90' : ''}">
                    {parsed.songTitle ? `《${parsed.songTitle}》` : parsed.rawContent}
                  </div>
                  <div class="text-[11px] text-[var(--chat-meta-color)] truncate mt-1 flex items-center gap-1.5">
                    {#if extraTrack?.artist}
                      <span class="truncate">{extraTrack.artist}</span>
                    {:else if isPlayingNow}
                      <span class="text-[var(--chat-accent-text)] font-medium">正在播放中</span>
                    {:else if isReq}
                      <span>房间点歌</span>
                    {:else}
                      <span>系统切播</span>
                    {/if}
                  </div>
                </div>

                <!-- 快捷操作按钮 -->
                {#if onOpenMusicDrawer}
                  <button
                    type="button"
                    class="chat-music-notice-play-btn shrink-0"
                    title="在点歌台查看"
                    onclick={() => {
                      closeAllHeaderMenus();
                      onOpenMusicDrawer?.();
                    }}
                  >
                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/snippet}


  <!-- 顶部悬浮毛玻璃层（小标题栏 + 置顶横幅） -->
  <div class="chat-header-stack" bind:clientHeight={chatHeaderStackHeight}>
    <!-- 顶栏 -->
    <div class="chat-panel-header chat-window-header" bind:clientWidth={chatHeaderWidth}>
    <div class="flex items-center gap-2 min-w-0 flex-1">
      <button
        type="button"
        class="chat-tool-btn chat-split-room-trigger relative shrink-0"
        aria-label={`${splitRoomOpen ? "收起" : "展开"}房间与成员${otherRoomsUnreadCount > 0 ? `，其他房间有 ${otherRoomsUnreadCount} 条未读消息` : ""}`}
        aria-controls={splitRoomPanelId}
        aria-expanded={splitRoomOpen}
        onclick={onToggleSplitRoom}
      >
        <svg class="w-[1.15rem] h-[1.15rem]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
        </svg>
        {#if otherRoomsUnreadCount > 0}
          <span class="chat-split-room-unread-dot" aria-hidden="true"></span>
        {/if}
      </button>
      {#if editingTopic && currentUser?.isAdmin}
        <form
          class="flex items-center gap-1.5 min-w-0 flex-1 max-w-md"
          onsubmit={(e) => {
            e.preventDefault();
            if (topicDraft.trim()) onSetTopic?.(topicDraft.trim());
            editingTopic = false;
          }}
        >
          <input
            type="text"
            maxlength="160"
            class="chat-topic-input flex-1 min-w-0 px-2.5 py-1 text-sm md:text-xs rounded-lg bg-black/5 dark:bg-white/10 text-[var(--deep-text)] dark:text-white/90 border border-[var(--chat-divider-color)] outline-none focus:border-[var(--primary)]"
            bind:value={topicDraft}
            placeholder="输入房间主题..."
            onkeydown={(e) => {
              if (e.key === "Escape") editingTopic = false;
            }}
          />
          <button type="submit" class="px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--primary)] text-white hover:opacity-90 border-none cursor-pointer">保存</button>
          <button type="button" class="px-2 py-1 rounded-lg text-xs text-[var(--chat-meta-color)] hover:bg-black/5 dark:hover:bg-white/10 border-none bg-transparent cursor-pointer" onclick={() => (editingTopic = false)}>取消</button>
        </form>
      {:else}
        <button
          type="button"
          class="chat-mobile-header-room-btn chat-mobile-only"
          aria-label={`#${roomName}，${mobileOnlineLabel}，打开房间与成员${otherRoomsUnreadCount > 0 ? `，其他房间有 ${otherRoomsUnreadCount} 条未读消息` : ""}`}
          onclick={() => onOpenRoomDrawer?.()}
        >
          {#snippet onlineStatus()}
            <span class="chat-mobile-room-online">
              <span class="chat-online-dot" aria-hidden="true"></span>
              <span class="truncate">{mobileOnlineLabel}</span>
            </span>
          {/snippet}
          <span class="chat-mobile-room-measure" aria-hidden="true">
            <span class="chat-mobile-room-measure-content" bind:offsetWidth={mobileRoomContentWidth}>
              <span class="chat-mobile-room-title">#{roomName}</span>
              {@render onlineStatus()}
            </span>
          </span>
          {#if hasRoomAvatar && fitsMobileRoomAvatar}
            <img
              src={getDownscaledAvatarUrl(effectiveRoomAvatar) || effectiveRoomAvatar}
              alt=""
              class="size-8 shrink-0 rounded-lg object-cover"
              decoding="async"
              crossorigin={!getDownscaledAvatarUrl(effectiveRoomAvatar) && canCorsDownscaleAvatar(effectiveRoomAvatar) ? "anonymous" : undefined}
              onload={(event) => downscaleImgElementInPlace(event.currentTarget, effectiveRoomAvatar)}

              onerror={() => {
                failedRoomAvatars = { ...failedRoomAvatars, [effectiveRoomAvatar]: true };
              }}
            />
          {/if}
          <span class="chat-mobile-room-info">
            <span class="chat-mobile-room-heading">
              <span class="chat-mobile-room-title truncate">#{roomName}</span>
              <span class="chat-mobile-room-chevron" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m9 5 7 7-7 7" />
                </svg>
                {#if otherRoomsUnreadCount > 0}
                  <span class="chat-mobile-room-unread-dot"></span>
                {/if}
              </span>
            </span>
            {@render onlineStatus()}
          </span>
        </button>

        <!-- 桌面端 / iPad 左侧：独立房间头像框、名称（互联茶室为可下拉框）与副标题 -->
        <div class="chat-header-room-avatar chat-desktop-only">
          {#if hasRoomAvatar}
            <img
              src={getDownscaledAvatarUrl(effectiveRoomAvatar) || effectiveRoomAvatar}
              alt={roomName}
              class="w-full h-full object-cover"
              decoding="async"
              crossorigin={!getDownscaledAvatarUrl(effectiveRoomAvatar) && canCorsDownscaleAvatar(effectiveRoomAvatar) ? "anonymous" : undefined}
              onload={(event) => downscaleImgElementInPlace(event.currentTarget, effectiveRoomAvatar)}

              onerror={() => {
                failedRoomAvatars = { ...failedRoomAvatars, [effectiveRoomAvatar]: true };
              }}
            />
          {:else}
            <span class="font-mono text-sm font-bold opacity-70">#</span>
          {/if}
        </div>
        {#if isInterconnectRoom}
          <button
            type="button"
            data-chat-interconnect-trigger
            data-chat-interconnect-anchor
            class="chat-header-room-dropdown chat-desktop-only {showInterconnect ? 'active' : ''}"
            aria-label="查看互联茶室友站列表"
            aria-expanded={showInterconnect}
            onclick={() => onToggleInterconnect?.()}
          >
            <span class="font-bold text-sm text-[var(--deep-text)] dark:text-white/90 min-w-0 truncate">
              #{roomName}
            </span>
            {#if interconnectSites.length > 0}
              <span class="chat-header-site-count text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--skin-accent-soft)] text-[var(--skin-accent)] tabular-nums shrink-0">
                {interconnectSites.length} 个站点
              </span>
            {/if}
            <svg class="w-3.5 h-3.5 opacity-65 transition-transform shrink-0 {showInterconnect ? 'rotate-180' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        {:else}
          <div class="chat-header-room-badge chat-desktop-only">
            <span class="font-bold text-sm text-[var(--deep-text)] dark:text-white/90 shrink-0">
              #{roomName}
            </span>
          </div>
        {/if}
        {#if effectiveSubtitle?.trim() || (currentUser?.isAdmin && onSetTopic)}
          <div class="chat-header-topic-wrap">
            {#if effectiveSubtitle?.trim()}
              <span
                use:fitBalancedTopicWidth={effectiveSubtitle}
                class="chat-header-topic-text"
                title={effectiveSubtitle}
              >
                {effectiveSubtitle.replace(/[\r\n]+/g, " ").trim()}
              </span>
            {/if}
            {#if currentUser?.isAdmin && onSetTopic}
              <ChatTooltip text="编辑房间主题" position="bottom" align="left">
                <button
                  type="button"
                  class="chat-header-topic-edit-btn"
                  aria-label="编辑房间主题"
                  onclick={() => {
                    topicDraft = effectiveSubtitle;
                    editingTopic = true;
                  }}
                >
                  <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </button>
              </ChatTooltip>
            {/if}
          </div>
        {/if}
      {/if}
    </div>
    <div class="chat-window-header-actions flex items-center gap-1.5 shrink-0">
      {#if hasHeaderThreads}
        <div class="chat-desktop-only relative shrink-0" bind:this={threadListWrapEl}>
          <button
            type="button"
            class="chat-header-pill-btn"
            aria-expanded={showThreadListMenu}
            aria-label="查看活跃线程回复"
            onclick={() => toggleHeaderList("threads")}
          >
            <svg class="w-3.5 h-3.5 shrink-0 text-[var(--primary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              <path d="M8 9h8" />
              <path d="M8 13h5" />
            </svg>
            <span class="font-bold text-[var(--primary)]">线程回复</span>
            <span class="text-[11px] md:text-[10px] opacity-75 tabular-nums">{mergedActiveThreads.length}</span>
          </button>

          {#if showThreadListMenu && !threadInMore}
            {@render headerThreadList()}
          {/if}
        </div>
      {/if}

      <div class="chat-mobile-only relative shrink-0" bind:this={mobileMoreMenuWrapEl}>
        <button
          type="button"
          data-chat-interconnect-anchor
          id="chat-site-controls-trigger"
          class="chat-mobile-header-action"
          class:is-active={showInterconnect}
          aria-label="更多聊天室选项"
          aria-expanded={showMobileMoreMenu || (threadInMore && showThreadListMenu) || (mentionsInMore && showMentionHistory) || (ENABLE_HEADER_MUSIC_NOTICES && musicNoticesInMore && showMusicNoticeMenu)}
          data-floating-panel-no-expanded
          bind:this={mobileMoreTrigger}
          onclick={toggleMobileMoreMenu}
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="1.25" fill="currentColor" />
            <circle cx="19" cy="12" r="1.25" fill="currentColor" />
            <circle cx="5" cy="12" r="1.25" fill="currentColor" />
          </svg>
        </button>

        {#if showMobileMoreMenu}
          <div data-chat-floating use:positionChatFloating={{ placement: "bottom-end", gap: 8 }} class="chat-mobile-more-menu" role="menu" aria-label="聊天室更多选项">
            {#if threadInMore}
              <button type="button" role="menuitem" class="chat-mobile-more-item" onclick={() => toggleHeaderList("threads", true)}>
                <span class="flex items-center gap-2.5">
                  <svg class="w-4.5 h-4.5 text-[var(--skin-accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    <path d="M8 9h8" />
                    <path d="M8 13h5" />
                  </svg>
                  <span>活跃线程回复</span>
                </span>
                <span class="chat-mobile-more-count">{mergedActiveThreads.length}</span>
              </button>
            {/if}
            {#if mentionsInMore}
              <button type="button" role="menuitem" class="chat-mobile-more-item" onclick={() => toggleHeaderList("mentions", true)}>
                <span class="flex items-center gap-2.5">
                  <svg class="w-4.5 h-4.5 text-[var(--skin-accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="4" />
                    <path d="M16 8v5a2 2 0 0 0 4 0v-1a8 8 0 1 0-3 6.25" />
                  </svg>
                  <span>被提及的消息</span>
                </span>
                <span class="chat-mobile-more-count">{mentionsToMe.length}</span>
              </button>
            {/if}
            {#if ENABLE_HEADER_MUSIC_NOTICES && musicNoticesInMore}
              <button type="button" role="menuitem" class="chat-mobile-more-item" onclick={() => toggleHeaderList("musicNotices", true)}>
                <span class="flex items-center gap-2.5">
                  <svg class="w-4.5 h-4.5 text-[var(--skin-accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                  <span>点歌记录</span>
                </span>
                <span class="chat-mobile-more-count">{sortedMusicNotices.length}</span>
              </button>
            {/if}
            {#if threadInMore || mentionsInMore || (ENABLE_HEADER_MUSIC_NOTICES && musicNoticesInMore)}
              <div class="mx-2 my-0.5 border-t border-[var(--skin-line)]"></div>
            {/if}

            <button
              type="button"
              role="menuitem"
              class="chat-mobile-more-item"
              onclick={() => {
                closeAllHeaderMenus();
                setTimeout(() => openSitePanel("display-settings-switch", "display-setting", "chat-site-controls-trigger"), 0);
              }}
            >
              <span class="flex items-center gap-2.5">
                <svg class="w-4.5 h-4.5 text-[var(--skin-accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
                  <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
                  <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
                  <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
                  <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
                </svg>
                <span>网站外观设置</span>
              </span>
              <svg class="w-4 h-4 text-[var(--chat-meta-color)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
            </button>

            <button
              type="button"
              role="menuitem"
              class="chat-mobile-more-item"
              onclick={() => {
                closeAllHeaderMenus();
                setTimeout(() => openSitePanel("scheme-switch", "theme-mode-panel", "chat-site-controls-trigger"), 0);
              }}
            >
              <span class="flex items-center gap-2.5">
                <svg class="w-4.5 h-4.5 text-[var(--skin-accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
                <span>切换明暗模式</span>
              </span>
              <svg class="w-4 h-4 text-[var(--chat-meta-color)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
            </button>

            {#if isInterconnectRoom}
              <button
                type="button"
                role="menuitem"
                data-chat-interconnect-trigger
                class="chat-mobile-more-item"
                onclick={() => {
                  closeAllHeaderMenus();
                  onToggleInterconnect?.();
                }}
              >
                <span class="flex items-center gap-2.5">
                  <svg class="w-4.5 h-4.5 text-[var(--skin-accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
                    <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
                    <line x1="6" y1="1" x2="6" y2="4" />
                    <line x1="10" y1="1" x2="10" y2="4" />
                    <line x1="14" y1="1" x2="14" y2="4" />
                  </svg>
                  <span>互联茶室友站列表</span>
                </span>
                <svg class="w-4 h-4 text-[var(--chat-meta-color)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            {/if}

            {#if currentUser?.isAdmin && onSetTopic}
              <button
                type="button"
                role="menuitem"
                class="chat-mobile-more-item"
                onclick={() => {
                  closeAllHeaderMenus();
                  topicDraft = effectiveSubtitle;
                  editingTopic = true;
                }}
              >
                <span class="flex items-center gap-2.5">
                  <svg class="w-4.5 h-4.5 text-[var(--skin-accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  <span>编辑房间主题</span>
                </span>
              </button>
            {/if}
          </div>
        {:else if threadInMore && showThreadListMenu}
          {@render headerThreadList(mobileMoreTrigger)}
        {:else if mentionsInMore && showMentionHistory}
          {@render headerMentionList(mobileMoreTrigger)}
        {:else if ENABLE_HEADER_MUSIC_NOTICES && musicNoticesInMore && showMusicNoticeMenu}
          {@render headerMusicNoticeList(mobileMoreTrigger)}
        {/if}
      </div>

      {#if hasHeaderMentions}
        <div class="relative shrink-0" bind:this={mentionHistoryWrapEl}>
          <button
            type="button"
            class="chat-header-pill-btn chat-mobile-header-action {unreadMentionUids.length > 0 ? 'has-unread' : ''}"
            aria-expanded={showMentionHistory}
            aria-label={unreadMentionUids.length > 0 ? `查看被提及的消息，${unreadMentionUids.length} 条未读` : "查看被提及的消息"}
            class:chat-mobile-header-collapsed={mentionsInMore}
            onclick={() => toggleHeaderList("mentions")}
          >
            <svg class="chat-mobile-only" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M16 8v5a2 2 0 0 0 4 0v-1a8 8 0 1 0-3 6.25" /></svg>
            <span class="chat-mention-label font-bold text-[var(--primary)]">被提及</span>
            {#if unreadMentionUids.length > 0}
              <span class="chat-mention-unread-badge">{unreadMentionUids.length}</span>
            {:else}
              <span class="chat-mention-count text-[11px] md:text-[10px] opacity-75 tabular-nums">{mentionsToMe.length}</span>
            {/if}
          </button>

          {#if showMentionHistory && !mentionsInMore}
            {@render headerMentionList()}
          {/if}
        </div>
      {/if}

      <!-- 点歌记录胶囊入口（当前设为不加载，节省内存与空间；改 ENABLE_HEADER_MUSIC_NOTICES = true 即可恢复） -->
      {#if ENABLE_HEADER_MUSIC_NOTICES}
        <div class="relative shrink-0" bind:this={musicNoticeWrapEl}>
          <button
            type="button"
            class="chat-header-pill-btn chat-mobile-header-action chat-music-notice-btn {unreadMusicNoticeCount > 0 ? 'has-unread' : ''} {showMusicNoticeMenu ? 'active' : ''}"
            aria-expanded={showMusicNoticeMenu}
            aria-label={unreadMusicNoticeCount > 0 ? `查看点歌记录，${unreadMusicNoticeCount} 条新动态` : "查看点歌记录"}
            class:chat-mobile-header-collapsed={musicNoticesInMore}
            onclick={() => toggleHeaderList("musicNotices")}
          >
            <svg class="w-3.5 h-3.5 shrink-0 text-[var(--primary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            <span class="chat-mention-label font-medium text-[var(--deep-text)] dark:text-white/90">点歌记录</span>
            {#if unreadMusicNoticeCount > 0}
              <span class="chat-mention-unread-badge">{unreadMusicNoticeCount}</span>
            {:else if sortedMusicNotices.length > 0}
              <span class="chat-mention-count text-[11px] md:text-[10px] opacity-75 tabular-nums text-[var(--chat-meta-color)]">{sortedMusicNotices.length}</span>
            {/if}
          </button>

          {#if showMusicNoticeMenu && !musicNoticesInMore}
            {@render headerMusicNoticeList()}
          {/if}
        </div>
      {/if}


      <!-- 桌面端顶栏右侧控件 -->
      <div class="chat-desktop-only">
        <ChatTooltip
          position="bottom"
          align="right"
          text={isInterconnectRoom && totalChatterCount && totalChatterCount > 0 ? `${onlineCount} 人在线 · 累计 ${totalChatterCount} 人聊过天` : `${onlineCount} 人在线`}
        >
          <div
            class="text-xs text-[var(--deep-text)] dark:text-white/85 px-2.5 py-1 rounded-full bg-[var(--card-bg)]/60 border border-[var(--chat-divider-color)] flex items-center gap-1.5"
          >
            <span class="chat-online-dot"></span>
            <span>{isInterconnectRoom && totalChatterCount && totalChatterCount > 0 ? `${onlineCount}/${totalChatterCount}` : `${onlineCount} 人在线`}</span>
          </div>
        </ChatTooltip>
      </div>

      <div class="chat-mobile-only flex items-center" bind:offsetWidth={mobileHeaderEndWidth}>
        <button
          type="button"
          id="chat-site-navigation-trigger"
          name="Nav Menu"
          class="chat-mobile-site-menu btn-plain scale-animation rounded-lg w-11 h-11 active:scale-90 lg:hidden!"
          aria-label="打开网站导航"
          aria-controls="nav-menu-panel"
          aria-expanded="false"
          onclick={() => openSitePanel("nav-menu-switch", "nav-menu-panel", "chat-site-navigation-trigger")}
        >
          <!-- 与 Navbar.astro 的 material-symbols:menu-rounded 一致。 -->
          <svg width="1em" height="1em" class="text-[1.25rem]" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M4 18q-.425 0-.712-.288T3 17t.288-.712T4 16h16q.425 0 .713.288T21 17t-.288.713T20 18zm0-5q-.425 0-.712-.288T3 12t.288-.712T4 11h16q.425 0 .713.288T21 12t-.288.713T20 13zm0-5q-.425 0-.712-.288T3 7t.288-.712T4 6h16q.425 0 .713.288T21 7t-.288.713T20 8z" />
          </svg>
        </button>
      </div>
    </div>
  </div>

  <!-- 移动端当前播放横条（常驻于顶栏下方、置顶消息上方） -->
  <div class="chat-mobile-only chat-mobile-player-layer">
    <MiniPlayerBar
      currentPlay={musicState?.current ?? null}
      isListening={mobilePlaybackStatus?.isListening ?? false}
      audioStatus={mobilePlaybackStatus?.audioStatus}
      elapsedSec={mobilePlaybackStatus?.elapsedSec ?? 0}
      durationSec={mobilePlaybackStatus?.durationSec ?? 0}
      canDirectSkip={mobilePlaybackStatus?.canDirectSkip ?? false}
      isSoloCoolingDown={mobilePlaybackStatus?.isSoloCoolingDown ?? false}
      soloCooldownRemainSec={mobilePlaybackStatus?.soloCooldownRemainSec ?? 0}
      hasVotedSkip={mobilePlaybackStatus?.hasVotedSkip ?? false}
      voteCount={musicState?.voteCount ?? 0}
      voteThreshold={musicState?.voteThreshold ?? 2}
      isSkippingTrack={isSkippingTrack}
      currentLyric={mobilePlaybackStatus?.currentLyric}
      variant="mobile"
      onOpenLyrics={() => (musicState?.current ? onOpenLyricsDrawer?.() : onOpenMusicDrawer?.())}
      onToggleListen={() => onToggleListen?.()}
      onSkipTrack={() => onSkipTrack?.()}
      onVoteSkip={() => onVoteSkip?.()}
    />
  </div>

    <!-- 置顶消息横幅 (Pinned Messages，置于播放器下方) -->
    {#if currentPinnedMsg}
      <div class="chat-pinned-banner">
        <button
          type="button"
          class="flex items-center gap-1.5 md:gap-2 truncate flex-1 chat-pinned-btn text-left bg-transparent border-none p-0 text-[var(--skin-text)] cursor-pointer min-w-0"
          onclick={() => void jumpToMessage(currentPinnedMsg.msgUid)}
        >
          <svg class="w-3.5 h-3.5 text-[var(--skin-accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="12" y1="17" x2="12" y2="22" />
            <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
          </svg>
          <span class="font-semibold text-xs shrink-0">{currentPinnedMsg.name}:</span>
          <span class="truncate text-xs text-[var(--chat-meta-color)]">
            {currentPinnedMsg.content || (currentPinnedMsg.attachments?.length > 0 ? "[多媒体附件]" : "消息")}
          </span>
        </button>
        <div class="flex items-center gap-1 md:gap-1.5 shrink-0 ml-1.5 md:ml-2">
          {#if pinnedMessages.length > 1}
            <span class="text-[11px] md:text-xs text-[var(--chat-meta-color)] tabular-nums px-0.5 select-none">
              {activePinIndex + 1}/{pinnedMessages.length}
            </span>
            <ChatTooltip text="查看下一条置顶">
              <button
                type="button"
                class="chat-pinned-action-btn"
                aria-label="查看下一条置顶"
                onclick={() => (activePinIndex = (activePinIndex + 1) % pinnedMessages.length)}
              >
                <svg class="chat-pinned-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </ChatTooltip>
          {/if}
          {#if currentUser?.isAdmin}
            <ChatTooltip text="取消置顶">
              <button
                type="button"
                class="chat-pinned-action-btn is-close"
                aria-label="取消置顶"
                onclick={() => onPinMessage?.(currentPinnedMsg.msgUid, true)}
              >
                <svg class="chat-pinned-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </ChatTooltip>
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <!-- 消息展示流区域（含悬浮 切歌投票 / @你 / 未读定位 横幅） -->
  <div class="chat-messages-stream-layer relative flex-1 min-h-0 flex flex-col">
    {#if skipVoteBanner || queueVoteBanners.length > 0 || activeAlertMessage || showUnreadJumpBar}
      <div class="chat-floating-alerts-stack">
        {#if skipVoteBanner}
          <div class="chat-mention-floating-bar" role="status" aria-live="polite">
            <div class="flex-1 min-w-0 flex items-center gap-2">
              <svg class="w-3.5 h-3.5 text-[var(--primary)] shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
              </svg>
              <span class="font-bold text-[var(--chat-accent-text)] shrink-0 truncate max-w-32">
                {skipVoteBanner.voterLabel}
              </span>
              <span class="truncate text-[var(--deep-text)] dark:text-white/85">
                申请切歌：《{skipVoteBanner.title}》（{skipVoteBanner.voteCount}/{skipVoteBanner.voteThreshold}）
              </span>
            </div>
            {#if isSkippingTrack}
              <button
                type="button"
                disabled
                class="chat-mention-jump-pill opacity-80 border-none cursor-wait shrink-0 flex items-center gap-1.5"
              >
                <svg class="w-3.5 h-3.5 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
                </svg>
                <span>切歌中...</span>
              </button>
            {:else if skipVoteBanner.hasVotedSkip}
              <!-- 发起投票 / 已经投过票的人：仅显示“取消”，绝不显示“同意” -->
              <ChatTooltip text="取消切歌申请" position="bottom" align="right">
                <button
                  type="button"
                  class="chat-mention-jump-pill opacity-90 hover:opacity-100 border-none cursor-pointer shrink-0"
                  onclick={() => onVoteSkip?.()}
                >
                  取消
                </button>
              </ChatTooltip>
            {:else}
              <!-- 其他没投票的人：显示“同意” -->
              <ChatTooltip text="同意切歌" position="bottom" align="right">
                <button
                  type="button"
                  class="chat-mention-jump-pill border-none cursor-pointer shrink-0 active:scale-95"
                  onclick={() => {
                    if (skipVoteBanner.canDirectSkip) {
                      onSkipTrack?.();
                    } else {
                      onVoteSkip?.();
                    }
                  }}
                >
                  同意
                </button>
              </ChatTooltip>
            {/if}
          </div>
        {/if}

        {#each queueVoteBanners as qBanner (qBanner.uid)}
          <div class="chat-mention-floating-bar" role="status" aria-live="polite">
            <div class="flex-1 min-w-0 flex items-center gap-2">
              <svg class="w-3.5 h-3.5 text-[var(--primary)] shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
              </svg>
              <span class="font-bold text-[var(--chat-accent-text)] shrink-0 truncate max-w-32">
                {qBanner.voterLabel}
              </span>
              <span class="truncate text-[var(--deep-text)] dark:text-white/85">
                申请切到：《{qBanner.title}》（{qBanner.voteCount}/{qBanner.voteThreshold}）
              </span>
            </div>
            {#if isSkippingTrack}
              <button
                type="button"
                disabled
                class="chat-mention-jump-pill opacity-80 border-none cursor-wait shrink-0 flex items-center gap-1.5"
              >
                <svg class="w-3.5 h-3.5 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
                </svg>
                <span>切歌中...</span>
              </button>
            {:else if qBanner.hasVoted}
              <ChatTooltip text="取消切歌申请" position="bottom" align="right">
                <button
                  type="button"
                  class="chat-mention-jump-pill opacity-90 hover:opacity-100 border-none cursor-pointer shrink-0"
                  onclick={() => onPlayQueued?.(qBanner.uid)}
                >
                  取消
                </button>
              </ChatTooltip>
            {:else}
              <ChatTooltip text="同意切到该歌曲" position="bottom" align="right">
                <button
                  type="button"
                  class="chat-mention-jump-pill border-none cursor-pointer shrink-0 active:scale-95"
                  onclick={() => onPlayQueued?.(qBanner.uid)}
                >
                  同意
                </button>
              </ChatTooltip>
            {/if}
          </div>
        {/each}

        {#if activeAlertMessage}
          <div class="chat-mention-floating-bar" role="status" aria-live="polite">
            <button
              type="button"
              class="flex-1 min-w-0 flex items-center gap-2 text-left bg-transparent border-none p-0 cursor-pointer text-inherit"
              onclick={() => void jumpToMessage(activeAlertMessage.msgUid)}
            >
              <span class="w-2 h-2 rounded-full bg-[var(--primary)] shrink-0 animate-pulse"></span>
              <span class="font-bold text-[var(--chat-accent-text)] shrink-0">
                {activeAlertMessage.name} {isReplyToMe(activeAlertMessage) ? "回复了你" : "提到了你"}
              </span>
              <span class="truncate text-[var(--deep-text)] dark:text-white/85">
                {activeAlertMessage.content || "[图片消息]"}
              </span>
              <span class="chat-mention-jump-pill shrink-0">
                {unreadMentionUids.length > 1 ? `立即查看 (${unreadMentionUids.length})` : "一键跳转 →"}
              </span>
            </button>
            <button
              type="button"
              class="w-5 h-5 rounded-full flex items-center justify-center border-none bg-transparent text-[var(--chat-meta-color)] hover:text-[var(--deep-text)] cursor-pointer shrink-0 text-xs"
              aria-label="关闭提醒"
              onclick={dismissAlertBanner}
            >
              ×
            </button>
          </div>
        {/if}

        {#if isLocatingTargetMessage}
          <div class="chat-mention-floating-bar chat-unread-floating-bar" role="status" aria-live="polite">
            <div class="flex-1 min-w-0 flex items-center gap-2 text-[var(--deep-text)] dark:text-white/90 text-xs py-0.5">
              <svg class="w-3.5 h-3.5 animate-spin text-[var(--primary)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
              </svg>
              <span class="font-medium truncate">正在追溯历史记录，定位目标消息...</span>
            </div>
          </div>
        {:else if targetMessageNotFound}
          <div class="chat-mention-floating-bar" role="status" aria-live="polite">
            <div class="flex-1 min-w-0 flex items-center gap-2 text-xs text-[var(--chat-meta-color)] py-0.5">
              <span>该消息可能已被撤回或不存在</span>
            </div>
            <button
              type="button"
              class="w-5 h-5 rounded-full flex items-center justify-center border-none bg-transparent text-[var(--chat-meta-color)] hover:text-[var(--deep-text)] cursor-pointer shrink-0 text-xs"
              aria-label="关闭提示"
              onclick={() => { targetMessageNotFound = false; }}
            >
              ×
            </button>
          </div>
        {/if}

        {#if unfocusedBanner}
          <div class="chat-mention-floating-bar chat-unread-floating-bar" role="status" aria-live="polite">
            <button
              type="button"
              class="flex-1 min-w-0 flex items-center gap-2 text-left bg-transparent border-none p-0 cursor-pointer text-inherit"
              onclick={handleJumpToUnfocusedStart}
            >
              <svg class="w-3.5 h-3.5 text-[var(--primary)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="17 11 12 6 7 11" />
                <polyline points="17 18 12 13 7 18" />
              </svg>
              <span class="font-semibold text-[var(--deep-text)] dark:text-white/90 truncate">
                离开期间有 {unfocusedBanner.count} 条新消息
              </span>
              <span class="chat-mention-jump-pill shrink-0">
                定位到未读起始 ↑
              </span>
            </button>
            <button
              type="button"
              class="w-5 h-5 rounded-full flex items-center justify-center border-none bg-transparent text-[var(--chat-meta-color)] hover:text-[var(--deep-text)] cursor-pointer shrink-0 text-xs"
              aria-label="关闭提示"
              onclick={() => { unfocusedBanner = null; }}
            >
              ×
            </button>
          </div>
        {:else if showUnreadJumpBar}
          <div class="chat-mention-floating-bar chat-unread-floating-bar" role="status" aria-live="polite">
            <button
              type="button"
              disabled={isLoadingHistory}
              class="flex-1 min-w-0 flex items-center gap-2 text-left bg-transparent border-none p-0 cursor-pointer text-inherit disabled:opacity-60"
              onclick={handleJumpToUnread}
            >
              <svg class="w-3.5 h-3.5 text-[var(--primary)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="17 11 12 6 7 11" />
                <polyline points="17 18 12 13 7 18" />
              </svg>
              <span class="font-semibold text-[var(--deep-text)] dark:text-white/90 truncate">
                离开期间有 {unreadBadgeCount} 条未读消息 ({formatUnreadTime(sessionUnreadSince)})
              </span>
              <span class="chat-mention-jump-pill shrink-0">
                {#if isLoadingHistory}
                  正在加载历史...
                {:else if hasUnloadedUnread}
                  查看历史消息 ({unreadBadgeCount}条) ↑
                {:else}
                  回到上次阅读位置 ↑
                {/if}
              </span>
            </button>
            <button
              type="button"
              class="w-5 h-5 rounded-full flex items-center justify-center border-none bg-transparent text-[var(--chat-meta-color)] hover:text-[var(--deep-text)] cursor-pointer shrink-0 text-xs"
              aria-label="忽略未读提示"
              onclick={dismissUnreadBar}
            >
              ×
            </button>
          </div>
        {/if}
      </div>
    {/if}

    <div
      bind:this={messageContainer}
      data-chat-message-scroll
      data-chat-pinned-bottom={followsLayoutAtBottom ? "" : undefined}
      data-chat-virtualized={virtualEnabled ? "" : undefined}
      onscroll={handleMessageScroll}
      class="flex-1 custom-scrollbar min-h-0"
    >
      <div
        bind:this={messageContentEl}
        class="chat-message-content min-h-full flex flex-col"
        style:padding-top={`${chatHeaderStackHeight || 54}px`}
      >
        {#if hasMoreHistory}
          <div class="flex justify-center py-1.5" bind:this={topSentinelEl}>
            {#if isLoadingHistory}
              <div class="flex items-center gap-2 text-xs text-[var(--chat-meta-color)] font-medium py-1 px-3 rounded-full bg-black/5 dark:bg-white/5 animate-pulse">
                <svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                </svg>
                <span>正在加载更早的消息...</span>
              </div>
            {:else}
              <button
                type="button"
                class="chat-history-expand-btn text-xs py-1 px-3 rounded-full opacity-75 hover:opacity-100 transition-opacity"
                onclick={() => triggerAutoLoadOlderHistory(true)}
              >
                ↑ 加载更早历史
              </button>
            {/if}
          </div>
        {:else if messages.length > 0}
          <div class="flex items-center justify-center gap-2 py-3 text-[11px] text-[var(--chat-meta-color)] select-none opacity-60">
            <span class="w-8 h-px bg-current opacity-30"></span>
            <span>已经到达消息的最开端</span>
            <span class="w-8 h-px bg-current opacity-30"></span>
          </div>
        {/if}

        {#if visibleMessages.length === 0}
          <div class="flex-1 flex flex-col items-center justify-center text-center py-8 text-xs text-[var(--chat-meta-color)]">
            <p class="m-0">房间暂时很安静，发条消息开启话题吧~</p>
          </div>
        {:else}
          {#if renderedWindow.topSpacerPx > 0}
            <div style="height: {renderedWindow.topSpacerPx}px; flex-shrink: 0;" aria-hidden="true"></div>
          {/if}
          <div bind:this={windowTopMarkerEl} aria-hidden="true"></div>
          {#each renderedMessages as msg (msg.msgUid)}
            {@const isSelf = Boolean(
              currentUser && (
                msg.userKey === currentUser.userKey ||
                (currentUser.isAdmin && (
                  msg.isAdmin ||
                  msg.userKey === "waline:1" ||
                  msg.userKey === "@lengxiqwq:matrix.lengxiqwq.com" ||
                  msg.userKey === "matrix:@lengxiqwq:matrix.lengxiqwq.com"
                ))
              )
            )}
            {@const isAdmin = Boolean(currentUser?.isAdmin)}
            {@const serverNow = nowMs + clockOffsetMs}
            {@const canRecall = Boolean(
              currentUser &&
                msg.kind === "user" &&
                (isAdmin ||
                  (isSelf && serverNow - msg.createdAt <= RECALL_WINDOW_MS)),
            )}
            {@const canEdit = Boolean(
              currentUser &&
                msg.kind === "user" &&
                (isAdmin ||
                  (isSelf && serverNow - msg.createdAt <= 15 * 60 * 1000)),
            )}
            {@const canDelete = Boolean(
              currentUser && msg.kind === "user" && isAdmin && roomId !== "interconnect",
            )}
            <div class="chat-message-row" data-vrow-uid={msg.msgUid}>
              {#if firstUnreadMsgUid === msg.msgUid}
                <div
                  data-unread-divider
                  class="chat-unread-divider {highlightUnreadDivider ? 'highlight' : ''}"
                  role="separator"
                >
                  <span class="chat-unread-divider-line"></span>
                  <span class="chat-unread-divider-label">
                    上次 {formatUnreadTime(sessionUnreadSince)} 阅读到这里
                  </span>
                  <span class="chat-unread-divider-line"></span>
                </div>
              {/if}
              <ChatMessage
                message={msg}
                isSelf={isSelf}
                isMentionedMe={isMentionedToMe(msg)}
                isHighlighted={highlightedMsgUid === msg.msgUid}
                currentUserKey={currentUser?.userKey}
                isAdmin={isAdmin}
                isPinned={pinnedUidSet.has(msg.msgUid)}
                isInterconnectRoom={isInterconnectRoom}
                threadSummary={getThreadSummaryForMessage(msg)}
                orphanThreadRootUid={msg.threadRootUid && !loadedMainRootIds.has(msg.threadRootUid) ? msg.threadRootUid : ""}
                canRecall={canRecall}
                canEdit={canEdit}
                canDelete={canDelete}
                stickerMap={stickerMap}
                stickerPacks={stickerPacks}
                chatServerUrl={chatServerUrl}
                interconnectSites={interconnectSites}
                userNameMap={userNameMap}
                userProfileMap={userProfileMap}
                readReceipts={readReceipts[msg.msgUid] ?? EMPTY_READ_RECEIPTS}
                onRecall={onRecallMessage}
                onDelete={onDeleteMessage}
                onReply={msg.kind === "user" ? handleStartReply : undefined}
                onOpenThread={msg.kind === "user" ? handleOpenThread : undefined}
                onOpenThreadByUid={(uid) => handleOpenThreadByUid(uid)}
                onViewSource={handleViewSource}
                onEdit={handleStartEdit}
                onPin={onPinMessage}
                onReaction={onReaction}
                onVotePoll={onVotePoll}
                onEndPoll={onEndPoll}
                onJumpToMessage={handleJumpToReply}
                onOpenUserProfile={onOpenUserProfile}
                onMention={onMentionUser}
                onOpenMobileActions={handleOpenMobileActions}
              />
            </div>
          {/each}
          <div bind:this={windowBottomMarkerEl} aria-hidden="true"></div>
          {#if renderedWindow.bottomSpacerPx > 0}
            <div style="height: {renderedWindow.bottomSpacerPx}px; flex-shrink: 0;" aria-hidden="true"></div>
          {/if}
        {/if}
      </div>
    </div>

    {#if showScrollBottomBtn}
      <div class="chat-scroll-bottom-wrap">
        <button
          type="button"
          class="chat-scroll-bottom-btn"
          aria-label="滚动到底部最新消息"
          onclick={() => {
            unreadBarDismissed = true;
            unfocusedBanner = null;
            unfocusedArrivalUids = [];
            void scrollToBottom(true);
            markCurrentRoomReadIfReady(true);
          }}
        >
          <svg class="w-3.5 h-3.5 text-[var(--primary)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span>
            {newMessagesWhileScrolled > 0
              ? `回到底部 (${newMessagesWhileScrolled} 条新消息)`
              : "回到底部"}
          </span>
        </button>
      </div>
    {/if}
  </div>

  <!-- 统一底部输入停靠区 -->
  <div
    bind:this={dockEl}
    class="chat-input-dock"
    ondragenter={handleInputBgDragEnter}
    ondragover={handleInputBgDragOver}
    ondragleave={handleInputBgDragLeave}
    ondrop={(e) => void handleInputBgDrop(e)}
  >
    <div class="chat-panel-bg-layer" aria-hidden="true">
      {#if inputBgUrl}
        <img
          src={inputBgUrl}
          alt=""
          loading="eager"
          fetchpriority="low"
          decoding="async"
          class="chat-panel-bg-img"
          use:trackBgImgAspectRatio={inputBgUrl}
          style:display={failedInputBg ? "none" : undefined}
          onerror={() => onInputBgError?.()}
        />
      {/if}
      <div class="chat-panel-bg-scrim"></div>
    </div>
    {#if import.meta.env.DEV && inputDragActive}
      <div class="chat-panel-dev-drop-overlay" role="presentation">
        <div class="chat-panel-dev-drop-box">
          <span class="text-xs font-bold text-[var(--skin-accent)]">松开替换为输入框壁纸</span>
          <span class="text-[11px] text-[var(--chat-meta-color)]">仅本地开发预览</span>
        </div>
      </div>
    {/if}
    {#if composerPickerMounted}
      <div
        data-chat-floating
        use:positionChatFloating={{
          enabled: activePopover === "emoji",
          placement: "top-start",
          gap: 8,
        }}
        class="chat-emoji-popover chat-sticker-popover chat-composer-picker"
      >
        <ChatStickerPicker
          variant="composer"
          open={activePopover === "emoji"}
          {stickerPacks}
          {chatServerUrl}
          onSelect={onSelectEmojiOrSticker}
          onClose={() => {
            activePopover = "none";
            focusInput(false);
          }}
        />
      </div>
    {/if}

    <!-- @ 选人弹窗（输入 @ 时触发：在线优先，离线靠后） -->
    {#if mentionMenuOpen}
      <div data-chat-floating use:positionChatFloating={{ placement: "top-start", gap: 8 }} class="chat-mention-autocomplete custom-scrollbar" role="listbox" aria-label="选择要 @ 的成员">
        {#if filteredMentionCandidates.length === 0}
          <div class="px-2.5 py-2 text-[11px] text-[var(--chat-meta-color)]">
            没有找到匹配的成员
          </div>
        {:else}
          {#each filteredMentionCandidates as person, idx (person.userKey)}
            {@const isRoomMention = person.userKey === "room"}
            {@const isExt = !isRoomMention && isExternalMatrixIdentity(person)}
            {@const extOrigin = isExt ? resolveExternalOrigin({ name: person.name, userKey: person.userKey, badge: person.badge, site: person.site, siteUrl: person.siteUrl, url: person.url }, interconnectSites) : null}
            {@const displayPersonName = isRoomMention
              ? "全体成员"
              : isExt
                ? (extOrigin?.cleanName || person.name)
                : person.name}
            {@const personBadgeLabel = isRoomMention
              ? "全体成员"
              : isExt
                ? (extOrigin?.siteName || person.badge || "互联茶友")
                : localSiteName}
            {@const personBadgeType = isRoomMention
              ? "host"
              : "tag"}
            <button
              type="button"
              role="option"
              aria-selected={idx === mentionActiveIndex}
              title={isRoomMention ? "全体成员提醒" : `${formatCandidateMentionName(person)} (${person.userKey})`}
              class="chat-mention-ac-item {idx === mentionActiveIndex ? 'active' : ''}"
              onmouseenter={() => (mentionActiveIndex = idx)}
              onpointerdown={(event) => event.preventDefault()}
              onclick={() => selectMentionCandidate(person)}
            >
              <!-- 第一栏（最左）：头像与昵称左对齐，超长截断并支持悬停 Tooltip 完整补全 -->
              <div class="chat-mention-col-user">
                <div class="relative shrink-0">
                  {#if isRoomMention}
                    <div class="w-5 h-5 rounded-full bg-[var(--primary)]/15 text-[var(--primary)] flex items-center justify-center text-[10px] font-bold">
                      @
                    </div>
                  {:else}
                    <ChatAvatar
                      src={person.avatar}
                      name={displayPersonName}
                      size="xs"
                      grayscale={!person.online}
                      mutedTone={!person.online}
                    />
                  {/if}
                  {#if person.online}
                    {@const mentionFallback = !isRoomMention && person.presenceMode === "fallback"}
                    {@const mentionAway = !isRoomMention && !mentionFallback && person.isFocused === false}
                    <span
                      class="chat-ac-status-dot {mentionFallback ? 'fallback' : mentionAway ? 'away' : 'online'}"
                      aria-hidden="true"
                    ></span>
                  {/if}
                </div>
                <div class="min-w-0">
                  <div class="text-xs font-medium truncate text-[var(--deep-text)] dark:text-white/90">
                    {displayPersonName}
                  </div>
                  {#if repeatedMentionLabels.has(formatCandidateMentionName(person))}
                    <div class="truncate text-[10px] text-[var(--chat-meta-color)]">{person.userKey}</div>
                  {/if}
                </div>
                {#if person.customBadges && person.customBadges.length > 0}
                  {#each person.customBadges as b (b.text)}
                    <span class="chat-role-badge chat-role-badge--{b.color} scale-90 origin-left shrink-0">
                      {b.text}
                    </span>
                  {/each}
                {/if}
              </div>

              <!-- 第二栏（中间）：来自哪个聊天室/站点标签统一左对齐 -->
              <div class="chat-mention-col-site">
                <span class="chat-role-badge chat-role-badge--{personBadgeType} scale-90 origin-left truncate max-w-full text-left">
                  {personBadgeLabel}
                </span>
              </div>

              <!-- 第三栏（最右）：离线时间 / 在线状态统一左对齐，单行不换行 -->
              <div class="chat-mention-col-status">
                {#if isRoomMention}
                  <span class="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium whitespace-nowrap text-left">
                    全体成员
                  </span>
                {:else if person.online}
                  {@const mentionFallbackLabel = person.presenceMode === "fallback"}
                  {@const mentionAwayLabel = !mentionFallbackLabel && person.isFocused === false}
                  <span
                    class="text-[11px] font-medium whitespace-nowrap text-left {mentionFallbackLabel
                      ? 'text-[var(--chat-meta-color)]'
                      : mentionAwayLabel
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400'}"
                  >
                    {mentionAwayLabel ? "离开" : "在线"}
                  </span>
                {:else}
                  <span class="text-[11px] text-[var(--chat-meta-color)] opacity-80 whitespace-nowrap text-left">
                    {formatOfflineTime(person.lastSeenAt)}
                  </span>
                {/if}
              </div>
            </button>
          {/each}
        {/if}
      </div>
    {/if}

    <!-- 正在输入浮动提示条（独立绝对定位，杜绝输入框跳动） -->
    {#if displayTypingUsers.length > 0}
      <div class="chat-typing-dock-indicator">
        <span class="chat-typing-dots">
          <span class="chat-typing-dot"></span>
          <span class="chat-typing-dot"></span>
          <span class="chat-typing-dot"></span>
        </span>
        <span>{typingDisplayText}</span>
      </div>
    {/if}

    <!-- 统一一体化毛玻璃输入卡片 -->
    <div class="chat-composer">
      <!-- 正在编辑提示条 -->
      {#if editingMessage}
        <div class="chat-reply-bar">
          <div class="chat-reply-bar-main">
            <span class="chat-reply-bar-label font-bold text-[var(--skin-accent)]">编辑消息</span>
            <span class="chat-reply-bar-text">
              {editingMessage.content}
            </span>
          </div>
          <button
            type="button"
            class="chat-reply-bar-close"
            aria-label="取消编辑"
            onclick={() => {
              editingMessage = null;
              clearInput();
              loadRoomDraft(roomId);
            }}
          >
            ×
          </button>
        </div>
      {/if}

      <!-- 正在回复提示条 -->
      {#if replyingTo}
        <div class="chat-reply-bar">
          <div class="chat-reply-bar-main">
            <span class="chat-reply-bar-label">回复 {replyingTo.name || "用户"}</span>
            <span class="chat-reply-bar-text">
              {formatChatReplyPreview(
                replyingTo.content,
                stickerMap,
                getChatAttachmentKind(replyingTo.attachments),
              )}
            </span>
          </div>
          <button
            type="button"
            class="chat-reply-bar-close"
            aria-label="取消回复"
            onclick={() => (replyingTo = null)}
          >
            ×
          </button>
        </div>
      {/if}


      <!-- 待发送附件预览条 -->
      {#if pendingImages.length > 0 || isUploadingImage || isUploadingMedia || uploadError}
        <div class="chat-attachment-bar flex flex-wrap items-center gap-2 border-b border-black/5 dark:border-white/10">
          {#each pendingImages as att, idx (att.url)}
            {#if att.type === "image"}
              <div class="relative w-14 h-14 rounded-lg overflow-hidden border border-[var(--chat-divider-color)] bg-black/10 shrink-0">
                <img src={att.url} alt="待发送图片" class="w-full h-full object-cover" />
                <button
                  type="button"
                  aria-label="移除图片"
                  class="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/65 text-white border-none text-[10px] leading-none flex items-center justify-center cursor-pointer"
                  onclick={() => removePendingImage(idx)}
                >
                  ×
                </button>
              </div>
            {:else}
              <div class="relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-[var(--skin-line)] bg-[var(--btn-regular-bg)] max-w-[14rem] shrink-0">
                <span class="text-base shrink-0">
                  {att.type === "audio" ? "🎵" : att.type === "video" ? "🎬" : "📎"}
                </span>
                <div class="min-w-0 flex-1">
                  <div class="text-xs font-medium truncate text-[var(--skin-text)]">{att.name || "附件"}</div>
                  {#if att.size}
                    <div class="text-[10px] text-[var(--chat-meta-color)]">
                      {att.size > 1024 * 1024 ? `${(att.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(att.size / 1024)} KB`}
                    </div>
                  {/if}
                </div>
                <button
                  type="button"
                  aria-label="移除附件"
                  class="w-4 h-4 rounded-full bg-black/40 hover:bg-black/70 text-white border-none text-[10px] leading-none flex items-center justify-center cursor-pointer ml-1"
                  onclick={() => removePendingImage(idx)}
                >
                  ×
                </button>
              </div>
            {/if}
          {/each}
          {#if isUploadingImage || isUploadingMedia}
            <span class="text-xs text-[var(--chat-accent-text)] animate-pulse">附件上传中...</span>
          {/if}
          {#if uploadError}
            <span class="text-xs text-red-500">{uploadError}</span>
          {/if}
          {#if hasPendingImage || uploadNote}
            <div class="chat-attach-meta">
              <span class="chat-upload-note">{uploadError || isUploadingImage ? "" : uploadNote}</span>
              {#if hasPendingImage}
                <label class="chat-original-check">
                  <input
                    type="checkbox"
                    checked={imageQuality === "original"}
                    disabled={isUploadingImage || isSendingAttachments}
                    onchange={() => toggleImageQuality()}
                  />
                  <span>原图发送</span>
                </label>
              {/if}
            </div>
          {/if}
        </div>
      {/if}

      <!-- 全宽输入区域 -->
      {#if isPreviewingMarkdown}
        <div
          class="chat-input-preview-box custom-scrollbar"
          tabindex="0"
          role="region"
          aria-label="Markdown 实时预览区域"
          onkeydown={(e) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) {
              e.preventDefault();
              toggleMarkdownPreview();
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              toggleMarkdownPreview();
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        >
          <div class="chat-input-preview-header">
            <span class="chat-input-preview-badge">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Markdown 实时预览
            </span>
            <div class="flex items-center gap-2">
              <span class="hidden md:inline text-[0.6875rem] text-[var(--chat-meta-color)]">
                按 Enter 直接发送 · 按 Esc / Ctrl+P 返回编辑
              </span>
              <button
                type="button"
                class="chat-input-preview-close"
                onclick={toggleMarkdownPreview}
                title="返回编辑"
              >
                返回编辑
              </button>
            </div>
          </div>
          <div class="chat-input-preview-body">
            {#if inputText.trim().length > 0}
              <ChatMarkdownContent
                content={inputText}
                stickerMap={stickerMap}
                mentionEntities={inputMentionEntities}
                currentUserKey={currentUser?.userKey}
                chatServerUrl={chatServerUrl}
              />
            {:else}
              <div class="text-xs text-[var(--chat-meta-color)] italic py-3 select-none">
                当前暂无文字内容。在输入框编写 Markdown 语法后可在此实时预览效果。
              </div>
            {/if}
          </div>
        </div>
      {/if}
      <div
        bind:this={inputEl}
        contenteditable="true"
        role="textbox"
        aria-label="聊天消息"
        aria-multiline="true"
        tabindex="0"
        data-empty={!inputText.trim() ? "true" : undefined}
        data-placeholder={currentUser
          ? `以 ${currentUser.name} 的身份在 #${roomName} 说点什么...`
          : `在 #${roomName} 中说点什么（发送前需先登录）...`}
        class="chat-input-box custom-scrollbar {isPreviewingMarkdown ? 'hidden' : ''}"
        oninput={syncInputState}
        onclick={syncInputState}
        onblur={() => {
          if (!inputText.trim() && !inputEl?.querySelector(".chat-mention-pill")) {
            if (inputEl) {
              inputEl.innerHTML = "";
              inputEl.dataset.empty = "true";
            }
          }
        }}
        onkeyup={(e) => {
          if (
            e.key !== "ArrowUp" &&
            e.key !== "ArrowDown" &&
            e.key !== "Enter" &&
            e.key !== "Tab" &&
            e.key !== "Escape"
          ) {
            syncInputState();
          }
        }}
        onkeydown={handleKeydown}
        onpaste={handlePaste}
      ></div>

      <!-- 单行底栏：左 表情/传图 + 右 快捷提示/发送按钮 -->
      <div class="chat-input-toolbar flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 md:gap-1 shrink-0">
          <!-- 颜文字 / QQ / 贴纸统一选择器按钮 -->
          <ChatTooltip text="表情与贴纸" align="left">
            <button
              type="button"
              class="chat-tool-btn {activePopover === 'emoji' ? 'text-[var(--primary)] bg-[var(--btn-plain-bg-hover)]' : ''}"
              aria-label="表情与贴纸"
              aria-expanded={activePopover === "emoji"}
              aria-haspopup="dialog"
              onclick={() => {
                if (!currentUser) {
                  onRequireAuth();
                  return;
                }
                composerPickerMounted = true;
                activePopover = activePopover === "emoji" ? "none" : "emoji";
              }}
            >
              <svg class="w-5 h-5 md:w-[1.15rem] md:h-[1.15rem]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                <line x1="9" y1="9" x2="9.01" y2="9" />
                <line x1="15" y1="9" x2="15.01" y2="9" />
              </svg>
            </button>
          </ChatTooltip>

          <!-- 多媒体与文件附件上传按钮 -->
          <input
            bind:this={mediaFileInputEl}
            type="file"
            multiple
            class="hidden"
            onchange={(e) => {
              if (e.currentTarget.files) {
                void processMediaFiles(e.currentTarget.files);
              }
            }}
          />
          <ChatTooltip text="发送图片或附件">
            <button
              type="button"
              class="chat-tool-btn"
              aria-label="发送图片或附件"
              disabled={isUploadingImage || isUploadingMedia}
              onclick={() => {
                if (!currentUser) {
                  onRequireAuth();
                  return;
                }
                mediaFileInputEl?.click();
              }}
            >
              <svg class="w-5 h-5 md:w-[1.15rem] md:h-[1.15rem]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
          </ChatTooltip>

          <!-- 发起投票按钮 -->
          <ChatTooltip text="发起投票">
            <button
              type="button"
              class="chat-tool-btn"
              aria-label="发起投票"
              onclick={() => {
                if (!currentUser) {
                  onRequireAuth();
                  return;
                }
                onOpenPollModal?.();
              }}
            >
              <svg class="w-5 h-5 md:w-[1.15rem] md:h-[1.15rem]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 3v18h18" />
                <rect x="7" y="10" width="3" height="8" rx="1" />
                <rect x="13" y="5" width="3" height="13" rx="1" />
                <rect x="19" y="13" width="3" height="5" rx="1" />
              </svg>
            </button>
          </ChatTooltip>

          <!-- Markdown 预览切换按钮 -->
          <ChatTooltip text={isPreviewingMarkdown ? "切回编辑 (Ctrl+P)" : "预览 Markdown (Ctrl+P)"}>
            <button
              type="button"
              class="chat-tool-btn {isPreviewingMarkdown ? 'text-[var(--primary)] bg-[var(--btn-plain-bg-hover)]' : ''}"
              aria-label={isPreviewingMarkdown ? "切回文本编辑" : "预览 Markdown"}
              onclick={toggleMarkdownPreview}
            >
              {#if isPreviewingMarkdown}
                <!-- 铅笔切回编辑图标 -->
                <svg class="w-5 h-5 md:w-[1.15rem] md:h-[1.15rem]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              {:else}
                <!-- 眼睛预览图标 -->
                <svg class="w-5 h-5 md:w-[1.15rem] md:h-[1.15rem]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              {/if}
            </button>
          </ChatTooltip>
        </div>

        <div class="flex items-center gap-1.5 md:gap-2 shrink-0">
          <span class="hidden xl:inline text-[0.6875rem] text-[var(--chat-meta-color)] select-none">
            {#if currentUser}
              Enter 发送 · Shift+Enter 换行 · 支持 Markdown 与粘贴图片
            {:else}
              发送消息前需先登录或填写访客信息
            {/if}
          </span>
          <ChatTooltip text="分享博客文章与说说">
            <button
              type="button"
              class="chat-tool-btn text-[var(--skin-text)] hover:text-[var(--primary)] shrink-0"
              aria-label="分享博客文章与说说"
              onclick={() => {
                if (!currentUser) {
                  onRequireAuth();
                  return;
                }
                showShareModal = true;
              }}
            >
              <svg class="w-5 h-5 md:w-[1.15rem] md:h-[1.15rem]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </ChatTooltip>
          <button
            type="button"
            class="chat-send-btn h-9.5! md:h-8! px-4.5! md:px-4! text-[13.5px]! md:text-xs! rounded-xl! md:rounded-lg! shrink-0"
            disabled={isUploadingImage || isUploadingMedia || isSendingAttachments}
            onclick={handleSend}
          >
            <span>{isSendingAttachments ? "上传中" : "发送"}</span>
            <svg class="w-4 h-4 md:w-3.5 md:h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- 移动端：点击消息气泡弹出的底部大按钮操作抽屉 -->
  {#if mobileActionTarget}
    {@const activeMsg = messages.find((m) => m.msgUid === mobileActionTarget?.message.msgUid) ?? mobileActionTarget.message}
    {@const activeIsPinned = pinnedUids.includes(activeMsg.msgUid)}
    {@const previewText = formatChatReplyPreview(
      activeMsg.content,
      stickerMap,
      getChatAttachmentKind(activeMsg.attachments),
    )}
    <dialog
      bind:this={mobileActionDialog}
      use:openMobileActionDialog
      out:fadeChatSheetBackdrop
      class="chat-mobile-action-sheet-wrap"
      aria-label="消息操作菜单"
      oncancel={(e) => {
        e.preventDefault();
        closeMobileActions();
      }}
    >
      <button
        type="button"
        class="chat-mobile-action-sheet-backdrop"
        aria-label="关闭消息操作菜单"
        onpointerdown={(e) => (pressedActionBackdrop = e.currentTarget)}
        onpointercancel={() => (pressedActionBackdrop = null)}
        onclick={(e) => {
          if (e.detail === 0 || e.currentTarget === pressedActionBackdrop) {
            closeMobileActions();
          }
          pressedActionBackdrop = null;
        }}
      ></button>

      <div class="chat-mobile-action-sheet" out:closeChatActionSheet>
        <div class="w-9 h-1 rounded-full bg-black/15 dark:bg-white/20 mx-auto mb-2.5 shrink-0" aria-hidden="true"></div>

        <!-- 选中的消息预览头部 -->
        <div class="flex items-center justify-between gap-2.5 px-1 pb-2.5 mb-2.5 border-b border-[var(--skin-line)]">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <ChatAvatar
              src={activeMsg.avatar}
              name={mobileActionTarget.senderDisplayName}
              size="sm"
            />
            <div class="min-w-0 flex-1">
              <div class="text-xs font-bold text-[var(--skin-text)] truncate">
                {mobileActionTarget.senderDisplayName}
              </div>
              <div class="text-xs text-[var(--chat-meta-color)] truncate mt-0.5">
                {previewText || "消息"}
              </div>
            </div>
          </div>
          <button
            type="button"
            class="chat-drawer-close-btn shrink-0"
            aria-label="关闭菜单"
            onclick={closeMobileActions}
          >
            <svg class="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <!-- 第一排：大号快捷表情回应 + 展开更多按钮 -->
        {#if onReaction}
          <div class="flex items-center gap-1.5 mb-3 overflow-x-auto custom-scrollbar py-0.5">
            {#each QUICK_REACTION_PRESETS as em (em)}
              {@const isMyReaction = Boolean(currentUser?.userKey && activeMsg.reactions?.[em]?.includes(currentUser.userKey))}
              <button
                type="button"
                class="chat-mobile-sheet-emoji-btn shrink-0 {isMyReaction ? 'is-active' : ''}"
                aria-label={`回应表情 ${em}`}
                onclick={() => {
                  const uid = activeMsg.msgUid;
                  closeMobileActions();
                  onReaction?.(uid, em);
                }}
              >
                <span>{em}</span>
              </button>
            {/each}
            <button
              type="button"
              class="chat-mobile-sheet-emoji-btn chat-mobile-sheet-more-btn shrink-0 {mobileShowMoreReactions ? 'is-active' : ''}"
              aria-label="更多表情回应"
              onclick={() => {
                mobileShowMoreReactions = !mobileShowMoreReactions;
              }}
            >
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>

          {#if mobileShowMoreReactions}
            <div class="mb-3 flex h-[min(260px,45dvh)] flex-col overflow-hidden rounded-xl border border-[var(--chat-divider-color)] bg-[var(--card-bg)]">
              <ChatStickerPicker
                variant="reaction"
                stickerPacks={stickerPacks}
                chatServerUrl={chatServerUrl}
                onSelect={(em) => {
                  const uid = activeMsg.msgUid;
                  closeMobileActions();
                  onReaction?.(uid, em);
                }}
                onClose={() => {
                  mobileShowMoreReactions = false;
                }}
              />
            </div>
          {/if}
        {/if}

        <!-- 第二排：带图标与中文文字的大操作按钮网格 -->
        <div class="grid grid-cols-2 gap-2">
          {#if activeMsg.kind === "user"}
            <button
              type="button"
              class="chat-mobile-sheet-action-btn"
              onclick={() => {
                const target = activeMsg;
                releaseMobileActions();
                handleStartReply(target);
              }}
            >
              <svg class="w-4.5 h-4.5 text-[var(--skin-accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="9 17 4 12 9 7" />
                <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
              </svg>
              <span>回复消息</span>
            </button>
          {/if}

          {#if currentUser?.isAdmin && onPinMessage}
            <button
              type="button"
              class="chat-mobile-sheet-action-btn"
              onclick={() => {
                const uid = activeMsg.msgUid;
                const wasPinned = activeIsPinned;
                closeMobileActions();
                onPinMessage?.(uid, wasPinned);
              }}
            >
              <svg class="w-4.5 h-4.5 text-[var(--skin-accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="12" y1="17" x2="12" y2="22" />
                <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
              </svg>
              <span>{activeIsPinned ? "取消置顶" : "置顶消息"}</span>
            </button>
          {/if}

          {#if activeMsg.content && activeMsg.content.trim()}
            <button
              type="button"
              class="chat-mobile-sheet-action-btn"
              onclick={async () => {
                const text = activeMsg.content;
                closeMobileActions();
                try {
                  await navigator.clipboard.writeText(text);
                  onNotify?.("已复制消息内容");
                } catch {
                  onNotify?.("复制失败，请手动长按选择复制");
                }
              }}
            >
              <svg class="w-4.5 h-4.5 text-[var(--skin-accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
              <span>复制文本</span>
            </button>
          {/if}

          {#if activeMsg.kind === "user"}
            <button
              type="button"
              class="chat-mobile-sheet-action-btn"
              onclick={() => {
                const target = activeMsg;
                releaseMobileActions();
                handleOpenThread(target);
              }}
            >
              <svg class="w-4.5 h-4.5 text-[var(--skin-accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                <path d="M8 9h8" />
                <path d="M8 13h5" />
              </svg>
              <span>线程回复</span>
            </button>
          {/if}

          {#if mobileActionTarget.canEdit}
            <button
              type="button"
              class="chat-mobile-sheet-action-btn"
              onclick={() => {
                const m = activeMsg;
                releaseMobileActions();
                handleStartEdit(m);
              }}
            >
              <svg class="w-4.5 h-4.5 text-[var(--skin-accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
              <span>编辑消息</span>
            </button>
          {/if}

          {#if mobileActionTarget.canRecall && onRecallMessage}
            <button
              type="button"
              class="chat-mobile-sheet-action-btn is-warning"
              onclick={() => {
                const uid = activeMsg.msgUid;
                closeMobileActions();
                onRecallMessage?.(uid);
              }}
            >
              <svg class="w-4.5 h-4.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
              <span>撤回消息</span>
            </button>
          {/if}

          {#if !mobileActionTarget.isSelf && activeMsg.name}
            <button
              type="button"
              class="chat-mobile-sheet-action-btn"
              onclick={() => {
                const name = activeMsg.name;
                const key = activeMsg.userKey;
                releaseMobileActions();
                onMentionUser(name, key);
              }}
            >
              <span class="w-4.5 h-4.5 inline-flex items-center justify-center font-bold text-[15px] text-[var(--skin-accent)] shrink-0">@</span>
              <span>提及 Ta</span>
            </button>
          {/if}

          {#if activeMsg.userKey && onOpenUserProfile}
            <button
              type="button"
              class="chat-mobile-sheet-action-btn"
              onclick={() => {
                const m = activeMsg;
                releaseMobileActions();
                onOpenUserProfile?.({
                  userKey: m.userKey,
                  name: m.name,
                  avatar: m.avatar,
                  url: m.url,
                  site: m.site,
                  siteUrl: m.siteUrl,
                  badge: m.badge,
                  badgeType: m.badgeType,
                  customBadges: m.customBadges,
                  isAdmin: m.isAdmin,
                });
              }}
            >
              <svg class="w-4.5 h-4.5 text-[var(--skin-accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>查看资料</span>
            </button>
          {/if}

          <button
            type="button"
            class="chat-mobile-sheet-action-btn"
            onclick={() => {
              const target = activeMsg;
              releaseMobileActions();
              handleViewSource(target);
            }}
          >
            <svg class="w-4.5 h-4.5 text-[var(--skin-accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            <span>查看源码</span>
          </button>

          {#if mobileActionTarget.canDelete}
            <button
              type="button"
              class="chat-mobile-sheet-action-btn is-danger"
              onclick={() => {
                const uid = activeMsg.msgUid;
                closeMobileActions();
                onDeleteMessage(uid);
              }}
            >
              <svg class="w-4.5 h-4.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
              <span>删除消息</span>
            </button>
          {/if}
        </div>
      </div>
    </dialog>
  {/if}

  {#if (activeThreadRootUid && !ChatThreadModalComp) || (sourceModalMessage && !ChatMessageSourceModalComp)}
    <ChatModal
      open={true}
      title={sourceModalMessage && !ChatMessageSourceModalComp ? "查看消息源码" : "线程回复"}
      onClose={() => {
        if (sourceModalMessage && !ChatMessageSourceModalComp) {
          sourceModalMessage = null;
        } else {
          activeThreadRootUid = "";
          activeThreadInitialRoot = null;
        }
      }}
    >
      <div class="flex items-center justify-center gap-2 py-10 text-sm text-[var(--chat-meta-color)]" role="status">
        <svg class="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" opacity="0.25"/><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <span>正在加载...</span>
      </div>
    </ChatModal>
  {/if}

  {#if ChatThreadModalComp}
    <ChatThreadModalComp
      open={Boolean(activeThreadRootUid)}
      roomId={roomId}
      rootUid={activeThreadRootUid}
      initialRootMessage={activeThreadInitialRoot}
      roomMessages={messages}
      currentUser={currentUser}
      mentionCandidates={mergedMentionCandidates}
      formatMentionLabel={formatCandidateMentionName}
      isInterconnectRoom={isInterconnectRoom}
      chatServerUrl={chatServerUrl}
      interconnectSites={interconnectSites}
      stickerMap={stickerMap}
      userNameMap={userNameMap}
      userProfileMap={userProfileMap}
      readReceipts={readReceipts}
      clockOffsetMs={clockOffsetMs}
      onClose={() => {
        activeThreadRootUid = "";
        activeThreadInitialRoot = null;
      }}
      onSendMessage={onSendMessage}
      onEditMessage={onEditMessage}
      onRecallMessage={onRecallMessage}
      onDeleteMessage={onDeleteMessage}
      onReaction={onReaction}
      onVotePoll={onVotePoll}
      onEndPoll={onEndPoll}
      onOpenUserProfile={onOpenUserProfile}
      onViewSource={handleViewSource}
      onRequireAuth={onRequireAuth}
    />
  {/if}

  {#if ChatMessageSourceModalComp}
    <ChatMessageSourceModalComp
      open={Boolean(sourceModalMessage)}
      message={sourceModalMessage}
      roomId={roomId}
      isInterconnectRoom={isInterconnectRoom}
      chatServerUrl={chatServerUrl}
      onClose={() => {
        sourceModalMessage = null;
      }}
      onNotify={onNotify}
    />
  {/if}

  {#if showShareModal}
    <ChatShareModal
      open={showShareModal}
      onClose={() => {
        showShareModal = false;
      }}
      onShare={handleShareBlogContent}
    />
  {/if}
</div>
