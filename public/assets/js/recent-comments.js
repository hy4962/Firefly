/**
 * 动态页（/dynamic/）右栏「最近评论」组件。
 *
 * 数据源是本站 Waline 后端的公开接口：
 *   GET https://waline.9ll.uk/api/comment?type=recent&count=8
 * 返回 { errno: 0, data: Comment[] }，字段含 nick / avatar / orig（纯文本）/
 * url（评论所在页面路径）/ time（毫秒时间戳）/ status。
 * 该接口已放开 CORS（Access-Control-Allow-Origin: *），前端直连无需代理。
 *
 * 注入路径（不改任何上游文件）：
 *   1. 组件外壳 DOM 与全部样式在 src/config/FooterConfig.html —— 页脚在 #swup-container
 *      之外，整页加载才跑一次，正好用来挂 swup 事件；
 *   2. 本脚本由页脚的 PAGE_SCRIPTS 按 pathname 按需加载，只在 /dynamic/ 生效；
 *   3. 挂载点是右栏 top 组件容器（#right-sidebar 的第一个子 div），插在
 *      「最新动态」widget-layout[data-id="latest-dynamics"] 之后。
 *      #right-sidebar-static 整个在 swup 替换范围外，搬一次即永久有效，切页不会丢；
 *   4. 离开 /dynamic/ 只把组件 hidden（节点留在右栏里），回来再显示并按缓存刷新。
 *      右栏在 ≤768px 被布局隐藏（layout-base.css），组件随之隐藏，移动端不显示。
 */
(function () {
	"use strict";

	// ===== 配置 =====
	// 换 Waline 地址或显示条数只改这两行
	var API_URL = "https://waline.9ll.uk/api/comment?type=recent&count=8";
	var GUESTBOOK_PATH = "/guestbook/";

	var PAGE_RE = /^\/dynamic\/?$/;
	var CACHE_KEY = "ff:recent-comments:v1";
	var CACHE_TTL = 120000; // 缓存 2 分钟：/dynamic/ 与别的页之间来回跳时不重复请求
	var EXCERPT_MAX = 120; // 摘要最多字符数（CSS 还会再截到两行）

	var root = document.getElementById("ff-rc");
	if (!root) return;
	var listEl = root.querySelector("[data-ff-rc-list]");
	var footEl = root.querySelector("[data-ff-rc-foot]");
	if (!listEl) return;

	// ===== 小工具 =====
	function el(tag, cls, text) {
		var node = document.createElement(tag);
		if (cls) node.className = cls;
		if (text != null) node.textContent = text;
		return node;
	}

	function readCache() {
		try {
			var raw = localStorage.getItem(CACHE_KEY);
			if (!raw) return null;
			var cached = JSON.parse(raw);
			if (
				cached &&
				Array.isArray(cached.items) &&
				typeof cached.timestamp === "number" &&
				Date.now() - cached.timestamp < CACHE_TTL
			) {
				return cached.items;
			}
		} catch (error) {
			// localStorage 不可用（无痕模式等）时直接走网络请求
		}
		return null;
	}

	function writeCache(items) {
		try {
			localStorage.setItem(
				CACHE_KEY,
				JSON.stringify({ timestamp: Date.now(), items: items }),
			);
		} catch (error) {
			// 写入失败不影响本次渲染
		}
	}

	function relTime(timestamp) {
		var diff = Date.now() - Number(timestamp || 0);
		if (diff < 0) return "刚刚";
		var minutes = Math.floor(diff / 60000);
		if (minutes < 1) return "刚刚";
		if (minutes < 60) return minutes + " 分钟前";
		var hours = Math.floor(minutes / 60);
		if (hours < 24) return hours + " 小时前";
		var days = Math.floor(hours / 24);
		if (days < 30) return days + " 天前";
		var months = Math.floor(days / 30);
		if (months < 12) return months + " 个月前";
		return Math.floor(months / 12) + " 年前";
	}

	// 昵称 → 色相：给文字头像一个稳定又不撞主题色的背景
	function nickHue(nick) {
		var text = String(nick || "?");
		var hash = 0;
		for (var i = 0; i < text.length; i += 1) {
			hash = (hash * 31 + text.charCodeAt(i)) % 360;
		}
		return hash;
	}

	function excerpt(text) {
		var plain = String(text || "").replace(/\s+/g, " ").trim();
		if (plain.length > EXCERPT_MAX) {
			return plain.slice(0, EXCERPT_MAX) + "…";
		}
		return plain;
	}

	// Waline 的 orig 字段是渲染前的原始 HTML（含 <span class="wl-badge"> 之类），
	// 直接当文本会把标签露出来；改用渲染后的 comment 字段再过一遍 DOM 取纯文本。
	// 只借 innerHTML 解析、马上读 textContent，不把用户内容插回页面，无 XSS 面。
	function htmlToText(html) {
		var box = document.createElement("div");
		box.innerHTML = String(html || "");
		return box.textContent || "";
	}

	// ===== 单条评论 =====
	function buildItem(comment) {
		var nick = String(comment.nick || "匿名");
		var target = comment.url || "/";
		var text = excerpt(htmlToText(comment.comment || comment.orig));

		var link = el("a", "ff-rc-item");
		link.href = target;
		link.title = nick + "：" + text;

		// 头像：文字头像垫底，图片加载失败自动移除露出文字
		var avatar = el("span", "ff-rc-avatar");
		avatar.style.setProperty("--ff-rc-hue", String(nickHue(nick)));
		avatar.appendChild(el("span", "ff-rc-initial", nick.charAt(0)));
		if (comment.avatar) {
			var image = document.createElement("img");
			image.className = "ff-rc-img";
			image.src = comment.avatar;
			image.alt = "";
			image.loading = "lazy";
			image.decoding = "async";
			image.addEventListener("error", function () {
				image.remove();
			});
			avatar.appendChild(image);
		}

		// ⚠️ 类名别叫 ff-rc-body：那是组件内容外包装（带 padding: 1rem）的类，
		//    撞名会让每条评论都白多吃 32px 内边距，meta 行被挤到 162px。
		var main = el("div", "ff-rc-main");
		var meta = el("div", "ff-rc-meta");
		meta.appendChild(el("span", "ff-rc-nick", nick));
		var time = el("time", "ff-rc-time", relTime(comment.time));
		time.dateTime = new Date(Number(comment.time || 0)).toISOString();
		meta.appendChild(time);
		meta.appendChild(el("span", "ff-rc-where", "评论于 " + target));
		main.appendChild(meta);
		main.appendChild(el("p", "ff-rc-text", text || "（无文字内容）"));

		link.appendChild(avatar);
		link.appendChild(main);
		return link;
	}

	// ===== 状态渲染 =====
	var SPINNER =
		'<svg class="ff-rc-spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
		'<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25"/>' +
		'<path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';

	function renderState(kind) {
		listEl.textContent = "";
		if (footEl) footEl.textContent = "";
		if (kind === "loading") {
			var box = el("div", "ff-rc-state");
			box.innerHTML = SPINNER + '<span class="ff-rc-state-text">加载中…</span>';
			listEl.appendChild(box);
			return;
		}
		var message =
			kind === "error" ? "评论加载失败，稍后回来再看看" : "还没有公开评论";
		listEl.appendChild(el("p", "ff-rc-state ff-rc-state-text", message));
	}

	function renderList(items) {
		listEl.textContent = "";
		var fragment = document.createDocumentFragment();
		items.forEach(function (comment) {
			fragment.appendChild(buildItem(comment));
		});
		listEl.appendChild(fragment);
		if (footEl) {
			footEl.textContent =
				"已展示 " + items.length + " 条公开评论 · 内容来自 Waline";
		}
	}

	// ===== 数据 =====
	var inflight = null;

	function load(force) {
		if (inflight) return inflight;
		if (!force) {
			var cached = readCache();
			if (cached) {
				if (cached.length > 0) renderList(cached);
				else renderState("empty");
				return Promise.resolve();
			}
		}
		renderState("loading");
		inflight = fetch(API_URL, { cache: "no-store" })
			.then(function (response) {
				if (!response.ok) throw new Error("waline " + response.status);
				return response.json();
			})
			.then(function (data) {
				if (!data || data.errno !== 0 || !Array.isArray(data.data)) {
					throw new Error("invalid waline payload");
				}
				var items = data.data.filter(function (comment) {
					return comment && comment.status === "approved";
				});
				writeCache(items);
				if (items.length > 0) renderList(items);
				else renderState("empty");
			})
			.catch(function (error) {
				if (window.console && console.warn) {
					console.warn("[ff-recent-comments] 加载失败：", error);
				}
				renderState("error");
			})
			.then(function () {
				inflight = null;
			});
		return inflight;
	}

	// ===== 挂载 / 隐藏 =====
	function findMountPoint() {
		var sidebar = document.getElementById("right-sidebar");
		if (!sidebar) return null;
		var wrapper = sidebar.firstElementChild; // top 组件容器（flex flex-col gap-4）
		if (!wrapper) return null;
		var latest = sidebar.querySelector(
			'widget-layout[data-id="latest-dynamics"]',
		);
		return { wrapper: wrapper, after: latest };
	}

	function mount() {
		var point = findMountPoint();
		if (!point) return;
		if (root.parentNode !== point.wrapper) {
			if (point.after && point.after.parentNode === point.wrapper) {
				point.wrapper.insertBefore(root, point.after.nextSibling);
			} else {
				point.wrapper.appendChild(root);
			}
		}
		root.hidden = false;
		load(false);
	}

	function unmount() {
		root.hidden = true;
	}

	function sync() {
		if (PAGE_RE.test(window.location.pathname)) mount();
		else unmount();
	}

	document.addEventListener("astro:page-load", sync);
	document.addEventListener("swup:page:view", sync);
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", sync, { once: true });
	} else {
		sync();
	}
})();
