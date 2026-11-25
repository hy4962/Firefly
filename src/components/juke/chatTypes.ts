import type { ChatMusicTrack } from "./musicTypes";

export type BadgeType = "host" | "accent" | "tag";
export type ChatPresenceMode = "local" | "matrix" | "fallback" | "offline";

export interface ChatCustomBadge {
	text: string;
	color: "gold" | "gray";
}

export const CHAT_STATUS_PRESETS = [
	"听歌中",
	"摸鱼中",
	"写代码",
	"改Bug中",
	"学习中",
	"工作中",
	"忙碌中",
	"开会中",
	"码字中",
	"思考中",
	"游戏中",
	"看番中",
	"追剧中",
	"刷视频",
	"冲浪中",
	"潜水中",
	"喝咖啡",
	"喝茶中",
	"干饭中",
	"去散步",
	"发呆中",
	"想静静",
	"困困的",
	"熬夜中",
	"挂机中",
	"闭关中",
	"充电中",
	"元气满满",
	"emo中",
	"勿扰中",
] as const;

export type ChatStatusPreset = (typeof CHAT_STATUS_PRESETS)[number];

export type ChatDesktopNotificationMode = "all" | "mention" | "off";

export interface ChatSessionUser {
	userKey: string;
	authType: "waline" | "guest";
	name: string;
	avatar: string;
	url: string;
	site?: string;
	siteUrl?: string;
	badge: string;
	badgeType: BadgeType;
	customBadges?: ChatCustomBadge[];
	isAdmin: boolean;
	isolated?: boolean;
	status?: string;
	bio?: string;
	location?: string;
	notifyEmail?: boolean;
	email?: string;
	matrixUser?: string | null;
	matrixId?: string | null;
	matrixServer?: string | null;
}

export interface ChatProfileDraft {
	nickname: string;
	badge: string;
	status: string;
	bio?: string;
	url: string;
	avatar?: string;
	notifyEmail?: boolean;
}

export interface ChatOnlineMember extends ChatSessionUser {
	/** 该成员当前所在的聊天房间 id（全局在线时用于展示“在哪个房间”） */
	roomId?: string;
	status: string;
	bio?: string;
	location?: string;
	device?: string;
	connectedAt?: number;
	isMuted?: boolean;
	/** 浏览器/窗口是否处于焦点中（离开焦点或切出页面时为 false） */
	isFocused?: boolean;
	/** 在线检测来源（local=本站实时WS，matrix=对方站点正规Matrix状态，fallback=未上报在线状态仅依据近期发言兜底） */
	presenceMode?: ChatPresenceMode;
	site?: string;
	siteUrl?: string;
	visitCount?: number;
	firstSeenAt?: number;
	totalDurationSec?: number;
	totalDurationFormatted?: string;
	isReturning?: boolean;
}

export interface ChatUserDetailSeed {
	userKey: string;
	authType?: "waline" | "guest";
	name: string;
	avatar?: string;
	url?: string;
	badge?: string;
	badgeType?: BadgeType;
	customBadges?: ChatCustomBadge[];
	isAdmin?: boolean;
	online?: boolean;
	status?: string;
	bio?: string;
	location?: string;
	roomId?: string;
	device?: string;
	connectedAt?: number;
	isFocused?: boolean;
	presenceMode?: ChatPresenceMode;
	site?: string;
	siteUrl?: string;
	isMuted?: boolean;
	disconnectedAt?: number;
	durationFormatted?: string;
	roomsVisited?: string[];
	visitCount?: number;
	totalVisits?: number;
	firstSeenAt?: number;
	totalDurationSec?: number;
	totalDurationFormatted?: string;
	matrixUser?: string | null;
	matrixId?: string | null;
	matrixServer?: string | null;
}

export interface ChatUserRequestedTrackItem {
	logId?: number;
	track: ChatMusicTrack;
	requestedAt: number;
	requestCount: number;
}

export interface ChatUserTracksPage {
	items: ChatUserRequestedTrackItem[];
	hasMore: boolean;
	nextBeforeId: number;
}

export interface ChatUserTopTrackItem {
	track: ChatMusicTrack;
	requestCount: number;
	lastRequestedAt: number;
}

export interface ChatUserTopArtistItem {
	artist: string;
	count: number;
}

export interface ChatUserRecentMessage {
	msgUid: string;
	content: string;
	hasImage: boolean;
	createdAt: number;
}

export interface ChatUserDetailProfile {
	userKey: string;
	authType: "waline" | "guest";
	name: string;
	avatar: string;
	url: string;
	site?: string;
	siteUrl?: string;
	badge: string;
	badgeType: BadgeType;
	customBadges?: ChatCustomBadge[];
	isAdmin: boolean;
	online: boolean;
	isFocused?: boolean;
	presenceMode?: ChatPresenceMode;
	status: string;
	bio: string;
	location?: string;
	firstSeenAt: number;
	lastSeenAt: number;
	stats: {
		messageCount: number;
		songRequestCount: number;
	};
	recentTracks: ChatUserRequestedTrackItem[];
	tracksHasMore?: boolean;
	tracksNextBeforeId?: number;
	topTracks?: ChatUserTopTrackItem[];
	topArtists?: ChatUserTopArtistItem[];
	recentMessages?: ChatUserRecentMessage[];
	playlists: Array<{
		id: string;
		title: string;
		platform: string;
		coverUrl: string;
		trackCount: number;
	}>;
	matrixUser?: string | null;
	matrixId?: string | null;
	matrixServer?: string | null;
}

export interface ChatMentionCandidate {
	userKey: string;
	authType: "waline" | "guest";
	name: string;
	avatar: string;
	url?: string;
	badge: string;
	badgeType: BadgeType;
	customBadges?: ChatCustomBadge[];
	isAdmin: boolean;
	online: boolean;
	connectedAt?: number;
	isFocused?: boolean;
	presenceMode?: ChatPresenceMode;
	site?: string;
	siteUrl?: string;
	status?: string;
	bio?: string;
	location?: string;
	lastSeenAt: number;
	matrixUser?: string | null;
	matrixId?: string | null;
	matrixServer?: string | null;
}

export interface ImageAttachment {
	type: "image" | "audio" | "video" | "file";
	url: string;
	thumbnailUrl?: string;
	name?: string;
	duration?: number;
	size?: number;
	width?: number;
	height?: number;
	isSticker?: boolean;
}

export type ChatAttachment = ImageAttachment;
export type ChatAttachmentKind =
	| ImageAttachment["type"]
	| "sticker"
	| "attachment";

export interface ChatPollAnswer {
	id: string;
	text: string;
}

export interface ChatPollData {
	question: string;
	answers: ChatPollAnswer[];
	maxSelections: number;
	votes: Record<string, string[]>;
	ended?: boolean;
}

export interface ChatReplyRef {
	msgUid: string;
	userKey: string;
	name: string;
	content: string;
	attachmentKind?: ChatAttachmentKind | null;
	hasImage?: boolean;
	isRecalled?: boolean;
}

export interface ChatThreadParticipant {
	userKey: string;
	name: string;
	avatar: string;
}

export interface ChatThreadSummary {
	count: number;
	latestReply: {
		msgUid: string;
		userKey: string;
		name: string;
		avatar: string;
		content: string;
		attachmentKind?: ChatAttachmentKind | null;
		hasImage?: boolean;
		createdAt: number;
	} | null;
	participants: ChatThreadParticipant[];
}

export interface ChatActiveThreadItem {
	rootUid: string;
	rootMessage: ChatMessageRecord | null;
	summary: ChatThreadSummary;
}

export interface ChatMessageSourceResponse {
	ok: boolean;
	room: string;
	msgUid: string;
	matrixEventId?: string | null;
	localRecord?: Record<string, unknown> | null;
	matrixEvent?: Record<string, unknown> | null;
	matrixError?: string | null;
	error?: string;
}

export interface ChatReadReceipt {
	userKey: string;
	name: string;
	avatar?: string;
	msgUid: string;
	ts: number;
}

/** One occurrence in content. Offsets and lengths count UTF-16 code units. */
export interface ChatMentionEntity {
	offset: number;
	length: number;
	userKey: string;
}

export interface ChatMessageRecord {
	source?: "matrix";
	id: number;
	msgUid: string;
	recalledMsgUid?: string;
	matrixEventId?: string;
	kind: "user" | "system" | "poll";
	msgType?: "text" | "emote" | "notice";
	isEncryptedPlaceholder?: boolean;
	userKey: string;
	name: string;
	avatar: string;
	url: string;
	site?: string;
	siteUrl?: string;
	badge: string;
	badgeType: BadgeType;
	customBadges?: ChatCustomBadge[];
	isAdmin: boolean;
	content: string;
	attachments: ImageAttachment[];
	inlineImageDimensions?: Record<string, { width: number; height: number }>;
	mentionKeys?: string[];
	mentionEntities?: ChatMentionEntity[];
	replyTo?: ChatReplyRef | null;
	threadRootUid?: string;
	threadSummary?: ChatThreadSummary | null;
	createdAt: number;
	reactions?: Record<string, string[]>;
	isEdited?: boolean;
	editedAt?: number;
	poll?: ChatPollData;
	isPinned?: boolean;
}

export interface QueueEntry {
	uid: string;
	playVotes?: string[];
	track: ChatMusicTrack;
	requesterKey: string;
	requesterName: string;
	createdAt: number;
}

export interface MusicHistoryEntry {
	track: ChatMusicTrack;
	requestCount: number;
	lastRequesterName: string;
	firstRequestedAt: number;
	lastRequestedAt: number;
	isRotation?: boolean;
}

export interface FetchMusicHistoryParams {
	roomId?: string;
	type?: "all" | "request" | "rotation";
	sort?: "recent" | "count";
	requesterKey?: string;
	offset?: number;
	limit?: number;
}

export interface FetchMusicHistoryResponse {
	ok: boolean;
	type: "all" | "request" | "rotation";
	total: number;
	offset: number;
	limit: number;
	hasMore: boolean;
	items: MusicHistoryEntry[];
	error?: string;
}

export interface MusicHistoryLogEntry {
	id: number;
	outcome?: "queued" | "played" | "unavailable" | "cancelled";
	track: ChatMusicTrack;
	requesterKey: string;
	requesterName: string;
	requesterAvatar: string;
	requestedAt: number;
	requestCount: number;
}

export interface CurrentPlayback {
	uid: string;
	track: ChatMusicTrack & {
		streamUrl: string;
		lrcUrl: string;
		proxyUrl?: string;
		directUrl?: string;
	};
	requesterKey: string;
	requesterName: string;
	isFallback: boolean;
	selectionStartedAt?: number;
	startedAt: number;
	durationSec: number;
	skipVotes: string[];
	sourceRevision?: number;
	phase?: "transitioning" | "preparing" | "scheduled" | "playing";
}

export interface RotationQueueItem {
	id: string;
	entryId?: string;
	sourcePlatform?: string;
	sourceTrackId?: string;
	title: string;
	artist: string;
	album?: string;
	durationSec?: number;
	pic?: string;
	sourcePlaylistTitle?: string;
	sourcePlaylistId?: string;
	sourcePlaylistCover?: string;
}

export interface RotationOffer {
	token: string;
	expiresAt: number;
	choices: {
		track: ChatMusicTrack;
		relation: "same_artist_version" | "same_title" | "same_artist_other";
	}[];
}

export interface RotationAction {
	entryId: string;
	pending?: boolean;
	code?: string;
	message?: string;
	offer?: RotationOffer;
}

export interface RoomMusicState {
	protocolVersion?: number;
	stateVersion?: number;
	next?: CurrentPlayback | null;
	current: CurrentPlayback | null;
	queue: QueueEntry[];
	rotationQueue?: RotationQueueItem[];
	rotationDeckTotal?: number;
	rotationPoolTotal?: number;
	fallbackPlaylistName?: string;
	fallbackPlaylistId?: string | null;
	history?: MusicHistoryEntry[];
	historyLogs?: MusicHistoryLogEntry[];
	requesterOnline: boolean;
	voteCount: number;
	voteThreshold: number;
	skipVoteNames?: string[];
	soloCooldownUntil?: number;
	serverTime: number;
}

export type ConnectionState =
	| "idle"
	| "connecting"
	| "connected"
	| "reconnecting"
	| "offline";

export interface FavoriteUserItem {
	userKey: string;
	userName: string;
	userAvatar?: string;
	createdAt?: number;
	trackCount?: number;
}

export interface FavoriteTrackStatusResponse {
	ok: boolean;
	isFavorited: boolean;
	favCount: number;
	favoritedUsers: FavoriteUserItem[];
	error?: string;
}

export interface ToggleFavoriteResponse {
	ok: boolean;
	favorited: boolean;
	favCount: number;
	favoritedUsers: FavoriteUserItem[];
	track: ChatMusicTrack;
	error?: string;
}

export interface CollectiveFavoritesResponse {
	ok: boolean;
	total: number;
	offset: number;
	limit: number;
	items: Array<
		ChatMusicTrack & {
			favCount: number;
			lastFavoritedAt: number;
			favoritedUsers: FavoriteUserItem[];
		}
	>;
	favoriters?: FavoriteUserItem[];
	error?: string;
}

export interface UserFavoritesResponse {
	ok: boolean;
	total: number;
	offset: number;
	limit: number;
	items: Array<ChatMusicTrack & { favoritedAt: number }>;
	error?: string;
}

export interface PlaylistSummary {
	id: string;
	ownerKey: string;
	ownerName: string;
	ownerAvatar?: string;
	title: string;
	subtitle?: string;
	platform: string;
	sourceUrl: string;
	coverUrl: string;
	creator: string;
	trackCount: number;
	retrievalMode: "full" | "preview";
	isPublic: boolean;
	isFeatured: boolean;
	isFallback: boolean;
	isSystemProtected?: boolean;
	createdAt: number;
	updatedAt: number;
}

export interface PlaylistTrackItem {
	position: number;
	sourcePlatform: string;
	sourceTrackId: string;
	isrc?: string;
	title: string;
	artist: string;
	album: string;
	cover: string;
	durationSec: number;
	sourceUrl: string;
	matchedTrack: ChatMusicTrack | null;
	favCount?: number;
	lastFavoritedAt?: number;
	favoritedUsers?: FavoriteUserItem[];
}

export interface PlaylistDetail extends PlaylistSummary {
	tracks: PlaylistTrackItem[];
	favoriters?: FavoriteUserItem[];
}

export type RoomRotation =
	| { mode: "off" }
	| { mode: "all" }
	| { mode: "playlist"; playlistIds: string[]; playlistId?: string };

export interface PlaylistsResponse {
	rotation?: RoomRotation;
	featured: PlaylistSummary[];
	mine: PlaylistSummary[];
	members: PlaylistSummary[];
	details?: Record<string, PlaylistDetail>;
}

export interface PlaylistImportTrackInput {
	sourcePlatform: string;
	sourceTrackId: string;
	isrc?: string;
	title: string;
	artist: string;
	album: string;
	cover: string;
	durationSec: number;
	sourceUrl: string;
}

export interface PlaylistImportPayload {
	title: string;
	platform: string;
	sourceUrl: string;
	coverUrl: string;
	creator: string;
	retrievalMode: "full" | "preview";
	tracks: PlaylistImportTrackInput[];
}

export interface ChatSpectatorRecord {
	id: string;
	visitorKey?: string;
	ip?: string;
	location?: string;
	os?: string;
	connectedAt: number;
	connectedTime?: string;
	disconnectedAt?: number;
	durationSec: number;
	durationFormatted: string;
	visitCount?: number;
	totalVisits?: number;
	firstSeenAt?: number;
	totalDurationSec?: number;
	totalDurationFormatted?: string;
	roomsVisited?: string[];
	lastRoom?: string;
	listenedMusic?: boolean;
	userAgent?: string;
}
