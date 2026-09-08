---
title: "给博客加上 Vercel 边缘缓存：顺便把那些英文术语整明白了"
published: 2026-09-08
description: "给博客页面设置分层缓存头，让 CDN 直接吐页面而不是每次都回源，再配一个部署后自动预热的工作流，顺手把 max-age、s-maxage、HIT/MISS 这些缓存术语一个个讲明白"
image: ./cover.png
tags: [Vercel, 缓存, CDN, 博客优化]
category: 部署
draft: false
---

博客一直挂在 Vercel 上，部署是省心，但有个小毛病：每次重新部署完，站点就像被人清空了记忆，第一个打开页面的人总要等上一小会。看 [mysticstars.cn](https://www.mysticstars.cn/archives/speed-vercel) 和 [upxuu.com](https://upxuu.com/posts/vercel-youxuan-cache/) 两篇文章，都是在讲怎么让 Vercel 站点在国内测速"全绿"，核心手段就是**边缘缓存**。看的时候一堆英文术语差点把我绕晕，折腾完顺手把这次的全过程记下来。

## 先把那些英文术语整明白

搞缓存绕不开一屏幕英文，先把它们按"谁在看、谁在听"分好类，后面看配置就不晕了：

| 术语 | 一句话解释 |
|---|---|
| `Cache-Control` | 响应头，告诉浏览器和 CDN"这个页面能缓存多久、要不要缓存"。本文所有配置都是在写它 |
| `max-age` | 缓存有效期，单位秒。写在 `Cache-Control` 里，**浏览器**认这个 |
| `s-maxage` | 和 `max-age` 一样是有效期，但只有**共享缓存（CDN）**认，浏览器直接忽略 |
| `immutable` | "这文件永远不会变"，浏览器连重新验证都省了，连缓存都懒得检查。只能配给带哈希文件名的资源 |
| `must-revalidate` | 缓存过期后**必须**回源问一声"有没有新版"，不许直接用旧的 |
| `stale-while-revalidate` | 缓存过期了先照旧用，同时后台悄悄去更新，下次就有新版了 |
| `ETag` | 服务器给每个版本的内容算的一个标签，重新验证时比对一下就知道变没变 |
| `X-Vercel-Cache` | Vercel 加的响应头，`HIT` 表示"这次是缓存直接吐给你的"，`MISS` 表示"这次回源现取的" |
| `Age` | 这份缓存已经在边缘节点里躺了多少秒 |
| `哈希文件名` | 构建时把内容哈希写进文件名（`_..BulBwWNp.css` 这种），内容变了文件名就变，天然不怕缓存旧版 |

几个关键关系再说细一点：

- `max-age` 和 `s-maxage` 是**分开的两个开关**：`s-maxage` 拉得再长，浏览器也只认 `max-age`。所以可以做到"CDN 缓存一天，浏览器每次重新验证"。
- `HIT` 不丢人，`MISS` 也不丢人。第一次请求必然是 MISS（缓存是空的），第二次开始才是 HIT。判断缓存配好没，就是看同一个页面第二次请求是不是 HIT。
- 重新部署为什么能"自动清缓存"：Vercel 每次部署会主动把旧缓存失效掉。所以 HTML 的边缘缓存 TTL 设多长其实无所谓——反正部署时就换新的了。

## 分层配置 vercel.json

思路很简单：**不同文件用不同缓存策略**。哈希资源一年不用动，HTML 要保证发新文章立即可见，数据接口折中。我的 `vercel.json` 最终长这样（安全头那部分是之前就有的）：

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "SAMEORIGIN" },
        { "key": "X-XSS-Protection", "value": "1; mode=block" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Cache-Control", "value": "public, s-maxage=86400, max-age=0, must-revalidate" }
      ]
    },
    {
      "source": "/_astro/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    },
    {
      "source": "/assets/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=2592000, stale-while-revalidate=604800, must-revalidate" }]
    },
    {
      "source": "/(pagefind|pio)/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=2592000, stale-while-revalidate=604800, must-revalidate" }]
    },
    {
      "source": "/api/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, s-maxage=3600, max-age=0, must-revalidate" }]
    }
  ]
}
```

每条规则的意图：

| 路径 | 策略 | 为什么 |
|---|---|---|
| 其他所有（HTML 页面） | 边缘缓存 1 天，浏览器每次重新验证 | CDN 直接吐页面，但发新文章后老读者刷新立刻看到新版 |
| `/_astro/` | 一年 + `immutable` | 全是带哈希的构建产物，文件名变了缓存自然换新 |
| `/assets/`、`/pagefind/`、`/pio/` | 30 天 + 过期后后台更新 | 手动放进去的静态文件，搜索索引、阅读器组件这类 |
| `/api/` | 边缘缓存 1 小时，浏览器不缓存 | 文章元数据、评论数据，旧一小时无伤大雅 |

> [!NOTE] 为什么要 1 天而不是十年
> 那两篇文章（尤其第二篇）建议把 HTML 边缘缓存直接拉到十年，理由是"重新部署会自动失效，设多长都行"。理是这个理，但我想的是：万一哪天 Vercel 某个区域的失效信号出岔子，TTL 一天最多让那个区域吐一天旧页面，十年就是吐到你手动清缓存为止。正常场景下两者效果完全一样，那我选风险小的。

## 部署后自动预热

配置完之后还有一个空窗期：**新部署的缓存是空的**，每个页面都要等第一个访客来"暖场"，第二个访客才能吃到缓存。我的站一共六十多个页面，全等真人来暖，得等挺久。所以抄第二篇文章的思路，加了个 GitHub Actions 工作流。

逻辑是这样的：

```yaml
on:
  push:
    branches: [HY]        # 我的部署分支
  workflow_dispatch:       # 也能手动跑

jobs:
  warm:
    steps:
      - name: 等待 Vercel 完成新部署
        if: github.event_name == 'push'
        run: sleep 120
      - name: 预热并统计命中率
        run: bash .github/scripts/cache-warm.sh
```

脚本干三件事：从 `sitemap-index.xml` 逐片抓全站 URL → 并发 curl 每个页面一遍 → 读响应里的 `X-Vercel-Cache` 统计 HIT 率，没达标就歇 20 秒再来一轮，最多四轮。原文的做法是写个 HIT.txt 提交回仓库，我嫌提交污染提交历史，改成直接把统计打到 Actions 的运行日志里，点开就能看。

有个物理限制得说清楚：**GitHub Actions 的机器在美国，预热的是美区边缘节点**。Vercel 边缘缓存按区域分片，所以这个工作流不能保证国内节点也全绿——国内访客第一次访问某页面时，就近节点可能还是 MISS，回源一次之后就好了。想连这块都解决就得动 DNS 优选，那是另一个话题。

## 踩坑：header 顺序比你想象的阴险

第一版配置我是把 HTML 那条规则**单独**放在 `headers` 数组最后面，想着 Vercel 应该会"更细的规则覆盖更宽的"。结果上线一测，`/_astro/` 的 CSS 返回的头居然是 `s-maxage=86400, max-age=0`——`immutable` 没了。

查了文档才知道：Vercel 的 headers 匹配是**先到先得**，第一条 `/(.*)` 基础规则把后面所有细规则全挡了。修复也简单：把 HTML 的缓存头直接并进第一条基础规则，让每个请求在第一条就拿到该拿的头，后面的细粒度规则才有机会覆盖。

修完重新部署，再测：

```bash
curl -sI https://www.9ll.uk/ | grep -i cache-control
# Cache-Control: public, s-maxage=86400, max-age=0, must-revalidate

curl -sI https://www.9ll.uk/_astro/_..BulBwWNp.css | grep -i cache-control
# Cache-Control: public, max-age=31536000, immutable
```

这回对了。教训记下来：**在 Vercel 配 headers，永远先声明通用头，再声明细粒度头，同 key 谁先声明谁赢**。

## 验证效果

配置生效后，冷态实测（第一次就请求）：

| 页面 | 第一次 | 第二次 |
|---|---|---|
| 首页 | MISS | HIT，Age 增长 |
| 关于页 | HIT（被预热工作流填过） | HIT |
| 朋友圈 | HIT | HIT |
| 标签页 | HIT | HIT |
| 随机老文章 | MISS（美区预热覆盖不到） | HIT |

预热脚本本地冒烟测试的数据也放一下：64 个页面，第一轮 HIT 28/64（43.8%），第二轮 64/64（100%）。这就是"暖场"的效果，第一遍全是 MISS，第二遍全 HIT。

发新文章会不会被缓存卡住？不会。浏览器端是 `max-age=0, must-revalidate`，每次都会带着 ETag 去问边缘节点有没有新版，部署一完成，刷新就是新内容。

## 写在最后

整套东西在 Vercel 上就是**一个 vercel.json + 一个 Actions 工作流**，后台什么都不用点。对静态博客来说，`s-maxage` 边缘缓存加哈希资源 `immutable` 基本就是全部了，剩下的预热属于锦上添花。如果你也想抄，顺序记住：

1. `vercel.json` 里通用头写进第一条规则，细粒度规则放后面
2. HTML 用 `s-maxage` 控制边缘、`max-age=0` 控制浏览器
3. 带哈希的资源大胆上 `immutable`
4. 加个部署后预热工作流，消掉"第一个访客最慢"的空窗

配置完用 `curl -sI` 看响应头就行，同一个 URL 连请求两次，第二次 `X-Vercel-Cache: HIT` 就成了。
