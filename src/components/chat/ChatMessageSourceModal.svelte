<script lang="ts">
import ChatModal from "./ChatModal.svelte";
import { fetchMessageSource } from "./chatClient";
import type { ChatMessageRecord, ChatMessageSourceResponse } from "./chatTypes";

interface Props {
	open: boolean;
	message: ChatMessageRecord | null;
	roomId: string;
	isInterconnectRoom?: boolean;
	chatServerUrl?: string;
	onClose: () => void;
	onNotify?: (msg: string, tone?: "default" | "error" | "success") => void;
}

const {
	open,
	message,
	roomId,
	isInterconnectRoom = false,
	chatServerUrl = "",
	onClose,
	onNotify,
}: Props = $props();

type SourceTab = "matrix" | "local";
interface JsonToken {
	type: "key" | "string" | "number" | "boolean" | "null" | "punct" | "plain";
	text: string;
}

let activeTab = $state<SourceTab>("matrix");
let loading = $state(false);
let fetchError = $state("");
let responseData = $state<ChatMessageSourceResponse | null>(null);
let copiedJson = $state(false);
let copiedId = $state(false);
let codeWrapEl = $state<HTMLDivElement | null>(null);
let requestSeq = 0;

$effect(() => {
	void activeTab;
	if (codeWrapEl) {
		codeWrapEl.scrollTop = 0;
	}
});

function formatFullTime(ts?: number): string {
	if (!ts) return "";
	const d = new Date(ts);
	if (Number.isNaN(d.getTime())) return "";
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function tokenizeJson(jsonText: string): JsonToken[] {
	const tokens: JsonToken[] = [];
	const regex =
		/("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|[{}[\],:])/g;
	let lastIndex = 0;
	let match = regex.exec(jsonText);
	while (match !== null) {
		if (match.index > lastIndex) {
			tokens.push({
				type: "plain",
				text: jsonText.slice(lastIndex, match.index),
			});
		}
		const val = match[0];
		if (val.startsWith('"')) {
			if (match[2]) {
				const colonIdx = val.lastIndexOf(":");
				const keyPart = val.slice(0, colonIdx);
				const tailPart = val.slice(colonIdx);
				tokens.push({ type: "key", text: keyPart });
				tokens.push({ type: "punct", text: tailPart });
			} else {
				tokens.push({ type: "string", text: val });
			}
		} else if (val === "true" || val === "false") {
			tokens.push({ type: "boolean", text: val });
		} else if (val === "null") {
			tokens.push({ type: "null", text: val });
		} else if (/^[{}[\],:]$/.test(val)) {
			tokens.push({ type: "punct", text: val });
		} else {
			tokens.push({ type: "number", text: val });
		}
		lastIndex = regex.lastIndex;
		match = regex.exec(jsonText);
	}
	if (lastIndex < jsonText.length) {
		tokens.push({ type: "plain", text: jsonText.slice(lastIndex) });
	}
	return tokens;
}

async function loadSource(targetMsg: ChatMessageRecord, targetRoom: string) {
	const seq = ++requestSeq;
	loading = true;
	fetchError = "";
	responseData = null;
	activeTab = isInterconnectRoom ? "matrix" : "local";

	if (!chatServerUrl) {
		loading = false;
		activeTab = "local";
		return;
	}

	try {
		const res = await fetchMessageSource(
			chatServerUrl,
			targetRoom,
			targetMsg.msgUid,
		);
		if (seq !== requestSeq) return;
		responseData = res;
		if (isInterconnectRoom && res.matrixEvent) {
			activeTab = "matrix";
		} else if (!isInterconnectRoom) {
			activeTab = "local";
		} else if (!res.matrixEvent && res.localRecord) {
			activeTab = "matrix";
		}
	} catch (err) {
		if (seq !== requestSeq) return;
		fetchError = err instanceof Error ? err.message : "拉取原始事件失败";
		activeTab = "local";
	} finally {
		if (seq === requestSeq) {
			loading = false;
		}
	}
}

$effect(() => {
	if (!open || !message) {
		requestSeq += 1;
		loading = false;
		fetchError = "";
		copiedJson = false;
		copiedId = false;
		return;
	}
	void loadSource(message, roomId);
});

const activePayload = $derived.by<Record<string, unknown> | null>(() => {
	if (!message) return null;
	if (activeTab === "matrix") {
		return responseData?.matrixEvent ?? null;
	}
	return (
		responseData?.localRecord ?? (message as unknown as Record<string, unknown>)
	);
});

const formattedJson = $derived.by(() => {
	if (!activePayload) return "";
	try {
		return JSON.stringify(activePayload, null, 2);
	} catch {
		return String(activePayload);
	}
});

const jsonTokens = $derived.by(() =>
	formattedJson ? tokenizeJson(formattedJson) : [],
);

const displayEventId = $derived.by(() => {
	if (!message) return "";
	return (
		responseData?.matrixEventId || message.matrixEventId || message.msgUid || ""
	);
});

const matrixEventType = $derived.by(() => {
	const ev = responseData?.matrixEvent;
	if (!ev || typeof ev.type !== "string") return "";
	return ev.type;
});

const modalSubtitle = $derived.by(() => {
	if (!message) return "";
	const parts: string[] = [];
	if (message.name) parts.push(message.name);
	const ts = formatFullTime(message.createdAt);
	if (ts) parts.push(ts);
	if (matrixEventType) parts.push(matrixEventType);
	return parts.join(" · ");
});

async function handleCopyJson() {
	if (!formattedJson) return;
	try {
		await navigator.clipboard.writeText(formattedJson);
		copiedJson = true;
		onNotify?.("已复制原始 JSON");
		setTimeout(() => {
			copiedJson = false;
		}, 1500);
	} catch {
		onNotify?.("复制失败，请手动选中复制");
	}
}

async function handleCopyEventId() {
	if (!displayEventId) return;
	try {
		await navigator.clipboard.writeText(displayEventId);
		copiedId = true;
		onNotify?.("已复制事件 ID");
		setTimeout(() => {
			copiedId = false;
		}, 1500);
	} catch {
		// ignore
	}
}
</script>

<ChatModal
  open={open && Boolean(message)}
  title="查看消息源码"
  mobile="full"
  subtitle={modalSubtitle}
  size="md"
  topPriority={true}
  onClose={onClose}
>
  <div class="chat-source-modal-body">
    <!-- 顶栏切换与操作区 -->
    <div class="chat-source-toolbar">
      <div class="chat-source-tabs" role="tablist" aria-label="源码来源">
        {#if isInterconnectRoom}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "matrix"}
            class="chat-source-tab {activeTab === 'matrix' ? 'is-active' : ''}"
            onclick={() => (activeTab = "matrix")}
          >
            <span>Matrix 原始事件</span>
            {#if responseData?.matrixEvent}
              <span class="chat-source-tab-dot is-ok"></span>
            {:else if !loading && (responseData?.matrixError || fetchError)}
              <span class="chat-source-tab-dot is-warn"></span>
            {/if}
          </button>
        {/if}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "local"}
          class="chat-source-tab {activeTab === 'local' ? 'is-active' : ''}"
          onclick={() => (activeTab = "local")}
        >
          <span>本站消息记录</span>
        </button>
      </div>

      <div class="flex items-center gap-1.5 shrink-0">
        {#if message && chatServerUrl}
          <button
            type="button"
            class="chat-source-action-btn"
            disabled={loading}
            title="重新拉取原始数据"
            onclick={() => message && void loadSource(message, roomId)}
          >
            <svg
              class="w-3.5 h-3.5 {loading ? 'animate-spin' : ''}"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
            <span class="hidden sm:inline">刷新</span>
          </button>
        {/if}
        <button
          type="button"
          class="chat-source-action-btn {copiedJson ? 'is-copied' : ''}"
          disabled={!formattedJson}
          onclick={handleCopyJson}
        >
          {#if copiedJson}
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>已复制</span>
          {:else}
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
            <span>复制 JSON</span>
          {/if}
        </button>
      </div>
    </div>

    <!-- 事件 ID 信息栏 -->
    {#if displayEventId}
      <div class="chat-source-meta-bar">
        <span class="chat-source-meta-label">
          {responseData?.matrixEventId ? "Event ID" : "Msg UID"}
        </span>
        <button
          type="button"
          class="chat-source-meta-id"
          title="点击复制 ID"
          onclick={handleCopyEventId}
        >
          <span class="truncate">{displayEventId}</span>
          <span class="text-[10px] opacity-70 shrink-0">{copiedId ? "已复制" : "复制"}</span>
        </button>
      </div>
    {/if}

    <!-- JSON 内容区 -->
    <div bind:this={codeWrapEl} class="chat-source-code-wrap custom-scrollbar">
      {#if loading && activeTab === "matrix"}
        <div class="chat-source-empty">
          <span class="inline-block w-4 h-4 rounded-full border-2 border-[var(--primary)] border-t-transparent animate-spin"></span>
          <span>正在从 Matrix 节点拉取原始事件 JSON...</span>
        </div>
      {:else if activeTab === "matrix" && !activePayload}
        <div class="chat-source-empty flex-col gap-2">
          <div class="text-xs font-medium text-[var(--deep-text)] dark:text-white/85">
            {fetchError || responseData?.matrixError || "暂未获取到该消息的 Matrix 原始事件"}
          </div>
          <button
            type="button"
            class="chat-source-action-btn"
            onclick={() => (activeTab = "local")}
          >
            切换到「本站消息记录」查看
          </button>
        </div>
      {:else if formattedJson}
        <pre class="chat-json-pre"><code>{#each jsonTokens as token, i (i)}{#if token.type === "plain"}{token.text}{:else}<span class="chat-json-{token.type}">{token.text}</span>{/if}{/each}</code></pre>
      {:else}
        <div class="chat-source-empty">
          <span>暂无可展示的消息数据</span>
        </div>
      {/if}
    </div>
  </div>
</ChatModal>
