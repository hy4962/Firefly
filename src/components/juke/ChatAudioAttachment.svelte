<script module lang="ts">
let stopCurrentVoice: (() => void) | undefined;
</script>

<script lang="ts">
import { onDestroy } from "svelte";
import { useChatMediaRetry } from "./chatMediaRetry";
import type { ChatAttachment } from "./chatTypes";

const { attachment }: { attachment: ChatAttachment } = $props();
let audio: HTMLAudioElement | undefined;
let playing = $state(false);
let failed = $state(false);
const retry = useChatMediaRetry(play);

function stop() {
	audio?.pause();
	audio = undefined;
	playing = false;
	if (stopCurrentVoice === stop) stopCurrentVoice = undefined;
}

function play() {
	stopCurrentVoice?.();
	const player = new Audio(attachment.url);
	audio = player;
	stopCurrentVoice = stop;
	playing = true;
	failed = false;

	function handleFailure() {
		if (audio !== player) return;
		stop();
		failed = true;
		retry.fail();
	}

	player.onended = () => { if (audio === player) stop(); };
	player.onerror = handleFailure;
	player.onplaying = () => {
		if (audio === player) retry.clear();
	};
	void player.play().catch(handleFailure);
}

function toggleAudio() {
	if (playing) stop();
	else {
		retry.clear();
		play();
	}
}

onDestroy(stop);
</script>

<div class="chat-voice-msg">
  <button type="button" class="chat-voice-play-btn" aria-label={playing ? "暂停" : "播放语音"} onclick={toggleAudio}>
    {#if playing}
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="6" y="4" width="4" height="16" rx="1"/>
        <rect x="14" y="4" width="4" height="16" rx="1"/>
      </svg>
    {:else}
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M8 5v14l11-7z"/>
      </svg>
    {/if}
  </button>
  <div class="flex flex-col min-w-0 flex-1">
    <span class="text-xs font-semibold truncate">{attachment.name || "语音留言"}</span>
    <span class="text-[0.6875rem] text-[var(--chat-meta-color)]" aria-live="polite">
      {failed ? "语音无法播放" : attachment.duration ? `${attachment.duration} 秒` : "音频片段"}
    </span>
  </div>
</div>
