<script lang="ts">
import {
	Check,
	Copy,
	Laptop,
	LoaderCircle,
	MapPin,
	Monitor,
	Pencil,
	Reply,
	RotateCcw,
	Trash2,
	X,
} from "lucide-svelte";
import type { GuestbookChatMessage } from "@/types/guestbook-chat";
import { getGuestbookInitials } from "@/utils/guestbook-chat";
import {
	renderGuestbookMessage,
	renderGuestbookQuotePreview,
} from "@/utils/guestbook-chat-markup";
import { GB_LANG } from "@/utils/guestbook-lang";

interface Props {
	message: GuestbookChatMessage;
	referencedMessage?: GuestbookChatMessage;
	timeLabel: string;
	canManage: boolean;
	isEditing: boolean;
	isMutating: boolean;
	editDraft: string;
	actionError?: string;
	onReply: (message: GuestbookChatMessage) => void;
	onEdit: (message: GuestbookChatMessage) => void;
	onEditDraftChange: (draft: string) => void;
	onEditCancel: () => void;
	onEditSave: (message: GuestbookChatMessage) => void;
	onDelete: (message: GuestbookChatMessage) => void;
	onJump: (message: GuestbookChatMessage) => void;
	onRetry: (message: GuestbookChatMessage) => void;
	onDiscard: (message: GuestbookChatMessage) => void;
	onCopyError: (message: string) => void;
}

let {
	message,
	referencedMessage,
	timeLabel,
	canManage,
	isEditing,
	isMutating,
	editDraft,
	actionError,
	onReply,
	onEdit,
	onEditDraftChange,
	onEditCancel,
	onEditSave,
	onDelete,
	onJump,
	onRetry,
	onDiscard,
	onCopyError,
}: Props = $props();

let copied = $state(false);

const quotePreview = $derived(
	referencedMessage
		? renderGuestbookQuotePreview(referencedMessage.body)
		: GB_LANG.gbQuoteNotLoaded,
);
const renderedBody = $derived(renderGuestbookMessage(message.body));

async function copyMessage() {
	try {
		await navigator.clipboard.writeText(message.body);
		copied = true;
		window.setTimeout(() => (copied = false), 1600);
	} catch {
		onCopyError(GB_LANG.gbCopyFailed);
	}
}
</script>

<article
	id={`guestbook-message-${message.id}`}
	class:is-admin={message.isAdmin}
	class:is-failed={message.localState === "failed"}
	class:is-sending={message.localState === "sending"}
	class="guestbook-message"
>
	{#if message.replyToId}
		<button
			class="guestbook-message__quote"
			type="button"
			onclick={() => onJump(message)}
			aria-label={GB_LANG.gbJumpToQuoteAria.replace(
				"{nick}",
				message.replyToNick || GB_LANG.gbVisitor,
			)}
			title={GB_LANG.gbJumpToQuoteTitle}
		>
			<span class="guestbook-message__quote-avatar" aria-hidden="true">
				<span>{getGuestbookInitials(referencedMessage?.nick || message.replyToNick || GB_LANG.gbVisitor)}</span>
				{#if referencedMessage?.avatar}
					<img
						src={referencedMessage.avatar}
						alt=""
						loading="lazy"
						referrerpolicy="no-referrer"
						onerror={(event) =>
							((event.currentTarget as HTMLImageElement).style.display = "none")}
					/>
				{/if}
			</span>
			<span class="guestbook-message__quote-copy">
				<strong>@{message.replyToNick || GB_LANG.gbVisitor}</strong>
				<small>{@html quotePreview}</small>
			</span>
		</button>
	{/if}

	<div class="guestbook-message__main">
	<div class="guestbook-message__avatar" aria-hidden="true">
		<span>{getGuestbookInitials(message.nick)}</span>
		{#if message.avatar}
			<img
				src={message.avatar}
				alt=""
				loading="lazy"
				referrerpolicy="no-referrer"
				onerror={(event) =>
					((event.currentTarget as HTMLImageElement).style.display = "none")}
			/>
		{/if}
	</div>

	<div class="guestbook-message__column">
		<div class="guestbook-message__heading">
			<span class="guestbook-message__author">
				{#if message.link}
					<a
						class="guestbook-message__author-link"
						href={message.link}
						target="_blank"
						rel="nofollow noopener noreferrer"
						title={GB_LANG.gbVisitSiteTitle.replace(
							"{nick}",
							message.nick,
						)}
					>
						{message.nick}
					</a>
				{:else}
					<strong>{message.nick}</strong>
				{/if}
			</span>
			{#if message.isAdmin}
				<span class="guestbook-message__badge guestbook-message__badge--admin">{GB_LANG.gbAdmin}</span>
			{/if}
			{#if message.label}
				<span class="guestbook-message__badge">{message.label}</span>
			{/if}
			<time
				class="guestbook-message__time"
				datetime={new Date(message.createdAt).toISOString()}>{timeLabel}</time
			>
			{#if message.status === "waiting"}
				<span class="guestbook-message__badge guestbook-message__badge--waiting">{GB_LANG.gbPendingReview}</span>
			{/if}
		</div>

		<div class="guestbook-message__bubble-row">
			<div class="guestbook-message__bubble">
				{#if isEditing}
					<textarea
						class="guestbook-message__edit-input"
						value={editDraft}
						oninput={(event) => onEditDraftChange(event.currentTarget.value)}
						maxlength="300"
						rows="4"
						disabled={isMutating}
						aria-label={GB_LANG.gbEditMessageWithName.replace(
							"{nick}",
							message.nick,
						)}
					></textarea>
					<div class="guestbook-message__edit-actions">
						<span>{GB_LANG.gbCharCount
							.replace("{count}", String(editDraft.length))
							.replace("{max}", "300")}</span>
						<button type="button" onclick={onEditCancel} disabled={isMutating}>
							<X size={14} aria-hidden="true" />{GB_LANG.cancel}
						</button>
						<button
							type="button"
							onclick={() => onEditSave(message)}
							disabled={isMutating}
						>
							{#if isMutating}
								<LoaderCircle class="is-spinning" size={14} aria-hidden="true" />
							{:else}
								<Check size={14} aria-hidden="true" />
							{/if}
							{isMutating ? GB_LANG.saving : GB_LANG.save}
						</button>
					</div>
				{:else}
					<div class="guestbook-message__body">{@html renderedBody}</div>
				{/if}
			</div>

			{#if !message.localState && !isEditing}
				<div class="guestbook-message__tools" role="group" aria-label={GB_LANG.gbMessageActionsAria}>
					<button
						type="button"
						onclick={() => onReply(message)}
						aria-label={GB_LANG.gbReplyAria.replace(
							"{nick}",
							message.nick,
						)}
						title={GB_LANG.gbQuoteReply}
					>
						<Reply size={15} aria-hidden="true" />
					</button>
					<button
						type="button"
						onclick={copyMessage}
						aria-label={copied
							? GB_LANG.gbCopied
							: GB_LANG.gbCopyMessage}
						title={copied
							? GB_LANG.gbCopied
							: GB_LANG.gbCopyMessage}
					>
						{#if copied}
							<Check size={15} aria-hidden="true" />
						{:else}
							<Copy size={15} aria-hidden="true" />
						{/if}
					</button>
					{#if canManage}
						<button
							type="button"
							onclick={() => onEdit(message)}
							aria-label={GB_LANG.gbEditMessage}
							title={GB_LANG.gbEditMessage}
							disabled={isMutating}
						>
							<Pencil size={15} aria-hidden="true" />
						</button>
						<button
							type="button"
							onclick={() => onDelete(message)}
							aria-label={GB_LANG.gbDeleteMessage}
							title={GB_LANG.gbDeleteMessage}
							disabled={isMutating}
						>
							<Trash2 size={15} aria-hidden="true" />
						</button>
					{/if}
				</div>
			{/if}
		</div>

		<div class="guestbook-message__meta">
			{#if message.browser}
				<span><Monitor size={14} aria-hidden="true" />{message.browser}</span>
			{/if}
			{#if message.os}
				<span><Laptop size={14} aria-hidden="true" />{message.os}</span>
			{/if}
			{#if message.addr}
				<span><MapPin size={14} aria-hidden="true" />{message.addr}</span>
			{/if}
			{#if message.localState === "sending"}
				<span><LoaderCircle class="is-spinning" size={14} aria-hidden="true" />{GB_LANG.sending}</span>
			{/if}
		</div>

		{#if message.localState === "failed"}
			<div class="guestbook-message__failure" role="alert">
				<span>{message.failureReason}</span>
				<button type="button" onclick={() => onRetry(message)}>
					<RotateCcw size={14} aria-hidden="true" />{GB_LANG.retry}
				</button>
				<button type="button" onclick={() => onDiscard(message)}>
					<Trash2 size={14} aria-hidden="true" />{GB_LANG.deleteLabel}
				</button>
			</div>
		{/if}

		{#if actionError}
			<div class="guestbook-message__failure" role="alert">{actionError}</div>
		{/if}
	</div>
	</div>
</article>
