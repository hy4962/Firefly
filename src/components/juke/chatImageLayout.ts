export interface ChatImageDimensions {
	width: number;
	height: number;
}

const FALLBACK_SIZE = { width: 4, height: 3 };
const MAX_IMAGE_EDGE = 100_000;
const cachedSizes = new Map<string, ChatImageDimensions>();

export function validateChatImageDimensions(
	width?: number,
	height?: number,
): ChatImageDimensions | undefined {
	if (
		width === undefined ||
		height === undefined ||
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		width <= 0 ||
		height <= 0 ||
		width > MAX_IMAGE_EDGE ||
		height > MAX_IMAGE_EDGE
	)
		return undefined;
	return { width, height };
}

export function getChatImageDimensions(
	url: string,
	metadata?: Partial<ChatImageDimensions>,
): ChatImageDimensions | undefined {
	return (
		cachedSizes.get(url) ??
		validateChatImageDimensions(metadata?.width, metadata?.height)
	);
}

export function rememberChatImageDimensions(
	url: string,
	size: ChatImageDimensions,
): void {
	if (cachedSizes.size >= 500 && !cachedSizes.has(url)) {
		const oldest = cachedSizes.keys().next().value;
		if (oldest !== undefined) cachedSizes.delete(oldest);
	}
	cachedSizes.set(url, size);
}

export function chatImageLayout(size?: ChatImageDimensions): {
	ratio: number;
	maxWidthRem: number;
	intrinsicWidth: number;
} {
	const { width, height } = size ?? FALLBACK_SIZE;
	const ratio = width / height;
	return {
		ratio,
		maxWidthRem: Math.min(size ? 14 : 10, 11 * ratio),
		intrinsicWidth: size ? width : Number.POSITIVE_INFINITY,
	};
}

export interface ChatImageResizeDetail {
	apply: () => void;
}
