import type { GuestbookConfig } from "../types/guestbookConfig";

/**
 * 留言板公告配置。
 *
 * 原留言板把公告写在 src/content/spec/guestbook.md 里（Markdown 渲染）。
 * 群聊版改为结构化公告：点击顶部公告栏会弹出对话框。
 * 把 announcements 置为 [] 即可完全隐藏公告栏、也不再自动弹出。
 */
export const guestbookConfig: GuestbookConfig = {
	announcements: [
		{
			id: "welcome",
			title: "留言板使用说明",
			summary: "在这里留下你的足迹。",
			lead: "请在交流中保持友善、理性和尊重：",
			rules: [
				"请保持友善和尊重，营造良好的交流氛围。",
				"欢迎分享你的想法，也可以提出对网站的建议。",
				"你的每一条留言都是对我最大的支持 ✨",
			],
		},
	],
};
