<script lang="ts">
import ChatModal from "./ChatModal.svelte";

interface Props {
	open: boolean;
	onClose: () => void;
	onSubmit: (
		question: string,
		answers: string[],
		maxSelections: number,
	) => void;
}

const { open, onClose, onSubmit }: Props = $props();

let question = $state("");
let options = $state<string[]>(["", ""]);
let isMultiple = $state(false);
let maxSelections = $state(2);
let error = $state("");

$effect(() => {
	if (!open) {
		question = "";
		options = ["", ""];
		isMultiple = false;
		maxSelections = 2;
		error = "";
	}
});

function addOption() {
	if (options.length < 10) {
		options = [...options, ""];
	}
}

function removeOption(idx: number) {
	if (options.length > 2) {
		options = options.filter((_, i) => i !== idx);
		if (maxSelections > options.length) {
			maxSelections = Math.max(1, options.length);
		}
	}
}

function handleSubmit() {
	const trimmedQuestion = question.trim();
	if (!trimmedQuestion) {
		error = "请输入投票问题";
		return;
	}

	const validOptions = options.map((o) => o.trim()).filter(Boolean);
	if (validOptions.length < 2) {
		error = "至少需要提供 2 个有效选项";
		return;
	}

	const effectiveMax = isMultiple
		? Math.min(validOptions.length, Math.max(1, maxSelections))
		: 1;

	onSubmit(trimmedQuestion, validOptions, effectiveMax);
	onClose();
}
</script>

<ChatModal
  open={open}
  title="发起投票"
  mobile="full"
  subtitle="支持与 Matrix / Element 联邦双向同步"
  size="sm"
  onClose={onClose}
>
  <div class="px-4 pb-4 pt-3 space-y-3.5 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
    <!-- 问题 -->
    <div>
      <label for="chat-poll-q" class="block text-xs font-semibold text-[var(--deep-text)] dark:text-white/90 mb-1.5">
        投票问题 <span class="text-red-500">*</span>
      </label>
      <input
        id="chat-poll-q"
        type="text"
        class="chat-auth-input"
        placeholder="输入要发起的投票主题..."
        maxlength={120}
        bind:value={question}
      />
    </div>

    <!-- 选项列表 -->
    <div>
      <div class="flex items-center justify-between mb-1.5">
        <span class="chat-dialog-option-title text-xs font-semibold text-[var(--deep-text)] dark:text-white/90">
          选项设置 <span class="text-red-500">*</span>
          <span class="text-[11px] font-normal text-[var(--chat-meta-color)]">
            ({options.length}/10)
          </span>
        </span>
        {#if options.length < 10}
          <button
            type="button"
            class="chat-dialog-inline-action text-xs text-[var(--skin-accent)] hover:underline border-none bg-transparent cursor-pointer font-medium"
            onclick={addOption}
          >
            + 添加选项
          </button>
        {/if}
      </div>

      <div class="space-y-2">
        {#each options as opt, idx (idx)}
          <div class="flex items-center gap-1.5">
            <span class="text-xs text-[var(--chat-meta-color)] w-5 shrink-0 text-center font-mono font-medium">
              {idx + 1}.
            </span>
            <input
              type="text"
              class="chat-auth-input flex-1"
              placeholder="选项 {idx + 1}"
              maxlength={60}
              bind:value={options[idx]}
            />
            {#if options.length > 2}
              <button
                type="button"
                class="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-[var(--chat-meta-color)] hover:text-red-500 border-none bg-transparent cursor-pointer transition-colors shrink-0"
                aria-label="删除选项"
                onclick={() => removeOption(idx)}
              >
                ✕
              </button>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <!-- 投票模式与设置 -->
    <div class="rounded-xl bg-[var(--btn-regular-bg)] p-3 space-y-2.5">
      <div class="flex items-center justify-between">
        <span class="chat-dialog-option-title text-xs font-medium text-[var(--deep-text)] dark:text-white/90">
          允许多选
        </span>
        <button
          type="button"
          role="switch"
          aria-label="允许多选"
          aria-checked={isMultiple}
          class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none {isMultiple ? 'bg-[var(--skin-accent)]' : 'bg-black/15 dark:bg-white/20'}"
          onclick={() => (isMultiple = !isMultiple)}
        >
          <span
            aria-hidden="true"
            class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out {isMultiple ? 'translate-x-4' : 'translate-x-0'}"
          ></span>
        </button>
      </div>

      {#if isMultiple}
        <div class="flex items-center justify-between pt-1 border-t border-black/5 dark:border-white/10 text-xs">
          <span class="text-[var(--chat-meta-color)]">最多可选项数</span>
          <div class="flex items-center gap-1.5">
            <select
              class="chat-auth-input py-0.5 px-2 text-xs w-auto"
              bind:value={maxSelections}
            >
              {#each Array.from({ length: Math.max(1, options.length - 1) }, (_, i) => i + 2) as count}
                <option value={count}>{count} 项</option>
              {/each}
            </select>
          </div>
        </div>
      {/if}
    </div>

    {#if error}
      <div class="text-xs text-red-500 font-medium">{error}</div>
    {/if}
  </div>

  <div class="chat-poll-modal-actions flex shrink-0 items-center justify-end gap-2 px-4 pb-4">
    <button
      type="button"
      class="chat-header-pill-btn h-8! px-3! text-xs! font-medium cursor-pointer"
      onclick={onClose}
    >
      取消
    </button>
    <button
      type="button"
      class="chat-send-btn h-8! px-4! text-xs! font-semibold cursor-pointer"
      onclick={handleSubmit}
    >
      发起投票
    </button>
  </div>
</ChatModal>
