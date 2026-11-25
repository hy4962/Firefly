<script module lang="ts">
import { normalizeServerUrl } from "./chatClient";

interface LottieAnimation {
	play: () => void;
	pause: () => void;
	destroy: () => void;
	addEventListener: (name: string, cb: () => void) => void;
}

interface LottiePlayer {
	loadAnimation: (params: {
		container: HTMLElement;
		renderer: "svg" | "canvas" | "html";
		loop: boolean;
		autoplay: boolean;
		path?: string;
		animationData?: object;
	}) => LottieAnimation;
}

const LOTTIE_CDNS = [
	"/assets/vendor/lottie-5.12.2.min.js",
	"https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js",
	"https://unpkg.com/lottie-web@5.12.2/build/player/lottie.min.js",
];

const DEFAULT_SERVER_URL = "https://chat-server.lengxiqwq.com";

let lottieLoaderPromise: Promise<LottiePlayer> | null = null;
const lottieDataCache = new Map<string, object>();
const lottiePromiseCache = new Map<string, Promise<object>>();

function getWindowLottie(): LottiePlayer | undefined {
	const w = window as unknown as {
		lottie?: LottiePlayer;
		bodymovin?: LottiePlayer;
	};
	return w.lottie || w.bodymovin;
}

function loadScript(src: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>(
			`script[data-lottie-src="${src}"]`,
		);
		if (existing) {
			if (existing.dataset.loaded === "1") {
				resolve();
				return;
			}
			existing.addEventListener("load", () => resolve(), { once: true });
			existing.addEventListener(
				"error",
				() => reject(new Error(`Failed to load ${src}`)),
				{ once: true },
			);
			return;
		}
		const script = document.createElement("script");
		script.src = src;
		script.async = true;
		script.dataset.lottieSrc = src;
		script.onload = () => {
			script.dataset.loaded = "1";
			resolve();
		};
		script.onerror = () => {
			script.remove();
			reject(new Error(`Failed to load ${src}`));
		};
		document.head.appendChild(script);
	});
}

export function ensureLottieLibrary(): Promise<LottiePlayer> {
	if (typeof window === "undefined") {
		return Promise.reject(new Error("Lottie unavailable on server"));
	}
	const ready = getWindowLottie();
	if (ready) {
		return Promise.resolve(ready);
	}
	if (!lottieLoaderPromise) {
		lottieLoaderPromise = (async () => {
			let lastErr: unknown;
			for (const url of LOTTIE_CDNS) {
				try {
					await loadScript(url);
					const lib = getWindowLottie();
					if (lib) return lib;
				} catch (err) {
					lastErr = err;
				}
			}
			lottieLoaderPromise = null;
			throw lastErr instanceof Error
				? lastErr
				: new Error("Failed to load lottie-web");
		})();
	}
	return lottieLoaderPromise;
}

export function preloadLottieData(
	name: string,
	chatServerUrl?: string,
): Promise<object> {
	if (typeof window === "undefined" || !name) {
		return Promise.reject(new Error("Cannot preload on server"));
	}
	const key = name.toLowerCase();
	const cached = lottieDataCache.get(key);
	if (cached) {
		return Promise.resolve(cached);
	}
	const pending = lottiePromiseCache.get(key);
	if (pending) {
		return pending;
	}
	const base = normalizeServerUrl(chatServerUrl) || DEFAULT_SERVER_URL;
	const url = `${base}/api/lottie/${encodeURIComponent(key)}.json`;
	const promise = fetch(url)
		.then((res) => {
			if (!res.ok) {
				throw new Error(`Lottie load failed with status ${res.status}`);
			}
			return res.json() as Promise<object>;
		})
		.then((data) => {
			lottieDataCache.set(key, data);
			lottiePromiseCache.delete(key);
			return data;
		})
		.catch((err) => {
			lottiePromiseCache.delete(key);
			throw err;
		});
	lottiePromiseCache.set(key, promise);
	return promise;
}
</script>

<script lang="ts">
import { useChatMediaRetry } from "./chatMediaRetry";

interface Props {
	name: string;
	alt?: string;
	className?: string;
	chatServerUrl?: string;
}

let {
	name,
	alt = "",
	className = "chat-sticker",
	chatServerUrl = DEFAULT_SERVER_URL,
}: Props = $props();

let containerEl = $state<HTMLDivElement | null>(null);
let isVisible = false;
let hasEnteredViewport = $state(false);
let failed = $state(false);
const retry = useChatMediaRetry(() => { failed = false; });

function handleLoadError() {
	failed = true;
	retry.fail();
}
let activeAnim: LottieAnimation | null = null;

const displayAlt = $derived(alt || name);

$effect(() => {
	const el = containerEl;
	if (!el || typeof IntersectionObserver === "undefined") {
		hasEnteredViewport = true;
		isVisible = true;
		activeAnim?.play();
		return;
	}
	const observer = new IntersectionObserver(
		(entries) => {
			const entry = entries[0];
			if (!entry) return;
			isVisible = entry.isIntersecting;
			if (entry.isIntersecting) {
				hasEnteredViewport = true;
				activeAnim?.play();
			} else {
				activeAnim?.pause();
			}
		},
		{ rootMargin: "120px" },
	);
	observer.observe(el);
	return () => {
		observer.disconnect();
	};
});

$effect(() => {
	const el = containerEl;
	if (!el || !hasEnteredViewport || !name) return;

	let disposed = false;
	let anim: LottieAnimation | null = null;
	failed = false;

	const key = name.toLowerCase();
	const cachedData = lottieDataCache.get(key);

	void Promise.all([
		ensureLottieLibrary(),
		cachedData
			? Promise.resolve(cachedData)
			: preloadLottieData(name, chatServerUrl),
	])
		.then(([lottie, data]) => {
			if (disposed || !el) return;
			el.replaceChildren();
			anim = lottie.loadAnimation({
				container: el,
				renderer: "svg",
				loop: true,
				autoplay: isVisible,
				animationData: data,
			});
			activeAnim = anim;
			anim.addEventListener("DOMLoaded", retry.clear);
			anim.addEventListener("data_failed", () => {
				if (!disposed) handleLoadError();
			});
		})
		.catch(() => {
			if (!disposed) handleLoadError();
		});

	return () => {
		disposed = true;
		if (activeAnim === anim) {
			activeAnim = null;
		}
		if (anim) {
			anim.destroy();
			anim = null;
		}
	};
});
</script>

{#if failed}
	<span class="inline-flex items-center justify-center text-xs opacity-75 px-1" role="img" aria-label={displayAlt} title={displayAlt}>
		[{displayAlt}]
	</span>
{:else}
	<div
		bind:this={containerEl}
		class={className}
		role="img"
		aria-label={displayAlt}
		title={displayAlt}
	></div>
{/if}
