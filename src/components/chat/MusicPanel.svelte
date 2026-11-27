<script module lang="ts">
function resolveMusicThumbUrl(raw?: string, size = 120): string {
	if (!raw) return "";
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return raw;
	}
	if (url.protocol === "http:") {
		url.protocol = "https:";
	}
	const px = Math.max(40, Math.min(300, Math.round(size)));
	if (url.hostname.endsWith(".126.net")) {
		url.searchParams.set("param", `${px}y${px}`);
		return url.href;
	}
	if (/^is\d+-ssl\.mzstatic\.com$/.test(url.hostname)) {
		return url.href.replace(/\/\d+x\d+bb(\.[a-zA-Z0-9]+)$/, `/${px}x${px}bb$1`);
	}
	if (url.hostname === "y.gtimg.cn") {
		const qqPx = px <= 200 ? 150 : px <= 300 ? 300 : 500;
		return url.href.replace(
			/T00([12])R\d+x\d+M000/,
			`T00$1R${qqPx}x${qqPx}M000`,
		);
	}
	if (url.hostname.endsWith(".kugou.com")) {
		url.pathname = url.pathname.replace(
			/\/stdmusic\/\d+\//,
			`/stdmusic/${px}/`,
		);
		return url.href;
	}
	if (
		url.hostname.endsWith("ytimg.com") ||
		url.hostname.endsWith("googleusercontent.com")
	) {
		if (/=[sw]\d+/.test(url.href)) {
			return url.href.replace(
				/=[sw]\d+(?:-h\d+)?[^?]*/,
				`=w${px}-h${px}-s-l90-rj`,
			);
		}
		return `${url.href}=w${px}-h${px}-s-l90-rj`;
	}
	if (
		url.hostname === "i.scdn.co" &&
		/^\/image\/ab67616d0000(?:b273|1e02)[a-f0-9]{24}$/i.test(url.pathname)
	) {
		url.pathname = url.pathname.replace(
			/^\/image\/ab67616d0000(?:b273|1e02)/i,
			"/image/ab67616d00004851",
		);
		return url.href;
	}
	return url.href;
}
</script>

<script lang="ts">
import { onMount, tick, untrack } from "svelte";
import ChatAvatar from "./ChatAvatar.svelte";
import ChatModal from "./ChatModal.svelte";
import ChatTooltip from "./ChatTooltip.svelte";
import { positionChatFloating } from "./chatFloating";
import { fetchMusicHistory, formatClockSeconds, readStoredGuestToken } from "./chatClient";
import type {
	ChatMentionCandidate,
	ChatOnlineMember,
	ChatSessionUser,
	ChatUserDetailSeed,
	FavoriteUserItem,
	MusicHistoryEntry,
	PlaylistDetail,
	PlaylistSummary,
	PlaylistTrackItem,
	QueueEntry,
	RotationAction,
	RotationQueueItem,
	RoomMusicState,
	RoomRotation,
} from "./chatTypes";
import MiniPlayerBar from "./MiniPlayerBar.svelte";
import { createVirtualWindowMemo } from "./virtualWindow";
import { RoomAudioPlayer, audioStatusLabel, type AudioStatus, type LocalAudioDiagnostic } from "./roomAudioPlayer";
import type { ChatMusicTrack } from "./musicTypes";
import {
	type AmbiguousResolveCandidate,
	DEFAULT_PLAYLISTOUT_API_URL,
	deleteSavedPlaylist,
	fetchFavoriteTrackStatus,
	fetchPlaylistByUrlFromPlaylistOut,
	fetchPlaylistDetail,
	fetchRoomPlaylists,
	formatPlatformLabel,
	refreshSavedPlaylist,
	resolvePlaylistFromPlaylistOut,
	saveImportedPlaylist,
	saveRoomRotation,
	toEnqueueableTrack,
	fetchUserFavoriteKeys,
	toggleFavoriteTrack,
	type PlaylistAuth,
	type UserPlaylistCandidate,
	updatePlaylistFlags,
} from "./playlistClient";

interface Props {
	audioEl: HTMLAudioElement | null;
	roomId: string;
	chatServerUrl?: string;
	playlistOutApiUrl?: string;
	walineToken?: string;
	playlistAuth?: PlaylistAuth;
	playlistRefreshSeq?: number;
	fallbackTracks?: ChatMusicTrack[];
	musicState: RoomMusicState | null;
	currentUser: ChatSessionUser | null;
	onlineMemberCount: number;
	onlineMembers?: ChatOnlineMember[];
	listeningMemberCount?: number;
	mentionMembers?: ChatMentionCandidate[];
	clockOffsetMs: number;
	serverNow?: () => number;
	initialVolume?: number;
	initialListening?: boolean;
	onSearchOnline: (
		keyword: string,
		options?: { signal?: AbortSignal; page?: number; provider?: "qq" | "netease" | "kugou" | "youtube" },
	) => Promise<{ tracks: ChatMusicTrack[]; hasMore: boolean; page: number }>;
	onEnqueueTrack: (track: ChatMusicTrack, anchor?: HTMLElement) => Promise<boolean>;
	onShareTrack?: (track: ChatMusicTrack) => Promise<boolean>;
	onRandomEnqueue: (playlistId: string) => Promise<boolean>;
	isRandomizing: boolean;
	onRemoveQueue: (uid: string) => void;
	onRemoveRotationTrack?: (track: RotationQueueItem) => void;
	onShuffleRotation?: () => void;
	onPlayQueued: (uid: string) => void;
	onPlayRotationTrack?: (track: RotationQueueItem, anchor?: HTMLElement) => void;
	onOpenRotationOffer?: () => void;
	rotationAction?: RotationAction | null;
	isSkippingTrack?: boolean;
	onSkipTrack: () => void;
	onVoteSkip: () => void;
	onReportDuration: (playUid: string, durationSec: number) => void;
	onTrackEnded: (playUid: string) => void;
	onReportError: (playUid: string, revision?: number) => void;
	onRequestAuth?: () => void;
	onOpenUserProfile?: (seed: ChatUserDetailSeed) => void;
	fallbackSearch?: { query: string; seq: number };
	externalPlaylistRequest?: {
		playlistId: string;
		seq: number;
		summary?: Partial<PlaylistSummary>;
	};
	onPlaybackStatusChange?: (status: {
		isListening: boolean;
		audioStatus?: AudioStatus;
		listenIntent?: boolean;
		isMuted: boolean;
		elapsedSec: number;
		durationSec: number;
		canDirectSkip: boolean;
		isSoloCoolingDown: boolean;
		soloCooldownRemainSec: number;
		hasVotedSkip: boolean;
		volume?: number;
		currentLyric?: string;
	}) => void;
	onAudioDiagnosticChange?: (diagnostic: LocalAudioDiagnostic | null) => void;
	onNotify?: (message: string, tone?: "default" | "error" | "success") => void;
	onClose?: () => void;
}

interface LyricLine {
	time: number;
	text: string;
}

const {
	audioEl,
	roomId,
	chatServerUrl = "",
	playlistOutApiUrl = DEFAULT_PLAYLISTOUT_API_URL,
	walineToken = "",
	playlistAuth,
	playlistRefreshSeq = 0,
	fallbackTracks = [],
	musicState = null,
	currentUser = null,
	onlineMemberCount = 0,
	onlineMembers = [],
	listeningMemberCount = 0,
	mentionMembers = [],
	clockOffsetMs = 0,
	serverNow,
	initialVolume = 1,
	initialListening = false,
	onSearchOnline,
	onEnqueueTrack,
	onShareTrack,
	onRandomEnqueue,
	isRandomizing,
	onRemoveQueue,
	onRemoveRotationTrack,
	onPlayQueued,
	onPlayRotationTrack,
	onOpenRotationOffer,
	rotationAction = null,
	isSkippingTrack = false,
	onSkipTrack,
	onVoteSkip,
	onReportDuration,
	onTrackEnded,
	onReportError,
	onRequestAuth,
	onOpenUserProfile,
	fallbackSearch,
	externalPlaylistRequest,
	onPlaybackStatusChange,
	onAudioDiagnosticChange,
	onNotify,
	onShuffleRotation,
	onClose,
}: Props = $props();

const initVol = untrack(() => {
	try {
		if (typeof window !== "undefined" && window.sessionStorage) {
			const saved = window.sessionStorage.getItem("chat:player:volume");
			if (saved !== null) {
				const n = Number.parseFloat(saved);
				if (Number.isFinite(n)) return Math.min(1, Math.max(0, n));
			}
		}
	} catch {
		// Ignore storage error
	}
	return Number.isFinite(initialVolume) ? Math.min(1, Math.max(0, initialVolume)) : 1;
});

type MusicTab = "player" | "search" | "playlist" | "history";
type HistorySortMode = "recent" | "count";
type PlayerPaneMode = "split" | "lyrics" | "queue";

interface HistoryRequesterOption {
	key: string;
	name: string;
	avatar: string;
	badge: string;
	trackCount: number;
	totalRequests: number;
	isMe: boolean;
}

let activeTab = $state<MusicTab>("player");
let historySort = $state<HistorySortMode>("recent");
let historyFilterType = $state<"all" | "request" | "rotation">("all");
let pagedAllHistory = $state<MusicHistoryEntry[]>([]);
let allHistoryTotal = $state(0);
let allHistoryHasMore = $state(false);
let isAllHistoryLoading = $state(false);
let isAllHistoryLoadingMore = $state(false);

let pagedRequestHistory = $state<MusicHistoryEntry[]>([]);
let requestHistoryTotal = $state(0);
let requestHistoryHasMore = $state(false);
let isRequestHistoryLoading = $state(false);
let isRequestHistoryLoadingMore = $state(false);

let pagedRotationHistory = $state<MusicHistoryEntry[]>([]);
let rotationHistoryTotal = $state(0);
let rotationHistoryHasMore = $state(false);
let isRotationHistoryLoading = $state(false);
let isRotationHistoryLoadingMore = $state(false);

let historyReqSeq = 0;
let selectedRequesterKey = $state("");
let showRequesterFilter = $state(false);
const shouldInitialListen = untrack(() => Boolean(initialListening));
let isListening = $state(shouldInitialListen);
let listenIntent = $state(shouldInitialListen);
let hasJoinedAudio = $state(false);
let player = $state<RoomAudioPlayer | undefined>();
let audioStatus = $state<AudioStatus>("idle");
let lyricRequest: AbortController | undefined;
const listenAction = $derived(
	audioStatus === "error"
		? "重试收听"
		: audioStatus === "blocked"
			? "点击恢复收听"
			: isListening
				? "正在收听（点击停止）"
				: "开始收听",
);
let playerPaneMode = $state<PlayerPaneMode>("split");
const playerPaneModeLabel = $derived(
	playerPaneMode === "split"
		? "并列显示"
		: playerPaneMode === "lyrics"
			? "纯歌词"
			: "播放列表",
);
let lyricsScrolling = $state(false);
let queueTab = $state<"request" | "rotation">("request");
let hasUserManuallySwitchedQueueTab = $state(false);

function selectQueueTab(tab: "request" | "rotation") {
	hasUserManuallySwitchedQueueTab = true;
	queueTab = tab;
}
let lyricsScrollHideTimer: number | null = null;
let queueScrollHideTimer: number | null = null;
let programmaticLyricScrollUntil = 0;
let roomElapsed = $state(0);

function triggerLyricsScroll() {
	lyricsScrolling = true;
	if (lyricsScrollHideTimer !== null) {
		window.clearTimeout(lyricsScrollHideTimer);
	}
	lyricsScrollHideTimer = window.setTimeout(() => {
		lyricsScrolling = false;
		lyricsScrollHideTimer = null;
	}, 950);
}

function cyclePlayerPaneMode() {
	playerPaneMode =
		playerPaneMode === "split"
			? "lyrics"
			: playerPaneMode === "lyrics"
				? "queue"
				: "split";
	if (playerPaneMode !== "queue" && activeLyricIndex >= 0) {
		void scrollLyricToCenter(activeLyricIndex, true);
	}
}
let localDuration = $state(0);
let volume = $state(initVol);
let coverLoadFailed = $state(false);

// 搜索相关状态
type SearchProvider = "qq" | "netease" | "kugou" | "youtube";

interface SearchProviderOption {
	id: SearchProvider;
	label: string;
	activeClass: string;
	inactiveClass: string;
	isOverseas: boolean;
}

const SEARCH_PROVIDERS: SearchProviderOption[] = [
	{
		id: "qq",
		label: "音源1",
		activeClass: "border-[#1ecd96] text-[#1ecd96] bg-[#1ecd96]/15",
		inactiveClass: "border-[#1ecd96]/45 text-[var(--chat-meta-color)] hover:border-[#1ecd96] hover:text-[#1ecd96] hover:bg-[#1ecd96]/8",
		isOverseas: false,
	},
	{
		id: "kugou",
		label: "音源2",
		activeClass: "border-[#227df7] text-[#227df7] bg-[#227df7]/15",
		inactiveClass: "border-[#227df7]/45 text-[var(--chat-meta-color)] hover:border-[#227df7] hover:text-[#227df7] hover:bg-[#227df7]/8",
		isOverseas: false,
	},
	{
		id: "netease",
		label: "音源3",
		activeClass: "border-[#ec4141] text-[#ec4141] bg-[#ec4141]/15",
		inactiveClass: "border-[#ec4141]/45 text-[var(--chat-meta-color)] hover:border-[#ec4141] hover:text-[#ec4141] hover:bg-[#ec4141]/8",
		isOverseas: false,
	},
	{
		id: "youtube",
		label: "YouTube Music",
		activeClass: "border-[#ea3323] text-[#ea3323] bg-[#ea3323]/15",
		inactiveClass: "border-[#ea3323]/45 text-[var(--chat-meta-color)] hover:border-[#ea3323] hover:text-[#ea3323] hover:bg-[#ea3323]/8",
		isOverseas: true,
	},
];

let searchQuery = $state("");
let submittedSearchQuery = $state("");
let searchResults = $state<ChatMusicTrack[]>([]);
let searchProvider = $state<SearchProvider>("qq");
// 实际产出当前列表的音源；国内音源 0 结果回退到 YouTube 时会与 searchProvider 不同
let searchResultProvider = $state<SearchProvider>("qq");
let searchPage = $state(1);
let hasMoreSearchResults = $state(false);
let isSearching = $state(false);
let isLoadingMore = $state(false);
let searchFallbackNotice = $state("");
let searchError = $state("");
let searchAbortController: AbortController | null = null;

const currentProviderOption = $derived(
	SEARCH_PROVIDERS.find((p) => p.id === searchProvider) || SEARCH_PROVIDERS[0],
);

// 歌单相关状态
let featuredCollapsed = $state(false);
let myCollapsed = $state(false);
let membersCollapsed = $state(false);
let featuredPlaylists = $state<PlaylistSummary[]>([]);
let myPlaylists = $state<PlaylistSummary[]>([]);
let membersPlaylists = $state<PlaylistSummary[]>([]);

const memberAvatarByKey = $derived.by(() => {
	const map = new Map<string, string>();
	for (const member of mentionMembers) {
		if (member.avatar) map.set(member.userKey, member.avatar);
	}
	return map;
});

const memberPlaylistGroups = $derived.by(() => {
	const groups = new Map<
		string,
		{
			ownerKey: string;
			ownerName: string;
			ownerAvatar: string;
			updatedAt: number;
			playlists: PlaylistSummary[];
		}
	>();
	for (const pl of membersPlaylists) {
		const key = pl.ownerKey || "unknown";
		const existing = groups.get(key);
		if (existing) {
			existing.playlists.push(pl);
			existing.updatedAt = Math.max(existing.updatedAt, pl.updatedAt || 0);
		} else {
			groups.set(key, {
				ownerKey: key,
				ownerName: pl.ownerName || "房友",
				ownerAvatar: pl.ownerAvatar || memberAvatarByKey.get(key) || "",
				updatedAt: pl.updatedAt || 0,
				playlists: [pl],
			});
		}
	}
	return [...groups.values()].sort((a, b) => b.updatedAt - a.updatedAt);
});
let rotation = $state<RoomRotation | null>(null);
let rotationExpanded = $state(false);
let rotationMode = $state<RoomRotation["mode"]>("off");
let rotationPlaylistIds = $state<string[]>([]);
let rotationSaving = $state(false);
let rotationError = $state("");
let rotationLoadError = $state("");
let rotationLoading = $state(false);
let rotationRequestSeq = 0;
let rotationDialogRoom = "";
let rotationDialogServer = "";
let rotationChoices = $state<PlaylistSummary[]>([]);
let rotationPlaylistSearch = $state("");
const filteredRotationChoices = $derived(
	rotationPlaylistSearch.trim()
		? rotationChoices.filter((playlist) => {
				const query = rotationPlaylistSearch.trim().toLowerCase();
				const displayTitle = playlist.id === "pl_collective_favorites" ? "全站收藏" : playlist.title;
				return (
					displayTitle.toLowerCase().includes(query) ||
					(playlist.ownerName && playlist.ownerName.toLowerCase().includes(query)) ||
					formatPlatformLabel(playlist.platform).toLowerCase().includes(query)
				);
			})
		: rotationChoices,
);

let rotationScrollTop = $state(0);
let rotationViewportH = $state(400);
const ROTATION_ROW_H = 62;
const VIRTUAL_ROTATION_THRESHOLD = 12;
const rotationWindowMemo = createVirtualWindowMemo<PlaylistSummary>();
let rotationScrollRaf: number | null = null;

function handleRotationScroll(e: Event) {
	const el = e.currentTarget as HTMLElement | null;
	if (!el) return;
	if (rotationScrollRaf !== null) return;
	rotationScrollRaf = requestAnimationFrame(() => {
		rotationScrollRaf = null;
		rotationScrollTop = el.scrollTop;
		if (el.clientHeight > 0) {
			rotationViewportH = el.clientHeight;
		}
	});
}

const rotationChoicesVirtual = $derived.by(() => {
	const list = filteredRotationChoices;
	const len = list.length;
	if (len <= VIRTUAL_ROTATION_THRESHOLD) {
		return rotationWindowMemo(list, `${len}:0:${len}`, () => ({
			items: list,
			start: 0,
			topSpacerPx: 0,
			bottomSpacerPx: 0,
		}));
	}
	const rawStart = Math.floor(rotationScrollTop / ROTATION_ROW_H) - 6;
	const STEP = 2;
	const steppedStart = Math.max(0, Math.floor(rawStart / STEP) * STEP);
	const visibleCount = Math.ceil(rotationViewportH / ROTATION_ROW_H) + 12 + STEP;
	const start = steppedStart;
	const end = Math.min(len, start + visibleCount);
	return rotationWindowMemo(list, `${len}:${start}:${end}`, () => ({
		items: list.slice(start, end),
		start,
		topSpacerPx: start * ROTATION_ROW_H,
		bottomSpacerPx: Math.max(0, (len - end) * ROTATION_ROW_H),
	}));
});
function normalizeRotationPlaylistIds(setting: RoomRotation | null): string[] {
	if (setting?.mode !== "playlist") return [];
	const raw = Array.isArray(setting.playlistIds)
		? setting.playlistIds
		: setting.playlistId
			? [setting.playlistId]
			: [];
	return [...new Set(raw.filter((id) => typeof id === "string" && id.trim().length > 0))];
}
const validSelectedRotationIds = $derived(
	rotationPlaylistIds.filter((id) => rotationChoices.some((playlist) => playlist.id === id)),
);
const canSaveRotation = $derived(
	rotationMode !== "playlist" || validSelectedRotationIds.length > 0,
);
let isLoadingPlaylists = $state(false);
let playlistsError = $state("");
let selectedPlaylist = $state<PlaylistDetail | null>(null);
let isLoadingPlaylistDetail = $state(false);
let enqueuingTrackIds = $state(new Set<string>());
let switchingQueueUid = $state<string | null>(null);
let switchingQueueTimer: number | null = null;
let lastHandledPlayUid: string | undefined = undefined;

function clearSwitchingQueue() {
	switchingQueueUid = null;
	if (switchingQueueTimer !== null) {
		window.clearTimeout(switchingQueueTimer);
		switchingQueueTimer = null;
	}
}

function handlePlayQueuedAction(uid: string) {
	if (!currentUser) {
		onRequestAuth?.();
		return;
	}
	if (switchingQueueUid || isSkippingTrack) return;
	switchingQueueUid = uid;
	if (switchingQueueTimer !== null) {
		window.clearTimeout(switchingQueueTimer);
	}
	switchingQueueTimer = window.setTimeout(() => {
		switchingQueueUid = null;
		switchingQueueTimer = null;
	}, 5000);
	onPlayQueued(uid);
}
let playlistTrackFilter = $state("");
let debouncedPlaylistFilter = $state("");
let playlistFilterTimer: number | null = null;
let importInput = $state("");
let isImportingPlaylist = $state(false);
let importStatusText = $state("");
let importError = $state("");
let pendingUserImport = $state<{
	platform: string;
	nickname: string;
	playlists: UserPlaylistCandidate[];
} | null>(null);
let pendingAmbiguousImport = $state<{
	query: string;
	candidates: AmbiguousResolveCandidate[];
} | null>(null);
let isRefreshingPlaylistId = $state("");
let isUpdatingFlagsId = $state("");
let confirmDeletePlaylistId = $state("");
let isDeletingPlaylistId = $state("");
let confirmDeleteTimer: number | null = null;

// 歌单与历史列表虚拟滚动状态
const VIRTUAL_MUSIC_THRESHOLD = 12;
const VIRTUAL_MUSIC_OVERSCAN = 6;
const playlistWindowMemo = createVirtualWindowMemo<PlaylistTrackItem>();
const historyWindowMemo = createVirtualWindowMemo<MusicHistoryEntry>();
let playlistScrollEl: HTMLDivElement | null = $state(null);
let playlistMetaBoxEl: HTMLDivElement | null = $state(null);
let playlistMetaHeight = $state(0);
let isCompactPlaylistHeader = $state(false);
let playlistScrollTop = $state(0);
let playlistViewportH = $state(480);
let musicPanelEl: HTMLElement | null = $state(null);
let playlistRowHeight = $state(52);
let desktopPlaylistRowHeight = 52;
let playlistScrollRaf: number | null = null;

let historyScrollEl: HTMLDivElement | null = $state(null);
let historyScrollTop = $state(0);
let historyViewportH = $state(480);
let historyScrollRaf: number | null = null;
let lastHistoryLoadCheck = Number.NEGATIVE_INFINITY;

// 歌词状态
let lyrics = $state<LyricLine[]>([]);
let lyricsStatus = $state<"idle" | "loading" | "ready" | "empty">("idle");
let activeLyricIndex = $state(-1);

let lyricsContainer: HTMLDivElement | null = $state(null);

let lyricFetchSeq = 0;
let lastUserScrollAt = 0;
let lastPlayUid = "";
let soloCooldownRemainSec = $state(0);
let pendingAutoUnmuteTrackId = "";
let pendingAutoUnmuteAt = 0;
const lyricsCache = new Map<string, LyricLine[]>();

const currentPlay = $derived(musicState?.current ?? null);

// 🌟 收藏系统全站联动状态与方法
let userFavoritedTrackIds = $state<Set<string>>(new Set());
let userFavoritedTitleArtists = $state<Set<string>>(new Set());
let favoriteTogglingTrackIds = $state<Set<string>>(new Set());
let favSparkleTrackIds = $state<Set<string>>(new Set());
let isCurrentFavorited = $state(false);
let currentFavCount = $state(0);
let isFavToggling = $state(false);
let isFavAnimating = $state(false);
let collectiveFilterUserKey = $state("");
let showCollectiveUserDropdown = $state(false);
let openFavoritersKey = $state("");
const activeFilterFavoriterName = $derived.by(() => {
	if (!collectiveFilterUserKey) return "";
	const p = selectedPlaylist?.favoriters?.find((f) => f.userKey === collectiveFilterUserKey);
	return p?.userName || "成员";
});

function getTrackTitleArtistKey(title?: string, artist?: string): string {
	if (!title) return "";
	const cleanTitle = title.toLowerCase().replace(/\s+/g, " ").trim();
	const cleanArtist = (artist || "").toLowerCase().replace(/\s+/g, " ").trim();
	return `${cleanTitle}:::${cleanArtist}`;
}

function isTrackFavorited(track?: { id?: string; sourceId?: string; sourceTrackId?: string; title?: string; artist?: string } | null): boolean {
	if (!track || !currentUser?.userKey) return false;
	if (track.id && userFavoritedTrackIds.has(track.id)) return true;
	if (track.sourceId && userFavoritedTrackIds.has(track.sourceId)) return true;
	if (track.sourceTrackId && userFavoritedTrackIds.has(track.sourceTrackId)) return true;
	if (track.id) {
		const bareId = track.id.replace(/^[a-z_]+:/i, "");
		if (bareId && userFavoritedTrackIds.has(bareId)) return true;
	}
	const taKey = getTrackTitleArtistKey(track.title, track.artist);
	if (taKey && userFavoritedTitleArtists.has(taKey)) return true;
	return false;
}

$effect(() => {
	const userKey = currentUser?.userKey || "";
	if (!userKey || !chatServerUrl) {
		userFavoritedTrackIds = new Set();
		userFavoritedTitleArtists = new Set();
		return;
	}
	let cancelled = false;
	const token = walineToken || (currentUser?.authType === "guest" ? readStoredGuestToken() : "");
	const authKind = currentUser?.authType === "guest" ? "guest" : "waline";

	void fetchUserFavoriteKeys({
		chatServerUrl,
		token,
		authKind,
		userKey,
	}).then((res) => {
		if (cancelled || !res?.ok) return;
		userFavoritedTrackIds = new Set(res.trackIds || []);
		userFavoritedTitleArtists = new Set(res.titleArtists || []);
	}).catch(() => {});

	return () => {
		cancelled = true;
	};
});

$effect(() => {
	const track = currentPlay?.track;
	const trackId = track?.id;
	const userKey = currentUser?.userKey || "";
	if (!track || !chatServerUrl) {
		isCurrentFavorited = false;
		currentFavCount = 0;
		return;
	}
	isCurrentFavorited = isTrackFavorited(track);

	let cancelled = false;
	const token = walineToken || (currentUser?.authType === "guest" ? readStoredGuestToken() : "");
	void fetchFavoriteTrackStatus({
		chatServerUrl,
		token,
		trackId: trackId || "",
		userKey,
	}).then((res) => {
		if (cancelled || !res) return;
		if (res.isFavorited) {
			isCurrentFavorited = true;
		}
		currentFavCount = Number(res.favCount) || 0;
	}).catch(() => {});

	return () => {
		cancelled = true;
	};
});

async function handleToggleFavoriteTrack(rawTrack?: ChatMusicTrack | PlaylistTrackItem | null): Promise<void> {
	if (!currentUser) {
		onRequestAuth?.();
		return;
	}
	if (!rawTrack) return;
	const track = "id" in rawTrack ? rawTrack : toEnqueueableTrack(rawTrack, selectedPlaylist?.id || "favorites");
	const trackId = track.id || "";
	const taKey = getTrackTitleArtistKey(track.title, track.artist);
	const lookupKey = trackId || taKey;

	if (favoriteTogglingTrackIds.has(lookupKey)) return;

	const nextToggling = new Set(favoriteTogglingTrackIds);
	nextToggling.add(lookupKey);
	favoriteTogglingTrackIds = nextToggling;

	const token = walineToken || (currentUser?.authType === "guest" ? readStoredGuestToken() : "");
	const authKind = currentUser?.authType === "guest" ? "guest" : "waline";

	try {
		const res = await toggleFavoriteTrack({
			chatServerUrl,
			token,
			authKind,
			track,
			userKey: currentUser?.userKey,
			userName: currentUser?.name,
			userAvatar: currentUser?.avatar,
		});

		const nextIds = new Set(userFavoritedTrackIds);
		const nextTAs = new Set(userFavoritedTitleArtists);

		if (res.favorited) {
			if (track.id) nextIds.add(track.id);
			if (res.track?.id) nextIds.add(res.track.id);
			if (taKey) nextTAs.add(taKey);
			onNotify?.(`已将《${track.title}》收藏到全站共享收藏`, "success");

			// 触发星星爆发动效
			const nextSparkles = new Set(favSparkleTrackIds);
			if (trackId) nextSparkles.add(trackId);
			if (taKey) nextSparkles.add(taKey);
			if (currentPlay?.track && (currentPlay.track.id === track.id || getTrackTitleArtistKey(currentPlay.track.title, currentPlay.track.artist) === taKey)) {
				nextSparkles.add("__current_play__");
				isCurrentFavorited = true;
				currentFavCount = res.favCount;
				isFavAnimating = true;
			}
			favSparkleTrackIds = nextSparkles;
			setTimeout(() => {
				const resetSparkles = new Set(favSparkleTrackIds);
				if (trackId) resetSparkles.delete(trackId);
				if (taKey) resetSparkles.delete(taKey);
				resetSparkles.delete("__current_play__");
				favSparkleTrackIds = resetSparkles;
				isFavAnimating = false;
			}, 700);
		} else {
			if (track.id) nextIds.delete(track.id);
			if (res.track?.id) nextIds.delete(res.track.id);
			if (taKey) nextTAs.delete(taKey);
			onNotify?.(`已取消收藏《${track.title}》`, "success");

			// 取消收藏时立即清除星星动效
			const nextSparkles = new Set(favSparkleTrackIds);
			if (trackId) nextSparkles.delete(trackId);
			if (taKey) nextSparkles.delete(taKey);
			nextSparkles.delete("__current_play__");
			favSparkleTrackIds = nextSparkles;

			if (currentPlay?.track && (currentPlay.track.id === track.id || getTrackTitleArtistKey(currentPlay.track.title, currentPlay.track.artist) === taKey)) {
				isCurrentFavorited = false;
				currentFavCount = res.favCount;
				isFavAnimating = false;
			}
		}

		userFavoritedTrackIds = nextIds;
		userFavoritedTitleArtists = nextTAs;
		const keys = await fetchUserFavoriteKeys({ chatServerUrl, token, authKind, userKey: currentUser?.userKey }).catch(() => null);
		if (keys?.ok) {
			userFavoritedTrackIds = new Set(keys.trackIds || []);
			userFavoritedTitleArtists = new Set(keys.titleArtists || []);
		}

		invalidatePlaylistCaches("pl_collective_favorites");
		if (selectedPlaylist?.id === "pl_collective_favorites") {
			void openPlaylistDetail("pl_collective_favorites", true, undefined, collectiveFilterUserKey);
		}
	} catch (err) {
		onNotify?.(err instanceof Error ? err.message : "收藏操作失败", "error");
	} finally {
		const resetToggling = new Set(favoriteTogglingTrackIds);
		resetToggling.delete(lookupKey);
		favoriteTogglingTrackIds = resetToggling;
	}
}

async function toggleFavoriteCurrentTrack(): Promise<void> {
	if (!currentUser) {
		onRequestAuth?.();
		return;
	}
	if (!currentPlay?.track || isFavToggling) return;
	isFavToggling = true;
	try {
		await handleToggleFavoriteTrack(currentPlay.track);
	} finally {
		isFavToggling = false;
	}
}

let trackContextMenu = $state<{
	track: ChatMusicTrack;
	x: number;
	y: number;
} | null>(null);
let trackLongPressTimer: ReturnType<typeof setTimeout> | null = null;
let trackLongPressStart = { x: 0, y: 0 };

function openTrackContextMenu(track: ChatMusicTrack, clientX: number, clientY: number) {
	if (typeof window === "undefined") return;
	const menuW = 196;
	const menuH = 186;
	const pad = 10;
	const x = Math.min(Math.max(pad, clientX), Math.max(pad, window.innerWidth - menuW - pad));
	const y = Math.min(Math.max(pad, clientY), Math.max(pad, window.innerHeight - menuH - pad));
	trackContextMenu = { track, x, y };
}

function closeTrackContextMenu() {
	trackContextMenu = null;
}

function cancelTrackLongPress() {
	if (trackLongPressTimer) {
		clearTimeout(trackLongPressTimer);
		trackLongPressTimer = null;
	}
}

function handleTrackRowContextMenu(event: MouseEvent, track: ChatMusicTrack) {
	event.preventDefault();
	event.stopPropagation();
	openTrackContextMenu(track, event.clientX, event.clientY);
}

function handleTrackRowPointerDown(event: PointerEvent, track: ChatMusicTrack) {
	if (event.pointerType !== "touch") return;
	cancelTrackLongPress();
	trackLongPressStart = { x: event.clientX, y: event.clientY };
	const cx = event.clientX;
	const cy = event.clientY;
	trackLongPressTimer = setTimeout(() => {
		trackLongPressTimer = null;
		openTrackContextMenu(track, cx, cy);
	}, 480);
}

function handleTrackRowPointerMove(event: PointerEvent) {
	if (!trackLongPressTimer) return;
	if (
		Math.abs(event.clientX - trackLongPressStart.x) > 10 ||
		Math.abs(event.clientY - trackLongPressStart.y) > 10
	) {
		cancelTrackLongPress();
	}
}

async function copyTrackInfo(track: ChatMusicTrack) {
	const text = `${track.title} - ${track.artist || "未知歌手"}`;
	try {
		await navigator.clipboard.writeText(text);
		onNotify?.(`已复制：${text}`, "success");
	} catch {
		onNotify?.("复制失败，请手动复制", "error");
	}
}

$effect(() => {
	if (!trackContextMenu) return;
	const onPointerDown = (e: PointerEvent) => {
		const target = e.target as HTMLElement | null;
		if (target?.closest("[data-track-context-menu]")) return;
		trackContextMenu = null;
	};
	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape") trackContextMenu = null;
	};
	const onScroll = () => {
		trackContextMenu = null;
	};
	window.addEventListener("pointerdown", onPointerDown, true);
	window.addEventListener("keydown", onKeyDown);
	window.addEventListener("scroll", onScroll, true);
	return () => {
		window.removeEventListener("pointerdown", onPointerDown, true);
		window.removeEventListener("keydown", onKeyDown);
		window.removeEventListener("scroll", onScroll, true);
	};
});

function handleFilterCollective(userKey: string): void {
	showCollectiveUserDropdown = false;
	if (collectiveFilterUserKey === userKey) return;
	collectiveFilterUserKey = userKey;
	playlistScrollTop = 0;
	if (playlistScrollEl) playlistScrollEl.scrollTop = 0;
	void openPlaylistDetail("pl_collective_favorites", true, undefined, userKey);
}

const queue = $derived(musicState?.queue ?? []);
const rotationQueue = $derived(musicState?.rotationQueue ?? []);
const rotationDeckTotal = $derived(musicState?.rotationDeckTotal ?? rotationQueue.length);
const rotationPoolTotal = $derived(musicState?.rotationPoolTotal ?? 0);
const rotationEmptyMessage = $derived(rotationPoolTotal > 0 && rotationDeckTotal === 0
	? "本轮已无待播歌曲，下一轮开始时重新洗牌"
	: "当前未开启歌单轮播或轮播池为空");

// 智能默认队列标签：无点播且有轮播时默认展示轮播，有点播时优先展示点播
$effect(() => {
	if (hasUserManuallySwitchedQueueTab) return;
	const qLen = queue.length;
	const rLen = rotationQueue.length;
	if (qLen === 0 && rLen > 0) {
		queueTab = "rotation";
	} else if (qLen > 0) {
		queueTab = "request";
	}
});
const historyRequesters = $derived.by<HistoryRequesterOption[]>(() => {
	const peopleMap = new Map<
		string,
		{
			key: string;
			name: string;
			avatar: string;
			tracks: Set<string>;
			totalRequests: number;
		}
	>();
	const coveredTrackIds = new Set<string>();

	for (const log of musicState?.historyLogs ?? []) {
		coveredTrackIds.add(log.track.id);
		const name = (log.requesterName || "").trim();
		const key = log.requesterKey || (name ? `name:${name}` : "");
		if (!key || !name) continue;
		const existing = peopleMap.get(key);
		if (existing) {
			existing.tracks.add(log.track.id);
			existing.totalRequests += 1;
			if (log.requesterAvatar) existing.avatar = log.requesterAvatar;
		} else {
			peopleMap.set(key, {
				key,
				name,
				avatar: log.requesterAvatar || "",
				tracks: new Set([log.track.id]),
				totalRequests: 1,
			});
		}
	}

	const namesInLogs = new Set(
		Array.from(peopleMap.values()).map((p) => p.name),
	);
	for (const item of musicState?.history ?? []) {
		if (coveredTrackIds.has(item.track.id)) continue;
		const name = (item.lastRequesterName || "").trim();
		if (!name || namesInLogs.has(name)) continue;
		const key = `name:${name}`;
		const existing = peopleMap.get(key);
		if (existing) {
			existing.tracks.add(item.track.id);
			existing.totalRequests += item.requestCount;
		} else {
			peopleMap.set(key, {
				key,
				name,
				avatar: "",
				tracks: new Set([item.track.id]),
				totalRequests: item.requestCount,
			});
		}
	}

	const memberByKey = new Map<string, { badge: string; authType?: string }>();
	for (const m of mentionMembers) {
		memberByKey.set(m.userKey, { badge: m.badge, authType: m.authType });
	}
	for (const m of onlineMembers) {
		memberByKey.set(m.userKey, { badge: m.badge, authType: m.authType });
	}

	return Array.from(peopleMap.values())
		.map((p) => {
			const meta = memberByKey.get(p.key);
			const rawBadge =
				(currentUser && p.key === currentUser.userKey
					? currentUser.badge
					: meta?.badge) || "";
			const badge = p.key.startsWith("waline:")
				? rawBadge === "访客" || !rawBadge
					? "认证"
					: rawBadge
				: rawBadge || (p.key.startsWith("guest:") ? "访客" : "");
			return {
				key: p.key,
				name:
					currentUser && p.key === currentUser.userKey
						? currentUser.name
						: p.name,
				avatar: p.avatar,
				badge,
				trackCount: p.tracks.size,
				totalRequests: p.totalRequests,
				isMe: Boolean(currentUser && p.key === currentUser.userKey),
			};
		})
		.sort((a, b) => {
			if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
			return (
				b.totalRequests - a.totalRequests ||
				a.name.localeCompare(b.name, "zh-CN")
			);
		});
});

const selectedRequester = $derived(
	historyRequesters.find((r) => r.key === selectedRequesterKey) ?? null,
);

const displayedHistoryEntries = $derived.by<MusicHistoryEntry[]>(() => {
	const sortHistory = (list: MusicHistoryEntry[]) =>
		list.sort((a, b) => {
			if (historySort === "recent") {
				return (
					b.lastRequestedAt - a.lastRequestedAt ||
					b.requestCount - a.requestCount
				);
			}
			// 按点播次数降序；次数相同时按时间正序（谁先点过的在最上面）
			return (
				b.requestCount - a.requestCount ||
				a.firstRequestedAt - b.firstRequestedAt ||
				a.lastRequestedAt - b.lastRequestedAt
			);
		});

	if (selectedRequesterKey) {
		const targetMap = new Map<string, MusicHistoryEntry>();
		for (const log of musicState?.historyLogs ?? []) {
			const logKey =
				log.requesterKey ||
				(log.requesterName ? `name:${log.requesterName}` : "");
			if (logKey !== selectedRequesterKey) continue;
			const existing = targetMap.get(log.track.id);
			if (existing) {
				existing.requestCount += 1;
				if (log.requestedAt < existing.firstRequestedAt) {
					existing.firstRequestedAt = log.requestedAt;
				}
				if (log.requestedAt >= existing.lastRequestedAt) {
					existing.lastRequestedAt = log.requestedAt;
					existing.track = log.track;
					existing.lastRequesterName =
						selectedRequester?.name || log.requesterName;
				}
			} else {
				targetMap.set(log.track.id, {
					track: log.track,
					requestCount: 1,
					lastRequesterName: selectedRequester?.name || log.requesterName,
					firstRequestedAt: log.requestedAt,
					lastRequestedAt: log.requestedAt,
				});
			}
		}

		if (targetMap.size === 0 && selectedRequester) {
			for (const item of musicState?.history ?? []) {
				if (item.lastRequesterName === selectedRequester.name) {
					targetMap.set(item.track.id, { ...item });
				}
			}
		}
		return sortHistory([...targetMap.values()]);
	}

	const mergedMap = new Map<string, MusicHistoryEntry>();
	for (const item of musicState?.history ?? []) {
		mergedMap.set(item.track.id, { ...item });
	}
	for (const log of musicState?.historyLogs ?? []) {
		if (!mergedMap.has(log.track.id)) {
			mergedMap.set(log.track.id, {
				track: log.track,
				requestCount: log.requestCount,
				lastRequesterName: log.requesterName,
				firstRequestedAt: log.requestedAt,
				lastRequestedAt: log.requestedAt,
			});
		}
	}
	return sortHistory([...mergedMap.values()]);
});

const activeHistoryEntries = $derived.by<MusicHistoryEntry[]>(() => {
	if (historyFilterType === "all") {
		if (pagedAllHistory.length > 0) {
			return pagedAllHistory;
		}
		return displayedHistoryEntries;
	}
	if (historyFilterType === "rotation") {
		return pagedRotationHistory;
	}
	if (pagedRequestHistory.length > 0) {
		return pagedRequestHistory;
	}
	return displayedHistoryEntries;
});

const activeHistoryTotal = $derived.by<number>(() => {
	if (historyFilterType === "all") {
		return (
			allHistoryTotal ||
			pagedAllHistory.length ||
			displayedHistoryEntries.length
		);
	}
	if (historyFilterType === "rotation") {
		return rotationHistoryTotal || pagedRotationHistory.length;
	}
	return (
		requestHistoryTotal ||
		(selectedRequesterKey
			? displayedHistoryEntries.length
			: (musicState?.history?.length ?? displayedHistoryEntries.length))
	);
});

const isCurrentHistoryLoading = $derived(
	historyFilterType === "all"
		? isAllHistoryLoading
		: historyFilterType === "rotation"
			? isRotationHistoryLoading
			: isRequestHistoryLoading,
);

const isCurrentHistoryLoadingMore = $derived(
	historyFilterType === "all"
		? isAllHistoryLoadingMore
		: historyFilterType === "rotation"
			? isRotationHistoryLoadingMore
			: isRequestHistoryLoadingMore,
);

const currentHistoryHasMore = $derived(
	historyFilterType === "all"
		? allHistoryHasMore
		: historyFilterType === "rotation"
			? rotationHistoryHasMore
			: requestHistoryHasMore,
);

const historyVirtual = $derived.by(() => {
	const list = activeHistoryEntries;
	const len = list.length;
	const rowH = Math.max(44, playlistRowHeight);
	if (len <= VIRTUAL_MUSIC_THRESHOLD) {
		return historyWindowMemo(list, `${len}:0:${len}:${rowH}`, () => ({
			items: list,
			start: 0,
			topSpacerPx: 0,
			bottomSpacerPx: 0,
		}));
	}
	const viewH = Math.max(240, historyViewportH);
	const rawStart = Math.floor(historyScrollTop / rowH) - VIRTUAL_MUSIC_OVERSCAN;
	const STEP = 4;
	const steppedStart = Math.max(0, Math.floor(rawStart / STEP) * STEP);
	const visibleCount = Math.ceil(viewH / rowH) + VIRTUAL_MUSIC_OVERSCAN * 2 + STEP;
	const start = steppedStart;
	const end = Math.min(len, start + visibleCount);
	return historyWindowMemo(list, `${len}:${start}:${end}:${rowH}`, () => ({
		items: list.slice(start, end),
		start,
		topSpacerPx: start * rowH,
		bottomSpacerPx: Math.max(0, (len - end) * rowH),
	}));
});

async function loadHistoryPage(
	tab: "all" | "request" | "rotation",
	isNextPage = false,
): Promise<void> {
	if (isNextPage) {
		if (tab === "all") {
			if (isAllHistoryLoadingMore || !allHistoryHasMore) return;
			isAllHistoryLoadingMore = true;
		} else if (tab === "request") {
			if (isRequestHistoryLoadingMore || !requestHistoryHasMore) return;
			isRequestHistoryLoadingMore = true;
		} else {
			if (isRotationHistoryLoadingMore || !rotationHistoryHasMore) return;
			isRotationHistoryLoadingMore = true;
		}
	} else {
		if (tab === "all") {
			isAllHistoryLoading = true;
		} else if (tab === "request") {
			isRequestHistoryLoading = true;
		} else {
			isRotationHistoryLoading = true;
		}
	}

	const seq = ++historyReqSeq;
	const currentList =
		tab === "all"
			? pagedAllHistory
			: tab === "request"
				? pagedRequestHistory
				: pagedRotationHistory;
	const offset = isNextPage ? currentList.length : 0;

	try {
		const res = await fetchMusicHistory(chatServerUrl, {
			roomId,
			type: tab,
			sort: historySort,
			requesterKey: tab !== "rotation" ? selectedRequesterKey : undefined,
			offset,
			limit: 100,
		});

		if (seq !== historyReqSeq) return;

		if (res?.ok && Array.isArray(res.items)) {
			if (tab === "all") {
				allHistoryTotal = res.total;
				allHistoryHasMore = res.hasMore;
				if (isNextPage) {
					const existingIds = new Set(pagedAllHistory.map((e) => e.track.id));
					const newItems = res.items.filter((e) => !existingIds.has(e.track.id));
					pagedAllHistory = [...pagedAllHistory, ...newItems];
				} else {
					pagedAllHistory = res.items;
				}
			} else if (tab === "request") {
				requestHistoryTotal = res.total;
				requestHistoryHasMore = res.hasMore;
				if (isNextPage) {
					const existingIds = new Set(pagedRequestHistory.map((e) => e.track.id));
					const newItems = res.items.filter((e) => !existingIds.has(e.track.id));
					pagedRequestHistory = [...pagedRequestHistory, ...newItems];
				} else {
					pagedRequestHistory = res.items;
				}
			} else {
				rotationHistoryTotal = res.total;
				rotationHistoryHasMore = res.hasMore;
				if (isNextPage) {
					const existingIds = new Set(
						pagedRotationHistory.map((e) => e.track.id),
					);
					const newItems = res.items.filter((e) => !existingIds.has(e.track.id));
					pagedRotationHistory = [...pagedRotationHistory, ...newItems];
				} else {
					pagedRotationHistory = res.items;
				}
			}
		}
	} catch (err) {
		console.warn("[MusicPanel] 加载历史记录失败:", err);
	} finally {
		if (seq === historyReqSeq) {
			if (tab === "all") {
				isAllHistoryLoading = false;
				isAllHistoryLoadingMore = false;
			} else if (tab === "request") {
				isRequestHistoryLoading = false;
				isRequestHistoryLoadingMore = false;
			} else {
				isRotationHistoryLoading = false;
				isRotationHistoryLoadingMore = false;
			}
		}
	}
}

function switchHistoryFilter(
	filter: "all" | "request" | "rotation",
	requesterKey = "",
): void {
	if (historyFilterType === filter && selectedRequesterKey === requesterKey) return;
	historyFilterType = filter;
	selectedRequesterKey = requesterKey;
	if (historyScrollEl) {
		historyScrollEl.scrollTop = 0;
		historyScrollTop = 0;
	}
	void loadHistoryPage(filter, false);
}

$effect(() => {
	if (activeTab === "history") {
		const _tab = historyFilterType;
		const _sort = historySort;
		const _filter = selectedRequesterKey;
		const _room = roomId;
		untrack(() => {
			void loadHistoryPage(_tab, false);
		});
	}
});

function handleHistoryScroll(): void {
	if (!historyScrollEl || historyScrollRaf !== null) return;
	historyScrollRaf = requestAnimationFrame(() => {
		historyScrollRaf = null;
		if (!historyScrollEl) return;
		historyScrollTop = historyScrollEl.scrollTop;

		// 边滚动边加载：当距离底部小于 260px 时，自动加载下一页 100 首。
		// 读取 scrollHeight 会触发布局，限制为每 150ms 最多检查一次。
		const now = performance.now();
		if (now - lastHistoryLoadCheck >= 150) {
			lastHistoryLoadCheck = now;
			const { scrollTop, scrollHeight, clientHeight } = historyScrollEl;
			if (scrollHeight - (scrollTop + clientHeight) < 260) {
				void loadHistoryPage(historyFilterType, true);
			}
		}
	});
}
$effect(() => {
	const el = playlistScrollEl;
	if (!el) return;
	const observer = new ResizeObserver(() => {
		if (el.clientHeight > 0) playlistViewportH = el.clientHeight;
	});
	observer.observe(el);
	return () => observer.disconnect();
});

$effect(() => {
	const el = historyScrollEl;
	if (!el) return;
	const observer = new ResizeObserver(() => {
		if (el.clientHeight > 0) historyViewportH = el.clientHeight;
	});
	observer.observe(el);
	return () => observer.disconnect();
});

$effect(() => {
	const el = playlistMetaBoxEl;
	if (!el) return;
	const update = () => {
		playlistMetaHeight = el.offsetHeight;
	};
	update();
	const observer = new ResizeObserver(update);
	observer.observe(el);
	return () => observer.disconnect();
});

const effectiveDuration = $derived.by(() => {
	if (currentPlay && currentPlay.durationSec > 0) {
		return currentPlay.durationSec;
	}
	return localDuration;
});

const progressRatio = $derived(
	effectiveDuration > 0
		? Math.min(1, Math.max(0, roomElapsed / effectiveDuration))
		: 0,
);
const volumeRatio = $derived(isListening ? volume : 0);

const queuedTrackIds = $derived(new Set(queue.map((item) => item.track.id)));

$effect(() => {
	if (enqueuingTrackIds.size > 0) {
		const currentId = currentPlay?.track.id;
		const currentTa = currentPlay?.track ? getTrackTitleArtistKey(currentPlay.track.title, currentPlay.track.artist) : "";
		const queuedKeys = new Set<string>();
		for (const item of queue) {
			queuedKeys.add(item.track.id);
			if (item.track.sourceId) queuedKeys.add(item.track.sourceId);
			const bare = item.track.id.replace(/^[a-z_]+:/i, "");
			if (bare) queuedKeys.add(bare);
			const ta = getTrackTitleArtistKey(item.track.title, item.track.artist);
			if (ta) queuedKeys.add(ta);
		}
		let changed = false;
		for (const key of enqueuingTrackIds) {
			if (
				key === currentId ||
				(currentTa && key === currentTa) ||
				queuedKeys.has(key)
			) {
				enqueuingTrackIds.delete(key);
				changed = true;
			}
		}
		if (changed) {
			enqueuingTrackIds = new Set(enqueuingTrackIds);
		}
	}
});

$effect(() => {
	const currentUid = currentPlay?.uid;
	if (lastHandledPlayUid === undefined) {
		lastHandledPlayUid = currentUid;
		return;
	}
	if (currentUid !== lastHandledPlayUid) {
		lastHandledPlayUid = currentUid;
		clearSwitchingQueue();
	}
});

$effect(() => {
	if (switchingQueueUid && !queue.some((item) => item.uid === switchingQueueUid)) {
		clearSwitchingQueue();
	}
});

const currentRequesterAvatar = $derived.by(() => {
	if (
		!currentPlay ||
		currentPlay.isFallback ||
		!currentPlay.requesterKey ||
		currentPlay.requesterKey === "system:fallback"
	) {
		return "";
	}
	if (
		currentUser &&
		currentPlay.requesterKey === currentUser.userKey &&
		currentUser.avatar
	) {
		return currentUser.avatar;
	}
	const memberMatch = mentionMembers.find(
		(m) => m.userKey === currentPlay.requesterKey && m.avatar,
	);
	if (memberMatch?.avatar) return memberMatch.avatar;
	const logMatch = (musicState?.historyLogs ?? []).find(
		(l) => l.requesterKey === currentPlay.requesterKey && l.requesterAvatar,
	);
	return logMatch?.requesterAvatar || "";
});

const currentRotationPlaylistCover = $derived.by(() => {
	if (!currentPlay || !currentPlay.isFallback) return "";
	if (currentPlay.requesterAvatar) return currentPlay.requesterAvatar;
	if (currentPlay.track?.sourcePlaylistCover) return currentPlay.track.sourcePlaylistCover;
	const plId = currentPlay.track?.sourcePlaylistId || musicState?.fallbackPlaylistId;
	if (plId) {
		const found = [...featuredPlaylists, ...myPlaylists, ...membersPlaylists].find((p) => p.id === plId);
		if (found?.coverUrl) return found.coverUrl;
	}
	return "";
});

function getTrackArtistAndAlbum(track?: ChatMusicTrack | null): string {
	if (!track) return "";
	const artist = (track.artist || "").trim();
	const album = (track.album || "").trim();
	if (album && album !== artist) {
		return artist ? `${artist} - ${album}` : album;
	}
	return artist || "未知歌手";
}

const isAdmin = $derived(Boolean(currentUser?.isAdmin));
const isOwnRequest = $derived(
	Boolean(
		currentUser &&
			currentPlay &&
			!currentPlay.isFallback &&
			currentPlay.requesterKey === currentUser.userKey,
	),
);
// 能否直接切歌：
// 1. 歌单轮播歌单：所有人随便切
// 2. 自己点的歌：自己随便切
// 3. 站长：随便切
// 4. 正在听歌人数 <= 2：无论谁都可以随便切
const canDirectSkip = $derived(
	Boolean(currentPlay) &&
		(currentPlay.isFallback ||
			(Boolean(currentUser) &&
				(isAdmin ||
					isOwnRequest ||
					listeningMemberCount <= 2))),
);
const isSoloCoolingDown = $derived(false);

function refreshSoloCooldown(): void {
	const until = musicState?.soloCooldownUntil ?? 0;
	if (!until) {
		soloCooldownRemainSec = 0;
		return;
	}
	const serverNow = Date.now() + clockOffsetMs;
	soloCooldownRemainSec = Math.max(0, Math.ceil((until - serverNow) / 1000));
}

$effect(() => {
	musicState?.soloCooldownUntil;
	clockOffsetMs;
	refreshSoloCooldown();
});

const hasVotedSkip = $derived(
	Boolean(currentUser && currentPlay?.skipVotes.includes(currentUser.userKey)),
);

function canRemoveEntry(entry: QueueEntry): boolean {
	if (!currentUser) return false;
	return currentUser.isAdmin || entry.requesterKey === currentUser.userKey;
}

function handleRemoveRotationTrackAction(item: RotationQueueItem) {
	if (!currentUser) {
		onRequestAuth?.();
		return;
	}
	onRemoveRotationTrack?.(item);
}

let isShufflingRotation = $state(false);

function triggerShuffleRotation() {
	if (!currentUser) {
		onRequestAuth?.();
		return;
	}
	if (rotationQueue.length <= 1) {
		onNotify?.("当前轮播曲目不足，无需重新洗牌", "default");
		return;
	}
	if (isShufflingRotation) return;
	isShufflingRotation = true;
	window.setTimeout(() => {
		isShufflingRotation = false;
	}, 650);
	onShuffleRotation?.();
}

function canToggleCatalogTrack(song: ChatMusicTrack): boolean {
	if (!currentUser) return true; // Clicking prompts auth modal via parent
	if (currentUser.isAdmin) return true;
	const existing = findQueuedEntryForSong(song);
	return !existing || existing.requesterKey === currentUser.userKey;
}

function switchMusicTab(tab: MusicTab) {
	activeTab = tab;
}

const personalPlaylistAuth = $derived(
	playlistAuth && currentUser?.authType === playlistAuth.kind ? playlistAuth : undefined,
);

function playlistAuthKey(auth?: PlaylistAuth): string {
	return auth ? `${auth.kind}:${auth.token}` : "";
}

const isWalineLoggedIn = $derived(
	Boolean(currentUser && currentUser.authType === "waline" && walineToken),
);

const rotationTooltipText = "歌单轮播设置";

function formatPlaylistDate(ts: number): string {
	if (!ts) return "";
	const d = new Date(ts);
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	return `${m}-${day} ${hh}:${mm}`;
}

function canManagePlaylist(playlist: PlaylistSummary | null): boolean {
	if (!playlist || !personalPlaylistAuth || !currentUser) return false;
	return currentUser.isAdmin || playlist.ownerKey === currentUser.userKey;
}

/** 只有歌单主人能删除；站长操作成员歌单时也不给删除入口，避免误删他人歌单 */
function isOwnPlaylist(playlist: PlaylistSummary | null): boolean {
	return Boolean(
		playlist && currentUser && playlist.ownerKey === currentUser.userKey,
	);
}

function resolveSafeExternalUrl(raw?: string): string {
	const trimmed = (raw || "").trim();
	if (!trimmed) return "";
	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol === "https:" || parsed.protocol === "http:") {
			return parsed.toString();
		}
	} catch {
		// Ignore non-URL source strings
	}
	return "";
}

const PLAYLIST_CACHE_TTL_MS = 30 * 1000;
const SEARCH_CACHE_TTL_MS = 30 * 1000;
const MAX_PLAYLIST_DETAIL_CACHE = 20;
let lastLoadedPlaylistKey = "";
let lastLoadedPlaylistAt = 0;
const playlistDetailCache = new Map<
	string,
	{ detail: PlaylistDetail; fetchedAt: number }
>();

function setPlaylistDetailCache(
	key: string,
	value: { detail: PlaylistDetail; fetchedAt: number },
): void {
	playlistDetailCache.delete(key);
	const capacity = Math.max(MAX_PLAYLIST_DETAIL_CACHE, featuredPlaylists.length + myPlaylists.length + membersPlaylists.length + 5);
	if (playlistDetailCache.size >= capacity) {
		const oldest = playlistDetailCache.keys().next().value;
		if (oldest !== undefined) playlistDetailCache.delete(oldest);
	}
	playlistDetailCache.set(key, value);
}
const pendingPlaylistDetails = new Map<string, Promise<PlaylistDetail>>();
const pendingPlaylistProgress = new Map<string, {
	listeners: Set<(detail: PlaylistDetail) => void>;
	latest?: PlaylistDetail;
}>();
let playlistHoverTimer: number | null = null;
const searchResultCache = new Map<
	string,
	{ tracks: ChatMusicTrack[]; hasMore: boolean; provider: SearchProvider; fetchedAt: number }
>();

function invalidatePlaylistCaches(playlistId?: string): void {
	lastLoadedPlaylistKey = "";
	lastLoadedPlaylistAt = 0;
	if (playlistId) {
		for (const key of playlistDetailCache.keys()) {
			if (key.includes(`|${playlistId}|`)) {
				playlistDetailCache.delete(key);
			}
		}
		for (const key of pendingPlaylistDetails.keys()) {
			if (key.includes(`|${playlistId}|`)) {
				pendingPlaylistDetails.delete(key);
				pendingPlaylistProgress.delete(key);
			}
		}
	} else {
		playlistDetailCache.clear();
		pendingPlaylistDetails.clear();
		pendingPlaylistProgress.clear();
	}
}

function invalidatePlaylistDetailEntries(room: string, auth: string, playlistId: string): void {
	const prefix = `${room}|${auth}|${playlistId}|`;
	for (const key of playlistDetailCache.keys()) {
		if (key.startsWith(prefix)) playlistDetailCache.delete(key);
	}
	for (const key of pendingPlaylistDetails.keys()) {
		if (key.startsWith(prefix)) {
			pendingPlaylistDetails.delete(key);
			pendingPlaylistProgress.delete(key);
		}
	}
}

let lastPlaylistSummarySigs = new Map<string, string>();
let lastRoomPlaylistSnapshot = "";

async function loadPlaylists(force = false): Promise<void> {
	if (!chatServerUrl) return;
	const auth = personalPlaylistAuth;
	const authSeg = playlistAuthKey(auth);
	const cacheKey = `${roomId}|${authSeg}|${playlistRefreshSeq}`;
	if (
		!force &&
		lastLoadedPlaylistKey === cacheKey &&
		Date.now() - lastLoadedPlaylistAt < PLAYLIST_CACHE_TTL_MS
	) {
		return;
	}
	isLoadingPlaylists = true;
	playlistsError = "";
	try {
		const res = await fetchRoomPlaylists(chatServerUrl, roomId, auth);
		if (authSeg !== playlistAuthKey(personalPlaylistAuth)) return;
		const now = Date.now();
		const allSummaries = [...res.featured, ...res.mine, ...res.members];
		const nextSigs = new Map<string, string>();
		let summaryChanged = false;
		const snapshotKey = authSeg + "#" + allSummaries
			.map((p) => `${p.id}:${p.updatedAt ?? 0}:${p.trackCount}:${p.isFeatured}:${p.isFallback}:${p.isPublic}`)
			.join("|") + `#${JSON.stringify(res.rotation ?? null)}`;

		for (const p of allSummaries) {
			const sig = `${p.updatedAt ?? 0}:${p.trackCount}:${p.title}`;
			nextSigs.set(p.id, sig);
			const prevSig = lastPlaylistSummarySigs.get(p.id);
			if (prevSig !== undefined && prevSig !== sig) {
				invalidatePlaylistDetailEntries(roomId, authSeg, p.id);
			}
		}
		for (const oldId of lastPlaylistSummarySigs.keys()) {
			if (!nextSigs.has(oldId)) {
				invalidatePlaylistDetailEntries(roomId, authSeg, oldId);
			}
		}
		lastPlaylistSummarySigs = nextSigs;
		summaryChanged = snapshotKey !== lastRoomPlaylistSnapshot;
		lastRoomPlaylistSnapshot = snapshotKey;

		if (summaryChanged) {
			featuredPlaylists = res.featured;
			myPlaylists = res.mine;
			membersPlaylists = res.members;
			rotation = res.rotation ?? null;
		}
		if (res.details) {
			for (const [pid, detail] of Object.entries(res.details)) {
				setPlaylistDetailCache(`${roomId}|${authSeg}|${pid}|`, {
					detail,
					fetchedAt: now,
				});
			}
		}
		lastLoadedPlaylistKey = cacheKey;
		lastLoadedPlaylistAt = now;
		if (selectedPlaylist && summaryChanged) {
			const stillExists = allSummaries.find(
				(p) => p.id === selectedPlaylist?.id,
			);
			if (stillExists) {
				selectedPlaylist = {
					...selectedPlaylist,
					isFeatured: stillExists.isFeatured,
					isFallback: stillExists.isFallback,
					isPublic: stillExists.isPublic,
				};
			} else if (lastPlaylistSummarySigs.has(selectedPlaylist.id)) {
				selectedPlaylist = null;
				isLoadingPlaylistDetail = false;
				playlistTrackFilter = "";
			}
		}
	} catch (err) {
		if (authSeg === playlistAuthKey(personalPlaylistAuth)) {
			playlistsError = err instanceof Error ? err.message : "加载歌单列表失败";
		}
	} finally {
		if (authSeg === playlistAuthKey(personalPlaylistAuth)) isLoadingPlaylists = false;
	}
}

let lastExternalPlaylistSeq = 0;

$effect(() => {
	if (
		externalPlaylistRequest &&
		externalPlaylistRequest.seq > 0 &&
		externalPlaylistRequest.seq !== lastExternalPlaylistSeq
	) {
		lastExternalPlaylistSeq = externalPlaylistRequest.seq;
		if (!currentUser) {
			onRequestAuth?.();
			return;
		}
		activeTab = "playlist";
		void openPlaylistDetail(
			externalPlaylistRequest.playlistId,
			false,
			externalPlaylistRequest.summary,
		);
	}
});

function openRequesterProfile(requesterKey: string, requesterName: string) {
	if (
		!onOpenUserProfile ||
		!requesterKey ||
		requesterKey === "system:fallback"
	) {
		return;
	}
	onOpenUserProfile({
		userKey: requesterKey,
		name: requesterName || "房友",
	});
}

function openPlaylistFromPlayer(playlistId?: string) {
	if (!playlistId) return;
	activeTab = "playlist";
	void openPlaylistDetail(playlistId, false);
}

function resolveOwnerAvatar(ownerKey: string, fallbackAvatar?: string): string {
	if (fallbackAvatar) return fallbackAvatar;
	if (!ownerKey) return "";
	if (currentUser?.userKey === ownerKey && currentUser.avatar) {
		return currentUser.avatar;
	}
	const online = onlineMembers.find((m) => m.userKey === ownerKey);
	if (online?.avatar) return online.avatar;
	const mention = mentionMembers.find((m) => m.userKey === ownerKey);
	if (mention?.avatar) return mention.avatar;
	return "";
}

async function getOrFetchPlaylistDetail(
	playlistId: string,
	auth: PlaylistAuth | undefined,
	force = false,
	filterUser?: string,
	onPartial?: (detail: PlaylistDetail) => void,
): Promise<PlaylistDetail> {
	const detailKey = `${roomId}|${playlistAuthKey(auth)}|${playlistId}|${filterUser || ""}`;
	if (!force) {
		const cached = playlistDetailCache.get(detailKey);
		if (cached && Date.now() - cached.fetchedAt < PLAYLIST_CACHE_TTL_MS) {
			return cached.detail;
		}
		const pending = pendingPlaylistDetails.get(detailKey);
		if (pending) {
			const progress = pendingPlaylistProgress.get(detailKey);
			if (onPartial && progress) {
				progress.listeners.add(onPartial);
				if (progress.latest) onPartial(progress.latest);
				try { return await pending; } finally { progress.listeners.delete(onPartial); }
			}
			return pending;
		}
	}

	const progress = { listeners: new Set<(detail: PlaylistDetail) => void>(), latest: undefined as PlaylistDetail | undefined };
	if (onPartial) progress.listeners.add(onPartial);
	const task = fetchPlaylistDetail(
		chatServerUrl,
		roomId,
		playlistId,
		auth,
		filterUser,
		(partial) => {
			progress.latest = partial;
			for (const listener of progress.listeners) listener(partial);
		},
	).then((detail) => {
		if (pendingPlaylistDetails.get(detailKey) === task) {
			setPlaylistDetailCache(detailKey, { detail, fetchedAt: Date.now() });
		}
		return detail;
	});
	pendingPlaylistDetails.set(detailKey, task);
	pendingPlaylistProgress.set(detailKey, progress);
	try {
		return await task;
	} finally {
		if (pendingPlaylistDetails.get(detailKey) === task) {
			pendingPlaylistDetails.delete(detailKey);
			pendingPlaylistProgress.delete(detailKey);
		}
	}
}

function cancelPlaylistDetailPrefetch(): void {
	if (playlistHoverTimer !== null) {
		window.clearTimeout(playlistHoverTimer);
		playlistHoverTimer = null;
	}
}

function schedulePlaylistDetailPrefetch(playlistId: string): void {
	if (!chatServerUrl || !playlistId) return;
	cancelPlaylistDetailPrefetch();
	const auth = personalPlaylistAuth;
	const authSeg = playlistAuthKey(auth);
	const detailKey = `${roomId}|${authSeg}|${playlistId}|`;
	const cached = playlistDetailCache.get(detailKey);
	if (cached && Date.now() - cached.fetchedAt < PLAYLIST_CACHE_TTL_MS) return;
	if (pendingPlaylistDetails.has(detailKey)) return;

	playlistHoverTimer = window.setTimeout(() => {
		playlistHoverTimer = null;
		void getOrFetchPlaylistDetail(playlistId, auth).catch(() => {});
	}, 180);
}

function findPlaylistSummary(playlistId: string): PlaylistSummary | undefined {
	return (
		featuredPlaylists.find((p) => p.id === playlistId) ??
		myPlaylists.find((p) => p.id === playlistId) ??
		membersPlaylists.find((p) => p.id === playlistId)
	);
}

function syncDetailFlags(detail: PlaylistDetail): PlaylistDetail {
	const inFeatured = featuredPlaylists.some((p) => p.id === detail.id);
	const inFallback = [...featuredPlaylists, ...myPlaylists, ...membersPlaylists].some(
		(p) => p.id === detail.id && p.isFallback,
	);
	return {
		...detail,
		isFeatured: inFeatured || Boolean(detail.isFeatured),
		isFallback: inFallback || Boolean(detail.isFallback),
	};
}

let playlistDetailRequestSeq = 0;
let displayedPlaylistAuthKey = "";

$effect(() => {
	const key = playlistAuthKey(personalPlaylistAuth);
	if (displayedPlaylistAuthKey === key) return;
	displayedPlaylistAuthKey = key;
	myPlaylists = [];
	selectedPlaylist = null;
	isLoadingPlaylistDetail = false;
	isLoadingPlaylists = false;
	playlistDetailRequestSeq++;
	invalidatePlaylistCaches();
});

async function openPlaylistDetail(
	playlistId: string,
	force = false,
	initialSummary?: Partial<PlaylistSummary> | PlaylistDetail,
	filterUser?: string,
): Promise<void> {
	if (!chatServerUrl) return;
	const isNewPlaylist = selectedPlaylist?.id !== playlistId;
	const requestSeq = ++playlistDetailRequestSeq;
	cancelPlaylistDetailPrefetch();
	const auth = personalPlaylistAuth;
	const authSeg = playlistAuthKey(auth);
	const detailKey = `${roomId}|${authSeg}|${playlistId}|${filterUser || ""}`;

	// 1. 若本地已有新鲜缓存且非强制刷新，立刻以完整详情打开
	if (!force) {
		const cached = playlistDetailCache.get(detailKey);
		if (cached && Date.now() - cached.fetchedAt < PLAYLIST_CACHE_TTL_MS) {
			selectedPlaylist = syncDetailFlags(cached.detail);
			isLoadingPlaylistDetail = false;
			if (isNewPlaylist) playlistTrackFilter = "";
			confirmDeletePlaylistId = "";
			playlistsError = "";
			return;
		}
	}

	// 2. 核心优化：先立刻进入歌单详情页（保留已有/概览元数据，曲目转圈异步加载），彻底消除点击不跟手的延迟感
	const existing = selectedPlaylist?.id === playlistId ? selectedPlaylist : undefined;
	const summaryFromList = findPlaylistSummary(playlistId);
	const baseSummary = initialSummary ?? existing ?? summaryFromList;
	const existingTracks = existing?.tracks ?? playlistDetailCache.get(detailKey)?.detail?.tracks ?? [];

	selectedPlaylist = syncDetailFlags({
		...existing,
		id: playlistId,
		ownerKey: baseSummary?.ownerKey ?? "",
		ownerName: baseSummary?.ownerName ?? "",
		ownerAvatar: baseSummary?.ownerAvatar,
		title: baseSummary?.title || "歌单",
		subtitle: baseSummary?.subtitle,
		platform: baseSummary?.platform || "external",
		sourceUrl: baseSummary?.sourceUrl || "",
		coverUrl: baseSummary?.coverUrl || "",
		creator: baseSummary?.creator || "",
		trackCount: baseSummary?.trackCount ?? existingTracks.length,
		retrievalMode: baseSummary?.retrievalMode ?? "full",
		isPublic: baseSummary?.isPublic ?? true,
		isFeatured: baseSummary?.isFeatured ?? false,
		isFallback: baseSummary?.isFallback ?? false,
		isSystemProtected: baseSummary?.isSystemProtected ?? false,
		createdAt: baseSummary?.createdAt ?? Date.now(),
		updatedAt: baseSummary?.updatedAt ?? Date.now(),
		tracks: existingTracks,
	});

	isLoadingPlaylistDetail = true;
	playlistsError = "";
	confirmDeletePlaylistId = "";
	if (isNewPlaylist) playlistTrackFilter = "";

	// 3. 后台异步拉取曲目清单与最新数据
	try {
		const detail = await getOrFetchPlaylistDetail(playlistId, auth, force, filterUser, (partial) => {
			if (isNewPlaylist && existingTracks.length === 0 && requestSeq === playlistDetailRequestSeq && selectedPlaylist?.id === playlistId) {
				selectedPlaylist = syncDetailFlags(partial);
			}
		});
		if (requestSeq === playlistDetailRequestSeq && selectedPlaylist?.id === playlistId) {
			selectedPlaylist = syncDetailFlags(detail);
			playlistsError = "";
		}
	} catch (err) {
		if (requestSeq === playlistDetailRequestSeq && selectedPlaylist?.id === playlistId) {
			const msg = err instanceof Error ? err.message : "加载歌单详情失败";
			playlistsError = msg;
			onNotify?.(msg, "error");
		}
	} finally {
		if (requestSeq === playlistDetailRequestSeq && selectedPlaylist?.id === playlistId) {
			isLoadingPlaylistDetail = false;
		}
	}
}

async function handleImportSubmit(overrideOptions?: {
	type?: "playlist" | "user";
	platform?: string;
}): Promise<void> {
	const auth = personalPlaylistAuth;
	if (!auth) {
		onRequestAuth?.();
		return;
	}
	const raw = importInput.trim();
	if (!raw) {
		importError = "请粘贴歌单链接或分享文本";
		return;
	}
	isImportingPlaylist = true;
	importError = "";
	importStatusText = "";
	pendingUserImport = null;
	pendingAmbiguousImport = null;
	try {
		const resolved = await resolvePlaylistFromPlaylistOut(
			playlistOutApiUrl,
			raw,
			overrideOptions,
		);
		if (personalPlaylistAuth !== auth) return;
		if (resolved.kind === "ambiguous") {
			pendingAmbiguousImport = {
				query: resolved.query,
				candidates: resolved.candidates,
			};
			return;
		}
		if (resolved.kind === "user") {
			pendingUserImport = {
				platform: resolved.platform,
				nickname: resolved.nickname,
				playlists: resolved.playlists,
			};
			return;
		}
		const saved = await saveImportedPlaylist(
			chatServerUrl,
			roomId,
			auth,
			resolved.payload,
		);
		if (personalPlaylistAuth !== auth) return;
		importInput = "";
		if (resolved.retrievalMessage) {
			importStatusText = resolved.retrievalMessage;
		}
		onNotify?.(
			saved.updatedExisting
				? `已同步更新歌单《${saved.playlist.title}》`
				: `已导入歌单《${saved.playlist.title}》`,
			"success",
		);
		invalidatePlaylistCaches(saved.playlist.id);
		void loadPlaylists(true);
		void openPlaylistDetail(saved.playlist.id, true, saved.playlist);
	} catch (err) {
		importError = err instanceof Error ? err.message : "歌单导入失败";
		onNotify?.(importError, "error");
	} finally {
		isImportingPlaylist = false;
	}
}

async function handleImportUserCandidate(
	candidate: UserPlaylistCandidate,
): Promise<void> {
	const auth = personalPlaylistAuth;
	if (!auth) return;
	isImportingPlaylist = true;
	importError = "";
	importStatusText = "";
	try {
		const parsed = await fetchPlaylistByUrlFromPlaylistOut(
			playlistOutApiUrl,
			candidate.sourceUrl,
			candidate.platform,
		);
		if (personalPlaylistAuth !== auth) return;
		const saved = await saveImportedPlaylist(
			chatServerUrl,
			roomId,
			auth,
			parsed.payload,
		);
		if (personalPlaylistAuth !== auth) return;
		pendingUserImport = null;
		importInput = "";
		if (parsed.retrievalMessage) {
			importStatusText = parsed.retrievalMessage;
		}
		onNotify?.(`已导入歌单《${saved.playlist.title}》`, "success");
		invalidatePlaylistCaches(saved.playlist.id);
		void loadPlaylists(true);
		void openPlaylistDetail(saved.playlist.id, true, saved.playlist);
	} catch (err) {
		importError = err instanceof Error ? err.message : "拉取选定歌单失败";
		onNotify?.(importError, "error");
	} finally {
		isImportingPlaylist = false;
	}
}

async function handleRefreshPlaylist(playlist: PlaylistSummary): Promise<void> {
	const auth = personalPlaylistAuth;
	if (!auth || playlist.id === "pl_collective_favorites" || !canManagePlaylist(playlist) || isRefreshingPlaylistId) return;
	isRefreshingPlaylistId = playlist.id;
	try {
		const fresh = await fetchPlaylistByUrlFromPlaylistOut(
			playlistOutApiUrl,
			playlist.sourceUrl,
			playlist.platform !== "external" ? playlist.platform : undefined,
		);
		if (personalPlaylistAuth !== auth) return;
		const updated = await refreshSavedPlaylist(
			chatServerUrl,
			roomId,
			auth,
			playlist.id,
			fresh.payload,
		);
		if (personalPlaylistAuth !== auth) return;
		onNotify?.(`已刷新《${updated.title}》（共 ${updated.trackCount} 首）`, "success");
		invalidatePlaylistCaches(playlist.id);
		void loadPlaylists(true);
		if (selectedPlaylist?.id === playlist.id) {
			await openPlaylistDetail(playlist.id, true, updated);
		}
	} catch (err) {
		onNotify?.(err instanceof Error ? err.message : "刷新歌单失败", "error");
	} finally {
		isRefreshingPlaylistId = "";
	}
}

function closeRotationSettings() {
	if (rotationSaving) return;
	rotationExpanded = false;
	rotationRequestSeq++;
}

async function loadRotationSettings() {
	const request = ++rotationRequestSeq;
	const requestedRoom = roomId;
	const requestedServer = chatServerUrl;
	rotationLoading = true;
	rotationLoadError = "";
	rotationError = "";
	try {
		if (!requestedServer) throw new Error("聊天室尚未连接，请稍后重试");
		const result = await fetchRoomPlaylists(requestedServer, requestedRoom, { kind: "waline", token: walineToken });
		if (request !== rotationRequestSeq || !rotationExpanded || roomId !== requestedRoom || chatServerUrl !== requestedServer) return;
		if (!result.rotation) throw new Error("未能获取轮播设置，请重试");
		rotation = result.rotation;
		rotationMode = result.rotation.mode;
		rotationPlaylistIds = normalizeRotationPlaylistIds(result.rotation);
		rotationChoices = [...new Map([...result.featured, ...result.mine, ...result.members]
			.filter((playlist) => playlist.isPublic && playlist.trackCount > 0)
			.map((playlist) => [playlist.id, playlist])).values()];
	} catch (error) {
		if (request === rotationRequestSeq && rotationExpanded && roomId === requestedRoom && chatServerUrl === requestedServer) {
			rotationLoadError = error instanceof Error ? error.message : "加载轮播设置失败，请重试";
		}
	} finally {
		if (request === rotationRequestSeq) rotationLoading = false;
	}
}

function openRotationSettings() {
	if (rotationSaving) return;
	if (!currentUser || !isWalineLoggedIn) {
		onRequestAuth?.();
		return;
	}
	rotationDialogRoom = roomId;
	rotationDialogServer = chatServerUrl;
	rotationExpanded = true;
	rotationPlaylistSearch = "";
	void loadRotationSettings();
}

$effect(() => {
	if (rotationExpanded && (roomId !== rotationDialogRoom || chatServerUrl !== rotationDialogServer)) {
		rotationExpanded = false;
		rotationRequestSeq++;
	}
});

function toggleRotationPlaylist(playlistId: string) {
	if (rotationSaving) return;
	rotationPlaylistIds = rotationPlaylistIds.includes(playlistId)
		? rotationPlaylistIds.filter((id) => id !== playlistId)
		: [...rotationPlaylistIds, playlistId];
}

async function handleSaveRotation() {
	if (rotationSaving || rotationLoading || rotationLoadError || roomId !== rotationDialogRoom || chatServerUrl !== rotationDialogServer || !canSaveRotation || !isWalineLoggedIn) return;
	const selectedIds = validSelectedRotationIds;
	const setting: RoomRotation = rotationMode === "playlist"
		? { mode: "playlist", playlistIds: selectedIds, playlistId: selectedIds[0] }
		: { mode: rotationMode };
	rotationSaving = true;
	rotationError = "";
	try {
		rotation = await saveRoomRotation(chatServerUrl, roomId, { kind: "waline", token: walineToken }, setting);
		rotationExpanded = false;
		onNotify?.("已保存本房间的轮播设置", "success");
		await loadPlaylists(true);
	} catch (error) {
		rotationError = error instanceof Error ? error.message : "保存失败，请重试";
	} finally {
		rotationSaving = false;
	}
}

async function handleTogglePlaylistFlag(
	playlist: PlaylistSummary,
	flag: "isPublic" | "isFeatured",
): Promise<void> {
	const auth = personalPlaylistAuth;
	if (!auth || isUpdatingFlagsId) return;
	if (flag === "isPublic" && !canManagePlaylist(playlist)) return;
	if (flag !== "isPublic" && !currentUser?.isAdmin) return;
	isUpdatingFlagsId = playlist.id;
	try {
		const nextFlags =
			flag === "isPublic"
				? { isPublic: !playlist.isPublic }
				: { isFeatured: !playlist.isFeatured };
		const updated = await updatePlaylistFlags(
			chatServerUrl,
			roomId,
			auth,
			playlist.id,
			nextFlags,
		);
		if (selectedPlaylist?.id === updated.id) {
			selectedPlaylist = {
				...selectedPlaylist,
				isPublic: updated.isPublic,
				isFeatured: updated.isFeatured,
				isFallback: updated.isFallback,
				updatedAt: updated.updatedAt,
			};
		}
		if (flag === "isPublic") {
			onNotify?.(
				updated.isPublic
					? `已共享《${updated.title}》到共享歌单`
					: `已取消共享《${updated.title}》`,
				"success",
			);
		} else if (flag === "isFeatured") {
			onNotify?.(
				updated.isFeatured
					? `已将《${updated.title}》设为房间精选`
					: `已取消《${updated.title}》的房间精选`,
				"success",
			);
		}
		invalidatePlaylistCaches(playlist.id);
		await loadPlaylists(true);
	} catch (err) {
		onNotify?.(err instanceof Error ? err.message : "更新歌单权限失败", "error");
	} finally {
		isUpdatingFlagsId = "";
	}
}

async function handleDeletePlaylist(playlist: PlaylistSummary): Promise<void> {
	const auth = personalPlaylistAuth;
	if (!auth || !canManagePlaylist(playlist) || isDeletingPlaylistId) return;
	if (confirmDeletePlaylistId !== playlist.id) {
		confirmDeletePlaylistId = playlist.id;
		if (confirmDeleteTimer !== null) {
			window.clearTimeout(confirmDeleteTimer);
		}
		confirmDeleteTimer = window.setTimeout(() => {
			confirmDeletePlaylistId = "";
			confirmDeleteTimer = null;
		}, 3500);
		return;
	}
	if (confirmDeleteTimer !== null) {
		window.clearTimeout(confirmDeleteTimer);
		confirmDeleteTimer = null;
	}
	isDeletingPlaylistId = playlist.id;
	try {
		await deleteSavedPlaylist(chatServerUrl, roomId, auth, playlist.id);
		confirmDeletePlaylistId = "";
		if (selectedPlaylist?.id === playlist.id) {
			selectedPlaylist = null;
			playlistTrackFilter = "";
		}
		onNotify?.(`已删除歌单《${playlist.title}》`, "success");
		invalidatePlaylistCaches(playlist.id);
		await loadPlaylists(true);
	} catch (err) {
		onNotify?.(err instanceof Error ? err.message : "删除歌单失败", "error");
	} finally {
		isDeletingPlaylistId = "";
	}
}

async function handleRandomPlayFromPlaylist(detail: PlaylistDetail): Promise<void> {
	if (!currentUser) {
		onRequestAuth?.();
		return;
	}
	if (isRandomizing) return;
	try {
		await onRandomEnqueue(detail.id);
	} catch (error) {
		console.warn("Unable to request a random song", error);
		onNotify?.("随机点歌请求未能发出，请重试", "error");
	}
}

function normalizeMatchTitle(raw: string): string {
	return raw.toLowerCase().replace(/[\s\-_·.,'"!?！？，。、()（）]+/g, "");
}

const currentPlayMatchInfo = $derived.by(() => {
	if (!currentPlay) return null;
	return {
		id: currentPlay.track.id,
		titleNorm: normalizeMatchTitle(currentPlay.track.title),
		artistNorm: normalizeMatchTitle(currentPlay.track.artist),
	};
});

const queueLookupIndex = $derived.by(() => {
	const byId = new Map<string, QueueEntry>();
	const byTitleNorm = new Map<string, Array<{ entry: QueueEntry; artistNorm: string }>>();
	for (const item of queue) {
		byId.set(item.track.id, item);
		if (item.track.sourceId) byId.set(item.track.sourceId, item);
		const bare = item.track.id.replace(/^[a-z_]+:/i, "");
		if (bare) byId.set(bare, item);
		const titleNorm = normalizeMatchTitle(item.track.title);
		const artistNorm = normalizeMatchTitle(item.track.artist);
		const bucket = byTitleNorm.get(titleNorm);
		if (bucket) {
			bucket.push({ entry: item, artistNorm });
		} else {
			byTitleNorm.set(titleNorm, [{ entry: item, artistNorm }]);
		}
	}
	return { byId, byTitleNorm };
});

function isTrackCurrent(song: ChatMusicTrack): boolean {
	const info = currentPlayMatchInfo;
	if (!info) return false;
	if (info.id === song.id) return true;
	if (song.sourceId && info.id.endsWith(song.sourceId)) return true;
	const bareSong = song.id ? song.id.replace(/^[a-z_]+:/i, "") : "";
	const bareCurr = info.id.replace(/^[a-z_]+:/i, "");
	if (bareSong && bareCurr && bareSong === bareCurr) return true;
	if (info.titleNorm === normalizeMatchTitle(song.title)) {
		const firstArtist = normalizeMatchTitle(
			song.artist.split(/[/,&、;；]+/)[0] || "",
		);
		const currentFirstArtist = info.artistNorm.split(/[/,&、;；]+/)[0] || "";
		if (
			!firstArtist ||
			!info.artistNorm ||
			info.artistNorm.includes(firstArtist) ||
			(currentFirstArtist && normalizeMatchTitle(song.artist).includes(currentFirstArtist))
		) {
			return true;
		}
	}
	return false;
}

function findQueuedEntryForSong(song: ChatMusicTrack): QueueEntry | undefined {
	const { byId, byTitleNorm } = queueLookupIndex;
	if (song.id && byId.has(song.id)) return byId.get(song.id);
	if (song.sourceId && byId.has(song.sourceId)) return byId.get(song.sourceId);
	if (song.id) {
		const bare = song.id.replace(/^[a-z_]+:/i, "");
		if (bare && byId.has(bare)) return byId.get(bare);
	}
	const bucket = byTitleNorm.get(normalizeMatchTitle(song.title));
	if (!bucket) return undefined;
	const targetArtist = normalizeMatchTitle(
		song.artist.split(/[/,&、;；]+/)[0] || "",
	);
	const fullSongArtist = normalizeMatchTitle(song.artist);
	for (const candidate of bucket) {
		if (
			!targetArtist ||
			!candidate.artistNorm ||
			candidate.artistNorm.includes(targetArtist) ||
			fullSongArtist.includes(candidate.artistNorm)
		) {
			return candidate.entry;
		}
	}
	return undefined;
}

function isTrackQueued(song: ChatMusicTrack): boolean {
	return Boolean(findQueuedEntryForSong(song));
}

$effect(() => {
	const raw = playlistTrackFilter;
	if (playlistFilterTimer !== null) {
		window.clearTimeout(playlistFilterTimer);
		playlistFilterTimer = null;
	}
	if (!raw.trim()) {
		debouncedPlaylistFilter = "";
		return;
	}
	playlistFilterTimer = window.setTimeout(() => {
		playlistFilterTimer = null;
		debouncedPlaylistFilter = raw;
	}, 120);
});

const filteredPlaylistTracks = $derived.by<PlaylistTrackItem[]>(() => {
	if (!selectedPlaylist) return [];
	const q = debouncedPlaylistFilter.trim().toLowerCase();
	if (!q) return selectedPlaylist.tracks;
	return selectedPlaylist.tracks.filter(
		(t) =>
			t.title.toLowerCase().includes(q) ||
			t.artist.toLowerCase().includes(q) ||
			t.album.toLowerCase().includes(q),
	);
});

const playlistVirtual = $derived.by(() => {
	const list = filteredPlaylistTracks;
	const len = list.length;
	const rowH = Math.max(44, playlistRowHeight);
	if (len <= VIRTUAL_MUSIC_THRESHOLD) {
		return playlistWindowMemo(list, `${len}:0:${len}:${rowH}`, () => ({
			items: list,
			start: 0,
			topSpacerPx: 0,
			bottomSpacerPx: 0,
		}));
	}
	const viewH = Math.max(240, playlistViewportH);
	const metaOffset = isCompactPlaylistHeader ? playlistMetaHeight + 6 : 0;
	const relScrollTop = Math.max(0, playlistScrollTop - metaOffset);
	const rawStart = Math.floor(relScrollTop / rowH) - VIRTUAL_MUSIC_OVERSCAN;
	const STEP = 4;
	const steppedStart = Math.max(0, Math.floor(rawStart / STEP) * STEP);
	const visibleCount = Math.ceil(viewH / rowH) + VIRTUAL_MUSIC_OVERSCAN * 2 + STEP;
	const start = steppedStart;
	const end = Math.min(len, start + visibleCount);
	return playlistWindowMemo(list, `${len}:${start}:${end}:${rowH}`, () => ({
		items: list.slice(start, end),
		start,
		topSpacerPx: start * rowH,
		bottomSpacerPx: Math.max(0, (len - end) * rowH),
	}));
});

const activePlaylistId = $derived(selectedPlaylist?.id);

$effect(() => {
	activePlaylistId;
	debouncedPlaylistFilter;
	untrack(() => {
		playlistScrollTop = 0;
		if (playlistScrollEl) playlistScrollEl.scrollTop = 0;
	});
});

function handlePlaylistScroll(e: Event): void {
	const el = e.currentTarget as HTMLDivElement | null;
	if (!el) return;
	if (playlistScrollRaf !== null) return;
	playlistScrollRaf = requestAnimationFrame(() => {
		playlistScrollRaf = null;
		if (!playlistScrollEl) return;
		playlistScrollTop = playlistScrollEl.scrollTop;
	});
}

// 歌单与历史共用列表行距，跨手机断点时同步虚拟滚动的估算。
$effect(() => {
	const el = musicPanelEl;
	if (!el) return;
	if (playlistScrollEl) desktopPlaylistRowHeight = 50;
	const phoneQuery = window.matchMedia("(width < 768px)");
	const syncRowH = () => {
		playlistRowHeight =
			Number.parseFloat(getComputedStyle(el).getPropertyValue("--chat-track-row-pitch")) ||
			desktopPlaylistRowHeight;
	};
	syncRowH();
	phoneQuery.addEventListener("change", syncRowH);
	return () => phoneQuery.removeEventListener("change", syncRowH);
});

$effect(() => {
	roomId;
	chatServerUrl;
	personalPlaylistAuth;
	void playlistRefreshSeq;
	if (activeTab === "playlist") {
		void loadPlaylists();
	}
});

// 只在歌单标签可见时，限制并发预载所有已列出的歌单数据；不请求图片。
$effect(() => {
	if (activeTab !== "playlist" || !chatServerUrl) return;
	const ids = [...new Set([...featuredPlaylists, ...myPlaylists, ...membersPlaylists].map((playlist) => playlist.id).filter(Boolean))];
	const requestRoom = roomId;
	const requestServer = chatServerUrl;
	const auth = personalPlaylistAuth;
	let cancelled = false;
	let next = 0;
	async function preload() {
		while (!cancelled && next < ids.length) {
			const id = ids[next++];
			if (!id || activeTab !== "playlist" || roomId !== requestRoom || chatServerUrl !== requestServer) return;
			try { await getOrFetchPlaylistDetail(id, auth); } catch { /* 点击时仍可正常重试。 */ }
		}
	}
	void preload();
	void preload();
	return () => { cancelled = true; };
});

function computeExpectedElapsed(): number {
	if (!currentPlay) return 0;
	const raw = ((serverNow?.() ?? Date.now() + clockOffsetMs) - currentPlay.startedAt) / 1000;
	if (currentPlay.phase === "preparing" || currentPlay.phase === "transitioning" || raw < 0) return 0;
	const clamped = Math.max(0, raw);
	if (effectiveDuration > 0) {
		return Math.min(clamped, effectiveDuration);
	}
	return clamped;
}

const formatTime = formatClockSeconds;

const TRAILING_PAREN_RE = /^(.*?)\s*[(（](.+?)[)）]\s*$/;
const HAN_RE = /[\u4e00-\u9fff]/;
const NON_HAN_SCRIPT_RE = /[\u3040-\u30ff\uac00-\ud7afA-Za-z]/;
const KANA_RE = /[\u3040-\u30ff]/;

function parseLrc(raw: string): LyricLine[] {
	const timeReg = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
	const offsetReg = /^\[offset:([+-]?\d+)\]$/i;
	const rawEntries: { time: number; rawText: string }[] = [];
	let offsetSec = 0;

	for (const rawLine of raw.split(/\r?\n/)) {
		const trimmedLine = rawLine.trim();
		const offsetMatch = trimmedLine.match(offsetReg);
		if (offsetMatch) {
			offsetSec = Number.parseInt(offsetMatch[1], 10) / 1000;
			continue;
		}

		const timestamps: number[] = [];
		timeReg.lastIndex = 0;
		let match: RegExpExecArray | null = timeReg.exec(rawLine);
		while (match !== null) {
			const min = Number.parseInt(match[1], 10);
			const sec = Number.parseInt(match[2], 10);
			const msRaw = match[3] ?? "0";
			const divisor = msRaw.length === 3 ? 1000 : msRaw.length === 2 ? 100 : 10;
			const ms = Number.parseInt(msRaw, 10) / divisor;
			timestamps.push(Math.max(0, min * 60 + sec + ms - offsetSec));
			match = timeReg.exec(rawLine);
		}
		if (timestamps.length === 0) continue;

		const rawText = rawLine.replace(timeReg, "").trim();
		if (!rawText) continue;

		for (const time of timestamps) {
			rawEntries.push({ time, rawText });
		}
	}

	let parenLineCount = 0;
	for (const entry of rawEntries) {
		const m = entry.rawText.match(TRAILING_PAREN_RE);
		if (m?.[1]?.trim() && m?.[2]?.trim()) {
			parenLineCount += 1;
		}
	}
	const isInlineBilingualTrack =
		rawEntries.length >= 4 && parenLineCount / rawEntries.length >= 0.4;

	const parsed: LyricLine[] = [];
	for (const entry of rawEntries) {
		let cleanText = entry.rawText;
		const splitMatch = cleanText.match(TRAILING_PAREN_RE);
		if (splitMatch?.[1]?.trim() && splitMatch?.[2]?.trim()) {
			const head = splitMatch[1].trim();
			const tail = splitMatch[2].trim();
			const isScriptTranslationPair =
				(NON_HAN_SCRIPT_RE.test(head) &&
					HAN_RE.test(tail) &&
					(!HAN_RE.test(head) ||
						(KANA_RE.test(head) && !KANA_RE.test(tail)))) ||
				(KANA_RE.test(head) && /[A-Za-z]{2,}/.test(tail) && !HAN_RE.test(tail));

			if (isInlineBilingualTrack || isScriptTranslationPair) {
				cleanText = head;
			}
		}

		if (cleanText) {
			parsed.push({ time: entry.time, text: cleanText });
		}
	}

	parsed.sort((a, b) => a.time - b.time);

	const deduped: LyricLine[] = [];
	for (const line of parsed) {
		const prev = deduped[deduped.length - 1];
		if (
			prev &&
			Math.abs(line.time - prev.time) < 0.01 &&
			NON_HAN_SCRIPT_RE.test(prev.text) &&
			!HAN_RE.test(prev.text) &&
			HAN_RE.test(line.text)
		) {
			continue;
		}
		deduped.push(line);
	}

	return deduped;
}

async function loadLyricsForUrl(lrcUrl?: string) {
	lyricRequest?.abort();
	lyricFetchSeq += 1;
	const reqId = lyricFetchSeq;
	activeLyricIndex = -1;

	if (!lrcUrl) {
		lyrics = [];
		lyricsStatus = "empty";
		return;
	}

	const cached = lyricsCache.get(lrcUrl);
	if (cached) {
		lyrics = cached;
		lyricsStatus = cached.length > 0 ? "ready" : "empty";
		syncLyricIndex(roomElapsed, true);
		return;
	}

	lyricsStatus = "loading";
	lyrics = [];

	const request = new AbortController();
	lyricRequest = request;
	try {
		const resp = await fetch(lrcUrl, { signal: request.signal });
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		const text = await resp.text();
		if (reqId !== lyricFetchSeq) return;
		const parsed = parseLrc(text);
		lyricsCache.set(lrcUrl, parsed);
		lyrics = parsed;
		lyricsStatus = parsed.length > 0 ? "ready" : "empty";
		syncLyricIndex(roomElapsed, true);
	} catch {
		if (request.signal.aborted || reqId !== lyricFetchSeq) return;
		lyrics = [];
		lyricsStatus = "empty";
	} finally {
		if (lyricRequest === request) lyricRequest = undefined;
	}
}

function syncLyricIndex(timeSec: number, instant = false) {
	if (lyrics.length === 0) {
		activeLyricIndex = -1;
		return;
	}
	let matched = -1;
	const lookupTime = timeSec + 0.12;
	for (let i = 0; i < lyrics.length; i += 1) {
		if (lyrics[i].time <= lookupTime) {
			matched = i;
		} else {
			break;
		}
	}
	if (matched !== activeLyricIndex) {
		activeLyricIndex = matched;
		if (matched >= 0) {
			void scrollLyricToCenter(matched, instant);
		}
	}
}

async function scrollLyricToCenter(index: number, instant = false) {
	await tick();
	if (!lyricsContainer) return;
	if (!instant && Date.now() - lastUserScrollAt < 2500) return;
	const lineEl = lyricsContainer.querySelector<HTMLElement>(
		`[data-lyric-idx="${index}"]`,
	);
	if (!lineEl) return;

	const containerRect = lyricsContainer.getBoundingClientRect();
	const lineRect = lineEl.getBoundingClientRect();
	const target =
		lyricsContainer.scrollTop +
		(lineRect.top - containerRect.top) -
		lyricsContainer.clientHeight / 2 +
		lineRect.height / 2;

	programmaticLyricScrollUntil = Date.now() + 650;
	lyricsContainer.scrollTo({
		top: Math.max(0, target),
		behavior: instant ? "auto" : "smooth",
	});
}

function updateMediaSessionMetadata() {
	if (typeof navigator === "undefined" || !("mediaSession" in navigator) || typeof MediaMetadata === "undefined")
		return;
	if (!hasJoinedAudio || !currentPlay) return;

	const coverUrl = currentPlay.track.cover
		? resolveMusicThumbUrl(new URL(currentPlay.track.cover, window.location.origin).toString(), 200)
		: "";
	navigator.mediaSession.metadata = new MediaMetadata({
		title: currentPlay.track.title,
		artist: currentPlay.track.artist,
		album: `#${roomId} 同步电台 · ${currentPlay.isFallback ? "轮播：" : "点歌："}${currentPlay.requesterName}`,
		artwork: coverUrl
			? [{ src: coverUrl, sizes: "200x200", type: "image/jpeg" }]
			: [],
	});
	navigator.mediaSession.playbackState = audioStatus === "playing" ? "playing" : "paused";
	registerMediaSessionHandlers();
}

function handleMediaSessionNextTrack() {
	if (!currentPlay || isSkippingTrack) return;
	if (canDirectSkip) {
		onSkipTrack();
	} else {
		onVoteSkip();
	}
}

function unregisterMediaSessionHandlers() {
	if (typeof navigator === "undefined" || !("mediaSession" in navigator))
		return;
	const actions: MediaSessionAction[] = [
		"play",
		"pause",
		"stop",
		"seekbackward",
		"seekforward",
		"seekto",
		"previoustrack",
		"nexttrack",
	];
	for (const action of actions) {
		try {
			navigator.mediaSession.setActionHandler(action, null);
		} catch {}
	}
}

function registerMediaSessionHandlers() {
	if (typeof navigator === "undefined" || !("mediaSession" in navigator))
		return;

	const actions: [MediaSessionAction, MediaSessionActionHandler | null][] = [
		["play", () => {
			if (!isListening || audioStatus === "error" || audioStatus === "blocked") startOrResumeAudio();
		}],
		["pause", muteLocally],
		["stop", muteLocally],
		["seekbackward", null],
		["seekforward", null],
		["seekto", null],
		["previoustrack", null],
		["nexttrack", handleMediaSessionNextTrack],
	];
	for (const [action, handler] of actions) {
		try {
			navigator.mediaSession.setActionHandler(action, handler);
		} catch {
			// Some browser implementations expose only a subset of media actions.
		}
	}
}

function muteLocally() {
	player?.stop();
	updateMediaSessionMetadata();
}
function startOrResumeAudio() {
	if (!audioEl || (!currentPlay?.track.streamUrl && !currentPlay?.track.proxyUrl)) return;
	if (volume === 0) volume = 0.5;
	hasJoinedAudio = true;
	audioEl.muted = false;
	player?.setVolume(volume);
	player?.listen();
	registerMediaSessionHandlers();
	updateMediaSessionMetadata();
}
function toggleListen() {
	if (audioStatus === "blocked" || audioStatus === "error" || !isListening) {
		startOrResumeAudio();
	} else {
		muteLocally();
	}
}

let isDraggingVolume = $state(false);
let volumeSliderEl: HTMLDivElement | null = $state(null);

function updateVolumeFromPointer(clientX: number) {
	if (!volumeSliderEl) return;
	const rect = volumeSliderEl.getBoundingClientRect();
	if (rect.width <= 0) return;
	const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
	handleVolumeInput(Math.round(ratio * 100) / 100);
}

function handleVolumePointerDown(e: PointerEvent) {
	if (e.button !== 0 && e.pointerType === "mouse") return;
	e.preventDefault();
	isDraggingVolume = true;
	volumeSliderEl?.setPointerCapture(e.pointerId);
	updateVolumeFromPointer(e.clientX);
}

function handleVolumePointerMove(e: PointerEvent) {
	if (!isDraggingVolume) return;
	updateVolumeFromPointer(e.clientX);
}

function handleVolumePointerEnd(e: PointerEvent) {
	if (!isDraggingVolume) return;
	isDraggingVolume = false;
	if (volumeSliderEl?.hasPointerCapture(e.pointerId)) {
		volumeSliderEl.releasePointerCapture(e.pointerId);
	}
}

function handleVolumeKeyDown(e: KeyboardEvent) {
	if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
		e.preventDefault();
		handleVolumeInput(Math.round(Math.max(0, volumeRatio - 0.05) * 100) / 100);
	} else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
		e.preventDefault();
		handleVolumeInput(Math.round(Math.min(1, volumeRatio + 0.05) * 100) / 100);
	}
}

function handleVolumeInput(value: number) {
	const clamped = Math.min(1, Math.max(0, value));
	volume = clamped;
	try {
		if (typeof window !== "undefined" && window.sessionStorage) {
			window.sessionStorage.setItem("chat:player:volume", String(clamped));
		}
	} catch {
		// Ignore storage error
	}
	if (clamped > 0 && !isListening) {
		startOrResumeAudio();
	} else if (clamped === 0 && isListening) {
		muteLocally();
	} else if (player) {
		player.setVolume(clamped);
	}
}

// The controller exclusively owns playback; this effect only supplies room state.
$effect(() => {
	const active = currentPlay;
	listenIntent;
	roomId;
	if (!player) return;
	const controller = player;
	const next = musicState?.next ?? null;
	const loudness = volume;
	untrack(() => {
		controller.setVolume(loudness);
		controller.setTrack(active);
		controller.preloadNext(next);
	});
	if (!active) {
		roomElapsed = 0;
		localDuration = 0;
		void loadLyricsForUrl();
		return;
	}
	if (active.uid !== lastPlayUid) {
		lastPlayUid = active.uid;
		coverLoadFailed = false;
		localDuration = active.durationSec;
		roomElapsed = computeExpectedElapsed();
		lastUserScrollAt = 0;
		void loadLyricsForUrl(active.track.lrcUrl || active.track.lrc);
		const autoListen = pendingAutoUnmuteTrackId &&
			(pendingAutoUnmuteTrackId === active.track.id || pendingAutoUnmuteTrackId.startsWith("ext:")) &&
			Date.now() - pendingAutoUnmuteAt < 30_000 && active.requesterKey === currentUser?.userKey;
		if (autoListen) { pendingAutoUnmuteTrackId = ""; startOrResumeAudio(); }
	}
	updateMediaSessionMetadata();
});

// 清空输入框时重置搜索状态，不再输入即发请求
$effect(() => {
	if (!searchQuery.trim()) {
		searchAbortController?.abort();
		searchAbortController = null;
		submittedSearchQuery = "";
		searchResults = [];
		searchPage = 1;
		hasMoreSearchResults = false;
		isSearching = false;
		isLoadingMore = false;
		searchError = "";
	}
});

function clearSearch() {
	searchAbortController?.abort();
	searchAbortController = null;
	searchQuery = "";
	submittedSearchQuery = "";
	searchResults = [];
	searchPage = 1;
	hasMoreSearchResults = false;
	isSearching = false;
	isLoadingMore = false;
	searchError = "";
	searchFallbackNotice = "";
}

let lastFallbackSearchSeq = 0;

$effect(() => {
	if (!fallbackSearch || fallbackSearch.seq === lastFallbackSearchSeq) return;
	lastFallbackSearchSeq = fallbackSearch.seq;
	searchQuery = fallbackSearch.query;
	switchMusicTab("search");
	void runSearch(fallbackSearch.query, false, "qq");
});

function submitSearch(bypassCache = false) {
	if (!currentUser) {
		onRequestAuth?.();
		return;
	}
	const q = searchQuery.trim();
	if (!q) {
		clearSearch();
		return;
	}
	searchFallbackNotice = "";
	void runSearch(q, bypassCache, searchProvider);
}

function switchSearchProvider(provider: SearchProvider) {
	if (searchProvider === provider) return;
	searchProvider = provider;
	searchFallbackNotice = "";
	const q = searchQuery.trim() || submittedSearchQuery.trim();
	if (q) {
		void runSearch(q, false, provider);
	}
}

function dedupeTracksById(tracks: ChatMusicTrack[]): ChatMusicTrack[] {
	const seen = new Set<string>();
	const result: ChatMusicTrack[] = [];
	for (const track of tracks) {
		if (!track?.id || seen.has(track.id)) continue;
		seen.add(track.id);
		result.push(track);
	}
	return result;
}

async function runSearch(q: string, bypassCache = false, provider: SearchProvider = "qq") {
	searchProvider = provider;
	searchResultProvider = provider;
	searchAbortController?.abort();
	const controller = new AbortController();
	searchAbortController = controller;

	submittedSearchQuery = q;
	searchError = "";
	searchPage = 1;
	isLoadingMore = false;

	const cacheKey = provider + ":" + q.toLowerCase();
	const cached = !bypassCache ? searchResultCache.get(cacheKey) : undefined;
	if (cached && Date.now() - cached.fetchedAt < SEARCH_CACHE_TTL_MS) {
		searchResults = cached.tracks;
		hasMoreSearchResults = cached.hasMore;
		searchResultProvider = cached.provider;
		isSearching = false;
		return;
	}

	searchResults = [];
	hasMoreSearchResults = false;
	isSearching = true;
	try {
		const res = await onSearchOnline(q, { signal: controller.signal, page: 1, provider });
		if (controller.signal.aborted) return;
		let tracks = dedupeTracksById(res.tracks).map((t) => ({
			...t,
			provider: t.provider || provider,
		}));

		// Ultimate Fallback: if domestic search returned 0 results, query YouTube Music as fallback
		let isFallback = false;
		let fallbackHasMore = false;
		if (tracks.length === 0 && provider !== "youtube" && !controller.signal.aborted) {
			try {
				const ytRes = await onSearchOnline(q, { signal: controller.signal, page: 1, provider: "youtube" });
				if (!controller.signal.aborted && ytRes.tracks.length > 0) {
					tracks = dedupeTracksById(ytRes.tracks).map((t) => ({
						...t,
						provider: "youtube",
					}));
					isFallback = true;
					fallbackHasMore = ytRes.hasMore;
					searchResultProvider = "youtube";
				}
			} catch {
				// Fallback error quietly ignored
			}
		}

		const resultHasMore = isFallback ? fallbackHasMore : res.hasMore;

		if (searchResultCache.size >= 40) {
			const oldest = searchResultCache.keys().next().value;
			if (oldest !== undefined) searchResultCache.delete(oldest);
		}
		searchResultCache.set(cacheKey, {
			tracks,
			hasMore: resultHasMore,
			provider: searchResultProvider,
			fetchedAt: Date.now(),
		});
		if (submittedSearchQuery === q) {
			searchResults = tracks;
			searchPage = res.page;
			hasMoreSearchResults = resultHasMore;
			searchError = "";
			searchFallbackNotice = isFallback ? "国内音源未检索到相关曲目，已自动通过 YouTube Music 兜底全网检索" : "";
		}
	} catch (err) {
		if (controller.signal.aborted && err instanceof DOMException && err.name === "AbortError") {
			return;
		}
		if (controller.signal.aborted && controller.signal.reason !== "timeout") {
			return;
		}
		if (submittedSearchQuery === q) {
			searchError = err instanceof Error ? err.message : "搜索失败，请稍后重试";
			searchFallbackNotice = "";
		}
	} finally {
		if (searchAbortController === controller) {
			searchAbortController = null;
			isSearching = false;
		}
	}
}

async function loadMoreSearchResults() {
	const q = submittedSearchQuery;
	if (!q || isSearching || isLoadingMore || !hasMoreSearchResults) return;
	const provider = searchResultProvider;

	const controller = new AbortController();
	searchAbortController = controller;
	isLoadingMore = true;
	searchError = "";

	try {
		// Search results can overlap across pages. Advance the upstream page independently.
		for (let attempt = 0; attempt < 3 && hasMoreSearchResults; attempt += 1) {
			const requestedPage = searchPage + 1;
			const res = await onSearchOnline(q, { signal: controller.signal, page: requestedPage, provider });
			if (controller.signal.aborted || submittedSearchQuery !== q) return;
			if (res.page < requestedPage) {
				hasMoreSearchResults = false;
				return;
			}
			const existingIds = new Set(searchResults.map((track) => track.id));
			const newTracks = dedupeTracksById(res.tracks)
				.map((t) => ({ ...t, provider: t.provider || provider }))
				.filter((track) => !existingIds.has(track.id));
			searchPage = res.page;
			hasMoreSearchResults = res.hasMore;
			if (newTracks.length > 0) {
				searchResults = [...searchResults, ...newTracks];
				return;
			}
		}
	} catch (err) {
		if (controller.signal.aborted && err instanceof DOMException && err.name === "AbortError") {
			return;
		}
		if (controller.signal.aborted && controller.signal.reason !== "timeout") {
			return;
		}
		if (submittedSearchQuery === q) {
			searchError = err instanceof Error ? err.message : "加载更多失败，请稍后重试";
		}
	} finally {
		if (searchAbortController === controller) {
			searchAbortController = null;
			isLoadingMore = false;
		}
	}
}

function markPendingAutoUnmuteIfImmediate(songId: string): void {
	// 当前没有歌或正在歌单轮播时，点歌会立即切播，自动取消静音开播；已有用户点播在放则保持静音
	if ((!currentPlay || currentPlay.isFallback) && currentUser) {
		pendingAutoUnmuteTrackId = songId;
		pendingAutoUnmuteAt = Date.now();
	}
}

function isEnqueuingTrack(song: ChatMusicTrack): boolean {
	if (enqueuingTrackIds.has(song.id)) return true;
	if (song.sourceId && enqueuingTrackIds.has(song.sourceId)) return true;
	const bareId = song.id ? song.id.replace(/^[a-z_]+:/i, "") : "";
	if (bareId && enqueuingTrackIds.has(bareId)) return true;
	const taKey = getTrackTitleArtistKey(song.title, song.artist);
	if (taKey && enqueuingTrackIds.has(taKey)) return true;
	return false;
}

async function requestTrack(song: ChatMusicTrack, anchor?: HTMLElement) {
	if (isEnqueuingTrack(song) || isTrackQueued(song) || isTrackCurrent(song)) return;
	const keysToAdd = [song.id];
	if (song.sourceId) keysToAdd.push(song.sourceId);
	const taKey = getTrackTitleArtistKey(song.title, song.artist);
	if (taKey) keysToAdd.push(taKey);

	enqueuingTrackIds = new Set([...enqueuingTrackIds, ...keysToAdd]);
	markPendingAutoUnmuteIfImmediate(song.id);
	try {
		const accepted = await onEnqueueTrack(song, anchor);
		if (!accepted) {
			if (pendingAutoUnmuteTrackId === song.id) pendingAutoUnmuteTrackId = "";
			const next = new Set(enqueuingTrackIds);
			for (const k of keysToAdd) next.delete(k);
			enqueuingTrackIds = next;
		} else {
			selectQueueTab("request");
			window.setTimeout(() => {
				let changed = false;
				const next = new Set(enqueuingTrackIds);
				for (const k of keysToAdd) {
					if (next.has(k)) {
						next.delete(k);
						changed = true;
					}
				}
				if (changed) enqueuingTrackIds = next;
			}, 3500);
		}
	} catch {
		const next = new Set(enqueuingTrackIds);
		for (const k of keysToAdd) next.delete(k);
		enqueuingTrackIds = next;
	}
}

function handleToggleQueueTrack(song: ChatMusicTrack, anchor?: HTMLElement) {
	if (isTrackCurrent(song) || isEnqueuingTrack(song)) return;
	const existing = findQueuedEntryForSong(song);
	if (existing) {
		if (canRemoveEntry(existing)) onRemoveQueue(existing.uid);
	} else {
		void requestTrack(song, anchor);
	}
}

onMount(() => {
	registerMediaSessionHandlers();
	const compactQuery = window.matchMedia(
		"(max-width: 1023px), (pointer: coarse) and (max-width: 1279px)",
	);
	const syncCompactHeader = () => {
		isCompactPlaylistHeader = compactQuery.matches;
	};
	syncCompactHeader();
	compactQuery.addEventListener("change", syncCompactHeader);

	// 房间时钟独立走时（即使本地处于静音模式也始终跟随全网进度推进与滚动歌词）
	const roomClock = window.setInterval(() => {
		if (document.hidden) return;
		refreshSoloCooldown();
		if (!currentPlay) return;

		const expected = computeExpectedElapsed();
		const localPos = player?.position ?? audioEl?.currentTime ?? 0;
		if (
			audioStatus === "preparing" ||
			currentPlay.phase === "transitioning" ||
			currentPlay.phase === "preparing"
		) {
			roomElapsed = 0;
		} else if (
			listenIntent &&
			audioStatus === "playing" &&
			Number.isFinite(localPos) &&
			localPos > 0 &&
			Math.abs(localPos - expected) <= 4.0
		) {
			roomElapsed = localPos;
		} else {
			roomElapsed = expected;
		}
		syncLyricIndex(roomElapsed);

	}, 250);

	const handlePointerDown = (e: PointerEvent) => {
		const target = e.target as HTMLElement | null;
		if (showRequesterFilter && !target?.closest("[data-history-filter-wrap]")) {
			showRequesterFilter = false;
		}
		if (showCollectiveUserDropdown && !target?.closest("[data-collective-filter-wrap]")) {
			showCollectiveUserDropdown = false;
		}
		if (openFavoritersKey && !target?.closest("[data-favoriters-wrap]")) {
			openFavoritersKey = "";
		}
	};
	const handleKeydown = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			if (showRequesterFilter) showRequesterFilter = false;
			if (showCollectiveUserDropdown) showCollectiveUserDropdown = false;
			openFavoritersKey = "";
		}
	};
	document.addEventListener("pointerdown", handlePointerDown);
	document.addEventListener("keydown", handleKeydown);

	return () => {
		compactQuery.removeEventListener("change", syncCompactHeader);
		lyricRequest?.abort();
		document.removeEventListener("pointerdown", handlePointerDown);
		document.removeEventListener("keydown", handleKeydown);
		window.clearInterval(roomClock);
		searchAbortController?.abort();
		searchAbortController = null;
		if (confirmDeleteTimer !== null) {
			window.clearTimeout(confirmDeleteTimer);
		}
		if (lyricsScrollHideTimer !== null) {
			window.clearTimeout(lyricsScrollHideTimer);
		}
		if (queueScrollHideTimer !== null) {
			window.clearTimeout(queueScrollHideTimer);
		}
		if (playlistFilterTimer !== null) {
			window.clearTimeout(playlistFilterTimer);
		}
		if (switchingQueueTimer !== null) {
			window.clearTimeout(switchingQueueTimer);
			switchingQueueTimer = null;
		}
		if (playlistScrollRaf !== null) {
			window.cancelAnimationFrame(playlistScrollRaf);
		}
		if (historyScrollRaf !== null) {
			window.cancelAnimationFrame(historyScrollRaf);
		}
		if (rotationScrollRaf !== null) {
			window.cancelAnimationFrame(rotationScrollRaf);
		}
		if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
			navigator.mediaSession.playbackState = "none";
			unregisterMediaSessionHandlers();
		}
	};
});

export function toggleListenControl(): void {
	toggleListen();
}

export function startListeningControl(): void {
	if (!isListening) startOrResumeAudio();
}

export function openPlayerTab(): void {
	activeTab = "player";
}

$effect(() => {
	const element = audioEl;
	if (!element) return;
	const controller = untrack(() => new RoomAudioPlayer(element, {
		now: () => serverNow?.() ?? Date.now() + clockOffsetMs,
		status: (status, intent, diagnostic) => {
			audioStatus = status;
			listenIntent = intent;
			isListening = intent && status !== "error";
			onAudioDiagnosticChange?.(diagnostic);
			updateMediaSessionMetadata();
		},
		error: (uid, revision) => onReportError(uid, revision),
		ended: (uid) => onTrackEnded(uid),
		duration: (uid, duration) => {
			localDuration = duration;
			onReportDuration(uid, duration);
		},
	}));
	player = controller;
	untrack(() => {
		controller.setVolume(volume);
		controller.setTrack(currentPlay);
		if (shouldInitialListen) { hasJoinedAudio = true; controller.listen(); }
	});
	return () => { controller.destroy(); if (player === controller) player = undefined; };
});

const displayedBrowseTracks = $derived(
	dedupeTracksById(submittedSearchQuery ? searchResults : fallbackTracks),
);
const elapsedWholeSec = $derived(Math.floor(roomElapsed));

const currentLyricText = $derived.by(() => {
	if (!currentPlay) return "";
	if (currentPlay.phase === "transitioning") return "♪ 正在切换下一曲... ♪";
	if (audioStatus === "preparing" || currentPlay.phase === "preparing") return "♪ 准备同步播放中... ♪";
	if (lyricsStatus === "loading") return "歌词加载中...";
	if (lyricsStatus === "empty" || lyrics.length === 0) return "纯音乐或暂无歌词";
	if (activeLyricIndex >= 0 && activeLyricIndex < lyrics.length) {
		return lyrics[activeLyricIndex].text || "♪ ~ ♪ ~ ♪";
	}
	return "♪ ~ 伴奏中 ~ ♪";
});

$effect(() => {
	onPlaybackStatusChange?.({
		isListening,
		audioStatus,
		listenIntent,
		isMuted: !isListening || volume <= 0,
		elapsedSec: elapsedWholeSec,
		durationSec: effectiveDuration,
		canDirectSkip,
		isSoloCoolingDown,
		soloCooldownRemainSec,
		hasVotedSkip,
		volume,
		currentLyric: currentLyricText,
	});
});
</script>

<aside bind:this={musicPanelEl} class="chat-music-panel flex flex-col h-full w-full min-h-0 overflow-hidden select-none" aria-label="点歌台">
  <div class="chat-music-panel-topbar">
  {#if onClose}
    <button
      type="button"
      class="chat-tool-btn chat-panel-close-btn md:hidden"
      aria-label="关闭点歌台"
      onclick={onClose}
    >
      <svg class="w-[1.15rem] h-[1.15rem]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
        <path d="m6 6 12 12M18 6 6 18" />
      </svg>
    </button>
  {/if}
  <!-- 其他页签用迷你播放条替代标题 -->
  {#if activeTab !== "player" && currentPlay}
    <MiniPlayerBar
      currentPlay={currentPlay}
      isListening={isListening}
      audioStatus={audioStatus}
      elapsedSec={roomElapsed}
      durationSec={effectiveDuration}
      canDirectSkip={canDirectSkip}
      isSoloCoolingDown={isSoloCoolingDown}
      soloCooldownRemainSec={soloCooldownRemainSec}
      hasVotedSkip={hasVotedSkip}
      voteCount={musicState?.voteCount ?? 0}
      voteThreshold={musicState?.voteThreshold ?? 2}
      isSkippingTrack={isSkippingTrack}
      currentLyric={currentLyricText}
      variant="panel"
      onOpenLyrics={() => switchMusicTab("player")}
      onToggleListen={() => toggleListen()}
      onSkipTrack={onSkipTrack}
      onVoteSkip={onVoteSkip}
    />
  {:else}
  <!-- 顶栏标题 -->
  <div class="chat-panel-header">
    <div class="chat-drawer-heading font-bold text-sm text-[var(--deep-text)] dark:text-white/90 flex items-center gap-2">
      <svg class="w-4 h-4 text-[var(--primary)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
      <span>点歌台</span>
    </div>

    <button
      type="button"
      disabled={!currentPlay}
      class="chat-listen-status text-xs md:text-[0.6875rem] px-3 md:px-2.5 py-0 rounded-full border font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed
        {isListening && currentPlay
          ? 'bg-(--primary)/14 border-(--primary)/30 text-[var(--chat-accent-text)] hover:bg-(--primary)/22'
          : 'bg-[var(--card-bg)]/60 border-[var(--chat-divider-color)] text-[var(--chat-meta-color)] hover:text-[var(--deep-text)] hover:bg-[var(--card-bg)]/85'}"
      aria-label={listenAction}
      onclick={toggleListen}
    >
      {#if audioStatus === "playing" && currentPlay}
        <span class="chat-eq-bars" aria-hidden="true">
          <span class="chat-eq-bar"></span>
          <span class="chat-eq-bar"></span>
          <span class="chat-eq-bar"></span>
        </span>
        <span>收听中</span>
      {:else}
        <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" />
        </svg>
        <span>{!currentPlay ? "未在播放" : audioStatusLabel[audioStatus]}</span>
      {/if}
    </button>
  </div>

  {/if}
  </div>

  <!-- 4-Tab 切换栏：歌词 / 搜索 / 歌单 / 历史 -->
  <div class="chat-music-tabs grid grid-cols-4 gap-1.5 border-b border-[var(--chat-divider-color)] px-2.5 py-2 md:py-1.5 shrink-0" role="tablist" aria-label="点歌台视图切换">
    <button
      type="button"
      role="tab"
      aria-selected={activeTab === "player"}
      class="flex items-center justify-center gap-1.5 py-2.5 md:py-2 px-1.5 text-[13.5px] xl:text-[13px] font-medium whitespace-nowrap transition-colors rounded-lg cursor-pointer border-none
        {activeTab === 'player'
          ? 'bg-(--btn-plain-bg-hover) text-(--primary) font-semibold'
          : 'bg-transparent text-[var(--chat-meta-color)] hover:bg-(--btn-plain-bg-hover) hover:text-[var(--deep-text)]'}"
      onclick={() => switchMusicTab("player")}
    >
      <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
      </svg>
      <span>歌词</span>
    </button>

    <button
      type="button"
      role="tab"
      aria-selected={activeTab === "search"}
      class="flex items-center justify-center gap-1.5 py-2.5 md:py-2 px-1.5 text-[13.5px] xl:text-[13px] font-medium whitespace-nowrap transition-colors rounded-lg cursor-pointer border-none
        {activeTab === 'search'
          ? 'bg-(--btn-plain-bg-hover) text-(--primary) font-semibold'
          : 'bg-transparent text-[var(--chat-meta-color)] hover:bg-(--btn-plain-bg-hover) hover:text-[var(--deep-text)]'}"
      onclick={() => switchMusicTab("search")}
    >
      <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <span>搜索</span>
    </button>

    <button
      type="button"
      role="tab"
      aria-selected={activeTab === "playlist"}
      class="flex items-center justify-center gap-1.5 py-2.5 md:py-2 px-1.5 text-[13.5px] xl:text-[13px] font-medium whitespace-nowrap transition-colors rounded-lg cursor-pointer border-none
        {activeTab === 'playlist'
          ? 'bg-(--btn-plain-bg-hover) text-(--primary) font-semibold'
          : 'bg-transparent text-[var(--chat-meta-color)] hover:bg-(--btn-plain-bg-hover) hover:text-[var(--deep-text)]'}"
      onmouseenter={() => void loadPlaylists()}
      onfocus={() => void loadPlaylists()}
      onclick={() => switchMusicTab("playlist")}
    >
      <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
      <span>歌单</span>
    </button>

    <button
      type="button"
      role="tab"
      aria-selected={activeTab === "history"}
      class="flex items-center justify-center gap-1.5 py-2.5 md:py-2 px-1.5 text-[13.5px] xl:text-[13px] font-medium whitespace-nowrap transition-colors rounded-lg cursor-pointer border-none
        {activeTab === 'history'
          ? 'bg-(--btn-plain-bg-hover) text-(--primary) font-semibold'
          : 'bg-transparent text-[var(--chat-meta-color)] hover:bg-(--btn-plain-bg-hover) hover:text-[var(--deep-text)]'}"
      onclick={() => switchMusicTab("history")}
    >
      <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15.5 14" />
      </svg>
      <span>历史</span>
    </button>
  </div>

  {#snippet collectiveCover()}
    <div class="w-full h-full bg-amber-100 flex items-center justify-center relative select-none">
      <svg class="w-5 h-5 text-amber-500 drop-shadow-[0_0_6px_rgba(245,158,11,0.65)] relative z-1" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="12 1.9 14.35 9.15 21.95 9.15 15.8 13.62 18.15 20.87 12 16.39 5.85 20.87 8.2 13.62 2.05 9.15 9.65 9.15" stroke="currentColor" stroke-width="0.5" stroke-linejoin="round" />
      </svg>
    </div>
  {/snippet}

  {#snippet rotationTrackRow(item: RotationQueueItem, index?: number)}
    {@const toTrack: ChatMusicTrack = {
      id: item.id,
      provider: "qq",
      sourceId: item.sourceTrackId || item.id.replace(/^qq:/, ""),
      sourcePlatform: (item.sourcePlatform as any) || "qqmusic",
      title: item.title,
      artist: item.artist,
      album: item.album || "",
      durationSec: item.durationSec || 0,
      cover: item.pic || "",
    }}
    {@const action = rotationAction?.entryId === (item.entryId ?? item.id) ? rotationAction : undefined}
    {@const isCurrent = item.entryId ? currentPlay?.track.id === item.id : isTrackCurrent(toTrack)}
    <div class="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
      <div class="chat-music-thumb-small w-8 h-8 rounded-md overflow-hidden shrink-0 bg-(--primary)/10 flex items-center justify-center">
        {#if item.pic}
          <img src={resolveMusicThumbUrl(item.pic)} alt="" loading="lazy" decoding="async" class="w-full h-full object-cover" />
        {:else}
          <span class="text-[10px] text-(--primary)">♪</span>
        {/if}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[13.5px] xl:text-[13px] font-bold text-[var(--deep-text)] truncate" title={item.title}>
          {item.title}
        </div>
        <div class="text-[12px] xl:text-[11px] text-[var(--chat-meta-color)] truncate flex items-center gap-1.5">
          <span class="truncate">{item.artist}</span>
          {#if item.durationSec}
            <span class="shrink-0 opacity-75">· {formatTime(item.durationSec)}</span>
          {/if}
        </div>
      </div>

      {#if item.sourcePlaylistTitle}
        {#if item.sourcePlaylistId}
          <button
            type="button"
            class="shrink-0 flex items-center justify-center self-center px-1.5 py-1 rounded bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-[var(--chat-meta-color)] hover:text-(--primary) text-[10.5px] xl:text-[10px] leading-tight text-center max-w-[96px] xl:max-w-[110px] line-clamp-2 border-none cursor-pointer transition-colors"
            onclick={() => openPlaylistFromPlayer(item.sourcePlaylistId)}
            title={`查看歌单《${item.sourcePlaylistTitle}》`}
          >
            {item.sourcePlaylistTitle}
          </button>
        {:else}
          <span
            class="shrink-0 flex items-center justify-center self-center px-1.5 py-1 rounded bg-black/5 dark:bg-white/10 text-[var(--chat-meta-color)] text-[10.5px] xl:text-[10px] leading-tight text-center max-w-[96px] xl:max-w-[110px] line-clamp-2 select-text"
            title={item.sourcePlaylistTitle}
          >
            {item.sourcePlaylistTitle}
          </span>
        {/if}
      {/if}

      <div class="flex items-center gap-1.5 shrink-0">
        {#if isCurrent}
          <span
            class="chat-queue-play-btn bg-(--primary)/12 text-[var(--chat-accent-text)]"
            aria-label="播放中"
          >
            <span class="chat-eq-bars" aria-hidden="true">
              <span class="chat-eq-bar"></span>
              <span class="chat-eq-bar"></span>
              <span class="chat-eq-bar"></span>
            </span>
          </span>
        {:else}
          {@const isSwitching = Boolean(action?.pending)}
          <button
            type="button"
            class="chat-queue-play-btn"
            aria-label={isSwitching ? `正在切到 ${item.title}...` : `播放 ${item.title}`}
            disabled={Boolean(rotationAction?.pending) || isSkippingTrack}
            onclick={(event) => onPlayRotationTrack?.(item, event.currentTarget.parentElement ?? event.currentTarget)}
          >
            {#if isSwitching}
              <svg class="w-3.5 h-3.5 shrink-0 animate-spin text-(--primary)" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
              </svg>
            {:else}
              <svg class="w-3.5 h-3.5 fill-current ml-0.5" viewBox="0 0 24 24" aria-hidden="true">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            {/if}
          </button>
        {/if}

        <!-- 移除按钮：这轮不播 -->
        <button
          type="button"
          class="chat-queue-icon-btn chat-queue-row-action"
          onclick={() => handleRemoveRotationTrackAction(item)}
          aria-label={`移除 ${item.title}`}
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>

    {#if action && !action.pending}
      <div class="flex flex-wrap items-center gap-x-2 px-2 pb-1 text-xs text-[var(--chat-meta-color)]">
        <span role="status">{action.offer ? "暂未找到原版本音源" : action.message}</span>
        {#if action.offer}
          <button type="button" class="btn-regular rounded-md px-2 py-1.5 font-medium text-[var(--chat-accent-text)]" onclick={() => onOpenRotationOffer?.()}>
            查看可播版本
          </button>
        {:else if action.code === "SOURCE_TEMPORARY"}
          <button type="button" class="btn-regular rounded-md px-2 py-1.5 font-medium text-[var(--chat-accent-text)]" onclick={(event) => onPlayRotationTrack?.(item, event.currentTarget.parentElement ?? event.currentTarget)}>
            重试
          </button>
        {:else if action.code === "NO_SOURCE"}
          <button type="button" class="btn-regular rounded-md px-2 py-1.5 font-medium text-[var(--chat-accent-text)]" onclick={() => {
            switchMusicTab("search");
            searchQuery = [item.title, item.artist].filter(Boolean).join(" ");
            submitSearch();
          }}>
            搜索这首歌
          </button>
        {/if}
      </div>
    {/if}
{/snippet}

  {#snippet trackRequestRow(
    song: ChatMusicTrack,
    subtitle: string,
    countBadge?: string,
    favoriters?: FavoriteUserItem[],
    favoriteCount?: number,
    durationSec?: number
  )}
    {@const isCurrent = isTrackCurrent(song)}
    {@const isQueued = isTrackQueued(song)}
    {@const thumbCover = resolveMusicThumbUrl(song.cover)}
    {@const isFav = isTrackFavorited(song)}
    {@const songLookupKey = song.id || getTrackTitleArtistKey(song.title, song.artist)}
    {@const isToggling = songLookupKey ? favoriteTogglingTrackIds.has(songLookupKey) : false}
    {@const hasSparkle = songLookupKey ? favSparkleTrackIds.has(songLookupKey) : false}
    <div
      class="chat-music-track-row chat-virtual-row flex items-center gap-3 md:gap-2.5 p-2.5 md:p-2 rounded-xl md:rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
      oncontextmenu={(event) => handleTrackRowContextMenu(event, song)}
      onpointerdown={(event) => handleTrackRowPointerDown(event, song)}
      onpointermove={handleTrackRowPointerMove}
      onpointerup={cancelTrackLongPress}
      onpointercancel={cancelTrackLongPress}
    >
      <div class="chat-music-thumb w-10 h-10 md:w-8 md:h-8 rounded-lg md:rounded-md overflow-hidden shrink-0 relative bg-(--primary)/10 flex items-center justify-center">
        <span class="text-xs text-(--primary)/70 select-none" aria-hidden="true">♪</span>
        {#if thumbCover}
          {#key thumbCover}
            <img src={thumbCover} alt="" loading="lazy" decoding="async"
              class="absolute inset-0 w-full h-full object-cover"
              onerror={(event) => { event.currentTarget.hidden = true; }} />
          {/key}
        {/if}
        {#if isCurrent}
          <div class="absolute inset-0 bg-black/45 flex items-center justify-center" aria-hidden="true">
            <span class="chat-eq-bars chat-eq-bars--light">
              <span class="chat-eq-bar"></span>
              <span class="chat-eq-bar"></span>
              <span class="chat-eq-bar"></span>
            </span>
          </div>
        {/if}
      </div>

      <div class="min-w-0 flex-1">
        <div class="text-[13.5px] xl:text-[13px] font-bold truncate {isCurrent ? 'text-[var(--chat-accent-text)]' : 'text-[var(--deep-text)]'}">
          {song.title}
        </div>
        <div class="flex items-center gap-1 min-w-0 text-[12px] xl:text-[11px] text-[var(--chat-meta-color)] mt-0.5">
          <span class="truncate min-w-0">{subtitle}</span>
          {#if durationSec}
            <span class="shrink-0 whitespace-nowrap">· {formatTime(durationSec)}</span>
          {/if}
          {#if favoriters && favoriters.length > 0}
            {@const count = Math.max(favoriteCount ?? 0, favoriters.length)}
            {@const favoriteRowKey = `${songLookupKey}:${song.title}`}
            <span aria-hidden="true" class="shrink-0">·</span>
            <span class="chat-read-receipts-wrap shrink-0" data-favoriters-wrap>
              <button
                type="button"
                class="whitespace-nowrap bg-transparent border-none p-0 text-inherit hover:text-(--primary) cursor-pointer text-left"
                aria-label={`查看收藏《${song.title}》的成员`}
                aria-expanded={openFavoritersKey === favoriteRowKey}
                onclick={() => (openFavoritersKey = openFavoritersKey === favoriteRowKey ? "" : favoriteRowKey)}
              >{count === 1 ? (favoriters[0].userName || "成员") : `${count} 人收藏`}</button>
              {#if openFavoritersKey === favoriteRowKey}
              <div
                data-chat-floating
                use:positionChatFloating={{ placement: "top", onReferenceHidden: () => { openFavoritersKey = ""; } }}
                class="chat-read-receipts-popover"
                role="group"
                aria-label="收藏成员"
              >
                <div class="text-[0.6875rem] font-semibold text-[var(--deep-text)] px-1 pb-1 mb-1 border-b border-[var(--chat-divider-color)] flex items-center justify-between gap-2">
                  <span>收藏成员</span><span class="text-[0.625rem] font-normal text-[var(--chat-meta-color)] tabular-nums">{count} 人</span>
                </div>
                <div class="chat-read-receipts-list custom-scrollbar space-y-0.5">
                  {#each favoriters as person (person.userKey)}
                    <button
                      type="button"
                      class="chat-reaction-user-btn"
                      disabled={!onOpenUserProfile || !person.userKey}
                      onclick={() => {
                        openFavoritersKey = "";
                        onOpenUserProfile?.({ userKey: person.userKey, name: person.userName || "成员", avatar: person.userAvatar });
                      }}
                    >
                      <ChatAvatar src={person.userAvatar} name={person.userName || "成员"} size="xs" class="w-4! h-4! text-[8px]! shrink-0" />
                      <span class="truncate flex-1 text-left">{person.userName || "成员"}</span>
                      <svg class="w-3 h-3 shrink-0 opacity-45" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
                    </button>
                  {/each}
                </div>
              </div>
              {/if}
            </span>
          {/if}
        </div>
      </div>

      <!-- 🌟 歌曲收藏按钮 -->
      <div class="relative inline-flex items-center justify-center shrink-0">
          <button
            type="button"
            aria-busy={isToggling}
            class="chat-queue-icon-btn {countBadge ? 'w-10! h-10! md:w-9! md:h-9!' : 'w-9! h-9! md:w-7! md:h-7!'} rounded-xl! md:rounded-lg! shrink-0 aspect-square border-none bg-transparent transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed {isFav ? 'text-amber-400 hover:text-amber-500' : 'text-[var(--chat-meta-color)] hover:text-amber-400'}"
            aria-label={isFav ? `取消收藏 ${song.title}` : `收藏 ${song.title}`}
            onclick={(e) => {
              e.stopPropagation();
              void handleToggleFavoriteTrack(song);
            }}
          >
            <svg
              class="chat-favorite-star w-4 h-4 md:w-3.5 md:h-3.5 transition-transform duration-150 {hasSparkle ? 'is-sparkling' : ''} {isFav ? 'chat-fav-star-glow' : ''}"
              data-favorited={isFav}
              viewBox="0 0 24 24"
              fill={isFav ? "currentColor" : "none"}
              stroke="currentColor"
              stroke-width={isFav ? "1" : "1.8"}
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polygon points="12 1.9 14.35 9.15 21.95 9.15 15.8 13.62 18.15 20.87 12 16.39 5.85 20.87 8.2 13.62 2.05 9.15 9.65 9.15" />
            </svg>
          </button>
        {#if hasSparkle}
          <span class="chat-fav-sparkle-burst" aria-hidden="true">
            <span class="chat-fav-sparkle s-1">★</span>
            <span class="chat-fav-sparkle s-2">✦</span>
            <span class="chat-fav-sparkle s-3">★</span>
            <span class="chat-fav-sparkle s-4">✦</span>
            <span class="chat-fav-sparkle s-5">★</span>
            <span class="chat-fav-sparkle s-6">✦</span>
          </span>
        {/if}
      </div>

      {#if isCurrent}
        <span
          class="{countBadge ? 'w-10 h-10 md:w-9 md:h-9 flex-col gap-0.5' : 'w-9 h-9 md:w-7 md:h-7'} rounded-xl md:rounded-lg inline-flex items-center justify-center bg-(--primary)/12 text-[var(--chat-accent-text)] shrink-0 aspect-square"
          aria-label="播放中"
        >
          <span class="chat-eq-bars" aria-hidden="true">
            <span class="chat-eq-bar"></span>
            <span class="chat-eq-bar"></span>
            <span class="chat-eq-bar"></span>
          </span>
          {#if countBadge}
            <span class="text-[11px] leading-none font-semibold tabular-nums">{countBadge}</span>
          {/if}
        </span>
      {:else if isQueued && !canToggleCatalogTrack(song)}
        <span
          class="{countBadge ? 'w-10 h-10 md:w-9 md:h-9 flex-col gap-0.5' : 'w-9 h-9 md:w-7 md:h-7'} rounded-xl md:rounded-lg inline-flex items-center justify-center text-[var(--chat-meta-color)] shrink-0 aspect-square"
          aria-label="已入列"
        >
          <svg class="w-4 h-4 md:w-3.5 md:h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {#if countBadge}
            <span class="text-[11px] leading-none font-semibold tabular-nums">{countBadge}</span>
          {/if}
        </span>
      {:else if isQueued}
        <button
          type="button"
          class="chat-queue-icon-btn {countBadge ? 'w-10! h-10! md:w-9! md:h-9! flex-col gap-0.5' : 'w-9! h-9! md:w-7! md:h-7!'} rounded-xl! md:rounded-lg! shrink-0 aspect-square text-red-500/85 hover:text-red-500!"
          aria-label={`移除 ${song.title}`}
          onclick={(event) => handleToggleQueueTrack(song, event.currentTarget.parentElement ?? event.currentTarget)}
        >
          <svg class="w-4 h-4 md:w-3.5 md:h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {#if countBadge}
            <span class="text-[11px] leading-none font-semibold tabular-nums">{countBadge}</span>
          {/if}
        </button>
      {:else if isEnqueuingTrack(song)}
        <button
          type="button"
          disabled
          class="chat-queue-icon-btn {countBadge ? 'w-10! h-10! md:w-9! md:h-9! flex-col gap-0.5' : 'w-9! h-9! md:w-7! md:h-7!'} rounded-xl! md:rounded-lg! shrink-0 aspect-square text-[var(--chat-accent-text)] bg-(--primary)/10 opacity-75 cursor-wait!"
          aria-label={`正在点歌 ${song.title}...`}
        >
          <svg class="w-4 h-4 md:w-3.5 md:h-3.5 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
          </svg>
          {#if countBadge}
            <span class="text-[11px] leading-none font-semibold tabular-nums">{countBadge}</span>
          {/if}
        </button>
      {:else}
        <button
          type="button"
          class="chat-queue-icon-btn {countBadge ? 'w-10! h-10! md:w-9! md:h-9! flex-col gap-0.5' : 'w-9! h-9! md:w-7! md:h-7!'} rounded-xl! md:rounded-lg! shrink-0 aspect-square text-[var(--chat-accent-text)] bg-(--primary)/10 hover:bg-(--primary)/20!"
          aria-label={`点歌 ${song.title}`}
          onclick={(event) => handleToggleQueueTrack(song, event.currentTarget.parentElement ?? event.currentTarget)}
        >
          <svg class="w-4 h-4 md:w-3.5 md:h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {#if countBadge}
            <span class="text-[11px] leading-none font-semibold tabular-nums">{countBadge}</span>
          {/if}
        </button>
      {/if}
    </div>
  {/snippet}

  {#snippet queuedPlayButton(item: QueueEntry)}
    {@const votes = item.playVotes ?? []}
    {@const voted = Boolean(currentUser && votes.includes(currentUser.userKey))}
    {@const direct = !currentPlay || canDirectSkip}
    {@const action = direct ? "切到" : voted ? "取消投票切到" : "投票切到"}
    {@const isSwitching = switchingQueueUid === item.uid}
    <button
      type="button"
      class="chat-queue-play-btn {voted ? 'is-voted' : ''} {!direct && votes.length > 0 && !isSwitching ? 'has-votes' : ''}"
      aria-label={isSwitching ? `正在切到 ${item.track.title}...` : `${action} ${item.track.title}${!direct ? `，${votes.length}/2 票` : ""}`}
      aria-pressed={!direct ? voted : undefined}
      disabled={isSwitching || isSkippingTrack}
      onclick={() => handlePlayQueuedAction(item.uid)}
    >
      {#if isSwitching}
        <svg class="w-3.5 h-3.5 shrink-0 animate-spin text-(--primary)" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
        </svg>
      {:else}
        {#if !direct && votes.length > 0}
          {#key votes.length}<span class="chat-queue-vote-count" aria-hidden="true">{votes.length}/2</span>{/key}
        {/if}
        <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="m7.07 18.62 8.43-5.95c.56-.39.56-1.24 0-1.64L7.07 5.08c-.65-.46-1.57 0-1.57.8v11.94c0 .8.92 1.26 1.57.8zM17 6c.55 0 1 .45 1 1v10c0 .55-.45 1-1 1s-1-.45-1-1V7c0-.55.45-1 1-1z" />
        </svg>
      {/if}
    </button>
  {/snippet}

  {#snippet queuedTrackRow(item: QueueEntry)}
    <div class="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
      <div class="chat-music-thumb-small w-8 h-8 rounded-md overflow-hidden shrink-0 bg-(--primary)/10 flex items-center justify-center">
        {#if item.track.cover}
          <img src={resolveMusicThumbUrl(item.track.cover)} alt="" loading="lazy" decoding="async" class="w-full h-full object-cover" />
        {:else}
          <span class="text-[10px] text-(--primary)">♪</span>
        {/if}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[13.5px] xl:text-[13px] font-bold text-[var(--deep-text)] truncate">
          {item.track.title}
        </div>
        <div class="text-[12px] xl:text-[11px] text-[var(--chat-meta-color)] truncate">
          {item.track.artist} ·
          {#if item.track.rotationReplacement}
            <span title={'替代《' + item.track.rotationReplacement.title + '》'}>替代《{item.track.rotationReplacement.title}》 · </span>
          {/if}
          {#if item.requesterKey && onOpenUserProfile}
            <button
              type="button"
              class="p-0 border-none bg-transparent text-inherit hover:text-[var(--primary)] cursor-pointer text-[12px] xl:text-[11px] inline"
              onclick={() => openRequesterProfile(item.requesterKey, item.requesterName)}
              title={`点歌人：${item.requesterName}`}
            >
              {item.requesterName}
            </button>
          {:else}
            <span title={`点歌人：${item.requesterName}`}>{item.requesterName}</span>
          {/if}
        </div>
      </div>

      <div class="flex items-center gap-1.5 shrink-0">
        {@render queuedPlayButton(item)}
        {#if canRemoveEntry(item)}
          <button
            type="button"
            class="chat-queue-icon-btn chat-queue-row-action"
            onclick={() => onRemoveQueue(item.uid)}
            aria-label={`移除 ${item.track.title}`}
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        {:else}
          <span class="chat-queue-row-action" aria-hidden="true"></span>
        {/if}
      </div>
    </div>
  {/snippet}

  {#if activeTab === "player"}
    <div class="flex-1 min-h-0 flex flex-col">
      <div class="px-4 pt-3 pb-1.5 shrink-0">
        <!-- 顶部行：左 w-20 正方形圆角大封面 + 右 三排文字（歌名、歌手/专辑、点歌人） -->
        <div class="flex items-center gap-3 mb-2.5">
          <div class="chat-music-player-cover relative shrink-0 w-20 h-20 rounded-xl overflow-hidden shadow-sm border border-black/5 dark:border-white/10 bg-(--primary)/10 flex items-center justify-center">
            <svg class="w-8 h-8 text-(--primary) opacity-40 absolute" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
            {#if currentPlay?.track.cover && !coverLoadFailed}
              <img
                src={resolveMusicThumbUrl(currentPlay.track.cover, 200)}
                alt={`${currentPlay.track.title} 封面`}
                class="w-full h-full object-cover relative z-10"
                onerror={() => (coverLoadFailed = true)}
              />
            {/if}
          </div>

          <div class="chat-music-player-details flex-1 min-w-0 h-20 flex flex-col justify-between py-0.5 select-text">
            <!-- 第一排：歌曲名称 -->
            <h3
              class="font-bold text-sm sm:text-base text-[var(--deep-text)] leading-snug truncate m-0 select-text cursor-text"
              title={currentPlay ? currentPlay.track.title : undefined}
            >
              {currentPlay ? currentPlay.track.title : "未在播放"}
            </h3>

            <!-- 第二排：歌曲作者与专辑 -->
            {#if currentPlay}
              <div
                class="text-[13px] xl:text-[12px] font-medium text-[var(--chat-meta-color)] truncate min-w-0 leading-normal select-text cursor-text"
                title={getTrackArtistAndAlbum(currentPlay.track)}
              >
                {getTrackArtistAndAlbum(currentPlay.track)}
              </div>
            {:else}
              <div
                class="text-[13px] xl:text-[12px] font-medium text-[var(--chat-meta-color)] truncate min-w-0 leading-normal select-text cursor-text"
              >
                {!musicState ? "正在连接电台..." : "暂无点播歌曲"}
              </div>
            {/if}

            {#if currentPlay?.track.rotationReplacement}
              <p class="m-0 truncate text-xs text-[var(--chat-meta-color)]" title={currentPlay.track.rotationReplacement.title}>
                替代《{currentPlay.track.rotationReplacement.title}》
              </p>
            {/if}

            <!-- 第三排：点歌人 / 轮播歌单（小头像/歌单封面 + 名称，点击打开资料/歌单） -->
            <div class="flex items-center gap-1.5 min-w-0">
              {#if currentPlay}
                {@const isSystemFallback =
                  currentPlay.isFallback || currentPlay.requesterKey === "system:fallback"}
                {#if !isSystemFallback && currentPlay.requesterKey && onOpenUserProfile}
                  <button
                    type="button"
                    class="inline-flex items-center gap-1.5 min-w-0 max-w-[min(12rem,100%)] h-[22px] pl-[3px] pr-2 py-0 text-xs leading-none font-medium rounded-full bg-(--primary)/12 text-[var(--chat-accent-text)] hover:bg-(--primary)/20 border-none cursor-pointer transition-colors active:scale-95"
                    onclick={() => openRequesterProfile(currentPlay.requesterKey, currentPlay.requesterName)}
                    title={`查看点歌人 ${currentPlay.requesterName} 的个人资料`}
                  >
                    <ChatAvatar
                      src={currentRequesterAvatar}
                      name={currentPlay.requesterName}
                      size="2xs"
                    />
                    <span class="truncate leading-[1.2]">{currentPlay.requesterName}</span>
                  </button>
                {:else if isSystemFallback}
                  {@const playlistId = currentPlay.track?.sourcePlaylistId || musicState?.fallbackPlaylistId}
                  {@const playlistTitle = currentPlay.track?.sourcePlaylistTitle || currentPlay.requesterName.replace(/\s*[（(]轮播[）)]$/, "")}
                  {@const isCollective = playlistId === "pl_collective_favorites"}
                  {@const playlistCover = currentRotationPlaylistCover}
                  {#if playlistId}
                    <button
                      type="button"
                      class="inline-flex items-center gap-1.5 min-w-0 max-w-[min(16rem,100%)] h-[22px] pl-[3px] pr-2 py-0 text-xs leading-none font-medium rounded-full bg-(--primary)/12 text-[var(--chat-accent-text)] hover:bg-(--primary)/20 border-none cursor-pointer transition-colors active:scale-95"
                      onclick={() => openPlaylistFromPlayer(playlistId)}
                      title={`查看歌单 ${playlistTitle}`}
                    >
                      {#if isCollective}
                        <div class="w-4 h-4 rounded-full overflow-hidden shrink-0 bg-amber-100 flex items-center justify-center relative select-none">
                          <svg class="w-2.5 h-2.5 text-amber-500 drop-shadow-[0_0_4px_rgba(245,158,11,0.65)]" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="12 1.9 14.35 9.15 21.95 9.15 15.8 13.62 18.15 20.87 12 16.39 5.85 20.87 8.2 13.62 2.05 9.15 9.65 9.15" stroke="currentColor" stroke-width="0.5" stroke-linejoin="round" />
                          </svg>
                        </div>
                      {:else}
                        <ChatAvatar
                          src={playlistCover}
                          name={playlistTitle}
                          size="2xs"
                          fallback="♪"
                        />
                      {/if}
                      <span class="truncate leading-[1.2]">{currentPlay.requesterName}</span>
                    </button>
                  {:else}
                    <span class="inline-flex items-center gap-1.5 min-w-0 max-w-[min(16rem,100%)] h-[22px] pl-[3px] pr-2 py-0 text-xs leading-none font-medium rounded-full bg-(--primary)/12 text-[var(--chat-accent-text)]">
                      {#if isCollective}
                        <div class="w-4 h-4 rounded-full overflow-hidden shrink-0 bg-amber-100 flex items-center justify-center relative select-none">
                          <svg class="w-2.5 h-2.5 text-amber-500" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="12 1.9 14.35 9.15 21.95 9.15 15.8 13.62 18.15 20.87 12 16.39 5.85 20.87 8.2 13.62 2.05 9.15 9.65 9.15" stroke="currentColor" stroke-width="0.5" stroke-linejoin="round" />
                          </svg>
                        </div>
                      {:else}
                        <ChatAvatar
                          src={playlistCover}
                          name={playlistTitle}
                          size="2xs"
                          fallback="♪"
                        />
                      {/if}
                      <span class="truncate leading-[1.2]">{currentPlay.requesterName}</span>
                    </span>
                  {/if}
                {:else}
                  <span class="inline-flex items-center gap-1.5 min-w-0 max-w-[min(12rem,100%)] h-[22px] pl-[3px] pr-2 py-0 text-xs leading-none font-medium rounded-full bg-(--primary)/12 text-[var(--chat-accent-text)]">
                    <ChatAvatar
                      src={currentRequesterAvatar}
                      name={currentPlay.requesterName}
                      size="2xs"
                    />
                    <span class="truncate leading-[1.2]">{currentPlay.requesterName}</span>
                  </span>
                {/if}
              {:else}
                <span class="text-[13px] xl:text-[12px] text-[var(--chat-meta-color)] opacity-40">--</span>
              {/if}
            </div>
          </div>
        </div>

        <!-- 播放进度时间与音量调节栏 -->
        <div class="flex items-center justify-between text-[var(--chat-meta-color)] h-6 mb-1.5">
          <div class="text-[11px] sm:text-xs font-medium font-mono flex items-center gap-1.5 shrink-0 h-full tabular-nums" aria-live="polite">
            <span class="text-[var(--deep-text)]">{formatTime(currentPlay ? roomElapsed : 0)}</span>
            <span class="opacity-40" aria-hidden="true">/</span>
            <span>{formatTime(currentPlay ? effectiveDuration : 0)}</span>
          </div>

          <div class="flex items-center gap-1.5 bg-transparent h-full">
            <button
              type="button"
              disabled={!currentPlay}
              class="hover:text-(--primary) transition-colors p-0.5 rounded-md flex items-center border-none bg-transparent text-inherit cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
              aria-label={listenAction}
              onclick={toggleListen}
            >
              {#if !isListening || volume === 0}
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" />
                </svg>
              {:else}
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                </svg>
              {/if}
            </button>
            <div class="w-16 flex items-center">
              <div
                bind:this={volumeSliderEl}
                role="slider"
                tabindex="0"
                aria-label="音量"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(volumeRatio * 100)}
                class="chat-slim-slider {isDraggingVolume ? 'chat-slim-slider--dragging' : ''}"
                style="--pct: {volumeRatio};"
                onpointerdown={handleVolumePointerDown}
                onpointermove={handleVolumePointerMove}
                onpointerup={handleVolumePointerEnd}
                onpointercancel={handleVolumePointerEnd}
                onkeydown={handleVolumeKeyDown}
              >
                <div class="chat-slim-slider-fill"></div>
                <div class="chat-slim-slider-thumb"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- 只读同步进度条（未播放时也保留显示 0%） -->
        <div class="mb-2">
          <div class="chat-sync-progress" style="--pct: {currentPlay ? progressRatio : 0};" aria-label="当前歌曲同步进度">
            <div class="chat-sync-progress-fill"></div>
          </div>
        </div>

        <!-- 控制栏：左 视图切换（歌词/即将播放/并列） + 中 收听/静音 + 右 切歌/投票切歌 -->
        <div class="grid grid-cols-[1fr_auto_1fr] items-center py-1 gap-1.5">
          <!-- 左：分享（最左） + 收藏（其次），与右侧两键镜像对称 -->
          <div class="grid grid-cols-2 justify-items-center min-w-0">
            {#if onShareTrack}
              <ChatTooltip text="分享到聊天室">
                <button
                  type="button"
                  disabled={!currentPlay}
                  class="inline-flex h-8 w-8 items-center justify-center rounded-lg active:scale-95 transition-colors border-none bg-transparent cursor-pointer text-[var(--chat-meta-color)] hover:text-(--primary) disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="分享当前歌曲到聊天室"
                  onclick={() => {
                    if (currentPlay?.track) void onShareTrack(currentPlay.track);
                  }}
                >
                  <svg class="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                  </svg>
                </button>
              </ChatTooltip>
            {:else}
              <span></span>
            {/if}

            <!-- 🌟 收藏当前歌曲星星按钮（带蹦出星星粒子动效） -->
            <ChatTooltip text={isCurrentFavorited ? "取消收藏" : "全站收藏"}>
              <div class="relative inline-flex items-center justify-center">
                <button
                  type="button"
                  disabled={Boolean(currentUser && !currentPlay)}
                  aria-busy={isFavToggling}
                  class="chat-current-favorite inline-flex h-8 w-8 items-center justify-center rounded-lg active:scale-95 transition-colors border-none bg-transparent cursor-pointer disabled:cursor-not-allowed {isCurrentFavorited ? 'text-amber-400' : 'text-[var(--chat-meta-color)] hover:text-amber-400'}"
                  data-favorited={isCurrentFavorited}
                  aria-label={isCurrentFavorited ? "取消收藏当前歌曲" : "收藏当前歌曲"}
                  onclick={toggleFavoriteCurrentTrack}
                >
                  <svg
                    class="chat-favorite-star w-5 h-5 transition-transform duration-150 {isFavAnimating ? 'is-sparkling' : ''} {isCurrentFavorited ? 'chat-fav-star-glow' : ''}"
                    data-favorited={isCurrentFavorited}
                    viewBox="0 0 24 24"
                    fill={isCurrentFavorited ? "currentColor" : "none"}
                    stroke="currentColor"
                    stroke-width={isCurrentFavorited ? "1" : "1.8"}
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <polygon points="12 1.9 14.35 9.15 21.95 9.15 15.8 13.62 18.15 20.87 12 16.39 5.85 20.87 8.2 13.62 2.05 9.15 9.65 9.15" />
                  </svg>
                </button>
                {#if isFavAnimating && isCurrentFavorited}
                  <span class="chat-fav-sparkle-burst" aria-hidden="true">
                    <span class="chat-fav-sparkle s-1">★</span>
                    <span class="chat-fav-sparkle s-2">✦</span>
                    <span class="chat-fav-sparkle s-3">★</span>
                    <span class="chat-fav-sparkle s-4">✦</span>
                    <span class="chat-fav-sparkle s-5">★</span>
                    <span class="chat-fav-sparkle s-6">✦</span>
                  </span>
                {/if}
              </div>
            </ChatTooltip>
          </div>

          <button
            type="button"
            disabled={!currentPlay}
            class="chat-play-btn {audioStatus === 'playing' && currentPlay ? 'playing' : ''} justify-self-center shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label={listenAction}
            onclick={toggleListen}
          >
            {#if audioStatus === "blocked"}
              <svg class="w-4 h-4 shrink-0 text-amber-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
              </svg>
              <span>恢复收听</span>
            {:else if audioStatus === "error"}
              <svg class="w-4 h-4 shrink-0 text-red-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" />
              </svg>
              <span>重试收听</span>
            {:else if isListening && (audioStatus === "loading" || audioStatus === "preparing" || audioStatus === "recovering")}
              <svg class="w-4 h-4 animate-spin shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" opacity="0.25"/><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2"/></svg>
              <span>{audioStatus === "preparing" ? "准备同步" : "正在缓冲"}</span>
            {:else if audioStatus === "playing" && currentPlay}
              <span class="chat-eq-bars chat-eq-bars--light shrink-0" aria-hidden="true">
                <span class="chat-eq-bar"></span>
                <span class="chat-eq-bar"></span>
                <span class="chat-eq-bar"></span>
              </span>
              <span>正在收听</span>
            {:else}
              <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z" />
              </svg>
              <span>开始收听</span>
            {/if}
          </button>

          <div class="grid grid-cols-2 justify-items-center min-w-0">
            {#if !currentPlay}
              <button
                type="button"
                disabled={Boolean(currentUser)}
                class="inline-flex h-8 w-8 items-center justify-center rounded-lg active:scale-95 transition-colors border-none bg-transparent {!currentUser ? 'cursor-pointer text-[var(--chat-meta-color)] hover:text-(--primary)' : 'text-[var(--chat-meta-color)] opacity-40 cursor-not-allowed!'}"
                aria-label="切歌"
                onclick={() => {
                  if (!currentUser) {
                    onRequestAuth?.();
                  }
                }}
              >
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m5 5 10 7-10 7V5Zm14 0v14" />
                </svg>
              </button>
            {:else}
              {@const activeVotes = musicState?.voteCount ?? 0}
              {@const activeThreshold = musicState?.voteThreshold ?? 2}
              {@const mainSkipTooltipText =
                isSkippingTrack
                  ? "正在切歌..."
                  : canDirectSkip
                    ? "下一曲"
                    : hasVotedSkip
                      ? `取消投票（已投 ${activeVotes}/${activeThreshold} 票）`
                      : activeVotes > 0
                        ? `同意切歌（已有 ${activeVotes}/${activeThreshold} 票）`
                        : "投票切歌（0/2 票）"}
              <ChatTooltip text={mainSkipTooltipText}>
                {#if !currentUser}
                  <button
                    type="button"
                    class="inline-flex h-8 w-8 items-center justify-center rounded-lg active:scale-95 transition-colors border-none bg-transparent cursor-pointer text-[var(--chat-meta-color)] hover:text-(--primary)"
                    aria-label="下一曲"
                    onclick={() => onRequestAuth?.()}
                  >
                    <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="m5 5 10 7-10 7V5Zm14 0v14" />
                    </svg>
                  </button>
                {:else if canDirectSkip}
                  <button
                    type="button"
                    disabled={isSkippingTrack}
                    class="inline-flex h-8 w-8 items-center justify-center rounded-lg active:scale-95 transition-colors border-none bg-transparent cursor-pointer text-[var(--chat-meta-color)] hover:text-(--primary) disabled:opacity-75 disabled:cursor-wait!"
                    aria-label={isSkippingTrack ? "正在切歌..." : "下一曲"}
                    onclick={onSkipTrack}
                  >
                    {#if isSkippingTrack}
                      <svg class="w-5 h-5 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
                        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
                      </svg>
                    {:else}
                      <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="m5 5 10 7-10 7V5Zm14 0v14" />
                      </svg>
                    {/if}
                  </button>
                {:else}
                  <button
                    type="button"
                    disabled={isSkippingTrack}
                    class="inline-flex h-8 w-8 items-center justify-center rounded-lg active:scale-95 transition-colors border-none bg-transparent cursor-pointer {hasVotedSkip ? 'text-(--primary)' : 'text-[var(--chat-meta-color)] hover:text-(--primary)'} disabled:opacity-75 disabled:cursor-wait!"
                    aria-pressed={hasVotedSkip}
                    aria-label={mainSkipTooltipText}
                    onclick={onVoteSkip}
                  >
                    {#if isSkippingTrack}
                      <svg class="w-5 h-5 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
                        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
                      </svg>
                    {:else if hasVotedSkip}
                      <svg class="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    {:else}
                      <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="m5 5 10 7-10 7V5Zm14 0v14" />
                      </svg>
                    {/if}
                  </button>
                {/if}
              </ChatTooltip>
            {/if}
            <ChatTooltip text={rotationTooltipText}>
              <button
                type="button"
                class="inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors border-none bg-transparent {!currentUser || isWalineLoggedIn
                  ? 'cursor-pointer text-[var(--chat-meta-color)] hover:text-(--primary) active:scale-95'
                  : 'text-[var(--chat-meta-color)] opacity-40 cursor-not-allowed!'}"
                aria-disabled={currentUser && !isWalineLoggedIn ? "true" : undefined}
                aria-label={rotationTooltipText}
                onclick={openRotationSettings}
              >
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M4 6h10M18 6h2M4 12h2m4 0h10M4 18h8m4 0h4" />
                  <circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="14" cy="18" r="2" />
                </svg>
              </button>
            </ChatTooltip>
          </div>
        </div>
      </div>

      <!-- 歌词滚动 + 即将播放容器（支持 并列 / 纯歌词 / 纯列表 三态切换） -->
      <div class="flex-1 min-h-0 flex flex-col mx-2.5">
        {#if playerPaneMode !== "queue"}
          <div
            class="min-h-0 flex flex-col border-t border-[var(--chat-divider-color)]"
            style="flex: 1 1 0%;"
          >
            {#if !currentPlay}
              <div class="flex-1 flex flex-col items-center justify-center gap-3.5 py-4 text-center">
                <p class="text-[13px] xl:text-[12px] text-[var(--chat-meta-color)] m-0">
                  {!musicState ? "正在连接房间同步电台..." : "暂无播放歌曲，点一首歌和大家一起听吧~"}
                </p>
                {#if musicState}
                  <button
                    type="button"
                    class="chat-send-btn h-9! px-5! rounded-full! text-[13px]! max-md:text-[14px]! gap-1.5"
                    onclick={() => switchMusicTab("search")}
                  >
                    <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                    </svg>
                    <span>去点歌</span>
                  </button>
                {/if}
              </div>
            {:else}
              <div
                bind:this={lyricsContainer}
                class="chat-lyrics-scroll relative flex-1 min-h-0 overflow-y-auto custom-scrollbar chat-scroll-autohide {lyricsScrolling ? 'is-scrolling' : ''} flex flex-col items-center gap-1 py-12 px-1 text-center select-text"
                role="listbox"
                aria-label="歌词"
                onwheel={() => {
                  lastUserScrollAt = Date.now();
                  programmaticLyricScrollUntil = 0;
                  triggerLyricsScroll();
                }}
                ontouchstart={() => {
                  lastUserScrollAt = Date.now();
                  programmaticLyricScrollUntil = 0;
                  triggerLyricsScroll();
                }}
                onscroll={() => {
                  if (Date.now() > programmaticLyricScrollUntil) {
                    triggerLyricsScroll();
                  }
                }}
              >
                {#if lyricsStatus === "loading"}
                  <div class="text-[var(--chat-meta-color)] text-[13px] xl:text-[12px] py-8">正在载入歌词...</div>
                {:else if lyrics.length === 0}
                  <div class="text-[var(--chat-meta-color)] text-[13px] xl:text-[12px] py-8">暂无同步歌词</div>
                {:else}
                  {#each lyrics as line, idx (`${idx}-${line.time}`)}
                    {@const isCurrentLine = idx === activeLyricIndex}
                    <div
                      data-lyric-idx={idx}
                      role="option"
                      aria-selected={isCurrentLine}
                      class="w-full py-1 transition-all duration-300 leading-snug select-text cursor-text
                        {isCurrentLine ? 'text-[var(--chat-accent-text)] font-bold text-base' : 'text-sm text-[var(--chat-meta-color)]'}"
                    >
                      {line.text}
                    </div>
                  {/each}
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        <div
          class="min-h-0 flex flex-col border-t border-[var(--chat-divider-color)] pt-2 {playerPaneMode === 'lyrics' ? 'pb-1.5' : 'pb-2'} transition-[max-height] duration-200"
          style={playerPaneMode === "lyrics"
            ? "flex: 0 0 auto;"
            : playerPaneMode === "split"
              ? (queueTab === "request" ? queue.length === 0 : rotationQueue.length === 0)
                ? "flex: 0 0 auto;"
                : "flex: 0 1 auto; max-height: 42%;"
              : "flex: 1 1 0%;"}
        >
          <div class="flex items-center justify-between {playerPaneMode === 'lyrics' ? 'mb-0' : 'mb-1.5'} shrink-0 px-0.5">
            <div class="flex items-center gap-1.5 min-w-0">
              <div class="inline-flex items-center p-0.5 rounded-lg bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 text-[12px]">
                <button
                  type="button"
                  class="px-2.5 py-0.5 rounded-md transition-all cursor-pointer {queueTab === 'request' ? 'bg-white dark:bg-neutral-800 text-[var(--deep-text)] shadow-xs font-semibold' : 'text-[var(--chat-meta-color)] hover:text-[var(--deep-text)]'}"
                  onclick={() => {
                    selectQueueTab("request");
                    if (playerPaneMode === "lyrics") playerPaneMode = "split";
                  }}
                >
                  点播
                </button>
                <button
                  type="button"
                  class="px-2.5 py-0.5 rounded-md transition-all cursor-pointer {queueTab === 'rotation' ? 'bg-white dark:bg-neutral-800 text-[var(--deep-text)] shadow-xs font-semibold' : 'text-[var(--chat-meta-color)] hover:text-[var(--deep-text)]'}"
                  onclick={() => {
                    selectQueueTab("rotation");
                    if (playerPaneMode === "lyrics") playerPaneMode = "split";
                  }}
                >
                  轮播
                </button>
              </div>

              <ChatTooltip text={playerPaneModeLabel}>
                <button
                  type="button"
                  class="inline-flex h-7 w-7 items-center justify-center rounded-lg active:scale-95 transition-colors border-none bg-transparent cursor-pointer {playerPaneMode !== 'split' ? 'text-(--primary)' : 'text-[var(--chat-meta-color)] hover:text-(--primary)'}"
                  aria-label={playerPaneModeLabel}
                  onclick={cyclePlayerPaneMode}
                >
                  {#if playerPaneMode === "split"}
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <rect x="3" y="4" width="18" height="16" rx="2.5" />
                      <line x1="3" y1="13" x2="21" y2="13" />
                      <line x1="7" y1="8.5" x2="17" y2="8.5" />
                      <line x1="7" y1="16.5" x2="15" y2="16.5" />
                    </svg>
                  {:else if playerPaneMode === "lyrics"}
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                      <line x1="4" y1="6" x2="20" y2="6" />
                      <line x1="7" y1="10.5" x2="17" y2="10.5" />
                      <line x1="5" y1="15" x2="19" y2="15" />
                      <line x1="8" y1="19.5" x2="16" y2="19.5" />
                    </svg>
                  {:else}
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" />
                    </svg>
                  {/if}
                </button>
              </ChatTooltip>
            </div>

              {#if queueTab === "rotation"}
                <div class="flex items-center gap-1.5">
                  <span class="text-[11px] text-[var(--chat-meta-color)]">
                    洗牌顺序播放
                  </span>
                  {#if rotationQueue.length > 0}
                    <ChatTooltip text="重新洗牌轮播队列">
                      <button
                        type="button"
                        disabled={isShufflingRotation}
                        class="chat-queue-icon-btn w-7! h-7! shrink-0 aspect-square disabled:opacity-40 disabled:cursor-not-allowed!"
                        aria-label="重新洗牌轮播队列"
                        onclick={triggerShuffleRotation}
                      >
                        <svg
                          class="w-3.5 h-3.5 {isShufflingRotation ? 'animate-spin' : ''}"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2.1"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          aria-hidden="true"
                        >
                          <polyline points="23 4 23 10 17 10" />
                          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                        </svg>
                      </button>
                    </ChatTooltip>
                  {/if}
                </div>
              {:else if queue.length > 0}
                <span class="text-[11px] text-[var(--chat-meta-color)]">
                  优先播放点播
                </span>
              {/if}
            </div>

            {#if playerPaneMode !== "lyrics"}
              {#if queueTab === "request"}
              {#if queue.length === 0}
                <div class="{playerPaneMode === 'queue' ? 'flex-1' : ''} flex flex-col items-center justify-center gap-1 text-center px-3 pt-2 pb-5">
                  {#if currentPlay?.isFallback}
                    <span class="text-[13.5px] xl:text-[12px] font-medium text-[var(--deep-text)]">
                      正在歌单轮播
                    </span>
                    <span class="text-[12px] xl:text-[11px] text-[var(--chat-meta-color)] leading-relaxed">
                      点播为空时顺次轮播 · 随时点歌立即插播
                    </span>
                    {#if rotationQueue.length > 0}
                      <button
                        type="button"
                        class="mt-1 text-[11.5px] text-(--primary) hover:underline cursor-pointer bg-transparent border-none p-0 inline-flex items-center gap-1"
                        onclick={() => selectQueueTab("rotation")}
                      >
                        查看轮播预告 &rarr;
                      </button>
                    {/if}
                  {:else}
                    <span class="text-[13px] xl:text-[12px] text-[var(--chat-meta-color)]">
                      暂无待播歌曲
                    </span>
                    {#if rotationQueue.length > 0}
                      <button
                        type="button"
                        class="mt-1 text-[11.5px] text-(--primary) hover:underline cursor-pointer bg-transparent border-none p-0 inline-flex items-center gap-1"
                        onclick={() => selectQueueTab("rotation")}
                      >
                        查看轮播预告 &rarr;
                      </button>
                    {/if}
                  {/if}
                </div>
              {:else}
                <div
                  class="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-1"
                >
                  {#each queue as item (item.uid)}
                    {@render queuedTrackRow(item)}
                  {/each}
                </div>
              {/if}
            {:else}
              {#if rotationQueue.length === 0}
                <div class="{playerPaneMode === 'queue' ? 'flex-1' : ''} flex flex-col items-center justify-center gap-1.5 text-center px-3 pt-3 pb-5">
                  <span class="text-[13px] xl:text-[12px] text-[var(--chat-meta-color)]">
                    {rotationEmptyMessage}
                  </span>
                  <button
                    type="button"
                    class="mt-1 px-3 py-1 text-[12px] rounded-lg font-medium transition-all {!currentUser || isWalineLoggedIn
                      ? 'border border-[var(--primary)]/35 bg-[var(--primary)]/10 text-(--primary) hover:bg-[var(--primary)]/20 cursor-pointer active:scale-95'
                      : 'border border-[var(--chat-divider-color)] bg-transparent text-[var(--chat-meta-color)] opacity-40 cursor-not-allowed!'}"
                    aria-disabled={currentUser && !isWalineLoggedIn ? "true" : undefined}
                    aria-label="设置轮播歌单"
                    onclick={openRotationSettings}
                  >
                    设置轮播歌单
                  </button>
                </div>
              {:else}
                <div
                  class="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-1"
                >
                  {#each rotationQueue as rItem (rItem.entryId ?? rItem.id)}
                    {@render rotationTrackRow(rItem)}
                  {/each}
                </div>
              {/if}
            {/if}
            {/if}
          </div>
      </div>
    </div>
  {:else if activeTab === "search"}
    <!-- Tab 2：歌曲 / 歌手搜索与待播队列 -->
    <div class="px-3 pt-2.5 pb-2 shrink-0 space-y-2">
      <div class="flex items-center gap-1.5">
        <div
          class="relative flex-1 min-w-0"
          role="presentation"
          onclick={() => {
            if (!currentUser) onRequestAuth?.();
          }}
        >
          <svg class="w-3.5 h-3.5 text-[var(--chat-meta-color)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            disabled={Boolean(currentUser && isSearching)}
            aria-disabled={!currentUser ? "true" : undefined}
            bind:value={searchQuery}
            placeholder={!currentUser ? "旁观模式不可点歌，登录后开启搜索" : searchProvider === "youtube" ? "在 YouTube Music 搜索歌曲 / 歌手" : "搜索歌曲 / 歌手"}
            class="chat-music-search {currentUser ? 'is-focus-reveal' : 'border border-[var(--chat-divider-color)] bg-black/5 dark:bg-white/5 cursor-pointer text-[var(--chat-meta-color)]'}"
            onkeydown={(e) => {
              if (e.key === "Enter" && !e.isComposing) {
                submitSearch();
              }
            }}
          />
          {#if searchQuery.trim().length > 0 && currentUser}
            <button
              type="button"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center border-none bg-transparent text-[var(--chat-meta-color)] hover:text-(--primary) cursor-pointer"
              aria-label="清除搜索"
              onclick={clearSearch}
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          {/if}
        </div>
        <button
          type="button"
          class="shrink-0 h-10 md:h-[32px] px-4 md:px-3 min-w-[58px] justify-center text-center rounded-full text-[14px] xl:text-[12px] font-medium transition-colors {!currentUser
            ? 'border border-[var(--primary)]/35 bg-[var(--primary)]/12 text-(--primary) hover:bg-[var(--primary)]/20 cursor-pointer active:scale-95'
            : 'border border-[var(--primary)]/35 bg-[var(--primary)]/12 text-(--primary) hover:bg-[var(--primary)]/20 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed'}"
          disabled={Boolean(currentUser && (!searchQuery.trim() || isSearching))}
          aria-disabled={!currentUser ? "true" : undefined}
          onclick={() => {
            if (!currentUser) {
              onRequestAuth?.();
              return;
            }
            submitSearch();
          }}
        >
          {isSearching ? "搜索中" : "搜索"}
        </button>
      </div>

      <!-- Source / Provider Switcher Pills Bar -->
      <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5" role="tablist" aria-label="音源选择">
        {#each SEARCH_PROVIDERS as provider (provider.id)}
          {@const isActive = searchProvider === provider.id}
          <button
            type="button"
            role="tab"
            aria-selected={isActive}
            class="shrink-0 px-3 py-1 rounded-full text-[12px] xl:text-[11px] font-medium transition-colors cursor-pointer border {provider.isOverseas ? '' : 'min-w-[54px] text-center justify-center'} {isActive
              ? provider.activeClass
              : provider.inactiveClass}"
            onclick={() => switchSearchProvider(provider.id)}
          >
            {provider.label}
          </button>
        {/each}
      </div>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 pb-3 space-y-3">
      <div>
        {#if searchFallbackNotice}
          <div class="p-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs flex items-center justify-between gap-2 mb-2">
            <div class="flex items-center gap-2">
              <svg class="w-4 h-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{searchFallbackNotice}</span>
            </div>
            <button
              type="button"
              class="text-[11px] underline opacity-80 hover:opacity-100 cursor-pointer bg-transparent border-none p-0 text-inherit"
              onclick={() => { searchFallbackNotice = ""; switchSearchProvider("qq"); }}
            >
              返回音源1
            </button>
          </div>
        {/if}

        {#if !submittedSearchQuery && !isSearching && fallbackTracks.length === 0}
          <div class="text-center py-6 px-3 rounded-xl border border-dashed border-[var(--chat-divider-color)] space-y-1">
            <p class="text-[14px] xl:text-[12px] font-medium text-[var(--deep-text)] m-0">
              {currentUser ? "输入歌名或歌手后点击「搜索」" : "当前处于旁观模式"}
            </p>
            <p class="text-[13px] xl:text-[12px] text-[var(--chat-meta-color)] m-0">
              {currentUser ? "点歌后全房将同步播放与滚动歌词，可随时切换上方音源" : "加入聊天室或登录后即可搜索点歌与大家一起听~"}
            </p>
          </div>
        {:else}
          <div class="flex items-center justify-between mb-1 px-0.5">
            <span class="text-[13px] xl:text-[12px] font-medium text-[var(--chat-meta-color)]">
              {submittedSearchQuery || isSearching
                ? isSearching
                  ? "正在搜索..."
                  : searchFallbackNotice
                    ? `YouTube Music 兜底 · 搜索结果 (${displayedBrowseTracks.length})`
                    : `${currentProviderOption.label} · 搜索结果 (${displayedBrowseTracks.length})`
                : `房间曲库 (${displayedBrowseTracks.length})`}
            </span>
            {#if submittedSearchQuery}
              <button
                type="button"
                class="text-[13px] xl:text-[12px] text-[var(--chat-meta-color)] hover:text-(--primary) bg-transparent border-none p-0 cursor-pointer"
                onclick={clearSearch}
              >
                {fallbackTracks.length > 0 ? "返回曲库" : "清空"}
              </button>
            {/if}
          </div>

          {#if isSearching}
            <div class="text-center py-8 px-3 rounded-xl border border-dashed border-[var(--chat-divider-color)] space-y-1.5">
              <div class="inline-block w-4 h-4 rounded-full border-2 border-[var(--primary)]/30 border-t-[var(--primary)] animate-spin"></div>
              <p class="text-[13px] xl:text-[12px] text-[var(--chat-meta-color)] m-0">正在【{currentProviderOption.label}】搜索「{submittedSearchQuery}」...</p>
            </div>
          {:else if searchError && displayedBrowseTracks.length === 0}
            <div class="text-center py-5 px-3 rounded-xl border border-dashed border-red-400/40 space-y-2">
              <p class="text-[13px] xl:text-[12px] text-red-500 m-0">{searchError}</p>
              <div class="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  class="px-3 py-1 rounded-full text-[13px] xl:text-[12px] border border-[var(--primary)]/35 bg-[var(--primary)]/12 text-(--primary) hover:bg-[var(--primary)]/20 cursor-pointer"
                  onclick={() => submitSearch(true)}
                >
                  重试
                </button>
                {#each SEARCH_PROVIDERS.filter((p) => p.id !== searchProvider) as alt}
                  <button
                    type="button"
                    class="px-3 py-1 rounded-full text-[13px] xl:text-[12px] border {alt.inactiveClass} cursor-pointer"
                    onclick={() => switchSearchProvider(alt.id)}
                  >
                    换到 {alt.label}
                  </button>
                {/each}
                <button
                  type="button"
                  class="px-3 py-1 rounded-full text-[13px] xl:text-[12px] border border-[var(--chat-divider-color)] bg-transparent text-[var(--chat-meta-color)] hover:text-[var(--deep-text)] cursor-pointer"
                  onclick={clearSearch}
                >
                  清空
                </button>
              </div>
            </div>
          {:else if displayedBrowseTracks.length === 0}
            <div class="text-center py-6 px-3 rounded-xl border border-dashed border-[var(--chat-divider-color)] space-y-2">
              <p class="text-[14px] xl:text-[12px] font-medium text-[var(--deep-text)] m-0">
                {submittedSearchQuery
                  ? `【${currentProviderOption.label}】暂未找到与「${submittedSearchQuery}」相关的歌曲`
                  : "暂无可用曲目"}
              </p>
              <p class="text-[13px] xl:text-[12px] text-[var(--chat-meta-color)] m-0">
                可以尝试切换其他音源继续搜索：
              </p>
              {#if submittedSearchQuery}
                <div class="flex flex-wrap items-center justify-center gap-2 pt-1">
                  {#each SEARCH_PROVIDERS.filter((p) => p.id !== searchProvider) as alt}
                    <button
                      type="button"
                      class="px-3 py-1 rounded-full text-[12px] font-medium border {alt.inactiveClass} cursor-pointer"
                      onclick={() => switchSearchProvider(alt.id)}
                    >
                      换用 {alt.label}
                    </button>
                  {/each}
                  <button
                    type="button"
                    class="px-3 py-1 rounded-full text-[12px] border border-[var(--chat-divider-color)] bg-transparent text-[var(--chat-meta-color)] hover:text-(--primary) cursor-pointer"
                    onclick={clearSearch}
                  >
                    清空搜索
                  </button>
                </div>
              {/if}
            </div>
          {:else}
            <div class="space-y-0.5">
              {#each displayedBrowseTracks as song (song.id)}
                {@render trackRequestRow(
                  song,
                  `${song.artist}${song.durationSec ? ` · ${formatTime(song.durationSec)}` : ""}`,
                )}
              {/each}
            </div>
            {#if searchError}
              <div class="text-center pt-2 text-[13px] xl:text-[12px] text-red-500">{searchError}</div>
            {/if}
          {/if}
          {#if !isSearching && submittedSearchQuery && hasMoreSearchResults}
            <div class="pt-2 flex justify-center">
              <button
                type="button"
                class="px-4 py-1.5 rounded-full text-[13px] xl:text-[12px] border border-[var(--chat-divider-color)] bg-transparent text-[var(--chat-meta-color)] hover:text-(--primary) hover:border-[var(--primary)]/40 disabled:opacity-50 transition-colors cursor-pointer"
                disabled={isLoadingMore}
                onclick={() => void loadMoreSearchResults()}
              >
                {isLoadingMore ? "正在加载更多..." : "加载更多结果"}
              </button>
            </div>
          {/if}
        {/if}
      </div>

      <div class="border-t border-[var(--chat-divider-color)]"></div>

      <div>
        <div class="flex items-center justify-between mb-1.5 shrink-0 px-0.5">
          <div class="inline-flex items-center p-0.5 rounded-lg bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 text-[12px]">
            <button
              type="button"
              class="px-2.5 py-0.5 rounded-md transition-all cursor-pointer {queueTab === 'request' ? 'bg-white dark:bg-neutral-800 text-[var(--deep-text)] shadow-xs font-semibold' : 'text-[var(--chat-meta-color)] hover:text-[var(--deep-text)]'}"
              onclick={() => selectQueueTab("request")}
            >
              点播
            </button>
            <button
              type="button"
              class="px-2.5 py-0.5 rounded-md transition-all cursor-pointer {queueTab === 'rotation' ? 'bg-white dark:bg-neutral-800 text-[var(--deep-text)] shadow-xs font-semibold' : 'text-[var(--chat-meta-color)] hover:text-[var(--deep-text)]'}"
              onclick={() => selectQueueTab("rotation")}
            >
              轮播
            </button>
          </div>

          {#if queueTab === "rotation"}
            <div class="flex items-center gap-1.5">
              <span class="text-[11px] text-[var(--chat-meta-color)]">
                洗牌顺序播放
              </span>
              {#if rotationQueue.length > 0}
                <ChatTooltip text="重新洗牌轮播队列">
                  <button
                    type="button"
                    disabled={isShufflingRotation}
                    class="chat-queue-icon-btn w-7! h-7! shrink-0 aspect-square disabled:opacity-40 disabled:cursor-not-allowed!"
                    aria-label="重新洗牌轮播队列"
                    onclick={triggerShuffleRotation}
                  >
                    <svg
                      class="w-3.5 h-3.5 {isShufflingRotation ? 'animate-spin' : ''}"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.1"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                  </button>
                </ChatTooltip>
              {/if}
            </div>
          {:else if queue.length > 0}
            <span class="text-[11px] text-[var(--chat-meta-color)]">
              优先播放点播
            </span>
          {/if}
        </div>

        {#if queueTab === "request"}
          {#if queue.length === 0}
            <div class="text-center py-4 text-[13px] xl:text-[12px] text-[var(--chat-meta-color)]">
              暂无点播歌曲，点播为空时将顺序轮播
              {#if rotationQueue.length > 0}
                <div class="mt-1">
                  <button
                    type="button"
                    class="text-[12px] text-(--primary) hover:underline cursor-pointer bg-transparent border-none p-0 inline-flex items-center gap-1"
                    onclick={() => selectQueueTab("rotation")}
                  >
                    查看轮播预告 &rarr;
                  </button>
                </div>
              {/if}
            </div>
          {:else}
            <div class="space-y-1">
              {#each queue as item (item.uid)}
                {@render queuedTrackRow(item)}
              {/each}
            </div>
          {/if}
        {:else}
          {#if rotationQueue.length === 0}
            <div class="text-center py-4 text-[13px] xl:text-[12px] text-[var(--chat-meta-color)]">
              {rotationEmptyMessage}
              <div class="mt-1.5">
                <button
                  type="button"
                  class="px-3 py-1 text-[12px] rounded-lg font-medium transition-all {!currentUser || isWalineLoggedIn
                    ? 'border border-[var(--primary)]/35 bg-[var(--primary)]/10 text-(--primary) hover:bg-[var(--primary)]/20 cursor-pointer active:scale-95'
                    : 'border border-[var(--chat-divider-color)] bg-transparent text-[var(--chat-meta-color)] opacity-40 cursor-not-allowed!'}"
                  aria-disabled={currentUser && !isWalineLoggedIn ? "true" : undefined}
                  aria-label="设置轮播歌单"
                  onclick={openRotationSettings}
                >
                  设置轮播歌单
                </button>
              </div>
            </div>
          {:else}
            <div class="space-y-1">
              {#each rotationQueue as rItem (rItem.entryId ?? rItem.id)}
                {@render rotationTrackRow(rItem)}
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    </div>
  {:else if activeTab === "playlist"}
    <!-- Tab 3：歌单（精选歌单 / 我的歌单 / 成员歌单 单列滚动） -->
    {#snippet playlistSummaryCard(pl: PlaylistSummary, showOwner = false)}
      <div class="chat-virtual-card flex items-center gap-2.5 p-2 rounded-xl border border-[var(--chat-divider-color)] bg-[var(--card-bg)]/45 hover:bg-[var(--card-bg)]/80 hover:border-(--primary)/30 transition-all shadow-xs">
        <button
          type="button"
          class="flex items-center gap-2.5 min-w-0 flex-1 text-left bg-transparent border-none p-0 cursor-pointer"
          onpointerenter={() => schedulePlaylistDetailPrefetch(pl.id)}
          onpointerleave={cancelPlaylistDetailPrefetch}
          onclick={() => openPlaylistDetail(pl.id, false, pl)}
        >
          <div class="chat-music-thumb w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-(--primary)/12 flex items-center justify-center">
            {#if pl.id === "pl_collective_favorites"}
              {@render collectiveCover()}
            {:else if pl.coverUrl}
              <img src={resolveMusicThumbUrl(pl.coverUrl)} alt="" loading="lazy" decoding="async" class="w-full h-full object-cover" />
            {:else}
              <span class="text-sm text-(--primary)">♪</span>
            {/if}
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="text-[13.5px] xl:text-[13px] font-bold text-[var(--deep-text)] truncate">{pl.id === "pl_collective_favorites" ? "全站收藏" : pl.title}</span>
              {#if pl.isFallback}
                <span class="shrink-0 text-[10px] xl:text-[10px] font-semibold px-1.5 py-px rounded-full bg-(--primary)/15 text-[var(--chat-accent-text)]">
                  歌单轮播
                </span>
              {/if}
              {#if pl.id === "pl_collective_favorites"}
                <span class="shrink-0 text-[10px] xl:text-[10px] font-semibold px-1.5 py-px rounded-full bg-(--primary)/12 text-[var(--chat-accent-text)]">共享</span>
              {:else if pl.isFeatured}
                <span class="shrink-0 text-[10px] xl:text-[10px] font-semibold px-1.5 py-px rounded-full bg-(--primary)/12 text-[var(--chat-accent-text)]">
                  精选
                </span>
              {/if}
            </div>
            <div class="text-[12px] xl:text-[11px] text-[var(--chat-meta-color)] truncate mt-0.5 flex items-center gap-1">
              {#if pl.id === "pl_collective_favorites"}
                <span>由大家共同收藏 · {pl.trackCount} 首</span>
              {:else}
                <span>{formatPlatformLabel(pl.platform)} · {pl.trackCount} 首</span>
              {/if}
              {#if showOwner && pl.ownerName && pl.id !== "pl_collective_favorites"}
                <span>·</span>
                <span class="inline-flex items-center gap-1 min-w-0">
                  {#if pl.ownerAvatar}
                    <ChatAvatar src={pl.ownerAvatar} name={pl.ownerName} size="2xs" lazy class="w-3! h-3! text-[7px]!" />
                  {/if}
                  <span class="truncate">{pl.ownerName}</span>
                </span>
              {:else if pl.updatedAt}
                <span>· {formatPlaylistDate(pl.updatedAt)}</span>
              {/if}
            </div>
          </div>
        </button>

        {#if pl.id !== "pl_collective_favorites" && canManagePlaylist(pl)}
          <ChatTooltip text={isRefreshingPlaylistId === pl.id ? "正在同步歌单..." : "从平台重新拉取歌单"} align="right">
            <button
              type="button"
              disabled={isRefreshingPlaylistId === pl.id}
              class="chat-queue-icon-btn w-7! h-7! shrink-0 aspect-square"
              aria-label={`刷新 ${pl.title}`}
              onclick={() => handleRefreshPlaylist(pl)}
            >
              <svg class="w-3.5 h-3.5 {isRefreshingPlaylistId === pl.id ? 'animate-spin' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
          </ChatTooltip>
        {/if}
      </div>
    {/snippet}

    {#snippet importPlaylistCard()}
      <div class="rounded-xl border border-[var(--chat-divider-color)] bg-[var(--card-bg)]/45 p-3 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[13.5px] xl:text-[13px] font-bold text-[var(--deep-text)]">导入外部歌单</span>
          <a
            href="https://playlistout.lengxiqwq.com"
            target="_blank"
            rel="noopener noreferrer"
            class="text-[12px] xl:text-[11px] text-[var(--chat-meta-color)] hover:text-(--primary) no-underline transition-colors"
          >
            Powered by Playlist Out
          </a>
        </div>

        <form
          class="flex items-center gap-1.5"
          onsubmit={(e) => {
            e.preventDefault();
            void handleImportSubmit();
          }}
        >
          <input
            type="text"
            class="chat-playlist-input flex-1 min-w-0"
            placeholder="粘贴歌单链接"
            aria-label="外部歌单链接"
            disabled={isImportingPlaylist}
            bind:value={importInput}
          />
          <button
            type="submit"
            disabled={isImportingPlaylist || !importInput.trim()}
            class="px-3 py-1.5 rounded-lg text-[13px] xl:text-[12px] font-semibold bg-(--primary) text-white border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            {isImportingPlaylist ? "解析中" : "导入"}
          </button>
        </form>

        {#if importError}
          <p class="text-[13px] xl:text-[12px] text-red-500 m-0">{importError}</p>
        {/if}
        {#if importStatusText}
          <p class="text-[13px] xl:text-[12px] text-[var(--chat-meta-color)] m-0">{importStatusText}</p>
        {/if}

        {#if pendingAmbiguousImport}
          <div class="pt-1 space-y-1.5 border-t border-[var(--chat-divider-color)]">
            <div class="text-[13px] xl:text-[12px] font-medium text-[var(--deep-text)]">
              检测到多个可能匹配的平台，请选择：
            </div>
            <div class="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
              {#each pendingAmbiguousImport.candidates as cand (`${cand.platform}-${cand.kind}-${cand.id}`)}
                <button
                  type="button"
                  disabled={isImportingPlaylist}
                  class="w-full flex items-center justify-between gap-2 p-2 rounded-lg border border-[var(--chat-divider-color)] bg-[var(--card-bg)]/60 hover:bg-(--primary)/10 text-left cursor-pointer"
                  onclick={() =>
                    handleImportSubmit({
                      type: cand.kind,
                      platform: cand.platform,
                    })}
                >
                  <div class="min-w-0 flex-1">
                    <div class="text-[13.5px] xl:text-[13px] font-semibold text-[var(--deep-text)] truncate">{cand.title}</div>
                    <div class="text-[12px] xl:text-[11px] text-[var(--chat-meta-color)] truncate">
                      {formatPlatformLabel(cand.platform)}{cand.subtitle ? ` · ${cand.subtitle}` : ""}
                    </div>
                  </div>
                  <span class="text-[12px] xl:text-[11px] font-semibold text-[var(--chat-accent-text)] shrink-0">选择</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}

        {#if pendingUserImport}
          <div class="pt-1 space-y-1.5 border-t border-[var(--chat-divider-color)]">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[13px] xl:text-[12px] font-medium text-[var(--deep-text)] truncate">
                {pendingUserImport.nickname} 的公开歌单（点选导入）
              </span>
              <button
                type="button"
                class="text-[12px] xl:text-[11px] text-[var(--chat-meta-color)] bg-transparent border-none cursor-pointer p-0"
                onclick={() => (pendingUserImport = null)}
              >
                收起
              </button>
            </div>
            <div class="space-y-1 max-h-44 overflow-y-auto custom-scrollbar">
              {#each pendingUserImport.playlists as item (item.id || item.sourceUrl)}
                <button
                  type="button"
                  disabled={isImportingPlaylist}
                  class="w-full flex items-center justify-between gap-2 p-1.5 rounded-lg border border-[var(--chat-divider-color)] bg-[var(--card-bg)]/60 hover:bg-(--primary)/10 text-left cursor-pointer"
                  onclick={() => handleImportUserCandidate(item)}
                >
                  <div class="min-w-0 flex-1">
                    <div class="text-[13.5px] xl:text-[13px] font-medium text-[var(--deep-text)] truncate">{item.name}</div>
                    <div class="text-[12px] xl:text-[11px] text-[var(--chat-meta-color)]">{item.trackCount} 首</div>
                  </div>
                  <span class="text-[12px] xl:text-[11px] font-semibold text-[var(--chat-accent-text)] shrink-0">+ 导入</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/snippet}

    {#if selectedPlaylist}
      {@const safeSourceUrl = resolveSafeExternalUrl(selectedPlaylist.sourceUrl)}
      {#snippet playlistMetaHeader()}
        {#if selectedPlaylist}
          <!-- 第 2 行：封面图 + 歌单信息 (如果是共享歌单，操作按钮放在同一行右侧) -->
          <div class="flex items-center justify-between gap-2.5">
            <div class="flex items-center gap-2.5 min-w-0 flex-1">
              <div class="chat-music-thumb w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-(--primary)/12 flex items-center justify-center">
                {#if selectedPlaylist.id === "pl_collective_favorites"}
                  {@render collectiveCover()}
                {:else if selectedPlaylist.coverUrl}
                  <img src={resolveMusicThumbUrl(selectedPlaylist.coverUrl)} alt="" decoding="async" class="w-full h-full object-cover" />
                {:else}
                  <span class="text-xs text-(--primary)">♪</span>
                {/if}
              </div>

              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 min-w-0">
                  <span class="text-[13.5px] xl:text-[13px] font-bold text-[var(--deep-text)] truncate">
                    {selectedPlaylist.id === "pl_collective_favorites" ? "全站收藏" : selectedPlaylist.title}
                  </span>
                  {#if selectedPlaylist.isFallback}
                    <span class="shrink-0 text-[10px] xl:text-[10px] font-semibold px-1.5 py-px rounded-full bg-(--primary)/15 text-[var(--chat-accent-text)]">
                      歌单轮播
                    </span>
                  {/if}
                  {#if selectedPlaylist.id === "pl_collective_favorites"}
                    <span class="shrink-0 text-[10px] xl:text-[10px] font-semibold px-1.5 py-px rounded-full bg-(--primary)/12 text-[var(--chat-accent-text)]">共享</span>
                  {:else if selectedPlaylist.isFeatured}
                    <span class="shrink-0 text-[10px] xl:text-[10px] font-semibold px-1.5 py-px rounded-full bg-(--primary)/12 text-[var(--chat-accent-text)]">
                      精选
                    </span>
                  {/if}
                </div>
                <div class="text-[12px] xl:text-[11px] text-[var(--chat-meta-color)] truncate mt-0.5 flex items-center gap-1">
                  {#if selectedPlaylist.id === "pl_collective_favorites"}
                    <span>由大家共同收藏 · {selectedPlaylist.tracks.length || selectedPlaylist.trackCount || 0} 首</span>
                  {:else}
                    <span>{formatPlatformLabel(selectedPlaylist.platform)} · {selectedPlaylist.tracks.length || selectedPlaylist.trackCount || 0} 首</span>
                    {#if selectedPlaylist.ownerName}
                      <span>·</span>
                      {#if onOpenUserProfile && selectedPlaylist.ownerKey}
                        <button
                          type="button"
                          class="inline-flex items-center gap-1 min-w-0 bg-transparent border-none p-0 text-[12px] xl:text-[11px] text-[var(--chat-accent-text)] hover:underline cursor-pointer"
                          onclick={() =>
                            selectedPlaylist &&
                            openRequesterProfile(
                              selectedPlaylist.ownerKey,
                              selectedPlaylist.ownerName,
                            )}
                        >
                          <ChatAvatar
                            src={resolveOwnerAvatar(selectedPlaylist.ownerKey, selectedPlaylist.ownerAvatar)}
                            name={selectedPlaylist.ownerName}
                            size="2xs"
                            class="w-3.5! h-3.5! text-[8px]!"
                          />
                          <span class="truncate">{selectedPlaylist.ownerName}</span>
                        </button>
                      {:else}
                        <span class="inline-flex items-center gap-1 min-w-0">
                          <ChatAvatar
                            src={resolveOwnerAvatar(selectedPlaylist.ownerKey, selectedPlaylist.ownerAvatar)}
                            name={selectedPlaylist.ownerName}
                            size="2xs"
                            class="w-3.5! h-3.5! text-[8px]!"
                          />
                          <span class="truncate">{selectedPlaylist.ownerName}</span>
                        </span>
                      {/if}
                    {/if}
                    {#if selectedPlaylist.retrievalMode === "preview"}
                      <span>· 仅预览</span>
                    {/if}
                  {/if}
                </div>
              </div>
            </div>

            {#if selectedPlaylist.id === "pl_collective_favorites"}
              <!-- 共享歌单：仅有的两个操作按钮靠右排在同一行 -->
              <div class="flex items-center gap-1.5 shrink-0">
                <div class="chat-playlist-action-wrap">
                  <button
                    type="button"
                    disabled={selectedPlaylist.tracks.length === 0 || isRandomizing}
                    class="chat-playlist-icon-btn {isRandomizing ? 'opacity-75 cursor-wait!' : ''}"
                    aria-label={isRandomizing ? "正在随机点歌..." : "随机点一首"}
                    onclick={() => selectedPlaylist && handleRandomPlayFromPlaylist(selectedPlaylist)}
                  >
                    {#if isRandomizing}
                      <svg class="w-3.5 h-3.5 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
                        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
                      </svg>
                    {:else}
                      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <polyline points="16 3 21 3 21 8" />
                        <line x1="4" y1="20" x2="21" y2="3" />
                        <polyline points="21 16 21 21 16 21" />
                        <line x1="15" y1="15" x2="21" y2="21" />
                        <line x1="4" y1="4" x2="9" y2="9" />
                      </svg>
                    {/if}
                  </button>
                  <span data-chat-floating use:positionChatFloating={{ placement: "top-end", hover: "tooltip", gap: 7 }} class="chat-playlist-tooltip" role="tooltip">
                    {isRandomizing ? "正在随机点歌..." : "随机点一首"}
                  </span>
                </div>

                <div class="chat-playlist-action-wrap">
                  <button
                    type="button"
                    disabled={isLoadingPlaylistDetail}
                    class="chat-playlist-icon-btn"
                    aria-label="刷新歌单曲目"
                    onclick={() => selectedPlaylist && openPlaylistDetail(selectedPlaylist.id, true, undefined, collectiveFilterUserKey)}
                  >
                    <svg class="w-3.5 h-3.5 {isLoadingPlaylistDetail ? 'animate-spin' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                  </button>
                  <span data-chat-floating use:positionChatFloating={{ placement: "top-end", hover: "tooltip", gap: 7 }} class="chat-playlist-tooltip" role="tooltip">
                    {isLoadingPlaylistDetail ? "正在刷新..." : "刷新歌单曲目"}
                  </span>
                </div>
              </div>
            {/if}
          </div>

          <!-- 第 3 行：纯图标工具栏（普通歌单） -->
          {#if selectedPlaylist.id !== "pl_collective_favorites"}
            <div class="flex items-center justify-start">
              <div class="flex items-center gap-1.5 shrink-0">
                <div class="chat-playlist-action-wrap">
                  <button
                    type="button"
                    disabled={selectedPlaylist.tracks.length === 0 || isRandomizing}
                    class="chat-playlist-icon-btn {isRandomizing ? 'opacity-75 cursor-wait!' : ''}"
                    aria-label={isRandomizing ? "正在随机点歌..." : "随机点一首"}
                    onclick={() => selectedPlaylist && handleRandomPlayFromPlaylist(selectedPlaylist)}
                  >
                    {#if isRandomizing}
                      <svg class="w-3.5 h-3.5 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
                        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
                      </svg>
                    {:else}
                      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <polyline points="16 3 21 3 21 8" />
                        <line x1="4" y1="20" x2="21" y2="3" />
                        <polyline points="21 16 21 21 16 21" />
                        <line x1="15" y1="15" x2="21" y2="21" />
                        <line x1="4" y1="4" x2="9" y2="9" />
                      </svg>
                    {/if}
                  </button>
                  <span data-chat-floating use:positionChatFloating={{ placement: "top-start", hover: "tooltip", gap: 7 }} class="chat-playlist-tooltip" role="tooltip">
                    {isRandomizing ? "正在随机点歌..." : "随机点一首"}
                  </span>
                </div>

                {#if safeSourceUrl && !selectedPlaylist.isSystemProtected}
                  <div class="chat-playlist-action-wrap">
                    <a
                      href={safeSourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="chat-playlist-icon-btn no-underline"
                      aria-label={`前往${formatPlatformLabel(selectedPlaylist.platform)}原歌单`}
                    >
                      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                    <span data-chat-floating use:positionChatFloating={{ placement: canManagePlaylist(selectedPlaylist) ? "top" : "top-end", hover: "tooltip", gap: 7 }} class="chat-playlist-tooltip" role="tooltip">
                      前往{formatPlatformLabel(selectedPlaylist.platform)}原歌单
                    </span>
                  </div>
                {/if}

                {#if selectedPlaylist.isSystemProtected}
                  <div class="chat-playlist-action-wrap">
                    <button
                      type="button"
                      disabled={isLoadingPlaylistDetail}
                      class="chat-playlist-icon-btn"
                      aria-label="刷新歌单曲目"
                      onclick={() => selectedPlaylist && openPlaylistDetail(selectedPlaylist.id, true, undefined, collectiveFilterUserKey)}
                    >
                      <svg class="w-3.5 h-3.5 {isLoadingPlaylistDetail ? 'animate-spin' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                      </svg>
                    </button>
                    <span data-chat-floating use:positionChatFloating={{ hover: "tooltip", gap: 7 }} class="chat-playlist-tooltip" role="tooltip">
                      {isLoadingPlaylistDetail ? "正在刷新..." : "刷新歌单曲目"}
                    </span>
                  </div>
                {:else if canManagePlaylist(selectedPlaylist)}
                  <div class="chat-playlist-action-wrap">
                    <button
                      type="button"
                      disabled={isRefreshingPlaylistId === selectedPlaylist.id}
                      class="chat-playlist-icon-btn"
                      aria-label={selectedPlaylist.updatedAt ? `刷新同步歌单（上次同步于 ${formatPlaylistDate(selectedPlaylist.updatedAt)}）` : "刷新同步歌单"}
                      onclick={() => selectedPlaylist && handleRefreshPlaylist(selectedPlaylist)}
                    >
                      <svg class="w-3.5 h-3.5 {isRefreshingPlaylistId === selectedPlaylist.id ? 'animate-spin' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                      </svg>
                    </button>
                    <span data-chat-floating use:positionChatFloating={{ placement: currentUser?.isAdmin ? "top" : "top-end", hover: "tooltip", gap: 7 }} class="chat-playlist-tooltip" role="tooltip">
                      {#if isRefreshingPlaylistId === selectedPlaylist.id}
                        正在同步...
                      {:else if selectedPlaylist.updatedAt}
                        上次同步于 {formatPlaylistDate(selectedPlaylist.updatedAt)}
                      {:else}
                        刷新同步歌单
                      {/if}
                    </span>
                  </div>

                  {#if currentUser?.isAdmin}
                    <div class="chat-playlist-action-wrap">
                      <button
                        type="button"
                        disabled={isUpdatingFlagsId === selectedPlaylist.id}
                        class="chat-playlist-icon-btn {selectedPlaylist.isFeatured ? 'is-active' : ''}"
                        aria-label={selectedPlaylist.isFeatured ? "取消房间精选" : "设为房间精选"}
                        onclick={() => selectedPlaylist && handleTogglePlaylistFlag(selectedPlaylist, "isFeatured")}
                      >
                        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill={selectedPlaylist.isFeatured ? "currentColor" : "none"} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <polygon points="12 1.9 14.35 9.15 21.95 9.15 15.8 13.62 18.15 20.87 12 16.39 5.85 20.87 8.2 13.62 2.05 9.15 9.65 9.15" />
                        </svg>
                      </button>
                      <span data-chat-floating use:positionChatFloating={{ hover: "tooltip", gap: 7 }} class="chat-playlist-tooltip" role="tooltip">
                        {selectedPlaylist.isFeatured ? "取消房间精选" : "设为房间精选"}
                      </span>
                    </div>
                  {/if}

                  {#if isOwnPlaylist(selectedPlaylist) && !selectedPlaylist.isSystemProtected}
                    <div class="chat-playlist-action-wrap">
                      <button
                        type="button"
                        disabled={isDeletingPlaylistId === selectedPlaylist.id}
                        class="chat-playlist-icon-btn {confirmDeletePlaylistId === selectedPlaylist.id ? 'is-danger-confirm' : 'is-danger'}"
                        aria-label={confirmDeletePlaylistId === selectedPlaylist.id ? "再次点击确认删除" : "删除歌单"}
                        onclick={() => selectedPlaylist && handleDeletePlaylist(selectedPlaylist)}
                      >
                        {#if confirmDeletePlaylistId === selectedPlaylist.id}
                          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        {:else}
                          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        {/if}
                      </button>
                      <span
                        data-chat-floating
                        use:positionChatFloating={{ placement: "top-end", hover: "tooltip", forceOpen: confirmDeletePlaylistId === selectedPlaylist.id, gap: 7 }}
                        class="chat-playlist-tooltip"
                        role="tooltip"
                      >
                        {#if isDeletingPlaylistId === selectedPlaylist.id}
                          正在删除...
                        {:else if confirmDeletePlaylistId === selectedPlaylist.id}
                          再次点击确认删除
                        {:else}
                          删除歌单
                        {/if}
                      </span>
                    </div>
                  {/if}
                {/if}
              </div>
            </div>
          {/if}

          <!-- 第 4 行：茶室星愿成员筛选条 -->
          {#if selectedPlaylist.id === "pl_collective_favorites"}
            <div class="flex items-center justify-between gap-2 pt-0.5">
              <div class="flex items-center gap-1.5 min-w-0">
              <div class="inline-flex items-center gap-0.5 rounded-lg bg-[var(--card-bg)]/60 p-0.5 border border-[var(--chat-divider-color)] shrink-0" role="group" aria-label="收藏成员筛选">
                <button
                  type="button"
                  class="px-2.5 py-1 text-[12px] xl:text-[11px] font-medium rounded-md border-none cursor-pointer transition-colors whitespace-nowrap
                    {collectiveFilterUserKey === ''
                      ? 'bg-(--primary) text-white'
                      : 'bg-transparent text-[var(--chat-meta-color)] hover:text-[var(--deep-text)]'}"
                  onclick={() => handleFilterCollective('')}
                >
                  全部成员
                </button>
                {#if currentUser?.userKey}
                  <button
                    type="button"
                    class="px-2.5 py-1 text-[12px] xl:text-[11px] font-medium rounded-md border-none cursor-pointer transition-colors whitespace-nowrap
                      {collectiveFilterUserKey === currentUser.userKey
                        ? 'bg-(--primary) text-white'
                        : 'bg-transparent text-[var(--chat-meta-color)] hover:text-[var(--deep-text)]'}"
                    onclick={() => handleFilterCollective(currentUser.userKey)}
                  >
                    我的收藏
                  </button>
                {/if}
              </div>
              <span class="w-3.5 h-3.5 shrink-0 inline-flex items-center justify-center" role="status" aria-label={isLoadingPlaylistDetail ? "正在加载" : undefined}>
                {#if isLoadingPlaylistDetail}
                  <svg class="w-3.5 h-3.5 animate-spin text-(--primary)" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
                    <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
                  </svg>
                {/if}
              </span>
              </div>

              {#if selectedPlaylist.favoriters && selectedPlaylist.favoriters.length > 0}
                <div class="relative shrink-0" data-collective-filter-wrap>
                  <button
                    type="button"
                    aria-expanded={showCollectiveUserDropdown}
                    class="inline-flex items-center gap-1.5 max-w-36 px-2.5 py-1 text-[12px] xl:text-[11px] font-medium rounded-lg border cursor-pointer transition-colors
                      {collectiveFilterUserKey && collectiveFilterUserKey !== currentUser?.userKey
                        ? 'bg-(--primary) text-white border-transparent'
                        : 'bg-[var(--card-bg)]/60 text-[var(--chat-meta-color)] border-[var(--chat-divider-color)] hover:text-[var(--deep-text)]'}"
                    onclick={() => (showCollectiveUserDropdown = !showCollectiveUserDropdown)}
                  >
                    <svg class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                    </svg>
                    <span class="truncate">{activeFilterFavoriterName ? activeFilterFavoriterName : "成员筛选"}</span>
                  </button>

                  {#if showCollectiveUserDropdown}
                    <div
                      data-chat-floating
                      use:positionChatFloating={{ placement: "bottom-end" }}
                      class="chat-requester-menu custom-scrollbar"
                      role="menu"
                      aria-label="按成员筛选"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        class="chat-requester-option {!collectiveFilterUserKey ? 'active' : ''}"
                        onclick={() => {
                          handleFilterCollective('');
                          showCollectiveUserDropdown = false;
                        }}
                      >
                        <span class="truncate">全部成员收藏</span>
                        <span class="text-[12px] xl:text-[11px] opacity-70 tabular-nums shrink-0">{selectedPlaylist.trackCount || selectedPlaylist.tracks.length || 0}首</span>
                      </button>

                      {#if selectedPlaylist.favoriters.length > 0}
                        <div class="my-1 border-t border-black/5 dark:border-white/10"></div>
                        {#each selectedPlaylist.favoriters as favoriter (favoriter.userKey)}
                          <button
                            type="button"
                            role="menuitem"
                            class="chat-requester-option {collectiveFilterUserKey === favoriter.userKey ? 'active' : ''}"
                            onclick={() => {
                              handleFilterCollective(favoriter.userKey);
                              showCollectiveUserDropdown = false;
                            }}
                          >
                            <span class="flex items-center gap-1.5 min-w-0 flex-1">
                              <ChatAvatar src={favoriter.userAvatar} name={favoriter.userName} size="2xs" />
                              <span class="truncate">{favoriter.userName}</span>
                            </span>
							{#if favoriter.trackCount}
							  <span class="text-[11px] opacity-70 tabular-nums shrink-0">{favoriter.trackCount}首</span>
                            {/if}
                          </button>
                        {/each}
                      {/if}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        {/if}
      {/snippet}

      <!-- 歌单详情视图 -->
      <div class="flex-1 min-h-0 flex flex-col">
        <div class="px-3 pt-2.5 pb-2 border-b border-[var(--chat-divider-color)] space-y-2 shrink-0">
          <!-- 第 1 行：返回按钮 + 歌单内搜索框 -->
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              class="chat-queue-icon-btn w-7! h-7! shrink-0"
              aria-label="返回歌单列表"
              onclick={() => {
                selectedPlaylist = null;
                isLoadingPlaylistDetail = false;
                playlistTrackFilter = "";
                confirmDeletePlaylistId = "";
              }}
            >
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            <div class="relative flex-1 min-w-0">
              <svg class="w-3.5 h-3.5 text-[var(--chat-meta-color)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                class="chat-music-search is-immersive py-1.5! pl-8! pr-7! text-xs!"
                placeholder="搜歌名或歌手"
                aria-label="歌单内搜索"
                bind:value={playlistTrackFilter}
              />
              {#if playlistTrackFilter.trim().length > 0}
                <button
                  type="button"
                  class="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center border-none bg-transparent text-[var(--chat-meta-color)] hover:text-(--primary) cursor-pointer"
                  aria-label="清除筛选"
                  onclick={() => (playlistTrackFilter = "")}
                >
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              {/if}
            </div>
          </div>

          {#if !isCompactPlaylistHeader}
            {@render playlistMetaHeader()}
          {/if}
        </div>

        <div
          bind:this={playlistScrollEl}
          class="chat-virtual-scroll flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 py-1.5"
          onscroll={handlePlaylistScroll}
        >
          {#if isCompactPlaylistHeader}
            <div bind:this={playlistMetaBoxEl} class="pb-2 mb-1.5 border-b border-[var(--chat-divider-color)] space-y-2">
              {@render playlistMetaHeader()}
            </div>
          {/if}
          {#if isLoadingPlaylistDetail && selectedPlaylist.tracks.length === 0}
            {#if selectedPlaylist.id !== "pl_collective_favorites"}
            <div class="flex flex-col items-center justify-center py-12 gap-2.5 text-[var(--chat-meta-color)]">
              <svg class="w-5 h-5 animate-spin text-(--primary)" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
                <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
              </svg>
              <span class="text-[13px] xl:text-[12px]">正在加载歌单曲目...</span>
            </div>
            {/if}
          {:else if playlistsError && selectedPlaylist.tracks.length === 0}
            <div class="text-center py-8 px-3 rounded-xl border border-dashed border-red-400/40 space-y-2">
              <p class="text-[13px] xl:text-[12px] text-red-500 m-0">{playlistsError}</p>
              <button
                type="button"
                class="px-3 py-1 rounded-full text-[12px] xl:text-[11px] border border-red-400/40 bg-transparent text-red-500 hover:bg-red-500/10 cursor-pointer"
                onclick={() => selectedPlaylist && openPlaylistDetail(selectedPlaylist.id, true, selectedPlaylist)}
              >
                重试加载
              </button>
            </div>
          {:else if filteredPlaylistTracks.length === 0}
            <div class="text-center py-6 text-[13px] xl:text-[12px] text-[var(--chat-meta-color)]">
              {playlistTrackFilter.trim() ? "没有匹配的歌曲" : "歌单暂无曲目"}
            </div>
          {:else}
            {#if playlistVirtual.topSpacerPx > 0}
              <div style="height: {playlistVirtual.topSpacerPx}px; flex-shrink: 0;" aria-hidden="true"></div>
            {/if}
            <div class="chat-music-track-list space-y-0.5" style="contain: layout style;">
              {#each playlistVirtual.items as item (`${selectedPlaylist.id}-${item.position}`)}
                {@const track = toEnqueueableTrack(item, selectedPlaylist.id)}
                {@const isCollective = selectedPlaylist.id === "pl_collective_favorites"}
                {@render trackRequestRow(
                  track,
                  item.artist,
                  undefined,
                  isCollective ? item.favoritedUsers : undefined,
                  isCollective ? item.favCount : undefined,
                  item.durationSec
                )}
              {/each}
            </div>
            {#if playlistVirtual.bottomSpacerPx > 0}
              <div style="height: {playlistVirtual.bottomSpacerPx}px; flex-shrink: 0;" aria-hidden="true"></div>
            {/if}
          {/if}
        </div>
      </div>
    {:else}
      <!-- 歌单目录视图：精选歌单 / 我的歌单 / 成员歌单 三段纵向排列 -->
      <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar chat-scrollbar-stable px-3 pb-4 pt-2 space-y-3">
        {#if playlistsError}
          <div class="text-[13px] xl:text-[12px] text-red-500 px-1">{playlistsError}</div>
        {/if}

        <!-- 段落 1：房间精选（可折叠） -->
        <section class="space-y-1.5">
          <button
            type="button"
            class="w-full flex items-center justify-between gap-2 bg-transparent border-none p-0 cursor-pointer text-left"
            aria-expanded={!featuredCollapsed}
            onclick={() => (featuredCollapsed = !featuredCollapsed)}
          >
            <span class="flex items-center gap-1.5 min-w-0">
              <span class="text-[13px] xl:text-[12px] font-bold text-[var(--deep-text)]">精选歌单</span>
              {#if featuredPlaylists.length > 0}
                <span class="text-[12px] xl:text-[11px] font-semibold text-[var(--chat-meta-color)] tabular-nums">{featuredPlaylists.length}</span>
              {/if}
            </span>
            <svg
              class="w-3.5 h-3.5 shrink-0 text-[var(--chat-meta-color)] transition-transform {featuredCollapsed ? '-rotate-90' : ''}"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {#if !featuredCollapsed}
            {#if isLoadingPlaylists && featuredPlaylists.length === 0}
              <div class="text-center py-4 text-[13px] xl:text-[12px] text-[var(--chat-meta-color)]">加载中...</div>
            {:else if featuredPlaylists.length === 0}
              <div class="rounded-xl border border-dashed border-[var(--chat-divider-color)] bg-[var(--card-bg)]/30 p-3 text-[13px] xl:text-[12px] text-[var(--chat-meta-color)] text-center">
                这个房间还没有精选歌单
              </div>
            {:else}
              <div class="space-y-1.5">
                {#each featuredPlaylists as pl (pl.id)}
                  {@render playlistSummaryCard(pl, Boolean(pl.ownerName))}
                {/each}
              </div>
            {/if}
          {/if}
        </section>

        <!-- 段落 2：我的歌单（导入入口常驻在列表上方） -->
        <section class="space-y-1.5">
          <button
            type="button"
            class="w-full flex items-center justify-between gap-2 bg-transparent border-none p-0 cursor-pointer text-left"
            aria-expanded={!myCollapsed}
            onclick={() => (myCollapsed = !myCollapsed)}
          >
            <span class="flex items-center gap-1.5 min-w-0">
              <span class="text-[13px] xl:text-[12px] font-bold text-[var(--deep-text)]">我的歌单</span>
              {#if personalPlaylistAuth && myPlaylists.length > 0}
                <span class="text-[12px] xl:text-[11px] font-semibold text-[var(--chat-meta-color)] tabular-nums">{myPlaylists.length}</span>
              {/if}
            </span>
            <svg class="w-3.5 h-3.5 shrink-0 text-[var(--chat-meta-color)] transition-transform {myCollapsed ? '-rotate-90' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {#if !myCollapsed}
          {#if !personalPlaylistAuth}
            <p class="text-[13px] xl:text-[12px] text-[var(--chat-meta-color)] m-0 px-2 py-1">
              {currentUser ? "正在确认聊天室身份…" : "旁观模式可浏览公开歌单。加入聊天室后可导入自己的歌单。"}
            </p>
          {:else}
            {@render importPlaylistCard()}
            {#if myPlaylists.length === 0}
              <div class="rounded-xl border border-dashed border-[var(--chat-divider-color)] bg-[var(--card-bg)]/30 p-3 text-[13px] xl:text-[12px] text-[var(--chat-meta-color)] text-center">
                还没有导入个人歌单，在上方粘贴歌单链接试试吧
              </div>
            {:else}
              <div class="space-y-1.5">
                {#each myPlaylists as pl (pl.id)}
                  {@render playlistSummaryCard(pl, false)}
                {/each}
              </div>
            {/if}
          {/if}
          {/if}
        </section>

        <!-- 段落 3：成员歌单（按成员分组，扁平列表） -->
        <section class="space-y-2">
          <button
            type="button"
            class="w-full flex items-center justify-between gap-2 bg-transparent border-none p-0 cursor-pointer text-left"
            aria-expanded={!membersCollapsed}
            onclick={() => (membersCollapsed = !membersCollapsed)}
          >
            <span class="flex items-center gap-1.5 min-w-0">
              <span class="text-[13px] xl:text-[12px] font-bold text-[var(--deep-text)]">成员歌单</span>
              {#if membersPlaylists.length > 0}
                <span class="text-[12px] xl:text-[11px] font-semibold text-[var(--chat-meta-color)] tabular-nums">{membersPlaylists.length}</span>
              {/if}
            </span>
            <svg class="w-3.5 h-3.5 shrink-0 text-[var(--chat-meta-color)] transition-transform {membersCollapsed ? '-rotate-90' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {#if !membersCollapsed}
          {#if isLoadingPlaylists && membersPlaylists.length === 0}
            <div class="text-center py-4 text-[13px] xl:text-[12px] text-[var(--chat-meta-color)]">加载中...</div>
          {:else if memberPlaylistGroups.length === 0}
            <div class="rounded-xl border border-dashed border-[var(--chat-divider-color)] bg-[var(--card-bg)]/30 p-3 text-[13px] xl:text-[12px] text-[var(--chat-meta-color)] text-center">
              还没有其他成员上传歌单
            </div>
          {:else}
            <div>
              {#each memberPlaylistGroups as group, groupIndex (group.ownerKey)}
                <div class={groupIndex > 0 ? "mt-3" : ""}>
                  <div class="flex items-center gap-2 px-1 pb-1">
                    <button
                      type="button"
                      class="flex items-center gap-1.5 min-w-0 flex-1 bg-transparent border-none p-0 cursor-pointer text-left transition-opacity hover:opacity-80"
                      aria-label={`查看 ${group.ownerName} 的个人资料`}
                      onclick={() => openRequesterProfile(group.ownerKey, group.ownerName)}
                    >
                      <ChatAvatar src={resolveOwnerAvatar(group.ownerKey, group.ownerAvatar)} name={group.ownerName} size="2xs" />
                      <span class="text-[13px] xl:text-[12px] font-semibold text-[var(--deep-text)] truncate">{group.ownerName}</span>
                    </button>
                    <span class="text-[12px] xl:text-[11px] text-[var(--chat-meta-color)] tabular-nums shrink-0">{group.playlists.length} 张</span>
                  </div>
                  <div class="space-y-1.5 mt-1">
                    {#each group.playlists as pl (pl.id)}
                      {@render playlistSummaryCard(pl, false)}
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
          {/if}
        </section>
      </div>
    {/if}
  {:else}
    <!-- Tab 4：历史记录（精简合并点播/轮播历史，筛选下拉菜单支持“全部/只看点播/只看轮播/按点歌人”，按时间/按次数排序） -->
    <div class="px-3 pt-2 pb-2.5 flex flex-col gap-2 shrink-0 relative">
      <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-1.5 min-w-0">
      <div class="inline-flex items-center gap-0.5 rounded-lg bg-[var(--card-bg)]/60 p-0.5 border border-[var(--chat-divider-color)]" role="group" aria-label="历史排序方式">
        <button
          type="button"
          class="px-3 py-1.5 md:px-2 md:py-0.5 text-[13px] xl:text-[12px] font-medium rounded-md border-none cursor-pointer transition-colors whitespace-nowrap
            {historySort === 'recent'
              ? 'bg-(--primary) text-white'
              : 'bg-transparent text-[var(--chat-meta-color)] hover:text-[var(--deep-text)]'}"
          onclick={() => (historySort = "recent")}
        >
          按时间
        </button>
        <button
          type="button"
          class="px-3 py-1.5 md:px-2 md:py-0.5 text-[13px] xl:text-[12px] font-medium rounded-md border-none cursor-pointer transition-colors whitespace-nowrap
            {historySort === 'count'
              ? 'bg-(--primary) text-white'
              : 'bg-transparent text-[var(--chat-meta-color)] hover:text-[var(--deep-text)]'}"
          onclick={() => (historySort = "count")}
        >
          按次数
        </button>
      </div>
      <span class="w-3.5 h-3.5 shrink-0 inline-flex items-center justify-center" role="status" aria-label={isCurrentHistoryLoading ? "正在加载" : undefined}>
        {#if isCurrentHistoryLoading}
          <svg class="w-3.5 h-3.5 animate-spin text-(--primary)" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
            <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
          </svg>
        {/if}
      </span>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <span class="text-[12px] xl:text-[11px] text-[var(--chat-meta-color)] font-medium tabular-nums hidden sm:inline">
          共 {activeHistoryTotal} 首
        </span>

        <div class="relative shrink-0" data-history-filter-wrap>
          <button
            type="button"
            aria-expanded={showRequesterFilter}
            class="inline-flex items-center gap-1.5 max-w-40 px-3 py-1.5 md:px-2 md:py-1 text-[13px] xl:text-[12px] font-medium rounded-lg border cursor-pointer transition-colors
              {historyFilterType !== 'all' || selectedRequesterKey
                ? 'bg-(--primary) text-white border-transparent shadow-xs'
                : 'bg-[var(--card-bg)]/60 text-[var(--chat-meta-color)] border-[var(--chat-divider-color)] hover:text-[var(--deep-text)]'}"
            onclick={() => (showRequesterFilter = !showRequesterFilter)}
          >
            {#if selectedRequester}
              <ChatAvatar
                src={selectedRequester.avatar}
                name={selectedRequester.name}
                size="2xs"
              />
              <span class="truncate">{selectedRequester.name}</span>
            {:else}
              <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              <span class="truncate">{historyFilterType === "rotation" ? "轮播" : historyFilterType === "request" ? "点播" : "全部"}</span>
            {/if}
            <svg class="w-2.5 h-2.5 shrink-0 opacity-70 transition-transform {showRequesterFilter ? 'rotate-180' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>

          {#if showRequesterFilter}
            <div data-chat-floating use:positionChatFloating={{ placement: "bottom-end" }} class="chat-requester-menu custom-scrollbar" role="group" aria-label="筛选历史类型或点歌人">
              <div class="px-1 pb-2">
      <div class="flex w-full items-center gap-0.5 rounded-lg bg-[var(--card-bg)]/60 p-0.5 border border-[var(--chat-divider-color)]" role="group" aria-label="历史类型">
        {#each [{ value: "all", label: "全部" }, { value: "request", label: "点播" }, { value: "rotation", label: "轮播" }] as filter (filter.value)}
          <button
            type="button"
            class="flex-1 min-w-0 px-3 py-1.5 md:px-2 md:py-0.5 text-[13px] xl:text-[12px] font-medium rounded-md border-none cursor-pointer transition-colors whitespace-nowrap {historyFilterType === filter.value ? 'bg-(--primary) text-white' : 'bg-transparent text-[var(--chat-meta-color)] hover:text-[var(--deep-text)]'}"
            aria-pressed={historyFilterType === filter.value}
            onclick={() => switchHistoryFilter(filter.value as "all" | "request" | "rotation")}
          >{filter.label}</button>
        {/each}
      </div>
              </div>
              <button
                type="button"
                role="menuitem"
                class="chat-requester-option {!selectedRequesterKey ? 'active' : ''}"
                onclick={() => {
                  switchHistoryFilter(historyFilterType, "");
                  showRequesterFilter = false;
                }}
              >
                <span>全部点歌人</span>
              </button>

              {#if historyRequesters.length > 0}
                <div class="my-1 border-t border-black/5 dark:border-white/10"></div>
                <div class="px-2.5 py-1 text-[11px] text-[var(--chat-meta-color)] font-medium">按点歌人筛选</div>
                {#each historyRequesters as person (person.key)}
                  <button
                    type="button"
                    role="menuitem"
                    class="chat-requester-option {historyFilterType === 'request' && selectedRequesterKey === person.key ? 'active' : ''}"
                    onclick={() => {
                      switchHistoryFilter("request", person.key);
                      showRequesterFilter = false;
                    }}
                  >
                    <span class="flex items-center gap-1.5 min-w-0 flex-1">
                      <ChatAvatar
                        src={person.avatar}
                        name={person.name}
                        size="2xs"
                      />
                      <span class="truncate">{person.name}</span>
                      {#if person.badge}
                        <span class="shrink-0 text-[10px] xl:text-[10px] px-1 py-px rounded bg-black/5 dark:bg-white/10 text-[var(--chat-meta-color)]">{person.badge}</span>
                      {/if}
                      {#if person.isMe}
                        <span class="shrink-0 text-[10px] xl:text-[10px] px-1 py-px rounded bg-(--primary)/15 text-[var(--chat-accent-text)]">我</span>
                      {/if}
                    </span>
                    <span class="text-[12px] xl:text-[11px] opacity-70 tabular-nums shrink-0">{person.trackCount}首</span>
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      </div>
      </div>

    </div>

    <div
      bind:this={historyScrollEl}
      class="chat-virtual-scroll flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 py-1.5"
      onscroll={handleHistoryScroll}
    >
      {#if activeHistoryEntries.length === 0 && isCurrentHistoryLoading}
        <!-- 加载反馈位于排序栏，避免在列表中插入占位内容。 -->
      {:else if activeHistoryEntries.length === 0}
        <div class="text-center py-8 px-3 rounded-xl border border-dashed border-[var(--chat-divider-color)] space-y-2">
          {#if historyFilterType === 'rotation'}
            <p class="text-[13px] xl:text-[12px] text-[var(--chat-meta-color)] m-0">
              房间里还没有歌单轮播记录
            </p>
            <span class="text-[12px] xl:text-[11px] text-[var(--chat-meta-color)]/70">
              开启歌单轮播后，播放过的歌曲将自动记录在此
            </span>
          {:else if historyFilterType === 'request' && selectedRequester}
            <p class="text-[13px] xl:text-[12px] text-[var(--chat-meta-color)] m-0">
              {selectedRequester.name} 还没有点歌记录
            </p>
            <button
              type="button"
              class="chat-queue-toggle-btn"
              onclick={() => switchHistoryFilter("all", "")}
            >
              查看全部
            </button>
          {:else if historyFilterType === 'request'}
            <p class="text-[13px] xl:text-[12px] text-[var(--chat-meta-color)] m-0">
              房间里还没有历史点歌记录
            </p>
            <button
              type="button"
              class="chat-queue-toggle-btn"
              onclick={() => switchMusicTab("search")}
            >
              去点歌
            </button>
          {:else}
            <p class="text-[13px] xl:text-[12px] text-[var(--chat-meta-color)] m-0">
              房间里还没有任何播放记录
            </p>
            <button
              type="button"
              class="chat-queue-toggle-btn"
              onclick={() => switchMusicTab("search")}
            >
              去点歌
            </button>
          {/if}
        </div>
      {:else}
        {#if historyVirtual.topSpacerPx > 0}
          <div style="height: {historyVirtual.topSpacerPx}px; flex-shrink: 0;" aria-hidden="true"></div>
        {/if}
        <div class="chat-music-track-list space-y-0.5" style="contain: layout style;">
          {#each historyVirtual.items as entry (`${entry.track.id}-${historyFilterType}-${historySort}-${selectedRequesterKey}`)}
            {@const subtitle = [
              entry.track.artist,
              entry.track.durationSec ? formatTime(entry.track.durationSec) : "",
              entry.lastRequesterName || "",
              entry.track.rotationReplacement
                ? "替代《" + entry.track.rotationReplacement.title + "》"
                : "",
            ].filter(Boolean).join(" · ")}
            {@render trackRequestRow(
              entry.track,
              subtitle,
              `${entry.requestCount}次`,
            )}
          {/each}
        </div>
        {#if historyVirtual.bottomSpacerPx > 0}
          <div style="height: {historyVirtual.bottomSpacerPx}px; flex-shrink: 0;" aria-hidden="true"></div>
        {/if}

        {#if isCurrentHistoryLoadingMore}
          <div class="py-3 flex items-center justify-center gap-2 text-xs text-[var(--chat-meta-color)]">
            <svg class="w-3.5 h-3.5 animate-spin text-(--primary)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <span>正在加载更多歌曲...</span>
          </div>
        {:else if !currentHistoryHasMore && activeHistoryEntries.length >= 20}
          <div class="py-2.5 text-center text-[11px] text-[var(--chat-meta-color)]/70">
            已加载全部 {activeHistoryEntries.length} 首歌曲
          </div>
        {/if}
      {/if}
    </div>
  {/if}

  <ChatModal open={rotationExpanded && isWalineLoggedIn}
    title="歌单轮播设置" subtitle="仅作用于当前房间，待播队列优先" size="lg"
    mobile="full" fillHeightOnDesktop={true} lockedMinHeight={540}
    topPriority
    onClose={closeRotationSettings}>
    {#if rotationLoading}
      <div class="flex flex-1 items-center justify-center gap-2 p-8 text-[13px] text-[var(--chat-meta-color)]" role="status">
        <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" /></svg>
        正在加载轮播设置…
      </div>
    {:else if rotationLoadError}
      <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p role="alert" class="m-0 text-[13px] text-red-500">{rotationLoadError}</p>
        <button type="button" class="chat-dialog-action rounded-lg px-3 py-2 text-[13px] border border-[var(--chat-divider-color)]" onclick={() => void loadRotationSettings()}>重试</button>
      </div>
    {:else}
    <form class="flex flex-1 flex-col min-h-0 overflow-hidden" onsubmit={(event) => { event.preventDefault(); void handleSaveRotation(); }}>
      <!-- 双栏主体容器：桌面端左右分割，移动端上下堆叠 -->
      <div class="chat-rotation-body flex-1 min-h-0 flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-[var(--chat-divider-color)] overflow-hidden">
        <!-- 左栏：播放状态与轮播模式设置（移动端精简紧凑并横排展示） -->
        <div class="w-full md:w-[320px] lg:w-[340px] shrink-0 flex flex-col md:overflow-y-auto custom-scrollbar p-3 sm:p-3.5 md:p-4 space-y-2.5 md:space-y-4 bg-[var(--skin-surface)]">
          <!-- 当前播放状态卡片：桌面端展示，手机端隐藏以极大释放歌单选择空间 -->
          <section aria-label="当前播放状态" class="hidden md:block rounded-xl border border-[var(--chat-divider-color)] bg-(--btn-regular-bg)/60 p-3.5 space-y-2">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 text-xs font-semibold text-[var(--deep-text)]">
                <svg class="w-3.5 h-3.5 text-(--primary)" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
                <span>当前播放</span>
              </div>
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium {currentPlay?.isFallback ? 'bg-(--primary)/15 text-(--primary)' : currentPlay ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-[var(--chat-meta-color)]/12 text-[var(--chat-meta-color)]'}">
                {currentPlay?.isFallback ? "歌单轮播中" : currentPlay ? "点播优先" : "暂未播放"}
              </span>
            </div>
            {#if currentPlay?.isFallback}
              <div class="space-y-0.5">
                <p class="m-0 truncate text-[13px] font-semibold text-[var(--deep-text)]" title={`${currentPlay.track.title} · ${currentPlay.track.artist}`}>{currentPlay.track.title} · {currentPlay.track.artist}</p>
                <p class="m-0 truncate text-xs text-[var(--chat-meta-color)]">来源：{currentPlay.requesterName.replace(/\s*[（(]轮播[）)]$/, "")}</p>
              </div>
              <p class="m-0 text-[11px] leading-relaxed text-[var(--chat-meta-color)]">待播队列为空时，电台自动在此轮播背景音乐。</p>
            {:else if currentPlay}
              <div class="space-y-0.5">
                <p class="m-0 truncate text-[13px] font-semibold text-[var(--deep-text)]" title={`${currentPlay.track.title} · ${currentPlay.track.artist}`}>{currentPlay.track.title} · {currentPlay.track.artist}</p>
                <p class="m-0 truncate text-xs text-[var(--chat-meta-color)]">点播人：{currentPlay.requesterName}</p>
              </div>
              <p class="m-0 text-[11px] leading-relaxed text-[var(--chat-meta-color)]">当前播放房友点播，待播队列播完后将自动切回轮播。</p>
            {:else}
              <p class="m-0 text-xs leading-relaxed text-[var(--chat-meta-color)]">当前电台空闲中。开启轮播后，待播队列为空时将自动播放。</p>
            {/if}
          </section>

          <!-- 轮播模式单选组：手机端横排紧凑切换，去除冗余小字解释 -->
          <fieldset class="chat-rotation-options border-0 p-0 m-0 space-y-1.5 md:space-y-2" aria-labelledby="chat-rotation-mode-title" disabled={rotationSaving}>
            <div class="flex items-center justify-between">
              <span id="chat-rotation-mode-title" class="chat-sheet-section-title text-[13.5px] sm:text-xs font-bold text-[var(--deep-text)]">轮播模式</span>
              <span class="hidden md:inline text-[11px] text-[var(--chat-meta-color)]">队列为空时策略</span>
            </div>
            <div class="grid grid-cols-3 gap-1.5 md:flex md:flex-col md:gap-2">
              {#each [
                {
                  value: "playlist",
                  title: "指定歌单",
                  shortTitle: "指定歌单",
                  detail: "仅在选中的一个或多个歌单中轮播"
                },
                {
                  value: "all",
                  title: "全部公开歌单",
                  shortTitle: "全部公开",
                  detail: "从房间所有公开歌单中随机挑选"
                },
                {
                  value: "off",
                  title: "关闭轮播",
                  shortTitle: "关闭轮播",
                  detail: "待播队列播放完毕后自动静止"
                }
              ] as option (option.value)}
                {@const isSelected = rotationMode === option.value}
                <label class="chat-rotation-mode group relative flex flex-col md:flex-row items-center md:items-start justify-center md:justify-start gap-1 md:gap-3 rounded-xl border py-2 px-2.5 md:p-3 cursor-pointer text-center md:text-left transition-all duration-150 {isSelected ? 'border-(--primary) bg-(--primary)/10 shadow-xs' : 'border-[var(--chat-divider-color)] hover:border-(--primary)/40 hover:bg-(--btn-plain-bg-hover)'}">
                  <input type="radio" name="rotation-mode" value={option.value} bind:group={rotationMode} class="sr-only md:not-sr-only md:mt-0.5 shrink-0 accent-(--primary)" />
                  <span class="min-w-0 flex-1 w-full">
                    <span class="chat-rotation-mode-title block text-[13.5px] sm:text-[13px] font-semibold truncate {isSelected ? 'text-(--primary)' : 'text-[var(--deep-text)]'}">
                      <span class="md:hidden">{option.shortTitle}</span>
                      <span class="hidden md:inline">{option.title}</span>
                    </span>
                    <!-- 手机端去除废话小字解释，仅在桌面端显示 -->
                    <span class="hidden md:block mt-0.5 text-[11px] leading-relaxed text-[var(--chat-meta-color)]">{option.detail}</span>
                  </span>
                </label>
              {/each}
            </div>
          </fieldset>
        </div>

        <!-- 右栏：专门显示歌单选择与预览 -->
        <div class="chat-rotation-results flex-1 min-w-0 flex flex-col overflow-hidden bg-[var(--chat-surface-soft)]/20">
          {#if rotationMode === "playlist"}
            <!-- 指定歌单模式：支持搜索、全选/清空、多选列表 -->
            <div class="shrink-0 px-3 sm:px-4 py-2 sm:py-2.5 border-b border-[var(--chat-divider-color)] bg-(--btn-regular-bg)/30">
              <div class="chat-rotation-toolbar flex items-center justify-between gap-2">
                <!-- 标题与已选计数 -->
                <div class="chat-rotation-selection flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <span class="chat-sheet-section-title text-[14px] sm:text-xs font-bold text-[var(--deep-text)] whitespace-nowrap">
                    <span class="sm:hidden">选择歌单</span>
                    <span class="hidden sm:inline">选择轮播歌单</span>
                  </span>
                  <span class="px-2 py-0.5 rounded-full text-[11px] font-medium {validSelectedRotationIds.length > 0 ? 'bg-(--primary)/15 text-(--primary)' : 'bg-red-500/10 text-red-500'} whitespace-nowrap">
                    已选 {validSelectedRotationIds.length} / {rotationChoices.length}
                  </span>
                </div>
                <!-- 桌面搜索和全选 / 清空操作 -->
                <div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  {#if rotationChoices.length > 3}
                    <div class="relative hidden md:block w-36">
                      <input
                        type="text"
                        bind:value={rotationPlaylistSearch}
                        placeholder="搜索歌单..."
                        class="w-full h-7 pl-6 pr-2 text-xs rounded-lg border border-[var(--chat-divider-color)] bg-transparent text-[var(--skin-text)] focus:outline-none focus:border-(--primary) placeholder:text-[var(--chat-meta-color)]"
                      />
                      <svg class="w-3 h-3 absolute left-2 top-2 text-[var(--chat-meta-color)] pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                      </svg>
                    </div>
                  {/if}
                  {#if rotationChoices.length > 1}
                    <button
                      type="button"
                      class="h-8 md:h-7 px-3 md:px-2.5 text-xs font-medium rounded-lg border border-[var(--chat-divider-color)] text-[var(--chat-meta-color)] hover:text-[var(--deep-text)] hover:bg-(--btn-plain-bg-hover) active:scale-95 transition-all"
                      onclick={() => rotationPlaylistIds = rotationChoices.map((playlist) => playlist.id)}
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      class="h-8 md:h-7 px-3 md:px-2.5 text-xs font-medium rounded-lg border border-[var(--chat-divider-color)] text-[var(--chat-meta-color)] hover:text-red-500 hover:border-red-500/30 hover:bg-red-500/5 active:scale-95 transition-all"
                      onclick={() => rotationPlaylistIds = []}
                    >
                      清空
                    </button>
                  {/if}
                </div>
              </div>

              <!-- 手机端独立的全宽搜索栏 -->
              {#if rotationChoices.length > 3}
                <div class="chat-rotation-search relative w-full mt-2 md:hidden">
                  <input
                    type="text"
                    bind:value={rotationPlaylistSearch}
                    placeholder="搜索歌单名称..."
                    class="w-full h-9 pl-8 pr-8 text-base rounded-xl border border-[var(--chat-divider-color)] bg-[var(--skin-surface)] text-[var(--skin-text)] focus:outline-none focus:border-(--primary) placeholder:text-[var(--chat-meta-color)] placeholder:text-xs"
                  />
                  <svg class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--chat-meta-color)] pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                  </svg>
                  {#if rotationPlaylistSearch}
                    <button
                      type="button"
                      class="absolute right-2 top-2 p-1 text-[var(--chat-meta-color)] hover:text-[var(--deep-text)] rounded-full"
                      onclick={() => rotationPlaylistSearch = ""}
                      aria-label="清空搜索"
                    >
                      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </button>
                  {/if}
                </div>
              {/if}
            </div>

            <fieldset class="flex-1 min-h-0 border-0 p-0 m-0 flex flex-col overflow-hidden" disabled={rotationSaving}>
              <div class="chat-rotation-list flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2.5 sm:p-3 md:p-4 space-y-1.5 sm:space-y-2" onscroll={handleRotationScroll}>
                {#if filteredRotationChoices.length === 0}
                  <div class="flex flex-col items-center justify-center min-h-full md:h-full md:min-h-[220px] text-center p-6 text-[var(--chat-meta-color)] max-md:[overflow-wrap:anywhere]">
                    {#if rotationPlaylistSearch.trim()}
                      <svg class="w-8 h-8 opacity-40 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                      </svg>
                      <p class="m-0 text-xs">未找到包含“{rotationPlaylistSearch}”的公开歌单</p>
                    {:else}
                      <svg class="w-8 h-8 opacity-40 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>
                      </svg>
                      <p class="m-0 text-xs">暂无可选的公开歌单</p>
                    {/if}
                  </div>
                {:else}
                  {#if rotationChoicesVirtual.topSpacerPx > 0}
                    <div style="height: {rotationChoicesVirtual.topSpacerPx}px; flex-shrink: 0;" aria-hidden="true"></div>
                  {/if}
                  <div class="chat-rotation-rows space-y-1.5 sm:space-y-2" style="contain: layout style;">
                    {#each rotationChoicesVirtual.items as playlist (playlist.id)}
                      {@const isSelected = rotationPlaylistIds.includes(playlist.id)}
                      <label class="chat-rotation-row group flex items-center gap-2.5 sm:gap-3 p-2 sm:p-2.5 rounded-xl border cursor-pointer transition-all duration-150 {isSelected ? 'border-(--primary) bg-(--primary)/10 shadow-xs' : 'border-[var(--chat-divider-color)] hover:border-(--primary)/30 hover:bg-(--btn-plain-bg-hover)'}">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onchange={() => toggleRotationPlaylist(playlist.id)}
                          class="shrink-0 accent-(--primary) w-4 h-4 rounded cursor-pointer"
                        />
                        <div class="w-10 h-10 sm:w-11 sm:h-11 rounded-lg overflow-hidden shrink-0 bg-(--primary)/12 flex items-center justify-center border border-black/5 dark:border-white/5">
                          {#if playlist.id === "pl_collective_favorites"}
                            {@render collectiveCover()}
                          {:else if playlist.coverUrl}
                            <img src={resolveMusicThumbUrl(playlist.coverUrl)} alt="" loading="lazy" decoding="async" class="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105" />
                          {:else}
                            <svg class="w-5 h-5 text-(--primary)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                              <path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>
                            </svg>
                          {/if}
                        </div>
                        <div class="min-w-0 flex-1">
                          <span class="chat-sheet-primary block truncate text-[14px] sm:text-[13px] font-semibold text-[var(--deep-text)] group-hover:text-(--primary) transition-colors">{playlist.id === "pl_collective_favorites" ? "全站收藏" : playlist.title}</span>
                          <div class="chat-sheet-meta flex items-center gap-1.5 mt-0.5 text-xs text-[var(--chat-meta-color)]">
                            <span class="px-1.5 py-0.2 rounded text-[10px] font-medium bg-[var(--chat-divider-color)]/70 text-[var(--chat-meta-color)]">
                              {formatPlatformLabel(playlist.platform)}
                            </span>
                            <span>{playlist.trackCount} 首</span>
                            <span>·</span>
                            <span class="truncate">{playlist.id === "pl_collective_favorites" ? "全站成员" : playlist.ownerName || "房友"}</span>
                          </div>
                        </div>
                      </label>
                    {/each}
                  </div>
                  {#if rotationChoicesVirtual.bottomSpacerPx > 0}
                    <div style="height: {rotationChoicesVirtual.bottomSpacerPx}px; flex-shrink: 0;" aria-hidden="true"></div>
                  {/if}
                {/if}
              </div>
            </fieldset>
          {:else if rotationMode === "all"}
            <!-- 全部公开歌单模式：展示包含的所有歌单列表概览 -->
            <div class="shrink-0 flex items-center justify-between gap-2 px-3 sm:px-4 py-2 sm:py-2.5 border-b border-[var(--chat-divider-color)] bg-(--btn-regular-bg)/30">
              <div class="chat-rotation-selection flex items-center gap-2 min-w-0">
                <span class="chat-sheet-section-title text-[13.5px] sm:text-xs font-bold text-[var(--deep-text)]">轮播歌曲来源</span>
                <span class="px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-medium bg-(--primary)/15 text-(--primary) whitespace-nowrap">
                  已全选（共 {rotationChoices.length} 个公开歌单）
                </span>
              </div>
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2.5 sm:p-3 md:p-4 space-y-1.5 sm:space-y-2">
              <div class="rounded-xl border border-dashed border-(--primary)/40 bg-(--primary)/5 p-2.5 sm:p-3 mb-1.5 sm:mb-2 text-xs text-(--primary) flex items-center gap-2">
                <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>从以下所有已公开的歌单中随机挑选轮播：</span>
              </div>
              {#each rotationChoices as playlist (playlist.id)}
                <div class="flex items-center gap-2.5 sm:gap-3 p-2 sm:p-2.5 rounded-xl border border-[var(--chat-divider-color)] bg-(--btn-regular-bg)/40 opacity-80">
                  <div class="w-9 h-9 sm:w-10 sm:h-10 rounded-lg overflow-hidden shrink-0 bg-(--primary)/12 flex items-center justify-center">
                    {#if playlist.id === "pl_collective_favorites"}
                      {@render collectiveCover()}
                    {:else if playlist.coverUrl}
                      <img src={resolveMusicThumbUrl(playlist.coverUrl)} alt="" loading="lazy" decoding="async" class="w-full h-full object-cover" />
                    {:else}
                      <svg class="w-5 h-5 text-(--primary)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>
                      </svg>
                    {/if}
                  </div>
                  <div class="min-w-0 flex-1">
                    <span class="chat-sheet-primary block truncate text-[14px] sm:text-[13px] font-semibold text-[var(--deep-text)]">{playlist.id === "pl_collective_favorites" ? "全站收藏" : playlist.title}</span>
                    <div class="chat-sheet-meta flex items-center gap-1.5 mt-0.5 text-xs text-[var(--chat-meta-color)]">
                      <span class="px-1.5 py-0.2 rounded text-[10px] font-medium bg-[var(--chat-divider-color)]/70 text-[var(--chat-meta-color)]">{formatPlatformLabel(playlist.platform)}</span>
                      <span>{playlist.trackCount} 首</span>
                      <span>·</span>
                      <span class="truncate">{playlist.id === "pl_collective_favorites" ? "全站成员" : playlist.ownerName || "全站成员"}</span>
                    </div>
                  </div>
                  <span class="px-2 py-0.5 text-[10px] sm:text-[11px] font-medium rounded-full bg-(--primary)/10 text-(--primary) shrink-0">已包含</span>
                </div>
              {:else}
                <p class="text-xs text-[var(--chat-meta-color)] p-4 text-center">暂无公开歌单</p>
              {/each}
            </div>
          {:else}
            <!-- 关闭轮播模式：指引占位 -->
            <div class="flex-1 flex flex-col items-center justify-center text-center p-6 text-[var(--chat-meta-color)] space-y-3">
              <div class="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-(--btn-regular-bg) border border-[var(--chat-divider-color)] flex items-center justify-center text-[var(--chat-meta-color)]">
                <svg class="w-6 h-6 sm:w-7 sm:h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                </svg>
              </div>
              <div class="max-w-xs space-y-1">
                <h5 class="m-0 text-[15px] sm:text-sm font-bold text-[var(--deep-text)]">歌单轮播已关闭</h5>
                <p class="m-0 text-xs leading-relaxed text-[var(--chat-meta-color)]">
                  当前未开启轮播，电台在待播歌曲放完后将自动静止。
                </p>
              </div>
              <button
                type="button"
                class="chat-dialog-action mt-1 px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-(--primary)/30 text-(--primary) hover:bg-(--primary)/10 active:scale-95 transition-all"
                onclick={() => rotationMode = "playlist"}
              >
                开启指定歌单轮播
              </button>
            </div>
          {/if}
        </div>
      </div>

      <!-- 底部操作与状态栏 -->
      <div class="chat-rotation-actions shrink-0 flex items-center justify-between gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 border-t border-[var(--chat-divider-color)] bg-[var(--skin-surface)]">
        <div class="chat-rotation-status min-w-0 flex-1 pr-1 sm:pr-2">
          {#if rotationError}
            <p role="alert" class="m-0 text-xs text-red-500 truncate">{rotationError}</p>
          {:else if rotationMode === "playlist" && validSelectedRotationIds.length === 0}
            <p class="m-0 text-xs text-amber-500 max-md:text-amber-700 max-md:dark:text-amber-400 truncate">⚠️ 请至少勾选一个歌单</p>
          {:else}
            <div class="hidden sm:flex items-center gap-2 text-[11px] text-[var(--chat-meta-color)]">
              <span class="inline-flex items-center gap-1 font-medium text-[var(--deep-text)] shrink-0">
                <svg class="w-3.5 h-3.5 text-amber-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>轮播提示</span>
              </span>
              <span class="truncate">房友点歌优先，点歌时自动切播</span>
            </div>
          {/if}
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button
            type="button"
            class="rounded-lg px-3.5 py-2 text-[13px] border border-[var(--chat-divider-color)] text-[var(--deep-text)] hover:bg-(--btn-plain-bg-hover) active:scale-95 transition-all"
            disabled={rotationSaving}
            onclick={closeRotationSettings}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={rotationSaving || !canSaveRotation}
            class="chat-dialog-primary-action rounded-lg border-none bg-(--primary) px-4 py-2 text-[13px] font-semibold text-white shadow-xs hover:brightness-110 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {rotationSaving ? "保存中..." : "保存设置"}
          </button>
        </div>
      </div>
    </form>
    {/if}
  </ChatModal>

  {#if trackContextMenu}
    {@const ctxTrack = trackContextMenu.track}
    {@const ctxIsFav = isTrackFavorited(ctxTrack)}
    {@const ctxIsQueued = isTrackQueued(ctxTrack)}
    {@const ctxIsCurrent = isTrackCurrent(ctxTrack)}
    <div
      data-track-context-menu
      role="menu"
      aria-label={`歌曲操作：${ctxTrack.title}`}
      class="fixed z-[1200] w-48 rounded-xl border border-[var(--skin-line)]/80 bg-[var(--skin-surface,#ffffff)]/95 backdrop-blur-md shadow-xl p-1.5 text-[13px] text-[var(--deep-text)] select-none"
      style="left: {trackContextMenu.x}px; top: {trackContextMenu.y}px;"
    >
      <div class="px-2.5 py-1.5 mb-1 border-b border-[var(--chat-divider-color)] min-w-0">
        <div class="font-bold text-xs truncate">{ctxTrack.title}</div>
        <div class="text-[11px] text-[var(--chat-meta-color)] truncate">{ctxTrack.artist || "未知歌手"}</div>
      </div>

      {#if onShareTrack}
        <button
          type="button"
          role="menuitem"
          class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left border-none bg-transparent text-inherit hover:bg-(--primary)/12 hover:text-(--primary) cursor-pointer transition-colors"
          onclick={() => {
            const target = ctxTrack;
            closeTrackContextMenu();
            void onShareTrack(target);
          }}
        >
          <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          <span>分享到聊天室</span>
        </button>
      {/if}

      {#if !ctxIsCurrent}
        <button
          type="button"
          role="menuitem"
          class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left border-none bg-transparent text-inherit hover:bg-black/5 dark:hover:bg-white/8 cursor-pointer transition-colors"
          onclick={(e) => {
            const target = ctxTrack;
            closeTrackContextMenu();
            handleToggleQueueTrack(target, e.currentTarget);
          }}
        >
          {#if ctxIsQueued}
            <svg class="w-3.5 h-3.5 shrink-0 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>移出待播队列</span>
          {:else}
            <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>加入待播队列</span>
          {/if}
        </button>
      {/if}

      <button
        type="button"
        role="menuitem"
        class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left border-none bg-transparent text-inherit hover:bg-black/5 dark:hover:bg-white/8 cursor-pointer transition-colors"
        onclick={() => {
          const target = ctxTrack;
          closeTrackContextMenu();
          void handleToggleFavoriteTrack(target);
        }}
      >
        <svg class="w-3.5 h-3.5 shrink-0 {ctxIsFav ? 'text-amber-400' : ''}" viewBox="0 0 24 24" fill={ctxIsFav ? "currentColor" : "none"} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polygon points="12 1.9 14.35 9.15 21.95 9.15 15.8 13.62 18.15 20.87 12 16.39 5.85 20.87 8.2 13.62 2.05 9.15 9.65 9.15" />
        </svg>
        <span>{ctxIsFav ? "取消收藏" : "收藏歌曲"}</span>
      </button>

      <button
        type="button"
        role="menuitem"
        class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left border-none bg-transparent text-inherit hover:bg-black/5 dark:hover:bg-white/8 cursor-pointer transition-colors"
        onclick={() => {
          const target = ctxTrack;
          closeTrackContextMenu();
          void copyTrackInfo(target);
        }}
      >
        <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        <span>复制歌名与歌手</span>
      </button>
    </div>
  {/if}

</aside>
