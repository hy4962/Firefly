/**
 * 动态页「内嵌评论预览」—— 只在 /dynamic/ 跑。
 *
 * 版面照 https://lengxiqwq.com/dynamic/ 那套：每条动态正文下面直接铺一块评论卡片
 * —— 标题行「N 条评论 + 写评论」、最多 3 条评论、底部「展开更多 / 打开完整评论区」。
 * 之前那个「评论 2」折叠按钮 + 整块 iframe 的路子废掉了：一页 20 条动态，
 * 光点开一条就要拉一遍完整的 Waline（几百 KB JS + 头像 + 表情包配置），
 * 而且不点开根本不知道有没有人聊过。
 *
 * 现在的分工：
 *   · 预览层（本文件）—— 只发一次 REST 请求（/api/comment?path=…），拿回计数与列表，
 *     自己拼 DOM 渲染。不发任何 Waline 前端资源。
 *   · 编辑层 —— 还是上游 dynamic-inline-comments 那个 iframe（/dynamic/comments/），
 *     但**按需创建**：点「写评论 / 打开完整评论区」才展开，并把光标塞进输入框。
 *     表单、表情、Markdown、登录、回复链全交给 Waline 自己，不重写。
 *
 * 上游那几个文件（DynamicInlineComments.astro / dynamic-inline-comments.ts /
 * dynamic.css）一个字都没动 —— 本文件只是：
 *   1. 在 <dynamic-inline-comments> 里插一块预览 DOM；
 *   2. 把上游那个折叠按钮藏掉（用 data-dyn-preview 门控，脚本挂了按钮还在，可降级）；
 *   3. 用户点「写评论」时代它 .click()，走它自己的开合逻辑。
 *
 * ⚠️ iframe 那边仍然要代投「回复折叠 / 回复引用 / 编辑器压扁」三套东西：
 *    /dynamic/comments/ 走 Layout、没有页脚，全站脚本与样式压根到不了它。
 *    这部分逻辑原样保留（inject / compactEditor）。
 * ⚠️ 刚 appendChild 的 iframe，document 还是 about:blank，而**它的 readyState 同样是
 *    complete** —— 不辨身份就会把样式注进空气里，所以按 location.pathname 前缀认页面。
 * ⚠️ 「window 捕获阶段监听 iframe 的 load」实测在 Chrome 155 上压根收不到，别用事件，
 *    老实轮询 contentDocument.readyState。
 * ⚠️ vercel.json 给 /assets/* 配了 30 天强缓存，改完本文件记得把 FooterConfig.html
 *    里 PAGE_SCRIPTS 那条的 ?v= 往上加。
 */
(function () {
	"use strict";

	// Waline 后端地址（评论列表 / 计数接口用）。换后端只改这一行。
	var WALINE = "https://waline.49o.pw";

	// 预览里最多铺几条。参考站是 4，我们卡片更窄，3 条刚好不把正文压到下一屏。
	var MAX_SHOWN = 3;
	var FETCH_LIMIT = 30;
	var CACHE_TTL = 5 * 60 * 1000;
	var CACHE_KEY = "ff-dyn-comments-cache-v1";
	var CLAMP_HEIGHT = 96; // 超过这个高度就折成 4 行 + 「展开」

	// 父文档里要搬进 iframe 的样式块，以及要补进 iframe 的脚本。
	// 版本号与 FooterConfig.html 的 PAGE_SCRIPTS 保持一致。
	// ff-cursor-style 也一并搬：那个 iframe 走 Layout（没有页脚），不搬就是系统原生指针。
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
	var POLL_MS = 150;
	var POLL_TIMEOUT = 20000;

	var FALLBACK_AVATAR =
		"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2394a3b8'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";

	// Material Symbols 的 path 直接内联 —— 动态插入的节点取不到页面上那份 <symbol>，
	// 照抄 <use href="#ai:..."> 只会渲染成空白。
	var ICON = {
		chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 18q-.825 0-1.412-.587T2 16V4q0-.825.588-1.412T4 2h16q.825 0 1.413.588T22 4v12q0 .825-.587 1.413T20 18H6.8L4 20.8V18Zm1.15-2H20V4H4v13.15L5.15 16ZM4 16V4v12Z"/></svg>',
		pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 19h1.425L16.2 9.225l-1.425-1.425L5 17.575V19Zm-2 2v-4.25L16.2 3.575q.3-.275.663-.425t.762-.15q.4 0 .775.15t.65.45L20.425 5q.3.275.437.65t.138.75q0 .4-.138.775t-.437.675L7.25 21H3ZM19 6.4 17.6 5 19 6.4Zm-3.525 2.125-.7-.725 1.425 1.425-.725-.7Z"/></svg>',
		arrow:
			'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.175 13H4v-2h12.175l-5.6-5.6L12 4l8 8-8 8-1.425-1.4 5.6-5.6Z"/></svg>',
		down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 14.95q-.2 0-.375-.063t-.325-.212L6.3 9.675q-.275-.275-.275-.7t.275-.7q.275-.275.7-.275t.7.275l4.3 4.3 4.3-4.3q.275-.275.7-.275t.7.275q.275.275.275.7t-.275.7l-5 5q-.15.15-.325.213t-.375.062Z"/></svg>',
		up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.3 14.95q-.275-.275-.275-.7t.275-.7l5-5q.15-.15.325-.213t.375-.062q.2 0 .375.063t.325.212l5 5q.275.275.275.7t-.275.7q-.275.275-.7.275t-.7-.275L12 10.95l-4.3 4.3q-.275.275-.7.275t-.7-.3Z"/></svg>',
	};

	// ===== 小工具 =====

	function el(tag, className, html) {
		var node = document.createElement(tag);
		if (className) node.className = className;
		if (html != null) node.innerHTML = html;
		return node;
	}

	// 评论正文是用户输入（Waline 服务端已经过滤过一轮），前端再兜一层：
	// 脚本/内联框架/事件属性全部剃掉，外链一律新窗口打开。
	function sanitize(html) {
		var out = html || "";
		out = out.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
		out = out.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
		out = out.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");
		out = out.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "");
		out = out.replace(/<embed\b[^>]*>/gi, "");
		out = out.replace(/\s+on[a-z]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, "");
		out = out.replace(/href\s*=\s*(?:['"]javascript:[^'"]*['"]|javascript:[^\s>]+)/gi, 'href="#"');
		out = out.replace(/<a\b/gi, '<a target="_blank" rel="noopener noreferrer"');
		return out.trim();
	}

	function relativeTime(ms) {
		var diff = Date.now() - ms;
		if (diff < 0) diff = 0;
		var minute = 60000;
		var hour = 3600000;
		var day = 86400000;
		if (diff < minute) return "刚刚";
		if (diff < hour) return Math.floor(diff / minute) + "分钟前";
		if (diff < day) return Math.floor(diff / hour) + "小时前";
		if (diff < 30 * day) return Math.floor(diff / day) + "天前";
		if (diff < 365 * day) return Math.floor(diff / (30 * day)) + "个月前";
		return Math.floor(diff / (365 * day)) + "年前";
	}

	function absoluteTime(ms) {
		var d = new Date(ms);
		var pad = function (n) {
			return n < 10 ? "0" + n : String(n);
		};
		return (
			d.getFullYear() +
			"-" +
			pad(d.getMonth() + 1) +
			"-" +
			pad(d.getDate()) +
			" " +
			pad(d.getHours()) +
			":" +
			pad(d.getMinutes())
		);
	}

	// ===== 一、取数 =====

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

	function readCache() {
		try {
			var raw = JSON.parse(window.sessionStorage.getItem(CACHE_KEY) || "{}");
			return raw && typeof raw === "object" ? raw : {};
		} catch (error) {
			return {};
		}
	}

	function writeCache(path, entry) {
		try {
			var all = readCache();
			all[path] = entry;
			window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(all));
		} catch (error) {
			/* 隐私模式 / 配额满：不缓存也能跑 */
		}
	}

	// 作者名用来认「博主」—— 上游模板里就是 profileConfig.name，
	// 不想在脚本里再硬编码一份。
	function authorNameOf(host) {
		var entry = host.closest("dynamic-entry");
		var node = entry && entry.querySelector(".page-author strong");
		return node ? node.textContent.trim() : "";
	}

	function flatten(list, out, parentNick, author) {
		for (var i = 0; i < list.length; i++) {
			var c = list[i];
			if (!c) continue;
			var nick = (c.nick || "匿名访客").trim();
			var ms = Number(c.time || (c.createdAt ? new Date(c.createdAt).getTime() : Date.now()));
			out.push({
				id: String(c.objectId != null ? c.objectId : c.id || ""),
				nick: nick,
				avatar: c.avatar || "",
				link: c.link || "",
				html: sanitize(c.comment || c.orig || ""),
				time: ms,
				replyTo: parentNick || "",
				isAdmin:
					c.type === "administrator" ||
					c.user_id === 1 ||
					c.label === "站长" ||
					(!!author && nick === author),
			});
			if (Array.isArray(c.children) && c.children.length) {
				flatten(c.children, out, nick, author);
			}
		}
		return out;
	}

	var inflight = {};

	function fetchComments(path, author) {
		if (inflight[path]) return inflight[path];
		var url =
			WALINE +
			"/api/comment?path=" +
			encodeURIComponent(path) +
			"&pageSize=" +
			FETCH_LIMIT +
			"&page=1";
		inflight[path] = fetch(url)
			.then(function (res) {
				return res.json();
			})
			.then(function (json) {
				var payload = json && json.data;
				if (!payload || !Array.isArray(payload.data)) {
					throw new Error("bad payload");
				}
				var items = flatten(payload.data, [], "", author);
				var state = {
					count: Math.max(Number(payload.count) || 0, items.length),
					items: items,
				};
				writeCache(path, { t: Date.now(), count: state.count, items: items });
				delete inflight[path];
				return state;
			})
			.catch(function (error) {
				delete inflight[path];
				throw error;
			});
		return inflight[path];
	}

	// ===== 二、渲染 =====

	function actionButton(label, icon, className) {
		var btn = el("button", "dyn-cmt-action" + (className ? " " + className : ""), icon);
		btn.type = "button";
		btn.append(document.createTextNode(label));
		return btn;
	}

	// 图标放文字后面（箭头 / 箭头朝下的折叠这类，参考站都是「文字 → 图标」）
	function trailingButton(label, icon, className) {
		var btn = el("button", "dyn-cmt-action" + (className ? " " + className : ""));
		btn.type = "button";
		btn.append(document.createTextNode(label), el("span", "dyn-cmt-btn-icon", icon));
		return btn;
	}

	function renderLoading(host) {
		var box = host.querySelector("[data-dyn-box]");
		if (!box) return;
		box.className = "dyn-cmt-box dyn-cmt-loading";
		box.replaceChildren(el("span", "dyn-cmt-skeleton", "评论加载中…"));
	}

	function renderEmpty(host) {
		var box = host.querySelector("[data-dyn-box]");
		if (!box) return;
		box.className = "dyn-cmt-box";
		var bar = el("div", "dyn-cmt-empty");
		var hint = el("button", "dyn-cmt-hint", ICON.chat);
		hint.type = "button";
		var hintText = el("span", "dyn-cmt-hint-text");
		hintText.textContent = "暂无评论，来抢个沙发吧";
		hint.append(hintText);
		hint.addEventListener("click", function () {
			setPanel(host, true, true);
		});
		var write = actionButton("写评论", ICON.pen, "dyn-cmt-write");
		write.addEventListener("click", function () {
			setPanel(host, true, true);
		});
		bar.append(hint, write);
		box.replaceChildren(bar);
	}

	function buildRow(comment) {
		var row = el("div", "dyn-cmt-row");

		var avatar = el("img", "dyn-cmt-avatar");
		avatar.src = comment.avatar || FALLBACK_AVATAR;
		avatar.alt = comment.nick;
		avatar.loading = "lazy";
		avatar.decoding = "async";
		avatar.width = 28;
		avatar.height = 28;
		avatar.addEventListener("error", function () {
			avatar.src = FALLBACK_AVATAR;
		});

		var main = el("div", "dyn-cmt-main");
		var meta = el("div", "dyn-cmt-meta");

		var nick;
		if (comment.link) {
			nick = el("a", "dyn-cmt-nick");
			nick.href = comment.link;
			nick.target = "_blank";
			nick.rel = "noopener noreferrer";
		} else {
			nick = el("span", "dyn-cmt-nick");
		}
		nick.textContent = comment.nick;
		meta.append(nick);

		if (comment.isAdmin) {
			meta.append(el("span", "dyn-cmt-badge", "博主"));
		}
		if (comment.replyTo) {
			var reply = el("span", "dyn-cmt-replyto");
			reply.textContent = "回复 @" + comment.replyTo;
			meta.append(reply);
		}

		var time = el("time", "dyn-cmt-time");
		time.dateTime = new Date(comment.time).toISOString();
		time.title = absoluteTime(comment.time);
		time.textContent = relativeTime(comment.time);
		meta.append(time);

		var body = el("div", "dyn-cmt-body");
		body.innerHTML = comment.html;

		var more = el("button", "dyn-cmt-fold", "展开");
		more.type = "button";
		more.hidden = true;
		more.addEventListener("click", function () {
			var open = body.classList.toggle("is-open");
			more.textContent = open ? "收起" : "展开";
		});

		main.append(meta, body, more);
		row.append(avatar, main);

		// 量高度得等它进了文档，扔到下一帧
		window.requestAnimationFrame(function () {
			if (!body.isConnected) return;
			if (body.scrollHeight <= CLAMP_HEIGHT) return;
			body.classList.add("is-clamped");
			more.hidden = false;
		});

		return row;
	}

	function renderList(host, state) {
		var box = host.querySelector("[data-dyn-box]");
		if (!box) return;
		box.className = "dyn-cmt-box";

		var head = el("div", "dyn-cmt-head");
		var label = el("div", "dyn-cmt-label", ICON.chat);
		var strong = el("strong", "dyn-cmt-count");
		strong.textContent = String(state.count);
		label.append(strong, document.createTextNode(" 条评论"));

		var write = actionButton("写评论", ICON.pen, "dyn-cmt-write");
		write.addEventListener("click", function () {
			setPanel(host, true, true);
		});
		head.append(label, write);

		var list = el("div", "dyn-cmt-list");
		var shown = state.expanded
			? state.items.slice(0, FETCH_LIMIT)
			: state.items.slice(0, MAX_SHOWN);
		for (var i = 0; i < shown.length; i++) {
			list.append(buildRow(shown[i]));
		}

		var foot = el("div", "dyn-cmt-foot");
		var hiddenCount = state.items.length - MAX_SHOWN;
		if (hiddenCount > 0) {
			var fold = trailingButton(
				state.expanded ? "收起评论" : "展开更多评论 (" + hiddenCount + ")",
				state.expanded ? ICON.up : ICON.down,
				"dyn-cmt-more",
			);
			fold.addEventListener("click", function () {
				state.expanded = !state.expanded;
				renderList(host, state);
			});
			foot.append(fold);
		} else {
			foot.append(el("span", "dyn-cmt-foot-hint", ""));
		}

		var open = trailingButton("打开完整评论区", ICON.arrow, "dyn-cmt-open");
		open.addEventListener("click", function () {
			setPanel(host, true, false);
		});
		foot.append(open);

		box.replaceChildren(head, list, foot);
	}

	// ===== 三、开合 iframe 面板（上游自己的那个） =====

	function setPanel(host, open, focus) {
		var panel = host.querySelector("[data-comment-panel]");
		var toggle = host.querySelector("[data-comment-toggle]");
		if (!panel || !toggle) return;
		var isOpen = !panel.hidden;
		if (open && !isOpen) {
			toggle.click(); // 走上游自己的开合逻辑，不自己造 iframe
			panel = host.querySelector("[data-comment-panel]");
		} else if (!open && isOpen) {
			toggle.click();
		}
		host.dataset.dynOpen = open ? "1" : "0";
		ensureCollapse(host, open);
		if (!open) return;
		if (focus) focusFrame(host);
		panel.scrollIntoView({ behavior: "smooth", block: "center" });
	}

	// 收起入口：空态那会儿没有底部栏，光靠「写评论」打开就出不去了，
	// 所以统一在面板下面挂一个。
	function ensureCollapse(host, show) {
		var existing = host.querySelector("[data-dyn-collapse]");
		if (!show) {
			if (existing) existing.remove();
			return;
		}
		if (existing) return;
		var wrap = el("div", "dyn-cmt-collapse-wrap");
		wrap.setAttribute("data-dyn-collapse", "");
		var btn = trailingButton("收起评论区", ICON.up, "dyn-cmt-collapse");
		btn.addEventListener("click", function () {
			setPanel(host, false, false);
		});
		wrap.append(btn);
		host.append(wrap);
	}

	function focusFrame(host) {
		var frame = host.querySelector("iframe." + FRAME_CLASS);
		if (!frame) return; // 还没创建：inject 时会看 data-ff-focus 补上
		frame.dataset.ffFocus = "1";
		var doc = frame.contentDocument;
		if (!doc) return;
		focusEditor(doc, 0);
	}

	function focusEditor(doc, attempt) {
		// iframe 刚建时 document 还是 about:blank，这时候怎么轮询都白搭 ——
		// 真正的注入由 inject() 负责，那时会再看一眼 data-ff-focus。
		if (!doc || doc.location.href === "about:blank") return;
		var field = doc.querySelector("#waline .wl-editor");
		if (field) {
			try {
				field.focus();
				field.scrollIntoView({ block: "center" });
			} catch (error) {
				/* 忽略 */
			}
			return;
		}
		if (attempt < 25) {
			window.setTimeout(function () {
				focusEditor(doc, attempt + 1);
			}, 200);
		}
	}

	// ===== 四、往 iframe 里投样式与脚本（逻辑与旧版一致） =====

	var IFRAME_CSS =
		"#waline .wl-comment.ff-compact .wl-header," +
		"#waline .wl-comment.ff-compact .wl-footer{display:none!important}" +
		"#waline .wl-comment.ff-compact .wl-editor{min-height:2.5rem!important;height:2.5rem!important}" +
		"#waline .wl-comment.ff-compact .wl-editor{transition:height 160ms ease}" +
		"#post-comments > .relative.z-10.mb-6{display:none!important}";

	var COMPACT_CLASS = "ff-compact";

	function compactEditor(doc, attempt) {
		var editor = doc.querySelector("#waline .wl-comment");
		if (!editor) {
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

	function inject(frame) {
		var doc;
		try {
			doc = frame.contentDocument;
		} catch (error) {
			return;
		}
		if (!doc || !doc.head || !doc.body) return;
		if (doc.documentElement.dataset[MARK] === "1") return;
		doc.documentElement.dataset[MARK] = "1";

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

		if (frame.dataset.ffFocus === "1") focusEditor(doc, 0);
	}

	function isCommentDoc(frame) {
		try {
			return frame.contentWindow.location.pathname.indexOf(PATH_PREFIX) === 0;
		} catch (error) {
			return false;
		}
	}

	function watchFrame(frame, deadline) {
		if (!frame.isConnected) return;
		var doc = frame.contentDocument;
		if (
			doc &&
			doc.readyState === "complete" &&
			doc.head &&
			doc.body &&
			isCommentDoc(frame)
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

	// ===== 五、装配 =====

	var observer =
		typeof IntersectionObserver === "function"
			? new IntersectionObserver(
					function (entries) {
						for (var i = 0; i < entries.length; i++) {
							if (!entries[i].isIntersecting) continue;
							observer.unobserve(entries[i].target);
							load(entries[i].target);
						}
					},
					{ rootMargin: "300px 0px" },
				)
			: null;

	function prepare(host) {
		if (host.dataset.dynReady === "1") return;
		var path = pathOf(host);
		if (!path) {
			// 上游模板里 data-src 是空的，由 Feed 克隆时写进去；偶尔会晚一拍
			var tries = Number(host.dataset.dynRetry || 0);
			if (tries < 12) {
				host.dataset.dynRetry = String(tries + 1);
				window.setTimeout(function () {
					prepare(host);
				}, 300);
			}
			return;
		}
		host.dataset.dynReady = "1";
		host.dataset.dynPath = path;
		host.dataset.dynPreview = "1";
		host._ffComments = { count: 0, items: [], expanded: false };

		var box = el("div", "dyn-cmt-box dyn-cmt-loading");
		box.setAttribute("data-dyn-box", "");
		box.append(el("span", "dyn-cmt-skeleton", "评论加载中…"));
		var toggle = host.querySelector("[data-comment-toggle]");
		if (toggle) host.insertBefore(box, toggle);
		else host.append(box);

		if (observer) observer.observe(host);
		else load(host);
	}

	function load(host) {
		if (host.dataset.dynLoaded === "1") return;
		host.dataset.dynLoaded = "1";
		var path = host.dataset.dynPath;
		if (!path) return;

		var cached = readCache()[path];
		if (cached && Date.now() - Number(cached.t || 0) < CACHE_TTL) {
			apply(host, cached);
			return;
		}

		fetchComments(path, authorNameOf(host))
			.then(function (state) {
				apply(host, state);
			})
			.catch(function () {
				// 后端挂了就退回上游那个折叠按钮：不显示预览，功能不丢
				delete host.dataset.dynPreview;
				var box = host.querySelector("[data-dyn-box]");
				if (box) box.remove();
				host.dataset.dynReady = "";
			});
	}

	function apply(host, state) {
		host._ffComments.count = state.count;
		host._ffComments.items = state.items || [];
		if (!host._ffComments.items.length) {
			renderEmpty(host);
			return;
		}
		renderList(host, host._ffComments);
	}

	function scan(node) {
		if (!node || node.nodeType !== 1) return;
		if (isFrame(node)) {
			handleFrame(node);
			return;
		}
		if (!node.querySelectorAll) return;
		var hosts = node.querySelectorAll("dynamic-inline-comments");
		for (var i = 0; i < hosts.length; i++) prepare(hosts[i]);
		var frames = node.querySelectorAll("iframe." + FRAME_CLASS);
		for (var j = 0; j < frames.length; j++) handleFrame(frames[j]);
		if (node.tagName === "DYNAMIC-INLINE-COMMENTS") prepare(node);
	}

	new MutationObserver(function (records) {
		for (var i = 0; i < records.length; i++) {
			var added = records[i].addedNodes;
			for (var j = 0; j < added.length; j++) scan(added[j]);
		}
	}).observe(document.body, { childList: true, subtree: true });

	// 兜底：swup 切进 /dynamic/ 时脚本可能比列表晚到
	scan(document.body);
})();
