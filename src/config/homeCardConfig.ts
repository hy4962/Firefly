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
	/** 距壁纸容器顶部的百分比（与 bottom 二选一） */
	top?: number;
	/** 距壁纸容器底部的百分比（与 top 二选一；一排贴纸用 bottom 锚定可保证脚踩同一条地面线） */
	bottom?: number;
	/** 距壁纸容器左侧的百分比（0-100） */
	left: number;
	/** 基准宽度（px），随视口按比例缩放 */
	width: number;
	/** 旋转角度（deg，正数为顺时针） */
	rotate: number;
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

	// 场景贴纸：按百分比定位，top（距顶）或 bottom（距底）二选一 + left
	// （贴纸列表顺序即拖拽层级，后者在上）
	// 桌面分三层：
	//   上方一排   top: 20   —— 左右两个角
	//   底部前排   bottom: 5  —— 8 张等距（1.2 / 13.7 / 26.2 / 38.7 / 51.2 / 63.7 / 76.2 / 88.7）
	//   底部后排   bottom: 16 —— 6 张等距错位（7.4 / 21.6 / 35.8 / 50 / 64.2 / 78.4）
	// `bottom >= 12` 视为后排：窗口高度不足 940px 时由 CSS 整排隐藏（否则会顶到卡片）
	// 移动端由脚本按卡片位置重新排布，不依赖上面的 left 顺序
	// 素材在 public/images/home-stickers/，可自行增删
	stickers: [
		{
			src: "/images/home-stickers/blonde-idol.webp",
			name: "金发偶像",
			top: 20,
			left: 1.2,
			width: 112,
			rotate: 4,
		},
		{
			src: "/images/home-stickers/roxy.webp",
			name: "洛琪希",
			bottom: 5,
			left: 1.2,
			width: 98,
			rotate: -5,
		},
		{
			src: "/images/home-stickers/kirino-cheer.webp",
			name: "高坂桐乃·欢呼",
			bottom: 5,
			left: 13.7,
			width: 96,
			rotate: 5,
		},
		{
			src: "/images/home-stickers/misaka.webp",
			name: "御坂美琴",
			bottom: 5,
			left: 26.2,
			width: 100,
			rotate: -4,
		},
		{
			src: "/images/home-stickers/sagiri.webp",
			name: "和泉纱雾",
			bottom: 5,
			left: 38.7,
			width: 96,
			rotate: 4,
		},
		{
			src: "/images/home-stickers/kirino-lying.webp",
			name: "高坂桐乃·躺平",
			bottom: 5,
			left: 51.2,
			width: 110,
			rotate: -6,
		},
		{
			src: "/images/home-stickers/madoka.webp",
			name: "鹿目圆",
			bottom: 5,
			left: 63.7,
			width: 92,
			rotate: -4,
		},
		{
			src: "/images/home-stickers/kirino-pout.webp",
			name: "高坂桐乃·抱臂",
			bottom: 5,
			left: 76.2,
			width: 92,
			rotate: 4,
		},
		{
			src: "/images/home-stickers/miku.webp",
			name: "初音未来",
			bottom: 5,
			left: 88.7,
			width: 96,
			rotate: 5,
		},
		{
			src: "/images/home-stickers/nezuko.webp",
			name: "祢豆子",
			top: 20,
			left: 94,
			width: 88,
			rotate: 4,
		},
		{
			src: "/images/home-stickers/shana-melon.webp",
			name: "夏娜·蜜瓜包",
			bottom: 16,
			left: 7.4,
			width: 100,
			rotate: -4,
		},
		{
			src: "/images/home-stickers/louise-maid.webp",
			name: "露易丝·女仆",
			bottom: 16,
			left: 21.6,
			width: 104,
			rotate: 4,
		},
		{
			src: "/images/home-stickers/shana-jump.webp",
			name: "夏娜·跃斩",
			bottom: 16,
			left: 35.8,
			width: 100,
			rotate: -6,
		},
		{
			src: "/images/home-stickers/shana-sword-black.webp",
			name: "夏娜·持剑（黑发）",
			bottom: 16,
			left: 50,
			width: 116,
			rotate: 3,
		},
		{
			src: "/images/home-stickers/pink-neko.webp",
			name: "粉发猫耳",
			bottom: 16,
			left: 64.2,
			width: 124,
			rotate: -4,
		},
		{
			src: "/images/home-stickers/shana-sword-red.webp",
			name: "夏娜·持剑（红发）",
			bottom: 16,
			left: 78.4,
			width: 112,
			rotate: 5,
		},
	] satisfies HomeCardSticker[],
};

export type HomeCardConfig = typeof homeCardConfig;
