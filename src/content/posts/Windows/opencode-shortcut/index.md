---
title: "一个字母的事：让 opencode 像 mimo 一样在资源管理器地址栏启动"
published: 2026-07-24
description: "想在文件资源管理器地址栏输入 oc 就启动 opencode？复制 .cmd 不行，得复制 .exe"
image: ./cover.png
tags: [opencode, Windows, 命令行, 快捷启动]
category: Windows
draft: false
---

我平时用 opencode 每次都要开命令行输入 `opencode`，挺烦的。

mimo 就方便很多，在文件资源管理器地址栏直接输入 `mimo` 就能打开终端。我就想着能不能也给 opencode 搞一个短命令。

最简单的想法：复制一个 `oc.cmd` 出来不就行了？

```powershell
Copy-Item "C:\Users\XOS\AppData\Roaming\npm\opencode.cmd" "C:\Users\XOS\AppData\Roaming\npm\oc.cmd"
```

命令行里输入 `oc` 确实能用。但是文件资源管理器地址栏里输入 `oc`，直接跳浏览器了。

搞了半天才发现，Windows 地址栏只认 `.exe`，不认 `.cmd`。输入 `oc` 找不到对应的 `.exe`，就当成网址去搜索了。

mimo 能用是因为它本身就是个 `.exe` 文件，放在 PATH 目录里，地址栏直接能找到。

所以正确的做法是复制 `.exe`：

```powershell
Copy-Item "C:\Users\XOS\AppData\Roaming\npm\node_modules\opencode-ai\bin\opencode.exe" "C:\Users\XOS\AppData\Roaming\npm\oc.exe"
```

这下命令行和地址栏都能用了，输入 `oc` 直接打开，跟 mimo 一样。

说实话这个坑挺小的，但不查真不知道。我一直以为 `.cmd` 和 `.exe` 在地址栏里效果一样。

---

*折腾 opencode 快捷启动的小记录*
