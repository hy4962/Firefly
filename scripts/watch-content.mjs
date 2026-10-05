#!/usr/bin/env node
/**
 * 监视本地内容仓库，改动即时增量同步到 src/site-content/。
 *
 * 配合 `pnpm dev` 双终端使用：保存 Markdown 后 dev server 会自己热重载，
 * 体验跟单仓开发一致，不用再手动 pull 或者重跑同步。
 *
 * 用法：
 *   终端 1   pnpm dev
 *   终端 2   node scripts/watch-content.mjs
 *
 * 路径来自 .env 的 CONTENT_DIR（和 sync-content.mjs 同一份配置）。
 * 只同步变动的单个文件，不做全量复制，所以启动后占用很低。
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEST = path.join(ROOT, "src", "site-content");
const SKIP_NAMES = new Set([".git", ".github", ".vscode", "node_modules"]);

const log = (msg) => console.log(`[watch-content] ${msg}`);
const clean = (v) => (v ?? "").trim().replace(/^["']|["']$/g, "");

try {
	process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
	/* 没有 .env 文件，忽略 */
}

const SRC = clean(process.env.CONTENT_DIR);

if (!SRC) {
	log("没有设置 CONTENT_DIR。请在项目根目录的 .env 里写上内容仓库的绝对路径：");
	log('  CONTENT_DIR="D:/Users/XOS/Documents/GitHub/firefly-content"');
	process.exit(1);
}

if (!existsSync(SRC)) {
	log(`CONTENT_DIR 指向的目录不存在：${SRC}`);
	process.exit(1);
}

/** 同步单个文件（相对路径） */
function syncOne(rel) {
	const top = rel.split(/[\\/]/)[0];
	if (SKIP_NAMES.has(top)) return;

	const from = path.join(SRC, rel);
	const to = path.join(DEST, rel);

	try {
		if (existsSync(from)) {
			if (statSync(from).isDirectory()) return;
			mkdirSync(path.dirname(to), { recursive: true });
			copyFileSync(from, to);
			log(`  ↑ ${rel}`);
		} else if (existsSync(to)) {
			rmSync(to, { recursive: true, force: true });
			log(`  ✗ ${rel}（已删除）`);
		}
	} catch (error) {
		log(`  同步 ${rel} 失败：${error.message}`);
	}
}

// 同一批保存往往触发多次事件，攒一下再处理
let timer = null;
const pending = new Set();

function flush() {
	for (const rel of pending) syncOne(rel);
	pending.clear();
}

log(`监视目录：${SRC}`);
log(`同步到：  ${DEST}`);
log("（Ctrl+C 退出）");

watch(SRC, { recursive: true }, (_event, filename) => {
	if (!filename) return;
	const top = String(filename).split(/[\\/]/)[0];
	if (SKIP_NAMES.has(top)) return;
	pending.add(String(filename));
	clearTimeout(timer);
	timer = setTimeout(flush, 150);
});
