import { getTagUrl } from "@utils/url-utils";

export type TagGraphInputPost = {
	id: string;
	title: string;
	tags: string[];
};

export type TagGraphNode = {
	id: string;
	name: string;
	value: number;
	posts: string[];
	url: string;
};

export type TagGraphLink = {
	source: string;
	target: string;
	value: number;
};

export type TagGraphData = {
	nodes: TagGraphNode[];
	links: TagGraphLink[];
	/** 全站标签总数（含未达到展示阈值的标签） */
	totalTags: number;
	/** 连线所需的最小共现篇数 */
	threshold: number;
	/** 节点所需的最小引用篇数 */
	minTagCount: number;
};

export type BuildTagGraphOptions = {
	/** 两个标签至少共同出现在多少篇文章中才连线，默认 2 */
	threshold?: number;
	/** 标签至少被多少篇文章引用才作为节点，默认 2 */
	minTagCount?: number;
	/** 节点数量上限，按引用次数取前 N 个，默认 60 */
	maxNodes?: number;
	/** 每个节点最多记录多少篇文章标题（用于 tooltip），默认 5 */
	maxPostsPerNode?: number;
};

const KEY_SEPARATOR = "\u0000";

/**
 * 根据文章列表构建标签关系图数据。
 *
 * - 节点大小 = 标签被引用的文章数（同一篇文章内重复标签只计一次）
 * - 连线 = 两个标签共同出现在同一篇文章中，权重为共现篇数
 * - 只保留至少有一条连线的节点，避免力导向图里出现漂浮的孤立节点
 */
export function buildTagGraphData(
	posts: TagGraphInputPost[],
	options: BuildTagGraphOptions = {},
): TagGraphData {
	const threshold = options.threshold ?? 2;
	const minTagCount = options.minTagCount ?? 2;
	const maxNodes = options.maxNodes ?? 60;
	const maxPostsPerNode = options.maxPostsPerNode ?? 5;

	const nodeMap = new Map<string, TagGraphNode>();
	const linkCountMap = new Map<string, number>();

	for (const post of posts) {
		const tags = [
			...new Set((post.tags || []).map((tag) => tag.trim()).filter(Boolean)),
		];

		for (const tag of tags) {
			let node = nodeMap.get(tag);
			if (!node) {
				node = { id: tag, name: tag, value: 0, posts: [], url: "" };
				nodeMap.set(tag, node);
			}
			node.value += 1;
			if (node.posts.length < maxPostsPerNode) {
				node.posts.push(post.title);
			}
		}

		for (let i = 0; i < tags.length; i++) {
			for (let j = i + 1; j < tags.length; j++) {
				const [a, b] = [tags[i], tags[j]].sort();
				const key = `${a}${KEY_SEPARATOR}${b}`;
				linkCountMap.set(key, (linkCountMap.get(key) ?? 0) + 1);
			}
		}
	}

	const totalTags = nodeMap.size;

	// 先按引用次数筛出候选节点，再统计它们之间的连线
	const candidates = [...nodeMap.values()]
		.filter((node) => node.value >= minTagCount)
		.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
		.slice(0, maxNodes);

	for (const node of candidates) {
		node.url = getTagUrl(node.name);
	}

	const allowed = new Set(candidates.map((node) => node.id));
	const links: TagGraphLink[] = [];

	for (const [key, value] of linkCountMap) {
		if (value < threshold) continue;
		const [source, target] = key.split(KEY_SEPARATOR);
		if (!allowed.has(source) || !allowed.has(target)) continue;
		links.push({ source, target, value });
	}

	links.sort(
		(a, b) =>
			b.value - a.value ||
			a.source.localeCompare(b.source) ||
			a.target.localeCompare(b.target),
	);

	const connected = new Set<string>();
	for (const link of links) {
		connected.add(link.source);
		connected.add(link.target);
	}

	const nodes = candidates.filter((node) => connected.has(node.id));

	return {
		nodes,
		links,
		totalTags,
		threshold,
		minTagCount,
	};
}
