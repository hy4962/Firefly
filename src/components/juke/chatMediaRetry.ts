import { getContext, onDestroy, setContext } from "svelte";

const key = Symbol("chat media retry");
type ReportFailure = (retry: () => void) => () => void;

export function provideChatMediaRetry(report: ReportFailure): void {
	setContext(key, report);
}

export function useChatMediaRetry(retry: () => void): {
	isInMessage: boolean;
	fail: () => void;
	clear: () => void;
} {
	const report = getContext<ReportFailure | undefined>(key);
	let unregister: (() => void) | undefined;

	function clear() {
		unregister?.();
		unregister = undefined;
	}

	onDestroy(clear);

	return {
		isInMessage: Boolean(report),
		fail: () => {
			unregister ??= report?.(() => {
				clear();
				retry();
			});
		},
		clear,
	};
}
