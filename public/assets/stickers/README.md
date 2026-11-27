# 网站表情贴纸资源维护规范（Stickers & Emojis）

本目录存放博客评论系统（Waline）与实时聊天室所使用的所有表情贴纸资产。

---

## 1. 现存表情包分类

| 包名 (Pack) | 前缀 (Prefix) | 图片格式 | 默认尺寸 | 命名习惯 | 典型用途 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `qq/` | `qq_` | `.gif` | 22x22 | 英文键名（如 `qq_clap.gif`） | 聊天室短码、评论行内小表情 |
| `miku/` | `miku_` | `.webp` | 72x72 / 80x80 | 中文键名（如 `miku_抱爱心.webp`） | 初音未来高清大贴纸、情绪反馈 |
| `bmoji/` | `bmoji_` | `.png` | 22x22 | 英文键名（如 `bmoji_doge.png`） | B 站经典小黄脸表情 |

### `lottie/` 目录（自动生成，不要手改）

`lottie/` 存放聊天室 Lottie 动态表情的 **Matrix 动图预览**（`<name>.gif`，192×192、约 15fps，与互联大厅其他站点一致）。站内渲染用的是 Lottie JSON，Matrix 贴纸只能带一张图片，所以需要这份由 JSON 离线渲染出来的动图，供聊天网关上传成 `mxc://`。

- 生成：在主仓运行 `pnpm lottie:render`（`scripts/render-lottie-stickers.mjs`，需要本机 Chrome/Edge 与 ffmpeg），只补缺失的；`--force` 全量重渲，`--only=aini,caigou` 指定表情，`--format=webp` 可切回有损 WebP。
- 何时重跑：`src/components/pages/chat/stickerLoader.ts` 的 `LOTTIE_SPRITE_KEYS` 增删或顺序变化后。
- 不要手动编辑这些 gif，也不要单独提交其中几个——它们是一次性产物，重跑脚本即可整体重建。

---

## 2. 新增或修改表情的四步 SOP（开发者与 AI 必须严格遵守）

为了防止用户在聊天室输入快捷短码或评论系统发出邮件时，由于文件名不匹配导致 **HTTP 404 裂图问号 `[?]`**（特别是 Gmail 的 Google Image Proxy 会将 404 图片渲染为问号图标），新增表情时必须同时完成以下 4 步：

### 第 1 步：放置图片资源
- 放入对应包目录下，如 `public/assets/stickers/miku/miku_<名称>.webp`。
- 文件名必须严格遵循 `<prefix><名称>.<ext>` 规则。

### 第 2 步：更新目录下的 `info.json`
- 将新增的名称加入 `items` 数组中。
- 前端 Waline 表情面板与聊天室面板将根据 `info.json` 自动渲染选择器。

### 第 3 步：【核心关键】同步更新邮件系统白名单与别名
- 打开邮件生成模块：`D:\Projects\waline-comment-system\src\utils\mailer.ts`。
- **加入白名单集合**：
  - QQ: `KNOWN_QQ_EMOJIS`
  - 初音: `KNOWN_MIKU_STICKERS`
  - B站: `KNOWN_BMOJI`
- **加入常用口语/中文别名映射**（强烈推荐）：
  用户手敲快捷短码时经常使用口语（如习惯打 `:miku_给心:` 或 `:miku_比心:`，但实际文件名是 `miku_抱爱心`；又如习惯打 `:qq_鼓掌:`，但文件名是 `qq_clap`）。
  在对应的 `*_NAME_ALIAS` 字典中添加映射，系统会自动将其重定向至合法有效的图片 URL：
  ```typescript
  const MIKU_NAME_ALIAS: Record<string, string> = {
      "给心": "抱爱心",
      "心": "抱爱心",
      "爱心": "抱爱心",
      // 在此处添加新别名...
  };
  ```

### 第 4 步：双仓同步提示
- 本目录在内容仓（`d:\Projects\lengxiqwq-site-content\public\assets\stickers\`）与主代码仓（`d:\Projects\lengxiqwq-site\public\assets\stickers\`）均需保留。
- 建议优先在内容仓维护，通过 `pnpm dev` 或构建时自动同步至主代码仓。
