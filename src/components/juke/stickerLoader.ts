import type {
	ChatAttachment,
	ChatAttachmentKind,
	ChatReplyRef,
} from "./chatTypes";

export type StickerCategory = "qq" | "emoji" | "sticker";

export interface StickerItem {
	code: string;
	name: string;
	url: string;
	category: StickerCategory;
	lottie?: string;
}

export interface StickerPack {
	id: string;
	name: string;
	iconUrl: string;
	category: StickerCategory;
	items: StickerItem[];
}

export type ChatContentSegment =
	| { kind: "text"; text: string }
	| { kind: "mention"; text: string; userKey: string }
	| {
			kind: "sticker";
			code: string;
			url: string;
			alt: string;
			category: StickerCategory;
			lottie?: string;
	  };

export const LOTTIE_LABELS: Record<string, string> = {
	// 27 精选动态表情
	caigou: "菜狗",
	aini: "爱你",
	bianpao: "鞭炮",
	bixin: "比心",
	cool: "酷",
	daku: "大哭",
	exin: "恶心",
	fan: "烦",
	foxi: "佛系",
	gandong: "感动",
	gongzuo: "工作",
	huang: "慌",
	jingxia: "惊吓",
	jiong: "囧",
	kaixin: "开心",
	meiku: "美哭",
	meishi: "美食",
	re: "热",
	shengqi: "生气",
	shengri: "生日",
	shuijiao: "睡觉",
	tietie: "贴贴",
	wangpan: "网盘",
	wenhao: "问号",
	wuzui: "捂嘴",
	xiaoku: "笑哭",
	yanhua: "烟花",
	// 84 QQ 超级表情
	"qq-5-5": "流泪",
	"qq-181-181": "戳一戳",
	"qq-311-311": "打call",
	"qq-314-314": "仔细分析",
	"qq-317-317": "菜汪",
	"qq-318-318": "崇拜",
	"qq-320-320": "庆祝",
	"qq-337-337": "花朵脸",
	"qq-338-338": "我想开了",
	"qq-341-341": "打招呼",
	"qq-342-342": "酸Q",
	"qq-343-343": "我方了",
	"qq-344-344": "大怨种",
	"qq-346-346": "你真棒棒",
	"qq-349-349": "坚强",
	"qq-351-351": "敲敲",
	"qq-360-360": "亲亲",
	"qq-361-361": "狗狗笑哭",
	"qq-363-363": "狗狗可怜",
	"qq-364-364": "超级赞",
	"qq-365-365": "狗狗生气",
	"qq-367-367": "狗狗疑问",
	"qq-371-371": "冒泡",
	"qq-372-372": "气呼呼",
	"qq-373-373": "忙",
	"qq-375-375": "超级鼓掌",
	"qq-377-377": "嗨",
	"qq-378-378": "企鹅笑哭",
	"qq-379-379": "企鹅流泪",
	"qq-380-380": "真棒",
	"qq-381-381": "路过",
	"qq-382-382": "emo",
	"qq-383-383": "企鹅爱心",
	"qq-384-384": "晚安",
	"qq-385-385": "太气了",
	"qq-387-387": "太好笑",
	"qq-388-388": "太头疼",
	"qq-390-390": "太头秃",
	"qq-391-391": "太沧桑",
	"qq-395-395": "略略略",
	"qq-397-397": "抛媚眼",
	"qq-398-398": "超级ok",
	"qq-400-400": "快乐",
	"qq-402-402": "别说话",
	"qq-403-403": "出去玩",
	"qq-404-404": "闪亮登场",
	"qq-405-405": "好运来",
	"qq-407-407": "我听听",
	"qq-408-408": "臭美",
	"qq-409-409": "送你花花",
	"qq-410-410": "么么哒",
	"qq-412-412": "开心",
	"qq-425-425": "求放过",
	"qq-427-427": "偷感",
	"qq-450-450": "委屈巴巴",
	"qq-451-451": "花痴流口水",
	"qq-452-452": "微笑",
	"qq-453-453": "气哭了",
	"qq-454-454": "墨镜酷",
	"qq-455-455": "星星眼",
	"qq-456-456": "擦鼻涕",
	"qq-457-457": "睡着了",
	"qq-458-458": "流口水",
	"qq-460-460": "无语",
	"qq-461-461": "晕头转向",
	"qq-462-462": "笑出汗",
	"qq-468-468": "探头围观",
	"qq-469-469": "嘘",
	"qq-472-472": "脸红心跳",
	"qq-474-474": "加油",
	"qq-475-475": "干饭",
	"qq-476-476": "努力工作",
	"qq-477-477": "偷笑",
	"qq-478-478": "可以",
	"qq-479-479": "不可以",
	"qq-481-481": "认真学习",
	"qq-482-482": "热化了",
	"qq-483-483": "拜托了",
	"qq-484-484": "满满爱心",
	"qq-489-489": "惊呆了",
	"qq-490-490": "满心期待",
	"qq-491-491": "认真敲代码",
	"qq-492-492": "仔细查找",
	"qq-493-493": "睡觉啦",
};

export const LOTTIE_SPRITE_KEYS: string[] = [
	"aini",
	"bianpao",
	"bixin",
	"caigou",
	"cool",
	"daku",
	"exin",
	"fan",
	"foxi",
	"gandong",
	"gongzuo",
	"huang",
	"jingxia",
	"jiong",
	"kaixin",
	"meiku",
	"meishi",
	"qq-181-181",
	"qq-311-311",
	"qq-314-314",
	"qq-317-317",
	"qq-318-318",
	"qq-320-320",
	"qq-337-337",
	"qq-338-338",
	"qq-341-341",
	"qq-342-342",
	"qq-343-343",
	"qq-344-344",
	"qq-346-346",
	"qq-349-349",
	"qq-351-351",
	"qq-360-360",
	"qq-361-361",
	"qq-363-363",
	"qq-364-364",
	"qq-365-365",
	"qq-367-367",
	"qq-371-371",
	"qq-372-372",
	"qq-373-373",
	"qq-375-375",
	"qq-377-377",
	"qq-378-378",
	"qq-379-379",
	"qq-380-380",
	"qq-381-381",
	"qq-382-382",
	"qq-383-383",
	"qq-384-384",
	"qq-385-385",
	"qq-387-387",
	"qq-388-388",
	"qq-390-390",
	"qq-391-391",
	"qq-395-395",
	"qq-397-397",
	"qq-398-398",
	"qq-400-400",
	"qq-402-402",
	"qq-403-403",
	"qq-404-404",
	"qq-405-405",
	"qq-407-407",
	"qq-408-408",
	"qq-409-409",
	"qq-410-410",
	"qq-412-412",
	"qq-425-425",
	"qq-427-427",
	"qq-450-450",
	"qq-451-451",
	"qq-452-452",
	"qq-453-453",
	"qq-454-454",
	"qq-455-455",
	"qq-456-456",
	"qq-457-457",
	"qq-458-458",
	"qq-460-460",
	"qq-461-461",
	"qq-462-462",
	"qq-468-468",
	"qq-469-469",
	"qq-472-472",
	"qq-474-474",
	"qq-475-475",
	"qq-476-476",
	"qq-477-477",
	"qq-478-478",
	"qq-479-479",
	"qq-481-481",
	"qq-482-482",
	"qq-483-483",
	"qq-484-484",
	"qq-489-489",
	"qq-490-490",
	"qq-491-491",
	"qq-492-492",
	"qq-493-493",
	"qq-5-5",
	"re",
	"shengqi",
	"shengri",
	"shuijiao",
	"tietie",
	"wangpan",
	"wenhao",
	"wuzui",
	"xiaoku",
	"yanhua",
];

export const LOTTIE_SPRITE_URL = "https://rainzt.cn/lottie/preview-sprite.webp";

export function getLottieSpriteStyle(name: string): string {
	const idx = LOTTIE_SPRITE_KEYS.indexOf(name.toLowerCase());
	if (idx < 0) return "";
	const rows = Math.ceil(LOTTIE_SPRITE_KEYS.length / 12);
	const col = idx % 12;
	const row = Math.floor(idx / 12);
	const posX = ((col / 11) * 100).toFixed(2);
	const posY = ((row / Math.max(1, rows - 1)) * 100).toFixed(2);
	return `background-image: url('${LOTTIE_SPRITE_URL}'); background-size: 1200% ${rows * 100}%; background-position: ${posX}% ${posY}%;`;
}

export interface LottieStickerItem {
	name: string;
	label: string;
	token: string;
	group: "animal" | "featured" | "qq";
}

/** 动物萌宠类动态 Lottie 表情（菜狗、菜汪、狗狗与企鹅等） */
export const ANIMAL_LOTTIE_ITEMS: LottieStickerItem[] = [
	{ name: "caigou", label: "菜狗", token: "[lottie:caigou]", group: "animal" },
	{
		name: "qq-317-317",
		label: "菜汪",
		token: "[lottie:qq-317-317]",
		group: "animal",
	},
	{
		name: "qq-361-361",
		label: "狗狗笑哭",
		token: "[lottie:qq-361-361]",
		group: "animal",
	},
	{
		name: "qq-363-363",
		label: "狗狗可怜",
		token: "[lottie:qq-363-363]",
		group: "animal",
	},
	{
		name: "qq-365-365",
		label: "狗狗生气",
		token: "[lottie:qq-365-365]",
		group: "animal",
	},
	{
		name: "qq-367-367",
		label: "狗狗疑问",
		token: "[lottie:qq-367-367]",
		group: "animal",
	},
	{
		name: "qq-378-378",
		label: "企鹅笑哭",
		token: "[lottie:qq-378-378]",
		group: "animal",
	},
	{
		name: "qq-379-379",
		label: "企鹅流泪",
		token: "[lottie:qq-379-379]",
		group: "animal",
	},
	{
		name: "qq-383-383",
		label: "企鹅爱心",
		token: "[lottie:qq-383-383]",
		group: "animal",
	},
];

/** 精选热门动态 Lottie 表情（27个） */
export const FEATURED_LOTTIE_ITEMS: LottieStickerItem[] = [
	{ name: "caigou", label: "菜狗", token: "[lottie:caigou]", group: "animal" },
	{ name: "foxi", label: "佛系", token: "[lottie:foxi]", group: "featured" },
	{ name: "aini", label: "爱你", token: "[lottie:aini]", group: "featured" },
	{ name: "bixin", label: "比心", token: "[lottie:bixin]", group: "featured" },
	{
		name: "tietie",
		label: "贴贴",
		token: "[lottie:tietie]",
		group: "featured",
	},
	{
		name: "xiaoku",
		label: "笑哭",
		token: "[lottie:xiaoku]",
		group: "featured",
	},
	{ name: "daku", label: "大哭", token: "[lottie:daku]", group: "featured" },
	{ name: "fan", label: "烦", token: "[lottie:fan]", group: "featured" },
	{ name: "cool", label: "酷", token: "[lottie:cool]", group: "featured" },
	{
		name: "kaixin",
		label: "开心",
		token: "[lottie:kaixin]",
		group: "featured",
	},
	{
		name: "shengqi",
		label: "生气",
		token: "[lottie:shengqi]",
		group: "featured",
	},
	{
		name: "shuijiao",
		label: "睡觉",
		token: "[lottie:shuijiao]",
		group: "featured",
	},
	{
		name: "wenhao",
		label: "问号",
		token: "[lottie:wenhao]",
		group: "featured",
	},
	{ name: "wuzui", label: "捂嘴", token: "[lottie:wuzui]", group: "featured" },
	{
		name: "gongzuo",
		label: "工作",
		token: "[lottie:gongzuo]",
		group: "featured",
	},
	{
		name: "gandong",
		label: "感动",
		token: "[lottie:gandong]",
		group: "featured",
	},
	{
		name: "meishi",
		label: "美食",
		token: "[lottie:meishi]",
		group: "featured",
	},
	{ name: "re", label: "热", token: "[lottie:re]", group: "featured" },
	{ name: "huang", label: "慌", token: "[lottie:huang]", group: "featured" },
	{
		name: "jingxia",
		label: "惊吓",
		token: "[lottie:jingxia]",
		group: "featured",
	},
	{ name: "jiong", label: "囧", token: "[lottie:jiong]", group: "featured" },
	{ name: "meiku", label: "美哭", token: "[lottie:meiku]", group: "featured" },
	{
		name: "shengri",
		label: "生日",
		token: "[lottie:shengri]",
		group: "featured",
	},
	{
		name: "bianpao",
		label: "鞭炮",
		token: "[lottie:bianpao]",
		group: "featured",
	},
	{
		name: "yanhua",
		label: "烟花",
		token: "[lottie:yanhua]",
		group: "featured",
	},
	{
		name: "wangpan",
		label: "网盘",
		token: "[lottie:wangpan]",
		group: "featured",
	},
	{ name: "exin", label: "恶心", token: "[lottie:exin]", group: "featured" },
];

/** QQ 超级表情与小黄脸动态（84个） */
export const QQ_SUPER_LOTTIE_ITEMS: LottieStickerItem[] = Object.entries(
	LOTTIE_LABELS,
)
	.filter(([key]) => key.startsWith("qq-"))
	.map(([key, label]) => ({
		name: key,
		label,
		token: `[lottie:${key}]`,
		group: ANIMAL_LOTTIE_ITEMS.some((a) => a.name === key) ? "animal" : "qq",
	}));

/** 全部 Lottie 动效表情（111个），菜狗排在最首位，动物与热门动效在前，QQ超级表情在后，平铺无缝滚动 */
export const ALL_LOTTIE_ITEMS: LottieStickerItem[] = (() => {
	const seen = new Set<string>();
	const list: LottieStickerItem[] = [];
	// 1. 萌宠动物（菜狗、菜汪、狗狗笑哭等）
	for (const item of ANIMAL_LOTTIE_ITEMS) {
		if (!seen.has(item.name)) {
			seen.add(item.name);
			list.push(item);
		}
	}
	// 2. 精选热门动效（佛系、爱你、比心、贴贴等）
	for (const item of FEATURED_LOTTIE_ITEMS) {
		if (!seen.has(item.name)) {
			seen.add(item.name);
			list.push(item);
		}
	}
	// 3. QQ 超级表情与小黄脸
	for (const item of QQ_SUPER_LOTTIE_ITEMS) {
		if (!seen.has(item.name)) {
			seen.add(item.name);
			list.push(item);
		}
	}
	return list;
})();

/** 岸宝小动物贴纸项目（30个） */
export const ANBAO_STICKER_ITEMS: string[] = [
	"打招呼",
	"比心",
	"开心",
	"探头",
	"委屈",
	"咬牙切齿",
	"早",
	"嘿嘿",
	"大哭",
	"哭哭",
	"躺平",
	"心虚",
	"思考",
	"思考中",
	"生气",
	"疑惑",
	"惊讶",
	"无语",
	"抱抱",
	"谢谢",
	"偷笑",
	"没电",
	"点赞",
	"拒绝",
	"收到",
	"催更",
	"加油",
	"递茶",
	"吃瓜",
	"晚安",
];

/** 尤诺宝宝小动物贴纸项目（18个） */
export const YOUNUO_STICKER_ITEMS: string[] = [
	"打招呼",
	"比心",
	"开心",
	"抱抱",
	"委屈",
	"气鼓鼓",
	"震惊",
	"疑惑",
	"害羞",
	"困困",
	"点赞",
	"喝茶",
	"收到",
	"谢谢",
	"加油",
	"贴贴",
	"吃瓜",
	"晚安",
];

/** 艾雪专属贴纸项目（20个） */
export const XUE_SNOW_ITEMS: string[] = [
	"snow-01",
	"snow-02",
	"snow-03",
	"snow-04",
	"snow-05",
	"snow-06",
	"snow-07",
	"snow-08",
	"snow-09",
	"snow-10",
	"snow-11",
	"snow-12",
	"snow-13",
	"snow-14",
	"snow-15",
	"snow-16",
	"snow-17",
	"snow-18",
	"snow-19",
	"snow-20",
];

/** 艾雪精选收藏贴纸项目（12个） */
export const XUE_FAV_ITEMS: { name: string; ext: string }[] = [
	{ name: "fav-01", ext: "jpg" },
	{ name: "fav-02", ext: "gif" },
	{ name: "fav-03", ext: "jpg" },
	{ name: "fav-04", ext: "jpg" },
	{ name: "fav-05", ext: "jpg" },
	{ name: "fav-06", ext: "png" },
	{ name: "fav-07", ext: "jpg" },
	{ name: "fav-08", ext: "gif" },
	{ name: "fav-09", ext: "jpg" },
	{ name: "fav-10", ext: "gif" },
	{ name: "fav-11", ext: "png" },
	{ name: "fav-12", ext: "jpg" },
];

export function getBuiltinAnimalStickerPacks(): StickerPack[] {
	const anbaoItems: StickerItem[] = ANBAO_STICKER_ITEMS.map((itemName) => ({
		code: `:anbao_${itemName}:`,
		name: `岸宝 · ${itemName}`,
		url: `https://rainzt.cn/assets/waline-emojis/anbao/anbao_${encodeURIComponent(itemName)}.webp`,
		category: "sticker",
	}));
	const younuoItems: StickerItem[] = YOUNUO_STICKER_ITEMS.map((itemName) => ({
		code: `:younuo_${itemName}:`,
		name: `尤诺 · ${itemName}`,
		url: `https://rainzt.cn/assets/waline-emojis/younuo/younuo_${encodeURIComponent(itemName)}.webp`,
		category: "sticker",
	}));
	const xueSnowItems: StickerItem[] = XUE_SNOW_ITEMS.map((itemName) => ({
		code: `:snow_${itemName}:`,
		name: `艾雪 · ${itemName}`,
		url: `https://daily.yybb.us/owo/snow/${encodeURIComponent(itemName)}.webp`,
		category: "sticker",
	}));
	const xueFavItems: StickerItem[] = XUE_FAV_ITEMS.map((item) => ({
		code: `:snow_${item.name}:`,
		name: `收藏 · ${item.name}`,
		url: `https://daily.yybb.us/owo/favorites/${encodeURIComponent(item.name)}.${item.ext}`,
		category: "sticker",
	}));
	return [
		{
			id: "rainzt",
			name: "朝朝听雨",
			iconUrl:
				"https://rainzt.cn/assets/waline-emojis/anbao/thumbs/anbao_%E6%AF%94%E5%BF%83.webp",
			category: "sticker",
			items: [...anbaoItems, ...younuoItems],
		},
		{
			id: "xue",
			name: "艾雪",
			iconUrl: "https://daily.yybb.us/owo/snow/snow-01.webp",
			category: "sticker",
			items: [...xueSnowItems, ...xueFavItems],
		},
	];
}

function resolveStickerCategory(
	baseUrl: string,
	prefix: string,
): StickerCategory {
	const lowerUrl = baseUrl.toLowerCase();
	const lowerPrefix = prefix.toLowerCase();
	if (lowerUrl.endsWith("/qq") || lowerPrefix === "qq_") {
		return "qq";
	}
	if (lowerUrl.endsWith("/bmoji") || lowerPrefix === "bmoji_") {
		return "emoji";
	}
	return "sticker";
}

interface RawStickerManifest {
	name?: string;
	prefix?: string;
	type?: string;
	icon?: string;
	items?: string[];
}

const STICKER_TOKEN_PATTERN =
	":[A-Za-z0-9_.-]+_[^:\\s<>\"']+?:|\\[lottie:[a-zA-Z0-9-]+\\]|\\[sticker:[a-zA-Z0-9/_-]+\\]";

export function buildStickerTokenRegex(): RegExp {
	return new RegExp(STICKER_TOKEN_PATTERN, "g");
}

export function resolveExternalOrLocalSticker(
	token: string,
	stickerMap: Map<string, StickerItem>,
): StickerItem | null {
	const local = stickerMap.get(token);
	if (local) return local;

	const lottieMatch =
		/^\[lottie:([a-z0-9-]+)\]$/i.exec(token) ||
		/^:lottie_([a-z0-9-]+):$/i.exec(token);
	if (lottieMatch) {
		const lottie = lottieMatch[1].toLowerCase();
		return {
			code: token,
			name: LOTTIE_LABELS[lottie] || lottie,
			url: "",
			category: "sticker",
			lottie,
		};
	}

	const stickerTokenMatch = /^\[sticker:([a-z0-9/_-]+)\]$/i.exec(token);
	if (stickerTokenMatch) {
		const id = stickerTokenMatch[1];
		const fallbackName = id.split("/").pop() || "贴纸";
		const qfaceStatic = /^qqface\/static\/([a-z0-9_-]+)$/i.exec(id);
		if (qfaceStatic) {
			return {
				code: token,
				name: qfaceStatic[1],
				url: `https://fastly.jsdelivr.net/gh/koishijs/QFace@master/public/static/${encodeURIComponent(qfaceStatic[1])}.png`,
				category: "sticker",
			};
		}
		const qfaceGif = /^qqface\/gif\/([a-z0-9_-]+)$/i.exec(id);
		if (qfaceGif) {
			return {
				code: token,
				name: qfaceGif[1],
				url: `https://fastly.jsdelivr.net/gh/koishijs/QFace@master/public/gif/${encodeURIComponent(qfaceGif[1])}.gif`,
				category: "qq",
			};
		}
		const qfaceAsset = /^qqface\/assets\/(.+)$/i.exec(id);
		if (qfaceAsset) {
			return {
				code: token,
				name: fallbackName,
				url: `https://fastly.jsdelivr.net/gh/koishijs/QFace@master/public/assets/${qfaceAsset[1]}`,
				category: "sticker",
			};
		}
		return {
			code: token,
			name: fallbackName,
			url: `https://somoe.xyz/stickers/${id}.webp`,
			category: "sticker",
		};
	}

	const rainztMatch = /^:(anbao|younuo|bb)_([^:\s<>"']+):$/i.exec(token);
	if (rainztMatch) {
		const pack = rainztMatch[1].toLowerCase();
		const itemName = rainztMatch[2];
		if (pack === "anbao") {
			return {
				code: token,
				name: itemName,
				url: `https://rainzt.cn/assets/waline-emojis/anbao/anbao_${encodeURIComponent(itemName)}.webp`,
				category: "sticker",
			};
		}
		if (pack === "younuo") {
			return {
				code: token,
				name: itemName,
				url: `https://rainzt.cn/assets/waline-emojis/younuo/younuo_${encodeURIComponent(itemName)}.webp`,
				category: "sticker",
			};
		}
		return {
			code: token,
			name: itemName,
			url: `https://rainzt.cn/assets/waline-emojis/bilibili/bb_${encodeURIComponent(itemName)}.png`,
			category: "emoji",
		};
	}

	const xueMatch = /^:(snow|xue|fav)_([^:\s<>"']+):$/i.exec(token);
	if (xueMatch) {
		const prefix = xueMatch[1].toLowerCase();
		const itemName = xueMatch[2];
		if (prefix === "fav" || itemName.startsWith("fav-")) {
			const found = XUE_FAV_ITEMS.find(
				(f) => f.name === itemName || f.name === `fav-${itemName}`,
			);
			const ext = found ? found.ext : "jpg";
			const realName = found ? found.name : itemName;
			return {
				code: token,
				name: `收藏 · ${realName}`,
				url: `https://daily.yybb.us/owo/favorites/${encodeURIComponent(realName)}.${ext}`,
				category: "sticker",
			};
		}
		const realSnowName = itemName.startsWith("snow-")
			? itemName
			: `snow-${itemName}`;
		return {
			code: token,
			name: `艾雪 · ${realSnowName}`,
			url: `https://daily.yybb.us/owo/snow/${encodeURIComponent(realSnowName)}.webp`,
			category: "sticker",
		};
	}

	return null;
}

let cachedPacksPromise: Promise<StickerPack[]> | null = null;
let cachedPackUrlsKey = "";

export async function loadStickerPacks(
	packBaseUrls: string[],
): Promise<StickerPack[]> {
	const cleanUrls = packBaseUrls
		.map((u) => u.trim().replace(/\/+$/, ""))
		.filter(Boolean);
	const cacheKey = cleanUrls.join("|");
	if (cachedPacksPromise && cachedPackUrlsKey === cacheKey) {
		return cachedPacksPromise;
	}

	cachedPackUrlsKey = cacheKey;
	cachedPacksPromise = (async () => {
		const loaded: StickerPack[] = [];
		for (const baseUrl of cleanUrls) {
			try {
				const separator = baseUrl.includes("?") ? "&" : "?";
				const resp = await fetch(`${baseUrl}/info.json${separator}v=20261124`);
				if (!resp.ok) continue;
				const manifest = (await resp.json()) as RawStickerManifest;
				const prefix = manifest.prefix || "";
				const ext = manifest.type || "png";
				const itemsRaw = Array.isArray(manifest.items) ? manifest.items : [];
				if (itemsRaw.length === 0) continue;

				const category = resolveStickerCategory(baseUrl, prefix);
				const items: StickerItem[] = itemsRaw.map((itemName) => ({
					code: `:${prefix}${itemName}:`,
					name: itemName,
					url: `${baseUrl}/${encodeURIComponent(`${prefix}${itemName}`)}.${ext}`,
					category,
				}));

				const iconName = manifest.icon || itemsRaw[0];
				const iconUrl = `${baseUrl}/${encodeURIComponent(`${prefix}${iconName}`)}.${ext}`;
				loaded.push({
					id: baseUrl,
					name: manifest.name || "表情包",
					iconUrl,
					category,
					items,
				});
			} catch {
				// Ignore failed sticker pack manifest
			}
		}
		// 自动挂载岸宝与尤诺宝宝小动物贴纸包
		const animalPacks = getBuiltinAnimalStickerPacks();
		for (const ap of animalPacks) {
			if (!loaded.some((p) => p.id === ap.id)) {
				loaded.push(ap);
			}
		}
		return loaded;
	})();

	return cachedPacksPromise;
}

export function buildStickerLookup(
	packs: StickerPack[],
): Map<string, StickerItem> {
	const map = new Map<string, StickerItem>();
	for (const pack of packs) {
		for (const item of pack.items) {
			map.set(item.code, item);
		}
	}
	return map;
}

export function parseChatSegments(
	content: string,
	stickerMap: Map<string, StickerItem>,
): ChatContentSegment[] {
	const segments: ChatContentSegment[] = [];
	let end = 0;
	for (const match of content.matchAll(buildStickerTokenRegex())) {
		const token = match[0];
		const start = match.index;
		if (start > end)
			segments.push({ kind: "text", text: content.slice(end, start) });
		const sticker = resolveExternalOrLocalSticker(token, stickerMap);
		if (sticker) {
			segments.push({
				kind: "sticker",
				code: sticker.code,
				url: sticker.url,
				alt: sticker.name,
				category: sticker.category,
				...(sticker.lottie ? { lottie: sticker.lottie } : {}),
			});
		} else {
			segments.push({ kind: "text", text: token });
		}
		end = start + token.length;
	}
	if (end < content.length)
		segments.push({ kind: "text", text: content.slice(end) });
	return segments;
}

const attachmentPreviewLabels: Record<ChatAttachmentKind, string> = {
	image: "[图片]",
	video: "[视频]",
	audio: "[音频]",
	file: "[文件]",
	sticker: "[贴纸]",
	attachment: "[附件]",
};

export function getChatAttachmentKind(
	attachments: ChatAttachment[] = [],
): ChatAttachmentKind | null {
	const first = attachments[0];
	if (!first) return null;
	const kind = first.isSticker ? "sticker" : first.type;
	return attachments.every(
		(item) => (item.isSticker ? "sticker" : item.type) === kind,
	)
		? kind
		: "attachment";
}

export function getChatReplyAttachmentKind(
	reply: Pick<ChatReplyRef, "attachmentKind" | "hasImage">,
): ChatAttachmentKind | null {
	if (reply.attachmentKind !== undefined) return reply.attachmentKind;
	return reply.hasImage ? "attachment" : null;
}

export function formatChatReplyPreview(
	content: string,
	stickerMap?: Map<string, StickerItem>,
	attachmentKind: ChatAttachmentKind | null | undefined = null,
	isRecalled = false,
): string {
	if (isRecalled) return "原消息已撤回";
	const readable = content
		.replace(/\[lottie:([a-zA-Z0-9-]+)\]/g, (_full, name) => {
			const key = String(name).toLowerCase();
			return `[${LOTTIE_LABELS[key] || name}]`;
		})
		.replace(/\[sticker:([a-zA-Z0-9/_-]+)\]/g, (_full, id) => {
			const label = String(id).split("/").pop() || "贴纸";
			return `[${label}]`;
		})
		.replace(/:[A-Za-z0-9_.-]+_([^:\s<>"]+?):/g, (full, fallbackName) => {
			const matched = stickerMap?.get(full);
			if (matched) return `[${matched.name}]`;
			const lottieMatch = /^:lottie_([a-z0-9-]+):$/i.exec(full);
			if (lottieMatch) {
				const key = lottieMatch[1].toLowerCase();
				return `[${LOTTIE_LABELS[key] || lottieMatch[1]}]`;
			}
			return `[${fallbackName}]`;
		})
		.replace(/\s+/g, " ")
		.trim();
	const label = attachmentKind ? attachmentPreviewLabels[attachmentKind] : "";
	return [label, readable].filter(Boolean).join(" ") || "[消息]";
}

export function formatStickerAttachmentAlt(rawName?: string): string {
	const text = (rawName || "").trim();
	if (!text) return "贴纸";
	const lottieMatch =
		/^\[lottie:([a-z0-9-]+)\]$/i.exec(text) ||
		/^:lottie_([a-z0-9-]+):$/i.exec(text);
	if (lottieMatch) {
		const key = lottieMatch[1].toLowerCase();
		return LOTTIE_LABELS[key] || lottieMatch[1];
	}
	const stickerMatch = /^\[sticker:([a-z0-9/_-]+)\]$/i.exec(text);
	if (stickerMatch) {
		return stickerMatch[1].split("/").pop() || "贴纸";
	}
	if (/^mx-sticker:/i.test(text)) {
		return text.replace(/^mx-sticker:/i, "").trim() || "贴纸";
	}
	return text;
}

const INLINE_STICKER_PATH_RE =
	/(?:\/assets\/stickers\/(?:qq|bmoji)\/|\/chat-api\/emoji\/|\/waline-emojis\/|qface|\/owo\/(?:snow|favorites)\/)/i;

export function isChatInlineSticker(
	url?: string,
	alt?: string,
	stickerMap?: Map<string, StickerItem>,
): boolean {
	const rawUrl = (url || "").trim();
	const rawAlt = (alt || "").trim();
	if (!rawUrl && !rawAlt) return false;

	if (rawUrl) {
		if (INLINE_STICKER_PATH_RE.test(rawUrl)) {
			return true;
		}
		if (stickerMap) {
			for (const item of stickerMap.values()) {
				if (item.url && item.url === rawUrl) {
					return item.category === "qq" || item.category === "emoji";
				}
			}
		}
	}

	if (rawAlt) {
		const lowerAlt = rawAlt.toLowerCase();
		if (
			lowerAlt.startsWith("emoji:") ||
			lowerAlt.startsWith("qq:") ||
			rawAlt.startsWith("表情：") ||
			rawAlt.startsWith("表情:") ||
			/^:(?:qq|bmoji)_[a-zA-Z0-9_.-]+:$/.test(rawAlt)
		) {
			return true;
		}
		if (stickerMap) {
			for (const item of stickerMap.values()) {
				if (item.name && item.name === rawAlt) {
					return item.category === "qq" || item.category === "emoji";
				}
			}
		}
	}

	return false;
}

export function resolveInlineStickerCategory(
	url: string,
	alt?: string,
): StickerCategory {
	const lowerUrl = url.toLowerCase();
	const lowerAlt = (alt || "").toLowerCase();
	if (
		lowerUrl.includes("/qq/") ||
		lowerAlt.includes("qq") ||
		lowerUrl.includes("qface")
	) {
		return "qq";
	}
	if (
		lowerUrl.includes("/bmoji/") ||
		lowerUrl.includes("/emoji/") ||
		lowerUrl.includes("/bilibili/")
	) {
		return "emoji";
	}
	return "sticker";
}
