#!/usr/bin/env node
/**
 * 构建前把独立的私有内容仓库同步到 content/。
 *
 * 为什么这么干：Vercel 不支持私有 git submodule（官方文档明确写「私有 submodule 会在
 * Build 阶段失败」），所以内容改为「构建时拉取」。思路参考 Shirone 的 content-separation。
 *
 * 环境变量：
 *   CONTENT_REPO_URL    带凭证的仓库地址，形如
 *                       https://x-access-token:<TOKEN>@github.com/OWNER/REPO.git
 *                       本地开发不设也行：content/ 已存在时脚本直接跳过。
 *   CONTENT_REPO_REF    分支或 tag，默认 main
 *   CONTENT_SYNC_FORCE  设为 1 时强制重新拉取（即使 content/ 已存在）
 *
 * 各场景：
 *   Vercel        vercel.json 的 buildCommand 在 pnpm build 之前调用本脚本
 *   本地日常      直接 pnpm dev（content/ 就在本地，脚本自动跳过）
 *   新机器首次    .env 里配好 CONTENT_REPO_URL，再跑 node scripts/sync-content.mjs
 *   内容有更新    在 content/ 里正常 git commit + push 即可，不用管主仓库
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DEST = path.join(ROOT, "content");
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
	log("content/ 已存在，跳过同步（本地开发模式）。");
	process.exit(0);
}

if (!URL) {
	log("content/ 为空，且没有设置 CONTENT_REPO_URL —— 拿不到内容。");
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
