import type {
	InterconnectSite,
	InterconnectSiteConfig,
} from "@/types/chatConfig";

/**
 * 提取 URL 或主机名中的小写域名（自动去除协议、端口与路径）
 */
export function extractCleanHostname(raw?: string): string {
	const trimmed = (raw || "").trim();
	if (!trimmed) return "";
	try {
		const parsed = new URL(
			trimmed.includes("://") ? trimmed : `https://${trimmed}`,
		);
		return parsed.hostname.toLowerCase();
	} catch {
		return trimmed
			.replace(/^https?:\/\//i, "")
			.split(/[/:]/)[0]
			.toLowerCase();
	}
}

/**
 * 归一化互联站点配置列表
 * 自动填充 url 兼容字段，并将 homeserver、siteUrl、chatUrl 域名汇总至 aliases，
 * 使任何消费组件无须关心底层别名罗列，直接开箱即用。
 */
export function normalizeInterconnectSites(
	configs: InterconnectSiteConfig[] = [],
): InterconnectSite[] {
	return configs.map((cfg) => {
		const siteUrl = cfg.siteUrl || cfg.url || "";
		const chatUrl = cfg.chatUrl || cfg.url || siteUrl;
		const effectiveUrl = cfg.isSelf
			? (cfg.chatUrl || cfg.url || "/")
			: (chatUrl || siteUrl);

		const aliasSet = new Set<string>();
		if (Array.isArray(cfg.aliases)) {
			for (const a of cfg.aliases) {
				const c = a.trim();
				if (c) aliasSet.add(c);
			}
		}

		// 1. 自动提取并登记 homeserver 域名（核心 Matrix 匹配凭据）
		if (cfg.homeserver) {
			const hsHost = extractCleanHostname(cfg.homeserver);
			if (hsHost) aliasSet.add(hsHost);
		}

		// 2. 自动提取并登记 siteUrl 域名及其二级根域
		if (siteUrl) {
			const siteHost = extractCleanHostname(siteUrl);
			if (siteHost) {
				aliasSet.add(siteHost);
				const parts = siteHost.split(".");
				if (parts.length >= 2) {
					aliasSet.add(parts.slice(-2).join("."));
				}
			}
		}

		// 3. 自动提取并登记 chatUrl 域名
		if (chatUrl) {
			const chatHost = extractCleanHostname(chatUrl);
			if (chatHost) aliasSet.add(chatHost);
		}

		if (cfg.name) aliasSet.add(cfg.name);
		if (cfg.badge) aliasSet.add(cfg.badge);

		return {
			...cfg,
			url: effectiveUrl,
			siteUrl: siteUrl || effectiveUrl,
			chatUrl: chatUrl || effectiveUrl,
			badge: cfg.badge || cfg.name,
			aliases: Array.from(aliasSet),
		};
	});
}
