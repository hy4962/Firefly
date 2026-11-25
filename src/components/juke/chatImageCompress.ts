/**
 * 聊天室图片发送前的画质预处理。
 *
 * - compressed（默认）：等比缩到长边 2048px 以内，重新编码为 JPEG（质量 0.82）；
 *   带透明通道的图转 WebP 以保留透明；GIF / 动图 WebP / APNG / AVIF 原样保留。
 * - original：完全不处理，原文件直传（由用户主动选择“原图”）。
 *
 * Canvas 重编码会顺带剥离 EXIF（含 GPS 定位与拍摄设备信息），
 * 这是默认走压缩的一个额外收益。
 */

import { validateChatImageDimensions } from "./chatImageLayout";

export type ChatImageQuality = "compressed" | "original";

export const CHAT_IMAGE_QUALITY_STORAGE_KEY = "fireflyChatImageQuality";

/** 压缩后的长边上限（px）。聊天窗内最大展示约 14rem，2048 足够覆盖 2x/3x 屏和灯箱查看。 */
const MAX_EDGE = 2048;
/** JPEG 压缩质量（0-1）。0.82 在文字截图和照片之间比较均衡。 */
const JPEG_QUALITY = 0.82;
/** 透明图转 WebP 的质量，略高于 JPEG 以保住边缘细节。 */
const WEBP_QUALITY = 0.9;
/** 已经足够小的 JPEG 不再重编码，避免二次损失。 */
const SKIP_JPEG_BYTES = 200 * 1024;

export interface PreparedChatImage {
	file: File;
	width?: number;
	height?: number;
	originalSize: number;
	size: number;
	/** 是否真的做了缩放或重编码 */
	changed: boolean;
	skipped?: "gif" | "animated" | "avif" | "small" | "no-gain" | "unsupported";
}

export function loadChatImageQuality(): ChatImageQuality {
	if (typeof window === "undefined") return "compressed";
	try {
		return window.localStorage.getItem(CHAT_IMAGE_QUALITY_STORAGE_KEY) ===
			"original"
			? "original"
			: "compressed";
	} catch {
		return "compressed";
	}
}

export function saveChatImageQuality(quality: ChatImageQuality): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(CHAT_IMAGE_QUALITY_STORAGE_KEY, quality);
	} catch {
		// 隐私模式下 localStorage 可能不可写，忽略即可
	}
}

export function formatChatFileSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
	if (bytes >= 1024 * 1024) {
		const mb = bytes / (1024 * 1024);
		return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
	}
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export async function prepareChatImageForSend(
	file: File,
	quality: ChatImageQuality,
): Promise<PreparedChatImage> {
	const originalSize = file.size;
	const unchanged: PreparedChatImage = {
		file,
		originalSize,
		size: originalSize,
		changed: false,
	};

	if (quality === "original" || typeof document === "undefined")
		return unchanged;

	const kind = detectImageKind(file);
	if (!kind) return { ...unchanged, skipped: "unsupported" };
	if (kind.skip) return { ...unchanged, skipped: kind.skip };
	if (kind.type === "image/webp" && (await isAnimatedWebp(file))) {
		return { ...unchanged, skipped: "animated" };
	}

	let decoded: DecodedImage | null = null;
	try {
		decoded = await decodeChatImage(file);
		if (!decoded) return { ...unchanged, skipped: "unsupported" };

		const { width, height } = decoded;
		const validSize = validateChatImageDimensions(width, height);
		if (!validSize) return { ...unchanged, skipped: "unsupported" };

		const needResize = Math.max(width, height) > MAX_EDGE;
		if (
			!needResize &&
			kind.type === "image/jpeg" &&
			originalSize <= SKIP_JPEG_BYTES
		) {
			return { ...unchanged, ...validSize, skipped: "small" };
		}

		const scale = needResize ? MAX_EDGE / Math.max(width, height) : 1;
		const targetWidth = Math.max(1, Math.round(width * scale));
		const targetHeight = Math.max(1, Math.round(height * scale));
		const transparent = kind.alpha && probeTransparency(decoded.source);

		const canvas = document.createElement("canvas");
		canvas.width = targetWidth;
		canvas.height = targetHeight;
		const ctx = canvas.getContext("2d");
		if (!ctx) return { ...unchanged, ...validSize, skipped: "unsupported" };

		if (!transparent) {
			// JPEG 不支持透明，先铺白底，避免透明区域被编码成黑色
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(0, 0, targetWidth, targetHeight);
		}
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";
		ctx.drawImage(decoded.source, 0, 0, targetWidth, targetHeight);

		const targetType = transparent ? "image/webp" : "image/jpeg";
		const blob = await canvasToBlob(
			canvas,
			targetType,
			transparent ? WEBP_QUALITY : JPEG_QUALITY,
		);
		if (!blob) return { ...unchanged, ...validSize, skipped: "unsupported" };

		// 没有缩放且体积没有明显收益时保留原图，避免白重编码一次
		const threshold = needResize ? 1 : 0.92;
		if (blob.size >= originalSize * threshold) {
			return { ...unchanged, ...validSize, skipped: "no-gain" };
		}

		const ext =
			blob.type === "image/webp"
				? "webp"
				: blob.type === "image/png"
					? "png"
					: "jpg";
		const baseName = (file.name.replace(/\.[^/.]+$/, "") || "chat-image").slice(
			0,
			80,
		);
		const processed = new File([blob], `${baseName}.${ext}`, {
			type: blob.type || targetType,
			lastModified: Date.now(),
		});

		return {
			file: processed,
			width: targetWidth,
			height: targetHeight,
			originalSize,
			size: processed.size,
			changed: true,
		};
	} catch {
		return { ...unchanged, skipped: "unsupported" };
	} finally {
		decoded?.release();
	}
}

interface ImageKind {
	type: string;
	/** 是否可能带透明通道 */
	alpha: boolean;
	skip?: PreparedChatImage["skipped"];
}

function detectImageKind(file: File): ImageKind | null {
	const type = (file.type || "").toLowerCase();
	const name = file.name.toLowerCase();
	const is = (mime: string, ext: RegExp) =>
		type === mime || (!!name && ext.test(name));

	if (is("image/gif", /\.gif$/))
		return { type: "image/gif", alpha: true, skip: "gif" };
	if (is("image/apng", /\.apng$/)) {
		return { type: "image/apng", alpha: true, skip: "animated" };
	}
	if (is("image/svg+xml", /\.svg$/)) {
		return { type: "image/svg+xml", alpha: true, skip: "unsupported" };
	}
	if (is("image/avif", /\.avif$/))
		return { type: "image/avif", alpha: true, skip: "avif" };
	if (is("image/png", /\.png$/)) return { type: "image/png", alpha: true };
	if (is("image/webp", /\.webp$/)) return { type: "image/webp", alpha: true };
	if (is("image/jpeg", /\.jpe?g$/)) return { type: "image/jpeg", alpha: false };
	if (is("image/bmp", /\.bmp$/)) return { type: "image/bmp", alpha: false };
	if (type.startsWith("image/")) return { type, alpha: true };
	return null;
}

interface DecodedImage {
	source: CanvasImageSource;
	width: number;
	height: number;
	release: () => void;
}

async function decodeChatImage(file: File): Promise<DecodedImage | null> {
	if (typeof createImageBitmap === "function") {
		try {
			const bitmap = await createImageBitmap(file, {
				imageOrientation: "from-image",
			});
			return {
				source: bitmap,
				width: bitmap.width,
				height: bitmap.height,
				release: () => bitmap.close(),
			};
		} catch {
			// 某些浏览器不支持带 options 的 createImageBitmap，退回 <img> 解码
		}
	}

	const url = URL.createObjectURL(file);
	try {
		const img = await new Promise<HTMLImageElement>((resolve, reject) => {
			const el = new Image();
			el.onload = () => resolve(el);
			el.onerror = () => reject(new Error("image decode failed"));
			el.src = url;
		});
		return {
			source: img,
			width: img.naturalWidth || img.width,
			height: img.naturalHeight || img.height,
			release: () => URL.revokeObjectURL(url),
		};
	} catch {
		URL.revokeObjectURL(url);
		return null;
	}
}

/** 抽样检查透明像素占比，零星一两个半透明像素不当作透明图。 */
function probeTransparency(source: CanvasImageSource): boolean {
	const size = 64;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) return false;
	try {
		ctx.clearRect(0, 0, size, size);
		ctx.drawImage(source, 0, 0, size, size);
		const data = ctx.getImageData(0, 0, size, size).data;
		let transparent = 0;
		for (let i = 3; i < data.length; i += 4) {
			if (data[i] < 200) transparent += 1;
		}
		return transparent / (size * size) > 0.005;
	} catch {
		return false;
	}
}

async function isAnimatedWebp(file: File): Promise<boolean> {
	try {
		const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
		if (head.length < 21) return false;
		const fourCC = String.fromCharCode(head[12], head[13], head[14], head[15]);
		// VP8X 扩展头的 flags 第 2 位（0x02）表示带 ANIM 动画
		return fourCC === "VP8X" && (head[20] & 0x02) !== 0;
	} catch {
		return false;
	}
}

function canvasToBlob(
	canvas: HTMLCanvasElement,
	type: string,
	quality: number,
): Promise<Blob | null> {
	return new Promise((resolve) => {
		canvas.toBlob((blob) => resolve(blob), type, quality);
	});
}
