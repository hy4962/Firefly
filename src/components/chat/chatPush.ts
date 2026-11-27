import type { ChatDesktopNotificationMode } from "./chatTypes";

const STORAGE_KEY = "fireflyChatWebPush";
const WORKER_URL = "/chat-push-sw.js";
const LEGACY_TEST_COOLDOWN_MS = 15_000;

type Auth = { kind: "waline" | "guest"; token: string };
type ActiveMode = Exclude<ChatDesktopNotificationMode, "off">;
type Settings = {
	userKey: string;
	revocationKey: string;
	mode: ChatDesktopNotificationMode;
};
type PreparedPush = {
	registration: ServiceWorkerRegistration;
	subscription: PushSubscription | null;
	publicKey: Uint8Array<ArrayBuffer>;
};

export function isIOSDevice(): boolean {
	if (typeof navigator === "undefined") return false;
	return (
		/iPhone|iPad|iPod/i.test(navigator.userAgent) ||
		(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
	);
}

export function isStandalonePWA(): boolean {
	if (typeof window === "undefined") return false;
	return (
		window.matchMedia?.("(display-mode: standalone)").matches === true ||
		(navigator as unknown as { standalone?: boolean }).standalone === true
	);
}

export function chatPushUnavailableReason(): string | null {
	if (typeof window === "undefined" || window.isSecureContext === false) {
		return "请从 HTTPS 页面打开聊天室，再启用浏览器推送";
	}
	if (isIOSDevice() && !isStandalonePWA()) {
		return "iOS 需在 Safari 点击【分享】->【添加到主屏幕】，从主屏幕打开后方可使用推送";
	}
	if (typeof navigator.serviceWorker?.register !== "function") {
		return "当前浏览器环境不支持注册后台推送服务";
	}
	if (typeof window.PushManager === "undefined") {
		return isIOSDevice()
			? "iOS 需在 Safari 点击【分享】->【添加到主屏幕】，从主屏幕打开后方可使用推送"
			: "当前浏览器环境未开放推送接口（PushManager）";
	}
	return null;
}

export function supportsChatPush(): boolean {
	return chatPushUnavailableReason() === null;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
	if (typeof window === "undefined" || typeof Notification === "undefined") {
		return "denied";
	}
	if (Notification.permission === "granted") {
		return "granted";
	}
	try {
		return await Notification.requestPermission();
	} catch {
		return new Promise<NotificationPermission>((resolve) => {
			try {
				Notification.requestPermission((result) => resolve(result));
			} catch {
				resolve(Notification.permission);
			}
		});
	}
}

export function urlBase64ToUint8Array(
	base64String: string,
): Uint8Array<ArrayBuffer> {
	const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
	const rawData = atob(base64);
	const buffer = new ArrayBuffer(rawData.length);
	const outputArray = new Uint8Array(buffer);
	for (let i = 0; i < rawData.length; ++i) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray;
}

export function readChatPushSettings(): Settings | null {
	try {
		return JSON.parse(
			localStorage.getItem(STORAGE_KEY) || "null",
		) as Settings | null;
	} catch {
		return null;
	}
}

function writeSettings(settings: Settings | null) {
	if (settings) localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
	else localStorage.removeItem(STORAGE_KEY);
}

class PushRequestError extends Error {
	constructor(
		message: string,
		readonly cooldownMs?: number,
	) {
		super(message);
	}
}

async function pushRequest(
	server: string,
	action: string,
	body?: Record<string, unknown>,
	auth?: Auth,
): Promise<{
	mode?: ChatDesktopNotificationMode;
	publicKey?: string;
	cooldownMs?: number;
}> {
	const headers: Record<string, string> = {};
	if (body) headers["Content-Type"] = "application/json";
	if (auth) {
		headers.Authorization = `Bearer ${auth.token}`;
		headers["X-Auth-Kind"] = auth.kind;
	}
	const response = await fetch(`${server}/api/chat/push/${action}`, {
		method: body ? "POST" : "GET",
		headers,
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(10000),
	});
	const data = await response.json();
	if (!response.ok)
		throw new PushRequestError(data.error || "unavailable", data.cooldownMs);
	return data;
}

export async function prepareChatPush(server: string): Promise<PreparedPush> {
	const [{ publicKey }] = await Promise.all([
		pushRequest(server, "config"),
		navigator.serviceWorker
			.register(WORKER_URL, { updateViaCache: "none" })
			.catch((error: unknown) => {
				throw new Error("worker", { cause: error });
			}),
	]);
	if (!publicKey) throw new Error("unavailable");
	const registration = await navigator.serviceWorker.ready;
	if (typeof registration.pushManager?.subscribe !== "function")
		throw new Error("push-api");
	return {
		registration,
		subscription: await registration.pushManager.getSubscription(),
		publicKey: urlBase64ToUint8Array(publicKey),
	};
}

export async function enableChatPush(
	server: string,
	auth: Auth,
	userKey: string,
	deviceId: string,
	mode: ActiveMode,
	prepared: PreparedPush,
): Promise<void> {
	const existing = readChatPushSettings();
	if (existing && existing.userKey !== userKey) throw new Error("ownership");
	const subscription =
		prepared.subscription ||
		(await prepared.registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: prepared.publicKey,
		}));
	prepared.subscription = subscription;
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const revocationKey =
		existing?.revocationKey ||
		btoa(String.fromCharCode(...bytes))
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
	const settings = {
		userKey,
		revocationKey,
		mode: existing?.mode || "off",
	} satisfies Settings;
	writeSettings(settings);
	await pushRequest(
		server,
		"subscribe",
		{
			revocationKey,
			deviceId,
			mode,
			subscription: subscription.toJSON(),
		},
		auth,
	);
	writeSettings({ ...settings, mode });
}

export async function disableChatPush(
	server: string,
	settings: Settings | null = readChatPushSettings(),
): Promise<void> {
	if (!settings) return;
	const revoke = pushRequest(server, "disable", {
		revocationKey: settings.revocationKey,
	});
	const unsubscribe = (async () => {
		const registration = await navigator.serviceWorker?.getRegistration();
		const subscription = await registration?.pushManager.getSubscription();
		if (subscription && !(await subscription.unsubscribe()))
			throw new Error("unsubscribe");
	})();
	const [removed, unsubscribed] = await Promise.allSettled([
		revoke,
		unsubscribe,
	]);
	if (removed.status === "rejected" && unsubscribed.status === "rejected")
		throw removed.reason;
	if (readChatPushSettings()?.revocationKey === settings.revocationKey)
		writeSettings(null);
}

export async function updateChatPushMode(
	server: string,
	userKey: string,
	mode: ChatDesktopNotificationMode,
): Promise<"updated" | "missing" | "legacy"> {
	const settings = readChatPushSettings();
	if (!settings || settings.userKey !== userKey) return "missing";
	try {
		await pushRequest(server, "mode", {
			revocationKey: settings.revocationKey,
			mode,
		});
	} catch (error) {
		// Old gateways authenticate unrecognized routes before returning a route error.
		if (
			error instanceof Error &&
			(error.message === "auth" || error.message === "route")
		)
			return "legacy";
		if (error instanceof Error && error.message === "missing") return "missing";
		throw error;
	}
	if (readChatPushSettings()?.revocationKey === settings.revocationKey) {
		writeSettings({ ...settings, mode });
	}
	return "updated";
}

export async function testChatPush(
	server: string,
	auth: Auth,
	userKey: string,
): Promise<{ status: "sent" | "rate" | "failed"; cooldownMs: number }> {
	const settings = readChatPushSettings();
	if (settings?.userKey !== userKey) throw new Error("missing");
	try {
		const data = await pushRequest(
			server,
			"test",
			{ revocationKey: settings.revocationKey },
			auth,
		);
		return {
			status: "sent",
			cooldownMs: data.cooldownMs ?? LEGACY_TEST_COOLDOWN_MS,
		};
	} catch (error) {
		if (error instanceof PushRequestError && error.message === "rate") {
			return {
				status: "rate",
				cooldownMs: error.cooldownMs ?? LEGACY_TEST_COOLDOWN_MS,
			};
		}
		if (error instanceof PushRequestError && error.message === "delivery") {
			return { status: "failed", cooldownMs: error.cooldownMs ?? 0 };
		}
		throw error;
	}
}
