import type {
	InterconnectSite,
	InterconnectSiteConfig,
} from "@/types/chatConfig";
import { normalizeInterconnectSites } from "@/utils/interconnect";

/**
 * 🍵 互联茶室友站专属配置列表
 *
 * 【添加新成员极简说明】：
 * 新增一个站点只需在下方数组添加一个对象，系统将自动完成：
 * 1. 自动提取 homeserver 域名，精准识别该 Matrix 节点发出的所有消息与用户；
 * 2. 自动汇总域名别名，消除手动枚举；
 * 3. 个人资料弹窗自动展示对方站长、简介、头像，并提供“访问主页”与“前往茶室”跳转链接；
 * 4. 自动注册站点来源标签，彻底免除在底层代码写死判定的麻烦。
 */
export const rawInterconnectSites: InterconnectSiteConfig[] = [
	{
		name: "冷汐的杂货铺",
		owner: "冷汐OωO",
		siteUrl: "https://lengxiqwq.com",
		chatUrl: "/chat/",
		homeserver: "matrix.lengxiqwq.com",
		avatar: "/assets/images/avatar.webp",
		desc: "你好谢谢小笼包再见",
		badge: "杂货铺",
		isSelf: true,
	},
	{
		name: "朝朝听雨",
		owner: "朝朝听雨",
		siteUrl: "https://rainzt.cn",
		chatUrl: "https://rainzt.cn/chat/",
		homeserver: "matrix.rainzt.cn",
		avatar: "https://rainzt.cn/zzty.png",
		desc: "物物而不物于物，念念而不念于念",
		badge: "听雨",
		aliases: ["听雨", "听雨茶室"],
		color: "#3b82f6",
	},
	{
		name: "Detached",
		owner: "Detached",
		siteUrl: "https://detached.online",
		chatUrl: "https://detached.online/chat/",
		homeserver: "detached.online",
		avatar: "https://detached.online/favicon.ico",
		desc: "总能看见不完美，所以一直追求完美，从修好每一处细节做起",
		badge: "Detached",
		color: "#d946ef",
	},
	{
		name: "AIOVTUE-雪",
		owner: "AIOVTUE-雪",
		siteUrl: "https://daily.yybb.us",
		chatUrl: "https://daily.yybb.us/chat/",
		homeserver: "matrix.rainzt.cn",
		avatar: "https://daily.yybb.us/owo/snow/snow-03.webp",
		desc: "雨滴会记录生命中的每一个瞬间",
		badge: "Aiovtue",
		aliases: ["aiovtue", "雪的茶室", "chat.yybb.us"],
		color: "#e07a96",
	},
	{
		name: "Somoe",
		owner: "Somoe",
		siteUrl: "https://somoe.xyz",
		chatUrl: "https://somoe.xyz/chat",
		homeserver: "chat.gbk.ink",
		avatar: "https://somoe.xyz/qiumonster.webp",
		desc: "在文字的深海里，拾贝而行",
		badge: "Somoe",
		aliases: ["gbk.ink", "gbk", "chat.gbk.ink"],
		color: "#ff9d76",
	},
	{
		name: "折腾进行时",
		owner: "HY",
		siteUrl: "https://www.9ll.uk",
		chatUrl: "https://www.9ll.uk/chat/",
		homeserver: "matrix.0dm.cn",
		avatar:
			"https://weavatar.com/api/avatar/e3298b871864a7a21690863f8c930754a36cb5c6f0b105f4b5d4737bfd219f57?s=2000&t=1783684315863",
		desc: "生命不息，折腾不止",
		badge: "折腾进行时",
		aliases: ["鹤渊", "9ll.uk", "0dm.cn", "matrix.0dm.cn"],
		color: "#f59e0b",
	},
	{
		name: "昭鸢笺",
		owner: "Mi",
		siteUrl: "https://blog.mibase.top",
		chatUrl: "https://blog.mibase.top/chat/",
		homeserver: "matrix.mibase.top",
		avatar: "https://blog.mibase.top/icon-192.png",
		desc: "鸢起云间，一纸藏闲",
		badge: "昭鸢笺",
		aliases: ["mibase.top"],
		color: "#c9a45c",
	},
];

export const interconnectSites: InterconnectSite[] =
	normalizeInterconnectSites(rawInterconnectSites);
