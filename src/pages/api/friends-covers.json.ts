import fs from "node:fs";
import path from "node:path";
import type { APIRoute } from "astro";
import { getEnabledFriends } from "@/config/friendsConfig";

/**
 * 友链卡片封面映射表 —— 给 /friends/ 页面的悬停预览用。
 *
 * 数据来源优先级：
 *   1. `src/data/friends-covers.json` —— 由 scripts/generate-friends-covers.ts
 *      离线截好、存在本站的 webp 封面（同源静态资源，尺寸统一、国内加载最快）；
 *   2. friendsConfig 里的 `homepage` 字段（对方自己给的首页截图）—— 只在离线截图
 *      缺席时兜底，比如对方站点抓取失败，或还没跑过截图脚本。
 *
 * 两者都没有的友链就不返回，卡片保持原样（悬停不展开），不会留个破图。
 *
 * 构建期生成静态 JSON：访客拿到的是一份静态文件，没有运行时开销。
 */
export const prerender = true;

const MANIFEST_PATH = path.join(process.cwd(), "src", "data", "friends-covers.json");

const readManifest = (): Record<string, string> => {
	try {
		const raw = fs.readFileSync(MANIFEST_PATH, "utf8");
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, string>;
		}
	} catch {
		// 还没跑过截图脚本时不报错，页面只是没有悬停预览。
	}
	return {};
};

export const GET: APIRoute = async () => {
	const local = readManifest();
	const covers: Record<string, string> = {};

	for (const friend of getEnabledFriends()) {
		const siteurl = friend.siteurl?.trim();
		if (!siteurl) continue;

		const cover = local[siteurl] || friend.homepage?.trim();
		if (cover) covers[siteurl] = cover;
	}

	return new Response(JSON.stringify({ ok: true, covers }), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
};
