<script lang="ts">
import {
	chatImageLayout,
	type ChatImageDimensions,
	type ChatImageResizeDetail,
	getChatImageDimensions,
	rememberChatImageDimensions,
	validateChatImageDimensions,
} from "./chatImageLayout";
import { openChatImageLightbox } from "./chatLightbox";
import { useChatMediaRetry } from "./chatMediaRetry";

interface Props {
	src: string;
	thumbnailSrc?: string;
	alt: string;
	metadata?: Partial<ChatImageDimensions>;
	inline?: boolean;
}

const { src, thumbnailSrc, alt, metadata, inline = false }: Props = $props();
let loaded = $state<{ src: string; size: ChatImageDimensions }>();
const size = $derived(loaded?.src === src ? loaded.size : getChatImageDimensions(src, metadata));
const layout = $derived(chatImageLayout(size));
let failedSrc = $state("");
let failedThumbnail = $state("");
let openingSrc = $state("");
let imageLink = $state<HTMLAnchorElement>();
const previewRetry = useChatMediaRetry(retryImage);
const previewSrc = $derived(thumbnailSrc && thumbnailSrc !== failedThumbnail ? thumbnailSrc : src);

function handleError() {
	if (previewSrc !== src) {
		failedThumbnail = previewSrc;
	} else {
		failedSrc = src;
		previewRetry.fail();
	}
}

function retryImage() {
	failedSrc = "";
	failedThumbnail = "";
}

async function showImage(event: MouseEvent) {
	if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
	event.preventDefault();
	const requestedSrc = src;
	if (openingSrc === requestedSrc) return;
	openingSrc = requestedSrc;
	try {
		await openChatImageLightbox(requestedSrc, imageLink);
	} finally {
		if (openingSrc === requestedSrc) openingSrc = "";
	}
}

function handleLoad(event: Event & { currentTarget: HTMLImageElement }) {
	previewRetry.clear();
	if (previewSrc !== src && size) return;
	const img = event.currentTarget;
	const actual = validateChatImageDimensions(img.naturalWidth, img.naturalHeight);
	if (!actual || (actual.width === size?.width && actual.height === size.height)) return;
	const imageSrc = src;
	const isOriginal = previewSrc === imageSrc;
	const apply = () => {
		if (isOriginal) rememberChatImageDimensions(imageSrc, actual);
		loaded = { src: imageSrc, size: actual };
	};
	// The virtual list captures its scroll anchor before the resize is applied.
	const resize = new CustomEvent<ChatImageResizeDetail>("chat-image-resize", {
		bubbles: true,
		cancelable: true,
		detail: { apply },
	});
	if (img.dispatchEvent(resize)) apply();
}
</script>

{#if failedSrc === src}
  <span class="inline-flex flex-wrap items-center gap-2 rounded-lg border border-black/10 px-3 py-2 dark:border-white/10" role="status">
    <span>图片加载失败</span>
    {#if !previewRetry.isInMessage}<button type="button" class="underline" onclick={retryImage}>重试</button>{/if}
  </span>
{:else}
  <a
    href={src}
    bind:this={imageLink}
    data-chat-image={src}
    data-no-swup
    class="{inline ? 'inline-flex align-top my-1' : 'flex w-fit'} min-w-0 max-w-full overflow-hidden rounded-lg border border-black/10 dark:border-white/10 cursor-zoom-in"
    aria-busy={openingSrc === src}
    onclick={showImage}
  >
    {#key previewSrc}
      <img
        src={previewSrc}
        {alt}
        loading="lazy"
        decoding="async"
        width={size?.width}
        height={size?.height}
        style:--chat-preview-width={size ? `min(${layout.intrinsicWidth}px, ${layout.maxWidthRem}rem)` : `${layout.maxWidthRem}rem`}
        style:--chat-preview-ratio={layout.ratio}
        onload={handleLoad}
        onerror={handleError}
        class="chat-msg-image"
      />
    {/key}
    {#if openingSrc === src}<span class="sr-only" role="status">正在打开原图</span>{/if}
  </a>
{/if}
