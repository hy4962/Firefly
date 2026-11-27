<script lang="ts">
import { tick } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import ChatAvatar from "./ChatAvatar.svelte";
import ChatAvatarCropModal from "./ChatAvatarCropModal.svelte";
import ChatModal from "./ChatModal.svelte";
import {
	checkEmailDeliverability,
	normalizeServerUrl,
	resolveCurrentUserEmail,
	sanitizeChatUrl,
} from "./chatClient";
import {
	chatPushUnavailableReason,
	requestNotificationPermission,
} from "./chatPush";
import {
	CHAT_STATUS_PRESETS,
	type ChatDesktopNotificationMode,
	type ChatProfileDraft,
	type ChatSessionUser,
	type ChatStatusPreset,
} from "./chatTypes";

type EditableField = "nickname" | "bio" | "url";

interface Props {
	open: boolean;
	currentUser: ChatSessionUser | null;
	chatServerUrl?: string;
	auth?: { kind: "waline" | "guest"; token: string } | null;
	walineServerUrl?: string;
	desktopNotificationMode?: ChatDesktopNotificationMode;
	desktopNotificationPermission?: NotificationPermission;
	onChangeDesktopNotificationMode?: (mode: ChatDesktopNotificationMode) => void;
	notificationSaving?: boolean;
	notificationTesting?: boolean;
	notificationTestSeconds?: number;
	notificationNeedsMigration?: boolean;
	onTestNotification?: () => void;
	onSave: (draft: ChatProfileDraft) => void;
	onClose: () => void;
	onLogout?: () => void;
}

const {
	open,
	currentUser = null,
	chatServerUrl = "",
	auth = null,
	walineServerUrl = "",
	desktopNotificationMode = "off",
	desktopNotificationPermission = "default" as NotificationPermission,
	onChangeDesktopNotificationMode,
	notificationSaving = false,
	notificationTesting = false,
	notificationTestSeconds = 0,
	notificationNeedsMigration = false,
	onTestNotification,
	onSave,
	onClose,
	onLogout,
}: Props = $props();

const walineProfileUrl = $derived.by(() => {
	const base = normalizeServerUrl(walineServerUrl);
	return base ? `${base}/ui/profile?lng=zh-CN` : "";
});

let draftNickname = $state("");
let draftStatus = $state("");
let draftBio = $state("");
let draftUrl = $state("");
let draftAvatar = $state("");
let draftNotifyEmail = $state(true);

let editingField = $state<EditableField | null>(null);
let editingValue = $state("");
let statusPickerOpen = $state(false);
let avatarModalOpen = $state(false);
let activeInputEl = $state<HTMLInputElement | null>(null);
let heroEl = $state<HTMLElement | null>(null);
let wasOpen = false;

const roleBadge = $derived.by(() => {
	if (!currentUser) {
		return { label: "访客", type: "tag" as const };
	}
	if (currentUser.isAdmin) {
		return { label: "站长", type: "host" as const };
	}
	if (currentUser.authType === "waline") {
		return { label: "认证", type: "accent" as const };
	}
	return { label: "访客", type: "tag" as const };
});

const isIsolatedGuest = $derived(
	Boolean(
		currentUser?.authType === "guest" &&
			(currentUser?.isolated || currentUser?.userKey.startsWith("guest:iso_")),
	),
);

const userEmail = $derived.by(() => resolveCurrentUserEmail(currentUser));
const emailDeliverability = $derived.by(() =>
	checkEmailDeliverability(userEmail),
);
const isEmailUndeliverable = $derived(!emailDeliverability.deliverable);
const isNotifyDisabled = $derived(isIsolatedGuest || isEmailUndeliverable);

const notificationUnavailable = $derived(chatPushUnavailableReason());
const isNotificationSupported = $derived(notificationUnavailable === null);

const safeDisplayUrl = $derived(sanitizeChatUrl(draftUrl, false));

const accountOriginText = $derived.by(() => {
	if (!currentUser) return "";
	const parts: string[] = [];
	if (currentUser.authType === "waline") {
		parts.push("Waline 已认证");
	} else {
		parts.push(isIsolatedGuest ? "临时访客" : "访客身份");
	}
	if (currentUser.location) {
		parts.push(currentUser.location);
	}
	return parts.join(" · ");
});

function normalizePresetStatus(raw?: string): string {
	if (!raw) return "";
	return CHAT_STATUS_PRESETS.includes(raw as ChatStatusPreset) ? raw : "";
}

$effect(() => {
	if (!open) {
		wasOpen = false;
		editingField = null;
		editingValue = "";
		statusPickerOpen = false;
		avatarModalOpen = false;
		return;
	}
	if (!currentUser) return;
	const justOpened = !wasOpen;
	wasOpen = true;
	if (justOpened || editingField !== "nickname") {
		draftNickname = currentUser.name;
	}
	draftStatus = normalizePresetStatus(currentUser.status);
	if (justOpened || editingField !== "bio") {
		draftBio = currentUser.bio || "";
	}
	if (justOpened || editingField !== "url") {
		draftUrl = currentUser.url || "";
	}
	draftAvatar = currentUser.avatar || "";
	draftNotifyEmail = isNotifyDisabled
		? false
		: currentUser.notifyEmail !== false;
});

$effect(() => {
	if (!open || avatarModalOpen || (editingField === null && !statusPickerOpen))
		return;

	const handlePointerDown = (event: PointerEvent) => {
		const target = event.target;
		if (!(target instanceof Node)) return;
		if (statusPickerOpen && heroEl && !heroEl.contains(target)) {
			statusPickerOpen = false;
		}
	};

	const handleKeydown = (event: KeyboardEvent) => {
		if (event.isComposing || event.key !== "Escape") return;
		if (editingField !== null || statusPickerOpen) {
			event.preventDefault();
			event.stopPropagation();
			cancelEdit();
			statusPickerOpen = false;
		}
	};

	document.addEventListener("pointerdown", handlePointerDown, {
		capture: true,
	});
	document.addEventListener("keydown", handleKeydown, { capture: true });
	return () => {
		document.removeEventListener("pointerdown", handlePointerDown, {
			capture: true,
		});
		document.removeEventListener("keydown", handleKeydown, { capture: true });
	};
});

function commitProfile(patch: Partial<ChatProfileDraft>) {
	if (!currentUser) return;
	const nextNickname =
		(patch.nickname ?? draftNickname).trim().slice(0, 16) || currentUser.name;
	const nextStatus = normalizePresetStatus(patch.status ?? draftStatus);
	const nextBio = (patch.bio ?? draftBio).trim().slice(0, 80);
	const nextUrl = (patch.url ?? draftUrl).trim().slice(0, 200);
	const nextNotifyEmail = isNotifyDisabled
		? false
		: (patch.notifyEmail ?? draftNotifyEmail);

	draftNickname = nextNickname;
	draftStatus = nextStatus;
	draftBio = nextBio;
	draftUrl = nextUrl;
	draftNotifyEmail = nextNotifyEmail;

	const payload: ChatProfileDraft = {
		nickname: nextNickname,
		badge: roleBadge.label,
		status: nextStatus,
		bio: nextBio,
		url: nextUrl,
		notifyEmail: nextNotifyEmail,
	};
	if (typeof patch.avatar === "string") {
		const nextAvatar = patch.avatar.trim().slice(0, 400);
		draftAvatar = nextAvatar;
		payload.avatar = nextAvatar;
	}
	onSave(payload);
}

async function startEdit(field: EditableField) {
	statusPickerOpen = false;
	editingField = field;
	if (field === "nickname") editingValue = draftNickname;
	else if (field === "bio") editingValue = draftBio;
	else editingValue = draftUrl;
	await tick();
	activeInputEl?.focus({ preventScroll: true });
	if (field === "nickname" || field === "url") {
		activeInputEl?.select();
	}
}

function cancelEdit() {
	editingField = null;
	editingValue = "";
}

function confirmEdit(): boolean {
	if (!editingField || !currentUser) return false;
	const field = editingField;
	if (field === "nickname") {
		const next = editingValue.trim().slice(0, 16) || currentUser.name;
		if (next !== draftNickname) {
			commitProfile({ nickname: next });
		}
	} else if (field === "bio") {
		const next = editingValue.trim().slice(0, 80);
		if (next !== draftBio) {
			commitProfile({ bio: next });
		}
	} else if (field === "url") {
		const next = editingValue.trim().slice(0, 200);
		if (next !== draftUrl) {
			commitProfile({ url: next });
		}
	}
	editingField = null;
	editingValue = "";
	return true;
}

function handleInlineKeydown(event: KeyboardEvent) {
	if (event.isComposing) return;
	if (event.key === "Enter") {
		event.preventDefault();
		confirmEdit();
	} else if (event.key === "Escape") {
		event.preventDefault();
		event.stopPropagation();
		cancelEdit();
	}
}

function handleStatusSelect(preset: string) {
	const next = draftStatus === preset ? "" : preset;
	if (next !== draftStatus) {
		commitProfile({ status: next });
	}
	statusPickerOpen = false;
}

function handleDone() {
	if (editingField) {
		confirmEdit();
	}
	statusPickerOpen = false;
	onClose();
}

async function handleSelectNotificationMode(mode: ChatDesktopNotificationMode) {
	if (!isNotificationSupported) return;
	if (
		mode !== "off" &&
		typeof Notification !== "undefined" &&
		Notification.permission === "default"
	) {
		await requestNotificationPermission();
	}
	onChangeDesktopNotificationMode?.(mode);
}
</script>

{#snippet pencilIcon(sizeClass = "size-3")}
  <svg class={sizeClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </svg>
{/snippet}

{#snippet checkIcon()}
  <svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
{/snippet}

{#snippet closeIcon()}
  <svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
{/snippet}

<ChatModal
  open={open && Boolean(currentUser)}
  title="个人资料"
  mobile="full"
  subtitle="点击小铅笔可直接编辑，修改后立即同步"
  ariaLabel="编辑个人资料"
  size="md"
  dialogClass="chat-profile-dialog"
  {onClose}
>
  {#if currentUser}
    <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div class="chat-profile-fields flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 sm:p-5 space-y-5">
        <!-- 1. 顶部身份名片（64px 大头像 + 昵称 + 状态 + 悬浮编辑浮层） -->
        <section bind:this={heroEl} class="chat-profile-hero">
          <div class="flex items-center gap-4 min-w-0">
            <button
              type="button"
              class="chat-profile-avatar-btn shrink-0"
              aria-label="更换或裁剪头像"
              onclick={() => {
                cancelEdit();
                statusPickerOpen = false;
                avatarModalOpen = true;
              }}
            >
              <ChatAvatar
                src={draftAvatar.trim()}
                name={draftNickname || currentUser.name}
                alt="当前头像"
                size="lg"
                class="w-16! h-16! text-lg!"
              />
              <span class="chat-profile-avatar-badge" aria-hidden="true">
                {@render pencilIcon("size-2.5")}
              </span>
            </button>

            <div class="min-w-0 flex-1 space-y-1.5">
              <div class="chat-profile-name-slot">
                {#if editingField === "nickname"}
                  <div class="flex items-center gap-1.5 w-full min-w-0">
                    <input
                      bind:this={activeInputEl}
                      type="text"
                      maxlength={16}
                      bind:value={editingValue}
                      placeholder="输入展示昵称"
                      aria-label="展示昵称"
                      class="chat-auth-input chat-profile-inline-input flex-1 min-w-0"
                      onkeydown={handleInlineKeydown}
                    />
                    <button
                      type="button"
                      class="chat-profile-confirm-btn"
                      aria-label="保存昵称"
                      onclick={confirmEdit}
                    >
                      {@render checkIcon()}
                    </button>
                    <button
                      type="button"
                      class="chat-profile-cancel-btn"
                      aria-label="取消编辑昵称"
                      onclick={cancelEdit}
                    >
                      {@render closeIcon()}
                    </button>
                  </div>
                {:else}
                  <div class="flex items-center gap-1.5 min-w-0 flex-wrap">
                    <span class="chat-sheet-primary text-base font-bold text-[var(--deep-text)] truncate">
                      {draftNickname || currentUser.name}
                    </span>
                    <button
                      type="button"
                      class="chat-profile-pencil-btn"
                      aria-label="编辑昵称"
                      onclick={() => void startEdit("nickname")}
                    >
                      {@render pencilIcon()}
                    </button>
                    <span class="chat-role-badge chat-role-badge--{roleBadge.type}">
                      {roleBadge.label}
                    </span>
                    {#if currentUser.customBadges && currentUser.customBadges.length > 0}
                      {#each currentUser.customBadges as b, idx (`${b.text}:${idx}`)}
                        <span class="chat-role-badge chat-role-badge--{b.color}">{b.text}</span>
                      {/each}
                    {/if}
                  </div>
                {/if}
              </div>

              <div class="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  class="chat-profile-status-pill {draftStatus ? 'is-active' : ''}"
                  aria-expanded={statusPickerOpen}
                  onclick={() => {
                    if (editingField) cancelEdit();
                    statusPickerOpen = !statusPickerOpen;
                  }}
                >
                  <span class="chat-profile-status-dot" aria-hidden="true"></span>
                  <span>{draftStatus || "在线 · 设置状态"}</span>
                  <svg
                    class="size-3 opacity-70 transition-transform duration-150 {statusPickerOpen ? 'rotate-180' : ''}"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>

                {#if accountOriginText}
                  <span class="text-xs text-[var(--chat-meta-color)] truncate">
                    {accountOriginText}
                  </span>
                {/if}
              </div>
            </div>
          </div>

          {#if statusPickerOpen}
            <div class="chat-profile-popover" role="region" aria-label="选择当前状态">
              <div class="flex items-center justify-between gap-2 mb-2">
                <span class="text-xs font-medium text-[var(--chat-meta-color)]">
                  选择当前状态
                </span>
                {#if draftStatus}
                  <button
                    type="button"
                    class="chat-dialog-inline-action text-xs font-medium text-(--primary) bg-transparent border-none cursor-pointer p-0 hover:underline"
                    onclick={() => handleStatusSelect("")}
                  >
                    清除状态
                  </button>
                {/if}
              </div>
              <div class="chat-profile-status-chips custom-scrollbar">
                {#each CHAT_STATUS_PRESETS as preset (preset)}
                  <button
                    type="button"
                    class="chat-profile-status-chip {draftStatus === preset ? 'is-selected' : ''}"
                    aria-pressed={draftStatus === preset}
                    onclick={() => handleStatusSelect(preset)}
                  >
                    {preset}
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </section>

        <!-- 2. 资料详情（等高轻量列表 + 迷你小铅笔行内编辑） -->
        <section class="space-y-1.5">
          <div class="chat-settings-section-title m-0!">
            <span>资料详情</span>
          </div>

          <div class="chat-profile-list-card">
            <!-- 个性签名 -->
            <div class="chat-profile-row">
              <span class="chat-profile-row-label">个性签名</span>
              {#if editingField === "bio"}
                <div class="chat-profile-row-editor">
                  <div class="relative flex-1 min-w-0">
                    <input
                      bind:this={activeInputEl}
                      type="text"
                      maxlength={80}
                      bind:value={editingValue}
                      placeholder="写一句简短介绍，别人点开你的头像时可见"
                      aria-label="个性签名"
                      class="chat-auth-input chat-profile-inline-input w-full pr-12!"
                      onkeydown={handleInlineKeydown}
                    />
                    <span class="chat-profile-char-count tabular-nums">
                      {editingValue.length}/80
                    </span>
                  </div>
                  <button
                    type="button"
                    class="chat-profile-confirm-btn"
                    aria-label="保存个性签名"
                    onclick={confirmEdit}
                  >
                    {@render checkIcon()}
                  </button>
                  <button
                    type="button"
                    class="chat-profile-cancel-btn"
                    aria-label="取消编辑个性签名"
                    onclick={cancelEdit}
                  >
                    {@render closeIcon()}
                  </button>
                </div>
              {:else}
                <div class="chat-profile-row-value-wrap">
                  {#if draftBio}
                    <span class="chat-profile-row-value">{draftBio}</span>
                  {:else}
                    <span class="chat-profile-row-placeholder">未设置个性签名</span>
                  {/if}
                  <button
                    type="button"
                    class="chat-profile-pencil-btn"
                    aria-label="编辑个性签名"
                    onclick={() => void startEdit("bio")}
                  >
                    {@render pencilIcon()}
                  </button>
                </div>
              {/if}
            </div>

            <!-- 个人主页 -->
            <div class="chat-profile-row">
              <span class="chat-profile-row-label">个人主页</span>
              {#if editingField === "url"}
                <div class="chat-profile-row-editor">
                  <input
                    bind:this={activeInputEl}
                    type="url"
                    maxlength={200}
                    bind:value={editingValue}
                    placeholder="https://your-site.com"
                    aria-label="个人主页"
                    class="chat-auth-input chat-profile-inline-input flex-1 min-w-0"
                    onkeydown={handleInlineKeydown}
                  />
                  <button
                    type="button"
                    class="chat-profile-confirm-btn"
                    aria-label="保存个人主页"
                    onclick={confirmEdit}
                  >
                    {@render checkIcon()}
                  </button>
                  <button
                    type="button"
                    class="chat-profile-cancel-btn"
                    aria-label="取消编辑个人主页"
                    onclick={cancelEdit}
                  >
                    {@render closeIcon()}
                  </button>
                </div>
              {:else}
                <div class="chat-profile-row-value-wrap">
                  {#if safeDisplayUrl}
                    <a
                      href={safeDisplayUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="chat-profile-row-link"
                    >
                      {safeDisplayUrl}
                    </a>
                  {:else if draftUrl}
                    <span class="chat-profile-row-value">{draftUrl}</span>
                  {:else}
                    <span class="chat-profile-row-placeholder">未填写个人主页</span>
                  {/if}
                  <button
                    type="button"
                    class="chat-profile-pencil-btn"
                    aria-label="编辑个人主页"
                    onclick={() => void startEdit("url")}
                  >
                    {@render pencilIcon()}
                  </button>
                </div>
              {/if}
            </div>
          </div>
        </section>

        <!-- 3. 消息提醒 -->
        <section class="space-y-1.5">
          <div class="chat-settings-section-title m-0!">
            <span>消息提醒</span>
          </div>

          <div class="chat-profile-list-card">
            <!-- 离线邮件提醒 -->
            <div class="chat-profile-setting-row">
              <div class="min-w-0 flex-1">
                <div class="chat-profile-setting-title text-xs font-medium text-(--btn-content)">离线 @ 与回复邮件提醒</div>
                <div class="chat-profile-setting-desc text-[11px] text-(--content-meta) mt-0.5 leading-relaxed">
                  {#if isIsolatedGuest}
                    独立临时身份未经邮箱所有权验证，已禁用离线邮件提醒，防止误发邮件
                  {:else if isEmailUndeliverable}
                    <span class="text-red-500 dark:text-red-400 font-medium inline-block">
                      当前邮箱 {userEmail ? `(${userEmail})` : ""} 为不可送达地址（{emailDeliverability.reason || "无法送达"}），已禁用邮件提醒
                    </span>
                  {:else}
                    不在线时有人 @ 或回复你，将发送摘要至邮箱账号
                  {/if}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isNotifyDisabled ? false : draftNotifyEmail}
                aria-label="切换离线 @ 邮件提醒"
                disabled={isNotifyDisabled}
                class="chat-profile-switch-btn p-0 border-none bg-transparent shrink-0 {isNotifyDisabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'}"
                onclick={() => {
                  if (isNotifyDisabled) return;
                  commitProfile({ notifyEmail: !draftNotifyEmail });
                }}
              >
                <span class="chat-switch-track {!isNotifyDisabled && draftNotifyEmail ? 'checked' : ''}" aria-hidden="true">
                  <span class="chat-switch-thumb"></span>
                </span>
              </button>
            </div>

            <!-- 浏览器推送 -->
            <div class="chat-profile-setting-block">
              <div class="flex min-h-6 sm:min-h-7 flex-wrap sm:flex-nowrap items-center justify-between gap-2">
                <div class="chat-profile-setting-title text-xs font-medium text-(--btn-content) flex items-center gap-1.5 whitespace-nowrap">
                  <span>浏览器推送</span>
                  <span class="inline-flex size-3 items-center justify-center" role="status">
                    {#if notificationSaving}
                      <span class="size-3 border-2 border-current border-r-transparent rounded-full motion-safe:animate-spin" aria-hidden="true"></span>
                      <span class="sr-only">正在同步提醒档位</span>
                    {/if}
                  </span>
                  {#if desktopNotificationPermission === "denied"}
                    <span class="text-[10px] font-normal px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 dark:text-red-400 border border-red-500/20">
                      权限受阻
                    </span>
                  {/if}
                </div>
                {#if isNotificationSupported && desktopNotificationPermission === "granted" &&
                  desktopNotificationMode !== "off" && !notificationSaving && !notificationTesting && notificationTestSeconds === 0}
                  <button
                    type="button"
                    class="chat-dialog-inline-action min-h-7 shrink-0 whitespace-nowrap text-[11px] text-(--primary) hover:underline cursor-pointer bg-transparent border-none p-0"
                    onclick={() => onTestNotification?.()}
                  >发送测试推送</button>
                {:else}
                  <span class="inline-flex min-h-7 shrink-0 items-center whitespace-nowrap text-[11px] text-(--content-meta)">
                    发送测试推送{#if notificationTestSeconds > 0}
                      <span class="ml-0.5 tabular-nums">（{notificationTestSeconds} 秒）</span>
                    {/if}
                  </span>
                {/if}
              </div>

              {#if desktopNotificationPermission === "denied"}
                <div class="chat-profile-push-notice text-[11px] text-red-500 dark:text-red-400 leading-tight">
                  通知已被拦截，请点击地址栏网站权限图标设为允许
                </div>
              {/if}

              <div class="grid grid-cols-3 gap-0.5 rounded-lg border border-black/5 bg-black/5 p-0.5 dark:border-white/10 dark:bg-white/5">
                <button
                  type="button"
                  class="chat-profile-notification-option flex min-h-7 items-center justify-center gap-1 rounded-md px-1 text-xs font-medium whitespace-nowrap transition-all cursor-pointer border-none
                    {desktopNotificationMode === 'off'
                      ? 'bg-[var(--primary)] text-white shadow-xs font-semibold'
                      : 'bg-transparent text-(--btn-content) opacity-75 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5'}"
                  aria-pressed={desktopNotificationMode === "off"}
                  onclick={() => handleSelectNotificationMode("off")}
                >
                  <Icon icon="mingcute:notification-off-line" class="size-3 shrink-0" />
                  <span>关闭</span>
                </button>
                <button
                  type="button"
                  class="chat-profile-notification-option flex min-h-7 items-center justify-center gap-1 rounded-md px-1 text-xs font-medium whitespace-nowrap transition-all cursor-pointer border-none
                    {desktopNotificationMode === 'mention'
                      ? 'bg-[var(--primary)] text-white shadow-xs font-semibold'
                      : 'bg-transparent text-(--btn-content) opacity-75 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5'}"
                  aria-pressed={desktopNotificationMode === "mention"}
                  onclick={() => handleSelectNotificationMode("mention")}
                >
                  <Icon icon="mingcute:notification-newdot-line" class="size-3 shrink-0" />
                  <span>仅提及</span>
                </button>
                <button
                  type="button"
                  class="chat-profile-notification-option flex min-h-7 items-center justify-center gap-1 rounded-md px-1 text-xs font-medium whitespace-nowrap transition-all cursor-pointer border-none
                    {desktopNotificationMode === 'all'
                      ? 'bg-[var(--primary)] text-white shadow-xs font-semibold'
                      : 'bg-transparent text-(--btn-content) opacity-75 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5'}"
                  aria-pressed={desktopNotificationMode === "all"}
                  onclick={() => handleSelectNotificationMode("all")}
                >
                  <Icon icon="mingcute:bell-ringing-line" class="size-3 shrink-0" />
                  <span>全部消息</span>
                </button>
              </div>

              {#if !isNotificationSupported}
                <p class="chat-profile-push-notice text-[11px] text-(--content-meta) m-0">{notificationUnavailable}</p>
              {:else if notificationNeedsMigration}
                <p class="chat-profile-push-notice text-[11px] text-(--content-meta) m-0">重新选择提醒档位，即可启用离开网页后仍能收到的浏览器推送。</p>
              {/if}
            </div>
          </div>
        </section>
      </div>

      <div class="chat-profile-actions shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-(--chat-divider-color)">
        <div class="chat-profile-secondary-actions flex items-center gap-2 shrink-0">
          {#if onLogout}
            <button
              type="button"
              class="btn-regular h-9 px-3 rounded-xl text-xs font-medium inline-flex items-center gap-1.5 text-red-500 hover:text-red-600 hover:bg-red-500/10 active:scale-95 transition-all cursor-pointer border-none shrink-0"
              onclick={() => {
                onLogout();
                onClose();
              }}
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>退出登录</span>
            </button>
          {/if}

          {#if walineProfileUrl}
            <a
              href={walineProfileUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="btn-regular h-9 px-3 rounded-xl text-xs font-medium inline-flex items-center gap-1.5 no-underline shrink-0"
            >
              <span>{currentUser.authType === "waline" ? "Waline 个人中心" : "前往 Waline 平台"}</span>
              <span class="text-[11px] opacity-80">↗</span>
            </a>
          {/if}
        </div>

        <button
          type="button"
          class="chat-send-btn chat-profile-done-btn md:min-w-24 md:h-9! md:px-5! rounded-xl! text-xs! md:ml-auto"
          onclick={handleDone}
        >
          完成
        </button>
      </div>
    </div>

    <ChatAvatarCropModal
      open={open && avatarModalOpen}
      currentAvatar={draftAvatar.trim()}
      userName={draftNickname || currentUser.name}
      {chatServerUrl}
      {auth}
      onApplyAvatar={(url) => commitProfile({ avatar: url })}
      onResetDefault={() => commitProfile({ avatar: "" })}
      onClose={() => (avatarModalOpen = false)}
    />
  {/if}
</ChatModal>
