import type { MomentsFeedConfig } from "../types/momentsConfig";

/**
 * 朋友圈时间线配比配置（`/moments/`）
 *
 * 抓回来的文章会先按「本站主理人 / 友链标签」分组，再按 `mix` 的比例分配展示名额，
 * 最后仍然按发布时间倒序排列。想调整各来源的露出量，只改这个文件就行。
 *
 * 只新增文件、不改主题源码，方便以后合并 CuteLeaf/Firefly 上游。
 */
export const momentsFeedConfig: MomentsFeedConfig = {
	// 时间线展示多少篇。页面每 20 篇一页，填 40 正好两页
	displayLimit: 40,

	// 每个友链最多抓几篇。本站只有一个源，这个值太小就凑不出 3 成
	maxItemsPerFriend: 12,

	// 本站 3 成 / Blog 4 成 / 博客社区 3 成
	// `own` 是保留字，代表《本站主理人》那一组，其余按友链 tags 匹配
	mix: [
		{ key: "own", weight: 30 },
		{ key: "Blog", weight: 40 },
		{ key: "博客社区", weight: 30 },
	],

	// balanced：按配比交错排列，每组内部仍是新的在前
	//           → 翻到任意一屏看到的来源比例都接近 3:4:3（推荐）
	// chronological：全局按时间倒序 → 配比只体现在总篇数上，
	//           更新频繁的聚合站（博友圈等）会继续霸占靠前的位置
	// shuffle：完全随机打乱 → 比例对，但时间线没有时间感
	layout: "balanced",
};
