import { cubicIn } from "svelte/easing";
import { fade, fly, type TransitionConfig } from "svelte/transition";

function exitDuration(node: Element): number {
	if (node.closest("dialog:not([open])")) return 0;
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;
	return 180;
}

export function fadeChatSheetBackdrop(node: Element): TransitionConfig {
	return fade(node, { duration: exitDuration(node) });
}

export function slideChatSheetOut(node: Element): TransitionConfig {
	const mobile = window.matchMedia("(width < 768px)").matches;
	return fly(node, {
		duration: mobile ? exitDuration(node) : 0,
		y: mobile ? node.getBoundingClientRect().height : 0,
		opacity: 1,
		easing: cubicIn,
	});
}

export function closeChatActionSheet(node: Element): TransitionConfig {
	return fly(node, {
		duration: exitDuration(node),
		y: 28,
		opacity: 0,
		easing: cubicIn,
	});
}
