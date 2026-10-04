import { getCollection } from "astro:content";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import rss, { type RSSFeedItem } from "@astrojs/rss";
import type { APIContext } from "astro";
import { dynamicConfig, profileConfig, siteConfig } from "@/config";
import { sortDynamics } from "@/utils/dynamic-utils";
import type { DynamicEntry } from "@/utils/memos-adapter";
import { fetchMemos } from "@/utils/memos-adapter";

export const prerender = true;

/** 动态正文截断为标题的最大长度 */
const TITLE_MAX_LENGTH = 60;

type MinimalEntry = {
	id: string;
	published: number;
	html: string;
	images: Array<{ alt: string; src: string; title?: string }>;
};

/**
 * 站长动态的独立 RSS（`/dynamic/rss.xml`）
 *
 * 页面数据来自 Memos API（`dynamicConfig.memos`，客户端拉取），所以 feed 也在**构建期**
 * 拉同一份接口，保证内容与页面一致；接口失败时回退到本地 `src/content/dynamic/` 内容集合，
 * 再不行输出空频道——绝不能让一次 Memos 抽风炸掉整个构建。
 *
 * 每条 item 的 link 跳回本站 `/dynamic/#dynamic-<id>`（和页内锚点同一套编码），
 * 阅读器点开直达对应那条动态。
 */
export async function GET(context: APIContext): Promise<Response> {
	const site = context.site ?? new URL(siteConfig.site_url);
	const memosConfig = dynamicConfig.memos;
	let entries: MinimalEntry[] = [];

	if (memosConfig?.enable) {
		try {
			const fetched = await fetchMemos(memosConfig.apiUrl, {
				parent: memosConfig.parent,
			});
			entries = fetched.map((entry) => ({
				id: entry.id,
				published: entry.published,
				html: entry.html,
				images: entry.images,
			}));
		} catch {
			// 构建机访问不到 Memos 时回退本地内容集合
			entries = [];
		}
	}

	if (entries.length === 0) {
		const processor = await createMarkdownProcessor();
		entries = sortDynamics(await getCollection("dynamic")).map((entry) => ({
			id: entry.id.replace(/\.(md|mdx)$/i, ""),
			published: entry.data.published.getTime(),
			html: processor.render(entry.body || ""),
			images: [],
		}));
	}

	// fetchMemos 是「置顶优先」，feed 按阅读器习惯改为纯时间倒序
	entries.sort((a, b) => b.published - a.published);

	const escapeXml = (value: string) =>
		value
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");

	/** 把 HTML 剥成纯文本，取第一段非空内容当标题 */
	const htmlToTitle = (html: string) =>
		html
			.replace(/<[^>]+>/g, " ")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/\s+/g, " ")
			.trim();

	const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});

	const items: RSSFeedItem[] = entries.map((entry) => {
		const plain = htmlToTitle(entry.html);
		const anchor = `dynamic-${entry.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
		const link = new URL(`dynamic/#${anchor}`, site).href;
		const titleChars = Array.from(plain);
		const title =
			(titleChars.length > TITLE_MAX_LENGTH
				? `${titleChars.slice(0, TITLE_MAX_LENGTH).join("")}…`
				: plain) || `动态 ${dateFormatter.format(new Date(entry.published))}`;
		const imageHtml = entry.images
			.map(
				(image) =>
					`<img src="${escapeXml(image.src)}" alt="${escapeXml(image.alt || "")}" />`,
			)
			.join("");

		return {
			title,
			link,
			pubDate: new Date(entry.published),
			description: `${entry.html}${imageHtml}`,
			content: `${entry.html}${imageHtml}`,
			customData: `<dc:creator>${escapeXml(profileConfig.name || siteConfig.title)}</dc:creator>`,
		};
	});

	const newestPubDate =
		entries.length > 0
			? new Date(
					entries.reduce(
						(max, entry) => Math.max(max, entry.published),
						Number.NEGATIVE_INFINITY,
					),
				)
			: new Date();

	return rss({
		title: `${siteConfig.title} · ${dynamicConfig.title || "站长动态"}`,
		description: dynamicConfig.description || "站长随手的记录与碎碎念。",
		site,
		xmlns: {
			atom: "http://www.w3.org/2005/Atom",
			dc: "http://purl.org/dc/elements/1.1/",
		},
		customData: `<atom:link href="${new URL("dynamic/rss.xml", site).href}" rel="self" type="application/rss+xml"/><lastBuildDate>${newestPubDate.toUTCString()}</lastBuildDate><generator>Astro</generator>`,
		items,
	});
}
