/**
 * 站点统计看板（/analytics/）配置
 *
 * 数据全部来自 Umami 的公开分享接口，不需要任何后端。
 * 换 Umami 实例或分享链接时，只改 shareId / shareApiBase 两行即可。
 */
export interface AnalyticsDashboardConfig {
	/** 是否启用页面（false 时页面只剩一行提示） */
	enable: boolean;
	/** Umami 分享 ID：取分享链接 /share/XXXXXXXX 的最后一段 */
	shareId: string;
	/** Umami 实例地址 */
	shareApiBase: string;
	/** 「访问脉冲」折线图覆盖的天数 */
	pulseDays: number;
	/** 「推送节奏」热力图展示的周数 */
	heatmapWeeks: number;
	/** GitHub 仓库，格式 owner/repo，留空则不显示「推送节奏」 */
	githubRepo: string;
	/** GitHub 分支名 */
	githubBranch: string;
	/** 构建时拉取的提交条数上限（GitHub 单页最大 100） */
	githubCommitLimit: number;
	/** Waline 服务地址，留空则不显示「最近评论」 */
	walineServerUrl: string;
	/** 最近评论条数 */
	walineCommentCount: number;
	/** 客户端数据缓存时长（毫秒），默认 2 分钟 */
	cacheTtl: number;
	/** 页面标题与描述 */
	title: string;
	description: string;
}

export const analyticsDashboardConfig: AnalyticsDashboardConfig = {
	enable: true,
	shareId: "Z4DD4Y3q9CTFpBeM",
	shareApiBase: "https://umami.9ll.uk",
	pulseDays: 30,
	heatmapWeeks: 20,
	githubRepo: "hy4962/Firefly",
	githubBranch: "HY",
	githubCommitLimit: 100,
	walineServerUrl: "https://waline.9ll.uk",
	walineCommentCount: 8,
	cacheTtl: 2 * 60 * 1000,
	title: "站点统计",
	description:
		"这个博客的访问数据看板：总览数字、30 天访问脉冲、推送节奏、访客活跃时间、设备与地域分布，数据来自 Umami 公开分享接口。",
};
