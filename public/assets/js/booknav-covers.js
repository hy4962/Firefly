/**
 * 书签导航卡片悬停预览封面。
 *
 * 背景：/booknav/ 的卡片由主题的 booknav.astro 渲染，改那个文件会和上游合并冲突，
 * 所以这里走「独立文件 + 客户端增强」的路子（和 /friends/ 那套完全同构）：
 *   1. 从 /api/booknav-covers.json 拿到 url → 封面图 的映射；
 *   2. 给命中的卡片头部插一层 .ff-booknav-cover，悬停时展开；
 *   3. 图片首屏不加载，真悬停/聚焦过才赋值 src —— 平时对 /booknav/ 零额外流量。
 *
 * 没有封面数据的书签，卡片保持主题原样，不会留破图。
 *
 * 本文件在页脚被按需引入（见 src/config/FooterConfig.html），
 * 只有 /booknav/ 才会去拉它。
 */
(function () {
	"use strict";

	var API_URL = "/api/booknav-covers.json";
	var CSS_URL = "/assets/css/booknav-covers.css";
	var BOOKNAV_PATH = /^\/booknav\/?$/;

	var cssInjected = false;
	var mapRequest = null;

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
					console.warn("[booknav-covers] 封面数据加载失败：", error);
				}
				return null;
			});

		return mapRequest;
	};

	var attach = function (card, coverUrl) {
		if (card.dataset.ffBooknavCoverReady === "1") return;
		card.dataset.ffBooknavCoverReady = "1";

		var wrap = document.createElement("span");
		wrap.className = "ff-booknav-cover";
		wrap.setAttribute("aria-hidden", "true");

		var img = document.createElement("img");
		img.className = "ff-booknav-cover__img";
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
		});

		["mouseenter", "focusin", "pointerdown", "touchstart"].forEach(function (name) {
			card.addEventListener(name, reveal, { once: true, passive: true });
		});
	};

	var enhance = function () {
		if (!BOOKNAV_PATH.test(window.location.pathname)) return;

		var cards = document.querySelectorAll(".booknav-grid .booknav-card");
		if (!cards.length) return;

		injectCss();

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
