/* 一覧画面 A案（フォルダー・ピン留め・種類チップ・日付見出し・スマホの長押し/下部ナビ）の E2E
   ※ モックではなく実API（ローカル）につないで、作成→移動→アップロード→削除まで通す。
   前提:
     1. 静的サーバー: python -m http.server 8765 --bind 127.0.0.1（my-programming ルート）
     2. API: solid-api を 8010 で起動（FILESYSTEM_DISK=local php -S 127.0.0.1:8010 -t public server.php）
        php -S は1本ずつしか処理しないので、テスト中はサムネイル・本体取得を止めている
     3. トークン: 管理者ユーザーで発行して WN_TOKEN に入れる（php artisan tinker で createToken）
   実行: WN_TOKEN='1|xxxx' node folders-pins-e2e.js */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');
const path = require('path');
const S = __dirname;
const TOKEN = process.env.WN_TOKEN || process.argv[2];
const BASE = 'http://127.0.0.1:8765/whatsno/app/dashboard.html';
const API = 'http://127.0.0.1:8010/api';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (c || x === undefined ? '' : '  → ' + JSON.stringify(x).slice(0, 300))); if (!c) fails++; };
const api = async (method, p, body) => (await fetch(API + p, { method, headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();

/* 後片付け: E2Eで作ったフォルダーへ移した既存ファイルは外へ戻してから、フォルダーとピンを消す */
async function cleanup() {
  const folders = (await api('GET', '/wn/folders?scope=company')).data.filter(f => f.name.startsWith('E2Eフォルダー_'));
  for (const f of folders) {
    const inside = (await api('GET', `/wn/files?folder=${f.id}&per_page=120`)).data || [];
    if (inside.length) await api('POST', '/wn/files/move', { file_ids: inside.map(x => x.id), folder_id: null });
    await api('DELETE', `/wn/folders/${f.id}`);
  }
  for (const pn of (await api('GET', '/wn/pins')).data) await api('DELETE', `/wn/pins/${pn.id}`);
}

(async () => {
  await cleanup();
  const me = (await api('GET', '/auth/me')).user;
  const stamp = Date.now().toString(36);
  /* channel:'chrome' だとこの環境ではマウス操作が届かないことがある（shift-range-select も同症状）ので同梱 Chromium を使う */
  const b = await chromium.launch();
  const errs = [];

  async function newPage(opts) {
    const ctx = await b.newContext({ serviceWorkers: 'block', ...opts });
    await ctx.addInitScript(([t, u]) => { sessionStorage.setItem('space_token', t); sessionStorage.setItem('space_user', u); }, [TOKEN, JSON.stringify(me)]);
    /* ローカルAPI(php -S)は1本ずつしか処理できないので、サムネイル・ファイル本体の取得は止めて操作系の応答を詰まらせない */
    await ctx.route(u => u.port === '8000' || u.port === '8010', r => {
      const url = r.request().url();
      if (/\/(thumb|thumbnail|view|download|preview-pdf|comments|notifications)(\?|$)/.test(url)) return r.fulfill({ status: 404, body: '' });
      return r.continue({ url: url.replace(':8000', ':8010') });
    });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource|39876/.test(m.text())) errs.push('console: ' + m.text()); });
    p.on('dialog', d => d.accept());
    return p;
  }
  const ready = p => p.waitForFunction(() => window.__wnDashboardReady === true, null, { timeout: 30000 });

  /* ===== PC ===== */
  const p = await newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(BASE + '?view=company', { waitUntil: 'domcontentloaded' });
  await ready(p);
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(S, 'shots', 'folders-pc1.png') });
  ok(await p.locator('#navCompany.active').count() === 1, '?view=company で社内共有が開く');
  ok(await p.locator('.wn-card').count() > 0, 'A案のカードが描画される');
  ok(await p.locator('.wn-date-head').count() > 0, '日付の見出しが入る');
  ok(await p.locator('#wnKindBar .wn-chip').count() >= 2, '種類チップが出る', await p.locator('#wnKindBar').innerHTML());
  ok(await p.locator('.wn-card .file-action-delete').count() === 0, 'カードに削除ボタンが常時出ていない');

  // 新しいフォルダー
  await p.click('#newFolderBtn');
  await p.fill('#wnNameInput', `E2Eフォルダー_${stamp}`);
  await p.click('#wnNameOk');
  await p.waitForSelector(`.wn-folder-card:has-text("E2Eフォルダー_${stamp}")`, { timeout: 10000 });
  ok(true, '新しいフォルダーを作ってカードが出る');

  // ピン留め（管理者は 自分用 / 全員 を選ぶ）
  const card = p.locator('.wn-card').first();
  const cardId = await card.getAttribute('data-file-id');
  await card.hover();
  await card.locator('[data-wn-act="pin"]').click();
  await p.click('#wnItemMenu [data-wn-act="pin-me"]');
  await p.waitForSelector(`.wn-pin[data-pin-key="f:${cardId}"]`, { timeout: 10000 });
  ok(await p.locator(`.wn-card[data-file-id="${cardId}"] .wn-card-pin.is-me`).count() === 1, 'ピン留めすると上段に出てカードに印が付く');

  // カードをフォルダーへドラッグ（ピン留めしたものとは別のカード）
  const card2 = p.locator('.wn-card').nth(1);
  const moveId = await card2.getAttribute('data-file-id');
  const folderCard = p.locator(`.wn-folder-card:has-text("E2Eフォルダー_${stamp}")`);
  await card2.dragTo(folderCard, { sourcePosition: { x: 60, y: 40 } });
  const gone = await p.waitForSelector(`.wn-card[data-file-id="${moveId}"]`, { state: 'detached', timeout: 15000 }).then(() => true, () => false);
  await p.waitForTimeout(500);
  ok(gone, 'ドラッグしたカードがフォルダーへ移って一覧から消える');
  ok(await p.locator('#navMine.active').count() === 0, '社内共有を開いたときマイファイルが選択状態で残らない');
  const fc = await folderCard.locator('.wn-folder-meta').innerText();
  ok(/^1件/.test(fc), 'フォルダーの件数が1件になる', fc);
  await p.screenshot({ path: path.join(S, 'shots', 'folders-pc2.png') });

  // フォルダーを開く → パンくず
  await folderCard.locator('.wn-folder-body').click();
  await p.waitForSelector('.wn-crumbs', { timeout: 10000 });
  ok(p.url().includes('folder='), 'URLにフォルダーが入る（戻るで戻れる）', p.url());
  ok(await p.locator(`.wn-card[data-file-id="${moveId}"]`).count() === 1, 'フォルダーの中に移したファイルがある');

  // フォルダーごとアップロード（webkitdirectory）
  await p.click('#uploadBtn');
  ok(/E2Eフォルダー_/.test(await p.locator('#uploadDestLabel').innerText()), 'アップロード画面に保存先（今のフォルダー）が出る');
  await p.setInputFiles('#inputFolder', path.join(S, 'fixtures', 'folder-upload', 'BF6-4400_図面一式'));
  const qn = await p.locator('.upload-file-item').count();
  ok(qn === 4, 'フォルダーの中身4件がキューに入る（Thumbs.db は除外）', qn);
  ok(await p.locator('.wn-upload-dir').count() === 4, 'キューにフォルダー内の位置が出る');
  await p.click('#uploadSubmitBtn');
  await p.waitForSelector('.wn-folder-card:has-text("BF6-4400_図面一式")', { timeout: 30000 });
  ok(true, 'アップロード後にフォルダー構成ができる');
  await p.locator('.wn-folder-card:has-text("BF6-4400_図面一式") .wn-folder-body').click();
  await p.waitForSelector('.wn-folder-card:has-text("部品図")', { timeout: 10000 });
  ok(await p.locator('.wn-card:has-text("説明.txt")').count() === 1, '直下のファイルとサブフォルダーが並ぶ');
  await p.locator('.wn-folder-card:has-text("部品図") .wn-folder-body').click();
  await p.waitForFunction(() => document.querySelectorAll('.wn-card').length === 2, null, { timeout: 10000 });
  ok(true, 'サブフォルダーに2件');
  const crumbs = await p.locator('#areaTitle').innerText();
  ok(/社内共有[\s\S]*E2Eフォルダー_[\s\S]*BF6-4400_図面一式[\s\S]*部品図/.test(crumbs), 'パンくずに階層が並ぶ', crumbs);
  await p.screenshot({ path: path.join(S, 'shots', 'folders-pc3.png') });

  // 戻る（ブラウザ）で1つ上へ
  await p.goBack({ waitUntil: 'commit' });
  await p.waitForSelector('.wn-folder-card:has-text("部品図")', { timeout: 10000 });
  ok(true, 'ブラウザの戻るで1つ上のフォルダーへ戻る');

  // パンくずでいちばん上へ → 種類チップ
  await p.click('.wn-crumb[data-folder-id=""]');
  await p.waitForSelector('.wn-pins', { timeout: 10000 });
  const chips = p.locator('#wnKindBar .wn-chip');
  const second = chips.nth(1);
  const kind = await second.getAttribute('data-wn-kind');
  await second.click();
  const on = await p.waitForSelector(`#wnKindBar .wn-chip.is-on[data-wn-kind="${kind}"]`, { timeout: 15000 }).then(() => true, () => false);
  const exts = await p.$$eval('.wn-card .wn-card-ext', els => els.map(e => e.textContent.trim()));
  ok(on && exts.length > 0 && (kind !== 'pdf' || exts.every(x => x === 'PDF')), `種類チップ（${kind}）で絞り込める`, exts);
  ok(await p.locator('.wn-pins').count() === 0, '種類で絞っているときはピン・フォルダーを出さない');
  await chips.first().click();
  await p.waitForTimeout(800);

  // 選択 → フォルダーへ移動ボタン
  await p.click('#selectModeBtn');
  await p.locator('.wn-card').first().click();
  ok(await p.locator('#moveSelBtn:not([disabled])').count() === 1, '選択すると「フォルダーへ移動」が押せる');
  await p.click('#moveSelBtn');
  await p.waitForSelector('#wnMoveModal:not(.hidden) .wn-move-row', { timeout: 10000 });
  ok(await p.locator(`#wnMoveModal .wn-move-row:has-text("E2Eフォルダー_${stamp}")`).count() === 1, '移動先の一覧にフォルダーが出る');
  await p.screenshot({ path: path.join(S, 'shots', 'folders-pc4.png') });
  await p.click('#wnMoveModal [data-wn-close]');
  await p.click('#mergeCancelBtn');

  // フォルダーの ⋯ メニュー（削除はあとでAPIで）
  await p.locator(`.wn-folder-card:has-text("E2Eフォルダー_${stamp}")`).hover();
  await p.locator(`.wn-folder-card:has-text("E2Eフォルダー_${stamp}") .wn-card-hover [data-wn-act="menu"]`).click();
  const mtxt = await p.locator('#wnItemMenu').innerText();
  ok(/名前を変更/.test(mtxt) && /フォルダーを削除/.test(mtxt) && /全員にピン留め/.test(mtxt), 'フォルダーのメニュー', mtxt);
  await p.keyboard.press('Escape');

  /* ===== スマホ ===== */
  const m = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await m.goto(BASE + '?view=company', { waitUntil: 'domcontentloaded' });
  await ready(m);
  await m.waitForTimeout(800);
  await m.screenshot({ path: path.join(S, 'shots', 'folders-mb1.png') });
  const nav = await m.evaluate(() => { const r = document.querySelector('.bottom-nav-inner').getBoundingClientRect(); const f = document.querySelector('#bnUpload').getBoundingClientRect(); return { navBottom: innerHeight - r.bottom, fabRight: innerWidth - f.right, fabW: f.width }; });
  ok(nav.navBottom >= 8 && nav.fabW >= 56, '下部ナビが浮いたカプセル＋丸い＋ボタン', nav);
  const row = await m.evaluate(() => { const c = document.querySelector('.wn-folder-card'); return c ? getComputedStyle(c).display : null; });
  ok(row === 'flex', 'スマホではフォルダーが1行ずつのリスト', row);
  const hoverShown = await m.evaluate(() => getComputedStyle(document.querySelector('.wn-card .wn-card-hover')).display);
  ok(hoverShown === 'none', 'スマホではホバー操作を出さない', hoverShown);

  // 長押し → シート
  await m.evaluate(async () => {
    const el = document.querySelector('.wn-card .file-card-thumb');
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, pointerType: 'touch', clientX: r.left + 30, clientY: r.top + 30, isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    await new Promise(res => setTimeout(res, 650));
    el.dispatchEvent(new PointerEvent('pointerup', o));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: o.clientX, clientY: o.clientY }));
  });
  await m.waitForTimeout(400);
  ok(await m.locator('#wnItemMenu.is-open.as-sheet').count() === 1, '長押しでメニューが下から出る');
  ok(m.url().includes('dashboard'), '長押し後に指を離してもファイルが開かない', m.url());
  await m.screenshot({ path: path.join(S, 'shots', 'folders-mb2.png') });
  await m.click('#wnMenuBackdrop', { position: { x: 20, y: 40 } });

  // スクロールで下部ナビが縮む
  await m.evaluate(async () => { for (let y = 0; y <= 900; y += 150) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } });
  await m.waitForTimeout(500);
  ok(await m.evaluate(() => document.body.classList.contains('bn-min')), '下へスクロールすると下部ナビが縮む');
  await m.screenshot({ path: path.join(S, 'shots', 'folders-mb3.png') });
  await m.evaluate(async () => { window.scrollTo(0, 500); await new Promise(r => setTimeout(r, 80)); window.scrollTo(0, 200); });
  await m.waitForTimeout(400);
  ok(!(await m.evaluate(() => document.body.classList.contains('bn-min'))), '上へスクロールすると元に戻る');

  // ＋ → アップロード画面（スマホではフォルダー選択を出さない）
  await m.click('#bnUpload');
  await m.waitForTimeout(300);
  ok(await m.locator('#pickFolderBtn').isHidden(), 'スマホでは「フォルダーを選ぶ」を出さない');
  ok(await m.locator('#makeFolderBtn').isVisible(), 'スマホでも「フォルダーを作る」は出る');
  await m.screenshot({ path: path.join(S, 'shots', 'folders-mb4.png') });

  await cleanup();

  console.log('errors:', errs.length ? errs : 'なし');
  console.log(fails ? `\n${fails} 件失敗` : '\nすべて成功');
  await b.close();
  process.exit(fails || errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
