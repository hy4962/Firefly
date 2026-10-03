import type { BooknavGroup, BooknavPageConfig } from "../types/booknavConfig";

// 书签导航页面配置
export const booknavPageConfig: BooknavPageConfig = {
	// 页面标题，如果留空则使用 i18n 中的翻译
	title: "",

	// 页面描述文本，如果留空则使用 i18n 中的翻译
	description: "",

	// favicon 自动获取配置
	favicon: {
		// 书签未填写 icon 时，是否自动获取目标站点的 favicon 图标
		enabled: true,

		// favicon 接口地址，{domain} 为占位符，会被替换成目标站点域名
		// 更换接口只需保证地址里含有 {domain}，例如：
		//   https://a.favicon.im/{domain}
		//   https://favicon.im/{domain}
		api: "https://a.favicon.im/{domain}",
	},
};

// 书签导航配置
// 每个数组项是一个分类组，分类组内的 items 是该分类下的书签
export const booknavConfig: BooknavGroup[] = [
	{
		id: "dev",
		name: "开发",
		icon: "material-symbols:code-rounded",
		desc: "写代码时离不开的站点",
		weight: 100,
		items: [
			{
				title: "GitHub",
				url: "https://github.com",
				desc: "全球最大的代码托管平台",
				// icon 字段可以使用 astro-icon 图标库的图标名称
				// 也可以使用图片 URL 和本地图片路径
				// 不填则会通过接口自动获取目标站点的 favicon 图标（需要在上面配置）
				icon: "fa7-brands:github",
				weight: 10,
			},
			{
				title: "MDN Web Docs",
				url: "https://developer.mozilla.org",
				desc: "最权威的 Web 技术文档",
				weight: 9,
			},
			{
				title: "Astro",
				url: "https://astro.build",
				desc: "内容驱动型网站的 Web 框架",
				weight: 8,
			},
			{
				title: "Svelte",
				url: "https://svelte.dev",
				desc: "把组件编译成高效原生 JS 的框架",
				weight: 7,
			},
			{
				title: "Tailwind CSS",
				url: "https://tailwindcss.com",
				desc: "一个功能强大且灵活的 CSS 框架",
				weight: 6,
			},
			{
				title: "Firefly",
				url: "https://github.com/hy4962/Firefly",
				desc: "Firefly 博客源码仓库",
				icon: "fa7-brands:github",
				weight: 5,
			},
		],
	},
	{
		id: "opensource",
		name: "项目",
		icon: "material-symbols:folder-open-rounded",
		desc: "好用的开源项目",
		weight: 90,
		items: [
			{
				title: "Firefly",
				url: "https://github.com/CuteLeaf/Firefly",
				desc: "清晰美观的 Astro 个人博客主题模板",
				icon: "fa7-brands:github",
				weight: 10,
			},
			{
				title: "BewlyCat",
				url: "https://github.com/keleus/BewlyCat",
				desc: "Bilibili 一站式增强插件",
				icon: "fa7-brands:github",
				weight: 9,
			},
			{
				title: "MaiBot",
				url: "https://github.com/Mai-with-u/MaiBot",
				desc: "QQ/Telegram 群聊机器人框架",
				icon: "fa7-brands:github",
				weight: 8,
			},
			{
				title: "CC-Switch",
				url: "https://github.com/farion1231/cc-switch",
				desc: "Claude Code 快速切换工具",
				icon: "fa7-brands:github",
				weight: 7,
			},
			{
				title: "Claude Desktop 中文版",
				url: "https://github.com/javaht/claude-desktop-zh-cn",
				desc: "Claude Desktop 官方中文语言包",
				icon: "fa7-brands:github",
				weight: 6,
			},
		],
	},
	{
		id: "design",
		name: "设计",
		icon: "material-symbols:palette-outline-rounded",
		desc: "配色、图标与灵感来源",
		weight: 90,
		items: [
			{
				title: "Iconify",
				url: "https://icon-sets.iconify.design",
				desc: "海量开源图标集合搜索",
				weight: 10,
			},
			{
				title: "iconfont",
				url: "https://www.iconfont.cn",
				desc: "阿里巴巴矢量图标库",
				weight: 9,
			},
			{
				title: "DeviantArt",
				url: "https://www.deviantart.com/",
				desc: "全球最大的插画与数字艺术社区",
				weight: 8,
			},
		],
	},
	{
		id: "tools",
		name: "工具",
		icon: "material-symbols:build-outline-rounded",
		desc: "顺手的在线小工具",
		weight: 80,
		items: [
			{
				title: "TinyPNG",
				url: "https://tinypng.com",
				desc: "在线压缩 PNG / JPEG 图片",
				weight: 10,
			},
			{
				title: "Squoosh",
				url: "https://squoosh.app",
				desc: "Google 出品的图片压缩与格式转换",
				weight: 9,
			},
			{
				title: "Carbon",
				url: "https://carbon.now.sh",
				desc: "把代码片段生成漂亮的图片",
				weight: 8,
			},
			{
				title: "兽音译者",
				url: "https://roar.iiilab.com/",
				desc: "兽音咆哮体在线编码解码",
				weight: 7,
			},
		],
	},
	{
		id: "selfhost",
		name: "自建服务",
		icon: "material-symbols:dns-outline-rounded",
		desc: "自部署的在线服务",
		weight: 87,
		items: [
			{
				title: "评论系统",
				url: "https://waline.9ll.uk/",
				desc: "基于 Waline 的站内评论系统",
				weight: 10,
			},
			{
				title: "免费图床",
				url: "https://imgbed.9ll.uk/",
				desc: "自建图片托管服务",
				weight: 9,
			},
			{
				title: "免费邮局",
				url: "https://email.9ll.uk/",
				desc: "自建邮箱服务",
				weight: 8,
			},
			{
				title: "网站监控",
				url: "https://kuma.9ll.uk/status/9ll",
				desc: "站点可用性监控面板",
				weight: 7,
			},
			{
				title: "站点统计",
				url: "https://umami.9ll.uk/share/Z4DD4Y3q9CTFpBeM",
				desc: "基于 Umami 的流量统计",
				weight: 6,
			},
		],
	},
	{
		id: "ai",
		name: "AI 平台",
		icon: "material-symbols:smart-toy-rounded",
		desc: "AI 大模型服务平台",
		weight: 85,
		items: [
			{
				title: "ChatGPT",
				url: "https://chatgpt.com/",
				desc: "GPT大人秒杀一切！！！！！",
				weight: 11,
			},
			{
				title: "MiMo",
				url: "https://mimo.mi.com/docs/zh-CN/quick-start/summary/welcome",
				desc: "小米 MiMo 大模型开放平台",
				weight: 10,
			},
			{
				title: "DeepSeek",
				url: "https://platform.deepseek.com/usage",
				desc: "DeepSeek AI 开放平台",
				weight: 9,
			},
			{
				title: "SenseNova",
				url: "https://platform.sensenova.cn/console",
				desc: "深势科技 SenseNova 大模型平台",
				weight: 8,
			},
			{
				title: "SiliconFlow",
				url: "https://cloud.siliconflow.cn/me/models",
				desc: "SiliconFlow 硅基流动云平台",
				weight: 7,
			},
			{
				title: "Agnes AI (国内)",
				url: "https://platform.agnes-ai.cn/settings/apiKeys",
				desc: "Agnes AI 国内站",
				weight: 6,
			},
			{
				title: "Agnes AI (国际)",
				url: "https://platform.agnes-ai.com/settings/apiKeys",
				desc: "Agnes AI 国际站",
				weight: 5,
			},
		],
	},
	{
		id: "infra",
		name: "基础设施",
		icon: "material-symbols:cloud-outline-rounded",
		desc: "云服务与域名管理",
		weight: 65,
		items: [
			{
				title: "Cloudflare",
				url: "https://dash.cloudflare.com/",
				desc: "全球 CDN 与安全服务",
				weight: 10,
			},
			{
				title: "Spaceship",
				url: "https://www.spaceship.com/zh/",
				desc: "域名注册与管理",
				weight: 9,
			},
			{
				title: "Vercel",
				url: "https://vercel.com/",
				desc: "前端部署与托管平台",
				weight: 8,
			},
			{
				title: "FnNAS",
				url: "https://fnnas.com/",
				desc: "飞牛 NAS 私有云存储系统",
				weight: 7,
			},
		],
	},
	{
		id: "resources",
		name: "资源",
		icon: "material-symbols:auto-stories-outline-rounded",
		desc: "文档、教程与阅读",
		weight: 70,
		items: [
			{
				title: "Firefly Docs",
				url: "https://docs-firefly.cuteleaf.cn",
				desc: "Firefly 主题模板文档",
				icon: "https://docs-firefly.cuteleaf.cn/logo.png",
				weight: 10,
			},
		],
	},
	{
		id: "acg",
		name: "ACG",
		icon: "material-symbols:live-tv-rounded",
		desc: "追番、找资源、下种子",
		weight: 78,
		items: [
			{
				title: "蜜柑计划",
				url: "https://mikanime.tv/",
				desc: "番剧 BT 聚合，追番 RSS 首选",
				weight: 10,
			},
			{
				title: "動漫花園",
				url: "https://share.dmhy.org/",
				desc: "老牌动漫 BT 资源站",
				weight: 10,
			},
			{
				title: "萌番组",
				url: "https://bangumi.moe/",
				desc: "番剧种子聚合，自带 BT 下载器",
				weight: 9,
			},
			{
				title: "末日動漫資源庫",
				url: "https://share.acgnx.net/",
				desc: "Project AcgnX，番剧资源分流",
				weight: 9,
			},
			{
				title: "Anime Garden",
				url: "https://animes.garden/",
				desc: "動漫花園資源網镜像聚合站",
				weight: 8,
			},
			{
				title: "爱恋动漫",
				url: "https://www.kisssub.org/",
				desc: "老牌字幕组站，番剧 BT 资源",
				weight: 7,
			},
			{
				title: "漫猫动漫",
				url: "https://www.comicat.org/#continue",
				desc: "新番 BT 下载与字幕",
				weight: 6,
			},
			{
				title: "GYING 动漫筛选",
				url: "https://www.gyg.la/ac",
				desc: "按条件筛番剧，找片效率工具",
				weight: 5,
			},
			{
				title: "GYING 发布页",
				url: "https://www.gying.page/",
				desc: "观影地址发布页",
				weight: 4,
			},
			{
				title: "TrackersList",
				url: "https://trackerslist.com/#/zh?id=xiu2trackerslistcollection",
				desc: "XIU2 维护的 BT Tracker 列表",
				weight: 3,
			},
		],
	},
	{
		id: "galgame",
		name: "Galgame",
		icon: "material-symbols:videogame-asset-rounded",
		desc: "Gal 社区、补丁与资源站",
		weight: 76,
		items: [
			{
				title: "鲲 Galgame 论坛",
				url: "https://www.kungal.com/",
				desc: "大佬一个人手搓的开源 Galgame 论坛，无广告不收费",
				weight: 12,
			},
			{
				title: "摸摸鱼ACG",
				url: "https://www.mmyacg.com/",
				desc: "Galgame 资源社区，每天大量更新",
				weight: 11,
			},
			{
				title: "鲲 Galgame 补丁",
				url: "https://www.moyu.moe/",
				desc: "开源 Galgame 补丁资源站，鲲的姊妹站",
				weight: 10,
			},
			{
				title: "TouchGal",
				url: "https://www.touchgal.us/",
				desc: "一站式 Galgame 文化社区，支持在线游玩",
				weight: 9,
			},
			{
				title: "稻荷 GAL",
				url: "https://inarigal.com/",
				desc: "Galgame 资源下载分享社区",
				weight: 9,
			},
			{
				title: "猫猫网盘",
				url: "https://catcat.cloud/",
				desc: "Galgame 网盘资源站",
				weight: 8,
			},
			{
				title: "量子 ACG",
				url: "https://lzacg.cc/",
				desc: "ACG 游戏资源站",
				weight: 8,
			},
			{
				title: "绮梦 ACG",
				url: "https://game.acgs.one/",
				desc: "Galgame 资源下载",
				weight: 7,
			},
			{
				title: "2DFan",
				url: "https://2dfmax.top/",
				desc: "Galgame 汉化补丁与资源",
				weight: 7,
			},
			{
				title: "老男人游戏网",
				url: "https://www.oldmantvg.net/",
				desc: "老牌 Galgame 下载站",
				weight: 6,
			},
			{
				title: "御爱同萌",
				url: "https://www.ai2.moe/",
				desc: "Galgame 论坛社区",
				weight: 6,
			},
			{
				title: "宇宙游戏库",
				url: "https://yzhouk.com/",
				desc: "全维度游戏资源聚合站",
				weight: 5,
			},
			{
				title: "NekoGAL",
				url: "https://www.nekogal.com/",
				desc: "Galgame 资源传递者",
				weight: 5,
			},
			{
				title: "Hikarinagi",
				url: "https://www.hikarinagi.org/",
				desc: "一个 ACGN 文化社区",
				weight: 4,
			},
			{
				title: "MikuGame 初音游戏库",
				url: "https://mikugame.icu/",
				desc: "游戏资源下载站",
				weight: 4,
			},
			{
				title: "GGS",
				url: "https://gal.saop.cc/",
				desc: "Galgame 资源站",
				weight: 3,
			},
		],
	},
	];
