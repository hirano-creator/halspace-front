/* スマホ幅での連絡先モーダル：登録フォームの折りたたみ検証（バックエンドなし・APIモック）

   狙い: フォームが常時開いていると、26件の一覧に届くまで1画面ぶんスクロールが要る。
   狭い画面ではフォームを畳み、ボタンで開く。PC(2カラム)は従来どおり常に開いている。

   実行: 静的サーバー :8765 を立てて node _wn_e2e/contact-mobile-form-e2e.js */
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

const visible = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0;
}, sel);

async function stubApi(page) {
  await page.evaluate(() => {
    const tags = [
      { id: 1, group_id: 10, name: 'レーザー', kana: 'レーザー',     count: 2 },
      { id: 2, group_id: 10, name: '機械加工', kana: 'キカイカコウ', count: 1 },
    ];
    const contacts = [
      { id: 100, name: '阿部', name_kana: 'アベ', company_name: '株式会社かねよし',
        email: 'knys@kaneyoshidesu.co.jp', phone: '', fax: '', tag_ids: [1], has_card: false },
      { id: 101, name: '伊藤 昇', name_kana: 'イトウノボル', company_name: '伊藤製作所',
        email: 'ito@ito-ss.co.jp', phone: '', fax: '', tag_ids: [2], has_card: false },
    ];
    window.wnGetContactTags = async () => ({ groups: [{ id: 10, name: '加工先', sort_order: 1 }], tags, can_edit: true });
    window.wnGetContacts     = async () => contacts.map(c => ({ ...c }));
    window.wnUpdateContact   = async (id, f) => ({ ...contacts[0], ...f });
    window.wnSaveContact     = async f => ({ id: 999, ...f });
    window.wnShowToast       = () => {};
  });
}

async function newPage(browser, width, height) {
  const ctx = await browser.newContext({
    serviceWorkers: 'block', viewport: { width, height },
    hasTouch: width < 880, isMobile: width < 880,
  });
  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com' }));
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await page.goto(`${BASE}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__wnDashboardReady === true, null, { timeout: 30000 });
  await stubApi(page);
  await page.evaluate(() => openContactsModal());
  await page.waitForSelector('#contactsModal:not(.hidden)', { timeout: 5000 });
  await page.waitForFunction(() => Array.isArray(allContactsCache) && allContactsCache.length > 0, null, { timeout: 10000 });
  await page.waitForTimeout(250);
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  /* ── スマホ幅（iPhone相当） ── */
  const { ctx: mCtx, page } = await newPage(browser, 390, 844);

  check('開閉ボタンが出る', await visible(page, '#ctFormToggle'));
  check('最初はフォームが畳まれている', !(await visible(page, '.ct-left')));
  check('畳んだ状態のラベルは「新しく登録する」',
    (await page.innerText('#ctFormToggleLabel')).includes('新しく登録する'));

  /* 畳んでいる間、1件目の連絡先までスクロールなしで見えること（これが今回の目的）。
     フォームが開いたままだと1画面ぶん下に押し出されるので、これがそのまま回帰テストになる */
  const firstRowTop = await page.evaluate(() =>
    Math.round(document.querySelector('#contactsList .ct-r').getBoundingClientRect().top));
  check('1件目の連絡先がスクロールなしで見える', firstRowTop > 0 && firstRowTop < 844,
    `画面上端から ${firstRowTop}px（画面の高さ 844px）`);

  /* ボタンで開く */
  await clk(page, '#ctFormToggle');
  await page.waitForTimeout(200);
  check('ボタンでフォームが開く', await visible(page, '.ct-left'));
  check('開いた状態のラベルは「閉じる」',
    (await page.innerText('#ctFormToggleLabel')).includes('閉じる'));
  check('開くと名前欄が使える', await visible(page, '#contactNameInput'));

  /* もう一度押すと閉じる */
  await clk(page, '#ctFormToggle');
  await page.waitForTimeout(200);
  check('もう一度押すと畳まれる', !(await visible(page, '.ct-left')));

  /* 一覧の鉛筆ボタン（編集）は畳んでいても開くこと */
  await page.evaluate(() => editContact(allContactsCache[0]));
  await page.waitForTimeout(250);
  check('編集を押すとフォームが開く', await visible(page, '.ct-left'));
  check('編集中は「更新する」に変わる',
    (await page.innerText('#contactAddBtnLabel')).includes('更新する'));
  check('編集内容が入っている',
    (await page.inputValue('#contactNameInput')) === '阿部',
    await page.inputValue('#contactNameInput'));

  /* 「やめる」で畳みに戻る */
  await clk(page, '#contactCancelEditBtn');
  await page.waitForTimeout(200);
  check('やめるで畳みに戻る', !(await visible(page, '.ct-left')));

  /* 登録が終わったら畳みに戻る */
  await clk(page, '#ctFormToggle');
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    document.getElementById('contactNameInput').value  = '新規 太郎';
    document.getElementById('contactEmailInput').value = 'shinki@example.com';
  });
  await clk(page, '#contactAddBtn');
  await page.waitForTimeout(500);
  check('登録が終わると畳みに戻る', !(await visible(page, '.ct-left')));

  await mCtx.close();

  /* ── PC幅：従来どおり2カラムで常に開いている ── */
  const { ctx: dCtx, page: dp } = await newPage(browser, 1280, 900);
  check('PCでは開閉ボタンを出さない', !(await visible(dp, '#ctFormToggle')));
  check('PCではフォームが常に見えている', await visible(dp, '.ct-left'));
  check('PCでは2カラムのまま',
    (await dp.evaluate(() => getComputedStyle(document.querySelector('#contactsModal .ct-body')).flexDirection)) === 'row');

  /* PCで登録し終えてもフォームは消えない（畳みクラスが付いても効かないこと） */
  await dp.evaluate(() => _contactCancelEdit());
  await dp.waitForTimeout(200);
  check('PCは登録後もフォームが見えたまま', await visible(dp, '.ct-left'));

  await dCtx.close();
  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n合計 ${results.length}件 / PASS ${results.length - failed.length} / FAIL ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})();
