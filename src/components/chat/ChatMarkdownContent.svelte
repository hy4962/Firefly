<script lang="ts">
import type { Token, Tokens } from "marked";
import ChatCodeBlock from "./ChatCodeBlock.svelte";
import ChatImagePreview from "./ChatImagePreview.svelte";
import ChatStickerImage from "./ChatStickerImage.svelte";
import type { ChatImageDimensions } from "./chatImageLayout";
import {
	type ChatMarkdownAst,
	isSafeImageUrl,
	isSafeLinkUrl,
	parseChatMarkdown,
	restoreChatMarkdownLiterals,
	restoreTextSegments,
} from "./chatMarkdown";
import type { ChatMentionEntity } from "./chatTypes";
import LottieSticker from "./LottieSticker.svelte";
import {
	formatStickerAttachmentAlt,
	isChatInlineSticker,
	resolveInlineStickerCategory,
	type StickerItem,
} from "./stickerLoader";

interface Props {
	content: string;
	imageDimensions?: Record<string, ChatImageDimensions>;
	stickerMap: Map<string, StickerItem>;
	mentionEntities?: ChatMentionEntity[];
	mentionKeys?: string[];
	currentUserKey?: string;
	chatServerUrl?: string;
	onMentionClick?: (userKey: string, text: string) => void;
}

const {
	content = "",
	imageDimensions,
	stickerMap,
	mentionEntities = [],
	mentionKeys = [],
	currentUserKey = "",
	chatServerUrl,
	onMentionClick,
}: Props = $props();

const ast: ChatMarkdownAst = $derived(
	parseChatMarkdown(content, stickerMap, mentionEntities),
);

function isSelfMention(userKey: string): boolean {
	return userKey === "room"
		? mentionKeys.includes("room")
		: userKey === currentUserKey && mentionKeys.includes(currentUserKey);
}

function getInlineChildren(token: Token): Token[] | undefined {
	if ("tokens" in token && Array.isArray(token.tokens)) {
		return token.tokens as Token[];
	}
	return undefined;
}
</script>

{#snippet renderInlineList(tokens: Token[])}
  {#each tokens as tok, i (`${i}-${tok.type}`)}
    {#if tok.type === "strong"}
      <strong>{@render renderInlineList((tok as Tokens.Strong).tokens)}</strong>
    {:else if tok.type === "em"}
      <em>{@render renderInlineList((tok as Tokens.Em).tokens)}</em>
    {:else if tok.type === "del"}
      <del class="opacity-70">{@render renderInlineList((tok as Tokens.Del).tokens)}</del>
    {:else if tok.type === "codespan"}
      <code class="chat-md-code">{restoreChatMarkdownLiterals((tok as Tokens.Codespan).text, ast)}</code>
    {:else if tok.type === "br"}
      <br />
    {:else if tok.type === "link"}
      {@const linkTok = tok as Tokens.Link}
      {@const safeHref = isSafeLinkUrl(linkTok.href)}
      {#if safeHref}
        <a
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer"
          class="chat-md-link"
        >
          {#if linkTok.tokens && linkTok.tokens.length > 0}
            {@render renderInlineList(linkTok.tokens)}
          {:else}
            {#each restoreTextSegments(linkTok.text, ast) as seg, sIdx (`${sIdx}-${seg.kind}`)}
              {#if seg.kind === "text"}{seg.text}{:else if seg.kind === "mention"}{seg.text}{/if}
            {/each}
          {/if}
        </a>
      {:else}
        {linkTok.raw}
      {/if}
    {:else if tok.type === "image"}
      {@const imgTok = tok as Tokens.Image}
      {@const safeSrc = isSafeImageUrl(imgTok.href)}
      {#if safeSrc}
        {@const isSticker = isChatInlineSticker(safeSrc, imgTok.text, stickerMap)}
        {@const cat = isSticker ? resolveInlineStickerCategory(safeSrc, imgTok.text) : null}
        {#if isSticker && (cat === "qq" || cat === "emoji")}
          <ChatStickerImage
            src={safeSrc}
            alt={formatStickerAttachmentAlt(imgTok.text) || "表情"}
            title={formatStickerAttachmentAlt(imgTok.text) || "表情"}
            loading="lazy"
            class="chat-sticker chat-sticker--{cat} chat-sticker--inline select-none"
          />
        {:else}
          <ChatImagePreview src={safeSrc} alt={formatStickerAttachmentAlt(imgTok.text) || "图片"} metadata={imageDimensions?.[safeSrc]} inline />
        {/if}
      {:else}
        {imgTok.raw}
      {/if}
    {:else if tok.type === "escape"}
      {(tok as Tokens.Escape).text}
    {:else if tok.type === "html"}
      {restoreChatMarkdownLiterals(tok.raw, ast)}
    {:else if tok.type === "text"}
      {@const children = getInlineChildren(tok)}
      {#if children && children.length > 0}
        {@render renderInlineList(children)}
      {:else}
        {#each restoreTextSegments((tok as Tokens.Text).text, ast) as seg, sIdx (`${sIdx}-${seg.kind}`)}
          {#if seg.kind === "sticker"}
            {#if seg.lottie}
              <LottieSticker
                name={seg.lottie}
                alt={seg.alt}
                className="chat-sticker chat-sticker--lottie {seg.category === 'sticker' ? 'is-large' : ''}"
                chatServerUrl={chatServerUrl}
              />
            {:else}
              <ChatStickerImage src={seg.url} alt={seg.alt} class="chat-sticker chat-sticker--{seg.category}" loading="lazy" />
            {/if}
          {:else if seg.kind === "mention"}
            {#if onMentionClick && seg.userKey !== "room"}
              <button
                type="button"
                class="chat-mention-pill {isSelfMention(seg.userKey) ? 'self' : ''} clickable select-none"
                title={"查看 " + seg.text + " 的资料"}
                onclick={(event) => {
                  event.stopPropagation();
                  onMentionClick?.(seg.userKey, seg.text);
                }}
              >{seg.text}</button>
            {:else}
              <span class="chat-mention-pill {isSelfMention(seg.userKey) ? 'self' : ''}">{seg.text}</span>
            {/if}
          {:else}
            {seg.text}
          {/if}
        {/each}
      {/if}
    {:else}
      {restoreChatMarkdownLiterals(tok.raw, ast)}
    {/if}
  {/each}
{/snippet}

{#snippet renderBlockList(tokens: Token[])}
  {#each tokens as tok, i (`${i}-${tok.type}`)}
    {#if tok.type === "space"}
      <!-- spacing handled by container gap -->
    {:else if tok.type === "paragraph"}
      {@const pTok = tok as Tokens.Paragraph}
      <p class="chat-md-p">{@render renderInlineList(pTok.tokens)}</p>
    {:else if tok.type === "text"}
      {@const children = getInlineChildren(tok)}
      {#if children && children.length > 0}
        <p class="chat-md-p">{@render renderInlineList(children)}</p>
      {:else}
        <p class="chat-md-p">{@render renderInlineList([tok])}</p>
      {/if}
    {:else if tok.type === "heading"}
      {@const hTok = tok as Tokens.Heading}
      <div class="chat-md-heading chat-md-h{Math.min(3, hTok.depth)}">
        {@render renderInlineList(hTok.tokens)}
      </div>
    {:else if tok.type === "code"}
      {@const codeTok = tok as Tokens.Code}
      <ChatCodeBlock code={restoreChatMarkdownLiterals(codeTok.text, ast)} lang={codeTok.lang || ""} />
    {:else if tok.type === "blockquote"}
      {@const qTok = tok as Tokens.Blockquote}
      <blockquote class="chat-md-quote">
        {@render renderBlockList(qTok.tokens)}
      </blockquote>
    {:else if tok.type === "list"}
      {@const listTok = tok as Tokens.List}
      {#if listTok.ordered}
        <ol class="chat-md-list chat-md-ol" start={typeof listTok.start === "number" ? listTok.start : 1}>
          {#each listTok.items as item, li (`${li}-ol`)}
            <li class="chat-md-li">
              {#if item.task}
                <span class="chat-md-task {item.checked ? 'checked' : ''}" aria-hidden="true">
                  {item.checked ? "✓" : ""}
                </span>
              {/if}
              <div class="min-w-0 flex-1">{@render renderBlockList(item.tokens)}</div>
            </li>
          {/each}
        </ol>
      {:else}
        <ul class="chat-md-list chat-md-ul">
          {#each listTok.items as item, li (`${li}-ul`)}
            <li class="chat-md-li">
              {#if item.task}
                <span class="chat-md-task {item.checked ? 'checked' : ''}" aria-hidden="true">
                  {item.checked ? "✓" : ""}
                </span>
              {/if}
              <div class="min-w-0 flex-1">{@render renderBlockList(item.tokens)}</div>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if tok.type === "table"}
      {@const tblTok = tok as Tokens.Table}
      <div class="chat-md-table-wrap custom-scrollbar">
        <table class="chat-md-table">
          <thead>
            <tr>
              {#each tblTok.header as cell, ci (`${ci}-th`)}
                <th style={tblTok.align[ci] ? `text-align:${tblTok.align[ci]}` : ""}>
                  {@render renderInlineList(cell.tokens)}
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each tblTok.rows as row, ri (`${ri}-tr`)}
              <tr>
                {#each row as cell, ci (`${ri}-${ci}-td`)}
                  <td style={tblTok.align[ci] ? `text-align:${tblTok.align[ci]}` : ""}>
                    {@render renderInlineList(cell.tokens)}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else if tok.type === "hr"}
      <hr class="chat-md-hr" />
    {:else if tok.type === "html"}
      <p class="chat-md-p">{restoreChatMarkdownLiterals(tok.raw, ast)}</p>
    {:else}
      <p class="chat-md-p">{restoreChatMarkdownLiterals(tok.raw, ast)}</p>
    {/if}
  {/each}
{/snippet}

{#if ast.tokens.length > 0}
  <div class="chat-msg-text chat-md-body">
    {@render renderBlockList(ast.tokens)}
  </div>
{/if}
