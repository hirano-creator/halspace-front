/* マニュアル編集画面の「既存ファイル」→「What'sNoから選ぶ」＋マイファイル/社内共有スコープ切替の検証
   （バックエンドなし・APIモック） */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');

const BASE = 'http://127.0.0.1:8765/whatsno';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

const MINE_FILES    = [{ id: 1, file_name: 'マイ資料A.pdf', mime_type: 'application/pdf', created_at: '2026-08-01' }];
const COMPANY_FILES = [
  { id: 2, file_name: '共有資料B.pdf', mime_type: 'application/pdf', created_at: '2026-08-01' },
  { id: 3, file_name: '共有資料C.pdf', mime_type: 'application/pdf', created_at: '2026-08-01' },
];

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });

  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com', wn_extended_options_enabled: true }));
  });

  const scopeCalls = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));

  await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));

  await page.route('**/api/wn/files?**', r => {
    const url = new URL(r.request().url());
    const scope = url.searchParams.get('scope') || '(none)';
    scopeCalls.push(scope);
    const list = scope === 'company' ? COMPANY_FILES : MINE_FILES;
    r.fulfill({ json: { data: list, meta: { current_page: 1, last_page: 1, per_page: 60, total: list.length } } });
  });

  await page.route('**/api/wn/manuals/5', r => r.fulfill({
    json: { data: {
      id: 5, title: 'テストマニュアル', description: '', status: 'draft',
      cover_file_id: null, created_by: 1, created_at: '2026-08-01', updated_at: '2026-08-01',
      tags: [], steps: [],
    } },
  }));

  await page.goto(`${BASE}/app/manual-edit.html?id=5`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#addFile', { timeout: 8000 });

  check('ボタン文言が「What\'sNoから選ぶ」になっている',
    (await page.textContent('#addFile')).trim() === "What'sNoから選ぶ",
    (await page.textContent('#addFile')).trim());

  await page.click('#addFile');
  await page.waitForSelector('.e-pick-item', { timeout: 5000 });

  check('モーダルタイトルが「What\'sNoから選ぶ」になっている',
    (await page.textContent('.e-modal-head h3')).trim() === "What'sNoから選ぶ");

  check('デフォルトでマイファイルが選択されている',
    await page.locator('#pickScope button[data-scope="mine"]').evaluate(el => el.classList.contains('active')));

  check('初期表示はscope=mineで問い合わせている', scopeCalls[scopeCalls.length - 1] === 'mine', scopeCalls.join(','));

  check('マイファイルの1件が表示される', await page.locator('.e-pick-item').count() === 1,
    `${await page.locator('.e-pick-item').count()}件`);

  /* 社内共有タブへ切替 */
  await page.click('#pickScope button[data-scope="company"]');
  await page.waitForFunction(() => document.querySelectorAll('.e-pick-item').length === 2, { timeout: 5000 })
    .then(() => check('社内共有タブに切替えると2件表示される', true))
    .catch(async () => check('社内共有タブに切替えると2件表示される', false,
      `${await page.locator('.e-pick-item').count()}件`));

  check('社内共有タブがactiveになる',
    await page.locator('#pickScope button[data-scope="company"]').evaluate(el => el.classList.contains('active')));
  check('社内共有タブでscope=companyが送られる', scopeCalls[scopeCalls.length - 1] === 'company', scopeCalls.join(','));

  /* 検索語を入れるとスコープが外れる（ダッシュボードと同じ挙動） */
  await page.fill('#pickSearch', '資料');
  await page.waitForTimeout(500);
  check('検索語を入れるとscopeパラメータが外れる', scopeCalls[scopeCalls.length - 1] === '(none)', scopeCalls.join(','));

  /* モーダルを開き直すとマイファイルにリセットされる */
  await page.click('.e-modal-head .close');
  await page.click('#addFile');
  await page.waitForSelector('.e-pick-item', { timeout: 5000 });
  check('モーダルを開き直すとマイファイルにリセットされる',
    await page.locator('#pickScope button[data-scope="mine"]').evaluate(el => el.classList.contains('active')));

  await page.screenshot({ path: 'shots/manual-picker-scope.png' });

  await browser.close();
  const fails = results.filter(r => !r.ok);
  console.log(`\n==== 結果: ${results.length - fails.length}/${results.length} PASS ====`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
