---
title: "IPv6 Switch for Windows"
slug: ipv6-switch
published: 2026-09-28
order: 110
description: "Windows 全局 IPv6 一键开关脚本。深入 TCP/IP 协议栈改写注册表 DisabledComponents，彻底解决虚拟网卡（Clash TUN / VPN）频繁自动重新勾选 IPv6 的顽疾，支持交互模式与 CLI 命令行静默调用。"
image: "images/ipv6-switch.png"
status: "published"
tags:
  - Windows
  - PowerShell
  - 网络
  - 开源工具
link:
  - label: "GitHub"
    icon: "fa7-brands:github"
    value: "https://github.com/hy4962/ipv6-switch"
---

> 一键开关 Windows 全局 IPv6 的小脚本，专治「网卡属性里取消勾选 IPv6，过一会儿又自己勾回去」。

## 痛点背景

很多时候我们需要临时或长期关闭 Windows 上的 IPv6（例如某些校园网、特定内网环境、BT 下载流量走错接口，或是代理软件的 DNS / 路由分流异常）。

但经常会遇到一个极其烦人的现象：**在网络适配器属性里明明去掉了「Internet 协议版本 6 (TCP/IPv6)」的勾选，没过多久它又自己悄悄勾回去了！**

### 为什么网卡属性里取消勾选不管用？

在 Windows 的网络适配器属性里取消勾选，本质上只是对该网卡执行了**解绑（Unbind）**，并没有在系统层关闭 IPv6 协议栈。以下常见场景都会让它重新“诈尸”：

- **代理/虚拟网卡软件**：使用 `wintun` 驱动的软件（如 Clash Verge、Mihomo Party、Meta Tunnel、各类 VPN），每次开关 TUN 模式或切换节点都会销毁并重建虚拟网卡，新网卡的绑定状态直接恢复为系统默认；
- **系统网络重置 / 驱动更新**：Windows 系统更新或网卡驱动重装后自动重置适配器属性；
- **第三方优化/卫士类工具**：某些网络修复或优化工具扫描后自动恢复默认勾选。

---

## 解决原理

彻底可靠的做法是从**注册表总开关**入手：

```text
HKLM\SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters
  DisabledComponents (REG_DWORD)
    255 (0xFF)  ->  全系统彻底关闭 IPv6
    0   (0x00)  ->  恢复启用 IPv6
```

该注册表项直接作用于 Windows 的 **TCP/IP 协议栈底层**，优先级高于任何单块网卡的绑定状态。一旦设置为 `0xFF`，即便后续新建任何虚拟网卡（如 TUN/TAP），协议栈本身也绝不会加载 IPv6，彻底压制死灰复燃。

---

## 使用方式

### 1. 交互模式（双击即用）

直接双击 `ipv6-toggle.bat` 运行：
- 会自动以管理员权限启动（首次弹出 UAC 点击「是」即可）；
- 会先读取并展示当前系统的 IPv6 实际状态及所有网卡绑定数量；
- 等待键盘输入选择：

```text
================ 当前状态 ================
  IPv6 状态 : IPv6 已开启
  注册表值  : DisabledComponents = 0x0  (0)
  网卡绑定  : 5 / 5 块网卡勾着 IPv6
==========================================

y = 打开 IPv6   |   n = 关闭 IPv6   |   回车或其它 = 不改，直接退出   请输入:
```

- 输入 `y`：启用全局 IPv6；
- 输入 `n`：关闭全局 IPv6；
- 直接回车：什么都不改，安全退出。

> **提示**：修改注册表协议栈后**需要重启系统才能完全生效**。脚本修改完成后会提示是否立即重启（输入 `y` 会进入 15 秒安全倒计时，回车则可稍后自行重启）。

---

### 2. 命令行与脚本调用（CLI）

除了双击交互，脚本还支持带参直接执行，非常适合集成到快捷方式、自动化脚本或任务计划中：

#### Batch 方式
```bat
ipv6-toggle.bat status   :: 只查看当前状态，不修改任何配置（无需管理员权限）
ipv6-toggle.bat on       :: 打开 IPv6
ipv6-toggle.bat off      :: 关闭 IPv6
ipv6-toggle.bat          :: 不带参数直接进入交互模式
```

#### PowerShell 方式
```powershell
.\IPv6-Toggle.ps1                       # 交互模式
.\IPv6-Toggle.ps1 -Action Status        # 查看状态
.\IPv6-Toggle.ps1 -Action Off           # 关闭 IPv6
.\IPv6-Toggle.ps1 -Action On            # 开启 IPv6
.\IPv6-Toggle.ps1 -Action Off -Restart  # 关闭并立即触发重启（15秒倒计时）
```

参数 `-Action` 支持：`Off` / `On` / `Status` / `Interactive`（默认）。

---

## 工程细节

为了在各种 Windows 环境下开箱即用且不报错，脚本在实现上做了几处细致考量：

1. **UTF-8 BOM 编码**：Win10 / Win11 原生 PowerShell 5.1 在控制台打印中文时经常遇到乱码，脚本特意采用带 BOM 的 UTF-8 保存，确保控制台输出文字干净整洁；
2. **免改执行策略**：通过 `.bat` 入口使用 `-ExecutionPolicy Bypass` 单次绕过系统脚本执行策略，用户电脑无需全局放开 `Set-ExecutionPolicy`；
3. **UAC 无缝提权**：在 PowerShell 内部检测管理员令牌，非提权状态下直接调用 `Start-Process -Verb RunAs` 自提权并继承参数。

---

## 文件结构

```text
ipv6-switch/
├── IPv6-Toggle.ps1  # 核心 PowerShell 脚本（状态检测、注册表读写、网卡绑定适配）
├── ipv6-toggle.bat  # 双击/命令行便捷入口（自动绕过执行策略与调用）
└── README.md        # 项目说明文档
```

两个文件放在同一目录下即可使用。
