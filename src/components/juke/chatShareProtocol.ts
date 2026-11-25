export const LX_ARTICLE_SHARE_TAG = "[LX:文章分享]";
export const LX_MOMENT_SHARE_TAG = "[LX:动态分享]";

export interface ChatArticleShareData {
	kind: "article";
	title: string;
	description: string;
	url: string;
	cover?: string;
	host: string;
}

export interface ChatMomentShareData {
	kind: "moment";
	date: string;
	content: string;
	url: string;
	cover?: string;
	host: string;
}

export type ChatShareData = ChatArticleShareData | ChatMomentShareData;

export function extractHostname(rawUrl: string): string {
	try {
		const u = new URL(
			rawUrl,
			typeof window !== "undefined"
				? window.location.origin
				: "https://lengxiqwq.com",
		);
		return u.hostname || "";
	} catch {
		return "";
	}
}

/**
 * 清洗封面链接：
 * 支持从类似 "https://example.com/cover.webp ![alt](https://...)" 中提取有效图片 URL
 */
export function cleanShareCoverUrl(raw: string): string {
	const trimmed = (raw || "").trim();
	if (!trimmed) return "";

	// 优先匹配 Markdown 嵌入图片语法 ![alt](src)
	const mdMatch = trimmed.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/i);
	if (mdMatch) return mdMatch[1].trim();

	// 匹配首个 http/https URL
	const urlMatch = trimmed.match(/https?:\/\/[^\s]+/i);
	if (urlMatch) return urlMatch[0].trim();

	// 本地站内相对路径 /assets/...
	if (trimmed.startsWith("/")) return trimmed;

	return "";
}

/**
 * 解析引用的统一逻辑
 */
function parseLxQuotedLines(raw: string, tag: string): string[] | null {
	const text = String(raw || "")
		.replace(/^\uFEFF/, "")
		.trim();
	if (!text) return null;

	const lines = text.split(/\r?\n/);
	if (String(lines[0] || "").trim() !== tag) return null;

	const quotes: string[] = [];
	for (let i = 1; i < lines.length; i += 1) {
		const line = String(lines[i] || "");
		if (!line.trim()) continue;
		const m = line.match(/^>\s?(.*)$/);
		if (!m) break;
		quotes.push(String(m[1] || "").trim());
	}

	return quotes;
}

/**
 * 解析 [LX:文章分享]
 * 结构：
 * > 标题
 * > 简介
 * > 链接
 * > 封面（可选）
 */
export function parseLxArticleShare(raw: string): ChatArticleShareData | null {
	const quotes = parseLxQuotedLines(raw, LX_ARTICLE_SHARE_TAG);
	if (!quotes || quotes.length < 3) return null;

	const title = quotes[0] || "未命名文章";
	const description = quotes[1] || "";
	const rawUrl = quotes[2] || "";
	if (
		!rawUrl ||
		(!rawUrl.startsWith("http://") &&
			!rawUrl.startsWith("https://") &&
			!rawUrl.startsWith("/"))
	) {
		return null;
	}

	const cover = quotes[3] ? cleanShareCoverUrl(quotes[3]) : undefined;
	const host = extractHostname(rawUrl);

	return {
		kind: "article",
		title,
		description,
		url: rawUrl,
		cover,
		host,
	};
}

/**
 * 解析 [LX:动态分享]
 * 结构：
 * > 日期
 * > 正文
 * > 链接
 * > 配图（可选）
 */
export function parseLxMomentShare(raw: string): ChatMomentShareData | null {
	const quotes = parseLxQuotedLines(raw, LX_MOMENT_SHARE_TAG);
	if (!quotes || quotes.length < 3) return null;

	const date = quotes[0] || "未知日期";
	const content = quotes[1] || "";
	const rawUrl = quotes[2] || "";
	if (
		!rawUrl ||
		(!rawUrl.startsWith("http://") &&
			!rawUrl.startsWith("https://") &&
			!rawUrl.startsWith("/"))
	) {
		return null;
	}

	const cover = quotes[3] ? cleanShareCoverUrl(quotes[3]) : undefined;
	const host = extractHostname(rawUrl);

	return {
		kind: "moment",
		date,
		content,
		url: rawUrl,
		cover,
		host,
	};
}

/**
 * 组装 [LX:文章分享] 文本
 */
export function formatLxArticleShare(data: {
	title: string;
	description?: string;
	url: string;
	cover?: string;
}): string {
	const title = (data.title || "").trim() || "未命名文章";
	const description = (data.description || "").trim() || "暂无简介";
	const url = (data.url || "").trim();
	const cover = (data.cover || "").trim();

	const lines = [
		LX_ARTICLE_SHARE_TAG,
		`> ${title}`,
		`> ${description}`,
		`> ${url}`,
	];
	if (cover) {
		lines.push(`> ${cover}`);
	}
	return lines.join("\n");
}

/**
 * 组装 [LX:动态分享] 文本
 */
export function formatLxMomentShare(data: {
	date: string;
	content?: string;
	url: string;
	cover?: string;
}): string {
	const date = (data.date || "").trim() || "未知日期";
	const content =
		(data.content || "").replace(/\s+/g, " ").trim().slice(0, 280) ||
		"暂无内容";
	const url = (data.url || "").trim();
	const cover = (data.cover || "").trim();

	const lines = [LX_MOMENT_SHARE_TAG, `> ${date}`, `> ${content}`, `> ${url}`];
	if (cover) {
		lines.push(`> ${cover}`);
	}
	return lines.join("\n");
}
