---
title: 搭建本站同款博客
published: 2026-07-12
description: 使用Vercel,Netlify等搭建本站同款博客
image: ./cover.png
tags: [前端, 博客, 搭建, Vercel, Netlify]
category: 博客
draft: false
---

# 1.复刻Firefly的Github官方仓库

[CuteLeaf/Firefly](https://github.com/CuteLeaf/Firefly)




![Fork](./fork.png "Fork仓库")

其实你自己下载压缩包下来，自己创一个公开仓库上传也行，不过复刻可以随时同步作者的更新，但是可能要处理代码冲突，如果实在冲突太多，[Firefly Docs](https://docs-firefly.cuteleaf.cn/zh/)里面也有提到手动覆盖



# 2.注册前端云平台

[![Powered by Vercel](https://cdn.jsdelivr.net/gh/yanranxiaoxi/Powered-by-Vercel@1.0.0/powered-by-vercel.svg)](https://vercel.com)

[![Deploys by Netlify](https://www.netlify.com/img/global/badges/netlify-color-accent.svg)](https://www.netlify.com)

vercel和netlify都可以，个人更推荐vercel？因为后续搭建umami需要用到vercel的免费数据库(Neon)。

 ## Vercel

[Vercel](https://vercel.com/) 是部署 Astro 项目最简单的平台之一。

1. 将你的项目推送到 GitHub / GitLab / Bitbucket

2. 登录 [Vercel](https://vercel.com/)，点击 **Add New … → Project**

3. 导入你刚刚复刻/创建的Firefly仓库

4. Vercel 会自动检测 Astro 框架，配置如下：

   - **Application Preset**: `Astro`
   - **Build Command**: `pnpm build`
   - **Output Directory**: `dist`
   - **Install Command**: `pnpm install`

5. 设置 Node.js 版本：进入 **Settings → General → Node.js Version**，选择 `22.x`

6. 点击 **Deploy**

 ## Netlify

   [Netlify](https://www.netlify.com/) 是另一个流行的静态站点托管平台。

   1. 将你的项目推送到 GitHub / GitLab / Bitbucket / Azure DevOps
   2. 登录 [Netlify](https://app.netlify.com/)
   3. 点击 **Add new project → Import a Git repository**
   4. 连接你刚刚复刻/创建的Firefly仓库
   5. 配置构建设置：
      - **Build command**: `pnpm build`
      - **Publish directory**: `dist`
   6. 在 **Environment variables** 中设置 `NODE_VERSION` 为 `22`
   7. 点击 **Deploy …**

# 3.站点配置

这里更推荐去看官方文档，也是非常详细了，但是官方文档里面并无写如何搭建umami站点统计和搭建评论区，我这两天再写一下吧

[快速开始 | Firefly Docs](https://docs-firefly.cuteleaf.cn/zh/guide/getting-started.html)