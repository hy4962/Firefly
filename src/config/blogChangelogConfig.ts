/**
 * 博客更新日志配置（blog-changelog 页面）
 * 独立配置文件 + 独立页面路由，不改动主题文件，便于以后合并上游主题更新。
 *
 * 版本规则：Major 代表结构级升级 · Minor 代表新功能 · Patch 代表修复、内容与维护
 */
export interface ChangelogItem {
	/** 变更所属分类，如 首页、视觉、性能、内容 */
	category: string;
	/** 变更说明 */
	text: string;
}

export interface ChangelogEntry {
	/** 版本号，如 "V1.0" */
	version: string;
	/** 版本主题短语（kind 徽章），如 "首页贴纸卡片" */
	title: string;
	/** 日期，格式 YYYY-MM-DD */
	date: string;
	/** 卡片标题（h2，一句短句） */
	summary: string;
	/** 卡片描述（标题下的一段说明） */
	description: string;
	/** 变更明细 */
	items: ChangelogItem[];
	/** 底部标签 */
	tags: string[];
}

export const blogChangelogConfig: ChangelogEntry[] = [
	{
		version: "V1.0",
		title: "首页贴纸卡片",
		date: "2026-09-06",
		summary: "首页来了套新皮肤",
		description:
			"给首页壁纸区加了一套可拖拽的贴纸装饰和个人卡片，顺手把邮箱资料也整理了一遍",
		items: [
			{
				category: "首页",
				text: "新增壁纸装饰卡片：毛玻璃个人卡片带胶带、彩色标签社交按钮（GitHub / Email 复制 / Bilibili / RSS / 打赏）和快捷导航",
			},
			{
				category: "首页",
				text: "新增 7 张可拖拽场景贴纸，按住即可拖动，位置限制在壁纸范围内，刷新后复位",
			},
			{
				category: "首页",
				text: "贴纸尺寸整体放大 1.25 倍",
			},
			{
				category: "视觉",
				text: "贴纸布局按列对齐：左右两列贴边、底部一排用 bottom 锚定踩同一地面线，中间三个等距分布",
			},
			{
				category: "视觉",
				text: "入场动画：卡片、贴纸、便签依次浮入，从其他页面回到首页时重播",
			},
			{
				category: "修复",
				text: "修复 fullscreen 壁纸模式下贴纸被裁切放大、跟随壁纸滚动模糊的问题，头像小贴纸拖拽失效的问题",
			},
			{
				category: "移动端",
				text: "手机端贴纸按卡片实际位置自适应排布，任意窄屏都不遮挡卡片内容",
			},
			{
				category: "性能",
				text: "贴纸素材从 1.6MB 压缩到约 330KB，首屏加载更快",
			},
			{
				category: "维护",
				text: "站点邮箱统一为 admin@9ll.uk，更新 Bilibili 主页链接",
			},
		],
		tags: ["首页", "贴纸", "视觉", "移动端", "性能"],
	},
];
