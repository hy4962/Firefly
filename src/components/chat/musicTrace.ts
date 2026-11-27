import { get, type Readable, writable } from "svelte/store";
import type { CurrentPlayback } from "./chatTypes";
import type { PlaybackAudioSource, PlaybackSelection } from "./musicTypes";
import type { LocalAudioDiagnostic } from "./roomAudioPlayer";

export interface PlaybackDiagnostic {
	uid: string;
	revision: number;
	room: string;
	roomConnected: boolean;
	title: string;
	artist: string;
	album?: string;
	provider?: string;
	rotation: boolean;
	selection?: PlaybackSelection;
	legacyOriginal?: { title: string; artist: string };
	source?: PlaybackAudioSource;
	local: LocalAudioDiagnostic | null;
}

const playbackDiagnostic = writable<PlaybackDiagnostic | null>(null);
export const currentPlaybackDiagnostic: Readable<PlaybackDiagnostic | null> = {
	subscribe: playbackDiagnostic.subscribe,
};

export function updatePlaybackDiagnostic(
	play: CurrentPlayback | null,
	local: LocalAudioDiagnostic | null,
	room: string,
	roomConnected: boolean,
): void {
	if (!play) {
		playbackDiagnostic.set(null);
		return;
	}
	const { track } = play;
	const revision = play.sourceRevision ?? 0;
	const selection = track.playbackSelection;
	const source = track.audioSource;
	const snapshot: PlaybackDiagnostic = {
		uid: play.uid,
		revision,
		room,
		roomConnected,
		title: track.title,
		artist: track.artist,
		album: track.album,
		provider: track.provider,
		rotation: play.isFallback,
		selection: selection && {
			mode: selection.mode,
			original: {
				title: selection.original.title,
				artist: selection.original.artist,
				platform: selection.original.platform,
			},
		},
		legacyOriginal: track.rotationReplacement && {
			title: track.rotationReplacement.title,
			artist: track.rotationReplacement.artist,
		},
		source: source && {
			checked: source.checked,
			channel: source.channel,
			mimeType: source.mimeType,
		},
		local:
			local?.uid === play.uid && local.revision === revision
				? {
						uid: local.uid,
						revision: local.revision,
						status: local.status,
						transport: local.transport,
					}
				: null,
	};
	if (JSON.stringify(get(playbackDiagnostic)) !== JSON.stringify(snapshot))
		playbackDiagnostic.set(snapshot);
}

type Detail = Record<string, string | number | boolean>;
const events: ({ at: number; event: string; uid: string } & Detail)[] = [];
export function recordMusicEvent(
	event: string,
	uid = "",
	detail: Detail = {},
): void {
	if (events.length >= 512) events.shift();
	events.push({
		at: Math.round(performance.timeOrigin + performance.now()),
		event,
		uid,
		...detail,
	});
}
export function downloadMusicTrace(): void {
	const data = JSON.stringify(
		{
			version: 2,
			browser: navigator.userAgent,
			currentPlayback: get(playbackDiagnostic),
			events,
		},
		null,
		2,
	);
	const url = URL.createObjectURL(
		new Blob([data], { type: "application/json" }),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = `chat-music-${Date.now()}.json`;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 60000);
}
