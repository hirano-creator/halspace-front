/* SOLID チャットの LINE 風リプライ機能 E2E（ローカルAPI 127.0.0.1:8000 + 静的 8088）
   - chat.html（社内/モデラー用）: ホバー返信 → 返信バー → 送信 → 引用クリックで元へジャンプ
   - project-detail.html（発注者も使う）: 同上
   - スマホ相当（タッチ）: 右スワイプで返信、長押しで操作ボタン
   事前に tokens.txt（tinker で発行した Sanctum トークン）を用意しておく */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const FRONT = 'http://127.0.0.1:8088/solid/app';
const API = 'http://127.0.0.1:8000/api';
const TOKENS = Object.fromEntries(fs.readFileSync(
  'C:/Users/wsk66/AppData/Local/Temp/claude/c--dev-my-programming-solid/3ad982c1-a130-471e-b5ec-3f14cc0753b7/scratchpad/tokens.txt', 'utf8')
  .trim().split('\n').map(l => l.split(/:(.+)/).slice(0, 2)));
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' - ' + detail : ''));
}

async function me(token) {
  const r = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  return (await r.json()).user;
}

async function newPage(browser, token, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1280, height: 860 },
    hasTouch: !!opts.mobile, isMobile: !!opts.mobile,
    deviceScaleFactor: 1,
  });
  const user = await me(token);
  await ctx.addInitScript(([t, u]) => {
    sessionStorage.setItem('space_token', t);
    sessionStorage.setItem('space_user', JSON.stringify(u));
    sessionStorage.setItem('solid_standalone', '1');
  }, [token, user]);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  page.on('dialog', d => d.accept());
  return { ctx, page };
}

/* 合成タッチで右スワイプ */
async function swipeRight(page, selector, dx = 70) {
  await page.evaluate(([sel, dx]) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const x0 = r.left + 40, y0 = r.top + r.height / 2;
    const mk = (type, x) => {
      const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y0, pageX: x, pageY: y0 });
      const list = type === 'touchend' ? [] : [t];
      el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: list, targetTouches: list, changedTouches: [t] }));
    };
    mk('touchstart', x0);
    mk('touchmove', x0 + 12);
    mk('touchmove', x0 + 40);
    mk('touchmove', x0 + dx);
    mk('touchend', x0 + dx);
  }, [selector, dx]);
}
async function longPress(page, selector, ms = 600) {
  await page.evaluate(([sel]) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const x = r.left + 60, y = r.top + r.height / 2;
    const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
  }, [selector]);
  await page.waitForTimeout(ms);
  await page.evaluate(([sel]) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const x = r.left + 60, y = r.top + r.height / 2;
    const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t] }));
  }, [selector]);
}

(async () => {
  const browser = await chromium.launch();
  const created = [];   // 後片付け用 [path]

  /* 画像だけのメッセージを1件作っておく（サムネ付き引用の確認用。既存データの画像はローカルR2に無い） */
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFklEQVR42mP8z8BQz0AEYBxVSF+FAAhKDveksOjmAAAAAElFTkSuQmCC', 'base64');
  const fd = new FormData();
  fd.append('channel', 'client');
  fd.append('images[]', new Blob([png], { type: 'image/png' }), 'dot.png');
  const imgRes = await fetch(`${API}/chat/rooms/p23/messages`, { method: 'POST', body: fd, headers: { Authorization: `Bearer ${TOKENS['1']}`, Accept: 'application/json' } });
  const IMG = String((await imgRes.json()).message.id);
  created.push(`/comments/${IMG}`);
  console.log('image message id', IMG);

  /* ===== 1. chat.html（管理者・PC） ===== */
  {
    const { ctx, page } = await newPage(browser, TOKENS['1']);
    await page.goto(`${FRONT}/chat.html`);
    await page.waitForSelector('.cr-room[data-key="p23"]');
    await page.click('.cr-room[data-key="p23"]');
    await page.waitForSelector(`.cr-msg[data-id="${IMG}"]`);
    // 画像のblob化待ち（ローカルの artisan serve は単一プロセス + R2往復なので数秒かかる）
    await page.waitForFunction(IMG => (document.querySelector(`.cr-msg[data-id="${IMG}"] img.cr-img`)?.src || '').startsWith('blob:'), IMG, { timeout: 30000 });

    // ホバーで返信ボタン → 返信バー
    await page.hover(`.cr-msg[data-id="${IMG}"]`);
    await page.click(`.cr-msg[data-id="${IMG}"] [data-act="reply"]`);
    const barShown = await page.isVisible('#replyBar');
    const barName = await page.textContent('#replyName');
    const barImg = await page.evaluate(() => { const i = document.getElementById('replyImg'); return i.style.display !== 'none' && !!i.src; });
    check('chat: reply bar opens', barShown, barName);
    check('chat: reply bar says "〇〇 に返信"', /に返信$/.test(barName), barName);
    check('chat: reply bar shows thumbnail for image message', barImg);
    await page.screenshot({ path: path.join(SHOTS, 'reply-chat-bar.png') });

    // × で解除 → Esc でも解除
    await page.click('#replyCancel');
    check('chat: cancel button hides bar', !(await page.isVisible('#replyBar')));
    await page.hover(`.cr-msg[data-id="${IMG}"]`);
    await page.click(`.cr-msg[data-id="${IMG}"] [data-act="reply"]`);
    await page.keyboard.press('Escape');
    check('chat: Esc hides bar', !(await page.isVisible('#replyBar')));

    // 送信
    await page.hover('.cr-msg[data-id="20"]');
    await page.click('.cr-msg[data-id="20"] [data-act="reply"]');
    await page.fill('#msgInput', 'E2E: 引用返信テスト');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.cr-msg .cr-quote[data-quote="20"]');
    const newId = await page.evaluate(() => document.querySelector('.cr-quote[data-quote="20"]').closest('.cr-msg').dataset.id);
    created.push(`/comments/${newId}`);
    check('chat: sent message shows quote of #20', !!newId, 'new id ' + newId);
    check('chat: bar cleared after send', !(await page.isVisible('#replyBar')));
    const qText = await page.textContent(`.cr-msg[data-id="${newId}"] .cr-quote`);
    check('chat: quote shows name+body', qText.includes('管理者') && qText.includes('test'), qText.trim());

    // 引用クリック → 元がハイライト
    await page.click(`.cr-msg[data-id="${newId}"] .cr-quote`);
    await page.waitForTimeout(100);
    check('chat: click quote flashes original', await page.evaluate(() => document.querySelector('.cr-msg[data-id="20"]').classList.contains('flash')));
    await page.screenshot({ path: path.join(SHOTS, 'reply-chat-quote.png') });

    // 画像付きの引用（サムネ）
    await page.hover(`.cr-msg[data-id="${IMG}"]`);
    await page.click(`.cr-msg[data-id="${IMG}"] [data-act="reply"]`);
    await page.fill('#msgInput', 'E2E: 画像への返信');
    await page.click('#btnSend');
    await page.waitForSelector(`.cr-quote[data-quote="${IMG}"] img.cr-quote-img`);
    await page.waitForFunction(IMG => (document.querySelector(`.cr-quote[data-quote="${IMG}"] img.cr-quote-img`)?.src || '').startsWith('blob:'), IMG, { timeout: 30000 });
    const id2 = await page.evaluate((IMG) => document.querySelector(`.cr-quote[data-quote="${IMG}"]`).closest('.cr-msg').dataset.id, IMG);
    created.push(`/comments/${id2}`);
    const thumbLoaded = await page.evaluate((IMG) => !!document.querySelector(`.cr-quote[data-quote="${IMG}"] img.cr-quote-img`).src, IMG);
    check('chat: quote of image message shows thumbnail', thumbLoaded);
    await page.screenshot({ path: path.join(SHOTS, 'reply-chat-image-quote.png') });

    // コピー
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8088' });
    await page.hover('.cr-msg[data-id="20"]');
    await page.click('.cr-msg[data-id="20"] [data-act="copy"]');
    await page.waitForTimeout(200);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check('chat: copy action copies body', clip === 'test', clip);
    await ctx.close();
  }

  /* ===== 2. chat.html（モデラー・スマホ/タッチ） ===== */
  {
    const { ctx, page } = await newPage(browser, TOKENS['1'], { mobile: true });
    await page.goto(`${FRONT}/chat.html`);
    await page.waitForSelector('.cr-room[data-key="p23"]');
    await page.click('.cr-room[data-key="p23"]');
    await page.waitForSelector('.cr-msg[data-id="20"]');
    await page.waitForTimeout(300);

    await swipeRight(page, '.cr-msg[data-id="20"]');
    await page.waitForTimeout(250);
    check('mobile chat: swipe right opens reply bar', await page.isVisible('#replyBar'), await page.textContent('#replyName'));
    check('mobile chat: transform reset after swipe', await page.evaluate(() => document.querySelector('.cr-msg[data-id="20"]').style.transform === ''));
    await page.screenshot({ path: path.join(SHOTS, 'reply-chat-mobile-swipe.png') });
    await page.click('#replyCancel');

    // 短いスワイプは返信にならない
    await swipeRight(page, `.cr-msg[data-id="${IMG}"]`, 30);
    await page.waitForTimeout(250);
    check('mobile chat: short swipe does nothing', !(await page.isVisible('#replyBar')));

    // 長押しで操作ボタン
    await longPress(page, `.cr-msg[data-id="${IMG}"]`);
    await page.waitForTimeout(100);
    const actsVisible = await page.evaluate((IMG) => {
      const el = document.querySelector(`.cr-msg[data-id="${IMG}"]`);
      return el.classList.contains('acts-open') && getComputedStyle(el.querySelector('.cr-msg-acts')).display === 'flex';
    }, IMG);
    check('mobile chat: long-press shows action buttons', actsVisible);
    await page.screenshot({ path: path.join(SHOTS, 'reply-chat-mobile-longpress.png') });
    await ctx.close();
  }

  /* ===== 3. project-detail.html（発注者・PC） ===== */
  {
    const { ctx, page } = await newPage(browser, TOKENS['4']);
    await page.goto(`${FRONT}/project-detail.html?id=23`);
    await page.waitForSelector('#chatMessages .chat-msg[data-id="20"]');
    await page.waitForFunction(IMG => (document.querySelector(`#chatMessages .chat-quote[data-quote="${IMG}"] img.chat-quote-img`)?.src || '').startsWith('blob:'), IMG, { timeout: 30000 }).catch(() => {});

    // 管理者がチャット画面から送った引用返信が発注者にも引用付きで見える
    const seen = await page.evaluate(() => !!document.querySelector('#chatMessages .chat-quote[data-quote="20"]'));
    check('detail: quote from chat.html visible to client', seen);
    const thumb = await page.evaluate((IMG) => { const i = document.querySelector(`#chatMessages .chat-quote[data-quote="${IMG}"] img.chat-quote-img`); return !!(i && i.src && i.src.startsWith('blob:')); }, IMG);
    check('detail: image quote shows thumbnail', thumb);

    // ホバー → 返信ボタン → 返信バー
    await page.hover('.chat-msg[data-id="20"] .chat-bubble-wrap');
    await page.click('.chat-msg[data-id="20"] .chat-reply-btn');
    check('detail: reply bar opens', await page.isVisible('#chatReplyBar'), await page.textContent('#chatReplyName'));
    await page.fill('#commentInput', 'E2E: 発注者からの返信');
    await page.click('#commentSubmit');
    await page.waitForFunction(() => document.querySelectorAll('#chatMessages .chat-msg.mine .chat-quote[data-quote="20"]').length > 0);
    const mineId = await page.evaluate(() => document.querySelector('#chatMessages .chat-msg.mine .chat-quote[data-quote="20"]').closest('.chat-msg').dataset.id);
    created.push(`/comments/${mineId}`);
    check('detail: own reply shows quote (white on blue)', !!mineId, 'id ' + mineId);
    check('detail: bar cleared after send', !(await page.isVisible('#chatReplyBar')));
    await page.screenshot({ path: path.join(SHOTS, 'reply-detail.png') });

    await page.click(`.chat-msg[data-id="${mineId}"] .chat-quote`);
    await page.waitForTimeout(100);
    check('detail: click quote flashes original', await page.evaluate(() => document.querySelector('.chat-msg[data-id="20"]').classList.contains('flash')));

    // Esc 解除
    await page.hover('.chat-msg[data-id="20"] .chat-bubble-wrap');
    await page.click('.chat-msg[data-id="20"] .chat-reply-btn');
    await page.focus('#commentInput');
    await page.keyboard.press('Escape');
    check('detail: Esc hides bar', !(await page.isVisible('#chatReplyBar')));
    await ctx.close();
  }

  /* ===== 4. project-detail.html（発注者・スマホ/タッチ） ===== */
  {
    const { ctx, page } = await newPage(browser, TOKENS['4'], { mobile: true });
    await page.goto(`${FRONT}/project-detail.html?id=23`);
    await page.waitForSelector('#chatMessages .chat-msg[data-id="20"]');
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#chatMessages').scrollIntoView());
    await swipeRight(page, '.chat-msg[data-id="20"]');
    await page.waitForTimeout(250);
    check('mobile detail: swipe right opens reply bar', await page.isVisible('#chatReplyBar'), await page.textContent('#chatReplyName'));
    await page.screenshot({ path: path.join(SHOTS, 'reply-detail-mobile.png') });
    await longPress(page, '.chat-msg[data-id="20"]');
    await page.waitForTimeout(100);
    check('mobile detail: long-press shows reply button', await page.evaluate(() =>
      getComputedStyle(document.querySelector('.chat-msg[data-id="20"] .chat-reply-btn')).display === 'flex'));
    await ctx.close();
  }

  // 後片付け
  for (const p of created) {
    await fetch(API + p, { method: 'DELETE', headers: { Authorization: `Bearer ${TOKENS['1']}`, Accept: 'application/json' } });
  }

  await browser.close();
  const pass = results.filter(r => r.ok).length;
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
