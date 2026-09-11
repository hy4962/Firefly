---
title: "给博客首页加了张可拖拽贴纸卡片：一次合并友好的魔改"
published: 2026-09-06
updated: 2026-09-12
description: "看到 rainzt.cn 的首页毛玻璃卡片和能拖动的贴纸羡慕了，扒下来装到自己的 Firefly 上。全程只新增文件不动主题源码，以后还能正常合并上游更新，顺便踩了一堆 CSS 的坑。后来又按性能数据把入场动画拆成两段、关掉了 Swup 视口预取。"
image: ./images/cover.webp
tags: [Firefly, Astro, CSS, 博客魔改, 性能优化]
category: 博客
draft: false
---

前几天刷到 [rainzt.cn](https://rainzt.cn)，首页是一张虚线框毛玻璃卡片，头顶贴着胶带、头像旁边挂了个 "You're Absolutely Right!" 的小贴纸，底下还有一排 Q 版小人，按住还能拖走。我一瞬间就觉得自己的首页太素了。

![rainzt.cn 的首页效果，卡片和贴纸都在壁纸区](./images/image-001.webp)

更舒服的是，我去翻了翻它的源码仓库 —— ::github{repo="Jarvis0227/Aemeath"}，发现它也是基于 Firefly 二改的。同一种子，那我抄作业的心就更安了。

## 先扒站：仓库里根本没有这套代码

第一反应是去仓库里找实现，结果 `sticker`、`drag` 全搜了一遍，啥都没有。它的 GitHub 仓库落后于线上站，这套装饰层根本没开源进去。

行吧，那就直接扒线上站。`curl` 把首页 HTML 拉下来，grep 一把 `home-wallpaper-sticker`，结构立刻清晰了：

```bash
curl -sL https://rainzt.cn/ -o rainzt.html
grep -o 'class="[^"]*sticker[^"]*"' rainzt.html | sort -u
```

从线上站一共拆出三块料：

1. **卡片 HTML**：一个 `article.home-wallpaper-card`，头像、身份行、标题、副标题、导航、彩色标签，全是语义化标签
2. **CSS**：`home-wallpaper-decor.css`，22KB，从卡片毛玻璃到贴纸投影全带
3. **JS**：一段拖拽脚本，Pointer Events 实现，附带移动端四角随机投放和点击复制 toast

贴纸图片就直接从它站点上下载到自己的 `public/images/home-stickers/`，一共十几张 webp。

## 集成方案：全放新文件，只留一个挂载点

这里我给自己加了个约束：**以后要合并 CuteLeaf/Firefly 上游的更新**。所以这套东西不能像传统魔改那样把主题文件改得到处都是，不然下次合并就是一场战争。

最终的结构是：

```
src/config/homeCardConfig.ts              # 新文件：全部配置
src/components/features/HomeWallpaperDecor.astro   # 新文件：HTML + CSS + JS 全自包含
public/images/home-stickers/              # 新目录：贴纸素材
```

主题文件只动了 `WallpaperSection.astro` 一个，改动是纯增量的一小段：

```diff
+ import HomeWallpaperDecor from "@/components/features/HomeWallpaperDecor.astro";
+ import { homeCardConfig } from "@/config/homeCardConfig";

  const { state, backgroundImages, title, bannerPostMeta } = Astro.props;
+ const homeCardEnabled = homeCardConfig.enable === true;

+ {homeCardEnabled && <HomeWallpaperDecor />}
```

卡片上显示什么也全部收进配置文件，换标题、换社交链接、挪贴纸都不用碰组件：

```ts
export const homeCardConfig = {
  enable: true,
  identity: "HY",
  title: "折腾进行时",
  subtitle: "Hello, I'm HY.",
  navLinks: [
    { name: "文章", url: "/archive/" },
    { name: "友链", url: "/friends/" },
    // ...
  ],
  socials: [
    { name: "GitHub", icon: "fa7-brands:github", url: "https://github.com/hy4962" },
    { name: "Email，点击复制", icon: "fa7-solid:envelope", copy: "admin@9ll.uk" },
    // ...
  ],
  stickers: [
    // 具体使用时，每一项只需要管这五个值
    { src: "/images/home-stickers/blonde-idol.webp", name: "金发偶像", top: 20, left: 1.2, width: 112, rotate: 4 },
    { src: "/images/home-stickers/blue-witch.webp", name: "蓝发魔女", bottom: 5, left: 1.2, width: 98, rotate: -5 },
    // ...
  ],
};
```

以后合并上游，就算 `WallpaperSection.astro` 被改了，冲突也就几行，手工处理一下就完事。

## 使用指南：怎么改成自己的

先说清楚数据流：**配置文件只描述内容，组件负责渲染，主题只提供一个挂载点**。日常改内容，你只需要动 `homeCardConfig.ts` 一个文件。

### 换文字和链接

- `identity` / `title` / `subtitle`：卡片上三行字，留空会自动回退到 `profileConfig` 和 `siteConfig` 里的名字、站点标题、签名
- `navLinks`：卡片标题下方的快捷导航，数组每一项 `{ name, url }`
- `socials`：彩色标签社交按钮，最多 5 个，颜色按顺序自动循环。`url` 是跳转，`copy` 是点击复制（邮箱、微信号这种就适合用 `copy`）

### 改贴纸

场景贴纸每一项的字段含义：

| 字段 | 含义 | 说明 |
|---|---|---|
| `src` | 图片路径 | public 目录的绝对路径，如 `/images/home-stickers/xxx.webp` |
| `name` | 备注名 | 不显示，只是给自己看的 |
| `top` / `bottom` | 纵向定位 | 距容器顶/底的百分比，二选一；一排贴纸用 `bottom` 才能对齐地面线 |
| `left` | 横向定位 | 距容器左侧的百分比 |
| `width` | 基准宽度 | px 为单位，实际渲染按视口自动缩放 |
| `rotate` | 旋转角度 | 度数，正数顺时针 |

纵向用 `top` 还是 `bottom` 取决于贴纸在哪一排：**底部那排全部用 `bottom`**，这样无论贴纸多高，脚都踩在同一条线上；左右两列的上半部分用 `top`。

还有一个 1.25 倍的全局缩放系数在组件里（`HomeWallpaperDecor.astro` 顶部的 `STICKER_SCALE`），想要所有贴纸一起变大变小改它就行，不用一个个调 `width`。

### 替换素材

新贴纸丢进 `public/images/home-stickers/`，然后改对应条目的 `src`。两个注意点：

1. 图片别太大——贴纸实际只显示 100~140px 宽（配置里的 `width` 再乘组件顶部的 1.25 倍缩放），源图 **192px 宽就够**，太大只会白烧流量
2. 底部一排的贴纸如果新素材身高差得特别大，地面线是靠 `bottom` 锚定保证的，不用管高度

### 关闭整套装饰

`enable: false`，组件整个不渲染，默认的横幅文字会自己回来，什么都不用动。

## 实现细节

### 显隐：不跟 Swup 纠缠，交给 CSS

Firefly 的壁纸区在 Swup 容器外面，切页不重渲染。这意味着装饰层不能依赖"重新渲染时判断是不是首页"，得自己处理显隐。

我最后用的方案是纯 CSS 门控，和主题里滚动指示器的思路一致：

```css
.home-wallpaper-decor {
  opacity: 0;
  visibility: hidden;
  /* ... */
}
html[data-wallpaper-mode="banner"] body.is-home .home-wallpaper-decor,
html[data-wallpaper-mode="fullscreen"] body.is-home .home-wallpaper-decor {
  opacity: 1;
  visibility: visible;
}
```

`body.is-home` 是服务端渲染 + Swup 切页时都会维护的类，`data-wallpaper-mode` 跟着壁纸模式走。这样切去文章页装饰层自动淡出，回到首页自动出现，一行 JS 都不用写。

入场动画最初是等卡片图片全部加载完再加 `is-ready` 触发，动画播完用 `animationend` 事件打上 `is-motion-settled` 标记固化终态。另外加了个 `MutationObserver` 盯着 `body` 的 class，每次从别的页面回首页时重播一遍入场动画。

> [!NOTE] 这段后来改过
> "等图片加载完才播动画"这个做法后来被推翻了——它把标题的入场一起拖到了图片下载之后。现在文字和图片走两条独立通道，细节见文末「后续更新」一节。

## 贴纸布局：从随手摆到强迫症对齐

贴纸位置全用百分比，但默认值不能随便摆——卡片居中占了大约 34%~66% 的横向空间，导航链接和社交标签都在卡片下半部，贴纸直接压上去会挡住点击。

最终的布局结构是：**左列（金发偶像上、蓝发魔女下）、右列（竹哒上、初音下）、底部中间一排三个**。宽度用 `min()` 做响应式收缩：

```css
width: min(105px, 5.4688vw, 11.5068vh);
```

中间排一开始我用 `top` 定位，结果贴纸身高不一，头顶齐了脚不齐，怎么看怎么别扭。后来把底部一排全改成 `bottom` 锚定——不管多高，脚都踩在同一条地面线上，瞬间工整了：

```ts
// bottom（距底）或 top（距顶）二选一
{ name: "蓝发魔女", bottom: 5, left: 1.2, width: 98, rotate: -5 },
```

### 拖拽的实现

拖拽用 Pointer Events，鼠标和触屏一套代码。指针按下时记录贴纸相对壁纸容器的坐标，移动时换算成 `left/top` 并夹在壁纸范围内（`Math.max(0, Math.min(容器宽 - 贴纸宽, ...))`），配合 `setPointerCapture` 保证拖出元素外也不丢事件。移动端额外禁掉长按弹菜单的 `contextmenu` 和 iOS 的 `touch-callout`。

头像小贴纸的位移写 CSS 变量而不是 `style.transform`，这是踩坑 4 的教训——fullscreen 模式下主题有 `transform: scale(1.05) !important`，内联 transform 打不过它。

刷新后贴纸回到初始位置是故意的：不做 localStorage 记忆，访客拖乱之后下次进来还是整齐的。

### 移动端的自适应

手机端和桌面端是同一套结构，靠脚本换算：解析每个贴纸初始配置里的 `top/bottom/left` 识别它属于左列、右列还是中间排，然后按卡片实际边界重排——顶部两张贴卡片上方两侧，底部五个 `bottom` 锚定在卡片下方，中间三个在左右两列之间等宽槽位居中。布局时机挂 `load` + `setTimeout` + 防抖 `resize` 兜底（后台标签页里 rAF 不触发，这个坑下面细说）。

## 踩坑记录

这次踩的坑比写代码的时间还长，值得单独一节。

### 坑 1：默认横幅文字阴魂不散

装饰卡片上线后，"World and Life" 那套默认横幅文字还叠在卡片上。我明明在服务端把 `showHomeText` 关了，HTML 里也确实带着 `hidden` 类——但页面跑起来之后它又出现了。

翻主题源码才发现有个 `syncBannerHomeTextVisibility()`，会在运行时按"是否首页 + 壁纸模式"重新计算并把 `hidden` 类摘掉。它不认识我的卡片，只知道"首页就该显示横幅文字"。

![文字覆盖层和卡片叠在一起的样子](./images/image-002.webp)

不想去改主题的工具函数，最后用同一条件的 CSS 规则直接压死：

```css
html[data-wallpaper-mode="banner"] body.is-home .banner-home-text-overlay {
  display: none !important;
}
```

这段 CSS 在我的组件里，组件不渲染时它也不存在，卡片关掉就一切恢复原状。

### 坑 2：看不见的卡片盒模型挡住了点击

调试时发现分类栏的"归档"按钮点不动，Playwright 报错说元素被 `article.home-wallpaper-card` 盖住了。卡片是透明的，但盒模型是实打实的，社交标签下方还伸出去一截。

解法是把整个卡片设成 `pointer-events: none`，再只给真正需要交互的子元素恢复：

```css
.home-wallpaper-card { pointer-events: none; }
.home-wallpaper-card__nav a,
.home-wallpaper-card__social-link,
.home-wallpaper-card__avatar-sticker {
  pointer-events: auto;
}
```

### 坑 3：切到 fullscreen 模式，贴纸三连崩

把壁纸模式切成 `fullscreen` 之后怪事来了：贴纸变大了一圈、下半截被裁掉、滚动一下还糊成一团。

![fullscreen 模式下贴纸被放大裁切又模糊](./images/image-003.webp)

查出来是主题在 fullscreen 模式下有针对壁纸容器内**所有** `img` 的规则，一共三条变体，其中最高的一条长这样：

```css
html[data-wallpaper-mode="fullscreen"][data-fullscreen-layout="classic"] #wallpaper-wrapper img {
  width: 100% !important;
  height: 100% !important;
  object-fit: cover !important;
  filter: blur(var(--fullscreen-blur)) !important;
  transform: scale(1.05) !important;
}
```

它的本意是让壁纸图铺满全屏、滚动时渐变模糊，但贴纸图也是 img，全被扫进去了：`cover` 负责裁切，`scale(1.05)` 负责放大，`blur` 负责糊脸，三个症状一次凑齐。

修法是在我自己的组件里加更高特异性的豁免规则。主题那条是 `(1,2,2)`，我借自己容器的类提到 `(1,3,2)`：

```css
html[data-wallpaper-mode="fullscreen"] #wallpaper-wrapper .home-wallpaper-decor .home-wallpaper-sticker img {
  width: 100% !important;
  height: auto !important;
  object-fit: contain !important;
  filter: none !important;
  transform: none !important;
}
```

![修复后 fullscreen 模式恢复正常](./images/image-004.webp)

### 坑 4：!important 大战之下，拖拽失效了

修上面这个的时候又埋了个雷：`transform: none !important` 把头像小贴纸的拖拽也废了——JS 拖拽写的是内联 `style.transform`，在内联样式里 `!important` 之外，任何样式表的 `!important` 都能把它按在地上摩擦。

解法是拖拽位移不走 `style.transform`，改写 CSS 变量：

```css
.home-wallpaper-card__avatar-sticker {
  transform: translate(var(--avatar-sticker-tx, 0px), var(--avatar-sticker-ty, 0px));
}
```

```js
// fullscreen 下也照样能拖
sticker.style.setProperty("--avatar-sticker-tx", `${translateX}px`);
sticker.style.setProperty("--avatar-sticker-ty", `${translateY}px`);
```

变量赋值是内联的，规则里带 `!important` 的 `transform` 引用的还是这份值，两边不打架。

### 坑 5：移动端随机投放，是我自己想当然

一开始照搬参考站的移动端方案：只显示 4 张 `mobile: true` 的贴纸，随机投放到四块写死的百分比区域。结果上线一看不对劲——区域是死的，卡片却是活的，窄屏下卡片占掉九成宽，两块"侧边区域"直接压在卡片上，一张贴纸骑在社交标签上，另外三张干脆没显示。

![手机端最初的随机投放，贴纸压在卡片上](./images/image-005.webp)

想明白了就把"随机投放"整个删掉：移动端显示全部贴纸，布局和桌面端同一套结构，坐标由脚本按卡片实际边界换算——顶部两张贴在卡片上方，底部五个 `bottom` 锚定在卡片下方，中间三个在左右两列之间等分槽位。这样不管屏幕多窄都自适应。

### 坑 6：布局代码写完了，后台标签页里根本不跑

自适应布局写完，我自己截图验证，发现贴纸时对时不对，纯属玄学。排查半天是两个坑叠一起：

1. 布局被包在 `requestAnimationFrame` 里——后台标签页的 rAF 是不触发的，页面在后台加载时布局永远不执行
2. 依赖 `matchMedia` 的 `change` 事件切换布局——部分环境（视口仿真等）这个事件压根不派发

解法：布局改同步执行（读 `getBoundingClientRect` 本身就会强制布局，不需要 rAF），再补 `load` 事件、`setTimeout` 校准和防抖 `resize` 监听兜底。顺手把贴纸坐标的解析从正则换成了临时元素 + `cssText`，让浏览器自己拆 `inset` 简写——之前那个正则压根没算上百分号，一直匹配失败，全靠默认值兜底。

### 坑 7：贴纸素材太大了

做完才反应过来，贴纸原图全是 1086×1448 的高清图，加起来 1.6MB，而它们实际只显示一百来像素宽——下载量是显示需求的十倍。用 ffmpeg 压到 192px 宽之后总共 **126.8 KB**，肉眼看不出差别：

```bash
cd public/images/home-stickers
for f in *.webp; do
  ffmpeg -y -loglevel error -i "$f" -vf "scale=192:-1" "tmp/$f"
done
```

八张图现在的实际尺寸和体积：

| 素材 | 尺寸 | 体积 |
|---|---|---|
| 金发偶像 | 192×256 | 16.2 KB |
| 洛琪希 | 192×256 | 20.1 KB |
| 和泉纱雾 | 192×256 | 14.2 KB |
| 祢豆子 | 192×256 | 17.7 KB |
| 初音未来 | 192×256 | 20.9 KB |
| 鹿目圆 | 192×256 | 16.2 KB |
| 御坂美琴 | 192×256 | 16.0 KB |
| Claude Code | 160×115 | 5.4 KB |

贴纸显示宽度是配置里的 `width` 乘上组件顶部的 `STICKER_SCALE = 1.25`，算下来在 98~140px 之间。192px 的源图对这个显示尺寸是 1.4~2 倍，正好覆盖高清屏，再大就是纯浪费。

## 效果

手机端不再是另一套布局：和桌面端同一套结构，脚本按卡片实际位置自适应换算，便签自动居中到顶部：

![手机端效果，全部贴纸自适应排布](./images/image-006.webp)

拖拽是按下即拖，Pointer Events 鼠标触屏通用，位置限制在壁纸范围内，点击邮箱标签会弹"已复制"的 toast：

![拖拽和复制 toast 的验证](./images/image-007.webp)

刷新后贴纸会回到初始位置，这点是故意的——位置记忆听着美好，但访客拖乱之后就再也回不去了，参考站也是这么做的。

## 极简流程

1. `curl` 抓参考站 HTML，拿到卡片结构、CSS、拖拽 JS 三块料，贴纸图下载到 `public/images/home-stickers/`
2. 新建 `src/config/homeCardConfig.ts`，卡片内容和贴纸位置全配置化
3. 新建 `src/components/features/HomeWallpaperDecor.astro`，HTML/CSS/JS 自包含
4. `WallpaperSection.astro` 里加一个挂载点，同时把 `showHomeText` 短路掉
5. 显隐交给 `body.is-home` + `data-wallpaper-mode` 的 CSS 门控
6. 踩坑修复：压默认文字、放开卡片点击、fullscreen 豁免、CSS 变量拖拽、移动端自适应布局
7. 后续：换自己的贴纸素材、入场动画拆成文字/图片两段、关掉 Swup 视口预取

## 写在最后

这次最值得记的其实不是贴纸本身，而是"合并友好"这个约束：所有逻辑收进两个新文件，主题只留一个挂载点，连踩坑修复都尽量用自己组件里的高优先级规则去覆盖，而不是直接改主题源码。以后上游更新合并过来，该是啥样还是啥样。

贴纸素材当时用的还是 rainzt 的演示图，后来换成了自己的一套角色（下面说）。想换成自己的图直接丢进 `public/images/home-stickers/` 改下配置就行。

## 后续更新

上面那一版是 9 月初的形态。后面又折腾了几轮，这里按时间补上，免得文章停在一个过时的状态。

### 贴纸换成自己的了

原来那批是参考站的演示图，8 张都是常见动漫 Q 版角色。后来换成了自己挑的一套，还是 8 张，布局位置一个没动：

| 素材 | 位置 |
|---|---|
| 金发偶像 | 左列上（`top: 20`） |
| 洛琪希 | 左列下（`bottom: 5`） |
| 和泉纱雾 | 底部左（`bottom: 5, left: 48`） |
| 祢豆子 | 右列上（`top: 20`） |
| 初音未来 | 右列下（`bottom: 5, left: 94`） |
| 鹿目圆 | 底部中（`bottom: 5, left: 61.5`） |
| 御坂美琴 | 底部中左（`bottom: 5, left: 34.5`） |
| Claude Code | 底部右（`bottom: 5`） |

换素材只动了 `homeCardConfig.ts` 里的 `src` 和少量 `width`，组件一行没改——这算是当初把内容全配置化的回报。压缩尺寸也顺便从 360px 收到了 192px，8 张图合计 126.8 KB（原本 330KB，再早是 1.6MB）。

### 入场动画拆成了两段

这是被一组性能数据逼出来的改动。我跑了几轮 Lighthouse 测移动端，一直有个数字看不懂：最大元素（LCP）要 4 秒多才被浏览器认定"画好了"，而且查不到是哪张图拖的。

后来把 Lighthouse 的底层 trace 导出来（145MB）流式解析，才发现 LCP 元素根本不是壁纸、也不是卡片，**是卡片里那行标题文字**：

```
@ 2614 ms  type=text  size=15194  nodeName=SPAN class='home-wallpaper-card__motion-text'
```

顺着查到两个叠加的原因，都在这套入场动画里：

1. **标题的入场关键帧起点是全透明**。它借用了通用的 `home-wallpaper-content-enter`，0% 是 `opacity: 0`；而动画用了 `animation-fill-mode: both`，意味着动画开始**前**就套用 0% 关键帧——于是它在 0.36 秒的延迟期间一直是全透明的，**Chrome 不把 `opacity: 0` 的元素算作内容绘制**，LCP 自然被推迟。
2. **`is-ready` 要等图片**。前面写的那句"等卡片图片加载完再加 `is-ready`"，把标题的入场也一起绑在了图片下载上。

改法是两刀：

- 给标题单独一版关键帧，起点直接 `opacity: 1`，只保留从下往上滑 12px 的位移；延迟从 `0.36s` 收到 `0.08s`。视觉上还是"滑上来"，但第一帧就算画好了。
- 入场逻辑拆两段：文字动画不再等图，两帧之后直接放行；图片单独走一条 `is-media-ready` 通道，只控制自己 0.24 秒的淡入。

```css
@keyframes home-wallpaper-title-enter {
  0% { opacity: 1; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
.home-wallpaper-decor.is-ready .home-wallpaper-card h1 {
  animation-name: home-wallpaper-title-enter;
  animation-delay: 0.08s;
}
```

拆图片通道时留了个安全垫：图片的隐藏规则写成 `.is-ready:not(.is-media-ready)`，只有 JS 确实接管、入场已启动时才隐藏它。这样脚本失效、或者访客开了"减弱动态效果"，图片都是直接可见的，不会永久空白一块。

### 顺手关掉了 Swup 的视口预取

同一次体检里还挖出一笔大流量：Swup 的预取插件默认会**把导航里露出来的链接全部提前下载**。首页第一屏正好有 7 个链接满足条件（卡片导航 5 个 + RSS / 打赏），移动端一次抓回 483KB 页面 HTML，占总流量 34%。

改法是把它还原成上游那行 `preload: true`。这行配置的完整语义是"hover 预取开、视口预取关"，跟我想要的 `visible: false` 运行时完全等价，但**和上游字节一致**，以后合并上游连 diff 都不会产生——这是这次所有优化里唯一一条能减少合并负担的改动。

效果（部署后实测）：

| 指标 | 改前 | 改后 |
|---|---|---|
| 移动端 perf | 64 | 71 |
| FCP | 3968 ms | 3006 ms（−24%） |
| LCP | 5280 ms | 4506 ms（−15%） |
| 总传输 | 1405 KiB | 916 KiB（−35%） |
| 预取页面数 | 16 | 1 |

桌面端分数没变（都是 89），但传输量从 2177 KiB 掉到 1142 KiB。桌面模拟带宽高，那 1MB 预取本来就不在关键路径上——所以桌面的收获是**省流量，不是提分**，这点得说清楚。

所有这些改动依然遵守着"不碰主题源码"的规矩：新增的关键帧、通道类名、门控规则全在 `HomeWallpaperDecor.astro` 里，这个文件上游根本没有，改它零冲突。`astro.config.mjs` 那行还反倒更接近上游了。

### 还没解决的

说个不太好看的：移动端那 2 秒的白屏直到现在也没完全解释清楚。trace 里能看到渲染阻塞的 CSS 在 612ms 就全部就绪了，但 FCP 还是拖到 2655ms——中间这段空窗目前只能怀疑是字体或主题运行时脚本，没定位到确切的元凶。

所以性能这块还没收工，下次再测。
