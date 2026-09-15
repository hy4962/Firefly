# 9LL.UK PageSpeed 优化清单（合并上游友好版）

> 实测时间：2026-09-11 20:20
> 工具：Lighthouse 13.4.1 本地跑 `https://www.9ll.uk/`（与 PSI 同一套审计引擎，移动端为默认节流配置）
> 仓库状态：`HY` 分支相对 `upstream/master` 为 **0 落后 / 315 领先**，上游已全部合入
>
> **执行进度：P0-1 / P0-2 / P0-4 已完成（见第九节「执行记录」）；P0-6 由你本人于 20:35 完成；P0-5 决定保留。**
>
> **➡️ 第二轮复测（部署后）见第十节 —— 第一轮改动已全部上线生效；LCP 从 6.2 s 降到中位数 5.3 s，但移动端分数仍在中位数 64，瓶颈已从"等贴纸图"转移到"首屏 hero 由 JS 生成 + Swup 预取抢带宽"。**
>
> **➡️➡️ 第四轮（2026-09-15）见第十二节 —— 查清了 §10.11 遗留的「另一层门控」：它不存在，那 500ms 白屏是 DOM/CSS 体积决定的渲染固有成本（禁用 JS 后首次绘制反而更晚）。**
> **本轮最终只有 3 处真实行为改动（图片质量 / 贴纸 / 重播守卫），详见 §12.0；另有 3 处曾改动但已撤销，原因见 §12.4 与 §12.11。**
> **§12.11 有线上实测的 LCP 数据：确认「甲」把 LCP 提前了约 85–125ms，但证明了卡片关键帧改动收益为 0。**

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

### 10.10 第三轮实测：部署后复测（2026-09-12 00:25）

用户已 push，Vercel 构建部署完成。桌面端跑 5 次、移动端跑 3 次（均为**不带** `--disable-gpu`）。

#### 先验证改动是否真的上线了

| 验证项 | 结果 |
| --- | --- |
| `/images/*`、`/favicon/*` 缓存头 | ✅ 返回 `public, max-age=2592000, ...`（原为通配的 `max-age=0, must-revalidate`） |
| booknav 页的 `/favicon/firefly-32.png` | ✅ 页面里已无该引用（原为 404 空图标） |
| Swup 预取 | ✅ **预取页面数 16 → 1**，见下表（剩下那 1 个是 `/api/allPostMeta.json`，不是页面预取） |

> 顺带发现：swup 的初始化参数**不在 HTML 里**——因为 `loadOnIdle: true`，初始化脚本被外置成了
> JS chunk，所以 grep `preloadVisibleLinks` 是 0 次。**验证这类改动要看行为（请求数），不要找配置字符串。**

#### 桌面端（改前只有 1 次带 GPU 样本，基线较弱）

| | 改前·无GPU | 改前·带GPU | **改后 5 次中位数** |
| --- | --- | --- | --- |
| Performance | 67 | 89 | **89** |
| FCP | 2369 ms | 1170 ms | **1097 ms** |
| LCP | 2780 ms | 1547 ms | **1527 ms** |
| Speed Index | 6171 ms | 1945 ms | **2108 ms** |
| **总传输** | 2058.8 KiB | 2176.7 KiB | **1142 KiB（−47%）** |
| Fetch 桶 | 924.3 KiB | 1042.3 KiB | **8.4 KiB（−99%）** |
| 预取页面数 | 16 | 16 | **1** |
| 请求数 | 94 | 87 | **71** |

逐次：perf `[56, 72, 89, 93, 96]`，LCP `[1234, 1389, 1527, 2266, 5462]` ms。

**⚠️ 结论要说清楚：桌面端传输量减半，但分数基本没变（89 → 中位数 89）。**
原因是桌面端模拟带宽 10 Mbps、且不做 CPU 节流，那 1 MB 预取本来就不在关键路径上——
桌面端这次收获的是**省流量**（对用户流量、CDN 成本有意义），不是**提分**。

离群那次（perf 56 / LCP 5462 ms）已排查：`server-response-time` 只有 93 ms、文档 567 ms 就绪，
其余四次 TTFB 也都在 85–115 ms —— **没有任何服务端因素能解释 4.5 秒的空白**，
判定为本机同时跑多个 Chrome 实例造成的测量干扰，不是站点问题。

#### 移动端（这才是真正的受益场景）

| | 改前 4 次中位数 | **改后 3 次中位数** | 变化 |
| --- | --- | --- | --- |
| Performance | 64 | **71** | +7 |
| FCP | 3968 ms | **3006 ms** | −24% |
| LCP | 5280 ms | **4506 ms** | −15% |
| Speed Index | 9240 ms | **8366 ms** | −9% |
| 总传输 | 1405 KiB | **916 KiB** | −35% |
| Fetch 桶 | 483.4 KiB | **11.7 KiB** | −98% |
| 预取页面数 | 8 | **1** | — |

逐次：perf `[59, 71, 78]`，LCP `[3925, 4506, 6664]` ms。

**但移动端的瓶颈没有消失**：图片桶仍是 610 KiB，占新的 916 KiB 总量的 **67%**。
LCP 4.5 s 里，`elementRenderDelay` 依然是主导——也就是 §10.4 那条
"首屏 hero 由 JS 生成、壁纸要等脚本克隆才开始下载"的链子**一点没动**。
关掉预取只是把抢带宽的大户拿掉了，让壁纸下载快了一点。

**所以下一步的优先级没变，还是 #2（hero 提前可发现），其次是图片那两项（#3 封面 / #5 贴纸）。**

### 10.11 ⚠️ 重大更正：#2 的方向是错的，LCP 不是壁纸

上面 10.10 结尾那句"下一步优先 #2"——**在查清 LCP 到底是谁之前就下了结论，是错的**。
用 `--save-assets` 拿到 Chrome 的**底层 trace**（145 MB），流式解析 `largestContentfulPaint::Candidate`
事件后，真相反转了。

> 解析要点：Chrome trace 的事件载荷在 **`args.data`**，不是 `data`；`data` 永远是空的。
> trace 只列了 25 个含 `ContentfulPaint` 的事件，一次流式扫描即可，不必整体 load 145 MB。

#### 决定性证据

```
[largestContentfulPaint::Candidate]  @ 2614 ms
   type      text                       ← 文字，不是 image
   size      15194
   nodeId    50
   nodeName  SPAN class='home-wallpaper-card__motion-text'
   candidateIndex 1                     ← 全程只有这一个候选
```

后续所有 `NavStartToLargestContentfulPaint::Candidate::AllFrames::UKM` 事件都重复
`type: text, size: 15194, durationInMilliseconds: 2613` —— **LCP 自始至终没有被图片刷新过**。

Lighthouse 自己的 `lcp-breakdown-insight` 节点也是同一个 h1 span，两个独立来源一致。

**结论：LCP 元素是首页卡片标题「折腾进行时」这段文字。壁纸图片从未参与 LCP 竞争**
（一张满屏图面积是它的 20 倍以上，如果参与，`type` 必然是 `image`）。

#### 因此以下两条要撤回

| 原判断 | 更正 |
| --- | --- |
| "壁纸藏在 `<template>` 里，所以要让它提前可发现" | 壁纸提前下载**不会改善 LCP 分数**，因为壁纸不是 LCP 元素 |
| "方案 A（LQIP 色块）/ 方案 B（首张壁纸进 HTML + preload）能打 FCP 3.97 s" | **不能**。这两个方案只改善"背景从色块变照片"的**观感**，与 FCP/LCP 指标无关 |

顺带更正 10.4.1 里那句"2.6 s 出现色块、4.3 s 真壁纸到达 → LCP"：4.3 s 是壁纸到达没错，
但它**不是** LCP。2.6 s 与 4.3 s 之间的 FCP→LCP 间隔，属于**文字**元素之间的差异，不是图片。

#### 真正的门控在哪里（代码事实）

好消息：`body.is-home` 和 `html[data-wallpaper-mode="fullscreen"]` **都是服务端渲染的**
（线上实测 `<body class="min-h-screen is-home dynamic-navbar" ...>`），
所以 `.home-wallpaper-decor` 的显隐 CSS 在解析期就满足，**容器本身不挡首帧**。

挡的是**卡片子元素的入场动画**。`HomeWallpaperDecor.astro` 第 685–710 行：

```css
.home-wallpaper-decor.is-ready .home-wallpaper-card      { animation: home-wallpaper-card-enter 0.76s ... both; animation-delay: 80ms; }
.home-wallpaper-decor.is-ready .home-wallpaper-card h1   { animation: home-wallpaper-content-enter 0.52s ... both; animation-delay: 0.36s; }
```

关键在 **`animation-fill-mode: both`**：它表示"动画开始前套用 0% 关键帧"。
而 `home-wallpaper-content-enter` 的 0% 是 `opacity: 0` —— 所以 **h1 在整个 0.36 s 延迟期间都是透明的**，
而 Chrome 不把 `opacity: 0` 的元素算作内容绘制。

再往前推一层，`.is-ready` 是 `revealDecor()` 在 `Promise.all(.home-wallpaper-card img)` 完成后
加 2 次 rAF 才加上的（第 348–370 行）——也就是**还要先等头像和头像贴纸这两张小图**。

所以 LCP 时刻 ≈ `头像图加载完 → is-ready → +0.36 s 动画延迟 → 淡入起点`。

#### 针对性的改法（全部落在同一个文件，零合并风险）

| # | 改动 | 位置 | 风险 | 确定性 |
| --- | --- | --- | --- | --- |
| 甲 | 给 h1 用一版**起点 `opacity: 1`** 的入场关键帧（只做位移，不做淡入） | `HomeWallpaperDecor.astro` 第 607–626、702–704 行 | **无** | **确定**消除"透明等待"这一层 |
| 乙 | `revealDecor()` 不再等卡片图片，直接 rAF 后加 `is-ready` | 同上 第 348–371 行 | **无** | 确定省掉"等两张小图"那一段；代价是动画可能先于头像播完（头像有 LQIP 占位兜着） |
| 丙 | 缩短 h1 的 `animation-delay`（0.36 s → 0.12 s） | 同上 第 702–704 行 | **无** | 效果温和，但会改变入场节奏 |

**甲和乙可以一起做**，都在 `HomeWallpaperDecor.astro`——该文件 1344 行**全部是你新增的，
上游不存在**（`git cat-file -e upstream/master:...` = false），改它**零冲突**。

**但要诚实**：M4 那次跑里，三个渲染阻塞 CSS 在 **612 ms** 就全部就绪，FCP 却仍到 2655 ms——
中间这一大段目前还解释不了（另一层门控尚未定位，可能是字体、也可能是主题运行时脚本）。
所以**做完甲/乙后必须重测**，不要假定一次到位。

#### 10.12 甲 + 乙实施记录（2026-09-13）

甲和乙**不是对立的备选**，而是链条上两个独立环节，可同时做（这一点最初表述有误，用户指出后更正）。

```
等图片加载 → .is-ready（乙）→ +0.36s 延迟 → 标题淡入（甲）→ Chrome 认定 LCP
                ↑                    ↑
             乙管这段              甲管这段
```

**甲（标题关键帧）**

新增专属关键帧，起点不透明：

```css
@keyframes home-wallpaper-title-enter {
    0% { opacity: 1; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
}
.home-wallpaper-decor.is-ready .home-wallpaper-card h1 {
    animation-name: home-wallpaper-title-enter;
    animation-delay: 0.08s;   /* 原 0.36s，且原来借用 content-enter（0% 为 opacity: 0） */
}
```

视觉上仍是"从下往上滑入"，但因不透明，LCP 在动画起始帧即可成立。
**卡片框本体（`home-wallpaper-card-enter`，delay 80ms）有意保持原样**，避免入场节奏改散。

**乙（文字与图片解耦）**

`revealDecor()` 不再 `Promise.all(images...)` 门控 `is-ready`，改为 2×rAF 立刻添加；
图片另走 `is-media-ready` 通道，只控制自己 0.24s 的淡入，兜底从 400ms 放宽到 **1200ms**
（已不门控 LCP，可以多等）。

**安全垫（防脚本失效）**：图片隐藏规则写成 `.is-ready:not(.is-media-ready)`，
即"只有 JS 接管、入场已启动时才隐藏"；无 JS 或 `prefers-reduced-motion` 时图片直接可见。

**备份**：`.workbuddy/tmp/backup-home-wallpaper-decor-before-A.txt`（甲改动前片段）、
`.workbuddy/tmp/backup-HomeWallpaperDecor-before-B.astro`（乙之前整文件）。

**状态：已实施，尚未重测。** 下次跑 Lighthouse 时重点确认
（1）LCP 是否下降、（2）612ms → 2655ms 那 2 秒空白是否仍在。

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

---

## 十二、第四轮（2026-09-15）：定位并解决 §10.11 遗留的「另一层门控」

> 工具：CDP 驱动本机 Chromium（不用 Lighthouse）。**注意：本轮所有绝对毫秒数都在一台走透明代理的机器上测得，
> 到境外站有约 630ms 固定开销，所以只采信「本地零网络」的相对数据和机制性结论，不采信绝对耗时。**

### 12.0 本轮改动清单

| # | 文件 | 改动 | 合并风险 |
| --- | --- | --- | --- |
| 1 | `src/config/siteConfig.ts` | `imageOptimization.quality: 85 → 78`（§10.7 #3） | **很低**（配置项） |
| 2 | `public/images/home-stickers/*.webp` ×8 | 192→144 宽重编码（§10.7 #5） | **无**（`public/` 静态资产） |
| 3 | `src/components/features/HomeWallpaperDecor.astro` | `wallpaperModeChange` 监听器加 `lastMode` 守卫（B-2） | **无**（该文件 100% 新增，上游不存在） |
| 4 | `public/_headers` | 新增。Cloudflare 静态资源响应头（Vercel 上惰性） | **无**（上游没有这个文件） |
| 5 | `src/constants/lqips.json` | 构建自动重生成 | — |
| ~~6~~ | ~~`HomeWallpaperDecor.astro` 卡片关键帧（B-1）~~ | ~~0% 改 opacity:1~~ | **实测 LCP 收益为 0，已撤销**，见 12.11 |
| ~~7~~ | ~~`backgroundWallpaper.ts` `carousel.enable`~~ | ~~改为 false~~ | **已完全还原，diff = 0**，见 12.4 |
| ~~8~~ | ~~`analyticsConfig.ts` `replays.enabled`~~ | ~~改为 false~~ | **已完全还原，diff = 0**，见 12.4 |

**本轮最终只有 3 处真实行为改动**（1–3），其中 2 处零合并冲突。
`backgroundWallpaper.ts` / `analyticsConfig.ts` 已 `git checkout --` 还原，**与 HEAD 完全一致**。

七次 `npm run build`（含全部 6 个后处理步骤）全部通过。

### 12.1 §10.11 的「另一层门控」不存在——是渲染固有成本

**方法学先说清楚**：`Page.captureScreenshot` **自带约 700ms 捕获延迟**，
用它逐帧抓图得到的「某时刻屏幕内容」全是错的（第一张截图实际已是 1 秒后的状态）。
必须改用 `Page.startScreencast`——它的帧自带合成时刻，才是可信的。

**对照实验**（本地生产构建，零网络延迟）：

| 实验 | domInteractive | DCL | 首次绘制 |
| --- | --- | --- | --- |
| 正常 | 94 ms | 674 ms | **520 ms** |
| **`Emulation.setScriptExecutionDisabled`** | 21 ms | 21 ms | **652 ms** |

**禁用 JS 后首次绘制反而更晚**，而且截图显示页面**完整渲染**：导航栏、卡片、「折腾进行时」标题、
头像、8 张贴纸全都在，只差 `<template>` 里的壁纸照片。

**结论：**

1. 首屏内容 100% 是服务端渲染的 HTML + CSS，**JS 对首次绘制零贡献**。
2. 本地零网络下 520–650ms 的空白，是**纯样式计算 + 布局 + 绘制**成本，来源是
   443KB HTML / 2300 个 DOM 节点 / 252KB 解码后 CSS / 10 个样式表 / 223 个内联 SVG。
3. 这解释了移动端节流那次 FCP 2260ms：**4× CPU 降速把这段计算成本放大约 4 倍**，与网络无关。
4. **因此继续调入场动画门控（甲 / 乙 / 卡片关键帧）不可能改善 FCP**——FCP 根本不等 JS。
   要打它只有减小 DOM 和 CSS 体积，属于主题级改动。

> 这一条推翻了 §10.7 #2 的优先级判断。§10.11 已经撤回了「让 hero 提前可发现能打 FCP」，
> 本轮进一步说明：**任何**围绕 hero / 入场动画的改动都打不到 FCP。

### 12.2 「甲」被父级抵消了（opacity 沿 DOM 树逐层相乘）

**CSS 的 `opacity` 是逐层相乘的。** 子元素自己 `opacity: 1`，父级 `opacity: 0` → 有效值为 0。

`HomeWallpaperDecor.astro` 第 598–603 行把装饰层在首页 fullscreen 模式下**强制设为可见**：

```css
html[data-wallpaper-mode="fullscreen"] body.is-home .home-wallpaper-decor {
    opacity: 1; visibility: visible;      /* ← 与 is-ready 无关 */
}
```

也就是说卡片从一开始就是可见的，`is-ready` 唯一的作用是**触发子元素的入场动画**。而：

```css
home-wallpaper-card-enter   0% { opacity: 0 }   /* 父级卡片仍从透明开始，delay 80ms，fill-mode both */
home-wallpaper-title-enter  0% { opacity: 1 }   /* 甲 只改了 h1 自己 */
```

**有效不透明度 = 卡片(0) × 标题(1) = 0** —— 甲被父级吃掉了。

**铁证**：线上实测 `is-ready` 落地在 **2531ms**，卡片在 **2611ms** 开始淡入（= is-ready + 80ms 延迟）。
而 §10.11 那份 M4 trace 记录的 LCP 时刻是 **2614ms**。**差 3ms——LCP 记录的就是卡片离开 `opacity: 0` 的那一刻。**

**修复**：把 `home-wallpaper-card-enter` 的 0% 改成 `opacity: 1`，只保留位移 + 缩放的入场观感。

验证（同一本地生产构建）：

| 时刻 | 改前 | 改后 |
| --- | --- | --- |
| t=165ms（`is-ready`） | `card(op=0)` ← 被推回透明 | `card(op=1)` 保持可见 |
| t=982ms | `card(op=0.03)` 开始淡入 | `card(op=1)` |
| t=1120ms | `card(op=0.72)` | `card(op=1)` |

#### ⚠️ 收益要说小一点：是 80ms，不是 760ms

我最初以为这能省 0.76 秒，**是错的**。`animation-fill-mode: both` 只在 **80ms 延迟期内**
把卡片压到 `opacity: 0`；动画一启动 opacity 就 > 0，浏览器即算作已绘制。

所以本次真正回收的是**最后那 80ms 的 LCP 门控**。大头（`is-ready + 360ms` → `+80ms`，约 280ms）
是 §10.12 的「甲」已经拿走的。附带收益是消除了「卡片先可见 → 加类后变透明 → 再淡入」的视觉回归。

> ⚠️ **后续补测修正**：§12.10 用 Chrome trace 实测后发现，这 80ms 是**条件性**的——
> 只在「绘制工作已于 `is-ready + 80ms` 前就绪」时才咬到 LCP。线上移动端符合（实测 83ms），
> **本地零网络不符合（LCP ≡ FCP，测不出）**。请以 §12.10 为准。

### 12.3 首次加载会重播一次入场动画（已修）

**现象**：本地实测 `is-ready` 在 758ms 被移除、769ms 又加回，导致
`avatar-wrap / identity / subtitle / nav`（仍用 `home-wallpaper-content-enter`，0% 是 `opacity:0`）
先消失再淡入一次。

**根因不在 `body.is-home`，而在 `wallpaperModeChange` 事件**：

```
src/utils/setting-utils.ts:395
  applyWallpaperMode()  →  window.dispatchEvent(new CustomEvent("wallpaperModeChange", ...))   ← 无条件派发

src/components/features/HomeWallpaperDecor.astro:395
  监听器: 只要 mode 是 banner/fullscreen 且 body.is-home 就 revealDecor(decor, true)
```

运行时初始化时会用**当前模式**调用一次 `applyWallpaperMode()`，那次派发只是「确立模式」，
不是「模式变了」——但监听器分辨不出来。

（顺带澄清：`device-desktop` 这个 body class 在 874ms 同时出现，只是**现象不是原因**；
加守卫后它照样出现，但重播消失了。）

**修复**：监听器加 `lastMode` 守卫，初始化时从
`document.documentElement.getAttribute("data-wallpaper-mode")` 取值，
`mode === lastMode` 或属性缺失时视为初始化，直接 return。

验证：改前 t=758ms `is-ready` 被移除再加回；改后 t=758ms 保持不变、动画不中断。

**⚠️ 证据强度标注**：这个重播在**本地稳定复现**，但**线上 4 秒采样窗口内没抓到**
（线上 body 里也没出现 `device-desktop`，怀疑那个脚本走 `requestIdleCallback` 之类的延后路径）。
所以准确说法是「已确认机制的潜在缺陷」，不是「已确认的线上故障」。

### 12.4 两项曾与既有决定冲突的改动——**已完全还原**

这两项在第四轮一度被改动，但**与本文档既有决定冲突**，**已于 2026-09-15 18:15 回退**。

回退时曾保留说明性注释；2026-09-15 18:20 进一步把这两个文件**完全还原到 HEAD**
（`git checkout --`），因为值本来就没变、注释只是徒增 diff 面，
而同样的信息本文档 §12.4 已经记全了。**这两个文件现在的 diff 为 0。**

| 项 | 第四轮曾改为 | 现状态 | 文档既有结论 |
| --- | --- | --- | --- |
| `backgroundWallpaper.ts` `carousel.enable` | `false` | **`true`，diff = 0** | §10.5「是你的视觉偏好，**不强行建议关**」 |
| `analyticsConfig.ts` `replays.enabled` | `false` | **`true`，diff = 0** | §P0-5「**保留，不建议关**」——59KB 换不到分数，不该丢数据 |

**回退理由**：这两项都不解决 §12.1 查明的 FCP 瓶颈（DOM/CSS 体积），
牺牲观感和数据换不到分数。

**改动代价已实测记录，供将来重新评估：**

| 项 | 代价 |
| --- | --- |
| 轮播开启 | 约 15 秒内把所有壁纸下载完：线上实测 **22 张图 / 766KB**；关闭后只加载随机命中的 1 张 / **145KB** |
| 会话回放开启 | 额外 59KB `recorder.js` + 一次独立域名的 DNS/TCP/TLS + DOM 变更监听（但 `defer`，不阻塞渲染） |

**如果将来想重新评估轮播**：`quality: 78` 已经让壁纸体积比 §10.5 测量时又降了 11–26%（见 §12.9），
所以轮播现在的代价比当时低了一截。

### 12.5 已完成的 §10.7 待办

| 项 | 状态 | 结果 |
| --- | --- | --- |
| #3 封面 `quality: 85 → 78` | ✅ 已做 | 所有经 Astro 处理的图（封面/壁纸/头像）普遍再降 20–30% |
| #5 贴纸 192 → 144 | ✅ 已做 | 129,874 B → **85,368 B**（−43 KB / −34.3%）。**从 360×480 原始备份重新生成，避免二次压缩损失**，逐个校验解码与尺寸通过 |

贴纸备份：`.workbuddy/tmp/stickers-192-backup/`（192 版）、`.workbuddy/tmp/stickers-orig-backup/`（360×480 原图）。

### 12.6 仍未验证 —— 下一步只有一件事

**§10.12 的「甲 + 乙」至今没有重测过。**

> ✅ **部分已解决**：LCP 现在可以自己测了——用 `Tracing.start` 抓
> `largestContentfulPaint::Candidate`，不需要 Lighthouse（见 §12.10）。
> 但**线上**的完整复测仍建议你跑一次 Lighthouse，因为本地环境复现不出移动端节流下的那条时序。

**跑 Lighthouse 时重点看两个数**
1. LCP 有没有从 4506ms 中位数下降；
2. §10.11 提到的「612ms → 2655ms 那 2 秒空白」是否仍在（按 12.1 的结论，**它应该仍在**，
   因为那是 DOM/CSS 体积决定的，甲/乙 打不到）。

**方法学要求**（沿用 §10.8）：移动端取 3 次中位数、固定 GPU 参数、同一时间窗内对比。

### 12.7 建议提给上游的 issue 草稿

本轮的 12.1 结论是主题级问题，不该继续自己改模板。可直接用以下内容开 issue：

> **标题**：首页首屏渲染成本偏高：443KB HTML / 2300 DOM 节点 / 252KB CSS 导致 FCP 无法通过 JS 优化改善
>
> **环境**：Firefly v6.16.8，`wallpaper.mode: fullscreen`，纯静态部署
>
> **现象**：本地零网络下首屏空白 520ms（`domInteractive` 仅 94ms）。用
> `Emulation.setScriptExecutionDisabled` 禁用脚本后，首次绘制为 652ms，**反而更晚**，
> 且页面完整渲染（导航栏 / 卡片 / 标题 / 贴纸齐全，只差 `<template>` 里的壁纸）。
>
> **结论**：首屏内容 100% 是 SSR 的 HTML + CSS，JS 对首次绘制零贡献；
> 那 500ms 是样式计算 + 布局 + 绘制的固有成本。移动端 4× CPU 节流下放大约 4 倍。
>
> **可量化的构成**（首页 `dist/index.html`）：
> - HTML 443KB（gzip 82KB），其中纯文本仅 4.5KB
> - `class` 属性 1600 个共 102KB（占 24%）
> - 内联 SVG 224 个共 85KB（astro-icon 内联，77 个 `<symbol>` + 213 个 `<use>`）
> - 内联 `<script>` 48 个共 94KB
> - CSS 单文件 `Layout.*.css` 207KB（gzip 30KB）
> - DOM 节点 2300
>
> **可能的改进方向**（供参考，未验证）：图标改为 sprite 外链而非内联；
> Tailwind 输出减少多行 class 的空白；内联脚本外置并合并；CSS 按页拆分。

### 12.8 本轮的方法学教训

1. **`Page.captureScreenshot` 有 ~700ms 捕获延迟**，不能用于逐帧时序分析。用 `Page.startScreencast`。
2. **`Emulation.setScriptExecutionDisabled` 是区分「JS 门控」和「渲染成本」的决定性手段**，
   应该在做任何「优化 JS 加载顺序」之前先跑这个对照。
3. **CSS `opacity` 沿 DOM 树逐层相乘**。查「元素何时可见」必须沿祖先链逐层看，
   只看目标元素本身会得出错误结论——本轮就是这么错了一轮。
4. **`animation-fill-mode: both` + `delay` 只门控延迟那一段**，不是整个动画时长。
   把 0.76s 当成收益会被夸大一个数量级。
5. **对照实验要真的看图，不要只看字节数**。「禁用 JS 但页面完整渲染」这个事实，
   只有把截图读出来才知道。
6. **不要凭沙箱的绝对耗时下托管结论**。本轮一开始据「境外站比国内站慢 5 倍」判断要换 CDN，
   但用户自测 Vercel 的 `server-response-time` 只有 93ms——沙箱的透明代理把这个对比彻底污染了。
   **下任何托管结论前，必须拿用户本机的数据交叉验证。**

### 12.9 两项改动的实测 A/B（补充）

#### A. `imageOptimization.quality: 85 → 78`

同一份代码、同一个 `npm run build` 流水线，只切 `quality` 值，各构建一次对比。

**① 首页 HTML 引用的 33 张 `/_astro/*.webp` 总和**（确定性指标，可复现）：

| | 体积 |
| --- | --- |
| `quality: 85` | 1,515,200 B（**1479.7 KB**） |
| `quality: 78` | 1,221,112 B（**1192.5 KB**） |
| **差** | **−294,088 B（−287.2 KB / −19.4%）** |

单张对照（同源图，1920w 档）：

| 图 | q85 | q78 | 省 |
| --- | --- | --- | --- |
| `three`（桌面壁纸） | 174,860 B | 133,762 B | −23.5% |
| `9`（桌面壁纸） | 148,090 B | 108,946 B | −26.4% |
| `3`（移动壁纸） | 90,868 B | 80,390 B | −11.5% |
| `cover.Doo_nJpf`（列表封面） | 76,126 B | 58,168 B | −23.6% |
| `cover.DmYuCQNo` | 60,246 B | 48,078 B | −20.2% |
| `cover.CCkS12N6` | 46,634 B | 38,732 B | −16.9% |

**② 首页单次实际加载的图片**（CDP 实测，本地、轮播已关，差异只来自 quality）：

| | 图片请求数 | 图片传输 |
| --- | --- | --- |
| `quality: 85` | 19 | 396 KB |
| `quality: 78` | 18 | 328–352 KB |
| **差** | — | **约 −44 ~ −68 KB（−11% ~ −17%）** |

**为什么两个数字差这么多**：① 是「被引用的全部 33 张」（含 1920w 大档和 `<template>` 里的候选图），
② 是浏览器真正下载的子集。**首页只加载其中一部分，所以首页单次省的是 ② 那个量级；
但 quality 对每一页、每一张图都生效**——文章页、归档页、画廊页的图片越多，省的越接近 ①。

**代价**：WebP 有损质量 85→78。你文档 §10.7 的判断是「视觉上几乎看不出来」，本轮未做像素级比对验证，
**建议部署前肉眼对比一下壁纸和列表封面**（这是全站质量最高的两张图，最容易看出差异）。

#### B. `HomeWallpaperDecor.astro` 的两处改动

**(B-1) 卡片入场关键帧 `home-wallpaper-card-enter` 的 0%：`opacity: 0` → `opacity: 1`**

改动只有一行（外加注释），保留原有的位移 + 缩放：

```diff
  @keyframes home-wallpaper-card-enter {
      0% {
-         opacity: 0;
+         opacity: 1;
          transform: translate(-50%, calc(-50% + 22px)) scale(0.965);
      }
```

收益：`is-ready` 落地时，卡片不再被推回透明，标题（LCP 元素）立即可用。

| 时刻 | 改前 | 改后 |
| --- | --- | --- |
| t=93ms | `card(op=1)` | `card(op=1)` |
| **t=165ms（`is-ready`）** | **`card(op=0)`** ← 被推回透明 | **`card(op=1)`** 保持可见 |
| t=982ms | `card(op=0.03)` 开始淡入 | `card(op=1)` |
| t=1120ms | `card(op=0.72)` | `card(op=1)` |

**量化收益 ≈ 80ms**（不是 0.76s，理由见 12.2）。附带消除「卡片先可见 → 加类后变透明 → 再淡入」
这个潜在闪动（是否肉眼可见取决于浏览器在 `is-ready` 之前是否已经绘制过）。

**(B-2) `wallpaperModeChange` 监听器加 `lastMode` 守卫**

```diff
+ let lastMode = document.documentElement.getAttribute("data-wallpaper-mode");
  window.addEventListener("wallpaperModeChange", (event) => {
      const mode = event.detail?.mode;
+     if (!mode) return;
+     const isInit = lastMode === null || mode === lastMode;
+     lastMode = mode;
+     if (isInit) return;
      if ((mode === "banner" || mode === "fullscreen") && document.body.classList.contains("is-home")) {
          const decor = getDecor();
          if (decor) revealDecor(decor, true);
      }
  });
```

收益：消除首屏一次多余的全量入场动画重播。

| 时刻 | 改前 | 改后 |
| --- | --- | --- |
| t=191ms | `ready=true`，动画开始 | `ready=true`，动画开始 |
| **t=758ms**（`device-desktop` 落地） | **`ready=false`** ← 被移除 | **`ready=true`** 保持不变 |
| t=769ms | `ready=true` ← 加回，**动画全部重播** | 动画不中断 |

**受影响的元素**：`avatar-wrap`（delay 0.21s）、`identity`（0.3s）、`subtitle`（0.43s）、`nav`（0.5s）
——它们用的是 `home-wallpaper-content-enter`，0% 仍是 `opacity: 0`，所以重播时**会真的消失再淡入一次**。
（卡片和 h1 已由 B-1 / 甲 保护，不受影响。）

**证据强度**：本地稳定复现；**线上 4 秒采样窗口内未抓到**（线上 body 也没出现 `device-desktop`，
怀疑该脚本走 `requestIdleCallback` 之类延后路径）。属「已确认机制的潜在缺陷」，
修复是保守的（只屏蔽首次派发，真实切换不受影响），故建议保留。

#### 两项对 FCP / LCP 的合计影响：**诚实说，接近零**

按 12.1 的结论，FCP 由 DOM/CSS 体积决定，与这两处无关。LCP 的量化收益是 B-1 的那 ~80ms。
**这两处的真正价值是消除可见的动画缺陷（B-2 的闪动、B-1 的潜在闪动），不是提分。**
不要把它们当成 LCP 的主要手段——主要手段在 12.7 那份上游 issue 里。

> ⚠️ **上句「LCP 收益 ~80ms」已在 §12.10 用实测修正为「条件性、本地测不出」。请以 §12.10 为准。**

### 12.10 补测：LCP 实测（用 Chrome trace，不依赖 Lighthouse）

§12.6 说「Lighthouse 才能测 LCP，本轮无法代劳」——**这一条已作废**。
用 `Tracing.start` 抓 `largestContentfulPaint::Candidate` 事件可以自己测，
方法和 §10.11 一致（**注意事件载荷在 `args.data`，不是 `data`**）。

**本地生产构建、零网络、连跑 4 次：**

| run | FCP | LCP | LCP − FCP | LCP 元素 |
| --- | --- | --- | --- | --- |
| 1 | 720 ms | 720 ms | 0 | `SPAN.home-wallpaper-card__motion-text` |
| 2 | 548 ms | 546 ms | −2 | 同上 |
| 3 | 696 ms | 696 ms | 0 | 同上 |
| 4 | 532 ms | 529 ms | −3 | 同上 |

**三条结论：**

1. **LCP 元素始终是首页卡片标题**，与 §10.11 的 trace 结论完全一致（4 次复现）。
2. **本地 LCP ≡ FCP，两者是同一时刻**——标题的首次绘制同时就是首次内容绘制和最大内容绘制。
3. **本地 FCP 波动带是 532–720 ms（±94 ms），比 B-1 想测的 80 ms 还宽**，
   所以**本地单次 A/B 无法分辨 B-1 的效果**。

#### 因此修正 B-1 的收益表述

| 环境 | is-ready | FCP | LCP | 卡片 opacity 门控是否咬到 LCP |
| --- | --- | --- | --- | --- |
| **本地**（零网络） | ~165–191 ms | 532–720 ms | ≡ FCP | **否**——标题在 is-ready 之后还要等 350–530 ms 才绘制，80 ms 的门控窗口早就过去了 |
| **线上 Lighthouse 移动端**（§10.11 的 M4 trace） | 2531 ms | 2536 ms | 2614 ms | **是**——FCP 距 is-ready 仅 5 ms，而 LCP 晚了 83 ms，正好对上卡片的 80 ms 延迟 |

**修正后的表述**：B-1 的 LCP 收益是**条件性的**——
只有当「绘制工作已在 `is-ready + 80ms` 之前就绪」时，那 80 ms 的门控才会咬到 LCP。
线上移动端节流环境符合这个条件（实测 LCP − FCP = 83 ms ≈ 80 ms 延迟），
**本地零网络环境不符合，测不出差异**。

所以 B-1 **仍然值得保留**（线上有证据支持 ~80 ms，且它顺带消除了一个视觉回归），
但**不要把它当成确定的 80 ms 收益**——它取决于环境，可能为 0。

#### 本轮新增的可复用工具

| 脚本 | 用途 |
| --- | --- |
| `Page.startScreencast` | 带真实合成时刻的逐帧截图（**`Page.captureScreenshot` 有 ~700ms 延迟，不可用于时序**） |
| `Emulation.setScriptExecutionDisabled` | 区分「JS 门控」与「渲染成本」的决定性对照 |
| `Tracing.start` + 过滤 `largestContentfulPaint::Candidate` | 自己测 LCP，无需 Lighthouse |

### 12.11 线上实测 LCP：确认「甲」有效，但 B-1 收益为 0（B-1 已撤销）

用 §12.10 的方法直接跑**线上**（当前线上版本 = 含甲+乙、不含本轮改动），
同时采样 `is-ready` / 卡片首次不透明的时刻。

**线上桌面（未节流）× 4：**

| run | TTFB | FCP | LCP | is-ready | 卡片首次不透明 | LCP − FCP | LCP − is-ready |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 652 | 2640 | 2636 | 2637 | 2198 | −4 | **−1** |
| 2 | 638 | 1792 | 1792 | 1795 | 1298 | 0 | **−3** |
| 3 | 1505 | 3092 | 3090 | 3090 | 2647 | −2 | **0** |
| 4 | 669 | 1600 | 1597 | 1597 | 1155 | −3 | **0** |

**线上移动端节流（4× CPU + 1.6 Mbps）× 2：**

| run | FCP | LCP | is-ready | LCP − FCP | LCP − is-ready |
| --- | --- | --- | --- | --- | --- |
| 1 | 2112 | 2545 | 2589 | **+433** | **−44** |
| 2 | 2268 | 2696 | 2728 | **+428** | **−32** |

**三条结论：**

1. **LCP 元素 6/6 次都是首页卡片标题**，与 §10.11 一致。
2. **6/6 次 LCP 都发生在 `is-ready` 之前**（−44 ~ 0 ms）。
   而那 80 ms 的卡片门控窗口在 `is-ready` **之后**——**所以 B-1 对 LCP 的收益是 0。**
   更早的「≈80ms」估计是基于 §10.11 那份 **甲之前**的 M4 trace 推算的，不成立。
3. **卡片在 `is-ready` 之前约 440 ms 就已经在 DOM 里且不透明**，
   但首次内容绘制仍然要等到 `is-ready`——这个「为什么」仍未解开
   （可能是主线程被 36 个 module 占住，也可能是字体）。

#### ⭐ 顺带验证了「甲」确实有效

对比 §10.11 那份 **甲之前**的 M4 trace 与本次 **甲之后**的线上实测：

| | LCP 相对 is-ready |
| --- | --- |
| 甲之前（M4 trace） | **+83 ms** |
| 甲之后（本次 6 次） | **−44 ~ 0 ms** |

**「甲」把 LCP 提前了约 85–125 ms。** 这是对 §10.12 工作的实测确认。

#### B-1 已撤销

B-1（卡片关键帧 0% 改 `opacity: 1`）经实测**对 LCP 收益为 0**，而它会**改变入场观感**
（卡片从「淡入 + 位移」变成「仅位移、全不透明出现」）。既然无收益又改动视觉，**已于 2026-09-15 18:25 撤销**，
`HomeWallpaperDecor.astro` 现在只保留 B-2（重播守卫）一处改动。

**B-2 保留的理由**：它修的是一个真实的逻辑缺陷——`applyWallpaperMode()` 无条件派发
`wallpaperModeChange`，而监听器无法区分「初始化派发」和「模式真的变了」。属正确性修复，
即使当前时序下不易触发。**但需诚实标注：线上 6 次采样中未捕捉到该重播**，收益未经线上验证。

#### 本轮最终落地

| # | 改动 | 实测收益 | 合并风险 |
| --- | --- | --- | --- |
| 1 | `quality: 85 → 78` | 首页引用图 −19.4%；单次实际加载 −11%~−17% | 低 |
| 2 | 贴纸 192→144 | −34.3%（−43 KB） | **零** |
| 3 | `lastMode` 重播守卫 | 消除一次重播（本地实测有效，**线上未验证**） | **零** |
| 4 | `public/_headers` | Cloudflare 用，Vercel 上惰性 | **零** |
| — | ~~卡片关键帧~~ | ~~≈80ms~~ → **实测 0，已撤销** | — |

**一句话总结：本轮真正有实测收益的只有两项——图片体积（quality 78 + 贴纸 144）。
FCP/LCP 的瓶颈自始至终是 DOM/CSS 体积（§12.1），只有上游能修（§12.7）。**

### 12.12 未解之谜：LCP 元素「已在 DOM 且不透明」却要等 440ms 才绘制

§12.11 的线上实测里有个说不通的地方：

```
decorInDom = 1155~2647ms   ← 装饰层进入 DOM
卡片首次不透明 = 同上       ← 卡片 computed opacity 已经是 1
is-ready   = 1597~3090ms   ← 440ms 之后
FCP = LCP  = 同上          ← 首次内容绘制就发生在这一刻
```

**卡片明明已经在 DOM 里、computed opacity 也是 1，却要再等 440ms 才有第一次内容绘制。**

#### 已排除的原因（负向证据，别再重复排查）

逐一查过，**都不是**：

| 怀疑项 | 结论 |
| --- | --- |
| `opacity` 隐藏 | 排除。卡片 computed opacity 从 decorInDom 起就是 1 |
| `visibility: hidden` / `display: none` | 排除。第 598–603 行的强制可见规则已覆盖初始隐藏 |
| `content-visibility` | 排除。全仓 + 构建产物 CSS 里 0 处 |
| `contain: paint/content/strict` | 排除。0 处 |
| 透明文字（`-webkit-text-fill-color` / `color: transparent`） | 排除。0 处 |
| `.home-wallpaper-card__motion-text` 隐藏文字 | 排除。它只有 `display:inline-block` + `transform-origin` + `transition` |
| `.home-wallpaper-card h1` 基础规则 | 正常，无隐藏属性（第 895–904 行） |

#### 最可能的解释（**未确认**）

**主线程被 36 个 module 脚本占住**：浏览器已经把文字准备好，但提交不了一帧，
而 `is-ready` 恰好是这批 JS 执行完的时刻——所以首次绘制和 `is-ready` 撞在一起。

**但我没能证实它：**

- 线上做「禁用 JS」对照失败——代理噪声把信号淹了（TTFB 在 630–1505ms 之间乱跳，
  `FCP − TTFB` 在 JS 开/关两种情况下区间重叠）。
- 本地做同样对照得到**相反**的结果（禁用 JS 后 FCP 从 520ms 变成 652ms，**更晚**）。

#### 如果这个假设成立，意味着什么

FCP 会被**脚本求值时间**门控，而不只是 DOM/CSS 体积。那么除了减小 DOM/CSS，
**减少 JS 模块数量与求值时间**也是一条路（36 个 module → §12.7 的 issue 草稿里已列）。

#### 怎么证实

需要**本地跑一次 Lighthouse**，看 trace 里的主线程分解：

- `script evaluation` / `long tasks` 的结束时刻是否 ≈ FCP；
- `render-blocking` 之外有没有大段 `Parse HTML` 或 `Evaluate Script`。

**这是目前唯一还没被解释、且可能有独立收益的点。**
