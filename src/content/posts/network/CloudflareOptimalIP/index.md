---
title: Cloudflare Workers优选IP
published: 2026-07-12
updated: 2026-07-15
description: CloudFlare优选IP
image: ./cover.png
tags: [Cloudflare, Workers, 优选IP, DNS, CDN]
category: 网络
draft: false
---

## 什么是优选IP，为什么要搞这个

用过 Cloudflare 的人应该都有感觉：国内访问 Cloudflare 托管的网站，有时候慢得离谱。明明是全球最大的 CDN 厂商之一，怎么体验还不如一些小厂？

原因出在路由上。

Cloudflare 用的是 anycast 技术——同一个 IP 地址在全球很多地方都有节点，你的请求会被路由到"最近"的那个。问题是这个"最近"是按网络拓扑算的，不是按地理距离。国内三大运营商到 Cloudflare 节点的线路经常绕路，比如电信用户可能被送到美国圣何塞的节点，明明直线距离不到两千公里的事，数据包绕了半个地球才到。

优选IP就是找那些对国内线路"更友好"的 Cloudflare 节点。这些节点可能物理位置不在国内（Cloudflare 在大陆没有免费节点），但经过的网络路径更短、中间跳数更少、延迟更低。

### 效果到底有多大

看你的运营商和地区，差别很大：

- **电信用户**：改善通常最明显。因为电信到 Cloudflare 默认线路特别绕，优选一下可能从 300ms+ 降到 100ms 左右
- **联通用户**：默认线路本来还行，改善幅度中等
- **移动用户**：情况不稳定，有时候有效果有时候没有，跟具体省份有关

至于下载速度，优选IP能让 Cloudflare 托管的静态资源（图片、CSS、JS）加载更快。但对于 Workers 的计算性能，优选IP帮不上忙——它只优化你到 Cloudflare 这段路，不改变 Cloudflare 内部处理请求的速度。

**网站打开更快了，下载更快了，但 Worker 跑代码的速度不变。**

### 两种实现方式

搞优选IP有两种路子，复杂程度不同：

| 方式           | 难度 | 稳定性             | 适合谁     |
| -------------- | ---- | ------------------ | ---------- |
| CNAME 优选域名 | 低   | 较高（别人在维护） | 大多数人   |
| A 记录直连 IP  | 高   | 低（IP 会过期）    | 想折腾的人 |

**CNAME 方式**就是你把域名指向一个别人已经配好的优选域名（比如 `vip.090227.xyz`），这个域名背后对应的是维护者筛出来的高质量 Cloudflare IP。你不用自己找 IP，改一条 DNS 记录就完事了。

**A 记录方式**是你自己去测速、自己找 IP、自己填到 DNS 里。更灵活，但维护成本高——好 IP 今天能用不代表明天还能用。

下面两种都讲。

---

## 方式一：CNAME 优选域名（推荐大多数人）

### 前提条件

域名必须在 Cloudflare 上托管。就是你的域名的 nameserver 指向 Cloudflare，不是说域名从 Cloudflare 买的。在阿里云、腾讯云买的域名，只要把 DNS 服务器改成 Cloudflare 提供的那两个地址就行。

### 第一步：给 Workers 添加路由

进入 Cloudflare Dashboard → Workers 和 Pages → 你的项目 → 设置 → 触发器 → 添加路由。

路由格式就是你的域名加通配符：

```
9ll.uk/*
*.9ll.uk/*
```

第一行匹配主域名下的所有路径，第二行匹配所有二级域名。**按需填，不需要的可以不加**。

注意一个坑：**这个域名必须已经添加到你的 Cloudflare 账号里**，就是 Dashboard 左侧"网站"列表里要有这个域名。没添加的话路由不会生效。

![添加路由](D:\Users\Administrator\Desktop\Firefly\src\content\posts\CloudflareOptimalIP\route.png)

### 第二步：选一个优选域名

推荐两个网站：

- [微测网 CF 优选 CNAME](https://www.wetest.vip/page/cloudflare/cname.html) — 更新比较勤，域名多
- [CF优选域名汇总](https://cf.090227.xyz/) — 界面简单直接

上面列出来的域名都是别人维护的优选 CNAME，比如 `vip.090227.xyz`、`cf.011011.xyz` 之类的。

怎么选？两种方法：

**简单粗暴法：** 直接挑一个 ping 一下，延迟低的就用。

```bash
ping vip.090227.xyz
```

**认真测试法：** 多 ping 几个，记下延迟，挑最低的两三个。不同运营商的结果可能不一样，有条件的话找个跟你同运营商的朋友帮忙测。

### 第三步：添加 DNS 解析

回到 Cloudflare → 你的域名 → DNS → 记录。

添加一条 CNAME 记录：

- **类型**：CNAME
- **名称**：`@`（代表主域名）或你想要的二级域名比如 `www`
- **目标**：你选的优选域名，比如 `vip.090227.xyz`
- **代理状态**：**关掉**，显示灰色云朵

![cname](D:\Users\Administrator\Desktop\Firefly\src\content\posts\CloudflareOptimalIP\cname.png)

**代理一定要关掉**，这是最多人踩的坑。Cloudflare 的代理（橙色云朵）会把你的流量走 Cloudflare 全球网络，等于绕回了默认路由，优选IP就白做了。关掉代理后，DNS 解析会直接返回优选域名对应的 IP，你的流量走的是那条优化过的路径。

### 第四步：验证

打开终端：

```bash
ping 你的域名
```

看返回的 IP 是不是跟优选域名的一样。再用 curl 检查一下：

```bash
curl -I https://你的域名
```

响应头里有 `server: cloudflare` 和 `cf-ray` 字段，说明流量确实走了 Cloudflare。

也可以用 [Ping.pe](https://ping.pe/) 这类工具从多个地区测速，对比优化前后的延迟。

---

## 方式二：A 记录直连优选IP

这种方式更折腾，但好处是你可以完全自己控制，不依赖别人维护的域名。

### 第一步：找到好用的 Cloudflare IP

去微测网的 [CloudFlare优选IPV4地址](https://www.wetest.vip/page/cloudflare/address_v4.html)，上面有测速过的一批 IP 列表。

或者自己动手：从 Cloudflare 的 IP 段（公开的，[官网有列表](https://www.cloudflare.com/ips/)）里挑一些，批量 ping 测速。这活挺枯燥的，但真想搞就耐心点。

测速的时候注意几点：

- **从你实际使用的网络测**，别用 VPN 测，那测出来的不准
- **多测几次**，网络质量有波动，偶尔一次延迟低不代表稳定
- **分时段测**，晚高峰和凌晨的延迟差别很大

### 第二步：添加 A 记录

DNS 设置里添加 A 记录：

- **类型**：A
- **名称**：`@` 或你的二级域名
- **IPv4 地址**：你测出来的优选 IP
- **代理状态**：关掉

同样代理要关掉。

想更稳妥的话，多加几条 A 记录，填不同的优选 IP。DNS 会自动轮询返回，相当于做了个简单的负载均衡。一个 IP 挂了，其他的还能顶上。

不过要注意：**CNAME 和 A 记录不能同时存在**。同一个域名下如果有 CNAME，就不能再加 A 记录，反过来也一样。想用 A 记录就得先把 CNAME 删了。

### 第三步：验证

跟 CNAME 方式一样，ping 看 IP，curl 看响应头。

### 为什么不推荐大多数人用这个

A 记录方式有两个硬伤：

1. **IP 会过期**。Cloudflare 的 IP 归属和路由策略经常调整，今天 30ms 的好 IP，过两个月可能变成 200ms。你得定期重新测速、更新记录。
2. **工作量大**。手动测速、挑选、填记录、定期维护，对个人博客来说性价比不高。

CNAME 方式的域名背后，维护者会不定期更新 IP 列表，你不用操心这些。

---

## 怎么判断优选IP有没有效果

优化完了得验证，不然白折腾。

### ping 对比

优化前后分别 ping 你的域名，记录延迟。简单但直观：

```bash
# 优化前
ping 9ll.uk

# 优化后（DNS 传播完）
ping 9ll.uk
```

### 多地区测试

用 [Ping.pe](https://ping.pe/) 或 [ITDog](https://www.itdog.cn/) 从全国多个节点测试。你自己的网络测出来好了不代表所有用户都好了，看个全局。

### 实际体验

浏览器清缓存（Ctrl+Shift+Delete），打开你的网站，感受加载速度。图片多的页面效果对比更明显。

### curl 看细节

```bash
curl -o /dev/null -s -w "DNS解析: %{time_namelookup}s\nTCP连接: %{time_connect}s\nTLS握手: %{time_appconnect}s\n首字节: %{time_starttransfer}s\n总时间: %{time_total}s\n" https://你的域名
```

这个命令会输出连接各阶段的耗时，比单纯 ping 更精确。重点看 `DNS解析`、`TCP连接` 和 `首字节` 这三项。

---

## 常见问题和踩坑记录

### 代理没关

最常见的坑，没有之一。加了 CNAME 但 Cloudflare 那边代理还是橙色的，等于白加。一定要确认是灰色云朵。

### DNS 缓存

改完 DNS 记录后，不是立刻生效的。本地电脑、浏览器、路由器都可能缓存了旧的 DNS 结果。

清除本地缓存：

```bash
# Windows
ipconfig /flushdns

# macOS
sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder

# Linux（看用的什么 DNS 服务）
sudo systemd-resolve --flush-caches
```

浏览器的话直接清缓存或者开无痕窗口试。

一般 DNS 传播要几分钟到几小时不等，Cloudflare 自己的 DNS 生效最快（因为就是他们家的），其他 DNS 服务商的传播慢一些。

### Workers 路由没生效

添加路由后发现请求没走 Workers，检查：

- 路由格式对不对（`域名/*` 不是 `域名/`）
- 域名是不是已经在 Cloudflare 账号里添加了
- Workers 项目有没有部署成功
- 路由规则里域名跟 DNS 记录里的要一致

### 优选域名挂了

第三方维护的优选域名可能随时停更或失效。如果突然访问不了了，先确认优选域名本身还能 ping 通。ping 不通就换一个域名。

### CNAME 和 A 记录冲突

同一个域名下不能同时有 CNAME 和 A 记录。报错提示重复的时候，检查是不是之前加了 CNAME 没删。

### 运营商差异

同一个优选IP，电信测出来 80ms，移动测出来 300ms，很正常。不同运营商走的线路完全不同，没有一个 IP 能对所有运营商都好。如果你的用户覆盖三大运营商，可以考虑针对不同运营商用不同的优选IP（需要多个子域名分别解析）。

---

## 进阶玩法

### 优选IP + Cloudflare Pages

Cloudflare Pages 也能用优选IP。原理跟 Workers 一样——Pages 本质上也是跑在 Cloudflare 边缘网络上的，给 Pages 绑定自定义域名后，同样可以 CNAME 指向优选域名。

### 跟 Vercel 对比

Vercel 的 Edge Network 在国内也经常绕路，特别是免费计划。很多人选 Cloudflare Workers + 优选IP 而不是 Vercel，就是图个能优化链路。Vercel 你没法选节点，Cloudflare 至少还有这条路。

### 自己维护优选IP列表

如果你特别在意效果，可以写个脚本定期从 Cloudflare IP 段里测速，自动更新 DNS 记录。Cloudflare API 支持程序化操作 DNS 记录，配合 cron 跑就行。这个比较折腾，但适合有自动化需求的场景。

---

## 结语

优选IP这事说白了就是在 Cloudflare 的路由上找捷径。CNAME 方式最省事，加一条 DNS 记录，几分钟就搞定了。A 记录方式更灵活但维护成本高，看你需不需要。

效果因人而异——电信用户大概率有明显改善，联通一般般，移动看运气。试一下又不亏，不喜欢改回来就是了。

最后说一句实话：**这种方式本质上是蹭别人优选好的 IP**。真想从头搞，得自己去测 IP、维护列表、定期更新。大多数人没必要折腾到那一步。
