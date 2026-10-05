import fs from "node:fs";
import path from "node:path";
import type { APIRoute } from "astro";
import { getEnabledBooknavGroups } from "@/utils/booknav-utils";

/**
 * 书签卡片封面映射表 —— 给 /booknav/ 页面的悬停预览用。
 *
 * 数据来源只有一处：`src/data/booknav-covers.json`，由
 * scripts/generate-booknav-covers.ts 离线截好、存在本站的 webp 封面
 * （同源静态资源，尺寸统一、国内加载最快）。
 *
 * 没截到封面的书签就不返回，卡片保持原样（悬停不展开），不会留个破图。
 *
 * 构建期生成静态 JSON：访客拿到的是一份静态文件，没有运行时开销。
 */
export const prerender = true;

const MANIFEST_PATH = path.join(
	process.cwd(),
	"src",
	"data",
	"booknav-covers.json",
);

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

	// 遍历方式跟 booknav.astro 保持一致（同一套 enabled/weight 筛选），
	// 免得清单里混进页面上根本不渲染的书签
	for (const group of getEnabledBooknavGroups()) {
		for (const item of group.items) {
			const url = item.url?.trim();
			if (!url) continue;
			const cover = local[url];
			if (cover) covers[url] = cover;
		}
	}

	return new Response(JSON.stringify({ ok: true, covers }), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
};
