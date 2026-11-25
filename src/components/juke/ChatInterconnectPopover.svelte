<script lang="ts">
import { onMount } from "svelte";
import type { InterconnectSite } from "@/types/chatConfig";
import ChatAvatar from "./ChatAvatar.svelte";
import { positionChatFloating } from "./chatFloating";

interface Props {
	open: boolean;
	sites?: InterconnectSite[];
	onClose: () => void;
}

const { open, sites = [], onClose }: Props = $props();

let popoverEl: HTMLDivElement | null = $state(null);

function getSiteTheme(site: InterconnectSite): string {
	if (site.isSelf) return "var(--primary)";
	return site.color || "var(--primary)";
}

function positionInterconnect(node: HTMLElement) {
	const anchors = node.parentElement?.querySelectorAll<HTMLElement>(
		"[data-chat-interconnect-anchor]",
	);
	const reference =
		anchors &&
		Array.from(anchors).find((anchor) => anchor.getClientRects().length > 0);
	if (!reference) return;
	return positionChatFloating(node, {
		reference,
		placement: "bottom-start",
		onReferenceHidden: onClose,
	});
}

onMount(() => {
	const handlePointerDown = (e: PointerEvent) => {
		if (!open) return;
		const target = e.target as HTMLElement | null;
		if (!target) return;
		if (popoverEl?.contains(target)) return;
		if (
			target.closest(
				"[data-chat-interconnect-trigger], [data-chat-interconnect-anchor]",
			)
		)
			return;
		onClose();
	};

	const handleKeydown = (e: KeyboardEvent) => {
		if (open && e.key === "Escape") {
			onClose();
		}
	};

	document.addEventListener("pointerdown", handlePointerDown);
	document.addEventListener("keydown", handleKeydown);

	return () => {
		document.removeEventListener("pointerdown", handlePointerDown);
		document.removeEventListener("keydown", handleKeydown);
	};
});
</script>

{#if open}
  <div
    data-chat-floating
    bind:this={popoverEl}
    use:positionInterconnect
    class="chat-settings-popover chat-interconnect-popover"
    role="dialog"
    aria-label="互联茶室友站列表"
  >
    <!-- 顶栏标题 -->
    <div class="flex items-center justify-between gap-1.5 pt-3 pb-2 mb-2 border-b border-black/5 dark:border-white/10">
      <div class="flex items-center gap-1.5 font-bold text-sm text-[var(--deep-text)] dark:text-white/90 shrink-0">
        <svg class="w-4 h-4 text-[var(--skin-accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
          <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
          <line x1="6" y1="1" x2="6" y2="4" />
          <line x1="10" y1="1" x2="10" y2="4" />
          <line x1="14" y1="1" x2="14" y2="4" />
        </svg>
        <span>互联茶室</span>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <a
          href="https://app.element.io/"
          target="_blank"
          rel="noopener noreferrer"
          class="btn-regular py-0.5 px-2 rounded-lg text-xs font-medium text-[var(--primary)] hover:bg-[var(--btn-plain-bg-hover)] transition-all inline-flex items-center gap-1 no-underline"
          title="前往 Element 网页端"
        >
          <span>Element</span>
          <svg class="w-3 h-3 shrink-0 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
        <a
          href="https://rainzt.cn/posts/tingyu-tea-room-guide/"
          target="_blank"
          rel="noopener noreferrer"
          class="btn-regular py-0.5 px-2 rounded-lg text-xs font-medium text-[var(--primary)] hover:bg-[var(--btn-plain-bg-hover)] transition-all inline-flex items-center gap-1 no-underline"
          title="查看互联加入指南"
        >
          <span>加入指南</span>
          <svg class="w-3 h-3 shrink-0 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
        <button
          type="button"
          class="w-6 h-6 rounded-md flex items-center justify-center border-none bg-transparent text-[var(--chat-meta-color)] hover:text-[var(--deep-text)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer text-sm"
          aria-label="关闭"
          onclick={onClose}
        >
          ✕
        </button>
      </div>
    </div>

    <!-- 简明说明 -->
    <div class="px-1 text-xs text-[var(--chat-meta-color)] leading-relaxed mb-2.5">
      以下这些博客是和本站聊天互相连通的哦，也可以去他们的小站坐坐：
    </div>

    <!-- 友站卡片列表 -->
    <div class="space-y-1.5 max-h-[60vh] overflow-y-auto custom-scrollbar pr-0.5">
      {#if sites.length === 0}
        <div class="py-6 text-center text-xs text-[var(--chat-meta-color)]">
          暂未配置互联友站，可在内容仓配置中添加~
        </div>
      {:else}
        {#each sites as site (site.url || site.name)}
          {@const href = site.url || ""}
          {@const siteTheme = getSiteTheme(site)}
          {#if href}
            <a
              {href}
              target={site.isSelf ? undefined : "_blank"}
              rel={site.isSelf ? undefined : "noopener noreferrer"}
              class="group interconnect-site-card"
              style="--site-theme: {siteTheme};"
              aria-label={site.isSelf ? "前往本站主页" : `前往 ${site.owner || site.name} 的茶室`}
            >
              <ChatAvatar
                src={site.avatar}
                name={site.owner || site.name}
              />
              <div class="min-w-0 flex-1 flex flex-col justify-center">
                <div class="flex items-center gap-1.5 min-w-0">
                  <span
                    class="font-semibold text-xs text-[var(--deep-text)] dark:text-white/90 truncate group-hover:text-[var(--site-theme)] transition-colors"
                  >
                    {site.name || site.owner}
                  </span>
                  {#if site.isSelf}
                    <span
                      class="shrink-0 text-[10px] font-medium px-1 py-0.2 rounded bg-[var(--skin-accent-soft)] text-[var(--skin-accent)] leading-tight"
                    >
                      本站
                    </span>
                  {/if}
                </div>
                {#if site.desc}
                  <span class="text-[11px] text-[var(--chat-meta-color)] truncate mt-0.5 leading-snug">
                    {site.desc}
                  </span>
                {/if}
              </div>
              <svg class="w-3 h-3 shrink-0 opacity-20 group-hover:opacity-70 transition-opacity text-[var(--site-theme)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          {:else}
            <div
              class="interconnect-site-card"
              style="--site-theme: {siteTheme};"
            >
              <ChatAvatar
                src={site.avatar}
                name={site.owner || site.name}
              />
              <div class="min-w-0 flex-1 flex flex-col justify-center">
                <span class="font-semibold text-xs text-[var(--deep-text)] dark:text-white/90 truncate">
                  {site.name || site.owner}
                </span>
                {#if site.desc}
                  <span class="text-[11px] text-[var(--chat-meta-color)] truncate mt-0.5 leading-snug">
                    {site.desc}
                  </span>
                {/if}
              </div>
            </div>
          {/if}
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
.interconnect-site-card {
	--site-theme-fallback: var(--primary);
	--site-cur: var(--site-theme, var(--site-theme-fallback));
	position: relative;
	border-radius: 0.75rem;
	padding: 0.5rem 0.65rem;
	display: flex;
	align-items: center;
	gap: 0.65rem;
	text-decoration: none;
	color: inherit;
	min-width: 0;
	cursor: pointer;
	border: 1px dashed color-mix(in srgb, var(--site-cur) 38%, rgba(0, 0, 0, 0.12));
	background: color-mix(in srgb, var(--site-cur) 3%, rgba(0, 0, 0, 0.02));
	transition: all 0.18s ease;
}

:global(.dark) .interconnect-site-card {
	border-color: color-mix(in srgb, var(--site-cur) 42%, rgba(255, 255, 255, 0.14));
	background: color-mix(in srgb, var(--site-cur) 4%, rgba(255, 255, 255, 0.02));
}

.interconnect-site-card:hover {
	border-color: color-mix(in srgb, var(--site-cur) 75%, transparent);
	background: color-mix(in srgb, var(--site-cur) 8%, rgba(0, 0, 0, 0.03));
}

:global(.dark) .interconnect-site-card:hover {
	border-color: color-mix(in srgb, var(--site-cur) 80%, transparent);
	background: color-mix(in srgb, var(--site-cur) 9%, rgba(255, 255, 255, 0.04));
}
</style>
