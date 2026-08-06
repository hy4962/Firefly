---
title: "Docker 一键部署 NewApi API 中转站"
published: 2026-07-28
description: "NewApi 是目前大多数 API 中转站都在用的统一网关管理工具，支持几乎所有主流 AI 模型接入，可对外售卖也可个人使用"
image: ./fengmian.png
tags: [Docker, API, NewApi, 部署, PostgreSQL, Redis]
category: 部署
draft: false
---

现在市面上绝大多数 API 中转站，后台用的都是 NewApi。

NewApi 是一个开源的 AI 接口管理与分发系统，基于 One-API 二次开发，功能比原版更丰富。核心作用是把你手上的各种上游 API（OpenAI、Claude、Gemini、各家国产大模型……）统一收进来，然后对外暴露一个标准的 OpenAI 兼容接口。下游不管接的是什么模型，调用方式完全一样，换模型不用改代码。

用途主要两种：

- **对外售卖**：做中转站，卖 API 额度给用户，有完整的计费、充值、用量统计体系
- **个人使用**：统一管理自己的一堆 key，项目里只配一个 NewApi 地址就够了，不用到处存 key

## NewApi 能做什么

**渠道管理**：把各家上游 API 添加进来，配置模型映射、优先级、负载均衡。同一个模型名可以对应多个渠道，自动故障转移。支持的模型几乎覆盖全球所有主流官方服务，也可以自定义添加任何 OpenAI 兼容的接口。

**令牌系统**：对外发放 API Key（令牌），可以设置额度上限、IP 限制、模型白名单、过期时间。每个令牌的用量独立统计，方便管理多个项目或多个用户。

**用户管理**：支持用户注册、充值、配额管理。商业部署的话有完整的前台界面，用户可以自助充值、查看用量、管理自己的令牌。

**计费系统**：按 token 计费，可以自定义每个模型的倍率。调用日志完整记录，可以按时间、用户、模型、渠道多维度查询。

**监控与告警**：渠道有健康检查，自动禁用失效的 key，支持邮件告警。

## 部署架构

这套 Docker Compose 起了三个容器：

| 容器 | 镜像 | 作用 |
|---|---|---|
| `new-api` | `calciumion/new-api:latest` | 主服务，提供 Web 界面和 API 端点 |
| `new-api-redis` | `redis:latest` | 缓存层，存储会话、速率限制计数等 |
| `new-api-postgres` | `postgres:15` | 主数据库，存储用户、渠道、日志等所有持久化数据 |

Redis 和 PostgreSQL 都配置了持久化，重启不丢数据。

## Docker Compose 配置

创建 `docker-compose.yml` 文件：

```yaml
version: '3.4'

services:
  new-api:
    image: calciumion/new-api:latest
    container_name: new-api
    restart: always
    command: --log-dir /app/logs
    ports:
      - '3000:3000'  # 如果3000端口冲突，可以改成 '3001:3000'
    volumes:
      - /your/data/path:/data          # ⚠️ 改成你自己的路径
      - /your/logs/path:/app/logs      # ⚠️ 改成你自己的路径
    environment:
      # ⚠️ 数据库连接字符串（请确保密码与下方 postgres 的密码一致）
      - SQL_DSN=postgresql://newapi_user:YourStrongPassword123!@postgres:5432/new-api
      - REDIS_CONN_STRING=redis://redis:6379
      - TZ=Asia/Shanghai
      - ERROR_LOG_ENABLED=true
      - BATCH_UPDATE_ENABLED=true
    depends_on:
      - redis
      - postgres
    healthcheck:
      test: ['CMD-SHELL', "wget -q -O - http://localhost:3000/api/status | grep -o '\"success\":\\s*true' || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3

  redis:
    image: redis:latest
    container_name: new-api-redis
    restart: always
    command: redis-server --appendonly yes  # 开启Redis持久化

  postgres:
    image: postgres:15
    container_name: new-api-postgres
    restart: always
    environment:
      POSTGRES_USER: newapi_user
      POSTGRES_PASSWORD: YourStrongPassword123!  # ⚠️ 这里建议修改为你自己的强密码
      POSTGRES_DB: new-api
    volumes:
      - /your/postgres/data:/var/lib/postgresql/data  # ⚠️ 改成你自己的路径，数据持久化防止重启丢失
```

> **部署前必改的三处地方**：
> - `new-api` 的两个 `volumes` 路径换成你自己机器上的实际目录
> - `postgres` 的 `volumes` 路径同上
> - `POSTGRES_PASSWORD` 和 `SQL_DSN` 里的密码必须保持一致，改一处另一处也要跟着改

## 启动服务

在 `docker-compose.yml` 所在目录执行：

```bash
docker-compose up -d
```

构建完后就能直接跑。

![服务启动后的登录页面](./images/screenshot-01.png)

## 初始化配置

首次访问 `http://localhost:3000` 会进入初始化向导，只需要走一遍，后续不会再出现。

**第一步：选择部署模式**

![选择部署模式](./images/screenshot-02.png)

- **个人版**：简化了用户体系，适合自用，没有充值、用户注册等商业功能
- **商业版**：完整功能，有用户注册、充值、计费体系，适合对外提供服务

我是个人使用，所以选了个人。

**第二步：设置管理员账号**

![配置管理员账号](./images/screenshot-03.png)

设置管理员用户名和密码，这是你登录后台的主账号。

**第三步：完成初始化**

![初始化完成](./images/screenshot-04.png)

![进入系统](./images/screenshot-05.png)

初始化完成后进入主界面。

## 后台界面

**用户后台**：普通用户视角，可以查看自己的用量、管理令牌、查看调用记录。

![用户后台](./images/screenshot-07.png)

**管理后台**：管理员视角，可以管理所有渠道、用户、令牌、查看全站日志和统计。

![站点管理后台](./images/screenshot-08.png)

## 接入上游 API

进入管理后台 → **渠道** → 新建渠道，把你的上游 API 添加进来。

![渠道配置页面](./images/screenshot-06.png)

NewApi 内置了几乎全球所有主流官方模型的预设配置，OpenAI、Anthropic、Google、Azure、各家国产大模型都有。添加渠道时选好类型，填入你的 API Key，再配置一下这个渠道支持哪些模型即可。

一个模型可以对应多个渠道，NewApi 会按照你设置的优先级和权重自动做负载均衡，某个渠道挂了会自动切换到下一个。

**添加完渠道后，还需要创建令牌**：管理后台 → **令牌** → 新建令牌，生成一个供调用的 API Key。下游项目的 `base_url` 填你的 NewApi 地址，`api_key` 填这里生成的令牌就行了。

---

配置完成后，所有请求统一走 NewApi 转发。额度管理、调用记录、限流规则都在一个地方，不用再到各个项目里单独维护 key 了。
