// 朋友圈时间线配比配置类型

/** 一条分组配比规则 */
export type MomentsMixRule = {
	/**
	 * 分组标识。
	 * - `own`：本站主理人的文章（按 `siteConfig.site_url` 匹配），优先级最高
	 * - 其余值：按友链的 `tags` 匹配，命中第一个就归入该组
	 */
	key: string;
	/** 配额权重，按所有规则的权重之和归一化；填 30 / 40 / 30 就是 3:4:3 */
	weight: number;
};

/**
 * 时间线的排列方式。
 *
 * - `balanced`：按配比交错排列。每组内部仍是「新的在前」，但整条时间线上
 *   各来源是均匀摊开的，所以翻到任意一屏看到的比例都接近配置值（推荐）。
 * - `chronological`：全局按发布时间倒序。配比只体现在总篇数上，翻页时
 *   更新频繁的聚合站会继续霸占靠前的位置。
 * - `shuffle`：完全随机打乱。比例对，但时间线失去时间感，每次构建都不一样。
 */
export type MomentsLayout = "balanced" | "chronological" | "shuffle";

export type MomentsFeedConfig = {
	/** 时间线展示的文章总数，按 `mix` 的比例分配名额；填 0 或负数表示不裁剪 */
	displayLimit: number;
	/** 每个友链最多抓取的文章数；本站只有一个源，取文上限太小就凑不出高配比 */
	maxItemsPerFriend: number;
	/** 分组配比，数组顺序同时决定标签的匹配优先级 */
	mix: MomentsMixRule[];
	/** 时间线排列方式，见 `MomentsLayout` */
	layout: MomentsLayout;
};
