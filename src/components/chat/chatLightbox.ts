type FancyboxType = typeof import("@fancyapps/ui").Fancybox;

export interface ChatLightboxImageItem {
	src: string;
}

let cachedCssUrls: string[] = [];
let cachedFancyboxPromise: Promise<FancyboxType> | null = null;
let loadedFancyboxRef: FancyboxType | null = null;
let swupCleanupBound = false;
let openSeq = 0;
let customSourceProvider: (() => ChatLightboxImageItem[]) | null = null;

/**
 * Register a memory-backed image provider (used by virtualized ChatWindow
 * so off-screen chat images remain navigable in the lightbox).
 */
export function setChatLightboxSourceProvider(
	provider: (() => ChatLightboxImageItem[]) | null,
): void {
	customSourceProvider = provider;
}

function bindSwupCleanupOnce(): void {
	if (swupCleanupBound || typeof document === "undefined") return;
	swupCleanupBound = true;
	document.addEventListener("swup:visit:start", () => {
		openSeq += 1;
		if (loadedFancyboxRef) {
			try {
				loadedFancyboxRef.destroy();
			} catch {
				// Ignore cleanup errors on route transition
			}
		}
	});
}

function waitForStylesheet(link: HTMLLinkElement): Promise<void> {
	return new Promise((resolve) => {
		if (link.sheet) {
			resolve();
			return;
		}
		const timer = window.setTimeout(resolve, 1500);
		const done = () => {
			window.clearTimeout(timer);
			resolve();
		};
		link.addEventListener("load", done, { once: true });
		link.addEventListener("error", done, { once: true });
	});
}

async function ensureFancyboxStyles(): Promise<void> {
	if (typeof document === "undefined") return;
	if (cachedCssUrls.length === 0) {
		const [fancyboxCss, customCss] = await Promise.all([
			import("@fancyapps/ui/dist/fancybox/fancybox.css?url"),
			import("@/styles/fancybox-custom.css?url"),
		]);
		cachedCssUrls = [fancyboxCss.default, customCss.default].filter(
			(u): u is string => typeof u === "string" && u.length > 0,
		);
	}
	const pendingLoads: Promise<void>[] = [];
	for (const url of cachedCssUrls) {
		if (!document.head.querySelector(`link[href="${url}"]`)) {
			const link = document.createElement("link");
			link.rel = "stylesheet";
			link.href = url;
			pendingLoads.push(waitForStylesheet(link));
			document.head.appendChild(link);
		}
	}
	if (pendingLoads.length > 0) {
		await Promise.all(pendingLoads);
	}
}

async function importFancyboxWithDevFallback(): Promise<FancyboxType> {
	try {
		const mod = await import("@fancyapps/ui");
		if (mod?.Fancybox) return mod.Fancybox;
	} catch (primaryErr) {
		// Vite dev server may return 504 (Outdated Optimize Dep) for @fancyapps/ui;
		// fall back directly to the ESM entrypoint beside the resolved fancybox.css URL.
		const cssUrl = cachedCssUrls.find((u) => u.includes("fancybox.css"));
		if (import.meta.env.DEV && cssUrl) {
			const esmUrl = cssUrl.replace(/fancybox\.css(?:\?.*)?$/, "index.js");
			const mod = (await import(/* @vite-ignore */ esmUrl)) as {
				Fancybox?: FancyboxType;
			};
			if (mod?.Fancybox) return mod.Fancybox;
		}
		throw primaryErr;
	}
	throw new Error("Fancybox module unavailable");
}

async function loadFancybox(): Promise<FancyboxType> {
	if (!cachedFancyboxPromise) {
		cachedFancyboxPromise = importFancyboxWithDevFallback()
			.then((fb) => {
				const plugins = (fb as { Plugins?: { Hash?: unknown } }).Plugins;
				if (plugins?.Hash) {
					delete plugins.Hash;
				}
				loadedFancyboxRef = fb;
				return fb;
			})
			.catch((err) => {
				cachedFancyboxPromise = null;
				throw err;
			});
	}
	return cachedFancyboxPromise;
}

/**
 * Open the site's built-in Fancybox lightbox for chatroom images,
 * grouping all rendered chat images in DOM order for prev/next navigation.
 */
export async function openChatImageLightbox(
	targetUrl: string,
	triggerEl?: HTMLElement | null,
): Promise<void> {
	if (typeof document === "undefined" || !targetUrl) return;
	bindSwupCleanupOnce();
	const currentSeq = ++openSeq;

	try {
		await ensureFancyboxStyles();
		const Fancybox = await loadFancybox();
		if (currentSeq !== openSeq) return;

		const isStickerTrigger = Boolean(
			triggerEl?.querySelector(".chat-sticker-large"),
		);

		const allSlides: Array<{
			src: string;
			type: "image";
			triggerEl?: HTMLElement;
			thumbEl?: HTMLImageElement;
		}> = [];
		let rawStartIndex = -1;

		if (!isStickerTrigger) {
			const scope = document.getElementById("chat-page") ?? document;
			const nodes = Array.from(
				scope.querySelectorAll<HTMLElement>("[data-chat-image]"),
			);
			const triggerSrc =
				triggerEl?.getAttribute("data-chat-image") || targetUrl;
			const triggerImg = triggerEl?.querySelector("img") ?? undefined;
			const readyTriggerThumb =
				triggerImg?.complete && triggerImg.naturalWidth > 0
					? triggerImg
					: undefined;

			const providerItems = customSourceProvider?.();
			if (providerItems && providerItems.length > 0) {
				let matchedTrigger = false;
				for (const item of providerItems) {
					if (!item.src) continue;
					const isTrigger = !matchedTrigger && item.src === triggerSrc;
					if (isTrigger) {
						matchedTrigger = true;
						rawStartIndex = allSlides.length;
					}
					allSlides.push({
						src: item.src,
						type: "image",
						triggerEl: isTrigger ? (triggerEl ?? undefined) : undefined,
						thumbEl: isTrigger ? readyTriggerThumb : undefined,
					});
				}
			} else {
				for (const el of nodes) {
					const src = el.getAttribute("data-chat-image") || "";
					if (!src) continue;
					const imgEl = el.querySelector("img") ?? undefined;
					// 聊天图片相册不混入表情包贴纸，避免把大量表情包塞进缩略图与左右切换列表
					if (imgEl?.classList.contains("chat-sticker-large")) continue;
					const isTrigger = Boolean(triggerEl && el === triggerEl);
					if (isTrigger) {
						rawStartIndex = allSlides.length;
					}
					const readyThumb =
						isTrigger && imgEl?.complete && imgEl.naturalWidth > 0
							? imgEl
							: undefined;
					allSlides.push({
						src,
						type: "image",
						triggerEl: isTrigger ? el : undefined,
						thumbEl: readyThumb,
					});
				}
			}
		}

		if (rawStartIndex < 0) {
			rawStartIndex = allSlides.findIndex((s) => s.src === targetUrl);
		}

		let slides = allSlides;
		let startIndex = rawStartIndex;
		if (slides.length === 0) {
			const triggerImg = triggerEl?.querySelector("img") ?? undefined;
			const readyThumb =
				triggerImg?.complete && triggerImg.naturalWidth > 0
					? triggerImg
					: undefined;
			slides = [
				{
					src: targetUrl,
					type: "image",
					triggerEl: triggerEl ?? undefined,
					thumbEl: readyThumb,
				},
			];
			startIndex = 0;
		} else {
			if (startIndex < 0) startIndex = 0;
			// 长聊天记录场景下仅截取当前图片前后窗口，防止海量原图同时进 DOM
			const MAX_WINDOW_SIDE = 25;
			if (allSlides.length > MAX_WINDOW_SIDE * 2 + 1) {
				const from = Math.max(0, startIndex - MAX_WINDOW_SIDE);
				const to = Math.min(allSlides.length, startIndex + MAX_WINDOW_SIDE + 1);
				slides = allSlides.slice(from, to);
				startIndex = startIndex - from;
			}
		}

		Fancybox.show(slides, {
			startIndex,
			Hash: false,
			closeExisting: true,
			Carousel: {
				errorTpl: `<div class="f-carousel__error"><span>图片加载失败</span>
					<button type="button" class="underline" data-chat-image-retry>重新加载</button></div>`,
			},
			Thumbs: {
				autoStart: false,
			},
			Toolbar: {
				display: {
					left: ["infobar"],
					middle: [
						"zoomIn",
						"zoomOut",
						"toggle1to1",
						"rotateCCW",
						"rotateCW",
						"flipX",
						"flipY",
					],
					right: ["slideshow", "thumbs", "close"],
				},
			},
			dragToClose: true,
			fitToView: true,
			preload: 1,
			infinite: slides.length > 1,
			Panzoom: {
				maxScale: 2,
				minScale: 1,
			},
			on: {
				initLayout: (fb) => {
					fb.getContainer()?.addEventListener("click", (event) => {
						if (!(event.target instanceof Element)) return;
						if (!event.target.closest("[data-chat-image-retry]")) return;
						const currentSrc = fb.getSlide()?.src;
						if (currentSrc) void openChatImageLightbox(currentSrc);
					});
				},
				destroy: (fb: { getContainer?: () => HTMLElement | null }) => {
					try {
						const container = fb.getContainer?.();
						if (container) {
							container.querySelectorAll("img").forEach((img) => {
								img.src = "";
							});
						}
					} catch {
						// Ignore cleanup failure
					}
				},
			},
		} as Parameters<typeof Fancybox.show>[1]);
	} catch (error) {
		if (currentSeq === openSeq) console.warn("聊天室阅图窗口打开失败", error);
	}
}
