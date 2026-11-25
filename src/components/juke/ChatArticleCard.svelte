<script lang="ts">
import type {
	ChatArticleShareData,
	ChatMomentShareData,
} from "./chatShareProtocol";

interface Props {
	data: ChatArticleShareData | ChatMomentShareData;
	isSelf?: boolean;
}

const { data, isSelf = false }: Props = $props();

let coverFailed = $state(false);

const title = $derived(
	data.kind === "article" ? data.title || "未命名文章" : data.date || "动态分享",
);

const excerpt = $derived(
	data.kind === "article" ? data.description : data.content,
);

const badgeLabel = $derived(
	data.kind === "article" ? "文章分享" : "动态分享",
);

const hasCover = $derived(Boolean(data.cover && !coverFailed));
</script>

<a
  href={data.url}
  target="_blank"
  rel="noopener noreferrer"
  class="chat-article-card block select-none overflow-hidden rounded-2xl border transition-all duration-200 min-w-[240px] max-w-[380px] w-full text-left {isSelf ? 'chat-article-card--self' : 'chat-article-card--peer'}"
  aria-label={`${badgeLabel}：${title}`}
>
  {#if hasCover}
    <div class="chat-article-cover relative w-full aspect-2/1 overflow-hidden bg-[var(--btn-plain-bg-hover)] shrink-0">
      <img
        src={data.cover}
        alt=""
        loading="lazy"
        decoding="async"
        class="chat-article-cover-img w-full h-full object-cover block"
        onerror={() => {
          coverFailed = true;
        }}
      />
      <div class="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent pointer-events-none opacity-60"></div>
    </div>
  {/if}

  <div class="chat-article-body p-3.5 flex flex-col gap-1.5 min-w-0">
    <div class="flex items-center gap-1.5 min-w-0">
      <span
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold tracking-wide shrink-0 {data.kind === 'article'
          ? 'bg-[var(--primary)]/15 text-[var(--primary)]'
          : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'}"
      >
        {#if data.kind === "article"}
          <svg class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        {:else}
          <svg class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
          </svg>
        {/if}
        <span>{badgeLabel}</span>
      </span>

      {#if data.host}
        <span class="chat-article-host text-[11px] truncate font-medium ml-auto opacity-75">
          {data.host}
        </span>
      {/if}
    </div>

    <strong class="chat-article-title text-sm md:text-[14.5px] font-bold leading-snug line-clamp-2 transition-colors">
      {title}
    </strong>

    {#if excerpt}
      <p class="chat-article-excerpt text-xs line-clamp-3 leading-relaxed m-0 break-words opacity-90">
        {excerpt}
      </p>
    {/if}
  </div>
</a>

<style>
  .chat-article-card,
  .chat-article-card:hover,
  .chat-article-card:focus,
  .chat-article-card:visited,
  .chat-article-card:active {
    text-decoration: none !important;
  }

  /* 彻底消除任何继承的下划线 */
  .chat-article-card :global(*) {
    text-decoration: none !important;
  }

  .chat-article-card {
    background-color: var(--skin-surface, #ffffff) !important;
    border: 1px solid var(--skin-line, rgba(0, 0, 0, 0.12));
    box-shadow: 0 4px 16px -2px rgba(0, 0, 0, 0.06);
    color: var(--skin-text);
    /* 彻底杜绝卡片自身位移移动 */
    transform: none !important;
  }

  .chat-article-card:hover {
    border-color: var(--primary);
    box-shadow: 0 8px 24px -4px rgba(var(--primary-rgb, 100, 100, 100), 0.18);
    /* 确保悬停时不产生任何位移 */
    transform: none !important;
  }

  /* 封面图片平滑缩放动效（鼠标悬停平滑放大，移开立即缩回） */
  .chat-article-cover-img {
    transform: scale(1);
    transform-origin: center center;
    transition: transform 300ms cubic-bezier(0.2, 0, 0, 1);
    will-change: transform;
  }

  .chat-article-card:hover .chat-article-cover-img {
    transform: scale(1.06);
  }

  .chat-article-title {
    color: var(--skin-text);
  }

  .chat-article-card:hover .chat-article-title {
    color: var(--primary);
  }

  .chat-article-excerpt,
  .chat-article-host {
    color: var(--chat-meta-color);
  }

  :global(.dark) .chat-article-card {
    background-color: var(--skin-surface, #1e1e20) !important;
    border: 1px solid var(--skin-line, rgba(255, 255, 255, 0.12));
    box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.35);
  }

  :global(.dark) .chat-article-card:hover {
    box-shadow: 0 8px 28px -4px rgba(var(--primary-rgb, 100, 100, 100), 0.3);
  }
</style>
