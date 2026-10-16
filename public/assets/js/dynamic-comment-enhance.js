/**
 * 动态页「内嵌评论」增强（只在 /dynamic/ 跑）—— 干两件事：
 *
 *   1. 评论面板默认展开：上游把评论区做成「点一下才展开」的折叠面板（面板带 hidden，
 *      点了才创建 iframe），站长要的是滚到这条动态就能直接看到评论。
 *   2. 把全站评论增强投进 iframe：回复折叠、回复引用。
 *
 * 第 1 件事为什么是「替用户点一下」而不是自己建 DOM：
 *   面板的开合、iframe 的创建、主题同步、高度上报全在上游那个 custom element 里，
 *   自己重写一遍等于把它们抄一遍，上游一改就漂。直接派发 click 到它那颗「评论」按钮，
 *   走的就是正常用户路径，上游怎么变都跟着变。
 *
 *   但要懒：一页 10 条动态，全展开就是 10 个 Waline 实例同时去拉 unpkg 上的
 *   waline.js / waline.css，每个 iframe 里还各自跑一整套页面脚本（统计、特效、播放器），
 *   首屏直接废掉。所以用 IntersectionObserver 兜着 —— 离视口 400px 以内才点，
 *   滚到哪展开到哪。首屏那条进页面就有评论，其余的各就各位。
 *   自动展开只做一次（打过标记就不再碰），用户手动收起后不会又被弹开。
 *
 * 第 2 件事：动态的评论区是个同源 iframe（src = /dynamic/comments/?path=...），
 * 而那个页面走的是 Layout —— 它**没有页脚**。全站的评论增强都是靠 FooterConfig.html
 * 的注入 + 页脚 PAGE_SCRIPTS 全站分发的，注入到不了那个文档，结果就是：
 * 文章页 / 留言板 / 友链页的回复默认展示 2 条、多余的收进「展开更多」，
 * 唯独动态里的回复一条不落地全摊着，成了全站唯一一套不一样的评论区。
 *
 *   修法（前提是 iframe 与主站同源，直接摸它的 document 是合法的）：
 *   · 样式 —— 按 id 取父文档页脚里的那两个 <style> 块，cloneNode 丢进 iframe 的 head。
 *     单一来源：以后改 FooterConfig.html 的样式，两边一起变，不用同步维护第二份。
 *   · 逻辑 —— 往 iframe 里插 <script src>，直接复用现成的 comment-reply-collapse.js
 *     与 comment-reply-quote.js。这两个脚本都是自包含的（只碰自己 document 的 DOM，
 *     MutationObserver 挂自己的 body），塞进任何文档都能独立跑，不依赖父文档的全局。
 *
 *   时机：iframe 是面板展开的那一刻才由上游创建的，所以不能「脚本一跑就去找元素」。
 *   MutationObserver 盯新增节点，拿到 iframe 后**轮询**它的 contentDocument.readyState，
 *   complete 了再注入；初次执行时也扫一遍页面上已有的 iframe。
 *   ⚠️ 一开始用的是「window 上捕获阶段监听 load（load 不冒泡但走捕获路径）」，实测
 *   在 Chrome 155 上压根收不到，注入永远不发生 —— 别再用事件，轮询才是可靠的。
 *   ⚠️ 刚 appendChild 的 iframe，document 还是 about:blank，而 **它的 readyState 同样是
 *   complete** —— 不辨身份就会把样式注进空气里，所以要按 location.pathname 前缀认页面。
 *   注入本身有幂等标记（iframe documentElement 上的 dataset），重复调用无害。
 *
 * ⚠️ vercel.json 给 /assets/* 配了 30 天强缓存，改完本文件记得把
 *    FooterConfig.html 里 PAGE_SCRIPTS 那条的 ?v= 往上加。
 * ⚠️ 这里的 ?v= 要和 PAGE_SCRIPTS 里那两条（collapse / quote）保持一致，
 *    否则 iframe 里可能拿到旧版本脚本。
 */
(function () {
	"use strict";

	// 父文档里要搬进 iframe 的样式块，以及要补进 iframe 的脚本。
	// 版本号与 FooterConfig.html 的 PAGE_SCRIPTS 保持一致。
	var STYLE_IDS = ["ff-comment-style-collapse", "ff-comment-style-quote"];
	var SCRIPTS = [
		{
			id: "ff-comment-reply-collapse-js",
			src: "/assets/js/comment-reply-collapse.js?v=2",
		},
		{
			id: "ff-comment-reply-quote-js",
			src: "/assets/js/comment-reply-quote.js?v=3",
		},
	];

	var HOST_TAG = "DYNAMIC-INLINE-COMMENTS";
	var FRAME_CLASS = "page-comment-frame";
	var PATH_PREFIX = "/dynamic/comments/";
	var MARK = "ffCommentEnhanced";
	var AUTO_MARGIN = "400px 0px"; // 离视口多远就提前展开
	var POLL_MS = 150;
	var POLL_TIMEOUT = 20000;

	// ===== 一、评论面板默认展开 =====

	function openPanel(host) {
		if (host.dataset.ffAutoOpened === "1") return;
		host.dataset.ffAutoOpened = "1";
		var panel = host.querySelector("[data-comment-panel]");
		var toggle = host.querySelector("[data-comment-toggle]");
		if (!panel || !toggle) return;
		// 用户自己已经点开了，不用再点一次
		if (!panel.hidden) return;
		toggle.click();
	}

	var autoObserver =
		typeof IntersectionObserver === "function"
			? new IntersectionObserver(
					function (entries) {
						for (var i = 0; i < entries.length; i++) {
							if (!entries[i].isIntersecting) continue;
							autoObserver.unobserve(entries[i].target);
							openPanel(entries[i].target);
						}
					},
					{ rootMargin: AUTO_MARGIN },
				)
			: null;

	function watchHost(host) {
		if (host.dataset.ffAutoWatch === "1") return;
		host.dataset.ffAutoWatch = "1";
		// 没有 IntersectionObserver 就退化成「全部立即展开」，功能不丢
		if (autoObserver) autoObserver.observe(host);
		else openPanel(host);
	}

	// ===== 二、把全站评论增强投进 iframe =====

	function inject(frame) {
		var doc;
		try {
			doc = frame.contentDocument;
		} catch (error) {
			// 跨源（理论上不会，路径都在本站）—— 静默跳过，绝不让它把页面搞崩
			return;
		}
		if (!doc || !doc.head || !doc.body) return;
		if (doc.documentElement.dataset[MARK] === "1") return;
		doc.documentElement.dataset[MARK] = "1";

		for (var i = 0; i < STYLE_IDS.length; i++) {
			var id = STYLE_IDS[i];
			if (doc.getElementById(id)) continue;
			var source = document.getElementById(id);
			if (source) doc.head.appendChild(source.cloneNode(true));
		}

		for (var j = 0; j < SCRIPTS.length; j++) {
			var entry = SCRIPTS[j];
			if (doc.getElementById(entry.id)) continue;
			var script = doc.createElement("script");
			script.id = entry.id;
			script.src = entry.src;
			doc.head.appendChild(script);
		}
	}

	// 只认评论页：iframe 刚插进 DOM 时 document 可能还是 about:blank，
	// 那时候 readyState 也是 complete，直接注入就注进空气里了。
	function isCommentDoc(frame, doc) {
		try {
			return frame.contentWindow.location.pathname.indexOf(PATH_PREFIX) === 0;
		} catch (error) {
			return false;
		}
	}

	function watchFrame(frame, deadline) {
		if (!frame.isConnected) return; // 被 swup / 翻页 / 收起干掉了，别再追
		var doc = frame.contentDocument;
		if (
			doc &&
			doc.readyState === "complete" &&
			doc.head &&
			doc.body &&
			isCommentDoc(frame, doc)
		) {
			inject(frame);
			return;
		}
		if (Date.now() > deadline) return;
		window.setTimeout(function () {
			watchFrame(frame, deadline);
		}, POLL_MS);
	}

	function handleFrame(frame) {
		if (frame.dataset.ffEnhanceWatch === "1") return;
		frame.dataset.ffEnhanceWatch = "1";
		watchFrame(frame, Date.now() + POLL_TIMEOUT);
	}

	function isFrame(node) {
		return (
			node &&
			node.nodeType === 1 &&
			node.tagName === "IFRAME" &&
			node.classList &&
			node.classList.contains(FRAME_CLASS)
		);
	}

	function isHost(node) {
		return node && node.nodeType === 1 && node.tagName === HOST_TAG;
	}

	function scan(node) {
		if (!node || node.nodeType !== 1) return;
		if (isHost(node)) {
			watchHost(node);
			return;
		}
		if (isFrame(node)) {
			handleFrame(node);
			return;
		}
		if (!node.querySelectorAll) return;
		var hosts = node.querySelectorAll("dynamic-inline-comments");
		for (var i = 0; i < hosts.length; i++) watchHost(hosts[i]);
		var frames = node.querySelectorAll("iframe." + FRAME_CLASS);
		for (var j = 0; j < frames.length; j++) handleFrame(frames[j]);
	}

	new MutationObserver(function (records) {
		for (var i = 0; i < records.length; i++) {
			var added = records[i].addedNodes;
			for (var j = 0; j < added.length; j++) scan(added[j]);
		}
	}).observe(document.body, { childList: true, subtree: true });

	// 兜底：脚本可能比动态列表晚到（比如 swup 切进 /dynamic/ 时列表已渲染完）
	scan(document.body);
})();
