import { marked, type Token } from "marked";
import { sanitizeChatUrl } from "./chatClient";
import { mentionRanges } from "./chatMentions";
import type {
	ChatMentionEntity,
	ChatMessageRecord,
	ImageAttachment,
} from "./chatTypes";
import {
	buildStickerTokenRegex,
	type ChatContentSegment,
	isChatInlineSticker,
	resolveExternalOrLocalSticker,
	resolveInlineStickerCategory,
	type StickerItem,
} from "./stickerLoader";

export interface ChatMarkdownAst {
	tokens: Token[];
	inlineTokens: { source: string; segment: ChatContentSegment }[];
	placeholderPattern: string;
}

const CODE_SPLIT_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g;
const MAX_CACHED_IMAGE_LAYOUTS = 1000;

interface ChatMarkdownLayout {
	imageUrls: string[];
	textLength: number;
}

const cachedImageLayouts = new WeakMap<
	Map<string, StickerItem>,
	Map<string, ChatMarkdownLayout>
>();

export function isSafeLinkUrl(raw?: string): string {
	const trimmed = (raw || "").trim();
	if (!trimmed) return "";
	if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
		return trimmed;
	}
	try {
		const parsed = new URL(trimmed);
		if (
			parsed.protocol === "http:" ||
			parsed.protocol === "https:" ||
			parsed.protocol === "mailto:"
		) {
			return parsed.toString();
		}
	} catch {
		// Invalid URL
	}
	return "";
}

export function isSafeImageUrl(raw?: string): string {
	const trimmed = (raw || "").trim();
	if (!trimmed) return "";
	if (trimmed.startsWith("/assets/") && !trimmed.startsWith("//")) {
		return trimmed;
	}
	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol === "http:" || parsed.protocol === "https:") {
			return parsed.toString();
		}
	} catch {
		// Invalid URL
	}
	return "";
}

export function getChatMessageAttachments(
	message: Pick<ChatMessageRecord, "attachments" | "content">,
	stickerMap: Map<string, StickerItem>,
): ImageAttachment[] {
	const raw = message.attachments ?? [];
	const content = message.content ?? "";
	const hasMdImg = /!\[[^\]]*\]\((https?:\/\/[^)]+)\)/i.test(content);
	return raw
		.map((att) => ({
			...att,
			url: sanitizeChatUrl(att.url, true),
			thumbnailUrl: sanitizeChatUrl(att.thumbnailUrl, true) || undefined,
		}))
		.filter((att) => {
			if (!att.url) return false;
			// 1. 如果正文中已经包含了该附件的 URL，去重过滤
			if (content.includes(att.url)) {
				return false;
			}
			// 2. 如果正文已经包含 Markdown 图片语法，且当前附件是贴纸/表情，或者正文非空且当前附件是内嵌表情，去重过滤
			if (
				(hasMdImg &&
					(att.isSticker ||
						isChatInlineSticker(att.url, att.name, stickerMap))) ||
				(content.trim().length > 0 &&
					isChatInlineSticker(att.url, att.name, stickerMap))
			) {
				return false;
			}
			return true;
		});
}

export function getChatMarkdownLayout(
	content: string,
	stickerMap: Map<string, StickerItem>,
): ChatMarkdownLayout {
	if (!content.includes("!["))
		return { imageUrls: [], textLength: content.length };
	let layouts = cachedImageLayouts.get(stickerMap);
	if (!layouts) {
		layouts = new Map();
		cachedImageLayouts.set(stickerMap, layouts);
	}
	const cached = layouts.get(content);
	if (cached) return cached;
	const imageUrls: string[] = [];
	let textLength = content.length;
	marked.walkTokens(
		marked.lexer(content, { gfm: true, breaks: true }),
		(token) => {
			if (token.type !== "image") return;
			const url = isSafeImageUrl(token.href);
			if (!url) return;
			textLength -= token.raw.length;
			if (isChatInlineSticker(url, token.text, stickerMap)) {
				const category = resolveInlineStickerCategory(url, token.text);
				if (category === "qq" || category === "emoji") return;
			}
			imageUrls.push(url);
		},
	);
	const layout = { imageUrls, textLength: Math.max(0, textLength) };
	if (layouts.size >= MAX_CACHED_IMAGE_LAYOUTS) {
		const oldest = layouts.keys().next().value;
		if (oldest !== undefined) layouts.delete(oldest);
	}
	layouts.set(content, layout);
	return layout;
}

export function parseChatMarkdown(
	content: string,
	stickerMap: Map<string, StickerItem>,
	mentionEntities: ChatMentionEntity[] = [],
): ChatMarkdownAst {
	const inlineTokens: ChatMarkdownAst["inlineTokens"] = [];
	let markerIndex = 0;
	let prefix = `\uE000chat${markerIndex}:`;
	while (content.includes(prefix)) prefix = `\uE000chat${++markerIndex}:`;
	const placeholderPattern = `${prefix}(\\d+)\\uE001`;
	function protect(source: string, segment: ChatContentSegment): string {
		const slot = inlineTokens.length;
		inlineTokens.push({ source, segment });
		return `${prefix}${slot}\uE001`;
	}

	let end = 0;
	let withMentions = "";
	for (const entity of mentionRanges(content, mentionEntities)) {
		withMentions += content.slice(end, entity.offset);
		end = entity.offset + entity.length;
		const text = content.slice(entity.offset, end);
		withMentions += protect(text, {
			kind: "mention",
			text,
			userKey: entity.userKey,
		});
	}
	withMentions += content.slice(end);
	const tokenMatcher = buildStickerTokenRegex();
	const parts = withMentions.split(CODE_SPLIT_RE);

	const protectedContent = parts
		.map((part, idx) => {
			// Odd indices match CODE_SPLIT_RE: preserve literal code blocks/spans untouched
			if (idx % 2 === 1) return part;
			tokenMatcher.lastIndex = 0;
			return part.replace(tokenMatcher, (token) => {
				const sticker = resolveExternalOrLocalSticker(token, stickerMap);
				if (!sticker) return token;
				return protect(token, {
					kind: "sticker",
					code: sticker.code,
					url: sticker.url,
					alt: sticker.name,
					category: sticker.category,
					...(sticker.lottie ? { lottie: sticker.lottie } : {}),
				});
			});
		})
		.join("");

	const tokens = marked.lexer(protectedContent, {
		gfm: true,
		breaks: true,
	});

	return { tokens, inlineTokens, placeholderPattern };
}

export function restoreTextSegments(
	text: string,
	ast: ChatMarkdownAst,
): ChatContentSegment[] {
	if (!text) return [];
	const out: ChatContentSegment[] = [];
	let lastIndex = 0;
	for (const match of text.matchAll(new RegExp(ast.placeholderPattern, "g"))) {
		const token = ast.inlineTokens[Number(match[1])];
		if (!token) continue;
		if (match.index > lastIndex) {
			out.push({ kind: "text", text: text.slice(lastIndex, match.index) });
		}
		out.push(token.segment);
		lastIndex = match.index + match[0].length;
	}

	if (lastIndex < text.length) {
		out.push({ kind: "text", text: text.slice(lastIndex) });
	}
	return out;
}

export function restoreChatMarkdownLiterals(
	text: string,
	ast: ChatMarkdownAst,
): string {
	return text.replace(
		new RegExp(ast.placeholderPattern, "g"),
		(raw, slot) => ast.inlineTokens[Number(slot)]?.source ?? raw,
	);
}
