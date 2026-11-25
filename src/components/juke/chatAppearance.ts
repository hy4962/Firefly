import { chatConfig } from "@/config";
import type {
	ChatPanelBgFit,
	ChatPanelSlot,
	ChatWallpaperConfig,
	ChatWallpaperDisplayMode,
	ChatWallpaperItem,
} from "@/types/chatConfig";

export type {
	ChatPanelBgFit,
	ChatPanelSlot,
	ChatWallpaperConfig,
	ChatWallpaperDisplayMode,
	ChatWallpaperItem,
};

export type ChatBackgroundStyle = "wallpaper" | "solid" | "dots" | "glow";
export type ChatDensity = "comfortable" | "compact";
export type ChatFontSize = "sm" | "md" | "lg";
export const CHAT_PANEL_SLOTS = ["left", "center", "right", "input"] as const;

export interface ChatPanelBgTransform {
	mode: ChatWallpaperDisplayMode;
	fit: ChatPanelBgFit;
	opacity: number;
	scale: number;
	offsetX: number;
	offsetY: number;
	blurEnabled: boolean;
	blur: number;
}

export interface ChatAppearanceSettings {
	chatHue: number;
	chatBgStyle: ChatBackgroundStyle;
	/** 四栏各自选中的壁纸 ID（"" 表示不使用图片；线上/本地均可选择） */
	selectedWallpapers: Record<ChatPanelSlot, string>;
	/** 仅本地 DEV 生效：按图片 ID（或 __dev__:<slot>）保存调试参数覆盖 */
	devItemTransforms: Record<string, ChatPanelBgTransform>;
	chatDensity: ChatDensity;
	chatFontSize: ChatFontSize;
}

export const CHAT_APPEARANCE_STORAGE_KEY = "fireflyChatAppearance";
export const SHOW_MUSIC_NOTICES_STORAGE_KEY = "lengxi_chat_show_music_notices";
export const DEFAULT_CHAT_HUE = 175;
export const DEFAULT_CHAT_WALLPAPER_OPACITY = 0.2;
const IS_DEV_ENV = import.meta.env.DEV;

export const DEFAULT_CHAT_PANEL_TRANSFORM: ChatPanelBgTransform = {
	mode: "wallpaper",
	fit: "cover",
	opacity: DEFAULT_CHAT_WALLPAPER_OPACITY,
	scale: 1,
	offsetX: 0,
	offsetY: 0,
	blurEnabled: false,
	blur: 8,
};

export const DEFAULT_STICKER_PANEL_TRANSFORM: ChatPanelBgTransform = {
	mode: "sticker",
	fit: "contain",
	opacity: DEFAULT_CHAT_WALLPAPER_OPACITY,
	scale: 0.6,
	offsetX: 0,
	offsetY: 0,
	blurEnabled: false,
	blur: 8,
};

let runtimeCatalogOverride: ChatWallpaperConfig | null = null;

export function setRuntimeChatWallpaperCatalog(
	next: ChatWallpaperConfig | null,
): void {
	runtimeCatalogOverride = next;
}

export function getChatWallpaperConfig(): ChatWallpaperConfig {
	const base = runtimeCatalogOverride ?? chatConfig.wallpapers;
	return {
		defaultOpacity:
			typeof base?.defaultOpacity === "number" &&
			Number.isFinite(base.defaultOpacity)
				? clampFloat(
						base.defaultOpacity,
						0.05,
						1,
						DEFAULT_CHAT_WALLPAPER_OPACITY,
					)
				: DEFAULT_CHAT_WALLPAPER_OPACITY,
		defaults: {
			left: base?.defaults?.left ?? "",
			center: base?.defaults?.center ?? "",
			right: base?.defaults?.right ?? "",
			input: base?.defaults?.input ?? "",
		},
		items: Array.isArray(base?.items) ? base.items : [],
	};
}

export function getChatWallpaperItems(
	slot?: ChatPanelSlot,
): ChatWallpaperItem[] {
	const items = getChatWallpaperConfig().items;
	return slot ? items.filter((item) => item.slot === slot) : items;
}

export function getChatWallpaperItemById(
	id: string | undefined | null,
	slot?: ChatPanelSlot,
): ChatWallpaperItem | undefined {
	if (!id) return undefined;
	return getChatWallpaperItems(slot).find((item) => item.id === id);
}

export function getDevPreviewTransformKey(slot: ChatPanelSlot): string {
	return `__dev__:${slot}`;
}

export function createDefaultSelectedWallpapers(): Record<
	ChatPanelSlot,
	string
> {
	const cfg = getChatWallpaperConfig();
	return { ...cfg.defaults };
}

export function getDefaultChatAppearance(): ChatAppearanceSettings {
	const cfg = getChatWallpaperConfig();
	return {
		chatHue: DEFAULT_CHAT_HUE,
		chatBgStyle: "wallpaper",
		selectedWallpapers: { ...cfg.defaults },
		devItemTransforms: {},
		chatDensity: "comfortable",
		chatFontSize: "md",
	};
}

export const DEFAULT_CHAT_APPEARANCE: ChatAppearanceSettings =
	getDefaultChatAppearance();

export function isChatPanelSlot(value: unknown): value is ChatPanelSlot {
	return (
		value === "left" ||
		value === "center" ||
		value === "right" ||
		value === "input"
	);
}

function clampInt(
	val: unknown,
	min: number,
	max: number,
	fallback: number,
): number {
	const num = Number(val);
	if (!Number.isFinite(num)) return fallback;
	return Math.min(max, Math.max(min, Math.round(num)));
}

function clampFloat(
	val: unknown,
	min: number,
	max: number,
	fallback: number,
	precision = 2,
): number {
	const num = Number(val);
	if (!Number.isFinite(num)) return fallback;
	const clamped = Math.min(max, Math.max(min, num));
	const factor = 10 ** precision;
	return Math.round(clamped * factor) / factor;
}

export function itemToPanelTransform(
	item: Pick<
		ChatWallpaperItem,
		| "mode"
		| "fit"
		| "opacity"
		| "scale"
		| "offsetX"
		| "offsetY"
		| "blurEnabled"
		| "blur"
	>,
): ChatPanelBgTransform {
	return normalizePanelTransform(item);
}

export function normalizePanelTransform(
	raw?: Partial<ChatPanelBgTransform>,
	fallback: ChatPanelBgTransform = DEFAULT_CHAT_PANEL_TRANSFORM,
): ChatPanelBgTransform {
	const mode: ChatWallpaperDisplayMode =
		raw?.mode === "sticker" || raw?.mode === "wallpaper"
			? raw.mode
			: raw?.fit === "contain"
				? "sticker"
				: fallback.mode;
	const fit: ChatPanelBgFit =
		raw?.fit === "contain" || raw?.fit === "cover"
			? raw.fit
			: mode === "sticker"
				? "contain"
				: "cover";
	const opacity = clampFloat(raw?.opacity, 0.05, 1, fallback.opacity);
	const blurEnabled =
		typeof raw?.blurEnabled === "boolean"
			? raw.blurEnabled
			: typeof raw?.blur === "number"
				? raw.blur > 0
				: fallback.blurEnabled;
	const blur = clampFloat(raw?.blur, 0, 30, fallback.blur, 1);
	return {
		mode,
		fit,
		opacity,
		scale: clampFloat(raw?.scale, 0.15, 3.5, fallback.scale, 3),
		offsetX: clampInt(raw?.offsetX, -200, 200, fallback.offsetX),
		offsetY: clampInt(raw?.offsetY, -200, 200, fallback.offsetY),
		blurEnabled,
		blur,
	};
}

export function loadChatAppearanceSettings(): ChatAppearanceSettings {
	const defaults = getDefaultChatAppearance();
	if (typeof window === "undefined" || !window.localStorage) {
		return defaults;
	}
	try {
		const raw = localStorage.getItem(CHAT_APPEARANCE_STORAGE_KEY);
		if (!raw) {
			return defaults;
		}
		const parsed = JSON.parse(raw) as Partial<ChatAppearanceSettings> & {
			chatWallpaperEnabled?: boolean;
		};
		const chatHue =
			typeof parsed.chatHue === "number" && Number.isFinite(parsed.chatHue)
				? clampInt(parsed.chatHue, 0, 360, DEFAULT_CHAT_HUE)
				: DEFAULT_CHAT_HUE;
		let chatBgStyle: ChatBackgroundStyle = defaults.chatBgStyle;
		if (
			parsed.chatBgStyle === "wallpaper" ||
			parsed.chatBgStyle === "solid" ||
			parsed.chatBgStyle === "dots" ||
			parsed.chatBgStyle === "glow"
		) {
			chatBgStyle = parsed.chatBgStyle;
		} else if (parsed.chatWallpaperEnabled === false) {
			chatBgStyle = "solid";
		}
		const chatDensity: ChatDensity =
			parsed.chatDensity === "compact" ? "compact" : "comfortable";
		const chatFontSize: ChatFontSize =
			parsed.chatFontSize === "sm" || parsed.chatFontSize === "lg"
				? parsed.chatFontSize
				: "md";

		const selectedWallpapers: Record<ChatPanelSlot, string> = {
			...defaults.selectedWallpapers,
		};
		for (const slot of CHAT_PANEL_SLOTS) {
			if (
				selectedWallpapers[slot] &&
				!getChatWallpaperItemById(selectedWallpapers[slot], slot)
			) {
				selectedWallpapers[slot] = "";
			}
		}
		if (
			parsed.selectedWallpapers &&
			typeof parsed.selectedWallpapers === "object"
		) {
			for (const slot of CHAT_PANEL_SLOTS) {
				const candidate = parsed.selectedWallpapers[slot];
				if (candidate === "") {
					selectedWallpapers[slot] = "";
				} else if (
					typeof candidate === "string" &&
					getChatWallpaperItemById(candidate, slot)
				) {
					selectedWallpapers[slot] = candidate;
				}
			}
		}

		const devItemTransforms: Record<string, ChatPanelBgTransform> = {};
		if (
			IS_DEV_ENV &&
			parsed.devItemTransforms &&
			typeof parsed.devItemTransforms === "object"
		) {
			for (const [key, val] of Object.entries(parsed.devItemTransforms)) {
				if (val && typeof val === "object") {
					const preset = getChatWallpaperItemById(key);
					const fallback = preset
						? itemToPanelTransform(preset)
						: DEFAULT_CHAT_PANEL_TRANSFORM;
					devItemTransforms[key] = normalizePanelTransform(val, fallback);
				}
			}
		}

		return {
			chatHue,
			chatBgStyle,
			selectedWallpapers,
			devItemTransforms,
			chatDensity,
			chatFontSize,
		};
	} catch {
		return defaults;
	}
}

export function saveChatAppearanceSettings(
	settings: ChatAppearanceSettings,
): void {
	if (typeof window === "undefined" || !window.localStorage) return;
	try {
		const payload: ChatAppearanceSettings = IS_DEV_ENV
			? settings
			: {
					...settings,
					devItemTransforms: {},
				};
		localStorage.setItem(CHAT_APPEARANCE_STORAGE_KEY, JSON.stringify(payload));
	} catch {
		// 忽略存储写入异常
	}
}

/**
 * 解析指定面板当前应该应用的变换与模糊参数：
 * - 线上环境：严格返回仓库壁纸库中对应图片的固定参数，不接受任何本地覆盖
 * - 本地开发：允许使用 devItemTransforms 对单张图片或拖拽预览图自由调整
 */
export function resolveSlotEffectiveTransform(
	slot: ChatPanelSlot,
	settings: ChatAppearanceSettings,
	hasDevPreview = false,
): ChatPanelBgTransform {
	if (IS_DEV_ENV && hasDevPreview) {
		const previewKey = getDevPreviewTransformKey(slot);
		const override = settings.devItemTransforms?.[previewKey];
		return override
			? normalizePanelTransform(override)
			: { ...DEFAULT_CHAT_PANEL_TRANSFORM };
	}

	const selectedId = settings.selectedWallpapers?.[slot] ?? "";
	const item = getChatWallpaperItemById(selectedId, slot);
	if (!item) {
		return { ...DEFAULT_CHAT_PANEL_TRANSFORM };
	}

	const preset = itemToPanelTransform(item);
	if (IS_DEV_ENV) {
		const override = settings.devItemTransforms?.[item.id];
		if (override) {
			return normalizePanelTransform(override, preset);
		}
	}
	return preset;
}

/**
 * 解析指定面板当前生效的图片 URL（空字符串表示该栏当前不展示图片）
 */
export function resolveSlotWallpaperSrc(
	slot: ChatPanelSlot,
	settings: ChatAppearanceSettings,
	devPreviewUrls?: Partial<Record<ChatPanelSlot, string>>,
): string {
	if (IS_DEV_ENV && devPreviewUrls?.[slot]) {
		return devPreviewUrls[slot] ?? "";
	}
	const selectedId = settings.selectedWallpapers?.[slot] ?? "";
	if (!selectedId) return "";
	return getChatWallpaperItemById(selectedId, slot)?.src ?? "";
}

export function applyChatAppearanceToDocument(
	settings: ChatAppearanceSettings,
	persist = true,
	devPreviewSlots?: Partial<Record<ChatPanelSlot, unknown>>,
): void {
	if (typeof document === "undefined") return;
	const root = document.documentElement;
	const hue = clampInt(settings.chatHue, 0, 360, DEFAULT_CHAT_HUE);

	// 清理旧版属性
	root.removeAttribute("data-chat-scheme");
	root.removeAttribute("data-chat-wallpaper");
	root.style.removeProperty("--chat-panel-blur");
	root.style.removeProperty("--chat-panel-opacity");
	root.style.removeProperty("--chat-panel-radius");
	root.style.removeProperty("--chat-bg-dim");
	root.style.removeProperty("--chat-bg-blur");
	root.style.removeProperty("--chat-bg-opacity");

	root.setAttribute("data-chat-bg", settings.chatBgStyle);
	root.setAttribute("data-chat-density", settings.chatDensity);
	root.setAttribute("data-chat-font-size", settings.chatFontSize);

	for (const slot of CHAT_PANEL_SLOTS) {
		const hasPreview = Boolean(devPreviewSlots?.[slot]);
		const t = resolveSlotEffectiveTransform(slot, settings, hasPreview);
		const effectiveBlur = t.blurEnabled ? t.blur : 0;
		root.setAttribute(`data-chat-bg-${slot}-mode`, t.mode);
		root.setAttribute(`data-chat-bg-${slot}-fit`, t.fit);
		root.style.setProperty(`--chat-bg-${slot}-fit`, t.fit);
		root.style.setProperty(`--chat-bg-${slot}-opacity`, String(t.opacity));
		root.style.setProperty(`--chat-bg-${slot}-scale`, String(t.scale));
		root.style.setProperty(`--chat-bg-${slot}-x`, `${t.offsetX}%`);
		root.style.setProperty(`--chat-bg-${slot}-y`, `${t.offsetY}%`);
		root.style.setProperty(`--chat-bg-${slot}-blur`, `${effectiveBlur}px`);
		root.style.removeProperty(`--chat-bg-${slot}-pos-x`);
		root.style.removeProperty(`--chat-bg-${slot}-pos-y`);
	}

	root.setAttribute("data-chat-custom-hue", "true");
	root.style.setProperty("--chat-hue", String(hue));

	// 聊天页下同步导航栏与全局 --hue，但绝不写入全站 localStorage.hue
	if (root.hasAttribute("data-chat-page")) {
		root.style.setProperty("--hue", String(hue));
		const browserThemeMeta = document.querySelector('meta[name="theme-color"]');
		if (browserThemeMeta) {
			const isDark = root.classList.contains("dark");
			browserThemeMeta.setAttribute(
				"content",
				`hsl(${hue} 12% ${isDark ? "10%" : "96%"})`,
			);
		}
	}

	if (persist) {
		saveChatAppearanceSettings({
			...settings,
			chatHue: hue,
		});
	}
}

export function clearChatAppearanceFromDocument(): void {
	if (typeof document === "undefined") return;
	const root = document.documentElement;
	root.removeAttribute("data-chat-page");
	root.removeAttribute("data-chat-scheme");
	root.removeAttribute("data-chat-custom-hue");
	root.removeAttribute("data-chat-wallpaper");
	root.removeAttribute("data-chat-bg");
	root.removeAttribute("data-chat-density");
	root.removeAttribute("data-chat-font-size");
	root.style.removeProperty("--chat-hue");
	root.style.removeProperty("--chat-bg-opacity");
	root.style.removeProperty("--chat-bg-blur");
	root.style.removeProperty("--chat-bg-dim");
	for (const slot of CHAT_PANEL_SLOTS) {
		root.removeAttribute(`data-chat-bg-${slot}-mode`);
		root.removeAttribute(`data-chat-bg-${slot}-fit`);
		root.style.removeProperty(`--chat-bg-${slot}-fit`);
		root.style.removeProperty(`--chat-bg-${slot}-opacity`);
		root.style.removeProperty(`--chat-bg-${slot}-scale`);
		root.style.removeProperty(`--chat-bg-${slot}-x`);
		root.style.removeProperty(`--chat-bg-${slot}-y`);
		root.style.removeProperty(`--chat-bg-${slot}-blur`);
		root.style.removeProperty(`--chat-bg-${slot}-pos-x`);
		root.style.removeProperty(`--chat-bg-${slot}-pos-y`);
	}
	root.style.removeProperty("--chat-panel-blur");
	root.style.removeProperty("--chat-panel-opacity");
	root.style.removeProperty("--chat-panel-radius");
}

export function syncBgImageAspectRatio(img: HTMLImageElement | null): void {
	if (!img) return;
	if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
		const ratio = img.naturalWidth / img.naturalHeight;
		img.style.setProperty("--img-ratio", String(ratio));
		img.setAttribute("data-has-ratio", "true");
	} else {
		img.removeAttribute("data-has-ratio");
		img.style.removeProperty("--img-ratio");
	}
}

export function trackBgImgAspectRatio(
	img: HTMLImageElement,
	_src?: string,
): { update: (nextSrc?: string) => void; destroy: () => void } {
	const update = (): void => syncBgImageAspectRatio(img);
	img.addEventListener("load", update);
	update();
	return {
		update(_nextSrc?: string): void {
			img.removeAttribute("data-has-ratio");
			img.style.removeProperty("--img-ratio");
			queueMicrotask(update);
		},
		destroy(): void {
			img.removeEventListener("load", update);
		},
	};
}

export interface ParsedMusicNotice {
	rawContent: string;
	actionType: "request" | "skip" | "vote_skip" | "error" | "system";
	actorName?: string;
	songTitle?: string;
	actionLabel: string;
}

export function parseMusicNoticeContent(content: string): ParsedMusicNotice {
	const rawContent = (content || "").trim();
	// 1. 点播：xxx 点播了《歌名》
	const requestMatch = rawContent.match(/^(.*?)\s*点播了[《<](.+?)[》>]/);
	if (requestMatch) {
		return {
			rawContent,
			actionType: "request",
			actorName: requestMatch[1]?.trim() || undefined,
			songTitle: requestMatch[2]?.trim(),
			actionLabel: "点歌",
		};
	}

	// 2. 切播：xxx 切播了《歌名》
	const directSwitchMatch = rawContent.match(/^(.*?)\s*切播了[《<](.+?)[》>]/);
	if (directSwitchMatch) {
		return {
			rawContent,
			actionType: "skip",
			actorName: directSwitchMatch[1]?.trim() || undefined,
			songTitle: directSwitchMatch[2]?.trim(),
			actionLabel: "切播",
		};
	}

	// 3. 切到了下一首：xxx 切到了下一首 (《歌名》)?
	const nextMatch = rawContent.match(
		/^(.*?)\s*切到了下一首(?:[《<](.+?)[》>])?/,
	);
	if (nextMatch) {
		return {
			rawContent,
			actionType: "skip",
			actorName: nextMatch[1]?.trim() || undefined,
			songTitle: nextMatch[2]?.trim() || undefined,
			actionLabel: "切歌",
		};
	}

	// 4. 投票切歌通过
	if (rawContent.includes("投票切歌通过")) {
		const songMatch = rawContent.match(/[《<](.+?)[》>]/);
		return {
			rawContent,
			actionType: "vote_skip",
			songTitle: songMatch?.[1]?.trim(),
			actionLabel: "投票切歌",
		};
	}

	// 5. 播放/音源失败
	if (/(音源解析失败|播放失败)/.test(rawContent)) {
		const songMatch = rawContent.match(/[《<](.+?)[》>]/);
		return {
			rawContent,
			actionType: "error",
			songTitle: songMatch?.[1]?.trim(),
			actionLabel: "播放失败",
		};
	}

	// 其他兜底系统音乐动态
	const genericSong = rawContent.match(/[《<](.+?)[》>]/);
	return {
		rawContent,
		actionType: "system",
		songTitle: genericSong?.[1]?.trim(),
		actionLabel: "点歌台",
	};
}

export function isMusicNoticeContent(content: string): boolean {
	return /(点播了|切到了下一首|投票切歌通过|切播了|音源解析失败|播放失败)/.test(
		content,
	);
}

export function isMusicNoticeMessage(msg: {
	kind: string;
	content: string;
}): boolean {
	return msg.kind === "system" && isMusicNoticeContent(msg.content);
}

export function getStoredMusicNoticesEnabled(): boolean {
	if (typeof window === "undefined" || !window.localStorage) return false;
	try {
		const saved = localStorage.getItem(SHOW_MUSIC_NOTICES_STORAGE_KEY);
		return saved === "1" || saved === "true";
	} catch {
		return false;
	}
}

export function setStoredMusicNoticesEnabled(enabled: boolean): void {
	if (typeof window === "undefined") return;
	try {
		localStorage.setItem(SHOW_MUSIC_NOTICES_STORAGE_KEY, enabled ? "1" : "0");
	} catch {
		// 忽略存储写入异常
	}
	window.dispatchEvent(
		new CustomEvent("chat-music-notices-change", { detail: { enabled } }),
	);
}

// ─── 本地开发模式：四栏壁纸拖拽预览存储（IndexedDB + ObjectURL） ────────────
const DEV_BG_DB_NAME = "fireflyChatDevWallpaperPreview";
const DEV_BG_STORE_NAME = "panels";

function openDevBgDb(): Promise<IDBDatabase | null> {
	if (typeof indexedDB === "undefined") return Promise.resolve(null);
	return new Promise((resolve) => {
		try {
			const req = indexedDB.open(DEV_BG_DB_NAME, 1);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains(DEV_BG_STORE_NAME)) {
					db.createObjectStore(DEV_BG_STORE_NAME);
				}
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
}

export async function saveDevPanelWallpaperPreview(
	slot: ChatPanelSlot,
	file: File,
): Promise<string> {
	const objectUrl = URL.createObjectURL(file);
	const db = await openDevBgDb();
	if (db) {
		await new Promise<void>((resolve) => {
			try {
				const tx = db.transaction(DEV_BG_STORE_NAME, "readwrite");
				tx.objectStore(DEV_BG_STORE_NAME).put(file, slot);
				tx.oncomplete = () => resolve();
				tx.onerror = () => resolve();
			} catch {
				resolve();
			}
		});
		db.close();
	}

	const current = loadChatAppearanceSettings();
	const previewKey = getDevPreviewTransformKey(slot);
	const defaultForSlot: ChatPanelBgTransform =
		slot === "left" || slot === "right"
			? { ...DEFAULT_STICKER_PANEL_TRANSFORM }
			: { ...DEFAULT_CHAT_PANEL_TRANSFORM };
	const next: ChatAppearanceSettings = {
		...current,
		chatBgStyle: "wallpaper",
		devItemTransforms: {
			...current.devItemTransforms,
			[previewKey]: current.devItemTransforms[previewKey] ?? defaultForSlot,
		},
	};
	const allPreviews = await loadDevPanelWallpaperPreviews();
	for (const url of Object.values(allPreviews)) {
		if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
	}
	const previewFlags: Partial<Record<ChatPanelSlot, boolean>> = {
		...Object.fromEntries(Object.keys(allPreviews).map((k) => [k, true])),
		[slot]: true,
	};
	applyChatAppearanceToDocument(next, true, previewFlags);
	window.dispatchEvent(
		new CustomEvent("chatAppearanceChange", { detail: next }),
	);
	window.dispatchEvent(
		new CustomEvent("chat-bg-preview-change", {
			detail: { slot, url: objectUrl, name: file.name },
		}),
	);
	return objectUrl;
}

export async function loadDevPanelWallpaperPreviews(): Promise<
	Partial<Record<ChatPanelSlot, string>>
> {
	const db = await openDevBgDb();
	if (!db) return {};
	const result: Partial<Record<ChatPanelSlot, string>> = {};
	const slots = CHAT_PANEL_SLOTS;
	await new Promise<void>((resolve) => {
		try {
			const tx = db.transaction(DEV_BG_STORE_NAME, "readonly");
			const store = tx.objectStore(DEV_BG_STORE_NAME);
			let pending = slots.length;
			for (const slot of slots) {
				const req = store.get(slot);
				req.onsuccess = () => {
					const val = req.result;
					if (val instanceof Blob) {
						result[slot] = URL.createObjectURL(val);
					}
					if (--pending === 0) resolve();
				};
				req.onerror = () => {
					if (--pending === 0) resolve();
				};
			}
		} catch {
			resolve();
		}
	});
	db.close();
	return result;
}

export async function getDevPanelWallpaperBlob(
	slot: ChatPanelSlot,
): Promise<{ blob: Blob; name: string } | null> {
	const db = await openDevBgDb();
	if (!db) return null;
	const res = await new Promise<{ blob: Blob; name: string } | null>(
		(resolve) => {
			try {
				const tx = db.transaction(DEV_BG_STORE_NAME, "readonly");
				const req = tx.objectStore(DEV_BG_STORE_NAME).get(slot);
				req.onsuccess = () => {
					const val = req.result;
					if (val instanceof Blob) {
						const name =
							val instanceof File && val.name ? val.name : `${slot}.png`;
						resolve({ blob: val, name });
					} else {
						resolve(null);
					}
				};
				req.onerror = () => resolve(null);
			} catch {
				resolve(null);
			}
		},
	);
	db.close();
	return res;
}

export async function clearDevPanelWallpaperPreview(
	slot?: ChatPanelSlot,
): Promise<void> {
	const db = await openDevBgDb();
	if (db) {
		await new Promise<void>((resolve) => {
			try {
				const tx = db.transaction(DEV_BG_STORE_NAME, "readwrite");
				const store = tx.objectStore(DEV_BG_STORE_NAME);
				if (slot) {
					store.delete(slot);
				} else {
					store.clear();
				}
				tx.oncomplete = () => resolve();
				tx.onerror = () => resolve();
			} catch {
				resolve();
			}
		});
		db.close();
	}
	window.dispatchEvent(
		new CustomEvent("chat-bg-preview-change", {
			detail: { slot: slot ?? "all", cleared: true },
		}),
	);
}
