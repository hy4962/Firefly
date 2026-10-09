#!/usr/bin/env node
/**
 * 把内容文件里用到的 class 名登记到 src/config/content-tailwind-safelist.txt。
 *
 * 为什么需要这个文件：
 *   src/site-content/ 在 .gitignore 里，而 Tailwind v4 的自动内容探测会跳过被 git
 *   忽略的路径。于是「只出现在内容文件、主题源码从没用过」的工具类永远不会被编译成
 *   CSS —— 类名照旧挂在 HTML 上、规则却不存在，视觉上表现为静默失效。
 *
 *   实际踩坑：friends.mdx 的 whitespace-pre-wrap / break-words / px-3.5 全部没生成，
 *   申请模板被挤成一整行、文字还贴着边框。诊断手法是直接拿 @tailwindcss/oxide 的
 *   Scanner 扫项目根目录，看候选类里有没有它。
 *
 * 解法：把内容文件里的 class 名汇总到一个**没有被 git 忽略**的文件里，Tailwind 就能
 * 扫到（已验证 oxide 的 Scanner 会收录 src/config/ 下的 .txt / .html）。
 *
 * 这个文件是构建产物式的登记表，由 sync-content.mjs 与 watch-content.mjs 自动重写，
 * 不要手改。生成失败也不该中断构建：沿用上一份登记表即可。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** 这些顶层目录内容不同步、也不扫描 */
const SKIP_NAMES = new Set([".git", ".github", ".vscode", "node_modules"]);

/** 登记表的落点：故意放在未被忽略的 src/config/ 下 */
const SAFELIST_REL = path.join("src", "config", "content-tailwind-safelist.txt");

const HEADER = [
	"# 自动生成，勿手改 —— 由 scripts/content-safelist.mjs 重写。",
	"# 起因：src/site-content/ 被 git 忽略，Tailwind 的自动内容探测会跳过它，",
	"# 只出现在内容文件里的工具类因此不会被编译出来。这里把它们登记成可扫描的候选。",
];

/**
 * 扫描内容目录里的 .md / .mdx，抽出 class="..." 与 className="..." 里的类名。
 * @param {string} contentDir  内容目录（通常是 <root>/src/site-content）
 * @returns {string[]} 去重排序后的类名
 */
export function collectContentClasses(contentDir) {
	const tokens = new Set();

	const walk = (dir) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (!SKIP_NAMES.has(entry.name) && !entry.name.startsWith(".")) {
					walk(path.join(dir, entry.name));
				}
				continue;
			}
			if (!/\.mdx?$/i.test(entry.name)) continue;

			let text;
			try {
				text = readFileSync(path.join(dir, entry.name), "utf8");
			} catch {
				continue;
			}
			for (const match of text.matchAll(/(?:class|className)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
				for (const token of (match[1] ?? match[2] ?? "").split(/\s+/)) {
					if (token) tokens.add(token);
				}
			}
		}
	};

	if (existsSync(contentDir)) walk(contentDir);
	return [...tokens].sort();
}

/**
 * 生成 / 刷新登记表。
 * @param {string} root      项目根目录
 * @param {string} contentDir 内容目录
 * @param {(msg: string) => void} [log]
 * @returns {number} 登记的类名数量（失败返回 -1）
 */
export function writeContentSafelist(root, contentDir, log = console.log) {
	const target = path.join(root, SAFELIST_REL);
	try {
		const tokens = collectContentClasses(contentDir);
		const body = [...HEADER, `# 共 ${tokens.length} 个。`, "", ...tokens, ""].join("\n");
		writeFileSync(target, body, "utf8");
		log(`内容类名登记表：${tokens.length} 个 → ${SAFELIST_REL.split(path.sep).join("/")}`);
		return tokens.length;
	} catch (error) {
		log(`刷新内容类名登记表失败（不影响构建，沿用上一份）：${error.message}`);
		return -1;
	}
}
