<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import MusicPanel from "./MusicPanel.svelte";
	import { MusicClock } from "./musicClock";
	import type { ChatMusicTrack } from "./musicTypes";
	import type {
		ChatMentionCandidate,
		ChatOnlineMember,
		ChatSessionUser,
		RotationAction,
		RoomMusicState,
	} from "./chatTypes";

	interface Props {
		apiBase: string;
		walineServerUrl?: string;
		playlistOutApiUrl?: string;
		roomId?: string;
		siteName?: string;
		onClose?: () => void;
	}

	function closeMobileJuke() {
		if (typeof document === "undefined") return;
		document.querySelector("[data-tea-app]")?.classList.remove("is-juke-open");
		const scrim = document.querySelector("[data-juke-scrim]");
		if (scrim instanceof HTMLElement) scrim.hidden = true;
	}

	const {
		apiBase,
		walineServerUrl = "",
		playlistOutApiUrl = "https://playlistout-api.lengxiqwq.com",
		roomId = "chat",
		siteName = "折腾进行时",
		onClose = closeMobileJuke,
	}: Props = $props();

	const base = apiBase.replace(/\/+$/, "");
	const clock = new MusicClock();
	let activeRoomId = $state((() => {
		if (typeof window === "undefined") return roomId;
		const params = new URLSearchParams(window.location.search);
		// 茶室自带 ?room=chat|lobby，点歌台必须跟聊天室首屏房间一致。
		const roomOverride = params.get("room")?.trim().toLowerCase();
		if (roomOverride === "chat" || roomOverride === "lobby") return roomOverride;
		if (import.meta.env.DEV) {
			const jukeOverride = params.get("jukeRoom")?.trim().toLowerCase();
			if (jukeOverride && /^[a-z0-9_-]{1,48}$/.test(jukeOverride)) return jukeOverride;
		}
		return roomId;
	})());

	let audioEl: HTMLAudioElement | null = $state(null);
	let socket: WebSocket | null = null;
	let connectedToken = "";
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let clockTimer: ReturnType<typeof setInterval> | null = null;
	let clockSent = new Map<string, number>();
	let requestWaiters = new Map<string, { finish: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }>();
	let destroyed = false;

	let currentUser = $state<ChatSessionUser | null>(null);
	let musicState = $state<RoomMusicState | null>(null);
	let onlineMembers = $state<ChatOnlineMember[]>([]);
	let mentionMembers = $state<ChatMentionCandidate[]>([]);
	let listeningMemberCount = $state(0);
	let rotationAction = $state<RotationAction | null>(null);
	let isRandomizing = $state(false);
	let isSkippingTrack = $state(false);
	let playlistRefreshSeq = $state(0);
	let fallbackSearch = $state<{ query: string; seq: number } | undefined>(undefined);
	let fallbackSearchSeq = 0;
	let clockOffsetMs = $state(0);
	let toast = $state("");
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	let initialVolume = 1;
	let initialListening = false;

	// 这里原来只在组件初始化时读一次 WALINE_USER：用 Matrix 账号入座后
	// 本地写的是 tea.identity，点歌台就一直以为自己没登录。
	let walineToken = $state(readAuthToken());

	const playlistAuth = $derived(
		currentUser
			? {
					userKey: currentUser.userKey,
					userName: currentUser.name,
					userAvatar: currentUser.avatar,
					token: walineToken,
					kind: currentUser.authType,
					isAdmin: currentUser.isAdmin,
				}
			: undefined,
	);

	function notify(message: string) {
		if (!message) return;
		toast = message;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = ""), 3200);
	}

	function readUser(): ChatSessionUser | null {
		try {
			const walineRaw = localStorage.getItem("WALINE_USER") || "";
			const waline = walineRaw ? JSON.parse(walineRaw) : null;
			if (waline?.token) {
				const key = String(waline.objectId || waline.id || waline.display_name || "waline");
				return {
					userKey: `waline:${key}`,
					authType: "waline",
					name: String(waline.display_name || waline.nick || "茶友"),
					avatar: String(waline.avatar || ""),
					url: String(waline.url || ""),
					badge: waline.type === "administrator" ? "站长" : "认证",
					badgeType: waline.type === "administrator" ? "host" : "accent",
					isAdmin: waline.type === "administrator" || Boolean(waline.admin),
				};
			}
			const guestRaw =
				sessionStorage.getItem("guestbook-chat-auth") ||
				localStorage.getItem("guestbook-chat-auth") ||
				"";
			const guest = guestRaw ? JSON.parse(guestRaw) : null;
			if (guest?.token) {
				return {
					userKey: `guest:${guest.objectId || guest.id || guest.token.slice(0, 10)}`,
					authType: "guest",
					name: String(guest.display_name || guest.nick || "茶友"),
					avatar: String(guest.avatar || ""),
					url: String(guest.url || guest.link || ""),
					badge: "访客",
					badgeType: "tag",
					isAdmin: false,
				};
			}
			const identityRaw = localStorage.getItem("tea.identity") || "";
			const identity = identityRaw ? JSON.parse(identityRaw) : null;
			if (identity?.token && identity?.id) {
				// 旧座位是在后端补 OWNER_ID 之前开的，admin 还是 false。
				// 直接按站长 Matrix ID 兜底，刷新页面就能恢复权限，不用重新登录。
				const ownerId = "@heyuan:matrix.0dm.cn";
				return {
					userKey: `tea:${identity.id}`,
					authType: "guest",
					name: String(identity.name || identity.nick || "茶友"),
					avatar: String(identity.avatar || ""),
					url: "",
					badge: "访客",
					badgeType: "tag",
					isAdmin: Boolean(identity.admin) || identity.id === ownerId,
				};
			}
		} catch {
			// 存储不可用时仍允许浏览和收听，只是不能点歌。
		}
		return null;
	}

	function readAuthToken(): string {
		try {
			const walineRaw = localStorage.getItem("WALINE_USER") || "";
			const waline = walineRaw ? JSON.parse(walineRaw) : null;
			if (typeof waline?.token === "string" && waline.token) return waline.token;
			const guestRaw =
				sessionStorage.getItem("guestbook-chat-auth") ||
				localStorage.getItem("guestbook-chat-auth") ||
				"";
			const guest = guestRaw ? JSON.parse(guestRaw) : null;
			if (typeof guest?.token === "string" && guest.token) return guest.token;
			const identityRaw = localStorage.getItem("tea.identity") || "";
			const identity = identityRaw ? JSON.parse(identityRaw) : null;
			if (typeof identity?.token === "string" && identity.token) return identity.token;
		} catch {
			// 存储不可用时按未登录处理。
		}
		return "";
	}

	function refreshAuth() {
		const nextToken = readAuthToken();
		walineToken = nextToken;
		currentUser = readUser();
		const ws = socket;
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		if (nextToken !== connectedToken) {
			// WebSocket URL 里的 token 不能热替换，重连一次让后端按新身份认。
			ws.close(1000, "auth-change");
			return;
		}
		sendPacket({ type: "auth", roomId: activeRoomId, user: currentUser, siteName });
	}

	function handleAuthEvent() {
		refreshAuth();
	}

	function handleAuthStorage(event: StorageEvent) {
		if (
			event.key &&
			event.key !== "WALINE_USER" &&
			event.key !== "WALINE_USER_META" &&
			event.key !== "guestbook-chat-auth" &&
			event.key !== "tea.identity"
		)
			return;
		refreshAuth();
	}

	function sendPacket(packet: Record<string, unknown>): boolean {
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			notify("点歌台正在重连，请稍候…");
			return false;
		}
		socket.send(JSON.stringify(packet));
		return true;
	}

	function request<T extends { ok?: boolean; error?: string }>(
		packet: Record<string, unknown>,
		timeoutMs = 15_000,
	): Promise<T> {
		return new Promise((resolve) => {
			if (!socket || socket.readyState !== WebSocket.OPEN) {
				resolve({ ok: false, error: "点歌台暂时不在线" } as T);
				return;
			}
			const requestId = packet.requestId ? String(packet.requestId) : crypto.randomUUID();
			const timer = setTimeout(() => {
				requestWaiters.delete(requestId);
				resolve({ ok: false, error: "请求超时" } as T);
			}, timeoutMs);
			requestWaiters.set(requestId, {
				finish: () => {
					clearTimeout(timer);
					resolve(socketPacketCache.get(requestId) as T);
				},
				timer,
			});
			socketPacketCache.set(requestId, { ok: false, error: "请求超时" } as T);
			sendPacket({ ...packet, requestId });
		});
	}

	// 回应包按 requestId 落到这里，request() 的 Promise 再取走结果。
	const socketPacketCache = new Map<string, unknown>();

	function handlePacket(packet: any) {
		switch (packet?.type) {
			case "music:state": {
				musicState = packet as RoomMusicState;
				clock.seed(Number(packet.serverTime) || Date.now());
				// 老茶室脚本的成员名片要读点歌历史，但新版状态只存在于这个组件里。
				// 用一个只读快照桥过去，避免两套脚本各自维护服务端状态。
				try {
					(window as any).__teaJukeHistory = Array.isArray((packet as any).history)
						? (packet as any).history
						: [];
				} catch {
					// 隐私模式下忽略存储异常。
				}
				break;
			}
			case "music:request_result": {
				const id = String(packet.requestId || "");
				socketPacketCache.set(id, packet);
				const waiter = requestWaiters.get(id);
				if (waiter) {
					requestWaiters.delete(id);
					clearTimeout(waiter.timer);
					waiter.finish(Boolean(packet.ok));
				}
				if (!packet.ok && packet.error) notify(String(packet.error));
				break;
			}
			case "music:rotation_result": {
				rotationAction = {
					entryId: String(packet.entryId || packet.trackId || ""),
					code: packet.ok ? undefined : String(packet.code || "FAILED"),
					message: packet.ok ? undefined : String(packet.error || "切换失败"),
					offer: packet.offer,
				};
				break;
			}
			case "pong": {
				const t0 = clockSent.get(String(packet.id || ""));
				if (t0 !== undefined) {
					clockSent.delete(String(packet.id || ""));
					if (clock.sample(Number(packet.serverTime), t0)) {
						clockOffsetMs = clock.now() - Date.now();
					}
				}
				break;
			}
			case "presence:update": {
				onlineMembers = Array.isArray(packet.members) ? packet.members : [];
				mentionMembers = Array.isArray(packet.mentionMembers) ? packet.mentionMembers : [];
				listeningMemberCount = Number(packet.musicAudience?.listeningCount) || 0;
				break;
			}
			case "playlists:updated": {
				playlistRefreshSeq += 1;
				break;
			}
			case "error": {
				notify(String(packet.message || packet.error || "点歌台出错了"));
				break;
			}
		}
	}

	function connect() {
		if (destroyed) return;
		const wsBase = base.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
		const params = new URLSearchParams({ room: activeRoomId });
		walineToken = readAuthToken();
		connectedToken = walineToken;
		if (walineToken) params.set("token", walineToken);
		let ws: WebSocket;
		try {
			ws = new WebSocket(`${wsBase}/juke/ws?${params.toString()}`);
		} catch {
			socket = null;
			scheduleReconnect();
			return;
		}
		socket = ws;
		ws.addEventListener("open", () => {
			currentUser = readUser();
			sendPacket({ type: "auth", roomId: activeRoomId, user: currentUser, siteName });
			sampleClock();
		});
		ws.addEventListener("message", (event) => {
			try {
				handlePacket(JSON.parse(String(event.data)));
			} catch {
				// 忽略未知推送。
			}
		});
		// 只有当前房间的连接断开才重连；换房主动关掉旧连接时不续命。
		ws.addEventListener("close", () => {
			if (socket === ws) scheduleReconnect();
		});
		ws.addEventListener("error", () => ws.close());
	}

	function switchRoom(room: string) {
		if (!/^[a-z0-9_-]{1,48}$/.test(room) || room === activeRoomId) return;
		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
		const oldSocket = socket;
		socket = null;
		if (oldSocket) oldSocket.close();
		for (const waiter of requestWaiters.values()) clearTimeout(waiter.timer);
		requestWaiters.clear();
		socketPacketCache.clear();
		musicState = null;
		onlineMembers = [];
		mentionMembers = [];
		rotationAction = null;
		try {
			(window as any).__teaJukeHistory = [];
		} catch {
			// 忽略存储异常。
		}
		activeRoomId = room;
		connect();
	}

	function handleRoomChange(event: Event) {
		const room = String((event as CustomEvent)?.detail?.room || "").trim().toLowerCase();
		if (room) switchRoom(room);
	}

	function scheduleReconnect() {
		if (destroyed || reconnectTimer) return;
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			connect();
		}, 1800);
	}

	function sampleClock() {
		if (!socket || socket.readyState !== WebSocket.OPEN) return;
		const id = crypto.randomUUID();
		clockSent.set(id, performance.now());
		sendPacket({ type: "clock:sync", id, t0: performance.now() });
	}

	async function searchOnline(
		keyword: string,
		options?: { signal?: AbortSignal; page?: number; provider?: "qq" | "netease" | "kugou" | "youtube" },
	) {
		const q = new URLSearchParams({
			q: keyword,
			page: String(options?.page || 1),
			limit: "20",
			provider: options?.provider || "qq",
		});
		const resp = await fetch(`${base}/api/music/search?${q.toString()}`, {
			signal: options?.signal,
		});
		const data = await resp.json().catch(() => null);
		if (!resp.ok || !data?.ok) throw new Error(data?.error || "搜索失败");
		return {
			tracks: Array.isArray(data.tracks) ? (data.tracks as ChatMusicTrack[]) : [],
			hasMore: Boolean(data.hasMore),
			page: Number(data.page) || 1,
		};
	}

	function enqueue(track: ChatMusicTrack): Promise<boolean> {
		if (!currentUser) {
			notify("先在茶室入座，再来点歌");
			return Promise.resolve(false);
		}
		return request<{ ok: boolean; error?: string }>({
			type: "music:enqueue",
			allowAlternatives: true,
			track: {
				id: track.id,
				provider: track.provider,
				sourceId: track.sourceId,
				sourcePlatform: track.sourcePlatform,
				playlistId: track.playlistId,
				position: track.position,
				title: track.title,
				artist: track.artist,
				album: track.album,
				cover: track.cover,
				durationSec: track.durationSec || 0,
			},
		}).then((result) => Boolean(result.ok));
	}

	function randomEnqueue(playlistId: string): Promise<boolean> {
		return request<{ ok: boolean; error?: string }>({
			type: "music:enqueue",
			randomPlaylistId: playlistId,
		}).then((result) => Boolean(result.ok));
	}

	onMount(() => {
		try {
			initialVolume = Number(localStorage.getItem("tea.jukeVolume") ?? "1") || 1;
			initialListening =
				localStorage.getItem("tea.juke.listen") === "1" &&
				Date.now() - Number(localStorage.getItem("tea.juke.listenAt") || 0) < 30 * 60 * 1000;
		} catch {
			// 忽略存储异常。
		}
		document.documentElement.setAttribute("data-chat-page", "true");
		connect();
		clockTimer = setInterval(sampleClock, 12_000);
		window.addEventListener("tea:juke-search", handleExternalSearch);
		window.addEventListener("tea:room-change", handleRoomChange);
		window.addEventListener("tea:juke-auth", handleAuthEvent);
		window.addEventListener("storage", handleAuthStorage);
	});

	function handleExternalSearch(event: Event) {
		const query = String((event as CustomEvent).detail || "").trim();
		if (!query) return;
		fallbackSearchSeq += 1;
		fallbackSearch = { query, seq: fallbackSearchSeq };
	}

	onDestroy(() => {
		destroyed = true;
		if (reconnectTimer) clearTimeout(reconnectTimer);
		if (clockTimer) clearInterval(clockTimer);
		if (toastTimer) clearTimeout(toastTimer);
		for (const waiter of requestWaiters.values()) clearTimeout(waiter.timer);
		requestWaiters.clear();
		socket?.close();
		window.removeEventListener("tea:juke-search", handleExternalSearch);
		window.removeEventListener("tea:room-change", handleRoomChange);
		window.removeEventListener("tea:juke-auth", handleAuthEvent);
		window.removeEventListener("storage", handleAuthStorage);
		document.documentElement.removeAttribute("data-chat-page");
	});
</script>

<div class="juke-panel-host">
	<audio bind:this={audioEl} preload="metadata"></audio>
	<MusicPanel
		{audioEl}
		roomId={activeRoomId}
		{walineToken}
		{playlistAuth}
		{playlistRefreshSeq}
		{fallbackSearch}
		{musicState}
		{currentUser}
		{onlineMembers}
		{mentionMembers}
		{listeningMemberCount}
		{rotationAction}
		{isSkippingTrack}
		{clockOffsetMs}
		{initialVolume}
		{initialListening}
		chatServerUrl={base}
		{playlistOutApiUrl}
		serverNow={() => clock.now()}
		onSearchOnline={searchOnline}
		onEnqueueTrack={enqueue}
		onRandomEnqueue={randomEnqueue}
		{isRandomizing}
		onRemoveQueue={(uid) => sendPacket({ type: "music:remove", uid })}
		onRemoveRotationTrack={(track) => sendPacket({ type: "music:rotation_remove", entryId: track.entryId || track.id })}
		onShuffleRotation={() => sendPacket({ type: "music:rotation_shuffle" })}
		onPlayQueued={(uid) => {
			isSkippingTrack = true;
			sendPacket({ type: "music:play_queued", uid, playUid: musicState?.current?.uid });
			setTimeout(() => (isSkippingTrack = false), 4500);
		}}
		onPlayRotationTrack={(track) => {
			isSkippingTrack = true;
			sendPacket({ type: "music:play_rotation", entryId: track.entryId || track.id });
			setTimeout(() => (isSkippingTrack = false), 4500);
		}}
		onSkipTrack={() => {
			isSkippingTrack = true;
			sendPacket({ type: "music:skip", playUid: musicState?.current?.uid });
			setTimeout(() => (isSkippingTrack = false), 4500);
		}}
		onVoteSkip={() => sendPacket({ type: "music:vote_skip", playUid: musicState?.current?.uid })}
		onReportDuration={(playUid, durationSec) => sendPacket({ type: "music:report_duration", playUid, durationSec })}
		onTrackEnded={(playUid) => sendPacket({ type: "music:ended", playUid })}
		onReportError={(playUid, revision) => sendPacket({ type: "music:report_error", playUid, revision })}
		onNotify={(message) => notify(message)}
		onPlaybackStatusChange={(status) => {
			try {
				sendPacket({
					type: "music:listen",
					listening: Boolean(status.isListening && !status.isMuted && status.audioStatus !== "blocked"),
				});
				if (status.isListening) {
					localStorage.setItem("tea.juke.listen", "1");
					localStorage.setItem("tea.juke.listenAt", String(Date.now()));
					const globalPlayer = (window as any).__fireflyMusic;
					globalPlayer?.pause?.();
				} else {
					localStorage.removeItem("tea.juke.listen");
					localStorage.removeItem("tea.juke.listenAt");
				}
				if (typeof status.volume === "number") {
					localStorage.setItem("tea.jukeVolume", String(status.volume));
				}
			} catch {
				// 忽略存储异常。
			}
		}}
		{onClose}
	/>
	{#if toast}
		<div class="juke-toast" role="status">{toast}</div>
	{/if}
</div>

<style>
	.juke-panel-host {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}
	.juke-panel-host audio {
		display: none;
	}
	.juke-toast {
		position: absolute;
		left: 50%;
		bottom: 1rem;
		z-index: 300;
		transform: translateX(-50%);
		max-width: calc(100% - 1.5rem);
		padding: 0.5rem 0.85rem;
		border-radius: 0.6rem;
		background: rgba(20, 24, 28, 0.92);
		color: #fff;
		font-size: 0.72rem;
		line-height: 1.45;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
		pointer-events: none;
	}
</style>
