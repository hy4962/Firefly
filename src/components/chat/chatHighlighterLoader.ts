// 聊天室高亮引擎异步懒加载器
// 只有在页面渲染代码块时才发起动态 import 请求，平时 0 性能损耗与 0 网络开销

export interface ChatHighlighter {
	highlightCode: (
		code: string,
		rawLang?: string,
	) => { html: string; detectedLang: string };
	escapeHtml: (str: string) => string;
}

let highlighterPromise: Promise<ChatHighlighter> | null = null;

export function loadChatHighlighter(): Promise<ChatHighlighter> {
	if (!highlighterPromise) {
		highlighterPromise = import("./chatHighlighterEngine").then((mod) => ({
			highlightCode: mod.highlightCode,
			escapeHtml: mod.escapeHtml,
		}));
	}
	return highlighterPromise;
}

export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
