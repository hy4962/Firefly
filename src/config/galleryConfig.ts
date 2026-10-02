import type { GalleryConfig } from "@/types/galleryConfig";

// 相册配置
export const galleryConfig: GalleryConfig = {
	// 相册列表
	albums: [
		// 支持jpg/png/webp/avif/gif格式
		// id: 相册唯一标识符（用于目录命名和URL路径），比如设置：id: "firefly-2026", 对应 public/gallery/firefly-2026/目录
		// cover: 手动指定封面图（可选，不填会把cover.*文件作为封面图，如果没有cover.*文件，则使用第一张图片作为封面图）
		// name: 相册名称
		// description: 相册描述
		// location: 相册拍摄地点
		// date: 相册日期，格式为 YYYY-MM-DD，用于排序和显示
		// tags: 相册标签，用于分类和过滤
		// password: 访问密码，设置后需要输入密码才能查看相册内容（可选）
		// passwordHint: 密码提示，设置后在输入密码错误时显示（可选，需配合password使用）
		// 每添加一个数组项就相当于添加了一个相册，记得在 public/gallery/ 目录下创建对应的子目录并放入图片
		
		{
			id: "blog",
			name: "博客截图",
			description: "博客首页的截图记录。",
			location: "Firefly 博客",
			date: "2026-09-07",
			tags: ["博客", "截图"],
		},
		{
			id: "firefly-2026",
			name: "可爱流萤",
			description: "飞萤之火自无梦的长夜亮起，绽放在终竟的明天。流萤壁纸与主题默认素材合集。",
			location: "崩坏：星穹铁道",
			date: "2026-01-01",
			tags: ["崩坏星穹铁道", "流萤", "壁纸"],
			cover: "/gallery/firefly-2026/d1.avif",
		},
		{
			id: "desktop-wallpaper",
			name: "桌面壁纸",
			description: "博客桌面端背景壁纸合集。",
			location: "Firefly 博客",
			date: "2026-09-09",
			tags: ["壁纸", "桌面"],
		},
		{
			id: "mobile-wallpaper",
			name: "手机壁纸",
			description: "博客移动端背景壁纸合集。",
			location: "Firefly 博客",
			date: "2026-09-09",
			tags: ["壁纸", "手机"],
		},
		{
			id: "design-assets",
			name: "站点设计稿",
			description: "博客 Logo 与小图标的设计稿记录。",
			location: "Firefly 博客",
			date: "2026-09-09",
			tags: ["设计", "Logo"],
		},
		{
			id: "stickers",
			name: "首页贴纸原图",
			description:
				"首页场景贴纸的原始画稿存档：全分辨率真原图，未经任何压缩与处理（保留画师签名与白底）。前三张素材年代较早，只有 192px 的版本；2026-10 起新增一批挂件九宫格切图与单张高清稿，同款重复的已清掉，只留最清晰的一份。",
			location: "Firefly 博客",
			date: "2026-09-26",
			tags: ["贴纸", "原图", "存档"],
			cover: "/gallery/stickers/kirino-cheer.png",
		},
		{
			id: "shana-emotes",
			name: "夏娜表情",
			description:
				"灼眼的夏娜表情包合集：发怒、叹气、大哭、慌乱、懵圈、挥手、星星眼、脸红、蜜瓜包。原图画稿存档，未压缩。",
			location: "灼眼的夏娜",
			date: "2026-09-28",
			tags: ["灼眼的夏娜", "表情包", "存档"],
		},
		{
			id: "shana-pc",
			name: "夏娜壁纸·电脑",
			description:
				"《灼眼的夏娜》桌面壁纸合集：31 张，4K–8K 原图压制的 2560 长边 webp，横竖混排。原图归档在仓库 gallery-originals/shana-pc/。",
			location: "灼眼的夏娜",
			date: "2026-09-28",
			tags: ["灼眼的夏娜", "壁纸", "桌面"],
			cover: "/gallery/shana-pc/09.webp",
		},
		{
			id: "shana-phone",
			name: "夏娜壁纸·手机",
			description:
				"《灼眼的夏娜》手机壁纸合集：29 张，以竖构图为主，2560 长边 webp。原图归档在仓库 gallery-originals/shana-phone/。",
			location: "灼眼的夏娜",
			date: "2026-09-28",
			tags: ["灼眼的夏娜", "壁纸", "手机"],
			cover: "/gallery/shana-phone/04.webp",
		},
		{
			id: "analytics",
			name: "统计页插画",
			description:
				"/analytics/ 页面的插画素材合集：页首横幅、两张角色立绘与四张概览卡片插画。原图归档在仓库 gallery-originals/analytics/。",
			location: "Firefly 博客",
			date: "2026-09-29",
			tags: ["统计页", "插画", "存档"],
			cover: "/gallery/analytics/02-push-rhythm.webp",
		},
		// {
		// 	id: "firefly-2026",
		// 	name: "可爱流萤",
		// 	description: "飞萤之火自无梦的长夜亮起，绽放在终竟的明天。",
		// 	location: "崩坏：星穹铁道",
		// 	date: "2026-01-01",
		// 	tags: ["崩坏星穹铁道", "流萤"],
		// },
		// {
		// 	id: "encrypted-test",
		// 	name: "加密相册示例",
		// 	description:
		// 		"这是一个加密相册的示例，设置了访问密码，只有输入正确的密码才能查看相册内容。",
		// 	location: "崩坏：星穹铁道",
		// 	date: "2026-02-01",
		// 	tags: ["加密相册", "示例"],
		// 	password: "123456",
		// 	passwordHint: "示例密码123456",
		// },
	],

	// 瀑布流最小列宽(px)，浏览器根据容器宽度自动计算列数，默认 240
	// 值越小列数越多，值越大列数越少
	columnWidth: 240,
};
