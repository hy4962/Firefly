import { createHash } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

class WsConnection {
	constructor(socket) {
		this.socket = socket;
		this.readyState = 1;
		this.listeners = new Map();
		this.buffer = Buffer.alloc(0);
		this.room = "chat";
		this.user = null;
		this.isMuted = false;
		socket.on("data", (chunk) => this.onData(chunk));
		socket.on("close", () => this.setClosed());
		socket.on("error", () => this.setClosed());
	}

	on(event, fn) {
		if (!this.listeners.has(event)) this.listeners.set(event, new Set());
		this.listeners.get(event).add(fn);
		return this;
	}

	emit(event, payload) {
		for (const fn of this.listeners.get(event) || []) {
			try {
				fn(payload);
			} catch (error) {
				console.warn("[juke ws listener]", error.message);
			}
		}
	}

	setClosed() {
		if (this.readyState === 3) return;
		this.readyState = 3;
		this.emit("close");
	}

	send(text) {
		if (this.readyState !== 1) return;
		const payload = Buffer.from(String(text));
		const header = payload.length < 126
			? Buffer.from([0x81, payload.length])
			: payload.length <= 0xffff
				? Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff])
				: Buffer.concat([
					Buffer.from([0x81, 127]),
					(() => {
						const long = Buffer.alloc(8);
						long.writeBigUInt64BE(BigInt(payload.length));
						return long;
					})(),
				]);
		try {
			this.socket.write(Buffer.concat([header, payload]));
		} catch {
			this.setClosed();
		}
	}

	sendJson(packet) {
		this.send(JSON.stringify(packet));
	}

	close() {
		if (this.readyState !== 1) return;
		try {
			this.socket.write(Buffer.from([0x88, 0x00]));
			this.socket.end();
		} catch {
			// 忽略已经断开的连接。
		}
		this.setClosed();
	}

	onData(chunk) {
		this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
		while (this.buffer.length >= 2) {
			const first = this.buffer[0];
			const second = this.buffer[1];
			const fin = Boolean(first & 0x80);
			const opcode = first & 0x0f;
			const masked = Boolean(second & 0x80);
			let length = second & 0x7f;
			let offset = 2;
			if (length === 126) {
				if (this.buffer.length < 4) return;
				length = this.buffer.readUInt16BE(2);
				offset = 4;
			} else if (length === 127) {
				if (this.buffer.length < 10) return;
				const big = this.buffer.readBigUInt64BE(2);
				if (big > 8n * 1024n * 1024n) {
					this.close();
					return;
				}
				length = Number(big);
				offset = 10;
			}
			const maskOffset = masked ? offset : 0;
			const total = offset + (masked ? 4 : 0) + length;
			if (this.buffer.length < total) return;
			const mask = masked ? this.buffer.subarray(maskOffset, maskOffset + 4) : null;
			const payloadStart = offset + (masked ? 4 : 0);
			const payload = Buffer.from(this.buffer.subarray(payloadStart, payloadStart + length));
			if (mask) {
				for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
			}
			this.buffer = this.buffer.subarray(total);
			if (!fin) continue;
			if (opcode === 0x8) {
				this.close();
				return;
			}
			if (opcode === 0x9) {
				this.sendFrame(0xa, payload);
				continue;
			}
			if (opcode === 0xa) continue;
			if (opcode === 0x1) {
				this.emit("message", payload.toString("utf8"));
			}
		}
	}

	sendFrame(opcode, payload) {
		const header = payload.length < 126
			? Buffer.from([0x80 | opcode, payload.length])
			: Buffer.from([0x80 | opcode, 126, payload.length >> 8, payload.length & 0xff]);
		try {
			this.socket.write(Buffer.concat([header, payload]));
		} catch {
			this.setClosed();
		}
	}
}

export function attachJukeWebSocket(server, pathname, onConnection) {
	server.on("upgrade", (req, socket, head) => {
		let url;
		try {
			url = new URL(req.url || "/", "http://localhost");
		} catch {
			socket.destroy();
			return;
		}
		if (url.pathname !== pathname) return;
		const key = req.headers["sec-websocket-key"];
		if (!key || req.headers.upgrade?.toLowerCase() !== "websocket") {
			socket.destroy();
			return;
		}
		const accept = createHash("sha1").update(key + GUID).digest("base64");
		socket.write(
			"HTTP/1.1 101 Switching Protocols\r\n" +
			"Upgrade: websocket\r\n" +
			"Connection: Upgrade\r\n" +
			`Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
		);
		const connection = new WsConnection(socket);
		if (head?.length) connection.onData(head);
		try {
			onConnection(connection, url);
		} catch (error) {
			console.error("[juke ws] connection handler", error);
			connection.close();
		}
	});
}
