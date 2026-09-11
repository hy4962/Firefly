# 9LL.UK PageSpeed 优化清单（合并上游友好版）

> 实测时间：2026-09-11 20:20
> 工具：Lighthouse 13.4.1 本地跑 `https://www.9ll.uk/`（与 PSI 同一套审计引擎，移动端为默认节流配置）
> 仓库状态：`HY` 分支相对 `upstream/master` 为 **0 落后 / 315 领先**，上游已全部合入
>
> **执行进度：P0-1 / P0-2 / P0-4 已完成（见第九节「执行记录」）；P0-6 由你本人于 20:35 完成；P0-5 决定保留。**
>
> **➡️ 第二轮复测（部署后）见第十节 —— 第一轮改动已全部上线生效；LCP 从 6.2 s 降到中位数 5.3 s，但移动端分数仍在中位数 64，瓶颈已从"等贴纸图"转移到"首屏 hero 由 JS 生成 + Swup 预取抢带宽"。**

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

### 8.0 现状量化（2026-09-12 实测，回答"改动会不会影响合并"）

`git diff --numstat upstream/master` 的全量统计：

| 指标 | 数值 |
| --- | --- |
| 与上游不同的文件 | **664 个**（文本 301 + 二进制 363） |
| 文本改动行数合计 | **37,278 行** |
| 我们删掉、上游仍存在的文件 | **18 个** |
| 上游独有提交数 | **0**（上游的提交你全都有） |

**改动量 Top 8（每次合并的手工大头）：**

```
  1207 /  984  pnpm-lock.yaml                          ← 上游几乎每次发版都动
  2151 /    0  src/pages/moments.astro                 ← 零冲突资产（上游没有）
   158 / 1338  src/layouts/Layout.astro                ← 重度分叉，核心成本
  1343 /    0  src/components/features/HomeWallpaperDecor.astro  ← 零冲突资产
    76 / 1117  src/layouts/MainGridLayout.astro        ← 重度分叉
     0 / 1003  src/content/posts/markdown-tutorial.md  ← 删掉了上游的示例文章
   743 /    0  src/content/posts/life/Internship/Internship.md
   703 /    0  src/components/features/ChangelogTimeline.astro
   109 /  497  src/utils/setting-utils.ts              ← 重度分叉
```

**⚠️ 最值得注意的一类：18 个「你删了、上游还在」的文件**

```
src/content/posts/markdown-tutorial.md   1003 行     src/content/posts/markdown-plantuml.md    250
src/content/posts/code-examples.md        472        src/content/posts/mdx-example.mdx         162
src/content/posts/markdown-mermaid.md     333        src/content/posts/guide/firefly-wiki-link.md 137
src/content/posts/markdown-extended.md    281        src/content/posts/guide/index.md          120
src/content/posts/guide/firefly-layout-system.md 250  src/content/posts/encrypted-demo.md     116
… 以及 katex-math-example.md / firefly.md / video.md / draft.md / 4 个 dynamic 条目
```

这些全是**上游的示例内容**（教程、演示文章等），你为了自己的站点清掉了它们。
上游只要更新其中任何一个，git 就会报 **modify/delete 冲突**（"他改了，你删了"）——
这是所有冲突里最烦的一类，因为每次都要手工 `git rm` 确认一次。
**建议：把"遇到这类文件就统一 `git rm`"写进你的合并 checklist**，别每次现想。

### 本次 4 处改动对合并的实际影响（很小）

| 文件 | 改动前差异 | 改动后差异 | 新增的冲突面 |
| --- | --- | --- | --- |
| `astro.config.mjs` | 17 / 3 | **13 / 2** | **负**——还原成上游写法，差异反而变小了 |
| `src/components/widget/Profile.astro` | 10 / 31 | 11 / 33 | 一处 2 行 |
| `src/config/booknavConfig.ts` | 159 / 1 | 160 / 2 | 一处 1 行 |
| `vercel.json` | 31 / 0 | 49 / 0 | 纯追加 18 行 |

- 前两处的 Profile / booknav 各只有**一处 1–2 行**改动，只有当上游**同时改动同一行**时才会冲突，
  且届时是行级冲突，一眼能解。
- `vercel.json` 是**纯新增、零删除**，而且插入点落在上游文件根本没有的区域
  （上游的 vercel.json 到 `/_astro/` 规则就结束了，后面 `/assets/`、`/pagefind|pio/`、`/api/`、我新加的
  `/images/` `/favicon/` 全是你/我追加的）——除非上游恰好在同一位置追加规则，否则不冲突。
- `docs/pagespeed-optimization.md` 上游完全没有这个文件，**零冲突**。

**结论：这 4 处不影响你长期合并。** 合并永远能跑完，区别只是要不要手工解冲突；
这 4 行最多给你增加"一次 2 行的行级冲突"的概率，而其中一处还让差异变小了。
真正决定你合并成本的是上面那 664 个文件 / 3.7 万行，不是这次这几行。

**复盘：本次所有改动都遵守了"优先落在上游不存在的文件或配置项、且尽量只动 1–2 行"的原则，
唯一例外是 `Profile.astro` 动了一处上游未改的行（2 行），属于可接受的低风险取舍。**


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

---

## 十、第二轮复测（部署后 · 2026-09-11 23:45）

> 工具：Lighthouse 13.4.1 本地跑 `https://www.9ll.uk/`（与 PSI 同一套审计引擎，移动端默认节流）
> 仓库状态：`upstream/master...HEAD` = **0 落后 / 316 领先**，上游已全部合入（健康）
>
> ⚠️ **你给的 PSI 链接本身跑失败了**：`https://pagespeed.web.dev/analysis/https-www-9ll-uk/c5i93nt0nw?form_factor=mobile`
> 报告里没有任何分数，实验室诊断报 `RPC::DEADLINE_EXCEEDED: context deadline exceeded`。
> 这本身是个信号（见 10.3），下面所有数据都是本地实测。

### 10.1 先确认：第一轮改动确实已经上线

| 资产 | 上一轮前 | 线上实测（现在） | 结论 |
| --- | --- | --- | --- |
| `/favicon/favicon.ico` | 87,889 B | **8,976 B**（magic `000001000300` = 真 ICO） | ✅ 已部署 |
| `/favicon/favicon-192.png` | 不存在 | **12,670 B**（`89504e47` = PNG） | ✅ 已部署 |
| `miku.webp` | 58,922 B | **21,406 B** | ✅ 已部署 |
| `madoka.webp` | 43,382 B | **16,546 B** | ✅ 已部署 |
| `blonde-idol.webp` | 45,144 B | **16,626 B** | ✅ 已部署 |
| `/images/home-stickers/` 合计 | 339,148 B | **129,874 B** | ✅ 与文档数字完全一致 |

`HomeWallpaperDecor.astro` 的两处改动也在（第 348 行 `.home-wallpaper-card img`、第 361 行 `setTimeout(finish, 400)`）。

**所以第一轮的账是实的：LCP 从 6.2 s 降到中位数 5.3 s。**

### 10.2 复测数据（移动端连跑 4 次）

| 轮次 | perf | FCP | LCP | SI | TBT | 总传输 | Image | Fetch | Script | 请求数 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | 68 | 3475 ms | 4599 ms | 9374 ms | 4 ms | 1405.0 KiB | 627.7 | 483.4 | 171.3 | 88 |
| M2 | 56 | 7259 ms | 8761 ms | 10375 ms | 2 ms | 1405.1 KiB | 627.6 | 483.5 | 171.4 | 81 |
| M3 | 61 | 4461 ms | 5962 ms | 9106 ms | 2 ms | 1405.1 KiB | 627.8 | 483.3 | 171.4 | 81 |
| M4 | 74 | 2655 ms | 4307 ms | 8291 ms | 12 ms | 1405.1 KiB | 627.7 | 483.3 | 171.5 | 81 |
| **中位数** | **64** | **3968 ms** | **5280 ms** | **9240 ms** | — | **1405 KiB** | **628** | **483** | **171** | — |

桌面端（同一份代码，两次，区别只在有没有 `--disable-gpu`）：

| 轮次 | perf | FCP | LCP | SI | 总传输 | Fetch |
| --- | --- | --- | --- | --- | --- | --- |
| D1 `--disable-gpu` | 67 | 2369 ms | 2780 ms | 6171 ms | 2058.8 KiB | 924.3 |
| D2 带 GPU | **89** | 1170 ms | 1547 ms | 1945 ms | 2176.7 KiB | 1042.3 |

Accessibility 96 / 95，Best Practices 100，SEO 100，TBT ≈ 0，CLS = 0 —— 这些和上一轮一致。

### 10.3 最重要的观察：**字节数是恒定的，时间全在抖**

4 次移动端跑的**总传输量每次都精确地是 1405.1 KiB**（Image 627.7 / Fetch 483.4 / Script 171.4），
但 FCP 在 **2.7 – 7.3 s** 之间摆动、分数 56 – 74。

**这说明瓶颈不是"下了多少字节"，而是"多少请求在同一条模拟 1.6 Mbps 的管道上抢"。**
88 个请求里有近一半（14 个 Fetch + 24 个 Image）对首屏毫无贡献，却把关键资源排到了后面。

这同时也是**你那份 PSI 报告直接超时（`RPC::DEADLINE_EXCEEDED`）的合理解释**——
Lighthouse 的 network-dependency-tree 显示，Swup 的预取请求一直排队到 **30 秒**才下完：

```
/ (607 ms) → page.js (768) → preload-helper.js (1485) → Swup.modern.js (12046!)
                                  → SwupPreloadPlugin.js (11867)
                                     ├─ /sponsor/  30623 ms
                                     ├─ /rss/      28599 ms
                                     ├─ /about/    24543 ms
                                     ├─ /friends/  22446 ms
                                     └─ /dynamic/  22444 ms
```

**一个页面的加载过程被拖到 30 秒还没收尾，Google 的采集端超时是可以预期的。**

### 10.4 LCP / FCP 的真实瓶颈：首屏 hero 完全由 JS 生成

**LCP 元素两次实测都是同一个**：

```
article.home-wallpaper-card > div.home-wallpaper-card__content > h1.is-motion-settled > span.home-wallpaper-card__motion-text
label: 折腾进行时
```

LCP 拆解：`timeToFirstByte` 258–284 ms，**`elementRenderDelay` 2328–3246 ms**。

`elementRenderDelay` 为什么还是这么大，链条是这样的：

```
HTML 开始解析
  → 3 个 CSS 阻塞首屏（40.4 KB，Lighthouse 估 380 ms）
  → 解析到 WallpaperSection 的内联脚本
      → initBannerCarousel() 执行
      → materialize(firstSlide, true)：把 <template> 里的 <picture> 克隆进 DOM
        ← 到这一刻浏览器才开始下载壁纸！
  → 壁纸下载完 → 才能画出第一帧  ← FCP 卡在这
  → HomeWallpaperDecor 的 revealDecor()
      → 等 .home-wallpaper-card img（头像 + 头像贴纸）加载完
      → 2 × requestAnimationFrame → 加 is-ready
  → .home-wallpaper-card  animation-delay: 80ms
  → h1                      animation-delay: 0.36s   ← 硬编码 440 ms
  → h1 入场 keyframe 起点是 opacity: 0，而 Chrome 不把 opacity:0 的元素算作 LCP
  → LCP 记录
```

**关键事实（本轮新查出来的）**：首页 HTML 里有 **9 个 `<template>`**，
壁纸的 `<picture>` 全在里面，**页面上没有任何 `<link rel="preload" as="image">`**。

```html
<!-- 线上首页 HTML 的实际结构 -->
<template>
  <div class="object-cover h-full w-full overflow-hidden relative">
    <div class="lqip-placeholder absolute inset-0 pointer-events-none"
         style="background: linear-gradient(135deg, #e5c9b7 0%, #d1ac98 50%, #bea3a7 100%)"></div>
    <picture><source srcset="/_astro/1.Bn08FcSA_1BiSrC.webp 640w, ..."></picture>
  </div>
</template>
```

也就是说：**浏览器在解析 HTML 时既看不到壁纸图，也看不到那个廉价的 LQIP 渐变占位**——
两者都要等内联脚本跑完、克隆进 DOM 才存在。首屏第一眼的 paint 被整条 JS 链串行地挡住了。

> 这解释了为什么「把 LCP 元素从等贴纸改成等头像」只换回了 1 s：
> 真正的问题不是"等哪几张图"，而是**首屏 hero 是运行时生成的，浏览器无从提前发现**。

#### 10.4.1 逐帧截图 + 网络时间线（实测证据）

不要只看数字。把 Lighthouse 的 `screenshot-thumbnails` 里的 base64 帧导出来直接看，
首屏体验是一目了然的（脚本要点：`data` 字段是 **data URL**，必须 `v.split(',',1)[1]` 再 base64 解码，
直接 `b64decode(data)` 会得到 `75ab5a8a` 这种垃圾头）：

| 时刻 | 帧大小 | 屏幕上是什么 |
| --- | --- | --- |
| 0.87 s | 1.2 KB | **全白** |
| 1.74 s | 1.2 KB | **全白** |
| 2.62 s | 15.9 KB | 首屏一次性出现：卡片 + h1「折腾进行时」+ 8 张贴纸；**背景只是纯色（LQIP/页面底色）** |
| 3.49 s | 14.7 KB | 同上，没变化 |
| 4.36 s | 29.7 KB | **真壁纸照片到达**，背景换成实拍图 |
| 5.23 s | 30.3 KB | 稳定 |

对应的网络时间（同一次跑的 M4：FCP 2655 ms / LCP 4307 ms）：

```
图片                       开始(ms)   结束(ms)    体积
8 张贴纸                   ~499       ~1014      14–21 KB 各
卡片头像 + 头像贴纸          499       861/1013   4.3 / 17.3 / 5.6 KB
3.DCPC6UnX  ← 本次随机首张壁纸  638       4310      89.0 KB   ← 3.67 秒才下完
1.Bn08FcSA  ← 轮播第 2 张     5640      12552     55.9 KB
2.DQDMqYrj  ← 轮播第 3 张     15260     22660     41.9 KB
```

**两个独立的原因，各占一半责任：**

1. **起点晚了约 340 ms**。壁纸请求直到 **638 ms** 才发出——因为它在 `<template>` 里，
   浏览器解析 HTML 阶段完全看不到这张图，必须等内联 `initBannerCarousel()` 执行、
   `materialize()` 克隆进 DOM 才开始下载。HTML 的 TTFB 只有 ~260 ms，CSS 在 538–612 ms 就绪，
   也就是说这 340 ms 纯粹是"等 JS"。
2. **下载速度只有约 24 KB/s**。89 KB ÷ 3.67 s ≈ 24 KB/s，而模拟带宽是 1.6 Mbps（≈200 KB/s）——
   **这张图只拿到了 12% 的带宽**，因为同一条管道上有 87 个请求在抢，其中 483 KB 就是 Swup 预取。

> 所以 **#1（关掉 Swup 预取）会顺带大幅缓解第 2 点**：抢带宽的大户被拿掉了，
> 壁纸能拿到接近全部带宽。第 1 点（起点晚）则要靠下面 #2 的改动解决。

**#2 的两个方案分别修哪一段：**

| 方案 | 修什么 | 代价 |
| --- | --- | --- |
| A. 把 LQIP 色块从 `<template>` 移出来直接渲染 | 白屏 2.6 s 那一段 → 变成"立刻有接近最终观感的色块" | 无。但 **CSS 渐变能否被 Chrome 算作 FCP 内容存疑**，所以主要是观感改善，分数不保证 |
| B. 首张壁纸直接写进 HTML + `<link rel="preload" as="image" fetchpriority="high">` | 起点晚 340 ms 那一段，并让它在带宽竞争里排前面 | 随机首张从"每次访问换一张"变成"每次构建换一张" |

`getLqipProps(src, basePath, isPublic)` 是纯函数（`src/utils/lqip-utils.ts`），可直接在 frontmatter 调用，
所以方案 A 技术上没有障碍。

### 10.5 与上一轮的差异：轮播把壁纸从 1 张变成 3 张

`backgroundWallpaper.ts` 在 20:35 把 `carousel.enable` 改成了 `true`，`interval: 5000`，`effect: "zoom"`。

轮播脚本的机制（`WallpaperSection.astro` 第 240–271、417–469 行）：

- `materialize()` 从 `<template>` 克隆一张进 DOM，**插入的那一刻才开始下载**
- 首张用 `fetchpriority="high"`；`materializeAhead()` 预取下一张，但已经做了 `requestIdleCallback` 延迟（第 456–464 行），这块是干净的
- `startAutoPlay()` 立刻启动，**每 5 秒克隆下一张** → 约 15 秒内 4 张壁纸全部下载完

实测代价（`image-delivery-insight` 里的实际 URL）：

| 端 | 壁纸 | 体积 | 实际像素 → 显示尺寸 |
| --- | --- | --- | --- |
| 移动 | `3.DCPC6UnX` | 90,868 B | 738×1472 → 463×823（浪费 59,016 B） |
| 移动 | `1.Bn08FcSA` | 56,992 B | 735×1471 → 463×823（浪费 36,901 B） |
| 移动 | `2.DQDMqYrj` | 42,658 B | 735×1471 → 463×823（浪费 27,620 B） |
| 桌面 | `three.CgenYltt` | 171.2 KiB | — |
| 桌面 | `9.SrdOYzl_` | 144.9 KiB | — |
| 桌面 | `7.DZkJnfUw` | 80.7 KiB | — |

移动端图片桶实测 **627.7 KiB**，其中壁纸约 190 KiB。上一轮只有随机命中 1 张。
贴纸从 331 KB 压到 130 KB 抵消了一部分，所以总量没涨太多，但**关键窗口内多出来的这 2 张壁纸是实打实的争用来源**。

> 注意：`hasMultipleImages = desktop.length > 1 || mobile.length > 1`（`banner-visibility-utils.ts:176`）
> 跟轮播开关**无关**。4 张壁纸的 `<template>` 结构在轮播关掉时也存在，只是那时只有 1 张会被克隆进 DOM。

### 10.6 桌面端：先修正我自己的一次测量误差

我第一遍用 `--disable-gpu` 跑出 **67 分**，那是**不可信的**：

这个页面合成负载很重（轮播 `effect-zoom` 持续 transform、`fullscreen.blurRamp` 的 `filter: blur()`、卡片的 `backdrop-filter` 毛玻璃），
在软件渲染下会严重失真。带 GPU 复跑是 **89 分**（FCP 1.2 s / LCP 1.5 s / SI 1.9 s）。

**所以桌面端是从 100 掉到约 89，不是 67。** 掉分主要来自轮播带来的持续重绘和 +38 KiB 传输。

**结论：以后所有对比都要固定 GPU 参数，并且移动端取 3 次中位数——单次数字没有意义。**

### 10.7 第二轮优先级清单（按性价比排序）

| # | 改动 | 位置 | 合并风险 | 预期收益 |
| --- | --- | --- | --- | --- |
| **1** | Swup 视口预取关掉（上一轮 P0-3，仍未做） | `astro.config.mjs:137` | **低**（配置文件，且这行是你自己加的第 135–138 行） | 移动端 **-483 KiB / -14 请求**；桌面端 -924~1042 KiB。这是唯一能同时改善 FCP / LCP / SI 的一项 || **2** | 让首屏 hero 可被提前发现 | `src/components/layout/WallpaperSection.astro` | **无**（642 行全新增，上游没有） | FCP 中位数 3.97 s 主要卡在这条串行链上 |
| **3** | 列表封面 `widths` 加小档，或 `quality: 85 → 78` | `CoverImage.astro:68` / `siteConfig.ts:345` | 中 / **很低** | 封面共约 320 KiB，Lighthouse 报可省 250 KiB |
| ~~4~~ | ~~壁纸轮播 `zoom → fade`~~ **← 本项撤回，见 10.9** | `backgroundWallpaper.ts:131` | — | ~~移动端 SI 一直卡在 8.3–10.4 s，zoom 的持续重绘是嫌疑之一~~ 查了 CSS：这是**错误推断** |
| **5** | 贴纸再降一档 192 → 144 | `public/images/home-stickers/*.webp` | **无** | 约 -55~60 KiB |
| **6** | 静态资产补缓存头 | `vercel.json` | **低** | 不影响 PSI 分数（都是冷启动），但重复访问收益明显 |
| **7** | 修 booknav 的 404 | `src/config/booknavConfig.ts:88` | 低 | 消一个线上 404（已实测确认） |
| **8** | 侧边栏头像改 lazy + 合理 sizes | `src/components/widget/Profile.astro:36-39` | 低 | -13.5 KiB，且不再和 LCP 抢 `fetchpriority` |

#### #1 关掉 Swup 视口预取

```js
// astro.config.mjs 第 135–138 行（现在是 —— 上游原版是 preload: true，这是你自己改的）
preload: {
  hover: true,
  visible: true,
},
// 改为
preload: {
  hover: true,
  visible: false,
},
```

**代价**：触屏没有 hover，移动端首次点某个链接会变成"手指按下才开始抓"（约 0.3–1.5 s），
同一会话再点同一页仍命中内存缓存。桌面端因 hover 覆盖了悬停→点击的时间，基本无感。

> **修正上一节的措辞**：第 196 行原来写"移动端用户点击链接会回到『现抓现切』"，不准确。
> 预加载插件共四个通道（`mouseenter` / `touchstart` / `focus` / 视口），关掉 `visible` 只去掉第四个，
> 移动端的 `touchstart` 通道仍在（手指按下即高优先级插队）。详见第十一节。

**但注意**：现在这 483 KiB 是压在**首屏**上的，抢的是 LCP 的通道。把它挪到"用户真的点了链接"之后再发生，整体体验是变好的。

#### #2 让首屏 hero 可被提前发现（本轮最有价值的改动）

两个方案，A 改动小、B 收益大：

**方案 A（推荐先做）**：把 LQIP 渐变占位层从 `<template>` 挪出来，直接渲染在 `.slide-item` 里。

```astro
<!-- WallpaperSection.astro 第 45–61 行附近 -->
{backgroundImages.mobile.map((src, index) => (
    <div class:list={["slide-item block lg:hidden", index === 0 && "active"]} data-index={index}>
        {/* LQIP 渐变层提到 template 外面：它是一个纯 CSS 渐变，解析 HTML 时就能画，
            这样浏览器不必等内联脚本执行完才有第一帧内容 */}
        <div class="lqip-placeholder absolute inset-0 pointer-events-none"
             style={`background: ${getLqipGradient(src)?.bg ?? "var(--page-bg)"}`}
             aria-hidden="true"></div>
        <template>
            <ImageWrapper ... />
        </template>
    </div>
))}
```

> 需要从 `src/constants/lqips.json` 取该图对应的渐变色（文件里已有 `public:assets/images/moe-icp.png` 这类条目）。
> `<picture>` 仍留在 template 里，所以不会让 4 张图都开始下载。

**方案 B（收益更大，但要接受一个行为变化）**：把"随机首张"从运行时改到构建时，
首张壁纸直接写进 HTML 并加预加载。

```astro
<!-- 首张不再用 Math.random() 挑，而是构建时定下来，直接渲染，不进 template -->
<link rel="preload" as="image" fetchpriority="high" href={firstWallpaperUrl} />
<ImageWrapper src={backgroundImages.mobile[0]} loading="eager" fetchpriority="high" ... />
```

**代价**：随机从「每次访问换一张」变成「每次构建/部署换一张」。
**收益**：浏览器在解析 HTML 阶段就开始下载壁纸，FCP 和 LCP 一起前移——这是目前唯一能绕开
「脚本 → 克隆 → 下载」这条串行链的办法。

#### #3 封面宽度（两条路，选一条）

```ts
// 路线 A：零代码，只改配置（合并风险很低）
// src/config/siteConfig.ts 第 345 行
quality: 85,   // → 78

// 路线 B：更激进，改组件（该文件你已改 21 行，属中等风险）
// src/components/common/CoverImage.astro 第 68 行
const widths = [828];          // → const widths = [400, 640, 828];
```

实测 10 张封面每张都被判定"比显示尺寸大 40–50%"（如 `cover.DmYuCQNo` 828×414 → 显示 368×207，浪费 46,858 B）。
**建议先走 A**，一毛钱风险都没有。

#### #5 贴纸 192 → 144

显示尺寸实测 **72×96 CSS px**（Lighthouse 同时报"压缩率还可以更高"和"比显示尺寸大"）。
192 宽 ≈ 2.67×，压到 **144×192** 刚好覆盖 2× DPR，预计省 55–60 KiB。
零合并风险（`public/` 静态资产），原图备份策略见第一节 P0-1。

#### #6 静态资产补缓存头

`vercel.json` 已经有 `/_astro/`、`/assets/`、`/pagefind|pio/`、`/api/` 四组规则，
但 `/images/` 和 `/favicon/` 会落到第 8–9 行的 catch-all：

```
Cache-Control: public, s-maxage=86400, stale-while-revalidate=604800, max-age=0, must-revalidate
                                        ↑ 这半段没问题            ↑ 这半段才是问题
```

`max-age=0, must-revalidate` = 浏览器每次访问都要重新校验，`/images/home-stickers/*.webp` 和 favicon 全部受影响。
照抄 `/assets/` 那段加两条规则即可：

```json
{
  "source": "/images/(.*)",
  "headers": [
    { "key": "Cache-Control", "value": "public, max-age=2592000, stale-while-revalidate=604800, must-revalidate" }
  ]
},
{
  "source": "/favicon/(.*)",
  "headers": [
    { "key": "Cache-Control", "value": "public, max-age=2592000, stale-while-revalidate=604800, must-revalidate" }
  ]
}
```

> 注意这批文件**不带内容哈希**，所以将来改图要用改名的办法让缓存失效。

#### #4 壁纸轮播的取舍

`carousel.enable: true` 是你的视觉偏好，**不强行建议关**。想留住轮播又想少付代价，有一个低风险选项：

```ts
// src/config/backgroundWallpaper.ts 第 127–134 行
carousel: {
  enable: true,
  interval: 5000,
  transitionEffect: "zoom",   // → "fade"
},
```

`zoom` 需要持续做 `transform` 重绘，在移动端 4× CPU 节流下对 Speed Index 不友好。
`fade` 只动 opacity，合成开销小得多。视觉上从"缓慢推镜"变成"交叉淡入"，看你取舍。

#### 不建议动（沿用上一轮结论）

| 项 | 理由 |
| --- | --- |
| `inlineStylesheets: 'always'` | 破坏 Swup 跨页 CSS 缓存，得不偿失 |
| umami `recorder.js`（45 KiB，`unused-javascript` 唯一点名） | TBT 是 0 ms，它不是瓶颈，关掉白丢你要的数据 |
| `Layout.astro` 里的 preconnect / SakuraEffect | 收益小，而该文件已删 1338 行 / 加 158 行，重度分叉，不值得再加手工合并成本 |
| `fullscreen.blurRamp` 的 mobile | 这是合成开销而非 LCP 问题；要动先固定 GPU 参数测一次再说 |

### 10.8 方法学提醒（下一轮务必遵守）

1. **移动端必须取 3 次中位数**。同一份代码连跑 4 次：perf `68 / 56 / 61 / 74`，FCP `2.7 / 7.3 / 4.5 / 2.7 s`。
   单次数字不可用于对比。而字节数 4 次完全一致（1405.1 KiB）——**抖动全部来自请求争用**。
2. **固定 `--disable-gpu` 与否**。这个页面合成负载重，桌面端会因为这一个参数差 22 分（67 vs 89）。
   建议统一**不加** `--disable-gpu`（更接近真实浏览器与 PSI）。
3. **对比要在同一时间窗内做**。线上部署状态、Vercel 边缘缓存 `age` 都会影响结果。
4. **判定文件归属要两个命令都查**（`git cat-file -e` + `git diff --numstat`），这条沿用上一轮教训。

### 10.9 第二轮执行记录（2026-09-12 00:15）

| # | 改动 | 文件 | diff | 状态 |
| --- | --- | --- | --- | --- |
| 1 | Swup 视口预取关掉 | `astro.config.mjs:135` | +1 / -4 | ✅ 已执行 |
| 7 | booknav 的 404 | `src/config/booknavConfig.ts:88` | +1 / -1 | ✅ 已执行 |
| 8 | 侧边栏头像改懒加载 | `src/components/widget/Profile.astro:36-37` | +1 / -2 | ✅ 已执行 |
| 6 | 静态资源缓存头 | `vercel.json` | +18 | ✅ 已执行 |
| ~~4~~ | ~~轮播 zoom→fade~~ | — | — | ❌ **撤回**，理由见下 |
| 2 | hero 提前可发现 | `WallpaperSection.astro` | — | 待你决定 A / B |
| 3 | 封面 quality 85→78 | `src/config/siteConfig.ts:345` | — | 未做 |
| 5 | 贴纸 192→144 | `public/images/home-stickers/` | — | 未做 |

**#1 的写法说明**：没有写 `visible: false`，而是直接还原成上游的 `preload: true`。
两者运行时完全等价（见 §11.1 的运行时验证），但这样这一行与上游**字节一致**——
`git diff upstream/master -- astro.config.mjs` 里已经完全没有 preload 相关差异。
这是本轮唯一一条能**减少**将来合并负担的改动。

**#4 撤回的理由（我上一轮的推断是错的）**：
当时写"`effect-zoom` 的持续重绘拖累 Speed Index"，属于没查证就下结论。
这次读了 `src/styles/layout-styles.css:327-334`：

```css
.effect-zoom .slide-item        { transition-property: opacity, transform; transform: scale(1.08); }
.effect-zoom .slide-item.active { transform: scale(1); }
```

**`zoom` 不是持续运行的动画**，只是一次性的 1000ms 过渡（`.slide-item` 基础规则里
`transition-duration: 1000ms`）——每 5 秒切换时播一次 1 秒的 opacity + transform。
`fade` 只是把 `transition-property` 从 `opacity, transform` 收成 `opacity`，差一个 GPU 合成的
transform，**在带宽瓶颈面前完全不可测**。

而且首张壁纸的入场过渡已经被处理好了（`WallpaperSection.astro:421-434` 先 `style.transition = 'none'`
再加 `active`，避免首帧被 1s 过渡推迟），所以也没有"首屏被 zoom 拖慢"的问题。

**结论：这项没有性能收益，纯属视觉偏好。既然没收益，就不该拿你的观感去换——故不改。**
如果你单纯更喜欢交叉淡入的观感，改 `backgroundWallpaper.ts:131` 的 `"zoom"` → `"fade"` 即可，一行。

**#8 的实现说明**：`loading="eager"` → `"lazy"`，并删掉 `fetchpriority="high"`。
后者其实更值得删——头像被显式标成高优先级，而真正的 LCP 元素（首屏壁纸）反而只有默认优先级，
两者在抢同一条管道。没动 `widths={[350]}` / `sizes="350px"`：实测图源 350×350，
在移动端 192 CSS px 容器里按 2.6× DPR 换算本就需要约 500px，**这张图其实已经偏小**，
Lighthouse 报的"浪费 13.5 KB"是它那套偏保守的超尺寸判定（见附一认知 1 的说明），压缩它只会让画面更糊。

**#6 的验证**：`vercel.json` 现在 7 条规则，JSON 合法。已线上实测确认**更具体的规则能覆盖 `/(.*)` 通配**：
`/_astro/` 返回 `max-age=31536000, immutable`、`/assets/` 返回 `max-age=2592000`，
而 `/images/` 和 `/favicon/` 目前确实拿到通配的 `max-age=0, must-revalidate`（就是问题所在）。
所以新规则部署后生效。

**#6 没加 `/gallery/`**：里面的图你会换，而文件名不带内容哈希，加了 30 天缓存后换图要等缓存过期才可见。
想加的话照抄 `/images/` 那条即可。

**尚未构建部署。** 回滚：`git checkout -- <file>`。

---

## 十一、Swup 预取机制详解（读源码确认）

> 来源：`node_modules/.../@swup/preload-plugin@3.2.11/dist/index.module.js.map`（含未压缩源码）、
> `@swup/astro@1.8.0/src/script.ts`。**不是推断，是源码事实。**

### 11.1 `preload` 选项是怎么映射的

```js
// @swup/astro/src/script.ts 第 50–54 行
if (typeof preload === 'object') {
  preload = { hover: preload.hover ?? true, visible: preload.visible ?? false };
} else {
  preload = { hover: preload, visible: false };   // ← 上游的 preload: true 走这一支
}
// 第 92 行
SwupPreloadPlugin: preload
  ? { preloadHoveredLinks: preload.hover, preloadVisibleLinks: preload.visible }
  : false
```

**结论：上游的 `preload: true` 就等于 `{ hover: true, visible: false }` —— `visible` 默认是关的。**
所以 `visible: true` 是本次 fork 自己打开的；建议关掉不是"偏离上游"，而是**回到上游默认**。
（另外第 44–47 行：`if (!cache) preload = false` —— 关掉 swup 的 cache 会连带关掉全部预取。）

#### 运行时验证（最硬的证据，可复跑）

不用只信源码，**直接调用库自己的生成器**看它产出什么参数：

```js
// 存成 .mjs 后 node 执行；路径指向 pnpm 里的 @swup/astro
const { buildInitScript } = await import(pathToFileURL(
  "…/node_modules/.pnpm/@swup+astro@1.8.0_…/node_modules/@swup/astro/dist/script.js"
).href);

for (const opts of [{ preload: true }, { preload: { hover: true, visible: true } }, {}]) {
  const out = buildInitScript(opts);
  console.log(out.match(/new SwupPreloadPlugin\((.*?)\)/)?.[1]);
}
```

实测输出（`@swup/astro@1.8.0` + `@swup/preload-plugin@3.2.11`）：

| 传入的 `preload` | 生成的插件参数 | 视口预取 |
| --- | --- | --- |
| `true`（**上游写法**） | `{"preloadHoveredLinks":true,"preloadVisibleLinks":false}` | **关** |
| （不传该选项） | `{"preloadHoveredLinks":true,"preloadVisibleLinks":false}` | **关** |
| `{ hover: true, visible: false }` | `{"preloadHoveredLinks":true,"preloadVisibleLinks":false}` | **关** |
| `{ hover: true, visible: true }`（**本站现状**） | `{"preloadHoveredLinks":true,"preloadVisibleLinks":true}` | **开** |

三层默认互相印证，`visible` 都是 `false`：

1. `@swup/astro` 映射：`else { preload = { hover: preload, visible: false } }`（`src/script.ts:53`）
2. 即使传对象且不带 `visible`：`visible: preload.visible ?? false`（同文件 `:51`）
3. 插件自身默认：`preloadVisibleLinks: { enabled: false, … }`（`preload-plugin/src/index.ts:86-87`）

**改动风险因此很低**：把 `visible` 改成 `false` 只是让配置回到"和上游完全一致"的状态，
将来合并上游时这一行甚至可能不再产生 diff。

### 11.2 四个触发通道，`visible` 只管其中一个

`@swup/preload-plugin` 的 `mount()` 里挂了四组监听：

| 通道 | 守卫条件 | 源码位置 |
| --- | --- | --- |
| `mouseenter` | `deviceSupportsHover()` 为真才执行 | `onMouseEnter` |
| `touchstart` | **`deviceSupportsHover()` 为假才执行**（触屏设备） | `onTouchStart` |
| `focus` | 无守卫，键盘 Tab 聚焦即触发 | `onFocus` |
| IntersectionObserver | `preloadVisibleLinks.enabled` 为真才挂 | `preloadVisibleLinks()` |

`deviceSupportsHover()` = `window.matchMedia("(hover: hover)").matches`。

**所以关掉 `visible` 只去掉第四个通道**，前三者全保留，其中 `touchstart` 让移动端"手指按下即高优先级预取"。
说成"移动端退回现抓现切"是不准确的。

### 11.3 视口通道的具体参数（为什么这里特别贵）

```js
preloadVisibleLinks: {
  enabled: false,        // 上游默认
  threshold: 0.2,        // 链接 20% 面积可见
  delay: 500,            // 需持续可见 500ms
  containers: ['body'],  // ← 扫整页所有链接
  ignore: () => false
}
```

观察器（`src/observer.ts`）用 `document.querySelectorAll("body a[*|href]")` 扫全页链接，
在 `whenIdle()`（`requestIdleCallback`）里执行，并且每次 `page:view` 都会 `update()` 重扫。

触发后走 `queue`（`throttle: 5`，**并发上限 5**），`performPreload()` 用 **`fetch()`** 取页面 HTML，
解析成 `PageData` 存进 `swup.cache`。导航时 `page:load` 钩子发现缓存命中就**直接返回该 Promise**，跳过真实请求。

### 11.4 为什么在本站是 483 KiB

预取的是**页面 HTML 本身**。这个主题每页 HTML 压缩后 **68–74 KB**（未压缩约 430 KB，大量内联脚本）。
首页第一屏恰好有 7 个合格链接：

```
首页卡片导航：/archive/ 72.1 KB  /friends/ 70.4  /dynamic/ 66.8  /guestbook/ 65.6  /about/ 65.5
卡片社交按钮：/rss/ 67.6 KB     /sponsor/ 67.0
                       合计 475–483 KiB ≈ 移动端总流量的 34%
```

在 1.6 Mbps 模拟带宽下相当于**凭空多出约 2.4 秒纯下载**，插在 LCP 需要的壁纸 / CSS / 头像前面抢通道。
`network-dependency-tree` 里这批请求最后一个完成于 **30.6 秒**。

**判据是单页 HTML 体积**：若单页只有 15 KB，预取 7 页才 105 KB，`visible: true` 是个合理特性，不该无脑关。

### 11.5 关掉之后会发生什么

**不会坏的部分**：hover / touchstart / focus 三条通道全保留；`preloadInitialPage: true`（缓存当前页 DOM，
浏览器返回键瞬时）不受影响；`cache: true` 不受影响 → 同一会话再点同一页仍 0 延迟。

**会变的只有一点**：

| 场景 | 现在 | 改后 |
| --- | --- | --- |
| 手机首次点某导航链接 | 已预载，0 ms | 按下才开始抓，约 0.3–1.5 s |
| 手机再点同一链接 | 0 ms | 0 ms（内存缓存） |
| 桌面悬停→点击 | ≈0 ms | ≈0 ms（mouseenter 覆盖了悬停到点击的间隔） |
| 首屏额外传输 | +483 KiB | 0 |

### 11.6 不想全关的折中写法

`preload` 里的 `visible` 可以传对象，plugin 会 `{...defaults, enabled: true, ...你的值}`：

```js
preload: {
  hover: true,
  // 提高门槛 + 延后触发：只有大面积、长时间可见的链接才预取
  visible: { threshold: 0.5, delay: 2000 },
  // 或者：只观察内容区，把 hero / 页脚里的链接排除在外
  // visible: { containers: ["#swup-container"] },
},
```

`containers: ["#swup-container"]` 的依据：首页卡片（`HomeWallpaperDecor`）挂在 `#wallpaper-wrapper` 里，
不在 swup 的容器列表中，所以这条能砍掉上面那 7 个链接。**但落地前建议先跑一遍确认哪些链接还落在容器内。**
