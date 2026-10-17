/**
 * 动态页「内嵌评论」增强（只在 /dynamic/ 跑）—— 干四件事：
 *
 *   1. 按钮上标评论数：一进页面就批量问一次 Waline 的公开计数接口，把「评论」
 *      改成「评论 2」—— 不用点开也知道有没有人聊过。没有评论就不带数字。
 *   2. 有评论的默认展开，没评论的保持收起：一条都没有的面板摊开只是占地方，
 *      所以只自动展开 count > 0 的。滚到哪展开到哪（IntersectionObserver，400px 提前量）——
 *      一页十几条动态全展开就是十几个 Waline 实例同时拉 CDN，首屏直接废掉。
 *      自动展开只做一次，用户手动收起后不会再被弹开。
 *   3. 把 Waline 那个大编辑器压成一行：默认展开之后，昵称/邮箱/网址那一整块表单
 *      顶在最上面太挡视野。压成一行输入框，点进去（:focus-within）自动还原。
 *   4. 把全站的回复折叠 / 回复引用投进 iframe。
 *
 * 关于「默认展开」的反复（留个记录，别再绕一圈）：
 *   2026-10-16 先做过一版自动展开，站长看过否掉了 —— 那时一进页面每条动态下面都
 *   摊着带大表单的评论区，观感确实差，所以整段移除。随后站长又提了两件事：
 *   「每次都要点开才能查看，不点开又不知道有没有人评论」。所以这次把方案补齐再上：
 *   按钮带评论数（1）+ 只展开有评论的、没评论的不动（2）+ 编辑器压成一行（3）。
 *   真正让人烦的是「空面板摊开」和「大表单挡视野」，不是展开本身。
 *
 * 第 4 件事的前提：iframe 与主站同源，直接摸它的 document 是合法的。
 *   · 样式 —— 按 id 取父文档页脚里的那两个 <style> 块，cloneNode 丢进 iframe 的 head。
 *     单一来源：以后改 FooterConfig.html 的样式，两边一起变，不用同步维护第二份。
 *     （编辑器压扁那条是 iframe 专属，直接由本脚本 build 一个 <style> 塞进去。）
 *   · 逻辑 —— 往 iframe 里插 <script src>，复用现成的 comment-reply-collapse.js
 *     与 comment-reply-quote.js。这两个脚本都是自包含的，塞进任何文档都能独立跑。
 *
 * 时机：iframe 是面板展开那一刻才由上游创建的，所以不能「脚本一跑就去找元素」。
 * MutationObserver 盯新增节点，拿到 iframe 后**轮询**它的 contentDocument.readyState，
 * complete 了再注入；初次执行时也扫一遍页面上已有的 iframe。
 *   ⚠️ 「window 捕获阶段监听 iframe 的 load」实测在 Chrome 155 上压根收不到，别用事件。
 *   ⚠️ 刚 appendChild 的 iframe，document 还是 about:blank，而**它的 readyState 同样是
 *   complete** —— 不辨身份就会把样式注进空气里，所以按 location.pathname 前缀认页面。
 *   注入本身有幂等标记，重复调用无害。
 *
 * ⚠️ vercel.json 给 /assets/* 配了 30 天强缓存，改完本文件记得把
 *    FooterConfig.html 里 PAGE_SCRIPTS 那条的 ?v= 往上加。
 * ⚠️ 这里的 ?v= 要和 PAGE_SCRIPTS 里那两条（collapse / quote）保持一致。
 */
(function () {
	"use strict";

	// Waline 后端地址（评论数计数接口用）。换后端只改这一行。
	var WALINE = "https://waline.49o.pw";

	// 父文档里要搬进 iframe 的样式块，以及要补进 iframe 的脚本。
	// 版本号与 FooterConfig.html 的 PAGE_SCRIPTS 保持一致。
	// ff-cursor-style 也一并搬：那个 iframe 走 Layout（没有页脚），不搬就是系统原生指针。
	// 该块内部自己用 :root / html.dark 分了桐乃 / 黑猫两套，iframe 同样能从 localStorage
	// 拿到 dark 类，两边自然一致。
	var STYLE_IDS = ["ff-comment-style-collapse", "ff-comment-style-quote", "ff-cursor-style"];
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

	var FRAME_CLASS = "page-comment-frame";
	var PATH_PREFIX = "/dynamic/comments/";
	var MARK = "ffCommentEnhanced";
	var EDITOR_STYLE_ID = "ff-compact-editor-style";
	var AUTO_MARGIN = "400px 0px";
	var POLL_MS = 150;
	var POLL_TIMEOUT = 20000;
	var COUNT_DEBOUNCE = 200;

	// iframe 专属样式，两块：
	//
	// ① 编辑器压成一行。
	// ⚠️ Waline v3 的输入框是 <textarea class="wl-editor">（**不是** .wl-textarea），
	//    头部是 .wl-header、底部是 .wl-footer，两个都由 Waline 自己写 display。
	// ⚠️ 压缩走「加一个 .ff-compact 类」，聚焦时**摘掉这个类**回到 Waline 原样 ——
	//    比用 :not(:focus-within) 反转更稳，不用去猜它原本的 display 是 flex 还是 block。
	//
	// ② 藏掉评论区标题（「评论区 / 分享你的想法，与大家交流讨论」那一块）。
	//    它来自全站共用的 src/components/comment/index.astro（上游文件，动不得），
	//    在文章页里是正文与评论的分界、有用；但动态页这里一条动态配一个评论区，
	//    标题只是白占地方。所以只在动态这个 iframe 里藏。
	var IFRAME_CSS =
		"#waline .wl-comment.ff-compact .wl-header," +
		"#waline .wl-comment.ff-compact .wl-footer{display:none!important}" +
		"#waline .wl-comment.ff-compact .wl-editor{min-height:2.5rem!important;height:2.5rem!important}" +
		"#waline .wl-comment.ff-compact .wl-editor{transition:height 160ms ease}" +
		"#post-comments > .relative.z-10.mb-6{display:none!important}";

	var COMPACT_CLASS = "ff-compact";

	// 有内容的输入框不收起来 —— 写了一半被收走太烦
	function compactEditor(doc, attempt) {
		var editor = doc.querySelector("#waline .wl-comment");
		if (!editor) {
			// 编辑器是 Waline 异步渲染的，注入时可能还没长出来，等一等
			if ((attempt || 0) < 12) {
				window.setTimeout(function () {
					compactEditor(doc, (attempt || 0) + 1);
				}, 300);
			}
			return;
		}
		if (editor.dataset.ffCompact === "1") return;
		editor.dataset.ffCompact = "1";

		var field = editor.querySelector(".wl-editor");
		var hasText = function () {
			return !!(field && field.value && field.value.trim());
		};

		editor.classList.add(COMPACT_CLASS);
		editor.addEventListener("focusin", function () {
			editor.classList.remove(COMPACT_CLASS);
		});
		editor.addEventListener("focusout", function () {
			window.setTimeout(function () {
				if (editor.contains(doc.activeElement) || hasText()) return;
				editor.classList.add(COMPACT_CLASS);
			}, 140);
		});
	}

	// ===== 一、评论数：批量查一次，回填到按钮上 =====

	function pathOf(host) {
		var src = (host && host.dataset.src) || "";
		var q = src.indexOf("?");
		if (q < 0) return "";
		try {
			return new URLSearchParams(src.slice(q + 1)).get("path") || "";
		} catch (error) {
			return "";
		}
	}

	function labelOf(host, count) {
		var span = host.querySelector(".page-comment-toggle span");
		if (!span) return;
		// 没有评论就保持原样的「评论」二字 —— 有数字本身就是在说「有人聊过」
		span.textContent = count > 0 ? "评论 " + count : "评论";
	}

	var counts = {}; // path -> 评论数
	var pending = {}; // 本轮待查的 path
	var countTimer = null;

	function flushCounts() {
		var paths = Object.keys(pending);
		pending = {};
		if (!paths.length) return;
		var url = WALINE + "/api/comment?type=count";
		for (var i = 0; i < paths.length; i++) {
			url += "&url=" + encodeURIComponent(paths[i]);
		}
		fetch(url)
			.then(function (res) {
				return res.json();
			})
			.then(function (json) {
				var data = json && json.data;
				if (!Array.isArray(data)) return;
				for (var j = 0; j < paths.length; j++) {
					counts[paths[j]] = Number(data[j]) || 0;
				}
				applyCounts();
			})
			.catch(function () {
				/* 拿不到就保持原样，不影响其他功能 */
			});
	}

	function requestCount(host) {
		var path = pathOf(host);
		if (!path) return;
		if (counts[path] !== undefined) {
			labelOf(host, counts[path]);
			maybeAutoOpen(host, counts[path]);
			return;
		}
		pending[path] = 1;
		if (countTimer) return;
		countTimer = window.setTimeout(function () {
			countTimer = null;
			flushCounts();
		}, COUNT_DEBOUNCE);
	}

	function applyCounts() {
		var hosts = document.querySelectorAll("dynamic-inline-comments");
		for (var i = 0; i < hosts.length; i++) {
			var path = pathOf(hosts[i]);
			if (!path || counts[path] === undefined) continue;
			labelOf(hosts[i], counts[path]);
			maybeAutoOpen(hosts[i], counts[path]);
		}
	}

	// ===== 二、有评论的才默认展开（懒）=====

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

	function openPanel(host) {
		if (!host || host.dataset.ffAutoOpened === "1") return;
		host.dataset.ffAutoOpened = "1";
		var panel = host.querySelector("[data-comment-panel]");
		var toggle = host.querySelector("[data-comment-toggle]");
		if (!panel || !toggle) return;
		if (!panel.hidden) return; // 用户已经自己点开了
		toggle.click(); // 走上游自己的开合逻辑，不自己造 DOM
	}

	function maybeAutoOpen(host, count) {
		if (host.dataset.ffAutoWatch === "1") return;
		if (!count) return; // 没评论就不展开，也不盯着它
		host.dataset.ffAutoWatch = "1";
		if (autoObserver) autoObserver.observe(host);
		else openPanel(host);
	}

	// ===== 三、往 iframe 里投样式与脚本 =====

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

		// iframe 专属样式 + 折叠逻辑
		if (!doc.getElementById(EDITOR_STYLE_ID)) {
			var editorStyle = doc.createElement("style");
			editorStyle.id = EDITOR_STYLE_ID;
			editorStyle.textContent = IFRAME_CSS;
			doc.head.appendChild(editorStyle);
		}
		compactEditor(doc, 0);

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

	function scan(node) {
		if (!node || node.nodeType !== 1) return;
		if (isFrame(node)) {
			handleFrame(node);
			return;
		}
		if (!node.querySelectorAll) return;
		var hosts = node.querySelectorAll("dynamic-inline-comments");
		for (var i = 0; i < hosts.length; i++) requestCount(hosts[i]);
		var frames = node.querySelectorAll("iframe." + FRAME_CLASS);
		for (var j = 0; j < frames.length; j++) handleFrame(frames[j]);
	}

	new MutationObserver(function (records) {
		for (var i = 0; i < records.length; i++) {
			var added = records[i].addedNodes;
			for (var j = 0; j < added.length; j++) scan(added[j]);
		}
	}).observe(document.body, { childList: true, subtree: true });

	// 兜底：脚本可能比列表晚到（swup 切进 /dynamic/ 时列表已渲染完）
	scan(document.body);
})();
