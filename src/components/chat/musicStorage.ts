const LISTEN_INTENT_KEY = "lengxi_chat_music_listen_intent";
const LISTEN_TIME_KEY = "lengxi_chat_music_listen_intent_at";

export function readStoredListenIntent(): boolean {
	try {
		if (typeof window !== "undefined" && window.localStorage) {
			const saved = window.localStorage.getItem(LISTEN_INTENT_KEY);
			const savedAt = Number(window.localStorage.getItem(LISTEN_TIME_KEY) || 0);
			// 30分钟内有效，支持刷新页面、重新打开页面即刻恢复
			if (saved === "true" && Date.now() - savedAt < 30 * 60 * 1000) {
				return true;
			}
		}
	} catch {
		// Ignore storage error
	}
	return false;
}

export function saveStoredListenIntent(intent: boolean): void {
	try {
		if (typeof window !== "undefined" && window.localStorage) {
			if (intent) {
				window.localStorage.setItem(LISTEN_INTENT_KEY, "true");
				window.localStorage.setItem(LISTEN_TIME_KEY, String(Date.now()));
			} else {
				window.localStorage.setItem(LISTEN_INTENT_KEY, "false");
				window.localStorage.removeItem(LISTEN_TIME_KEY);
			}
		}
	} catch {
		// Ignore storage error
	}
}
