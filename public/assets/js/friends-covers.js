/**
 * 友链卡片悬停预览封面。
 *
 * 背景：/friends/ 的卡片由主题的 friends.astro 渲染，改那个文件会和上游合并冲突，
 * 所以这里走「独立文件 + 客户端增强」的路子：
 *   1. 从 /api/friends-covers.json 拿到 siteurl → 封面图 的映射；
 *   2. 给命中的卡片头部插一层 .ff-friend-cover，悬停时展开；
 *   3. 图片首屏不加载，真悬停/聚焦过才赋值 src —— 平时对 /friends/ 零额外流量。
 *
 * ⚠️ 展开态刻意不用 CSS :hover 控制，改由 JS 加 .is-preview-open、并用
 * elementFromPoint 对账「指针是不是真的还压在这张卡片上」。
 * 原因：纯 :hover 会卡住不收，实测能复现的三种触发方式——
 *   ① 指针快速移出窗口 / 切标签页 / 切应用，浏览器漏发 mouseleave；
 *   ② 悬停把卡片撑高、整行重排，Chrome 漏一次 hover 重算；
 *   ③ 鼠标点击卡片后链接拿到焦点，:focus-within 一直命中（这条最常见）。
 * 卡住后只能等下一次进页面才好，所以状态必须握在自己手里。
 * 现在任何一次指针移动或滚动都会重新对账，跟浏览器那套 hover 记账彻底解耦。
 *
 * 没有封面数据的友链，卡片保持主题原样，不会留破图。
 *
 * 本文件在页脚被全站引入（见 src/config/FooterConfig.html），
 * 但不在友链页会立刻返回，成本只有一次函数调用。
 */
(function () {
	"use strict";

	var API_URL = "/api/friends-covers.json";
	var CSS_URL = "/assets/css/friends-covers.css?v=2";
	var FRIENDS_PATH = /^\/friends\/?$/;
	var OPEN_CLASS = "is-preview-open";

	var cssInjected = false;
	var mapRequest = null;

	// 当前展开的那一张（同一时刻只留一张，免得滚动后堆出一片）
	var activeCard = null;
	// 最后一次指针位置，用来在没收到新事件时（比如滚动）重新对账。
	// 故意拆成两个数字而不是一个对象：pointermove 每秒能来上百次，
	// 每次新建对象纯属给 GC 添堵，两个数字赋值是零分配。
	var lastX = null;
	var lastY = null;
	var frameQueued = false;
	var guardsInstalled = false;

	var normalizeUrl = function (value) {
		return String(value || "")
			.trim()
			.replace(/\/+$/, "")
			.toLowerCase();
	};

	var injectCss = function () {
		if (cssInjected) return;
		cssInjected = true;
		var link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = CSS_URL;
		document.head.appendChild(link);
	};

	var loadMap = function () {
		if (mapRequest) return mapRequest;

		mapRequest = fetch(API_URL, { credentials: "same-origin" })
			.then(function (response) {
				if (!response.ok) throw new Error("HTTP " + response.status);
				return response.json();
			})
			.then(function (data) {
				var map = Object.create(null);
				var raw = (data && data.covers) || {};
				Object.keys(raw).forEach(function (key) {
					map[normalizeUrl(key)] = raw[key];
				});
				return map;
			})
			.catch(function (error) {
				// 接口挂了就整体放弃，下次进页面再试。
				mapRequest = null;
				if (window.console && console.warn) {
					console.warn("[friends-covers] 封面数据加载失败：", error);
				}
				return null;
			});

		return mapRequest;
	};

	var setOpen = function (card, open) {
		if (!card) return;
		if (open) {
			if (activeCard && activeCard !== card) setOpen(activeCard, false);
			activeCard = card;
			card.classList.add(OPEN_CLASS);
			return;
		}
		card.classList.remove(OPEN_CLASS);
		if (activeCard === card) activeCard = null;
	};

	var closeActive = function () {
		if (activeCard) setOpen(activeCard, false);
	};

	/**
	 * 指针此刻真正压着的是不是这张卡片？
	 * elementFromPoint 走的是浏览器真实的命中测试，跟内部 hover 状态无关，
	 * 所以哪怕 mouseleave 漏发了，这里照样能算出正确答案。
	 */
	var pointerOver = function (card) {
		if (!card || lastX === null) return false;
		var hit = document.elementFromPoint(lastX, lastY);
		return !!(hit && card.contains(hit));
	};

	var reconcile = function () {
		frameQueued = false;
		if (!activeCard) return;
		if (!pointerOver(activeCard)) closeActive();
	};

	var scheduleReconcile = function () {
		if (frameQueued || !activeCard) return;
		frameQueued = true;
		if (window.requestAnimationFrame) {
			window.requestAnimationFrame(reconcile);
		} else {
			setTimeout(reconcile, 16);
		}
	};

	var rememberPoint = function (event) {
		if (!event) return;
		if (typeof event.clientX !== "number") return;
		lastX = event.clientX;
		lastY = event.clientY;
	};

	/**
	 * 全局兜底，只装一次。
	 * 这几条覆盖的全是「浏览器不会补发 mouseleave」的场景：
	 * 指针移出文档 / 滚轮把卡片滚走 / 切标签 / 切应用 / 点空白处 / Esc。
	 */
	var installGuards = function () {
		if (guardsInstalled) return;
		guardsInstalled = true;

		document.addEventListener(
			"pointermove",
			function (event) {
				rememberPoint(event);
				scheduleReconcile();
			},
			{ passive: true },
		);

		// 滚动时指针不动、卡片却在动，用旧坐标重新对账一次
		document.addEventListener(
			"scroll",
			function () {
				scheduleReconcile();
			},
			{ passive: true, capture: true },
		);

		document.addEventListener(
			"pointerdown",
			function (event) {
				rememberPoint(event);
				if (activeCard && !activeCard.contains(event.target)) closeActive();
			},
			{ passive: true, capture: true },
		);

		document.addEventListener("mouseleave", closeActive);
		document.documentElement.addEventListener("mouseleave", closeActive);
		window.addEventListener("blur", closeActive);
		document.addEventListener("visibilitychange", function () {
			if (document.hidden) closeActive();
		});
		document.addEventListener("keydown", function (event) {
			if (event.key === "Escape") closeActive();
		});

		// 键盘走位的两条：焦点挪出卡片、或者开始打字（搜索框）。
		// 这两条还有个副作用是必须的 —— 键盘输入会把卡片 display:none 掉，
		// 若不收起，等筛选清空、卡片重新显示时就会带着展开态蹦出来。
		document.addEventListener(
			"focusin",
			function (event) {
				if (activeCard && !activeCard.contains(event.target)) closeActive();
			},
			{ capture: true },
		);
		document.addEventListener("input", closeActive, { capture: true, passive: true });

		// swup 换页前先收起来，别让 activeCard 指着一个马上要被丢掉的节点
		document.addEventListener("astro:before-swap", closeActive);
		document.addEventListener("swup:page:leave", closeActive);
	};

	var attach = function (card, coverUrl) {
		if (card.dataset.ffCoverReady === "1") return;
		card.dataset.ffCoverReady = "1";

		var wrap = document.createElement("span");
		wrap.className = "ff-friend-cover";
		wrap.setAttribute("aria-hidden", "true");

		var img = document.createElement("img");
		img.className = "ff-friend-cover__img";
		img.alt = "";
		img.loading = "lazy";
		img.decoding = "async";
		img.referrerPolicy = "no-referrer";
		img.setAttribute("data-src", coverUrl);
		wrap.appendChild(img);
		card.insertBefore(wrap, card.firstChild);

		var reveal = function () {
			if (img.getAttribute("src")) return;
			wrap.classList.add("is-loading");
			img.setAttribute("src", String(img.getAttribute("data-src")));
		};

		img.addEventListener("load", function () {
			wrap.classList.remove("is-loading");
			wrap.classList.add("is-ready");
		});
		img.addEventListener("error", function () {
			wrap.classList.remove("is-loading");
			wrap.classList.add("is-error");
			// 图挂了就别再撑开空盒子，直接退出预览
			setOpen(card, false);
			card.dataset.ffCoverDead = "1";
		});

		var open = function () {
			if (card.dataset.ffCoverDead === "1") return;
			reveal();
			setOpen(card, true);
		};

		var close = function () {
			setOpen(card, false);
		};

		// 触摸屏没有「悬停」这回事：点一下只预热图片，不撑开，
		// 否则会在页面里留下一个收不回去的封面（点完后浏览器还会模拟 mouseenter）。
		card.addEventListener("pointerdown", reveal, { passive: true });
		// 键盘 Tab 进来时 CSS 的 :focus-visible 会撑开 7rem，图片得提前备好，
		// 不然键盘用户看到的是一个空盒子。focusin 只负责预热，不管展开态。
		card.addEventListener("focusin", reveal);

		if (window.PointerEvent) {
			card.addEventListener("pointerenter", function (event) {
				if (event.pointerType === "touch") return;
				open();
			});
			card.addEventListener("pointerleave", close);
		} else {
			card.addEventListener("mouseenter", open);
			card.addEventListener("mouseleave", close);
		}
	};

	var enhance = function () {
		if (!FRIENDS_PATH.test(window.location.pathname)) return;

		var cards = document.querySelectorAll(".friends-grid .friend-card");
		if (!cards.length) return;

		injectCss();
		installGuards();

		loadMap().then(function (map) {
			if (!map) return;
			Array.prototype.forEach.call(cards, function (card) {
				var coverUrl = map[normalizeUrl(card.getAttribute("href"))];
				if (coverUrl) attach(card, coverUrl);
			});
		});
	};

	var boot = function () {
		// swup 换页后卡片是新的 DOM，得重新挂一次；两个事件名都听，覆盖不同版本。
		document.addEventListener("astro:page-load", enhance);
		document.addEventListener("swup:page:view", enhance);
		enhance();
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot, { once: true });
	} else {
		boot();
	}
})();
