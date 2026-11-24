/* 茶室前端：原来内联在 chat.astro 里，被 Astro 输出到 </body> 之后，
   站内 swup 无刷新切页时不会执行，于是永远停在「正在看看大家聊到哪儿了…」。
   改成外链、由页脚 PAGE_SCRIPTS 按 /chat/ 注入，切页也能跑起来。
   改完记得把 FooterConfig 里那条 ?v= 往上加。 */
(() => {
	// 配置从页面根节点现读：脚本是外链、又可能被 swup 反复执行，
	// 不能像 define:vars 那样在构建期写死。
	const appNode = () => document.querySelector("[data-tea-app]");
	const appData = (key, fallback = "") => {
		const el = appNode();
		const v = el && el.dataset ? el.dataset[key] : "";
		return v || fallback;
	};
	const API_BASE = appData("api");
	const SITE_NAME = appData("site");

		const KEY = "__teaRoomRuntime";
		const params0 = new URLSearchParams(location.search);
		const api0 = params0.get("api") || API_BASE;
		const ROOMS = {
			chat: { name: "闲聊", desc: "随便聊聊日常与折腾" },
			lobby: { name: "互联茶室", desc: "和其他站点的朋友一起聊天" },
		};

		const esc = (s) =>
			String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

		const hash = (str) => {
			let h = 2166136261;
			for (let i = 0; i < str.length; i++) {
				h ^= str.charCodeAt(i);
				h = Math.imul(h, 16777619);
			}
			return Math.abs(h);
		};

		const avatarStyle = (nick, site) => {
			const h = hash(nick + "|" + (site || ""));
			const a = h % 360;
			const b = (a + 38) % 360;
			return `background-image:linear-gradient(145deg,oklch(0.74 0.13 ${a}),oklch(0.62 0.14 ${b}))`;
		};

		const initials = (nick) => {
			const n = String(nick || "?").trim();
			if (!n) return "?";
			return /[\u4e00-\u9fa5]/.test(n[0]) ? n[0] : n.slice(0, 1).toUpperCase();
		};

		// 极简 markdown：只认图片、链接、粗体、代码块，够大厅里的分享消息用
		const inlineFmt = (raw) => {
			const re = /(!?)\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>"'）)，。]+)/g;
			let out = "";
			let last = 0;
			let m;
			while ((m = re.exec(raw))) {
				out += esc(raw.slice(last, m.index));
				if (m[3]) {
					const url = m[3];
					const label = m[2] || "";
					out +=
						m[1] === "!"
							? `<img src="${esc(url)}" alt="${esc(label)}" loading="lazy" data-zoom />`
							: `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(label || url)}</a>`;
				} else if (m[4]) {
					const url = m[4];
					out += `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(url.replace(/^https?:\/\//, ""))}</a>`;
				}
				last = m.index + m[0].length;
			}
			out += esc(raw.slice(last));
			return out
				.replace(/`([^`<>\n]{1,120})`/g, "<code>$1</code>")
				.replace(/\*\*([^*<]{1,80})\*\*/g, "<strong>$1</strong>");
		};

		const fmtText = (text) => {
			const parts = String(text ?? "").split(/```[a-zA-Z0-9+#-]*\n?/);
			return parts
				.map((chunk, i) =>
					i % 2 === 1
						? `<pre><code>${esc(chunk.replace(/\n$/, ""))}</code></pre>`
						: renderEmojiTags(inlineFmt(chunk)),
				)
				.join("");
		};

		// 投票消息：正文用 📊 开头，选项用圈数字；投票本身走 Matrix reaction，跨站也能看到
		const POLL_MARKS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"];
		const POLL_KEYS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣"];
		const parsePoll = (text) => {
			const lines = String(text ?? "").split("\n");
			const first = lines[0] || "";
			if (!first.startsWith("📊 ")) return null;
			const question = first.slice(2).trim();
			const options = [];
			for (const line of lines.slice(1)) {
				const m = line.match(/^([①②③④⑤⑥⑦⑧])\s+(.+)$/);
				if (m) options.push(m[2].trim());
			}
			return question && options.length >= 2 ? { question, options } : null;
		};
		const renderPollCard = (poll, reactions, eventId) => {
			const list = Array.isArray(reactions) ? reactions : [];
			const counts = poll.options.map((_, i) => {
				const r = list.find((x) => x.key === POLL_KEYS[i]);
				return r ? Number(r.count) || 0 : 0;
			});
			const total = counts.reduce((a, b) => a + b, 0);
			const me = rt.visitor && rt.visitor.id;
			return `<div class="tea-poll-card">
				<div class="tea-poll-card__q">📊 ${esc(poll.question)}</div>
				${poll.options
					.map((opt, i) => {
						const pct = total ? Math.round((counts[i] / total) * 100) : 0;
						const r = list.find((x) => x.key === POLL_KEYS[i]);
						const mine = !!(r && Array.isArray(r.senders) && me && r.senders.includes(me));
						return `<button type="button" class="tea-poll-card__opt${mine ? " is-mine" : ""}" data-act="poll-vote" data-id="${esc(eventId || "")}" data-key="${esc(POLL_KEYS[i])}" ${eventId ? "" : "disabled"}>
							<span class="tea-poll-card__bar" style="width:${pct}%"></span>
							<span class="tea-poll-card__label">${esc(POLL_MARKS[i])} ${esc(opt)}</span>
							<span class="tea-poll-card__pct">${counts[i]} 票 · ${pct}%</span>
						</button>`;
					})
					.join("")}
				<div class="tea-poll-card__foot">${total ? `${total} 票` : "还没人投票"}</div>
			</div>`;
		};

		const fmtTime = (ts) =>
			new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

		const dayKey = (ts) => {
			const d = new Date(ts);
			return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
		};

		const dayLabel = (ts) => {
			const d = new Date(ts);
			const today = new Date();
			const diff = (today.setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 86400000;
			if (diff === 0) return "今天";
			if (diff === 1) return "昨天";
			return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
		};

		const store = {
			get identity() {
				try {
					const v = JSON.parse(localStorage.getItem("tea.identity") || "null");
					if (!v || !v.token || !v.id) return null;
					return v;
				} catch {
					return null;
				}
			},
			set identity(v) {
				if (v) localStorage.setItem("tea.identity", JSON.stringify(v));
				else localStorage.removeItem("tea.identity");
			},
			get count() {
				return Number(localStorage.getItem("tea.count") || 0);
			},
			bump() {
				localStorage.setItem("tea.count", String(this.count + 1));
			},
			// 点歌历史：{ [matrixId]: [{ name, artist, pic, ts }] }
			get songHistory() {
				try {
					return JSON.parse(localStorage.getItem("tea.songHistory") || "{}");
				} catch {
					return {};
				}
			},
			set songHistory(v) {
				localStorage.setItem("tea.songHistory", JSON.stringify(v));
			},
		};

		// 记一首歌到当前访客名下（同曲累加时间，不重复堆条目）
		const recordSong = (track) => {
			const v = rt.visitor;
			if (!v || !track || !track.name) return;
			const all = store.songHistory;
			const list = all[v.id] || [];
			const found = list.find((x) => x.name === track.name && x.artist === track.artist);
			if (found) found.ts = Date.now();
			else list.unshift({ name: track.name, artist: track.artist, pic: track.pic || "", ts: Date.now() });
			all[v.id] = list.slice(0, 80);
			store.songHistory = all;
		};

		// ── 实例状态 ──────────────────────────────────────────────
		const rt =
			window[KEY] ||
			(window[KEY] = {
				bound: false,
				timer: null,
				since: null,
				lastId: null,
				seen: new Set(),
				sending: false,
				jukeTimer: null,
				rosterAll: false,
				members: [],
				reactions: new Map(),
				replyTo: null,
				typingAt: 0,
				typingTimer: 0,
				readTimer: 0,
				readPending: "",
				room: params0.get("room") === "chat" ? "chat" : "lobby",
				visitor: store.identity,
			});

		const root = () => document.getElementById("tea-app");
		const q = (sel) => (root() ? root().querySelector(sel) : null);

		const setConn = (state, text) => {
			const el = q("[data-tea-conn]");
			const label = q("[data-tea-conn-text]");
			if (!el) return;
			el.classList.toggle("is-live", state === "live");
			el.classList.toggle("is-down", state === "down");
			if (label) label.textContent = text || (state === "live" ? "已连接" : state === "down" ? "连接中断" : "连接中");
		};

		const showError = (msg) => {
			const box = q("[data-tea-error]");
			if (!box) return;
			box.textContent = msg || "";
			box.hidden = !msg;
		};

		// ── 渲染 ─────────────────────────────────────────────────
		const feedEl = () => q("[data-tea-feed]");

		const atBottom = () => {
			const f = feedEl();
			if (!f) return true;
			return f.scrollHeight - f.scrollTop - f.clientHeight < 90;
		};

		const scrollBottom = (smooth) => {
			const f = feedEl();
			if (!f) return;
			f.scrollTo({ top: f.scrollHeight, behavior: smooth ? "smooth" : "auto" });
		};

		const renderReactions = (m) => {
			const list = Array.isArray(m.reactions) ? m.reactions : [];
			if (!list.length) return "";
			const me = rt.visitor?.id || "";
			return `<div class="tea-msg__reactions">${list
				.map((r) => {
					const mine = Array.isArray(r.senders) && r.senders.includes(me);
					return `<button type="button" class="tea-msg__reaction${mine ? " is-mine" : ""}" title="${esc(r.nick || "")} 回应了 ${esc(r.key)}">${esc(r.key)} ${r.count}</button>`;
				})
				.join("")}</div>`;
		};

		const readerFace = (r) =>
			r.avatar
				? `<img src="${esc(r.avatar)}" alt="" loading="lazy" />`
				: `<span style="${avatarStyle(r.nick, r.site)}">${esc(initials(r.nick))}</span>`;

		const renderReceipt = (m) => {
			const rp = m.receipt;
			if (!rp || !rp.count) return "";
			const readers = Array.isArray(rp.readers) ? rp.readers : [];
			const faces = readers
				.slice(0, 3)
				.map(readerFace)
				.join("");
			const more = Math.max(0, (rp.count || 0) - readers.length);
			const rows = readers
				.map(
					(r) => `<li>
						${readerFace(r)}
						<span class="tea-receipt__who"><b>${esc(r.nick || "茶友")}</b>${r.site ? `<small>来自 ${esc(r.site)}</small>` : ""}</span>
					</li>`,
				)
				.join("");
			return `<div class="tea-receipt">
				<button type="button" class="tea-receipt__trigger" data-receipt aria-expanded="false" aria-label="已读 ${Number(rp.count) || 0} 人，查看名单">
					<span class="tea-receipt__faces">${faces}${more ? `<span>+${more}</span>` : ""}</span>
					<span>${Number(rp.count) || 0} 人已读</span>
				</button>
				<div class="tea-receipt__pop" data-receipt-pop hidden>
					<h5>已读成员 <small>${Number(rp.count) || 0} 人</small></h5>
					<ul class="tea-receipt__list">${rows}${more ? `<li><small>还有 ${more} 人未显示</small></li>` : ""}</ul>
				</div>
			</div>`;
		};

		// sync 里带回的回执更新：只换掉对应消息的已读区，不重画整段历史。
		// 回执名单最多带 12 人，count 里可能还有没带下来的人，多出来的算「+N」。
		const applyReceipts = (map) => {
			if (!map) return;
			const f = feedEl();
			if (!f) return;
			for (const [id, rec] of Object.entries(map)) {
				if (!rec) continue;
				const el = f.querySelector(`.tea-msg[data-id="${CSS.escape(id)}"]`);
				if (!el) continue;
				const sender = el.dataset.sender || "";
				const all = Array.isArray(rec.readers) ? rec.readers : [];
				const readers = all.filter((r) => r && r.id !== sender);
				const hidden = Math.max(0, (Number(rec.count) || all.length) - all.length);
				const count = readers.length + hidden;
				const html = count ? renderReceipt({ receipt: { count, readers } }) : "";
				const cur = el.querySelector(".tea-receipt");
				if (!html) {
					if (cur) cur.remove();
					continue;
				}
				const box = document.createElement("div");
				box.innerHTML = html;
				const fresh = box.firstElementChild;
				if (!fresh) continue;
				if (cur) cur.replaceWith(fresh);
				else el.querySelector(".tea-msg__body")?.appendChild(fresh);
			}
		};

		// 已读名单弹层：fixed 定位避开消息区 overflow 裁剪
		const bindReceipts = () => {
			const f = feedEl();
			if (!f || f.dataset.receiptBound) return;
			f.dataset.receiptBound = "1";
			let activePop = null;
			let activeBtn = null;
			const close = () => {
				if (activePop) {
					activePop.hidden = true;
					activePop = null;
				}
				if (activeBtn) {
					activeBtn.setAttribute("aria-expanded", "false");
					activeBtn = null;
				}
			};
			f.addEventListener("click", (e) => {
				const btn = e.target.closest("[data-receipt]");
				if (!btn || !f.contains(btn)) {
					if (!e.target.closest("[data-receipt-pop]")) close();
					return;
				}
				const pop = btn.parentElement.querySelector("[data-receipt-pop]");
				if (!pop) return;
				if (activeBtn === btn && !pop.hidden) {
					close();
					return;
				}
				close();
				pop.hidden = false;
				const r = btn.getBoundingClientRect();
				const w = pop.offsetWidth;
				const h = pop.offsetHeight;
				pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
				const up = r.top - h - 6 >= 8;
				pop.style.top = `${up ? r.top - h - 6 : Math.min(r.bottom + 6, innerHeight - h - 8)}px`;
				activePop = pop;
				activeBtn = btn;
				btn.setAttribute("aria-expanded", "true");
			});
			document.addEventListener("keydown", (e) => {
				if (e.key === "Escape") close();
			});
		};

		const ICON_REACT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9.5" cy="12.5" r="6.5"/><path d="M6.8 14.4s1 1.4 2.7 1.4 2.7-1.4 2.7-1.4"/><circle cx="7.2" cy="10.6" r=".7" fill="currentColor" stroke="none"/><circle cx="11.8" cy="10.6" r=".7" fill="currentColor" stroke="none"/><path d="M19 5v5M16.5 7.5h5"/></svg>`;
		const ICON_REPLY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 7 3 12l6 5"/><path d="M3 12h11a6 6 0 0 1 6 6v1"/></svg>`;
		const ICON_MORE = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>`;

		// 已读回执：规范（Receipts）要求「确认消息已展示」后上报 m.read，
		// 并且 SHOULD NOT 给自己发的消息发回执。回执是水位线语义，只报最新一条。
		const markRead = (m) => {
			const v = rt.visitor;
			if (!v || !m || !m.id || !/^\$/.test(m.id)) return;
			if (m.sender === v.id) return;
			if (document.visibilityState !== "visible") return;
			rt.readPending = m.id;
			if (rt.readTimer) return;
			rt.readTimer = setTimeout(() => {
				rt.readTimer = 0;
				const id = rt.readPending;
				rt.readPending = "";
				if (!id) return;
				api(`/api/receipt?room=${rt.room}`, { method: "POST", body: JSON.stringify({ eventId: id }) }).catch(() => {});
			}, 2000);
		};

		const renderMessage = (m) => {
			const f = feedEl();
			if (!f) return;
			// 判重以 DOM 为准：单页切房/重载时 rt.seen 可能和真实 DOM 不同步，
			// 只看 seen 会把整段历史当成“已渲染”全部跳过，页面上就只剩 sync 来的几条。
			if (m.id && (rt.seen.has(m.id) || f.querySelector(`.tea-msg[data-id="${CSS.escape(m.id)}"]`))) return;
			if (m.id) rt.seen.add(m.id);


			const lastDay = f.dataset.day;
			if (lastDay !== dayKey(m.ts)) {
				const sep = document.createElement("div");
				sep.className = "tea-day";
				sep.textContent = dayLabel(m.ts);
				f.appendChild(sep);
				f.dataset.day = dayKey(m.ts);
			}

			const mine = !!(rt.visitor && m.sender && m.sender === rt.visitor.id);
			const el = document.createElement("article");
			el.className = "tea-msg" + (mine ? " tea-msg--mine" : "");
			el.dataset.nick = m.nick || "";
			el.dataset.site = m.site || "";
			if (m.sender) el.dataset.sender = m.sender;
			el.dataset.ts = String(m.ts || Date.now());
			if (m.id) el.dataset.id = m.id;
			if (m.pending) el.classList.add("tea-msg--pending");
			if (m.failed) el.classList.add("tea-msg--failed");

			const av = m.avatar
				? `style="background-image:url('${esc(m.avatar)}')"`
				: `style="${avatarStyle(m.nick, m.site)}"`;
			const siteTag = m.site ? `<span class="tea-msg__site">来自 ${esc(m.site)}</span>` : "";
			const poll = parsePoll(m.text || "");
			if (poll) el.dataset.poll = JSON.stringify(poll);
			// 消息图片不要 lazy：Chrome 会在 overflow 容器里把未加载的图压成 2×2，
			// 懒加载又因元素太小不触发，结果只露出 alt「图片」，图永远不出来。
			// 顺带用 Matrix info.w/h 给真实尺寸，避免布局跳动。
			const dims = m.imageW && m.imageH ? ` width="${Number(m.imageW)}" height="${Number(m.imageH)}"` : "";
			const body = m.image
				? `<img src="${esc(m.image)}" alt="${m.emoticon ? "表情" : "图片"}" decoding="async"${dims} ${m.emoticon ? 'class="tea-emoticon"' : "data-zoom"} />`
				: poll
					? renderPollCard(poll, m.reactions, m.id)
					: fmtText(m.text || "");
			const reply = m.reply
				? `<div class="tea-msg__reply"><b>${esc(m.reply.who || "茶友")}</b><span>${esc(m.reply.text || "")}</span></div>`
				: "";
			const reactions = renderReactions(m);
			// pending 时也渲染操作区（CSS 隐藏），发送成功后去掉 pending 类即可显示，
			// 否则自己刚发的消息永远没有撤回/回复按钮。
			const actions = m.id
				? `<span class="tea-msg__actions">
						<button type="button" class="tea-msg__action" data-act="react" data-id="${esc(m.id)}" title="回应" aria-label="回应">${ICON_REACT}</button>
						<button type="button" class="tea-msg__action" data-act="reply" data-id="${esc(m.id)}" data-nick="${esc(m.nick || "茶友")}" data-text="${esc((m.text || "图片").slice(0, 80))}" title="回复" aria-label="回复">${ICON_REPLY}</button>
						<button type="button" class="tea-msg__action" data-act="more" data-id="${esc(m.id)}" data-nick="${esc(m.nick || "茶友")}" data-text="${esc((m.text || "图片").slice(0, 500))}" data-recall="${mine && Date.now() - Number(m.ts || 0) < 5 * 60 * 1000 ? "1" : "0"}" data-thread="${rt.room === "lobby" ? "1" : "0"}" title="更多" aria-label="更多">${ICON_MORE}</button>
					</span>`
				: "";
			const receipt = renderReceipt(m);

			// 头像可点：点开就是这个人（或自己）的名片
			const avatarHtml = m.sender
				? `<button type="button" class="tea-msg__avatar" ${av} data-tea-msg-avatar="${esc(m.sender)}" data-tea-msg-nick="${esc(m.nick || "茶友")}" data-tea-msg-site="${esc(m.site || "")}"${m.avatar ? ` data-tea-msg-pic="${esc(m.avatar)}"` : ""} title="查看 ${esc(m.nick || "茶友")} 的名片" aria-label="查看 ${esc(m.nick || "茶友")} 的名片">${m.avatar ? "" : esc(initials(m.nick))}</button>`
				: `<div class="tea-msg__avatar" ${av} aria-hidden="true">${m.avatar ? "" : esc(initials(m.nick))}</div>`;

			el.innerHTML = `
				${avatarHtml}
				<div class="tea-msg__body">
					<div class="tea-msg__head">
						<span class="tea-msg__nick">${esc(m.nick || "茶友")}</span>
						${siteTag}
					<time class="tea-msg__time">${esc(fmtTime(m.ts))}</time>
				</div>
				<div class="tea-msg__text">${reply}${body}${reactions}${actions}</div>
					${receipt}
				</div>`;

			f.appendChild(el);
			markRead(m);
			if (m.scroll !== false) scrollBottom(!m.pending);
		};

		// ── 撤回 ──────────────────────────────────────────────────
		const recallHtml = (r) => {
			const site = r.site ? " · " + esc(r.site) : "";
			return `<div class="tea-recall" data-id="${esc(r.id)}" data-ts="${Number(r.ts) || 0}"><b>${esc(r.by || "茶友")}${site}</b> 撤回了一条消息</div>`;
		};
		const applyRedactions = (list) => {
			if (!Array.isArray(list) || !list.length) return;
			const f = feedEl();
			if (!f) return;
			for (const r of list) {
				if (!r || !r.id) continue;
				const old = f.querySelector(`.tea-msg[data-id="${CSS.escape(r.id)}"]`);
				const box = document.createElement("div");
				box.innerHTML = recallHtml(r);
				const node = box.firstElementChild;
				if (old) {
					old.replaceWith(node);
					continue;
				}
				if (f.querySelector(`.tea-recall[data-id="${CSS.escape(r.id)}"]`)) continue;
				// 目标消息不在当前加载窗口时，按时间戳插到正确位置，别全塞到底部。
				const ts = Number(r.ts) || 0;
				const items = [...f.querySelectorAll(".tea-msg, .tea-recall")];
				const next = items.find((el) => Number(el.dataset.ts || 0) > ts);
				if (next) next.before(node);
				else if (!items.length || ts >= Number(items[items.length - 1].dataset.ts || 0)) f.appendChild(node);
			}
		};

		// ── 上次阅读位置 ──────────────────────────────────────────
		const readKey = () => "tea.lastRead." + (api0 || "") + "." + rt.room;
		const saveReadMark = () => {
			const list = rt.messages || [];
			const last = list[list.length - 1];
			const ts = Number(last?.ts || 0);
			if (ts) localStorage.setItem(readKey(), String(ts));
		};
		const fmtReadTime = (ts) => {
			const d = new Date(Number(ts));
			const now = new Date();
			const sameDay = d.toDateString() === now.toDateString();
			return (sameDay ? "今天 " : "") + d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
		};
		const markUnreadDivider = () => {
			const f = feedEl();
			if (!f || f.querySelector("[data-tea-readmark]")) return;
			const since = Number(localStorage.getItem(readKey()) || 0);
			if (!since) return;
			const first = [...f.querySelectorAll(".tea-msg")].find((el) => Number(el.dataset.ts || 0) > since);
			if (!first) return;
			const mark = document.createElement("div");
			mark.className = "tea-readmark";
			mark.dataset.readmark = "1";
			mark.innerHTML = `<span>上次 ${fmtReadTime(since)} 阅读到这里</span>`;
			first.parentElement.insertBefore(mark, first);
			const jump = q("[data-tea-readjump]");
			if (jump) jump.hidden = false;
		};
		rt.saveReadMark = saveReadMark;

		const renderMembers = (members) => {
			const list = q("[data-tea-members]");
			if (!list) return;
			rt.members = members;
			const isOn = (m) => m.online !== false || !!(rt.visitor && m.id === rt.visitor.id);
			const countEl = q("[data-tea-online]");
			if (countEl) countEl.textContent = String(members.filter(isOn).length + (rt.visitor ? 0 : 1));
			const more = q("[data-tea-roster-all]");
			const observerHtml = rt.visitor
				? ""
				: `<li class="tea-member tea-member--observer" role="note" title="未登录，正在旁观">
					<span class="tea-member__avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/></svg></span>
					<span class="tea-member__copy">
						<span class="tea-member__name">旁观者</span>
						<span class="tea-member__site">互联茶室</span>
					</span>
				</li>`;

			if (!members.length) {
				list.innerHTML = observerHtml || `<li class="tea-roster__empty">暂时没人，等你来坐第一桌。</li>`;
				if (more) more.hidden = true;
				return;
			}

			const LIMIT = 6;
			const rowHtml = (m) => {
				const av = m.avatar
					? `style="background-image:url('${esc(m.avatar)}')"`
					: `style="${avatarStyle(m.nick, m.site)}"`;
				const on = isOn(m);
				const badge = on
					? `<span class="tea-member__badge is-online">在线</span>`
					: `<span class="tea-member__badge is-away">离开</span>`;
				const idx = members.indexOf(m);
				return `<li class="tea-member tea-member--clickable${on ? "" : " tea-member--idle"}" data-tea-member="${idx}" role="button" tabindex="0" title="查看 ${esc(m.nick)} 的名片">
					<span class="tea-member__avatar" ${av}>${m.avatar ? "" : esc(initials(m.nick))}</span>
					<span class="tea-member__copy">
						<span class="tea-member__name">${esc(m.nick)}</span>
						<span class="tea-member__site">${esc(m.site ? "来自 " + m.site : "Matrix")}</span>
					</span>
					${badge}
				</li>`;
			};

			// 在线 / 离线分开：在线按站点分组，离线单独一栏，避免“在线人数”和列表对不上
			const isSelfSite = (m) => !m.site || m.site === SITE_NAME;
			const onlineMembers = members.filter(isOn);
			const local = onlineMembers.filter(isSelfSite);
			const others = onlineMembers.filter((m) => !isSelfSite(m));
			const offline = members.filter((m) => !isOn(m));
			const groupHtml = (label, list, count, extra = "") => {
				if (!list.length && !extra) return "";
				const rows = rt.rosterAll ? list : list.slice(0, LIMIT);
				return `<li class="tea-roster__group" role="presentation"><span>${label}</span><span class="tea-roster__group-count">${count} 人在线</span></li>` +
					rows.map(rowHtml).join("") + extra;
			};
			const offlineHtml = offline.length
				? `<li class="tea-roster__group" role="presentation"><span>离线成员</span><span class="tea-roster__group-count">${offline.length} 人</span></li>` +
					(rt.rosterAll ? offline.map(rowHtml).join("") : "")
				: "";
			list.innerHTML =
				groupHtml("本站在线", local, local.length + (rt.visitor ? 0 : 1), observerHtml) +
				groupHtml("其他站点", others, others.length) +
				offlineHtml;

			if (more) {
				more.hidden = members.length <= LIMIT && !offline.length;
				more.textContent = rt.rosterAll ? "收起离线成员" : `显示全部（${members.length}）`;
			}
		};

		// 成员“初次来访”只能记在本机：没记过的按今天算，之后就一直沿用那次的时间。
		const FIRST_SEEN_KEY = "tea.firstSeen";
		const firstSeenAt = (id) => {
			if (!id) return Date.now();
			try {
				const all = JSON.parse(localStorage.getItem(FIRST_SEEN_KEY) || "{}") || {};
				if (!all[id]) {
					all[id] = Date.now();
					const keys = Object.keys(all);
					if (keys.length > 300) keys.sort((a, b) => all[a] - all[b]).slice(0, keys.length - 300).forEach((k) => delete all[k]);
					localStorage.setItem(FIRST_SEEN_KEY, JSON.stringify(all));
				}
				return all[id];
			} catch (_) {
				return Date.now();
			}
		};

		// ── 成员名片 ────────────────────────────────────────────
		const mcState = { member: null, sort: "time" };
		const mcSongs = () => {
			const m = mcState.member;
			if (!m) return [];
			const list = (store.songHistory[m.id] || []).map((s) => ({ ...s }));
			// 同名同歌手合并次数，记录里 ts 是最近一次
			const map = new Map();
			for (const s of list) {
				const key = `${s.name}|${s.artist}`;
				const prev = map.get(key);
				if (prev) { prev.count++; if (s.ts > prev.ts) { prev.ts = s.ts; prev.pic = s.pic || prev.pic; } }
				else map.set(key, { ...s, count: 1 });
			}
			const all = [...map.values()];
			all.sort((a, b) => mcState.sort === "count" ? b.count - a.count : b.ts - a.ts);
			return all;
		};
		const mcRenderSongs = () => {
			const box = document.querySelector("[data-tea-mc-songs]");
			const note = document.querySelector("[data-tea-mc-song-note]");
			if (!box) return;
			const songs = mcSongs();
			if (note) note.textContent = songs.length ? `${songs.length} 首` : "暂无记录";
			if (!songs.length) {
				box.innerHTML = `<li class="mc-empty">TA 还没点过歌，点歌台点一首试试~</li>`;
				return;
			}
			box.innerHTML = songs
				.map((s, i) => {
					const day = new Date(s.ts);
					const when = day.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) + " " + day.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
					return `<li class="mc-song">
						<span class="mc-song__idx">${i + 1}</span>
						${s.pic ? `<img class="mc-song__cover" src="${esc(s.pic)}" alt="" loading="lazy" />` : `<span class="mc-song__cover"></span>`}
						<span class="mc-song__copy"><b>${esc(s.name)}</b><span>${esc(s.artist || "未知歌手")} · ${when}${s.count > 1 ? ` · 点过 ${s.count} 次` : ""}</span></span>
						<button type="button" class="mc-song__add" data-mc-add="${esc(s.name)}" data-mc-artist="${esc(s.artist || "")}">+ 点歌</button>
					</li>`;
				})
				.join("");
		};
		const openMemberCard = (m) => {
			if (!m) return;
			mcState.member = m;
			mcState.sort = "time";
			for (const b of document.querySelectorAll("[data-tea-mc-sort]")) b.classList.toggle("is-active", b.dataset.teaMcSort === "time");
			const left = document.querySelector("[data-tea-mc-left]");
			if (!left) return;
			const on = m.online !== false || !!(rt.visitor && m.id === rt.visitor.id);
			const domain = (m.id || "").split(":")[1] || "";
			const server = domain ? (domain.startsWith("matrix.") ? domain : `matrix.${domain}`) : "";
			const isSelf = rt.visitor && m.id === rt.visitor.id;
			const role = isSelf ? "我" : (m.site === SITE_NAME ? "站长" : "茶友");
			const badge = `<span class="mc-badge">${esc(role)}</span>`;
			const av = m.avatar ? `background-image:url('${esc(m.avatar)}')` : avatarStyle(m.nick, m.site);
			const site = m.site || (domain === "matrix.0dm.cn" ? SITE_NAME : domain ? "Matrix" : "");
			const website = m.website || (store.identity && store.identity.id === m.id ? store.identity.website : "");
			const bio = m.bio || "这个人很懒，还没留下签名~";
			const songList = store.songHistory[m.id] || [];
			const artists = new Map();
			const statsSongs = mcSongs();
			for (const s of statsSongs) artists.set(s.artist || "未知歌手", (artists.get(s.artist || "未知歌手") || 0) + s.count);
			const topArtists = [...artists.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
			const msgCount = (rt.messages || []).filter((x) => x.sender === m.id).length;
			const recent = (rt.messages || []).filter((x) => x.sender === m.id).slice(-2).reverse();
			left.innerHTML = `
				<div class="mc-card">
					<div class="mc-top">
						<span class="mc-avatar" style="${av}">${m.avatar ? "" : esc(initials(m.nick))}<i class="mc-dot${on ? " is-on" : ""}"></i></span>
						<span class="mc-ident">
							<span class="mc-name">${esc(m.nick)}${badge}</span>
							<span class="mc-meta"><span>${on ? "在线" : "离开"}</span><i>·</i><span>${esc(site || "本站 Matrix 节点")}</span></span>
						</span>
					</div>
					<div class="mc-signature">${esc(bio)}</div>
					${website ? `<a class="mc-site" href="${esc(/^https?:\/\//i.test(website) ? website : "https://" + website)}" target="_blank" rel="noopener noreferrer nofollow"><span>${esc(website)}</span><span>访问主页 ↗</span></a>` : ""}
					<div class="mc-mx">
						<div><span>Matrix 账号:</span><span title="${esc(m.id || "")}">${esc(m.id || "待分配")}</span></div>
						<div><span>服务器:</span><span title="${esc(server)}">${esc(server)}</span></div>
					</div>
				</div>
				<a class="mc-at" href="https://matrix.to/#/${encodeURIComponent(m.id || "")}" target="_blank" rel="noopener noreferrer">@ ${esc(m.nick)}</a>
				<div class="mc-stats">
					<div class="mc-stat"><span>聊天发言</span><b>${msgCount || "—"}</b></div>
					<div class="mc-stat"><span>点过的歌</span><b>${songList.length || "—"}</b></div>
					<div class="mc-stat"><span title="本机第一次见到 TA 的日期">初见</span><b>${esc(new Date(firstSeenAt(m.id)).toLocaleDateString("zh-CN"))}</b></div>
					<div class="mc-stat"><span>最近活跃</span><b class="${on ? "" : "is-away"}">${on ? "在线" : "离开"}</b></div>
				</div>
				${topArtists.length ? `<div><h4 class="mc-block-title">常点歌手</h4><div class="mc-artists">${topArtists.map(([n, c]) => `<span class="mc-artist">${esc(n)}<b>${c} 次</b></span>`).join("")}</div></div>` : ""}
				${recent.length ? `<div><h4 class="mc-block-title">最近发言</h4><div class="mc-recent">${recent.map((x) => `<div class="mc-recent-item"><span>${esc((x.text || "图片").slice(0, 40))}</span><span>${esc(fmtTime(x.ts))}</span></div>`).join("")}</div></div>` : ""}`;
			left.scrollTop = 0;
			const rightPane = document.querySelector(".tea-membercard__right");
			if (rightPane) rightPane.scrollTop = 0;
			mcRenderSongs();
			const dlg = document.querySelector("[data-tea-membercard]");
			if (!dlg) return;
			if (dlg.open) return;
			if (typeof dlg.showModal === "function") dlg.showModal();
			else dlg.setAttribute("open", "");
		};

		const renderSelf = () => {
			const v = rt.visitor;
			const av = q("[data-tea-me-avatar]");
			const name = q("[data-tea-me-name]");
			const status = q("[data-tea-me-status]");
			const badge = q("[data-tea-me-badge]");
			const count = q("[data-tea-me-count]");
			const card = q("[data-tea-me]");
			const loginBtn = q("[data-tea-card-login]");
			const bell = q("[data-tea-notify-toggle]");
			if (!av || !name) return;
			if (card) card.classList.toggle("is-guest", !v);
			if (loginBtn) loginBtn.hidden = !!v;
			if (bell) {
				bell.disabled = !v;
				bell.title = v ? "通知" : "登录后才能接收通知";
			}
			if (v) {
				if (v.avatar) {
					av.textContent = "";
					av.setAttribute("style", `background-image:url('${v.avatar}')`);
				} else {
					av.textContent = initials(v.nick);
					av.setAttribute("style", avatarStyle(v.nick, SITE_NAME));
				}
				name.textContent = v.nick;
				if (badge) badge.hidden = false;
				if (status) status.textContent = v.status || "点击设置状态…";
				if (count) count.textContent = String(store.count);
			} else {
				av.textContent = "?";
				av.removeAttribute("style");
				name.textContent = "未登录（旁观）";
				if (badge) badge.hidden = true;
				if (status) status.textContent = "登录后即可发言与点歌";
				if (count) count.textContent = "0";
			}
			const since = q("[data-tea-me-since]");
			if (since) since.textContent = v ? "已入座" : "今天刚到";
			if (rt.members) renderMembers(rt.members);
			updatePlaceholder();
		};

		// ── 个人资料 ─────────────────────────────────────────────
		const profileDialog = document.querySelector("[data-tea-profile-dialog]");
		const profileForm = document.querySelector("[data-tea-profile-form]");
		const profilePaint = () => {
			if (!profileForm) return;
			const nick = profileForm.elements.nick.value.trim() || "还没填昵称";
			const status = profileForm.elements.status.value.trim() || "在线";
			const avatar = profileForm.elements.avatar.value.trim();
			const av = document.querySelector("[data-tea-profile-avatar]");
			const name = document.querySelector("[data-tea-profile-name]");
			const st = document.querySelector("[data-tea-profile-status]");
			if (av) {
				if (avatar) {
					av.textContent = "";
					av.setAttribute("style", `background-image:url('${avatar}')`);
				} else {
					av.textContent = initials(nick);
					av.setAttribute("style", avatarStyle(nick, SITE_NAME));
				}
			}
			if (name) name.textContent = nick;
			if (st) st.textContent = status;
		};
		const openProfile = async () => {
			if (!rt.visitor) {
				openDialog();
				return;
			}
			if (!profileForm || !profileDialog) return;
			const v = rt.visitor;
			profileForm.elements.nick.value = v.nick || "";
			profileForm.elements.signature.value = v.signature || "";
			profileForm.elements.website.value = v.website || "";
			profileForm.elements.avatar.value = v.avatar || "";
			profileForm.elements.status.value = v.status || "";
			profileForm.elements.emailNotify.checked = v.emailNotify !== false;
			profileForm.elements.push.checked = v.push === true;
			profilePaint();
			if (typeof profileDialog.showModal === "function") profileDialog.showModal();
		};
		const closeProfile = () => profileDialog && profileDialog.close();
		if (profileForm) {
			for (const name of ["nick", "status", "avatar"]) {
				profileForm.elements[name]?.addEventListener("input", profilePaint);
			}
			const grid = document.querySelector("[data-tea-status-grid]");
			if (grid) {
				grid.addEventListener("click", (e) => {
					const b = e.target.closest("[data-tea-status]");
					if (!b) return;
					profileForm.elements.status.value = b.dataset.teaStatus;
					for (const x of grid.querySelectorAll("[data-tea-status]")) x.classList.toggle("is-active", x === b);
					profilePaint();
				});
			}
			profileForm.elements.push?.addEventListener("change", async (e) => {
				if (!e.target.checked) return;
				if (!("Notification" in window)) {
					e.target.checked = false;
					return;
				}
				const p = await Notification.requestPermission();
				if (p !== "granted") e.target.checked = false;
			});
			document.querySelector("[data-tea-profile-close]")?.addEventListener("click", closeProfile);
			document.querySelector("[data-tea-profile-cancel]")?.addEventListener("click", closeProfile);
			document.querySelector("[data-tea-profile-logout]")?.addEventListener("click", () => {
				store.identity = null;
				location.reload();
			});
			document.querySelector("[data-tea-profile-save]")?.addEventListener("click", async (ev) => {
				const btn = ev.currentTarget;
				const err = document.querySelector("[data-tea-profile-error]");
				if (err) err.hidden = true;
				btn.disabled = true;
				try {
					const body = {
						nick: profileForm.elements.nick.value.trim(),
						signature: profileForm.elements.signature.value.trim(),
						website: profileForm.elements.website.value.trim(),
						avatarUrl: profileForm.elements.avatar.value.trim(),
						status: profileForm.elements.status.value.trim(),
						emailNotify: profileForm.elements.emailNotify.checked,
						push: profileForm.elements.push.checked,
					};
					if (!body.nick) throw new Error("昵称不能为空");
				const data = await api("/api/profile", { method: "POST", body: JSON.stringify(body) });
					const v = rt.visitor || {};
					Object.assign(v, {
						nick: body.nick,
						signature: body.signature,
						website: body.website,
						status: body.status,
						emailNotify: body.emailNotify,
						push: body.push,
					});
					if (data.user?.avatar) v.avatar = data.user.avatar;
					rt.visitor = v;
					store.identity = v;
					renderSelf();
					closeProfile();
					loadRoom();
				} catch (e2) {
					if (err) {
						err.textContent = e2.message || "保存失败";
						err.hidden = false;
					}
				} finally {
					btn.disabled = false;
				}
			});
		}

		// ── 通知中心 ─────────────────────────────────────────────
		const NOTICE_KEY = "tea.notices.v1";
		const readNotices = () => {
			try {
				const v = JSON.parse(localStorage.getItem(NOTICE_KEY) || "[]");
				return Array.isArray(v) ? v : [];
			} catch {
				return [];
			}
		};
		let notices = readNotices();
		const saveNotices = () => {
			try { localStorage.setItem(NOTICE_KEY, JSON.stringify(notices.slice(0, 30))); } catch (_) {}
		};
		const renderNotices = () => {
			const pop = q("[data-tea-notify]");
			const list = q("[data-tea-notify-list]");
			const dot = q("[data-tea-notify-dot]");
			const unread = notices.filter((n) => !n.read).length;
			if (dot) dot.hidden = unread === 0;
			if (!list) return;
			list.innerHTML = notices.length
				? notices
						.map((n) => `<div class="tea-notify__item${n.read ? "" : " is-unread"}" data-notice-id="${esc(n.id)}">
							<b>${esc(n.nick || "茶友")}${n.room === "chat" ? " · 闲聊" : " · 互联茶室"}</b>
							<span>${esc(n.text || "")}</span>
							<time>${esc(fmtTime(n.ts))}</time>
						</div>`)
						.join("")
				: `<p class="tea-notify__empty">还没有新的提醒。</p>`;
			if (pop && !pop.hidden) positionNotices();
		};
		const positionNotices = () => {
			const pop = q("[data-tea-notify]");
			const bell = q("[data-tea-notify-toggle]");
			if (!pop || !bell) return;
			const r = bell.getBoundingClientRect();
			const w = pop.offsetWidth || 300;
			pop.style.top = r.bottom + 8 + "px";
			pop.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px";
		};
		const noteIncoming = (m) => {
			const v = rt.visitor;
			if (!v || !m || !m.id || m.sender === v.id) return;
			const text = String(m.text || "");
			const hit = (v.nick && text.includes("@" + v.nick)) || (m.reply && m.reply.who === v.nick);
			if (!hit) return;
			if (notices.some((n) => n.id === m.id)) return;
			notices.unshift({ id: m.id, nick: m.nick || "茶友", text: text.slice(0, 100), ts: m.ts || Date.now(), room: rt.room, read: false });
			notices = notices.slice(0, 30);
			saveNotices();
			renderNotices();
			if (document.hidden && "Notification" in window && Notification.permission === "granted") {
				try { new Notification(`${m.nick || "茶友"} 提到了你`, { body: text.slice(0, 100) }); } catch (_) {}
			}
		};
		const notifyBell = q("[data-tea-notify-toggle]");
		const notifyPop = q("[data-tea-notify]");
		if (notifyBell && notifyPop) {
			notifyBell.addEventListener("click", (e) => {
				e.stopPropagation();
				notifyPop.hidden = !notifyPop.hidden;
				if (!notifyPop.hidden) {
					renderNotices();
					positionNotices();
				}
			});
			notifyPop.addEventListener("click", (e) => {
				e.stopPropagation();
				const item = e.target.closest("[data-notice-id]");
				if (!item) return;
				const n = notices.find((x) => x.id === item.dataset.noticeId);
				if (n) n.read = true;
				saveNotices();
				renderNotices();
				notifyPop.hidden = true;
				if (n && n.room !== rt.room && typeof rt.switchRoom === "function") rt.switchRoom(n.room);
				setTimeout(() => {
					const el = feedEl()?.querySelector(`.tea-msg[data-id="${CSS.escape(item.dataset.noticeId)}"]`);
					if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
				}, n && n.room !== rt.room ? 900 : 60);
			});
			q("[data-tea-notify-read]")?.addEventListener("click", (e) => {
				e.stopPropagation();
				notices = notices.map((n) => ({ ...n, read: true }));
				saveNotices();
				renderNotices();
			});
			document.addEventListener("click", (e) => {
				if (notifyPop.hidden) return;
				if (e.target.closest("[data-tea-notify]") || e.target.closest("[data-tea-notify-toggle]")) return;
				notifyPop.hidden = true;
			});
			window.addEventListener("scroll", () => { if (!notifyPop.hidden) positionNotices(); }, { passive: true });
			renderNotices();
		}

		const setGate = (entered) => {
			const gate = q("[data-tea-gate]");
			const input = q("[data-tea-input]");
			if (gate) gate.hidden = !!entered;
			if (input) input.hidden = !entered;
			updatePlaceholder();
		};

		// 输入框占位提示：以 昵称 的身份在 #房间 说点什么…
		const updatePlaceholder = () => {
			const ta = q("[data-tea-text]");
			if (!ta) return;
			const v = rt.visitor;
			const room = (ROOMS[rt.room] || ROOMS.chat).name;
			ta.placeholder = v
				? `以 ${v.nick || "茶友"} 的身份在 #${room} 说点什么…`
				: `在 #${room} 说点什么…`;
		};

		// ── 数据 ─────────────────────────────────────────────────
		const api = async (path, opts = {}) => {
			const { timeout = 20_000, ...fetchOpts } = opts;
			const headers = { ...(fetchOpts.headers || {}) };
			if (rt.visitor && rt.visitor.token) headers.Authorization = `Bearer ${rt.visitor.token}`;
			if (typeof fetchOpts.body === "string" && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
			const ctrl = new AbortController();
			const timer = setTimeout(() => ctrl.abort(), timeout);
			let res;
			try {
				res = await fetch(api0.replace(/\/$/, "") + path, { ...fetchOpts, headers, signal: ctrl.signal });
			} catch (e) {
				if (e?.name === "AbortError") throw new Error("请求超时，请检查网络后重试");
				throw e;
			} finally {
				clearTimeout(timer);
			}
			let data = {};
			try {
				data = await res.json();
			} catch (_) {}
			if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
			return data;
		};

		const feedStatus = (html, isError) => {
			const f = feedEl();
			if (!f) return;
			f.innerHTML = `<div class="tea-feed__status${isError ? " tea-feed__status--error" : ""}">${html}</div>`;
			f.dataset.day = "";
			rt.seen.clear();
		};

		const hydrateProfile = () => {
			if (!rt.visitor || !rt.visitor.token) return;
			api("/api/profile").then((d) => {
				if (d && d.profile) {
					Object.assign(rt.visitor, d.profile);
					if (!rt.visitor.avatar && d.profile.avatarUrl) rt.visitor.avatar = d.profile.avatarUrl;
					store.identity = rt.visitor;
					renderSelf();
				}
			}).catch(() => {});
		};

		const loadHistory = async () => {
			feedStatus(`<span class="tea-spinner"></span> 正在看看大家聊到哪儿了…`);
			const histP = api(`/api/history?limit=60&room=${rt.room}`);
			const syncP = api(`/api/sync?room=${rt.room}&timeout=0`).catch(() => null);
			try {
				// 1. 先画历史记录，不被 sync 和在线名单阻塞
				const hist = await histP;
				feedStatus("");
				const f = feedEl();
				if (f) f.innerHTML = "";
				// 历史重画前一定清掉判重表，避免“DOM 已空、seen 还有”时整段历史被跳过。
				rt.seen.clear();
				const msgs = [...(hist.messages || [])];
				msgs.sort((a, b) => a.ts - b.ts);
				rt.messages = msgs;
				const seen = new Set(msgs.map((m) => m.id));
				if (!msgs.length) {
					feedStatus(`<div class="tea-empty"><b>茶室里还没人说话</b><span>要不你先开个话头？</span></div>`);
				} else {
					for (const m of msgs) renderMessage({ ...m, scroll: false });
					applyRedactions(hist.redactions || []);
					markUnreadDivider();
					scrollBottom(false);
				}
				setConn("live");

				// 2. 登录资料随后补，不阻塞历史
				hydrateProfile();

				// 3. 合并初始 sync 的最新消息
				const sync = await syncP;
				if (sync) {
					const fresh = (sync.messages || []).filter((m) => !seen.has(m.id));
					if (fresh.length) {
						rt.messages = [...rt.messages, ...fresh].sort((a, b) => a.ts - b.ts);
						const stick = atBottom();
						for (const m of fresh) renderMessage({ ...m, scroll: false });
						applyRedactions(sync.redactions || []);
						if (stick) scrollBottom(false);
					}
					rt.since = sync.next || null;
				}
				startLoop();

				// 4. 在线名单
				await loadRoom();
				// 5. 房间头像等次要内容
				syncRoomAvatars();
			} catch (e) {
				feedStatus(
					`<b>茶室暂时打不开</b><span>${esc(e.message || "网络异常")}</span><button type="button" class="tea-btn tea-btn--ghost" data-tea-retry>重试</button>`,
					true,
				);
				setConn("down", "连接失败");
				const btn = q("[data-tea-retry]");
				if (btn) btn.addEventListener("click", () => {
					showError("");
					loadHistory();
				});
			}
		};

		// 标题栏头像不写死：直接复用当前房间在列表里的头像，
		// 列表拿到 Matrix 房间真实头像后，标题栏也跟着换。
		const syncBarAvatar = () => {
			const bar = document.querySelector("[data-tea-bar-avatar]");
			const roomImg = document.querySelector(`[data-room-avatar="${rt.room}"]`);
			if (!bar || !roomImg) return;
			const src = roomImg.getAttribute("src");
			if (!src || bar.getAttribute("src") === src) return;
			bar.onerror = () => {
				bar.onerror = null;
				bar.src = rt.room === "chat" ? "/assets/images/room-chat.webp" : "/assets/images/room-lobby.webp";
			};
			bar.src = src;
		};

		const applyRoomAvatar = (key, avatar) => {
			if (!avatar) return;
			const img = document.querySelector(`[data-room-avatar="${key}"]`);
			if (!img || img.dataset.avatarApplied === "1") return;
			img.dataset.avatarApplied = "1";
			img.onerror = () => {
				img.onerror = null;
				img.src = key === "chat" ? "/assets/images/room-chat.webp" : "/assets/images/room-lobby.webp";
				if (key === rt.room) syncBarAvatar();
			};
			img.addEventListener("load", () => {
				if (key === rt.room) syncBarAvatar();
			});
			img.src = avatar;
			if (key === rt.room) syncBarAvatar();
		};

		// 房间列表头像：优先用 Matrix 房间真实头像，加载不出来回退到本地副本
		const syncRoomAvatars = async () => {
			for (const key of Object.keys(ROOMS)) {
				try {
					const data = await api(`/api/room?room=${key}&light=1`);
					applyRoomAvatar(key, data.room && data.room.avatar);
				} catch (_) {}
			}
		};

		const loadRoom = async () => {
			try {
				const data = await api(`/api/room?room=${rt.room}`);
				renderMembers(data.members || []);
				applyRoomAvatar(rt.room, data.room && data.room.avatar);
			} catch (_) {}
		};

		// 长轮询：一次请求没新消息就在服务端挂着等（最多 30 秒），有消息立刻返回，
		// 不再每 3 秒打一发；失败才退避重试，避免断网时狂刷请求。
		const SYNC_WAIT = 30_000;
		const poll = async () => {
			let delay = 300;
			const gen = rt.gen || 0;
			if (!root()) return;
			try {
				const t0 = Date.now();
				const data = await api(
					`/api/sync?room=${rt.room}&timeout=${SYNC_WAIT}` + (rt.since ? `&since=${encodeURIComponent(rt.since)}` : ""),
					{ timeout: SYNC_WAIT + 15_000 },
				);
				// 旧版后端不认 timeout 参数会「秒回」；空返回太快时退回 3 秒间隔，防止请求风暴
				if (Date.now() - t0 < 1000 && !(data.messages || []).length && !(data.redactions || []).length && !Object.keys(data.receipts || {}).length)
					delay = 3000;
				rt.pollFails = 0;
				if (data.next) rt.since = data.next;
				renderTyping(data.typing || []);
				if (data.reactions) {
					for (const [id, rs] of Object.entries(data.reactions)) {
						const el = feedEl()?.querySelector(`.tea-msg[data-id="${CSS.escape(id)}"]`);
						if (!el) continue;
						const old = el.querySelector(".tea-msg__reactions");
						const box = document.createElement("div");
						box.innerHTML = renderReactions({ reactions: rs });
						const fresh = box.firstElementChild;
						if (old && fresh) old.replaceWith(fresh);
						else if (fresh) el.querySelector(".tea-msg__text")?.appendChild(fresh);
						// 投票消息：票数随 reaction 同步刷新
						if (el.dataset.poll) {
							try {
								const poll = JSON.parse(el.dataset.poll);
								const oldCard = el.querySelector(".tea-poll-card");
								const cb = document.createElement("div");
								cb.innerHTML = renderPollCard(poll, rs, el.dataset.id);
								if (oldCard && cb.firstElementChild) oldCard.replaceWith(cb.firstElementChild);
							} catch (_) {}
						}
					}
				}
				const list = data.messages || [];
				if (list.length || (data.redactions || []).length) {
					const stick = atBottom();
					rt.messages = (rt.messages || []).concat(list).slice(-120);
					for (const m of list) {
						renderMessage({ ...m, scroll: false });
						noteIncoming(m);
					}
					applyRedactions(data.redactions || []);
					if (stick) scrollBottom(true);
					else {
						const jump = q("[data-tea-jump]");
						if (jump) jump.hidden = false;
					}
				}
				if (data.receipts) applyReceipts(data.receipts);
				setConn("live");
				if (!rt.rosterAt || Date.now() - rt.rosterAt > 30_000) {
					rt.rosterAt = Date.now();
					loadRoom();
				}
			} catch (_) {
				setConn("down", "连接中断");
				rt.pollFails = (rt.pollFails || 0) + 1;
				delay = Math.min(30_000, rt.pollFails * 3000);
			}
			if (gen === rt.gen) rt.timer = setTimeout(poll, delay);
		};

		const startLoop = () => {
			// 换房/重连会再次 startLoop：递增代数让旧轮询链自然停掉，避免两条链同时挂着
			clearTimeout(rt.timer);
			rt.gen = (rt.gen || 0) + 1;
			poll();
		};

		// ── 发送 ─────────────────────────────────────────────────
		// 规范（Transaction identifiers）：同一 txnId 重传必须幂等，
		// 所以重试要复用同一条消息的 txnId，否则会重复发出两条。
		const newTxn = (kind) => `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
		const sendText = async (text, node, threadRoot = "", threadLatest = "", txnId = "") => {
			const v = rt.visitor;
			if (!v) return;
			const txn = txnId || newTxn("web");
			let target = node;
			if (!target && !threadRoot) {
				const ts = Date.now();
				renderMessage({ id: "tmp-" + ts, ts, sender: v.id, nick: v.nick, site: SITE_NAME, avatar: v.avatar, text, self: true, pending: true });
				target = feedEl().querySelector(`.tea-msg[data-id="tmp-${ts}"]`);
			}
			try {
				const res = await api(`/api/send?room=${rt.room}`, {
					method: "POST",
					body: JSON.stringify({ text, replyTo: threadRoot ? "" : (rt.replyTo?.id || ""), threadRoot, threadLatest, txnId: txn }),
				});
				if (threadRoot && rt.refreshThreads) rt.refreshThreads();
				sendTyping(false);
				if (rt.setReply) rt.setReply(null);
				if (target) {
					target.classList.remove("tea-msg--pending", "tea-msg--failed");
					if (res.id) {
						target.dataset.id = res.id;
						// 按钮上的 data-id 同步成真实 event id，否则撤回/回应拿到 tmp-xxx
						target.querySelectorAll("[data-id]").forEach((b) => { b.dataset.id = res.id; });
						rt.seen.add(res.id);
					}
					const old = target.querySelector(".tea-msg__retry");
					if (old) old.remove();
				}
				store.bump();
				const c = q("[data-tea-me-count]");
				if (c) c.textContent = String(store.count);
			} catch (e) {
				const msg = e.message || "";
				if (msg.includes("还没入座") || msg.includes("401")) {
					rt.visitor = null;
					store.identity = null;
					renderSelf();
					setGate(false);
					if (target) target.remove();
					openDialog();
					return;
				}
				if (target) {
					target.classList.remove("tea-msg--pending");
					target.classList.add("tea-msg--failed");
					const old = target.querySelector(".tea-msg__retry");
					if (old) old.remove();
					const retry = document.createElement("button");
					retry.type = "button";
					retry.className = "tea-msg__retry";
					retry.textContent = "发送失败：" + (e.message || "网络异常") + "，点此重试";
					retry.addEventListener("click", () => {
						target.remove();
						sendText(text, null, threadRoot, threadLatest, txn);
					});
					target.querySelector(".tea-msg__body").appendChild(retry);
				}
			}
		};

		// ── 图片 / 表情包 ────────────────────────────────────────
		const sendImage = async (blob, { emoticon = false, name = "图片" } = {}) => {
			const v = rt.visitor;
			if (!v) {
				openDialog();
				return;
			}
			const ts = Date.now();
			const localUrl = URL.createObjectURL(blob);
			renderMessage({
				id: "tmp-" + ts, ts, sender: v.id, nick: v.nick, site: SITE_NAME, avatar: v.avatar,
				image: localUrl, emoticon, text: "", self: true, pending: true,
			});
			const target = feedEl().querySelector(`.tea-msg[data-id="tmp-${ts}"]`);
			try {
				const fd = await blob.arrayBuffer();
				const up = await api(`/api/upload`, { method: "POST", body: fd, headers: { "Content-Type": blob.type || "image/png" }, timeout: 60_000 });
				// 发一条带图片的消息：后端 send 目前只发 text，这里用 body 携带 mxc
				const res = await api(`/api/send?room=${rt.room}`, {
					method: "POST",
					body: JSON.stringify({ text: "", imageUrl: up.url, filename: name, emoticon }),
				});
				if (target) {
					target.classList.remove("tea-msg--pending", "tea-msg--failed");
					if (res.id) {
						target.dataset.id = res.id;
						// 按钮上的 data-id 同步成真实 event id，否则撤回/回应拿到 tmp-xxx
						target.querySelectorAll("[data-id]").forEach((b) => { b.dataset.id = res.id; });
						rt.seen.add(res.id);
					}
					const old = target.querySelector(".tea-msg__retry");
					if (old) old.remove();
				}
				store.bump();
				const c = q("[data-tea-me-count]");
				if (c) c.textContent = String(store.count);
			} catch (e) {
				if (target) {
					target.classList.remove("tea-msg--pending");
					target.classList.add("tea-msg--failed");
					const retry = document.createElement("button");
					retry.type = "button";
					retry.className = "tea-msg__retry";
					retry.textContent = "发送失败：" + (e.message || "网络异常") + "，点此重试";
					retry.addEventListener("click", () => {
						target.remove();
						sendImage(blob, { emoticon, name });
					});
					target.querySelector(".tea-msg__body").appendChild(retry);
				}
			} finally {
				setTimeout(() => URL.revokeObjectURL(localUrl), 30_000);
			}
		};

		const EMOTICON_SETS = [
			{
				id: "unicode", name: "Emoji", unicode: true,
				items: [
					"😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","😚","😙",
					"😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🤐","🤨","😐","😑","😶","😏","😒","🙄","😬","🤥",
					"😌","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🤮","🤧","🥵","🥶","🥴","😵","🤯","🤠","🥳","😎","🤓",
					"🧐","🤓","😕","😟","🙁","😮","😯","😲","😳","🥺","😦","😧","😨","😰","😥","😢","😭","😱","😖","😣",
					"😞","😓","😩","😫","🥱","😤","😡","😠","🤬","😈","👿","💀","🤡","👻","👽","🤖","💩","😺","😸","😹",
					"😻","😼","😽","🙀","😿","🙈","🙉","🙊","👶","🧒","👦","👧","👨","👩","🧑","👴","👵","👮","👷","💂",
					"🕵️","🧙","🧚","🧛","👨‍🎤","👩‍🎤","🤵","👰","🙋","🙇","🤦","🤷","💪","👏","🙌","👍","👎","✌️","🤞","🤟",
					"🤘","👌","👈","👉","👆","👇","☝️","✍️","🙏","💅","🤳","💃","🕺","🫰","🧡","💛","💚","💙","💜","🖤",
					"❤️","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💯","💢","💥","💫","💦","💨","🕳️","💣","🔥","🌟",
					"✨","⚡","☀️","🌈","☁️","🌙","⭐","🍎","🍊","🍋","🍉","🍇","🍓","🍑","🥝","🍍","🥑","🍔","🍟","🍕",
					"🌮","🍜","🍣","🍰","🍩","🍪","☕","🍵","🍺","🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁",
					"🐮","🐷","🐸","🐵","🐔","🐧","🐦","🐤","🦆","🦉","🐴","🦄","🐝","🦋","🐌","🐙","🐳","🐬","🌵","🌸",
				],
			},
			{ id: "qq", name: "QQ", base: "/assets/emojis/qq/", prefix: "qq_", info: "/assets/emojis/qq.json" },
			{ id: "bili", name: "B站", base: "/assets/emojis/bilibili/", prefix: "bb_", info: "/assets/emojis/bilibili.json" },
		];
		// 表情标记：图片表情写成 [emoji:qq:smile]，发送后由 fmtText 渲染回图片
		const EMOJI_TAG_RE = /\[emoji:(qq|bili):([\w-]+)\]/g;
		const renderEmojiTags = (html) =>
			html.replace(EMOJI_TAG_RE, (_, set, name) => {
				const src = set === "qq"
					? `/assets/emojis/qq/qq_${name}.gif`
					: `/assets/emojis/bilibili/bb_${name}.png`;
				return `<img src="${src}" alt="${name}" class="tea-inline-emoji" loading="lazy" />`;
			});
		const emojiCache = new Map();

		const loadEmojiSet = async (set) => {
			if (set.unicode) return set.items.map((ch) => ({ name: ch, char: ch }));
			if (emojiCache.has(set.id)) return emojiCache.get(set.id);
			const p = fetch(set.info)
				.then((r) => (r.ok ? r.json() : Promise.reject(new Error("加载失败"))))
				.then((info) => {
					const items = (info.items || []).slice(0, 60);
					return items.map((it) => ({ name: it, url: `${set.base}${set.prefix}${it}.${info.type || "png"}` }));
				});
			emojiCache.set(set.id, p);
			return p;
		};

		const renderEmojiPanel = async (setId) => {
			const panel = q("[data-tea-emoji-panel]");
			if (!panel) return;
			const set = EMOTICON_SETS.find((s) => s.id === setId) || EMOTICON_SETS[0];
			panel.innerHTML = `<div class="tea-emoji-panel__tabs">${EMOTICON_SETS
				.map((s) => `<button type="button" class="tea-emoji-panel__tab${s.id === set.id ? " is-active" : ""}" data-emoji-set="${s.id}">${s.name}</button>`)
				.join("")}</div><p class="tea-emoji-panel__msg">正在加载表情…</p>`;
			try {
				const items = await loadEmojiSet(set);
				const grid = panel.querySelector(".tea-emoji-panel__grid") || document.createElement("div");
				grid.className = "tea-emoji-panel__grid";
			grid.innerHTML = items
				.map((it) =>
					it.char
						? `<button type="button" class="tea-emoji-char" title="${esc(it.name)}" data-emoji-char="${esc(it.char)}">${esc(it.char)}</button>`
						: `<img src="${esc(it.url)}" alt="${esc(it.name)}" title="${esc(it.name)}" loading="lazy" data-emoji-set-id="${set.id}" data-emoji-name="${esc(it.name)}" data-emoji-url="${esc(it.url)}" />`,
				)
				.join("");
				const msg = panel.querySelector(".tea-emoji-panel__msg");
				if (msg) msg.remove();
				panel.appendChild(grid);
			} catch (e) {
				const msg = panel.querySelector(".tea-emoji-panel__msg");
				if (msg) msg.textContent = "表情加载失败，点右上角重试";
			}
		};

		// ── 正在输入 ────────────────────────────────────────────
		// 规范（Typing Notifications）：typing 是短时状态，服务器 20 秒过期；
		// 客户端在持续输入时要周期性续期（留 5 秒安全边际），停止输入要主动置 false。
		const TYPING_RENEW = 12_000;
		const stopTyping = () => {
			if (rt.typingTimer) {
				clearInterval(rt.typingTimer);
				rt.typingTimer = 0;
			}
		};
		const sendTyping = (active) => {
			const v = rt.visitor;
			if (!v) return;
			if (!active) stopTyping();
			api(`/api/typing?room=${rt.room}`, {
				method: "POST",
				body: JSON.stringify({ active }),
			}).catch(() => {});
		};
		const keepTyping = () => {
			const input = q("[data-tea-text]");
			if (!input || !input.value.trim() || document.visibilityState !== "visible") {
				sendTyping(false);
				return;
			}
			sendTyping(true);
		};
		const startTyping = () => {
			if (!rt.typingTimer) rt.typingTimer = setInterval(keepTyping, TYPING_RENEW);
		};
		rt.stopTyping = stopTyping;

		const renderTyping = (users) => {
			const box = q("[data-tea-typing]");
			const text = q("[data-tea-typing-text]");
			if (!box || !text) return;
			const list = Array.isArray(users) ? users.filter(Boolean) : [];
			if (!list.length) {
				box.hidden = true;
				return;
			}
			const names = list.slice(0, 3).join("、") + (list.length > 3 ? " 等人" : "");
			text.textContent = `${names} 正在输入…`;
			box.hidden = false;
		};

		// ── 交互 ─────────────────────────────────────────────────
		const openDialog = () => {
			const dlg = document.querySelector("[data-tea-dialog]");
			const form = document.querySelector("[data-tea-identity]");
			if (!dlg || !form) return;
			const v = rt.visitor;
			if (v) {
				form.elements.nick.value = v.nick || "";
				form.elements.email.value = v.email || "";
				form.elements.website.value = v.website || "";
				updatePreview();
			}
			showForm("identity");
			if (typeof dlg.showModal === "function") dlg.showModal();
		};

		const updatePreview = () => {
			const form = document.querySelector("[data-tea-identity]");
			if (!form) return;
			const nick = (form.elements.nick.value || "").trim();
			const av = document.querySelector("[data-tea-preview-avatar]");
			const name = document.querySelector("[data-tea-preview-name]");
			if (av) {
				av.textContent = nick ? initials(nick) : "?";
				av.setAttribute("style", nick ? avatarStyle(nick, SITE_NAME) : "");
			}
			if (name) name.textContent = nick ? `${nick} · ${SITE_NAME}` : "还没填昵称";
		};

		const applyIdentity = (res, extra = {}) => {
			if (!res || !res.user || !res.token) throw new Error("返回数据不完整");
			rt.visitor = {
				id: res.user.id,
				nick: res.user.nick,
				avatar: res.user.avatar || "",
				email: extra.email || "",
				website: extra.website || "",
				token: res.token,
			};
			store.identity = rt.visitor;
			renderSelf();
			setGate(true);
			const dlg = document.querySelector("[data-tea-dialog]");
			if (dlg) dlg.close();
			const ta = q("[data-tea-text]");
			if (ta) ta.focus();
		};

		const showForm = (which) => {
			const forms = {
				identity: document.querySelector("[data-tea-identity]"),
				waline: document.querySelector("[data-tea-waline]"),
				matrix: document.querySelector("[data-tea-matrix]"),
			};
			for (const [k, f] of Object.entries(forms)) if (f) f.hidden = k !== which;
			const active = forms[which];
			if (active) {
				const first = active.querySelector("input:not([readonly])");
				if (first) setTimeout(() => first.focus(), 60);
			}
		};

		const submitWaline = async (e) => {
			e.preventDefault();
			const form = document.querySelector("[data-tea-waline]");
			if (!form) return;
			const email = (form.elements.email.value || "").trim();
			const password = form.elements.password.value || "";
			const err = document.querySelector("[data-tea-waline-error]");
			const btn = document.querySelector("[data-tea-waline-submit]");
			const label = btn ? btn.querySelector("[data-tea-waline-label]") : null;
			if (err) err.hidden = true;
			if (btn) btn.disabled = true;
			if (label) label.textContent = "正在登录…";
			try {
				const res = await api("/api/waline", { method: "POST", body: JSON.stringify({ email, password }) });
				applyIdentity(res, { email });
			} catch (e2) {
				if (err) {
					err.textContent = e2.message || "登录失败";
					err.hidden = false;
				}
			} finally {
				if (btn) btn.disabled = false;
				if (label) label.textContent = "登录并进入";
			}
		};

		const submitMatrix = async (e) => {
			e.preventDefault();
			const form = document.querySelector("[data-tea-matrix]");
			if (!form) return;
			const homeserver = (form.elements.homeserver.value || "").trim();
			const username = (form.elements.username.value || "").trim();
			const password = form.elements.password.value || "";
			const err = document.querySelector("[data-tea-matrix-error]");
			const btn = document.querySelector("[data-tea-matrix-submit]");
			const label = btn ? btn.querySelector("[data-tea-matrix-label]") : null;
			if (err) err.hidden = true;
			if (btn) btn.disabled = true;
			if (label) label.textContent = "正在登录…";
			try {
				const res = await api("/api/matrix-login", {
					method: "POST",
					body: JSON.stringify({ homeserver, username, password }),
				});
				applyIdentity(res, { email: "" });
			} catch (e2) {
				if (err) {
					err.textContent = e2.message || "登录失败";
					err.hidden = false;
				}
			} finally {
				if (btn) btn.disabled = false;
				if (label) label.textContent = "登录并进入";
			}
		};

		const submitIdentity = async (e) => {
			e.preventDefault();
			const form = document.querySelector("[data-tea-identity]");
			if (!form) return;
			const nick = (form.elements.nick.value || "").trim();
			const email = (form.elements.email.value || "").trim();
			const website = (form.elements.website.value || "").trim();
			const err = document.querySelector("[data-tea-dialog-error]");
			const btn = document.querySelector("[data-tea-submit]");
			if (!nick) {
				if (err) {
					err.textContent = "昵称不能为空";
					err.hidden = false;
				}
				return;
			}
			if (err) err.hidden = true;
			if (btn) {
				btn.disabled = true;
				const label = btn.querySelector("[data-tea-submit-label]");
				if (label) label.textContent = "正在给你开座位…";
			}
			try {
				const res = await api("/api/enter", {
					method: "POST",
					body: JSON.stringify({ nick, email, website }),
				});
				applyIdentity(res, { email, website });
			} catch (e2) {
				if (err) {
					err.textContent = e2.message || "开座位失败，稍后再试";
					err.hidden = false;
				}
			} finally {
				if (btn) {
					btn.disabled = false;
					const label = btn.querySelector("[data-tea-submit-label]");
					if (label) label.textContent = "进入茶室";
				}
			}
		};

		// ── 点歌台 v2：全网搜索 + 共享队列 + 轮播 + 同步收听 ──────────
		const jukeSig = {
			tab: "lyrics",
			queueTab: "request",
			room: "",
			state: null,
			catalog: [],
			query: "",
			source: "site",
			searchList: [],
			searchState: "idle",
			searchError: "",
			playlists: [],
			playlistsLoaded: false,
			playlistsLoading: false,
			playlistsRoom: "",
			playlistId: "site",
			playlistLoadedId: "",
			playlistTracks: [],
			playlistLoading: false,
			rotationFull: null,
			rotationLoading: false,
			listening: false,
			ending: false,
			loading: false,
			lastUid: "",
			lastSeq: -1,
			currentKey: "",
			loadingUid: "",
			// 用户拖过进度条后，本机以本地进度为准，不再每 2 秒被房间里
			// 的墙钟位置拽回去；换一首歌时自动恢复同步。
			manualSeek: false,
			seeking: false,
			seekAt: 0,
			switching: false,
			stateEpoch: 0,
			directUrl: "",
			proxyUrl: "",
			proxyTried: false,
			stallTimer: 0,
			lyrics: [],
			lrcIndex: -2,
			loadToken: 0,
			notice: "",
			noticeError: false,
			noticeTimer: 0,
			clock: [],
			clockAt: 0,
			listSig: "",
			rotationSig: "",
		};
		// 同页脚本被 swup 重跑时，用代次让旧闭包的在途请求失效。
		let jukeGen = 0;

		const musicApi = () => (window.__fireflyMusic ? window.__fireflyMusic : null);
		// 点歌台开始出声时，把站点的背景播放器按掉，避免两套音源叠在一起。
		const jukeStopBgm = () => {
			const m = musicApi();
			if (m && m.getState().isPlaying) m.togglePlay();
		};
		const jukeNode = (sel) => (root() ? root().querySelector("[data-tea-juke] " + sel) : null);
		const jukeDur = (n) => {
			const sec = Math.max(0, Math.round(Number(n) || 0));
			return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
		};
		const jukeSourceLabel = (t) => {
			const src = t?.source || "";
			if (src === "qq") return "QQ";
			if (src === "netease") return "网易云";
			if (src === "kugou") return "酷狗";
			if (src === "local" || src === "site") return "本站";
			const p = String(t?.platform || "").toLowerCase();
			if (p.includes("apple")) return "Apple";
			if (p.includes("spotify")) return "Spotify";
			if (p.includes("youtube")) return "YouTube";
			if (p.includes("qq")) return "QQ";
			if (p.includes("netease")) return "网易云";
			if (p.includes("kugou")) return "酷狗";
			return "音源";
		};
		const jukeSafeUrl = (u) => String(u || "").replace(/["\\\n\r()]/g, "");
		const jukeCover = (url) => (url ? `url("${jukeSafeUrl(url)}")` : "");

		const jukeClock = {
			add(serverNow, t0, t1) {
				const server = Number(serverNow) || 0;
				const rtt = t1 - t0;
				if (!server || rtt < 0 || rtt > 5000) return;
				jukeSig.clock.push({ server, local: (t0 + t1) / 2, rtt });
				jukeSig.clock.sort((a, b) => a.rtt - b.rtt);
				jukeSig.clock = jukeSig.clock.slice(0, 6);
			},
			now() {
				const best = jukeSig.clock[0];
				if (!best) return Date.now();
				return best.server + (performance.now() - best.local);
			},
		};

		const jukeSampleClock = async () => {
			const t0 = performance.now();
			try {
				const data = await api("/api/juke/time", { timeout: 5000 });
				jukeClock.add(data.serverNow, t0, performance.now());
			} catch (_) {}
		};

		const jukeSay = (msg, isError = false) => {
			jukeSig.notice = msg || "";
			jukeSig.noticeError = !!isError;
			const el = jukeNode("[data-juke-notice]");
			if (el) {
				el.textContent = msg || "";
				el.hidden = !msg;
				el.classList.toggle("is-error", !!isError);
			}
			clearTimeout(jukeSig.noticeTimer);
			if (msg) jukeSig.noticeTimer = setTimeout(() => jukeSay(""), 8000);
		};

		const jukeParseLrc = (text) => {
			const out = [];
			const reg = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
			for (const line of String(text || "").split(/\r?\n/)) {
				const matches = [...line.matchAll(reg)];
				if (!matches.length) continue;
				const body = line.replace(reg, "").trim();
				if (!body) continue;
				for (const m of matches) {
					const frac = m[3] ? Number(`0.${m[3]}`) : 0;
					out.push({ time: Number(m[1]) * 60 + Number(m[2]) + frac, text: body });
				}
			}
			return out.sort((a, b) => a.time - b.time);
		};

		const jukeCatalog = () => {
			const m = musicApi();
			if (!m) return [];
			if (!m.getState().initialized && !m.getState().error) {
				try { m.init(); } catch (_) {}
			}
			const st = m.getState();
			jukeSig.catalog = (st.playlist || []).map((t, i) => {
				const url = String(t.url || "");
				const idm = url.match(/[?&]id=(\d+)/);
				const id = idm ? idm[1] : String(t.id || "");
				const netease = /^\d+$/.test(id);
				return {
					key: netease ? `netease:${id}` : `site:${i}`,
					title: t.name || "未知曲目",
					artist: t.artist || "",
					album: "",
					cover: t.pic || "",
					durationSec: 0,
					source: netease ? "netease" : /^\/assets\//.test(url) ? "local" : "",
					sourceId: netease ? id : "",
					url: url.startsWith("/assets/") ? url : "",
					platform: "site",
				};
			}).filter((t) => t.title);
			return jukeSig.catalog;
		};

		const jukeTrackRow = (t, i, attr, curKey) => `<button type="button" class="tea-song${curKey && curKey === t.key ? " is-current" : ""}" ${attr}>
			<span class="tea-song__idx">${curKey === t.key ? "♪" : i + 1}</span>
			<span class="tea-song__copy">
				<span class="tea-song__name"><span>${esc(t.title)}</span><em class="tea-juke__src">${esc(jukeSourceLabel(t))}</em><span class="tea-juke__dur">${t.durationSec ? jukeDur(t.durationSec) : ""}</span></span>
				<span class="tea-song__artist">${esc(t.artist || "未知歌手")}${t.requester ? " · " + esc(t.requester) : ""}</span>
			</span>
		</button>`;

		const jukeQueueRow = (t, curKey) => {
			const mine = rt.visitor && t.requesterId && t.requesterId === rt.visitor.id;
			const canDel = mine || !!(jukeSig.state && jukeSig.state.admin);
			return `<div class="tea-juke__qrow${curKey === t.key ? " is-current" : ""}">
				<button type="button" class="tea-song" data-juke-qplay="${esc(t.uid)}">
					<span class="tea-song__idx">♪</span>
					<span class="tea-song__copy">
						<span class="tea-song__name"><span>${esc(t.title)}</span><em class="tea-juke__src">${esc(jukeSourceLabel(t))}</em><span class="tea-juke__dur">${t.durationSec ? jukeDur(t.durationSec) : ""}</span></span>
						<span class="tea-song__artist">${esc(t.artist || "未知歌手")} · ${esc(t.requester || "茶友")}</span>
					</span>
				</button>
				${canDel ? `<button type="button" class="tea-juke__qact" data-juke-qdel="${esc(t.uid)}" title="移除" aria-label="移除">×</button>` : ""}
			</div>`;
		};

		const ensureJukeAudio = () => {
			let a = rt.jukeAudio;
			// swup 换页 / 脚本重复执行时可能留下没有登记的旧音频。
			// 它们不在 rt.jukeAudio 上，进度条和状态都管不到，却会继续出声，
			// 造成“两首歌一起播”。这里按标记把野音频全部清掉，只留一只。
			for (const el of document.querySelectorAll("audio[data-tea-juke-audio]")) {
				if (el === a) continue;
				try {
					el.pause();
					el.remove();
				} catch (_) {}
			}
			if (!a) {
				a = new Audio();
				a.dataset.teaJukeAudio = "1";
				a.preload = "auto";
				a.volume = Math.min(1, Math.max(0, Number(localStorage.getItem("tea.jukeVolume") ?? 0.7)));
				document.body.appendChild(a);
				rt.jukeAudio = a;
			} else if (!a.isConnected) {
				a.dataset.teaJukeAudio = "1";
				document.body.appendChild(a);
			}
			if (!rt.jukeAudioBound) {
				rt.jukeAudioBound = true;
				a.addEventListener("play", () => {
					if (rt.jukeAudio !== a) return;
					jukeStopBgm();
					jukeRenderTrack();
				});
				a.addEventListener("pause", () => jukeRenderTrack());
				a.addEventListener("timeupdate", () => {
					if (rt.jukeAudio !== a) return;
					jukeRenderProgress();
					if (jukeSig.tab === "lyrics") jukeRenderLyrics(false);
					jukeSetupPosition();
				});
				a.addEventListener("loadedmetadata", () => {
					if (rt.jukeAudio !== a) return;
					jukeRenderProgress();
					jukeSync(true);
				});
				a.addEventListener("canplay", () => {
					clearTimeout(jukeSig.stallTimer);
				});
				a.addEventListener("playing", () => {
					clearTimeout(jukeSig.stallTimer);
					a.playbackRate = 1;
					jukeRenderTrack();
				});
				a.addEventListener("waiting", () => {
					clearTimeout(jukeSig.stallTimer);
					jukeSig.stallTimer = setTimeout(() => {
						if (jukeSig.listening && !jukeSig.proxyTried && jukeSig.proxyUrl) jukeUseProxy();
					}, 3500);
				});
				a.addEventListener("volumechange", () => {
					try { localStorage.setItem("tea.jukeVolume", String(a.volume)); } catch (_) {}
					const vol = jukeNode("[data-juke-vol]");
					if (vol) vol.value = String(Math.round(a.volume * 100));
				});
				a.addEventListener("ended", () => {
					if (rt.jukeAudio !== a) return;
					if (!jukeSig.listening || !jukeSig.state?.current || jukeSig.ending) return;
					jukeSig.ending = true;
					const from = jukeSig.state.current.uid;
					jukeAction("ended", { from }).finally(() => setTimeout(() => { jukeSig.ending = false; }, 2500));
				});
				a.addEventListener("error", () => {
					if (rt.jukeAudio !== a) return;
					if (!jukeSig.listening || !jukeSig.state?.current) return;
					if (!jukeSig.proxyTried && jukeSig.proxyUrl) {
						jukeUseProxy();
						return;
					}
					jukeSay("这首歌的音源暂时播不了，换一首试试。", true);
				});
			}
			return a;
		};

		const jukeUseProxy = () => {
			const a = rt.jukeAudio;
			if (!a || !jukeSig.proxyUrl || jukeSig.proxyTried) return;
			jukeSig.proxyTried = true;
			const at = Number(a.currentTime) || 0;
			const wasPlaying = !a.paused;
			try { a.pause(); } catch (_) {}
			a.src = jukeSig.proxyUrl;
			const resume = () => {
				if (a !== rt.jukeAudio) return;
				const d = Number(a.duration);
				const to = Number.isFinite(d) && d > 0 ? Math.min(at, Math.max(0, d - 1)) : at;
				try { if (to > 0) a.currentTime = to; } catch (_) {}
				if (wasPlaying && jukeSig.listening) a.play().catch(() => {});
			};
			a.addEventListener("loadedmetadata", resume, { once: true });
			a.load();
			jukeSay("直连有点慢，已经切到代理线路。");
		};

		const jukeSetupPosition = () => {
			if (!("mediaSession" in navigator) || !("setPositionState" in navigator.mediaSession)) return;
			const a = rt.jukeAudio;
			if (!a || !a.duration || !isFinite(a.duration) || a.duration <= 0) return;
			try {
				navigator.mediaSession.setPositionState({
					duration: a.duration,
					playbackRate: a.playbackRate || 1,
					position: Math.min(Math.max(0, a.currentTime), a.duration),
				});
			} catch (_) {}
		};

		const jukeSetupMediaSession = (track) => {
			if (!("mediaSession" in navigator)) return;
			try {
				if (window.MediaMetadata) {
					navigator.mediaSession.metadata = new MediaMetadata({
						title: track?.title || "茶室点歌台",
						artist: track?.artist || "折腾进行时",
						album: "茶室点歌台",
						artwork: track?.cover ? [{ src: track.cover, sizes: "300x300" }] : [],
					});
				}
				navigator.mediaSession.setActionHandler("play", () => {
					const a = ensureJukeAudio();
					jukeSig.listening = true;
					const cur = jukeSig.state?.current;
					if (cur) jukePlayCurrent(cur);
					else a.play().catch(() => {});
				});
				navigator.mediaSession.setActionHandler("pause", () => {
					const a = rt.jukeAudio;
					if (a) a.pause();
				});
				navigator.mediaSession.setActionHandler("nexttrack", () => jukeSkip());
				navigator.mediaSession.setActionHandler("previoustrack", () => {
					const a = rt.jukeAudio;
					if (!a) return;
					jukeSig.manualSeek = true;
					jukeSig.seekAt = Date.now();
					a.currentTime = 0;
				});
				navigator.mediaSession.setActionHandler("seekto", (d) => {
					const a = rt.jukeAudio;
					if (!a || !d || !Number.isFinite(d.seekTime)) return;
					jukeSig.manualSeek = true;
					jukeSig.seekAt = Date.now();
					a.currentTime = d.seekTime;
				});
			} catch (_) {}
		};

		const jukeDuration = () => {
			const d = Number(rt.jukeAudio?.duration);
			return Number.isFinite(d) && d > 0 ? d : 0;
		};

		// 房间里的“现在放到哪了”：服务端记录 startAt，客户端按校准过的
		// 服务端时钟推算。为负说明这首歌还没正式开始，按 0 处理。
		const jukeLiveAt = (track) => {
			if (!track || !track.startAt) return 0;
			const at = (jukeClock.now() - Number(track.startAt)) / 1000;
			return Number.isFinite(at) ? Math.max(0, at) : 0;
		};

		// 这首歌在房间里已经越过结尾（典型场景：房间里没人听，current 停在
		// 上一首很久了）。此时绝不能把本地音频 seek 到 duration - 0.6，否则
		// 刚点播放就会“0 秒直接跳到结束”。改为从本地 0 秒开始，并暂停墙钟
		// 同步，让这一首完整播完；播完后照常上报 ended 推进房间队列。
		const jukeIsOver = (track) => {
			const d = jukeDuration();
			return d > 0 && jukeLiveAt(track) >= d - 1;
		};

		const jukeEnterLocal = (track, autoplay) => {
			const a = rt.jukeAudio;
			if (!a) return;
			const already = jukeSig.manualSeek;
			const shouldPlay = autoplay === undefined ? !a.paused : !!autoplay;
			jukeSig.manualSeek = true;
			try {
				a.pause();
				a.currentTime = 0;
				if (shouldPlay && jukeSig.listening) {
					a.play().catch(() => jukeSay("浏览器拦住了自动播放，点一下播放键继续。", true));
				}
			} catch (_) {}
			if (!already) jukeSay("这首歌在房间里已经放完了，先从本地从头播。");
		};

		const jukeSeekTo = (track, force) => {
			const a = rt.jukeAudio;
			if (!a || !track || !track.startAt) return;
			if (!force && jukeSig.manualSeek) return;
			const at = jukeLiveAt(track);
			if (jukeIsOver(track)) {
				jukeEnterLocal(track);
				return;
			}
			try {
				if (Math.abs(a.currentTime - at) > 0.4) a.currentTime = at;
			} catch (_) {}
		};

		const jukeSync = (force) => {
			const a = rt.jukeAudio;
			const cur = jukeSig.state?.current;
			if (!a || !cur || !jukeSig.listening || a.paused) return;
			// 用户正在拖进度条，或已经主动拖过：本机进度优先，别再每 2 秒
			// 按墙钟把人家拽回去。
			if (jukeSig.seeking || jukeSig.manualSeek) return;
			if (!Number(cur.startAt)) return;
			if (a.readyState < 2 || !isFinite(a.duration) || a.duration <= 0) return;
			const expected = jukeLiveAt(cur);
			if (expected >= a.duration - 1) {
				jukeEnterLocal(cur, true);
				return;
			}
			const diff = expected - a.currentTime;
			if (Math.abs(diff) > 3 || force) {
				const at = Math.min(Math.max(0, expected), Math.max(0, a.duration - 1));
				try { a.currentTime = at; } catch (_) {}
				a.playbackRate = 1;
			} else if (diff > 0.6) {
				a.playbackRate = 1.04;
			} else if (diff < -0.6) {
				a.playbackRate = 0.96;
			} else {
				a.playbackRate = 1;
			}
		};

		const jukePlayCurrent = async (track) => {
			if (!track || (jukeGen && rt.jukeGen !== jukeGen)) return;
			const a = ensureJukeAudio();
			const uid = track.uid || track.key || "";
			// 同一首的取链请求已经在路上，别因为状态轮询又发一次，
			// 否则后一次会把前一次的 token 顶掉，白白多绕一圈。
			if (jukeSig.loadingUid === uid) return;
			if (jukeSig.currentKey === track.key && a.src && !a.error) {
				// 同一首歌被轮播重新排到：startAt 会刷新，清掉本地进度锁；
				// 但同一 uid 的轮询不能清，否则用户刚拖的进度又被拽回去。
				if (jukeSig.currentUid !== uid) {
					jukeSig.currentUid = uid;
					jukeSig.manualSeek = false;
					jukeSig.seeking = false;
				}
				jukeSeekTo(track);
				if (a.paused) a.play().catch(() => {});
				return;
			}
			const token = ++jukeSig.loadToken;
			jukeStopBgm();
			try { a.pause(); } catch (_) {}
			// 先把“当前曲目”清掉：新音源还没接上之前，不能让后续轮询
			// 把这只还装着上一首歌的 audio 当成新歌继续播。
			jukeSig.currentKey = "";
			jukeSig.currentUid = "";
			jukeSig.manualSeek = false;
			jukeSig.seeking = false;
			jukeSig.seekAt = 0;
			jukeSig.directUrl = "";
			jukeSig.proxyUrl = "";
			jukeSig.proxyTried = false;
			jukeSig.lyrics = [];
			jukeSig.lrcIndex = -2;
			clearTimeout(jukeSig.stallTimer);
			jukeSig.loadingUid = uid;
			const params = new URLSearchParams();
			params.set("key", track.key || "");
			params.set("title", track.title || "");
			params.set("artist", track.artist || "");
			params.set("source", track.source || "");
			params.set("id", track.sourceId || "");
			params.set("duration", String(track.durationSec || 0));
			if (track.url) params.set("url", track.url);
			jukeSay("正在找音源…");
			try {
				const data = await api(`/api/juke/link?${params.toString()}`, { timeout: 20_000 });
				if (token !== jukeSig.loadToken || a !== rt.jukeAudio) {
					if (jukeSig.loadingUid === uid) jukeSig.loadingUid = "";
					return;
				}
				jukeSig.directUrl = data.direct || "";
				jukeSig.proxyUrl = data.proxy || "";
				jukeSig.proxyTried = data.url === data.proxy;
				jukeSig.lyrics = jukeParseLrc(data.lrc || "");
				jukeSay("");
				// 先把旧源停干净。只写 a.src 在部分浏览器里会等新源就绪才停，
				// 这段时间旧歌还在响；这里直接 pause + 换源，保证任一时刻只有一首。
				try { a.pause(); } catch (_) {}
				jukeSig.switching = true;
				a.src = data.url;
				jukeSig.currentKey = track.key;
				jukeSig.currentUid = uid;
				jukeSig.loadingUid = "";
				if (a.volume === 0 && Number(localStorage.getItem("tea.jukeVolume") ?? 0.7) > 0) {
					a.volume = Number(localStorage.getItem("tea.jukeVolume") ?? 0.7);
				}
				const start = Number(track.startAt) || 0;
				const wait = start ? Math.max(0, start - jukeClock.now()) : 0;
				const begin = () => {
					jukeSig.switching = false;
					if (token !== jukeSig.loadToken || a !== rt.jukeAudio) return;
					if (!jukeSig.listening) return;
					if (wait > 0) {
						setTimeout(() => {
							if (token === jukeSig.loadToken && a === rt.jukeAudio && jukeSig.listening) {
								jukeSeekTo(track);
								a.play().catch(() => {});
							}
						}, wait + 40);
						return;
					}
					// 房间里已经播过结尾的歌不要 seek 到结尾自杀，从头本地播。
					if (jukeIsOver(track)) {
						jukeEnterLocal(track, true);
						return;
					}
					jukeSeekTo(track);
					a.play().catch(() => {
						if (token !== jukeSig.loadToken || a !== rt.jukeAudio) return;
						jukeSay("浏览器拦住了自动播放，点一下播放键继续。", true);
					});
				};
				// 必须等新源自己的 metadata，不能拿上一首的 duration / readyState
				// 直接 begin，否则会按旧时长判断进度，甚至把新歌直接送到结尾。
				a.addEventListener("loadedmetadata", begin, { once: true });
				a.load();
				jukeSetupMediaSession(track);
				jukeRenderLyrics(true);
				jukeRenderTrack();
			} catch (e) {
				jukeSig.switching = false;
				if (token !== jukeSig.loadToken || a !== rt.jukeAudio) return;
				jukeSig.currentKey = "";
				jukeSig.currentUid = "";
				jukeSig.loadingUid = "";
				jukeSig.listening = false;
				jukeSay(e.message || "找不到可播的音源", true);
				jukeRenderTrack();
			}
		};

		const jukeListeners = () => {
			const el = q("[data-tea-online]");
			return Math.max(1, Number(el && el.textContent) || 1);
		};

		const jukeAction = async (action, extra = {}) => {
			if (action !== "ended" && (!rt.visitor || !rt.visitor.token)) {
				jukeSay("先入座，再点歌。", true);
				return null;
			}
			try {
				const data = await api(`/api/juke/action?room=${encodeURIComponent(rt.room)}`, {
					method: "POST",
					body: JSON.stringify({ action, room: rt.room, ...extra }),
				});
				if (data.state) {
					jukeSig.stateEpoch += 1;
					if (typeof data.admin === "boolean") data.state.admin = data.admin;
					jukeApply(data.state);
				}
				return data;
			} catch (e) {
				jukeSay(e.message || "操作失败，稍后再试", true);
				return null;
			}
		};

		const jukeSkip = async () => {
			const cur = jukeSig.state?.current;
			if (!cur) return;
			const data = await jukeAction("skip", { from: cur.uid, listeners: jukeListeners() });
			if (!data || !data.vote) return;
			if (data.vote.skipped) {
				jukeSay("切歌成功。");
			} else {
				const left = Math.max(0, Number(data.vote.required || 0) - Number(data.vote.votes || 0));
				jukeSay(`已投票切歌，${data.vote.votes}/${data.vote.required} 人同意，还差 ${left} 人。`);
			}
		};

		const jukePick = async (track) => {
			if (!track) return;
			const data = await jukeAction("enqueue", { track });
			if (!data) return;
			if (data.duplicate) jukeSay("这首歌已经在队列里了。");
			else if (data.state?.current?.key === track.key) jukeSay("这就开播。");
			else jukeSay("已加入待播队列。");
		};

		const jukeRenderProgress = () => {
			const a = rt.jukeAudio;
			const seek = jukeNode("[data-juke-seek]");
			const ct = jukeNode("[data-juke-cur]");
			const du = jukeNode("[data-juke-dur]");
			const cur = a ? a.currentTime : 0;
			const dur = a && isFinite(a.duration) ? a.duration : 0;
			const p = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;
			// 拖动中或刚拖完的一小段时间里，timeupdate 不能把滑块抢回去，
			// 否则手指还在拖、值已经被播放进度覆盖，松手就跳到别处。
			const hold = jukeSig.seeking || Date.now() - Number(jukeSig.seekAt || 0) < 600;
			if (seek && !hold) {
				seek.value = String(Math.round(p * 10));
				seek.style.setProperty("--p", p + "%");
			}
			if (ct) ct.textContent = jukeDur(cur);
			if (du) du.textContent = jukeDur(dur);
		};

		const jukeRenderTrack = () => {
			const a = rt.jukeAudio;
			const s = jukeSig.state;
			const cur = s && s.current;
			const playing = !!a && !a.paused && jukeSig.listening;
			const live = jukeNode("[data-juke-live]");
			const title = jukeNode("[data-juke-title]");
			const artist = jukeNode("[data-juke-artist]");
			const cover = jukeNode("[data-juke-cover]");
			if (title) title.textContent = cur ? cur.title : "还没开始听";
			if (artist) {
				artist.textContent = cur
					? `${cur.artist || "未知歌手"}${cur.kind === "rotation" ? " · 背景轮播" : cur.requester ? " · " + cur.requester + " 点的" : ""}`
					: "从下面挑一首，或者让茶室随便放";
			}
			if (cover) cover.style.backgroundImage = cur && cur.cover ? jukeCover(cur.cover) : "";
			if (live) {
				live.classList.toggle("is-listening", jukeSig.listening);
				live.classList.toggle("is-playing", playing);
				const label = live.querySelector("b");
				if (label) label.textContent = jukeSig.listening ? (playing ? "收听中" : "已加入") : "未开始";
			}
			const listenBtn = jukeNode("[data-juke-listen]");
			if (listenBtn) {
				listenBtn.classList.toggle("is-on", jukeSig.listening);
				listenBtn.title = jukeSig.listening ? "退出收听" : "开始收听";
			}
			const juke = root() ? root().querySelector("[data-tea-juke]") : null;
			if (juke) juke.classList.toggle("is-playing", playing);
			const playBtn = jukeNode("[data-juke-play]");
			if (playBtn) {
				const p = playBtn.querySelector("[data-juke-icon-play]");
				const q2 = playBtn.querySelector("[data-juke-icon-pause]");
				if (p) p.hidden = playing;
				if (q2) q2.hidden = !playing;
			}
			const vol = jukeNode("[data-juke-vol]");
			if (vol && a) vol.value = String(Math.round(a.volume * 100));
			jukeRenderProgress();
		};

		const jukeRenderLyrics = (force) => {
			const box = jukeNode("[data-juke-lyrics]");
			if (!box) return;
			const a = rt.jukeAudio;
			const cur = jukeSig.state?.current;
			const key = cur ? cur.key : "";
			if (!cur) {
				if (force || box.dataset.song !== "") {
					box.innerHTML = `<p class="tea-juke__empty">先挑一首歌吧。</p>`;
					box.dataset.song = "";
					box.dataset.empty = "1";
				}
				return;
			}
			if (!jukeSig.lyrics.length) {
				if (force || box.dataset.song !== key || box.dataset.empty !== "1") {
					box.innerHTML = `<p class="tea-juke__empty">这首歌暂时没有歌词。</p>`;
					box.dataset.song = key;
					box.dataset.empty = "1";
					jukeSig.lrcIndex = -2;
				}
				return;
			}
			if (force || box.dataset.song !== key || box.dataset.empty === "1") {
				box.innerHTML = jukeSig.lyrics
					.map((l, i) => `<button type="button" class="tea-lyric" data-lrc="${i}">${esc(l.text)}</button>`)
					.join("");
				box.dataset.song = key;
				box.dataset.empty = "0";
				jukeSig.lrcIndex = -2;
			}
			const t = a ? a.currentTime : 0;
			let idx = -1;
			for (let i = 0; i < jukeSig.lyrics.length; i++) {
				if (jukeSig.lyrics[i].time <= t + 0.12) idx = i;
				else break;
			}
			if (idx !== jukeSig.lrcIndex) {
				jukeSig.lrcIndex = idx;
				const lines = box.querySelectorAll(".tea-lyric");
				lines.forEach((line, i) => line.classList.toggle("is-current", i === idx));
				if (idx >= 0 && lines[idx] && a && !a.paused) lines[idx].scrollIntoView({ block: "center", behavior: "smooth" });
			}
		};

		const jukeRenderSearch = () => {
			const box = jukeNode("[data-juke-results]");
			if (!box) return;
			let list = [];
			if (jukeSig.source === "site") {
				const qtext = jukeSig.query.trim().toLowerCase();
				list = jukeCatalog().filter((t) => !qtext || (t.title + " " + t.artist).toLowerCase().includes(qtext));
				if (list.length > 60) list = list.slice(0, 60);
				jukeSig.searchList = list;
				box.innerHTML = list.length
					? list.map((t, i) => jukeTrackRow(t, i, `data-juke-pick="${i}"`, jukeSig.state?.current?.key)).join("")
					: `<p class="tea-juke__empty">${qtext ? `本站歌单里没找到「${esc(jukeSig.query)}」。` : "站点歌单还在路上…"}</p>`;
				return;
			}
			if (jukeSig.searchState === "loading") {
				box.innerHTML = `<p class="tea-juke__empty">正在翻 QQ / 网易云 / 酷狗的曲库…</p>`;
				return;
			}
			if (jukeSig.searchState === "error") {
				box.innerHTML = `<p class="tea-juke__empty">${esc(jukeSig.searchError || "搜索失败")}</p>`;
				return;
			}
			list = jukeSig.results || [];
			jukeSig.searchList = list;
			box.innerHTML = list.length
				? list.map((t, i) => jukeTrackRow(t, i, `data-juke-pick="${i}"`, jukeSig.state?.current?.key)).join("")
				: `<p class="tea-juke__empty">${jukeSig.searchState === "done" ? "没搜到，换个关键词试试。" : "搜全网歌曲，或者切到「本站」翻站点歌单。"}</p>`;
		};

		const jukeSearch = async () => {
			const qtext = jukeSig.query.trim();
			if (/^https?:\/\//i.test(qtext)) {
				jukeShowImport(true);
				const input = jukeNode("[data-juke-importurl]");
				if (input) input.value = qtext;
				jukeSay("看起来是歌单链接，点「导入」把它存进歌单。");
				return;
			}
			if (jukeSig.source === "site") {
				jukeRenderSearch();
				return;
			}
			if (!qtext) {
				jukeSay("想听什么？先输入歌名或歌手。");
				return;
			}
			jukeSig.searchState = "loading";
			jukeSig.searchError = "";
			jukeSig.results = [];
			jukeRenderSearch();
			try {
				const data = await api(`/api/juke/search?q=${encodeURIComponent(qtext)}&source=${encodeURIComponent(jukeSig.source)}&limit=14`, { timeout: 20_000 });
				jukeSig.results = data.items || [];
				jukeSig.searchState = "done";
				if (!jukeSig.results.length) jukeSay("没搜到，换个关键词试试。");
			} catch (e) {
				jukeSig.searchState = "error";
				jukeSig.searchError = e.message || "搜索失败";
			}
			jukeRenderSearch();
		};

		const jukeLoadPlaylists = async (force) => {
			if (jukeSig.playlistsLoading) return;
			if (jukeSig.playlistsLoaded && !force && jukeSig.playlistsRoom === rt.room) return;
			const room = rt.room;
			jukeSig.playlistsLoading = true;
			try {
				const data = await api(`/api/juke/playlists?room=${encodeURIComponent(room)}`);
				if (room !== rt.room) return;
				jukeSig.playlists = data.items || [];
				jukeSig.playlistsLoaded = true;
				jukeSig.playlistsRoom = room;
				if (data.rotation && jukeSig.state) jukeSig.state.rotation = data.rotation;
				if (jukeSig.playlistId !== "site" && !jukeSig.playlists.some((p) => p.id === jukeSig.playlistId)) {
					jukeSig.playlistId = "site";
				}
				jukeRenderList(true);
			} catch (_) {}
			finally {
				jukeSig.playlistsLoading = false;
			}
		};

		const jukeLoadPlaylist = async (id) => {
			id = id || "site";
			const room = rt.room;
			jukeSig.playlistId = id;
			jukeSig.playlistLoading = true;
			jukeSig.playlistTracks = [];
			jukeRenderList(true);
			if (id === "site") {
				jukeSig.playlistTracks = jukeCatalog();
				jukeSig.playlistLoadedId = "site";
				jukeSig.playlistLoading = false;
				jukeRenderList(true);
				return;
			}
			try {
				const data = await api(`/api/juke/playlist?room=${encodeURIComponent(room)}&id=${encodeURIComponent(id)}`, { timeout: 20_000 });
				if (jukeSig.playlistId !== id || room !== rt.room) return;
				jukeSig.playlistTracks = data.playlist?.tracks || [];
				jukeSig.playlistLoadedId = id;
			} catch (e) {
				jukeSay(e.message || "歌单加载失败", true);
			} finally {
				if (jukeSig.playlistId === id) {
					jukeSig.playlistLoading = false;
					jukeRenderList(true);
				}
			}
		};

		const jukeRenderList = (force) => {
			const bar = jukeNode("[data-juke-plbar]");
			const head = jukeNode("[data-juke-plhead]");
			const name = jukeNode("[data-juke-plname]");
			const rotBtn = jukeNode("[data-juke-pl-rotation]");
			const box = jukeNode("[data-juke-pltracks]");
			if (!bar || !box) return;
			if (!jukeSig.playlistsLoaded) {
				bar.innerHTML = "";
				box.innerHTML = `<p class="tea-juke__empty">正在读歌单…</p>`;
				jukeLoadPlaylists();
				return;
			}
			const items = [{ id: "site", name: "本站歌单", trackCount: jukeSig.catalog.length }, ...jukeSig.playlists];
			const sig = `${jukeSig.playlistId}|${items.map((x) => x.id + x.trackCount).join(",")}|${jukeSig.playlistTracks.length}|${jukeSig.state?.admin ? 1 : 0}|${jukeSig.state?.rotation?.playlistId || ""}`;
			if (!force && sig === jukeSig.listSig) return;
			jukeSig.listSig = sig;
			bar.innerHTML = items
				.map((p) => `<button type="button" class="${p.id === jukeSig.playlistId ? "is-active" : ""}" data-juke-pl="${esc(p.id)}" title="${esc(p.name)}">${esc(p.name)}</button>`)
				.join("");
			const selected = items.find((p) => p.id === jukeSig.playlistId) || items[0];
			if (head) head.hidden = selected.id === "site";
			if (name) name.textContent = selected.name || "歌单";
			if (rotBtn) {
				const canRotate = !!(jukeSig.state && jukeSig.state.admin);
				rotBtn.hidden = !canRotate || selected.id === "site";
				const isRot = jukeSig.state?.rotation?.playlistId === selected.id;
				rotBtn.textContent = isRot ? "取消轮播" : "设为轮播";
				rotBtn.dataset.rotationId = selected.id;
			}
			if (selected.id === "site") {
				const site = jukeCatalog();
				if (jukeSig.playlistLoadedId !== "site" || site.length !== jukeSig.playlistTracks.length) {
					jukeSig.playlistTracks = site;
					jukeSig.playlistLoadedId = "site";
				}
			}
			if (jukeSig.playlistLoading) {
				box.innerHTML = `<p class="tea-juke__empty">正在读「${esc(selected.name)}」…</p>`;
				return;
			}
			if (selected.id !== "site" && jukeSig.playlistLoadedId !== selected.id) {
				box.innerHTML = `<p class="tea-juke__empty">点一下歌单标签加载曲目。</p>`;
				return;
			}
			const list = jukeSig.playlistTracks;
			box.innerHTML = list.length
				? list.map((t, i) => jukeTrackRow(t, i, `data-juke-plpick="${i}"`, jukeSig.state?.current?.key)).join("")
				: `<p class="tea-juke__empty">这个歌单里还没有歌。</p>`;
		};

		const jukeLoadRotation = async (force) => {
			if (jukeSig.rotationLoading) return;
			if (!force && jukeSig.rotationFull && jukeSig.rotationFull.playlistId === jukeSig.state?.rotation?.playlistId) return;
			jukeSig.rotationLoading = true;
			try {
				const data = await api(`/api/juke/rotation?room=${encodeURIComponent(rt.room)}`);
				jukeSig.rotationFull = data.rotation || null;
			} catch (_) {
				jukeSig.rotationFull = null;
			} finally {
				jukeSig.rotationLoading = false;
				jukeRenderQueue(true);
			}
		};

		const jukeRenderQueue = (force) => {
			const box = jukeNode("[data-juke-queue]");
			const count = jukeNode("[data-juke-queuecount]");
			const s = jukeSig.state;
			const queue = (s && s.queue) || [];
			if (count) count.textContent = String(queue.length);
			if (!box) return;
			const kind = jukeSig.queueTab;
			if (kind === "request") {
				box.innerHTML = queue.length
					? queue.map((t) => jukeQueueRow(t, s?.current?.key)).join("")
					: `<p class="tea-juke__empty">点播队列空着，去歌单里挑一首。</p>`;
				return;
			}
			const rot = s && s.rotation;
			if (!rot) {
				box.innerHTML = `<p class="tea-juke__empty">还没有绑定背景轮播。站长可以在「歌单」里选一个导入歌单设为轮播。</p>`;
				return;
			}
			const full = jukeSig.rotationFull && jukeSig.rotationFull.playlistId === rot.playlistId ? jukeSig.rotationFull : null;
			const sig = `${rot.playlistId}|${rot.trackCount}|${full ? full.tracks.length : 0}|${s?.current?.key || ""}`;
			if (!force && sig === jukeSig.rotationSig) return;
			jukeSig.rotationSig = sig;
			const brief = `<div class="tea-juke__rotbrief">
				<b>${esc(rot.name)}</b>
				<p>${rot.trackCount} 首 · 点播队列空着时自动接着放</p>
				${full ? "" : `<button type="button" data-juke-rotation-load>查看全部</button>`}
			</div>`;
			if (!full) {
				box.innerHTML = brief + (rot.preview || []).map((t, i) => `<div class="tea-juke__qrow"><span class="tea-song"><span class="tea-song__idx">${i + 1}</span><span class="tea-song__copy"><span class="tea-song__name"><span>${esc(t.title)}</span></span><span class="tea-song__artist">${esc(t.artist || "未知歌手")}</span></span></span></div>`).join("");
				return;
			}
			box.innerHTML = brief + full.tracks.map((t, i) => jukeTrackRow(t, i, `data-juke-rotpick="${i}"`, s?.current?.key)).join("");
		};

		const jukeRenderHistory = () => {
			const box = jukeNode("[data-juke-history]");
			if (!box) return;
			const list = (jukeSig.state && jukeSig.state.history) || [];
			box.innerHTML = list.length
				? list.map((t, i) => jukeTrackRow(t, i, `data-juke-readd="${i}"`, "")).join("")
				: `<p class="tea-juke__empty">还没有播放记录。</p>`;
		};

		const jukeApply = (s) => {
			if (!s || (jukeGen && rt.jukeGen !== jukeGen)) return;
			if (!s.room) s.room = jukeSig.room || rt.room;
			const prev = jukeSig.state;
			// 轮询和点歌响应可能乱序回来。旧状态会把正在播的歌“倒回去”，
			// 甚至再触发一次切歌；用服务端 seq 丢掉比当前更旧的快照。
			if (prev && prev.room === s.room && Number(s.seq) > 0 && Number(prev.seq) > 0 && Number(s.seq) < Number(prev.seq)) {
				return;
			}
			if (jukeSig.room !== s.room) {
				jukeSig.room = s.room;
				jukeSig.lastUid = "";
				jukeSig.playlistsLoaded = false;
				jukeSig.playlistsLoading = false;
				jukeSig.playlistId = "site";
				jukeSig.playlistLoadedId = "";
				jukeSig.playlistTracks = [];
				jukeSig.playlistLoading = false;
				jukeSig.rotationFull = null;
				jukeSig.listSig = "";
				jukeSig.rotationSig = "";
				jukeLoadPlaylists(true);
			}
			jukeSig.state = s;
			if (jukeSig.listening) {
				const cur = s.current;
				if (cur && cur.uid !== jukeSig.lastUid) {
					jukeSig.lastUid = cur.uid;
					jukeSig.manualSeek = false;
					jukeSig.seeking = false;
					jukePlayCurrent(cur);
				} else if (!cur) {
					jukeSig.lastUid = "";
					jukeSig.manualSeek = false;
					const a = rt.jukeAudio;
					if (a) a.pause();
				} else if (cur && cur.uid === jukeSig.lastUid) {
					// 用户拖过进度就不要再按墙钟拽回去；只做轻量追帧。
					jukeSeekTo(cur);
				}
			}
			const changed = !prev || prev.seq !== s.seq;
			if (changed) {
				jukeRenderQueue();
				jukeRenderHistory();
				if (jukeSig.tab === "list") jukeRenderList(true);
			}
			jukeRenderTrack();
		};

		const jukeLoad = async () => {
			if (jukeSig.loading) return;
			jukeSig.loading = true;
			const epoch = jukeSig.stateEpoch;
			try {
				const data = await api(`/api/juke/state?room=${encodeURIComponent(rt.room)}`, { timeout: 15_000 });
				// 拉状态期间有点歌/切歌操作回来了，以更新的那份为准，
				// 不要让这次慢轮询把队列倒回去。
				if (epoch !== jukeSig.stateEpoch) return;
				jukeApply(data);
			} catch (_) {
				// 轮询失败不打断正在播的歌，下一轮再试
			} finally {
				jukeSig.loading = false;
			}
		};

		const jukeSwitchTab = (name) => {
			jukeSig.tab = name;
			const juke = root() ? root().querySelector("[data-tea-juke]") : null;
			if (!juke) return;
			for (const b of juke.querySelectorAll("[data-juke-tab]")) b.classList.toggle("is-active", b.dataset.jukeTab === name);
			for (const [key, sel] of [["lyrics", "lyrics"], ["search", "search"], ["list", "list"], ["history", "history"]]) {
				const el = jukeNode("[data-juke-" + sel + "]");
				if (el) el.hidden = name !== key;
			}
			if (name === "lyrics") jukeRenderLyrics(true);
			if (name === "search") jukeRenderSearch();
			if (name === "list") {
				jukeLoadPlaylists().then(() => {
					if (jukeSig.playlistId !== "site" && jukeSig.playlistLoadedId !== jukeSig.playlistId) jukeLoadPlaylist(jukeSig.playlistId);
					else jukeRenderList(true);
				});
			}
			if (name === "history") jukeRenderHistory();
		};

		const jukeSetSource = (source) => {
			jukeSig.source = source || "site";
			const juke = root() ? root().querySelector("[data-tea-juke]") : null;
			if (juke) {
				for (const b of juke.querySelectorAll("[data-juke-source]")) b.classList.toggle("is-active", b.dataset.jukeSource === jukeSig.source);
			}
			jukeSig.results = [];
			jukeSig.searchList = [];
			jukeSig.searchState = "idle";
			jukeSig.searchError = "";
			jukeRenderSearch();
		};

		const jukeShowImport = (show) => {
			const form = jukeNode("[data-juke-importform]");
			if (!form) return;
			form.hidden = !show;
			if (show) {
				const input = jukeNode("[data-juke-importurl]");
				if (input) input.focus();
			}
		};

		const jukeImport = async () => {
			const input = jukeNode("[data-juke-importurl]");
			const url = input ? input.value.trim() : "";
			if (!url) {
				jukeSay("先粘贴一个歌单链接。", true);
				return;
			}
			if (!rt.visitor || !rt.visitor.token) {
				jukeSay("先入座，再导歌单。", true);
				return;
			}
			const btn = jukeNode("[data-juke-importform] button[type=submit]");
			if (btn) btn.disabled = true;
			jukeSay("正在解析歌单，长歌单可能要十几秒…");
			try {
				const data = await api(`/api/juke/import?room=${encodeURIComponent(rt.room)}`, {
					method: "POST",
					body: JSON.stringify({ url }),
					timeout: 35_000,
				});
				const pl = data.playlist;
				if (pl) {
					jukeSig.playlists = [pl, ...jukeSig.playlists.filter((p) => p.id !== pl.id)];
					jukeSig.playlistsLoaded = true;
					jukeSig.playlistsRoom = rt.room;
					jukeSig.playlistId = pl.id;
					jukeSig.playlistLoadedId = "";
					await jukeLoadPlaylist(pl.id);
					jukeSwitchTab("list");
					jukeSay(`已导入「${pl.name}」，${pl.trackCount} 首。`);
				}
				if (input) input.value = "";
				jukeShowImport(false);
			} catch (e) {
				jukeSay(e.message || "歌单导入失败", true);
			} finally {
				if (btn) btn.disabled = false;
			}
		};

		const jukeToggleListen = async (on) => {
			const a = ensureJukeAudio();
			jukeSig.listening = on === undefined ? !jukeSig.listening : !!on;
			jukeSig.lastUid = "";
			if (jukeSig.listening) {
				await jukeLoad();
				const cur = jukeSig.state?.current;
				if (cur) {
					jukeSig.lastUid = cur.uid;
					// 不管 currentKey 是否相同都走一遍：同曲不同场次（uid 变了）
					// 要重新对齐 startAt，音频被换掉/加载失败时也要能重新拉起。
					await jukePlayCurrent(cur);
				} else {
					jukeSay("房间还没开始放歌，先点一首吧。");
				}
			} else {
				a.pause();
			}
			jukeRenderTrack();
		};

		const bindJuke = () => {
			const juke = root() ? root().querySelector("[data-tea-juke]") : null;
			if (!juke || juke.dataset.bound === "1") return;
			juke.dataset.bound = "1";
			jukeGen = rt.jukeGen = (Number(rt.jukeGen) || 0) + 1;
			// 页面被 swup 换过一次后，旧 audio 的事件闭包还指着上一份 state，
			// 重新绑定时直接换一只新的，避免出现“界面在动、播放器不听使唤”。
			for (const el of document.querySelectorAll("audio[data-tea-juke-audio]")) {
				try {
					el.pause();
					el.remove();
				} catch (_) {}
			}
			rt.jukeAudio = null;
			rt.jukeAudioBound = false;
			// 让还在路上的旧取链请求作废，别让它回来操作新 audio。
			jukeSig.loadToken += 1;
			jukeSig.loadingUid = "";
			jukeSig.currentKey = "";
			jukeSig.currentUid = "";
			jukeSig.manualSeek = false;
			jukeSig.seeking = false;
			jukeSig.seekAt = 0;
			ensureJukeAudio();
			jukeSampleClock();
			jukeSig.playlistTracks = jukeCatalog();
			jukeSig.playlistLoadedId = "site";
			jukeLoad();
			jukeLoadPlaylists();
			jukeRenderSearch();
			jukeRenderList(true);
			jukeRenderQueue(true);
			jukeRenderHistory();
			jukeRenderTrack();

			juke.addEventListener("click", async (e) => {
				const source = e.target.closest("[data-juke-source]");
				if (source) {
					jukeSetSource(source.dataset.jukeSource);
					return;
				}
				if (e.target.closest("[data-juke-import-toggle]")) {
					const form = jukeNode("[data-juke-importform]");
					jukeShowImport(!!(form && form.hidden));
					return;
				}
				const tab = e.target.closest("[data-juke-tab]");
				if (tab) {
					jukeSwitchTab(tab.dataset.jukeTab);
					return;
				}
				const qtab = e.target.closest("[data-juke-queue-tab]");
				if (qtab) {
					jukeSig.queueTab = qtab.dataset.jukeQueueTab;
					for (const b of juke.querySelectorAll("[data-juke-queue-tab]")) b.classList.toggle("is-active", b === qtab);
					jukeSig.rotationSig = "";
					jukeRenderQueue(true);
					if (jukeSig.queueTab === "rotation") jukeLoadRotation();
					return;
				}
				const pl = e.target.closest("[data-juke-pl]");
				if (pl) {
					jukeLoadPlaylist(pl.dataset.jukePl);
					return;
				}
				const rotBtn = e.target.closest("[data-juke-pl-rotation]");
				if (rotBtn) {
					const id = rotBtn.dataset.rotationId || "";
					const isRot = jukeSig.state?.rotation?.playlistId === id;
					const data = await jukeAction("rotation", { playlistId: isRot ? "" : id });
					if (data) {
						jukeSig.rotationFull = null;
						jukeSay(isRot ? "已取消背景轮播。" : `已把「${jukeSig.playlists.find((p) => p.id === id)?.name || "歌单"}」设为背景轮播。`);
						jukeRenderList(true);
						jukeRenderQueue(true);
					}
					return;
				}
				const plpick = e.target.closest("[data-juke-plpick]");
				if (plpick) {
					jukePick(jukeSig.playlistTracks[Number(plpick.dataset.jukePlpick)]);
					return;
				}
				const rotLoad = e.target.closest("[data-juke-rotation-load]");
				if (rotLoad) {
					jukeLoadRotation(true);
					return;
				}
				const rotpick = e.target.closest("[data-juke-rotpick]");
				if (rotpick) {
					jukePick(jukeSig.rotationFull?.tracks?.[Number(rotpick.dataset.jukeRotpick)]);
					return;
				}
				const pick = e.target.closest("[data-juke-pick]");
				if (pick) {
					jukePick(jukeSig.searchList[Number(pick.dataset.jukePick)]);
					return;
				}
				const qplay = e.target.closest("[data-juke-qplay]");
				if (qplay) { jukeAction("play", { uid: qplay.dataset.jukeQplay }); return; }
				const qdel = e.target.closest("[data-juke-qdel]");
				if (qdel) { jukeAction("remove", { uid: qdel.dataset.jukeQdel }); return; }
				const readd = e.target.closest("[data-juke-readd]");
				if (readd) {
					jukePick(jukeSig.state?.history?.[Number(readd.dataset.jukeReadd)]);
					return;
				}
				const lyric = e.target.closest("[data-lrc]");
				if (lyric) {
					const line = jukeSig.lyrics[Number(lyric.dataset.lrc)];
					const a = rt.jukeAudio;
					if (line && a) {
						jukeSig.manualSeek = true;
						jukeSig.seekAt = Date.now();
						a.currentTime = line.time;
						if (a.paused && jukeSig.listening) a.play().catch(() => {});
					}
					return;
				}
				const listen = e.target.closest("[data-juke-listen]");
				if (listen) {
					jukeToggleListen();
					return;
				}
				if (e.target.closest("[data-juke-next]")) { jukeSkip(); return; }
				if (e.target.closest("[data-juke-play]")) {
					if (!jukeSig.listening) {
						jukeToggleListen(true);
					} else {
						const a = ensureJukeAudio();
						if (a.paused) {
							const cur = jukeSig.state?.current;
							if (cur) jukePlayCurrent(cur);
							else a.play().catch(() => {});
						} else {
							a.pause();
						}
					}
					return;
				}
				const prev = e.target.closest("[data-juke-prev]");
				if (prev) {
					const a = ensureJukeAudio();
					if (a) {
						jukeSig.manualSeek = true;
						jukeSig.seekAt = Date.now();
						a.currentTime = 0;
						if (a.paused && jukeSig.listening) a.play().catch(() => {});
					}
					return;
				}
				const random = e.target.closest("[data-juke-random]");
				if (random) {
					let pool = jukeCatalog();
					if (!pool.length) pool = jukeSig.playlistTracks;
					if (!pool.length) pool = jukeSig.rotationFull?.tracks || [];
					if (!pool.length) { jukeSay("还没有可点的歌。", true); return; }
					jukePick(pool[Math.floor(Math.random() * pool.length)]);
					return;
				}
				if (e.target.closest("[data-juke-close]")) {
					const shell = root();
					if (!shell) return;
					if (window.matchMedia("(min-width: 1241px)").matches) shell.classList.add("is-juke-hidden");
					else shell.classList.remove("is-juke-open");
				}
			});

			const form = juke.querySelector("[data-juke-searchform]");
			if (form) form.addEventListener("submit", (e) => {
				e.preventDefault();
				const input = jukeNode("[data-juke-q]");
				jukeSig.query = input ? input.value : "";
				jukeSearch();
			});

			const importForm = juke.querySelector("[data-juke-importform]");
			if (importForm) importForm.addEventListener("submit", (e) => {
				e.preventDefault();
				jukeImport();
			});

			const seek = juke.querySelector("[data-juke-seek]");
			if (seek) {
				const seekByInput = (e) => {
					const a = rt.jukeAudio;
					if (!a || !isFinite(a.duration) || a.duration <= 0) return;
					const pct = Math.max(0, Math.min(1, Number(e.target.value) / 1000));
					const at = Math.min(pct * a.duration, Math.max(0, a.duration - 0.25));
					const first = !jukeSig.manualSeek;
					jukeSig.manualSeek = true;
					jukeSig.seekAt = Date.now();
					jukeStopBgm();
					a.playbackRate = 1;
					try { a.currentTime = at; } catch (_) {}
					seek.style.setProperty("--p", pct * 100 + "%");
					const ct = jukeNode("[data-juke-cur]");
					if (ct) ct.textContent = jukeDur(at);
					if (first) jukeSay("已切到本地进度，换歌后自动回到房间同步。");
				};
				seek.addEventListener("pointerdown", () => { jukeSig.seeking = true; });
				const endSeek = () => {
					if (!jukeSig.seeking) return;
					jukeSig.seeking = false;
					jukeSig.seekAt = Date.now();
				};
				seek.addEventListener("pointerup", endSeek);
				seek.addEventListener("pointercancel", endSeek);
				seek.addEventListener("blur", endSeek);
				seek.addEventListener("input", seekByInput);
				seek.addEventListener("change", seekByInput);
			}

			const vol = juke.querySelector("[data-juke-vol]");
			if (vol) vol.addEventListener("input", (e) => {
				const a = ensureJukeAudio();
				a.volume = Math.min(1, Math.max(0, Number(e.target.value) / 100));
			});

			window.addEventListener("fm:play-state", (e) => {
				const a = rt.jukeAudio;
				if (e.detail && e.detail.isPlaying && a && !a.paused) a.pause();
			});

			if (rt.jukeTimer) clearInterval(rt.jukeTimer);
			// 只清自己的 timer：旧实例的间隔可能在新实例绑定后才醒过来，
			// 不能让它把新实例的 rt.jukeTimer 清掉。
			const jukeTimer = setInterval(() => {
				if (jukeGen && rt.jukeGen !== jukeGen) {
					clearInterval(jukeTimer);
					if (rt.jukeTimer === jukeTimer) rt.jukeTimer = null;
					return;
				}
				if (!root() || !root().querySelector("[data-tea-juke]")) {
					clearInterval(jukeTimer);
					if (rt.jukeTimer === jukeTimer) rt.jukeTimer = null;
					if (rt.jukeAudio) rt.jukeAudio.pause();
					return;
				}
				jukeLoad();
				if (Date.now() - (jukeSig.clockAt || 0) > 30_000) {
					jukeSig.clockAt = Date.now();
					jukeSampleClock();
				}
				if (jukeSig.listening) jukeSync();
				jukeRenderTrack();
				if (jukeSig.tab === "lyrics") jukeRenderLyrics(false);
				if (jukeSig.tab === "list") jukeRenderList();
			}, 2000);
			rt.jukeTimer = jukeTimer;
		};

		// ── 图片预览 ─────────────────────────────────────────────
		const setRoomUI = () => {
			const r = ROOMS[rt.room] || ROOMS.chat;
			const t = q(".tea-bar__title");
			if (t) t.textContent = r.name;
			const d = q(".tea-bar__sub");
			if (d) d.textContent = r.desc;
			const threadPill = q("[data-tea-threads-trigger]");
			if (threadPill && rt.room === "chat") threadPill.hidden = true;
			for (const b of document.querySelectorAll("[data-room]")) {
				b.classList.toggle("is-active", b.dataset.room === rt.room);
			}
			updatePlaceholder();
			syncBarAvatar();
		};

		const switchRoom = (key) => {
			if (!ROOMS[key] || key === rt.room) return;
			if (rt.saveReadMark) rt.saveReadMark();
			rt.room = key;
			rt.since = null;
			rt.seen.clear();
			// 换房要断掉上一间房的 typing 续期与待发回执，否则会把状态写到新房
			if (rt.stopTyping) rt.stopTyping();
			if (rt.readTimer) {
				clearTimeout(rt.readTimer);
				rt.readTimer = 0;
			}
			rt.readPending = "";
			const rj = q("[data-tea-readjump]");
			if (rj) rj.hidden = true;
			// 线程只在互联茶室有意义，切房时收起相关浮层
			if (rt.closePops) rt.closePops();
			if (rt.closeThread) rt.closeThread();
			const tt = q("[data-tea-threads-trigger]");
			if (tt) tt.hidden = key !== "lobby";
			if (rt.loadPins) rt.loadPins();
			const f = feedEl();
			if (f) {
				f.innerHTML = "";
				f.dataset.day = "";
			}
			setRoomUI();
			try {
				const u = new URL(location.href);
				u.searchParams.set("room", key);
				history.replaceState(null, "", u);
			} catch (_) {}
			clearTimeout(rt.timer);
			loadHistory();
		};
		rt.switchRoom = switchRoom;

		// ── 图片预览：缩放 / 拖动 / 多图切换 ──────────────────
		const zoomState = {
			list: [], index: 0, scale: 1, x: 0, y: 0,
			dragging: false, startX: 0, startY: 0, originX: 0, originY: 0,
			pointers: new Map(), pinchDist: 0, pinchScale: 1,
		};
		const zoomParts = () => {
			const box = document.querySelector("[data-tea-zoom]");
			return {
				box,
				stage: box && box.querySelector("[data-tea-zoom-stage]"),
				img: box && box.querySelector("[data-tea-zoom-img]"),
				prev: box && box.querySelector("[data-tea-zoom-prev]"),
				next: box && box.querySelector("[data-tea-zoom-next]"),
				count: box && box.querySelector("[data-tea-zoom-count]"),
			};
		};
		const zoomClamp = () => {
			const { stage, img } = zoomParts();
			if (!stage || !img || !img.offsetWidth) return;
			const maxX = Math.max(0, (img.offsetWidth * zoomState.scale - stage.clientWidth) / 2);
			const maxY = Math.max(0, (img.offsetHeight * zoomState.scale - stage.clientHeight) / 2);
			zoomState.x = Math.max(-maxX, Math.min(maxX, zoomState.x));
			zoomState.y = Math.max(-maxY, Math.min(maxY, zoomState.y));
		};
		const zoomApply = () => {
			const { img } = zoomParts();
			if (!img) return;
			zoomClamp();
			img.style.transform = `translate(${zoomState.x}px, ${zoomState.y}px) scale(${zoomState.scale})`;
		};
		const zoomReset = () => {
			zoomState.scale = 1;
			zoomState.x = 0;
			zoomState.y = 0;
			const { stage } = zoomParts();
			if (stage) stage.classList.remove("is-dragging");
			zoomApply();
		};
		const zoomAt = (next, clientX, clientY) => {
			const { stage } = zoomParts();
			if (!stage) return;
			const scale = Math.max(1, Math.min(6, next));
			const r = stage.getBoundingClientRect();
			const cx = clientX - (r.left + r.width / 2);
			const cy = clientY - (r.top + r.height / 2);
			const ratio = scale / zoomState.scale;
			zoomState.x = cx - (cx - zoomState.x) * ratio;
			zoomState.y = cy - (cy - zoomState.y) * ratio;
			zoomState.scale = scale;
			if (scale === 1) {
				zoomState.x = 0;
				zoomState.y = 0;
			}
			zoomApply();
		};
		const zoomShow = (index) => {
			const { img, prev, next, count, box } = zoomParts();
			if (!img || !zoomState.list.length) return;
			const len = zoomState.list.length;
			zoomState.index = ((index % len) + len) % len;
			const item = zoomState.list[zoomState.index];
			img.src = item.src;
			img.alt = item.alt || "";
			if (count) count.textContent = `${zoomState.index + 1}/${len}`;
			if (prev) prev.hidden = len <= 1;
			if (next) next.hidden = len <= 1;
			if (box) box.classList.toggle("is-single", len <= 1);
			zoomReset();
		};
		const zoomStep = (dir) => {
			if (zoomState.list.length <= 1) return;
			zoomShow(zoomState.index + dir);
		};
		const openZoom = (src, node) => {
			const { box, img, count } = zoomParts();
			if (!box || !src) return;
			const feed = feedEl();
			const nodes = feed ? [...feed.querySelectorAll("img[data-zoom]")] : [];
			const list = nodes.map((n) => ({ src: n.currentSrc || n.src, alt: n.alt || "" }));
			if (!list.length) list.push({ src, alt: "" });
			zoomState.list = list;
			zoomState.pointers.clear();
			zoomState.dragging = false;
			const idx = node ? nodes.indexOf(node) : list.findIndex((x) => x.src === src);
			zoomState.index = idx >= 0 ? idx : 0;
			box.hidden = false;
			if (img) img.style.transition = "none";
			zoomShow(zoomState.index);
			if (img) img.style.transition = "";
			if (count) count.textContent = `${zoomState.index + 1}/${list.length}`;
		};
		const closeZoom = () => {
			const { box, img } = zoomParts();
			if (!box || box.hidden) return;
			box.hidden = true;
			if (img) {
				img.removeAttribute("src");
				img.style.transform = "";
			}
			zoomState.list = [];
			zoomState.scale = 1;
			zoomState.x = 0;
			zoomState.y = 0;
			zoomState.pointers.clear();
			zoomState.dragging = false;
		};

		// ── 藏掉上游的壁纸/分类栏（CSS 打不过某些模式的 !important，这里补内联） ──
		const CHROME_SELECTORS = ["#wallpaper-wrapper", "#category-bar-wrapper"];

		const killChrome = () => {
			if (!root()) return;
			for (const sel of CHROME_SELECTORS) {
				const el = document.querySelector(sel);
				if (!el) continue;
				if (el.dataset.teaPrev === undefined) el.dataset.teaPrev = el.getAttribute("style") || "";
				if (el.style.getPropertyValue("display") !== "none" || el.style.getPropertyPriority("display") !== "important") {
					el.style.setProperty("display", "none", "important");
				}
			}
			document.body.classList.remove("enable-banner");
		};

		const restoreChrome = () => {
			for (const sel of CHROME_SELECTORS) {
				const el = document.querySelector(sel);
				if (!el || el.dataset.teaPrev === undefined) continue;
				el.setAttribute("style", el.dataset.teaPrev);
				delete el.dataset.teaPrev;
			}
		};

		const setup = () => {
			const shell = root();
			if (!shell || shell.dataset.ready === "1") return;
			shell.dataset.ready = "1";

			// 视口高度：按导航栏实际底部算，避免和胶囊导航打架
			const measure = () => {
				const nav = document.querySelector("#navbar") || document.querySelector("header");
				if (!nav) return;
				const r = nav.getBoundingClientRect();
				const top = Math.max(0, Math.round(r.bottom)) + 8;
				if (top > 8) shell.style.setProperty("--tea-top", top + "px");
			};
			measure();
			window.addEventListener("resize", measure);

			renderSelf();
			setGate(!!rt.visitor);
			killChrome();
			setTimeout(killChrome, 300);
			setTimeout(killChrome, 1200);
			loadHistory();

			// 图片选择 / 粘贴
			const imageFile = q("[data-tea-image-file]");
			const pickBtn = q("[data-tea-image-pick]");
			if (pickBtn && imageFile) {
				pickBtn.addEventListener("click", () => {
					const ta = q("[data-tea-text]");
					const typed = (ta && ta.value || "").trim();
					// 输入框里是网址 → 当作链接消息发出（fmtText 会自动渲染成可点链接）
					if (/^https?:\/\/\S+$/i.test(typed)) {
						sendText(typed);
						if (ta) ta.value = "";
						return;
					}
					imageFile.click();
				});
				imageFile.addEventListener("change", () => {
					const f = imageFile.files?.[0];
					if (f) sendImage(f, { name: f.name });
					imageFile.value = "";
				});
			}

			// Markdown 实时预览
			const mdToggle = q("[data-tea-md-toggle]");
			const mdClose = q("[data-tea-md-close]");
			const mdPreview = q("[data-tea-md-preview]");
			const mdBody = q("[data-tea-md-body]");
			const mdOff = () => {
				if (!mdPreview || !taInput) return;
				mdPreview.hidden = true;
				taInput.hidden = false;
				mdToggle?.classList.remove("is-active");
				taInput.focus();
			};
			const mdOn = () => {
				if (!mdPreview || !taInput || !mdBody) return;
				const txt = taInput.value.trim();
				const poll = parsePoll(txt);
				mdBody.innerHTML = txt
					? poll
						? renderPollCard(poll, [], "")
						: fmtText(txt)
					: `<span style="opacity:.6">还没写内容。输入 Markdown 语法后可在这里预览效果。</span>`;
				taInput.hidden = true;
				mdPreview.hidden = false;
				mdToggle?.classList.add("is-active");
			};
			mdToggle?.addEventListener("click", () => (mdPreview && !mdPreview.hidden ? mdOff() : mdOn()));
			mdClose?.addEventListener("click", mdOff);

			// 投票弹窗
			const pollDialog = document.querySelector("[data-tea-poll-dialog]");
			const pollForm = document.querySelector("[data-tea-poll-form]");
			const pollOptions = document.querySelector("[data-tea-poll-options]");
			const pollToggle = q("[data-tea-poll-toggle]");
			pollToggle?.addEventListener("click", () => {
				if (!rt.visitor) { openDialog(); return; }
				if (pollDialog && typeof pollDialog.showModal === "function") pollDialog.showModal();
			});
			document.querySelector("[data-tea-poll-close]")?.addEventListener("click", () => pollDialog?.close());
			document.querySelector("[data-tea-poll-add]")?.addEventListener("click", () => {
				if (!pollOptions) return;
				const count = pollOptions.querySelectorAll("input").length;
				if (count >= 8) return;
				const label = document.createElement("label");
				label.className = "tea-field";
				label.innerHTML = `<span>选项 ${count + 1}</span><input type="text" name="option" maxlength="60" placeholder="选项${count + 1}" required />`;
				pollOptions.appendChild(label);
				label.querySelector("input")?.focus();
			});
			pollForm?.addEventListener("submit", (e) => {
				e.preventDefault();
				const err = document.querySelector("[data-tea-poll-error]");
				const question = (pollForm.elements.question.value || "").trim();
				const opts = [...pollForm.querySelectorAll('input[name="option"]')].map((x) => (x.value || "").trim()).filter(Boolean);
				if (!question || opts.length < 2) {
					if (err) { err.textContent = "请填写问题和至少两个选项"; err.hidden = false; }
					return;
				}
				const text = `📊 ${question}\n${opts.map((o, i) => `${POLL_MARKS[i]} ${o}`).join("\n")}`;
				sendText(text);
				pollForm.reset();
				while (pollOptions && pollOptions.querySelectorAll("input").length > 2) {
					pollOptions.lastElementChild?.remove();
				}
				if (err) err.hidden = true;
				pollDialog?.close();
			});
			const taInput = q("[data-tea-text]");
			if (taInput) {
				taInput.addEventListener("paste", (e) => {
					const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/"));
					if (f) {
						e.preventDefault();
						sendImage(f, { name: f.name || "粘贴的图片" });
					}
				});
				taInput.addEventListener("input", () => {
					const now = Date.now();
					if (!taInput.value.trim()) { stopTyping(); return; }
					if (now - rt.typingAt > 1500) {
						rt.typingAt = now;
						sendTyping(true);
					}
					// 输入过程中挂一个续期定时器，别让「正在输入」在 20 秒后自动消失
					startTyping();
				});
				taInput.addEventListener("blur", () => sendTyping(false));
			}

			// 表情面板
			const emojiToggle = q("[data-tea-emoji-toggle]");
			const emojiPanel = q("[data-tea-emoji-panel]");
			const positionEmojiPanel = () => {
				if (!emojiToggle || !emojiPanel) return;
				const composer = root() ? root().querySelector("[data-tea-composer]") : null;
				const anchor = composer || emojiToggle;
				const r = anchor.getBoundingClientRect();
				const h = emojiPanel.offsetHeight || 280;
				const w = emojiPanel.offsetWidth || 304;
				const top = Math.max(8, r.top - h - 8);
				const left = Math.min(Math.max(8, r.left + 8), Math.max(8, window.innerWidth - w - 8));
				emojiPanel.style.top = top + "px";
				emojiPanel.style.left = left + "px";
				emojiPanel.dataset.anchored = "1";
			};
			const insertAtCursor = (text) => {
				const input = q("[data-tea-text]");
				if (!input) return;
				const start = input.selectionStart ?? input.value.length;
				const end = input.selectionEnd ?? start;
				const next = input.value.slice(0, start) + text + input.value.slice(end);
				if (next.length > 500) { showError("内容太长了，表情放不下"); return; }
				input.value = next;
				const caret = start + text.length;
				input.focus();
				input.setSelectionRange(caret, caret);
				input.dispatchEvent(new Event("input", { bubbles: true }));
			};
			if (emojiToggle && emojiPanel) {
				emojiToggle.addEventListener("click", (e) => {
					e.stopPropagation();
					const open = emojiPanel.hidden;
					emojiPanel.hidden = !open;
					if (!open) return;
					renderEmojiPanel(EMOTICON_SETS[0].id).then(() => setTimeout(positionEmojiPanel, 0));
				});
				emojiPanel.addEventListener("click", (e) => {
					// 面板会异步重建 DOM，冒泡到 document 时 target 可能已被移除，
					// 导致 contains() 误判 false 把面板关掉。这里直接截断冒泡。
					e.stopPropagation();
					const tab = e.target.closest("[data-emoji-set]");
					if (tab) {
						renderEmojiPanel(tab.dataset.emojiSet).then(() => setTimeout(positionEmojiPanel, 0));
						return;
					}
					const charBtn = e.target.closest("[data-emoji-char]");
					if (charBtn) { insertAtCursor(charBtn.dataset.emojiChar); return; }
					const img = e.target.closest("[data-emoji-name]");
					if (!img) return;
					const setId = img.dataset.emojiSetId === "bili" ? "bili" : "qq";
					insertAtCursor(`[emoji:${setId}:${img.dataset.emojiName}]`);
				});
				document.addEventListener("click", (e) => {
					if (!emojiPanel.hidden && !emojiPanel.contains(e.target) && e.target !== emojiToggle) emojiPanel.hidden = true;
				});
				window.addEventListener("resize", () => {
					if (!emojiPanel.hidden) positionEmojiPanel();
				});
			}

			// 回复 / 回应 / 取消回复
			const replybar = q("[data-tea-replybar]");
			const setReply = (msg) => {
				rt.replyTo = msg;
				if (!replybar) return;
				if (!msg) {
					replybar.hidden = true;
					return;
				}
				const who = q("[data-tea-reply-who]");
				const txt = q("[data-tea-reply-text]");
				if (who) who.textContent = msg.nick || "茶友";
				if (txt) txt.textContent = msg.text || "图片";
				replybar.hidden = false;
				if (ta) ta.focus();
			};
			rt.setReply = setReply;
			const cancelReply = q("[data-tea-reply-cancel]");
			if (cancelReply) cancelReply.addEventListener("click", () => setReply(null));
			const f = feedEl();
			const msgMenu = q("[data-tea-msg-menu]");
			let msgMenuTarget = null;
			const closeMsgMenu = () => {
				if (!msgMenu) return;
				msgMenu.hidden = true;
				msgMenuTarget = null;
			};
			const showSource = (text) => {
				let dlg = document.querySelector("[data-tea-source-dialog]");
				if (!dlg) {
					dlg = document.createElement("dialog");
					dlg.className = "tea-source";
					dlg.dataset.teaSourceDialog = "";
					dlg.innerHTML = `<div class="tea-source__box"><header class="tea-source__head"><span>消息源码</span><button type="button" data-source-close aria-label="关闭">×</button></header><pre></pre></div>`;
					document.body.appendChild(dlg);
				}
				dlg.querySelector("pre").textContent = text;
				dlg.querySelector("[data-source-close]").onclick = () => dlg.close();
				dlg.showModal();
			};
			const copyText = async (text) => {
				try {
					await navigator.clipboard.writeText(text);
				} catch (_) {
					const ta = document.createElement("textarea");
					ta.value = text;
					ta.style.position = "fixed";
					ta.style.opacity = "0";
					document.body.appendChild(ta);
					ta.select();
					document.execCommand("copy");
					ta.remove();
				}
			};
			// ── 表情回应：常用快捷 + 完整选择 ──────────────────
			const REACT_QUICK = ["👍", "❤️", "😂", "🎉", "🔥", "👀"];
			const REACT_EMOJIS = [
				"😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","😉","😍","🥰","😘","😗",
				"😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🥳","😏","😒","😞","😔",
				"😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯",
				"😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🤭","🤫","🤥","😶","😐","😑",
				"😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐","🥴","🤢","🤮",
				"🤧","😷","🤒","🤕","👍","👎","👌","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","👇",
				"☝️","✋","🤚","🖐️","🖖","👋","🤝","🙏","💪","❤️","🧡","💛","💚","💙","💜","🖤",
				"🤍","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","✨","⭐","🌟","💫","⚡",
				"🔥","🎉","🎊","🎈","🎁","🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁",
				"🍎","🍉","🍇","🍓","🍒","🍑","🥭","🍍","☕","🍵","🍺","🍻","🍰","🎂","🍫","🍬",
			];
			const REACT_NAMES = {
				"👍": "赞 同意 好", "👎": "踩 反对", "❤️": "爱心 喜欢 红心", "😂": "笑哭 大笑",
				"🎉": "庆祝 彩带", "🔥": "火 热门", "👀": "眼睛 看", "😀": "笑 开心", "😭": "哭 大哭",
				"🙏": "感谢 拜托", "💪": "加油 肌肉", "✨": "闪光 星星", "⭐": "星 收藏",
			};
			let reactPicker = null;
			let reactPickerTarget = "";
			const reactGridHtml = (query = "") => {
				const q = query.trim().toLowerCase();
				const list = REACT_EMOJIS.filter((e) => !q || e === q || (REACT_NAMES[e] || "").toLowerCase().includes(q));
				return list.length
					? list.map((e) => `<button type="button" data-react-key="${esc(e)}" title="${esc(REACT_NAMES[e] || e)}">${e}</button>`).join("")
					: `<p class="tea-react-picker__empty">没找到这个表情</p>`;
			};
			const closeReactPicker = () => {
				if (reactPicker) reactPicker.hidden = true;
				reactPickerTarget = "";
			};
			const positionReactPicker = (btn) => {
				if (!reactPicker) return;
				const r = btn.getBoundingClientRect();
				const w = reactPicker.offsetWidth || 288;
				const h = reactPicker.offsetHeight || 250;
				const top = r.top - h - 8 >= 8 ? r.top - h - 8 : Math.min(r.bottom + 8, innerHeight - h - 8);
				const left = Math.min(Math.max(8, r.right - w), Math.max(8, innerWidth - w - 8));
				reactPicker.style.top = top + "px";
				reactPicker.style.left = left + "px";
			};
			const sendReaction = async (key) => {
				const id = reactPickerTarget;
				closeReactPicker();
				if (!id) return;
				try {
					await api("/api/reaction", { method: "POST", body: JSON.stringify({ eventId: id, key }) });
				} catch (err) {
					showError(err.message || "回应失败");
				}
			};
			const openReactPicker = (btn) => {
				if (!rt.visitor) {
					openDialog();
					return;
				}
				if (!reactPicker) {
					reactPicker = document.createElement("div");
					reactPicker.className = "tea-react-picker";
					reactPicker.dataset.teaReactPicker = "";
					reactPicker.innerHTML = `
						<div class="tea-react-picker__quick">${REACT_QUICK.map((e) => `<button type="button" data-react-key="${e}" title="${esc(REACT_NAMES[e] || e)}">${e}</button>`).join("")}</div>
						<input class="tea-react-picker__search" type="search" maxlength="20" placeholder="搜索表情…" data-react-search aria-label="搜索表情" />
						<div class="tea-react-picker__grid" data-react-grid>${reactGridHtml()}</div>`;
					reactPicker.addEventListener("click", (e) => {
						e.stopPropagation();
						const b = e.target.closest("[data-react-key]");
						if (b) sendReaction(b.dataset.reactKey);
					});
					reactPicker.addEventListener("input", (e) => {
						if (e.target.matches("[data-react-search]")) {
							const grid = reactPicker.querySelector("[data-react-grid]");
							if (grid) grid.innerHTML = reactGridHtml(e.target.value);
						}
					});
					document.addEventListener("click", (e) => {
						if (!reactPicker || reactPicker.hidden) return;
						if (e.target.closest("[data-tea-react-picker]") || e.target.closest('[data-act="react"]')) return;
						closeReactPicker();
					});
					document.addEventListener("keydown", (e) => {
						if (e.key === "Escape") closeReactPicker();
					});
					if (f) f.addEventListener("scroll", closeReactPicker, { passive: true });
					document.body.appendChild(reactPicker);
				}
				if (!reactPicker.hidden && reactPickerTarget === btn.dataset.id) {
					closeReactPicker();
					return;
				}
				reactPickerTarget = btn.dataset.id;
				const search = reactPicker.querySelector("[data-react-search]");
				const grid = reactPicker.querySelector("[data-react-grid]");
				if (search) search.value = "";
				if (grid) grid.innerHTML = reactGridHtml();
				reactPicker.hidden = false;
				positionReactPicker(btn);
				if (search) setTimeout(() => search.focus(), 30);
			};

			const openMsgMenu = (btn) => {
				if (!msgMenu) return;
				const canRecall = btn.dataset.recall === "1";
				msgMenuTarget = {
					id: btn.dataset.id,
					nick: btn.dataset.nick || "茶友",
					text: btn.dataset.text || "",
				};
				msgMenu.innerHTML = `
					<button type="button" data-menu="copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>复制内容</button>
					${btn.dataset.thread === "1" ? `<button type="button" data-menu="thread"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.2-4.2A8 8 0 1 1 21 12Z"/></svg>线程回复</button>` : ""}
					<button type="button" data-menu="source"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m9 8-4 4 4 4M15 8l4 4-4 4"/></svg>查看源码</button>
					${canRecall ? `<button type="button" data-menu="recall" class="is-danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7 3 12l6 5"/><path d="M3 12h10a7 7 0 0 1 7 7"/></svg>撤回</button>` : ""}
				`;
				msgMenu.hidden = false;
				const r = btn.getBoundingClientRect();
				const w = msgMenu.offsetWidth || 150;
				const h = msgMenu.offsetHeight || 120;
				const top = r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6;
				const left = Math.min(Math.max(8, r.left), Math.max(8, innerWidth - w - 8));
				msgMenu.style.top = top + "px";
				msgMenu.style.left = left + "px";
			};
			if (msgMenu) {
				msgMenu.addEventListener("click", async (e) => {
					const item = e.target.closest("[data-menu]");
					if (!item || !msgMenuTarget) return;
					const { id, nick, text } = msgMenuTarget;
					const kind = item.dataset.menu;
					closeMsgMenu();
					if (kind === "copy") {
						await copyText(text);
					} else if (kind === "thread") {
						if (typeof rt.openThread === "function") rt.openThread(id);
					} else if (kind === "source") {
						showSource(text);
					} else if (kind === "recall") {
						try {
							await api("/api/recall", { method: "POST", body: JSON.stringify({ eventId: id }) });
							const el = f.querySelector(`.tea-msg[data-id="${CSS.escape(id)}"]`);
							if (el) {
								const v = rt.visitor;
								const box = document.createElement("div");
								box.innerHTML = recallHtml({ id, by: v?.nick || "我", site: SITE_NAME, ts: Date.now() });
								el.replaceWith(box.firstElementChild);
							}
						} catch (err) {
							showError(err.message || "撤回失败");
						}
					}
				});
				document.addEventListener("click", (e) => {
					if (msgMenu.hidden) return;
					if (e.target.closest("[data-tea-msg-menu]") || e.target.closest('[data-act="more"]')) return;
					closeMsgMenu();
				});
				document.addEventListener("keydown", (e) => {
					if (e.key === "Escape") closeMsgMenu();
				});
				if (f) f.addEventListener("scroll", closeMsgMenu, { passive: true });
			}
			if (f) {
				f.addEventListener("click", async (e) => {
					// 点消息头像看名片：名册里有的用人家的完整资料，
					// 不在名册（离线/外站）就用这条消息里的昵称、站点、头像兜底。
					const avBtn = e.target.closest("[data-tea-msg-avatar]");
					if (avBtn) {
						const id = avBtn.dataset.teaMsgAvatar || "";
						const member = (rt.members || []).find((x) => x && x.id === id) || {
							id,
							nick: avBtn.dataset.teaMsgNick || "茶友",
							site: avBtn.dataset.teaMsgSite || "",
							avatar: avBtn.dataset.teaMsgPic || "",
							online: false,
						};
						openMemberCard(member);
						return;
					}
					const btn = e.target.closest("[data-act]");
					if (!btn) return;
					const id = btn.dataset.id;
					if (btn.dataset.act === "more") {
						openMsgMenu(btn);
					} else if (btn.dataset.act === "thread") {
						if (typeof rt.openThread === "function") rt.openThread(id);
					} else if (btn.dataset.act === "recall") {
						try {
							await api("/api/recall", {
								method: "POST",
								body: JSON.stringify({ eventId: id }),
							});
							const el = f.querySelector(`.tea-msg[data-id="${CSS.escape(id)}"]`);
							if (el) {
								const v = rt.visitor;
								const box = document.createElement("div");
								box.innerHTML = recallHtml({ id, by: v?.nick || "我", site: SITE_NAME, ts: Date.now() });
								el.replaceWith(box.firstElementChild);
							}
						} catch (err) {
							showError(err.message || "撤回失败");
						}
					} else if (btn.dataset.act === "reply") {
						setReply({ id, nick: btn.dataset.nick, text: btn.dataset.text });
					} else if (btn.dataset.act === "react") {
						openReactPicker(btn);
					} else if (btn.dataset.act === "poll-vote") {
						if (!rt.visitor) { openDialog(); return; }
						try {
							btn.disabled = true;
							await api("/api/reaction", {
								method: "POST",
								body: JSON.stringify({ eventId: id, key: btn.dataset.key }),
							});
						} catch (_) {
							showError("投票失败，稍后再试");
							btn.disabled = false;
						}
					}
				});
			}

			// 身份弹窗
			for (const el of document.querySelectorAll("[data-tea-enter]")) {
				el.addEventListener("click", openDialog);
			}
			for (const el of document.querySelectorAll("[data-tea-profile-open]")) {
				el.addEventListener("click", (e) => {
					e.preventDefault();
					openProfile();
				});
			}
			const form = document.querySelector("[data-tea-identity]");
			if (form) {
				form.addEventListener("submit", (e) => submitIdentity(e));
				form.elements.nick.addEventListener("input", updatePreview);
			}
			const walineOpen = document.querySelector("[data-tea-waline-open]");
			if (walineOpen && walineOpen.dataset.bound !== "1") {
				walineOpen.dataset.bound = "1";
				walineOpen.addEventListener("click", () => showForm("waline"));
			}
			const walineBack = document.querySelector("[data-tea-waline-back]");
			if (walineBack && walineBack.dataset.bound !== "1") {
				walineBack.dataset.bound = "1";
				walineBack.addEventListener("click", () => showForm("identity"));
			}
			const walineForm = document.querySelector("[data-tea-waline]");
			if (walineForm && walineForm.dataset.bound !== "1") {
				walineForm.dataset.bound = "1";
				walineForm.addEventListener("submit", submitWaline);
			}
			const walineClose = document.querySelector("[data-tea-waline-close]");
			if (walineClose && walineClose.dataset.bound !== "1") {
				walineClose.dataset.bound = "1";
				walineClose.addEventListener("click", () => {
					const dlg = document.querySelector("[data-tea-dialog]");
					if (dlg) dlg.close();
				});
			}
			const matrixOpen = document.querySelector("[data-tea-matrix-open]");
			if (matrixOpen && matrixOpen.dataset.bound !== "1") {
				matrixOpen.dataset.bound = "1";
				matrixOpen.addEventListener("click", () => showForm("matrix"));
			}
			const matrixBack = document.querySelector("[data-tea-matrix-back]");
			if (matrixBack && matrixBack.dataset.bound !== "1") {
				matrixBack.dataset.bound = "1";
				matrixBack.addEventListener("click", () => showForm("identity"));
			}
			const matrixForm = document.querySelector("[data-tea-matrix]");
			if (matrixForm && matrixForm.dataset.bound !== "1") {
				matrixForm.dataset.bound = "1";
				matrixForm.addEventListener("submit", submitMatrix);
			}
			const matrixClose = document.querySelector("[data-tea-matrix-close]");
			if (matrixClose && matrixClose.dataset.bound !== "1") {
				matrixClose.dataset.bound = "1";
				matrixClose.addEventListener("click", () => {
					const dlg = document.querySelector("[data-tea-dialog]");
					if (dlg) dlg.close();
				});
			}
			const dlgClose = document.querySelector("[data-tea-dialog-close]");
			if (dlgClose) {
				dlgClose.addEventListener("click", () => {
					const dlg = document.querySelector("[data-tea-dialog]");
					if (dlg) dlg.close();
				});
			}
			const dlgEl = document.querySelector("[data-tea-dialog]");
			if (dlgEl) {
				dlgEl.addEventListener("click", (e) => {
					if (e.target === dlgEl) dlgEl.close();
				});
			}

			// 输入框
			const ta = q("[data-tea-text]");
			const counter = q("[data-tea-count]");
			if (ta) {
				ta.addEventListener("input", () => {
					ta.style.height = "auto";
					ta.style.height = Math.min(ta.scrollHeight, 128) + "px";
					if (counter) counter.textContent = `${ta.value.length}/500`;
				});
				ta.addEventListener("keydown", (e) => {
					if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
						e.preventDefault();
						const f = q("[data-tea-composer]");
						if (f) f.requestSubmit();
					}
				});
			}
			const composer = q("[data-tea-composer]");
			if (composer) {
				composer.addEventListener("submit", async (e) => {
					e.preventDefault();
					if (!ta) return;
					const text = ta.value.trim();
					if (!text) return;
					if (!rt.visitor) {
						openDialog();
						return;
					}
					showError("");
					ta.value = "";
					ta.style.height = "auto";
					if (counter) counter.textContent = "0/500";
					await sendText(text);
				});
			}

			// 回到最新
			const jump = q("[data-tea-jump]");
			if (jump) {
				jump.addEventListener("click", () => {
					scrollBottom(true);
					jump.hidden = true;
				});
			}
			const feed = feedEl();
			if (feed) {
				feed.addEventListener("scroll", () => {
					if (atBottom()) {
						const j = q("[data-tea-jump]");
						if (j) j.hidden = true;
					}
				});
				feed.addEventListener("click", (e) => {
					const img = e.target.closest("img[data-zoom]");
					if (img) openZoom(img.currentSrc || img.getAttribute("src"), img);
				});
			}

			// 图片预览：按钮 / 滚轮 / 拖动 / 双指 / 键盘 / 左右切换
			const zoomBox = document.querySelector("[data-tea-zoom]");
			if (zoomBox && zoomBox.parentElement !== document.body) document.body.appendChild(zoomBox);
			if (zoomBox && zoomBox.dataset.bound !== "1") {
				zoomBox.dataset.bound = "1";
				const zs = zoomBox.querySelector("[data-tea-zoom-stage]");
				const zi = zoomBox.querySelector("[data-tea-zoom-img]");
				const zClose = zoomBox.querySelector("[data-tea-zoom-close]");
				const zPrev = zoomBox.querySelector("[data-tea-zoom-prev]");
				const zNext = zoomBox.querySelector("[data-tea-zoom-next]");
				const zOut = zoomBox.querySelector("[data-tea-zoom-out]");
				const zIn = zoomBox.querySelector("[data-tea-zoom-in]");
				const zReset = zoomBox.querySelector("[data-tea-zoom-reset]");
				if (zClose) zClose.addEventListener("click", closeZoom);
				if (zPrev) zPrev.addEventListener("click", () => zoomStep(-1));
				if (zNext) zNext.addEventListener("click", () => zoomStep(1));
				if (zs) {
					const centerZoom = (factor) => {
						const r = zs.getBoundingClientRect();
						zoomAt(zoomState.scale * factor, r.left + r.width / 2, r.top + r.height / 2);
					};
					if (zOut) zOut.addEventListener("click", () => centerZoom(1 / 1.25));
					if (zIn) zIn.addEventListener("click", () => centerZoom(1.25));
					if (zReset) zReset.addEventListener("click", zoomReset);
					zs.addEventListener("wheel", (e) => {
						if (zoomBox.hidden) return;
						e.preventDefault();
						zoomAt(zoomState.scale * (e.deltaY < 0 ? 1.12 : 0.89), e.clientX, e.clientY);
					}, { passive: false });
					zs.addEventListener("dblclick", (e) => {
						if (zoomState.scale > 1) zoomReset();
						else zoomAt(2.5, e.clientX, e.clientY);
					});
					const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
					zs.addEventListener("pointerdown", (e) => {
						if (e.button !== 0 && e.pointerType === "mouse") return;
						zs.setPointerCapture?.(e.pointerId);
						zoomState.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
						if (zoomState.pointers.size === 1) {
							zoomState.dragging = true;
							zoomState.startX = e.clientX;
							zoomState.startY = e.clientY;
							zoomState.originX = zoomState.x;
							zoomState.originY = zoomState.y;
							zs.classList.add("is-dragging");
						} else if (zoomState.pointers.size === 2) {
							const [a, b] = [...zoomState.pointers.values()];
							zoomState.pinchDist = distance(a, b) || 1;
							zoomState.pinchScale = zoomState.scale;
							zoomState.dragging = false;
						}
					});
					zs.addEventListener("pointermove", (e) => {
						if (!zoomState.pointers.has(e.pointerId)) return;
						zoomState.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
						if (zoomState.pointers.size >= 2) {
							const [a, b] = [...zoomState.pointers.values()];
							const d = distance(a, b) || 1;
							if (zoomState.pinchDist) {
								zoomAt(zoomState.pinchScale * (d / zoomState.pinchDist), (a.x + b.x) / 2, (a.y + b.y) / 2);
							}
							return;
						}
						if (!zoomState.dragging || zoomState.scale <= 1) return;
						zoomState.x = zoomState.originX + (e.clientX - zoomState.startX);
						zoomState.y = zoomState.originY + (e.clientY - zoomState.startY);
						zoomApply();
					});
					const endPointer = (e) => {
						zoomState.pointers.delete(e.pointerId);
						if (zoomState.pointers.size < 2) zoomState.pinchDist = 0;
						if (zoomState.pointers.size === 0) {
							zoomState.dragging = false;
							zs.classList.remove("is-dragging");
						} else if (zoomState.pointers.size === 1) {
							const p = [...zoomState.pointers.values()][0];
							zoomState.dragging = true;
							zoomState.startX = p.x;
							zoomState.startY = p.y;
							zoomState.originX = zoomState.x;
							zoomState.originY = zoomState.y;
						}
					};
					zs.addEventListener("pointerup", endPointer);
					zs.addEventListener("pointercancel", endPointer);
				}
				document.addEventListener("keydown", (e) => {
					if (zoomBox.hidden) return;
					if (e.key === "Escape") { closeZoom(); return; }
					if (e.key === "ArrowLeft") { zoomStep(-1); return; }
					if (e.key === "ArrowRight") { zoomStep(1); return; }
					if (e.key === "+" || e.key === "=") {
						const r = zi ? zi.getBoundingClientRect() : null;
						zoomAt(zoomState.scale * 1.25, r ? r.left + r.width / 2 : innerWidth / 2, r ? r.top + r.height / 2 : innerHeight / 2);
						return;
					}
					if (e.key === "-") {
						const r = zi ? zi.getBoundingClientRect() : null;
						zoomAt(zoomState.scale / 1.25, r ? r.left + r.width / 2 : innerWidth / 2, r ? r.top + r.height / 2 : innerHeight / 2);
						return;
					}
					if (e.key === "0") zoomReset();
				});
			}

			// 刷新 / 抽屉
			const refresh = q("[data-tea-refresh]");
			if (refresh) {
				refresh.addEventListener("click", () => {
					rt.since = null;
					clearTimeout(rt.timer);
					loadHistory();
					startLoop();
				});
			}
			const toggle = q("[data-tea-roster-toggle]");
			const scrim = q("[data-tea-scrim]");
			const closeDrawer = () => {
				shell.classList.remove("is-drawer-open");
				if (scrim) scrim.hidden = true;
			};
			if (toggle) {
				toggle.addEventListener("click", () => {
					const open = !shell.classList.contains("is-drawer-open");
					shell.classList.toggle("is-drawer-open", open);
					if (scrim) scrim.hidden = !open;
				});
			}
			if (scrim) scrim.addEventListener("click", closeDrawer);

			// 点歌台开关
			const jukeToggle = q("[data-tea-juke-toggle]");
			if (jukeToggle) {
				jukeToggle.addEventListener("click", () => {
					if (window.matchMedia("(min-width: 1241px)").matches) shell.classList.toggle("is-juke-hidden");
					else shell.classList.toggle("is-juke-open");
					bindJuke();
					setTimeout(jukeLoad, 60);
				});
			}
			const roomsList = q("[data-tea-rooms]");
			if (roomsList && roomsList.dataset.bound !== "1") {
				roomsList.dataset.bound = "1";
				roomsList.addEventListener("click", (e) => {
					const btn = e.target.closest("[data-room]");
					if (btn) switchRoom(btn.dataset.room);
				});
			}
			setRoomUI();
			const rosterAllBtn = q("[data-tea-roster-all]");
			if (rosterAllBtn && rosterAllBtn.dataset.bound !== "1") {
				rosterAllBtn.dataset.bound = "1";
				rosterAllBtn.addEventListener("click", () => {
					rt.rosterAll = !rt.rosterAll;
					renderMembers(rt.members || []);
				});
			}
			// 成员名片
			const roster = q("[data-tea-members]");
			if (roster && roster.dataset.cardBound !== "1") {
				roster.dataset.cardBound = "1";
				const pick = (e) => {
					const li = e.target.closest("[data-tea-member]");
					if (li) openMemberCard((rt.members || [])[Number(li.dataset.teaMember)]);
				};
				roster.addEventListener("click", pick);
				roster.addEventListener("keydown", (e) => {
					if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(e); }
				});
			}
			const mcDialog = document.querySelector("[data-tea-membercard]");
			document.querySelector("[data-tea-membercard-close]")?.addEventListener("click", () => mcDialog?.close());
			if (mcDialog && mcDialog.dataset.sortBound !== "1") {
				mcDialog.dataset.sortBound = "1";
				mcDialog.addEventListener("click", async (e) => {
					const sortBtn = e.target.closest("[data-tea-mc-sort]");
					if (sortBtn) {
						mcState.sort = sortBtn.dataset.teaMcSort;
						for (const b of mcDialog.querySelectorAll("[data-tea-mc-sort]")) b.classList.toggle("is-active", b === sortBtn);
						mcRenderSongs();
						return;
					}
					const add = e.target.closest("[data-mc-add]");
					if (add) {
						const m = musicApi();
						const st = m && m.getState();
						const idx = st && st.playlist.findIndex((t) => t.name === add.dataset.mcAdd && t.artist === add.dataset.mcArtist);
						if (idx >= 0 && m) {
							m.playTrackByIndex(idx);
							recordSong(st.playlist[idx]);
							setTimeout(jukeLoad, 150);
						}
					}
				});
			}
			const jukeScrim = q("[data-juke-scrim]");
			if (jukeScrim) jukeScrim.addEventListener("click", () => shell.classList.remove("is-juke-open"));
			bindJuke();
			bindReceipts();

			// ── 互联友站浮层 ──────────────────────────────────────
			const sitesTrigger = q("[data-tea-sites-trigger]");
			const sitesPop = q("[data-tea-sites-pop]");
			const sitesList = q("[data-tea-sites-list]");
		const threadsTrigger = q("[data-tea-threads-trigger]");
		const threadsPop = q("[data-tea-threads-pop]");
		// 浮层用 fixed 定位，打开时对齐触发按钮，避免被上层容器的 fixed/overflow 影响
		const positionPop = (pop, trigger, align) => {
			if (!pop || !trigger) return;
			const r = trigger.getBoundingClientRect();
			const w = pop.offsetWidth || pop.getBoundingClientRect().width;
			const left = align === "right" ? r.right - w : r.left;
			const maxLeft = Math.max(8, window.innerWidth - w - 8);
			pop.style.left = Math.min(Math.max(8, left), maxLeft) + "px";
			pop.style.top = r.bottom + 6 + "px";
			pop.dataset.anchored = "1";
		};
		const closePops = (except) => {
				if (sitesPop && except !== sitesPop) {
					sitesPop.hidden = true;
					if (sitesTrigger) sitesTrigger.setAttribute("aria-expanded", "false");
				}
				if (threadsPop && except !== threadsPop) {
					threadsPop.hidden = true;
					if (threadsTrigger) threadsTrigger.setAttribute("aria-expanded", "false");
				}
			};

			if (sitesList) {
				const peersList = (() => { try { return JSON.parse(appData("peers", "[]")); } catch (_) { return []; } })();
				const selfSite = (() => { try { return JSON.parse(appData("selfSite", "{}")); } catch (_) { return {}; } })();
				const allSites = [selfSite, ...peersList];
				sitesList.innerHTML = allSites
					.map((s) => {
						const av = s.avatar
							? `<img class="tea-site-card__avatar" src="${esc(s.avatar)}" alt="" loading="lazy" onerror="this.style.display='none'" />`
							: `<span class="tea-site-card__avatar" style="${avatarStyle(s.owner || s.name, "")}"></span>`;
						return `<a class="tea-site-card" href="${esc(s.url)}" ${s.isSelf ? "" : 'target="_blank" rel="noopener noreferrer"'}>
							${av}
							<span class="tea-site-card__copy">
								<span class="tea-site-card__name">${esc(s.name)}${s.isSelf ? '<em class="tea-site-card__self">本站</em>' : ""}</span>
								<span class="tea-site-card__desc">${esc(s.desc || s.owner || "")}</span>
							</span>
						</a>`;
					})
					.join("");
			}
			if (sitesTrigger && sitesPop) {
				sitesTrigger.addEventListener("click", (e) => {
					e.stopPropagation();
					const open = sitesPop.hidden;
					closePops(open ? sitesPop : null);
					sitesPop.hidden = !open;
					sitesTrigger.setAttribute("aria-expanded", String(open));
					if (open) positionPop(sitesPop, sitesTrigger, "left");
				});
			}
			if (threadsTrigger && threadsPop) {
				threadsTrigger.addEventListener("click", (e) => {
					e.stopPropagation();
					const open = threadsPop.hidden;
					closePops(open ? threadsPop : null);
					threadsPop.hidden = !open;
					threadsTrigger.setAttribute("aria-expanded", String(open));
					if (open) {
						positionPop(threadsPop, threadsTrigger, "right");
						loadThreads();
					}
				});
			}
			document.addEventListener("click", (e) => {
				if (!e.target.closest("[data-tea-sites-pop]") && !e.target.closest("[data-tea-sites-trigger]")) {
					if (sitesPop && !sitesPop.hidden) closePops();
				}
				if (!e.target.closest("[data-tea-threads-pop]") && !e.target.closest("[data-tea-threads-trigger]")) {
					if (threadsPop && !threadsPop.hidden) closePops();
				}
			});
			rt.closePops = closePops;
			document.addEventListener("keydown", (e) => {
				if (e.key === "Escape") { closePops(); if (rt.closeThread) rt.closeThread(); }
			});
			window.addEventListener("resize", () => {
				if (sitesPop && !sitesPop.hidden) positionPop(sitesPop, sitesTrigger, "left");
				if (threadsPop && !threadsPop.hidden) positionPop(threadsPop, threadsTrigger, "right");
			});
			sitesPop?.querySelectorAll("[data-tea-pop-close]").forEach((b) => b.addEventListener("click", () => closePops()));
			threadsPop?.querySelectorAll("[data-tea-pop-close]").forEach((b) => b.addEventListener("click", () => closePops()));

			// ── 活跃线程列表 ──────────────────────────────────────
			const threadCountEl = q("[data-tea-threads-count]");
			const threadsTotalEl = q("[data-tea-threads-total]");
			const threadsListEl = q("[data-tea-threads-list]");
			const setThreadCount = (n) => {
				if (threadCountEl) threadCountEl.textContent = String(n);
				if (threadsTotalEl) threadsTotalEl.textContent = n + " 个";
				if (threadsTrigger) threadsTrigger.hidden = false;
			};

			const loadThreads = async () => {
				if (!threadsListEl) return;
				threadsListEl.innerHTML = `<div class="tea-thread__loading">正在找活跃线程…</div>`;
				try {
					const data = await api(`/api/threads?room=${rt.room}`);
					const threads = data.threads || [];
					setThreadCount(threads.length);
					if (!threads.length) {
						threadsListEl.innerHTML = `<div class="tea-pop__empty">还没有线程回复。在任意消息上点「线程回复」就能开一个。</div>`;
						return;
					}
					threadsListEl.innerHTML = threads
						.map((t) => {
							const root = t.root || {};
							const latest = t.summary?.latestReply || null;
							const av = root.avatar
								? `<img class="tea-thread-item__avatar" src="${esc(root.avatar)}" alt="" loading="lazy" />`
								: `<span class="tea-thread-item__avatar" style="${avatarStyle(root.nick, root.site)}"></span>`;
							const rootText = root.text || root.image || "点击查看线程";
							return `<button type="button" class="tea-thread-item" data-thread-root="${esc(t.rootUid)}">
								${av}
								<span class="tea-thread-item__copy">
									<span class="tea-thread-item__row">
										<span class="tea-thread-item__who">${esc(root.nick || "茶友")}${root.site ? " · " + esc(root.site) : ""}</span>
										<span class="tea-thread-item__count">${Number(t.summary?.count) || 0} 条回复</span>
									</span>
									<span class="tea-thread-item__text">${esc(String(rootText).slice(0, 80))}</span>
									${latest ? `<span class="tea-thread-item__latest">最新 ${esc(latest.name || "茶友")}：${esc(String(latest.content || "").slice(0, 60))}</span>` : ""}
								</span>
							</button>`;
						})
						.join("");
				} catch (e) {
					threadsListEl.innerHTML = `<div class="tea-pop__empty">线程列表暂时打不开${e.message ? "：" + esc(e.message) : ""}</div>`;
				}
			};
			rt.refreshThreads = loadThreads;
			// 进房后拉一次线程数（失败则静默，按钮保持隐藏）
			if (rt.room === "lobby") {
				api(`/api/threads?room=${rt.room}`)
					.then((d) => setThreadCount((d.threads || []).length))
					.catch(() => {});
			}

			threadsListEl?.addEventListener("click", (e) => {
				const item = e.target.closest("[data-thread-root]");
				if (item) {
					closePops();
					openThread(item.dataset.threadRoot);
				}
			});

			// ── 线程详情弹层 ──────────────────────────────────────
			const threadView = q("[data-tea-thread-view]");
			const threadBody = q("[data-tea-thread-body]");
			const threadSub = q("[data-tea-thread-sub]");
			const threadInput = q("[data-tea-thread-input]");
			const threadSend = q("[data-tea-thread-send]");
			let currentThreadRoot = "";
			let currentThreadLatest = "";

			const threadMsgHtml = (m) => {
				const av = m.avatar
					? `<img src="${esc(m.avatar)}" alt="" loading="lazy" />`
					: `<span style="${avatarStyle(m.nick, m.site)}">${esc(initials(m.nick))}</span>`;
				const tDims = m.imageW && m.imageH ? ` width="${Number(m.imageW)}" height="${Number(m.imageH)}"` : "";
				const body = m.image
					? `<img src="${esc(m.image)}" alt="${m.emoticon ? "表情" : "图片"}" decoding="async"${tDims} style="max-width:100%;border-radius:0.5rem;" data-zoom />`
					: fmtText(m.text || "");
				return `<div class="tea-msg tea-thread__msg" data-id="${esc(m.id || "")}">
					<div class="tea-msg__avatar" aria-hidden="true">${av}</div>
					<div class="tea-msg__body">
						<div class="tea-msg__head">
							<span class="tea-msg__nick">${esc(m.nick || "茶友")}</span>
							${m.site ? `<span class="tea-msg__site">来自 ${esc(m.site)}</span>` : ""}
							<time class="tea-msg__time">${esc(fmtTime(m.ts))}</time>
						</div>
						<div class="tea-msg__text">${body}</div>
					</div>
				</div>`;
			};

			const openThread = async (rootUid) => {
				if (!threadView || !threadBody || !rootUid) return;
				currentThreadRoot = rootUid;
				currentThreadLatest = rootUid;
				threadView.hidden = false;
				threadBody.innerHTML = `<div class="tea-thread__loading">正在打开线程…</div>`;
				if (threadSub) threadSub.textContent = "Matrix 线程 · 加载中";
				(threadInput?.closest(".tea-thread__footer"))?.removeAttribute("hidden");
				try {
					const data = await api(`/api/thread?room=${rt.room}&rootUid=${encodeURIComponent(rootUid)}`);
					const replies = data.messages || [];
					// 规范（Fallback for unthreaded clients）：is_falling_back 的 m.in_reply_to
					// 要指向线程内最新一条消息，不是线程根，否则老客户端看到的是「回复主题」而不是上下文。
					currentThreadLatest = replies.length ? replies[replies.length - 1].id : rootUid;
					(threadSub && (threadSub.textContent = `Matrix 线程 · 共 ${replies.length} 条回复`));
					threadBody.innerHTML = `
						${data.root ? `<div class="tea-thread__root-label">主题原消息</div>${threadMsgHtml(data.root)}` : ""}
						<div class="tea-thread__divider">${replies.length} 条线程回复</div>
						${replies.length ? replies.map(threadMsgHtml).join("") : `<div class="tea-thread__empty">还没有回复，来开个头吧。</div>`}
					`;
					threadBody.scrollTop = threadBody.scrollHeight;
				} catch (e) {
					threadBody.innerHTML = `<div class="tea-thread__empty">线程暂时打不开：${esc(e.message || "网络异常")}</div>`;
				}
			};
			rt.openThread = openThread;
			const closeThread = () => {
				if (threadView) threadView.hidden = true;
				currentThreadRoot = "";
				currentThreadLatest = "";
			};
			rt.closeThread = closeThread;
			threadView?.querySelectorAll("[data-tea-thread-close]").forEach((b) => b.addEventListener("click", closeThread));

			const doThreadSend = async () => {
				if (!threadInput || !currentThreadRoot) return;
				const text = threadInput.value.trim();
				if (!text) return;
				if (!rt.visitor) {
					showError("先入座才能回复线程");
					openDialog();
					return;
				}
				threadInput.disabled = true;
				if (threadSend) threadSend.disabled = true;
				try {
					await sendText(text, null, currentThreadRoot, currentThreadLatest);
					threadInput.value = "";
					await openThread(currentThreadRoot);
					if (rt.refreshThreads) rt.refreshThreads();
				} catch (e) {
					showError(e.message || "发送失败");
				} finally {
					threadInput.disabled = false;
					if (threadSend) threadSend.disabled = false;
					threadInput.focus();
				}
			};
			threadSend?.addEventListener("click", doThreadSend);
			threadInput?.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
					e.preventDefault();
					doThreadSend();
				}
			});

			// ── 置顶消息 ──────────────────────────────────────────
			const pinsBox = q("[data-tea-pins]");
			const pinsBody = q("[data-tea-pins-body]");
			const pinsToggle = q("[data-tea-pins-toggle]");
			const pinOpen = () => {
				if (!pinsBox) return;
				const collapsed = pinsBox.classList.toggle("tea-pins--collapsed");
				if (pinsToggle) pinsToggle.textContent = collapsed ? "展开" : "收起";
			};
			pinsToggle?.addEventListener("click", pinOpen);
			pinsBox?.classList.add("tea-pins--collapsed");
			const loadPins = async () => {
				if (!pinsBox || !pinsBody) return;
				if (rt.room !== "lobby") { pinsBox.hidden = true; return; }
				try {
					const data = await api(`/api/pins?room=${rt.room}`);
					const pins = data.pins || [];
					if (!pins.length) { pinsBox.hidden = true; return; }
					pinsBody.innerHTML = pins
						.map((p) => {
							const nick = p.nick || "茶友";
							const site = p.site ? ` · ${esc(p.site)}` : "";
							const text = fmtText(p.text || "");
							return `<div class="tea-pins__item"><span class="tea-pins__who">📌 ${esc(nick)}${site}：</span><span class="tea-pins__text">${text}</span></div>`;
						})
						.join("");
					pinsBox.hidden = false;
				} catch (_) {
					pinsBox.hidden = true;
				}
			};
			rt.loadPins = loadPins;
			loadPins();

			// ── 阅读位置：离开时存时间戳，回来时显示分隔线与跳转按钮 ──
			const readJump = q("[data-tea-readjump]");
			readJump?.addEventListener("click", () => {
				const mark = feedEl()?.querySelector("[data-tea-readmark]");
				if (!mark) return;
				mark.scrollIntoView({ block: "center", behavior: "smooth" });
				mark.animate(
					[{ background: "color-mix(in oklch, var(--primary) 40%, transparent)" }, {}],
					{ duration: 1200, easing: "ease-out" },
				);
			});
			window.addEventListener("pagehide", () => rt.saveReadMark?.());
			document.addEventListener("visibilitychange", () => {
				if (document.visibilityState === "hidden") {
					rt.saveReadMark?.();
					return;
				}
				// 切回前台补一次回执：后台期间渲染的消息也算「看过了」
				const f = feedEl();
				const list = f ? [...f.querySelectorAll(".tea-msg[data-id]")].reverse() : [];
				const last = list.find((el) => el.dataset.sender && el.dataset.sender !== rt.visitor?.id);
				if (last) markRead({ id: last.dataset.id, sender: last.dataset.sender });
			});
		};

		if (!rt.bound) {
			for (const name of ["astro:page-load", "astro:after-swap", "swup:contentReplaced", "swup:page:view"]) {
				document.addEventListener(name, () => {
					if (root()) setup();
					else {
						clearTimeout(rt.timer);
						restoreChrome();
					}
				});
			}
			rt.bound = true;
		}
		setup();
	})();
