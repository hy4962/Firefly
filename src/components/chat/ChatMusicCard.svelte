<script module lang="ts">
let stopCurrentMusicPreview: (() => void) | undefined;

const PREVIEW_VOLUME_KEY = "lx_chat_music_preview_volume";
const PREVIEW_MUTED_KEY = "lx_chat_music_preview_muted";

function readStoredPreviewVolume(): number {
	if (typeof window === "undefined") return 0.7;
	try {
		const rawStr = window.localStorage.getItem(PREVIEW_VOLUME_KEY);
		if (rawStr === null || rawStr.trim() === "") return 0.7;
		const raw = Number(rawStr);
		if (Number.isFinite(raw) && raw >= 0 && raw <= 1) return raw;
	} catch {
		// ignore
	}
	return 0.7;
}

function readStoredPreviewMuted(): boolean {
	if (typeof window === "undefined") return false;
	try {
		return window.localStorage.getItem(PREVIEW_MUTED_KEY) === "1";
	} catch {
		return false;
	}
}

function persistPreviewAudioPrefs(vol: number, muted: boolean) {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(PREVIEW_VOLUME_KEY, String(vol));
		window.localStorage.setItem(PREVIEW_MUTED_KEY, muted ? "1" : "0");
	} catch {
		// ignore
	}
}

function notifyRoomPreviewState(playing: boolean) {
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent("lx-chat-music-preview-state", { detail: { playing } }),
	);
}

interface CardLyricLine {
	time: number;
	text: string;
}

const cardLyricsCache = new Map<string, CardLyricLine[]>();

function parseCardLrc(raw: string): CardLyricLine[] {
	const timeReg = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
	const offsetReg = /^\[offset:([+-]?\d+)\]$/i;
	let offsetSec = 0;
	const entries: CardLyricLine[] = [];

	for (const rawLine of raw.split(/\r?\n/)) {
		const trimmed = rawLine.trim();
		if (!trimmed) continue;
		const offsetMatch = trimmed.match(offsetReg);
		if (offsetMatch) {
			offsetSec = Number.parseInt(offsetMatch[1], 10) / 1000;
			continue;
		}
		const timestamps: number[] = [];
		timeReg.lastIndex = 0;
		let match: RegExpExecArray | null = timeReg.exec(rawLine);
		while (match !== null) {
			const min = Number.parseInt(match[1], 10);
			const sec = Number.parseInt(match[2], 10);
			const msRaw = match[3] ?? "0";
			const ms =
				msRaw.length === 1
					? Number.parseInt(msRaw, 10) * 100
					: msRaw.length === 2
						? Number.parseInt(msRaw, 10) * 10
						: Number.parseInt(msRaw, 10);
			timestamps.push(Math.max(0, min * 60 + sec + ms / 1000 + offsetSec));
			match = timeReg.exec(rawLine);
		}
		if (timestamps.length === 0) continue;
		const text = rawLine.replace(timeReg, "").trim();
		if (!text) continue;
		for (const t of timestamps) {
			entries.push({ time: t, text });
		}
	}

	entries.sort((a, b) => a.time - b.time);
	const deduped: CardLyricLine[] = [];
	for (const item of entries) {
		const prev = deduped[deduped.length - 1];
		if (prev && Math.abs(prev.time - item.time) < 0.08) {
			continue;
		}
		deduped.push(item);
	}
	return deduped;
}
</script>

<script lang="ts">
import { onDestroy, onMount } from "svelte";
import type { ChatMusicShareData } from "./chatShareProtocol";
import type { ChatMusicTrack } from "./musicTypes";
import {
	fetchFavoriteTrackStatus,
	type PlaylistAuth,
	toggleFavoriteTrack,
} from "./playlistClient";

interface Props {
	data: ChatMusicShareData;
	isSelf?: boolean;
	chatServerUrl?: string;
	currentUserKey?: string;
	playlistAuth?: PlaylistAuth;
	isCurrentPlaying?: boolean;
	isQueued?: boolean;
	onEnqueueTrack?: (
		track: ChatMusicTrack,
		anchor?: HTMLElement,
	) => Promise<boolean> | void;
	onRequireAuth?: () => void;
	onFavoriteChanged?: () => void;
	onNotify?: (message: string, type?: "default" | "success" | "error") => void;
}

const {
	data,
	isSelf = false,
	chatServerUrl = "",
	currentUserKey = "",
	playlistAuth,
	isCurrentPlaying = false,
	isQueued = false,
	onEnqueueTrack,
	onRequireAuth,
	onFavoriteChanged,
	onNotify,
}: Props = $props();

let coverFailed = $state(false);
let audioEl: HTMLAudioElement | null = null;
let isPlaying = $state(false);
let isLoadingAudio = $state(false);
let isEnqueuing = $state(false);
let audioError = $state("");
let currentTimeSec = $state(0);
let durationSec = $state(0);
let isSeeking = $state(false);
let seekIgnoreUntil = 0;
let scrubberEl = $state<HTMLDivElement | null>(null);
let pendingSeekSec: number | null = null;
let resolvedFallbackUrl = $state("");

// Volume state
let previewVolume = $state(readStoredPreviewVolume());
let isPreviewMuted = $state(readStoredPreviewMuted());
let isDraggingVolume = $state(false);
let volumeSliderEl = $state<HTMLDivElement | null>(null);

// Favorite state
let isFavorited = $state(false);
let isFavoriteToggling = $state(false);
let favCheckedKey = "";

// Lyrics state
let lyrics = $state<CardLyricLine[]>([]);
let lyricsStatus = $state<"idle" | "loading" | "ready" | "empty">("idle");
let lyricAbort: AbortController | null = null;

$effect(() => {
	if (!durationSec && data.durationSec && data.durationSec > 0) {
		durationSec = data.durationSec;
	}
});

$effect(() => {
	if (audioEl) {
		audioEl.volume = previewVolume;
		audioEl.muted = isPreviewMuted || previewVolume === 0;
	}
});

const effectiveDuration = $derived(
	durationSec > 0 ? durationSec : data.durationSec || 0,
);

const progressPercent = $derived(
	effectiveDuration > 0
		? Math.min(100, Math.max(0, (currentTimeSec / effectiveDuration) * 100))
		: 0,
);

const effectiveVolumePercent = $derived(
	isPreviewMuted ? 0 : Math.round(previewVolume * 100),
);

const platformLabel = $derived.by(() => {
	const p = (data.provider || data.sourcePlatform || "").toLowerCase();
	if (p === "qq" || p === "tencent") return "QQ音乐";
	if (p === "netease" || p === "ncm") return "网易云";
	if (p === "kugou") return "酷狗";
	if (p === "youtube" || p === "yt") return "YouTube";
	if (p === "local") return "本地音源";
	return p ? p.toUpperCase() : "音乐";
});

const artistText = $derived((data.artist || "").trim() || "未知歌手");
const externalHref = $derived(data.sourceUrl || data.url || "");
const alreadyInRoom = $derived(isCurrentPlaying || isQueued);

const activeLyricText = $derived.by(() => {
	if (lyrics.length === 0) return "";
	const t = currentTimeSec + 0.15;
	let matched = -1;
	for (let i = 0; i < lyrics.length; i += 1) {
		if (lyrics[i].time <= t) {
			matched = i;
		} else {
			break;
		}
	}
	return matched >= 0 ? lyrics[matched].text : lyrics[0]?.text || "";
});

// 第一行展示内容：播放前显示歌曲名；点击播放后显示实时同步歌词（无歌词时回退歌名）
const topLineContent = $derived.by(() => {
	if (audioError) {
		return { text: audioError, tone: "error" as const };
	}
	if (isLoadingAudio && !isPlaying) {
		return { text: "正在加载音频...", tone: "muted" as const };
	}
	if (isPlaying || currentTimeSec > 0) {
		if (activeLyricText) {
			return { text: activeLyricText, tone: "lyric" as const };
		}
		if (lyricsStatus === "loading") {
			return { text: "歌词加载中...", tone: "muted" as const };
		}
		return { text: data.title || "未命名歌曲", tone: "title" as const };
	}
	return { text: data.title || "未命名歌曲", tone: "title" as const };
});

const showSongArtistSubline = $derived(topLineContent.tone !== "title");

function formatSec(sec: number): string {
	if (!Number.isFinite(sec) || sec <= 0) return "0:00";
	const total = Math.floor(sec);
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m}:${String(s).padStart(2, "0")}`;
}

function toMusicTrack(): ChatMusicTrack {
	return {
		id:
			data.id ||
			`${data.provider || data.sourcePlatform || "track"}:${data.sourceId || data.title}`,
		provider: data.provider || data.sourcePlatform || undefined,
		sourceId: data.sourceId || undefined,
		sourcePlatform: data.sourcePlatform || data.provider || undefined,
		title: data.title || "未命名歌曲",
		artist: data.artist || "未知歌手",
		album: data.album || "",
		cover: data.cover || "",
		url: data.sourceUrl || data.url || "",
		durationSec: effectiveDuration || 0,
	};
}

$effect(() => {
	const trackId = data.id || "";
	const userKey = currentUserKey || "";
	const server = (chatServerUrl || "").trim();
	const key = `${server}|${trackId}|${userKey}`;
	if (!server || !trackId || !userKey || key === favCheckedKey) return;
	favCheckedKey = key;
	void fetchFavoriteTrackStatus({
		chatServerUrl: server,
		token: playlistAuth?.token,
		trackId,
		userKey,
	})
		.then((res) => {
			if (favCheckedKey === key && res.ok) {
				isFavorited = Boolean(res.isFavorited);
			}
		})
		.catch(() => {
			// ignore
		});
});

function resolveLyricUrl(): string {
	const base = (chatServerUrl || "").replace(/\/+$/, "");
	if (!base) return "";
	let provider = (data.provider || data.sourcePlatform || "").toLowerCase();
	let bareId = (data.sourceId || "").trim();
	if (!bareId && data.id) {
		const idx = data.id.indexOf(":");
		if (idx > 0) {
			if (!provider) provider = data.id.slice(0, idx).toLowerCase();
			bareId = data.id.slice(idx + 1).trim();
		} else {
			bareId = data.id.trim();
		}
	}
	if (!provider || !bareId) return "";
	return `${base}/api/music/lyric?provider=${encodeURIComponent(provider)}&id=${encodeURIComponent(bareId)}`;
}

async function ensureLyricsLoaded() {
	if (lyricsStatus === "ready" || lyricsStatus === "loading") return;
	const url = resolveLyricUrl();
	if (!url) {
		lyricsStatus = "empty";
		return;
	}
	const cached = cardLyricsCache.get(url);
	if (cached) {
		lyrics = cached;
		lyricsStatus = cached.length > 0 ? "ready" : "empty";
		return;
	}
	lyricsStatus = "loading";
	lyricAbort?.abort();
	const controller = new AbortController();
	lyricAbort = controller;
	try {
		const resp = await fetch(url, { signal: controller.signal });
		if (!resp.ok) {
			lyricsStatus = "empty";
			return;
		}
		const text = await resp.text();
		if (lyricAbort !== controller) return;
		const parsed = parseCardLrc(text);
		cardLyricsCache.set(url, parsed);
		lyrics = parsed;
		lyricsStatus = parsed.length > 0 ? "ready" : "empty";
	} catch {
		if (lyricAbort === controller) {
			lyricsStatus = "empty";
		}
	}
}

function stopAudio(resetTime = false, notifyRoom = true) {
	const wasActive = isPlaying || isLoadingAudio;
	if (audioEl) {
		audioEl.pause();
		if (resetTime) {
			try {
				audioEl.currentTime = 0;
			} catch {
				// ignore
			}
			currentTimeSec = 0;
		}
	}
	isPlaying = false;
	isLoadingAudio = false;
	pendingSeekSec = null;
	if (stopCurrentMusicPreview === pauseSelf) {
		stopCurrentMusicPreview = undefined;
		if (notifyRoom && wasActive) {
			notifyRoomPreviewState(false);
		}
	}
}

function pauseSelf() {
	stopAudio(false, false);
}

async function fetchFallbackPreviewUrl(): Promise<string> {
	if (resolvedFallbackUrl) return resolvedFallbackUrl;
	const base = (chatServerUrl || "").replace(/\/+$/, "");
	if (!base) return "";
	const resp = await fetch(`${base}/api/music/preview`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ track: toMusicTrack() }),
	});
	if (!resp.ok) return "";
	const json = (await resp.json().catch(() => null)) as {
		ok?: boolean;
		streamUrl?: string;
		proxyUrl?: string;
		directUrl?: string;
		durationSec?: number;
	} | null;
	if (!json?.ok) return "";
	if (json.durationSec && !durationSec) {
		durationSec = json.durationSec;
	}
	const nextUrl = json.streamUrl || json.proxyUrl || json.directUrl || "";
	if (nextUrl) resolvedFallbackUrl = nextUrl;
	return nextUrl;
}

function applyPendingSeek(player: HTMLAudioElement) {
	if (pendingSeekSec === null) return;
	if (Number.isFinite(player.duration) && player.duration > 0) {
		const target = Math.min(player.duration, Math.max(0, pendingSeekSec));
		pendingSeekSec = null;
		try {
			player.currentTime = target;
			currentTimeSec = target;
		} catch {
			// ignore
		}
	}
}

function bindAudioEvents(player: HTMLAudioElement, allowFallback: boolean) {
	player.ontimeupdate = () => {
		if (audioEl !== player || isSeeking || Date.now() < seekIgnoreUntil) return;
		currentTimeSec = player.currentTime || 0;
	};
	player.onloadedmetadata = () => {
		if (audioEl !== player) return;
		if (Number.isFinite(player.duration) && player.duration > 0) {
			durationSec = player.duration;
		}
		applyPendingSeek(player);
	};
	player.onplaying = () => {
		if (audioEl !== player) return;
		applyPendingSeek(player);
		isLoadingAudio = false;
		isPlaying = true;
		audioError = "";
		notifyRoomPreviewState(true);
	};
	player.onwaiting = () => {
		if (audioEl !== player) return;
		isLoadingAudio = true;
	};
	player.onpause = () => {
		if (audioEl !== player) return;
		isPlaying = false;
		isLoadingAudio = false;
	};
	player.onended = () => {
		if (audioEl !== player) return;
		stopAudio(true, true);
	};
	player.onerror = async () => {
		if (audioEl !== player) return;
		if (allowFallback) {
			try {
				isLoadingAudio = true;
				const fallbackUrl = await fetchFallbackPreviewUrl();
				if (fallbackUrl && fallbackUrl !== player.src) {
					const fallbackPlayer = new Audio(fallbackUrl);
					fallbackPlayer.preload = "auto";
					fallbackPlayer.volume = previewVolume;
					fallbackPlayer.muted = isPreviewMuted || previewVolume === 0;
					audioEl = fallbackPlayer;
					bindAudioEvents(fallbackPlayer, false);
					await fallbackPlayer.play();
					return;
				}
			} catch {
				// fall through to error state
			}
		}
		stopAudio(false, true);
		audioError = "试听暂不可用";
	};
}

async function startPlayback(seekToSec?: number) {
	audioError = "";
	void ensureLyricsLoaded();
	if (typeof seekToSec === "number" && Number.isFinite(seekToSec)) {
		pendingSeekSec = seekToSec;
		currentTimeSec = seekToSec;
	}

	// Sync latest volume preference across cards
	previewVolume = readStoredPreviewVolume();
	isPreviewMuted = readStoredPreviewMuted();

	stopCurrentMusicPreview?.();
	stopCurrentMusicPreview = pauseSelf;
	notifyRoomPreviewState(true);

	if (audioEl && audioEl.src && !audioEl.error) {
		audioEl.volume = previewVolume;
		audioEl.muted = isPreviewMuted || previewVolume === 0;
		applyPendingSeek(audioEl);
		isLoadingAudio = true;
		try {
			await audioEl.play();
			return;
		} catch {
			// reload below
		}
	}

	isLoadingAudio = true;
	let primaryUrl = data.sharedAudioUrl || "";
	let allowFallback = true;

	if (!primaryUrl) {
		allowFallback = false;
		try {
			primaryUrl = await fetchFallbackPreviewUrl();
		} catch {
			primaryUrl = "";
		}
	}

	if (!primaryUrl) {
		isLoadingAudio = false;
		audioError = "暂无试听音源";
		notifyRoomPreviewState(false);
		return;
	}

	const player = new Audio(primaryUrl);
	player.preload = "auto";
	player.volume = previewVolume;
	player.muted = isPreviewMuted || previewVolume === 0;
	audioEl = player;
	bindAudioEvents(player, allowFallback);

	try {
		await player.play();
	} catch {
		if (!allowFallback) {
			stopAudio(false, true);
			audioError = "试听启动失败";
		}
	}
}

async function togglePreview(event: MouseEvent) {
	event.stopPropagation();
	if (isPlaying || isLoadingAudio) {
		stopAudio(false, true);
		return;
	}
	await startPlayback();
}

// Progress scrubber handlers (zero-lag pointer capture)
function getRatioFromPointer(el: HTMLElement | null, clientX: number): number {
	if (!el) return 0;
	const rect = el.getBoundingClientRect();
	if (rect.width <= 0) return 0;
	return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}

function commitSeekToRatio(ratio: number) {
	const total = effectiveDuration || 0;
	if (total <= 0) return;
	const targetSec = ratio * total;
	currentTimeSec = targetSec;
	seekIgnoreUntil = Date.now() + 260;
	if (audioEl && Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
		try {
			audioEl.currentTime = Math.min(audioEl.duration, Math.max(0, targetSec));
		} catch {
			// ignore
		}
		if (!isPlaying && !isLoadingAudio) {
			void startPlayback(targetSec);
		}
	} else {
		void startPlayback(targetSec);
	}
}

function handleScrubberPointerDown(event: PointerEvent) {
	if (event.button !== 0 && event.pointerType === "mouse") return;
	event.stopPropagation();
	event.preventDefault();
	isSeeking = true;
	try {
		scrubberEl?.setPointerCapture(event.pointerId);
	} catch {
		// ignore
	}
	const ratio = getRatioFromPointer(scrubberEl, event.clientX);
	if (effectiveDuration > 0) {
		currentTimeSec = ratio * effectiveDuration;
	}
}

function handleScrubberPointerMove(event: PointerEvent) {
	if (!isSeeking) return;
	event.stopPropagation();
	const ratio = getRatioFromPointer(scrubberEl, event.clientX);
	if (effectiveDuration > 0) {
		currentTimeSec = ratio * effectiveDuration;
	}
}

function handleScrubberPointerUp(event: PointerEvent) {
	if (!isSeeking) return;
	event.stopPropagation();
	isSeeking = false;
	try {
		scrubberEl?.releasePointerCapture(event.pointerId);
	} catch {
		// ignore
	}
	const ratio = getRatioFromPointer(scrubberEl, event.clientX);
	commitSeekToRatio(ratio);
}

function handleScrubberPointerCancel(event: PointerEvent) {
	if (!isSeeking) return;
	event.stopPropagation();
	isSeeking = false;
	try {
		scrubberEl?.releasePointerCapture(event.pointerId);
	} catch {
		// ignore
	}
	if (audioEl) {
		currentTimeSec = audioEl.currentTime || 0;
	}
}

function handleScrubberKeyDown(event: KeyboardEvent) {
	if (effectiveDuration <= 0) return;
	let delta = 0;
	if (event.key === "ArrowRight") delta = 5;
	else if (event.key === "ArrowLeft") delta = -5;
	else return;
	event.preventDefault();
	event.stopPropagation();
	const next = Math.min(effectiveDuration, Math.max(0, currentTimeSec + delta));
	commitSeekToRatio(next / effectiveDuration);
}

// Volume handlers (zero-lag pointer capture)
function applyVolume(ratio: number) {
	const clamped = Math.min(1, Math.max(0, ratio));
	previewVolume = clamped;
	isPreviewMuted = clamped === 0;
	persistPreviewAudioPrefs(previewVolume, isPreviewMuted);
}

function togglePreviewMute(event: MouseEvent) {
	event.stopPropagation();
	if (isPreviewMuted || previewVolume === 0) {
		isPreviewMuted = false;
		if (previewVolume === 0) previewVolume = 0.7;
	} else {
		isPreviewMuted = true;
	}
	persistPreviewAudioPrefs(previewVolume, isPreviewMuted);
}

function handleVolumePointerDown(event: PointerEvent) {
	if (event.button !== 0 && event.pointerType === "mouse") return;
	event.stopPropagation();
	event.preventDefault();
	isDraggingVolume = true;
	try {
		volumeSliderEl?.setPointerCapture(event.pointerId);
	} catch {
		// ignore
	}
	applyVolume(getRatioFromPointer(volumeSliderEl, event.clientX));
}

function handleVolumePointerMove(event: PointerEvent) {
	if (!isDraggingVolume) return;
	event.stopPropagation();
	applyVolume(getRatioFromPointer(volumeSliderEl, event.clientX));
}

function handleVolumePointerUp(event: PointerEvent) {
	if (!isDraggingVolume) return;
	event.stopPropagation();
	isDraggingVolume = false;
	try {
		volumeSliderEl?.releasePointerCapture(event.pointerId);
	} catch {
		// ignore
	}
	applyVolume(getRatioFromPointer(volumeSliderEl, event.clientX));
}

function handleVolumePointerCancel(event: PointerEvent) {
	if (!isDraggingVolume) return;
	event.stopPropagation();
	isDraggingVolume = false;
	try {
		volumeSliderEl?.releasePointerCapture(event.pointerId);
	} catch {
		// ignore
	}
}

function handleVolumeKeyDown(event: KeyboardEvent) {
	let delta = 0;
	if (event.key === "ArrowRight" || event.key === "ArrowUp") delta = 0.05;
	else if (event.key === "ArrowLeft" || event.key === "ArrowDown") delta = -0.05;
	else return;
	event.preventDefault();
	event.stopPropagation();
	applyVolume((isPreviewMuted ? 0 : previewVolume) + delta);
}

async function handleToggleFavorite(event: MouseEvent) {
	event.stopPropagation();
	if (!currentUserKey || !playlistAuth?.token) {
		onRequireAuth?.();
		return;
	}
	if (isFavoriteToggling || !chatServerUrl) return;
	isFavoriteToggling = true;
	try {
		const res = await toggleFavoriteTrack({
			chatServerUrl,
			token: playlistAuth.token,
			authKind: playlistAuth.kind,
			track: toMusicTrack(),
			userKey: currentUserKey,
		});
		isFavorited = Boolean(res.isFavorited);
		onFavoriteChanged?.();
		onNotify?.(
			isFavorited
				? `已将《${data.title}》收藏到全站共享收藏`
				: `已取消收藏《${data.title}》`,
			"success",
		);
	} catch (err) {
		onNotify?.(
			err instanceof Error ? err.message : "收藏操作失败",
			"error",
		);
	} finally {
		isFavoriteToggling = false;
	}
}

async function handleEnqueue(event: MouseEvent) {
	event.stopPropagation();
	if (!onEnqueueTrack || isEnqueuing || alreadyInRoom) return;
	const anchor = event.currentTarget as HTMLElement;
	isEnqueuing = true;
	try {
		const res = await onEnqueueTrack(toMusicTrack(), anchor);
		if (res === true) {
			onNotify?.(`已将《${data.title}》加入点歌台队列`, "success");
		}
	} finally {
		isEnqueuing = false;
	}
}

onMount(() => {
	const onExternalStop = () => {
		if (isPlaying || isLoadingAudio) {
			stopAudio(false, false);
		}
	};
	window.addEventListener("lx-chat-music-preview-stop", onExternalStop);
	return () => {
		window.removeEventListener("lx-chat-music-preview-stop", onExternalStop);
	};
});

onDestroy(() => {
	lyricAbort?.abort();
	stopAudio(true, true);
	if (audioEl) {
		audioEl.removeAttribute("src");
		audioEl.load();
		audioEl = null;
	}
});
</script>

<div
  class="chat-music-card relative overflow-hidden rounded-2xl text-left transition-all duration-200 {isSelf ? 'chat-music-card--self' : 'chat-music-card--peer'} {isPlaying ? 'chat-music-card--playing' : ''}"
  role="region"
  aria-label={`音乐分享：${data.title} - ${data.artist}`}
>
  <div class="relative z-10 p-3.5 flex flex-col gap-2 min-w-0">
    <!-- 顶部主区：静态圆角矩形封面 + 两行可选中复制文本 + 博客原生底色播放键 -->
    <div class="flex items-center gap-3 min-w-0">
      <div class="relative shrink-0 w-[52px] h-[52px] rounded-xl overflow-hidden border border-black/8 dark:border-white/10 bg-(--primary)/10 shadow-xs flex items-center justify-center select-none">
        {#if data.cover && !coverFailed}
          <img
            src={data.cover}
            alt={`${data.title} 封面`}
            loading="lazy"
            decoding="async"
            class="w-full h-full object-cover block"
            onerror={() => {
              coverFailed = true;
            }}
          />
        {:else}
          <svg class="w-6 h-6 block text-(--primary) opacity-60" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
          </svg>
        {/if}
      </div>

      <!-- 中间两行文本：允许鼠标自由选中与复制 -->
      <div
        class="flex-1 min-w-0 flex flex-col justify-center gap-1 select-text cursor-text"
        onpointerdown={(e) => e.stopPropagation()}
        onclick={(e) => e.stopPropagation()}
      >
        <div
          class="text-[13.5px] font-bold leading-snug truncate transition-colors duration-200 {topLineContent.tone === 'lyric'
            ? 'text-(--primary)'
            : topLineContent.tone === 'error'
              ? 'text-amber-600 dark:text-amber-400'
              : topLineContent.tone === 'muted'
                ? 'text-[var(--chat-meta-color)] font-medium'
                : 'text-[var(--deep-text)]'}"
          title={topLineContent.text}
          aria-live="polite"
        >
          {topLineContent.text}
        </div>

        <div class="flex items-center min-w-0 text-[12px] leading-tight overflow-hidden">
          {#if showSongArtistSubline}
            <span
              class="font-medium text-[var(--deep-text)] truncate shrink-0 max-w-[68%]"
              title={data.title}
            >
              {data.title}
            </span>
            <span
              class="text-[var(--chat-meta-color)] truncate min-w-0 flex-1"
              title={artistText}
            >
              &nbsp;-&nbsp;{artistText}
            </span>
          {:else}
            <span
              class="text-[var(--chat-meta-color)] truncate min-w-0 flex-1"
              title={artistText}
            >
              {artistText}
            </span>
          {/if}
        </div>
      </div>

      <!-- 右侧：博客原生同款底色圆形播放/暂停键 -->
      <button
        type="button"
        class="chat-music-play-btn w-10 h-10 rounded-full inline-flex items-center justify-center border-none cursor-pointer transition-all duration-200 active:scale-95 shrink-0 select-none {isPlaying
          ? 'bg-(--primary) text-white hover:brightness-110'
          : 'bg-(--btn-regular-bg) hover:bg-(--btn-regular-bg-hover) active:bg-(--btn-regular-bg-active) text-(--primary)'}"
        aria-label={isPlaying ? `暂停 ${data.title}` : `试听 ${data.title}`}
        onclick={togglePreview}
      >
        {#if isLoadingAudio}
          <svg class="w-[18px] h-[18px] block animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.6" opacity="0.28" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
          </svg>
        {:else if isPlaying}
          <svg class="w-[17px] h-[17px] block" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="5.5" y="4.5" width="4.5" height="15" rx="1.6" />
            <rect x="14" y="4.5" width="4.5" height="15" rx="1.6" />
          </svg>
        {:else}
          <svg class="w-[17px] h-[17px] block" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8.5 5.45c0-1.08 1.19-1.74 2.11-1.17l9.28 5.79c.86.54.86 1.8 0 2.34l-9.28 5.79c-.92.57-2.11-.09-2.11-1.17V5.45z" />
          </svg>
        {/if}
      </button>
    </div>

    <!-- 进度条 + 下方：左侧时间 / 右侧迷你音量调节 -->
    <div class="flex flex-col gap-1 min-w-0 group/scrubber select-none pt-0.5">
      <div
        bind:this={scrubberEl}
        role="slider"
        tabindex="0"
        aria-label="拖动调整试听进度"
        aria-valuemin={0}
        aria-valuemax={Math.round(effectiveDuration)}
        aria-valuenow={Math.round(currentTimeSec)}
        class="relative flex items-center h-3.5 w-full min-w-0 cursor-pointer touch-none"
        onclick={(e) => e.stopPropagation()}
        onpointerdown={handleScrubberPointerDown}
        onpointermove={handleScrubberPointerMove}
        onpointerup={handleScrubberPointerUp}
        onpointercancel={handleScrubberPointerCancel}
        onkeydown={handleScrubberKeyDown}
      >
        <div class="w-full h-1 bg-neutral-300/60 dark:bg-neutral-500/40 rounded-full overflow-hidden pointer-events-none">
          {#if isLoadingAudio && currentTimeSec === 0}
            <div class="chat-music-track-loading h-full w-1/3 bg-(--primary) rounded-full"></div>
          {:else}
            <div
              class="h-full bg-(--primary) rounded-full"
              style="width: {progressPercent}%;"
            ></div>
          {/if}
        </div>
        <div
          class="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-(--primary) ring-2 ring-white dark:ring-neutral-800 rounded-full shadow-sm {isSeeking ? 'scale-110' : isPlaying || currentTimeSec > 0 ? 'scale-100 transition-transform duration-150' : 'scale-0 group-hover/scrubber:scale-100 transition-transform duration-150'}"
          style="left: {progressPercent}%;"
          aria-hidden="true"
        ></div>
      </div>

      <div class="flex items-center justify-between gap-2 h-4.5">
        <div class="text-[10.5px] leading-none text-neutral-400 flex items-center gap-1.5 min-w-0 truncate">
          <span class="font-mono tabular-nums inline-flex items-center gap-1 shrink-0">
            <span class="text-neutral-600 dark:text-neutral-300">{formatSec(currentTimeSec)}</span>
            <span class="opacity-50" aria-hidden="true">/</span>
            <span>{formatSec(effectiveDuration)}</span>
          </span>
          <span class="opacity-50 shrink-0" aria-hidden="true">·</span>
          <span class="truncate text-neutral-500 dark:text-neutral-400">{platformLabel}</span>
        </div>

        <!-- 博客同款迷你试听音量调节 -->
        <div class="flex items-center gap-1.5 shrink-0 group/vol">
          <button
            type="button"
            class="inline-flex items-center justify-center w-5 h-5 rounded-md border-none bg-transparent text-neutral-400 hover:text-(--primary) cursor-pointer transition-colors p-0"
            aria-label={isPreviewMuted || previewVolume === 0 ? "取消静音" : "静音试听"}
            onclick={togglePreviewMute}
          >
            {#if isPreviewMuted || previewVolume === 0}
              <svg class="w-3.5 h-3.5 block" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" />
              </svg>
            {:else}
              <svg class="w-3.5 h-3.5 block" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
              </svg>
            {/if}
          </button>

          <div
            bind:this={volumeSliderEl}
            role="slider"
            tabindex="0"
            aria-label="试听音量"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={effectiveVolumePercent}
            class="relative flex items-center w-16 h-4 cursor-pointer touch-none"
            onclick={(e) => e.stopPropagation()}
            onpointerdown={handleVolumePointerDown}
            onpointermove={handleVolumePointerMove}
            onpointerup={handleVolumePointerUp}
            onpointercancel={handleVolumePointerCancel}
            onkeydown={handleVolumeKeyDown}
          >
            <div class="w-full h-1 bg-neutral-300/60 dark:bg-neutral-500/40 rounded-full overflow-hidden pointer-events-none">
              <div
                class="h-full bg-(--primary) rounded-full"
                style="width: {effectiveVolumePercent}%;"
              ></div>
            </div>
            <div
              class="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-(--primary) ring-2 ring-white dark:ring-neutral-800 rounded-full shadow-xs {isDraggingVolume ? 'scale-110' : 'scale-0 group-hover/vol:scale-100 transition-transform duration-150'}"
              style="left: {effectiveVolumePercent}%;"
              aria-hidden="true"
            ></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部操作行：全为真实可交互的博客原生底色圆角按钮，均衡排布 -->
    <div class="flex items-center gap-2 pt-0.5 min-w-0 select-none">
      <!-- 一键全站收藏 -->
      <button
        type="button"
        disabled={isFavoriteToggling}
        class="flex-1 inline-flex items-center justify-center gap-1 h-7.5 px-2.5 rounded-lg bg-(--btn-regular-bg) hover:bg-(--btn-regular-bg-hover) active:bg-(--btn-regular-bg-active) text-[11.5px] font-semibold border-none cursor-pointer transition-all active:scale-95 disabled:opacity-60 disabled:cursor-wait min-w-0 {isFavorited ? 'text-amber-500 dark:text-amber-400' : 'text-neutral-600 dark:text-neutral-300 hover:text-amber-500'}"
        aria-label={isFavorited ? `取消收藏 ${data.title}` : `收藏 ${data.title}`}
        onclick={handleToggleFavorite}
      >
        <svg
          class="w-3.5 h-3.5 block shrink-0"
          viewBox="0 0 24 24"
          fill={isFavorited ? "currentColor" : "none"}
          stroke="currentColor"
          stroke-width={isFavorited ? "1.2" : "2"}
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polygon points="12 1.9 14.35 9.15 21.95 9.15 15.8 13.62 18.15 20.87 12 16.39 5.85 20.87 8.2 13.62 2.05 9.15 9.65 9.15" />
        </svg>
        <span class="truncate">{isFavorited ? "已收藏" : "收藏"}</span>
      </button>

      {#if onEnqueueTrack}
        {#if alreadyInRoom}
          <span
            class="flex-1 inline-flex items-center justify-center gap-1 h-7.5 px-2.5 rounded-lg bg-neutral-100 dark:bg-white/8 text-neutral-500 dark:text-neutral-400 text-[11.5px] font-semibold min-w-0"
            aria-label={isCurrentPlaying ? "点歌台正在播放这首歌" : "这首歌已在点歌台待播队列中"}
          >
            <svg class="w-3.5 h-3.5 block shrink-0 text-(--primary)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span class="truncate">{isCurrentPlaying ? "房间在播" : "已入队"}</span>
          </span>
        {:else}
          <button
            type="button"
            disabled={isEnqueuing}
            class="flex-1 inline-flex items-center justify-center gap-1 h-7.5 px-2.5 rounded-lg bg-(--btn-regular-bg) hover:bg-(--btn-regular-bg-hover) active:bg-(--btn-regular-bg-active) text-(--primary) text-[11.5px] font-semibold border-none cursor-pointer transition-all active:scale-95 disabled:opacity-60 disabled:cursor-wait min-w-0"
            aria-label={`点歌 ${data.title} 加入点歌台`}
            onclick={handleEnqueue}
          >
            {#if isEnqueuing}
              <svg class="w-3.5 h-3.5 block shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
              </svg>
              <span class="truncate">点歌中</span>
            {:else}
              <svg class="w-3.5 h-3.5 block shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span class="truncate">点歌</span>
            {/if}
          </button>
        {/if}
      {/if}

      {#if externalHref}
        <a
          href={externalHref}
          target="_blank"
          rel="noopener noreferrer"
          class="flex-1 inline-flex items-center justify-center gap-1 h-7.5 px-2.5 rounded-lg bg-(--btn-regular-bg) hover:bg-(--btn-regular-bg-hover) active:bg-(--btn-regular-bg-active) text-neutral-600 dark:text-neutral-300 hover:text-(--primary) text-[11.5px] font-semibold transition-all active:scale-95 no-underline min-w-0"
          aria-label="在新窗口打开原曲链接"
          onclick={(e) => e.stopPropagation()}
        >
          <span class="truncate">原曲</span>
          <svg class="w-3 h-3 block shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      {/if}
    </div>
  </div>
</div>

<style>
  .chat-music-card {
    width: 356px;
    max-width: 100%;
    background-color: var(--skin-surface, #ffffff);
    border: 1px solid var(--skin-line, rgba(0, 0, 0, 0.1));
    box-shadow: 0 4px 16px -2px rgba(0, 0, 0, 0.06);
    color: var(--skin-text);
  }

  .chat-music-card:hover {
    border-color: color-mix(in srgb, var(--primary) 42%, var(--skin-line, rgba(0, 0, 0, 0.12)));
  }

  .chat-music-card--playing {
    border-color: color-mix(in srgb, var(--primary) 50%, var(--skin-line, rgba(0, 0, 0, 0.12)));
  }

  .chat-music-track-loading {
    opacity: 0.75;
    animation: chat-music-indeterminate 1.2s ease-in-out infinite;
  }

  @keyframes chat-music-indeterminate {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(350%);
    }
  }

  :global(.dark) .chat-music-card {
    background-color: var(--skin-surface, #1e1e20);
    border-color: var(--skin-line, rgba(255, 255, 255, 0.12));
    box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.35);
  }

  @media (max-width: 480px) {
    .chat-music-card {
      width: min(356px, calc(100vw - 84px));
    }
  }
</style>
