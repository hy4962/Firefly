/**
 * 邮箱送达性与防伪/防占位校验工具
 * 专门拦截无法接收邮件、全球无 MX 记录或容易导致 SMTP 退信的假邮箱与占位邮箱。
 */

// 已知保留/无 MX 记录的测试与占位域名（不区分大小写）
const UNDELIVERABLE_EXACT_DOMAINS = new Set([
	"example.com",
	"example.org",
	"example.net",
	"example.edu",
	"test.com",
	"test.org",
	"test.net",
	"localhost",
	"invalid",
	"users.noreply.github.com",
	"noreply.github.com",
	"oauth.local",
]);

// RFC 2606 / RFC 6761 保留顶级域后缀
const RESERVED_TLD_SUFFIXES = [
	".example",
	".test",
	".invalid",
	".localhost",
	".local",
];

// 主流大厂与高校特许免检白名单（0ms 秒过，绝不误伤）
export const TRUSTED_FAST_PASS_DOMAINS: ReadonlySet<string> = new Set([
	// 国内主流
	"qq.com",
	"vip.qq.com",
	"foxmail.com",
	"163.com",
	"vip.163.com",
	"126.com",
	"vip.126.com",
	"yeah.net",
	"sina.com",
	"sina.cn",
	"vip.sina.com",
	"sohu.com",
	"139.com",
	"189.cn",
	"wo.cn",
	"aliyun.com",
	// 国际主流
	"gmail.com",
	"googlemail.com",
	"outlook.com",
	"hotmail.com",
	"live.com",
	"msn.com",
	"icloud.com",
	"me.com",
	"mac.com",
	"yahoo.com",
	"yahoo.com.cn",
	"yahoo.co.jp",
	// 极客与隐私安全正常个人邮箱
	"proton.me",
	"protonmail.com",
	"pm.me",
	"tuta.com",
	"tutanota.com",
	"fastmail.com",
	"zoho.com",
	"mail.ru",
	"yandex.com",
	"yandex.ru",
]);

export function isTrustedFastPassDomain(domain: string): boolean {
	const lower = (domain || "").toLowerCase().trim();
	return (
		TRUSTED_FAST_PASS_DOMAINS.has(lower) ||
		lower.endsWith(".edu") ||
		lower.endsWith(".edu.cn")
	);
}

export interface EmailDeliverabilityResult {
	deliverable: boolean;
	reason?: string;
}

/**
 * 校验邮箱是否属于可送达的合规邮箱。
 * 拦截以下常见退信高发源：
 * 1. 虚假/占位/保留测试域名（example.com, test.com 等全球无 MX 记录）
 * 2. GitHub 单向匿名替身（users.noreply.github.com，只发不收，无 MX 记录）
 * 3. 缺少合法顶级域（如 liruisen2007@163 少了 .com）
 * 4. 格式残缺或非法字符
 */
export function checkEmailDeliverability(
	email?: string | null,
): EmailDeliverabilityResult {
	if (!email || typeof email !== "string") {
		return { deliverable: false, reason: "未填写邮箱地址" };
	}

	const trimmed = email.trim().toLowerCase();
	if (!trimmed) {
		return { deliverable: false, reason: "未填写邮箱地址" };
	}

	// 基础邮箱格式正则：必须包含用户名、@、域名主体，且顶级域名必须至少由 2 个字母组成
	const basicEmailRegex =
		/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
	if (!basicEmailRegex.test(trimmed)) {
		return {
			deliverable: false,
			reason: "邮箱格式不完整或缺少顶级域名（例如少了 .com）",
		};
	}

	const parts = trimmed.split("@");
	if (parts.length !== 2) {
		return { deliverable: false, reason: "邮箱格式不正确" };
	}

	const domain = parts[1];

	// 0. 主流大厂与高校白名单秒过（0ms，绝不误伤）
	if (isTrustedFastPassDomain(domain)) {
		return { deliverable: true };
	}

	if (
		domain === "oauth.local" ||
		domain.endsWith(".local") ||
		trimmed.includes("@oauth.local")
	) {
		return {
			deliverable: false,
			reason: "第三方快捷登录生成的虚拟占位邮箱，无真实邮件接收服务器",
		};
	}

	// 检查已知无 MX 记录或单向替身域名
	if (UNDELIVERABLE_EXACT_DOMAINS.has(domain)) {
		if (domain.includes("noreply.github.com")) {
			return {
				deliverable: false,
				reason: "GitHub 单向匿名替身邮箱，无法接收任何外来邮件",
			};
		}
		return {
			deliverable: false,
			reason: "虚拟测试保留域名（无邮件服务器），无法送达",
		};
	}

	// 检查是否以保留顶级域名结尾
	for (const suffix of RESERVED_TLD_SUFFIXES) {
		if (domain.endsWith(suffix)) {
			return {
				deliverable: false,
				reason: "保留测试域名后缀，无法送达",
			};
		}
	}

	// 顶级域名至少为 2 个字符且只能是纯字母
	const tld = domain.split(".").pop() || "";
	if (tld.length < 2 || !/^[a-z]+$/i.test(tld)) {
		return {
			deliverable: false,
			reason: "邮箱顶级域名无效",
		};
	}

	return { deliverable: true };
}

/**
 * 判断邮箱是否不可送达（方便快速布尔过滤）
 */
export function isUndeliverableEmail(email?: string | null): boolean {
	return !checkEmailDeliverability(email).deliverable;
}

const DISPOSABLE_KEYWORDS = [
	"mailinator",
	"tempmail",
	"10minutemail",
	"guerrillamail",
	"dispostable",
];

/**
 * 校验访客注册邮箱是否可用。
 * 访客新注册时，严禁使用包含 "noreply"、"example" 等虚拟占位、单向替身或临时假邮箱。
 */
export function checkGuestRegistrationEmail(
	email?: string | null,
): EmailDeliverabilityResult {
	const baseResult = checkEmailDeliverability(email);
	if (!baseResult.deliverable) {
		return baseResult;
	}

	const trimmed = (email || "").trim().toLowerCase();
	const [localPart = "", domain = ""] = trimmed.split("@");

	// 0. 主流大厂与高校白名单秒过
	if (isTrustedFastPassDomain(domain)) {
		return { deliverable: true };
	}

	// 1. 严格检查是否包含 "example"（无论是用户名还是域名）
	if (localPart.includes("example") || domain.includes("example")) {
		return {
			deliverable: false,
			reason: "禁止使用包含 example 的虚拟测试占位邮箱注册",
		};
	}

	// 2. 严格检查是否包含 "noreply"（如 noreply@, no-reply@, no_reply@, users.noreply.github.com 等）
	const normalizedLocal = localPart.replace(/[-_.]/g, "");
	const normalizedDomain = domain.replace(/[-_.]/g, "");
	if (
		normalizedLocal.includes("noreply") ||
		normalizedDomain.includes("noreply")
	) {
		return {
			deliverable: false,
			reason: "禁止使用包含 noreply 的单向通知或替身邮箱注册",
		};
	}

	// 3. 检查是否包含常见一次性临时邮箱关键词
	for (const kw of DISPOSABLE_KEYWORDS) {
		if (domain.includes(kw)) {
			return {
				deliverable: false,
				reason: "禁止使用一次性临时邮箱注册",
			};
		}
	}

	return { deliverable: true };
}

/**
 * 客户端异步探测邮箱（结合本地白名单 + VPS 远端 10,400+ 临时库及 DNS MX 探测）
 */
export async function verifyEmailRemote(
	email: string,
	chatServerUrl: string,
): Promise<{ ok: boolean; error?: string }> {
	const localRes = checkGuestRegistrationEmail(email);
	if (!localRes.deliverable) {
		return { ok: false, error: localRes.reason };
	}

	const parts = email.trim().toLowerCase().split("@");
	if (parts.length === 2 && isTrustedFastPassDomain(parts[1])) {
		return { ok: true };
	}

	const base = chatServerUrl ? chatServerUrl.replace(/\/+$/, "") : "";
	if (!base) {
		return { ok: true }; // 若未配置服务端地址，以本地校验为准
	}

	try {
		const resp = await fetch(
			`${base}/api/auth/verify-email?email=${encodeURIComponent(email.trim())}`,
			{
				signal: AbortSignal.timeout(4000),
			},
		);
		if (!resp.ok) {
			const data = (await resp.json().catch(() => ({}))) as {
				error?: string;
			};
			return { ok: false, error: data.error || "邮箱未通过验证" };
		}
		const data = (await resp.json()) as { ok?: boolean; error?: string };
		return { ok: Boolean(data.ok), error: data.error };
	} catch {
		// 网络抖动降级放行，保证高可用
		return { ok: true };
	}
}
