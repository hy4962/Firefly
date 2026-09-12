import { momentsFeedConfig } from "@/config/momentsConfig";
import type { FriendLink } from "@/types/friendsConfig";
import type { MomentsFeedConfig } from "@/types/momentsConfig";
import type { FriendFeedItem } from "@/utils/friends-feed";

/** `mix` 里代表「本站主理人」的保留分组名 */
const OWN_BUCKET = "own";

export type MomentsTimelineBucket = {
	/** 分组标识 */
	key: string;
	/** 该分组在抓取结果里的可用篇数 */
	available: number;
	/** 最终进入时间线的篇数 */
	selected: number;
};

export type MomentsTimeline = {
	/** 按配比挑出并排好序的文章 */
	items: FriendFeedItem[];
	/** 各分组配额与实际取用情况，供构建期校对配比 */
	buckets: MomentsTimelineBucket[];
};

type MomentsGroup = {
	key: string;
	/** 目标占比（权重归一化后的值） */
	ratio: number;
	/** 该组按时间倒序排好的候选 */
	pool: FriendFeedItem[];
	/** 最终取用篇数 */
	count: number;
};

function normalizeSiteUrl(url: string | undefined | null): string {
	return (url ?? "")
		.trim()
		.replace(/^https?:\/\//i, "")
		.replace(/^www\./i, "")
		.replace(/\/+$/, "")
		.toLowerCase();
}

function publishedTime(item: FriendFeedItem): number {
	return item.publishedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
}

function sortByDateDesc(items: FriendFeedItem[]): FriendFeedItem[] {
	return [...items].sort((a, b) => publishedTime(b) - publishedTime(a));
}

function shuffle(items: FriendFeedItem[]): FriendFeedItem[] {
	const result = [...items];
	for (let i = result.length - 1; i > 0; i -= 1) {
		const j = Math.floor(Math.random() * (i + 1));
		const current = result[i];
		result[i] = result[j];
		result[j] = current;
	}
	return result;
}

/** 按权重把 `total` 个名额分配给各分组，用最大余数法保证总和精确等于 total */
function allocateQuotas(weights: number[], total: number): number[] {
	const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
	if (weightSum <= 0) return weights.map(() => 0);

	const exact = weights.map((weight) => (total * weight) / weightSum);
	const quotas = exact.map((value) => Math.floor(value));
	let remainder = total - quotas.reduce((sum, value) => sum + value, 0);

	const byFraction = weights
		.map((_, index) => index)
		.sort((a, b) => exact[b] - quotas[b] - (exact[a] - quotas[a]));
	for (const index of byFraction) {
		if (remainder <= 0) break;
		quotas[index] += 1;
		remainder -= 1;
	}

	return quotas;
}

/**
 * 按配比把各分组的文章交错摊开，同时让每组内部保持「新的在前」。
 *
 * 每一步都挑「实际落后目标比例最多」的那一组取下一篇文章，等价于平滑加权轮询，
 * 所以任意一段连续片段里的来源比例都贴着配置走，而不是把某一组堆在前面。
 */
function interleaveByRatio(groups: MomentsGroup[]): FriendFeedItem[] {
	const result: FriendFeedItem[] = [];
	const cursors = new Map(groups.map((group) => [group.key, 0]));
	const total = groups.reduce((sum, group) => sum + group.count, 0);

	while (result.length < total) {
		let best: MomentsGroup | null = null;
		let bestDeficit = Number.NEGATIVE_INFINITY;

		for (const group of groups) {
			const cursor = cursors.get(group.key) ?? 0;
			if (cursor >= group.count) continue;
			// 目标累计篇数 - 已排篇数，差值最大者优先
			const deficit = group.ratio * (result.length + 1) - cursor;
			if (deficit > bestDeficit) {
				bestDeficit = deficit;
				best = group;
			}
		}

		if (!best) break;
		const cursor = cursors.get(best.key) ?? 0;
		result.push(best.pool[cursor]);
		cursors.set(best.key, cursor + 1);
	}

	return result;
}

/**
 * 把抓回来的朋友圈文章按「本站主理人 / 友链标签」分组，按 `config.mix` 的比例挑片，
 * 再按 `config.layout` 排好序（默认 `balanced`，按配比交错）。
 *
 * 分流规则：先看是不是本站（`ownSiteUrl`），命中就进 `own` 组；否则按 `mix` 的标签
 * 顺序匹配友链 `tags`，都没命中归入「其他」，只有在所有分组都取不够时才用来补位。
 *
 * 某个分组的文章不够配额时，空出来的名额会补给其他还有余量的分组，
 * 所以配比是「上限」而不是「硬性保证」——源里没有那么多文章时不会凭空造出来。
 */
export function buildMomentsTimeline(
	items: FriendFeedItem[],
	friends: FriendLink[],
	ownSiteUrl: string,
	config: MomentsFeedConfig = momentsFeedConfig,
): MomentsTimeline {
	const mix = config.mix.filter((rule) => rule.weight > 0);
	if (items.length === 0 || mix.length === 0) {
		return { items: sortByDateDesc(items), buckets: [] };
	}

	const ownUrl = normalizeSiteUrl(ownSiteUrl);
	const tagsByUrl = new Map(
		friends.map(
			(friend) =>
				[normalizeSiteUrl(friend.siteurl), friend.tags ?? []] as const,
		),
	);

	const grouped = new Map<string, FriendFeedItem[]>();
	const unclassified: FriendFeedItem[] = [];
	for (const item of items) {
		const friendUrl = normalizeSiteUrl(item.friendUrl);
		let bucket = ownUrl && friendUrl === ownUrl ? OWN_BUCKET : "";
		if (!bucket || !mix.some((rule) => rule.key === bucket)) {
			const tags = tagsByUrl.get(friendUrl) ?? [];
			bucket =
				mix.find(
					(rule) => rule.key !== OWN_BUCKET && tags.includes(rule.key),
				)?.key ?? "";
		}

		if (!bucket) {
			unclassified.push(item);
			continue;
		}
		const existing = grouped.get(bucket);
		if (existing) existing.push(item);
		else grouped.set(bucket, [item]);
	}

	const weightSum = mix.reduce((sum, rule) => sum + rule.weight, 0);
	const limit =
		config.displayLimit > 0
			? Math.min(config.displayLimit, items.length)
			: items.length;
	const quotas = allocateQuotas(
		mix.map((rule) => rule.weight),
		limit,
	);

	const groups: MomentsGroup[] = mix.map((rule, index) => ({
		key: rule.key,
		ratio: weightSum > 0 ? rule.weight / weightSum : 0,
		pool: sortByDateDesc(grouped.get(rule.key) ?? []),
		count: Math.min(quotas[index], grouped.get(rule.key)?.length ?? 0),
	}));

	// 实际取用数不足 limit 时，把富余名额补给还有余量的分组
	let spare = limit - groups.reduce((sum, group) => sum + group.count, 0);
	while (spare > 0) {
		let progressed = false;
		for (const group of groups) {
			if (spare <= 0) break;
			if (group.count >= group.pool.length) continue;
			group.count += 1;
			spare -= 1;
			progressed = true;
		}
		if (!progressed) break;
	}

	const buckets: MomentsTimelineBucket[] = groups.map((group) => ({
		key: group.key,
		available: group.pool.length,
		selected: group.count,
	}));

	// 每个分组各取自己最新的 N 篇（shuffle 模式则随机取 N 篇）
	const picked = groups.map((group) =>
		config.layout === "shuffle"
			? shuffle(group.pool).slice(0, group.count)
			: group.pool.slice(0, group.count),
	);

	let result: FriendFeedItem[];
	if (config.layout === "chronological") {
		result = sortByDateDesc(picked.flat());
	} else if (config.layout === "shuffle") {
		result = shuffle(picked.flat());
	} else {
		result = interleaveByRatio(
			groups.map((group, index) => ({ ...group, pool: picked[index] })),
		);
	}

	// 所有分组都榨干后名额还有剩，用未归类的文章补满，避免时间线无故变短
	if (result.length < limit) {
		result = [
			...result,
			...sortByDateDesc(unclassified).slice(0, limit - result.length),
		];
	}

	return { items: result, buckets };
}
