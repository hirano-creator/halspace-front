/* 手渡し（特定の人へ期限付きでファイルを渡す・受け取り箱）の画面検証

   確認すること:
   - 選択して「人に渡す」→ 社内の人を名前で選ぶ・他社の人をメールで探す → 送る内容
   - 他社の人が見つからないとき、メールで共有リンクを送る導線が出る
   - 他人のファイルを選んでいると「人に渡す」が押せない
   - 受け取り箱: 送り主・会社名・ひとこと・未開封、開く（view に handoff を付ける）・保存
   - 渡したもの: 開いた／まだ開いていない、取り消し
   - マイファイルへ戻ると一覧に戻る、?view=inbox で直接開く、手渡しの通知から受け取り箱へ
   - スマホ: 下部ナビの「いいね」が「受け取り」に替わり、バッジが出る。入力欄は16px以上
   - ファイル詳細: 自分のファイルにだけ「人に渡す」が出る

   実行: node _wn_e2e/handoff-e2e.js
   （バックエンド不要。APIはこのスクリプトが route で全部スタブする） */
const PW = (() => {
  try { return require('../_aa_e2e/node_modules/playwright-core'); }
  catch { return require('c:/dev/my-programming/_aa_e2e/node_modules/playwright-core'); }
})();
const { chromium } = PW;
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = process.env.WN_ROOT || path.resolve(__dirname, '..');
const PORT = 8793;
const BASE = `http://127.0.0.1:${PORT}`;

const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
               '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml',
               '.png':'image/png', '.json':'application/json' };

const IGNORE_ERR = /39876|localhost:39876|ERR_FAILED|status of 404/;
const noise = e => IGNORE_ERR.test(String(e));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404); return res.end('nf');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

function fileRow(id, name, owner) {
  return {
    id, file_name: name, file_size: 1234, mime_type: 'application/pdf',
    version: 1, created_at: '2026-10-30T00:00:00Z', updated_at: '2026-10-30T00:00:00Z',
    uploader: { id: owner, name: owner === 1 ? 'テスト太郎' : '同僚花子' }, tags: [],
    like_count: 0, liked: false, view_count: 0, comment_count: 0,
    approval_status: 'none', visibility: 'private', owner_user_id: owner, shared_at: null,
    can_edit: owner === 1,
  };
}

const future = d => new Date(Date.now() + d * 86400000).toISOString();
const INBOX = [
  { id: 11, batch_id: 'b1', state: 'active', message: '明日の打ち合わせ用です\n確認お願いします', expires_at: future(3),
    created_at: new Date(Date.now() - 3600e3).toISOString(), opened_at: null, saved_file_id: null, saved_at: null,
    file: { id: 501, file_name: '取引先_外形図.pdf', file_size: 204800, mime_type: 'application/pdf', version: 1 },
    from: { id: 9, name: '取引先一郎', company_name: 'B製作所', same_company: false } },
  { id: 12, batch_id: 'b1', state: 'active', message: '明日の打ち合わせ用です\n確認お願いします', expires_at: future(3),
    created_at: new Date(Date.now() - 3600e3).toISOString(), opened_at: '2026-10-31T01:00:00Z', saved_file_id: 77, saved_at: '2026-10-31T01:00:00Z',
    file: { id: 502, file_name: '現場写真.jpg', file_size: 102400, mime_type: 'image/jpeg', version: 1 },
    from: { id: 9, name: '取引先一郎', company_name: 'B製作所', same_company: false } },
  { id: 13, batch_id: 'b2', state: 'revoked', message: null, expires_at: future(1),
    created_at: new Date(Date.now() - 86400e3).toISOString(), opened_at: null, saved_file_id: null, saved_at: null,
    file: { id: 503, file_name: '古い見積.xlsx', file_size: null, mime_type: null, version: 1 },
    from: { id: 2, name: '同僚花子', company_name: 'テスト社', same_company: true } },
];
const SENT = [
  { id: 21, batch_id: 's1', message: '確認お願いします', created_at: new Date(Date.now() - 7200e3).toISOString(),
    expires_at: future(7), opened_at: '2026-10-31T02:03:00Z', saved_at: null, revoked_at: null, expired: false,
    file: { id: 1, file_name: '自分の図面.pdf', deleted: false },
    to: { id: 2, name: '同僚花子', company_name: 'テスト社', same_company: true } },
  { id: 22, batch_id: 's1', message: '確認お願いします', created_at: new Date(Date.now() - 7200e3).toISOString(),
    expires_at: future(7), opened_at: null, saved_at: null, revoked_at: null, expired: false,
    file: { id: 1, file_name: '自分の図面.pdf', deleted: false },
    to: { id: 9, name: '取引先一郎', company_name: 'B製作所', same_company: false } },
];

const calls = [];
let notifications = [];

async function stubApi(ctx) {
  await ctx.route('**/api/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const p   = url.pathname.replace(/^.*\/api/, '');
    const m   = req.method();
    const j   = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    calls.push({ m, p, q: url.search, body: req.postData() });

    if (p === '/wn/files') {
      return j({ data: [fileRow(1, '自分の図面.pdf', 1), fileRow(2, '同僚の図面.pdf', 2)],
                 meta: { current_page: 1, last_page: 1, per_page: 60, total: 2, storage_mode: 'personal' } });
    }
    if (p === '/wn/handoffs/summary')    return j({ unopened: 2, handoff_mail: true });
    if (p === '/wn/handoffs/recipients') return j({ data: [{ id: 2, name: '同僚花子' }, { id: 3, name: '工場長' }] });
    if (p === '/wn/handoffs/resolve-recipient') {
      const email = JSON.parse(req.postData()).email;
      if (email === 'partner@example.com') return j({ data: { id: 9, name: '取引先一郎', company_name: 'B製作所', same_company: false } });
      return j({ message: "What'sNo を使っている方が見つかりませんでした" }, 404);
    }
    if (p === '/wn/handoffs' && m === 'POST') {
      return j({ data: { batch_id: 'x', expires_at: future(3), recipients: [{ id: 2, name: '同僚花子' }, { id: 9, name: '取引先一郎' }] } }, 201);
    }
    if (p === '/wn/handoffs/inbox') return j({ data: INBOX, unopened: 1 });
    if (p === '/wn/handoffs/sent')  return j({ data: SENT });
    if (/^\/wn\/handoffs\/\d+\/save$/.test(p)) return j({ data: { file_id: 88, file_name: '取引先_外形図.pdf', already: false } }, 201);
    if (/^\/wn\/handoffs\/\d+$/.test(p) && m === 'DELETE') return j({ ok: true });
    if (/^\/wn\/files\/\d+\/view$/.test(p)) return j({ url: `${BASE}/whatsno/app/share.html` });
    if (/^\/wn\/files\/\d+\/thumb$/.test(p)) return route.fulfill({ status: 404, body: '' });
    if (p === '/wn/notifications') return j({ data: notifications, unread: notifications.filter(n => !n.read_at).length });
    if (p === '/wn/settings') return j({ data: { storage_mode: 'personal', my_private_count: 0 } });
    if (p === '/wn/contact-tags') return j({ data: [], groups: [] });
    return j({ data: [] });
  });
}

async function newPage(browser, viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', ...opts });
  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({
      id: 1, name: 'テスト太郎', email: 't@example.com', role: 'general',
      company: 'テスト社', company_id: 1, apps: ['whatsno'],
      wn_storage_mode: 'personal', wn_extended_options_enabled: true,
    }));
  });
  await stubApi(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { if (!noise(e)) errors.push(String(e)); });
  page.on('console', msg => { if (msg.type() === 'error' && !noise(msg.text())) errors.push(msg.text()); });
  return { ctx, page, errors };
}

/* カードは draggable なので、マウス操作だとドラッグ扱いになりクリックが届かないことがある。
   選択の仕組み自体はカードの click リスナーなので、要素の click() で叩く */
const pickCard = (page, id) => page.evaluate(i => document.querySelector(`#fileGrid [data-file-id="${i}"]`).click(), id);

const lastPost = path => [...calls].reverse().find(c => c.p === path && c.m === 'POST');

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();

  /* ══ PC ══ */
  {
    const { ctx, page, errors } = await newPage(browser, { width: 1440, height: 950 });
    await page.goto(`${BASE}/whatsno/app/dashboard.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__wnDashboardReady === true);
    await page.waitForTimeout(400);

    check('JSエラーが出ない', errors.length === 0, errors.join(' | '));
    check('サイドバーに受け取り箱と渡したものがある',
      await page.locator('#navInbox').isVisible() && await page.locator('#navSent').isVisible());
    check('受け取り箱に未開封の数が出る', (await page.locator('#navInboxBadge').textContent()) === '2'
      && await page.locator('#navInboxBadge').isVisible());

    /* ── 選択して人に渡す ── */
    // 既存テストと同じく関数で選択モードに入る（ボタンは幅によって別の要素の下になる）
    await page.evaluate(() => { if (!selectMode) toggleSelectMode(); });
    await pickCard(page, 2);
    await page.waitForTimeout(150);
    check('他人のファイルを選ぶと「人に渡す」は押せない', await page.locator('#handoffSelBtn').isDisabled());
    // 0件にすると選択モードが終わるので、先に自分のを足してから他人のを外す
    await pickCard(page, 1);
    await page.waitForTimeout(100);
    check('自分と他人のファイルが混ざっていても押せない', await page.locator('#handoffSelBtn').isDisabled());
    await pickCard(page, 2);
    await page.waitForTimeout(150);
    check('自分のファイルだけなら「人に渡す」を押せる', !(await page.locator('#handoffSelBtn').isDisabled()));

    await page.click('#handoffSelBtn');
    await page.waitForSelector('#wnHoModal:not(.hidden)');
    check('渡すモーダルにファイル名が出る', (await page.locator('#wnHoFiles').textContent()).includes('自分の図面.pdf'));
    check('相手を選ぶまで「渡す」は押せない', await page.locator('#wnHoSend').isDisabled());

    await page.fill('#wnHoSearch', '花子');
    await page.waitForSelector('#wnHoSuggest .wn-ho-sg-item');
    const sugg = await page.locator('#wnHoSuggest .wn-ho-sg-item').allTextContents();
    check('名前で社内の人を絞り込める', sugg.length === 1 && sugg[0].includes('同僚花子'), sugg.join(','));
    await page.click('#wnHoSuggest .wn-ho-sg-item');

    await page.click('#wnHoOther summary');
    await page.fill('#wnHoEmail', 'nobody@example.com');
    await page.click('#wnHoEmailBtn');
    await page.waitForSelector('#wnHoEmailMsg.error');
    check('見つからないときはメールで送る導線が出る',
      await page.locator('#wnHoEmailMsg .wn-ho-linkbtn').isVisible(),
      await page.locator('#wnHoEmailMsg').textContent());

    await page.fill('#wnHoEmail', 'partner@example.com');
    await page.press('#wnHoEmail', 'Enter');
    await page.waitForSelector('#wnHoEmailMsg.ok');
    const chips = await page.locator('#wnHoChips .wn-ho-chip').allTextContents();
    check('社内と他社の相手がチップで並ぶ（他社は会社名付き）',
      chips.length === 2 && chips[1].includes('取引先一郎') && chips[1].includes('B製作所'), chips.map(s => s.trim()).join(' / '));

    await page.fill('#wnHoMsg', '確認お願いします');
    await page.click('#wnHoExpires button[data-days="3"]');
    await page.click('#wnHoSend');
    await page.waitForSelector('#wnHoModal.hidden', { state: 'attached' });
    const sent = JSON.parse(lastPost('/wn/handoffs')?.body || '{}');
    check('送る内容: 社内はID・他社はメール・期限・ひとこと',
      JSON.stringify(sent.file_ids) === '[1]' && JSON.stringify(sent.recipient_ids) === '[2]'
        && JSON.stringify(sent.recipient_emails) === '["partner@example.com"]'
        && sent.expires_days === 3 && sent.message === '確認お願いします', JSON.stringify(sent));
    const toast = await page.locator('.toast').last().textContent().catch(() => '');
    check('渡した相手がトーストに出る', toast.includes('同僚花子') && toast.includes('取引先一郎'), toast);

    /* ── 受け取り箱 ── */
    await page.click('#navInbox');
    await page.waitForSelector('.wn-ho-batch');
    check('受け取り箱では一覧カードを隠す', !(await page.locator('#fileListCard').isVisible()));
    check('見出しが受け取り箱', (await page.locator('#topBarTitle').textContent()) === '受け取り箱');
    const batch1 = await page.locator('.wn-ho-batch').first().innerText();
    check('送り主と会社名とひとことが出る',
      batch1.includes('取引先一郎') && batch1.includes('B製作所') && batch1.includes('明日の打ち合わせ用です'), batch1.slice(0, 80));
    check('同じ操作で届いた2件がひとまとまり', await page.locator('.wn-ho-batch').first().locator('.wn-ho-item').count() === 2);
    check('未開封は目立たせる', await page.locator('.wn-ho-item.unopened').count() === 1);
    check('保存済みは「保存先」に変わる', batch1.includes('保存済み') && batch1.includes('保存先'));
    const revokedTxt = await page.locator('.wn-ho-batch').nth(1).innerText();
    check('取り消されたものは理由が分かり、開けない',
      revokedTxt.includes('送り主が取り消しました') && await page.locator('.wn-ho-batch').nth(1).locator('[data-act="open"]').count() === 0);
    const thumbReq = calls.find(c => c.p === '/wn/files/501/thumb');
    check('サムネは手渡し経由で取る（handoff と token 付き）',
      !!thumbReq && thumbReq.q.includes('handoff=11') && thumbReq.q.includes('token=mock-token-e2e'), thumbReq?.q);

    await page.click('.wn-ho-item.unopened [data-act="open"]');
    await page.waitForSelector('#wnHoPreview:not(.hidden) iframe');
    const viewReq = [...calls].reverse().find(c => c.p === '/wn/files/501/view');
    check('開くと view に handoff を付けて呼ぶ（開封記録）', viewReq?.q.includes('handoff=11'), viewReq?.q);
    const dl = await page.locator('#wnHoPreviewDl').getAttribute('href');
    check('ダウンロードも手渡し経由', dl.includes('/wn/files/501/download?handoff=11'), dl);
    await page.click('#wnHoPreviewClose');

    await page.click('.wn-ho-item.unopened [data-act="save"]');
    await page.waitForTimeout(300);
    check('保存は save を呼ぶ', !!lastPost('/wn/handoffs/11/save'));

    /* ── 渡したもの ── */
    await page.click('.wn-ho-tabs button[data-mode="sent"]');
    await page.waitForSelector('.wn-ho-to');
    const sentTxt = await page.locator('#wnHoList').innerText();
    check('渡したもの: 開いた人と、まだ開いていない人が分かる',
      sentTxt.includes('開きました') && sentTxt.includes('まだ開いていません') && sentTxt.includes('B製作所'), sentTxt.slice(0, 120));
    check('見出しが渡したもの', (await page.locator('#topBarTitle').textContent()) === '渡したもの'
      && await page.locator('#navSent.active').count() === 1);
    page.once('dialog', d => d.accept());
    await page.locator('.wn-ho-revoke').nth(1).click();
    await page.waitForTimeout(300);
    check('取り消すと DELETE を呼ぶ', calls.some(c => c.m === 'DELETE' && c.p === '/wn/handoffs/22'));

    /* ── 一覧に戻る ── */
    await page.click('#navMine');
    await page.waitForTimeout(400);
    check('マイファイルへ戻ると一覧が出て受け取り箱は閉じる',
      await page.locator('#fileListCard').isVisible() && !(await page.locator('#handoffPanel').isVisible())
        && (await page.locator('#topBarTitle').textContent()) === 'マイファイル');

    check('操作を通してJSエラーが出ない', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  /* ══ メールのリンク（?view=inbox）と通知から ══ */
  {
    notifications = [{ id: 5, type: 'handoff', file_id: 501, file_name: '取引先_外形図.pdf ほか1件', actor_id: 9,
      actor_name: '取引先一郎', body: '確認お願いします', read_at: null, created_at: new Date().toISOString() }];
    const { ctx, page, errors } = await newPage(browser, { width: 1280, height: 900 });
    await page.goto(`${BASE}/whatsno/app/dashboard.html?view=inbox`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__wnDashboardReady === true);
    await page.waitForSelector('.wn-ho-batch');
    check('?view=inbox で受け取り箱が開く', await page.locator('#handoffPanel').isVisible());
    check('開いたあと URL から view を外す（再読み込みで戻され続けない）', !page.url().includes('view=inbox'), page.url());

    await page.click('#navMine');
    await page.waitForTimeout(300);
    await page.click('#notifBtn');
    const notifTxt = await page.locator('.notif-item').first().innerText();
    check('通知に「ファイルが届きました」と出る', notifTxt.includes('取引先一郎') && notifTxt.includes('届きました'), notifTxt);
    await page.click('.notif-item');
    await page.waitForSelector('.wn-ho-batch');
    check('手渡しの通知を押すと受け取り箱へ', await page.locator('#handoffPanel').isVisible());
    check('JSエラーが出ない（通知・URL）', errors.length === 0, errors.join(' | '));
    notifications = [];
    await ctx.close();
  }

  /* ══ スマホ ══ */
  {
    const { ctx, page, errors } = await newPage(browser, { width: 390, height: 844 },
      { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await page.goto(`${BASE}/whatsno/app/dashboard.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__wnDashboardReady === true);
    await page.waitForTimeout(300);

    const bnTexts = await page.locator('.bottom-nav-item').allInnerTexts();
    check('下部ナビの「いいね」が「受け取り」に替わる',
      bnTexts.some(t => t.includes('受け取り')) && !bnTexts.some(t => t.includes('いいね')), bnTexts.map(t => t.replace(/\s+/g, '')).join(','));
    check('下部ナビに未開封バッジ', await page.locator('#bnInboxBadge').isVisible()
      && (await page.locator('#bnInboxBadge').textContent()) === '2');

    await page.click('#bnInbox');
    await page.waitForSelector('.wn-ho-batch');
    check('受け取りを押すと受け取り箱', await page.locator('#handoffPanel').isVisible()
      && await page.locator('#bnInbox.active').count() === 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('スマホで横スクロールが出ない', overflow <= 0, `${overflow}px`);
    await page.screenshot({ path: path.join(__dirname, 'shots', 'handoff-mobile-inbox.png') }).catch(() => {});

    await page.click('#bnHome');
    await page.waitForTimeout(300);
    check('マイを押すと一覧へ戻る', await page.locator('#fileListCard').isVisible() && !(await page.locator('#handoffPanel').isVisible()));

    await page.evaluate(() => wnOpenHandoffModal([{ id: 1, name: '自分の図面.pdf' }]));
    await page.click('#wnHoOther summary');
    const sizes = await page.evaluate(() => ['wnHoSearch', 'wnHoEmail', 'wnHoMsg']
      .map(id => parseFloat(getComputedStyle(document.getElementById(id)).fontSize)));
    check('スマホの入力欄は16px以上（自動ズーム対策）', sizes.every(s => s >= 16), sizes.join(','));
    await page.screenshot({ path: path.join(__dirname, 'shots', 'handoff-mobile-modal.png') }).catch(() => {});
    check('JSエラーが出ない（スマホ）', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  /* ══ ファイル詳細 ══ */
  for (const [canEdit, label] of [[true, '自分のファイル'], [false, '他人のファイル']]) {
    const { ctx, page, errors } = await newPage(browser, { width: 1500, height: 900 });
    // プレビューの読み込みで落ちないよう、ファイル詳細は実在する画像で開く
    const img = { ...fileRow(1, '自分の図面.png', canEdit ? 1 : 2), mime_type: 'image/png' };
    await ctx.route('**/api/wn/files/1', r => r.fulfill({ json: { data: img } }));
    await ctx.route('**/api/wn/files/1/view*', r => r.fulfill({ json: { url: `${BASE}/solid/icon-512.png` } }));
    await page.goto(`${BASE}/whatsno/app/file-detail.html?id=1`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.getElementById('topFileName')?.textContent.length > 0);
    await page.waitForTimeout(300);
    const shown = await page.evaluate(() => getComputedStyle(document.getElementById('handoffBtn')).display !== 'none');
    check(`ファイル詳細: ${label}には「人に渡す」が${canEdit ? '出る' : '出ない'}`, shown === canEdit);
    if (canEdit) {
      await page.evaluate(() => document.getElementById('handoffBtn').click());
      await page.waitForSelector('#wnHoModal:not(.hidden)');
      check('ファイル詳細から渡すモーダルが開く', (await page.locator('#wnHoFiles').textContent()).includes('自分の図面.png'));
    }
    check(`ファイル詳細でJSエラーが出ない（${label}）`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    console.log('FAILED:');
    failed.forEach(f => console.log(`  - ${f.name} ${f.detail}`));
    process.exit(1);
  }
})().catch(e => { console.error(e); server.close(); process.exit(1); });
