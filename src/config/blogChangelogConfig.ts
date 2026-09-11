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
		version: "V1.5",
		title: "标题不再姗姗来迟",
		date: "2026-09-12",
		summary: "首屏标题少等 0.3 秒，文字与图片彻底解耦",
		description:
			"V1.45 把预取关掉之后，回头重新归因一次 LCP，结果发现之前判断错了——拖慢首屏的不是那张毛玻璃卡片、也不是壁纸，而是卡片里那行标题「折腾进行时」。它被入场动画设成全透明、还要等 0.36 秒才开始淡入，而浏览器不把全透明的元素算作「已经画出来」，于是最大元素的计时被硬生生推迟。更绕的是，这个 0.36 秒的起点还得先等卡片里的小图加载完。这次把这条链条拆成两段，文字归文字、图片归图片",
		items: [
			{
				category: "性能",
				text: "标题换上专属入场关键帧，起点直接 opacity: 1，只保留从下往上滑 12px 的位移。之前它借用的是通用内容关键帧，起点是全透明，而 Chrome 不会把 opacity: 0 的元素计入内容绘制，等于 LCP 被延迟到淡入之后才成立",
			},
			{
				category: "性能",
				text: "标题延迟从 0.36 秒砍到 0.08 秒。视觉上依然是「滑上来」，但因为不透明，第一帧就已经算画好了，不再多花 0.36 秒等它出现",
			},
			{
				category: "性能",
				text: "入场逻辑拆成两段：文字动画不再等卡片图片加载，两帧之后直接放行；图片单独走一条就绪通道，只控制自己的 0.24 秒淡入。之前图片没到，连标题的入场都要一起陪着等",
			},
			{
				category: "维护",
				text: "图片隐藏加了一层保护：只有当 JS 确实接管、且入场已启动时才隐藏图片，脚本失效时会直接显示，不会永久空白一块；开启「减弱动态效果」时也直接显示",
			},
			{
				category: "修复",
				text: "更正 V1.45 里对 LCP 元的判断：之前看帧截图误以为是壁纸，读了 trace 才确认最大元素是 h1 里的文字节点，并据此重写了归因结论",
			},
		],
		tags: ["性能", "LCP", "入场动画", "首屏"],
	},
	{
		version: "V1.45",
		title: "预取刹车",
		date: "2026-09-12",
		summary: "首屏少传 483KB，顺手修掉两个小毛病",
		description:
			"接着 V1.4 的体检继续往下钻，这次换了个办法——把 Lighthouse 抓的逐帧截图导出来一张张看，首屏到底慢在哪立刻就清楚了：前 2.6 秒整屏是白的，然后卡片和贴纸一次性冒出来、背景还只是个色块，真正的壁纸要到 4.3 秒才到。顺着这条线查下去，发现最大的那笔流量根本不是图片——是 Swup 趁你还在看首页，就把导航里 7 个页面全提前下载好了",
		items: [
			{
				category: "性能",
				text: "关掉 Swup 视口预取：链接只要露出 20% 面积并停留 500ms 就会被提前下载，而首页第一屏正好有 7 个链接满足条件（卡片导航 5 个 + RSS / 打赏），一次抓回 483KB 的页面 HTML，占移动端总流量的 34%。改回 hover-only 之后，首屏少发起 14 个请求、少传 483KB，桌面端少 924KB～1042KB",
			},
			{
				category: "维护",
				text: "这次没有写 visible: false，而是直接把配置还原成上游那行 preload: true。两者运行时完全等价（跑库自己的 buildInitScript() 验证过，产出的插件参数一模一样），但这样这一行和上游字节一致，以后合并上游连 diff 都不会产生",
			},
			{
				category: "维护",
				text: "把首屏慢的原因彻底拆成两截：那张 89KB 的壁纸，请求直到 638ms 才发出——因为它藏在 <template> 标签里，浏览器解析 HTML 时根本看不到它，必须等内联脚本把它克隆进 DOM 才开始下载；而它下载时只抢到约 12% 的带宽（89KB 花了 3.67 秒），剩下的都被别的请求占着",
			},
			{
				category: "性能",
				text: "侧边栏头像改成懒加载，并去掉 fetchpriority=high：一个小头像被标成高优先级，而真正的首屏标题和壁纸反而只有默认优先级，等于小图在跟主图抢带宽",
			},
			{
				category: "性能",
				text: "/images/ 和 /favicon/ 补上 30 天缓存头：这两类之前落在默认规则上，响应头是 max-age=0, must-revalidate，等于浏览器每次访问都要把它们重新校验一遍",
			},
			{
				category: "修复",
				text: "修掉书签导航页一个一直裂着的图标：那条 Firefly 主题书签指向 /favicon/firefly-32.png，但换 favicon 时把这个文件删掉了，页面上一直是个 404 的空图标，改用图标库的 GitHub 图标",
			},
			{
				category: "维护",
				text: "把整个 fork 的合并负担量化了一遍：664 个文件与上游不同、3.7 万行改动，并揪出 18 个「本地删了但上游还在」的文件——这些上游一更新就会报 modify/delete 冲突，以后合并时统一 git rm 处理，不用每次现想",
			},
		],
		tags: ["性能", "LCP", "预取", "缓存", "修复"],
	},
	{
		version: "V1.4",
		title: "首屏提速",
		date: "2026-09-11",
		summary: "首屏少传 283KB，标题不再等贴纸图",
		description:
			"跑了一次 Lighthouse 体检：桌面端已经满分，移动端 72 分，而且瓶颈压在一个反直觉的地方——不是 JS 慢、也不是图太大，而是首页标题被 9 张贴纸图的加载堵住了，最大元素的渲染延迟高达 2190ms。这次把贴纸图、装饰层入场逻辑和 favicon 一起收拾了一遍",
		items: [
			{
				category: "性能",
				text: "贴纸图压缩到实际显示尺寸：8 张从 331KB 降到 127KB（省 62%）。源图是 360×480，但 CSS 里 max-height: 104px 把它们夹到约 78×104，按 192 宽重新导出并降低 alpha 压缩质量",
			},
			{
				category: "性能",
				text: "修掉首页 LCP 被贴纸图阻塞：装饰层入场动画原本要等 9 张图全部加载完才开始（还带 1400ms 兜底超时），现在只等卡片自身的图、兜底收到 400ms，标题的渲染延迟从那 2190ms 降下来",
			},
			{
				category: "性能",
				text: "favicon 从 88KB 换成 8.9KB：原来那个 .ico 其实是一张 221×183 的 PNG 改名的，重新生成了 16/32/48 的真多尺寸 ICO",
			},
			{
				category: "修复",
				text: "新增 favicon-192.png，OG 图生成和 apple-touch-icon 改用 png 格式图标——只有 .ico 的话会落到 sharp 兜底，而它读不了 ICO，站点图标会静默降级成透明图",
			},
			{
				category: "视觉",
				text: "关闭桌面端与移动端的水波纹动画效果，减少持续占用主线程的 canvas 绘制",
			},
			{
				category: "视觉",
				text: "开启多张壁纸自动轮播，每 5 秒切换一张",
			},
			{
				category: "维护",
				text: "体检数据与优化清单整理进 docs/pagespeed-optimization.md，按合并上游的风险分档，附可复现的判定命令",
			},
		],
		tags: ["性能", "LCP", "贴纸", "favicon", "首页"],
	},
	{
		version: "V1.3",
		title: "壁纸瘦身",
		date: "2026-09-10",
		summary: "首屏图片体积砍掉 93%",
		description:
			"把 7 张壁纸从 PNG 批量转成 WebP q90，总量从 14.3MB 压到 1.0MB；同时给 CDN 缓存加了过期续命机制，访客永远秒开旧页面，后台静默更新",
		items: [
			{
				category: "性能",
				text: "壁纸全部转成 WebP q90：桌面端 4 张 + 移动端 3 张，总计 1.0MB（原 PNG 14.3MB），首屏图片加载量减 93%",
			},
			{
				category: "性能",
				text: "新增 scripts/compress-wallpapers.ts：一键压缩壁纸到指定质量，支持强制重跑，以后换壁纸跑一遍就行",
			},
			{
				category: "性能",
				text: "vercel.json HTML 缓存加 stale-while-revalidate=604800：CDN 缓存过期后先给访客旧页面秒开，后台同时拉新页面更新缓存",
			},
			{
				category: "维护",
				text: "壁纸配置同步更新为 .webp 路径，构建验证通过",
			},
		],
		tags: ["性能", "壁纸", "CDN", "缓存"],
	},
	{
		version: "V1.2",
		title: "CDN 缓存",
		date: "2026-09-08",
		summary: "页面全部缓存到边缘节点",
		description:
			"vercel.json 按资源类型分层设置缓存头：HTML 边缘缓存一天、哈希资源一年不可变，部署后自动预热全站缓存，新文章发布依旧即时可见",
		items: [
			{
				category: "性能",
				text: "HTML 页面新增 s-maxage=86400 边缘缓存，CDN 节点直接吐页面；浏览器端保持 max-age=0，发新文章立即可见",
			},
			{
				category: "性能",
				text: "/_astro/ 哈希静态资源缓存一年并标记 immutable，重新部署自动换哈希无需手动刷新",
			},
			{
				category: "性能",
				text: "/assets/、/pagefind/、/pio/ 等静态资源缓存 30 天，过期后由 CDN 后台重新验证更新",
			},
			{
				category: "性能",
				text: "/api/ 数据接口边缘缓存 1 小时，浏览器端不缓存",
			},
			{
				category: "自动化",
				text: "新增 Cache Warm 工作流：每次部署后自动从 sitemap 提取全站 URL 预热边缘缓存，并统计命中率",
			},
			{
				category: "自动化",
				text: "预热脚本多轮并发请求直到 HIT 率达标，日志直接输出在 Actions 运行记录",
			},
		],
		tags: ["缓存", "CDN", "性能", "自动化"],
	},
	{
		version: "V1.1",
		title: "朋友圈",
		date: "2026-09-07",
		summary: "友链更新聚成一条时间线",
		description:
			"新增 /moments/ 朋友圈页面，构建时抓取全部友链的 RSS/Atom 合流成时间线，快照兜底加每天定时刷新，纯静态不用服务器",
		items: [
			{
				category: "朋友圈",
				text: "新增朋友圈页面：聚合所有启用友链的最新文章，按时间倒序展示，支持分页",
			},
			{
				category: "朋友圈",
				text: '构建时抓取 RSS/Atom：友链配置新增可选 rss 字段，未填写的站点自动探测常见路径和首页 <link rel="alternate"> 标签',
			},
			{
				category: "朋友圈",
				text: "随机文章卡片：每 5 秒自动换一篇（可关闭），本站文章标蓝色徽章、推荐友链标金色徽章",
			},
			{
				category: "自动化",
				text: "新增 GitHub Actions 定时任务，每周六 06:00 刷新友链快照并自动提交，提交联动站点重新部署",
			},
			{
				category: "自动化",
				text: "抓取结果写入 src/data/friends-feed-snapshot.json 快照兜底，单站失败不阻断构建",
			},
			{
				category: "修复",
				text: '友链页与朋友圈头像统一加 referrerpolicy="no-referrer"，解决 BlogsClub 头像防盗链 404',
			},
			{
				category: "修复",
				text: "BlogsClub 头像改为本地托管，不再依赖对方站点资源",
			},
			{
				category: "导航",
				text: "朋友圈、友链、留言提为一级导航，移除社交子菜单",
			},
			{
				category: "内容",
				text: "发布文章《给博客装了个朋友圈：把友链的更新聚成一条时间线》",
			},
		],
		tags: ["朋友圈", "RSS", "自动化", "导航", "修复"],
	},
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
