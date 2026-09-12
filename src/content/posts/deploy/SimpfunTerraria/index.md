---
title: "用简幻欢开泰拉瑞亚模组服，顺便记几个终端不显示的坑"
published: 2026-09-12
description: "在简幻欢上用 TModLoader 开一个带模组的泰拉瑞亚服务器：从 Steam 提取服务端、上传模组整合包到改启动脚本的完整流程，附创建世界时终端漏显示字段的对照表。"
image: ./images/cover.webp
tags: [泰拉瑞亚, TModLoader, 简幻欢, 游戏服务器, 部署]
category: 部署
draft: false
---

一直想开个泰拉瑞亚模组服，又懒得去折腾公网和端口转发，最后选了简幻欢。面板上有现成的 Terraria 镜像，实例类别选 Terraria、服务端选 TModLoader 就能建出来，但建出来的服务端是纯净的——想玩模组，得自己把本地 Steam 上的 TModLoader 服务端文件搬上去，再改启动脚本把模组目录指过去。

流程不复杂，坑都在细节里：启动脚本要补一行运行时，模组和配置得放进指定目录，另外创建世界那一步终端会漏显示几个字段。这篇按我操作的顺序记一遍。

## 准备工作

- 一个简幻欢账号（[simpfun.cn](https://simpfun.cn/auth?type=register&code=287905953) 注册）
- 本地装好 TModLoader（Steam 免费下载）
- 要玩的模组在本地先启用好

## 第一步：注册账号、新建实例

### 注册账号

前往简幻欢官网 [simpfun.cn](https://simpfun.cn/auth?type=register&code=287905953) 注册一个账号，跟着官网指引走完就行。

### 新建实例

进入官网点进控制台，然后新建实例：基础镜像，实例类别选 **Terraria**，服务端选 **TModLoader**，版本选最新版本，最后确认创建。

## 第二步：提取 TModLoader 服务端文件

打开 Steam，下载游戏 **TModLoader**。在 Steam 左侧游戏列表右键 → 管理 → 浏览本地文件，运行一次 `start-tModLoaderServer.bat`。

第一个提示输入 `n`，走到选择世界的步骤时直接关闭程序。然后在目录里全选所有文件，右键压缩成一个压缩包，建议压成 7z。

## 第三步：清掉简幻欢的原服务端，上传新的

回到刚新建的实例，点「文件」，全选所有文件删除——简幻欢会保留一个启动脚本。然后把刚才压好的压缩包上传上去，勾选它，点右下角工具箱里的「解压」。

## 第四步：改启动脚本，补上 dotnet

找到文件列表里的 `start.sh`，点开编辑，在 `cd "$(dirname "$0")" || exit` 后面加一行：

```bash
mise use -g dotnet@8.0
```

保存。这行是给容器装上 dotnet 8.0，TModLoader 本体就靠它启动。

## 第五步：把本地模组打包成整合包

在本地 TModLoader 里，把自己要玩的、也就是要传到服务器的那批模组全部启用。确认配置没问题后，在模组管理页面点「将已启用模组保存为模组整合包」，再点「导出整合包」。

然后打开这个整合包所在的文件夹，切到 `Mods` 和 `Modconfigs` 这两个文件夹的目录，把它们打包压缩，同样建议压成 7z。

## 第六步：改启动参数，指定模组目录

把上一步压好的包上传到 `start.sh` 所在的目录并解压，当前目录会多出 `Mods` 和 `Modconfigs` 两个文件夹。

再打开 `start.sh`：

1. 删掉所有以 `launch_args="-server"` 开头的代码
2. 新增一行：

```bash
launch_args="-server -config serverconfig.txt -modpath /home/container/Mods -tmlsavedirectory /home/container"
```

这行把模组路径指到刚解压出来的 `Mods`，把存档目录指到 `/home/container`。

改完之后 `start.sh` 全文长这样：

```bash
#!/usr/bin/env bash
cd "$(dirname "$0")" || exit
mise use -g dotnet@8.0
launch_args="-server -config serverconfig.txt -modpath /home/container/Mods -tmlsavedirectory /home/container"
dotnet tModLoader.dll $launch_args
```

## 第七步：启动

回到简幻欢的终端页面，点右上角的「启动服务器」，服务器就带着你的模组跑起来了。

## 踩坑：终端不显示的那几个字段

简幻欢的网页终端渲染 TModLoader 服务端的交互提示时会有 bug，提示文字显示不出来，只能看到一个光标在那儿闪。得按顺序对着填。

**创建世界的时候，下面这两个内容显示不出来：**

| 顺序 | 显示不出来的内容 |
|---|---|
| 1 | 世界名称 |
| 2 | 种子 |

**创建完世界后进入选择世界启动，这一步同样不显示，依次是：**

| 顺序 | 显示不出来的内容 | 怎么填 |
|---|---|---|
| 1 | 最大玩家数 | — |
| 2 | 端口 | 填简幻欢对应实例的**实际端口**，别随手填 |
| 3 | 自动转发端口 | 直接输 `y` 过掉 |
| 4 | 密码 | — |

这里就端口要注意一下：它要的是你这个实例自己的端口，不是随便一个能用的数，填错了外面连不进来。自动转发端口那项无所谓，无脑输 `y` 就行。

> [!WARNING] 顺序别记错
> 提示看不到，等于是在盲填。建议把上面两张表放在旁边，一项一项对着来。

## 极简流程

1. 简幻欢注册账号，控制台新建实例：Terraria + TModLoader + 最新版本
2. 本地 Steam 跑一次 `start-tModLoaderServer.bat`，到选世界那步退出，全选文件压包
3. 上传到简幻欢解压，`start.sh` 里加一行 `mise use -g dotnet@8.0`
4. 本地导出模组整合包，把 `Mods`、`Modconfigs` 压包上传解压
5. 改 `launch_args` 指向模组目录，回终端点「启动服务器」

## 写在最后

整套流程走下来，真正花时间的不是点面板，是在本地把服务端文件和模组整理干净——本地跑过一遍、模组确认启用、路径对上，后面才顺。终端那个显示 bug 挺烦的，但知道顺序之后也就没什么影响了。
