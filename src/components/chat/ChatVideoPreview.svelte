<script lang="ts">
import { useChatMediaRetry } from "./chatMediaRetry";

const { src }: { src: string } = $props();
let failedSrc = $state("");
const retry = useChatMediaRetry(reset);

function reset() {
	failedSrc = "";
}

function handleError() {
	failedSrc = src;
	retry.fail();
}
</script>

{#if failedSrc === src}
  <div class="chat-file-card flex-wrap gap-2" role="status">
    <span>视频无法播放</span>
    {#if !retry.isInMessage}<button type="button" class="underline" onclick={reset}>重试</button>{/if}
    <a href={src} target="_blank" rel="noopener noreferrer" class="underline">打开原视频</a>
  </div>
{:else}
  <video
    {src}
    controls
    playsinline
    preload="metadata"
    class="chat-msg-video"
    onloadedmetadata={retry.clear}
    onerror={handleError}
  >
    <track kind="captions" />
  </video>
{/if}
