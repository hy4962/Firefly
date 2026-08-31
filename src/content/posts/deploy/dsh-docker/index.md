---
title: "DeepSeek Harness 上服务器：官方没出 Docker，社区镜像这么选"
published: 2026-08-29
description: "官方 dsh 只发 npm 包，Web 模式还只允许监听 127.0.0.1。整理两个社区 Docker 镜像的命令、环境变量和选择建议。"
image: ./images/cover.png
tags: [DeepSeek Harness, Docker, NAS, 部署, 服务器]
category: 部署
draft: false
---

最近把 DeepSeek Harness（dsh）当主力 agent 用，结果前两天 Windows 上的全局安装突然起不来，一敲 `dsh` 就是 `ERR_MODULE_NOT_FOUND`。修好之后我就动了歪心思：这种工具其实更适合扔在服务器或者 NAS 上 7×24 挂着，家里设备随时连上去用。于是去查它有没有 Docker 版，结论是：**官方没有，但社区有俩能打的**。这篇把调研结果整理一下。另外，把 Windows 上的 dsh 硬搬进 NAS 容器会踩哪些坑，我在[迁移那篇](/posts/ai/dsh-migrate-docker-ai-repair/)里记了四个，迁移时可以对照着看。

## 先说结论：官方目前没有 Docker 版

[官方仓库](https://github.com/deepseek-ai/deepseek-harness)的 README 里只写了两种用法：npm 装（`npx @deepseek-ai/dsh web` 起 Web UI）和源码编译，一个字没提容器。项目还在 developer preview 阶段，官方也明说后续会有破坏性变更。

更麻烦的是，`dsh web` 出于安全考虑只监听 `127.0.0.1:3080`，`--host 0.0.0.0` 是被禁止的。这意味着就算你自己把 npm 包塞进容器，局域网里其他设备照样连不上，还得自己套一层反代。

社区镜像就是冲着这两个问题去的。

## 方案一：smanx/deepseek-harness — 内置反代，开箱即用

[官方讨论区 #1762](https://github.com/deepseek-ai/deepseek-harness/discussions/1762) 里 smanx 打包的镜像，Docker Hub 和 GHCR 双仓库（`ghcr.io/smanx/deepseek-harness`，tag 一致）。

镜像内置一个 Node 反向代理：监听 `0.0.0.0:3080` 转发到容器内的 `127.0.0.1:3079`，顺手解决了三件事：

- WebSocket 转发（`/api/events.mux`、`/api/events.host`），不然网页端消息推不出来；
- 局域网 IP 属于非安全上下文，`crypto.randomUUID` 不可用，反代会往 HTML 里注入 polyfill，否则连接一直 pending；
- 可选的 HTTP Basic Auth。

tag 有三档，按需选：

| tag | 里面有什么 |
| --- | --- |
| `latest` | Node + DSH + 反代，最精简 |
| `devtools-min-latest` | 加 git、curl、wget、jq、pnpm、uv |
| `devtools-latest` | 再加 vim、python3、build-essential、tmux，适合让 agent 直接在容器里写代码 |

启动命令（原帖原文）：

```bash
docker run -d \
  --name dsh-harness \
  -p 3080:3080 \
  -v dsh-data:/root/.dsh \
  --restart unless-stopped \
  smanx/deepseek-harness:latest
```

可用的环境变量：

- `DSH_PORT`：dsh web 端口，默认 3079
- `PROXY_PORT`：反代端口，默认 3080
- `PROXY_USERNAME` / `PROXY_PASSWORD`：两个都设置才启用 Basic Auth

评论区还有人给了 compose 版，把代码目录也挂进去：

```yaml
services:
  dsh-harness:
    image: smanx/deepseek-harness:devtools-latest
    container_name: dsh-harness
    ports:
      - "3080:3080"
    volumes:
      - /home/ly/code:/home/ly/code   # ⚠️ 改成你的代码目录
      - /home/ly/.dsh-home:/root      # ⚠️ 改成你的持久化目录
    restart: unless-stopped
```

## 方案二：runzhliu/deepseek-harness — 安全加固，带 K8s 参考

[runzhliu 的版本](https://github.com/runzhliu/deepseek-harness-docker)（对应 `0.1.1-rc.2`，构建参数可换）走的是另一个思路：不碰 0.0.0.0，端口只绑 `127.0.0.1`，要访问就 SSH 隧道或 `kubectl port-forward`。安全细节给得挺足：非 root（UID 1000）运行、只读根文件系统、drop ALL capabilities、`no-new-privileges`、tini 收尸。额外还带了个 noVNC 浏览器桌面（6080 端口），网页里能直接看到容器桌面。

```bash
docker run --rm --name deepseek-harness \
  --publish 127.0.0.1:3080:3080 \
  --publish 127.0.0.1:6080:6080 \
  --shm-size 1g \
  --mount type=volume,src=dsh-home,dst=/home/node/.dsh \
  --mount type=bind,src="$PWD",dst=/workspace \
  runzhliu/deepseek-harness:0.1.1-rc.2
```

compose 用法是 `docker compose pull` 之后 `DSH_WORKSPACE=/绝对路径 docker compose up -d`。注意工作区目录必须对 UID 1000 可写，否则直接 EACCES。K8s 那边给了单副本 StatefulSet + NetworkPolicy，默认拒绝入站——作者很克制，明确不建议当 HA 扩容用。另有一个预装 dshmarket 的 market 变体（tag `0.1.1-rc.2-market.1`），要用 `compose.market.yaml` 显式启用。

## 怎么选

| | smanx 版 | runzhliu 版 |
| --- | --- | --- |
| 局域网访问 | 直接可用（反代监听 0.0.0.0） | 只绑 127.0.0.1 |
| 访问控制 | 可选 Basic Auth | 无，靠 SSH 隧道 |
| 容器内工具 | devtools 三档 tag | 精简，另有 market 变体 |
| 安全设计 | 常规 | 只读根、非 root、无新增特权 |
| noVNC 桌面 | 无 | 有（6080） |
| K8s | 无 | StatefulSet 参考 |

我的判断：NAS 或家里服务器想给全设备用，smanx 顺手得多，记得把 Basic Auth 打开；runzhliu 适合自己一个人用、对安全默认值有要求的场景，K8s 部署直接抄它的配置。

> [!WARNING] 警告
> dsh 的 Web UI 能执行任意代码，smanx 版的 Basic Auth 还是可选项。不管哪个方案，都别裸奔到公网，要暴露就套反代加 TLS。

## 踩坑记录：本机 0.1.1-rc.2 的 peer 依赖炸弹

回到开头那个报错。`Cannot find package '@deepseek-ai/cordis-plugin-group'`，排查下来不是我的问题，是这版打包的锅：19 个内部包（`dsh-invariants`、`dsh-sandbox`、`dsh-timeout`……）只被声明成 peerDependencies，但没有任何包实际安装它们，其中 `dsh-invariants` 被 168 处引用，等于大半个 dsh 都等着它。

解决办法是把缺的包补装进全局包自己的 `node_modules`（`npm install --no-save` 指着缺失清单装就行），补完 `dsh --version` 立刻活过来。顺手还修了一个插件的 MCP 路径解析问题，这里不展开。

所以如果你自己装 rc.2 也碰到同样的报错，先怀疑依赖没装齐，别急着删配置。社区镜像万一也踩到，`docker exec` 进容器补依赖，思路一样。

## 部署前的几个注意

1. **持久化**：容器内的 `.dsh` 目录（配置、会话、凭据）一定要挂卷，工作区用 bind mount；反过来，别把 `~/.ssh`、云凭据、docker socket 挂进容器。
2. **API Key**：headless 运行用 `DEEPSEEK_API_KEY` 环境变量注入，不要写进镜像层。
3. **架构**：拉取前确认镜像架构和你的设备匹配（NAS 有 x86 也有 arm）。
4. **Windows 本机**想跑 Docker 版需要 Docker Desktop（WSL2），我这种本来就有服务器/NAS 的，直接部署到远端更省心。

## 接下来打算

上面这些命令都来自原帖和项目 README，我还没实机跑过——等我把它在 NAS 上用 `devtools-latest` + Basic Auth 跑起来，再写个实测续篇。

*写于 2026 年 8 月，折腾 dsh 的记录。*

## 图片建议

- 位置：文章开头或方案一节，容器跑起来后浏览器访问 `http://NAS的IP:3080` 的 Web UI 界面截图
- 位置：踩坑记录一节，`ERR_MODULE_NOT_FOUND` 的终端报错截图
- 作用：封面 + 证明服务真的跑起来了 / 报错现场
- 推荐尺寸：封面 1200×630，正文图宽度不超过 1600
