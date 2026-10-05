#!/usr/bin/env node
/**
 * 构建前把独立的私有内容仓库同步到 src/site-content/。
 *
 * 为什么这么干：Vercel 不支持私有 git submodule（官方文档明确写「私有 submodule 会在
 * Build 阶段失败」），所以内容改为「构建时拉取」。思路参考 Shirone 的 content-separation。
 *
 * 为什么目标目录必须在 src/ 下：主题的图片解析（ImageWrapper.astro、schema-image.ts）用
 * import.meta.glob("../../**") 扫描 src/ 内的图片。内容目录若放在仓库根（src/ 之外），
 * 文章封面与配图会全部解析失败、页面显示空图。故落在 src/site-content/。
 *
 * 环境变量：
 *   CONTENT_REPO_URL    带凭证的仓库地址，形如
 *                       https://x-access-token:<TOKEN>@github.com/OWNER/REPO.git
 *                       本地开发不设也行：目录已存在时脚本直接跳过。
 *   CONTENT_REPO_REF    分支或 tag，默认 main
 *   CONTENT_SYNC_FORCE  设为 1 时强制重新拉取（即使目录已存在）
 *
 * 各场景：
 *   Vercel / CF     构建命令前置本脚本（Vercel 走 vercel.json 的 buildCommand；CF 在面板里配）
 *   本地日常        直接 pnpm dev（内容就在本地，脚本自动跳过）
 *   新机器首次      .env 里配好 CONTENT_REPO_URL，再跑 node scripts/sync-content.mjs
 *   内容有更新      在 src/site-content/ 里 git commit + push 即可，不用管主仓库
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DEST = path.join(ROOT, "src", "site-content");
const URL = process.env.CONTENT_REPO_URL ?? "";
const REF = process.env.CONTENT_REPO_REF ?? "main";
const FORCE = process.env.CONTENT_SYNC_FORCE === "1";

const log = (msg) => console.log(`[sync-content] ${msg}`);
/** 日志里永不出现 token */
const redact = (s) => s.replace(/\/\/[^@/]+@/, "//***@");

const hasContent =
	existsSync(DEST) &&
	readdirSync(DEST).some((name) => !name.startsWith("."));

if (hasContent && !FORCE) {
	log("src/site-content/ 已存在，跳过同步（本地开发模式）。");
	process.exit(0);
}

if (!URL) {
	log("src/site-content/ 为空，且没有设置 CONTENT_REPO_URL —— 拿不到内容。");
	log("首次使用请先在 .env 中配置 CONTENT_REPO_URL，再重跑本脚本。");
	process.exit(1);
}

log(`拉取内容：${redact(URL)}（ref=${REF}，浅克隆）`);

try {
	rmSync(DEST, { recursive: true, force: true });
	mkdirSync(path.dirname(DEST), { recursive: true });
	execFileSync("git", ["clone", "--depth=1", "--branch", REF, URL, DEST], {
		stdio: "inherit",
	});
	// 去掉 .git，避免在构建环境里留下嵌套仓库
	rmSync(path.join(DEST, ".git"), { recursive: true, force: true });
	log("同步完成。");
} catch (error) {
	log(`同步失败：${error.message}`);
	process.exit(1);
}
