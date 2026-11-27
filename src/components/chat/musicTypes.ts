export interface ChatMusicTrack {
	id: string;
	provider?: string;
	sourceId?: string;
	sourcePlatform?: string;
	playlistId?: string;
	position?: number;
	title: string;
	artist: string;
	album?: string;
	url?: string;
	streamUrl?: string;
	proxyUrl?: string;
	directUrl?: string;
	cover: string;
	lrc?: string;
	lrcUrl?: string;
	durationSec?: number;
	quality?: string;
	rotationReplacement?: { title: string; artist: string };
	playbackSelection?: PlaybackSelection;
	audioSource?: PlaybackAudioSource;
	sourcePlaylistTitle?: string;
	sourcePlaylistId?: string;
	sourcePlaylistCover?: string;
}
export interface PlaybackSelection {
	mode:
		| "original"
		| "same-version"
		| "automatic-alternative"
		| "manual-choice"
		| "saved-choice";
	original: { title: string; artist: string; platform: string };
}

export interface PlaybackAudioSource {
	checked: boolean;
	channel: string;
	mimeType: string;
}
