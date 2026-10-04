/**
 * 友链卡片封面截图生成器。
 *
 * 给 /friends/ 的每张友链卡片准备一张首页截图，鼠标悬停时在卡片里展开显示。
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
 *   npx tsx scripts/generate-friends-covers.ts          # 只补缺失的
 *   npx tsx scripts/generate-friends-covers.ts --force  # 全部重新截图
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { getEnabledFriends } from "../src/config/friendsConfig";

const OUTPUT_DIR = path.join("public", "assets", "images", "friends", "covers");
/** 构建后 public/ 会映射到站点根，所以清单里存的是这条对外路径 */
const PUBLIC_PREFIX = "/assets/images/friends/covers";
/** 中间产物 png 放系统临时目录，别往仓库里塞 */
const TMP_DIR = path.join(os.tmpdir(), "ff-friends-covers");
const MANIFEST_PATH = path.join("src", "data", "friends-covers.json");

/** 截图视口：宽 1280 保证拿到桌面版布局，高 512 让成品比例贴近卡片里 7rem 高的展示区 */
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 512;
const OUTPUT_WIDTH = 640;
const WEBP_QUALITY = 80;
/** 单站截图超时，够慢站加载，又不至于把整批拖死 */
const SHOT_TIMEOUT_MS = 45000;
/** 站点之间喘口气，别把人家服务器打疼 */
const DELAY_BETWEEN_MS = 500;

const FORCE = process.argv.includes("--force");

const exists = async (filePath: string): Promise<boolean> => {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
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
				path.join(root, entry, "chrome-headless-shell-linux64",
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

/** 域名转文件名：blog.cuteleaf.cn → blog-cuteleaf-cn */
const slugOf = (siteurl: string): string => {
	let host = siteurl;
	try {
		host = new URL(siteurl).hostname;
	} catch {
		// 配置里写的是裸域名时走这里
		host = siteurl.replace(/^https?:\/\//, "").split("/")[0];
	}
	return host.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
};

const shoot = (chrome: string, url: string, pngPath: string): Promise<void> =>
	new Promise((resolve, reject) => {
		const args = [
			"--headless",
			"--no-sandbox",
			"--disable-gpu",
			"--hide-scrollbars",
			"--force-device-scale-factor=1",
			"--disable-lcd-text",
			`--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT}`,
			// 给前端脚本留出渲染时间；虚拟时间预算会等网络空闲，比单纯 sleep 靠谱
			"--virtual-time-budget=10000",
			`--screenshot=${path.resolve(pngPath)}`,
			url,
		];
		execFile(chrome, args, { timeout: SHOT_TIMEOUT_MS }, (error, _stdout, stderr) => {
			if (error) {
				reject(new Error(`${error.message}${stderr ? ` | ${stderr}` : ""}`));
				return;
			}
			resolve();
		});
	});

async function main() {
	const chrome = await findChrome();
	if (!chrome) {
		console.warn(
			"[friends-covers] 找不到 chrome-headless-shell，跳过。可用 CHROME_HEADLESS_SHELL 环境变量指定路径。",
		);
		return;
	}
	console.log(`[friends-covers] 使用浏览器：${chrome}`);

	await fs.mkdir(OUTPUT_DIR, { recursive: true });
	await fs.mkdir(TMP_DIR, { recursive: true });

	const friends = getEnabledFriends();
	const manifest: Record<string, string> = {};
	let shotCount = 0;
	let cachedCount = 0;
	let failedCount = 0;

	for (const friend of friends) {
		const siteurl = friend.siteurl?.trim();
		if (!siteurl || !/^https?:\/\//i.test(siteurl)) {
			console.warn(`[friends-covers] 跳过（地址不合法）：${friend.title}`);
			continue;
		}

		const slug = slugOf(siteurl);
		const webpPath = path.join(OUTPUT_DIR, `${slug}.webp`);
		const publicPath = `${PUBLIC_PREFIX}/${slug}.webp`;

		if (!FORCE && (await exists(webpPath))) {
			manifest[siteurl] = publicPath;
			cachedCount += 1;
			continue;
		}

		const pngPath = path.join(TMP_DIR, `${slug}.png`);
		try {
			await shoot(chrome, siteurl, pngPath);
			await sharp(pngPath)
				.resize({ width: OUTPUT_WIDTH, withoutEnlargement: true })
				.webp({ quality: WEBP_QUALITY, effort: 4 })
				.toFile(webpPath);
			manifest[siteurl] = publicPath;
			shotCount += 1;
			console.log(`[friends-covers] 已截图 ${friend.title} → ${slug}.webp`);
		} catch (error) {
			failedCount += 1;
			console.warn(
				`[friends-covers] 截图失败 ${friend.title}（${siteurl}）：`,
				error instanceof Error ? error.message : error,
			);
		} finally {
			await fs.rm(pngPath, { force: true });
			await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_MS));
		}
	}

	await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
	await fs.writeFile(
		`${MANIFEST_PATH}`,
		`${JSON.stringify(manifest, null, "\t")}\n`,
		"utf8",
	);

	console.log(
		`[friends-covers] 完成：新截图 ${shotCount}，复用缓存 ${cachedCount}，失败 ${failedCount}，共 ${Object.keys(manifest).length} 条写入 ${MANIFEST_PATH}`,
	);
}

main();
