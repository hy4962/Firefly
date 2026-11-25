import type { ChatMentionEntity } from "./chatTypes";

export interface ChatDraft {
	content: string;
	mentionEntities: ChatMentionEntity[];
}

export function mentionRanges(
	content: string,
	entities: readonly ChatMentionEntity[] = [],
): ChatMentionEntity[] {
	let end = 0;
	return [...entities]
		.filter(
			(entity) =>
				entity &&
				Number.isSafeInteger(entity.offset) &&
				Number.isSafeInteger(entity.length) &&
				entity.offset >= 0 &&
				entity.length > 0 &&
				entity.offset + entity.length <= content.length &&
				typeof entity.userKey === "string" &&
				entity.userKey.length > 0,
		)
		.sort((a, b) => a.offset - b.offset)
		.filter((entity) => {
			if (entity.offset < end) return false;
			end = entity.offset + entity.length;
			return true;
		});
}

export function normalizeMentionSpacing(
	content: string,
	entities: readonly ChatMentionEntity[] = [],
): ChatDraft {
	if (!entities?.length) {
		return { content: (content || "").trim(), mentionEntities: [] };
	}
	const sorted = [...entities]
		.filter(
			(e) =>
				e &&
				Number.isSafeInteger(e.offset) &&
				Number.isSafeInteger(e.length) &&
				e.length > 0 &&
				e.offset >= 0 &&
				e.offset + e.length <= (content || "").length,
		)
		.sort((a, b) => a.offset - b.offset);

	let result = "";
	let cursor = 0;
	const newEntities: ChatMentionEntity[] = [];

	for (let i = 0; i < sorted.length; i++) {
		const entity = sorted[i];
		const segBefore = content.slice(cursor, entity.offset);

		if (i === 0) {
			const trimmed = segBefore.replace(/^[ \t]+/, "");
			result += trimmed.replace(/[ \t]+$/, "");
			if (result.length > 0 && !/\n$/.test(result)) {
				result += " ";
			}
		} else {
			if (!segBefore.trim()) {
				const hasNewline = segBefore.includes("\n");
				if (hasNewline) {
					result = `${result.replace(/[ \t]+$/, "")}\n`;
				} else {
					result = `${result.replace(/[ \t]+$/, "")} `;
				}
			} else {
				const middle = segBefore.trim();
				result = `${result.replace(/[ \t]+$/, "")} ${middle} `;
			}
		}

		const newOffset = result.length;
		const label = content.slice(entity.offset, entity.offset + entity.length);
		result += label;
		newEntities.push({
			offset: newOffset,
			length: label.length,
			userKey: entity.userKey,
		});
		cursor = entity.offset + entity.length;
	}

	const segAfter = content.slice(cursor);
	if (!segAfter.trim()) {
		result = result.replace(/[ \t]+$/, "");
	} else {
		const trail = segAfter.trimEnd();
		const hasNewline = /^[ \t]*\r?\n/.test(trail);
		if (hasNewline) {
			result = `${result.replace(/[ \t]+$/, "")}\n${trail.replace(/^[ \t]*\r?\n[ \t]*/, "")}`;
		} else {
			result = `${result.replace(/[ \t]+$/, "")} ${trail.replace(/^[ \t]+/, "")}`;
		}
	}

	return { content: result, mentionEntities: newEntities };
}

export function trimChatDraft(draft: ChatDraft): ChatDraft {
	const left = draft.content.length - draft.content.trimStart().length;
	const content = draft.content.trim();
	const mentionEntities = mentionRanges(
		content,
		draft.mentionEntities.map((entity) => ({
			...entity,
			offset: entity.offset - left,
		})),
	);
	return normalizeMentionSpacing(content, mentionEntities);
}

export function readChatComposer(container: HTMLElement): ChatDraft {
	let content = "";
	const mentionEntities: ChatMentionEntity[] = [];
	function walk(node: Node) {
		if (node.nodeType === Node.TEXT_NODE) {
			content += (node.nodeValue || "").replace(/\u00a0/g, " ");
		} else if (node instanceof HTMLElement) {
			if (
				node.classList.contains("chat-mention-pill") &&
				node.dataset.userKey
			) {
				const text = node.textContent || "";
				mentionEntities.push({
					offset: content.length,
					length: text.length,
					userKey: node.dataset.userKey,
				});
				content += text;
			} else if (node.tagName === "BR") {
				content += "\n";
			} else {
				for (const child of node.childNodes) walk(child);
				if (
					node !== container &&
					node.nextSibling &&
					["DIV", "P"].includes(node.tagName)
				) {
					content += "\n";
				}
			}
		}
	}
	walk(container);
	return { content, mentionEntities };
}

function createPill(text: string, userKey: string): HTMLElement {
	const pill = document.createElement("span");
	pill.contentEditable = "false";
	pill.className = "chat-mention-pill";
	pill.dataset.userKey = userKey;
	pill.textContent = text;
	return pill;
}

export function writeChatComposer(
	container: HTMLElement,
	draft: ChatDraft,
): void {
	const fragment = document.createDocumentFragment();
	let end = 0;
	for (const entity of mentionRanges(draft.content, draft.mentionEntities)) {
		fragment.append(draft.content.slice(end, entity.offset));
		end = entity.offset + entity.length;
		fragment.append(
			createPill(draft.content.slice(entity.offset, end), entity.userKey),
		);
	}
	fragment.append(draft.content.slice(end));
	container.replaceChildren(fragment);
}

export function getChatMentionQuery(
	container: HTMLElement | null,
): { query: string; range: Range } | null {
	const selection = window.getSelection();
	if (!container || !selection?.isCollapsed || !selection.rangeCount)
		return null;
	const range = selection.getRangeAt(0);
	const node = range.startContainer;
	if (node.nodeType !== Node.TEXT_NODE || !container.contains(node))
		return null;
	if (node.parentElement?.closest(".chat-mention-pill")) return null;
	const beforeCaret = (node.nodeValue || "").slice(0, range.startOffset);
	const start = beforeCaret.lastIndexOf("@");
	if (start < 0) return null;
	const query = beforeCaret.slice(start + 1);
	if (query.includes("\n") || query.length > 96) return null;
	const replacement = range.cloneRange();
	replacement.setStart(node, start);
	return { query, range: replacement };
}

export function insertChatMention(
	container: HTMLElement,
	label: string,
	userKey: string,
	replacement?: Range,
): void {
	container.focus({ preventScroll: true });
	const selection = window.getSelection();
	const range =
		replacement || (selection?.rangeCount ? selection.getRangeAt(0) : null);
	const pill = createPill(`@${label}`, userKey);

	let needsLeadingSpace = false;
	if (range && container.contains(range.commonAncestorContainer)) {
		const sc = range.startContainer;
		const so = range.startOffset;
		if (sc.nodeType === Node.TEXT_NODE) {
			const text = sc.nodeValue || "";
			if (so > 0 && !/[\s]/.test(text[so - 1])) {
				needsLeadingSpace = true;
			}
		}
		range.deleteContents();
		if (needsLeadingSpace) {
			const spaceNode = document.createTextNode(" ");
			range.insertNode(spaceNode);
			range.setStartAfter(spaceNode);
			range.collapse(true);
		}
		range.insertNode(pill);
	} else {
		const last = container.lastChild;
		if (last?.nodeType === Node.TEXT_NODE) {
			const text = last.nodeValue || "";
			if (text.length > 0 && !/[\s]/.test(text[text.length - 1])) {
				container.append(document.createTextNode(" "));
			}
		}
		container.append(pill);
	}

	let caret: Text;
	const nextSibling = pill.nextSibling;
	if (
		nextSibling &&
		nextSibling.nodeType === Node.TEXT_NODE &&
		nextSibling.nodeValue?.startsWith(" ")
	) {
		caret = nextSibling as Text;
	} else {
		caret = document.createTextNode(" ");
		pill.after(caret);
	}
	const next = document.createRange();
	next.setStart(caret, 1);
	next.collapse(true);
	selection?.removeAllRanges();
	selection?.addRange(next);
}

export function deleteChatMentionBeforeCaret(
	container: HTMLElement | null,
): boolean {
	const selection = window.getSelection();
	if (!container || !selection?.isCollapsed || !selection.rangeCount)
		return false;
	const { startContainer, startOffset } = selection.getRangeAt(0);
	if (!container.contains(startContainer)) return false;
	let previous: Node | null | undefined;
	if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 0) {
		previous = startContainer.previousSibling;
	} else if (startContainer.nodeType === Node.ELEMENT_NODE) {
		previous = startContainer.childNodes[startOffset - 1];
		if (previous?.nodeType === Node.TEXT_NODE && !previous.nodeValue) {
			previous = previous.previousSibling;
		}
	}
	if (
		!(previous instanceof HTMLElement) ||
		!previous.classList.contains("chat-mention-pill")
	) {
		return false;
	}
	previous.remove();
	return true;
}
