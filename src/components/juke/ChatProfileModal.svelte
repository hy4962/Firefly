<script lang="ts">
import { chatPushUnavailableReason, requestNotificationPermission } from "./chatPush";
import Icon from "@/components/common/Icon.svelte";
import ChatAvatar from "./ChatAvatar.svelte";
import ChatModal from "./ChatModal.svelte";
import {
	checkEmailDeliverability,
	normalizeServerUrl,
	resolveCurrentUserEmail,
} from "./chatClient";
import {
	CHAT_STATUS_PRESETS,
	type ChatDesktopNotificationMode,
	type ChatProfileDraft,
	type ChatSessionUser,
	type ChatStatusPreset,
} from "./chatTypes";

interface Props {
	open: boolean;
	currentUser: ChatSessionUser | null;
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
let initialAvatar = "";
let avatarEdited = false;

const roleBadge = $derived.by(() => {
	if (!currentUser) {
		return { label: "访客", type: "tag" as const, hint: "固定访客头衔" };
	}
	if (currentUser.isAdmin) {
		return { label: "站长", type: "host" as const, hint: "固定站长头衔" };
	}
	if (currentUser.authType === "waline") {
		return {
			label: "认证",
			type: "accent" as const,
			hint: "Waline 登录固定头衔",
		};
	}
	return { label: "访客", type: "tag" as const, hint: "访客登录固定头衔" };
});

const isIsolatedGuest = $derived(
	Boolean(
		currentUser?.authType === "guest" &&
			(currentUser?.isolated || currentUser?.userKey.startsWith("guest:iso_")),
	),
);

const userEmail = $derived.by(() => {
	return resolveCurrentUserEmail(currentUser);
});

const emailDeliverability = $derived.by(() => {
	return checkEmailDeliverability(userEmail);
});

const isEmailUndeliverable = $derived(!emailDeliverability.deliverable);

const isNotifyDisabled = $derived(isIsolatedGuest || isEmailUndeliverable);

const notificationUnavailable = $derived(chatPushUnavailableReason());
const isNotificationSupported = $derived(notificationUnavailable === null);

async function handleSelectNotificationMode(mode: ChatDesktopNotificationMode) {
	if (!isNotificationSupported) return;
	if (mode !== "off" && typeof Notification !== "undefined" && Notification.permission === "default") {
		await requestNotificationPermission();
	}
	onChangeDesktopNotificationMode?.(mode);
}

$effect(() => {
	if (open && currentUser) {
		draftNickname = currentUser.name;
		draftStatus =
			currentUser.status &&
			CHAT_STATUS_PRESETS.includes(currentUser.status as ChatStatusPreset)
				? currentUser.status
				: "";
		draftBio = currentUser.bio || "";
		draftUrl = currentUser.url || "";
		draftAvatar = currentUser.avatar || "";
		draftNotifyEmail = isNotifyDisabled
			? false
			: currentUser.notifyEmail !== false;
		initialAvatar = currentUser.avatar || "";
		avatarEdited = false;
	}
});

function handleSubmit(e: SubmitEvent) {
	e.preventDefault();
	if (!currentUser) return;
	const statusValue = CHAT_STATUS_PRESETS.includes(
		draftStatus as ChatStatusPreset,
	)
		? draftStatus
		: "";
	const payload: ChatProfileDraft = {
		nickname: draftNickname.trim().slice(0, 16) || currentUser.name,
		badge: roleBadge.label,
		status: statusValue,
		bio: draftBio.trim().slice(0, 80),
		url: draftUrl.trim().slice(0, 200),
		notifyEmail: isNotifyDisabled ? false : draftNotifyEmail,
	};
	if (avatarEdited || draftAvatar.trim() !== initialAvatar) {
		payload.avatar = draftAvatar.trim().slice(0, 400);
	}
	onSave(payload);
	onClose();
}
</script>

<ChatModal
  open={open && Boolean(currentUser)}
  title="个人资料"
  mobile="full"
  subtitle="修改后将实时同步至在线成员列表与后续消息"
  ariaLabel="编辑个人资料"
  size="md"
  {onClose}
>
  {#if currentUser}
    <form class="flex-1 min-h-0 flex flex-col overflow-hidden" onsubmit={handleSubmit}>
      <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3.5 sm:p-4 space-y-3">
        <!-- 顶部通栏实时名片预览 -->
        <div class="rounded-xl bg-(--btn-regular-bg) px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div class="flex items-center gap-3 min-w-0">
            <ChatAvatar
              src={draftAvatar.trim()}
              name={draftNickname.trim() || currentUser.name}
              alt="头像预览"
              size="md"
            />
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 min-w-0 flex-wrap">
                <span class="text-xs font-bold text-[var(--deep-text)] truncate">
                  {draftNickname.trim() || currentUser.name}
                </span>
                <span class="chat-role-badge chat-role-badge--{roleBadge.type}">
                  {roleBadge.label}
                </span>
                {#if currentUser.customBadges && currentUser.customBadges.length > 0}
                  {#each currentUser.customBadges as b, idx (`${b.text}:${idx}`)}
                    <span class="chat-role-badge chat-role-badge--{b.color}">{b.text}</span>
                  {/each}
                {/if}
              </div>
              <div class="text-[11px] text-[var(--chat-meta-color)] truncate mt-0.5">
                {draftStatus.trim() || "在线"}
              </div>
            </div>
          </div>

          <div class="min-w-0 sm:max-w-[50%] sm:text-right space-y-0.5">
            <div class="text-[11px] text-[var(--deep-text)]/80 truncate">
              {draftBio.trim() || "暂未填写个人简介"}
            </div>
            <div class="flex items-center gap-1.5 flex-wrap sm:justify-end text-[10px] text-[var(--chat-meta-color)]">
              {#if currentUser?.location}
                <span class="inline-flex items-center gap-1 font-medium text-[var(--chat-meta-color)]">
                  <svg class="w-3 h-3 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span>{currentUser.location}</span>
                </span>
              {/if}
              {#if draftUrl.trim()}
                {#if currentUser?.location}
                  <span class="opacity-40 select-none">·</span>
                {/if}
                <span class="text-[var(--chat-accent-text)] truncate opacity-85">
                  {draftUrl.trim()}
                </span>
              {/if}
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 items-start gap-3.5 md:grid-cols-2">
          <!-- 1. 基本资料 (左上) -->
          <div class="md:col-start-1 md:row-start-1">
            <div class="chat-settings-section-title">
              <span>基本资料</span>
            </div>
            <div class="rounded-xl bg-(--btn-regular-bg) px-3 py-2.5 space-y-2.5">
              <div>
                <label for="profile-modal-nick" class="block text-xs font-medium text-(--btn-content) opacity-85 mb-1">
                  展示昵称
                </label>
                <input
                  id="profile-modal-nick"
                  type="text"
                  maxlength={16}
                  bind:value={draftNickname}
                  placeholder="输入展示昵称"
                  class="chat-auth-input"
                />
              </div>

              <div>
                <label for="profile-modal-bio" class="block text-xs font-medium text-(--btn-content) opacity-85 mb-1">
                  个性签名（可选，最多 80 字）
                </label>
                <input
                  id="profile-modal-bio"
                  type="text"
                  maxlength={80}
                  bind:value={draftBio}
                  placeholder="写一句简短介绍，别人点击你的头像时可见"
                  class="chat-auth-input"
                />
              </div>
            </div>
          </div>

          <!-- 2. 主页与头像 (右上) -->
          <div class="md:col-start-2 md:row-start-1">
            <div class="chat-settings-section-title">
              <span>主页与头像</span>
            </div>
            <div class="rounded-xl bg-(--btn-regular-bg) px-3 py-2.5 space-y-2.5">
              <div>
                <label for="profile-modal-url" class="block text-xs font-medium text-(--btn-content) opacity-85 mb-1">
                  个人主页（可选）
                </label>
                <input
                  id="profile-modal-url"
                  type="text"
                  maxlength={200}
                  bind:value={draftUrl}
                  placeholder="https://your-site.com"
                  class="chat-auth-input"
                />
              </div>

              <div>
                <div class="flex items-center justify-between mb-1">
                  <label for="profile-modal-avatar" class="block text-xs font-medium text-(--btn-content) opacity-85">
                    自定义头像链接（可选）
                  </label>
                  <button
                    type="button"
                    class="text-[11px] font-medium text-(--primary) bg-transparent border-none cursor-pointer p-0 hover:underline"
                    onclick={() => {
                      draftAvatar = "";
                      avatarEdited = true;
                    }}
                  >
                    恢复默认
                  </button>
                </div>
                <input
                  id="profile-modal-avatar"
                  type="url"
                  maxlength={400}
                  bind:value={draftAvatar}
                  oninput={() => (avatarEdited = true)}
                  placeholder="留空或点恢复默认即使用账号默认头像"
                  class="chat-auth-input"
                />
              </div>
            </div>
          </div>

        </div>

        <div class="grid grid-cols-1 gap-x-3.5 gap-y-3 md:grid-cols-2">
          <!-- 个性状态 -->
          <div class="flex min-w-0 flex-col gap-1.5">
            <div class="chat-settings-section-title m-0! min-h-6">
              <span>个性状态</span>
              {#if draftStatus}
                <button
                  type="button"
                  class="ml-auto min-h-6 text-[11px] font-normal text-(--primary) hover:underline cursor-pointer"
                  onclick={() => (draftStatus = "")}
                >
                  清除状态
                </button>
              {/if}
            </div>
            <div class="relative min-h-[7.25rem] flex-1 rounded-xl bg-(--btn-regular-bg)">
              <div class="custom-scrollbar absolute inset-x-3 inset-y-2.5 grid grid-cols-4 auto-rows-[calc((100%-0.75rem)/3)] gap-1.5 overflow-y-auto pr-1">
                {#each CHAT_STATUS_PRESETS as preset (preset)}
                  <button
                    type="button"
                    class="min-h-0 w-full inline-flex items-center justify-center px-1 text-xs rounded-lg font-medium active:scale-95 transition-all cursor-pointer border truncate
                      {draftStatus === preset
                        ? 'bg-[var(--primary)] text-white border-[var(--primary)] shadow-xs font-semibold'
                        : 'bg-(--btn-regular-bg) hover:bg-(--btn-regular-bg-hover) text-(--btn-content) opacity-80 hover:opacity-100 border-black/5 dark:border-white/10'}"
                    onclick={() => (draftStatus = draftStatus === preset ? "" : preset)}
                  >
                    {preset}
                  </button>
                {/each}
              </div>
            </div>
          </div>

          <!-- 个人设置 -->
          <div class="flex min-w-0 flex-col gap-1.5">
            <div class="chat-settings-section-title m-0! min-h-6">
              <span>个人设置</span>
            </div>
            <div class="flex-1 space-y-2.5 rounded-xl bg-(--btn-regular-bg) px-3 py-2.5">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-xs font-medium text-(--btn-content)">离线 @ 与回复邮件提醒</div>
                  <div class="text-[11px] text-(--content-meta) mt-0.5 leading-relaxed">
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
                  class="p-0 border-none bg-transparent shrink-0 {isNotifyDisabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'}"
                  onclick={() => {
                    if (isNotifyDisabled) return;
                    draftNotifyEmail = !draftNotifyEmail;
                  }}
                >
                  <span class="chat-switch-track {!isNotifyDisabled && draftNotifyEmail ? 'checked' : ''}" aria-hidden="true">
                    <span class="chat-switch-thumb"></span>
                  </span>
                </button>
              </div>

              <div class="space-y-1">
                <div class="flex min-h-7 items-center justify-between gap-2">
                  <div class="text-xs font-medium text-(--btn-content) flex items-center gap-1.5 whitespace-nowrap">
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
                      class="min-h-7 shrink-0 whitespace-nowrap text-[11px] text-(--primary) hover:underline cursor-pointer"
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
                  <div class="text-[11px] text-red-500 dark:text-red-400 leading-tight">
                    通知已被拦截，请点击地址栏网站权限图标设为允许
                  </div>
                {/if}

                <div class="grid grid-cols-3 gap-0.5 rounded-lg border border-black/5 bg-black/5 p-0.5 dark:border-white/10 dark:bg-white/5">
                  <button
                    type="button"
                    class="flex min-h-7 items-center justify-center gap-1 rounded-md px-1 text-xs font-medium whitespace-nowrap transition-all cursor-pointer border-none
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
                    class="flex min-h-7 items-center justify-center gap-1 rounded-md px-1 text-xs font-medium whitespace-nowrap transition-all cursor-pointer border-none
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
                    class="flex min-h-7 items-center justify-center gap-1 rounded-md px-1 text-xs font-medium whitespace-nowrap transition-all cursor-pointer border-none
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
                  <p class="text-[11px] text-(--content-meta)">{notificationUnavailable}</p>
                {:else if notificationNeedsMigration}
                  <p class="text-[11px] text-(--content-meta)">重新选择提醒档位，即可启用离开网页后仍能收到的浏览器推送。</p>
                {/if}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-(--chat-divider-color)">
        <div class="flex items-center gap-2 shrink-0">
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

        <div class="flex items-center gap-2 ml-auto flex-1 sm:flex-initial justify-end">
          <button
            type="button"
            class="btn-regular flex-1 sm:flex-none md:min-w-24 h-9 px-4 rounded-xl text-xs font-medium active:scale-95 transition-all cursor-pointer border-none"
            onclick={onClose}
          >
            取消
          </button>
          <button
            type="submit"
            class="chat-send-btn flex-1 sm:flex-none md:min-w-28 h-9! px-5! rounded-xl! text-xs!"
          >
            保存资料
          </button>
        </div>
      </div>
    </form>
  {/if}
</ChatModal>
