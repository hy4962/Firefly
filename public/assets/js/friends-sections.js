/**
 * 友链页分区：按标签把友链卡片拆成多个带标题的区块，结构对齐书签导航页。
 *
 * 背景：/friends/ 原来是一个大网格全铺开，友链社区、博客聚合站和个人博客
 * 混在一起，看着不像一类东西；分类也只在上面的标签筛选里选得出来，视觉上
 * 完全没体现。friends.astro 是上游文件不能改，所以走「客户端增强」：
 * 卡片本身带 data-tags 属性，按标签重排成 <section> + 标题 + 独立网格。
 *
 * 为什么是重排而不是重建卡片：卡片是主题渲染的，悬停展开、筛选、淡入动画
 * 都挂在它身上，搬 DOM 就行，一行属��都不用改。
 *
 * 两个关键点：
 *   1. 所有区块必须留在页面那张 .card-base 里面 —— 主题的 friend-filter 组件是
 *      `container = this.closest(".card-base")` 再 `querySelectorAll(".friend-card")`，
 *      搬出去的话点标签 / 搜名字就筛不到了；
 *   2. 区块显隐要跟着筛选结果走，否则切到「博客社区」时上面会留一个
 *      只有标题、没有卡片的空壳。用 MutationObserver 盯着 inline style 变化。
 */
(function () {
	"use strict";

	/**
	 * 分区定义，顺序即页面上的顺序；tag 对应卡片 data-tags 里的值。
	 * 新增分区改这里就行，不用动主题文件。
	 */
	var GROUPS = [
		{ tag: "Blog", title: "个人博客", desc: "订阅了 RSS 的朋友们" },
		{ tag: "博客社区", title: "博客社区", desc: "友链社区与博客聚合站，跟上面的不是一类东西" },
	];

	/** 兜底：没归到上面任何分区的卡片（配置里新加了标签也不会丢） */
	var FALLBACK = { tag: "", title: "其他", desc: "" };

	var CSS_URL = "/assets/css/friends-sections.css";
	var FRIENDS_PATH = /^\/friends\/?$/;

	var cssInjected = false;
	var observer = null;

	var injectCss = function () {
		if (cssInjected) return;
		cssInjected = true;
		var link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = CSS_URL;
		document.head.appendChild(link);
	};

	var tagsOf = function (card) {
		return (card.getAttribute("data-tags") || "")
			.split(",")
			.map(function (t) {
				return t.trim();
			})
			.filter(Boolean);
	};

	var el = function (tag, className, text) {
		var node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	};

	var buildSection = function (def, cards) {
		var section = el("section", "friends-group");
		section.setAttribute("data-friends-group", def.tag || "other");

		var heading = el("div", "friends-group__heading");

		var main = el("div", "friends-group__main");
		main.appendChild(el("h2", "friends-group__title", def.title));
		if (def.desc) main.appendChild(el("span", "friends-group__desc", def.desc));
		heading.appendChild(main);
		heading.appendChild(el("span", "friends-group__count", cards.length + " 个"));

		var grid = el("div", "friends-grid friends-grid--group");

		section.appendChild(heading);
		section.appendChild(grid);
		cards.forEach(function (card) {
			grid.appendChild(card);
		});

		return section;
	};

	/**
	 * 主题的筛选靠 inline style 的 display 开关卡片，这里跟着它同步各区块显隐。
	 * 只在值真的变了时才写 hidden —— 无条件写会自己触发自己身上的 MutationObserver，
	 * 形成回环。用 setTimeout 而不是 rAF 做节流：无头环境下 rAF 不一定被调度。
	 */
	var syncVisibility = function (sections) {
		sections.forEach(function (section) {
			var visible = Array.prototype.some.call(
				section.querySelectorAll(".friend-card"),
				function (card) {
					return card.style.display !== "none";
				},
			);
			if (section.hidden === visible) section.hidden = !visible;
		});
	};

	var enhance = function () {
		if (!FRIENDS_PATH.test(window.location.pathname)) return;

		var mainGrid = document.querySelector(".friends-grid");
		if (!mainGrid) return;

		var container = mainGrid.closest(".card-base") || mainGrid.parentNode;
		// 幂等：swup 回到本页时 DOM 是新的，但同一次加载里可能重复调用
		if (container.dataset.ffSectionsDone === "1") return;

		var all = Array.prototype.slice.call(mainGrid.querySelectorAll(".friend-card"));
		if (all.length === 0) return;

		injectCss();
		container.dataset.ffSectionsDone = "1";

		// 按 GROUPS 顺序分桶；一张卡命中多个分区时只进第一个（首个匹配即 return），避免重复出现
		var buckets = GROUPS.map(function (def) {
			return { def: def, cards: [] };
		});
		var taken = new Set();
		all.forEach(function (card) {
			var tags = tagsOf(card);
			for (var i = 0; i < buckets.length; i++) {
				if (tags.indexOf(buckets[i].def.tag) === -1) continue;
				buckets[i].cards.push(card);
				taken.add(card);
				return;
			}
		});
		var rest = all.filter(function (card) {
			return !taken.has(card);
		});
		if (rest.length) buckets.push({ def: FALLBACK, cards: rest });

		var sections = buckets
			.filter(function (b) {
				return b.cards.length > 0;
			})
			.map(function (b) {
				return buildSection(b.def, b.cards);
			});

		sections.forEach(function (section) {
			container.insertBefore(section, mainGrid);
		});
		// 卡片全搬走了，原网格只剩一个带 my-4 的空壳，直接移除
		if (mainGrid.parentNode) mainGrid.parentNode.removeChild(mainGrid);

		syncVisibility(sections);

		if (observer) observer.disconnect();
		var pending = false;
		observer = new MutationObserver(function () {
			if (pending) return;
			pending = true;
			setTimeout(function () {
				pending = false;
				syncVisibility(sections);
			}, 0);
		});
		observer.observe(container, {
			subtree: true,
			attributes: true,
			attributeFilter: ["style", "class", "hidden"],
		});
	};

	var boot = function () {
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
