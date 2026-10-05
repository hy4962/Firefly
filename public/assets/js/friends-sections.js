/**
 * 友链页分区：把「博客社区」这类的友链从主网格里挪到下方独立一栏。
 *
 * 背景：/friends/ 的卡片由主题的 friends.astro 渲染（上游文件，不能改），
 * 友链社区 / 博客聚合站和个人博客混在一张网格里，看着不像一类东西。
 * 所以走「客户端增强」：卡片本身有 data-tags 属性，按标签把社区卡片搬到
 * 页面下方一个新开的分区里。
 *
 * 两个关键点：
 *   1. 新分区必须留在页面那张 .card-base 里面 —— 主题的筛选组件是
 *      `container.querySelectorAll(".friend-card")`，container = 最近的 .card-base，
 *      搬出去的话点标签 / 搜名字就筛不到社区卡片了；
 *   2. 卡片上只改 DOM 位置，不改任何属性，主题的悬停、筛选、动画都不受影响。
 *
 * 分区是否显示跟着筛选结果走：切到「Blog」时社区那栏要收起来，
 * 否则会留一个只有标题没有卡片的空壳。
 */
(function () {
	"use strict";

	/** 归到独立分区的标签名。标题直接用这个字符串，改一处就行。 */
	var COMMUNITY_TAG = "博客社区";
	var COMMUNITY_DESC = "友链社区和博客聚合站，跟上面的个人博客不是一类东西，单独放一栏";

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

	var isCommunity = function (card) {
		var tags = (card.getAttribute("data-tags") || "").split(",");
		return tags.indexOf(COMMUITY_TAG) !== -1;
	};

	var buildSection = function (mainGrid, communityCards) {
		var section = document.createElement("section");
		section.className = "friends-community";

		var head = document.createElement("div");
		head.className = "friends-community__head";

		var title = document.createElement("span");
		title.className = "friends-community__title";
		title.textContent = COMMUNITY_TAG;

		var desc = document.createElement("span");
		desc.className = "friends-community__desc";
		desc.textContent = COMMUNITY_DESC;

		head.appendChild(title);
		head.appendChild(desc);

		var grid = document.createElement("div");
		grid.className = "friends-grid friends-grid--community";

		section.appendChild(head);
		section.appendChild(grid);

		// 插在主网格之后、评论区之前
		if (mainGrid.parentNode) {
			mainGrid.parentNode.insertBefore(section, mainGrid.nextSibling);
		}
		communityCards.forEach(function (card) {
			grid.appendChild(card);
		});

		return section;
	};

	/** 主题的筛选靠 inline style 的 display 开关卡片，这里跟着它同步两个区块的显隐 */
	var syncVisibility = function (mainGrid, section, communityGrid) {
		var anyIn = function (root) {
			return Array.prototype.some.call(
				root.querySelectorAll(".friend-card"),
				function (card) {
					return card.style.display !== "none";
				},
			);
		};
		section.hidden = !anyIn(communityGrid);
		mainGrid.hidden = !anyIn(mainGrid);
	};

	var enhance = function () {
		if (!FRIENDS_PATH.test(window.location.pathname)) return;

		var mainGrid = document.querySelector(".friends-grid");
		if (!mainGrid) return;
		// 已经分过区（swup 回到本页时 DOM 是新的，但同一次加载里可能重复调用）
		if (mainGrid.dataset.ffSectionsDone === "1") return;

		var all = Array.prototype.slice.call(mainGrid.querySelectorAll(".friend-card"));
		var communityCards = all.filter(isCommunity);
		if (communityCards.length === 0) return;

		injectCss();
		mainGrid.dataset.ffSectionsDone = "1";

		var section = buildSection(mainGrid, communityCards);
		var communityGrid = section.querySelector(".friends-grid");

		syncVisibility(mainGrid, section, communityGrid);

		if (observer) observer.disconnect();
		observer = new MutationObserver(function () {
			window.requestAnimationFrame(function () {
				syncVisibility(mainGrid, section, communityGrid);
			});
		});
		observer.observe(mainGrid.parentNode, {
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
