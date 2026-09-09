---
title: "ComfyUI Prompt Studio"
slug: comfyui-prompt-studio
published: 2026-06-15
order: 100
description: "ComfyUI 提示词库自定义节点插件：10 个安全分类 + 6 个 NSFW 分类，多选弹窗实时预览，一键拼接高质量 prompt tags，支持 Anima 前缀与多节点组合。"
image: "images/comfyui-prompt-studio.png"
status: "published"
tags:
  - ComfyUI
  - Python
  - JavaScript
  - AIGC
link:
  - label: "GitHub"
    icon: "fa7-brands:github"
    value: "https://github.com/hy4962/comfyui-prompt-studio"
---

> 基于 [SD-Anima-Prompt-Studio](https://github.com/Hajimides/SD-Anima-Prompt-Studio) 的提示词库，移植为 ComfyUI 自定义节点插件。

## 安装

1. 将 `comfyui-prompt-studio` 文件夹整个复制到 ComfyUI 的 `custom_nodes/` 目录
2. 重启 ComfyUI
3. 右键画布 → Add Node → **Prompt Studio** 分类下可找到所有节点

## 节点说明

### Prompt Studio (SD/Anima)

主节点，包含 10 个安全分类，每个分类通过**多选弹窗**选择预设提示词组：

| 分类 | 输入名 | 预设数量 | 说明 |
|------|--------|---------|------|
| 质量 | `quality` | 15 | 杰作、电影光照、超清细节、光线追踪等 |
| 风格 | `style` | 10 | 动漫、赛博朋克、水彩、吉卜力、新海诚等 |
| 主体 | `subject` | 8 | 单人女性/男性、双人、百合、多人等 |
| 人物 | `character` | 9 | 小鸟游星野、空崎日奈、圣园未花、兽耳、纹身等 |
| 服装 | `clothing` | 21 | 旗袍、和服、女仆装、JK制服、角色专属服装等 |
| 动作Tag | `action_tag` | 10 | 短标签式动作（站姿、微笑、回眸等） |
| 动作自然语言 | `action_natural` | 10 | 自然语言场景描述（漫步花海、靠窗沉思等） |
| 角度 | `perspective` | 10 | 低角度、俯视、特写、荷兰角等 |
| 构图 | `composition` | 10 | 居中、三分法、黄金分割、景深等 |
| 背景 | `background` | 8 | 城市夜景、奇幻森林、太空星云、中式庭院等 |

**使用方式：** 点击每个分类的按钮 → 弹窗中勾选多个预设 → 底部实时预览实际 prompt tags → Confirm 确认。

输出 `STRING` — 直接连接到 CLIP Text Encode。

### Prompt Studio NSFW

独立的 NSFW 节点，包含 6 个 NSFW 分类，操作方式与上方一致：

| 分类 | 输入名 | 预设数量 |
|------|--------|---------|
| 人物特征 | `nsfw_character` | 4 |
| 服装 | `nsfw_clothing` | 20 |
| 表情反应 | `nsfw_expression` | 3 |
| 动作Tag | `nsfw_action_tag` | 25 |
| 特殊主题 | `nsfw_special` | 8 |
| 动作自然语言 | `nsfw_action_natural` | 15 |

### Anima 前缀 / Anima Prefix

零输入节点，直接输出 Anima 模型前缀：

```
score_9, score_8_up, score_7_up, anime style,
```

通过 **Prompt Concat** 与其他提示词合并即可。

### 合并提示词 / Prompt Concat

将最多 8 个 STRING 输入合并为一个，用 `, ` 连接。用于组合多个 Prompt Studio 节点的输出，或拼接 Anima 前缀。

### 自由输入 / Free Prompt

手动输入任意自定义提示词文本，输出 STRING。

## 工作流示例

### 基础用法

```
Prompt Studio ──→ CLIP Text Encode (正向)
```

一个节点完成全部提示词选择。

### 搭配 Anima 模型

```
Prompt Studio ──┐
Anima Prefix  ──┼──→ Prompt Concat ──→ CLIP Text Encode (正向)
```

### 分组控制

```
Prompt Studio (角色) ──┐
Prompt Studio (场景) ──┼──→ Prompt Concat ──→ Anima Prefix ──→ CLIP Text Encode
Free Prompt (补充)   ──┘
```

### NSFW 搭配

```
Prompt Studio      ──→ Prompt Concat ──→ CLIP Text Encode (正向)
Prompt Studio NSFW ──┘
```

## 文件结构

```
comfyui-prompt-studio/
├── __init__.py          # 插件入口，注册 WEB_DIRECTORY
├── nodes.py             # 节点定义（5 个节点）
├── prompt_data.py       # 提示词库数据（所有分类的 prompt tags）
├── js/
│   └── prompt_studio.js # 前端扩展（多选弹窗 + 实时预览）
├── pyproject.toml       # ComfyUI Manager 元数据
└── README.md
```

## 许可证

MIT License — 基于 [SD-Anima-Prompt-Studio](https://github.com/Hajimides/SD-Anima-Prompt-Studio)
