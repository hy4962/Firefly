import { execFileSync } from "node:child_process";
import type { APIRoute } from "astro";

/**
 * 「推送节奏」热力图的提交日期数据源。
 *
 * 构建期生成静态 JSON（prerender），页面在浏览器端按需取用。
 *
 * 为什么不直接在浏览器里打 GitHub API：未认证限 60 次/小时/IP，访客一多就废。
 * 放构建期只需要构建机拉一次。
 *
 * 两级数据源：
 *   1. `git log` —— 本地 / 全量 clone 时最省事，不依赖网络，能拿到完整历史；
 *   2. GitHub API —— 构建环境是 shallow clone 时（Vercel 默认只拉很浅的历史，
 *      `git log` 只能拿到十几条）回退到这里分页拉取。
 */
export const prerender = true;

const repository = "hy4962/Firefly";
const branch = "HY";
/**
 * 只统计本人的提交。
 * 这个仓库是 fork，不加过滤会把上游 CuteLeaf/Firefly 的历史一起算进来
 * （实测：全部 1695 条，本人的只有 253 条）。
 */
const author = "hy4962";
const weeksBack = 53;
/** git log 拿到的条数少于这个值，就认为 clone 不完整，改走 API */
const gitLogTrustThreshold = 100;

/**
 * 可选：构建环境里配一个 GITHUB_TOKEN（Vercel → Settings → Environment Variables），
 * 未认证的 60 次/小时/IP 会提到 5000 次/小时。不配也能跑，只是频繁推送时可能被限流。
 */
const githubToken = process.env.GITHUB_TOKEN || "";

const sinceDate = new Date(Date.now() - weeksBack * 7 * 86400000);

const readFromGit = (): string[] => {
	try {
		return execFileSync(
			"git",
			["log", "HEAD", `--since=${weeksBack} weeks ago`, `--author=${author}`, "--format=%cI"],
			{ cwd: process.cwd(), encoding: "utf8" },
		)
			.split(/\r?\n/)
			.map((value) => value.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
};

const readFromGitHub = async (): Promise<string[]> => {
	const dates: string[] = [];
	try {
		for (let page = 1; page <= 25; page += 1) {
			const url =
				`https://api.github.com/repos/${repository}/commits` +
				`?sha=${encodeURIComponent(branch)}&per_page=100&page=${page}` +
				`&author=${encodeURIComponent(author)}` +
				`&since=${sinceDate.toISOString()}`;

			// 网络抖动会让某页失败，进而把这次构建的热力图搞空 —— 每页重试一次再放弃
			let list: Array<{ commit?: { committer?: { date?: string } } }> | null = null;
			for (let attempt = 0; attempt < 2; attempt += 1) {
				try {
					const response = await fetch(url, {
						headers: {
							Accept: "application/vnd.github+json",
							"User-Agent": "firefly-analytics",
							...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
						},
					});
					if (!response.ok) {
						console.warn(
							`[github-pushes] GitHub API 第 ${page} 页返回 HTTP ${response.status}`,
						);
						break;
					}
					const payload = await response.json();
					if (Array.isArray(payload)) {
						list = payload;
						break;
					}
				} catch (error) {
					if (attempt === 1) {
						console.warn(
							`[github-pushes] 第 ${page} 页重试后仍失败：`,
							error instanceof Error ? error.message : error,
						);
					}
				}
			}
			if (!list || list.length === 0) break;

			for (const item of list) {
				const date = item?.commit?.committer?.date;
				if (date) dates.push(date);
			}
			if (list.length < 100) break;
		}
	} catch (error) {
		// 构建环境没有外网时留空，页面会显示「接口暂时没有响应」，不影响构建。
		console.warn(
			"[github-pushes] GitHub API 拉取异常：",
			error instanceof Error ? error.message : error,
		);
	}
	return dates;
};

export const GET: APIRoute = async () => {
	let commits = readFromGit();
	let source = "git-log";

	// 全量 clone 时 git log 一步到位；沙箱 / 浅克隆（Vercel 默认）下它只有 0～十几条，才回退到 API
	if (commits.length < gitLogTrustThreshold) {
		const fromApi = await readFromGitHub();
		if (fromApi.length > commits.length) {
			commits = fromApi;
			source = "github-api";
		}
	}
	if (commits.length === 0) {
		console.warn("[github-pushes] 一条提交都没拿到，热力图会显示为空");
	}

	return new Response(
		JSON.stringify({
			ok: true,
			source,
			repository,
			branch,
			generatedAt: new Date().toISOString(),
			commits,
		}),
		{
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "public, max-age=300",
			},
		},
	);
};
