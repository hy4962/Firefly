<script lang="ts">
import { onDestroy } from "svelte";
import { useChatMediaRetry } from "./chatMediaRetry";
import type { ChatAttachment } from "./chatTypes";

const { attachment }: { attachment: ChatAttachment } = $props();
let link = $state<HTMLAnchorElement>();
let request: AbortController | undefined;
let failed = $state(false);
let downloading = $state(false);
let downloadPercent = $state<number | null>(null);

const retry = useChatMediaRetry(() => {
	void handleDownload();
});

async function handleDownload(e?: MouseEvent) {
	e?.preventDefault();
	if (downloading) return;

	request?.abort();
	const attempt = new AbortController();
	request = attempt;
	failed = false;
	downloading = true;
	downloadPercent = null;

	const targetFilename = attachment.name || "下载文件";

	try {
		const response = await fetch(attachment.url, {
			signal: attempt.signal,
		});

		if (!response.ok) {
			throw new Error(`HTTP error ${response.status}`);
		}

		const contentLength = response.headers.get("content-length");
		const totalBytes = contentLength
			? Number.parseInt(contentLength, 10)
			: attachment.size || 0;

		let blob: Blob;
		if (
			response.body &&
			totalBytes > 0 &&
			typeof ReadableStream !== "undefined"
		) {
			const reader = response.body.getReader();
			let receivedBytes = 0;
			const chunks: Uint8Array[] = [];

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (value) {
					chunks.push(value);
					receivedBytes += value.length;
					if (totalBytes > 0) {
						downloadPercent = Math.min(
							100,
							Math.round((receivedBytes / totalBytes) * 100),
						);
					}
				}
			}
			blob = new Blob(chunks, {
				type:
					response.headers.get("content-type") || "application/octet-stream",
			});
		} else {
			blob = await response.blob();
		}

		if (attempt.signal.aborted) return;

		// 通过同源 Blob 触发下载，突破跨域限制，确保文件名和后缀 100% 遵守 targetFilename
		const blobUrl = URL.createObjectURL(blob);
		const tempLink = document.createElement("a");
		tempLink.href = blobUrl;
		tempLink.download = targetFilename;
		tempLink.style.display = "none";
		document.body.appendChild(tempLink);
		tempLink.click();
		document.body.removeChild(tempLink);
		setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);

		retry.clear();
	} catch (err: unknown) {
		if (attempt.signal.aborted) return;
		const isAbort = err instanceof DOMException && err.name === "AbortError";
		if (!isAbort) {
			// 若网络或 CORS 异常，降级回退为新窗口直接打开链接
			failed = true;
			retry.fail();
			window.open(attachment.url, "_blank", "noopener,noreferrer");
		}
	} finally {
		if (!attempt.signal.aborted) {
			downloading = false;
			downloadPercent = null;
		}
	}
}

onDestroy(() => {
	request?.abort();
});
</script>

<a
  bind:this={link}
  href={attachment.url}
  download={attachment.name || "下载文件"}
  target="_blank"
  rel="noopener noreferrer"
  class="chat-file-card"
  aria-busy={downloading}
  onclick={handleDownload}
>
  <div class="w-8 h-8 rounded-lg bg-[var(--skin-accent)]/15 text-[var(--skin-accent)] flex items-center justify-center shrink-0">
    {#if downloading}
      <svg class="animate-spin w-4 h-4 text-[var(--skin-accent)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
      </svg>
    {:else}
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
    {/if}
  </div>
  <div class="flex flex-col min-w-0 flex-1">
    <span class="text-xs font-medium truncate">{attachment.name || "文件附件"}</span>
    <span class="text-[0.6875rem] text-[var(--chat-meta-color)] truncate">
      {#if downloading}
        {downloadPercent !== null ? `正在下载 ${downloadPercent}%...` : "正在准备下载..."}
      {:else if failed}
        文件暂时无法下载
      {:else if attachment.size}
        {attachment.size > 1024 * 1024 ? `${(attachment.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(attachment.size / 1024)} KB`}
      {:else}
        点击下载文件
      {/if}
    </span>
  </div>
</a>
