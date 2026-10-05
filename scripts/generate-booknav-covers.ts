/**
 * 书签导航卡片封面截图生成器。
 *
 * 给 /booknav/ 的每张书签卡片准备一张首页截图，鼠标悬停时在卡片里展开显示。
 * 和 scripts/generate-friends-covers.ts 是同一套路子，只是数据源换成 booknavConfig。
 *
 * 为什么离线预生成而不是实时调第三方截图 API：
 *   1. 实时截图服务（thum.io / mshots 之类）首次请求要 5～15 秒，卡片展览就卡成幻灯片；
 *   2. 本站访客主要在国内，绕一圈国外服务再回来只会更慢；
 *   3. 静态 webp 走本站 CDN，浏览器缓存命中后是零请求。
 *
 * 依赖本机的 chrome-headless-shell（Playwright 自带那套），没有就用系统 Chrome。
 * 想换浏览器：设环境变量 CHROME_HEADLESS_SHELL 指向可执行文件。
 *
 * 用法：
 *   npx tsx scripts/generate-booknav-covers.ts                # 只补缺失的
 *   npx tsx scripts/generate-booknav-covers.ts --force        # 全部重新截图
 *   npx tsx scripts/generate-booknav-covers.ts --limit=5      # 只跑前 5 个（试水用）
 *   npx tsx scripts/generate-booknav-covers.ts --only=github  # 只跑标题/域名含该串的
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { getEnabledBooknavGroups } from "../src/utils/booknav-utils";

const OUTPUT_DIR = path.join("public", "assets", "images", "booknav", "covers");
/** 构建后 public/ 会映射到站点根，所以清单里存的是这条对外路径 */
const PUBLIC_PREFIX = "/assets/images/booknav/covers";
/** 中间产物 png 放系统临时目录，别往仓库里塞 */
const TMP_DIR = path.join(os.tmpdir(), "ff-booknav-covers");
const MANIFEST_PATH = path.join("src", "data", "booknav-covers.json");

/** 截图视口：宽 1280 保证拿到桌面版布局，高 512 让成品比例贴近卡片里 7rem 高的展示区 */
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 512;
const OUTPUT_WIDTH = 640;
const WEBP_QUALITY = 80;
/** 单站截图超时，够慢站加载，又不至于把整批拖死 */
const SHOT_TIMEOUT_MS = 45000;
/** 站点之间喘口气，别把人家服务器打疼 */
const DELAY_BETWEEN_MS = 500;

/**
 * 书签和友链不一样：友链基本一站一个域名，书签里同一个域名会有好几条
 * （比如 github.com 和 github.com/features），只按域名取文件名会互相覆盖，
 * 所以文件名带上路径。下面 slugOf/uniqueSlug 两个函数就是干这个的。
 */

const FORCE = process.argv.includes("--force");
const LIMIT_ARG = process.argv.find((arg) => arg.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Number.parseInt(LIMIT_ARG.split("=")[1] ?? "", 10) : 0;
const ONLY =
	process.argv.find((arg) => arg.startsWith("--only="))?.split("=")[1]?.toLowerCase() ?? "";

const exists = async (filePath: string): Promise<boolean> => {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
};

/** 读已有的清单（还没跑过脚本时返回空对象，不报错） */
const readManifest = async (): Promise<Record<string, string>> => {
	try {
		const raw = await fs.readFile(MANIFEST_PATH, "utf8");
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, string>;
		}
	} catch {
		// 首次运行时文件不存在，属于正常情况
	}
	return {};
};

/** 在 Playwright 缓存目录里找 chromium headless shell，找不到再退回系统 Chrome */
const findChrome = async (): Promise<string | null> => {
	const explicit = process.env.CHROME_HEADLESS_SHELL;
	if (explicit && (await exists(explicit))) return explicit;

	const roots = [
		path.join(process.env.LOCALAPPDATA || "", "ms-playwright"),
		path.join(process.env.USERPROFILE || "", ".cache", "puppeteer"),
	].filter((value) => value.length > 0);

	for (const root of roots) {
		let entries: string[] = [];
		try {
			entries = await fs.readdir(root);
		} catch {
			continue;
		}
		for (const entry of entries.sort().reverse()) {
			const candidates = [
				path.join(
					root,
					entry,
					"chrome-headless-shell-win64",
					"chrome-headless-shell.exe",
				),
				path.join(
					root,
					entry,
					"chrome-headless-shell-linux64",
					"chrome-headless-shell",
				),
			];
			for (const candidate of candidates) {
				if (await exists(candidate)) return candidate;
			}
		}
	}

	const systemChrome = [
		"C:/Program Files/Google/Chrome/Application/chrome.exe",
		"/usr/bin/google-chrome",
		"/usr/bin/chromium",
	];
	for (const candidate of systemChrome) {
		if (await exists(candidate)) return candidate;
	}
	return null;
};

const slugify = (value: string): string =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

/** URL 转文件名基：https://github.com/features → github-com-features */
const slugOf = (raw: string): string => {
	let host = raw;
	let pathname = "";
	try {
		const parsed = new URL(raw);
		host = parsed.hostname;
		pathname = parsed.pathname;
	} catch {
		// 配置里写的是裸域名（没带协议）时走这里
		const rest = raw.replace(/^https?:\/\//, "");
		host = rest.split("/")[0] ?? rest;
		pathname = rest.split("/").slice(1).join("/");
	}
	const hostPart = slugify(host);
	const pathPart = slugify(pathname);
	const joined = pathPart ? `${hostPart}-${pathPart}` : hostPart;
	return (joined || "site").slice(0, 80).replace(/-$/, "");
};

/** 同一个文件名基被两个不同 URL 抢时，后者补 -2 / -3…，保证清单和产物一一对应 */
const uniqueSlug = (
	base: string,
	url: string,
	used: Map<string, string>,
): string => {
	const taken = used.get(base);
	if (taken === undefined || taken === url) {
		used.set(base, url);
		return base;
	}
	let n = 2;
	while (true) {
		const candidate = `${base}-${n}`;
		const owner = used.get(candidate);
		if (owner === undefined || owner === url) {
			used.set(candidate, url);
			return candidate;
		}
		n += 1;
	}
};

/**
 * 用真实的 Chrome UA。chrome-headless-shell 默认 UA 里带 HeadlessChrome，
 * 不少站点（Cloudflare 那一批）会直接回验证页，截出来就是一张白图。
 */
const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/**
 * 站点拦截 / 出错的页面特征。
 *
 * 为什么需要这一步：有些站点（Cloudflare 那一批）会回一张排版完整的 403 页，
 * 截出来是张白底黑字的「正常图」，悬停展开就露馅了。chrome 的 --dump-dom
 * 能把渲染后的 HTML 打到 stdout，跟 --screenshot 可以同时用，一次请求两样都拿，
 * 所以顺手校验一下，命中就当这次截图失败、不留产物。
 */
const BLOCKED_MARKERS = [
	/the request could not be satisfied/i,
	/\b403\s+error\b/i,
	/\b40[0-9]\s+error\b/i,
	/you have been blocked/i,
	/attention required/i,
	/just a moment\.\.\./i,
	/enable javascript and cookies to continue/i,
	/access denied/i,
	/checking your browser before accessing/i,
	/verify you are human/i,
];

const looksBlocked = (dom: string): boolean => {
	if (!dom) return false;
	// 只看开头一段：正文里偶尔出现「access denied」不算，标题/首屏出现才算
	const head = dom.slice(0, 4000);
	return BLOCKED_MARKERS.some((pattern) => pattern.test(head));
};

const shoot = (chrome: string, url: string, pngPath: string): Promise<string> =>
	new Promise((resolve, reject) => {
		const args = [
			"--headless",
			"--no-sandbox",
			"--disable-gpu",
			"--hide-scrollbars",
			"--force-device-scale-factor=1",
			"--disable-lcd-text",
			`--user-agent=${USER_AGENT}`,
			`--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT}`,
			// 给前端脚本留出渲染时间；虚拟时间预算会等网络空闲，比单纯 sleep 靠谱
			"--virtual-time-budget=10000",
			`--screenshot=${path.resolve(pngPath)}`,
			// 顺带把渲染后的 DOM 打出来做拦截校验，见上面的 BLOCKED_MARKERS
			"--dump-dom",
			url,
		];
		execFile(
			chrome,
			args,
			{ timeout: SHOT_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error) {
					reject(new Error(`${error.message}${stderr ? ` | ${stderr}` : ""}`));
					return;
				}
				resolve(stdout || "");
			},
		);
	});

async function main() {
	const chrome = await findChrome();
	if (!chrome) {
		console.warn(
			"[booknav-covers] 找不到 chrome-headless-shell，跳过。可用 CHROME_HEADLESS_SHELL 环境变量指定路径。",
		);
		return;
	}
	console.log(`[booknav-covers] 使用浏览器：${chrome}`);

	await fs.mkdir(OUTPUT_DIR, { recursive: true });
	await fs.mkdir(TMP_DIR, { recursive: true });

	// 用页面同一套筛选（enabled !== false，按 weight 排序），保证截图范围和 /booknav/ 渲染出来的完全一致
	const targets: Array<{ title: string; url: string }> = [];
	const seenUrls = new Set<string>();
	for (const group of getEnabledBooknavGroups()) {
		for (const item of group.items) {
			const url = item.url?.trim();
			if (!url || seenUrls.has(url)) continue;
			if (ONLY && !`${item.title} ${url}`.toLowerCase().includes(ONLY)) continue;
			seenUrls.add(url);
			targets.push({ title: item.title, url });
		}
	}
	const queue = LIMIT > 0 ? targets.slice(0, LIMIT) : targets;

	/**
	 * 清单做「读旧 + 合并」而不是每次重写：
	 * --only= 只跑单个站点时要保留其余条目，否则一份完整清单会被一条覆盖掉。
	 * 只有在跑完整一遍（没有 --only / --limit）时才把不在配置里的旧条目清掉。
	 */
	const manifest: Record<string, string> = { ...(await readManifest()) };
	const used = new Map<string, string>();
	const failed: string[] = [];
	let shotCount = 0;
	let cachedCount = 0;

	// 老的产物文件名要占住，否则同一批里新算出来的 slug 可能撞上已有文件
	for (const [url, publicPath] of Object.entries(manifest)) {
		const name = path.basename(publicPath).replace(/\.webp$/, "");
		if (name) used.set(name, url);
	}

	for (const target of queue) {
		if (!/^https?:\/\//i.test(target.url)) {
			console.warn(`[booknav-covers] 跳过（地址不合法）：${target.title} → ${target.url}`);
			continue;
		}

		const slug = uniqueSlug(slugOf(target.url), target.url, used);
		const webpPath = path.join(OUTPUT_DIR, `${slug}.webp`);
		const publicPath = `${PUBLIC_PREFIX}/${slug}.webp`;

		if (!FORCE && (await exists(webpPath))) {
			manifest[target.url] = publicPath;
			cachedCount += 1;
			continue;
		}

		const pngPath = path.join(TMP_DIR, `${slug}.png`);
		try {
			const dom = await shoot(chrome, target.url, pngPath);
			if (looksBlocked(dom)) {
				throw new Error("拿到的是站点拦截 / 错误页，已丢弃");
			}
			// 纯色空白页（整页一个颜色）也当失败，别留一张空图
			const stats = await sharp(pngPath).stats();
			if (stats.channels.every((channel) => channel.stdev < 3)) {
				throw new Error("截图几乎是纯色空白页，已丢弃");
			}
			await sharp(pngPath)
				.resize({ width: OUTPUT_WIDTH, withoutEnlargement: true })
				.webp({ quality: WEBP_QUALITY, effort: 4 })
				.toFile(webpPath);
			manifest[target.url] = publicPath;
			shotCount += 1;
			console.log(`[booknav-covers] 已截图 ${target.title} → ${slug}.webp`);
		} catch (error) {
			failed.push(
				`${target.title}（${target.url}）：${error instanceof Error ? error.message : error}`,
			);
			console.warn(
				`[booknav-covers] 截图失败 ${target.title}（${target.url}）：`,
				error instanceof Error ? error.message : error,
			);
		} finally {
			await fs.rm(pngPath, { force: true });
			await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_MS));
		}
	}

	// 完整跑一遍 → 以配置为准裁掉已删除书签的旧条目
	if (!ONLY && LIMIT <= 0) {
		const known = new Set(targets.map((target) => target.url));
		for (const url of Object.keys(manifest)) {
			if (!known.has(url)) delete manifest[url];
		}
	}

	await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
	await fs.writeFile(
		`${MANIFEST_PATH}`,
		`${JSON.stringify(manifest, null, "\t")}\n`,
		"utf8",
	);

	console.log(
		`[booknav-covers] 完成：新截图 ${shotCount}，复用缓存 ${cachedCount}，失败 ${failed.length}，共 ${Object.keys(manifest).length} 条写入 ${MANIFEST_PATH}`,
	);
	if (failed.length > 0) {
		console.log("[booknav-covers] 失败清单（下次可以 --only= 单独补）：");
		for (const line of failed) console.log(`  - ${line}`);
	}
}

main();
