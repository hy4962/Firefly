<script lang="ts">
import ChatAvatar from "./ChatAvatar.svelte";
import ChatModal from "./ChatModal.svelte";
import { sanitizeChatUrl, uploadChatAvatar } from "./chatClient";

interface Props {
	open: boolean;
	currentAvatar: string;
	userName: string;
	chatServerUrl: string;
	auth?: { kind: "waline" | "guest"; token: string } | null;
	onApplyAvatar: (avatarUrl: string) => void;
	onResetDefault: () => void;
	onClose: () => void;
}

const EXPORT_SIZE = 256;
const ALLOWED_IMAGE_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
	"image/avif",
]);

const {
	open,
	currentAvatar = "",
	userName = "",
	chatServerUrl = "",
	auth = null,
	onApplyAvatar,
	onResetDefault,
	onClose,
}: Props = $props();

let mode = $state<"crop" | "url">("crop");
let fileInputEl = $state<HTMLInputElement | null>(null);
let stageEl = $state<HTMLDivElement | null>(null);
let stageSize = $state(240);
let objectUrl = $state("");
let imgNaturalWidth = $state(0);
let imgNaturalHeight = $state(0);
let zoom = $state(1);
let offsetX = $state(0);
let offsetY = $state(0);
let isDragging = $state(false);
let isDragOver = $state(false);
let dragPointerId = -1;
let dragStartX = 0;
let dragStartY = 0;
let dragStartOffsetX = 0;
let dragStartOffsetY = 0;

let urlInput = $state("");
let errorText = $state("");
let isUploading = $state(false);

function revokeCurrentObjectUrl() {
	if (objectUrl) {
		URL.revokeObjectURL(objectUrl);
		objectUrl = "";
	}
}

$effect(() => {
	if (!open) {
		revokeCurrentObjectUrl();
		imgNaturalWidth = 0;
		imgNaturalHeight = 0;
		zoom = 1;
		offsetX = 0;
		offsetY = 0;
		isDragging = false;
		isDragOver = false;
		errorText = "";
		isUploading = false;
		mode = "crop";
		return;
	}
	urlInput = currentAvatar;
	errorText = "";
});

$effect(() => {
	return () => {
		revokeCurrentObjectUrl();
	};
});

$effect(() => {
	const el = stageEl;
	if (!el) return;
	const syncSize = () => {
		if (el.clientWidth > 0) stageSize = el.clientWidth;
	};
	syncSize();
	const ro = new ResizeObserver(syncSize);
	ro.observe(el);
	return () => ro.disconnect();
});

const baseScale = $derived.by(() => {
	if (!imgNaturalWidth || !imgNaturalHeight) return 1;
	return stageSize / Math.min(imgNaturalWidth, imgNaturalHeight);
});

const renderWidth = $derived(imgNaturalWidth * baseScale * zoom);
const renderHeight = $derived(imgNaturalHeight * baseScale * zoom);

const maxOffsetX = $derived(Math.max(0, (renderWidth - stageSize) / 2));
const maxOffsetY = $derived(Math.max(0, (renderHeight - stageSize) / 2));

function clampOffsets(
	nx: number,
	ny: number,
	mx = maxOffsetX,
	my = maxOffsetY,
) {
	return {
		x: Math.max(-mx, Math.min(mx, nx)),
		y: Math.max(-my, Math.min(my, ny)),
	};
}

function handleZoomChange(nextZoom: number) {
	const clampedZoom = Math.max(1, Math.min(3, nextZoom));
	const nextW = imgNaturalWidth * baseScale * clampedZoom;
	const nextH = imgNaturalHeight * baseScale * clampedZoom;
	const nextMaxX = Math.max(0, (nextW - stageSize) / 2);
	const nextMaxY = Math.max(0, (nextH - stageSize) / 2);
	const ratio = zoom > 0 ? clampedZoom / zoom : 1;
	const clamped = clampOffsets(
		offsetX * ratio,
		offsetY * ratio,
		nextMaxX,
		nextMaxY,
	);
	zoom = clampedZoom;
	offsetX = clamped.x;
	offsetY = clamped.y;
}

function loadSelectedFile(file: File | null | undefined) {
	if (!file) return;
	errorText = "";
	const mime = file.type.toLowerCase();
	if (mime && !ALLOWED_IMAGE_TYPES.has(mime)) {
		errorText = "请选择 PNG / JPG / WebP / GIF / AVIF 图片文件";
		return;
	}
	if (file.size > 15 * 1024 * 1024) {
		errorText = "原图不能超过 15MB";
		return;
	}
	const nextUrl = URL.createObjectURL(file);
	const probe = new Image();
	probe.onload = () => {
		if (!probe.naturalWidth || !probe.naturalHeight) {
			URL.revokeObjectURL(nextUrl);
			errorText = "无法读取该图片尺寸";
			return;
		}
		revokeCurrentObjectUrl();
		objectUrl = nextUrl;
		imgNaturalWidth = probe.naturalWidth;
		imgNaturalHeight = probe.naturalHeight;
		zoom = 1;
		offsetX = 0;
		offsetY = 0;
		mode = "crop";
	};
	probe.onerror = () => {
		URL.revokeObjectURL(nextUrl);
		errorText = "图片解析失败，请更换一张图片重试";
	};
	probe.src = nextUrl;
}

function handleFileInputChange(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	input.value = "";
	loadSelectedFile(file);
}

function handleDrop(event: DragEvent) {
	event.preventDefault();
	isDragOver = false;
	if (isUploading) return;
	const file = event.dataTransfer?.files?.[0];
	loadSelectedFile(file);
}

function startCropDrag(event: PointerEvent) {
	if (!objectUrl || isUploading) return;
	if (!event.isPrimary || event.button !== 0) return;
	isDragging = true;
	dragPointerId = event.pointerId;
	dragStartX = event.clientX;
	dragStartY = event.clientY;
	dragStartOffsetX = offsetX;
	dragStartOffsetY = offsetY;
	(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function moveCropDrag(event: PointerEvent) {
	if (!isDragging || event.pointerId !== dragPointerId) return;
	const dx = event.clientX - dragStartX;
	const dy = event.clientY - dragStartY;
	const clamped = clampOffsets(dragStartOffsetX + dx, dragStartOffsetY + dy);
	offsetX = clamped.x;
	offsetY = clamped.y;
}

function endCropDrag(event: PointerEvent) {
	if (!isDragging || event.pointerId !== dragPointerId) return;
	isDragging = false;
	dragPointerId = -1;
}

function handleWheelZoom(event: WheelEvent) {
	if (!objectUrl || isUploading) return;
	event.preventDefault();
	const delta = event.deltaY < 0 ? 0.12 : -0.12;
	handleZoomChange(zoom + delta);
}

function renderCroppedBlob(): Promise<Blob> {
	return new Promise((resolve, reject) => {
		if (!objectUrl || !imgNaturalWidth || !imgNaturalHeight) {
			reject(new Error("请先选择一张图片"));
			return;
		}
		const img = new Image();
		img.onload = () => {
			const canvas = document.createElement("canvas");
			canvas.width = EXPORT_SIZE;
			canvas.height = EXPORT_SIZE;
			const ctx = canvas.getContext("2d");
			if (!ctx) {
				reject(new Error("浏览器不支持画布裁剪"));
				return;
			}
			const totalScale = baseScale * zoom;
			const srcSize = stageSize / totalScale;
			const imgCenterX = imgNaturalWidth / 2 - offsetX / totalScale;
			const imgCenterY = imgNaturalHeight / 2 - offsetY / totalScale;
			const sx = Math.max(
				0,
				Math.min(imgNaturalWidth - srcSize, imgCenterX - srcSize / 2),
			);
			const sy = Math.max(
				0,
				Math.min(imgNaturalHeight - srcSize, imgCenterY - srcSize / 2),
			);

			ctx.imageSmoothingEnabled = true;
			ctx.imageSmoothingQuality = "high";
			ctx.drawImage(
				img,
				sx,
				sy,
				srcSize,
				srcSize,
				0,
				0,
				EXPORT_SIZE,
				EXPORT_SIZE,
			);

			canvas.toBlob(
				(webpBlob) => {
					if (webpBlob && webpBlob.size > 0) {
						resolve(webpBlob);
						return;
					}
					canvas.toBlob((pngBlob) => {
						if (pngBlob && pngBlob.size > 0) resolve(pngBlob);
						else reject(new Error("生成裁剪图片失败"));
					}, "image/png");
				},
				"image/webp",
				0.9,
			);
		};
		img.onerror = () => reject(new Error("读取图片失败"));
		img.src = objectUrl;
	});
}

async function handleConfirm() {
	if (isUploading) return;
	errorText = "";

	if (mode === "url") {
		const trimmed = urlInput.trim().slice(0, 400);
		if (!trimmed) {
			onResetDefault();
			onClose();
			return;
		}
		const safe = sanitizeChatUrl(trimmed, false);
		if (!safe) {
			errorText = "请输入合法的 http:// 或 https:// 图片链接";
			return;
		}
		onApplyAvatar(safe);
		onClose();
		return;
	}

	if (!objectUrl) {
		errorText = "请先选择一张本地图片，或切换为使用图片链接";
		return;
	}

	isUploading = true;
	try {
		const blob = await renderCroppedBlob();
		const { url } = await uploadChatAvatar(blob, chatServerUrl, auth);
		onApplyAvatar(url);
		onClose();
	} catch (err) {
		errorText = err instanceof Error ? err.message : "头像上传失败，请重试";
	} finally {
		isUploading = false;
	}
}

function handleResetDefault() {
	if (isUploading) return;
	onResetDefault();
	onClose();
}
</script>

<ChatModal
  {open}
  title="更换头像"
  subtitle={mode === "crop" ? "上传本地图片并拖动裁剪区域，或改用外部图片链接" : "输入自定义头像图片链接，可实时预览效果"}
  ariaLabel="更换头像"
  size="sm"
  dialogClass="chat-avatar-modal-dialog"
  mobile="compact"
  preserveBehind={true}
  hideBackButton={true}
  onClose={() => {
    if (!isUploading) onClose();
  }}
>
  <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
    <div class="p-4 space-y-3.5 overflow-y-auto custom-scrollbar">
      <input
        bind:this={fileInputEl}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        class="sr-only"
        onchange={handleFileInputChange}
      />

      {#if mode === "crop"}
        <!-- 裁剪主工作区 -->
        <div class="flex flex-col items-center gap-3">
          {#if objectUrl}
            <div
              bind:this={stageEl}
              class="chat-avatar-crop-stage {isDragging ? 'is-dragging' : ''}"
              role="application"
              aria-label="拖动调整头像裁剪位置，滚轮缩放"
              onpointerdown={startCropDrag}
              onpointermove={moveCropDrag}
              onpointerup={endCropDrag}
              onpointercancel={endCropDrag}
              onwheel={handleWheelZoom}
            >
              <img
                src={objectUrl}
                alt="头像裁剪预览"
                draggable="false"
                class="chat-avatar-crop-img"
                style:width="{renderWidth}px"
                style:height="{renderHeight}px"
                style:transform="translate(calc(-50% + {offsetX}px), calc(-50% + {offsetY}px))"
              />
              <div class="chat-avatar-crop-mask" aria-hidden="true"></div>
            </div>

            <div class="w-full max-w-[16rem] flex items-center gap-2.5">
              <span class="text-[11px] text-[var(--chat-meta-color)] shrink-0">缩放</span>
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={zoom}
                aria-label="头像缩放比例"
                class="chat-avatar-zoom-slider flex-1 min-w-0"
                oninput={(e) => handleZoomChange(Number(e.currentTarget.value))}
              />
              <span class="text-[11px] text-[var(--chat-meta-color)] tabular-nums w-9 text-right shrink-0">
                {zoom.toFixed(1)}×
              </span>
            </div>
          {:else}
            <button
              type="button"
              class="chat-avatar-dropzone {isDragOver ? 'is-dragover' : ''}"
              onclick={() => fileInputEl?.click()}
              ondragover={(e) => {
                e.preventDefault();
                isDragOver = true;
              }}
              ondragleave={() => (isDragOver = false)}
              ondrop={handleDrop}
            >
              <ChatAvatar
                src={currentAvatar}
                name={userName}
                alt="当前头像预览"
                size="lg"
                class="w-20! h-20! text-xl!"
              />
              <div class="space-y-0.5 text-center">
                <div class="text-xs font-semibold text-[var(--deep-text)]">
                  点击选择图片或拖拽到此处
                </div>
                <div class="text-[11px] text-[var(--chat-meta-color)]">
                  支持 JPG / PNG / WebP，选图后可自由裁剪
                </div>
              </div>
            </button>
          {/if}

          <div class="flex items-center justify-center gap-2 flex-wrap w-full">
            <button
              type="button"
              disabled={isUploading}
              class="btn-regular md:h-8 px-3.5 md:px-3 rounded-xl md:rounded-lg text-xs font-medium cursor-pointer border-none"
              onclick={() => fileInputEl?.click()}
            >
              {objectUrl ? "重新选图" : "选择本地图片"}
            </button>
            <button
              type="button"
              disabled={isUploading}
              class="chat-dialog-inline-action h-10 md:h-8 px-3 md:px-2.5 rounded-xl md:rounded-lg text-xs font-medium text-[var(--chat-accent-text)] bg-transparent border-none cursor-pointer hover:underline"
              onclick={() => {
                errorText = "";
                mode = "url";
              }}
            >
              改用图片链接
            </button>
          </div>
        </div>
      {:else}
        <!-- 图片链接模式 -->
        <div class="flex flex-col items-center gap-3 py-1">
          <ChatAvatar
            src={sanitizeChatUrl(urlInput, false) || currentAvatar}
            name={userName}
            alt="头像链接预览"
            size="lg"
            class="w-20! h-20! text-xl!"
          />
          <div class="w-full space-y-1.5">
            <label for="avatar-modal-url-input" class="block text-xs font-medium text-[var(--chat-meta-color)]">
              图片链接（https://...）
            </label>
            <input
              id="avatar-modal-url-input"
              type="url"
              maxlength={400}
              bind:value={urlInput}
              placeholder="输入图片链接，留空即恢复默认"
              class="chat-auth-input"
              onkeydown={(e) => {
                if (e.key === "Enter" && !e.isComposing) {
                  e.preventDefault();
                  void handleConfirm();
                }
              }}
            />
          </div>
          <button
            type="button"
            class="chat-dialog-inline-action h-8 px-2.5 rounded-lg text-xs font-medium text-[var(--chat-accent-text)] bg-transparent border-none cursor-pointer hover:underline"
            onclick={() => {
              errorText = "";
              mode = "crop";
            }}
          >
            改用本地上传裁剪
          </button>
        </div>
      {/if}

      {#if errorText}
        <p class="m-0 text-xs text-red-500 dark:text-red-400 text-center" role="alert">
          {errorText}
        </p>
      {/if}
    </div>

    <div class="chat-avatar-modal-actions shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-(--chat-divider-color)">
      <button
        type="button"
        disabled={isUploading}
        class="chat-dialog-inline-action text-xs font-medium text-[var(--chat-meta-color)] hover:text-[var(--deep-text)] bg-transparent border-none cursor-pointer p-0 disabled:opacity-50"
        onclick={handleResetDefault}
      >
        恢复默认头像
      </button>

      <div class="flex items-center gap-2 ml-auto">
        <button
          type="button"
          disabled={isUploading}
          class="btn-regular md:h-8.5 px-3.5 rounded-xl text-xs font-medium cursor-pointer border-none disabled:opacity-50"
          onclick={onClose}
        >
          取消
        </button>
        <button
          type="button"
          disabled={isUploading || (mode === "crop" && !objectUrl)}
          class="chat-send-btn md:h-8.5! px-4! rounded-xl! text-xs! inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
          onclick={() => void handleConfirm()}
        >
          {#if isUploading}
            <span class="size-3 border-2 border-current border-r-transparent rounded-full motion-safe:animate-spin" aria-hidden="true"></span>
            <span>上传中…</span>
          {:else}
            <span>确定使用</span>
          {/if}
        </button>
      </div>
    </div>
  </div>
</ChatModal>
