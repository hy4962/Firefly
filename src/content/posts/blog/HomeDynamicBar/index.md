---
title: "首页加了一条会滚的动态：参考楠枝小筑，一个主题文件都没改"
published: 2026-10-05
description: "在楠枝小筑首页看到一条会一直横滚的「瞬间」条，想在自己站上也挂一个。他用的是 Ethereal 主题，代码没法照抄，所以只搬机制：Memos 数据在客户端拉，滚动靠 CSS 把轨道复制成两份，DOM 走页脚注入再加一点点搬运。最后改动落在两个文件里，主题源码一个没碰。"
image: ./images/cover.webp
tags: [Firefly, Astro, Memos, CSS, 前端]
category: 博客
draft: false
---

翻到一个叫楠枝小筑的站（[nanzhiy.cn](https://www.nanzhiy.cn/)），首页横幅下面挂着一条一直在横向滚的东西：左边一个「瞬间」胶囊，右边「更多」，中间是滚过去的动态文字，鼠标放上去还会停。

我这边也有「动态」页，走的是 Memos。但内容全藏在 `/dynamic/` 里，首页上一丁点都照应不到 —— 别人点进来，不点那个链接根本不知道有这东西。

所以把它搬过来。

![首页那条会横滚的动态条，点了下滑箭头之后的落点](./images/cover.webp)

## 他那条是怎么做的

扒了一遍他的页面。这个站用的不是 Firefly，是 **Ethereal**（资源路径是 `/themes/Ethereal/assets/*.css`，页面里还留着 Thymeleaf 的痕迹 —— `.home-moments-track` 那块 JS 里写着 `th:if`）。

代码抄不了，机制可以搬。拆开看只有四件事：

| 机制 | 具体做法 |
|---|---|
| 无缝滚动 | 轨道内容复制成**完全相同的两份**，`translateX(0) → translateX(-50%)` 线性无限循环 |
| 内容不够一屏会静止 | 先按 `ceil(跑道宽 / 内容宽)` 重复 k 份把一屏补满，再整体复制 |
| 左右淡出 | `mask-image` 上一层左右两端透明的渐变 |
| 手感 | 速度约 48px/s、最短 20s；悬停暂停；`prefers-reduced-motion` 时完全不动 |

无缝的原理就是那个「两份」：第二份的开头和第一份的内容完全一样，所以平移到 -50%（正好是一份的宽度）时，第二份的开头刚好落在起点，肉眼接不上接缝。

还有个很容易漏的点：**内容不足一屏时必须先把内容重复到够宽**。不然一份还没跑道长，0 到 -50% 这段里后面是空的，整条看起来就是在原地不动。

## 我的落法：只动两个文件

主题的 `MainGridLayout.astro` 是上游文件，改它以后合并上游必冲突。所以还是走老路子 —— 页脚 HTML 注入 + 客户端脚本。

| 文件 | 状态 | 干什么的 |
|---|---|---|
| `src/config/FooterConfig.html` | 改（追加） | 条子的 DOM + 样式 + 按需加载那十几行 |
| `public/assets/js/home-dynamic-bar.js` | 新增 | 拉 Memos、渲染轨道、控制滚动、把 DOM 搬到位 |

`FooterConfig.html` 是本站已经在用的注入点（页脚的运行时间和访问统计都在里面），`<style>` 和 `<script>` 都能正常生效。

脚本只在首页 `/` 才拉取，其他页面只多十几行判断。

数据没什么好说的：`/dynamic/` 已经在用 Memos，直接连同一个接口拿最近的 12 条就行。响应里的 `creator` 字段得在客户端再过滤一次 —— Memos 的 ListMemos 带不带 `parent` 返回结果都一样，这个坑主题自己的 `memos-adapter.ts` 里也标注了。

## 条子该插在哪

这个是折腾最久的地方，前后改了两版。

第一版插在 `#main-grid` 之前，横跨全宽，看着没问题 —— 直到点了首页那个下滑箭头，滚动条整个不见了。

查了半天才反应过来。那个箭头的 onclick 长这样：

```astro
onclick="document.getElementById('main-grid')?.scrollIntoView({ behavior: 'smooth' })"
```

它滚的是 **`#main-grid`**，不是页面往下翻一屏。而 `#main-grid` 自己还带着 `scroll-margin-top: 5.5rem`（怕被吸顶导航栏盖住），所以点完之后它正好停在视口往下 88px 的位置 —— 条子在它前面，自然被甩到视口上方去了。

> [!WARNING] 第二轮我一度把它挪进了 `#content-column`
> 那样确实不会被甩出去，但只有文章列的宽度（1440 视口下 701px），比左右侧栏窄一大截，看着像「嵌」进去的一小块，不是横跨的一整条。又改了回来。

**最终解法**：让条子变成 `#main-grid` 的 **grid item**，靠 `grid-column: 1 / -1` 横跨全部列。

```css
.ff-dyn {
	grid-column: 1 / -1;
	display: none;   /* 默认不显示，数据到位才放开 */
	margin: 0;       /* 行间距交给 #main-grid 自己的 gap-4 */
}
```

一举两得：既在 `#main-grid` **内部**（箭头滚过来时它就在视野里），又拿到了横跨左右侧栏的全宽。

能这么改的前提是 `#main-grid` 用的是**自动放置**。它自己的样式注释写得很清楚：

```css
/* #main-grid 列几何全部来自 --cols-* / --*-display-*；
   子元素不做定位：侧栏包裹层是 display:contents，真正的 grid item 是内层元素 */
```

没有写死列位置，所以插一个跨列 item 不会打乱左右侧栏的排布，其余 item 自动顺延到下一行。

另外 `margin` 必须清零 —— `#main-grid` 自带 `gap-4`，再叠一层 margin 就是双倍间距。

## 两个不显眼但会咬人的坑

**1. `hidden` 属性在这儿是失效的**

一开始想用 `hidden` 控制「数据没来就别显示」，结果发现条子一直在页脚位置上挂着。

原因是作者样式的 `.ff-dyn { display: flex }` 和浏览器默认的 `[hidden] { display: none }` **特异性完全一样**（都是 0,1,0），同分时后定义的赢 —— 作者样式胜出，`hidden` 直接被吃掉。

要么显式写一条：

```css
.ff-dyn[hidden] { display: none; }
```

要么干脆别用 `hidden`。本站最后改成了加 `.ff-dyn--ready` 类来控制。

**2. Vercel 给 `/assets/*` 配了 30 天强缓存**

`vercel.json` 里这条会让改过的 js 在老访客那里一直是旧的：

```json
{
	"source": "/assets/(.*)",
	"headers": [
		{
			"key": "Cache-Control",
			"value": "public, max-age=2592000, stale-while-revalidate=604800, must-revalidate"
		}
	]
}
```

所以加载脚本时挂了个版本号，以后改脚本记得把 `v=` 往上加：

```js
script.src = "/assets/js/home-dynamic-bar.js?v=1";
```

## 顺手测了下会不会拖慢首页

这个是上线前最担心的：条子要等 Memos 数据回来才显示，会不会变成首页的阻塞项？

用无头浏览器跑了一组对照 —— 把 `memos.49o.pw` 的请求全部 abort，模拟接口整段挂掉：

| | 正常加载 | 接口全挂 |
|---|---|---|
| FCP（首次内容绘制） | 1112ms | **1112ms** |
| DOMContentLoaded | 1437ms | 1428ms |
| 首页文章卡数量 | 10 | **10** |
| CLS（布局偏移） | 0 | 0 |
| 滚动条 | 1599ms 出现 | 永不出现，也不留空壳 |

FCP 两组一模一样，说明条子根本不在首屏的关键路径上。三个原因：

1. DOM 默认 `display: none`，不占布局也不参与渲染；
2. 那个 js 是**动态创建插入的 async 脚本**，不阻塞解析，也不阻塞 DOMContentLoaded；
3. 数据是页面渲染完之后才发起的客户端请求，拉不到就永远不显示。

它比首屏内容晚约 400ms 出现，而且是从无到有插进去的。因为首页横幅占满整屏、`#main-grid` 那一刻还在视口外，实测 CLS 是 0，没有可见的跳动。数据本身还带了 10 分钟的本地缓存，第二次访问基本是瞬时出现。

暗色模式直接跟着主题变量走，没额外写一套色：

![暗色模式下的动态滚动条](./images/image-001.webp)

## 上手步骤

想照搬的话大概是这几步：

1. 在 `FooterConfig.html` 里追加条子的 DOM、样式和按需加载脚本（只在首页拉）
2. 新建 `public/assets/js/home-dynamic-bar.js`，数据源改成你自己的 Memos 实例和用户名
3. 脚本里 `mount()` 用 `host.insertBefore(bar, host.firstChild)` 把 DOM 插到 `#main-grid` 首位
4. 样式里给 `.ff-dyn` 加 `grid-column: 1 / -1` 拿全宽，`margin` 清零
5. 拉不到数据时不要加 `.ff-dyn--ready`，让它彻底不显示
6. 本地 `astro build` 验一次，确认图片都走了 `_astro` 管线

脚本里的几个参数集中在这几行，想调直接改：

```js
var MAX_ITEMS = 12;        // 最多放几条
var SPEED = 48;            // 滚动速度 px/s，越小越慢
var MIN_DURATION = 20;     // 一轮最短几秒，内容太少时兜底
```

## 写在最后

整个过程最贵的不是写代码，是想明白条子该插在哪。前后改了三版，最后一版其实是反过来利用了主题自己的 grid 布局 —— 要是 `#main-grid` 当初写死了列位置，这条路就走不通。

还有一件事得说清楚：现在首页横幅是全屏模式（`mode: "fullscreen"`），占满整个视口，所以条子在首屏之下，要点那个下滑箭头才看得到。
