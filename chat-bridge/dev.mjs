/**
 * 本地调试入口：把 Node 的 http 请求转成 Web Request，复用同一份 handler。
 *   BRIDGE_TOKEN=xxx node chat-bridge/dev.mjs
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handleRequest } from "./handler.mjs";

const PORT = Number(process.env.PORT || 8787);
const env = { ...process.env };

// CYAPI 联调凭据不进源码仓库：优先读环境变量，其次读挂载目录里的 .cyapi-key。
// 容器把宿主 /vol1/1000/Docker/tea-bridge 挂到 /app，所以生产只需放一个 .cyapi-key 文件。
if (!env.CYAPI_KEY) {
	try {
		const keyPath = fileURLToPath(new URL("./.cyapi-key", import.meta.url));
		const key = readFileSync(keyPath, "utf8").trim();
		if (key) env.CYAPI_KEY = key;
	} catch (_) {}
}

http
	.createServer(async (req, res) => {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);

		const request = new Request(`http://${req.headers.host || "localhost"}${req.url}`, {
			method: req.method,
			headers: req.headers,
			body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
		});

		try {
			const response = await handleRequest(request, env);
			res.writeHead(response.status, Object.fromEntries(response.headers));
			res.end(Buffer.from(await response.arrayBuffer()));
		} catch (err) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
		}
	})
	.listen(PORT, "0.0.0.0", () => {
		console.log(`tea bridge dev server: http://127.0.0.1:${PORT}`);
		if (!env.BRIDGE_TOKEN) console.log("⚠️  BRIDGE_TOKEN 为空，接口会返回 500");
	});
