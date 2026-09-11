# 9LL.UK PageSpeed 优化清单（合并上游友好版）

> 实测时间：2026-09-11 20:20
> 工具：Lighthouse 13.4.1 本地跑 `https://www.9ll.uk/`（与 PSI 同一套审计引擎，移动端为默认节流配置）
> 仓库状态：`HY` 分支相对 `upstream/master` 为 **0 落后 / 315 领先**，上游已全部合入
>
> **执行进度：P0-1 / P0-2 / P0-4 已完成（见第九节「执行记录」）；P0-6 由你本人于 20:35 完成；P0-5 决定保留。**

---

## 一、体检结果（实测）

| 指标 | 移动端 | 桌面端 |
| --- | --- | --- |
| **Performance** | **72** | **100** |
| Accessibility | 96 | 95 |
| Best Practices | 100 | 100 |
| SEO | 100 | 100 |
| FCP | 2.1 s | 0.4 s |
| **LCP** | **6.2 s** ← 唯一大问题 | 0.6 s |
| TBT | 10 ms | 0 ms |
| CLS | 0 | 0.002 |
| Speed Index | 5.1 s | 0.8 s |
| TTI | 6.3 s | 0.6 s |
| 主线程总工作量 | 21.1 s | 7.4 s |
| 传输总量 | 1542 KiB / 85 请求 | 2139 KiB |

**结论：桌面端已经满分，不用碰。移动端 72 分全部来自 LCP —— 而 TBT 只有 10 ms、CLS 为 0，说明这不是 JS 执行或布局问题，是"最大元素出现得太晚"。**

---

## 二、根因：LCP 元素被贴纸图"锁"住了

Lighthouse 给出的 LCP 元素不是壁纸图，而是首页卡片标题：

```
LCP 元素：<span class="home-wallpaper-card__motion-text">折腾进行时</span>
  ├─ Time to first byte ......  252 ms
  └─ Element render delay .... 2190 ms   ← 全在这里
```

链式因果：

```
HTML 解析
  → 3 个 CSS 阻塞首屏渲染（41 KB，约 380 ms）
  → HomeWallpaperDecor 内联脚本启动
  → revealDecor() 执行 Promise.all(装饰层里所有 <img>)
  → 9 张贴纸图共 331 KB 下载完成（每张还有 1400 ms 兜底超时）
  → 加 is-ready 类
  → .home-wallpaper-decor.is-ready .home-wallpaper-card h1 的入场动画才开始
    （animation-delay 0.36s + 0.52s，起点 opacity: 0）
  → LCP 被记录在 6.2 s
```

对应代码：`src/components/features/HomeWallpaperDecor.astro`

- 第 581–585 行：`.home-wallpaper-decor { opacity: 0; visibility: hidden; }`
- 第 348–371 行：`waitForImage` 等待装饰层内**每一张** `img`，兜底超时 1400 ms
- 第 698 行：`.home-wallpaper-decor.is-ready .home-wallpaper-card h1 { animation-delay: 0.36s; }`

**所以：砍贴纸图体积 + 不让标题等贴纸，是移动端提分的第一杠杆。**

---

## 三、流量构成：1176 KiB 是可以回收的

| 项目 | 体积 | 占比 | 可回收 |
| --- | --- | --- | --- |
| Swup 预取其他页面（14 个） | 487 KiB | 31.6% | ✅ 约 487 KiB |
| 贴纸图（9 张） | 333 KiB | 21.6% | ✅ 已回收 204 KiB |
| 文章列表封面（10 张） | 270 KiB | 17.5% | ✅ 约 150 KiB |
| 脚本 JS（36 个） | 171 KiB | 11.1% | 部分 |
| `favicon.ico` | 86 KiB | 5.6% | ✅ 已回收 79 KiB |
| 壁纸 + 头像 | 80 KiB | 5.2% | — |
| HTML 文档 | 74 KiB | 4.8% | — |
| 样式 CSS | 41 KiB | 2.6% | — |

---

## 四、P0：零合并风险

> 判据：这些改动只落在 **你自己新增的文件**（上游不存在）、**`public/` 静态资产**、**配置项** 里。上游怎么改都不会冲突。

### ✅ P0-1 压缩首页贴纸图：331 KB → 127 KB（已执行）

| | |
| --- | --- |
| 位置 | `public/images/home-stickers/*.webp` |
| 合并风险 | **无**。`public/` 是静态资产；引用它的 `src/config/homeCardConfig.ts` 是你新增的文件 |
| 实际结果 | **339,148 B → 129,874 B，省 209,274 B（61.7%）** |

各文件结果：

```
blonde-idol.webp  360x480 -> 192x256   45,144 -> 16,626 B
claudecode.webp   220x158 -> 160x115    9,792 ->  5,568 B
madoka.webp       360x480 -> 192x256   43,382 -> 16,546 B
miku.webp         360x480 -> 192x256   58,922 -> 21,406 B
misaka.webp       360x480 -> 192x256   43,496 -> 16,414 B
nezuko.webp       360x480 -> 192x256   47,564 -> 18,170 B
roxy.webp         360x480 -> 192x256   53,742 -> 20,572 B
sagiri.webp       360x480 -> 192x256   37,106 -> 14,572 B
```

**参数选择的依据**（这部分是本次最有价值的经验）：

1. **目标尺寸看 CSS，不看配置**。`homeCardConfig` 里写的宽度是 88~112px，但样式里 `.home-wallpaper-sticker img { max-height: 104px }` 会把所有贴纸夹到 **约 78×104 CSS px**（Lighthouse 实测 72×96）。按 3:4 比例，192 宽已覆盖 2.46 倍 DPR。
2. **真正的体积杠杆是 `alpha_quality`**。Pillow 保存 WebP 时 `alpha_quality` 默认 **100（无损 alpha）**，这些贴纸的 alpha 平面占了很大比重。实测同一张 `miku.webp`：
   - `360x480 q75 aq100` → 50,144 B
   - `360x480 q75 aq60` → 40,286 B（仅降 alpha 质量就省 20%）
   - `192x256 q82 aq75` → 21,406 B
3. **PSNR 要在「实际显示尺寸」上比，不要在编码尺寸上比**。在编码尺寸上比会被透明区域的 RGB 噪声淹没（各质量档 PSNR 都卡在 21 dB，毫无区分度）；先合成到白底、再缩到 78×104 比较，才能反映肉眼所见。
4. 参数矩阵实测（合计体积 / 显示尺寸 PSNR 平均）：

| 参数 | 合计 | 省 | 显示尺寸 PSNR |
| --- | --- | --- | --- |
| 144 q85 aq80 | 91 KB | 72.4% | 36.8 dB |
| 192 q78 aq70 | 102 KB | 69.1% | 38.1 dB |
| **192 q82 aq75（采用）** | **127 KB** | **61.7%** | **38.8 dB** |
| 224 q85 aq80 | 173 KB | 47.7% | 41.1 dB |
| 256 q85 aq80 | 209 KB | 36.9% | 42.0 dB |

想更激进可改 192/q78/aq70（再省 25 KB），想更保真可改 224/q85/aq80。

原图备份在 `.workbuddy/tmp/stickers-orig-backup/`；也可 `git checkout -- public/images/home-stickers/` 还原。

### ✅ P0-2 别让标题等贴纸图（已执行）

| | |
| --- | --- |
| 位置 | `src/components/features/HomeWallpaperDecor.astro` |
| 合并风险 | **无**。该文件 1339 行全是新增，上游没有这个文件 |

改动（`git diff` 为 +10/-3）：

```diff
-            const images = [...decor.querySelectorAll("img")];
+            // 只等卡片自身的图：漂浮贴纸不再阻塞卡片内容（尤其是 h1 这个 LCP 元素）的绘制
+            const images = [...decor.querySelectorAll(".home-wallpaper-card img")];
```

```diff
-                    window.setTimeout(finish, 1400);
+                    // 兜底：图片迟迟不来也要放行动画，避免 LCP 被无限期拖延
+                    window.setTimeout(finish, 400);
```

**为什么这样改是安全的**：等待集合从「装饰层内所有图」收窄为「`.home-wallpaper-card` 内的图」——也就是头像 + 头像贴纸两张小图，不再包含 7 张漂浮贴纸。

而漂浮贴纸的入场动画自带 `animation-delay: 0.52s` + `both` 填充模式（第 1128–1131 行），意味着 `is-ready` 加上之后它们还要等 520 ms 才开始显示。**这 520 ms 天然就是缓冲**，贴纸有充足时间加载完，不会出现"动画播完了图还没到"的闪入。

### P0-3 Swup 的视口预取：省 487 KiB ← 待你决定

| | |
| --- | --- |
| 位置 | `astro.config.mjs` 第 135–138 行 |
| 合并风险 | **很低**。上游这一行是 `preload: true`，将来上游动这行最多是一次行级冲突 |
| 预期收益 | 首屏少抓 14 个页面 / 487 KiB |

**这是什么意思**（上次说没看懂，这里讲细一点）：

Swup 是这个主题用来做"点链接不刷新整页、只换内容区"的客户端路由库。它有个预加载功能：趁着用户还在看当前页，提前把可能要点开的页面 HTML 悄悄抓下来，这样真点下去时几乎瞬间切换。

预加载有两种触发方式：

- `hover`：鼠标悬停在链接上才抓（桌面端有效，触屏没有 hover）
- `visible`：**链接只要进入视口就抓**（不等人操作）

你把上游的 `preload: true` 显式改成了 `{ hover: true, visible: true }`，等于打开了 `visible`。结果是：首页导航栏那十几个链接一进视口就全部触发预取——实测首屏加载期间发起了 14 个额外请求：

```
/archive/ 74 KB   /friends/ 72 KB   /rss/ 69 KB      /sponsor/ 69 KB
/dynamic/ 69 KB   /about/ 67 KB     /guestbook/ 67 KB /moments/ 89 KB
/booknav/ 74 KB   /blog-changelog/ 71 KB            /projects/ 70 KB
/tags/ 69 KB      /gallery/ 69 KB   /series/ 67 KB   /categories/ 67 KB
```

合起来 **487 KiB，占移动端总流量的 31.6%**，在 1.6 Mbps 的模拟移动带宽下，这批请求正好和 LCP 需要的关键资源抢通道。

改法：

```js
// 现在
preload: {
  hover: true,
  visible: true,
},
// 改为（等价于上游的 preload: true —— @swup/preload-plugin 的默认是 hover-only）
preload: {
  hover: true,
  visible: false,
},
```

**代价说清楚**：触屏设备没有 hover，关掉 `visible` 后，移动端用户点击链接会回到"现抓现切"，切页首屏会慢一点。桌面端 hover 预取保留，不受影响。

所以这是一个**取舍**：

- 想要 PageSpeed 分数 → 关掉
- 更在意手机上切页的手感 → 保留，接受这 487 KiB

如果想两全：保留 `visible: true`，但把 LCP 相关资源进一步压小，让它们在这场带宽竞争里不至于落后。P0-1 已经把贴纸从 331 KB 压到 127 KB，其实已经缓解了不少。

**建议：先关掉跑一次，对比 LCP 和手机上的切页体感，再决定长期保留哪个。**

### ✅ P0-4 换掉 86 KB 的 favicon（已执行）

| | |
| --- | --- |
| 位置 | `public/favicon/favicon.ico` + `src/config/siteConfig.ts` |
| 合并风险 | **无** |
| 实际结果 | **87,889 B → 8,976 B，省 78,913 B（89.8%）** |

**排查中发现的事实**：原来那个 `favicon.ico` 根本不是 ICO，而是一张 **221×183 的 PNG 被改名为 `.ico`**（`public/favicon/favicon.ico`、`src/assets/images/icon.png`、两个 logo 文件字节完全相同，都是 87,889 B）。PNG chunk 只有 `IHDR/pHYs/IDAT/IEND`，没有多余元数据——纯粹是图本身细节多（金色渐变的噪点）。

已做的三件事：

1. **生成真正的多尺寸 ICO**（16/32/48），源用你的三叶草徽章 `src/assets/images/icon.png`
2. 徽章是 221×183 的扁椭圆形，做了**居中补透明边成正方形**（不拉伸、不裁剪），行为与浏览器之前自动居中缩放一致
3. 新增 `public/favicon/favicon-192.png`（192×192），并在 `siteConfig.favicon` 里登记

```ts
favicon: [
  { src: "/favicon/favicon.ico" },
  {
    // OpenGraph 图片与 apple-touch-icon 需要 png 格式的图标
    src: "/favicon/favicon-192.png",
    sizes: "192x192",
  },
],
```

**⚠️ 这里有个坑，值得记一下**：`public/favicon/` 里那 8 个 `favicon-light-*.png` / `favicon-dark-*.png` **是上游的占位图标**（深色圆角方块 + 蓝点，本地与上游 blob 哈希完全一致），**不是你的三叶草**。我一开始差点直接把它们指过去，那样会把你的 logo 换成上游的占位图。以后动 favicon 时注意别踩。

**为什么必须补一个真 PNG 进数组**：`src/pages/og/[...slug].ts` 第 186–191 行会找 `siteConfig.favicon` 里第一个 `.png` 条目来做 OG 图的图标；如果只有 `.ico`，它会落到 `favicon[0]`，然后在第 157–166 行发现格式不被支持、交给 sharp 兜底——而 **sharp 读不了 ICO**，会走 `warnAndFallback` 用一张透明图。也就是说 OG 卡片上的站点图标会悄悄消失。

新增的 192 PNG 用 256 色调色板 + 抖动（`mode=P`，12,670 B）而不是 RGBA（同一张图 RGBA 要 59,679 B）——源图 RGB 有大量肉眼不可见的噪点，量化后观感不变、体积降 4.7 倍。它只被 apple-touch-icon 和 OG 生成使用，不在首屏关键路径上。

原 favicon 备份在 `.workbuddy/tmp/favicon-orig-backup/`。

### P0-5 umami 会话回放：保留（按你的要求）

**结论：保留，不建议关。** 理由和它的实际代价说清楚：

`analyticsConfig.umamiAnalytics.replays.enabled: true` 会加载 `https://umami.9ll.uk/recorder.js`。实测：

- 移动端 45,440 B，其中 **40,236 B 未被使用**（`unused-javascript` 唯一点名的就是它）
- `legacy-javascript` 也只点名了它（含 `Array.from` 等旧语法，8 KB）

但关键在于：**它不是你的性能瓶颈**。

- 它已经带了 `defer`（`UmamiAnalytics.astro` 第 46 行），不阻塞渲染
- TBT 只有 **10 ms**，说明它没有造成长任务
- LCP 的 6.2 s 与它无关（LCP 卡在贴纸等待上）

所以关掉它能省 45 KB，但换不来分数提升，反而丢掉你要的数据。**保持开启是对的。**

如果以后想再优化它，有两个不损失功能的方向：

1. **加 preconnect**（省约 105 ms 的连接建立时间）：
   ```html
   <link rel="preconnect" href="https://umami.9ll.uk" crossorigin />
   ```
   位置需要在 `<head>`，也就是 `Layout.astro`（你已重度分叉的文件）——105 ms 收益配这个风险，不值，先记着。
2. **自建并把 recorder.js 放到同源**（例如 `/assets/umami/recorder.js`）：省掉一次 DNS + TLS 握手，还能被同一个 CDN 缓存和压缩。文件体积不变，但延迟代价基本归零。

另外注意：调低 `sampleRate` 并不能减少脚本下载（脚本每次都会下），只有 `enabled: false` 才能省掉。所以"降低采样率"不是省流量的手段。

### ✅ P0-6 移动端关掉水波纹和模糊渐变（你已于 20:35 自行完成）

复查时发现 `src/config/backgroundWallpaper.ts` 在 20:35:48 被改过（早于我这轮改动），内容正是：

```diff
 waves: {
   enable: {
-    desktop: true,
-    mobile: true,
+    desktop: false,
+    mobile: false,
   },
 },
```

同时把 `carousel.enable` 从 `false` 改成了 `true`（多张壁纸每 5 s 自动轮播）。这是你的偏好选择，我没动。文件 UTF-8 编码校验正常。

`fullscreen.blurRamp`（首页下滑时对整屏壁纸动画 `filter: blur()`）目前仍是桌面/移动都开。这是移动端最贵的合成操作之一，如果之后还想再榨一点，可以把 `mobile` 也设为 `false`。

---

## 五、P1：要动上游文件，但冲突可控

### P1-1 全站图片质量 85 → 78（零代码的替代方案）

| | |
| --- | --- |
| 位置 | `src/config/siteConfig.ts` 第 338 行 |
| 合并风险 | **很低**（配置项） |
| 预期收益 | 所有 Astro 处理过的图（封面、壁纸、头像）普遍再降 20–30% |

```ts
imageOptimization: {
  formats: "webp",
  quality: 78,   // 原 85
  // ...
},
```

这是**替代 P1-2 的合并安全版本**：不需要改任何组件代码，但同样能把 270 KB 的列表封面压下来一截。视觉上 85→78 几乎看不出来。

### P1-2 列表封面宽度只给了一档（更激进）

| | |
| --- | --- |
| 位置 | `src/components/common/CoverImage.astro` 第 68 行 |
| 合并风险 | **中等**。该文件你已改过 21 行（新增 `naturalHeight`、改 `height: 100% !important`、加 `astro:page-load` 重复注册守卫），本来就有冲突面；再叠一处改动虽然仍是行级冲突，但会多一个将来要手工过的点 |
| 预期收益 | 省约 150 KB |

```js
// upstream 与本地当前都是这一行：
const widths = [828];
// 改为：
const widths = [400, 640, 828];
```

现状：`widths = [828]` 只有一档（**这行是上游自己的代码，不是你写的**），所以每张列表封面无论屏幕多小都下 828w。实测 10 张封面共 270 KB，每张被 Lighthouse 判定"比显示尺寸大 40–50%"（如 `cover.DmYuCQNo` 实际 828×414 → 显示 368×207，浪费 46,858 B）。

**取舍建议**：先用 P1-1 的 `quality: 78`。还不够再动这一行。

### P1-3 壁纸加一档更小宽度

| | |
| --- | --- |
| 位置 | `src/components/layout/WallpaperSection.astro` 第 54 行、第 88 行 |
| 合并风险 | **无**（该文件 642 行全新增） |
| 预期收益 | 约 20–35 KB，且不稳定 |

实测移动端壁纸 `1.webp` 是 735×1471 / 57 KB，显示尺寸只有 463×823。现在是 `widths={[640, 828]}`，可加一档 `480`。但 `sizes="100vw"` 配合高 DPR 时浏览器仍可能选 828w，所以收益不稳定，属于锦上添花。

---

## 六、P2：可选 / 不建议动

| 项 | 说明 | 建议 |
| --- | --- | --- |
| SakuraEffect 脚本 | `sakuraConfig.enable = false` 了，但 `Layout.astro` 第 561 行无条件渲染 `<SakuraEffect />`，7.5 KB 脚本照样下载解析 | 收益小，要动重度分叉的 `Layout.astro`。**跳过**，这是上游自身的设计问题 |
| 渲染阻塞 CSS 380 ms | `Layout.DjqYd7jF.css` 30.6 KB 阻塞首屏 | 唯一的杠杆是 `inlineStylesheets: 'always'`，但会破坏跨页缓存（Swup 切页时 CSS 会重复内联），**得不偿失，不建议** |
| preconnect umami | 省约 105 ms，需动 `Layout.astro` | 见 P0-5 的说明，**暂缓** |
| Accessibility 96/95 | 三类：`color-contrast`（category-bar 的 `.pill-count`、post-meta 的 `.text-50`）、`label-content-name-mismatch`（分页按钮、分类链接）、`heading-order`（音乐播放器 h3 缺上级 h2） | 收益 4–5 分、风险中等。想做只改你自己重度改过的文件里的样式 |
| 内联脚本 94 KB | 音乐播放器配置 18.5 KB + meting 管理器 9.4 KB + 日历 12.8 KB 内联在 HTML 里 | 需改 `MusicPlayer.astro`（14/14 分叉）等，收益中等，**排最后** |
| 侧边栏头像过大 | `avatar.CjtmSIpt_9RU6S.webp` 34,322 B，`sizes="350px"`，实测显示 168×168，浪费 13,474 B；且在 `Profile.astro` 第 37 行带 `fetchpriority="high"` + eager（首屏之下却高优先级） | 值得做，属 P1。改 `Profile.astro`（你改过 10/31） |
| `src=""` 的空图片 | `unsized-images` 点名一个 `src=""` 的 ICP 备案图 | 顺手查 `src/config/footerConfig.ts` 与 `FooterConfig.html` 是否重复渲染 |

### ⚠️ 顺带发现的一个 404

`src/config/booknavConfig.ts` 第 88 行：

```ts
{
  title: "Firefly",
  url: "https://github.com/CuteLeaf/Firefly",
  desc: "清晰美观的 Astro 个人博客主题模板",
  icon: "/favicon/firefly-32.png",   // ← 这个文件你删掉了
},
```

你把上游的 `firefly-*.png` 换成自己的 `favicon.ico` 时，书签导航页里这条还在引用已删除的文件，会产生 404。而 `siteConfig.pages.booknav` 是 `true`，页面是启用的。

两种修法，取决于你想不想要那个 Firefly 图标：

- 换成图标库（与同组其他 GitHub 仓库一致）：`icon: "fa7-brands:github"`
- 保留 Firefly 品牌图标：`git checkout upstream/master -- public/favicon/firefly-32.png`（仅 918 B，且与上游一致所以不产生 diff）

我没有替你决定，因为这属于视觉取舍。

---

## 七、预期效果

已完成的 P0-1 + P0-2 + P0-4 合计回收：

| 项 | 减少 |
| --- | --- |
| 贴纸图 | 204 KiB |
| favicon | 79 KiB |
| **小计** | **约 283 KiB** |

叠加 P0-2 消除的那 2190 ms 元素渲染延迟：

- 首屏传输：1542 KiB → 约 **1260 KiB**
- 预期移动端 LCP 落到 **3–4 s** 区间，Performance **85–92**
- 桌面端维持 100

再把 P0-3（Swup 预取 487 KiB）关掉的话，首屏可降到 **约 770 KiB**，LCP 有望进 **3 s 以内**。

数字是估算，真正的判据是改完后再跑一次 Lighthouse 对比。

**注意：以上改动尚未构建部署，线上跑的还是旧版本。**

---

## 八、合并上游的安全策略（长期）

当前 `HY` 相对 `upstream/master` 是 0 落后 / 315 领先，说明你的合并流程是健康的。要维持下去：

1. **优先改"上游不存在的文件"**。下面这些是你自己的新增资产，改动零冲突：
   - `src/components/features/HomeWallpaperDecor.astro`
   - `src/components/layout/WallpaperSection.astro`
   - `src/components/features/WavesEffect.astro`
   - `src/config/homeCardConfig.ts`
   - `src/pages/moments.astro`、`src/pages/projects/*`、`src/utils/friends-feed.ts` 等
2. **其次改配置文件**（`src/config/*.ts`）。上游偶尔会动，但冲突是单行级的，一眼能解。
3. **尽量别碰这几个上游活跃文件**：
   - `src/layouts/Layout.astro`（你已删 1338 行 / 加 158 行）
   - `src/layouts/MainGridLayout.astro`（删 1117 行 / 加 76 行）
   - `src/components/layout/Navbar.astro`、`CategoryBar.astro`、`PostMeta.astro`
   - 这些本来每次合并都要手工过一遍，再叠加新改动只会更痛。
4. **纯上游未改文件**（如 `ImageWrapper.astro`、`SakuraEffect.astro`、`UmamiAnalytics.astro`）**改动前先想一下**——它们现在是"零冲突资产"，动了就把这个优势用掉了。优先找配置层的等价方案。
5. 每季度做一次 `git fetch upstream && git rev-list --left-right --count upstream/master...HEAD`，确认领先数没有异常膨胀。

### 本次用到的判定命令

判断一个文件是"你的"还是"上游的"，以及你改了多少：

```bash
# 上游有没有这个文件
git cat-file -e upstream/master:<path> && echo "上游有" || echo "上游无（你新增的）"

# 你相对上游改了多少行（新增 删除 文件）
git diff --numstat upstream/master...HEAD -- <path>

# 某一行到底是上游的还是你写的
git show upstream/master:<path> | grep -n "关键字"
```

**这次的教训**：我在第一版报告里断言 `CoverImage.astro`"你一行都没改过"，实际它有 21 处改动——因为我只查了 `cat-file`（文件是否存在），没查 `--numstat`（改了多少）。**两个都要查**。

---

## 九、执行记录（2026-09-11 20:40 前后）

| 文件 | 改动 | 状态 |
| --- | --- | --- |
| `public/images/home-stickers/*.webp`（8 个） | 331 KB → 127 KB | ✅ 已执行 |
| `public/favicon/favicon.ico` | 87,889 B → 8,976 B（真 ICO） | ✅ 已执行 |
| `public/favicon/favicon-192.png` | 新增 12,670 B | ✅ 已执行 |
| `src/components/features/HomeWallpaperDecor.astro` | +10 / -3 | ✅ 已执行 |
| `src/config/siteConfig.ts` | +5（favicon 数组加 png 条目） | ✅ 已执行 |
| `src/config/backgroundWallpaper.ts` | 你于 20:35 自行修改（关水波纹、开轮播） | ✅ 已执行 |
| `src/config/blogChangelogConfig.ts` | +39（新增 V1.4「首屏提速」日志条目） | ✅ 已执行 |
| `docs/pagespeed-optimization.md` | 新增（本文件） | ✅ |

校验：

- `HomeWallpaperDecor.astro` 的内联脚本经 `node --check` 语法校验通过
- 8 张贴纸均为可正常解码的 WebP，尺寸符合预期
- `backgroundWallpaper.ts` UTF-8 解码正常（PowerShell 里看到的乱码只是控制台编码问题）

回滚方式：

```bash
git checkout -- public/images/home-stickers/    # 还原贴纸原图
git checkout -- public/favicon/favicon.ico      # 还原 favicon
rm public/favicon/favicon-192.png               # 移除新增 PNG
```

备份另存于 `.workbuddy/tmp/stickers-orig-backup/` 与 `.workbuddy/tmp/favicon-orig-backup/`。

**注意：以上改动尚未构建部署，线上仍是旧版本。**
