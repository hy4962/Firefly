/**
 * 刷新 Steam 游戏库快照：结果写入 src/data/steam-snapshot.json 供构建时读取。
 *
 * 由 GitHub Actions 定时执行（.github/workflows/refresh-friends-feed.yml），
 * 与朋友圈快照共用一次提交、一次构建。
 *
 * 两条取数路径，自动选择：
 *   A. 完整模式 —— 需要仓库 Secret STEAM_API_KEY + Steam 隐私设置「游戏详情」公开。
 *      拿到完整游戏库、每款总时长、近两周时长、最后游玩日期、等级与徽章数。
 *   B. 精简模式 —— 没有 Key 时走 steamcommunity 的公开 XML，
 *      只能拿到昵称 / 头像 / 在线状态 / 常玩的几款游戏（含时长）。不需要任何凭据。
 *
 * 两条路径失败都不会让 CI 变红：请求出错时保留旧快照。
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import steamConfig from "../src/config/steamConfig";

const SNAPSHOT_FILE = join(process.cwd(), "src/data/steam-snapshot.json");
const API_BASE = "https://api.steampowered.com";
const COMMUNITY_XML_BASE = "https://steamcommunity.com/profiles";
const FETCH_TIMEOUT_MS = 10000;
const FETCH_RETRY_ATTEMPTS = 3;
const FETCH_RETRY_DELAY_MS = 500;

type SteamGame = {
	appid: number;
	name: string;
	minutes: number;
	recentMinutes: number;
	lastPlayed: number | null;
	header: string;
};

type SteamProfile = {
	steamId: string;
	name: string;
	avatar: string;
	profileUrl: string;
	online: boolean;
	stateMessage: string;
	level: number;
	badgeCount: number;
};

type SteamSnapshot = {
	version: number;
	updatedAt: string | null;
	/** true = 精简模式（未配置 API Key），数据不完整 */
	partial: boolean;
	profile: SteamProfile | null;
	stats: {
		gameCount: number;
		totalMinutes: number;
		recentMinutes: number;
	};
	games: SteamGame[];
};

const PERSONA_STATE_ONLINE = new Set([1, 2, 3, 4, 5, 6]);

async function fetchText(url: string): Promise<string> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= FETCH_RETRY_ATTEMPTS; attempt++) {
		try {
			const response = await fetch(url, {
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			return await response.text();
		} catch (error) {
			lastError = error;
			if (attempt < FETCH_RETRY_ATTEMPTS) {
				await new Promise((resolve) =>
					setTimeout(resolve, FETCH_RETRY_DELAY_MS * attempt),
				);
			}
		}
	}
	throw lastError;
}

async function fetchJson(url: string): Promise<unknown> {
	return JSON.parse(await fetchText(url));
}

async function readExistingSnapshot(): Promise<SteamSnapshot | null> {
	try {
		const raw = await readFile(SNAPSHOT_FILE, "utf8");
		const parsed = JSON.parse(raw) as SteamSnapshot;
		if (parsed && Array.isArray(parsed.games)) {
			return parsed;
		}
		return null;
	} catch {
		return null;
	}
}

function buildHeaderImage(appid: number): string {
	return `${steamConfig.headerImageBase}/${appid}/header.jpg`;
}

/** 取某个 XML 标签的文本，自动剥掉 CDATA */
function pickTag(xml: string, tag: string): string {
	const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
	if (!match) return "";
	return match[1]
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1")
		.trim();
}

/** 数字字符串可能带千分位逗号，例如 "2,265" */
function parseNumber(value: string): number {
	const cleaned = value.replace(/,/g, "").trim();
	const parsed = Number.parseFloat(cleaned);
	return Number.isFinite(parsed) ? parsed : 0;
}

function stripHtml(value: string): string {
	return value
		.replace(/<br\s*\/?>/gi, " · ")
		.replace(/<[^>]+>/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

// ---------------------------------------------------------------------------
// 路径 B：精简模式（免 Key，读 steamcommunity 公开 XML）
// ---------------------------------------------------------------------------
async function fetchFromCommunityXml(steamId: string): Promise<SteamSnapshot> {
	const xml = await fetchText(`${COMMUNITY_XML_BASE}/${steamId}/?xml=1`);

	const onlineState = pickTag(xml, "onlineState");
	const profile: SteamProfile = {
		steamId,
		name: pickTag(xml, "steamID"),
		avatar: pickTag(xml, "avatarFull"),
		profileUrl:
			steamConfig.profileUrl ||
			`https://steamcommunity.com/profiles/${steamId}/`,
		online: onlineState !== "offline" && onlineState !== "",
		stateMessage: stripHtml(pickTag(xml, "stateMessage")),
		level: 0,
		badgeCount: 0,
	};

	const blocks = xml.match(/<mostPlayedGame>[\s\S]*?<\/mostPlayedGame>/g) ?? [];
	const games: SteamGame[] = blocks
		.map((block) => {
			const link = pickTag(block, "gameLink");
			const appid = Number(link.match(/\/app\/(\d+)/)?.[1] ?? 0);
			if (appid <= 0) return null;
			return {
				appid,
				name: pickTag(block, "gameName"),
				// XML 里是小时，快照统一用分钟
				minutes: Math.round(parseNumber(pickTag(block, "hoursOnRecord")) * 60),
				recentMinutes: Math.round(
					parseNumber(pickTag(block, "hoursPlayed")) * 60,
				),
				lastPlayed: null,
				header: buildHeaderImage(appid),
			};
		})
		.filter((game): game is SteamGame => game !== null);

	games.sort((a, b) => b.minutes - a.minutes);
	const trimmed =
		steamConfig.maxGames > 0 ? games.slice(0, steamConfig.maxGames) : games;

	if (!profile.name) {
		throw new Error("XML 里没有昵称，可能是档案不公开或 ID 有误");
	}

	return {
		version: 1,
		updatedAt: new Date().toISOString(),
		partial: true,
		profile,
		stats: {
			// 精简模式拿不到真实拥有数，置 0 让页面改用收录数
			gameCount: 0,
			totalMinutes: games.reduce((sum, game) => sum + game.minutes, 0),
			recentMinutes: games.reduce((sum, game) => sum + game.recentMinutes, 0),
		},
		games: trimmed,
	};
}

// ---------------------------------------------------------------------------
// 路径 A：完整模式（Steam Web API，需要 Key）
// ---------------------------------------------------------------------------
async function fetchFromWebApi(
	apiKey: string,
	steamId: string,
): Promise<SteamSnapshot> {
	const keyParam = `key=${encodeURIComponent(apiKey)}&steamid=${steamId}`;

	// 注意：只有这个接口的参数名是复数 steamids，其余都是单数 steamid
	const summaryUrl =
		`${API_BASE}/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}` +
		`&steamids=${steamId}`;
	const summaryData = (await fetchJson(summaryUrl)) as {
		response?: { players?: Array<Record<string, unknown>> };
	};
	const player = summaryData.response?.players?.[0];

	if (!player) {
		throw new Error("个人资料为空，检查 Steam ID 是否正确");
	}

	const personastate = Number(player.personastate ?? 0);
	const profile: SteamProfile = {
		steamId,
		name: String(player.personaname ?? ""),
		avatar: String(player.avatarfull ?? ""),
		profileUrl:
			steamConfig.profileUrl ||
			String(
				player.profileurl ?? `https://steamcommunity.com/profiles/${steamId}/`,
			),
		online: PERSONA_STATE_ONLINE.has(personastate),
		stateMessage: "",
		level: 0,
		badgeCount: 0,
	};

	// 等级与徽章数：非必需，失败不影响其余字段
	try {
		const badgeUrl = `${API_BASE}/IPlayerService/GetBadges/v1/?${keyParam}`;
		const badgeData = (await fetchJson(badgeUrl)) as {
			response?: { player_level?: number; badges?: unknown[] };
		};
		profile.level = Number(badgeData.response?.player_level ?? 0);
		profile.badgeCount = badgeData.response?.badges?.length ?? 0;
	} catch (error) {
		console.log(`[steam] 徽章信息获取失败，跳过：${String(error)}`);
	}

	const gamesUrl =
		`${API_BASE}/IPlayerService/GetOwnedGames/v1/?${keyParam}` +
		`&include_appinfo=1&include_played_free_games=${steamConfig.includeFreeGames ? 1 : 0}` +
		`&format=json`;
	const gamesData = (await fetchJson(gamesUrl)) as {
		response?: { game_count?: number; games?: Array<Record<string, unknown>> };
	};
	const rawGames = gamesData.response?.games ?? [];

	const games: SteamGame[] = rawGames
		.filter((game) => Number(game.appid ?? 0) > 0)
		.map((game) => ({
			appid: Number(game.appid),
			name: String(game.name ?? `App ${game.appid}`),
			minutes: Number(game.playtime_forever ?? 0),
			recentMinutes: Number(game.playtime_2weeks ?? 0),
			lastPlayed: game.rtime_last_played
				? Number(game.rtime_last_played)
				: null,
			header: buildHeaderImage(Number(game.appid)),
		}));

	// 没玩过的游戏（时长 0）不占版面
	const played = games.filter((game) => game.minutes > 0);

	played.sort((a, b) =>
		steamConfig.sortBy === "lastPlayed"
			? (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)
			: b.minutes - a.minutes,
	);

	const trimmed =
		steamConfig.maxGames > 0 ? played.slice(0, steamConfig.maxGames) : played;

	return {
		version: 1,
		updatedAt: new Date().toISOString(),
		partial: false,
		profile,
		stats: {
			gameCount: Number(gamesData.response?.game_count ?? games.length),
			totalMinutes: games.reduce((sum, game) => sum + game.minutes, 0),
			recentMinutes: games.reduce((sum, game) => sum + game.recentMinutes, 0),
		},
		games: trimmed,
	};
}

async function main() {
	const apiKey = process.env.STEAM_API_KEY?.trim();
	const steamId = steamConfig.steamId.trim();

	if (!/^\d{17}$/.test(steamId)) {
		console.log(
			`[steam] steamConfig.steamId 不是合法的 64 位 ID（当前：${steamId}），跳过刷新`,
		);
		return;
	}

	const snapshot = apiKey
		? await fetchFromWebApi(apiKey, steamId)
		: await fetchFromCommunityXml(steamId);

	await writeFile(
		SNAPSHOT_FILE,
		`${JSON.stringify(snapshot, null, 2)}\n`,
		"utf8",
	);

	const mode = snapshot.partial ? "精简" : "完整";
	const totalHours = (snapshot.stats.totalMinutes / 60).toFixed(1);
	console.log(
		`[steam] ${mode}模式 / ${snapshot.profile?.name ?? "?"} / ` +
			`收录 ${snapshot.games.length} 款 / 总时长 ${totalHours}h` +
			(apiKey ? "" : "（未配置 STEAM_API_KEY，配置后可拿到完整游戏库）"),
	);
}

try {
	await main();
} catch (error) {
	const fallback = await readExistingSnapshot();
	console.error(
		`[steam] 刷新失败，保留旧快照${fallback?.updatedAt ? `（${fallback.updatedAt}）` : ""}：${String(error)}`,
	);
	// 不抛出：定时任务失败不应该让整条流水线变红
}
