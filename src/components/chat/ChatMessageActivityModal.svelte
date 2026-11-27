<script lang="ts">
import type { InterconnectSite } from "@/types/chatConfig";
import ChatAvatar from "./ChatAvatar.svelte";
import ChatModal from "./ChatModal.svelte";
import { isExternalMatrixIdentity, resolveExternalOrigin } from "./chatClient";
import {
	type ReactionDisplayInfo,
	resolveReactionDisplay,
} from "./chatReactions";
import type {
	ChatMessageRecord,
	ChatReadReceipt,
	ChatUserDetailProfile,
	ChatUserDetailSeed,
} from "./chatTypes";
import type { StickerItem } from "./stickerLoader";

interface Props {
	open: boolean;
	initialTab?: string;
	message: ChatMessageRecord;
	readReceipts?: ChatReadReceipt[];
	currentUserKey?: string;
	userProfileMap?: Map<string, ChatUserDetailProfile>;
	userNameMap?: Map<string, string>;
	interconnectSites?: InterconnectSite[];
	chatServerUrl?: string;
	stickerMap?: Map<string, StickerItem>;
	onOpenUserProfile?: (seed: ChatUserDetailSeed) => void;
	onClose: () => void;
}

const {
	open,
	initialTab = "read",
	message,
	readReceipts = [],
	currentUserKey = "",
	userProfileMap = new Map(),
	userNameMap = new Map(),
	interconnectSites = [],
	chatServerUrl,
	stickerMap,
	onOpenUserProfile,
	onClose,
}: Props = $props();

interface ActivityUserItem {
	userKey: string;
	displayName: string;
	cleanName: string;
	siteName?: string;
	isMe: boolean;
	seed: ChatUserDetailSeed;
	timeStr?: string;
}

function resolveUserProfileSeed(
	key: string,
	fallbackName?: string,
	fallbackAvatar?: string,
): {
	displayName: string;
	cleanName: string;
	siteName?: string;
	isMe: boolean;
	seed: ChatUserDetailSeed;
} {
	const isMe = Boolean(currentUserKey && key === currentUserKey);
	const profile =
		userProfileMap.get(key) ||
		(key.startsWith("matrix:")
			? userProfileMap.get(key.slice(7))
			: userProfileMap.get(`matrix:${key}`));
	let resolvedFallback = fallbackName || userNameMap.get(key) || "";
	if (!resolvedFallback) {
		if (
			key.startsWith("matrix:") ||
			(key.startsWith("@") && key.includes(":"))
		) {
			const cleanKey = key.replace(/^matrix:/, "");
			const match = cleanKey.match(/^@([^:]+):(.+)$/);
			resolvedFallback = match ? match[1] : cleanKey;
		} else if (key.startsWith("waline:") || key.startsWith("guest:")) {
			resolvedFallback = key.split(":")[1] || key;
		} else {
			resolvedFallback = key;
		}
	}
	const isExt = isExternalMatrixIdentity(key);
	const baseName = profile?.name || resolvedFallback || "成员";
	const origin = isExt
		? resolveExternalOrigin(
				{
					name: baseName,
					userKey: key,
					site: profile?.site,
					siteUrl: profile?.siteUrl,
					url: profile?.url,
				},
				interconnectSites,
			)
		: null;
	const cleanName = origin?.cleanName || baseName;
	const siteName = origin?.siteName || profile?.site;
	const displayName = siteName ? `${cleanName} (${siteName})` : cleanName;

	const seed: ChatUserDetailSeed = profile
		? {
				...profile,
				userKey: profile.userKey || key,
				name: cleanName,
				avatar: profile.avatar || fallbackAvatar,
			}
		: {
				userKey: key,
				name: cleanName,
				avatar: fallbackAvatar,
				authType: isExt
					? undefined
					: key.startsWith("waline:")
						? "waline"
						: key.startsWith("guest:")
							? "guest"
							: undefined,
			};
	return { displayName, cleanName, siteName, isMe, seed };
}

function formatTime(ts?: number): string {
	if (!ts) return "";
	const d = new Date(ts);
	if (Number.isNaN(d.getTime())) return "";
	const now = new Date();
	const isToday =
		d.getFullYear() === now.getFullYear() &&
		d.getMonth() === now.getMonth() &&
		d.getDate() === now.getDate();
	const h = String(d.getHours()).padStart(2, "0");
	const m = String(d.getMinutes()).padStart(2, "0");
	if (isToday) {
		return `${h}:${m}`;
	}
	const mo = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${mo}-${day} ${h}:${m}`;
}

const isSelf = $derived(
	Boolean(currentUserKey && message.userKey === currentUserKey),
);

const resolvedReaders = $derived.by<ActivityUserItem[]>(() => {
	const readers = readReceipts.filter((r) => {
		if (r.userKey === message.userKey) return false;
		if (isSelf && currentUserKey && r.userKey === currentUserKey) return false;
		return true;
	});
	const sorted = [...readers].sort((a, b) => (b.ts || 0) - (a.ts || 0));
	return sorted.map((r) => {
		const res = resolveUserProfileSeed(r.userKey, r.name, r.avatar);
		return {
			userKey: r.userKey,
			displayName: res.displayName,
			cleanName: res.cleanName,
			siteName: res.siteName,
			isMe: res.isMe,
			seed: res.seed,
			timeStr: formatTime(r.ts),
		};
	});
});

const reactionEntries = $derived.by<[string, ActivityUserItem[]][]>(() => {
	const raw = message.reactions || {};
	const entries: [string, ActivityUserItem[]][] = [];
	for (const [emoji, users] of Object.entries(raw)) {
		if (!Array.isArray(users) || users.length === 0) continue;
		const seen = new Set<string>();
		const list: ActivityUserItem[] = [];
		for (const u of users) {
			if (!u || seen.has(u)) continue;
			seen.add(u);
			const res = resolveUserProfileSeed(u);
			list.push({
				userKey: u,
				displayName: res.displayName,
				cleanName: res.cleanName,
				siteName: res.siteName,
				isMe: res.isMe,
				seed: res.seed,
			});
		}
		if (list.length > 0) {
			entries.push([emoji, list]);
		}
	}
	return entries;
});

const availableTabs = $derived.by<
	{ id: string; label: string; count: number; display: ReactionDisplayInfo }[]
>(() => {
	const list: {
		id: string;
		label: string;
		count: number;
		display: ReactionDisplayInfo;
	}[] = [];
	if (resolvedReaders.length > 0) {
		list.push({
			id: "read",
			label: "已读",
			count: resolvedReaders.length,
			display: { type: "text", text: "已读", alt: "已读" },
		});
	}
	for (const [emoji, users] of reactionEntries) {
		const display = resolveReactionDisplay(emoji, chatServerUrl, stickerMap);
		list.push({ id: emoji, label: emoji, count: users.length, display });
	}
	return list;
});

let currentTab = $state("read");

$effect(() => {
	if (
		initialTab &&
		(initialTab === "read" || reactionEntries.some(([e]) => e === initialTab))
	) {
		currentTab = initialTab;
	} else if (
		availableTabs.length > 0 &&
		!availableTabs.some((t) => t.id === currentTab)
	) {
		currentTab = availableTabs[0].id;
	}
});

const activeUsers = $derived.by<ActivityUserItem[]>(() => {
	if (currentTab === "read") return resolvedReaders;
	const match = reactionEntries.find(([e]) => e === currentTab);
	return match ? match[1] : [];
});

const modalTitle = $derived.by(() => {
	if (currentTab === "read") return "已读成员";
	return "表情回应";
});

const modalSubtitle = $derived.by(() => {
	if (currentTab === "read") {
		return `共 ${resolvedReaders.length} 人已读`;
	}
	const matchTab = availableTabs.find((t) => t.id === currentTab);
	if (matchTab?.display.type === "image") {
		return `${matchTab.display.alt} · 共 ${activeUsers.length} 人回应`;
	}
	return `${currentTab} · 共 ${activeUsers.length} 人回应`;
});
</script>

<ChatModal
  open={open}
  title={modalTitle}
  subtitle={modalSubtitle}
  size="sm"
  mobile="compact"
  onClose={onClose}
>
  <div class="chat-activity-modal-content">
    {#if availableTabs.length > 1}
      <div class="chat-activity-tabs custom-scrollbar" role="tablist" aria-label="消息互动标签">
        {#each availableTabs as tab (tab.id)}
          <button
            type="button"
            role="tab"
            aria-selected={currentTab === tab.id}
            class="chat-activity-tab-btn {currentTab === tab.id ? 'is-active' : ''}"
            onclick={() => (currentTab = tab.id)}
            aria-label={tab.display.alt}
          >
            {#if tab.display.type === "image"}
              <img
                src={tab.display.url}
                alt={tab.display.alt}
                class="w-3.5 h-3.5 object-contain inline-block shrink-0 rounded-xs"
                loading="lazy"
                decoding="async"
                onerror={(e) => {
                  const img = e.currentTarget as HTMLImageElement;
                  if (tab.display.fallbackUrl && img.src !== tab.display.fallbackUrl) {
                    img.src = tab.display.fallbackUrl;
                  } else {
                    img.style.display = "none";
                  }
                }}
              />
            {:else}
              <span class="text-xs leading-none">{tab.display.text}</span>
            {/if}
            <span class="chat-activity-tab-count tabular-nums">{tab.count}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="chat-activity-list custom-scrollbar">
      {#if activeUsers.length > 0}
        <div class="space-y-1">
          {#each activeUsers as item (item.userKey)}
            <button
              type="button"
              class="chat-activity-user-row"
              onclick={() => onOpenUserProfile?.(item.seed)}
            >
              <div class="shrink-0">
                <ChatAvatar
                  src={item.seed.avatar}
                  name={item.seed.name}
                  size="sm"
                />
              </div>
              <div class="flex-1 min-w-0 text-left">
                <div class="flex items-center gap-1.5 min-w-0">
                  <span class="chat-activity-user-name text-xs font-semibold text-[var(--skin-text)] truncate">
                    {item.cleanName}
                  </span>
                  {#if item.isMe}
                    <span class="text-[10px] font-semibold text-[var(--skin-accent)] bg-[var(--skin-accent)]/12 px-1 py-0.5 rounded leading-none shrink-0">
                      你
                    </span>
                  {/if}
                  {#if item.siteName}
                    <span class="text-[10px] text-[var(--chat-meta-color)] bg-black/5 dark:bg-white/10 px-1 py-0.5 rounded leading-none shrink-0 truncate max-w-[110px]">
                      {item.siteName}
                    </span>
                  {/if}
                </div>
                {#if item.seed.siteUrl || item.seed.url}
                  <div class="text-[11px] text-[var(--chat-meta-color)] truncate mt-0.5 opacity-80">
                    {item.seed.siteUrl || item.seed.url}
                  </div>
                {/if}
              </div>
              {#if item.timeStr}
                <span class="text-[11px] text-[var(--chat-meta-color)] shrink-0 tabular-nums font-mono opacity-75">
                  {item.timeStr}
                </span>
              {/if}
              <svg class="w-3.5 h-3.5 text-[var(--chat-meta-color)] opacity-40 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          {/each}
        </div>
      {:else}
        <div class="py-8 text-center text-xs text-[var(--chat-meta-color)]">
          暂无成员记录
        </div>
      {/if}
    </div>
  </div>
</ChatModal>
