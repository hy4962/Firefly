/**
 * DiceBear 剪纸风（Cutouts）怪异搞笑趣味头像生成与解析工具
 * 采用 10.x 的 cutouts 风格：拼贴剪纸怪异艺术风，不对称五官与奇趣拼贴
 */

export type DiceBearStyle = "cutouts" | "bottts" | "fun-emoji";

/**
 * 根据种子（用户名、邮箱或访客标识）生成确定性的 DiceBear 剪纸风矢量头像地址
 * @param seed 用户名 / 邮箱 / 访客标识
 * @param style 默认 "cutouts"
 * @returns 完整的 SVG 头像 CDN 地址
 */
export function getDiceBearAvatar(
	seed?: string,
	style: DiceBearStyle = "cutouts",
): string {
	const clean = (seed || "").trim();
	const safeSeed = clean || "guest";
	if (style === "cutouts") {
		return `https://api.dicebear.com/10.x/cutouts/svg?seed=${encodeURIComponent(safeSeed)}`;
	}
	return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(safeSeed)}`;
}

/**
 * 兼容旧命名导出，默认使用 Cutouts 剪纸拼贴怪异搞笑风
 */
export function getDiceBearGlassAvatar(seed?: string): string {
	return getDiceBearAvatar(seed, "cutouts");
}
