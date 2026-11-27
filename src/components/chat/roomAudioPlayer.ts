import type { CurrentPlayback } from "./chatTypes";
import { recordMusicEvent } from "./musicTrace";

export type AudioStatus =
	| "idle"
	| "preparing"
	| "loading"
	| "playing"
	| "recovering"
	| "blocked"
	| "error";

export const audioStatusLabel: Record<AudioStatus, string> = {
	idle: "未收听",
	preparing: "准备同步播放",
	loading: "正在缓冲",
	playing: "正在收听",
	recovering: "正在恢复播放",
	blocked: "点击恢复收听",
	error: "加载失败，点击重试",
};

export interface LocalAudioDiagnostic {
	uid: string;
	revision: number;
	status: AudioStatus;
	transport?: "direct" | "proxy";
}

const SYNC_TOLERANCE_SEC = 2.5;
const SEEK_COOLDOWN_MS = 3000;

interface Callbacks {
	now: () => number;
	status: (
		status: AudioStatus,
		intent: boolean,
		diagnostic: LocalAudioDiagnostic | null,
	) => void;
	error: (uid: string, revision: number) => void;
	ended: (uid: string) => void;
	duration: (uid: string, duration: number) => void;
}

export class RoomAudioPlayer {
	private play: CurrentPlayback | null = null;
	private intent = false;
	private status: AudioStatus = "idle";
	private generation = 0;
	private reportedDuration = 0;
	private readonly events = new AbortController();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private waitingTimer: ReturnType<typeof setTimeout> | undefined;
	private stallTimer: ReturnType<typeof setTimeout> | undefined;
	private lastSeek = Number.NEGATIVE_INFINITY;
	private isSeekingInternal = false;
	private activeTransport: "direct" | "proxy" = "direct";

	constructor(
		private readonly audio: HTMLAudioElement,
		private readonly callbacks: Callbacks,
	) {
		const options = { signal: this.events.signal };

		const reportDuration = () => {
			const play = this.play;
			if (
				!this.active ||
				!play ||
				!Number.isFinite(audio.duration) ||
				audio.duration <= 0 ||
				audio.duration === this.reportedDuration
			)
				return;
			// 严格防线：当前 audio 标签上的音源必须确实属于当前这首歌，绝不上报旧歌曲的残留时长
			if (!this.isCurrentAudioSrcValid()) {
				return;
			}
			// 保护性检查：若原歌曲已有合理时长，偏差超过 20 秒视为异常音源不予污染服务器
			const baseSec = play.durationSec || play.track.durationSec || 0;
			if (
				baseSec > 30 &&
				Math.abs(audio.duration - baseSec) > Math.max(15, baseSec * 0.2)
			) {
				return;
			}
			this.reportedDuration = audio.duration;
			this.callbacks.duration(play.uid, audio.duration);
		};

		audio.addEventListener(
			"loadedmetadata",
			() => {
				this.isSeekingInternal = false;
				if (!this.active) return;
				recordMusicEvent("audio-metadata", this.play?.uid);
				reportDuration();
				this.align(true);
			},
			options,
		);

		audio.addEventListener("durationchange", reportDuration, options);

		audio.addEventListener(
			"playing",
			() => {
				this.isSeekingInternal = false;
				if (!this.active || audio.paused) return;
				clearTimeout(this.waitingTimer);
				this.waitingTimer = undefined;
				clearTimeout(this.stallTimer);
				this.stallTimer = undefined;
				recordMusicEvent("audio-playing", this.play?.uid);
				reportDuration();
				this.openOutput();
			},
			options,
		);

		audio.addEventListener(
			"seeked",
			() => {
				this.isSeekingInternal = false;
				if (!this.active || audio.paused) return;
				this.openOutput();
			},
			options,
		);

		audio.addEventListener(
			"seeking",
			() => {
				this.isSeekingInternal = true;
			},
			options,
		);

		audio.addEventListener(
			"timeupdate",
			() => {
				if (!this.active || audio.paused) return;
				clearTimeout(this.waitingTimer);
				this.waitingTimer = undefined;
				if (this.status !== "playing") {
					this.openOutput();
				} else {
					this.align(false);
				}
			},
			options,
		);

		audio.addEventListener(
			"waiting",
			() => {
				if (!this.active || audio.ended) return;
				this.watchDirectStream();
				clearTimeout(this.waitingTimer);
				this.waitingTimer = setTimeout(() => {
					if (this.active && !audio.ended && this.status !== "loading") {
						this.update("loading");
					}
				}, 400);
			},
			options,
		);

		audio.addEventListener(
			"ended",
			() => {
				this.isSeekingInternal = false;
				const play = this.play;
				if (this.active && play && audio.ended) {
					this.callbacks.ended(play.uid);
				}
			},
			options,
		);

		audio.addEventListener(
			"error",
			() => {
				this.isSeekingInternal = false;
				if (!this.active) return;
				const play = this.play;
				if (!play) return;
				clearTimeout(this.waitingTimer);
				this.waitingTimer = undefined;
				const proxy = play.track.proxyUrl;
				// 熔断保护：当前 direct 失败时，在当前歌曲生命周期内降级走 proxy，并记录时间戳
				if (proxy && this.activeTransport !== "proxy") {
					this.activeTransport = "proxy";
					this.start(true);
					return;
				}
				this.update("error");
				this.callbacks.error(play.uid, play.sourceRevision ?? 0);
			},
			options,
		);

		const resume = () => {
			if (
				document.hidden ||
				!this.active ||
				this.status === "blocked" ||
				this.status === "error"
			)
				return;
			if (this.isCurrentAudioSrcValid()) {
				if (audio.paused && !audio.ended) {
					this.start();
				} else {
					this.openOutput();
					this.align(false);
				}
			} else {
				this.start();
			}
		};

		document.addEventListener("visibilitychange", resume, options);
		window.addEventListener("pageshow", resume, options);
		window.addEventListener("online", resume, options);
	}

	get position(): number {
		const pos = this.audio.currentTime;
		return Number.isFinite(pos) && pos >= 0 ? pos : 0;
	}

	private get active(): boolean {
		return (
			this.intent &&
			!!this.play &&
			this.play.phase !== "transitioning" &&
			this.callbacks.now() >= this.play.startedAt
		);
	}

	private normalizeUrl(url: string | null | undefined): string {
		if (!url) return "";
		try {
			const parsed = new URL(
				url,
				typeof window !== "undefined"
					? window.location.href
					: "https://lengxiqwq.com",
			);
			parsed.hash = "";
			return parsed.href;
		} catch {
			return url.trim();
		}
	}

	private isCurrentAudioSrcValid(): boolean {
		const play = this.play;
		if (!play) return false;
		const currentRaw =
			this.audio.currentSrc || this.audio.src || this.audio.getAttribute("src");
		const current = this.normalizeUrl(currentRaw);
		if (!current) return false;
		const validUrls = [
			play.track.streamUrl,
			play.track.directUrl,
			play.track.proxyUrl,
		]
			.filter((u): u is string => Boolean(u))
			.map((u) => this.normalizeUrl(u));
		return validUrls.includes(current);
	}

	private resolveTargetUrl(forceProxy = false): string | null {
		const play = this.play;
		if (!play) return null;
		// Keep the working transport until the track or source revision changes.
		if ((forceProxy || this.activeTransport === "proxy") && play.track.proxyUrl) {
			return play.track.proxyUrl;
		}
		return (
			play.track.streamUrl ||
			play.track.directUrl ||
			play.track.proxyUrl ||
			null
		);
	}

	private update(status: AudioStatus) {
		this.status = status;
		const play = this.play;
		const currentRaw =
			this.audio.currentSrc || this.audio.src || this.audio.getAttribute("src");
		const source = status === "idle" ? null : this.normalizeUrl(currentRaw);
		const proxyNorm = this.normalizeUrl(play?.track.proxyUrl);
		const directNorm = this.normalizeUrl(
			play?.track.directUrl || play?.track.streamUrl,
		);
		const transport =
			source && proxyNorm && source === proxyNorm
				? "proxy"
				: source && directNorm && source === directNorm
					? "direct"
					: undefined;
		this.callbacks.status(
			status,
			this.intent,
			play
				? {
						uid: play.uid,
						revision: play.sourceRevision ?? 0,
						status,
						transport,
					}
				: null,
		);
	}

	private openOutput() {
		const audio = this.audio;
		if (!this.active || audio.paused || audio.ended || audio.seeking) return;
		if (audio.muted) {
			audio.muted = false;
		}
		if (this.status !== "playing") {
			this.update("playing");
		}
	}

	private align(force = false) {
		const audio = this.audio;
		const play = this.play;
		if (
			!this.active ||
			!play ||
			!this.isCurrentAudioSrcValid() ||
			audio.readyState < 1 ||
			audio.seeking ||
			audio.ended ||
			this.isSeekingInternal
		)
			return;
		const elapsed = (this.callbacks.now() - play.startedAt) / 1000;
		const target =
			Number.isFinite(audio.duration) && audio.duration > 0
				? Math.min(elapsed, audio.duration)
				: elapsed;
		if (target < 0) return;
		const now = performance.now();
		const diff = Math.abs(audio.currentTime - target);
		if (
			!force &&
			(diff <= SYNC_TOLERANCE_SEC || now - this.lastSeek < SEEK_COOLDOWN_MS)
		)
			return;
		if (diff < 0.5) return;
		this.lastSeek = now;
		this.isSeekingInternal = true;
		try {
			audio.currentTime = target;
			recordMusicEvent("realign-seek", play.uid, { target, diff });
		} catch {
			this.isSeekingInternal = false;
		}
	}

	preloadNext(_next: CurrentPlayback | null): void {
		// Single DOM audio element avoids iOS WebKit audio session drop & untrusted gesture errors.
	}

	// A stalled CDN may leave play() pending without an error event. Allow
	// slow downloads to continue while media time or buffered bytes advance.
	private watchDirectStream() {
		const proxy = this.play?.track.proxyUrl;
		if (!proxy || !this.active || this.activeTransport === "proxy" ||
			this.normalizeUrl(proxy) === this.normalizeUrl(this.audio.src) || this.stallTimer !== undefined) return;
		const position = this.audio.currentTime;
		const ranges = this.audio.buffered;
		const end = ranges.length ? ranges.end(ranges.length - 1) : 0;
		this.stallTimer = setTimeout(() => {
			this.stallTimer = undefined;
			if (!this.active || this.audio.ended) return;
			const buffered = this.audio.buffered;
			if (this.audio.currentTime !== position || (buffered.length && buffered.end(buffered.length - 1) > end)) {
				this.watchDirectStream();
				return;
			}
			this.activeTransport = "proxy";
			recordMusicEvent("audio-stall-proxy", this.play?.uid);
			this.start(true);
		}, 3500);
	}

	private release() {
		clearTimeout(this.stallTimer);
		this.stallTimer = undefined;
		clearTimeout(this.timer);
		clearTimeout(this.waitingTimer);
		this.waitingTimer = undefined;
		this.generation++;
		this.isSeekingInternal = false;
		// Keep src without calling removeAttribute/load to preserve iOS user gesture token
		if (this.audio.hasAttribute("src")) {
			try {
				this.audio.pause();
			} catch {}
		}
	}

	private start(forceProxy = false) {
		const play = this.play;
		if (!play || !this.intent) return;
		clearTimeout(this.stallTimer);
		this.stallTimer = undefined;
		clearTimeout(this.timer);
		clearTimeout(this.waitingTimer);
		this.waitingTimer = undefined;
		this.isSeekingInternal = false;
		const generation = ++this.generation;

		const targetUrl = this.resolveTargetUrl(forceProxy);
		if (!targetUrl) {
			try {
				this.audio.pause();
			} catch {}
			if (!this.isCurrentAudioSrcValid()) {
				this.audio.removeAttribute("src");
				this.audio.load();
			}
			this.update("error");
			return;
		}

		if (
			this.normalizeUrl(this.audio.getAttribute("src")) !==
			this.normalizeUrl(targetUrl)
		) {
			this.audio.src = targetUrl;
		}

		if (this.audio.error) this.audio.load();
		if (!this.active) {
			this.update("preparing");
			if (play.phase === "transitioning") return;
			this.timer = setTimeout(
				() => this.start(forceProxy),
				Math.max(0, play.startedAt - this.callbacks.now()),
			);
			return;
		}

		this.update("loading");
		this.watchDirectStream();

		if (this.audio.readyState >= 1) {
			this.align(true);
		}

		if (this.audio.readyState < 1 && this.callbacks.now() - play.startedAt >= 500) {
			this.audio.muted = true;
		}
		void this.audio
			.play()
			.then(() => {
				if (generation === this.generation) {
					if (this.audio.currentTime < 0.5 || this.audio.muted) this.align(true);
					this.openOutput();
				}
			})
			.catch((error: DOMException) => {
				if (generation !== this.generation) return;
				clearTimeout(this.stallTimer);
				this.stallTimer = undefined;
				if (error.name === "AbortError") return;
				if (this.audio.error) {
					const proxy = play.track.proxyUrl;
					if (
						proxy &&
						this.activeTransport !== "proxy" &&
						this.normalizeUrl(proxy) !==
							this.normalizeUrl(this.audio.getAttribute("src"))
					) {
						this.activeTransport = "proxy";
						this.start(true);
						return;
					}
					this.update("error");
					this.callbacks.error(play.uid, play.sourceRevision ?? 0);
					return;
				}
				this.update(error.name === "NotAllowedError" ? "blocked" : "error");
			});
	}

	setTrack(play: CurrentPlayback | null): void {
		const previous = this.play;
		const isSamePlay =
			previous?.uid === play?.uid &&
			previous?.sourceRevision === play?.sourceRevision &&
			previous?.track.streamUrl === play?.track.streamUrl &&
			previous?.track.proxyUrl === play?.track.proxyUrl;

		this.play = play;

		if (
			isSamePlay &&
			previous?.startedAt === play?.startedAt &&
			(previous?.phase === "transitioning") ===
				(play?.phase === "transitioning")
		)
			return;

		this.lastSeek = Number.NEGATIVE_INFINITY;
		this.reportedDuration = 0;
		this.isSeekingInternal = false;
		this.release();

		// 新曲目切入，重置传输模式为 direct，优先享受直链优质体验
		if (!isSamePlay) {
			this.activeTransport = "direct";
		} else if (previous?.sourceRevision !== play?.sourceRevision) {
			// 服务端推送了新的 sourceRevision，重置 direct 允许重试最新直链
			this.activeTransport = "direct";
		}

		// 如果切到了不同的歌曲，并且新歌存在有效音源，立即替换 audio.src 并暂停，杜绝旧音频潜伏发声
		if (!isSamePlay && play) {
			this.audio.preload = this.intent ? "auto" : "metadata";
			const targetUrl = this.resolveTargetUrl(false);
			if (targetUrl) {
				if (
					this.normalizeUrl(this.audio.getAttribute("src")) !==
					this.normalizeUrl(targetUrl)
				) {
					this.audio.src = targetUrl;
				}
			} else {
				if (!this.isCurrentAudioSrcValid()) {
					this.audio.removeAttribute("src");
					this.audio.load();
				}
			}
		}

		if (play && this.intent) {
			this.start();
		} else {
			this.update("idle");
		}
	}

	listen(): void {
		this.intent = true;
		this.audio.preload = "auto";
		if (!this.play) {
			this.update("idle");
			return;
		}
		if (
			this.active &&
			!this.audio.paused &&
			this.status === "playing" &&
			this.isCurrentAudioSrcValid()
		) {
			return;
		}

		// 核心企业级手势保活（Autoplay Blocked 终结者）：
		// 当处于提前预调度期（now < startedAt），在同步手势事件中执行静音激活，获取浏览器 User Gesture 授权
		if (this.callbacks.now() < this.play.startedAt) {
			const targetUrl = this.resolveTargetUrl();
			if (
				targetUrl &&
				this.normalizeUrl(this.audio.getAttribute("src")) !==
					this.normalizeUrl(targetUrl)
			) {
				this.audio.src = targetUrl;
			}
			const scheduled = this.play;
			this.audio.muted = true;
			void this.audio
				.play()
				.then(() => {
					if (this.play === scheduled && this.intent && this.callbacks.now() < scheduled.startedAt) {
						this.audio.pause();
					}
					this.audio.muted = false;
				})
				.catch(() => {
					this.audio.muted = false;
				});
		}

		this.start();
	}

	stop(): void {
		this.intent = false;
		this.audio.preload = "metadata";
		clearTimeout(this.stallTimer);
		this.stallTimer = undefined;
		clearTimeout(this.timer);
		clearTimeout(this.waitingTimer);
		this.waitingTimer = undefined;
		this.generation++;
		this.isSeekingInternal = false;
		try {
			this.audio.pause();
		} catch {}
		this.update("idle");
	}

	setVolume(volume: number): void {
		try {
			this.audio.volume = Math.min(1, Math.max(0, volume));
		} catch {}
	}

	destroy(): void {
		this.events.abort();
		this.stop();
		this.release();
	}
}
