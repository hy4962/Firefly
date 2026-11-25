<script lang="ts">
import ChatTooltip from "./ChatTooltip.svelte";
import { formatClockSeconds } from "./chatClient";
import type { CurrentPlayback } from "./chatTypes";
import { type AudioStatus, audioStatusLabel } from "./roomAudioPlayer";

interface Props {
	currentPlay?: CurrentPlayback | null;
	isListening: boolean;
	audioStatus?: AudioStatus;
	elapsedSec: number;
	durationSec: number;
	canDirectSkip: boolean;
	isSoloCoolingDown: boolean;
	soloCooldownRemainSec: number;
	hasVotedSkip: boolean;
	voteCount: number;
	voteThreshold: number;
	isSkippingTrack?: boolean;
	currentLyric?: string;
	variant?: "panel" | "mobile";
	onOpenLyrics: () => void;
	onToggleListen: () => void;
	onSkipTrack: () => void;
	onVoteSkip: () => void;
	onClose?: () => void;
}

const {
	currentPlay = null,
	isListening,
	elapsedSec,
	durationSec,
	canDirectSkip,
	isSoloCoolingDown,
	soloCooldownRemainSec,
	hasVotedSkip,
	voteCount,
	voteThreshold,
	isSkippingTrack = false,
	currentLyric,
	variant = "panel",
	audioStatus = "idle",
	onOpenLyrics,
	onToggleListen,
	onSkipTrack,
	onVoteSkip,
	onClose,
}: Props = $props();

let coverFailed = $state(false);

$effect(() => {
	if (currentPlay) {
		currentPlay.uid;
	}
	coverFailed = false;
});

const isBusy = $derived(
	isListening && ["loading", "preparing", "recovering"].includes(audioStatus),
);
const listenAction = $derived(
	isBusy
		? "恢复收听"
		: audioStatus === "blocked" || audioStatus === "error"
			? "重试收听"
			: isListening
				? "停止收听"
				: "开启收听",
);

const progressRatio = $derived(
	durationSec > 0 ? Math.min(1, Math.max(0, elapsedSec / durationSec)) : 0,
);

const displayLyric = $derived(
	currentPlay
		? currentLyric && currentLyric.trim().length > 0
			? currentLyric.trim()
			: currentPlay.track.title
		: "当前没有歌曲播放",
);

const formattedTimeText = $derived(
	`${formatClockSeconds(elapsedSec)}${durationSec > 0 ? ` / ${formatClockSeconds(durationSec)}` : ""}`,
);

const formattedStatusOrTime = $derived(
	currentPlay
		? audioStatus !== "playing" && audioStatus !== "idle"
			? audioStatusLabel[audioStatus]
			: formattedTimeText
		: "",
);

const skipTooltipText = $derived.by(() => {
	if (isSkippingTrack) return "正在切歌...";
	if (canDirectSkip) {
		return "下一曲";
	}
	if (hasVotedSkip) {
		return `取消投票（已投 ${voteCount}/${voteThreshold} 票）`;
	}
	return voteCount > 0
		? `同意切歌（已有 ${voteCount}/${voteThreshold} 票）`
		: `投票切歌（0/${voteThreshold} 票）`;
});
</script>

<div
  class={variant === "mobile" ? "chat-mobile-global-player" : "chat-mini-player"}
  role="region"
  aria-label={currentPlay ? "当前正在播放" : "点歌台快捷栏"}
>
  {#if currentPlay}
    <div class="chat-mini-progress-bar" aria-hidden="true">
      <div class="chat-mini-progress-fill" style="--pct: {progressRatio};"></div>
    </div>
  {/if}

  {#if variant === "panel" && onClose}
    <button
      type="button"
      class="chat-tool-btn chat-panel-close-btn shrink-0 md:hidden"
      aria-label="关闭点歌台"
      onclick={onClose}
    >
      <svg class="w-[1.15rem] h-[1.15rem]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
        <path d="m6 6 12 12M18 6 6 18" />
      </svg>
    </button>
  {/if}

  <button
    type="button"
    class="chat-mini-player-info flex items-center gap-2.5 min-w-0 flex-1 text-left bg-transparent border-none p-1 -m-1 rounded-xl hover:bg-black/4 dark:hover:bg-white/6 active:bg-black/6 dark:active:bg-white/10 transition-colors cursor-pointer group"
    aria-label={currentPlay
      ? "查看 " + currentPlay.track.title + " 歌词与播放详情" + (currentPlay.track.rotationReplacement ? "，替代 " + currentPlay.track.rotationReplacement.title : "")
      : "点歌台当前无播放歌曲，点击打开点歌台"}
    title={currentPlay ? "点击打开大播放器与完整歌词" : "点击打开点歌台"}
    onclick={onOpenLyrics}
  >
    <div class="{variant === 'mobile' ? 'size-8 rounded-md' : 'w-8.5 h-8.5 rounded-lg'} overflow-hidden shrink-0 border border-black/5 dark:border-white/10 bg-(--primary)/12 flex items-center justify-center shadow-xs transition-transform group-hover:scale-102">
      {#if currentPlay?.track?.cover && !coverFailed}
        <img
          src={currentPlay.track.cover}
          alt=""
          class="w-full h-full object-cover"
          onerror={() => (coverFailed = true)}
        />
      {:else}
        <svg class="size-4 text-(--primary)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      {/if}
    </div>

    <div class="min-w-0 flex-1">
      <div
        class="{variant === 'mobile' ? 'text-[12.5px]' : 'text-[12px] xl:text-[11.5px]'} font-bold text-[var(--deep-text)] truncate leading-snug"
      >
        {displayLyric}
      </div>
      <div
        class="{variant === 'mobile' ? 'text-[12px]' : 'text-[12px] xl:text-[11.5px]'} text-[var(--chat-meta-color)] tabular-nums leading-tight mt-0.5 flex items-center min-w-0 gap-1.5"
      >
        {#if currentPlay}
          {#if variant === 'mobile'}
            <!-- 手机版：歌名保留更多（上限达 78%），作者优先截断，空间不足时歌名更完整 -->
            <div class="flex items-center min-w-0 flex-1 overflow-hidden">
              <span
                class="text-[var(--deep-text)] truncate shrink-0 {currentPlay.track.rotationReplacement ? 'max-w-[58%]' : 'max-w-[78%]'}"
                title={currentPlay.track.title}
              >
                {currentPlay.track.title}
              </span>
              <span
                class="truncate min-w-0 flex-1 text-[var(--chat-meta-color)]"
                title={currentPlay.track.artist}
              >
                &nbsp;-&nbsp;{currentPlay.track.artist}
              </span>
              {#if currentPlay.track.rotationReplacement}
                <span class="ml-1 shrink-0 text-[10px] text-[var(--chat-meta-color)]" title={'替代《' + currentPlay.track.rotationReplacement.title + '》'}>替代播放</span>
              {/if}
            </div>
          {:else}
            <!-- 桌面端/侧栏版：保持原样不变 -->
            <div class="flex items-center min-w-0 flex-1 overflow-hidden">
              <span
                class="text-[var(--deep-text)] truncate shrink-0 {currentPlay.track.rotationReplacement ? 'max-w-[50%]' : 'max-w-[70%]'}"
                title={currentPlay.track.title}
              >
                {currentPlay.track.title}
              </span>
              <span
                class="truncate shrink min-w-0 text-[var(--chat-meta-color)]"
                title={currentPlay.track.artist}
              >
                &nbsp;-&nbsp;{currentPlay.track.artist}
              </span>
              {#if currentPlay.track.rotationReplacement}
                <span class="ml-1 shrink-0 text-[var(--chat-meta-color)]" title={'替代《' + currentPlay.track.rotationReplacement.title + '》'}>替代播放</span>
              {/if}
            </div>
          {/if}
          <span class="shrink-0 text-[var(--chat-meta-color)]/85 text-right tabular-nums">
            {formattedStatusOrTime}
          </span>
        {:else}
          <span class="truncate text-[var(--chat-meta-color)]">
            点击打开点歌台去点歌
          </span>
        {/if}
      </div>
    </div>
  </button>

  {#if currentPlay}
    <div class="flex items-center {variant === 'mobile' ? 'gap-0' : 'gap-1'} shrink-0">
    <ChatTooltip text={variant === "mobile" ? listenAction : isListening ? "点击静音" : "已静音"}>
      <button
        type="button"
        class="chat-queue-icon-btn {variant === 'mobile' ? 'size-11! rounded-lg!' : 'w-11! h-11! md:w-9! md:h-9! rounded-lg!'} {isListening ? 'text-[var(--chat-accent-text)]!' : ''} {variant === 'panel' && isListening ? 'bg-(--primary)/14!' : ''}"
        aria-label={listenAction}
        onclick={onToggleListen}
      >
        {#if isBusy}
          <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" opacity="0.25"/><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2"/></svg>
        {:else if variant === "mobile"}
          {#if isListening}
            <svg class="size-6 shrink-0" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 11.975q0-2.075-1.1-3.787t-2.95-2.563q-.375-.175-.55-.537t-.05-.738q.15-.4.538-.575t.787 0Q18.1 4.85 19.55 7.063T21 11.974t-1.45 4.913t-3.875 3.287q-.4.175-.788 0t-.537-.575q-.125-.375.05-.737t.55-.538q1.85-.85 2.95-2.562t1.1-3.788M7 15H4q-.425 0-.712-.288T3 14v-4q0-.425.288-.712T4 9h3l3.3-3.3q.475-.475 1.088-.213t.612.938v11.15q0 .675-.612.938T10.3 18.3zm9.5-3q0 1.05-.475 1.988t-1.25 1.537q-.25.15-.513.013T14 15.1V8.85q0-.3.263-.437t.512.012q.775.625 1.25 1.575t.475 2"/></svg>
          {:else}
            <svg class="size-6 shrink-0" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.775 19.575q-.275.175-.55.325t-.575.275q-.375.175-.762 0t-.538-.575q-.15-.375.038-.737t.562-.538q.1-.05.188-.1t.187-.1L12 14.8v2.775q0 .675-.612.938T10.3 18.3L7 15H4q-.425 0-.712-.288T3 14v-4q0-.425.288-.712T4 9h2.2L2.1 4.9q-.275-.275-.275-.7t.275-.7t.7-.275t.7.275l17 17q.275.275.275.7t-.275.7t-.7.275t-.7-.275zm2.225-7.6q0-2.075-1.1-3.787t-2.95-2.563q-.375-.175-.55-.537t-.05-.738q.15-.4.538-.575t.787 0Q18.1 4.85 19.55 7.05T21 11.975q0 .825-.15 1.638t-.425 1.562q-.2.55-.612.688t-.763.012t-.562-.45t-.013-.75q.275-.65.4-1.312T19 11.975m-4.225-3.55Q15.6 8.95 16.05 10t.45 2v.25q0 .125-.025.25q-.05.325-.35.425t-.55-.15L14.3 11.5q-.15-.15-.225-.337T14 10.775V8.85q0-.3.263-.437t.512.012M9.75 6.95Q9.6 6.8 9.6 6.6t.15-.35l.55-.55q.475-.475 1.087-.213t.613.938V8q0 .35-.3.475t-.55-.125z"/></svg>
          {/if}
        {:else if audioStatus === "playing"}
          <span class="chat-eq-bars" aria-hidden="true">
            <span class="chat-eq-bar"></span>
            <span class="chat-eq-bar"></span>
            <span class="chat-eq-bar"></span>
          </span>
        {:else}
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" />
          </svg>
        {/if}
      </button>
    </ChatTooltip>

    <ChatTooltip text={skipTooltipText} align="right">
      {#if canDirectSkip}
        <button
          type="button"
          disabled={isSkippingTrack}
          class="chat-queue-icon-btn {variant === 'mobile' ? 'size-11! rounded-lg!' : 'w-11! h-11! md:w-9! md:h-9! rounded-lg!'} disabled:opacity-75 disabled:cursor-wait!"
          aria-label={skipTooltipText}
          onclick={onSkipTrack}
        >
          {#if isSkippingTrack}
            <svg class="{variant === 'mobile' ? 'w-4.5 h-4.5' : 'w-5 h-5'} animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
            </svg>
          {:else if variant === "mobile"}
            <svg class="size-6 shrink-0" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.5 17V7q0-.425.288-.712T17.5 6t.713.288T18.5 7v10q0 .425-.288.713T17.5 18t-.712-.288T16.5 17m-11-.875v-8.25q0-.45.3-.725t.7-.275q.125 0 .275.025t.275.125l6.2 4.15q.225.15.338.363T13.7 12t-.112.463t-.338.362l-6.2 4.15q-.125.1-.275.125t-.275.025q-.4 0-.7-.275t-.3-.725"/></svg>
          {:else}
            <svg class="{variant === 'mobile' ? 'w-4.5 h-4.5' : 'w-5 h-5'}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
            </svg>
          {/if}
        </button>
      {:else}
        <button
          type="button"
          disabled={isSkippingTrack}
          class="chat-queue-icon-btn {variant === 'mobile' ? 'size-11! flex-col gap-0.5 rounded-lg!' : 'w-11! h-11! md:w-9! md:h-9! rounded-lg!'} {hasVotedSkip ? 'bg-(--primary)/14! text-[var(--chat-accent-text)]!' : ''} disabled:opacity-75 disabled:cursor-wait!"
          aria-pressed={hasVotedSkip}
          aria-label={skipTooltipText}
          onclick={onVoteSkip}
        >
          {#if isSkippingTrack}
            <svg class="{variant === 'mobile' ? 'w-4.5 h-4.5' : 'w-5 h-5'} animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
            </svg>
          {:else if variant === "mobile"}
            {#if hasVotedSkip}
              <svg class="size-6 shrink-0" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m9.55 15.15l8.475-8.475q.3-.3.7-.3t.7.3t.3.713t-.3.712l-9.175 9.2q-.3.3-.7.3t-.7-.3L4.55 13q-.3-.3-.288-.712t.313-.713t.713-.3t.712.3z"/></svg>
            {:else}
              <svg class="size-6 shrink-0" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.5 17V7q0-.425.288-.712T17.5 6t.713.288T18.5 7v10q0 .425-.288.713T17.5 18t-.712-.288T16.5 17m-11-.875v-8.25q0-.45.3-.725t.7-.275q.125 0 .275.025t.275.125l6.2 4.15q.225.15.338.363T13.7 12t-.112.463t-.338.362l-6.2 4.15q-.125.1-.275.125t-.275.025q-.4 0-.7-.275t-.3-.725"/></svg>
            {/if}
            <span class="text-[10px] leading-none tabular-nums" aria-hidden="true">{voteCount}/{voteThreshold}</span>
          {:else if hasVotedSkip}
            <svg class="{variant === 'mobile' ? 'w-4.5 h-4.5' : 'w-5 h-5'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          {:else}
            <svg class="{variant === 'mobile' ? 'w-4.5 h-4.5' : 'w-5 h-5'}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
            </svg>
          {/if}
        </button>
      {/if}
    </ChatTooltip>
  </div>
  {:else}
    <div class="flex items-center shrink-0 pr-1">
      <button
        type="button"
        class="text-xs px-2.5 py-1 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 transition-colors font-medium border-none cursor-pointer flex items-center gap-1"
        aria-label="打开点歌台点歌"
        onclick={onOpenLyrics}
      >
        <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        <span>点歌</span>
      </button>
    </div>
  {/if}
</div>
