<script lang="ts">
import { tick } from "svelte";
import type { InterconnectSite } from "@/types/chatConfig";
import ChatMessage from "./ChatMessage.svelte";
import ChatModal from "./ChatModal.svelte";
import { fetchThreadMessages, isMentionedForUser } from "./chatClient";
import {
	deleteChatMentionBeforeCaret,
	getChatMentionQuery,
	insertChatMention,
	readChatComposer,
	trimChatDraft,
	writeChatComposer,
} from "./chatMentions";
import type {
	ChatMentionCandidate,
	ChatMentionEntity,
	ChatMessageRecord,
	ChatReadReceipt,
	ChatSessionUser,
	ChatUserDetailSeed,
	ImageAttachment,
} from "./chatTypes";
import { formatChatReplyPreview, getChatAttachmentKind, type StickerItem } from "./stickerLoader";

interface Props {
	open: boolean;
	roomId: string;
	rootUid: string;
	initialRootMessage?: ChatMessageRecord | null;
	roomMessages: ChatMessageRecord[];
	currentUser: ChatSessionUser | null;
	mentionCandidates: ChatMentionCandidate[];
	formatMentionLabel: (candidate: ChatMentionCandidate) => string;
	isInterconnectRoom?: boolean;
	chatServerUrl?: string;
	interconnectSites?: InterconnectSite[];
	stickerMap: Map<string, StickerItem>;
	userNameMap?: Map<string, string>;
	userProfileMap?: Map<string, ChatUserDetailSeed>;
	readReceipts?: Record<string, ChatReadReceipt[]>;
	clockOffsetMs?: number;
	onClose: () => void;
	onSendMessage: (
		content: string,
		attachments: ImageAttachment[],
		mentionEntities: ChatMentionEntity[],
		replyToUid?: string,
		threadRootUid?: string,
	) => void;
	onEditMessage?: (msgUid: string, content: string, entities: ChatMentionEntity[]) => void;
	onRecallMessage?: (msgUid: string) => void;
	onDeleteMessage: (msgUid: string) => void;
	onReaction?: (msgUid: string, key: string) => void;
	onVotePoll?: (pollUid: string, answerId: string) => void;
	onEndPoll?: (pollUid: string) => void;
	onOpenUserProfile?: (seed: ChatUserDetailSeed) => void;
	onViewSource?: (message: ChatMessageRecord) => void;
	onRequireAuth: () => void;
}

const {
	open,
	roomId,
	rootUid,
	initialRootMessage = null,
	roomMessages,
	currentUser,
	mentionCandidates,
	formatMentionLabel,
	isInterconnectRoom = false,
	chatServerUrl = "",
	interconnectSites = [],
	stickerMap,
	userNameMap = new Map(),
	userProfileMap = new Map(),
	readReceipts = {},
	clockOffsetMs = 0,
	onClose,
	onSendMessage,
	onEditMessage,
	onRecallMessage,
	onDeleteMessage,
	onReaction,
	onVotePoll,
	onEndPoll,
	onOpenUserProfile,
	onViewSource,
	onRequireAuth,
}: Props = $props();

const RECALL_WINDOW_MS = 5 * 60_000;
const EMPTY_RECEIPTS: ChatReadReceipt[] = [];

let fetchedRoot = $state<ChatMessageRecord | null>(null);
let fetchedReplies = $state<ChatMessageRecord[]>([]);
let loading = $state(false);
let loadError = $state("");
let draftText = $state("");
let replyingTarget = $state<ChatMessageRecord | null>(null);
let editingTarget = $state<ChatMessageRecord | null>(null);
let listEl = $state<HTMLDivElement | null>(null);
let composer = $state<HTMLDivElement | null>(null);
let mentionQuery = $state<string | null>(null);
let mentionRange: Range | null = null;
let mentionIndex = $state(-1);
const candidates = $derived(
	mentionQuery === null
		? []
		: mentionCandidates.filter((candidate) =>
				formatMentionLabel(candidate).toLowerCase().includes(mentionQuery!.toLowerCase()) ||
				candidate.userKey.toLowerCase().includes(mentionQuery!.toLowerCase()),
			).slice(0, 20),
);
let fetchSeq = 0;
let lastReplyCount = 0;
let nowMs = $state(Date.now());

$effect(() => {
	if (!open) return;
	nowMs = Date.now();
	const timer = window.setInterval(() => {
		nowMs = Date.now();
	}, 15_000);
	return () => window.clearInterval(timer);
});

async function loadThread(targetRoom: string, targetRootUid: string) {
	const seq = ++fetchSeq;
	loading = true;
	loadError = "";
	if (!chatServerUrl || !targetRootUid) {
		loading = false;
		return;
	}
	try {
		const res = await fetchThreadMessages(
			chatServerUrl,
			targetRoom,
			targetRootUid,
		);
		if (seq !== fetchSeq) return;
		fetchedRoot = res.rootMessage ?? null;
		fetchedReplies = Array.isArray(res.replies) ? res.replies : [];
	} catch (err) {
		if (seq !== fetchSeq) return;
		loadError = err instanceof Error ? err.message : "加载线程回复失败";
	} finally {
		if (seq === fetchSeq) {
			loading = false;
		}
	}
}

$effect(() => {
	if (!open || !rootUid) {
		fetchSeq += 1;
		loading = false;
		loadError = "";
		fetchedRoot = null;
		fetchedReplies = [];
		clearComposer();
		replyingTarget = null;
		editingTarget = null;
		lastReplyCount = 0;
		return;
	}
	fetchedRoot = initialRootMessage ?? null;
	fetchedReplies = [];
	replyingTarget = null;
	editingTarget = null;
	void loadThread(roomId, rootUid);
});

const liveRootMessage = $derived.by<ChatMessageRecord | null>(() => {
	if (!rootUid) return null;
	const fromRoom = roomMessages.find(
		(m) => m.msgUid === rootUid || m.matrixEventId === rootUid,
	);
	return fromRoom ?? fetchedRoot ?? initialRootMessage ?? null;
});

const canonicalRootUid = $derived(liveRootMessage?.msgUid || rootUid || "");
const canonicalRootMatrixId = $derived(
	liveRootMessage?.matrixEventId ||
		(canonicalRootUid.startsWith("$") ? canonicalRootUid : ""),
);

const threadReplies = $derived.by<ChatMessageRecord[]>(() => {
	if (!canonicalRootUid) return [];
	const roomById = new Map<string, ChatMessageRecord>();
	for (const m of roomMessages) {
		roomById.set(m.msgUid, m);
	}
	const matchesRoot = (m: ChatMessageRecord) => {
		if (!m.threadRootUid) return false;
		return (
			m.threadRootUid === canonicalRootUid ||
			m.threadRootUid === rootUid ||
			Boolean(
				canonicalRootMatrixId && m.threadRootUid === canonicalRootMatrixId,
			)
		);
	};

	const merged = new Map<string, ChatMessageRecord>();
	const recalledIds = new Set(
		roomMessages.map((m) => m.recalledMsgUid).filter(Boolean),
	);
	for (const m of fetchedReplies) {
		if (recalledIds.has(m.msgUid)) continue;
		const liveVersion = roomById.get(m.msgUid);
		if (liveVersion) {
			merged.set(m.msgUid, liveVersion);
		} else {
			merged.set(m.msgUid, m);
		}
	}
	for (const m of roomMessages) {
		if (matchesRoot(m)) {
			merged.set(m.msgUid, m);
		}
	}

	return Array.from(merged.values()).sort(
		(a, b) => (a.createdAt || 0) - (b.createdAt || 0),
	);
});

$effect(() => {
	if (!open) return;
	const count = threadReplies.length;
	if (count > lastReplyCount) {
		lastReplyCount = count;
		void tick().then(() => {
			if (listEl) {
				listEl.scrollTop = listEl.scrollHeight;
			}
		});
	} else {
		lastReplyCount = count;
	}
});

function clearComposer() {
	draftText = "";
	mentionQuery = null;
	mentionRange = null;
	composer?.replaceChildren();
}

function syncComposer() {
	if (!composer) return;
	draftText = readChatComposer(composer).content;
	const match = getChatMentionQuery(composer);
	mentionQuery = match?.query ?? null;
	mentionRange = match?.range ?? null;
	mentionIndex = -1;
}

function selectCandidate(candidate: ChatMentionCandidate) {
	if (!composer || !mentionRange) return;
	insertChatMention(composer, formatMentionLabel(candidate), candidate.userKey, mentionRange);
	syncComposer();
}

function handleStartReplyInThread(msg: ChatMessageRecord) {
	if (editingTarget) clearComposer();
	editingTarget = null;
	replyingTarget = msg;
	composer?.focus();
}

function handleStartEditInThread(msg: ChatMessageRecord) {
	replyingTarget = null;
	editingTarget = msg;
	if (!composer) return;
	writeChatComposer(composer, { content: msg.content, mentionEntities: msg.mentionEntities ?? [] });
	composer.focus();
	const selection = window.getSelection();
	selection?.selectAllChildren(composer);
	selection?.collapseToEnd();
	syncComposer();
}

function handleSubmit() {
	if (!composer) return;
	const { content, mentionEntities } = trimChatDraft(readChatComposer(composer));
	if (!content) return;
	if (!currentUser) {
		onRequireAuth();
		return;
	}
	if (editingTarget) {
		onEditMessage?.(editingTarget.msgUid, content, mentionEntities);
		editingTarget = null;
	} else {
		onSendMessage(content, [], mentionEntities, replyingTarget?.msgUid || "", canonicalRootUid);
		replyingTarget = null;
	}
	clearComposer();
}

function handleKeydown(e: KeyboardEvent) {
	if (e.isComposing) return;
	if (e.key === "Backspace" && deleteChatMentionBeforeCaret(composer)) {
		e.preventDefault();
		syncComposer();
		return;
	}
	if (candidates.length && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
		e.preventDefault();
		const direction = e.key === "ArrowUp" ? -1 : 1;
		mentionIndex = mentionIndex < 0 ? 0 : (mentionIndex + direction + candidates.length) % candidates.length;
		return;
	}
	const candidate = candidates[mentionIndex];
	if (candidate && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
		e.preventDefault();
		selectCandidate(candidate);
		return;
	}
	if (mentionQuery !== null && e.key === "Escape") {
		e.preventDefault();
		e.stopPropagation();
		mentionQuery = null;
		mentionRange = null;
		return;
	}
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		handleSubmit();
	}
}

function handlePaste(e: ClipboardEvent) {
	const text = e.clipboardData?.getData("text/plain");
	if (!e.clipboardData) return;
	e.preventDefault();
	const selection = window.getSelection();
	if (!text || !selection?.rangeCount || !composer) return;
	const range = selection.getRangeAt(0);
	if (!composer.contains(range.commonAncestorContainer)) return;
	const node = document.createTextNode(text);
	range.deleteContents();
	range.insertNode(node);
	selection.collapse(node, node.length);
	syncComposer();
}

const serverNow = $derived(nowMs + clockOffsetMs);
const isAdmin = $derived(Boolean(currentUser?.isAdmin));

const threadSubtitle = $derived.by(() => {
	const count = threadReplies.length;
	const proto = isInterconnectRoom ? "Matrix 线程 (m.thread)" : "站内讨论线程";
	return count > 0
		? `${proto} · 共 ${count} 条回复`
		: `${proto} · 发起首条线程回复`;
});
</script>

<ChatModal
  open={open && Boolean(rootUid)}
  title="线程回复"
  mobile="full"
  subtitle={threadSubtitle}
  size="md"
  fillHeightOnDesktop={true}
  onClose={onClose}
>
  <div class="chat-thread-modal-body">
    <div bind:this={listEl} class="chat-thread-scroll custom-scrollbar">
      <!-- 原主题消息 -->
      {#if liveRootMessage}
        {@const rootIsSelf = Boolean(currentUser && liveRootMessage.userKey === currentUser.userKey)}
        <div class="chat-thread-root-card">
          <div class="chat-thread-root-label">
            <svg class="w-3.5 h-3.5 text-[var(--primary)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span>主题原消息</span>
          </div>
          <ChatMessage
            message={liveRootMessage}
            isSelf={rootIsSelf}
            isMentionedMe={isMentionedForUser(liveRootMessage, currentUser)}
            currentUserKey={currentUser?.userKey || ""}
            isAdmin={isAdmin}
            isInterconnectRoom={isInterconnectRoom}
            inThreadView={true}
            canRecall={Boolean(
              currentUser &&
                liveRootMessage.kind === "user" &&
                (isAdmin || (rootIsSelf && serverNow - liveRootMessage.createdAt <= RECALL_WINDOW_MS)),
            )}
            canEdit={Boolean(
              currentUser &&
                liveRootMessage.kind === "user" &&
                (isAdmin || (rootIsSelf && serverNow - liveRootMessage.createdAt <= 15 * 60 * 1000)),
            )}
            canDelete={Boolean(
              currentUser && liveRootMessage.kind === "user" && isAdmin && roomId !== "interconnect",
            )}
            stickerMap={stickerMap}
            chatServerUrl={chatServerUrl}
            interconnectSites={interconnectSites}
            userNameMap={userNameMap}
            userProfileMap={userProfileMap}
            readReceipts={readReceipts[liveRootMessage.msgUid] ?? EMPTY_RECEIPTS}
            onRecall={onRecallMessage}
            onDelete={onDeleteMessage}
            onEdit={handleStartEditInThread}
            onReaction={onReaction}
            onVotePoll={onVotePoll}
            onEndPoll={onEndPoll}
            onOpenUserProfile={onOpenUserProfile}
            onViewSource={onViewSource}
          />
        </div>
      {:else if !loading}
        <div class="chat-thread-root-card text-xs text-[var(--chat-meta-color)] text-center py-3">
          原主题消息不在当前历史缓存中（Event: {rootUid}）
        </div>
      {/if}

      <!-- 分割线 -->
      <div class="chat-thread-divider" role="separator">
        <span class="chat-thread-divider-line"></span>
        <span class="chat-thread-divider-text">
          {#if loading && threadReplies.length === 0}
            加载线程回复中...
          {:else if threadReplies.length > 0}
            {threadReplies.length} 条线程回复
          {:else}
            暂无线程回复，发一条开启讨论吧
          {/if}
        </span>
        <span class="chat-thread-divider-line"></span>
      </div>

      {#if loadError}
        <div class="text-xs text-red-500 text-center py-2 px-3">
          {loadError}
        </div>
      {/if}

      <!-- 线程回复消息列表 -->
      <div class="flex flex-col gap-1.5">
        {#each threadReplies as reply (reply.msgUid)}
          {@const replyIsSelf = Boolean(currentUser && reply.userKey === currentUser.userKey)}
          {@const canRecallReply = Boolean(
            currentUser &&
              reply.kind === "user" &&
              (isAdmin || (replyIsSelf && serverNow - reply.createdAt <= RECALL_WINDOW_MS)),
          )}
          {@const canEditReply = Boolean(
            currentUser &&
              reply.kind === "user" &&
              (isAdmin || (replyIsSelf && serverNow - reply.createdAt <= 15 * 60 * 1000)),
          )}
          {@const canDeleteReply = Boolean(
            currentUser && reply.kind === "user" && isAdmin && roomId !== "interconnect",
          )}
          <ChatMessage
            message={reply}
            isSelf={replyIsSelf}
            isMentionedMe={isMentionedForUser(reply, currentUser)}
            currentUserKey={currentUser?.userKey || ""}
            isAdmin={isAdmin}
            isInterconnectRoom={isInterconnectRoom}
            inThreadView={true}
            canRecall={canRecallReply}
            canEdit={canEditReply}
            canDelete={canDeleteReply}
            stickerMap={stickerMap}
            chatServerUrl={chatServerUrl}
            interconnectSites={interconnectSites}
            userNameMap={userNameMap}
            userProfileMap={userProfileMap}
            readReceipts={readReceipts[reply.msgUid] ?? EMPTY_RECEIPTS}
            onRecall={onRecallMessage}
            onDelete={onDeleteMessage}
            onReply={reply.kind === "user" ? handleStartReplyInThread : undefined}
            onEdit={handleStartEditInThread}
            onReaction={onReaction}
            onVotePoll={onVotePoll}
            onEndPoll={onEndPoll}
            onOpenUserProfile={onOpenUserProfile}
            onViewSource={onViewSource}
          />
        {/each}
      </div>
    </div>

    <!-- 底部线程回复输入框 -->
    <div class="chat-thread-composer">
      {#if editingTarget}
        <div class="chat-thread-composer-banner">
          <span class="truncate">
            正在编辑消息：{editingTarget.content.slice(0, 60)}
          </span>
          <button
            type="button"
            class="chat-thread-banner-close"
            onclick={() => {
              editingTarget = null;
              clearComposer();
            }}
          >
            取消
          </button>
        </div>
      {:else if replyingTarget}
        <div class="chat-thread-composer-banner">
          <span class="truncate">
            回复 {replyingTarget.name}：{formatChatReplyPreview(replyingTarget.content, stickerMap, getChatAttachmentKind(replyingTarget.attachments))}
          </span>
          <button
            type="button"
            class="chat-thread-banner-close"
            onclick={() => (replyingTarget = null)}
          >
            取消
          </button>
        </div>
      {/if}

      {#if currentUser}
        {#if candidates.length}
          <div class="flex flex-wrap gap-1 max-h-24 overflow-auto" aria-label="线程提及候选">
            {#each candidates as candidate, index (candidate.userKey)}
              <button
                type="button"
                class="chat-mention-pill clickable {index === mentionIndex ? 'self' : ''}"
                title={candidate.userKey}
                onpointerdown={(event) => event.preventDefault()}
                onclick={() => selectCandidate(candidate)}
              >
                {formatMentionLabel(candidate)}
                {#if candidates.some((other) => other.userKey !== candidate.userKey && formatMentionLabel(other) === formatMentionLabel(candidate))}
                  <small>({candidate.userKey})</small>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
        <div class="chat-thread-input-row">
          <div
            bind:this={composer}
            contenteditable="true"
            role="textbox"
            tabindex="0"
            aria-label="线程消息"
            aria-multiline="true"
            data-empty={!draftText.trim() ? "true" : undefined}
            data-placeholder={editingTarget ? "修改消息内容，Enter 保存..." : "在此线程中回复，输入 @ 可选人..."}
            class="chat-input-box chat-thread-textarea custom-scrollbar"
            oninput={syncComposer}
            onclick={syncComposer}
            onkeydown={handleKeydown}
            onpaste={handlePaste}
          ></div>
          <button
            type="button"
            class="chat-thread-send-btn"
            disabled={!draftText.trim()}
            onclick={handleSubmit}
          >
            {editingTarget ? "保存" : "发送"}
          </button>
        </div>
      {:else}
        <button
          type="button"
          class="chat-thread-auth-btn"
          onclick={onRequireAuth}
        >
          登录或填写访客昵称后参与线程讨论
        </button>
      {/if}
    </div>
  </div>
</ChatModal>
