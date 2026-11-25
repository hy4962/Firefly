<script lang="ts">
import ChatModal from "./ChatModal.svelte";
import {
	formatLxArticleShare,
	formatLxMomentShare,
} from "./chatShareProtocol";

interface Props {
	open: boolean;
	onClose: () => void;
	onShare: (content: string) => void;
}

const { open, onClose, onShare }: Props = $props();

interface ArticleItem {
	id: string;
	title: string;
	description: string;
	published: number;
	publishedDate: string;
	category?: string;
	image?: string;
	url: string;
}

interface MomentItem {
	id: string;
	published: number;
	html: string;
	images: Array<{ src: string; alt?: string }>;
	searchText: string;
	dateStr: string;
	relativeTime: string;
}

let activeTab = $state<"articles" | "moments">("articles");
let searchQuery = $state("");
let articles = $state<ArticleItem[]>([]);
let moments = $state<MomentItem[]>([]);
let isLoading = $state(false);
let loadError = $state("");
let searchInputEl = $state<HTMLInputElement | null>(null);

function ensureAbsoluteUrl(pathOrUrl: string): string {
	if (!pathOrUrl) return "";
	if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
	const origin =
		typeof window !== "undefined"
			? window.location.origin
			: "https://lengxiqwq.com";
	return `${origin}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

function formatMomentDate(timestamp: number): string {
	try {
		const d = new Date(timestamp);
		return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
	} catch {
		return "动态分享";
	}
}

function getRelativeTime(timestamp: number): string {
	if (!timestamp) return "";
	const now = Date.now();
	const diffSec = Math.floor((now - timestamp) / 1000);
	if (diffSec < 60) return "刚刚";
	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return `${diffMin}分钟前`;
	const diffHour = Math.floor(diffMin / 60);
	if (diffHour < 24) return `${diffHour}小时前`;
	const diffDay = Math.floor(diffHour / 24);
	if (diffDay < 30) return `${diffDay}天前`;
	const diffMonth = Math.floor(diffDay / 30);
	if (diffMonth < 12) return `${diffMonth}个月前`;
	return `${Math.floor(diffMonth / 12)}年前`;
}

async function loadData() {
	if (articles.length > 0 && moments.length > 0) return;
	isLoading = true;
	loadError = "";

	try {
		const [postRes, momentRes] = await Promise.all([
			fetch("/api/allPostMeta.json").then((r) => (r.ok ? r.json() : [])),
			fetch("/api/dynamic.json").then((r) => (r.ok ? r.json() : [])),
		]);

		articles = Array.isArray(postRes)
			? postRes.map((p) => ({
					id: p.id || "",
					title: p.title || "未命名文章",
					description: p.description || "",
					published: Number(p.published) || 0,
					publishedDate: p.publishedDate || "",
					category: p.category || "",
					image: p.image || "",
					url: p.url || `/posts/${p.id}/`,
				}))
			: [];

		moments = Array.isArray(momentRes)
			? momentRes.map((m) => {
					const ts = Number(m.published) || 0;
					return {
						id: m.id || "",
						published: ts,
						html: m.html || "",
						images: Array.isArray(m.images) ? m.images : [],
						searchText: m.searchText || "",
						dateStr: formatMomentDate(ts),
						relativeTime: getRelativeTime(ts),
					};
				})
			: [];
	} catch (err) {
		console.error("加载博客内容失败", err);
		loadError = "未能加载博客内容，请检查网络或稍后重试";
	} finally {
		isLoading = false;
	}
}

$effect(() => {
	if (open) {
		searchQuery = "";
		loadError = "";
		void loadData();
	}
});

const filteredArticles = $derived.by(() => {
	const q = searchQuery.trim().toLowerCase();
	if (!q) return articles;
	return articles.filter(
		(a) =>
			a.title.toLowerCase().includes(q) ||
			a.description.toLowerCase().includes(q) ||
			Boolean(a.category?.toLowerCase().includes(q)),
	);
});

const filteredMoments = $derived.by(() => {
	const q = searchQuery.trim().toLowerCase();
	if (!q) return moments;
	return moments.filter(
		(m) =>
			m.searchText.toLowerCase().includes(q) ||
			m.dateStr.toLowerCase().includes(q),
	);
});

function handlePickArticle(item: ArticleItem) {
	const absUrl = ensureAbsoluteUrl(item.url);
	const absCover = item.image ? ensureAbsoluteUrl(item.image) : undefined;
	const payload = formatLxArticleShare({
		title: item.title,
		description: item.description,
		url: absUrl,
		cover: absCover,
	});
	onShare(payload);
	onClose();
}

function handlePickMoment(item: MomentItem) {
	const cleanText = (item.searchText || "")
		.replace(/!\[.*?\]\(.*?\)/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 240);
	const absUrl = ensureAbsoluteUrl(`/dynamic/#${item.id}`);
	const firstImage = item.images?.[0]?.src;
	const absCover = firstImage ? ensureAbsoluteUrl(firstImage) : undefined;

	const payload = formatLxMomentShare({
		date: item.dateStr,
		content: cleanText,
		url: absUrl,
		cover: absCover,
	});
	onShare(payload);
	onClose();
}
</script>

<ChatModal
  open={open}
  title="分享内容至聊天室"
  subtitle="选择博客文章或即刻说说，生成专属图文卡片分享至房间"
  size="lg"
  mobile="expandable"
  onClose={onClose}
>
  <div class="chat-share-dialog-body flex flex-col h-[78vh] max-h-[660px] min-h-[460px] overflow-hidden select-none">
    <!-- 顶部流体一体化控制栏（胶囊分段器 + 快捷微光搜索框） -->
    <div class="chat-share-toolbar px-4 py-3 sm:px-6 sm:py-3.5 border-b border-[var(--skin-line)]/50 bg-[var(--skin-surface)]/80 backdrop-blur-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
      <!-- iOS / macOS 灵动胶囊选项卡 -->
      <div class="chat-share-segmented-control flex items-center p-1 rounded-full bg-[var(--btn-plain-bg-hover)] border border-[var(--skin-line)]/40 shrink-0 self-start sm:self-auto shadow-2xs">
        <button
          type="button"
          class="chat-share-tab-btn flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all duration-200 cursor-pointer {activeTab === 'articles' ? 'active text-[var(--skin-text)] shadow-xs' : 'text-[var(--chat-meta-color)] hover:text-[var(--skin-text)]'}"
          onclick={() => {
            activeTab = "articles";
            searchInputEl?.focus();
          }}
        >
          <svg class="w-3.5 h-3.5 {activeTab === 'articles' ? 'text-[var(--primary)]' : 'text-[var(--chat-meta-color)]'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span>博客文章</span>
          {#if articles.length > 0}
            <span class="chat-share-count-badge text-[10.5px] px-1.5 py-0.2 rounded-full font-bold {activeTab === 'articles' ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'bg-[var(--skin-line)]/60 text-[var(--chat-meta-color)]'}">
              {articles.length}
            </span>
          {/if}
        </button>

        <button
          type="button"
          class="chat-share-tab-btn flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all duration-200 cursor-pointer {activeTab === 'moments' ? 'active text-[var(--skin-text)] shadow-xs' : 'text-[var(--chat-meta-color)] hover:text-[var(--skin-text)]'}"
          onclick={() => {
            activeTab = "moments";
            searchInputEl?.focus();
          }}
        >
          <svg class="w-3.5 h-3.5 {activeTab === 'moments' ? 'text-emerald-500' : 'text-[var(--chat-meta-color)]'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
          </svg>
          <span>即刻说说</span>
          {#if moments.length > 0}
            <span class="chat-share-count-badge text-[10.5px] px-1.5 py-0.2 rounded-full font-bold {activeTab === 'moments' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-[var(--skin-line)]/60 text-[var(--chat-meta-color)]'}">
              {moments.length}
            </span>
          {/if}
        </button>
      </div>

      <!-- 搜索过滤条 -->
      <div class="relative flex items-center w-full sm:w-68">
        <svg class="absolute left-3 w-3.5 h-3.5 text-[var(--chat-meta-color)]/70 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>

        <input
          bind:this={searchInputEl}
          type="text"
          bind:value={searchQuery}
          placeholder={activeTab === 'articles' ? `搜索 ${articles.length ? `${articles.length} 篇` : ''}文章标题或分类...` : `搜索 ${moments.length ? `${moments.length} 条` : ''}说说内容或日期...`}
          class="chat-share-search-input w-full h-8.5 pl-8.5 pr-8 text-xs bg-[var(--card-bg)] border border-[var(--skin-line)]/60 rounded-full text-[var(--skin-text)] placeholder:text-[var(--chat-meta-color)]/60 focus:outline-none transition-all duration-200"
        />

        {#if searchQuery}
          <button
            type="button"
            class="absolute right-2.5 w-4.5 h-4.5 flex items-center justify-center rounded-full text-[11px] text-[var(--chat-meta-color)] hover:text-[var(--skin-text)] hover:bg-[var(--btn-plain-bg-hover)] transition-colors cursor-pointer"
            aria-label="清空搜索条件"
            onclick={() => {
              searchQuery = "";
              searchInputEl?.focus();
            }}
          >
            ✕
          </button>
        {/if}
      </div>
    </div>

    <!-- 核心网格展示区（大屏双列画卷网格，小屏自适应单列，彻底消灭横向冗余空白） -->
    <div class="chat-share-list-container flex-1 overflow-y-auto custom-scrollbar px-4 py-3.5 sm:px-6 sm:py-4 min-h-0">
      {#if isLoading}
        <!-- 骨架屏占位（与真实双列网格 1:1 对齐） -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          {#each [1, 2, 3, 4, 5, 6] as _i}
            <div class="flex items-start gap-3 p-3 rounded-2xl border border-[var(--skin-line)]/40 bg-[var(--card-bg)] animate-pulse">
              <div class="w-28 sm:w-32 aspect-16/10 rounded-xl bg-[var(--skin-line)]/30 shrink-0"></div>
              <div class="flex-1 min-w-0 space-y-2 py-0.5">
                <div class="h-4 w-4/5 bg-[var(--skin-line)]/40 rounded-md"></div>
                <div class="h-3 w-full bg-[var(--skin-line)]/25 rounded"></div>
                <div class="h-3 w-1/2 bg-[var(--skin-line)]/20 rounded"></div>
              </div>
            </div>
          {/each}
        </div>
      {:else if loadError}
        <!-- 异常态 -->
        <div class="flex flex-col items-center justify-center py-16 text-center gap-3">
          <div class="w-12 h-12 rounded-2xl bg-red-500/10 text-red-500 flex items-center justify-center text-xl shadow-xs">
            ⚠️
          </div>
          <div class="space-y-1">
            <p class="text-sm font-bold text-[var(--skin-text)] m-0">{loadError}</p>
            <p class="text-xs text-[var(--chat-meta-color)] m-0">请检查网络连通性或稍后重新加载</p>
          </div>
          <button
            type="button"
            class="px-4 py-1.5 text-xs font-semibold rounded-full bg-[var(--primary)] text-white hover:opacity-90 active:scale-95 transition-all shadow-sm cursor-pointer"
            onclick={() => void loadData()}
          >
            重新尝试
          </button>
        </div>
      {:else if activeTab === "articles"}
        <!-- 博客文章双列卡片网格 -->
        {#if filteredArticles.length === 0}
          <div class="flex flex-col items-center justify-center py-16 text-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-[var(--btn-plain-bg-hover)] text-[var(--chat-meta-color)]/60 flex items-center justify-center border border-[var(--skin-line)]/40">
              <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <div class="space-y-1">
              <p class="text-xs text-[var(--skin-text)] font-semibold m-0">
                {searchQuery ? `未找到包含「${searchQuery}」的博文` : "暂无可分享的文章"}
              </p>
              <p class="text-[11px] text-[var(--chat-meta-color)] m-0">
                可尝试搜索其他关键字或分类名称
              </p>
            </div>
            {#if searchQuery}
              <button
                type="button"
                class="text-xs text-[var(--primary)] hover:underline font-medium cursor-pointer"
                onclick={() => { searchQuery = ""; }}
              >
                清空搜索词
              </button>
            {/if}
          </div>
        {:else}
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            {#each filteredArticles as article (article.id)}
              <button
                type="button"
                class="chat-share-card group relative flex items-start gap-3 p-3 rounded-2xl bg-[var(--card-bg)] hover:bg-[var(--btn-plain-bg-hover)]/70 border border-[var(--skin-line)]/60 hover:border-[var(--primary)]/60 text-left transition-all duration-200 cursor-pointer w-full overflow-hidden"
                onclick={() => handlePickArticle(article)}
              >
                <!-- 封面图（黄金比例微缩画卷，悬浮平滑变焦） -->
                <div class="w-28 sm:w-32 aspect-16/10 rounded-xl overflow-hidden shrink-0 relative bg-[var(--btn-plain-bg-hover)] flex items-center justify-center border border-[var(--skin-line)]/40 shadow-2xs">
                  {#if article.image}
                    <img
                      src={article.image}
                      alt=""
                      class="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                      loading="lazy"
                    />
                    <div class="absolute inset-0 bg-gradient-to-t from-black/35 via-black/5 to-transparent pointer-events-none"></div>
                  {:else}
                    <div class="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[var(--primary)]/15 via-[var(--primary)]/5 to-transparent text-[var(--primary)]/70">
                      <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </div>
                  {/if}

                  {#if article.category}
                    <span class="absolute top-1 left-1 px-1.5 py-0.2 rounded-md text-[9px] font-bold bg-black/60 text-white/95 backdrop-blur-xs leading-none">
                      {article.category}
                    </span>
                  {/if}
                </div>

                <!-- 文字排版（紧凑有度，标题+简介+底部日期与发送胶囊） -->
                <div class="flex-1 min-w-0 flex flex-col justify-between self-stretch py-0.2 gap-1.5">
                  <div class="space-y-1">
                    <strong class="text-[13.5px] font-bold text-[var(--skin-text)] group-hover:text-[var(--primary)] transition-colors line-clamp-1 tracking-tight leading-snug">
                      {article.title}
                    </strong>

                    {#if article.description}
                      <p class="text-[11.5px] text-[var(--chat-meta-color)] line-clamp-2 leading-relaxed m-0 break-words opacity-90">
                        {article.description}
                      </p>
                    {/if}
                  </div>

                  <!-- 底部信息与发送微标 -->
                  <div class="flex items-center justify-between gap-1.5 pt-0.5 text-[10.5px] text-[var(--chat-meta-color)]">
                    <span class="truncate opacity-80 font-medium">
                      {article.publishedDate || "博客文章"}
                    </span>

                    <span class="flex items-center gap-0.5 font-bold text-[var(--primary)] text-[10.5px] opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <span>分享</span>
                      <span aria-hidden="true">↵</span>
                    </span>
                  </div>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      {:else}
        <!-- 即刻说说双列卡片网格 -->
        {#if filteredMoments.length === 0}
          <div class="flex flex-col items-center justify-center py-16 text-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-[var(--btn-plain-bg-hover)] text-[var(--chat-meta-color)]/60 flex items-center justify-center border border-[var(--skin-line)]/40">
              <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
              </svg>
            </div>
            <div class="space-y-1">
              <p class="text-xs text-[var(--skin-text)] font-semibold m-0">
                {searchQuery ? `未找到包含「${searchQuery}」的说说` : "暂无可分享的说说"}
              </p>
              <p class="text-[11px] text-[var(--chat-meta-color)] m-0">
                可尝试搜索其他关键字或日期
              </p>
            </div>
            {#if searchQuery}
              <button
                type="button"
                class="text-xs text-[var(--primary)] hover:underline font-medium cursor-pointer"
                onclick={() => { searchQuery = ""; }}
              >
                清空搜索词
              </button>
            {/if}
          </div>
        {:else}
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            {#each filteredMoments as moment (moment.id)}
              <button
                type="button"
                class="chat-share-card group relative flex items-start gap-3 p-3 rounded-2xl bg-[var(--card-bg)] hover:bg-[var(--btn-plain-bg-hover)]/70 border border-[var(--skin-line)]/60 hover:border-emerald-500/60 text-left transition-all duration-200 cursor-pointer w-full overflow-hidden"
                onclick={() => handlePickMoment(moment)}
              >
                <!-- 配图或灵动徽章 -->
                {#if moment.images && moment.images.length > 0 && moment.images[0].src}
                  <div class="w-18 sm:w-20 aspect-square rounded-xl overflow-hidden shrink-0 relative bg-[var(--btn-plain-bg-hover)] border border-[var(--skin-line)]/40 shadow-2xs">
                    <img
                      src={moment.images[0].src}
                      alt=""
                      class="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                      loading="lazy"
                    />
                    {#if moment.images.length > 1}
                      <span class="absolute bottom-1 right-1 px-1 py-0.2 rounded-md text-[9px] font-bold bg-black/65 text-white backdrop-blur-xs leading-none">
                        +{moment.images.length}
                      </span>
                    {/if}
                  </div>
                {:else}
                  <div class="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/20 shadow-2xs">
                    <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
                    </svg>
                  </div>
                {/if}

                <!-- 说说文字主体 -->
                <div class="flex-1 min-w-0 flex flex-col justify-between self-stretch py-0.2 gap-1.5">
                  <div class="space-y-1">
                    <div class="flex items-center gap-1.5 min-w-0">
                      <span class="text-xs font-bold text-[var(--skin-text)] group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors truncate">
                        {moment.dateStr}
                      </span>
                      {#if moment.relativeTime}
                        <span class="text-[10px] text-[var(--chat-meta-color)] font-medium">
                          ({moment.relativeTime})
                        </span>
                      {/if}
                    </div>

                    <p class="text-[11.5px] text-[var(--skin-text)]/85 line-clamp-3 leading-relaxed m-0 break-words">
                      {moment.searchText.replace(/!\[.*?\]\(.*?\)/g, "").trim() || "暂无文字描述"}
                    </p>
                  </div>

                  <!-- 底部微标 -->
                  <div class="flex items-center justify-between gap-1.5 pt-0.5 text-[10.5px]">
                    <span class="text-[10px] text-[var(--chat-meta-color)] font-medium">
                      {moment.images?.length ? `${moment.images.length} 张配图` : "纯文字动态"}
                    </span>

                    <span class="flex items-center gap-0.5 font-bold text-emerald-600 dark:text-emerald-400 text-[10.5px] opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <span>分享</span>
                      <span aria-hidden="true">↵</span>
                    </span>
                  </div>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      {/if}
    </div>

    <!-- 弹窗底部微光状态条 -->
    <div class="chat-share-footer px-4 py-2 sm:px-6 border-t border-[var(--skin-line)]/40 bg-[var(--skin-surface)]/60 text-[11px] text-[var(--chat-meta-color)] flex items-center justify-between shrink-0">
      <div class="flex items-center gap-1.5">
        <span class="w-1.5 h-1.5 rounded-full bg-[var(--primary)] opacity-80"></span>
        <span>
          {#if activeTab === "articles"}
            {filteredArticles.length} / {articles.length} 篇博文
          {:else}
            {filteredMoments.length} / {moments.length} 条说说
          {/if}
        </span>
      </div>
      <div class="hidden sm:inline-block opacity-75 font-medium">
        点击卡片即可在聊天室生成富媒体分享
      </div>
    </div>
  </div>
</ChatModal>

<style>
  .chat-share-dialog-body {
    background-color: var(--skin-surface, #ffffff);
  }

  .chat-share-segmented-control {
    background-color: var(--btn-plain-bg-hover);
  }

  .chat-share-tab-btn.active {
    background-color: var(--skin-surface, #ffffff);
  }

  :global(.dark) .chat-share-tab-btn.active {
    background-color: var(--btn-regular-bg, #262626);
  }

  .chat-share-search-input:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 18%, transparent);
  }

  .chat-share-card {
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
  }

  .chat-share-card:hover {
    box-shadow: 0 8px 20px -4px rgba(0, 0, 0, 0.08);
    transform: translateY(-1px);
  }

  :global(.dark) .chat-share-card {
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }

  :global(.dark) .chat-share-card:hover {
    box-shadow: 0 8px 20px -4px rgba(0, 0, 0, 0.45);
    transform: translateY(-1px);
  }

  /* 优化滚动区域右侧呼吸间距，防止滚动条紧贴卡片 */
  .chat-share-list-container {
    padding-right: calc(1.5rem - 4px);
  }

  @media (max-width: 640px) {
    .chat-share-list-container {
      padding-right: calc(1rem - 4px);
    }
  }
</style>
