/**
 * 壁纸压缩脚本（本地工具，不进构建流程）
 * 用法：npx tsx scripts/compress-wallpapers.ts
 *
 * 将 src/assets/images/DesktopWallpaper 和 MobileWallpaper 下的
 * png/jpg/webp 全部转为 AVIF，桌面端限宽 1920px，移动端限宽 1080px。
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const DIRS = [
	{ dir: "src/assets/images/DesktopWallpaper", maxWidth: 1920 },
	{ dir: "src/assets/images/MobileWallpaper", maxWidth: 1080 },
];

const EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);
const QUALITY = 90;
// q85 压缩后文件大小范围：66KB-162KB，q60 为 46KB-114KB，存在重叠无法通过文件大小区分
// 强制重新压缩所有文件（设为 true 以应用当前 QUALITY 设置）
const FORCE = true;

async function main() {
	let totalBefore = 0;
	let totalAfter = 0;

	for (const { dir, maxWidth } of DIRS) {
		if (!existsSync(dir)) continue;
		const files = (await readdir(dir)).filter((f) =>
			EXTS.has(path.extname(f).toLowerCase()),
		);

		for (const file of files) {
			const filePath = path.join(dir, file);
			const before = (await stat(filePath)).size;

			// 已压缩过的 webp 直接跳过（幂等，可重复运行）
			// 注意：如需强制重新压缩（如更改质量设置），请设置 FORCE = true
			if (!FORCE && path.extname(file).toLowerCase() === ".webp" && before < 800 * 1024) {
				console.log(`跳过（已是小体积 webp）: ${file}`);
				totalBefore += before;
				totalAfter += before;
				continue;
			}

			const img = sharp(filePath);
			const meta = await img.metadata();
			const width = meta.width ?? maxWidth;
			const resizeWidth = Math.min(width, maxWidth);

			const outPath = path.join(
				dir,
				`${path.basename(file, path.extname(file))}.webp`,
			);
			const buf = await img
				.resize({ width: resizeWidth, withoutEnlargement: true })
				.webp({ quality: QUALITY })
				.toBuffer();

			await writeFile(outPath, buf);
			if (outPath !== filePath) await unlink(filePath);

			totalBefore += before;
			totalAfter += buf.length;
			console.log(
				`${file} (${width}px, ${(before / 1024).toFixed(0)}KB) -> ${path.basename(outPath)} (${resizeWidth}px, ${(buf.length / 1024).toFixed(0)}KB)`,
			);
		}
	}

	console.log(
		`\n总计: ${(totalBefore / 1024 / 1024).toFixed(1)}MB -> ${(totalAfter / 1024 / 1024).toFixed(1)}MB`,
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
