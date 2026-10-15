/**
 * 评论区「回复引用」（全站，Waline）—— 回复别人时带上被回复那条的内容。
 *
 * 起因：Waline 的二级回复只渲染 `@昵称：` 加自己的话，看的人根本不知道在回哪一条 ——
 * 一串你来我往的对话里，@ 的是谁很清楚，@ 的是他那句话里的哪一句完全靠猜。
 *
 * 做法：Waline 其实留了线索 —— 回复的正文里有一行
 *   <p class="wl-reply-to"><a href="#4508715">@朝朝听雨</a><span>: </span></p>
 * 那个 href 就是**被回复评论的 objectId**，而每条评论的 DOM 节点 id 正好也是它。
 * 所以顺着锚点找到目标评论，把它「谁 + 说了什么」摘出来，做成一个引用块插在 @ 那行下面；
 * 点引用块会滚到原评论并闪一下。
 *
 * 几个边界：
 *   · 目标不在当前页（分页/已删除）→ 找不到节点，就不插，保持 Waline 原样；
 *   · 目标准好是回复本身（回复的回复）→ 取它的正文，但要剥掉它自己那行 @ 前缀；
 *   · 目标被「回复折叠」收起来了 → 点引用块时先请折叠脚本把它展开（见下面的全局钩子），
 *     否则 scrollIntoView 对一个 display:none 的节点是没反应的；
 *   · 引用只摘两行并做视觉截断，长评论不至于把回复撑开。
 *
 * ⚠️ 两个血泪点：
 *   1. 剥 @ 前缀必须 **clone 之后再 remove**。第一版直接对真实节点下手，把页面上
 *      「回复 @某某：」那行整个删掉了 —— 而那正是要保留的东西。
 *   2. 取子元素一律走「直接子」，不用 querySelector：一条顶层评论的 DOM 里还嵌着
 *      十几条回复，`item.querySelector('.wl-content')` 捞到谁全看文档顺序。
 *
 * ⚠️ vercel.json 给 /assets/* 配了 30 天强缓存，改完本文件记得把
 *    FooterConfig.html 里 PAGE_SCRIPTS 那条的 ?v= 往上加。
 */
(function () {
	"use strict";

	var DEBOUNCE = 160; // MutationObserver 防抖
	var MAX_LEN = 120; // 引用正文最多摘多少字（CSS 还会再截到两行）
	var CLS = "ff-rq";
	var FLASH = "ff-rq-flash";

	// ===== 取「自己的」节点：全部走直接子，不碰嵌套回复里的同名元素 =====
	function ownChild(parent, cls) {
		if (!parent) return null;
		for (var i = 0; i < parent.children.length; i++) {
			if (parent.children[i].classList.contains(cls)) return parent.children[i];
		}
		return null;
	}

	function ownCard(item) {
		return ownChild(item, "wl-card");
	}

	function ownContent(item) {
		return ownChild(ownCard(item), "wl-content");
	}

	// 摘「谁说了什么」
	function quoteOf(item) {
		var card = ownCard(item);
		var content = ownChild(card, "wl-content");
		if (!content) return null;

		// 只剥副本里的 .wl-reply-to（那是「回复 @某某：」前缀，不是他说的话）
		var clone = content.cloneNode(true);
		var prefix = clone.querySelector(".wl-reply-to");
		if (prefix) prefix.remove();

		var text = (clone.textContent || "").replace(/\s+/g, " ").trim();
		if (!text) return null;

		var nick = ownChild(ownChild(card, "wl-head"), "wl-nick");
		var name = nick ? (nick.textContent || "").trim() : "";

		return {
			name: name || "被回复的评论",
			text: text.length > MAX_LEN ? text.slice(0, MAX_LEN) + "…" : text,
		};
	}

	function hasQuote(item) {
		var content = ownContent(item);
		if (!content) return false;
		for (var i = 0; i < content.children.length; i++) {
			if (content.children[i].classList.contains(CLS)) return true;
		}
		return false;
	}

	function jumpTo(target) {
		// 目标可能正被「回复折叠」收着，先请它展开到这一条
		if (target.classList.contains("ff-rp-hidden") && typeof window.__ffReplyCollapseExpand === "function") {
			window.__ffReplyCollapseExpand(target);
		}
		if (typeof target.scrollIntoView === "function") {
			target.scrollIntoView({ block: "center", behavior: "smooth" });
		}
		target.classList.remove(FLASH);
		// 强制回流，让动画能连着重放
		void target.offsetWidth;
		target.classList.add(FLASH);
		window.setTimeout(function () {
			target.classList.remove(FLASH);
		}, 1900);
	}

	function attach(item) {
		if (item.dataset.ffRq === "1" && hasQuote(item)) return;

		var replyTo = ownChild(ownContent(item), "wl-reply-to");
		if (!replyTo) return;

		var link = replyTo.querySelector('a[href^="#"]');
		if (!link) return;

		var id = (link.getAttribute("href") || "").slice(1);
		var target = id ? document.getElementById(id) : null;
		if (!target || target === item || !target.classList.contains("wl-card-item")) return;

		var quote = quoteOf(target);
		if (!quote) return;

		item.dataset.ffRq = "1";

		var btn = document.createElement("button");
		btn.type = "button";
		btn.className = CLS;
		btn.title = "跳到这条评论";
		btn.setAttribute("aria-label", "跳到 " + quote.name + " 的那条评论");

		var nameEl = document.createElement("span");
		nameEl.className = "ff-rq-nick";
		nameEl.textContent = quote.name + "：";

		var textEl = document.createElement("span");
		textEl.className = "ff-rq-text";
		textEl.textContent = quote.text;

		btn.appendChild(nameEl);
		btn.appendChild(textEl);
		btn.addEventListener("click", function () {
			jumpTo(target);
		});

		replyTo.insertAdjacentElement("afterend", btn);
	}

	function scan() {
		var root = document.getElementById("waline");
		if (!root) return;
		var items = root.querySelectorAll(".wl-card-item");
		for (var i = 0; i < items.length; i++) attach(items[i]);
	}

	var timer = null;
	function schedule() {
		if (timer) return;
		timer = window.setTimeout(function () {
			timer = null;
			scan();
		}, DEBOUNCE);
	}

	// 同 comment-reply-collapse：挂 body 而不是 #waline —— 后者会随 swup 换页被整体替换
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
