import rss, { type RSSFeedItem } from "@astrojs/rss";
import { loadFriendsFeed } from "@utils/friends-feed";
import { buildMomentsTimeline } from "@utils/moments-timeline";
import type { APIContext } from "astro";
import { getEnabledFriends, siteConfig } from "@/config";

export const prerender = true;

/**
 * 朋友圈时间线的独立 RSS（`/moments/rss.xml`）
 *
 * 和页面 `/moments/` 共用同一份数据来源与配比逻辑（`loadFriendsFeed` +
 * `buildMomentsTimeline`），所以订阅出来的条目顺序、来源占比与页面上看到的完全一致，
 * 不会出现「网页一种排序、订阅另一种排序」的情况。
 *
 * 每条 item 的 link 指向**原文所在的友链站点**，而不是跳回本站，
 * 这样阅读器点开就是文章本体；本站身份通过 `author` / `dc:creator` / `category` 标注。
 */
export async function GET(context: APIContext): Promise<Response> {
	const site = context.site ?? new URL(siteConfig.site_url);
	const friends = getEnabledFriends();
	const feed = await loadFriendsFeed(friends);
	const timeline = buildMomentsTimeline(
		feed.items,
		friends,
		siteConfig.site_url,
	);

	const normalizeFriendUrl = (url: string | undefined | null) =>
		(url ?? "")
			.trim()
			.replace(/^https?:\/\//i, "")
			.replace(/^www\./i, "")
			.replace(/\/+$/, "")
			.toLowerCase();
	const ownSiteUrl = normalizeFriendUrl(siteConfig.site_url);

	const escapeXml = (value: string) =>
		value
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");

	const items: RSSFeedItem[] = timeline.items.map((item) => {
		const sourceTitle = item.friendTitle || "友链站点";
		const isOwnSite = normalizeFriendUrl(item.friendUrl) === ownSiteUrl;
		const summary = item.description?.trim();
		const meta = [
			`来自 ${sourceTitle}`,
			item.publishedAt
				? new Intl.DateTimeFormat("zh-CN", {
						year: "numeric",
						month: "2-digit",
						day: "2-digit",
					}).format(item.publishedAt)
				: null,
			isOwnSite ? "本站主理人" : null,
		].filter(Boolean);

		return {
			title: item.title,
			link: item.link,
			pubDate: item.publishedAt ?? new Date(),
			description: summary
				? `<p>${escapeXml(summary)}</p><p><small>${escapeXml(meta.join(" · "))}</small></p>`
				: `<p><small>${escapeXml(meta.join(" · "))}</small></p>`,
			author: sourceTitle,
			categories: isOwnSite ? ["朋友圈", "本站"] : ["朋友圈", sourceTitle],
			customData: `<dc:creator>${escapeXml(sourceTitle)}</dc:creator>`,
		};
	});

	const newestPubDate = timeline.items
		.map((item) => item.publishedAt)
		.filter(
			(date): date is Date =>
				date instanceof Date && !Number.isNaN(date.getTime()),
		)
		.sort((a, b) => b.getTime() - a.getTime())[0];

	return rss({
		title: `${siteConfig.title} · 朋友圈`,
		description: "把友链博客最近写下的文章，收进一条轻盈的时间线。",
		site,
		xmlns: {
			atom: "http://www.w3.org/2005/Atom",
			dc: "http://purl.org/dc/elements/1.1/",
		},
		customData: `<atom:link href="${new URL("moments/rss.xml", site).href}" rel="self" type="application/rss+xml"/>${newestPubDate ? `<lastBuildDate>${newestPubDate.toUTCString()}</lastBuildDate>` : ""}<generator>Astro</generator>`,
		items,
	});
}
