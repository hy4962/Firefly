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
			["log", "HEAD", `--since=${weeksBack} weeks ago`, "--format=%cI"],
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
				`&since=${sinceDate.toISOString()}`;

			const response = await fetch(url, {
				headers: {
					Accept: "application/vnd.github+json",
					"User-Agent": "firefly-analytics",
					...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
				},
			});
			if (!response.ok) break;

			const list = (await response.json()) as Array<{
				commit?: { committer?: { date?: string } };
			}>;
			if (!Array.isArray(list) || list.length === 0) break;

			for (const item of list) {
				const date = item?.commit?.committer?.date;
				if (date) dates.push(date);
			}
			if (list.length < 100) break;
		}
	} catch {
		// 构建环境没有外网时留空，页面会显示「接口暂时没有响应」，不影响构建。
	}
	return dates;
};

export const GET: APIRoute = async () => {
	let commits = readFromGit();
	let source = "git-log";

	if (commits.length < gitLogTrustThreshold) {
		const fromApi = await readFromGitHub();
		if (fromApi.length > commits.length) {
			commits = fromApi;
			source = "github-api";
		}
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
