export type GuestbookAnnouncementItem = {
	id: string;
	title: string;
	summary: string;
	lead?: string;
	rules: string[];
};

export type GuestbookConfig = {
	announcements: GuestbookAnnouncementItem[];
};
