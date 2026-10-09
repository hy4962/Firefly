#!/usr/bin/env node
/**
 * 把独立的内容仓库同步到 src/site-content/。
 *
 * 两种来源，按优先级：
 *   1. CONTENT_DIR       本地内容仓库的绝对路径 —— 本地开发用，直接复制，不走网络
 *   2. CONTENT_REPO_URL  远程私有仓库地址 —— 云端构建用，git clone --depth=1
 *
 * 为什么目标目录必须在 src/ 下：主题的图片解析（ImageWrapper.astro、schema-image.ts）用
 * import.meta.glob("../../**") 只扫 src/ 内的图片。内容目录若放在 src/ 之外，
 * 文章封面与配图会全部解析失败、页面渲染成空白。
 *
 * 环境变量：
 *   CONTENT_DIR         本地内容仓库的绝对路径（优先级最高，参考 Shirone 的同类设计）
 *   CONTENT_REPO_URL    带凭证的仓库地址，形如
 *                       https://x-access-token:<TOKEN>@github.com/OWNER/REPO.git
 *   CONTENT_REPO_REF    分支或 tag，默认 main
 *   CONTENT_SYNC_FORCE  设为 1 时，目标目录已有内容也强制重新同步
 *
 * 各场景：
 *   本地开发     .env 里配 CONTENT_DIR，跑 `pnpm dev` 前先 `node scripts/sync-content.mjs`
 *                （想边写边看，另开一个终端跑 `node scripts/watch-content.mjs`）
 *   Vercel / CF  构建命令前置本脚本，靠 CONTENT_REPO_URL
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeContentSafelist } from "./content-safelist.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEST = path.join(ROOT, "src", "site-content");

/** 内容仓库里的这些顶层目录不同步进主题仓 */
const SKIP_NAMES = new Set([".git", ".github", ".vscode", "node_modules"]);

const log = (msg) => console.log(`[sync-content] ${msg}`);
/** 日志里永不出现 token */
const redact = (s) => s.replace(/\/\/[^@/]+@/, "//***@");
/** 去掉 .env / 面板里粘贴时可能带上的引号与首尾空白 */
const clean = (v) => (v ?? "").trim().replace(/^["']|["']$/g, "");

// .env 只是本地便利，云端靠平台环境变量；不存在就跳过
try {
	process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
	/* 没有 .env 文件，忽略 */
}

const DIR = clean(process.env.CONTENT_DIR);
// URL 里的换行会让 git 直接报 "url contains a newline in its path component"，
// Cloudflare 上还会表现为 token 被截断（Invalid username or token），统一清掉空白。
const URL = clean(process.env.CONTENT_REPO_URL).replace(/\s+/g, "");
const REF = clean(process.env.CONTENT_REPO_REF) || "main";
const FORCE = process.env.CONTENT_SYNC_FORCE === "1";

const hasContent =
	existsSync(DEST) &&
	readdirSync(DEST).some((name) => !name.startsWith("."));

/** 本地目录 → 复制（不走网络） */
function syncFromDir(src) {
	if (!existsSync(src)) {
		log(`CONTENT_DIR 指向的目录不存在：${src}`);
		log("检查一下 .env 里的路径写对没有。");
		process.exit(1);
	}
	rmSync(DEST, { recursive: true, force: true });
	mkdirSync(DEST, { recursive: true });
	for (const name of readdirSync(src)) {
		if (SKIP_NAMES.has(name)) continue;
		cpSync(path.join(src, name), path.join(DEST, name), { recursive: true });
	}
}

if (DIR) {
	if (hasContent && !FORCE) {
		log(`src/site-content/ 已存在。要重新同步加 CONTENT_SYNC_FORCE=1，`);
		log(`或者直接跑 node scripts/watch-content.mjs 开增量监听。`);
		// 内容已就位也刷新登记表：它才是「内容里的工具类能不能编译出来」的关键
		writeContentSafelist(ROOT, DEST, log);
		process.exit(0);
	}
	log(`从本地目录同步：${DIR}`);
	syncFromDir(DIR);
	writeContentSafelist(ROOT, DEST, log);
	log("同步完成。");
	process.exit(0);
}

if (hasContent && !FORCE) {
	log("src/site-content/ 已存在，跳过同步（本地开发模式）。");
	writeContentSafelist(ROOT, DEST, log);
	process.exit(0);
}

if (!URL) {
	log("src/site-content/ 为空，且 CONTENT_DIR / CONTENT_REPO_URL 都没设置 —— 拿不到内容。");
	log("本地：在 .env 里配置 CONTENT_DIR；云端：配置 CONTENT_REPO_URL。");
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
	writeContentSafelist(ROOT, DEST, log);
	log("同步完成。");
} catch (error) {
	log(`同步失败：${error.message}`);
	process.exit(1);
}
