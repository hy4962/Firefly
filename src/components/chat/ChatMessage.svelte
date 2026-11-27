<script lang="ts">
import { SvelteSet } from "svelte/reactivity";
import ChatArticleCard from "./ChatArticleCard.svelte";
import ChatAudioAttachment from "./ChatAudioAttachment.svelte";
import ChatAvatar from "./ChatAvatar.svelte";
import ChatFileAttachment from "./ChatFileAttachment.svelte";
import ChatImagePreview from "./ChatImagePreview.svelte";
import ChatMarkdownContent from "./ChatMarkdownContent.svelte";
import ChatMessageActivityModal from "./ChatMessageActivityModal.svelte";
import ChatMusicCard from "./ChatMusicCard.svelte";
import ChatStickerPicker from "./ChatStickerPicker.svelte";
import ChatStickerImage from "./ChatStickerImage.svelte";
import ChatTooltip from "./ChatTooltip.svelte";
import ChatVideoPreview from "./ChatVideoPreview.svelte";
import {
	formatChatFullDateTime,
	formatChatMessageTime,
	isExternalMatrixIdentity,
	normalizeDotSpacing,
	resolveExternalOrigin,
	sanitizeChatUrl,
} from "./chatClient";
import type { InterconnectSite } from "./chatConfig";
import { positionChatFloating } from "./chatFloating";
import { getChatMessageAttachments } from "./chatMarkdown";
import { provideChatMediaRetry } from "./chatMediaRetry";
import {
	QUICK_REACTION_PRESETS,
	resolveReactionDisplay,
} from "./chatReactions";
import { parseRecallNotice, parseRoomActivityActor } from "./chatRoomActivity";
import {
	type ChatShareData,
	parseLxArticleShare,
	parseLxMomentShare,
	parseLxMusicShare,
} from "./chatShareProtocol";
import type {
	ChatMessageRecord,
	ChatReadReceipt,
	ChatThreadSummary,
	ChatUserDetailSeed,
	RoomMusicState,
} from "./chatTypes";
import type { ChatMusicTrack } from "./musicTypes";
import type { PlaylistAuth } from "./playlistClient";
import LottieSticker from "./LottieSticker.svelte";
import {
	formatChatReplyPreview,
	formatStickerAttachmentAlt,
	getChatReplyAttachmentKind,
	parseChatSegments,
	type StickerItem,
	type StickerPack,
} from "./stickerLoader";

interface Props {
	message: ChatMessageRecord;
	isSelf: boolean;
	isMentionedMe?: boolean;
	isHighlighted?: boolean;
	currentUserKey?: string;
	isAdmin?: boolean;
	isPinned?: boolean;
	isInterconnectRoom?: boolean;
	inThreadView?: boolean;
	threadSummary?: ChatThreadSummary | null;
	orphanThreadRootUid?: string;
	canRecall?: boolean;
	canEdit?: boolean;
	canDelete?: boolean;
	stickerMap: Map<string, StickerItem>;
	stickerPacks?: StickerPack[];
	chatServerUrl?: string;
	interconnectSites?: InterconnectSite[];
	userNameMap?: Map<string, string>;
	userProfileMap?: Map<string, ChatUserDetailSeed>;
	readReceipts?: ChatReadReceipt[];
	onRecall?: (msgUid: string) => void;
	onDelete?: (msgUid: string) => void;
	onReply?: (message: ChatMessageRecord) => void;
	onOpenThread?: (message: ChatMessageRecord) => void;
	onOpenThreadByUid?: (rootUid: string) => void;
	onViewSource?: (message: ChatMessageRecord) => void;
	onEdit?: (message: ChatMessageRecord) => void;
	onPin?: (msgUid: string, unpin?: boolean) => void;
	onReaction?: (msgUid: string, key: string) => void;
	onVotePoll?: (pollUid: string, answerId: string) => void;
	onEndPoll?: (pollUid: string) => void;
	onJumpToMessage?: (msgUid: string) => void;
	jumpingToMessageUid?: string;
	onOpenUserProfile?: (seed: ChatUserDetailSeed) => void;
	onMention?: (name: string, userKey?: string) => void;
	musicState?: RoomMusicState | null;
	playlistAuth?: PlaylistAuth;
	onEnqueueTrack?: (
		track: ChatMusicTrack,
		anchor?: HTMLElement,
	) => Promise<boolean> | void;
	onRequireAuth?: () => void;
	onFavoriteChanged?: () => void;
	onNotify?: (msg: string, tone?: "default" | "error" | "success") => void;
	onOpenMobileActions?: (
		message: ChatMessageRecord,
		meta: {
			isSelf: boolean;
			senderDisplayName: string;
			canRecall: boolean;
			canEdit: boolean;
			canDelete: boolean;
			isPinned: boolean;
		},
	) => void;
}

const {
	message,
	isSelf,
	isMentionedMe = false,
	isHighlighted = false,
	currentUserKey = "",
	isAdmin = false,
	isPinned = false,
	isInterconnectRoom = false,
	inThreadView = false,
	threadSummary = null,
	orphanThreadRootUid = "",
	canRecall = false,
	canEdit = false,
	canDelete = false,
	stickerMap,
	stickerPacks = [],
	chatServerUrl,
	interconnectSites = [],
	userNameMap = new Map(),
	userProfileMap = new Map(),
	readReceipts = [],
	onRecall,
	onDelete,
	onReply,
	onOpenThread,
	onOpenThreadByUid,
	onViewSource,
	onEdit,
	onPin,
	onReaction,
	onVotePoll,
	onEndPoll,
	onJumpToMessage,
	jumpingToMessageUid = "",
	onOpenUserProfile,
	onMention,
	musicState = null,
	playlistAuth,
	onEnqueueTrack,
	onRequireAuth,
	onFavoriteChanged,
	onNotify,
	onOpenMobileActions,
}: Props = $props();

let showQuickReaction = $state(false);
let quickReactionReady = $state(false);
let prepareReactionPicker = $state(false);
let showReactionPicker = $state(false);
let showMoreActions = $state(false);
let actionsMounted = $state(false);
let copySuccess = $state(false);
let reactionEl = $state<HTMLElement | null>(null);
let quickReactionBar = $state<HTMLDivElement | null>(null);
let reactionMoreButton = $state<HTMLButtonElement | null>(null);
let moreActionsEl = $state<HTMLElement | null>(null);

function closeReactionMenus() {
	showReactionPicker = false;
	showQuickReaction = false;
	quickReactionReady = false;
	prepareReactionPicker = false;
}

$effect(() => {
	if (!quickReactionReady) return;
	// Let the quick bar paint before preparing the hidden, positioned picker.
	let frame = requestAnimationFrame(() => {
		frame = requestAnimationFrame(() => {
			prepareReactionPicker = true;
		});
	});
	return () => cancelAnimationFrame(frame);
});

function closeReactionPicker() {
	showReactionPicker = false;
	if (showQuickReaction) reactionMoreButton?.focus({ preventScroll: true });
}

function showReactionPopover(node: HTMLDivElement) {
	// Keep the picker in DOM order for focus and outside-click handling.
	node.showPopover?.();
}

async function handleCopy(e: MouseEvent) {
	e.stopPropagation();
	if (!message.content) return;
	try {
		await navigator.clipboard.writeText(message.content);
		copySuccess = true;
		setTimeout(() => {
			copySuccess = false;
		}, 1200);
	} catch {
		// ignore
	}
}

let bubbleW = $state(0);
let bubbleH = $state(0);

function trackBubbleBox(node: HTMLElement, active: boolean) {
	let ro: ResizeObserver | null = null;
	const sync = () => {
		const rect = node.getBoundingClientRect();
		const w = Math.round(rect.width * 100) / 100;
		const h = Math.round(rect.height * 100) / 100;
		if (w !== bubbleW) bubbleW = w;
		if (h !== bubbleH) bubbleH = h;
	};
	const start = () => {
		sync();
		if (typeof ResizeObserver === "undefined" || ro) return;
		ro = new ResizeObserver(sync);
		ro.observe(node);
	};
	const stop = () => {
		ro?.disconnect();
		ro = null;
	};
	if (active) start();
	return {
		update(nextActive: boolean) {
			if (nextActive) start();
			else stop();
		},
		destroy: stop,
	};
}

const mentionedBubblePath = $derived.by(() => {
	if (!isMentionedMe) return "";
	const w = bubbleW;
	const h = bubbleH;
	if (w <= 0 || h <= 0) return "";
	const r = Math.max(6, Math.min(18, Math.floor(Math.min(w, h) / 2)));
	const ty = Math.min(13, Math.max(8, h - r));
	return [
		"M -5 0",
		`L ${w - r} 0`,
		`A ${r} ${r} 0 0 1 ${w} ${r}`,
		`L ${w} ${h - r}`,
		`A ${r} ${r} 0 0 1 ${w - r} ${h}`,
		`L ${r} ${h}`,
		`A ${r} ${r} 0 0 1 0 ${h - r}`,
		`L 0 ${ty}`,
		`C 0 ${ty * 0.58}, -2.4 2.8, -5.8 1.3`,
		"C -6.1 1.15, -6.2 0.7, -6.0 0.35",
		"C -5.8 0.08, -5.45 0, -5 0",
		"Z",
	].join(" ");
});

$effect(() => {
	if (!showQuickReaction && !showMoreActions && !showReactionPicker) return;
	function handleOutside(e: PointerEvent) {
		const target = e.target as Node | null;
		if (!target || !document.body.contains(target)) return;
		if (
			(showQuickReaction || showReactionPicker) &&
			!reactionEl?.contains(target)
		) {
			closeReactionMenus();
		}
		if (
			showMoreActions &&
			moreActionsEl &&
			!moreActionsEl.contains(target)
		) {
			showMoreActions = false;
		}
	}
	function handleEscape(event: KeyboardEvent) {
		if (event.key !== "Escape" || event.defaultPrevented) return;
		const active = showMoreActions ? moreActionsEl : reactionEl;
		const restoreFocus = active?.contains(document.activeElement);
		showMoreActions = false;
		closeReactionMenus();
		if (restoreFocus) active?.querySelector("button")?.focus({ preventScroll: true });
	}
	window.addEventListener("pointerdown", handleOutside, { capture: true });
	window.addEventListener("keydown", handleEscape);
	return () => {
		window.removeEventListener("pointerdown", handleOutside, { capture: true });
		window.removeEventListener("keydown", handleEscape);
	};
});
const mediaRetries = new SvelteSet<() => void>();
provideChatMediaRetry((retry) => {
	mediaRetries.add(retry);
	return () => { mediaRetries.delete(retry); };
});

function retryMessageMedia(event: MouseEvent) {
	event.stopPropagation();
	for (const retry of [...mediaRetries]) retry();
}

const segments = $derived(
	parseChatSegments(message.content, stickerMap),
);

const stickerSegments = $derived(
	segments.filter((seg) => seg.kind === "sticker"),
);
const isStickerOnly = $derived(
	message.attachments.length === 0 &&
		stickerSegments.length > 0 &&
		stickerSegments.length <= 3 &&
		stickerSegments.some((seg) => seg.category === "sticker") &&
		segments.every(
			(seg) =>
				seg.kind === "sticker" ||
				(seg.kind === "text" && seg.text.trim() === ""),
		),
);
const isStickerAttachmentOnly = $derived.by(() => {
	if (message.content.trim().length > 0) return false;
	if (
		!message.attachments ||
		message.attachments.length === 0 ||
		message.attachments.length > 3
	) {
		return false;
	}
	return message.attachments.every(
		(a) => a.type === "image" && Boolean(a.isSticker),
	);
});

const shareData = $derived<ChatShareData | null>(
	parseLxArticleShare(message.content) ??
		parseLxMomentShare(message.content) ??
		parseLxMusicShare(message.content),
);

function matchesSharedMusic(
	track: ChatMusicTrack | undefined | null,
	shared: ChatShareData | null,
): boolean {
	if (!track || !shared || shared.kind !== "music") return false;
	const sharedBare = (shared.sourceId || shared.id || "").replace(/^[a-z_]+:/i, "").trim();
	const trackBare = (track.sourceId || track.id || "").replace(/^[a-z_]+:/i, "").trim();
	if (shared.id && track.id && shared.id === track.id) return true;
	if (sharedBare && trackBare && sharedBare === trackBare) return true;
	const sTitle = (shared.title || "").trim().toLowerCase();
	const tTitle = (track.title || "").trim().toLowerCase();
	const sArtist = (shared.artist || "").trim().toLowerCase();
	const tArtist = (track.artist || "").trim().toLowerCase();
	return Boolean(sTitle && tTitle && sTitle === tTitle && (!sArtist || !tArtist || sArtist === tArtist));
}

const isSharedMusicCurrent = $derived(
	Boolean(
		shareData?.kind === "music" &&
			matchesSharedMusic(musicState?.current?.track, shareData),
	),
);

const isSharedMusicQueued = $derived(
	Boolean(
		shareData?.kind === "music" &&
			(musicState?.queue ?? []).some((item) =>
				matchesSharedMusic(item.track, shareData),
			),
	),
);

const formattedTime = $derived.by(() => {
	if (!message.createdAt) return "";
	return formatChatMessageTime(message.createdAt);
});

const fullDateTimeTooltip = $derived.by(() => {
	if (!message.createdAt) return "";
	return formatChatFullDateTime(message.createdAt);
});

const replyPreviewText = $derived.by(() => {
	if (!message.replyTo) return "";
	return formatChatReplyPreview(
		message.replyTo.content,
		stickerMap,
		getChatReplyAttachmentKind(message.replyTo),
		message.replyTo.isRecalled,
	);
});

const isFromOurServer = $derived(
	message.userKey.endsWith(":matrix.lengxiqwq.com") ||
		message.userKey.includes("matrix.lengxiqwq.com"),
);

const isExternal = $derived(
	!isSelf &&
		!isFromOurServer &&
		isExternalMatrixIdentity(message),
);

const externalOrigin = $derived.by(() => {
	if (!isExternal) return null;
	return resolveExternalOrigin(
		{
			userKey: message.userKey,
			name: message.name,
			source: message.source,
			badge: message.badge,
			site: message.site,
			siteUrl: message.siteUrl,
			url: message.url,
		},
		interconnectSites,
	);
});

const cleanSenderName = $derived.by(() => {
	if (externalOrigin?.cleanName) return externalOrigin.cleanName;
	const rawName = message.name || "";
	const match = rawName.match(/^(.+?)\s*[·•・]\s*(.+)$/);
	return match ? match[1].trim() : rawName.trim();
});

const senderDisplayName = $derived.by(() => {
	const rawName = (message.name || "").trim();
	const hasDot =
		rawName.includes("·") || rawName.includes("•") || rawName.includes("・");

	// 1. 如果昵称本身已经规范化（自带点号和站点名称），100% 完整保留原本昵称
	if (hasDot) {
		return normalizeDotSpacing(rawName);
	}

	// 2. 只有未带站点后缀的裸昵称，才补充站点后缀
	if (isExternal && externalOrigin?.siteName) {
		return `${rawName || externalOrigin.cleanName} · ${externalOrigin.siteName}`;
	}
	if (isInterconnectRoom) {
		return `${rawName} · 冷汐的杂货铺`;
	}
	return normalizeDotSpacing(rawName);
});

const effectiveSenderUrl = $derived.by(() => {
	if (isFromOurServer || isSelf) return "https://lengxiqwq.com";
	if (externalOrigin?.site?.url) {
		return sanitizeChatUrl(externalOrigin.site.url, false);
	}
	if (message.url && !message.url.includes("matrix.lengxiqwq.com")) {
		return sanitizeChatUrl(message.url, false);
	}
	return sanitizeChatUrl(externalOrigin?.site?.url, false);
});

const safeAttachments = $derived(getChatMessageAttachments(message, stickerMap));

const roleBadge = $derived.by(() => {
	if (isExternal) return null;
	if (message.isAdmin) return { label: "站长", type: "host" as const };
	if (message.userKey.startsWith("waline:")) {
		return { label: "认证", type: "accent" as const };
	}
	if (message.userKey.startsWith("guest:")) {
		return { label: "访客", type: "tag" as const };
	}
	return message.badge
		? { label: message.badge, type: message.badgeType }
		: null;
});
const recallNoticeParsed = $derived(
	message.kind === "system" ? parseRecallNotice(message.content) : null,
);
const systemActor = $derived.by(() => {
	if (message.kind !== "system") return null;
	if (recallNoticeParsed) {
		return { name: recallNoticeParsed.actorName, detail: "" };
	}
	if (message.source !== "matrix" || !message.userKey || !message.name) return null;
	const prefix = `${message.name} `;
	return parseRoomActivityActor(message.content.trim(), message.name.trim()) ??
		(message.content.startsWith(prefix)
			? { name: message.name, detail: message.content.slice(prefix.length) }
			: null);
});
const systemActorAvatar = $derived(
	systemActor
		? resolveUserProfileSeed(message.userKey, systemActor.name, message.avatar).seed.avatar
		: undefined,
);

function handleOpenSystemUserProfile(name: string, explicitUserKey?: string) {
	if (!onOpenUserProfile) return;
	const cleanName = name.trim();
	const key =
		explicitUserKey ||
		(message.userKey && (!message.name || message.name === cleanName)
			? message.userKey
			: "");
	const useMessageMeta = Boolean(key && key === message.userKey);
	onOpenUserProfile({
		userKey: key,
		name: cleanName || "成员",
		avatar: useMessageMeta ? systemActorAvatar : undefined,
		url: useMessageMeta ? message.url : undefined,
		badge: useMessageMeta ? roleBadge?.label || message.badge : undefined,
		badgeType: useMessageMeta
			? roleBadge?.type || message.badgeType
			: undefined,
		customBadges: useMessageMeta ? message.customBadges : undefined,
		isAdmin: useMessageMeta ? message.isAdmin : undefined,
		authType: key
			? key.startsWith("waline:")
				? "waline"
				: "guest"
			: undefined,
	});
}

function handleOpenProfileForReplyTo() {
	if (!onOpenUserProfile || !message.replyTo) return;
	const rep = message.replyTo;
	if (!rep.userKey && !rep.name) return;
	onOpenUserProfile({
		userKey: rep.userKey || "",
		name: rep.name || "用户",
		authType: rep.userKey
			? rep.userKey.startsWith("waline:")
				? "waline"
				: "guest"
			: undefined,
	});
}

function handleAvatarClick() {
	if (onOpenUserProfile && message.userKey) {
		onOpenUserProfile({
			userKey: message.userKey,
			authType: (isExternal || message.source === "matrix" || message.userKey.startsWith("matrix:") || message.userKey.startsWith("@"))
				? undefined
				: message.userKey.startsWith("waline:") ? "waline" : "guest",
			name: message.name,
			avatar: message.avatar,
			url: message.url,
			site: message.site,
			siteUrl: message.siteUrl,
			badge: roleBadge?.label || message.badge,
			badgeType: roleBadge?.type || message.badgeType,
			customBadges: message.customBadges,
			isAdmin: message.isAdmin,
		});
		return;
	}
	if (!isSelf && !isExternal) {
		onMention?.(senderDisplayName || message.name, message.userKey);
	}
}

function handleMentionPillClick(userKey: string, text: string) {
	if (!onOpenUserProfile || userKey === "room") return;
	const profile = userProfileMap.get(userKey);
	const label = text.startsWith("@") ? text.slice(1) : text;
	onOpenUserProfile({ ...profile, userKey, name: profile?.name || label });
}

interface ReactionUserItem {
	userKey: string;
	displayName: string;
	isMe: boolean;
	seed: ChatUserDetailSeed;
}

function resolveUserProfileSeed(
	key: string,
	fallbackName?: string,
	fallbackAvatar?: string,
): { displayName: string; isMe: boolean; seed: ChatUserDetailSeed } {
	const isMe = Boolean(currentUserKey && key === currentUserKey);
	const profile =
		userProfileMap.get(key) ||
		(key.startsWith("matrix:")
			? userProfileMap.get(key.slice(7))
			: userProfileMap.get(`matrix:${key}`));
	let resolvedFallback = fallbackName || userNameMap.get(key) || "";
	if (!resolvedFallback) {
		if (key.startsWith("matrix:") || (key.startsWith("@") && key.includes(":"))) {
			const cleanKey = key.replace(/^matrix:/, "");
			const match = cleanKey.match(/^@([^:]+):(.+)$/);
			resolvedFallback = match ? match[1] : cleanKey;
		} else if (key.startsWith("waline:") || key.startsWith("guest:")) {
			resolvedFallback = key.split(":")[1] || key;
		} else {
			resolvedFallback = key;
		}
	}
	const isExt = isExternalMatrixIdentity({ userKey: key });
	const baseName = profile?.name || resolvedFallback || "成员";
	const origin = isExt
		? resolveExternalOrigin(
				{ name: baseName, userKey: key, site: profile?.site, siteUrl: profile?.siteUrl, url: profile?.url },
				interconnectSites,
			)
		: null;
	const displayName = origin?.siteName
		? `${origin.cleanName || baseName} (${origin.siteName})`
		: baseName;

	const seed: ChatUserDetailSeed = profile
		? {
				...profile,
				userKey: profile.userKey || key,
				name: origin?.cleanName || baseName,
				avatar: profile.avatar || fallbackAvatar,
			}
		: {
				userKey: key,
				name: origin?.cleanName || baseName,
				avatar: fallbackAvatar,
				authType: isExt
					? undefined
					: key.startsWith("waline:")
						? "waline"
						: key.startsWith("guest:")
							? "guest"
							: undefined,
			};
	return { displayName, isMe, seed };
}

function resolveReactionUsers(users: string[]): ReactionUserItem[] {
	if (!users || users.length === 0) return [];
	const seen = new Set<string>();
	const list: ReactionUserItem[] = [];
	for (const key of users) {
		if (!key || seen.has(key)) continue;
		seen.add(key);
		const { displayName, isMe, seed } = resolveUserProfileSeed(key);
		list.push({ userKey: key, displayName, isMe, seed });
	}
	return list;
}

let pointerStartPos: { id: number; x: number; y: number } | null = null;
let longPressTimer: number | null = null;
let pendingBubbleClick: "tap" | "long-press" | null = null;

let showActivityModal = $state(false);
let activityModalTab = $state<string>("read");

function handleOpenReadActivity(e: MouseEvent) {
	e.stopPropagation();
	activityModalTab = "read";
	showActivityModal = true;
}

function handleOpenReactionActivity(emoji: string) {
	activityModalTab = emoji;
	showActivityModal = true;
}

let reactionPressTimer: number | null = null;
let reactionPressPos: { x: number; y: number; id: number } | null = null;
let didLongPressReaction = false;

function handleReactionPointerDown(e: PointerEvent, emoji: string) {
	if (e.pointerType !== "touch") return;
	reactionPressPos = { x: e.clientX, y: e.clientY, id: e.pointerId };
	didLongPressReaction = false;
	if (reactionPressTimer !== null) {
		window.clearTimeout(reactionPressTimer);
	}
	reactionPressTimer = window.setTimeout(() => {
		reactionPressTimer = null;
		didLongPressReaction = true;
		try {
			navigator.vibrate?.(18);
		} catch {}
		handleOpenReactionActivity(emoji);
	}, 380);
}

function handleReactionPointerMove(e: PointerEvent) {
	if (reactionPressPos && reactionPressPos.id === e.pointerId) {
		if (
			Math.abs(e.clientX - reactionPressPos.x) > 8 ||
			Math.abs(e.clientY - reactionPressPos.y) > 8
		) {
			if (reactionPressTimer !== null) {
				window.clearTimeout(reactionPressTimer);
				reactionPressTimer = null;
			}
		}
	}
}

function handleReactionPointerUp() {
	if (reactionPressTimer !== null) {
		window.clearTimeout(reactionPressTimer);
		reactionPressTimer = null;
	}
	reactionPressPos = null;
}

function handleReactionPointerCancel() {
	if (reactionPressTimer !== null) {
		window.clearTimeout(reactionPressTimer);
		reactionPressTimer = null;
	}
	reactionPressPos = null;
}

function handleReactionContextMenu(e: MouseEvent) {
	e.preventDefault();
}

function handleReactionClick(e: MouseEvent, emoji: string) {
	e.stopPropagation();
	if (didLongPressReaction) {
		didLongPressReaction = false;
		e.preventDefault();
		return;
	}
	onReaction?.(message.msgUid, emoji);
}

function clearLongPress() {
	if (longPressTimer !== null) {
		window.clearTimeout(longPressTimer);
		longPressTimer = null;
	}
}

function cancelBubblePress() {
	clearLongPress();
	pointerStartPos = null;
	pendingBubbleClick = null;
}

$effect(() => cancelBubblePress);

function isBubbleActionTarget(target: EventTarget | null) {
	return (
		target instanceof Element &&
		!target.closest("a, button, video, audio, input, textarea, [data-chat-image], .chat-msg-floating-actions")
	);
}

function triggerMobileActions() {
	if (!onOpenMobileActions) return;
	onOpenMobileActions(message, {
		isSelf,
		senderDisplayName: senderDisplayName || message.name || "用户",
		canRecall,
		canEdit: Boolean(canEdit && !message.replyTo?.isRecalled),
		canDelete,
		isPinned,
	});
}

function handleBubblePointerDown(e: PointerEvent) {
	if (!e.isPrimary) return;
	cancelBubblePress();
	if (
		!onOpenMobileActions ||
		e.button !== 0 ||
		!isBubbleActionTarget(e.target) ||
		(e.pointerType === "mouse" &&
			!window.matchMedia("(width < 768px), (pointer: coarse)").matches)
	) {
		return;
	}
	pointerStartPos = { id: e.pointerId, x: e.clientX, y: e.clientY };
	longPressTimer = window.setTimeout(() => {
		longPressTimer = null;
		pointerStartPos = null;
		if (window.getSelection()?.toString().trim()) return;
		pendingBubbleClick = "long-press";
		triggerMobileActions();
	}, 460);
}

function isSameBubblePress(e: PointerEvent) {
	return (
		pointerStartPos?.id === e.pointerId &&
		Math.abs(e.clientX - pointerStartPos.x) <= 10 &&
		Math.abs(e.clientY - pointerStartPos.y) <= 10
	);
}

function handleBubblePointerMove(e: PointerEvent) {
	if (pointerStartPos?.id === e.pointerId && !isSameBubblePress(e)) cancelBubblePress();
}

function handleBubblePointerLeave(e: PointerEvent) {
	if (e.pointerType === "mouse" && pointerStartPos?.id === e.pointerId) cancelBubblePress();
}

function handleBubblePointerUp(e: PointerEvent) {
	if (pointerStartPos?.id !== e.pointerId) return;
	const isTap = isSameBubblePress(e);
	cancelBubblePress();
	if (isTap) pendingBubbleClick = "tap";
}

function handleBubbleClick(e: MouseEvent) {
	const pendingClick = pendingBubbleClick;
	pendingBubbleClick = null;
	// Let the actual tap finish before mounting an overlay over its target.
	if (pendingClick === "long-press") {
		e.preventDefault();
		e.stopPropagation();
		return;
	}
	if (
		pendingClick === "tap" &&
		!e.defaultPrevented &&
		isBubbleActionTarget(e.target) &&
		!window.getSelection()?.toString().trim()
	) {
		triggerMobileActions();
	}
}
</script>

{#snippet renderBubbleTail(isSelfMsg: boolean)}
  <svg
    class="chat-bubble-tail {isSelfMsg ? 'self' : 'other'}"
    width="8"
    height="14"
    viewBox="-7 0 8 14"
    aria-hidden="true"
  >
    <path
      class="chat-bubble-tail-shadow"
      transform="translate(0 1)"
      d="M 1 0 L 1 13 L 0 13 C 0 7.5, -2.4 2.8, -5.8 1.3 C -6.1 1.15, -6.2 0.7, -6.0 0.35 C -5.8 0.08, -5.45 0, -5 0 Z"
    />
    <path
      class="chat-bubble-tail-shape"
      d="M 1 0 L 1 13 L 0 13 C 0 7.5, -2.4 2.8, -5.8 1.3 C -6.1 1.15, -6.2 0.7, -6.0 0.35 C -5.8 0.08, -5.45 0, -5 0 Z"
    />
  </svg>
{/snippet}

{#snippet replyQuoteBlock()}
  {#if message.replyTo}
    {@const locating = !message.replyTo.isRecalled && jumpingToMessageUid === message.replyTo.msgUid}
    <button
      type="button"
      class="chat-reply-quote {isSelf ? 'self' : 'other'} {message.replyTo.isRecalled ? 'recalled' : ''} {locating ? 'pr-8!' : ''}"
      aria-busy={locating}
      onclick={() => {
        if (message.replyTo) {
          if (!message.replyTo.isRecalled) {
            onJumpToMessage?.(message.replyTo.msgUid);
          } else {
            handleOpenProfileForReplyTo();
          }
        }
      }}
    >
      <span class="chat-reply-quote-author">{message.replyTo.name || "用户"}</span>
      <span class="chat-reply-quote-text">{replyPreviewText}</span>
      {#if locating}
        <span class="absolute right-2.5 top-0 bottom-0 flex items-center" aria-hidden="true">
          <svg class="w-3 h-3 motion-safe:animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle class="opacity-25" cx="12" cy="12" r="10" />
            <path stroke-linecap="round" d="M12 2a10 10 0 0 1 10 10" />
          </svg>
        </span>
      {/if}
    </button>
  {/if}
{/snippet}

{#snippet renderFloatingActions(isSelfMsg: boolean)}
  {@const canCopy = Boolean(message.content && message.content.trim())}
  {@const canThreadMsg = Boolean(!inThreadView && onOpenThread && message.kind === "user")}
  {@const canViewSource = Boolean(onViewSource)}
  {@const canEditMsg = Boolean(onEdit && canEdit && !message.replyTo?.isRecalled)}
  {@const canPinMsg = Boolean(isAdmin && onPin)}
  {@const canRecallMsg = Boolean(canRecall && onRecall)}
  {@const canDeleteMsg = Boolean(canDelete && onDelete)}
  {@const hasMoreActions = canCopy || canThreadMsg || canEditMsg || canPinMsg || canViewSource || canRecallMsg || canDeleteMsg}
  {#if onReaction || onReply || hasMoreActions || mediaRetries.size > 0}
    <div
      class="chat-msg-floating-actions {isSelfMsg ? 'self' : 'other'} {showQuickReaction || showMoreActions || showReactionPicker || mediaRetries.size > 0 ? 'is-active' : ''} {mediaRetries.size > 0 ? 'has-media-retry' : ''}"
      role="toolbar"
      aria-label="消息快捷操作"
    >
      {#if mediaRetries.size > 0}
        <ChatTooltip text="重新加载" class="chat-media-retry-wrap" disabled={showQuickReaction || showMoreActions}>
          <button type="button" class="chat-action-icon-btn chat-media-retry" aria-label="重新加载" onclick={retryMessageMedia}>
            <!-- Lucide 0.468.0: rotate-cw -->
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        </ChatTooltip>
      {/if}
      <!-- 快捷表情反应 -->
      {#if onReaction}
        <div class="relative inline-flex items-center" bind:this={reactionEl}>
          <button
            type="button"
            class="chat-action-icon-btn {showQuickReaction || showReactionPicker ? 'active' : ''}"
            aria-label="表情回应"
            onclick={(e) => {
              e.stopPropagation();
              showMoreActions = false;
              if (showQuickReaction) {
                closeReactionMenus();
              } else {
                showQuickReaction = true;
              }
            }}
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M22 11v1a10 10 0 1 1-9-10" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
              <path d="M16 5h6" />
              <path d="M19 2v6" />
            </svg>
          </button>

          {#if showQuickReaction}
            <div
              bind:this={quickReactionBar}
              data-chat-floating
              use:positionChatFloating={{
                placement: isSelfMsg ? "top-end" : "top-start",
                onReady: () => { quickReactionReady = true; },
                onReferenceHidden: closeReactionMenus,
              }}
              class="chat-quick-reactions-popover"
            >
              {#each QUICK_REACTION_PRESETS as em (em)}
                <button
                  type="button"
                  class="chat-quick-reaction-btn"
                  onclick={() => {
                    onReaction?.(message.msgUid, em);
                    closeReactionMenus();
                  }}
                  aria-label={`回应 ${em}`}
                >
                  {em}
                </button>
              {/each}
              <button
                bind:this={reactionMoreButton}
                type="button"
                class="chat-quick-reaction-btn chat-quick-reaction-more-btn {showReactionPicker ? 'is-active' : ''}"
                aria-label="更多表情回应"
                aria-haspopup="dialog"
                aria-expanded={showReactionPicker}
                onclick={(e) => {
                  e.stopPropagation();
                  showReactionPicker = !showReactionPicker;
                }}
              >
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>
          {/if}

          {#if quickReactionBar && (prepareReactionPicker || showReactionPicker)}
            <div
              popover="manual"
              data-chat-floating
              data-chat-reaction-picker-open={showReactionPicker ? "" : undefined}
              inert={!showReactionPicker}
              use:showReactionPopover
              use:positionChatFloating={{
                reference: quickReactionBar,
                placement: isSelfMsg ? "bottom-end" : "bottom-start",
                gap: 6,
                strategy: "fixed",
                fitViewport: true,
                sizeToAvailableSpace: false,
                onReferenceHidden: closeReactionMenus,
              }}
              class="chat-reaction-picker-floating-wrap"
            >
              <div class="chat-emoji-popover chat-sticker-popover chat-reaction-system-picker">
                <ChatStickerPicker
                  stickerPacks={stickerPacks}
                  chatServerUrl={chatServerUrl}
                  variant="reaction"
                  open={showReactionPicker}
                  onSelect={(emoji) => {
                    onReaction?.(message.msgUid, emoji);
                    closeReactionMenus();
                  }}
                  onClose={closeReactionPicker}
                />
              </div>
            </div>
          {/if}
        </div>
      {/if}

      <!-- 快捷回复 -->
      {#if onReply}
        <ChatTooltip text="回复" disabled={showMoreActions}>
          <button
            type="button"
            class="chat-action-icon-btn"
            aria-label="回复消息"
            onclick={(e) => {
              e.stopPropagation();
              closeReactionMenus();
              showMoreActions = false;
              onReply?.(message);
            }}
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="9 17 4 12 9 7" />
              <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
            </svg>
          </button>
        </ChatTooltip>
      {/if}

      <!-- 收纳更多操作（点击展开） -->
      {#if hasMoreActions}
        <div class="relative inline-flex items-center" bind:this={moreActionsEl}>
          <ChatTooltip text="更多操作" disabled={showMoreActions || showQuickReaction}>
            <button
              type="button"
              class="chat-action-icon-btn {showMoreActions ? 'active' : ''}"
              aria-label="更多操作"
              aria-expanded={showMoreActions}
              onclick={(e) => {
                e.stopPropagation();
                closeReactionMenus();
                showMoreActions = !showMoreActions;
              }}
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.75" />
                <circle cx="12" cy="12" r="1.75" />
                <circle cx="19" cy="12" r="1.75" />
              </svg>
            </button>
          </ChatTooltip>

          {#if showMoreActions}
            <div
              data-chat-floating
              use:positionChatFloating={{
                placement: isSelfMsg ? "bottom-start" : "bottom-end",
                onReferenceHidden: () => (showMoreActions = false),
              }}
              class="chat-more-actions-popover"
              role="menu"
              aria-label="更多消息操作"
            >
              {#if canPinMsg}
                <button
                  type="button"
                  role="menuitem"
                  class="chat-more-action-item {isPinned ? 'text-[var(--skin-accent)]' : ''}"
                  onclick={(e) => {
                    e.stopPropagation();
                    showMoreActions = false;
                    onPin?.(message.msgUid, isPinned);
                  }}
                >
                  <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <line x1="12" y1="17" x2="12" y2="22" />
                    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
                  </svg>
                  <span>{isPinned ? "取消置顶" : "置顶消息"}</span>
                </button>
              {/if}

              {#if canCopy}
                <button
                  type="button"
                  role="menuitem"
                  class="chat-more-action-item {copySuccess ? 'text-emerald-500' : ''}"
                  onclick={(e) => {
                    void handleCopy(e);
                    showMoreActions = false;
                  }}
                >
                  <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                  </svg>
                  <span>{copySuccess ? "已复制" : "复制内容"}</span>
                </button>
              {/if}

              {#if canThreadMsg}
                <button
                  type="button"
                  role="menuitem"
                  class="chat-more-action-item"
                  onclick={(e) => {
                    e.stopPropagation();
                    showMoreActions = false;
                    onOpenThread?.(message);
                  }}
                >
                  <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    <path d="M8 9h8" />
                    <path d="M8 13h5" />
                  </svg>
                  <span>线程回复</span>
                </button>
              {/if}

              {#if canEditMsg}
                <button
                  type="button"
                  role="menuitem"
                  class="chat-more-action-item"
                  onclick={(e) => {
                    e.stopPropagation();
                    showMoreActions = false;
                    onEdit?.(message);
                  }}
                >
                  <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  </svg>
                  <span>编辑消息</span>
                </button>
              {/if}

              {#if canRecallMsg}
                <button
                  type="button"
                  role="menuitem"
                  class="chat-more-action-item"
                  onclick={(e) => {
                    e.stopPropagation();
                    showMoreActions = false;
                    onRecall?.(message.msgUid);
                  }}
                >
                  <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                  <span>撤回消息</span>
                </button>
              {/if}

              {#if canViewSource}
                <button
                  type="button"
                  role="menuitem"
                  class="chat-more-action-item"
                  onclick={(e) => {
                    e.stopPropagation();
                    showMoreActions = false;
                    onViewSource?.(message);
                  }}
                >
                  <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                  <span>查看源码</span>
                </button>
              {/if}

              {#if canDeleteMsg}
                <button
                  type="button"
                  role="menuitem"
                  class="chat-more-action-item text-red-500 hover:text-red-500"
                  onclick={(e) => {
                    e.stopPropagation();
                    showMoreActions = false;
                    onDelete?.(message.msgUid);
                  }}
                >
                  <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M3 6h18" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                  <span>删除消息</span>
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet renderThreadSummary(alignEnd: boolean)}
  {@const effectiveSummary = !inThreadView ? (threadSummary ?? message.threadSummary ?? null) : null}
  {#if effectiveSummary && effectiveSummary.count > 0 && onOpenThread}
    {@const latest = effectiveSummary.latestReply}
    {@const latestPreview = latest
      ? formatChatReplyPreview(latest.content, stickerMap, getChatReplyAttachmentKind(latest))
      : ""}
    <div class="w-full flex {alignEnd ? 'justify-end' : 'justify-start'} mt-1">
      <button
        type="button"
        class="chat-thread-summary-pill"
        onclick={(e) => {
          e.stopPropagation();
          onOpenThread?.(message);
        }}
      >
        <svg class="w-3.5 h-3.5 text-[var(--primary)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M8 9h8" />
          <path d="M8 13h5" />
        </svg>
        {#if effectiveSummary.participants && effectiveSummary.participants.length > 0}
          <span class="inline-flex items-center -space-x-1 shrink-0">
            {#each effectiveSummary.participants.slice(0, 3) as p (p.userKey || p.name)}
              <span class="inline-flex rounded-full ring-1 ring-[var(--card-bg)] overflow-hidden">
                <ChatAvatar
                  src={p.avatar}
                  name={p.name}
                  size="xs"
                  class="w-4! h-4! text-[8px]!"
                />
              </span>
            {/each}
          </span>
        {/if}
        <span class="font-semibold text-[var(--primary)] shrink-0">
          {effectiveSummary.count} 条线程回复
        </span>
        {#if latestPreview}
          <span class="chat-thread-summary-preview truncate">
            {latest?.name ? `${latest.name}：` : ""}{latestPreview}
          </span>
        {/if}
        <svg class="w-3 h-3 shrink-0 opacity-55" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </div>
  {/if}
{/snippet}

{#snippet renderOrphanThreadChip(alignEnd: boolean)}
  {#if !inThreadView && orphanThreadRootUid && onOpenThreadByUid}
    <div class="w-full flex {alignEnd ? 'justify-end' : 'justify-start'} mb-1">
      <button
        type="button"
        class="chat-thread-context-chip"
        onclick={(e) => {
          e.stopPropagation();
          onOpenThreadByUid?.(orphanThreadRootUid);
        }}
      >
        <svg class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M8 9h8" />
          <path d="M8 13h5" />
        </svg>
        <span>线程回复 · 查看完整线程</span>
      </button>
    </div>
  {/if}
{/snippet}

{#snippet renderReactions(alignEnd: boolean)}
  {@const reactionEntries = Object.entries(message.reactions || {}).filter(([_, users]) => Array.isArray(users) && users.length > 0)}
  {#if reactionEntries.length > 0}
    <div class="chat-reaction-pills {alignEnd ? 'justify-end' : 'justify-start'}">
      {#each reactionEntries as [emoji, users] (emoji)}
        {@const isMine = Boolean(currentUserKey && users.includes(currentUserKey))}
        {@const reactionUsers = resolveReactionUsers(users)}
        {@const display = resolveReactionDisplay(emoji, chatServerUrl, stickerMap)}
        <div class="chat-reaction-item">
          <button
            type="button"
            class="chat-reaction-pill {isMine ? 'is-active' : ''}"
            onpointerdown={(e) => handleReactionPointerDown(e, emoji)}
            onpointermove={handleReactionPointerMove}
            onpointerup={handleReactionPointerUp}
            onpointercancel={handleReactionPointerCancel}
            oncontextmenu={handleReactionContextMenu}
            onclick={(e) => handleReactionClick(e, emoji)}
            aria-label={`${display.alt} ${users.length} 人回应（长按查看成员）`}
          >
            {#if display.type === "image"}
              <img
                src={display.url}
                alt={display.alt}
                class="chat-reaction-img"
                loading="lazy"
                decoding="async"
                onerror={(e) => {
                  const img = e.currentTarget as HTMLImageElement;
                  if (display.fallbackUrl && img.src !== display.fallbackUrl) {
                    img.src = display.fallbackUrl;
                  } else {
                    img.style.display = "none";
                  }
                }}
              />
            {:else}
              <span>{display.text}</span>
            {/if}
            <span class="text-[0.6875rem] font-medium opacity-85">{users.length}</span>
          </button>
          {#if reactionUsers.length > 0}
            <div
              data-chat-floating
              use:positionChatFloating={{ placement: alignEnd ? "top-end" : "top-start", hover: "card" }}
              class="chat-read-receipts-popover chat-reaction-popover"
              role="dialog"
              aria-label={`${display.alt} 回应成员`}
            >
              <div class="text-[0.6875rem] font-semibold text-[var(--deep-text)] dark:text-white/90 px-1 pb-1 mb-1 border-b border-[var(--chat-divider-color)] flex items-center justify-between gap-2">
                <span class="flex items-center gap-1.5 min-w-0">
                  {#if display.type === "image"}
                    <img
                      src={display.url}
                      alt={display.alt}
                      class="w-4 h-4 object-contain inline-block shrink-0 rounded-xs"
                      loading="lazy"
                      decoding="async"
                    />
                  {:else}
                    <span class="shrink-0">{display.text}</span>
                  {/if}
                  <span class="truncate">回应成员</span>
                </span>
                <span class="text-[0.625rem] font-normal text-[var(--chat-meta-color)] tabular-nums shrink-0">{reactionUsers.length} 人</span>
              </div>
              <div class="chat-read-receipts-list custom-scrollbar space-y-0.5">
                {#each reactionUsers as item (item.userKey)}
                  <button
                    type="button"
                    class="chat-reaction-user-btn"
                    onclick={(e) => {
                      e.stopPropagation();
                      onOpenUserProfile?.(item.seed);
                    }}
                  >
                    <ChatAvatar
                      src={item.seed.avatar}
                      name={item.seed.name}
                      size="xs"
                      class="w-4! h-4! text-[9px]!"
                    />
                    <span class="truncate flex-1 text-left">
                      {item.displayName}{item.isMe ? " (你)" : ""}
                    </span>
                    <svg class="w-3 h-3 shrink-0 opacity-45" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet renderAttachmentsBlock()}
  {#if safeAttachments.length > 0}
    <div class="flex flex-col gap-2 {message.replyTo || message.content.trim().length > 0 ? 'mt-2' : ''}">
      {#each safeAttachments as att (att.url)}
        {#if att.type === "image" && att.isSticker}
          <div class="inline-block select-none">
            <ChatStickerImage
              src={att.url}
              loading="lazy"
              alt={formatStickerAttachmentAlt(att.name)}
              title={formatStickerAttachmentAlt(att.name)}
              class="chat-sticker-large single"
            />
          </div>
        {:else if att.type === "image"}
          <ChatImagePreview
            src={att.url}
            thumbnailSrc={att.thumbnailUrl}
            alt={att.name || "聊天图片"}
            metadata={att}
          />
        {:else if att.type === "audio"}
          <ChatAudioAttachment attachment={att} />
        {:else if att.type === "video"}
          <ChatVideoPreview src={att.url} />
        {:else if att.type === "file"}
          <ChatFileAttachment attachment={att} />
        {/if}
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet renderPollBlock()}
  {#if message.kind === "poll" && message.poll}
    {@const poll = message.poll}
    {@const totalVotes = Object.values(poll.votes || {}).reduce((acc, list) => acc + (Array.isArray(list) ? list.length : 0), 0)}
    <div class="chat-poll-card my-1">
      <div class="flex items-center justify-between gap-2 mb-2">
        <span class="text-xs font-bold text-[var(--skin-text)]">{poll.question}</span>
        <span class="text-[0.6875rem] text-[var(--chat-meta-color)] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10">
          {poll.ended ? "已结束" : poll.maxSelections > 1 ? "多选" : "单选"}
        </span>
      </div>
      <div class="flex flex-col gap-1.5">
        {#each poll.answers as ans (ans.id)}
          {@const votesList = poll.votes?.[ans.id] || []}
          {@const count = votesList.length}
          {@const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0}
          {@const isMyVote = Boolean(currentUserKey && votesList.includes(currentUserKey))}
          <button
            type="button"
            disabled={poll.ended}
            class="chat-poll-option {isMyVote ? 'is-selected' : ''}"
            onclick={() => onVotePoll?.(message.msgUid, ans.id)}
          >
            <div class="chat-poll-progress" style="width: {percent}%"></div>
            <span class="relative z-10 truncate text-[var(--skin-text)]">{ans.text}</span>
            <span class="relative z-10 text-[0.6875rem] text-[var(--chat-meta-color)] shrink-0 ml-2 font-medium">
              {percent}% ({count})
            </span>
          </button>
        {/each}
      </div>
      <div class="mt-2 text-[0.6875rem] text-[var(--chat-meta-color)] flex items-center justify-between gap-2">
        <span>共 {totalVotes} 票</span>
        {#if poll.ended}
          <span class="text-red-400">投票已截止</span>
        {:else if (isAdmin || isSelf) && onEndPoll}
          <button
            type="button"
            class="text-[0.6875rem] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 hover:text-red-400 transition-colors cursor-pointer"
            onclick={() => onEndPoll(message.msgUid)}
          >
            结束投票
          </button>
        {/if}
      </div>
    </div>
  {/if}
{/snippet}

{#snippet renderReadReceipts()}
  {@const readers = readReceipts.filter((r) => {
    if (r.userKey === message.userKey) return false;
    if (isSelf && currentUserKey && r.userKey === currentUserKey) return false;
    return true;
  })}
  {#if readers.length > 0}
    {@const resolvedReaders = readers.map((r) => ({
      reader: r,
      resolved: resolveUserProfileSeed(r.userKey, r.name, r.avatar),
    }))}
    {@const shown = resolvedReaders.slice(0, 4)}
    {@const restCount = resolvedReaders.length - shown.length}
    <button
      type="button"
      class="chat-read-receipts-wrap select-none"
      onclick={handleOpenReadActivity}
      aria-label={`查看已读成员：${resolvedReaders.map((item) => item.resolved.displayName).join("、")}`}
    >
      <span class="inline-flex items-center -space-x-1">
        {#each shown as item (item.reader.userKey)}
          <span class="inline-flex rounded-full ring-1 ring-[var(--card-bg)] overflow-hidden">
            <ChatAvatar
              src={item.resolved.seed.avatar}
              name={item.resolved.seed.name}
              size="xs"
              class="w-3.5! h-3.5! text-[8px]!"
            />
          </span>
        {/each}
        {#if restCount > 0}
          <span class="text-[0.625rem] text-[var(--chat-meta-color)] pl-1.5 tabular-nums">+{restCount}</span>
        {/if}
      </span>
      <div
        data-chat-floating
        use:positionChatFloating={{ placement: isSelf ? "top-end" : "top-start", hover: "card" }}
        class="chat-read-receipts-popover"
        role="dialog"
        aria-label="已读成员"
      >
        <div class="text-[0.6875rem] font-semibold text-[var(--deep-text)] dark:text-white/90 px-1 pb-1 mb-1 border-b border-[var(--chat-divider-color)] flex items-center justify-between gap-2">
          <span>已读成员</span>
          <span class="text-[0.625rem] font-normal text-[var(--chat-meta-color)] tabular-nums">{resolvedReaders.length} 人</span>
        </div>
        <div class="chat-read-receipts-list custom-scrollbar space-y-0.5">
          {#each resolvedReaders as item (item.reader.userKey)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              role="button"
              tabindex="0"
              class="chat-reaction-user-btn"
              onclick={(e) => {
                e.stopPropagation();
                onOpenUserProfile?.(item.resolved.seed);
              }}
            >
              <ChatAvatar
                src={item.resolved.seed.avatar}
                name={item.resolved.seed.name}
                size="xs"
                class="w-4! h-4! text-[8px]! shrink-0"
              />
              <span class="truncate flex-1 text-left">
                {item.resolved.displayName}{item.resolved.isMe ? " (你)" : ""}
              </span>
              <svg class="w-3 h-3 shrink-0 opacity-45" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </div>
          {/each}
        </div>
      </div>
    </button>
  {/if}
{/snippet}

{#snippet renderStickerOnlyBody(alignEnd: boolean)}
  <div class="flex flex-col {alignEnd ? 'items-end' : 'items-start'} gap-1">
    {#if message.replyTo}
      {@render replyQuoteBlock()}
    {/if}
    <div class="chat-sticker-only-wrap {alignEnd ? 'justify-end' : 'justify-start'}">
      {#each stickerSegments as seg, idx (`${idx}-${seg.code}`)}
        {#if seg.lottie}
          <LottieSticker
            name={seg.lottie}
            alt={seg.alt}
            className={seg.category === "sticker"
              ? `chat-sticker-large ${stickerSegments.length === 1 ? "single" : ""}`
              : `chat-sticker chat-sticker--lottie chat-sticker--${seg.category}`}
            chatServerUrl={chatServerUrl}
          />
        {:else}
          <ChatStickerImage
            src={seg.url}
            alt={seg.alt}
            class={seg.category === "sticker"
              ? `chat-sticker-large ${stickerSegments.length === 1 ? "single" : ""}`
              : `chat-sticker chat-sticker--${seg.category}`}
          />
        {/if}
      {/each}
    </div>
  </div>
{/snippet}

{#snippet renderStickerAttachmentOnlyBody(alignEnd: boolean)}
  <div class="flex flex-col {alignEnd ? 'items-end' : 'items-start'} gap-1">
    {#if message.replyTo}
      {@render replyQuoteBlock()}
    {/if}
    <div class="chat-sticker-only-wrap {alignEnd ? 'justify-end' : 'justify-start'}">
      {#each safeAttachments as att (att.url)}
        <div class="block select-none">
          <ChatStickerImage
            src={att.url}
            alt={formatStickerAttachmentAlt(att.name)}
            title={formatStickerAttachmentAlt(att.name)}
            loading="lazy"
            class="chat-sticker-large {safeAttachments.length === 1 ? 'single' : ''}"
          />
        </div>
      {/each}
    </div>
  </div>
{/snippet}

{#if message.kind === "system"}
  {@const isMusicErrorSystem = /(匹配失败|音源解析失败|播放失败|不可用)/.test(message.content)}
  <div class="w-full flex justify-center my-1.5">
    <div class="chat-system-msg {isMusicErrorSystem ? 'chat-system-msg--error' : ''}">
      {#if systemActor}
        <span class="shrink-0" aria-hidden="true">
          <ChatAvatar src={systemActorAvatar} name={systemActor.name} size="2xs" />
        </span>
      {/if}
      {#if recallNoticeParsed}
        <span class="inline-flex flex-wrap items-center justify-center gap-x-1">
          <button
            type="button"
            class="chat-system-msg-link"
            onclick={() => handleOpenSystemUserProfile(recallNoticeParsed.actorName, message.userKey)}
          >{recallNoticeParsed.actorName}</button>
          {#if recallNoticeParsed.targetName}
            <span>撤回了</span>
            <button
              type="button"
              class="chat-system-msg-link"
              onclick={() => handleOpenSystemUserProfile(recallNoticeParsed.targetName || "", message.mentionKeys?.[0])}
            >{recallNoticeParsed.targetName}</button>
            <span>的一条消息</span>
          {:else}
            <span>撤回了一条消息</span>
          {/if}
        </span>
      {:else if systemActor}
        <span>
          <button
            type="button"
            class="chat-system-msg-link"
            onclick={() => handleOpenSystemUserProfile(systemActor.name, message.userKey)}
          >{systemActor.name}</button>
          {systemActor.detail}
        </span>
      {:else}
        <span>{message.content}</span>
      {/if}
    </div>
  </div>
{:else if isSelf}
  <div
    data-msg-uid={message.msgUid}
    class="flex flex-row-reverse items-start gap-2.5 my-1 group {isHighlighted ? 'chat-msg-jump-highlight' : ''}"
    onpointerenter={() => { actionsMounted = true; }}
    onfocusin={() => { actionsMounted = true; }}
    onpointerleave={() => { if (!showQuickReaction && !showMoreActions && !showReactionPicker) actionsMounted = false; }}
  >
    <button
      type="button"
      class="p-0 border-none bg-transparent cursor-pointer shrink-0 rounded-full"
      onclick={handleAvatarClick}
    >
      <ChatAvatar
        src={message.avatar}
        name={cleanSenderName || message.name}
        fallback="我"
        alt={cleanSenderName || message.name || "我"}
        size="md"
      />
    </button>

    <div class="flex flex-col items-end max-w-[82%] md:max-w-[74%] min-w-0">
      {#if senderDisplayName || roleBadge || (message.customBadges && message.customBadges.length > 0)}
        <div class="flex items-center justify-end gap-1.5 mb-1 px-0.5 min-w-0 max-w-full">
          {#if roleBadge}
            <span class="chat-role-badge chat-role-badge--{roleBadge.type}">{roleBadge.label}</span>
          {/if}
          {#if message.customBadges && message.customBadges.length > 0}
            {#each message.customBadges as b, idx (`${b.text}:${idx}`)}
              <span class="chat-role-badge chat-role-badge--{b.color}">{b.text}</span>
            {/each}
          {/if}
          {#if senderDisplayName}
            <span class="text-[13px] md:text-xs text-[var(--chat-meta-color)] font-medium truncate">{senderDisplayName}</span>
          {/if}
        </div>
      {/if}

      {@render renderOrphanThreadChip(true)}

      <!-- svelte-ignore a11y_click_events_have_key_events (This click completes a pointer gesture. Nested message controls keep their own keyboard handling.) -->
      <div
        class="relative max-w-full chat-msg-bubble-wrap"
        onpointerdown={handleBubblePointerDown}
        onpointermove={handleBubblePointerMove}
        onpointerup={handleBubblePointerUp}
        onpointerleave={handleBubblePointerLeave}
        onpointercancel={cancelBubblePress}
        onclick={handleBubbleClick}
      >
        {#if actionsMounted || showQuickReaction || showMoreActions || showReactionPicker || mediaRetries.size > 0}
          {@render renderFloatingActions(true)}
        {/if}

        {#if isStickerOnly}
          {@render renderStickerOnlyBody(true)}
        {:else if isStickerAttachmentOnly}
          {@render renderStickerAttachmentOnlyBody(true)}
        {:else}
          <div class="chat-bubble chat-bubble-self {shareData ? 'chat-bubble-share' : ''}">
            {#if !shareData}
              {@render renderBubbleTail(true)}
            {/if}
            {#if message.replyTo}
              {@render replyQuoteBlock()}
            {/if}
            {#if shareData}
              {#if shareData.kind === "music"}
                <ChatMusicCard
                  data={shareData}
                  isSelf={true}
                  chatServerUrl={chatServerUrl}
                  currentUserKey={currentUserKey}
                  playlistAuth={playlistAuth}
                  isCurrentPlaying={isSharedMusicCurrent}
                  isQueued={isSharedMusicQueued}
                  onEnqueueTrack={onEnqueueTrack}
                  onRequireAuth={onRequireAuth}
                  onFavoriteChanged={onFavoriteChanged}
                  onNotify={onNotify}
                />
              {:else}
                <ChatArticleCard data={shareData} isSelf={true} />
              {/if}
            {:else if message.content.trim().length > 0}
              <div class={message.msgType === "emote" ? "italic opacity-90" : message.isEncryptedPlaceholder ? "opacity-75 text-xs" : ""}>
                {#if message.msgType === "emote"}
                  <span class="font-medium mr-1">* {externalOrigin?.cleanName || message.name}</span>
                {/if}
                <ChatMarkdownContent
                  content={message.content}
                  imageDimensions={message.inlineImageDimensions}
                  stickerMap={stickerMap}
                  mentionEntities={message.mentionEntities}
                  currentUserKey={currentUserKey}
                  mentionKeys={message.mentionKeys}
                  chatServerUrl={chatServerUrl}
                  onMentionClick={handleMentionPillClick}
                />
              </div>
            {/if}

            {@render renderAttachmentsBlock()}
            {@render renderPollBlock()}
          </div>
        {/if}
      </div>

      {@render renderReactions(true)}
      {@render renderThreadSummary(true)}

      {#if formattedTime}
        <div class="flex items-center gap-1 mt-1 px-1 select-none">
          {@render renderReadReceipts()}
          {#if message.isEdited}
            <span class="text-[11px] md:text-[0.625rem] text-[var(--chat-meta-color)] opacity-70">(已编辑)</span>
          {/if}
          <span
            class="text-xs md:text-[0.6875rem] text-[var(--chat-meta-color)] cursor-default"
            title={fullDateTimeTooltip}
          >
            {formattedTime}
          </span>
        </div>
      {/if}
    </div>
  </div>
{:else}
  <div
    data-msg-uid={message.msgUid}
    class="flex items-start gap-2.5 my-1 group {isHighlighted ? 'chat-msg-jump-highlight' : ''}"
    onpointerenter={() => { actionsMounted = true; }}
    onfocusin={() => { actionsMounted = true; }}
    onpointerleave={() => { if (!showQuickReaction && !showMoreActions && !showReactionPicker) actionsMounted = false; }}
  >
    <button
      type="button"
      class="p-0 border-none bg-transparent cursor-pointer shrink-0 rounded-full"
      onclick={handleAvatarClick}
    >
      <ChatAvatar
        src={message.avatar}
        name={cleanSenderName || externalOrigin?.cleanName || message.name}
        fallback="?"
        alt={senderDisplayName}
        size="md"
      />
    </button>

    <div class="flex flex-col items-start max-w-[82%] md:max-w-[74%] min-w-0">
      {#if senderDisplayName || roleBadge || (message.customBadges && message.customBadges.length > 0) || isMentionedMe}
        <div class="flex items-center gap-1.5 mb-1 px-0.5 min-w-0 max-w-full">
          {#if effectiveSenderUrl}
            <a
              href={effectiveSenderUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="text-[13px] md:text-xs text-[var(--chat-meta-color)] hover:text-[var(--primary)] font-medium truncate no-underline"
            >
              {senderDisplayName}
            </a>
          {:else if senderDisplayName}
            <span class="text-[13px] md:text-xs text-[var(--chat-meta-color)] font-medium truncate">{senderDisplayName}</span>
          {/if}
          {#if roleBadge}
            <span class="chat-role-badge chat-role-badge--{roleBadge.type}">{roleBadge.label}</span>
          {/if}
          {#if message.customBadges && message.customBadges.length > 0}
            {#each message.customBadges as b, idx (`${b.text}:${idx}`)}
              <span class="chat-role-badge chat-role-badge--{b.color}">{b.text}</span>
            {/each}
          {/if}
          {#if isMentionedMe}
            <span class="chat-mentioned-tag">提到了你</span>
          {/if}
        </div>
      {/if}

      {@render renderOrphanThreadChip(false)}

      <!-- svelte-ignore a11y_click_events_have_key_events (This click completes a pointer gesture. Nested message controls keep their own keyboard handling.) -->
      <div
        class="relative max-w-full chat-msg-bubble-wrap"
        onpointerdown={handleBubblePointerDown}
        onpointermove={handleBubblePointerMove}
        onpointerup={handleBubblePointerUp}
        onpointerleave={handleBubblePointerLeave}
        onpointercancel={cancelBubblePress}
        onclick={handleBubbleClick}
      >
        {#if actionsMounted || showQuickReaction || showMoreActions || showReactionPicker || mediaRetries.size > 0}
          {@render renderFloatingActions(false)}
        {/if}

        {#if isStickerOnly}
          {@render renderStickerOnlyBody(false)}
        {:else if isStickerAttachmentOnly}
          {@render renderStickerAttachmentOnlyBody(false)}
        {:else}
          <div
            use:trackBubbleBox={isMentionedMe}
            class="chat-bubble chat-bubble-other {shareData ? 'chat-bubble-share' : ''} {isMentionedMe ? 'chat-bubble-mentioned' : ''} {mentionedBubblePath ? 'chat-bubble-svg-ready' : ''}"
          >
            {#if mentionedBubblePath}
              <svg
                class="chat-bubble-bg"
                viewBox="0 0 {bubbleW} {bubbleH}"
                style="width: {bubbleW}px; height: {bubbleH}px;"
                shape-rendering="geometricPrecision"
                aria-hidden="true"
              >
                <path class="chat-bubble-shadow" transform="translate(0 1)" d={mentionedBubblePath} />
                <path class="chat-bubble-shape" d={mentionedBubblePath} />
              </svg>
            {:else if !shareData}
              {@render renderBubbleTail(false)}
            {/if}
            {#if message.replyTo}
              {@render replyQuoteBlock()}
            {/if}
            {#if shareData}
              {#if shareData.kind === "music"}
                <ChatMusicCard
                  data={shareData}
                  isSelf={false}
                  chatServerUrl={chatServerUrl}
                  currentUserKey={currentUserKey}
                  playlistAuth={playlistAuth}
                  isCurrentPlaying={isSharedMusicCurrent}
                  isQueued={isSharedMusicQueued}
                  onEnqueueTrack={onEnqueueTrack}
                  onRequireAuth={onRequireAuth}
                  onFavoriteChanged={onFavoriteChanged}
                  onNotify={onNotify}
                />
              {:else}
                <ChatArticleCard data={shareData} isSelf={false} />
              {/if}
            {:else if message.content.trim().length > 0}
              <div class={message.msgType === "emote" ? "italic opacity-90" : message.isEncryptedPlaceholder ? "opacity-75 text-xs" : ""}>
                {#if message.msgType === "emote"}
                  <span class="font-medium mr-1">* {externalOrigin?.cleanName || message.name}</span>
                {/if}
                <ChatMarkdownContent
                  content={message.content}
                  imageDimensions={message.inlineImageDimensions}
                  stickerMap={stickerMap}
                  mentionEntities={message.mentionEntities}
                  currentUserKey={currentUserKey}
                  mentionKeys={message.mentionKeys}
                  chatServerUrl={chatServerUrl}
                  onMentionClick={handleMentionPillClick}
                />
              </div>
            {/if}

            {@render renderAttachmentsBlock()}
            {@render renderPollBlock()}
          </div>
        {/if}
      </div>

      {@render renderReactions(false)}
      {@render renderThreadSummary(false)}

      {#if formattedTime}
        <div class="flex items-center gap-1 mt-1 px-1 select-none">
          <span
            class="text-xs md:text-[0.6875rem] text-[var(--chat-meta-color)] cursor-default"
            title={fullDateTimeTooltip}
          >
            {formattedTime}
          </span>
          {#if message.isEdited}
            <span class="text-[11px] md:text-[0.625rem] text-[var(--chat-meta-color)] opacity-70">(已编辑)</span>
          {/if}
          {@render renderReadReceipts()}
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if showActivityModal}
  <ChatMessageActivityModal
    open={showActivityModal}
    initialTab={activityModalTab}
    message={message}
    readReceipts={readReceipts}
    currentUserKey={currentUserKey}
    userProfileMap={userProfileMap}
    userNameMap={userNameMap}
    interconnectSites={interconnectSites}
    chatServerUrl={chatServerUrl}
    stickerMap={stickerMap}
    onOpenUserProfile={onOpenUserProfile}
    onClose={() => (showActivityModal = false)}
  />
{/if}
