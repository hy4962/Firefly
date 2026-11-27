// ESA 构建产物有 2000 文件上限。Svelte 茶室上线后，旧 chat.js 专用的
// /assets/emojis 和当前页面未启用的贴纸包仍会被 Astro 原样拷进 dist/。
// 这里在 astro build 之后按真实引用裁掉它们，而不是盲删整个目录。

import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import { resolveSiteRoot } from "./site-root";

const DIST_DIR = resolveSiteRoot();
const CHAT_PAGE = path.join(process.cwd(), "src/pages/chat.astro");

/** 递归数文件；路径不存在返回 0。 */
async function countFiles(target: string): Promise<number> {
	try {
		const stat = await fs.stat(target);
		if (!stat.isDirectory()) return 1;
		return (await glob("**/*", { cwd: target, nodir: true, dot: true })).length;
	} catch {
		return 0;
	}
}

async function remove(relPath: string): Promise<number> {
	const target = path.join(DIST_DIR, relPath);
	const count = await countFiles(target);
	if (!count) return 0;
	await fs.rm(target, { recursive: true, force: true });
	console.log(`   ✂ ${relPath} (${count} files)`);
	return count;
}

/** 只保留 src/pages/chat.astro 实际传给 ChatApp 的贴纸包。 */
async function unusedStickerPacks(): Promise<string[]> {
	let source = "";
	try {
		source = await fs.readFile(CHAT_PAGE, "utf8");
	} catch {
		return [];
	}
	const configured = source.match(/const stickerPackUrls = \[([^\]]*)\]/)?.[1] || "";
	const enabled = new Set(
		[...configured.matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/^\/+/, "")),
	);
	const packs = await glob("assets/stickers/*", { cwd: DIST_DIR, posix: true });
	const unused: string[] = [];
	for (const pack of packs) {
		const stat = await fs.stat(path.join(DIST_DIR, pack));
		if (stat.isDirectory() && !enabled.has(pack)) unused.push(pack);
	}
	return unused;
}

async function main() {
	console.log("🧹 Pruning unused chat assets in dist/...");
	let removed = 0;

	// 旧 chat.js 已经没有页面引用；它专用的 qq/bilibili 表情包不必进产物。
	const html = await glob("**/*.html", { cwd: DIST_DIR, posix: true });
	let legacyChatReferenced = false;
	for (const file of html) {
		const content = await fs.readFile(path.join(DIST_DIR, file), "utf8");
		if (content.includes("/assets/js/chat.js")) {
			legacyChatReferenced = true;
			break;
		}
	}
	if (!legacyChatReferenced) {
		removed += await remove("assets/emojis");
		removed += await remove("assets/js/chat.js");
	}

	for (const pack of await unusedStickerPacks()) removed += await remove(pack);

	const remaining = await glob("**/*", {
		cwd: DIST_DIR,
		nodir: true,
		dot: true,
		posix: true,
	});
	console.log(
		`✨ Removed ${removed} unused chat files; dist file count: ${remaining.length}`,
	);
}

main().catch((err) => {
	console.error("❌ Failed to prune unused chat assets:", err);
	process.exit(1);
});
