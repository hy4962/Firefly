<script module lang="ts">
import { REACTION_CATEGORY_GROUPS } from "./chatReactions";
import { ALL_LOTTIE_ITEMS, getLottieSpriteStyle } from "./stickerLoader";

const batchSize = 24;
let emojiCount = 0;
const emojiGroups = REACTION_CATEGORY_GROUPS.filter(
	(group) => group.id !== "kaomoji",
).map((group) => {
	const start = emojiCount;
	emojiCount += group.emojis.length;
	return { ...group, start };
});
const lottieItems = ALL_LOTTIE_ITEMS.map((item) => ({
	...item,
	spriteStyle: getLottieSpriteStyle(item.name),
}));
const listSizes = { emoji: emojiCount, lottie: lottieItems.length };
</script>

<script lang="ts">
import { KAOMOJI_PRESETS } from "@/constants/kaomoji";
import { onDestroy, tick, untrack } from "svelte";
import ChatTooltip from "./ChatTooltip.svelte";
import { positionChatFloating } from "./chatFloating";
import LottieSticker, { preloadLottieData } from "./LottieSticker.svelte";
import type { LottieStickerItem, StickerPack } from "./stickerLoader";

interface Props {
	onSelect: (code: string, imageUrl?: string, lottieName?: string) => void;
	onClose: () => void;
	stickerPacks?: StickerPack[];
	chatServerUrl?: string;
	variant: "composer" | "reaction";
	open?: boolean;
}

let {
	onSelect,
	onClose,
	stickerPacks = [],
	chatServerUrl,
	variant,
	open = true,
}: Props = $props();

const orderedStickerPacks = $derived.by(() => {
	return stickerPacks
		.map((pack) => {
			let displayName = pack.name;
			let order = 10;
			if (
				pack.id.includes("/miku") ||
				pack.name === "初音未来" ||
				pack.name === "贴纸"
			) {
				displayName = "初音未来";
				order = 1;
			} else if (pack.id.includes("/qq")) {
				displayName = "QQ表情";
				order = 2;
			} else if (
				pack.id.includes("/bmoji") ||
				pack.name.toLowerCase().includes("bilibili") ||
				pack.name.includes("bmoji")
			) {
				displayName = "B站";
				order = 3;
			} else if (
				pack.id === "rainzt" ||
				pack.name.includes("朝朝听雨") ||
				pack.name.includes("听雨")
			) {
				displayName = "朝朝听雨";
				order = 90;
			} else if (
				pack.id === "xue" ||
				pack.name.includes("雪") ||
				pack.id.includes("yybb")
			) {
				displayName = "艾雪";
				order = 100;
			}
			return {
				...pack,
				displayName,
				order,
			};
		})
		.sort((a, b) => a.order - b.order);
});

const qqStickerPack = $derived(
	orderedStickerPacks.find(
		(p) =>
			p.category === "qq" || p.id.includes("/qq") || p.displayName === "QQ表情",
	),
);

const otherStickerPacks = $derived(
	orderedStickerPacks.filter(
		(p) =>
			p !== qqStickerPack &&
			p.category !== "qq" &&
			!p.id.includes("/qq") &&
			p.displayName !== "QQ表情",
	),
);

const tabs = $derived([
	{ id: "kaomoji", displayName: "颜文字" },
	{ id: "emoji", displayName: "Emoji 表情" },
	...(qqStickerPack ? [qqStickerPack] : []),
	{ id: "lottie", displayName: "动态表情" },
	...otherStickerPacks,
]);

let activeTab = $state<string>("kaomoji");
let visitedTabs = $state(new Set(["kaomoji"]));
let itemCounts = $state({ emoji: batchSize, lottie: batchSize });
let body = $state<HTMLDivElement>();
const tabScrollPositions = new Map<string, number>();

$effect(() => {
	if (!open) return;
	const remaining = untrack(() =>
		["emoji", "lottie"].filter((tab) => !visitedTabs.has(tab)),
	);
	let cancel: (() => void) | undefined;
	function prepareNextTab() {
		const tab = remaining.shift();
		if (!tab) return;
		cancel = schedulePickerIdle(() => {
			if (!visitedTabs.has(tab)) visitedTabs = new Set([...visitedTabs, tab]);
			prepareNextTab();
		});
	}
	prepareNextTab();
	return () => cancel?.();
});

function schedulePickerIdle(task: () => void): () => void {
	if (typeof window.requestIdleCallback === "function") {
		const idle = window.requestIdleCallback(task);
		return () => window.cancelIdleCallback(idle);
	}
	const timeout = window.setTimeout(task, 80);
	return () => window.clearTimeout(timeout);
}

$effect(() => {
	const tab = activeTab;
	if (!open || (tab !== "emoji" && tab !== "lottie")) return;
	const total = listSizes[tab];
	if (untrack(() => itemCounts[tab]) >= total) return;

	function appendItems() {
		itemCounts[tab] = Math.min(itemCounts[tab] + batchSize, total);
		if (itemCounts[tab] < total) frame = requestAnimationFrame(appendItems);
	}

	// Paint the first batch before appending more results.
	let frame = requestAnimationFrame(() => {
		frame = requestAnimationFrame(appendItems);
	});
	return () => cancelAnimationFrame(frame);
});

async function switchTab(tabId: string) {
	if (activeTab === tabId) return;
	if (body) tabScrollPositions.set(activeTab, body.scrollTop);
	activeTab = tabId;
	if (!visitedTabs.has(tabId)) visitedTabs = new Set([...visitedTabs, tabId]);
	onLottieItemLeave();
	await tick();
	if (activeTab === tabId && body) {
		body.scrollTop = tabScrollPositions.get(tabId) ?? 0;
	}
}

// 动态表情（Lottie）悬浮大图预览处理
let hoveredLottieItem = $state<LottieStickerItem | null>(null);
let hoveredLottieEl = $state<HTMLElement | null>(null);
let pendingLottieEl: HTMLElement | null = null;
let hoverLottieTimer: number | undefined;
let lastScroll = -Infinity;

$effect(() => {
	if (!open) onLottieItemLeave();
});

$effect(() => {
	if (!open || activeTab !== "lottie") return;
	const serverUrl = chatServerUrl;
	return schedulePickerIdle(() => {
		for (const item of lottieItems.slice(0, 4)) {
			void preloadLottieData(item.name, serverUrl).catch(() => {});
		}
	});
});

onDestroy(() => {
	if (hoverLottieTimer !== undefined) window.clearTimeout(hoverLottieTimer);
});

function handleScroll() {
	lastScroll = performance.now();
	onLottieItemLeave();
}

function onLottieItemHover(item: LottieStickerItem, event: PointerEvent) {
	const el = event.currentTarget;
	if (
		event.pointerType !== "mouse" ||
		!(el instanceof HTMLElement) ||
		pendingLottieEl === el ||
		performance.now() - lastScroll < 120
	) {
		return;
	}

	onLottieItemLeave();
	pendingLottieEl = el;
	hoverLottieTimer = window.setTimeout(() => {
		void preloadLottieData(item.name, chatServerUrl).catch(() => {});
		hoveredLottieItem = item;
		hoveredLottieEl = el;
	}, 120);
}

function onLottieItemLeave() {
	window.clearTimeout(hoverLottieTimer);
	pendingLottieEl = null;
	hoveredLottieItem = null;
	hoveredLottieEl = null;
}

function handleSelect(code: string, imageUrl?: string, lottieName?: string) {
	onLottieItemLeave();
	onSelect(code, imageUrl, lottieName);
}
</script>

<div
  class="chat-picker-content"
  role="dialog"
  tabindex="-1"
  aria-label={variant === "composer" ? "颜文字与表情贴纸" : "选择表情回应"}
  onclick={(e) => e.stopPropagation()}
  onkeydown={(e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  }}
>
  <div class="chat-picker-body custom-scrollbar" bind:this={body} onscroll={handleScroll}>
    <!-- 经典高频与分类通用 Emoji -->
    {#if visitedTabs.has("emoji")}
      <div class="chat-picker-pane" style:display={activeTab === "emoji" ? "block" : "none"}>
        <div class="space-y-3">
          {#each emojiGroups as group (group.id)}
            {#if group.start < itemCounts.emoji}
              <div>
                <div class="text-[11px] font-semibold text-[var(--chat-meta-color)] mb-1.5 px-0.5 flex items-center gap-1">
                  <span>{group.icon}</span>
                  <span>{group.title}</span>
                </div>
                <div class="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1">
                  {#each group.emojis.slice(0, itemCounts.emoji - group.start) as em (em)}
                    <button
                      type="button"
                      class="chat-quick-reaction-btn size-9! text-xl! hover:bg-[var(--btn-plain-bg-hover)] rounded-lg transition-transform hover:scale-125"
                      onclick={() => handleSelect(em)}
                      title={em}
                    >
                      {em}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
          {/each}
        </div>
      </div>
    {/if}

    <!-- 颜文字 -->
    {#if visitedTabs.has("kaomoji")}
      <div class="chat-picker-pane" style:display={activeTab === "kaomoji" ? "block" : "none"}>
        <div class="space-y-2.5">
          {#each KAOMOJI_PRESETS as group (group.name)}
            <div>
              <div class="text-[11px] font-semibold text-[var(--chat-meta-color)] mb-1 px-0.5">
                {group.name}
              </div>
              <div class="flex flex-wrap gap-1">
                {#each group.items as kaomoji (kaomoji)}
                  <button
                    type="button"
                    class="chat-kaomoji-item"
                    onclick={() => handleSelect(kaomoji)}
                  >
                    {kaomoji}
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- 3. QQ 表情 Tab 面板 -->
    {#if qqStickerPack && visitedTabs.has(qqStickerPack.id)}
      <div class="chat-picker-pane" style:display={activeTab === qqStickerPack.id ? "block" : "none"}>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(2rem,1fr))] gap-1">
          {#each qqStickerPack.items as item (item.code)}
            <button
              type="button"
              class="chat-sticker-btn chat-sticker-btn--emoji"
              aria-label={item.name}
              title={item.name}
              onclick={() => handleSelect(item.code, item.url)}
            >
              <img
                src={item.url}
                alt={item.name}
                loading="lazy"
                decoding="async"
                class="w-6 h-6 object-contain pointer-events-none"
              />
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- 4. 动态表情 Tab 面板（Lottie，菜狗、QQ超级表情等） -->
    {#if visitedTabs.has("lottie")}
      <div class="chat-picker-pane" style:display={activeTab === "lottie" ? "block" : "none"}>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] gap-1.5">
          {#each lottieItems.slice(0, itemCounts.lottie) as item (item.name)}
            <button
              type="button"
              class="chat-lottie-btn min-w-0 p-1 rounded-lg hover:bg-[var(--btn-plain-bg-hover)] hover:scale-110 active:scale-95 flex flex-col items-center justify-center gap-0.5 group"
              aria-label={item.label}
              onpointerenter={(event) => onLottieItemHover(item, event)}
              onpointermove={(event) => onLottieItemHover(item, event)}
              onpointerleave={onLottieItemLeave}
              onclick={() => handleSelect(item.token, undefined, item.name)}
            >
              <span
                class="w-8 max-w-full aspect-square block rounded-md pointer-events-none"
                style={item.spriteStyle}
              ></span>
              <span class="text-[10px] text-[var(--chat-meta-color)] group-hover:text-[var(--primary)] truncate max-w-full leading-none">
                {item.label}
              </span>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- 5. 各类贴纸包 Tab 面板（初音未来、B站、朝朝听雨、艾雪等） -->
    {#each otherStickerPacks as pack (pack.id)}
      {#if visitedTabs.has(pack.id)}
        {@const isStickerPack = pack.category === "sticker"}
        <div class="chat-picker-pane" style:display={activeTab === pack.id ? "block" : "none"}>
          <div class={isStickerPack ? "grid grid-cols-7 gap-[8px]" : "grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1"}>
            {#each pack.items as item (item.code)}
              <button
                type="button"
                class="chat-sticker-btn {isStickerPack ? 'chat-sticker-btn--sticker p-1!' : 'chat-sticker-btn--emoji'}"
                aria-label={item.name}
                title={item.name}
                onclick={() => handleSelect(item.code, item.url)}
              >
                <img
                  src={item.url}
                  alt={item.name}
                  loading="lazy"
                  decoding="async"
                  class={isStickerPack
                    ? "w-full aspect-square object-contain pointer-events-none"
                    : "w-7 h-7 object-contain pointer-events-none"}
                />
              </button>
            {/each}
          </div>
        </div>
      {/if}
    {/each}
  </div>

  <!-- 动态表情悬浮卡片 -->
  {#if open && hoveredLottieItem && hoveredLottieEl}
    <div
      data-chat-floating
      use:positionChatFloating={{
        reference: hoveredLottieEl,
        placement: "top",
        gap: 8,
        strategy: "fixed",
        fitViewport: true,
      }}
      class="chat-lottie-hover-preview"
    >
      <div class="chat-lottie-hover-card">
        <div class="chat-lottie-hover-media">
          <LottieSticker
            name={hoveredLottieItem.name}
            alt={hoveredLottieItem.label}
            chatServerUrl={chatServerUrl}
            className="w-full h-full flex items-center justify-center"
          />
        </div>
        <div class="chat-lottie-hover-title">
          {hoveredLottieItem.label}
        </div>
      </div>
    </div>
  {/if}

  <div class="chat-picker-tabs custom-scrollbar" role="tablist" aria-label="表情分类">
    {#each tabs as tab (tab.id)}
      <ChatTooltip text={tab.displayName} position="bottom" strategy="fixed" class="shrink-0">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          class="chat-picker-tab {activeTab === tab.id ? 'active' : ''}"
          aria-label={tab.displayName}
          onclick={() => switchTab(tab.id)}
        >
          {#if "iconUrl" in tab}
            <img src={tab.iconUrl} alt="" class="w-5 h-5 object-contain" />
          {:else if tab.id === "kaomoji"}
            <span class="font-bold text-xs leading-none">OωO</span>
          {:else if tab.id === "emoji"}
            <span class="text-sm leading-none">😄</span>
          {:else}
            <span class="w-5 h-5 block rounded-xs pointer-events-none" style={getLottieSpriteStyle("caigou")}></span>
          {/if}
        </button>
      </ChatTooltip>
    {/each}
  </div>
</div>
