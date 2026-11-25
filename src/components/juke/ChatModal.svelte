<script module lang="ts">
const activeChatModals: HTMLDivElement[] = [];
let backgroundFocus: HTMLElement | null = null;

function topChatModal(): HTMLDivElement | undefined {
	return (
		activeChatModals
			.filter((modal) => modal.classList.contains("chat-modal-backdrop--top"))
			.at(-1) ?? activeChatModals.at(-1)
	);
}

function syncModalStack(): void {
	const top = topChatModal();
	for (const modal of activeChatModals) {
		const behind = modal !== top;
		modal.inert = behind;
		modal.toggleAttribute("data-chat-modal-behind", behind);
	}
	const root = document.documentElement;
	if (top) {
		root.setAttribute("data-chat-modal-open", "true");
	} else {
		root.removeAttribute("data-chat-modal-open");
	}
	for (const id of ["top-row", "chat-page"]) {
		const background = document.getElementById(id);
		if (background) background.inert = Boolean(top);
	}
}
</script>

<script lang="ts">
import type { Snippet } from "svelte";
import { fadeChatSheetBackdrop, slideChatSheetOut } from "./chatSheetMotion";

interface Props {
	open: boolean;
	title: string;
	subtitle?: string;
	ariaLabel?: string;
	size?: "sm" | "md" | "lg";
	mobile?: "compact" | "expandable" | "full";
	fillHeightOnDesktop?: boolean;
	lockedMinHeight?: number;
	topPriority?: boolean;
	showBackButton?: boolean;
	onBack?: () => void;
	onClose: () => void;
	headerExtra?: Snippet;
	children: Snippet;
}

const {
	open,
	title,
	subtitle = "",
	ariaLabel = "",
	size = "sm",
	mobile = "compact",
	fillHeightOnDesktop = false,
	lockedMinHeight = 0,
	topPriority = false,
	showBackButton = false,
	onBack,
	onClose,
	headerExtra,
	children,
}: Props = $props();

let backdropEl: HTMLDivElement | null = $state(null);
let dialogEl: HTMLDivElement | null = $state(null);
let backdropPointerDown = false;
let expanded = $state(false);
let dragOffset = $state(0);
let dragStart: { id: number; y: number } | null = $state(null);
let suppressHandleClick = false;
let isStackedChild = $state(false);

function placeBackdrop(node: HTMLDivElement) {
	const layer = document.getElementById("chat-modal-layer") ?? document.body;
	layer.appendChild(node);
	return {
		destroy() {
			node.remove();
		},
	};
}

$effect(() => {
	// 退场期间弹窗仍挂在 DOM 上，遮罩随 open 状态开始退场。
	backdropEl?.toggleAttribute("data-chat-modal-closing", !open);
});

$effect(() => {
	const backdrop = backdropEl;
	const dialog = dialogEl;
	if (!backdrop || !dialog) return;
	const trigger = document.activeElement;
	if (activeChatModals.length === 0) {
		backgroundFocus = trigger instanceof HTMLElement ? trigger : null;
	}
	activeChatModals.push(backdrop);
	isStackedChild = activeChatModals.indexOf(backdrop) > 0;
	syncModalStack();
	expanded = false;
	dragOffset = 0;
	dragStart = null;
	suppressHandleClick = false;
	const focusFrame = requestAnimationFrame(() => {
		if (open && topChatModal() === backdrop && !dialog.contains(document.activeElement)) {
			dialog.focus({ preventScroll: true });
		}
	});
	const handleKeydown = (e: KeyboardEvent) => {
		if (topChatModal() !== backdrop || e.defaultPrevented || e.isComposing) return;
		if (e.key === "Escape") {
			e.preventDefault();
			if (open) onClose();
			return;
		}
		if (e.key === "Tab") {
			const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
				'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [contenteditable="true"], [tabindex]',
			)).filter((control) => control.tabIndex >= 0 && control.getClientRects().length > 0 && !control.closest("[inert]"));
			const first = controls[0];
			const last = controls.at(-1);
			const active = document.activeElement;
			if (!active || !controls.includes(active as HTMLElement) || active === (e.shiftKey ? first : last)) {
				e.preventDefault();
				(e.shiftKey ? last ?? dialog : first ?? dialog).focus({ preventScroll: true });
			}
		}
	};
	document.addEventListener("keydown", handleKeydown);
	return () => {
		cancelAnimationFrame(focusFrame);
		document.removeEventListener("keydown", handleKeydown);
		const wasTop = topChatModal() === backdrop;
		activeChatModals.splice(activeChatModals.indexOf(backdrop), 1);
		syncModalStack();
		if (!wasTop) return;
		const nextModal = topChatModal();
		const focusTarget = nextModal ? trigger : backgroundFocus;
		if (!nextModal) backgroundFocus = null;
		requestAnimationFrame(() => {
			const active = document.activeElement;
			if (topChatModal() !== nextModal || (active !== document.body && !backdrop.contains(active))) return;
			if (focusTarget instanceof HTMLElement && focusTarget.isConnected && (!nextModal || nextModal.contains(focusTarget))) {
				focusTarget.focus({ preventScroll: true });
			} else {
				nextModal?.querySelector<HTMLElement>(".chat-dialog-card")?.focus({ preventScroll: true });
			}
		});
	};
});

function startDrag(event: PointerEvent) {
	if (!event.isPrimary || event.button !== 0) return;
	suppressHandleClick = false;
	dragStart = { id: event.pointerId, y: event.clientY };
	(event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId);
}

function moveDrag(event: PointerEvent) {
	if (dragStart?.id !== event.pointerId) return;
	const delta = event.clientY - dragStart.y;
	if (Math.abs(delta) > 8) suppressHandleClick = true;
	dragOffset = delta;
}

function finishDrag(event: PointerEvent, cancelled = false) {
	if (dragStart?.id !== event.pointerId) return;
	const delta = event.clientY - dragStart.y;
	dragStart = null;
	dragOffset = 0;
	if (cancelled || Math.abs(delta) <= 8) return;
	suppressHandleClick = true;
	if (delta < -56) expanded = true;
	if (delta > 80) {
		if (expanded) expanded = false;
		else onClose();
	}
}

function handlePointerDown(e: PointerEvent) {
	backdropPointerDown = e.target === backdropEl;
}

function handleBackdropClick(e: MouseEvent) {
	if (backdropPointerDown && e.target === backdropEl) {
		onClose();
	}
	backdropPointerDown = false;
}

const sizeClass = $derived(
	size === "lg"
		? "chat-dialog-card--lg"
		: size === "md"
			? "chat-dialog-card--md"
			: "chat-dialog-card--sm",
);
</script>

{#if open}
  <div
    bind:this={backdropEl}
    use:placeBackdrop
    out:fadeChatSheetBackdrop
    class="chat-modal-backdrop {topPriority ? 'chat-modal-backdrop--top' : ''}"
    role="presentation"
    onpointerdown={handlePointerDown}
    onclick={handleBackdropClick}
  >
    <div
      bind:this={dialogEl}
      out:slideChatSheetOut
      class="chat-dialog-card {sizeClass} {fillHeightOnDesktop ? 'chat-dialog-card--fill-md' : ''}"
      data-chat-sheet={mobile}
      class:chat-sheet-expanded={expanded}
      class:chat-sheet-dragging={Boolean(dragStart)}
      style:--chat-dialog-min-height={lockedMinHeight > 0 ? `min(${lockedMinHeight}px, 100%)` : undefined}
      style:--chat-sheet-drag={dragOffset ? `${dragOffset}px` : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel || title}
      tabindex="-1"
    >
      {#if mobile === "expandable"}
        <button
          type="button"
          class="chat-sheet-handle"
          aria-label={expanded ? "收起面板" : "展开面板"}
          aria-expanded={expanded}
          onpointerdown={startDrag}
          onpointermove={moveDrag}
          onpointerup={finishDrag}
          onpointercancel={(event) => finishDrag(event, true)}
          onlostpointercapture={(event) => finishDrag(event, true)}
          onclick={(event) => {
            if (event.detail === 0 || !suppressHandleClick) expanded = !expanded;
            suppressHandleClick = false;
          }}
        ><span aria-hidden="true"></span></button>
      {/if}
      <header class="chat-dialog-header shrink-0 flex items-center justify-between gap-2.5 px-3.5 py-3 border-b border-(--chat-divider-color)">
        <div class="flex items-center gap-2 min-w-0 flex-1">
          {#if isStackedChild || showBackButton || Boolean(onBack)}
            <button
              type="button"
              class="chat-tool-btn chat-dialog-back shrink-0"
              aria-label="返回上一级"
              onclick={onBack ?? onClose}
            >
              <svg
                class="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
          {/if}
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 min-w-0">
              <h3 class="text-base sm:text-sm font-bold text-[var(--deep-text)] m-0 truncate">
                {title}
              </h3>
              {#if headerExtra}
                {@render headerExtra()}
              {/if}
            </div>
            {#if subtitle}
              <p class="text-xs sm:text-[11px] text-[var(--chat-meta-color)] mt-0.5 mb-0 truncate">
                {subtitle}
              </p>
            {/if}
          </div>
        </div>
        <button
          type="button"
          class="chat-tool-btn chat-dialog-close shrink-0"
          aria-label="关闭弹窗"
          onclick={onClose}
        >
          <svg
            class="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      <div class="chat-dialog-content flex-1 min-h-0 flex flex-col overflow-hidden">
        {@render children()}
      </div>
    </div>
  </div>
{/if}
