---
title: "Snow Shot：常驻 13MB 的截图工具，把 PixPin 的会员功能全免费了"
published: 2026-09-28
description: "Snow Shot 是免费开源的跨平台截图工具，表格识别、文本翻译、LaTeX 公式识别、多语种 OCR 和录屏记键鼠都不需要会员，常驻内存只有 13MB，还带了一个 MCP 接口，AI 能直接替你截图、识别、导出。"
image: ./images/cover.webp
tags: [Snow Shot, 截图工具, PixPin, Windows, 开源, OCR]
category: 推荐
draft: false
---

我电脑里装着 PixPin，用着挺顺，但有几处一直膈应：表格识别要会员、文本翻译要会员、LaTeX 公式识别要会员、多语种 OCR 也要会员，连录屏记鼠标键盘都锁在会员里。

换成 Snow Shot 之后，这个膈应没了。常驻内存 13MB，PixPin 靠会员收钱的功能，它全免费、全开源、全本地跑。

GitHub 上 5127 个 star，Snow Shot 本体是 GPLv3，主体 C++/Qt，底下的图像和 OCR 部分走 Rust。9 月 28 号刚发 v1.1.6-beta，再往前数，从 22 号的 v1.1.0 到今天，七天推了七个 beta。

::github{repo="mg-chao/snow-apps"}

## PixPin 会员区里躺着的功能，它一个不落全给了

先摆账。PixPin 官方文档里明晃晃标着 "会员用户" 的这几样，Snow Shot 这边打开就能用：

| 功能 | PixPin | Snow Shot |
|---|---|---|
| 表格识别 | 会员，截图时按 `Shift + Q`，只能存 Excel | 免费，识别完能改单元格、合并拆分，导出 Excel 或 Markdown |
| 文本翻译 | 会员，`Ctrl + Q` | 免费，贴图和 OCR 结果上右键就翻，自动识别源语言 |
| LaTeX 公式识别 | 会员，截图时按 `Shift + F` | 免费，截图里的公式直接变成 LaTeX 代码 |
| 多语种 OCR | 会员，简体、繁体、英、日、韩、法、德、西、葡 | 免费，模型版本 V4 到 V6 自己挑，精度和速度随你权衡 |
| 录屏记鼠标键盘 | 会员，画中画和录后剪辑也一起锁着 | 免费，键鼠轨迹、摄像头画中画、录完还能剪 |

到这儿你大概会想：不过是把会员功能抄了一遍，能有多好？

接着往下看，还有几个我觉得更值钱的：

- **条码 / 二维码识别**：快递单、商品码、WiFi 码，一次扫一整张图
- **屏幕录制**：选区录屏，键鼠记录、摄像头画中画，录完直接剪

这些全都不用登录、不用扫码、不用绑支付方式。

## 13MB 是个什么概念

我挂上 Snow Shot 一天，任务管理器里那个进程稳定在 13MB 上下。同时开着的 PixPin 常年 200MB 起步，时不时窜到 400MB。都是挂着全局热键等我召唤，差出一个数量级。

它轻，不是阉割出来的轻。OCR 推理由 Rust 写的 `rapid-ocr-rs` 跑，模型是 PaddleOCR 那套，推理走 ONNX Runtime；截图捕获吃 Windows 的 DXGI / GDI，录屏编码甩给 GPU。作者连 "识别进程要不要常驻" 都做成了开关：不开，用的时候才拉起子进程；开了，模型预热好，OCR 零延迟。

那 13MB 是不是靠省掉功能换来的？我一开始也这么怀疑。直到我把表格识别、公式识别、录屏挨个跑了一遍——全在，而且都在本地跑。

PixPin 的核心是闭源的，你看不到它在跑什么。

## 翻译到底要不要 API

这个说法网上传得乱，我翻了源码，说准确点。

翻译走的是 OpenAI 兼容接口，base URL 你可以指向本机。填 `http://localhost:11434/v1`、模型名写本地跑的那个，整条翻译链路就出不了你的电脑，不用买任何云端 key。

你要是嫌折腾，接智谱、DeepSeek、通义的兼容 API 也行，作者把选择权交给你了。

OCR 更彻底：本地 PP-OCR 模型，断网能用，GPU 加速开不开随你。

补一句判断标准：隐私敏感就选本地翻译 + 本地 OCR，图省事就接云端 API。两条路它都给你留好了。

## 它比 PixPin 多走了一步

Snow Shot 自带一个 MCP server，叫 `snow-shot-mcp`。在 Claude Code、Codex 或任何支持 MCP 的客户端里接上它（先在 `设置 → 系统` 里打开 MCP），AI 就能直接替你截图、标注、识别、导出。

意思就是你对着 AI 说 "把这块屏幕截下来，表格提出来"，它就真去干了。截图工具里这是我第一次见。

## 说句公道话

PixPin 的产品打磨是顶级的，UI 细腻，会员制也合理——作者要吃饭。

但我这种普通用户，截图就是为了识个别字、翻一段英文、偶尔录十秒视频，这些动作 PixPin 全归进会员。我只是偶尔用一次表格识别，为什么得先开会员？

Snow Shot 的作者 mg-chao 把这些功能用本地模型加开源算法重做了一遍，GPLv3 丢在 GitHub 上，不放心你可以自己编译。

## 它和上个月那个 "截图吧" 不是一回事

有读者会问：前阵子不是刚写过一个开源截图工具？两个是不同的项目，别搞混。

那到底该装哪个？看你的日常：天天回头翻旧截图，选[截图吧](/posts/recommend/jietuba/)；想录段带键鼠操作的视频给同事，选 Snow Shot。

截图吧是 PySide6 加 Rust 的路线，219 个 star，强项是剪贴板历史管理；Snow Shot 是 C++/Qt 加 Rust，5127 个 star，强项在录屏记键鼠、表格编辑器和 MCP 接口。

## 怎么才能用上

去 [Releases](https://github.com/mg-chao/snow-apps/releases/latest) 下最新版，Windows 有三个包：

1. `offline.exe`（62 MB）——所有 OCR 模型内置，离线环境最稳
2. `online.exe`（24 MB）——想省空间选它，功能用到再下
3. `portable.zip`——想塞 U 盘选它

macOS ARM64 用户下 `.dmg`。

懒得下也行，命令行一行：

```powershell
winget install --exact --id mg-chao.snow-shot --source winget
```

官网 snowshot.top 的直连下载暂时在维护，作者让大家走 GitHub Releases 或飞盘。

PixPin 我已经卸了。你要是也吃过 "这功能怎么又要会员" 的闷亏，记住这一句：Snow Shot 把 PixPin 的会员功能全免费了，常驻只有 13MB，还带 MCP 接口。截图识字、翻英文、提表格、录视频这几件事，它一个软件全包了。
