/**
 * 搜索预热（search warmup）
 *
 * 目的：把 Pagefind 那串「必须串行」的资源加载提前到用户输入之前完成。
 *
 * 背景（实测数据，2026-10-15）：
 *   站点用 Pagefind 做站内搜索，一次冷搜索需要依次拉这些文件：
 *     pagefind.js(45KB) → pagefind-worker.js(40KB) → wasm.unknown.pagefind(66KB)
 *     → pagefind-entry.json → pagefind.<lang>_<hash>.pf_meta → index/xxx.pf_index(33KB)
 *     → 每个命中的页面再各拉一个 fragment/xxx.pf_fragment
 *   这条链是串行依赖的，国内访问 CF 边缘每跳约 0.3~1s，于是「第一次搜索」要等好几秒。
 *   而 pagefind.js 只在用户碰搜索框时才被 import（见 Navbar.astro 的 __loadPagefind），
 *   所以这个等待 100% 落在用户的输入之后。
 *
 * 做法（不改任何主题源文件）：
 *   1. 首屏空闲（或鼠标/手指碰到搜索框）时就把 __loadPagefind() 和几个高频词的
 *      preload 跑掉 —— 等用户真的输入时，worker 已起、wasm 已编译、索引已进内存。
 *   2. 顶栏搜索面板只渲染前 5 条结果（Search.svelte 里写死的 slice(0, 5)），
 *      但上游代码取数据时是 `results.map(item => item.data())` —— 对「全部」结果调用
 *      data()，而 Pagefind 每个结果的 data() 就是一次 fragment 请求。
 *      实测搜一个常见词会命中 45 条 → 45 个 HTTP 请求。
 *      这里在运行时包一层 search()，只让前 DATA_LIMIT 条真正去拉正文，
 *      其余保持 length 不变（这样「查看更多 N 条」的计数还是准的）但返回空摘要。
 *      /search/ 页面要展示完整列表，因此不限制。
 *
 * 幂等：可被 PAGE_SCRIPTS 在 swup 切页后重复注入，内部有全局开关。
 */
(function () {
	"use strict";

	if (window.__ffSearchWarmup) return;
	window.__ffSearchWarmup = true;

	// 顶栏面板最多显示 5 条，多留 1 条余量；/search/ 页面不限制
	var DATA_LIMIT = 6;
	// 预热词：中文高频字，命中不同索引分片，用来把 index chunk 一并落进内存/缓存
	var WARM_TERMS = ["的", "是", "在"];
	var DEBUG = false;

	var log = function () {
		if (!DEBUG) return;
		var a = Array.prototype.slice.call(arguments);
		console.log.apply(console, ["[search-warmup]"].concat(a));
	};

	// 移动网络 / 省流模式下不做预热，别抢带宽
	var conn = navigator.connection || navigator.mozConnection || {};
	var poorNet =
		conn.saveData === true ||
		/^(slow-)?2g$/.test(String(conn.effectiveType || ""));

	var isSearchPage = function () {
		return /^\/search\/?$/.test(window.location.pathname);
	};

	// ---------- 取 pagefind 实例 ----------
	var pending = null;
	function getPagefind() {
		if (window.pagefind) return Promise.resolve(window.pagefind);
		if (pending) return pending;
		if (typeof window.__loadPagefind !== "function") {
			return Promise.resolve(undefined);
		}
		pending = window
			.__loadPagefind()
			.then(function () {
				return window.pagefind;
			})
			.catch(function (e) {
				log("load failed", e);
				return undefined;
			});
		return pending;
	}

	// ---------- 包装 search：限制 data() 的调用数量 ----------
	// ⚠️ window.pagefind 是 `await import()` 拿到的 ES Module 命名空间对象：
	//    它的属性只读（module namespace 的 [[Set]] 直接返回 false），
	//    既不能 `pf.search = fn`，也不能拿它当 Object.create 的原型。
	//    唯一稳妥的办法是用 Proxy 包一层，只拦截 search 这一个键，其余透传。
	var patched = new WeakSet();

	function patch(pf) {
		if (!pf || typeof pf.search !== "function") return pf;
		if (patched.has(pf)) return pf;
		var origSearch = pf.search;

		var wrapped = function (term, options) {
			var p = origSearch.call(pf, term, options);
			if (isSearchPage()) return p;
			return p.then(function (res) {
				if (!res || !Array.isArray(res.results)) return res;
				try {
					res.results = res.results.map(function (item, i) {
						// 面板只渲染前 5 条，后面这些没必要各发一次 fragment 请求。
						// 换成一个等价的轻量对象（而不是改写原对象的方法，
						// 原对象的 data 可能是只读的 getter，赋值会炸掉整次搜索）。
						if (i < DATA_LIMIT) return item;
						return {
							url: item.url,
							meta: { title: "" },
							excerpt: "",
							data: function () {
								return Promise.resolve({
									url: item.url,
									meta: { title: "" },
									excerpt: "",
								});
							},
						};
					});
				} catch (e) {
					log("trim failed", e);
				}
				return res;
			});
		};

		var proxied;
		try {
			proxied = new Proxy(pf, {
				get: function (target, prop) {
					if (prop === "search") return wrapped;
					return target[prop];
				},
			});
		} catch (e) {
			log("proxy failed", e);
			return pf;
		}
		patched.add(pf);
		patched.add(proxied);
		window.pagefind = proxied;
		log("search patched, data limit =", DATA_LIMIT);
		return proxied;
	}

	// ---------- 预热 ----------
	var warmed = false;
	function warm() {
		if (warmed || poorNet) return;
		warmed = true;
		getPagefind().then(function (pf) {
			if (!pf) return;
			patch(pf);
			if (typeof pf.preload !== "function") return;
			// preload = search(term, {preload:true})：起 worker、编译 wasm、载入索引，
			// 但不返回结果、不拉 fragment。正是我们要的。
			Promise.all(
				WARM_TERMS.map(function (t) {
					return pf.preload(t).catch(function () {});
				}),
			).then(function () {
				log("warm done");
			});
		});
	}

	// ---------- 触发时机 ----------
	// 1) 首屏空闲
	function scheduleIdle() {
		if (typeof window.requestIdleCallback === "function") {
			window.requestIdleCallback(warm, { timeout: 2500 });
		} else {
			window.setTimeout(warm, 2000);
		}
	}
	if (document.readyState === "complete") scheduleIdle();
	else window.addEventListener("load", scheduleIdle, { once: true });

	// 2) 越早越好的「意图信号」：鼠标悬停 / 焦点 / 触摸到搜索入口
	function bindIntent() {
		var targets = ["#search-bar", "#search-switch", "#search-input-desktop"];
		for (var i = 0; i < targets.length; i++) {
			var el = document.querySelector(targets[i]);
			if (!el || el.__ffWarmBound) continue;
			el.__ffWarmBound = true;
			["pointerenter", "focusin", "touchstart"].forEach(function (ev) {
				el.addEventListener(ev, warm, { once: true, passive: true });
			});
		}
		// 键盘快捷键（本站没有全局搜索快捷键，留着以防上游后加）
		document.addEventListener(
			"keydown",
			function (e) {
				if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "k") {
					warm();
				}
			},
			{ passive: true },
		);
	}

	// 3) 回车：上游的搜索框没有绑定 Enter，敲回车什么都不发生。
	//    这里补一个「回车 = 进第一条结果」，符合直觉且不改变原有「输入即搜」。
	//    ⚠️ 中文输入法用回车确认候选词，此时 isComposing 为真，必须放行。
	document.addEventListener("keydown", function (e) {
		if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
		var input = e.target;
		if (!input || input.tagName !== "INPUT") return;
		if (!input.closest("#search-bar") && !input.closest("#search-bar-inside"))
			return;
		var panel = document.getElementById("search-panel");
		if (!panel || panel.classList.contains("float-panel-closed")) return;
		var first = panel.querySelector("a[href]");
		if (!first) return;
		e.preventDefault();
		first.click();
	});

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", bindIntent, { once: true });
	} else {
		bindIntent();
	}
	// swup 切页后搜索框会被替换，重新绑定
	document.addEventListener("swup:page:view", bindIntent);
	document.addEventListener("astro:page-load", bindIntent);
})();
