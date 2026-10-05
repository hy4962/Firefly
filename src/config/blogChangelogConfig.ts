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
		version: "V1.28",
		title: "内容与主题分离",
		date: "2026-10-05",
		summary:
			"把文章从主题仓库里搬出去单独立了个私有仓库：主仓库从此只留主题代码，合并上游不用再为文章目录打架，写了一半的草稿也不会躺在公开历史里",
		description:
			"文章和主题代码原来住在同一个仓库（src/content），而上游更新很勤——示例文章、文档、demo 项目经常顺带一起改，每次 merge 都在这个目录上解冲突；加上仓库是公开的，没写完的草稿也跟着暴露在历史里。这次做了内容分离：文章迁到独立的私有仓库，构建前由 scripts/sync-content.mjs 从 CONTENT_REPO_URL 浅克隆到 src/site-content/ 再编译。中途换过一次方案——先按最正统的做法试了 git submodule，推送后才发现 Vercel 官方明确不支持私有 submodule（构建阶段直接失败），改成构建时同步。另外踩了两个坑：内容目录一度放在仓库根，导致主题的图片解析（ImageWrapper.astro 里写死扫 src/ 的 import.meta.glob）扫不到图，所有文章封面渲染成空白；以及构建平台的环境变量里混进一个换行符把 token 截断——Vercel 报 url contains a newline，Cloudflare 报 Invalid username or token，其实是同一个病根。最后补上 Deploy Hook：内容仓库推送时由 Actions 调用两个平台的 hook 触发重新构建。",
		items: [
			{
				category: "维护",
				text: "文章迁至独立私有仓库 hy4962/firefly-content；主仓库 src/site-content/ 进 .gitignore，git ls-files 已归零，主仓库只保留主题代码与配置",
			},
			{
				category: "内容",
				text: "新增 scripts/sync-content.mjs：构建前从 CONTENT_REPO_URL 浅克隆内容（git clone --depth=1），本地已有内容时自动跳过，日志对 URL 脱敏并清理值中的空白字符",
			},
			{
				category: "维护",
				text: "Vercel（vercel.json 的 buildCommand）与 Cloudflare（面板里的构建命令）都在 pnpm build 前执行同步脚本，两个平台均需配置环境变量 CONTENT_REPO_URL",
			},
			{
				category: "部署",
				text: "内容仓库新增 .github/workflows/deploy.yml：push 后调用 Vercel Deploy Hook 与 Cloudflare 部署挂链，文章推上去即自动重新构建上线",
			},
		],
		tags: ["博客", "Git", "部署", "私有仓库"],
	},
	{
		version: "V1.27",
		title: "首页卡片让位下滑箭头",
		date: "2026-10-05",
		summary:
			"修掉移动端首页「关于我那张卡片压住下滑箭头」的问题：屏幕矮时卡片整体往上抬一点，把箭头完整让出来，屏够高时一点都不动",
		description:
			"首页那张卡片是垂直居中的（top: 50%），下滑箭头钉在底部（窄屏 bottom: 10rem），两者一个跟着屏幕高度居中、一个固定贴着底边，屏幕越矮它们靠得越近。卡片底边本身只是个虚线框还不明显，但卡片下面挂着一排社交标签（socials 用了 margin-bottom: -49px，是刻意让标签垂到面板外面当吊牌的），标签是实打实的色块，于是先被糊住的就是箭头。更麻烦的是装饰层 z-index 是 25、箭头只有 10，箭头就算被盖住也抢不到上层，只能挨着。修法不写死常数：脚本按实测算出「卡片视觉底边 + 12px 净空」到箭头之间差了多高，把差值写进 CSS 变量抬升卡片，屏够高时算出来是 0 就是原样。量尺寸走布局数据（容器高度、offsetHeight）而不是 getBoundingClientRect，因为入场动画正在跑时 rect 里混着 transform 的位移和缩放，量出来会偏。抬升量还有个上限，免得屏幕特别矮时卡片被顶进导航栏。",
		items: [
			{
				category: "修复",
				text: "窄屏（≤1023px）下首页卡片按实测算出抬升量写入 --home-wallpaper-card-lift，卡片视觉底边（含面板下方垂出的社交标签）与下滑箭头之间保持 12px 净空，不再叠在一起",
			},
			{
				category: "首页",
				text: "抬升量由 applyMobileCardLift 现算：屏够高（390×800 及以上）结果为 0，卡片仍是原来的垂直居中，桌面端与平板完全不受影响",
			},
		],
		tags: ["首页", "移动端", "卡片", "修复"],
	},
	{
		version: "V1.26",
		title: "留言板移动端头部",
		date: "2026-10-05",
		summary:
			"修掉移动端留言板顶部「公告栏被左上角与右上角两个悬浮按钮压住」的问题：公告栏文字不再被切掉一半，成员按钮也不跟它挤在一起",
		description:
			"留言板在移动端整体铺满一屏，头部那行（左边「留言板」胶囊、右边「成员」按钮）是 position: absolute 浮在聊天区上方的、不占文档流，这样消息区能从头铺到尾。问题是公告栏还老老实实待在文档流里，于是就钻到了两个按钮底下——左边的「留言板」三个字压在「留言板使用说明」上，右边的成员按钮又跟公告栏的关闭叉号挤在一处，看着像两块 UI 叠在一起。修法很直接：让内容列自己把头部那份高度垫出来（0.375rem × 2 内边距 + 2.5rem 按钮 = 3.25rem），公告栏和消息列表就都落到按钮下方了，有没有公告栏都成立。顺手把公告栏在移动端那几条 top/left/right 删了——它现在是 position: static 的布局内元素，这几条从来没生效过，留着只会误导下一个看代码的人",
		items: [
			{
				category: "修复",
				text: "移动端 .guestbook-chat__conversation 垫出 3.25rem，让开浮层式头部：公告栏与首条消息不再被左上「留言板」、右上「成员」两个按钮遮挡",
			},
			{
				category: "维护",
				text: "删除移动端公告栏里无效的 top/left/right（元素为 position: static，这些属性不生效）",
			},
		],
		tags: ["留言板", "移动端", "修复"],
	},
	{
		version: "V1.25",
		title: "Steam 游戏库",
		date: "2026-10-05",
		summary:
			"新增 /steam/ 游戏库页面：拥有游戏数、总时长、近两周时长、等级徽章，以及按时长排序的全部游戏列表；数据由定时任务写入快照，跟朋友圈共用同一条流水线",
		description:
			"在 nxxy335.top/steam 看到他的 Steam 履历页，扒了下源码发现是 Halo 插件在服务端定时拉 Steam Web API、缓存后 SSR——他那边有常驻后端，我这是纯静态站，走不了同一条路。好在博客里早有一条干同类事的流水线：朋友圈的 refresh-friends-feed.yml，定时抓友链 RSS 落快照、有变化就提交、提交触发重建。于是没有新建第二条，直接往里面加了一个步骤，跑一次提交一次构建一次，两类数据一起刷新。取数用官方 Web API（GetPlayerSummaries / GetBadges / GetOwnedGames），需要申请 API Key 并把 Steam 隐私设置的「游戏详情」设为公开；封面图直接按 appid 拼 CDN 地址，不用再拉商店详情。另外补了一条降级路径：没配 Key 时退回抓 steamcommunity 的公开 XML，只拿得到常玩的几款游戏，页面会标出「精简模式」并改称「收录游戏」，不误导读者。密钥只存在于 GitHub Actions 的环境变量里，不进入构建产物与前端，因此 Vercel 和 Cloudflare 后台都不用配任何东西",
		items: [
			{
				category: "Steam",
				text: "新增 /steam/ 页面与 scripts/refresh-steam-snapshot.ts：取拥有游戏数、总时长、近两周时长、等级与徽章数、最近游玩、全部游戏时长榜（含封面、最后游玩日期）",
			},
			{
				category: "Steam",
				text: "两条取数路径自动切换：有 STEAM_API_KEY 走 Web API 拿完整游戏库；没有则退回 steamcommunity 公开 XML 的精简模式（仅常玩几款），快照用 partial 字段标记，页面据此显示提示并调整统计卡名称",
			},
			{
				category: "Steam",
				text: "封面图按 https://cdn.cloudflare.steamstatic.com/steam/apps/<appid>/header.jpg 直接拼接，省掉「先拉商店详情拿 hash」这一步",
			},
			{
				category: "维护",
				text: "refresh-friends-feed.yml 更名为 Refresh External Snapshots，新增一个 step 跑 Steam 脚本（注入 STEAM_API_KEY），提交逻辑改为一次性 add 两份快照；没有新建第二条 workflow",
			},
			{
				category: "首页",
				text: "导航「我的」子菜单新增「游戏库」入口",
			},
			{
				category: "维护",
				text: "全为新增文件 + src/config 内改动，组件、布局、样式、i18n 等上游高频改动区零改动",
			},
		],
		tags: ["Steam", "统计", "定时任务", "新增"],
	},
	{
		version: "V1.24",
		title: "站长动态独立 RSS",
		date: "2026-10-05",
		summary:
			"站长动态有了自己的订阅源 /dynamic/rss.xml，和页面同一份数据；动态页头部的「N 动态」旁边多了个 RSS 小按钮，点一下就能把地址丢进阅读器",
		description:
			"在 blog.fufu520.cn 看到 TA 的动态页挂着独立 feed，回头看自己的站长动态页只有网页、没有订阅源——想追更的读者只能手动来翻。于是照着做了一份：feed 在构建期拉 Memos 接口，和页面用的是同一份数据，每条跳回 /dynamic/ 的对应锚点；接口挂了自动回退本地内容集合、再不行输出空频道，构建永远不会因此变红。入口加在动态页头部——那一整页都是主题文件，所以走页脚注入段把 RSS 按钮塞进「N 动态」计数里，只有动态页会出现，head 也一并埋了自动发现声明",
		items: [
			{
				category: "动态",
				text: "新增 /dynamic/rss.xml：构建期拉 Memos 接口（与页面同源，当前 12 条），每条跳回 /dynamic/ 对应锚点；接口失败自动回退本地内容集合，再不行输出空频道，绝不炸构建",
			},
			{
				category: "动态",
				text: "动态页头部「N 动态」左侧注入「订阅RSS以随时偷窥站长日常」入口（页脚 FooterConfig.html 注入，只在 /dynamic/ 出现，小屏只留图标），点击新标签打开 Feed；head 同步埋 rel=alternate",
			},
			{
				category: "维护",
				text: "新增 src/pages/dynamic/rss.xml.ts 一个文件 + FooterConfig.html 注入段，主题源文件零改动",
			},
		],
		tags: ["动态", "RSS", "新增"],
	},
	{
		version: "V1.23",
		title: "首页动态滚动条",
		date: "2026-10-05",
		summary:
			"首页横幅下方多了一条会持续横向滚动的动态条：左边「动态」胶囊、右边「更多」，中间滚动播放最近的 Memos 动态，鼠标悬停暂停，点某条跳到对应那条",
		description:
			"在 nanzhiy.cn 看到的效果：他首页横幅下面挂着一条一直在横滚的「瞬间」条。扒完发现他用的是 Ethereal 主题而不是 Firefly，页面里还留着服务端模板的痕迹，代码没法照抄，所以只搬机制 —— 数据直连 Memos 公开接口（和 /dynamic/ 同一个源，对方已放开 CORS），滚动靠 CSS 把轨道内容复制成完全相同的两份、在 0 到 -50% 之间平移实现无缝。最折腾的是插在哪：首页那个下滑箭头执行的是 #main-grid.scrollIntoView()，条子放在它之前会被整条甩出视口；第二轮挪进 #content-column 又变成只有文章列那么窄的一小块；最后让它当 #main-grid 的 grid item 配合 grid-column: 1/-1，才同时拿到「不被甩出去」和「横跨左右侧栏的全宽」。改动只落在两个文件，主题源文件零改动",
		items: [
			{
				category: "首页",
				text: "首页新增动态滚动条：左侧「动态」胶囊 + 中间滚动区 + 右侧「更多」，取最近 12 条 Memos 动态；悬停暂停，移动端把两侧胶囊压紧、行间距自备（移动端 #main-grid 是 block，没有 gap 可用）后同样显示，点某条跳到 /dynamic/ 对应那条",
			},
			{
				category: "首页",
				text: "条子作为 #main-grid 的 grid item（grid-column: 1 / -1）横跨左右侧栏，同时解决「点下滑箭头看不到」——箭头滚的就是 #main-grid，条子在它内部才不会被甩出视口",
			},
			{
				category: "性能",
				text: "DOM 默认 display:none、数据在页面渲染完之后才异步拉取，拉不到就整条不显示；实测把接口掐断后 FCP 仍是 1112ms、CLS 为 0，首页 10 篇文章照常渲染，数据本身带 10 分钟本地缓存",
			},
			{
				category: "维护",
				text: "新增 public/assets/js/home-dynamic-bar.js + src/config/FooterConfig.html 追加注入段，主题源文件零改动；脚本版本号挂在 ?v= 上绕开 vercel 给 /assets 的 30 天强缓存",
			},
		],
		tags: ["首页", "动态", "新增"],
	},
	{
		version: "V1.22",
		title: "留言板改成聊天窗口",
		date: "2026-10-05",
		summary:
			"把留言板从 Waline 默认评论框换成群聊风格的聊天窗口：气泡、成员列表、公告栏、表情图片、回复编辑删除都在，30 秒自动同步。后端复用现成的 Waline 一个字节没动，这一页的评论脚本反而从 100 KB 降到 23 KB",
		description:
			"在 blog.amamo.top 的留言板看到的：不是评论区，是一整个聊天窗口。扒了仓库发现后端就是 Waline，我现成有一个。参考站为了塞进主题改了 6 类上游文件，我搬完之后把上游改动压到只动 guestbook.astro 一个——137 个新文案走自建表不进 i18n，CSS 变量就近定义，样式从全站 main.css 挪到页面内引入。顺带修了三件事：旧评论框发的回复显示不出引用块（组件的标记和 Waline 原生 pid 是两套体系）、公告栏文字和消息叠在一起（浮层底色实际只有 9% 不透明度）、标题压在首屏壁纸上（主题的上浮设计遇上透明背景）",
		items: [
			{
				category: "内容",
				text: "留言板换成群聊风格聊天窗口：气泡列表、公告栏、成员列表、表情包、图片上传、回复/编辑/删除、30 秒自动同步，移动端公告栏占位布局单独适配",
			},
			{
				category: "性能",
				text: "这一页的评论前端从 @waline/client 完整客户端（100.9 KB gzip，走 unpkg 第三方 CDN）换成自写组件（23.4 KB brotli，同域托管），净减约 82 KB",
			},
			{
				category: "性能",
				text: "50 KB 组件样式从全站 main.css 挪到页面内引入，只有 /guestbook/ 加载；原版做法是打进全站 Layout.css（guestbook-chat 类名在其中出现 200 次），每页白下",
			},
			{
				category: "维护",
				text: "137 个新文案走自建 guestbook-lang.ts 不改 src/i18n/，CSS 变量就近定义不进 variables.styl——上游改动只剩 guestbook.astro 一个文件",
			},
			{
				category: "修复",
				text: "旧评论框 / Waline 后台发的回复显示不出引用块：解析回退到 Waline 原生 pid / reply_user 字段，判据用 typeof pid === 'number'（一级评论的 pid 是 null 而不是缺失，用 in 判断会误判）",
			},
			{
				category: "修复",
				text: "公告栏文字与消息重叠：浮层底色实际只有 9% 不透明度（color-mix 的另一端 --guestbook-surface 是 transparent），改成占位式布局并换 --card-bg 取色，消息不再被切半截",
			},
			{
				category: "修复",
				text: "留言板标题压在首屏壁纸上：主题的主内容区上浮 3.5rem 是给卡片底色设计的，透明背景挡不住；桌面端下移 3.5rem，面板高度放大到 1.2 倍",
			},
			{
				category: "内容",
				text: "公告弹窗加「不再显示」，写入 localStorage 后该访客不再自动弹出，顶部公告栏保留可手动点开",
			},
			{
				category: "维护",
				text: "新增依赖 @waline/api、lucide-svelte；实现记录见《留言板改成聊天窗口》",
			},
		],
		tags: ["留言板", "Waline", "Svelte", "新增"],
	},
	{
		version: "V1.21",
		title: "友链自助申请",
		date: "2026-10-05",
		summary:
			"友链页第 2 步多了个「进入申请表」按钮，点进去是个 GitHub Issue 表单；提交后机器人自己去访问对方的友链页，确认挂了本站链接就自动写入配置并上线，不用等人审核",
		description:
			"在 blog.amamo.top 的友链页看到的效果：他那页顶上有个「自动友链」入口，点进去是 GitHub Issue 表单。他也是 fork 的 Firefly，实现全在 .github 下——Issue 模板 + 一个 Node 脚本 + 一个 workflow，纯静态站就能跑，完全不涉及 SSR（网上讲这套要改 SSR 的那篇文章是另一个人写的）。我按同样的思路重做了一遍，但改了三处：写入只往数组头部插一条，而不是重写整个数组（他的写法会把已有条目的 rss / homepage 字段和注释一起吃掉）；校验只用 Node 内置 fetch，不装 pnpm 和 playwright，workflow 二十来秒跑完；把「主站与友链页必须同域」这条真正补上（他博客里写了，脚本里其实只比了站名）。另外「发评论区 / 发邮件」保留成兜底，用 GitHub 毕竟是有门槛的",
		items: [
			{
				category: "友链",
				text: "友链页第 2 步改成「自动友链 · 进入申请表」按钮，链到 GitHub Issue 表单；原来的评论区 / 邮件方式压成一行小字保留",
			},
			{
				category: "友链",
				text: "自动校验三项：主站可达、友链页可达且与主站同域、页面里确实挂了本站链接——全过才写入，没过会在 Issue 里回复具体原因",
			},
			{
				category: "维护",
				text: "写入只往 friendsConfig 数组头部插一条，已有条目的 rss / homepage 字段和注释一个字节不动，并按域名去重",
			},
			{
				category: "性能",
				text: "校验脚本零第三方依赖（只用 Node 内置 fetch），不需要装 Chromium，单次运行约 20 秒",
			},
			{
				category: "维护",
				text: "新增 .github/ISSUE_TEMPLATE/friend-request.yml、.github/scripts/auto-friend-link.cjs、.github/workflows/auto-friend-link.yml，主题源文件零改动",
			},
			{
				category: "修复",
				text: "MDX 正文里的 <a> 会被 markdown.css 的 a:not(.no-styling) 染色，按钮橙字压橙底导致文字看不见，改用主题自带的 no-styling 类豁免",
			},
		],
		tags: ["友链", "自动化", "新增"],
	},
	{
		version: "V1.20",
		title: "友链卡片悬停展开首页截图",
		date: "2026-10-04",
		summary:
			"鼠标停在友链卡片上，卡片顶部展开一张对方首页的截图；截图是离线批量截好、存在本站的 webp，12 张总共 190 KB 左右，且首屏一张都不加载",
		description:
			"在 blog.amamo.top 的友链页看到的效果：鼠标悬上去，卡片顶部长出一条首页截图。对方是直接把卡片重写成竖版、把图塞进 friends.astro 里的，我这边不能动主题源文件，所以换了个做法 —— 卡片结构留给主题，封面用一段独立脚本在浏览器里贴上去。截图没有走第三方截图 API（首次要等 5～15 秒，还绕一圈国外），而是新增了一个脚本用本机 chrome-headless-shell 把每条友链截一遍、sharp 转成 640 宽的 webp 存进 public，所以加载时走的是本站 CDN。悬停前连请求都不发，第一次真悬停才赋值 src",
		items: [
			{
				category: "友链",
				text: "友链卡片悬停时在顶部展开首页截图（高 7rem，截取页面上半部分而不是居中裁剪，更像「首页」）",
			},
			{
				category: "素材",
				text: "新增 scripts/generate-friends-covers.ts，批量截取所有启用友链的首页，转成 640×512 比例的 webp（单张 10～21 KB），并生成 src/data/friends-covers.json 清单",
			},
			{
				category: "性能",
				text: "封面默认不加载，首次悬停 / 聚焦才发请求；脚本本体也只在 /friends/ 才按需拉取，其他页面只多十几行判断",
			},
			{
				category: "维护",
				text: "新增 src/pages/api/friends-covers.json.ts（构建期生成静态 JSON）与 public/assets/js|css/friends-covers.*，主题源文件零改动，上游合并无冲突",
			},
		],
		tags: ["友链", "性能", "新增"],
	},
	{
		version: "V1.19",
		title: "相册清理两张重复/带底素材",
		date: "2026-10-03",
		summary:
			"「移动壁纸」相册去掉品红底那张原图，「贴纸」相册删掉与单张版重复的模糊画稿",
		description:
			"昨天归档时把「原图」照单全收进相册，事后翻相册发现两张碍眼的：一是手机壁纸那张品红纯色底的原始版（壁纸池里用的已是抠成透明通道的版本，相册里再留一个刺眼的红底没意义），二是「贴纸」相册里那张从九宫格切出来的草帽 Q 版——它和单张高清版是同款，九宫格那格是 JPEG 压缩过的格子源，放大后帽子和描边都是噪点，留着只是重复占位。两张都从相册目录删掉，LQIP 占位色同步清干净",
		items: [
			{
				category: "相册",
				text: "「移动壁纸」相册删掉 kuroneko-shh.png（品红底原始版），现在只剩 1 / 2 / 3 / shana-1 四张",
			},
			{
				category: "相册",
				text: "「贴纸」相册删掉 kuroneko-hat.png（九宫格 JPEG 源，与更清晰的单张版 kuroneko-dress 同款），相册 22 张",
			},
		],
		tags: ["相册", "素材", "清理"],
	},
	{
		version: "V1.18",
		title: "首页贴纸扩充，壁纸池进两张新图",
		date: "2026-10-02",
		summary:
			"挂件九宫格切开做成 9 张 Q 版贴纸（与单张高清版重复的那张已删），壁纸池新增桌面夏装横图与手机透明底立绘",
		description:
			"这批素材是一套挂件图：九宫格整版切开抠底出 9 张 Q 版贴纸，另有一张单张高清版一起进首页贴纸池（两者同款的那张后来删掉了）。桌面端随机抽 10 张的机制不用动坐标，手机端自动装箱。横版夏装图直接进桌面壁纸轮播；竖版立绘原来是刺眼的品红纯色底，索性按同色匹配整体抠掉、只留透明通道不做替代底，背后交给页面自身底色，浅色深色各自适应 —— 手机端从单图升级成两张轮播。原图照例全部归档：贴纸画稿进「贴纸」相册，两张壁纸原图分别进桌面 / 移动壁纸相册",
		items: [
			{
				category: "素材",
				text: "首页贴纸新增：九宫格切出 kirino-sit / kirino-glasses / kirino-maid / kuroneko-swim / kuroneko-maid / ayase-swim / kanako-swim / maid-glasses，外加单张 kuroneko-dress，全部透明底、高 192px、均 8–12KB",
			},
			{
				category: "壁纸",
				text: "桌面壁纸池新增 kuroneko-summer（1920×1080，q90 约 157KB），追加进轮播数组末尾",
			},
			{
				category: "壁纸",
				text: "手机壁纸池新增 kuroneko-shh：把刺眼的品红纯色底整体抠掉，直接保留透明通道（1080 宽 q90 约 194KB），背后露出的是页面底色，浅色/深色模式各自适应；mobile 配置从单图字符串升级为两张数组，手机端开始走轮播",
			},
			{
				category: "素材",
				text: "删掉两张贴纸：「夏娜·持剑（红发）」（shana-sword-red）与重复的「黑猫·草帽」（kuroneko-hat，与单张版 kuroneko-dress 同款，留下更清晰的单张版）；贴纸池最终从 11 张扩到 19 张，被删的两张原始画稿仍留在「贴纸」相册",
			},
			{
				category: "相册",
				text: "原图全部归档：10 张贴纸画稿进「贴纸」相册，两张壁纸原图分别进「桌面壁纸」「移动壁纸」相册（移动那张保留的是抠底前的品红底原版）",
			},
		],
		tags: ["贴纸", "壁纸", "素材"],
	},
	{
		version: "V1.17",
		title: "追番页从 B站 换成番组计划",
		date: "2026-09-30",
		summary:
			"关掉 /bilibili/ 改由 /bangumi/ 接手：浏览器实时拉 bgm.tv 收藏，动画 308 部、其中看过 277 部",
		description:
			"昨天开的 /bilibili/ 页只解决「收藏了什么」，而真正想让人看到的是「看过什么」—— 那部分记录都在 bgm 上，把 B站 的「看过」清单批量补录过去之后，B站 这页就没什么存在必要了。主题其实自带一对平级的追番页，bangumi 那页一直是关着的，而且默认指向第三方镜像 api.bangumi.pro，实测这个域名连 TCP 都建不起来，是条死链。换回官方 api.bgm.tv 之后就能直接用：官方放开了跨域，浏览器可以直连，于是开 dynamic 模式，访客打开页面时现拉数据，收藏有变动不必重新部署",
		items: [
			{
				category: "页面",
				text: "siteConfig 里 pages.bilibili 关回 false、pages.bangumi 打开：/bilibili/ 重新重定向到 /404/，「我的」菜单里那一项换成「番组计划」（两者都绑了 pageKey，开关一关自动隐藏）",
			},
			{
				category: "维护",
				text: "bangumi.apiUrl 由已失效的第三方 api.bangumi.pro 换回官方 api.bgm.tv；详情页地址同步从 api.bangumi.pro/subject/ 改为 bgm.tv/subject/，卡片点进去落在 bgm.tv 而不是代理域名",
			},
			{
				category: "性能",
				text: "数据用 dynamic 模式：构建期不请求任何外部接口，访客打开时由浏览器拉取（官方接口带 Access-Control-Allow-Origin，实测直连正常）。代价是首屏靠 JS 渲染，好处是收藏更新不用重新部署",
			},
			{
				category: "素材",
				text: "noReferrerDomains 增加 *.bgm.tv —— bgm 的封面图床同样有防盗链，不加会整页裂图",
			},
		],
		tags: ["追番", "bgm", "页面"],
	},
	{
		version: "V1.16",
		title: "追番页开张，B站收藏搬上来",
		date: "2026-09-29",
		summary:
			"打开 /bilibili/ 页面：构建期拉取 UID 161964502 的追番与追剧清单，共 221 条，均分 8.7",
		description:
			"页面文件和导航菜单项一直都在，只是 siteConfig 里的页面开关是 false，访问会被直接重定向到 /404/，导航里那一项又因为绑了 pageKey 被自动隐藏，等于整页处于「装好了但没通电」的状态。把开关打开后，构建时会请求 B 站 space/bangumi/follow/list 接口，追番（type=1）与追剧（type=2）一起抓，带评分、简介和最新一集的更新进度。封面走的是 hdslb 域名，站点早就配了 noReferrerDomains，不会被防盗链挡回来",
		items: [
			{
				category: "页面",
				text: "siteConfig.pages.bilibili 由 false 改为 true，导航栏「关于 → 哔哩哔哩追番」入口恢复显示（菜单项绑 pageKey，开关关闭时自动隐藏）",
			},
			{
				category: "内容",
				text: "首次拉取到 221 条条目（追番 + 追剧），均分 8.7；数据为构建期抓取，静态渲染，不随 B 站实时变动",
			},
		],
		tags: ["追番", "哔哩哔哩", "页面"],
	},
	{
		version: "V1.15",
		title: "统计页的画，搬进相册了",
		date: "2026-09-29",
		summary:
			"把 /analytics/ 页面里的 7 张插画归档成新相册「统计页插画」：页首横幅、两张角色立绘、四张概览卡片插画",
		description:
			"统计页里那些画——页首樱花横幅、推送节奏和访客活跃两张角色立绘、概览区四张卡片插画——散在页面各处，没法单独看。这回把它们归进相册：三张 PNG 立绘与横幅转成 90 质量的 webp，四张概览插画本来就是压缩好的 webp，字节原样拷过去不做二次压缩；原始 PNG 归档在仓库 gallery-originals/analytics/，配套 _manifest.json 记录来源与尺寸",
		items: [
			{
				category: "相册",
				text: "新增「统计页插画」相册（/gallery/analytics/），收录 /analytics/ 页面的 7 张插画：01 页首横幅、02-03 两张角色立绘（保留透明通道）、04-07 四张概览卡片插画，封面用推送节奏立绘",
			},
			{
				category: "素材",
				text: "三张 PNG 转 webp（质量 90，不放大，保留透明通道）；四张概览 webp 字节原样拷贝，避免二次有损压缩。原始 PNG 归档至 gallery-originals/analytics/ 并附 _manifest.json",
			},
		],
		tags: ["统计页", "相册", "素材"],
	},
	{
		version: "V1.14",
		title: "搬来的看板，得改成自己的",
		date: "2026-09-29",
		summary:
			"配色换成站点主题色、提交数修正为只算本人、热力图改 GitHub 绿、两个状态角标归位、Umami 加外链",
		description:
			"上一版整份搬过来，功能是齐的，但用起来处处别扭：整页是参考站的蓝，跟本站的橙黄对不上；推送热力图显示「最近 1690 次」，而我一年的提交明明只有两百多；两个状态角标被 space-between 顶到最右，正好压在角色插画的脸上；DATA SOURCE 那里的 Umami 点进去是登录页。这些都是「能跑但不像自己的」—— 尤其第二项是个实打实的错：这个仓库是 fork，git log 不加过滤会把上游的历史一起算进来，1695 条里属于我的只有 252 条，差了七倍。一条条改完之后才算顺眼",
		items: [
			{
				category: "页面",
				text: "整页主色由写死的 #2d7cff 换成 var(--primary)，kicker、小标题、折线图、时间范围切换一次性全部跟随主题色；访客活跃时间热力图的色阶也改成从主色派生，暗色不用再写一组",
			},
			{
				category: "修复",
				text: "推送统计只算本人提交：git log 加 --author、GitHub API 加 author 参数。这个仓库是 fork，不过滤会把上游 CuteLeaf/Firefly 的历史全算进来（1695 条 vs 本人 252 条）。另给 API 每页加了重试，避免网络抖动让热力图整块变空",
			},
			{
				category: "页面",
				text: "推送热力图改用 GitHub 原版绿阶（不跟主题色，这个模块本来就在模仿 GitHub 贡献图）；「访客活跃时间」那块仍跟主题色，两者有意区分开",
			},
			{
				category: "页面",
				text: "状态文字改成语义绿（本地预览 / 已更新 / 已记录），并给推送状态加了 data-state，失败时仍然是红色而不是一律绿",
			},
			{
				category: "页面",
				text: "两个状态角标（hero 的「已更新」和推送节奏的「已记录」）从右上角挪进标题文案块 —— 那两处 header 都是 space-between 布局，右侧恰好都是角色插画，角标会被顶上去压住它们。现在插画完整露出来了",
			},
			{
				category: "页面",
				text: "DATA SOURCE 里的 Umami 变成外链，指向公开分享页而不是实例首页（首页对访客来说只有登录框）；地址由 shareApiBase 与 shareId 拼出，换实例自动跟随",
			},
		],
		tags: ["站点统计", "Umami", "主题色", "页面"],
	},
	{
		version: "V1.13",
		title: "开场两秒，然后交给壁纸",
		date: "2026-09-29",
		summary:
			"首页个人卡片完整停留约两秒后整体向右滑出屏幕，右边缘留一根小竖条；卡片右上角还有一颗半透明 −，随时可以手动收起。底部贴纸改成随机抽 10 张、左右各 5 张分列，把正中央让给下滑箭头；右下角新增「隐藏贴纸」开关",
		description:
			"首页那张卡片——头像、站名、快捷导航、彩色社交标签——是整块壁纸上最抢眼的东西，但壁纸本身也是自己一张张挑的。于是想要个「开场」：先让卡片亮两秒，然后把位置让出来，只留壁纸和贴纸。真正难缠的不是动画，是动画的终态：卡片入场走的是 CSS animation，fill: both 会把终态一直挂在元素上，优先级高于普通声明，不先把这段动画摘掉，后面 transition 怎么写都推不动，表现就是「点了没反应，卡片直接瞬移」。另一个决定是只做水平位移、不做缩放——手机端那套按卡片位置算贴纸落点的布局读的是卡片的 rect，只横着挪的话上下两个值完全不变，收起前后贴纸一张都不会跳。最后是「只播一次」的判定：没用 sessionStorage，因为那样会把刷新也算进同一次会话，和想要的正好相反",
		items: [
			{
				category: "首页",
				text: "新增「入场后自动收起」：卡片完整停留约 2 秒后整体向右滑出屏幕，露出纯壁纸。配置在 homeCardConfig.autoCollapse，只填「停留多久」一个数（hold: 2000）—— 入场动画什么时候跑完由脚本监听 animationend 现算，不用写「从入场开始算」的总时长，以后调整入场动画的节奏不必回来改这个数",
			},
			{
				category: "首页",
				text: "卡片右上角新增一颗半透明 − ：点它立刻收起，不用等自动到点。用减号不用叉，是因为这按钮是「先把卡片收起来」而不是「永久关掉」——收完还能从边缘小竖条叫回来",
			},
			{
				category: "首页",
				text: "收起后右边缘挂出一根竖排小签（默认「关于我」），带一枚与卡片身份行同款的小方块当视觉抓手；它是一个真正的 button，点击、键盘 Enter / 空格都能把卡片滑回来，带 aria-expanded。竖条停在 slideTo 同侧，卡片从右边走、签子也从右边出来",
			},
			{
				category: "首页",
				text: "右下角新增「隐藏贴纸」开关：点一下把首页那排小人收走，再点一下放回来。收起时从左往右一张张淡出、放回时从右往左接上（错开 40ms，可在 homeCardConfig.stickerToggle 调成 0 = 整排一起动），状态存 localStorage，刷新与切页都记得住",
			},
			{
				category: "修复",
				text: "下滑箭头不再被贴纸挡住：贴纸层 z-index(25) 压在箭头(10) 上面，居中那张小人正好把它盖死。没有去动箭头的层级（那样中央会多出一颗压在贴纸身上的圆钮），改成让贴纸给它让路——桌面端底部这排从 11 张素材里随机抽 10 张，左右各 5 张分列，正中央空出一段（homeCardConfig.desktopStickerRow，count / centerGap 可调），箭头落在空地里。每次刷新换一批，抽中的仍按原本的相对顺序排，不会左右跨位",
			},
			{
				category: "修复",
				text: "卡片入场动画的 fill: both 终态会压住后续的 transform / opacity，transition 完全推不动。收起前先给容器加 is-entrance-done 摘掉卡片自身的动画并强制一次样式计算，位移才真正走得动",
			},
			{
				category: "性能",
				text: "收起只做水平位移、不做缩放：手机端贴纸布局读的是卡片 rect 的上下边界，横向挪动不改这两个值。实测收起前后 11 张（手机 4 张）贴纸坐标零漂移，不需要重排",
			},
			{
				category: "首页",
				text: "「只播一次」用脚本作用域里的内存变量，而不是 sessionStorage：脚本带 data-swup-ignore-script 只执行一次、壁纸区又在 Swup 容器外不重渲染，于是刷新会重播、从文章返回首页不会重播，卡片保持收起；sessionStorage 会连刷新一起算掉，正好相反",
			},
			{
				category: "维护",
				text: "改动全部落在自己新增的组件与配置里（HomeWallpaperDecor.astro + homeCardConfig.ts），主题源文件一个没动；补了 prefers-reduced-motion 兜底（减弱动态效果时不做位移，直接落到终态）",
			},
		],
		tags: ["首页", "动效", "交互", "配置"],
	},
	{
		version: "V1.12",
		title: "一页真的数据看板",
		date: "2026-09-29",
		summary:
			"新增 /analytics/ 站点统计页：总览、访问脉冲、推送节奏、活跃时间、设备地域、最近评论",
		description:
			"上一条刚给页脚塞了两行数字，转头又看上了 rainzt.cn 的 /analytics/ —— 那不是两行数字，是整整一页看板：四张彩色总览卡、带 7 / 30 / 90 天切换的访问脉冲、按 GitHub 推送时间排的热力图、24 小时活跃分布、设备与地域的环形图，还有一张中国地图和最近评论。第一版我照着截图自己设计了一套，能跑，但一看就不是那个味道：配色、留白、动效节奏全都对不上。被一句话点醒之后才去翻 Aemeath 的仓库——人家根本不是单个文件，页面将近四千行，外加两个组件，其中专门渲染总览数字的那个要是漏了，页面其余模块全部正常、只有四个数字永远停在「加载中」。整份搬过来才算真正对上，顺带把导航入口从「关于」子菜单提到了顶级",
		items: [
			{
				category: "页面",
				text: "新增 /analytics/ 站点统计页；导航入口放顶级而不是藏在「关于」子菜单里——藏起来等于没有",
			},
			{
				category: "统计",
				text: "七个模块：四色总览卡、访问脉冲（7 / 30 / 90 天切换 + 手动刷新 + 数字滚动）、推送节奏热力图（按 GitHub 提交时间，带贪吃蛇动画）、访客活跃时间、设备与浏览器环形图、地域分布（中国地图 + 流量来源占比）、Waline 最近评论",
			},
			{
				category: "统计",
				text: "数据全部走 Umami 公开分享接口，浏览器直连；取数要同时带 x-umami-share-token 与 x-umami-share-context 两个头，少一个就 401。配置集中在 analyticsConfig.umamiAnalytics 的 shareId / shareApiBase / historicalStats 三项",
			},
			{
				category: "维护",
				text: "实现整份取自同源 fork（Aemeath），含页面、侧栏组件、指标组件与全部插画、地图资源；只把署名和 localStorage 前缀从 rainzt 换成自己的，其余保持原样，便于以后跟着上游一起更新",
			},
			{
				category: "修复",
				text: "页面用到的 --text-color 与 --font-active-sans 上游主题没有，做在页面自身作用域里而不是改 src/styles/variables.styl，避免为两个变量动主题源文件",
			},
			{
				category: "修复",
				text: "补上「推送节奏」依赖的 GitHub 提交数据接口（构建期生成静态 JSON：全量 clone 读 git 历史，shallow clone 回退到 GitHub API 分页），并去掉参考实现里「每日扣除 2 次定时 Actions」的算法——那是人家自己的定时机器人，照抄会把提交数算少",
			},
			{
				category: "内容",
				text: "同步这次的实现记录（/posts/blog/analyticsdashboard/）：从自研翻车、到怎么发现漏了一个组件，都写了",
			},
		],
		tags: ["站点统计", "Umami", "数据看板", "页面"],
	},
	{
		version: "V1.11",
		title: "页脚的两行数字",
		date: "2026-09-28",
		summary: "页脚加上建站运行时间与访问统计，静态站直连 Umami 分享接口",
		description:
			"又是在刷 rainzt.cn 的时候看上的——他页脚挂着两行东西：一行「本站已运行 X 天 X 小时 X 分 X 秒」在跳秒，一行是今日与全站的访客/访问四个数字。跳秒那行纯前端就能算，另一行卡了我一会儿：博客是跑在 Vercel 上的纯静态站，没有服务端替我去读 Umami。抱着试试看的心态 curl 了一下他那个分享链接，响应头里明晃晃一个 Access-Control-Allow-Origin: * —— Umami 的分享接口本来就是给外部页面调用的。真正的坑在第二步，取数据的接口要同时带 x-umami-share-token 和 x-umami-share-context 两个头，少一个就 401，我按「只带 token」试了一轮才摸对。落点还是 Firefly 原生的 FooterConfig.html 注入点，这次同样一个主题源文件都没动",
		items: [
			{
				category: "页脚",
				text: "新增建站运行时间（天/小时/分/秒），秒数逐秒跳动；切到后台标签页直接停掉定时器，切回来立刻重算，避免在看不见的地方空转 setInterval",
			},
			{
				category: "页脚",
				text: "新增今日访客、今日访问、本站访客、本站访问四个指标，数字从 0 滚到目标值（900ms 三次方缓动），系统开了「减少动态效果」就跳过动画直接落值",
			},
			{
				category: "统计",
				text: "接入方式：先 GET /api/share/<slug> 换一枚 JWT（缓存 24 小时），再 GET /api/websites/<id>/stats?startAt=&endAt= 取数。两个头缺一不可——x-umami-share-token 加 x-umami-share-context: 1，只带前者返回 401",
			},
			{
				category: "统计",
				text: "缓存分三层：分享令牌 24 小时、今日数据 60 秒、全站数据 5 分钟，都写在 localStorage；页面停留期间每 90 秒静默刷新一次，document.hidden 时一次请求都不发",
			},
			{
				category: "性能",
				text: "请求挂在 window.load 之后的 requestIdleCallback 上，不进首屏关键路径；两个接口并发，靠令牌与结果双缓存把首次之后的开销压到 0",
			},
			{
				category: "修复",
				text: "取数失败时整行保持 hidden，既不显示 0 也不显示「加载中」，不在页脚留半截残骸；控制台只留一条 warn",
			},
			{
				category: "内容",
				text: "同步这次的实现记录（/posts/blog/footerstats/）：从探接口、踩 401 的坑，到落点选择与缓存策略都写了",
			},
		],
		tags: ["页脚", "统计", "Umami", "性能"],
	},
	{
		version: "V1.10",
		title: "贴纸排成一条线",
		date: "2026-09-28",
		summary: "桌面并成一排、手机收成一行 4 张，贴纸改成按需加载",
		description:
			"V1.9 那版是「桌面两层、手机随机露 8 张」，这次两件事都推翻了：两排错位看久了不如一排整齐，手机端 8 张分两行也不如 4 张铺一行。顺带撤掉便签、加进第一张会动的贴纸，最后发现一件蠢事——手机端只显示 4 张，实际却把 11 张全下载了，因为随机抽签是在图片请求发出去之后才切的 display。改成按需加载后，手机端首屏的贴纸流量从 149 KB 掉到 47 KB",
		items: [
			{
				category: "首页",
				text: "桌面贴纸从两层并成一层：11 张全部 bottom: 5 铺成一行，脚踩同一条地面线。left 改成按「视觉中心等距」计算——各张基准宽度不同、图片在盒子里居中，按 left 等距排会让视觉中心最多漂 ±11px（1920 宽）",
			},
			{
				category: "首页",
				text: "手机端从 2×4 两行改成一行 4 张：mobileStickerLimit 由 8 改成 4。这个数直接决定行数——每行张数 = floor(97.6 / (尺寸/屏宽×100 + 1.6))，68px 时 390 宽能放 5 张、360 宽掉到 4 张，所以填 5 会在窄机型上翻回两行",
			},
			{
				category: "首页",
				text: "新增第一张动图贴纸「夏娜·甩发」：6 帧 300ms 一轮的动画 webp，GIF 转出来的（帧按并集 bbox 统一裁剪，缩放走预乘 alpha 防止红头发外圈挂黑边）",
			},
			{
				category: "首页",
				text: "下架夏娜蜜瓜包与露易丝女仆两张贴纸，相册里的原始画稿保留；移除卡片上的「欢迎访问」便签（组件不再渲染该节点，而不是靠清空文字隐藏）",
			},
			{
				category: "性能",
				text: "贴纸图片改成按需加载：服务端只输出 data-home-wallpaper-src 不发请求，脚本在手机端只给随机抽中的那 4 张赋 src、桌面端等 window.load 之后再统一赋值。实测手机端从 12 个请求 / 149 KB 降到 5 个请求 / 47 KB；桌面端字节不变，但全部移出 LCP 关键路径",
			},
			{
				category: "性能",
				text: "新贴纸体积从 60.2 KB 压到 32.3 KB：alpha_quality 100→70（这张图的 alpha 几乎只有 0/255，有损压缩碰不到它）、quality 90→70，分辨率维持 202×192。质量曲线在 q50~q70 几乎是平的，说明字节是帧数据本身",
			},
			{
				category: "素材",
				text: "新增相册「夏娜表情」共 9 张：发怒、叹气、大哭、慌乱、懵圈、挥手、星星眼、脸红、蜜瓜包，原图画稿不压缩存档",
			},
			{
				category: "内容",
				text: "同步首页贴纸那篇实现记录（/posts/blog/homestickercard/）：新增「并成一排」「第一张动图贴纸」「改成延迟加载」三个小节，配了两张成品图",
			},
		],
		tags: ["首页", "贴纸", "性能", "移动端"],
	},
	{
		version: "V1.9",
		title: "手机上的贴纸大军",
		date: "2026-09-26",
		summary: "贴纸扩到 12 张，桌面分两层、手机只随机露 8 张",
		description:
			"贴纸是一张张攒起来的，问题也是攒出来的：手机上要全部显示就只能往上堆行，最后变成三排 50px 的小人墙，连卡片底部的社交按钮都快被压住；桌面端反过来——两排六个站得舒服，再加就顶到卡片了。这次撤掉两侧那 4 张旧贴纸换成新角色，并把排布改成自适应：桌面分前后两层、手机随机挑 8 张用 68px 的正常尺寸显示，刷新换一批",
		items: [
			{
				category: "首页",
				text: "贴纸从 7 张扩到 12 张：新增高坂桐乃 3 张（欢呼 / 躺平 / 抱臂）与夏娜系 6 张（蜜瓜包、跃斩、黑红双色持剑、露易丝女仆、粉发猫耳）",
			},
			{
				category: "首页",
				text: "桌面改双层排布：前排 6 张脚踩同一条地面线，后排 6 张错位插空；窗口高度不足 940px 时后排整排隐藏，避免顶到卡片底部的导航与社交按钮",
			},
			{
				category: "首页",
				text: "手机端改为随机抽 8 张显示（homeCardConfig.mobileStickerLimit 可调，填 0 即全显示）：以前是「缩到 50px 也要全塞下」，现在是 68px 两行。抽签结果在同一次页面加载内保持不变，刷新才换一批",
			},
			{
				category: "首页",
				text: "移除 4 张旧贴纸（金发偶像、洛琪希、祢豆子、初音未来），底排随之从 8 张步长 12.5% 改成 6 张步长 17.5%",
			},
			{
				category: "素材",
				text: "白底原图用「亮度 + 低饱和度谓词 + 四角洪水填充」抠底：靠连通性保住角色内部的白衬衫，同时吃掉落地灰影；画笔感强、浅色部件直接贴背景的那 6 张，本地抠图会咬掉剑刃和衣领，改用云端前景提取后再本地收边",
			},
			{
				category: "修复",
				text: "云端抠图会把日期和画师签名当成前景留下，用「只保留面积 ≥ 最大连通域 5% 的块」一次清掉；它在角色外留的半透明白描边则用 alpha 阈值掐掉",
			},
		],
		tags: ["首页", "贴纸", "移动端", "素材"],
	},
	{
		version: "V1.8",
		title: "贴纸原稿存档",
		date: "2026-09-26",
		summary: "新增相册「首页贴纸原图」，全分辨率原稿可直接翻看",
		description:
			"首页贴纸最多只显示 104px 高，但手上的源图是 2048px、还带着画师签名，此前只躺在本地文件夹里。项目自带相册能力，就把它们收进 public/gallery/stickers/：不转码、不缩放、不重编码，直接放原始 PNG。截图站上线前实测过——构建产物与源文件逐字节一致（md5 相同），因为相册页读的是 public 目录、用的是裸 <img>，压根不经过 Astro 图片管线。代价是这页滑到底会拉 18MB，我认了这个代价",
		items: [
			{
				category: "相册",
				text: "新增「首页贴纸原图」相册共 12 张：9 张 1440~2048px 的原始 PNG，加上 3 张早期素材（它们只有 192px 的版本，那就是现存最清晰的形态）",
			},
			{
				category: "相册",
				text: "相册索引与导航自动收录，无需改主题；封面手动指定为桐乃那张欢呼",
			},
			{
				category: "维护",
				text: "重建 LQIP 占位表：补齐新相册与壁纸的条目，清掉已删除图片留下的失效条目",
			},
		],
		tags: ["相册", "贴纸", "原图"],
	},
	{
		version: "V1.7",
		title: "夏娜壁纸与题图",
		date: "2026-09-26",
		summary: "壁纸池添了夏娜横竖各一张，三篇动画观后感补上题图",
		description:
			"壁纸池一直是那几张老面孔，这次补了一组夏娜：横版进桌面池、竖版进移动池，原图一并归档进 git（壁纸的展示版会走构建管线重新编码，不存原图以后就没法重压）。顺手给三篇动画观后感补了标题卡题图——这三篇正文通篇没有配图，翻到最后有点干，加一张收个尾",
		items: [
			{
				category: "壁纸",
				text: "桌面壁纸池加入 1920×1005 横版夏娜、移动池加入 1080×1920 竖版，原图同时归档到对应 originals/ 目录；壁纸轮播会自动带上",
			},
			{
				category: "相册",
				text: "桌面壁纸、手机壁纸两个展示相册同步换图，顺带清掉已废弃的旧素材",
			},
			{
				category: "内容",
				text: "《我的妹妹哪有这么可爱！》《零之使魔》《灼眼的夏娜》三篇观后感末尾各补一张标题卡题图",
			},
			{
				category: "内容",
				text: "《零之使魔》的封面换成 2048×1152 源图，比原来那张 1672×941 更经得起高分屏放大",
			},
		],
		tags: ["壁纸", "相册", "内容"],
	},
	{
		version: "V1.6",
		title: "朋友圈配比",
		date: "2026-09-12",
		summary: "时间线不再被聚合站霸榜，按来源 3:4:3 交错",
		description:
			"朋友圈上线后自己刷着发现不对劲：前排几乎全是博友圈那类聚合站。查下来随机池本身已经是 6:4，问题出在排序——聚合站更新频率是个人博客的几十倍，按时间倒序它天然霸榜（第一页 20 篇里 14 篇是社区）。给时间线加了一层来源配额，本站 3 成、Blog 4 成、社区 3 成，再按配比交错排列",
		items: [
			{
				category: "朋友圈",
				text: "新增来源配比配置：时间线按 本站 30% / Blog 40% / 博客社区 30% 分配展示名额，全部收在新的 src/config/momentsConfig.ts 里，只新增文件不碰主题源码",
			},
			{
				category: "朋友圈",
				text: "排序改为按配比交错：原本整体按发布时间倒序，配额只能约束总量、管不住顺序——社区组总共 12 篇，但博友圈那几篇时间最新，倒序一排还是全跑到最前面。改成每一步挑「当前实际落后目标比例最多」的那一组取下一篇，组内仍是新的在前，第一页 20 篇稳定在 8 Blog / 6 本站 / 6 社区",
			},
			{
				category: "朋友圈",
				text: "每个友链的取文上限从 6 篇提到 12 篇，并改为从配置读取：本站只有一个源，上限 6 篇时最多只能贡献 6 篇，而 40 篇里要占 3 成就得 12 篇，怎么配都凑不出来",
			},
			{
				category: "朋友圈",
				text: "移除随机卡片里「20% 概率优先抽本站」的旧逻辑：来源配比已经在池子里分好组，再叠一层倾斜会把本站实际命中率压到 20%，跟配置里写的 3 成对不上",
			},
			{
				category: "友链",
				text: "把博友圈、博客星球、八零圈、BlogsClub、中文独立博客聚合列表这 5 条的标签统一成「博客社区」，友链页筛选栏从 11 个 chip 收敛为 全部 / Blog / 博客社区 三个",
			},
			{
				category: "修复",
				text: "补装漏装的 @fontsource-variable/noto-sans-sc：它在 package.json 里声明了，但 node_modules 下并不存在，OG 图片路由读取字体时抛 ENOENT，导致整个构建中断、dist 被削到只剩 21 页（连首页都没生成）",
			},
			{
				category: "维护",
				text: "已知副作用：组内「取最新 N 篇」的策略下，几个月没更新的友链（夏夜流萤、霞の葉間）会掉出 40 篇名额，8 个来源实际只出现 6 个。想保证每个友链都露脸，需要把组内挑选改成按友链轮询",
			},
			{
				category: "内容",
				text: "发布文章《给朋友圈加了层来源配额：本站 3 成、Blog 4 成、社区 3 成》",
			},
		],
		tags: ["朋友圈", "友链", "配比", "构建", "修复"],
	},
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
