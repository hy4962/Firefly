// ============================================================================
// Steam 游戏库配置 - 数据来源 Steam Web API，由 GitHub Actions 定时写入快照
// Steam Library Configuration - data comes from Steam Web API, refreshed by CI
// ============================================================================

export type SteamConfig = {
	/** 64 位 Steam ID，形如 7656119xxxxxxxxxx。可在 Steam 客户端「账户明细」或 steamid.io 查到 */
	steamId: string;
	/** 自定义个人主页地址（可选）。留空则回退到 /profiles/<steamId>/ */
	profileUrl: string;
	/** 展示的游戏数量上限，按时长降序截断。0 表示不限制 */
	maxGames: number;
	/** 排序方式：按总时长 / 按最后游玩时间 */
	sortBy: "playtime" | "lastPlayed";
	/** 是否展示「最近游玩」模块（近两周有时长的游戏） */
	showRecent: boolean;
	/** 是否把玩过的免费游戏（CS2、Apex 等）纳入统计 */
	includeFreeGames: boolean;
	/** 封面图 CDN 前缀，末尾不要带斜杠 */
	headerImageBase: string;
};

const steamConfig: SteamConfig = {
	steamId: "76561199212880612",
	profileUrl: "https://steamcommunity.com/id/HY-bulebird/",
	maxGames: 60,
	sortBy: "playtime",
	showRecent: true,
	includeFreeGames: true,
	// 直连实测 200（460×215 jpeg，约 34KB），无需额外调用商店 API 拿 hash
	headerImageBase: "https://cdn.cloudflare.steamstatic.com/steam/apps",
};

export default steamConfig;
