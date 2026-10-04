---
title: "给友链页加了悬停预览：12 张截图离线截好，主题文件一行没动"
published: 2026-10-04
description: "在 blog.amamo.top 的友链页看到鼠标悬停弹首页截图的效果。我这边的约束是不能动主题源文件，所以换了个做法：截图用本机浏览器离线截、转 webp 存进仓库，卡片用一段独立脚本在浏览器里现场拼。12 张封面一共 190 KB，悬停之前一张都不加载。"
image: ./images/cover.webp
tags: [Firefly, Astro, 友链, 博客魔改]
category: 博客
draft: false
---

今天翻 [blog.amamo.top](https://blog.amamo.top/friends/) 的友链页，鼠标往卡片上划过的时候，卡片顶部长出了一条对方首页的截图。

效果大概是这样，不悬停是普通卡片：

![未悬停时的友链卡片，头像加名字和描述](./images/image-001.webp)

划上去之后，卡片顶部展开一条首页截图：

![友链卡片悬停时顶部展开对方首页截图](./images/image-002.webp)

不用点进去，扫一眼就知道对方站点长什么样。我那页友链现在还是一排光头像加名字，差距挺明显的。

## 他那边怎么做的

顺手把他的实现扒出来看了。核心是两行 CSS：

```css
.friend-card__cover {
	height: 0;
	opacity: 0;
	transition: height 0.3s ease, opacity 0.35s ease;
}
.friend-card:hover .friend-card__cover {
	height: 7rem;
	opacity: 1;
}
```

截图默认高度 0、完全透明，悬停时展开到 7rem 并淡入。卡片本身被重写成了竖版：封面在上，头像加站点名、域名、描述在下。仓库在 [qwc-ch/Firefly](https://github.com/qwc-ch/Firefly)。

然后是图从哪来的。他的封面地址长这样：

```
https://tu.520781.xyz/file/youlian/blog.cuteleaf.cn.png
```

路径里带着域名、还统一放在 `youlian` 目录下，估计是他自己一张张截好、批量传上图床的。

## 我这边的约束

我的博客是 fork 自 [CuteLeaf/Firefly](https://github.com/CuteLeaf/Firefly) 的，上游一直在更新，所以给自己定了条规矩：`src/pages`、`src/components`、`src/styles` 这些主题源文件一律不动，要加东西就往 `src/config`、`src/content`、`public` 里塞新文件。

好处是上游发新版我直接 merge，冲突基本为零。代价是很多"顺手改一行"的事得绕路。

友链卡片正好在 `src/pages/friends.astro` 里渲染，撞红线上了。所以这个功能只能照着他的效果另找做法。

## 截图从哪来

先把图的问题解决掉。摆在面前的有三个选项：

| 方案 | 首次显示 | 维护成本 | 国内速度 |
|---|---|---|---|
| 第三方截图 API（thum.io、mshots 这类） | 5～15 秒 | 零 | 绕一圈国外 |
| 手动截图传图床 | 快 | 每加一条友链重做一次 | 看图床脸色 |
| 本机离线截好存进仓库 | 快 | 跑一条命令 | 同源，最快 |

第一个方案不用试：这类服务是"你请求它、它现去打开那个网站截图"，第一次必然等好几秒。加上国内访问那些服务本身就慢，卡片展览会变成幻灯片。

第三个方案的代价是仓库多 190 KB、多一个脚本要维护。我选了它。

## 离线截图脚本

新增 `scripts/generate-friends-covers.ts`，跑一条命令把启用中的友链全截一遍：

```bash
npx tsx scripts/generate-friends-covers.ts
```

它干这几件事：

1. 从 `friendsConfig` 里取启用中的友链；
2. 调本机的 `chrome-headless-shell` 逐个打开首页截图；
3. 用 `sharp` 转成 640 宽的 webp，存进 `public/assets/images/friends/covers/`；
4. 生成 `src/data/friends-covers.json` 映射清单。

已经截过的会跳过，所以以后加了新友链再跑一次，只补新的那一张。

截图用的参数：

```bash
--headless --no-sandbox --disable-gpu --hide-scrollbars
--force-device-scale-factor=1
--window-size=1280,512
--virtual-time-budget=10000
```

`--window-size` 里的高度特意给得矮。卡片上那块封面是 7rem 高、宽度跟着卡片走，比例大概 2.5:1，用 1280×512 截出来的正好是首页顶部（导航加首屏），比截个完整的 1280×800 再让 CSS 居中裁掉上下更合适。

> [!NOTE]
> `--virtual-time-budget` 是让浏览器等网络空闲，它不推进页面里的 `setTimeout`。有站点靠定时器延迟渲染首屏的话，截出来可能是空白。我这 12 个站没遇到，但这个坑先记着。

12 个站跑完，一次成功，零失败。单张 7～45 KB，加起来 190 KB。

## 卡片是浏览器现场拼的

图有了，剩下的问题是怎么塞进卡片。

不能改 `friends.astro`，那就换个思路：卡片结构留给主题，封面用一段独立脚本在浏览器里补上去。

原卡片是个横向 flex：左边 64×64 头像，右边名字、描述、标签。要让它顶部能展开一条通栏封面，把布局改成两列网格最省事：

```css
.friends-grid .friend-card {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr);
	column-gap: 0.75rem;
}
.friends-grid .friend-card > .ff-friend-cover {
	grid-column: 1 / -1; /* 占满整行 */
}
```

这里占了个便宜：卡片里那两个装饰元素（悬停时的主题色底块、右上角的箭头图标）本来就是 `position: absolute`，在网格里不参与自动排布。所以真正进网格的只有封面、头像、内容三块，位置正好排成"封面一行、头像和内容一行"。

封面首屏是不加载的。脚本给 `img` 挂的是 `data-src`，只有卡片真的被悬停或聚焦过，才把地址写进 `src`：

```js
["mouseenter", "focusin", "pointerdown", "touchstart"].forEach(function (name) {
	card.addEventListener(name, reveal, { once: true, passive: true });
});
```

`/friends/` 一页 12 张图，全铺上去就是 190 KB。现在第一次进去是 0 张，划过哪张加载哪张。

## 数据接口和注入点

映射表走了一个构建期生成的静态 JSON：

```
src/pages/api/friends-covers.json.ts
```

加了 `export const prerender = true`，构建时把 `friendsConfig` 和截图清单合成一份文件，访客拿到的就是 `dist/api/friends-covers.json`。没有服务端，也没有运行时开销。

脚本怎么进到 `/friends/` 页面，这一步卡了一会儿。

最自然的做法是写进 `friends.mdx`，但那个页面的内容区在 `#swup-container` 里 —— swup 无刷新切页时，新插进 DOM 的 `<script>` 标签浏览器不会执行。从首页点进友链页，脚本就等于没加载。

所以最后落在页脚注入点（`src/config/FooterConfig.html`）上。它在 swup 容器之外，整页加载时执行一次，然后挂住 swup 的切页事件：

```js
document.addEventListener("astro:page-load", loadFriendCovers);
document.addEventListener("swup:page:view", loadFriendCovers);
```

页脚里只放十几行判断，真正的逻辑在 `/assets/js/friends-covers.js`，而且这个脚本只有 `/friends/` 才会去拉，其他页面不背这个包。

## 性能账

| 项目 | 成本 |
|---|---|
| `/friends/` 首屏 | 0 张封面图请求 |
| 悬停一张卡片 | 1 张 webp，7～45 KB，之后走浏览器缓存 |
| 友链脚本本体 | 4 KB，只在 `/friends/` 加载 |
| 其他页面 | 页脚多十几行判断，约 0.5 KB |

## 一个知道但暂时没解决的问题

悬停展开时卡片会从 94px 长到 206px，网格行高跟着变，所以同一行下面的卡片会被往下顶一下。

参考站也是这个行为（他的 CSS 就是 `height: 0 → 7rem`），我按他的做法来。想要完全不跳，得把封面改成绝对定位的浮层，那就不是他这个效果了，先放着。

## 以后加友链

```bash
npx tsx scripts/generate-friends-covers.ts
```

截图脚本会跳过已截过的，只补新增那条，然后重写一遍清单。跑完构建带上线就完事。
