/**
 * 首页「动态」跑马灯。
 *
 * 想在首页首屏 banner 下方挂一条持续横滚的最新动态，思路参考 nanzhiy.cn。
 *
 * 主题的 MainGridLayout.astro 属于上游文件，改它以后合并上游必冲突，所以走三段式：
 *   1. DOM 与样式注入在页脚（src/config/FooterConfig.html），页脚本身就在 #swup-container 之外；
 *   2. 本脚本把那条 DOM 搬进 #content-column（分类栏之前）—— 为什么是这个位置而不是
 *      #main-grid 之前，见 mount() 里的注释；#content-column 同样不在 swup 的替换范围内，
 *      所以搬一次即永久有效，切页不会丢；
 *   3. 数据直连 Memos 公开接口（实例与用户名见下面常量，对应 dynamicConfig.memos），已放开 CORS。
 *
 * 无缝滚动的关键：轨道内容先重复 k 份补满一屏，再整体复制一份 → 两半完全相同，
 * 在 0 → -50% 之间平移就看不出接缝。内容不足一屏时必须补足，否则整条静止不动。
 *
 * 本文件在页脚被全站引入（见 src/config/FooterConfig.html），非首页不请求数据，
 * 成本只有一次 getElementById。
 */
(function () {
	"use strict";

	// ===== 数据源：与 src/config/dynamicConfig.ts 的 memos 段保持一致 =====
	var MEMOS_API = "https://memos.49o.pw";
	var MEMOS_USER = "users/hy4962";
	var DETAIL_PATH = "/dynamic/";

	var MAX_ITEMS = 12;
	var SPEED = 48; // px/s，越小越慢
	var MIN_DURATION = 20; // s，内容太少时兜底，免得转得飞快
	var CACHE_KEY = "ff:dynbar:v1";
	var CACHE_TTL = 600000; // 10 分钟

	var bar = document.getElementById("ff-dyn");
	if (!bar) return;

	var marquee = bar.querySelector("[data-ff-dyn-marquee]");
	var track = bar.querySelector("[data-ff-dyn-track]");
	var group = bar.querySelector("[data-ff-dyn-group]");
	if (!marquee || !track || !group) return;

	var owner = bar.getAttribute("data-ff-dyn-owner") || "";

	// ===== 1. 搬到 #main-grid 内部的第一个位置 =====
	// 位置必须卡在这里，两个原因：
	//   ① 条子要横跨左右侧栏拿全宽 —— 只能靠 grid-column: 1 / -1 实现，
	//      所以它必须是 #main-grid 的 grid item（样式见 FooterConfig.html）；
	//   ② 首页那个下滑箭头执行的是 `#main-grid.scrollIntoView({ block: "start" })`，
	//      条子只要在 #main-grid **内部**，箭头滚完它就在视口里；
	//      放在 #main-grid 之前则会被整条甩到视口上方（V1 的 bug）。
	// #main-grid 本身不在 swup 的替换范围内（被换掉的只有它内部的 #swup-container），
	// 所以搬一次即永久有效，切页不会丢。
	function mount() {
		var host = document.getElementById("main-grid");
		if (!host) return;
		if (host.firstElementChild === bar) return;
		host.insertBefore(bar, host.firstChild);
	}

	// ===== 2. Markdown 取「首个非空行」的纯文本 =====
	// 只要一行，不需要 marked，所以不复用 memos-adapter（那是 TS，静态脚本引不动）。
	function firstLine(markdown) {
		var text = String(markdown || "")
			.replace(/```[\s\S]*?```/g, " ")
			.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
			.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
			.replace(/<[^>]*>/g, " ");

		var lines = text.split(/\r?\n/);
		for (var i = 0; i < lines.length; i += 1) {
			var line = lines[i]
				.replace(/[#>*_`~]/g, " ")
				.replace(/\s+/g, " ")
				.replace(/^[-–—•·]\s*/, "")
				.trim();
			if (line) return line;
		}
		return "";
	}

	// ===== 3. 缓存 =====
	function readCache() {
		try {
			var raw = localStorage.getItem(CACHE_KEY);
			if (!raw) return null;
			var cached = JSON.parse(raw);
			if (
				cached &&
				typeof cached.at === "number" &&
				Date.now() - cached.at < CACHE_TTL &&
				Array.isArray(cached.items) &&
				cached.items.length
			) {
				return cached.items;
			}
		} catch (error) {
			// 无痕模式等场景下 localStorage 不可用，直接走网络。
		}
		return null;
	}

	function writeCache(items) {
		try {
			localStorage.setItem(
				CACHE_KEY,
				JSON.stringify({ at: Date.now(), items: items }),
			);
		} catch (error) {
			// 写不进去不影响本次渲染。
		}
	}

	// ===== 4. 渲染轨道内容 =====
	function renderItems(items) {
		group.textContent = "";
		items.forEach(function (item) {
			var link = document.createElement("a");
			link.className = "ff-dyn-link";
			link.href = item.id
				? DETAIL_PATH + "#dynamic-" + item.id
				: DETAIL_PATH;

			var ownerEl = document.createElement("span");
			ownerEl.className = "ff-dyn-owner";
			ownerEl.textContent = owner;

			var sepEl = document.createElement("span");
			sepEl.className = "ff-dyn-sep";
			sepEl.textContent = "：";

			var textEl = document.createElement("span");
			textEl.className = "ff-dyn-text";
			textEl.textContent = item.text;

			var dotEl = document.createElement("span");
			dotEl.className = "ff-dyn-dot";
			dotEl.setAttribute("aria-hidden", "true");

			link.appendChild(ownerEl);
			link.appendChild(sepEl);
			link.appendChild(textEl);
			link.appendChild(dotEl);
			group.appendChild(link);
		});
	}

	// ===== 5. 无缝滚动 =====
	// 装饰性副本要对读屏隐藏，并把内部链接移出 tab 序，
	// 否则 aria-hidden 容器里出现可聚焦元素会被无障碍审计判违规。
	function decorate(node) {
		node.setAttribute("aria-hidden", "true");
		var links = node.querySelectorAll("a");
		for (var i = 0; i < links.length; i += 1) {
			links[i].setAttribute("tabindex", "-1");
		}
		node.setAttribute("data-ff-dyn-clone", "");
		return node;
	}

	var setupTimer = null;

	function setup() {
		// 先清掉上一轮克隆，保证 resize / 容器变宽后重算不会越滚越多。
		var stale = track.querySelectorAll("[data-ff-dyn-clone]");
		for (var i = 0; i < stale.length; i += 1) stale[i].remove();
		track.classList.remove("ff-dyn-track--animate");

		var setWidth = group.scrollWidth;
		var boxWidth = marquee.clientWidth;
		// 移动端整条 display:none → clientWidth 为 0，自然跳过，无需额外断点判断。
		if (!setWidth || !boxWidth) return;

		// ① 半幅至少要和跑道一样宽，滚动过程中视窗才不露空
		var k = Math.max(1, Math.ceil(boxWidth / setWidth));
		for (var j = 1; j < k; j += 1) {
			track.appendChild(decorate(group.cloneNode(true)));
		}
		// ② 整体再复制一份 → 两半完全相同，0 ↔ -50% 平移即无缝
		var half = track.querySelectorAll(".ff-dyn-group");
		for (var m = 0; m < half.length; m += 1) {
			track.appendChild(decorate(half[m].cloneNode(true)));
		}

		var duration = Math.max(MIN_DURATION, Math.round((k * setWidth) / SPEED));
		track.style.setProperty("--ff-dyn-duration", duration + "s");

		// 强制回流后再挂动画类，否则重算时动画不重播。
		void track.offsetWidth;
		track.classList.add("ff-dyn-track--animate");
	}

	function scheduleSetup() {
		// 等字体就绪再测宽：字体没加载完时 scrollWidth 偏小，会把「一屏」判少。
		if (document.fonts && document.fonts.ready) {
			document.fonts.ready.then(function () {
				requestAnimationFrame(setup);
			});
		} else {
			setTimeout(setup, 200);
		}
	}

	function onLayoutChange() {
		if (setupTimer) clearTimeout(setupTimer);
		setupTimer = setTimeout(setup, 250);
	}

	window.addEventListener("resize", onLayoutChange);

	// 首页切 banner / fullscreen 会改内容区宽度，resize 事件不一定触发，补一个容器级观察。
	if (window.ResizeObserver) {
		var lastWidth = 0;
		new ResizeObserver(function (entries) {
			var width = entries[0].contentRect.width;
			if (Math.abs(width - lastWidth) < 2) return;
			lastWidth = width;
			onLayoutChange();
		}).observe(marquee);
	}

	// ===== 6. 启动 =====
	var loaded = false;

	function boot() {
		if (loaded) return;
		if (!/^\/$/.test(window.location.pathname)) return;
		loaded = true;

		var cached = readCache();
		if (cached) {
			renderItems(cached);
			bar.classList.add("ff-dyn--ready");
			scheduleSetup();
			return;
		}

		fetch(MEMOS_API + "/api/v1/memos?pageSize=50", {
			headers: { Accept: "application/json" },
		})
			.then(function (response) {
				if (!response.ok) throw new Error("memos " + response.status);
				return response.json();
			})
			.then(function (data) {
				// Memos 的 ListMemos 不带 parent 也能拿到别人的动态，这里按 creator 二次过滤；
				// 排序与 memos-adapter.ts 对齐：置顶优先，其余按时间倒序。
				var items = (data.memos || [])
					.filter(function (memo) {
						return (
							memo.state === "NORMAL" && memo.creator === MEMOS_USER
						);
					})
					.sort(function (a, b) {
						if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
						return new Date(b.createTime) - new Date(a.createTime);
					})
					.slice(0, MAX_ITEMS)
					.map(function (memo) {
						return {
							id: String(memo.name || "").split("/").pop() || "",
							text: firstLine(memo.content),
						};
					})
					.filter(function (item) {
						return item.text;
					});

				if (!items.length) return;

				writeCache(items);
				renderItems(items);
				bar.classList.add("ff-dyn--ready");
				scheduleSetup();
			})
			.catch(function (error) {
				// 拉不到就整条不显示，页面里不留空壳。
				if (window.console && console.warn) {
					console.warn("[ff-dyn] 首页动态加载失败：", error);
				}
			});
	}

	function onPageReady() {
		mount();
		boot();
	}

	document.addEventListener("swup:page:view", onPageReady);
	document.addEventListener("astro:page-load", onPageReady);

	// body 的 is-home 由主题在切页时同步，这里只关心「首页路径」，
	// 所以不需要额外监听 class 变化，按路径判断最稳。
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", onPageReady, { once: true });
	} else {
		onPageReady();
	}
})();
