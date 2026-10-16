/**
 * 动态页封面区（只在 /dynamic/ 跑）—— 把页脚那个 #ff-wx-hero 壳子搬到正文顶部。
 *
 * 壳子（封面图 / 头像 / 昵称 / 签名 / 两个按钮）写在 src/config/FooterConfig.html 里，
 * 版式照 blog.huchao.vip/moments/ 的 wx-cover。之所以先挂页脚再搬：
 * 上游的 src/pages/dynamic/index.astro 是主题文件，动不得；而页脚在 swup 容器之外、
 * 全站都在，是现成的注入点。
 *
 * ⚠️ 搬的时候用 cloneNode，**不搬原壳** —— 正文整个在 swup 的替换范围里，切一次页
 *    搬过去的节点就没了，原壳留在页脚才能保证下次切回来还在。
 *    副本会去掉 id（避免和原壳重复），样式全靠 .ff-wx-* 的类名，不依赖 id。
 * ⚠️ 置顶条的内容要等动态列表渲染完（数据是客户端从 Memos 拉的），所以是轮询补的，
 *    拿不到就一直不显示（bar 默认 hidden），不会留一个空框在页面上。
 *
 * ⚠️ /assets/* 有 30 天强缓存，改完本文件记得把 FooterConfig.html 里
 *    PAGE_SCRIPTS 那条的 ?v= 往上加。
 */
(function () {
	"use strict";

	var HERO_ID = "ff-wx-hero";
	var MAX_PINNED = 3; // 置顶条最多预览几条
	var POLL_MS = 1200;
	var POLL_MAX = 12;

	function mount() {
		var shell = document.getElementById(HERO_ID);
		if (!shell) return;
		var anchor = document.querySelector(".page-header");
		if (!anchor || !anchor.parentElement) return;

		// 同一个页面可能被 astro:page-load 与 swup:page:view 各触发一次，插之前先认门。
		// ⚠️ 别用 `host.querySelector(":scope > .ff-wx-cover")` 判 —— 实测在这儿不生效，
		//    连触发三次事件就插出三份封面。锚点上的 dataset 标记最靠谱：
		//    swup 换页时 .page-header 是新元素（没有标记）会重新插，同一份 DOM 反复触发
		//    也不会重复。
		if (anchor.dataset.ffHeroMounted === "1") return;
		anchor.dataset.ffHeroMounted = "1";

		var host = anchor.parentElement;
		var copy = shell.cloneNode(true);
		copy.removeAttribute("id");
		copy.hidden = false;
		host.insertBefore(copy, anchor);
		randomizeCover(copy);
		mountActions(copy);
		fillPinned(copy);
	}

	// 封面图：从 data-covers 里随机挑一张（跟桌面壁纸同一批图）。
	// 站长要的是「每次进来随机一张、但不轮播」，所以只在挂载时挑一次，
	// 页面内不再定时换 —— 切进切出算「一次进来」，会重新挑。
	// ⚠️ 图片地址写在 FooterConfig.html 那个壳的 data-covers 上，不在这里硬编码；
	//    只配一个的话就不随机，固定成那张。
	function randomizeCover(hero) {
		var img = hero.querySelector(".ff-wx-cover-img");
		if (!img) return;
		var list = (img.dataset.covers || "")
			.split(",")
			.map(function (s) {
				return s.trim();
			})
			.filter(Boolean);
		if (list.length < 2) return;
		img.src = list[Math.floor(Math.random() * list.length)];
	}

	// 「写说说」并进页面头部右侧那一排（跟「订阅RSS」「N 动态」排一起）。
	// 它原来是封面区下面单独的一行，只有一个按钮，又空又占一整行高度。
	// .page-header 是 Astro 静态吐出来的（Svelte 只管下面的动态列表），
	// 插进去的节点不会被重建，所以不用像封面区那样每次克隆。
	function mountActions(hero) {
		var actions = hero.querySelector(".ff-wx-actions");
		var count = document.querySelector(".page-count");
		if (!actions || !count) return;
		var btn = actions.querySelector(".ff-wx-action-btn");
		if (!btn) {
			actions.remove();
			return;
		}
		count.insertBefore(btn, count.firstChild);
		actions.remove();
	}

	function fillPinned(hero) {
		var bar = hero.querySelector(".ff-wx-pinned");
		var box = hero.querySelector(".ff-wx-pinned-items");
		if (!bar || !box) return;

		var entryCache = [];
		var attempt = 0;

		var run = function () {
			attempt++;
			entryCache = [];
			var entries = document.querySelectorAll("dynamic-entry");
			for (var i = 0; i < entries.length; i++) {
				var badge = entries[i].querySelector(".page-pinned-badge");
				if (badge && !badge.hidden) entryCache.push(entries[i]);
			}

			if (!entryCache.length) {
				// 列表还没渲染出来（客户端拉 Memos 是异步的），等一等再说；
				// 始终没有置顶就保持隐藏，不留空框
				if (attempt < POLL_MAX) window.setTimeout(run, POLL_MS);
				return;
			}

			box.replaceChildren();
			entryCache.slice(0, MAX_PINNED).forEach(function (entry) {
				var preview = document.createElement("div");
				preview.className = "ff-wx-pinned-preview";

				var thumb = entry.querySelector(".page-gallery-grid-item img");
				if (thumb) {
					var img = document.createElement("img");
					img.className = "ff-wx-pinned-img";
					img.src = thumb.currentSrc || thumb.src;
					img.alt = "";
					img.loading = "lazy";
					preview.appendChild(img);
				} else {
					var content = entry.querySelector(".page-content");
					var text = document.createElement("div");
					text.className = "ff-wx-pinned-text";
					text.textContent =
						((content && content.innerText) || "").trim().slice(0, 36) ||
						"置顶动态";
					preview.appendChild(text);
				}
				box.appendChild(preview);
			});

			bar.setAttribute("href", "#" + (entryCache[0].id || ""));
			bar.hidden = false;
		};

		run();
	}

	function boot() {
		mount();
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot, { once: true });
	} else {
		boot();
	}
	document.addEventListener("astro:page-load", boot);
	document.addEventListener("swup:page:view", boot);
	document.addEventListener("swup:content:replace", boot);
})();
