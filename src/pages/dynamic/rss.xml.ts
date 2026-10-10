import { getCollection } from "astro:content";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import rss, { type RSSFeedItem } from "@astrojs/rss";
import type { APIContext } from "astro";
import { dynamicConfig, profileConfig, siteConfig } from "@/config";
import { sortDynamics } from "@/utils/dynamic-utils";
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
/**
 * 构建机能不能碰到 Memos？
 *
 * Memos 实例（`dynamicConfig.memos.apiUrl`）解析到的是国内 IP，Vercel / Cloudflare
 * 的构建机在海外，直连基本必然 ConnectTimeout。这里先花最多 4s 探一次：连不上就
 * 根本不调 `fetchMemos`，直接走本地内容回退。**只要拿到任何 HTTP 响应就算通**，
 * 不要求 2xx——网络可达与否才是这里要判断的事。
 */
async function isMemosReachable(
	apiUrl: string,
	timeoutMs = 4000,
): Promise<boolean> {
	try {
		await fetch(new URL("/api/v1/workspace/profile", apiUrl), {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(timeoutMs),
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * 吞掉「Memos 请求失败」这一类未处理的 Promise 拒绝。
 *
 * 上游 `src/utils/memos-adapter.ts`（本仓库不碰上游）里有一句
 * `promise.finally(() => pendingRequests.delete(cacheKey))`——`finally()` 会派生一个
 * 新的 promise，它 reject 时没有任何人接管，于是变成 unhandledRejection；Node 24 默认
 * `--unhandled-rejections=throw`，会直接把整个构建进程干掉（日志里的
 * `triggerUncaughtException(err, true /* fromPromise *∕)` 就是这个）。调用方 catch 拦不住它。
 *
 * 所以这里在调用前挂一个极窄的监听：只吞 fetch 超时/连接失败，其它拒绝照旧抛出。
 */
const ignoreMemosFetchFailure = (reason: unknown): void => {
	const message =
		reason instanceof Error
			? `${reason.name}: ${reason.message}`
			: String(reason);
	if (
		/fetch failed|Connect Timeout|UND_ERR|ECONNRESET|ETIMEDOUT/i.test(message)
	) {
		console.warn(
			`[dynamic/rss] Memos 请求失败，已忽略并回退本地内容：${message}`,
		);
		return;
	}
	throw reason;
};

export async function GET(context: APIContext): Promise<Response> {
	const site = context.site ?? new URL(siteConfig.site_url);
	const memosConfig = dynamicConfig.memos;
	let entries: MinimalEntry[] = [];

	if (memosConfig?.enable && (await isMemosReachable(memosConfig.apiUrl))) {
		process.on("unhandledRejection", ignoreMemosFetchFailure);
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
		const dynamics = sortDynamics(await getCollection("dynamic"));
		// processor.render() 是 async 且返回 { code }（对照上游 src/pages/api/dynamic.json.ts 的写法）。
		// 早先这里漏了 await、也没取 .code，html 拿到的是 Promise → 后面 htmlToTitle() 直接
		// `html.replace is not a function`，把整次构建炸掉（2026-10-10 线上构建失败就是这条）。
		entries = await Promise.all(
			dynamics.map(async (entry) => {
				const rendered = await processor.render(entry.body || "");
				return {
					id: entry.id.replace(/\.(md|mdx)$/i, ""),
					published: entry.data.published.getTime(),
					html: rendered.code,
					images: [],
				};
			}),
		);
	}

	// fetchMemos 是「置顶优先」，feed 按阅读器习惯改为纯时间倒序
	entries.sort((a, b) => b.published - a.published);

	const escapeXml = (value: string) =>
		value
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");

	/** 把 HTML 剥成纯文本，取第一段非空内容当标题（入参兜底转字符串，别再让类型意外炸掉构建） */
	const htmlToTitle = (html: unknown) =>
		String(html ?? "")
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
