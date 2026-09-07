/**
 * 刷新朋友圈快照：抓取所有启用友链的 RSS/Atom，把结果写入
 * src/data/friends-feed-snapshot.json 供构建时回退使用。
 *
 * 由 GitHub Actions 定时执行（.github/workflows/refresh-friends-feed.yml），
 * 成功后自动提交；提交会触发 Pages 部署，因此朋友圈内容随定时任务保持新鲜。
 *
 * 快照的写入开关 FRIENDS_FEED_WRITE_SNAPSHOT 在 src/utils/friends-feed.ts
 * 中统一控制，这里强制打开。
 */

import { getEnabledFriends } from "../src/config/friendsConfig";
import { loadFriendsFeed } from "../src/utils/friends-feed";

process.env.FRIENDS_FEED_WRITE_SNAPSHOT = "1";

const friends = getEnabledFriends();
const feed = await loadFriendsFeed(friends);

console.log(
	`[friends-feed] ${feed.items.length} 篇更新 / ${feed.freshSources} 个来源新鲜 / ${feed.staleSources} 个沿用快照`,
);
