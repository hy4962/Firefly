import type { FriendLink, FriendsPageConfig } from "../types/friendsConfig";

// 可以在src/content/spec/friends.md中编写友链页面下方的自定义内容

// 友链页面配置
export const friendsPageConfig: FriendsPageConfig = {
	// 页面标题，如果留空则使用 i18n 中的翻译
	title: "",

	// 页面描述文本，如果留空则使用 i18n 中的翻译
	description: "",

	// 是否显示底部自定义内容（friends.mdx 中的内容）
	showCustomContent: true,

	// 是否显示评论区，需要先在commentConfig.ts启用评论系统
	showComment: true,

	// 是否开启随机排序配置，如果开启，就会忽略权重，构建时进行一次随机排序
	randomizeSort: false,
};

// 友链配置
export const friendsConfig: FriendLink[] = [
	{
		title: "折腾进行时",
		imgurl: "https://www.9ll.uk/assets/images/avatar.avif",
		desc: "生命不息，折腾不止！",
		siteurl: "https://www.9ll.uk",
		rss: "/rss.xml", // 本站 RSS，使自己的文章进入朋友圈时间线并标记"本站主理人"
		homepage: "https://www.9ll.uk/gallery/blog/homepage.png", // 首页照片
		tags: ["Blog"],
		weight: 100, // 权重，数字越大排序越靠前
		enabled: true, // 是否启用
	},
	{
		title: "夏夜流萤",
		imgurl:
			"https://weavatar.com/avatar/d252655d40d6874417a720bad0a6c5f77f8f6a1fd2f882f8f338402dc37e4190?s=640",
		desc: "飞萤之火自无梦的长夜亮起，绽放在终竟的明天。",
		siteurl: "https://blog.cuteleaf.cn",
		tags: ["Blog"],
		weight: 10, // 权重，数字越大排序越靠前
		enabled: true, // 是否启用
	},
	{
		title: "霞の葉間",
		imgurl: "https://kasuha.com/avatar.webp",
		desc: "光と言葉の狭間",
		siteurl: "https://kasuha.com",
		tags: ["Blog"],
		weight: 20, // 权重，数字越大排序越靠前
		enabled: true, // 是否启用
	},
	{
		title: "UpXuu's blog",
		imgurl: "https://upxuu.com/images/me.jpg",
		desc: "逐光而上",
		siteurl: "https://upxuu.com",
		tags: ["Blog"],
		weight: 30,
		enabled: true,
	},
	{
		title: "朝朝听雨",
		imgurl: "https://rainzt.cn/zzty.png",
		desc: "物物而不物于物，念念而不念于念",
		siteurl: "https://rainzt.cn/",
		// RSS/Atom 地址（可选）：填了优先使用，不填则由朋友圈页面自动探测。
		// 例：rss: "/rss.xml" 或 rss: ["https://example.com/feed/", "/atom.xml"]
		// 填了 RSS 的文章会进入本站朋友圈时间线（/moments/），与博主互动联动。
		// homepage（可选）：首页照片/截图，用于展示，不填则不显示。
		tags: ["Blog"],
		weight: 10, // 权重，数字越大排序越靠前
		enabled: true, // 是否启用
	},
	// 加入的项目（博客社区与交流项目）
	{
		title: "博友圈",
		imgurl: "https://www.boyouquan.com/assets/images/sites/logo/logo-small.png",
		desc: "让我们跨越山海彼此相连，一起用文字打败时间！",
		siteurl: "https://www.boyouquan.com/home",
		tags: ["项目", "博客社区", "友链互推", "RSS"],
		weight: 9,
		enabled: true,
	},
	{
		title: "博客星球",
		imgurl: "https://www.blogplanet.cn/img/bkxq.png",
		desc: "每一个博客都是一个独立星球！",
		siteurl: "https://www.blogplanet.cn/",
		tags: ["项目", "博客社区", "博客收录", "博主交流"],
		weight: 8,
		enabled: true,
	},
	{
		title: "八零圈",
		imgurl: "https://80tz.cn/assets/images/sites/logo/logo-small.svg",
		desc: "自由、共享，给原创博客写作一个空间！",
		siteurl: "https://www.80tz.cn/home",
		tags: ["项目", "博客社区", "原创写作", "友链交流"],
		weight: 7,
		enabled: true,
	},
	{
		title: "BlogsClub",
		// 站点防盗链（Referer 校验），本地托管头像并由友链页 referrerpolicy="no-referrer" 加载
		imgurl: "/assets/images/friends/blogsclub-favicon.png",
		desc: "BlogsClub是一个互联网独立博客俱乐部。",
		siteurl: "https://www.blogsclub.org/",
		tags: ["项目", "博客社区", "博主交流", "博客收录"],
		weight: 6,
		enabled: true,
	},
	{
		title: "中文独立博客聚合列表",
		imgurl:
			"https://blogroll.online/wp-content/uploads/2026/07/android-chrome-512x512-1.png",
		desc: "又一个博客聚合站",
		siteurl: "https://blogroll.online/",
		tags: ["项目", "博客聚合", "博客收录", "博客社区"],
		weight: 5,
		enabled: true,
	},
];

// 获取启用的友链并进行排序
export const getEnabledFriends = (): FriendLink[] => {
	const friends = friendsConfig.filter((friend) => friend.enabled);

	if (friendsPageConfig.randomizeSort) {
		return friends.sort(() => Math.random() - 0.5);
	}

	return friends.sort((a, b) => b.weight - a.weight);
};
