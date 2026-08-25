---
title: "B站批量隐藏投稿：一键把全部稿件设为仅自己可见"
published: 2026-08-23
description: "一个Tampermonkey脚本，在B站稿件管理页面一键把公开视频批量设置为仅自己可见，支持自动翻页、自定义起止页，127个视频实测通过。"
image: ./images/cover.png
tags: [Tampermonkey, 用户脚本, B站, 批量操作, 教程]
category: 折腾
draft: false
---

B站没有批量修改稿件可见性的功能。如果你有一百多个视频想全部设成"仅自己可见"，一个一个手动点编辑 → 更多设置 → 仅自己可见 → 提交，手都得废。

这个脚本就是干这件事的。脚本用 ZCode 配合商汤的 DeepSeek V4 Flash 模型辅助开发，最终版本稳定跑完 127 个视频。

## 效果

我在127个视频上实测过，最终结果：

- 124个视频成功设为仅自己可见
- 3个之前就已经是仅自己可见，自动跳过
- 自动翻了13页，没有遗漏
- 不需要手动翻页，设好起止页数点开始就行

## 安装

### 1. 安装 Tampermonkey

如果你还没装 Tampermonkey，先装一个：

- **Chrome**：[Chrome 网上应用店](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- **Edge**：[Edge 扩展](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
- **Firefox**：[Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)

### 2. 安装脚本

把下面的代码复制一下：

1. 点击 Tampermonkey 图标 → **创建新脚本**
2. 删除默认的模板内容
3. 粘贴下面的完整代码，保存（Ctrl+S）

```javascript
// ==UserScript==
// @name         B站批量隐藏投稿
// @namespace    https://bilibili.com/
// @version      9.0.0
// @description  批量将B站稿件设置为"仅自己可见"，支持自定义起止页，自动翻页
// @match        https://member.bilibili.com/platform/upload-manager/article*
// @match        https://member.bilibili.com/platform/upload/video/frame*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const ST = 'bili_batch_hide_v9';
    const QU = 'bili_batch_hide_queue_v9';
    const LIST_URL = 'https://member.bilibili.com/platform/upload-manager/article';
    const eUrl = b => 'https://member.bilibili.com/platform/upload/video/frame?type=edit&bvid=' + b;
    const slp = ms => new Promise(r => setTimeout(r, ms));

    function gs() { try { return JSON.parse(localStorage.getItem(ST)); } catch (e) { return null; } }
    function ss(s) { localStorage.setItem(ST, JSON.stringify(s)); }
    function cs() { localStorage.removeItem(ST); localStorage.removeItem(QU); }
    function gq() { try { return JSON.parse(localStorage.getItem(QU)) || []; } catch (e) { return []; } }
    function sq(q) { localStorage.setItem(QU, JSON.stringify(q)); }

    function curPg() {
        const m = location.href.match(/[?&]page=(\d+)/);
        return m ? parseInt(m[1]) : 1;
    }
    function isLP() { return location.href.includes('/upload-manager/article'); }
    function isEP() { return location.href.includes('/upload/video/frame'); }

    function collect() {
        const links = document.querySelectorAll('a[href*="/video/BV"]');
        const seen = new Set();
        const q = [];
        let sk = 0;
        links.forEach(a => {
            const m = a.href.match(/\/video\/(BV[a-zA-Z0-9]+)/);
            if (!m || seen.has(m[1])) return;
            seen.add(m[1]);
            const row = a.closest('li, div, [class*="item"]');
            if (row && row.textContent.includes('仅自己可见')) sk++;
            else q.push(m[1]);
        });
        return { queue: [...new Set(q)], skipped: sk };
    }

    function mkPanel() {
        if (document.getElementById('bs-panel')) return;
        const p = document.createElement('div');
        p.id = 'bs-panel';
        p.style.cssText = `
            position: fixed; z-index: 999999; right: 20px; top: 100px;
            width: 270px; padding: 15px; background: #18191c; color: #fff;
            border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,.35);
            font-size: 14px; font-family: Arial, sans-serif;
        `;
        p.innerHTML = `
            <div style="font-size:16px;font-weight:bold;margin-bottom:10px;">B站批量隐藏</div>
            <div id="bs-cur" style="margin-bottom:6px;color:#aaa;">当前页：第 ${curPg()} 页</div>
            <div id="bs-st" style="margin-bottom:10px;">状态：等待开始</div>
            <div id="bs-cnt" style="margin-bottom:12px;">已处理：0　跳过：0　失败：0</div>
            <div style="margin-bottom:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span style="font-size:12px;color:#aaa;">从第</span>
                <input id="bs-sp" type="number" min="1" max="99" value="1"
                    style="width:45px;padding:4px;border:1px solid #555;border-radius:4px;background:#2a2a2a;color:#fff;text-align:center;font-size:13px;">
                <span style="font-size:12px;color:#aaa;">页到第</span>
                <input id="bs-ep" type="number" min="1" max="99" value="99"
                    style="width:45px;padding:4px;border:1px solid #555;border-radius:4px;background:#2a2a2a;color:#fff;text-align:center;font-size:13px;">
                <span style="font-size:12px;color:#aaa;">页</span>
            </div>
            <button id="bs-go" style="width:100%;padding:8px;border:0;border-radius:6px;
                background:#00aeec;color:#fff;cursor:pointer;margin-bottom:6px;">开始批量隐藏</button>
            <button id="bs-stp" style="width:100%;padding:8px;border:0;border-radius:6px;
                background:#444;color:#fff;cursor:pointer;margin-bottom:6px;">停止</button>
            <button id="bs-rst" style="width:100%;padding:6px;border:0;border-radius:6px;
                background:#333;color:#aaa;cursor:pointer;font-size:12px;">重置状态</button>
            <div style="margin-top:10px;color:#aaa;font-size:12px;line-height:1.5;">
                自动翻页处理到结束页。<br>已"仅自己可见"的自动跳过。<br>面板在列表页和编辑页都会显示。
            </div>
        `;
        document.body.appendChild(p);

        const sp = localStorage.getItem('bs_sp');
        const ep = localStorage.getItem('bs_ep');
        if (sp) document.getElementById('bs-sp').value = sp;
        if (ep) document.getElementById('bs-ep').value = ep;

        document.getElementById('bs-sp').onchange = () => localStorage.setItem('bs_sp', document.getElementById('bs-sp').value);
        document.getElementById('bs-ep').onchange = () => localStorage.setItem('bs_ep', document.getElementById('bs-ep').value);

        document.getElementById('bs-go').onclick = function () {
            if (gs() && gs().running) { stUI('运行中，请先停止'); return; }
            const sp = Math.max(1, parseInt(document.getElementById('bs-sp').value) || 1);
            const ep = Math.max(sp, parseInt(document.getElementById('bs-ep').value) || 99);
            cs();
            ss({
                running: true, collected: false, reachedStart: false,
                processed: 0, skipped: 0, failed: 0, queue: [],
                startPage: sp, endPage: ep, currentPage: 0, done: false
            });
            sq([]);
            localStorage.setItem('bs_sp', String(sp));
            localStorage.setItem('bs_ep', String(ep));
            stUI('开始（第 ' + sp + '~' + ep + ' 页）');
            location.href = LIST_URL + (sp > 1 ? '?page=' + sp : '');
        };

        document.getElementById('bs-stp').onclick = () => { cs(); stUI('已停止'); updP(); };
        document.getElementById('bs-rst').onclick = () => { cs(); stUI('已重置'); updP(); };
    }

    function updP() {
        const s = gs();
        const el = document.getElementById('bs-cnt');
        const pel = document.getElementById('bs-cur');
        if (el && s) el.textContent = '已处理：' + (s.processed || 0) + '　跳过：' + (s.skipped || 0) + '　失败：' + (s.failed || 0);
        else if (el) el.textContent = '已处理：0　跳过：0　失败：0';
        if (pel) pel.textContent = '当前页：第 ' + curPg() + ' 页（目标 ' + (s ? s.startPage + '~' + s.endPage : '-') + '）';
    }
    function stUI(t) { const el = document.getElementById('bs-st'); if (el) el.textContent = '状态：' + t; }

    function advance() {
        const s = gs();
        if (!s || !s.running || !isLP()) return;
        if (s.done) return;

        s.currentPage = curPg();
        ss(s);
        updP();

        if (!s.reachedStart) {
            if (curPg() < s.startPage) {
                stUI('跳转到第 ' + s.startPage + ' 页...');
                location.href = LIST_URL + '?page=' + s.startPage;
                return;
            }
            s.reachedStart = true;
            ss(s);
        }

        if (curPg() > s.endPage) { finish(); return; }

        if (!s.collected) {
            const { queue, skipped } = collect();
            if (queue.length === 0 && document.querySelectorAll('a[href*="/video/BV"]').length === 0) {
                stUI('等待页面加载...');
                setTimeout(() => { if (gs() && gs().running && !gs().done) advance(); }, 2000);
                return;
            }
            s.skipped = (s.skipped || 0) + skipped;
            s.queue = queue;
            s.collected = true;
            ss(s);
            sq(queue);

            if (queue.length === 0) {
                stUI('本页无待处理，进入下一页');
                s.collected = false; ss(s); nextPage();
                return;
            }
            goEdit();
            return;
        }

        if (s.queue.length > 0) { goEdit(); return; }
        s.collected = false; ss(s); nextPage();
    }

    function goEdit() {
        const s = gs();
        if (!s || !s.running) return;
        if (!s.queue || s.queue.length === 0) { advance(); return; }
        const next = s.queue.shift();
        sq(s.queue);
        ss(s);
        stUI('处理 ' + next + ' | 第 ' + s.currentPage + '/' + s.endPage + ' 页');
        location.href = eUrl(next);
    }

    function nextPage() {
        const s = gs();
        if (!s || !s.running || s.done) return;
        if (curPg() >= s.endPage) { finish(); return; }
        stUI('进入第 ' + (curPg() + 1) + ' 页...');
        s.collected = false; ss(s);
        location.href = LIST_URL + '?page=' + (curPg() + 1);
    }

    function finish() {
        const s = gs(); if (!s) return;
        s.done = true; ss(s);
        const msg = '🎉 全部完成！\n处理：' + (s.processed || 0) + '，跳过：' + (s.skipped || 0) + '，失败：' + (s.failed || 0);
        alert(msg); cs(); stUI('全部完成');
    }

    async function handleEP() {
        const s = gs();
        if (!s || !s.running || s.done) return;
        updP(); stUI('正在编辑...');
        await slp(2000);

        let ok = false, clicked = false;
        const labels = document.querySelectorAll('span.label');
        for (const l of labels) { if (l.textContent.trim().startsWith('更多设置')) { l.click(); clicked = true; break; } }
        if (!clicked) {
            const titles = document.querySelectorAll('div.title');
            for (const t of titles) { if (t.textContent.trim().startsWith('更多设置')) { t.click(); clicked = true; break; } }
        }
        if (!clicked) {
            const all = document.querySelectorAll('span, div, a');
            for (const e of all) { if (e.textContent.trim().startsWith('更多设置')) { e.click(); clicked = true; break; } }
        }

        if (clicked) {
            await slp(1200);
            const containers = document.querySelectorAll('.check-radio-v2-container');
            if (containers.length >= 2) {
                const isChecked = containers[1].querySelector('.check-radio-v2-box-checked') !== null;
                if (!isChecked) {
                    const radio = containers[1].querySelector('.check-radio-v2-box, span');
                    if (radio) radio.click(); else containers[1].click();
                    await slp(800);
                }
                const sub = document.querySelector('span.submit-add');
                if (sub) { sub.click(); ok = true; }
                else {
                    const all = document.querySelectorAll('div, button, span');
                    for (const e of all) { if (e.textContent.trim() === '立即投稿') { e.click(); ok = true; break; } }
                }
            }
        }

        const st = gs();
        if (st) { if (ok) st.processed = (st.processed || 0) + 1; else st.failed = (st.failed || 0) + 1; ss(st); }
        updP();
        stUI(ok ? '已提交，返回列表...' : '失败，返回列表...');
        await slp(2500);
        const st2 = gs();
        const pg = st2 && st2.currentPage ? st2.currentPage : 1;
        location.href = LIST_URL + (pg > 1 ? '?page=' + pg : '');
    }

    setTimeout(function () { mkPanel(); updP(); }, 500);

    if (isLP()) {
        setTimeout(function () {
            const s = gs();
            if (s && s.running && !s.done) { stUI('自动继续...'); updP(); advance(); updP(); }
        }, 2000);
    }

    if (isEP()) { handleEP(); }
})();
```

## 使用方法

### 1. 打开稿件管理页面

在浏览器中打开 [B站创作中心 → 稿件管理](https://member.bilibili.com/platform/upload-manager/article)

### 2. 设置起止页数

页面右上角会出现一个黑色的控制面板：

- **从第\_页到第\_页**：默认处理全部页面（1~99页）。如果你只想处理第3页到第5页，改一下这两个数字就行
- 设置会自动保存，下次打开还是上次填的数值

### 3. 点击"开始批量隐藏"

点完按钮后，脚本会自动：

1. 跳转到起始页
2. 收集当前页所有公开视频
3. 逐个进入编辑页，设置为仅自己可见，提交
4. 本页处理完 → 自动翻到下一页
5. 到结束页后停止，弹窗显示统计结果

### 4. 观察进度

面板会一直显示在页面右上角，无论是在列表页还是编辑页都能看到：

- 当前在第几页
- 已处理 / 跳过 / 失败的数量
- 当前正在处理哪个视频

### 5. 中途想停

点击 **"停止"** 按钮即可。之后想继续，回到列表页设置好起止页数，再点"开始"就行。

## 注意事项

- **建议先小范围测试**。比如先设置从第1页到第1页，跑一下确认没问题，再处理全部。
- 已经"仅自己可见"的稿件会自动跳过，不会重复处理。
- 处理过程中页面会在列表页和编辑页之间来回跳转，这是正常现象。
- 如果翻页时卡住了，点 **"重置状态"** 再重新开始。
- 不兼容B站专栏稿件，只处理视频稿件。

## 脚本原理

说起来其实很简单：脚本在列表页收集所有视频的BV ID，逐个跳转到编辑页，自动展开"更多设置"→ 选中"仅自己可见"→ 提交，然后回到列表页取下一条。翻页是通过直接跳转URL实现的，比依赖SPA的"下一页"按钮要稳定得多。

全程大概就是这个流程：

```
列表页收集BV ID → 跳转编辑页 → 展开更多设置 → 选仅自己可见 → 提交 → 回列表页 → 下一个
                                                                    ↓
                                                            本页完成 → 翻页到下一页
```

如果你有批量处理B站视频的需求，这个脚本应该能帮你省不少时间。用之前记得先备份，毕竟批量操作出了错不太好恢复。





最后再分享一个设置为公开可见的脚本，直接叫我的zcode+dsv4f在上面的基础直接改的
```javascript
// ==UserScript==
// @name         B站批量公开投稿
// @namespace    https://bilibili.com/
// @version      1.0.0
// @description  批量将B站稿件设置为"公开可见"，支持自定义起止页，自动翻页
// @match        https://member.bilibili.com/platform/upload-manager/article*
// @match        https://member.bilibili.com/platform/upload/video/frame*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const ST = 'bili_batch_public_v1';
    const QU = 'bili_batch_public_queue_v1';
    const LIST_URL = 'https://member.bilibili.com/platform/upload-manager/article';
    const eUrl = b => 'https://member.bilibili.com/platform/upload/video/frame?type=edit&bvid=' + b;
    const slp = ms => new Promise(r => setTimeout(r, ms));

    function gs() { try { return JSON.parse(localStorage.getItem(ST)); } catch (e) { return null; } }
    function ss(s) { localStorage.setItem(ST, JSON.stringify(s)); }
    function cs() { localStorage.removeItem(ST); localStorage.removeItem(QU); }
    function gq() { try { return JSON.parse(localStorage.getItem(QU)) || []; } catch (e) { return []; } }
    function sq(q) { localStorage.setItem(QU, JSON.stringify(q)); }

    function curPg() {
        const m = location.href.match(/[?&]page=(\d+)/);
        return m ? parseInt(m[1]) : 1;
    }
    function isLP() { return location.href.includes('/upload-manager/article'); }
    function isEP() { return location.href.includes('/upload/video/frame'); }

    function collect() {
        const links = document.querySelectorAll('a[href*="/video/BV"]');
        const seen = new Set();
        const q = [];
        let sk = 0;
        links.forEach(a => {
            const m = a.href.match(/\/video\/(BV[a-zA-Z0-9]+)/);
            if (!m || seen.has(m[1])) return;
            seen.add(m[1]);
            const row = a.closest('li, div, [class*="item"]');
            // 跳过已经是公开的（没有"仅自己可见"标记的视为公开）
            if (row && !row.textContent.includes('仅自己可见')) sk++;
            else q.push(m[1]);
        });
        return { queue: [...new Set(q)], skipped: sk };
    }

    function mkPanel() {
        if (document.getElementById('bs-panel')) return;
        const p = document.createElement('div');
        p.id = 'bs-panel';
        p.style.cssText = `
            position: fixed; z-index: 999999; right: 20px; top: 100px;
            width: 270px; padding: 15px; background: #18191c; color: #fff;
            border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,.35);
            font-size: 14px; font-family: Arial, sans-serif;
        `;
        p.innerHTML = `
            <div style="font-size:16px;font-weight:bold;margin-bottom:10px;">B站批量公开</div>
            <div id="bs-cur" style="margin-bottom:6px;color:#aaa;">当前页：第 ${curPg()} 页</div>
            <div id="bs-st" style="margin-bottom:10px;">状态：等待开始</div>
            <div id="bs-cnt" style="margin-bottom:12px;">已公开：0　跳过：0　失败：0</div>
            <div style="margin-bottom:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span style="font-size:12px;color:#aaa;">从第</span>
                <input id="bs-sp" type="number" min="1" max="99" value="1"
                    style="width:45px;padding:4px;border:1px solid #555;border-radius:4px;background:#2a2a2a;color:#fff;text-align:center;font-size:13px;">
                <span style="font-size:12px;color:#aaa;">页到第</span>
                <input id="bs-ep" type="number" min="1" max="99" value="99"
                    style="width:45px;padding:4px;border:1px solid #555;border-radius:4px;background:#2a2a2a;color:#fff;text-align:center;font-size:13px;">
                <span style="font-size:12px;color:#aaa;">页</span>
            </div>
            <button id="bs-go" style="width:100%;padding:8px;border:0;border-radius:6px;
                background:#00aeec;color:#fff;cursor:pointer;margin-bottom:6px;">开始批量公开</button>
            <button id="bs-stp" style="width:100%;padding:8px;border:0;border-radius:6px;
                background:#444;color:#fff;cursor:pointer;margin-bottom:6px;">停止</button>
            <button id="bs-rst" style="width:100%;padding:6px;border:0;border-radius:6px;
                background:#333;color:#aaa;cursor:pointer;font-size:12px;">重置状态</button>
            <div style="margin-top:10px;color:#aaa;font-size:12px;line-height:1.5;">
                自动翻页处理到结束页。<br>已公开的自动跳过。<br>面板在列表页和编辑页都会显示。
            </div>
        `;
        document.body.appendChild(p);

        const sp = localStorage.getItem('bs_sp');
        const ep = localStorage.getItem('bs_ep');
        if (sp) document.getElementById('bs-sp').value = sp;
        if (ep) document.getElementById('bs-ep').value = ep;

        document.getElementById('bs-sp').onchange = () => localStorage.setItem('bs_sp', document.getElementById('bs-sp').value);
        document.getElementById('bs-ep').onchange = () => localStorage.setItem('bs_ep', document.getElementById('bs-ep').value);

        document.getElementById('bs-go').onclick = function () {
            if (gs() && gs().running) { stUI('运行中，请先停止'); return; }
            const sp = Math.max(1, parseInt(document.getElementById('bs-sp').value) || 1);
            const ep = Math.max(sp, parseInt(document.getElementById('bs-ep').value) || 99);
            cs();
            ss({
                running: true, collected: false, reachedStart: false,
                processed: 0, skipped: 0, failed: 0, queue: [],
                startPage: sp, endPage: ep, currentPage: 0, done: false
            });
            sq([]);
            localStorage.setItem('bs_sp', String(sp));
            localStorage.setItem('bs_ep', String(ep));
            stUI('开始（第 ' + sp + '~' + ep + ' 页）');
            location.href = LIST_URL + (sp > 1 ? '?page=' + sp : '');
        };

        document.getElementById('bs-stp').onclick = () => { cs(); stUI('已停止'); updP(); };
        document.getElementById('bs-rst').onclick = () => { cs(); stUI('已重置'); updP(); };
    }

    function updP() {
        const s = gs();
        const el = document.getElementById('bs-cnt');
        const pel = document.getElementById('bs-cur');
        if (el && s) el.textContent = '已公开：' + (s.processed || 0) + '　跳过：' + (s.skipped || 0) + '　失败：' + (s.failed || 0);
        else if (el) el.textContent = '已公开：0　跳过：0　失败：0';
        if (pel) pel.textContent = '当前页：第 ' + curPg() + ' 页（目标 ' + (s ? s.startPage + '~' + s.endPage : '-') + '）';
    }
    function stUI(t) { const el = document.getElementById('bs-st'); if (el) el.textContent = '状态：' + t; }

    function advance() {
        const s = gs();
        if (!s || !s.running || !isLP()) return;
        if (s.done) return;

        s.currentPage = curPg();
        ss(s);
        updP();

        if (!s.reachedStart) {
            if (curPg() < s.startPage) {
                stUI('跳转到第 ' + s.startPage + ' 页...');
                location.href = LIST_URL + '?page=' + s.startPage;
                return;
            }
            s.reachedStart = true;
            ss(s);
        }

        if (curPg() > s.endPage) { finish(); return; }

        if (!s.collected) {
            const { queue, skipped } = collect();
            if (queue.length === 0 && document.querySelectorAll('a[href*="/video/BV"]').length === 0) {
                stUI('等待页面加载...');
                setTimeout(() => { if (gs() && gs().running && !gs().done) advance(); }, 2000);
                return;
            }
            s.skipped = (s.skipped || 0) + skipped;
            s.queue = queue;
            s.collected = true;
            ss(s);
            sq(queue);

            if (queue.length === 0) {
                stUI('本页无待处理，进入下一页');
                s.collected = false; ss(s); nextPage();
                return;
            }
            goEdit();
            return;
        }

        if (s.queue.length > 0) { goEdit(); return; }
        s.collected = false; ss(s); nextPage();
    }

    function goEdit() {
        const s = gs();
        if (!s || !s.running) return;
        if (!s.queue || s.queue.length === 0) { advance(); return; }
        const next = s.queue.shift();
        sq(s.queue);
        ss(s);
        stUI('处理 ' + next + ' | 第 ' + s.currentPage + '/' + s.endPage + ' 页');
        location.href = eUrl(next);
    }

    function nextPage() {
        const s = gs();
        if (!s || !s.running || s.done) return;
        if (curPg() >= s.endPage) { finish(); return; }
        stUI('进入第 ' + (curPg() + 1) + ' 页...');
        s.collected = false; ss(s);
        location.href = LIST_URL + '?page=' + (curPg() + 1);
    }

    function finish() {
        const s = gs(); if (!s) return;
        s.done = true; ss(s);
        alert('🎉 全部完成！\n已公开：' + (s.processed || 0) + '，跳过：' + (s.skipped || 0) + '，失败：' + (s.failed || 0));
        cs(); stUI('全部完成');
    }

    async function handleEP() {
        const s = gs();
        if (!s || !s.running || s.done) return;
        updP(); stUI('正在编辑...');
        await slp(2000);

        let ok = false, clicked = false;
        const labels = document.querySelectorAll('span.label');
        for (const l of labels) { if (l.textContent.trim().startsWith('更多设置')) { l.click(); clicked = true; break; } }
        if (!clicked) {
            const titles = document.querySelectorAll('div.title');
            for (const t of titles) { if (t.textContent.trim().startsWith('更多设置')) { t.click(); clicked = true; break; } }
        }
        if (!clicked) {
            const all = document.querySelectorAll('span, div, a');
            for (const e of all) { if (e.textContent.trim().startsWith('更多设置')) { e.click(); clicked = true; break; } }
        }

        if (clicked) {
            await slp(1200);
            const containers = document.querySelectorAll('.check-radio-v2-container');
            if (containers.length >= 2) {
                const isChecked = containers[0].querySelector('.check-radio-v2-box-checked') !== null;
                if (!isChecked) {
                    // 点击"公开可见"（第一个容器）
                    const radio = containers[0].querySelector('.check-radio-v2-box, span');
                    if (radio) radio.click(); else containers[0].click();
                    await slp(800);
                }
                const sub = document.querySelector('span.submit-add');
                if (sub) { sub.click(); ok = true; }
                else {
                    const all = document.querySelectorAll('div, button, span');
                    for (const e of all) { if (e.textContent.trim() === '立即投稿') { e.click(); ok = true; break; } }
                }
            }
        }

        const st = gs();
        if (st) { if (ok) st.processed = (st.processed || 0) + 1; else st.failed = (st.failed || 0) + 1; ss(st); }
        updP();
        stUI(ok ? '已提交，返回列表...' : '失败，返回列表...');
        await slp(2500);
        const st2 = gs();
        const pg = st2 && st2.currentPage ? st2.currentPage : 1;
        location.href = LIST_URL + (pg > 1 ? '?page=' + pg : '');
    }

    setTimeout(function () { mkPanel(); updP(); }, 500);

    if (isLP()) {
        setTimeout(function () {
            const s = gs();
            if (s && s.running && !s.done) { stUI('自动继续...'); updP(); advance(); updP(); }
        }, 2000);
    }

    if (isEP()) { handleEP(); }
})();
```