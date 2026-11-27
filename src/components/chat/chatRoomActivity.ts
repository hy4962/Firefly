import type { ChatMessageRecord } from "./chatTypes";

interface RecallNotice {
	actorName: string;
	targetName?: string;
}

export function parseRecallNotice(content: string): RecallNotice | null {
	const match = content
		.trim()
		.match(/^(.+?)\s+撤回了(?:一条消息|\s+(.+?)\s+的一条消息)$/);
	if (!match) return null;
	return { actorName: match[1].trim(), targetName: match[2]?.trim() };
}

export function isRoomActivity(message: ChatMessageRecord): boolean {
	return (
		message.kind === "system" &&
		(message.source === "matrix" ||
			Boolean(message.recalledMsgUid) ||
			Boolean(parseRecallNotice(message.content)))
	);
}

const activityActions: ReadonlyArray<readonly [RegExp, string]> = [
	[/^加入了房间$/, "加入了房间"],
	[/^离开了房间(?:（|$)/, "离开了房间"],
	[/^邀请 .+ 加入房间(?:（|$)/, "发出了入群邀请"],
	[/^申请加入房间(?:（|$)/, "申请加入房间"],
	[/^撤回了加入申请(?:（|$)/, "撤回了入群申请"],
	[/^拒绝了 .+ 的加入申请(?:（|$)/, "拒绝了入群申请"],
	[/^拒绝了邀请(?:（|$)/, "拒绝了邀请"],
	[/^撤销了对 .+ 的邀请(?:（|$)/, "撤销了入群邀请"],
	[/^将 .+ 移出了房间(?:（|$)/, "移出了成员"],
	[/^封禁了 /, "封禁了成员"],
	[/^解除了对 .+ 的封禁(?:（|$)/, "解封了成员"],
	[/^更换了头像$/, "更换了头像"],
	[/^移除了头像$/, "移除了头像"],
	[
		/^(?:将昵称改为「.+」|移除了昵称)，(?:更换|移除)了头像$/,
		"更新了昵称和头像",
	],
	[/^将昵称改为「/, "更换了昵称"],
	[/^移除了昵称$/, "移除了昵称"],
	[/^的房间成员资料已更新$/, "更新了成员资料"],
	[/^将房间名称改为「/, "修改了房间名称"],
	[/^移除了房间名称$/, "移除了房间名称"],
	[/^将房间主题改为「/, "修改了房间主题"],
	[/^移除了房间主题$/, "移除了房间主题"],
	[/^更换了房间头像$/, "更换了房间头像"],
	[/^移除了房间头像$/, "移除了房间头像"],
	[/^更新了房间地址/, "更新了房间地址"],
	[/^移除了房间地址$/, "移除了房间地址"],
	[/^修改了房间加入规则/, "修改了加入规则"],
	[/^修改了历史消息可见范围/, "修改了历史可见范围"],
	[/^允许访客加入房间$/, "允许访客加入房间"],
	[/^禁止访客加入房间$/, "禁止访客加入房间"],
	[/^修改了房间权限/, "修改了房间权限"],
	[/^置顶了 \d+ 条消息，取消置顶了 /, "调整了置顶消息"],
	[/^置顶了 \d+ 条消息$/, "置顶了消息"],
	[/^取消置顶了 \d+ 条消息$/, "取消置顶了消息"],
	[/^清空了置顶消息$/, "清空了置顶消息"],
	[/^发出了外部邀请$/, "发出了外部邀请"],
	[/^撤销了外部邀请$/, "撤销了外部邀请"],
	[/^创建了房间$/, "创建了房间"],
	[/^启用了房间加密$/, "启用了房间加密"],
	[/^已将房间迁移到新房间$/, "迁移了房间"],
	[/^发起了通话$/, "发起了通话"],
];

export function parseRoomActivityActor(
	content: string,
	storedName?: string,
): { name: string; detail: string; action: string } | null {
	const parseAt = (offset: number) => {
		const name = content.slice(0, offset);
		const detail = content.slice(offset).trimStart();
		const rule = activityActions.find(([pattern]) => pattern.test(detail));
		return name && rule ? { name, detail, action: rule[1] } : null;
	};
	if (storedName && content.startsWith(`${storedName} `)) {
		const match = parseAt(storedName.length);
		if (match) return match;
	}
	for (const boundary of content.matchAll(/\s+/gu)) {
		const match = parseAt(boundary.index);
		if (match) return match;
	}
	return null;
}

export function summarizeRoomActivity(events: ChatMessageRecord[]): Array<{
	text: string;
	actorName?: string;
	event: ChatMessageRecord;
}> {
	const actions = new Map<
		string,
		{
			description: string;
			count: number;
			recallActor?: string;
			actorName?: string;
			event: ChatMessageRecord;
		}
	>();

	for (const event of events) {
		const content = event.content.trim();
		const recall = parseRecallNotice(content);
		const activity = recall
			? null
			: parseRoomActivityActor(content, event.name?.trim());
		const actorName = recall?.actorName ?? activity?.name;
		const action = recall
			? "撤回了消息"
			: activity?.detail.startsWith("将昵称改为「")
				? activity.detail
				: activity?.action;

		const description = actorName ? `${actorName} ${action}` : content;
		const key = actorName
			? JSON.stringify([event.userKey || actorName, action])
			: JSON.stringify([event.userKey, content]);
		const previous = actions.get(key);
		if (previous) previous.count++;
		else
			actions.set(key, {
				description,
				count: 1,
				recallActor: recall?.actorName,
				actorName,
				event,
			});
	}

	return [...actions.values()].map(
		({ description, count, recallActor, actorName, event }) => ({
			actorName,
			event,
			text: recallActor
				? count === 1
					? `${recallActor} 撤回了一条消息`
					: `${recallActor} 撤回了 ${count} 条消息`
				: count === 1
					? description
					: `${description}（${count} 次）`,
		}),
	);
}

interface RoomActivityTimeline {
	rows: ChatMessageRecord[];
	groups: Map<string, ChatMessageRecord[]>;
	rowByEvent: Map<string, string>;
}

export function groupRoomActivity(
	messages: ChatMessageRecord[],
): RoomActivityTimeline {
	const rows: ChatMessageRecord[] = [];
	const groups = new Map<string, ChatMessageRecord[]>();
	const rowByEvent = new Map<string, string>();
	let group: ChatMessageRecord[] | undefined;

	for (const message of messages) {
		if (!isRoomActivity(message)) {
			group = undefined;
			rows.push(message);
			continue;
		}
		if (!group) {
			group = [];
			rows.push(message);
			groups.set(message.msgUid, group);
		}
		group.push(message);
		rowByEvent.set(message.msgUid, group[0].msgUid);
	}

	return { rows, groups, rowByEvent };
}

export function appendTimelineMessage(
	messages: ChatMessageRecord[],
	message: ChatMessageRecord,
): ChatMessageRecord[] {
	if (
		message.kind === "system" &&
		message.source === "matrix" &&
		message.createdAt < (messages.at(-1)?.createdAt ?? 0)
	) {
		const next = messages.findIndex(
			(item) => item.createdAt > message.createdAt,
		);
		return [...messages.slice(0, next), message, ...messages.slice(next)];
	}
	return [...messages, message];
}
