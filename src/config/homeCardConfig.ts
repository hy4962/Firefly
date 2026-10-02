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

export interface HomeCardAutoCollapse {
	/** 是否启用「入场停留一会儿 → 自动把卡片让开，露出纯壁纸」 */
	enable: boolean;
	/** 入场动画落定后，卡片完整亮着停留多久才收起（ms） */
	hold: number;
	/** 手机端（≤767px）是否也收起 */
	enableOnMobile: boolean;
	/** 收起动画时长（ms） */
	duration: number;
	/** 卡片右上角是否挂一个半透明小 ×（点它立刻收起，不必等自动到点） */
	closeButton: boolean;
	/** 卡片往哪一侧滑出屏幕 */
	slideTo: "left" | "right";
	/** 收起后挂出的小竖条停在哪一侧 */
	tabSide: "left" | "right";
	/** 小竖条上的文字（竖排显示，2-4 个字最好看） */
	tabText: string;
}

export interface HomeCardDesktopStickerRow {
	/** 桌面端这一排放几张（从 stickers 里随机抽，刷新换一批）。0 或 ≥ 列表长度 = 全部铺满、不抽签 */
	count: number;
	/** 正中央留出的空档宽度（占壁纸宽度的百分比），下滑箭头要落在这块空地里 */
	centerGap: number;
}

export interface HomeCardStickerToggle {
	/** 是否在壁纸右下角显示「隐藏贴纸」开关 */
	enable: boolean;
	/** 每张之间错开多久（ms）。0 = 整排一起动 */
	stagger: number;
	/** 单张淡出 / 淡入时长（ms） */
	duration: number;
}

export const homeCardConfig = {
	// 是否启用首页装饰卡片（卡片 + 贴纸）
	enable: true,

	// 手机端（≤767px）随机显示多少张场景贴纸（贴纸再多也不会挤满手机屏，刷新会换一批；0 或留空=全显示）
	// ⚠️ 这个数字直接决定手机端排几行，别随手加大：
	//   手机端每行能放几张 = floor(97.6 / (size/屏宽 × 100 + 1.6))，尺寸从 68px 往下试，
	//   只要"行数 × 行高"塞得进卡片下方的安全区就定案（会优先选 68px）。
	//   实测 390px 宽时 68px 每行 5 张、360px 宽时降到 4 张 —— 所以 5 开始就会在某些机型上翻成两行。
	//   取 4 可保证窄到 320px（iPhone SE）仍是完整一行；取 8 就是两行 2×4（旧配置）。
	mobileStickerLimit: 4,

	// 桌面端底部这一排怎么铺（正中央给下滑箭头留一块空地，所以左右分列而不是一条直线铺满）
	// 之所以要留空档：贴纸层 z-index(25) 压在下滑箭头(10) 上面，居中那张正好把箭头盖死。
	// 抽签是**每次刷新换一批**，抽中的按视觉中心等距分列：左半 N/2 张、右半 N/2 张，
	// 两端留 5% 边距，中间空出 centerGap 那一段。
	// 约束：左右两侧各自的中心间距 = (45 - centerGap/2) / (每侧张数 - 1)，
	//       相邻两张 width 之和 ≲ 30.72 × 该间距（沿用全宽等距时的同一条闸门）。
	//       10 张 / 空档 20% → 间距 8.75% → 上限 268.8，当前最宽的一对 116+112=228，安全。
	desktopStickerRow: {
		// 一排放几张（11 张素材里随机抽 10 张）。改 0 就是全部铺满、不留空档（箭头会被盖住）
		count: 10,

		// 中央空档宽度（%）。箭头 80px 宽，1280 宽下 20% ≈ 256px，两侧各余 ~88px 净空；
		// 想让贴纸更挤就调小（最小别低于 16，否则 1024 宽下贴纸会蹭到箭头）
		centerGap: 20,
	} satisfies HomeCardDesktopStickerRow,

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

	// 入场后自动收起：卡片停一会儿就把位置让给壁纸，只在边缘留一根小竖条，点一下能把卡片滑回来。
	// 只在「首次进入 / 刷新」时播一次 —— 同一个标签页里从文章返回首页不会再重播，卡片保持收起状态。
	// 想彻底关掉这项（卡片一直在）就把 enable 改成 false。
	autoCollapse: {
		enable: true,

		// 入场动画落定之后，卡片完整亮着停留多久才收起（ms）。想调「展示多久」只动这一个数。
		//
		// 这里**不需要**填「从入场开始算」的总时长：组件会在入场动画真跑完（监听 animationend）
		// 之后再开始计时，所以以后改 HomeWallpaperDecor 里入场动画的节奏，这个数不用跟着动。
		// 系统开了「减少动态效果」时动画不跑、也就没有 animationend，此时按「卡片一亮就开始算」处理，
		// 语义仍然对得上（没有入场动画 = 立刻就位）。
		hold: 2000,

		// 手机端是否也收起。手机屏小、卡片几乎是首屏唯一内容，收起后只剩壁纸 + 小竖条；
		// 觉得太空就把这里改成 false，只让桌面端播这个开场。
		enableOnMobile: true,

		// 收起 / 展开动画时长（ms）
		duration: 950,

		// 卡片右上角要不要挂一个半透明小 −。点它立刻收起，不用等自动到点；
		// 收起后还能从边缘小竖条把卡片叫回来，所以用减号而不是叉（不是"永久关掉"）。
		closeButton: true,

		// 卡片往哪一侧滑出屏幕："right" | "left"
		slideTo: "right",

		// 收起后小竖条停在哪一侧："left" | "right"
		// 跟 slideTo 放同侧（都 right）才连贯：卡片从右边走，签子也从右边挂出来。
		tabSide: "right",

		// 小竖条上的文字（竖排）
		tabText: "关于我",
	} satisfies HomeCardAutoCollapse,

	// 头像右上角的小贴纸（可拖动，width 为基准宽度 px）
	avatarSticker: {
		src: "/images/home-stickers/claudecode.webp",
		width: 78,
	},

	// 便签贴纸（固定装饰，不可拖动；top/left 为桌面端百分比定位，移动端自动居中到顶部）
	// enable: false → 组件直接不渲染这个节点（不是 display:none，是压根不输出）
	note: {
		enable: false,
		text: "欢迎访问",
		top: 32,
		left: 70.5,
	},

	// 场景贴纸：按百分比定位，top（距顶）或 bottom（距底）二选一 + left
	// （贴纸列表顺序即拖拽层级，后者在上）
	// 桌面端全部铺在卡片下方同一排（bottom 一致 → 脚踩同一条地面线），
	// left 按「视觉中心等距」算：中心从 5% 到 95% 均分，再各减去自身宽度的一半。
	// 之所以不直接让 left 等距，是因为各张基准宽度不同、图在盒子内居中，
	// left 等距时视觉中心会左右漂移（最多 ±11px / 1920）。
	// 约束：中心间距 = 90/(张数-1) %，必须 > 相邻两张半宽之和。11 张 → 间距 9%。
	// 换算成 width 的闸门：相邻两张 width 之和 ≲ 2764.8/(张数-1)（11 张 = 276.5，再按 8 折给旋转留余量）。
	// 现在最紧的一对是 shana-sword-black 116 + pink-neko 110 = 226，1024 宽下还有 ~11px 净空隙。
	// ⚠️ 注意 width 只管**盒子**宽度，贴纸实际大小由 img 的 max-height:104px 决定：
	// 可见宽 = min(盒宽, 104/宽高比)，竖长的图（如 kirino-pout 宽高比 2.16）盒子再宽也只显示 48px。
	// 所以真正会互相顶到的只有扁图（pink-neko 0.89、shana-hairflip 0.95）。
	// 动图同理：GIF → 动画 webp 见 skill 里的 gif-to-sticker.py。
	// 注意 bottom < 12 时不会带 --rear 类，矮窗口 CSS 那条整排隐藏对这批不生效。
	// 需要用到卡片上方时给 `top: 20` 即可，移动端脚本会按之自动分带
	// 移动端由脚本按卡片位置重新排布（只认有无 bottom，与具体数值无关），不依赖下面的 left
	// 素材在 public/images/home-stickers/，可自行增删
	stickers: [
		{
			src: "/images/home-stickers/kirino-cheer.webp",
			name: "高坂桐乃·欢呼",
			bottom: 5,
			left: 1.88,
			width: 96,
			rotate: 5,
		},
		{
			src: "/images/home-stickers/misaka.webp",
			name: "御坂美琴",
			bottom: 5,
			left: 10.74,
			width: 100,
			rotate: -4,
		},
		{
			src: "/images/home-stickers/sagiri.webp",
			name: "和泉纱雾",
			bottom: 5,
			left: 19.88,
			width: 96,
			rotate: 4,
		},
		{
			src: "/images/home-stickers/kirino-lying.webp",
			name: "高坂桐乃·躺平",
			bottom: 5,
			left: 28.42,
			width: 110,
			rotate: -6,
		},
		{
			src: "/images/home-stickers/madoka.webp",
			name: "鹿目圆",
			bottom: 5,
			left: 38.01,
			width: 92,
			rotate: -4,
		},
		{
			src: "/images/home-stickers/kirino-pout.webp",
			name: "高坂桐乃·抱臂",
			bottom: 5,
			left: 47.01,
			width: 92,
			rotate: 4,
		},
		{
			src: "/images/home-stickers/shana-jump.webp",
			name: "夏娜·跃斩",
			bottom: 5,
			left: 55.74,
			width: 100,
			rotate: -6,
		},
		{
			// 动图（6 帧 / 300ms 一轮，GIF → 动画 webp 见 skill 的 gif-to-sticker.py）
			// width 要 ≥ 104/宽高比(=0.95)→110，盒子才不会被限住、比邻居矮一截
			src: "/images/home-stickers/shana-hairflip.webp",
			name: "夏娜·甩发",
			bottom: 5,
			left: 64.74,
			width: 100,
			rotate: -3,
		},
		{
			src: "/images/home-stickers/shana-sword-black.webp",
			name: "夏娜·持剑（黑发）",
			bottom: 5,
			left: 73.22,
			width: 116,
			rotate: 3,
		},
		{
			src: "/images/home-stickers/pink-neko.webp",
			name: "粉发猫耳",
			bottom: 5,
			left: 82.42,
			width: 110,
			rotate: -4,
		},
		{
			src: "/images/home-stickers/shana-sword-red.webp",
			name: "夏娜·持剑（红发）",
			bottom: 5,
			left: 91.35,
			width: 112,
			rotate: 5,
		},
		// ---- 2026-10-02 新增：黑猫拍立得挂件九宫格 + 单张帽娃（桌面端运行时随机抽 10 张重排，left 仅作排序用） ----
		{
			src: "/images/home-stickers/kirino-sit.webp",
			name: "高坂桐乃·坐姿",
			bottom: 5,
			left: 3,
			width: 100,
			rotate: -4,
		},
		{
			src: "/images/home-stickers/kirino-glasses.webp",
			name: "高坂桐乃·墨镜",
			bottom: 5,
			left: 12,
			width: 104,
			rotate: 4,
		},
		{
			src: "/images/home-stickers/kirino-maid.webp",
			name: "高坂桐乃·女仆",
			bottom: 5,
			left: 21,
			width: 102,
			rotate: -3,
		},
		{
			src: "/images/home-stickers/kuroneko-hat.webp",
			name: "黑猫·草帽",
			bottom: 5,
			left: 31,
			width: 108,
			rotate: 5,
		},
		{
			src: "/images/home-stickers/kuroneko-swim.webp",
			name: "黑猫·泳装",
			bottom: 5,
			left: 41,
			width: 98,
			rotate: -5,
		},
		{
			src: "/images/home-stickers/kuroneko-maid.webp",
			name: "黑猫·女仆",
			bottom: 5,
			left: 51,
			width: 103,
			rotate: 3,
		},
		{
			src: "/images/home-stickers/ayase-swim.webp",
			name: "新垣绫濑·泳装",
			bottom: 5,
			left: 61,
			width: 100,
			rotate: -4,
		},
		{
			src: "/images/home-stickers/kanako-swim.webp",
			name: "来栖加奈子·泳装",
			bottom: 5,
			left: 71,
			width: 106,
			rotate: 5,
		},
		{
			src: "/images/home-stickers/maid-glasses.webp",
			name: "螺旋眼镜·女仆",
			bottom: 5,
			left: 81,
			width: 102,
			rotate: -3,
		},
		{
			src: "/images/home-stickers/kuroneko-dress.webp",
			name: "黑猫·白裙草帽",
			bottom: 5,
			left: 90,
			width: 108,
			rotate: 4,
		},
	] satisfies HomeCardSticker[],

	// 右下角的「隐藏贴纸」开关：点一下把这排小人收走，再点一下放回来。
	// 状态存 localStorage（homeWallpaperStickersHidden），刷新、切页、从文章返回都记得住。
	// 只影响下面 stickers 这一排；卡片头像上那张小贴纸属于卡片，不跟着走。
	stickerToggle: {
		enable: true,

		// 逐张错开的间隔（ms）：收的时候从左往右一张张走，放回来从右往左接上。
		// 想整排一起动就填 0。
		stagger: 40,

		// 单张淡出 / 淡入时长（ms）
		duration: 340,
	} satisfies HomeCardStickerToggle,
};

export type HomeCardConfig = typeof homeCardConfig;
