export interface VirtualWindow<T> {
	items: T[];
	start: number;
	topSpacerPx: number;
	bottomSpacerPx: number;
}

/**
 * Keeps a virtual window object (and its sliced item array) stable while the
 * list reference and window signature are unchanged. Scroll handlers can then
 * update their raw scrollTop every frame without invalidating every mounted
 * row in Svelte.
 */
export function createVirtualWindowMemo<T>() {
	let cachedList: readonly T[] | null = null;
	let cachedSignature = "";
	let cachedWindow: VirtualWindow<T> | null = null;

	return (
		list: readonly T[],
		signature: string,
		build: () => VirtualWindow<T>,
	): VirtualWindow<T> => {
		if (cachedWindow && cachedList === list && cachedSignature === signature) {
			return cachedWindow;
		}
		const next = build();
		cachedList = list;
		cachedSignature = signature;
		cachedWindow = next;
		return next;
	};
}
