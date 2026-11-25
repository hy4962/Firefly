export type ChatPanelSlot = "left" | "center" | "right" | "input";
export type ChatWallpaperDisplayMode = "wallpaper" | "sticker";
export type ChatPanelBgFit = "cover" | "contain";

export interface ChatWallpaperItem {
	/** 壁纸唯一 ID */
	id: string;
	/** 所属栏位（严格隔离：left / center / right / input 互不串用） */
	slot: ChatPanelSlot;
	/** 在设置面板显示的壁纸名称 */
	name: string;
	/** 壁纸文件路径（位于 /wallpapers/chat/<slot>/...） */
	src: string;
	/** 缩略图文件路径（位于 /wallpapers/chat/<slot>/thumbs/...，未填时回退 src） */
	thumbSrc?: string;
	/** 显示模式：wallpaper=大壁纸默认铺满，sticker=小贴纸可超出越界裁剪 */
	mode: ChatWallpaperDisplayMode;
	/** 适配方式：cover=铺满，contain=保持比例完整显示（贴纸常用） */
	fit: ChatPanelBgFit;
	/** 图片不透明度（0.05 ~ 1，默认 0.2 即 20%） */
	opacity?: number;
	/** 缩放倍数（如 1 表示 100%，0.6 表示 60%） */
	scale: number;
	/** 水平偏移百分比（-200 ~ 200，0 为居中） */
	offsetX: number;
	/** 垂直偏移百分比（-200 ~ 200，0 为居中） */
	offsetY: number;
	/** 是否启用高斯模糊 */
	blurEnabled: boolean;
	/** 高斯模糊半径（px，0 ~ 30） */
	blur: number;
}

export interface ChatWallpaperConfig {
	/** 默认背景不透明度（0.1 ~ 1） */
	defaultOpacity?: number;
	/** 四栏默认选中的壁纸 ID（空字符串表示默认不显示图片） */
	defaults: Record<ChatPanelSlot, string>;
	/** 聊天室壁纸/贴纸库：每张图片各自固定一套大小、位置与模糊参数 */
	items: ChatWallpaperItem[];
}

export interface ChatRoomMeta {
	id: string;
	name: string;
	subtitle: string;
	avatar?: string;
}

/**
 * 互联茶室站点基础配置（用于独立配置文件 config/interconnectConfig.ts）
 */
export interface InterconnectSiteConfig {
	/** 站点正式名称（展示在互联名录、来源标签、个人资料卡片） */
	name: string;
	/** 站点主页地址（用于个人资料跳转“访问主页”，如 https://blog.mibase.top） */
	siteUrl: string;
	/** 站点公开聊天室地址（用于互联名录直接前往，留空时回退为 siteUrl） */
	chatUrl?: string;
	/** 兼容旧代码字段（等同于 chatUrl || siteUrl） */
	url?: string;
	/**
	 * Matrix Homeserver 地址或域名（核心识别凭据，如 "matrix.mibase.top" 或完整 URL）
	 * 系统会自动提取域名，并将所有来自该 Matrix 服务器的用户精准归属到此站点
	 */
	homeserver?: string;
	/** 站长/主理人昵称（展示在资料卡片与列表中） */
	owner: string;
	/** 站点或站长头像 URL */
	avatar?: string;
	/** 站点一句话介绍/标语 */
	desc?: string;
	/** 站点来源标签/徽章文案（未填时默认使用 name） */
	badge?: string;
	/** 站点主题色（用于标签边框、阴影与高亮，十六进制色值） */
	color?: string;
	/** 可选的历史域名、Matrix 节点域或简称别名（用于额外识别归属） */
	aliases?: string[];
	/** 是否为当前本站（通常仅第一项为 true） */
	isSelf?: boolean;
}

/**
 * 互联茶室站点运行时对象（保持向后完全兼容现有组件）
 */
export interface InterconnectSite extends InterconnectSiteConfig {
	/** 保证 url 必填，方便现有直接读取 site.url 的组件 */
	url: string;
}

export interface ChatConfig {
	/**
	 * 聊天室后端 Worker 基础地址（例如 "https://chat-api.lengxiqwq.com"）
	 * 留空时前端仅展示静态兜底提示，不发起联机请求
	 */
	serverURL: string;
	/**
	 * 聊天室主题房间列表（当前精简为单房间，未来可扩展多个独立房间及各自电台）
	 */
	rooms: ChatRoomMeta[];
	/**
	 * 是否启用聊天图片上传（复用 Waline R2 /api/upload 接口）
	 */
	enableImageUpload: boolean;
	/**
	 * PlaylistOut 公开 API 基础地址（可选，默认 https://playlistout-api.lengxiqwq.com）
	 */
	playlistOutApiURL?: string;
	/**
	 * 互联茶室联动友站列表（点击一键前往对方茶室）
	 */
	interconnectSites?: InterconnectSite[];
	/**
	 * 聊天室四栏壁纸库与固定默认配置（线上访问者仅可选图，参数锁定为仓库配置）
	 */
	wallpapers?: ChatWallpaperConfig;
}
