import type { ChatConfig } from "@/types/chatConfig";

// 聊天页的实际配置在 src/pages/chat.astro 内联传入 ChatApp；
// 这里提供外观模块读取的壁纸目录（当前站点没有聊天壁纸资源，保持空列表）。
export const chatConfig: ChatConfig = {
	serverURL: "https://tea.0dm.cn",
	rooms: [
		{ id: "lobby", name: "互联茶室", subtitle: "和其他站点的朋友一起聊天" },
		{ id: "chat", name: "闲聊", subtitle: "随便聊聊日常与折腾" },
	],
	enableImageUpload: true,
	playlistOutApiURL: "https://playlistout-api.lengxiqwq.com",
	wallpapers: {
		defaultOpacity: 0.2,
		defaults: { left: "", center: "", right: "", input: "" },
		items: [],
	},
};
