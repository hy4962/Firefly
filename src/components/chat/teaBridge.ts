/**
 * 本地 tea-bridge 协议适配层。
 *
 * 参考站 ChatApp 通过 WebSocket `/ws` 收发 packet；本站 fnOS 桥接使用
 * `/api/sync` 长轮询 + `/api/room` + `/api/send`。这里只替换指向本站桥接
 * 的 WebSocket 构造，其余连接（例如点歌台的 `/juke/ws`）仍走浏览器原生实现。
 */

const TEA_HOSTS = new Set(["tea.0dm.cn", "tea.9ll.uk"]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let nativeWebSocket: typeof WebSocket | null = null;

function isTeaBridgeSocket(url: string): boolean {
	try {
		const u = new URL(url, typeof location === "undefined" ? "https://localhost/" : location.href);
		return TEA_HOSTS.has(u.hostname) && /\/ws\/?$/.test(u.pathname);
	} catch {
		return false;
	}
}

/** 供 chatClient 判断是否需要走本地 tea-bridge 的认证接口。 */
export function isTeaBridgeBase(url: string): boolean {
	try {
		const u = new URL(url, typeof location === "undefined" ? "https://localhost/" : location.href);
		return TEA_HOSTS.has(u.hostname);
	} catch {
		return false;
	}
}

function mapMessage(m: any, id: number): any {
	const attachments = m.image
		? [{ url: m.image, width: m.imageW || 0, height: m.imageH || 0, type: "image" }]
		: m.video
			? [{ url: m.video, poster: m.poster || "", width: m.videoInfo?.w || 0, height: m.videoInfo?.h || 0, type: "video" }]
			: [];
	return {
		id,
		msgUid: String(m.id || `${m.ts}-${id}`),
		kind: "user",
		msgType: "text",
		userKey: String(m.sender || ""),
		name: String(m.nick || m.sender || "茶友"),
		avatar: String(m.avatar || ""),
		url: "",
		site: String(m.site || ""),
		badge: "",
		badgeType: "tag",
		isAdmin: false,
		content: String(m.text || ""),
		attachments,
		createdAt: Number(m.ts) || Date.now(),
		reactions: m.reactions || {},
		replyTo: m.reply
			? { msgUid: String(m.reply.id || ""), name: String(m.reply.who || ""), content: String(m.reply.text || "") }
			: null,
	};
}

function mapMember(m: any): any {
	return {
		userKey: String(m.id || ""),
		authType: "guest",
		name: String(m.nick || m.id || ""),
		avatar: String(m.avatar || ""),
		url: "",
		site: String(m.site || ""),
		badge: String(m.badge || ""),
		badgeType: "tag",
		isAdmin: false,
		status: "",
		online: true,
	};
}

const EMPTY_MUSIC = {
	current: null,
	queue: [],
	rotationQueue: [],
	requesterOnline: false,
	voteCount: 0,
	voteThreshold: 3,
	serverTime: Date.now(),
};

class TeaBridgeSocket extends EventTarget {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;

	readonly CONNECTING = 0;
	readonly OPEN = 1;
	readonly CLOSING = 2;
	readonly CLOSED = 3;

	readyState = 0;
	url: string;
	protocol = "";
	binaryType = "blob";
	onopen: ((event: Event) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;

	private base: string;
	private room: string;
	private token = "";
	private since = "";
	private msgSeq = 0;
	private closed = false;
	private jukeSocket: WebSocket | null = null;
	constructor(url: string) {
		super();
		this.url = url;
		const u = new URL(url, typeof location === "undefined" ? "https://localhost/" : location.href);
		this.base = `${u.protocol === "wss:" ? "https" : "http"}://${u.host}`;
		this.room = u.searchParams.get("room") || "lobby";
		this.token = u.searchParams.get("token") || "";
		this.addEventListener("open", (e) => this.onopen?.(e));
		this.addEventListener("message", (e) => this.onmessage?.(e as MessageEvent));
		this.addEventListener("close", (e) => this.onclose?.(e as CloseEvent));
		this.addEventListener("error", (e) => this.onerror?.(e));
		this.openJukeSocket();
		void this.connect();
	}

	private openJukeSocket() {
		if (!nativeWebSocket) return;
		this.jukeSocket?.close();
		const wsBase = this.base.replace(/^http/, "ws");
		const socket = new nativeWebSocket(`${wsBase}/juke/ws?room=${encodeURIComponent(this.room)}`);
		this.jukeSocket = socket;
		socket.addEventListener("message", (event) => {
			if (typeof event.data !== "string") return;
			try {
				const packet = JSON.parse(event.data);
				if (packet?.type?.startsWith("music:")) this.emit(packet);
			} catch {
				// 非 JSON 心跳帧忽略。
			}
		});
	}

	private emit(packet: Record<string, unknown>) {
		if (this.closed) return;
		this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(packet) }));
	}

	private async getJson(path: string): Promise<any> {
		const res = await fetch(`${this.base}${path}`, { credentials: "omit", headers: this.authHeaders() });
		if (!res.ok) throw new Error(`${res.status} ${path}`);
		return res.json();
	}

	private authHeaders(): Record<string, string> {
		return this.token ? { Authorization: `Bearer ${this.token}` } : {};
	}

	private async connect() {
		try {
			const [roomData, syncData] = await Promise.all([
				this.getJson(`/api/room?room=${encodeURIComponent(this.room)}`),
				this.getJson(`/api/sync?room=${encodeURIComponent(this.room)}`),
			]);
			if (this.closed) return;
			this.since = String(syncData?.next || "");
			const members = Array.isArray(roomData?.members) ? roomData.members.map(mapMember) : [];
			let self: unknown = null;
			if (this.token && typeof localStorage !== "undefined") {
				try {
					self = JSON.parse(localStorage.getItem("fireflyChatSessionUser") || "null");
				} catch {
					self = null;
				}
			}
			const messages = Array.isArray(syncData?.messages)
				? syncData.messages.map((m: any) => mapMessage(m, ++this.msgSeq))
				: [];
			this.readyState = this.OPEN;
			this.dispatchEvent(new Event("open"));
			this.emit({
				type: "room:init",
				roomId: this.room,
				self,
				messages,
				members,
				observers: [],
				observerCount: 0,
				totalCount: Number(roomData?.online || members.length || 0),
				totalChatters: Number(roomData?.totalChatters || 0),
				music: EMPTY_MUSIC,
				serverTime: Date.now(),
			});
			void this.poll();
			void this.pollMembers();
		} catch (err) {
			this.readyState = this.CLOSED;
			this.dispatchEvent(new Event("error"));
			this.dispatchEvent(new CloseEvent("close", { code: 1006, reason: String(err), wasClean: false }));
		}
	}

	private async poll() {
		while (!this.closed) {
			try {
				const query = new URLSearchParams({ room: this.room, timeout: "25000" });
				if (this.since) query.set("since", this.since);
				const data = await this.getJson(`/api/sync?${query.toString()}`);
				if (data?.next) this.since = String(data.next);
				for (const m of data?.messages || []) {
					this.emit({ type: "chat:message", roomId: this.room, message: mapMessage(m, ++this.msgSeq) });
				}
				for (const [uid, reaction] of Object.entries(data?.reactions || {})) {
					this.emit({ type: "chat:reaction_updated", roomId: this.room, msgUid: uid, reactions: reaction });
				}
			} catch {
				await sleep(2000);
			}
			await sleep(120);
		}
	}

	private async pollMembers() {
		while (!this.closed) {
			try {
				const data = await this.getJson(`/api/room?room=${encodeURIComponent(this.room)}`);
				const members = Array.isArray(data?.members) ? data.members.map(mapMember) : [];
				this.emit({
					type: "presence:update",
					roomId: this.room,
					members,
					observers: [],
					observerCount: 0,
					totalCount: Number(data?.online || members.length || 0),
					totalChatters: Number(data?.totalChatters || 0),
				});
			} catch {
				// 成员列表暂时拿不到时保留上一次快照。
			}
			await sleep(12_000);
		}
	}

	send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
		if (this.closed || typeof data !== "string") return;
		let packet: any;
		try {
			packet = JSON.parse(data);
		} catch {
			return;
		}
		switch (packet?.type) {
			case "chat:send": {
				const first = (packet.attachments || [])[0] || {};
				void this.post("/api/send", {
					text: String(packet.content || ""),
					imageUrl: first.type === "image" ? first.url : "",
					videoUrl: first.type === "video" ? first.url : "",
					filename: first.name || "",
					replyTo: String(packet.replyToUid || ""),
				});
				break;
			}
			case "chat:typing":
				void this.post("/api/typing", { typing: Boolean(packet.isTyping) });
				break;
			case "chat:receipt":
				void this.post("/api/receipt", { msgUid: String(packet.msgUid || "") });
				break;
			case "chat:reaction":
				void this.post("/api/reaction", { msgUid: String(packet.msgUid || ""), emoji: String(packet.emoji || "") });
				break;
			case "room:switch":
				this.room = String(packet.roomId || "lobby");
				this.since = "";
				this.msgSeq = 0;
				this.openJukeSocket();
				void this.connect();
				break;
			default:
				// 点歌台包交给本地 juke 网关，其余（presence:audio 等）无需转发。
				if (typeof packet?.type === "string" && packet.type.startsWith("music:")) {
					this.jukeSocket?.send(data);
				}
				break;
		}
	}

	private async post(path: string, body: Record<string, unknown>) {
		try {
			const query = new URLSearchParams({ room: this.room });
			await fetch(`${this.base}${path}?${query.toString()}`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...this.authHeaders() },
				credentials: "omit",
				body: JSON.stringify(body),
			});
		} catch {
			// 发送失败由随后到达的 sync 结果体现，这里不打断 UI。
		}
	}

	close(code = 1000, reason = "") {
		if (this.closed) return;
		this.closed = true;
		this.readyState = this.CLOSED;
		this.jukeSocket?.close();
		this.dispatchEvent(new CloseEvent("close", { code, reason, wasClean: true }));
	}
}

export function installTeaBridge(): void {
	if (typeof window === "undefined") return;
	const globals = window as unknown as { WebSocket: typeof WebSocket };
	const native = globals.WebSocket;
	if ((native as any)?.__teaBridgePatched) return;
	nativeWebSocket = native;
	const patched = function (url: string, protocols?: string | string[]) {
		if (isTeaBridgeSocket(url)) return new TeaBridgeSocket(url);
		return protocols ? new native(url, protocols) : new native(url);
	} as unknown as typeof WebSocket;
	Object.assign(patched, {
		CONNECTING: 0,
		OPEN: 1,
		CLOSING: 2,
		CLOSED: 3,
		__teaBridgePatched: true,
	});
	globals.WebSocket = patched;
}
