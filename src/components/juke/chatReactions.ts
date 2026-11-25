import { LOTTIE_LABELS, type StickerItem } from "./stickerLoader";

export const DEFAULT_CHAT_SERVER_URL = "https://chat-server.lengxiqwq.com";

/** 高频快捷回应表情预设（常驻快速操作栏，默认 6 个经典表情） */
export const QUICK_REACTION_PRESETS: string[] = [
	"👍",
	"❤️",
	"😂",
	"🎉",
	"🍵",
	"👀",
];

export interface ReactionDisplayInfo {
	/** 显示方式: 文本/Emoji 或 微缩图片 */
	type: "text" | "image";
	/** 文本或 Emoji 符号 */
	text?: string;
	/** 图片 HTTP URL（针对 mxc:// 资源、贴纸或外部图片） */
	url?: string;
	/** 备用图片 URL（加载失败时平滑降级） */
	fallbackUrl?: string;
	/** 无障碍或提示文本 */
	alt: string;
	/** 是否属于自定义媒体（mxc / 贴纸） */
	isCustomMedia?: boolean;
}

/**
 * 将 Matrix mxc:// 格式 URI 转换为聊天网关的反代 HTTP URL
 */
export function mxcToHttp(
	mxcUrl: string,
	serverUrl: string = DEFAULT_CHAT_SERVER_URL,
): string {
	if (!mxcUrl || typeof mxcUrl !== "string") return "";
	const trimmed = mxcUrl.trim();
	const match = trimmed.match(/^mxc:\/\/([^/?#]+)\/([^?#]+)/);
	if (!match) {
		return /^https?:\/\//i.test(trimmed) ? trimmed : "";
	}
	const serverName = match[1];
	const mediaId = match[2];
	if (
		serverName.includes("..") ||
		mediaId.includes("..") ||
		mediaId.includes("/")
	) {
		return "";
	}
	const base = (serverUrl || DEFAULT_CHAT_SERVER_URL).replace(/\/+$/, "");
	return `${base}/api/media/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`;
}

/**
 * 将回应表情的原始 key（Unicode emoji、mxc://...、贴纸短码、颜文字等）
 * 解析为统一的前端展示结构
 */
export function resolveReactionDisplay(
	rawKey: string,
	chatServerUrl: string = DEFAULT_CHAT_SERVER_URL,
	stickerMap?: Map<string, StickerItem>,
): ReactionDisplayInfo {
	const key = (rawKey || "").trim();
	if (!key) {
		return { type: "text", text: "❓", alt: "未知回应" };
	}

	// 1. Matrix mxc 资源
	if (key.startsWith("mxc://")) {
		const httpUrl = mxcToHttp(key, chatServerUrl);
		return {
			type: "image",
			url: httpUrl,
			alt: "自定义表情",
			isCustomMedia: true,
		};
	}

	// 2. HTTP/HTTPS 图片链接（如特定网关代理或外部安全图）
	if (/^https?:\/\//i.test(key)) {
		return {
			type: "image",
			url: key,
			alt: "自定义表情",
			isCustomMedia: true,
		};
	}

	// 3. 站内表情贴纸匹配（如 :qq_xxx: 或表情代码）
	const stickerItem = stickerMap?.get(key);
	if (stickerItem) {
		return {
			type: "image",
			url: stickerItem.url,
			alt: stickerItem.name || "贴纸表情",
			isCustomMedia: true,
		};
	}

	// 4. Lottie 动态表情代号匹配 [lottie:name]
	const lottieMatch = key.match(/^\[lottie:([a-z0-9_-]+)\]$/i);
	if (lottieMatch) {
		const lottieName = lottieMatch[1];
		const label = LOTTIE_LABELS[lottieName] || lottieName;
		const base = (chatServerUrl || DEFAULT_CHAT_SERVER_URL).replace(/\/+$/, "");
		const gifUrl = `/assets/stickers/lottie/${encodeURIComponent(lottieName)}.gif`;
		const webpUrl = `${base}/api/lottie/${encodeURIComponent(lottieName)}.webp`;
		return {
			type: "image",
			url: gifUrl,
			fallbackUrl: webpUrl,
			alt: label,
			isCustomMedia: true,
		};
	}

	// 5. 纯文本 / Unicode Emoji / 颜文字
	return {
		type: "text",
		text: key,
		alt: key,
		isCustomMedia: false,
	};
}

export interface EmojiGroup {
	id: string;
	title: string;
	icon: string;
	emojis: string[];
}

/** 完整丰富的分类回应表情库 */
export const REACTION_CATEGORY_GROUPS: EmojiGroup[] = [
	{
		id: "frequent",
		title: "常用高频",
		icon: "🔥",
		emojis: [
			"👍",
			"❤️",
			"😂",
			"🎉",
			"🔥",
			"👀",
			"😭",
			"🤔",
			"🍵",
			"✨",
			"🙏",
			"👏",
			"💯",
			"🤣",
			"🥰",
			"😮",
			"🌙",
			"☕",
			"🚀",
			"💤",
			"🤡",
			"🫡",
			"🥺",
			"🤯",
		],
	},
	{
		id: "smileys",
		title: "情绪与神态",
		icon: "😄",
		emojis: [
			"😀",
			"😃",
			"😄",
			"😁",
			"😆",
			"🥹",
			"😅",
			"😂",
			"🤣",
			"🥲",
			"☺️",
			"😊",
			"😇",
			"🙂",
			"🙃",
			"😉",
			"😌",
			"😍",
			"🥰",
			"😘",
			"😗",
			"😙",
			"😚",
			"😋",
			"😛",
			"😝",
			"😜",
			"🤪",
			"🤨",
			"🧐",
			"🤓",
			"😎",
			"🥸",
			"🤩",
			"🥳",
			"😏",
			"😒",
			"😞",
			"😔",
			"😟",
			"😕",
			"🙁",
			"☹️",
			"😣",
			"😖",
			"😫",
			"😩",
			"🥺",
			"😢",
			"😭",
			"😮‍💨",
			"😤",
			"😠",
			"😡",
			"🤬",
			"🤯",
			"😳",
			"🥵",
			"🥶",
			"😱",
			"😨",
			"😰",
			"😥",
			"😓",
			"🫣",
			"🤗",
			"🫡",
			"🤔",
			"🫢",
			"🤫",
			"🤥",
			"😶",
			"😐",
			"😑",
			"😬",
			"🫨",
			"🫠",
			"🙄",
			"😯",
			"😦",
			"😧",
			"😮",
			"😲",
			"🥱",
			"😴",
			"🤤",
			"😪",
			"😵",
			"🤐",
			"🥴",
			"🤢",
			"🤮",
			"🤧",
			"😷",
			"🤒",
			"🤕",
			"🤑",
			"🤠",
			"😈",
			"👿",
			"🤡",
			"💩",
			"👻",
			"💀",
			"👽",
			"🤖",
		],
	},
	{
		id: "gestures",
		title: "手势与互动",
		icon: "👋",
		emojis: [
			"👍",
			"👎",
			"👏",
			"🙌",
			"🫶",
			"👐",
			"🤲",
			"🤝",
			"🤜",
			"🤛",
			"✊",
			"👊",
			"🫳",
			"🫴",
			"🤏",
			"🤌",
			"✌️",
			"🤞",
			"🫰",
			"🤟",
			"🤘",
			"🤙",
			"👈",
			"👉",
			"👆",
			"👇",
			"☝️",
			"🫵",
			"👋",
			"🤚",
			"🖐️",
			"✋",
			"🖖",
			"✍️",
			"🤳",
			"💅",
			"🙏",
			"🙇",
			"🙋",
			"🤷",
			"🤦",
			"👀",
			"👁️",
			"👅",
			"👄",
			"🫦",
			"🫂",
		],
	},
	{
		id: "symbols",
		title: "爱心与气氛",
		icon: "💖",
		emojis: [
			"❤️",
			"🧡",
			"💛",
			"💚",
			"💙",
			"💜",
			"🖤",
			"🤍",
			"🤎",
			"💔",
			"❤️‍🔥",
			"❤️‍🩹",
			"❣️",
			"💕",
			"💞",
			"💓",
			"💗",
			"💖",
			"💘",
			"💝",
			"💟",
			"🔥",
			"💥",
			"✨",
			"🌟",
			"💫",
			"⭐",
			"🌠",
			"💯",
			"💢",
			"💤",
			"🎉",
			"🎊",
			"🎈",
			"🎁",
			"🏆",
			"🥇",
			"🎯",
			"🎲",
			"🎮",
			"💡",
			"🔔",
			"📢",
			"💬",
			"💭",
			"❗",
			"❓",
			"❔",
			"‼️",
			"⁉️",
			"✅",
			"❌",
			"⭕",
			"🛑",
			"⚠️",
		],
	},
	{
		id: "life",
		title: "茶饮与生活",
		icon: "🍵",
		emojis: [
			"🍵",
			"☕",
			"🧋",
			"🍺",
			"🍻",
			"🥂",
			"🍷",
			"🍶",
			"🥤",
			"🎂",
			"🍰",
			"🍦",
			"🍉",
			"🍓",
			"🌸",
			"🌻",
			"🍀",
			"☀️",
			"🌙",
			"🌈",
			"☁️",
			"⚡",
			"❄️",
			"🌊",
			"🚀",
			"🚗",
			"🚲",
			"🎧",
			"🎵",
			"🎶",
			"💻",
			"📱",
			"📷",
			"📚",
			"🎨",
		],
	},
	{
		id: "kaomoji",
		title: "经典颜文字",
		icon: "(=^･ω･^=)",
		emojis: [
			"OωO",
			"(☆ω☆)",
			"(＾▽＾)",
			"(≧∇≦)/",
			"(๑>◡<๑)",
			"ヽ(✿ﾟ▽ﾟ)ノ",
			"(o˘◡˘o)",
			"(๑˃̵ᴗ˂̵)و",
			"(♡°▽°♡)",
			"(｡♥‿♥｡)",
			"( ˘ ³˘)♥",
			"(づ｡◕‿‿◕｡)づ",
			"(╥﹏╥)",
			"(ಥ﹏╥)",
			"(T＿T)",
			"(;ω;)",
			"(╬◣д◢)",
			"(ノ°Д°)ノ",
			"(・_・;)",
			"(⊙_⊙)",
			"(*/ω＼*)",
			"(*/▽＼*)",
			"╮(╯▽╰)╭",
			"┐(‘～`；)┌",
			"(￣▽￣)ノ",
			"(～￣▽￣)～",
		],
	},
];
