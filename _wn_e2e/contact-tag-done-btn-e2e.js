/* 連絡先タグ パネル内「更新する／選択を終える」ボタンの検証（バックエンドなし・APIモック）

   背景: .ct-pop-panel は position:absolute でフォームの「登録する／更新する」を覆い隠すため、
   タグを選んでも保存ボタンに手が届かなかった。パネル内から確定できることを確認する。

   実行: 静的サーバー :8765 を立てて node _wn_e2e/contact-tag-done-btn-e2e.js */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');

const BASE = 'http://127.0.0.1:8765/whatsno';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

/* この環境では Playwright の実マウス入力がページに届かないため el.click() で操作する */
const clk = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) throw new Error('要素がない: ' + s);
  el.click();
}, sel);

/* 連絡先・タグAPIをページ側で差し替える。updated には update 呼び出しを記録する */
async function stubApi(page, canEdit) {
  await page.evaluate(canEdit => {
    window.__updated = [];
    const tags = [
      { id: 1, group_id: 10, name: 'レーザー', kana: 'レーザー', count: 1 },
      { id: 2, group_id: 10, name: '曲げ加工', kana: 'マゲカコウ', count: 0 },
    ];
    const contacts = [
      { id: 100, name: '山田 太郎', name_kana: 'ヤマダタロウ', company_name: 'A社',
        email: 'yamada@example.com', phone: '', fax: '', tag_ids: [1], has_card: false },
    ];
    window.wnGetContactTags = async () => ({ groups: [{ id: 10, name: '加工', sort_order: 1 }], tags, can_edit: canEdit });
    window.wnGetContacts     = async () => contacts.map(c => ({ ...c }));
    window.wnUpdateContact   = async (id, fields) => { window.__updated.push({ id, fields }); return { ...contacts[0], ...fields }; };
    window.wnSaveContact     = async fields => { window.__updated.push({ id: null, fields }); return { id: 999, ...fields }; };
    window.wnShowToast       = () => {};
  }, canEdit);
}

async function openModal(page) {
  await page.evaluate(() => openContactsModal());
  await page.waitForSelector('#contactsModal:not(.hidden)', { timeout: 5000 });
  await page.waitForFunction(() => Array.isArray(allContactsCache) && allContactsCache.length > 0, null, { timeout: 10000 });
  await page.waitForTimeout(200);
}

async function newPage(browser, canEdit) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com', wn_extended_options_enabled: true }));
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await page.goto(`${BASE}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__wnDashboardReady === true, null, { timeout: 30000 });
  await stubApi(page, canEdit);
  await openModal(page);
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  /* ── 管理者：新規登録モード ── */
  const { ctx: aCtx, page } = await newPage(browser, true);

  await clk(page, '#contactTagPickBtn');
  await page.waitForSelector('#ctDoneBtn', { timeout: 5000 });

  check('パネルに確定ボタンが出る', await page.isVisible('#ctDoneBtn'));
  check('新規登録中は「選択を終える」と出る',
    (await page.innerText('#ctDoneBtn')).includes('選択を終える'),
    (await page.innerText('#ctDoneBtn')).trim());

  /* 問題の再現: パネルが開いている間、フォームの登録ボタンは覆われている */
  const covered = await page.evaluate(() => {
    const btn = document.getElementById('contactAddBtn').getBoundingClientRect();
    const pan = document.querySelector('.ct-pop-panel').getBoundingClientRect();
    return pan.bottom > btn.top && pan.top < btn.bottom;   // 縦方向に重なっている
  });
  check('パネルがフォームの保存ボタンを覆う（ボタン追加の根拠）', covered);

  /* 新規登録中は閉じるだけで保存しない（名前・メール未入力のため） */
  await clk(page, '#ctDoneBtn');
  await page.waitForTimeout(150);
  check('確定でパネルが閉じる', (await page.locator('.ct-pop-panel').count()) === 0);
  check('新規登録中は保存を走らせない', (await page.evaluate(() => window.__updated.length)) === 0);
  check('閉じるとフォームの登録ボタンが見える', await page.isVisible('#contactAddBtn'));

  /* ── 既存連絡先の編集モード ── */
  await page.evaluate(() => editContact(allContactsCache[0]));
  await page.waitForTimeout(150);
  await clk(page, '#contactTagPickBtn');
  await page.waitForSelector('#ctDoneBtn', { timeout: 5000 });

  check('編集中は「更新する」と出る',
    (await page.innerText('#ctDoneBtn')).includes('更新する'),
    (await page.innerText('#ctDoneBtn')).trim());

  /* 編集モードのままでもタグを選べて、確定で更新まで走る */
  await clk(page, '#ctManageBtn');                       // 「タグを編集」に入る
  await page.waitForTimeout(120);
  check('編集モード中はタグを選択できない（既知の挙動）',
    (await page.locator('#contactTagPanel [data-pick]').count()) === 0);

  await clk(page, '#ctDoneBtn');
  await page.waitForTimeout(300);
  check('確定すると編集モードから抜ける', (await page.evaluate(() => ctPop.manage)) === false);

  const updated = await page.evaluate(() => window.__updated);
  check('編集中の確定で更新APIが呼ばれる', updated.length === 1 && updated[0].id === 100,
    JSON.stringify(updated.map(u => u.id)));
  check('選択済みタグが送られる',
    updated.length === 1 && Array.isArray(updated[0].fields.tag_ids) && updated[0].fields.tag_ids.includes(1),
    JSON.stringify(updated[0]?.fields?.tag_ids));

  /* ── 一般ユーザー：管理導線が無くても確定ボタンは出る ── */
  const { ctx: gCtx, page: gp } = await newPage(browser, false);
  await clk(gp, '#contactTagPickBtn');
  await gp.waitForSelector('#contactTagPanel .ct-opt', { timeout: 5000 });
  check('一般でも確定ボタンが出る', await gp.isVisible('#ctDoneBtn'));
  check('一般には「タグを編集」は出ない', !(await gp.isVisible('#ctManageBtn')));

  await aCtx.close();
  await gCtx.close();
  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n合計 ${results.length}件 / PASS ${results.length - failed.length} / FAIL ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})();
