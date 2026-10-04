/**
 * 自动友链处理脚本（零第三方依赖，只需 Node 18+ 内置 fetch）
 *
 * 触发方式：见 .github/workflows/auto-friend-link.yml
 *   1. 有人用 friend-request.yml 模板提 Issue  → 自动校验
 *   2. Issue 作者在下面回复                      → 重新校验（改完站可以重试）
 *
 * 校验三项（全过才写入）：
 *   1. 主站可访问（HTTP 2xx/3xx 最终 200）
 *   2. 友链页可访问，且与主站同域（防广告站、防跳转）
 *   3. 友链页 HTML 中确实出现本站域名（防"我挂你、你不挂我"）
 *
 * 写入策略：**只往 friendsConfig 数组头部插入一条**，
 *   绝不重排/重写已有条目 —— 否则会吃掉其它条目的 rss / homepage 字段和注释。
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CONFIG_RELATIVE_PATH = 'src/config/friendsConfig.ts';

// ── 本站信息：申请者需要挂的、以及失败提示里展示的 ──────────────────
const SITE_INFO = {
	name: '折腾进行时',
	url: 'https://www.9ll.uk',
	avatar:
		'https://weavatar.com/api/avatar/e3298b871864a7a21690863f8c930754a36cb5c6f0b105f4b5d4737bfd219f57?s=2000&t=1783684315863',
	desc: '生命不息，折腾不止',
	// 友链页里出现这些字符串中的任意一个，即视为已挂本站友链
	backlinkPatterns: ['9ll.uk'],
};

const DEFAULT_TAG = 'Blog';
const DEFAULT_WEIGHT = 10;
const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 15000;
const MAX_HTML = 800000;

const LABEL_PENDING = '验证中';
const LABEL_NEEDS_FIX = 'needs-update';
const LABEL_REQUEST = '友链申请';

// ── 小工具 ──────────────────────────────────────────────────────

function clean(value, maxLen = 300) {
	if (value == null) return '';
	let s = String(value)
		.replace(/\r?\n+/g, ' ') // 关键：换行会破坏 TS 结构，必须压平
		.replace(/\s+/g, ' ')
		.trim();
	if (/^_?no response_?$/i.test(s)) return '';
	if (s.length > maxLen) s = s.slice(0, maxLen).trim();
	return s;
}

function escapeString(value) {
	return String(value ?? '')
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"');
}

function normalizeUrl(value) {
	const s = clean(value, 500);
	if (!s) return '';
	try {
		const u = new URL(s);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
		return u.toString();
	} catch {
		return '';
	}
}

function hostOf(url) {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return '';
	}
}

function trimSlash(url) {
	return String(url).replace(/\/+$/, '');
}

function registrableDomain(host) {
	const parts = String(host).replace(/^www\./, '').split('.');
	return parts.length >= 2 ? parts.slice(-2).join('.') : host;
}

function sameSite(a, b) {
	const ha = hostOf(a);
	const hb = hostOf(b);
	if (!ha || !hb) return false;
	return ha === hb || registrableDomain(ha) === registrableDomain(hb);
}

function fallbackAvatar(name) {
	return `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(name)}`;
}

function run(cmd, args, options = {}) {
	const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...options });
	if (result.status !== 0) {
		throw new Error(`${cmd} ${args.join(' ')} 执行失败（exit ${result.status}）`);
	}
}

// ── 解析 Issue 表单 ─────────────────────────────────────────────
// GitHub Issue Form 提交后的 body 长这样：
//   ### 网站名称\n\n某某小站\n\n### 网站链接\n\nhttps://...
// 所以按 "\n### " 切块，每块首行是 label、其余是值。

const LABEL_MAP = {
	网站名称: 'title',
	名称: 'title',
	网站链接: 'siteurl',
	网站地址: 'siteurl',
	友链页面url: 'friendPageUrl',
	友链页面: 'friendPageUrl',
	网站描述: 'desc',
	描述: 'desc',
	网站头像url: 'imgurl',
	网站头像: 'imgurl',
	头像: 'imgurl',
	rss链接: 'rss',
	rss: 'rss',
	首页照片url: 'homepage',
	首页照片: 'homepage',
	首页截图: 'homepage',
};

function normalizeLabel(label) {
	return String(label)
		.replace(/^#+\s*/, '') // split 后第一块的 label 会带 "### " 前缀
		.toLowerCase()
		.replace(/[（(].*?[)）]/g, '')
		.replace(/[\s:：]/g, '')
		.trim();
}

function parseIssueForm(body) {
	const data = {};
	const chunks = String(body).split(/\r?\n###\s+/);

	for (const chunk of chunks) {
		const nl = chunk.indexOf('\n');
		if (nl === -1) continue;
		const label = normalizeLabel(chunk.slice(0, nl));
		const value = clean(chunk.slice(nl + 1));
		const key = LABEL_MAP[label];
		if (key && value && !data[key]) data[key] = value;
	}

	// 兜底：如果有人不用模板、手打 "网站名称：xxx" 这种格式
	if (!data.title && !data.siteurl) {
		for (const line of String(body).split(/\r?\n/)) {
			const m = line.match(/^\s*[-*>]?\s*(网站名称|名称|网站链接|网址|友链页面(?:URL)?|RSS|首页(?:照片|截图))\s*[:：]\s*(.+)$/i);
			if (!m) continue;
			const key = LABEL_MAP[normalizeLabel(m[1])];
			if (key && !data[key]) data[key] = clean(m[2]);
		}
	}

	return data;
}

/** 把 Issue 正文整理成干净的字段对象（主流程与本地自测共用同一路径） */
function buildForm(body) {
	const parsed = parseIssueForm(body);
	return {
		title: clean(parsed.title, 60),
		siteurl: normalizeUrl(parsed.siteurl),
		friendPageUrl: normalizeUrl(parsed.friendPageUrl),
		desc: clean(parsed.desc, 160),
		imgurl: normalizeUrl(parsed.imgurl),
		rss: normalizeUrl(parsed.rss),
		homepage: normalizeUrl(parsed.homepage),
	};
}

// ── 抓页面 ──────────────────────────────────────────────────────

async function fetchPage(url) {
	let lastError = null;

	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			const res = await fetch(url, {
				redirect: 'follow',
				headers: {
					'user-agent': UA,
					accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
					'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
				},
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
			const text = await res.text();
			return {
				ok: res.ok,
				status: res.status,
				finalUrl: res.url || url,
				html: text.slice(0, MAX_HTML),
			};
		} catch (error) {
			lastError = error;
			if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
		}
	}

	return {
		ok: false,
		status: 0,
		finalUrl: url,
		html: '',
		error: lastError ? String(lastError.message || lastError) : '未知错误',
	};
}

function pageTitle(html) {
	const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	return m ? clean(m[1], 120) : '';
}

function findBacklink(html) {
	const lower = html.toLowerCase();
	return SITE_INFO.backlinkPatterns.some((p) => lower.includes(p.toLowerCase()));
}

// ── 校验 ────────────────────────────────────────────────────────

async function validate(form) {
	// 1) 主站可访问
	const home = await fetchPage(form.siteurl);
	if (!home.ok) {
		return {
			ok: false,
			kind: 'site-unreachable',
			detail: `主站无法访问（HTTP ${home.status || '超时'}${home.error ? ` / ${home.error}` : ''}）`,
		};
	}

	// 2) 友链页可访问
	const page = await fetchPage(form.friendPageUrl);
	if (!page.ok) {
		return {
			ok: false,
			kind: 'page-unreachable',
			actualUrl: page.finalUrl,
			detail: `友链页无法访问（HTTP ${page.status || '超时'}${page.error ? ` / ${page.error}` : ''}）`,
		};
	}

	// 3) 同域
	if (!sameSite(form.siteurl, page.finalUrl)) {
		return {
			ok: false,
			kind: 'domain-mismatch',
			actualUrl: page.finalUrl,
			detail: `友链页域名（${hostOf(page.finalUrl)}）与主站域名（${hostOf(form.siteurl)}）不一致`,
		};
	}

	// 4) 回链
	if (!findBacklink(page.html)) {
		return {
			ok: false,
			kind: 'missing-backlink',
			actualUrl: page.finalUrl,
			title: pageTitle(page.html),
		};
	}

	return { ok: true, actualUrl: page.finalUrl, title: pageTitle(page.html) };
}

// ── 写入 friendsConfig.ts（只插入，不改动已有条目）────────────────

function renderFriend(form, indent, eol) {
	const lines = [
		`${indent}{`,
		`${indent}\ttitle: "${escapeString(form.title)}",`,
		`${indent}\timgurl: "${escapeString(form.imgurl || fallbackAvatar(form.title))}",`,
		`${indent}\tdesc: "${escapeString(form.desc || '')}",`,
		`${indent}\tsiteurl: "${escapeString(trimSlash(form.siteurl))}",`,
	];

	if (form.rss) lines.push(`${indent}\trss: "${escapeString(form.rss)}",`);
	if (form.homepage) lines.push(`${indent}\thomepage: "${escapeString(form.homepage)}",`);

	lines.push(
		`${indent}\ttags: ["${DEFAULT_TAG}"],`,
		`${indent}\tweight: ${DEFAULT_WEIGHT},`,
		`${indent}\tenabled: true,`,
		`${indent}},`,
	);

	return lines.join(eol);
}

function insertFriend(repoRoot, form) {
	const filePath = path.join(repoRoot, CONFIG_RELATIVE_PATH);
	const raw = fs.readFileSync(filePath, 'utf8');
	const eol = raw.includes('\r\n') ? '\r\n' : '\n';
	const anchor = 'export const friendsConfig: FriendLink[] = [';
	const at = raw.indexOf(anchor);
	if (at === -1) {
		throw new Error(`未找到锚点 "${anchor}"，请确认 ${CONFIG_RELATIVE_PATH} 格式未变`);
	}

	// 去重：按域名比对，避免同一站被反复添加
	const newHost = registrableDomain(hostOf(form.siteurl));
	const existingUrls = [...raw.matchAll(/siteurl:\s*["']([^"']+)["']/g)].map((m) => m[1]);
	const duplicated = existingUrls.some((u) => {
		const h = hostOf(u);
		return h && registrableDomain(h) === newHost;
	});
	if (duplicated) {
		return { changed: false, duplicate: true };
	}

	const insertAt = at + anchor.length;
	const entry = renderFriend(form, '\t', eol);
	const updated = raw.slice(0, insertAt) + eol + entry + raw.slice(insertAt);
	fs.writeFileSync(filePath, updated, 'utf8');

	return { changed: true, entry };
}

// ── GitHub 交互 ─────────────────────────────────────────────────

async function safeAddLabels(github, owner, repo, issueNumber, labels) {
	try {
		await github.rest.issues.addLabels({ owner, repo, issue_number: issueNumber, labels });
	} catch (error) {
		// label 不存在等情况不要中断流程
		console.log(`添加 label 失败（忽略）：${error.message}`);
	}
}

async function safeRemoveLabel(github, owner, repo, issueNumber, label) {
	try {
		await github.rest.issues.removeLabel({ owner, repo, issue_number: issueNumber, name: label });
	} catch (error) {
		if (error.status !== 404) console.log(`移除 label 失败（忽略）：${error.message}`);
	}
}

async function comment(github, owner, repo, issueNumber, body) {
	await github.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });
}

function commitAndPush(repoRoot, branch, siteName) {
	run('git', ['config', 'user.name', 'github-actions[bot]'], { cwd: repoRoot });
	run('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com'], { cwd: repoRoot });
	run('git', ['add', CONFIG_RELATIVE_PATH], { cwd: repoRoot });

	const dirty =
		spawnSync('git', ['diff', '--cached', '--quiet', '--', CONFIG_RELATIVE_PATH], {
			cwd: repoRoot,
			shell: false,
		}).status !== 0;

	if (!dirty) return false;

	run('git', ['commit', '-m', `feat(friends): 自动添加友链「${siteName}」`], { cwd: repoRoot });
	run('git', ['pull', '--rebase', 'origin', branch], { cwd: repoRoot });
	run('git', ['push', 'origin', `HEAD:${branch}`], { cwd: repoRoot });
	return true;
}

// ── 主流程 ──────────────────────────────────────────────────────

module.exports = async function processFriendRequest({ github, context }) {
	const issue = context.payload.issue;
	if (!issue) {
		console.log('当前事件不包含 issue，跳过。');
		return;
	}

	const { owner, repo } = context.repo;
	const issueNumber = issue.number;
	const action = context.payload.action;
	const body = issue.body || '';
	const isCommentEvent = context.eventName === 'issue_comment';

	const hasLabel = (issue.labels || []).some((l) => (l.name || '') === LABEL_REQUEST);
	const looksLikeForm = /###\s*网站名称/.test(body) && /###\s*网站链接/.test(body);

	if (!looksLikeForm && !hasLabel) {
		console.log('非友链申请 Issue，跳过。');
		return;
	}

	try {
		if (action === 'opened' || action === 'reopened') {
			await safeAddLabels(github, owner, repo, issueNumber, [LABEL_PENDING]);
		}

		// 只有申请者本人的回复才触发重新校验，避免路人刷
		if (isCommentEvent) {
			const commenter = context.payload.comment?.user?.login;
			if (commenter !== issue.user?.login) {
				console.log('评论不是 Issue 作者发的，跳过。');
				return;
			}
		}

		// ── 整理字段 ──
		const form = buildForm(body);

		if (!form.title || !form.siteurl || !form.friendPageUrl) {
			await comment(
				github,
				owner,
				repo,
				issueNumber,
				'❌ **信息不完整**\n\n「网站名称」「网站链接」「友链页面 URL」三项都要填，且链接必须是完整的 `https://` 地址。\n\n改完可以直接在本 Issue 里回复，会自动重新检查。',
			);
			await safeAddLabels(github, owner, repo, issueNumber, [LABEL_NEEDS_FIX]);
			return;
		}

		// ── 校验 ──
		const result = await validate(form);

		if (!result.ok) {
			if (result.kind === 'missing-backlink') {
				await comment(
					github,
					owner,
					repo,
					issueNumber,
					[
						`❌ **未在友链页找到本站友链**：${form.title}`,
						'',
						`- 检查的页面：${result.actualUrl}`,
						`- 页面标题：${result.title || '（无）'}`,
						'',
						'请先把本站加进你的友链页，信息如下：',
						'',
						'```',
						`名称：${SITE_INFO.name}`,
						`链接：${SITE_INFO.url}`,
						`头像：${SITE_INFO.avatar}`,
						`描述：${SITE_INFO.desc}`,
						'```',
						'',
						'> 💡 加好之后，直接回复本 Issue 即可自动重新检查。',
						'> 注意：如果友链页是纯 JS 渲染的（内容靠前端请求才出来），机器人抓不到，请改用服务端渲染或静态输出。',
					].join('\n'),
				);
			} else {
				await comment(
					github,
					owner,
					repo,
					issueNumber,
					[
						`❌ **验证失败**：${form.title}`,
						'',
						`- 原因：${result.detail}`,
						result.actualUrl ? `- 实际访问到：${result.actualUrl}` : '',
						'',
						'> 💡 修好后直接回复本 Issue 即可重新检查。',
					]
						.filter(Boolean)
						.join('\n'),
				);
			}
			await safeAddLabels(github, owner, repo, issueNumber, [LABEL_NEEDS_FIX]);
			return;
		}

		// ── 写入 + 提交 ──
		const repoRoot = process.env.GITHUB_WORKSPACE || process.cwd();
		const update = insertFriend(repoRoot, form);

		if (!update.changed) {
			await comment(
				github,
				owner,
				repo,
				issueNumber,
				`ℹ️ **${form.title}** 已经在友链列表里了（按域名去重），无需重复添加。`,
			);
			await safeRemoveLabel(github, owner, repo, issueNumber, LABEL_PENDING);
			await safeRemoveLabel(github, owner, repo, issueNumber, LABEL_NEEDS_FIX);
			await github.rest.issues.update({
				owner,
				repo,
				issue_number: issueNumber,
				state: 'closed',
				state_reason: 'completed',
			});
			return;
		}

		const branch = context.payload.repository?.default_branch || 'HY';
		const committed = commitAndPush(repoRoot, branch, form.title);

		await comment(
			github,
			owner,
			repo,
			issueNumber,
			[
				`✅ **${form.title}** 已通过自动校验，已加入友链列表。`,
				'',
				'| 字段 | 值 |',
				'| --- | --- |',
				`| 名称 | ${form.title} |`,
				`| 链接 | ${trimSlash(form.siteurl)} |`,
				`| 描述 | ${form.desc || '—'} |`,
				`| RSS | ${form.rss || '—'} |`,
				`| 首页照片 | ${form.homepage || '—'} |`,
				'',
				committed
					? '站点正在自动重新构建，几分钟后就能在友链页看到你。'
					: '（配置无变化，未产生提交）',
			].join('\n'),
		);

		await safeRemoveLabel(github, owner, repo, issueNumber, LABEL_PENDING);
		await safeRemoveLabel(github, owner, repo, issueNumber, LABEL_NEEDS_FIX);
		await github.rest.issues.update({
			owner,
			repo,
			issue_number: issueNumber,
			state: 'closed',
			state_reason: 'completed',
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		await comment(
			github,
			owner,
			repo,
			issueNumber,
			`❌ 自动处理时出了异常：\n\n\`\`\`\n${message}\n\`\`\`\n\n请到 Actions 日志里看看，或手动处理。`,
		);
		throw error;
	}
};

// ── 本地 dry-run 自测入口（Actions 中不使用）──────────────────────
module.exports.__test = {
	clean,
	normalizeUrl,
	parseIssueForm,
	buildForm,
	renderFriend,
	insertFriend,
	findBacklink,
	sameSite,
	validate,
};
