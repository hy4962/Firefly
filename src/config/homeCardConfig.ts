/**
 * 首页壁纸装饰卡片配置（个人卡片 + 可拖拽贴纸 + 便签）
 * 独立配置文件，不改动主题原有配置结构，便于以后合并上游主题更新。
 * 启用后首页横幅的默认文字（backgroundWallpaper.common.homeText）会被本卡片替代。
 *
 * 壁纸模式为 "banner" 或 "fullscreen" 时，首页会展示该装饰层；
 * 贴纸支持按住拖动（鼠标直接拖，触屏按住拖），刷新后恢复初始位置。
 */
export interface HomeCardSticker {
	/** 贴纸图片路径（public 目录的绝对路径，如 "/images/home-stickers/xxx.webp"） */
	src: string;
	/** 标识名，仅用于备注，不展示 */
	name: string;
	/** 距壁纸容器顶部的百分比（0-100） */
	top: number;
	/** 距壁纸容器左侧的百分比（0-100） */
	left: number;
	/** 基准宽度（px），随视口按比例缩放 */
	width: number;
	/** 旋转角度（deg，正数为顺时针） */
	rotate: number;
	/** 移动端是否显示（移动端仅显示为 true 的贴纸，位置随机投放到四角避让卡片） */
	mobile: boolean;
}

export interface HomeCardNavLink {
	name: string;
	url: string;
}

export interface HomeCardSocialLink {
	/** 名称，同时用作无障碍标签 */
	name: string;
	/** Iconify 图标名，如 "fa7-brands:github" */
	icon: string;
	/** 跳转链接（与 copy 二选一） */
	url?: string;
	/** 点击复制到剪贴板的内容（如邮箱、微信号，与 url 二选一） */
	copy?: string;
}

export const homeCardConfig = {
	// 是否启用首页装饰卡片（卡片 + 贴纸）
	enable: true,

	// 卡片内容（留空则回退：identity → profileConfig.name，title → siteConfig.title，subtitle → profileConfig.bio）
	identity: "HY",
	title: "折腾进行时",
	subtitle: "Hello, I'm HY.",

	// 标题下方的快捷导航
	navLinks: [
		{ name: "文章", url: "/archive/" },
		{ name: "友链", url: "/friends/" },
		{ name: "动态", url: "/dynamic/" },
		{ name: "留言", url: "/guestbook/" },
		{ name: "关于", url: "/about/" },
	] satisfies HomeCardNavLink[],

	// 彩色标签社交按钮（颜色按顺序循环，最多 5 个；copy 为点击复制内容）
	socials: [
		{
			name: "GitHub",
			icon: "fa7-brands:github",
			url: "https://github.com/hy4962",
		},
		{
			name: "Email，点击复制",
			icon: "fa7-solid:envelope",
			copy: "admin@9ll.uk",
		},
		{
			name: "Bilibili",
			icon: "fa7-brands:bilibili",
			url: "https://space.bilibili.com/161964502",
		},
		{
			name: "RSS",
			icon: "fa7-solid:rss",
			url: "/rss/",
		},
		{
			name: "打赏",
			icon: "material-symbols:favorite",
			url: "/sponsor/",
		},
	] satisfies HomeCardSocialLink[],

	// 头像右上角的小贴纸（可拖动，width 为基准宽度 px）
	avatarSticker: {
		src: "/images/home-stickers/claudecode.webp",
		width: 78,
	},

	// 便签贴纸（固定装饰，不可拖动；top/left 为桌面端百分比定位，移动端自动居中到顶部）
	note: {
		text: "欢迎访问",
		top: 32,
		left: 70.5,
	},

	// 场景贴纸：桌面端按 top/left 百分比定位（贴纸列表顺序即拖拽层级，后者在上）
	// 移动端仅显示 mobile: true 的贴纸，随机投放到卡片两侧的四块区域
	// 素材来自 rainzt.cn 演示，可自行替换为 public/images/home-stickers/ 下的其他图片
	stickers: [
		{
			src: "/images/home-stickers/blonde-idol.webp",
			name: "金发偶像",
			top: 18,
			left: 84,
			width: 112,
			rotate: 4,
			mobile: true,
		},
		{
			src: "/images/home-stickers/blue-witch.webp",
			name: "蓝发魔女",
			top: 72,
			left: 10,
			width: 98,
			rotate: -5,
			mobile: true,
		},
		{
			src: "/images/home-stickers/white-haired-reader.webp",
			name: "白发读者",
			top: 20,
			left: 3,
			width: 96,
			rotate: 4,
			mobile: false,
		},
		{
			src: "/images/home-stickers/bamboo-girl.webp",
			name: "竹哒",
			top: 77,
			left: 35.5,
			width: 88,
			rotate: 4,
			mobile: false,
		},
		{
			src: "/images/home-stickers/aqua-singer.webp",
			name: "初音",
			top: 75,
			left: 61,
			width: 96,
			rotate: 5,
			mobile: true,
		},
		{
			src: "/images/home-stickers/pink-bows.webp",
			name: "粉蝴蝶结",
			top: 76,
			left: 72,
			width: 92,
			rotate: -4,
			mobile: false,
		},
		{
			src: "/images/home-stickers/brown-lightning.webp",
			name: "棕发闪电",
			top: 60,
			left: 89.5,
			width: 100,
			rotate: -4,
			mobile: true,
		},
	] satisfies HomeCardSticker[],
};

export type HomeCardConfig = typeof homeCardConfig;
