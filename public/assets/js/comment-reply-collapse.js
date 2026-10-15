/**
 * 评论区「回复折叠」（全站，Waline）—— 每条评论下的回复默认收起。
 *
 * 行为（站长 2026-10-15 定的，当晚改过一版）：
 *   1. 顶层评论照常全部显示，不动；
 *   2. 它下面的回复**默认展示 2 条**，后面的先收着；
 *   3. 还有剩就给个「展开更多（还剩 M 条）」，每次再放 5 条；
 *   4. 全摊完按钮变「收起回复」，点一下回到默认的 2 条；
 *   5. 回复本来就不超过 2 条的评论完全不碰，连按钮都不插。
 *
 * 为什么这么写（都是实测踩出来的）：
 *   · Waline 的 DOM 是 Vue 渲染的，回复挂在 **.wl-quote** 里（不是嵌套条目），
 *     一条顶层评论 = .wl-card-item > .wl-card > .wl-quote > .wl-card-item × N。
 *     没有回复时 .wl-quote 仍然存在、只是空的，所以要按「有 .wl-card-item 子节点」判定。
 *   · 折叠只认 .wl-quote 的**直接子** .wl-card-item；Waline 点「回复」时插进来的
 *     编辑框不是这个类，不会被误伤。
 *   · MutationObserver 挂在 body 上而不是 #waline 上：#waline 会随 swup 换页被整个替换，
 *     挂它身上的观察器会失效；挂 body 则换页后 Waline 重新渲染的新节点也能接住。
 *   · 隐藏用 class 而不是内联 style，免得跟 Vue 自己的 style 绑定打架。
 *   · 已处理的 .wl-quote 用 dataset 打标，但**同时要求按钮还在**才算处理过 ——
 *     Vue 重绘若把按钮带走，dataset 可能残留，只认 dataset 会导致按钮再也不出现。
 *
 * ⚠️ vercel.json 给 /assets/* 配了 30 天强缓存，改完本文件记得把
 *    FooterConfig.html 里 PAGE_SCRIPTS 那条的 ?v= 往上加。
 */
(function () {
	"use strict";

	var DEFAULT_SHOWN = 2; // 默认展示的回复条数（不超过这个数就不插按钮）
	var STEP = 5; // 「展开更多」每次追加的条数
	var DEBOUNCE = 160; // MutationObserver 防抖
	var ITEM = "wl-card-item";
	var BTN = "ff-rp-toggle";
	var HIDDEN = "ff-rp-hidden";

	var ICON =
		'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.9a1 1 0 0 1-.7-.3l-6.2-6.2a1 1 0 1 1 1.4-1.4L12 13.5l5.5-5.5a1 1 0 1 1 1.4 1.4l-6.2 6.2a1 1 0 0 1-.7.3z"/></svg>';

	// 只取直接子级：.wl-quote 里可能嵌着更深的 .wl-card-item（回复的回复），
	// querySelectorAll 会把它一起捞出来，层级就乱了。
	function directItems(quote) {
		var out = [];
		for (var i = 0; i < quote.children.length; i++) {
			var el = quote.children[i];
			if (el.classList && el.classList.contains(ITEM)) out.push(el);
		}
		return out;
	}

	function findButton(quote) {
		for (var i = 0; i < quote.children.length; i++) {
			var el = quote.children[i];
			if (el.classList && el.classList.contains(BTN)) return el;
		}
		return null;
	}

	function labelOf(shown, total) {
		if (shown >= total) return "收起回复";
		return "展开更多（还剩 " + (total - shown) + " 条）";
	}

	function apply(quote, shown) {
		var items = directItems(quote);
		var total = items.length;
		if (shown > total) shown = total;
		if (shown < 0) shown = 0;

		for (var i = 0; i < total; i++) {
			items[i].classList.toggle(HIDDEN, i >= shown);
		}
		quote.dataset.ffShown = String(shown);

		var btn = findButton(quote);
		if (!btn) return;
		var text = btn.querySelector(".ff-rp-label");
		if (text) text.textContent = labelOf(shown, total);
		// 全摊开时箭头翻上去，表示「点一下是收起」
		btn.classList.toggle("ff-rp-open", shown >= total);
		btn.setAttribute("aria-expanded", shown > 0 ? "true" : "false");
	}

	function attach(quote) {
		// 按钮还在就说明这条已经接过了，别重复插
		if (quote.dataset.ffRp === "1" && findButton(quote)) return;

		var items = directItems(quote);
		// 回复本来就没超过默认条数：原样摊着，不插按钮，也不打标记
		if (items.length <= DEFAULT_SHOWN) return;

		quote.dataset.ffRp = "1";

		var btn = document.createElement("button");
		btn.type = "button";
		btn.className = BTN;
		btn.innerHTML = ICON + '<span class="ff-rp-label"></span>';
		btn.addEventListener("click", function () {
			var total = directItems(quote).length;
			var shown = Number(quote.dataset.ffShown || DEFAULT_SHOWN);
			apply(quote, shown >= total ? DEFAULT_SHOWN : shown + STEP);
		});

		quote.appendChild(btn);
		apply(quote, DEFAULT_SHOWN);
	}

	function scan() {
		var root = document.getElementById("waline");
		if (!root) return;
		var quotes = root.querySelectorAll(".wl-quote");
		for (var i = 0; i < quotes.length; i++) attach(quotes[i]);
	}

	var timer = null;
	function schedule() {
		if (timer) return;
		timer = window.setTimeout(function () {
			timer = null;
			scan();
		}, DEBOUNCE);
	}

	new MutationObserver(schedule).observe(document.body, {
		childList: true,
		subtree: true,
	});

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", scan, { once: true });
	} else {
		scan();
	}
})();
