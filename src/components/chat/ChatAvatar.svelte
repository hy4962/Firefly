<script module lang="ts">
const failedAvatarUrls = new Set<string>();
const loadedAvatarUrls = new Set<string>();
const downscaledAvatarUrls = new Map<string, string>();
const corsDisabledAvatarUrls = new Set<string>();
const pendingDownscaleUrls = new Map<string, Promise<string | null>>();
const MAX_AVATAR_URL_CACHE = 500;
const MAX_DOWNSCALED_CACHE = 300;
const AVATAR_THUMB_SIZE = 96;
let sharedThumbCanvas: HTMLCanvasElement | null = null;

function markAvatarFailed(url: string): void {
	if (!url) return;
	if (failedAvatarUrls.size >= MAX_AVATAR_URL_CACHE) {
		failedAvatarUrls.clear();
	}
	failedAvatarUrls.add(url);
}

function markAvatarLoaded(url: string): void {
	if (!url) return;
	if (loadedAvatarUrls.size >= MAX_AVATAR_URL_CACHE) {
		loadedAvatarUrls.clear();
	}
	loadedAvatarUrls.add(url);
}

export function getDownscaledAvatarUrl(url: string): string {
	if (!url || !canAttemptCorsDownscale(url)) {
		if (url && downscaledAvatarUrls.has(url)) {
			const old = downscaledAvatarUrls.get(url);
			if (old) URL.revokeObjectURL(old);
			downscaledAvatarUrls.delete(url);
		}
		return "";
	}
	return downscaledAvatarUrls.get(url) || "";
}

export function canCorsDownscaleAvatar(url: string): boolean {
	return canAttemptCorsDownscale(url);
}

export function downscaleImgElementInPlace(
	img: HTMLImageElement,
	rawUrl: string,
): void {
	if (!rawUrl || !canAttemptCorsDownscale(rawUrl)) return;
	if (img.naturalWidth <= 160 && img.naturalHeight <= 160) return;
	const initialSrc = img.currentSrc || img.src;
	void downscaleAvatarToBlobUrl(img, rawUrl).then((blobUrl) => {
		if (
			blobUrl &&
			img.isConnected &&
			(img.currentSrc || img.src) === initialSrc
		) {
			img.src = blobUrl;
		}
	});
}

function canAttemptCorsDownscale(url: string): boolean {
	if (!url || typeof window === "undefined") return false;
	if (corsDisabledAvatarUrls.has(url)) return false;
	if (url.startsWith("blob:") || url.startsWith("data:")) return false;
	if (/\.(?:gif|svg)(?:$|\?)/i.test(url)) return false;
	try {
		const parsed = new URL(url, window.location.href);
		if (parsed.origin === window.location.origin) {
			return !/\.(?:gif|svg)(?:$|\?)/i.test(parsed.pathname);
		}
	} catch {
		return false;
	}
	return false;
}

function downscaleAvatarToBlobUrl(
	img: HTMLImageElement,
	sourceUrl: string,
): Promise<string | null> {
	if (!sourceUrl || !canAttemptCorsDownscale(sourceUrl)) {
		return Promise.resolve(null);
	}
	const existing = downscaledAvatarUrls.get(sourceUrl);
	if (existing) return Promise.resolve(existing);
	const inflight = pendingDownscaleUrls.get(sourceUrl);
	if (inflight) return inflight;

	const task = new Promise<string | null>((resolve) => {
		try {
			const w = img.naturalWidth;
			const h = img.naturalHeight;
			if (!w || !h || (w <= 160 && h <= 160)) {
				resolve(null);
				return;
			}
			if (!sharedThumbCanvas) {
				sharedThumbCanvas = document.createElement("canvas");
				sharedThumbCanvas.width = AVATAR_THUMB_SIZE;
				sharedThumbCanvas.height = AVATAR_THUMB_SIZE;
			}
			const ctx = sharedThumbCanvas.getContext("2d");
			if (!ctx) {
				resolve(null);
				return;
			}
			ctx.clearRect(0, 0, AVATAR_THUMB_SIZE, AVATAR_THUMB_SIZE);
			const side = Math.min(w, h);
			const sx = Math.floor((w - side) / 2);
			const sy = Math.floor((h - side) / 2);
			ctx.drawImage(
				img,
				sx,
				sy,
				side,
				side,
				0,
				0,
				AVATAR_THUMB_SIZE,
				AVATAR_THUMB_SIZE,
			);
			sharedThumbCanvas.toBlob(
				(blob) => {
					if (!blob) {
						resolve(null);
						return;
					}
					if (downscaledAvatarUrls.size >= MAX_DOWNSCALED_CACHE) {
						const oldestKey = downscaledAvatarUrls.keys().next().value;
						if (oldestKey !== undefined) {
							const oldUrl = downscaledAvatarUrls.get(oldestKey);
							if (oldUrl) URL.revokeObjectURL(oldUrl);
							downscaledAvatarUrls.delete(oldestKey);
						}
					}
					const blobUrl = URL.createObjectURL(blob);
					downscaledAvatarUrls.set(sourceUrl, blobUrl);
					resolve(blobUrl);
				},
				"image/webp",
				0.86,
			);
		} catch {
			corsDisabledAvatarUrls.add(sourceUrl);
			resolve(null);
		}
	}).finally(() => {
		pendingDownscaleUrls.delete(sourceUrl);
	});

	pendingDownscaleUrls.set(sourceUrl, task);
	return task;
}
</script>

<script lang="ts">
import {
	getAvatarInitials,
	getDiceBearGlassAvatar,
	resolveChatAvatarFallbackUrl,
	resolveChatAvatarUrl,
} from "./chatClient";

type AvatarSize = "2xs" | "xs" | "sm" | "md" | "lg";

interface Props {
	src?: string;
	alternateSrc?: string;
	name?: string;
	fallback?: string;
	alt?: string;
	size?: AvatarSize;
	grayscale?: boolean;
	mutedTone?: boolean;
	lazy?: boolean;
	class?: string;
}

const {
	src = "",
	alternateSrc = "",
	name = "",
	fallback = "?",
	alt = "",
	size = "md",
	grayscale = false,
	mutedTone = false,
	lazy = false,
	class: extraClass = "",
}: Props = $props();

let imgError = $state(false);
let imgLoaded = $state(false);
let downscaledSrc = $state("");
let disableCorsForCurrent = $state(false);
let useAlternate = $state(false);
let diceBearError = $state(false);
let diceBearLoaded = $state(false);

const primaryUrl = $derived(resolveChatAvatarUrl(src));
const alternateUrl = $derived.by(() => {
	const explicit = resolveChatAvatarUrl(alternateSrc);
	return explicit && explicit !== primaryUrl
		? explicit
		: resolveChatAvatarFallbackUrl(src);
});
const resolvedSrc = $derived(
	alternateUrl && (useAlternate || !primaryUrl || failedAvatarUrls.has(primaryUrl))
		? alternateUrl
		: primaryUrl,
);

const diceBearSeed = $derived.by(() => {
	const raw = (name || fallback || "spectator").trim();
	return raw.replace(/\s*·\s*[^·]+$/, "").trim() || raw || "spectator";
});
const diceBearUrl = $derived(getDiceBearGlassAvatar(diceBearSeed));

$effect(() => {
	void primaryUrl;
	void alternateUrl;
	useAlternate = false;
});

$effect(() => {
	const cur = resolvedSrc;
	imgError = Boolean(cur && failedAvatarUrls.has(cur));
	disableCorsForCurrent = false;
	downscaledSrc = size === "lg" ? "" : getDownscaledAvatarUrl(cur);
	imgLoaded = Boolean(cur && loadedAvatarUrls.has(cur));
});

$effect(() => {
	const dbUrl = diceBearUrl;
	diceBearError = Boolean(dbUrl && failedAvatarUrls.has(dbUrl));
	diceBearLoaded = Boolean(dbUrl && loadedAvatarUrls.has(dbUrl));
});

const useCors = $derived(!downscaledSrc && !disableCorsForCurrent && canCorsDownscaleAvatar(resolvedSrc));

function handleAvatarLoad(img: HTMLImageElement): void {
	if (!resolvedSrc) return;
	markAvatarLoaded(resolvedSrc);
	imgLoaded = true;
	if (size !== "lg" && useCors && (img.naturalWidth > 160 || img.naturalHeight > 160)) {
		void downscaleAvatarToBlobUrl(img, resolvedSrc);
	}
}

function handleAvatarError(): void {
	const raw = resolvedSrc;
	imgLoaded = false;
	if (downscaledSrc) {
		if (downscaledAvatarUrls.get(raw) === downscaledSrc) {
			URL.revokeObjectURL(downscaledSrc);
			downscaledAvatarUrls.delete(raw);
		}
		downscaledSrc = "";
		disableCorsForCurrent = true;
		return;
	}
	if (useCors) {
		corsDisabledAvatarUrls.add(raw);
		disableCorsForCurrent = true;
		return;
	}
	markAvatarFailed(raw);
	if (alternateUrl && alternateUrl !== raw && !failedAvatarUrls.has(alternateUrl)) {
		useAlternate = true;
		return;
	}
	imgError = true;
}

function handleDiceBearLoad(): void {
	if (!diceBearUrl) return;
	markAvatarLoaded(diceBearUrl);
	diceBearLoaded = true;
}

function handleDiceBearError(): void {
	if (diceBearUrl) {
		markAvatarFailed(diceBearUrl);
	}
	diceBearLoaded = false;
	diceBearError = true;
}

const hasCustomAvatar = $derived(Boolean(resolvedSrc));
const showCustomImage = $derived(hasCustomAvatar && !imgError);
const initials = $derived(getAvatarInitials(name, fallback));
const isMultiChar = $derived(Array.from(initials).length >= 2);

const boxClass = $derived(
	size === "2xs"
		? "w-4 h-4 rounded-full"
		: size === "xs"
			? "w-5 h-5 rounded-full"
			: size === "sm"
				? "chat-avatar-sm"
				: size === "lg"
					? "w-12 h-12 rounded-full border border-black/10 dark:border-white/15"
					: "chat-avatar",
);

const textSizeClass = $derived.by(() => {
	switch (size) {
		case "2xs":
			return isMultiChar ? "text-[7px] tracking-tighter" : "text-[9px]";
		case "xs":
			return isMultiChar ? "text-[8px] tracking-tighter" : "text-[10px]";
		case "sm":
			return isMultiChar ? "text-[10.5px] tracking-tight" : "text-xs";
		case "lg":
			return isMultiChar ? "text-sm tracking-tight" : "text-base";
		default:
			return isMultiChar ? "text-xs tracking-tight" : "text-sm";
	}
});

const fallbackBgClass = $derived(
	size === "2xs" || size === "xs" || size === "lg" ? "bg-(--primary)/15" : "bg-black/5 dark:bg-white/10",
);

const fallbackTextColorClass = $derived(
	mutedTone
		? "text-[var(--chat-meta-color)]"
		: "text-[var(--chat-accent-text)]",
);
</script>

{#if hasCustomAvatar}
  {#if showCustomImage && imgLoaded}
    <img
      src={downscaledSrc || resolvedSrc}
      loading={lazy ? "lazy" : "eager"}
      fetchpriority={lazy ? "low" : undefined}
      decoding="async"
      crossorigin={useCors ? "anonymous" : undefined}
      referrerpolicy="no-referrer"
      alt={alt || name}
      class="{boxClass} object-cover shrink-0 {grayscale ? 'grayscale-[35%]' : ''} {extraClass}"
      onload={(event) => handleAvatarLoad(event.currentTarget)}
      onerror={handleAvatarError}
    />
  {:else if showCustomImage}
    <!-- 有头像但在加载中：显示中性灰色人头像剪影，绝不闪现奇怪头像 -->
    <span
      class="{boxClass} relative inline-flex items-center justify-center shrink-0 overflow-hidden bg-neutral-200/90 dark:bg-neutral-800/90 {extraClass}"
      aria-label={alt || name || "加载中"}
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        class="w-[58%] h-[58%] text-neutral-400 dark:text-neutral-500 shrink-0"
        aria-hidden="true"
      >
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
      </svg>
      <img
        src={downscaledSrc || resolvedSrc}
        loading={lazy ? "lazy" : "eager"}
        fetchpriority={lazy ? "low" : undefined}
        decoding="async"
        crossorigin={useCors ? "anonymous" : undefined}
        referrerpolicy="no-referrer"
        alt={alt || name}
        class="absolute inset-0 w-full h-full object-cover opacity-0 transition-opacity duration-150 {grayscale ? 'grayscale-[35%]' : ''}"
        onload={(event) => handleAvatarLoad(event.currentTarget)}
        onerror={handleAvatarError}
      />
    </span>
  {:else}
    <!-- 有头像但加载失败（404/破损）：纯灰色人头像剪影，绝不替换成怪异头像 -->
    <span
      class="{boxClass} relative inline-flex items-center justify-center shrink-0 overflow-hidden bg-neutral-200/90 dark:bg-neutral-800/90 {extraClass}"
      title="头像加载失败"
      aria-label={alt || name || "默认头像"}
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        class="w-[58%] h-[58%] text-neutral-400 dark:text-neutral-500 shrink-0"
        aria-hidden="true"
      >
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
      </svg>
    </span>
  {/if}
{:else if !diceBearError}
  <!-- 没有任何头像的人：使用 Cutouts 剪纸风生成专属趣味头像 -->
  {#if diceBearLoaded}
    <img
      src={diceBearUrl}
      loading={lazy ? "lazy" : "eager"}
      fetchpriority={lazy ? "low" : undefined}
      decoding="async"
      referrerpolicy="no-referrer"
      alt={alt || name}
      class="{boxClass} object-cover shrink-0 {grayscale ? 'grayscale-[35%]' : ''} {extraClass}"
      onload={handleDiceBearLoad}
      onerror={handleDiceBearError}
    />
  {:else}
    <!-- Cutouts 正在加载中：同样以温和中性灰色人像剪影过渡 -->
    <span class="{boxClass} relative inline-flex items-center justify-center shrink-0 overflow-hidden bg-neutral-200/90 dark:bg-neutral-800/90 {extraClass}">
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        class="w-[58%] h-[58%] text-neutral-400 dark:text-neutral-500 shrink-0"
        aria-hidden="true"
      >
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
      </svg>
      <img
        src={diceBearUrl}
        loading={lazy ? "lazy" : "eager"}
        fetchpriority={lazy ? "low" : undefined}
        decoding="async"
        referrerpolicy="no-referrer"
        alt={alt || name}
        class="absolute inset-0 w-full h-full object-cover opacity-0 transition-opacity duration-150 {grayscale ? 'grayscale-[35%]' : ''}"
        onload={handleDiceBearLoad}
        onerror={handleDiceBearError}
      />
    </span>
  {/if}
{:else}
  <!-- 极端离线/不可用兜底：中性灰色人像剪影 -->
  <span
    class="{boxClass} bg-neutral-200/90 dark:bg-neutral-800/90 inline-flex items-center justify-center shrink-0 {extraClass}"
    aria-label={alt || name || "默认头像"}
  >
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      class="w-[58%] h-[58%] text-neutral-400 dark:text-neutral-500 shrink-0"
      aria-hidden="true"
    >
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  </span>
{/if}
