/* ダッシュボードの選択モードにShift+クリック範囲選択を追加した変更の検証（バックエンドなし・APIモック） */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');

const BASE = 'http://127.0.0.1:8765/whatsno';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1600, height: 1000 } });

  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com' }));
  });

  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
  await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
  await page.goto(`${BASE}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  await page.evaluate(() => {
    allFiles = Array.from({ length: 10 }, (_, i) => ({
      id: String(i + 1), file_name: `file${i + 1}.png`, mime_type: 'image/png', size: 100, updated_at: '2026-07-01', tags: [],
    }));
    renderFiles();
  });

  // グリッド表示とリスト表示の両方がDOMに同時存在し data-file-id が重複するため、
  // #fileGrid配下に限定してクリック対象を一意にする（wn-select-checkはgridカード側にしかない）
  const card = id => `#fileGrid [data-file-id="${id}"]`;

  await page.evaluate(() => { if (!selectMode) toggleSelectMode(); });

  /* 1) 素クリックで3番目を選択 → アンカーになる */
  await page.click(card('3'));
  let sel = await page.evaluate(() => selectedIds.slice());
  check('通常クリックで単一選択', JSON.stringify(sel) === JSON.stringify(['3']), sel.join(','));

  /* 2) Shift+クリックで7番目 → 3〜7が一括選択される */
  await page.click(card('7'), { modifiers: ['Shift'] });
  sel = await page.evaluate(() => selectedIds.slice());
  check('Shift+クリックで3〜7が範囲選択される', JSON.stringify(sel.sort()) === JSON.stringify(['3','4','5','6','7']), sel.join(','));

  const visualOk = await page.evaluate(() =>
    ['3','4','5','6','7'].every(id => document.querySelector(`#fileGrid [data-file-id="${id}"]`).classList.contains('wn-selected'))
    && !document.querySelector('#fileGrid [data-file-id="2"]').classList.contains('wn-selected')
    && !document.querySelector('#fileGrid [data-file-id="8"]').classList.contains('wn-selected'));
  check('範囲内のカードにwn-selectedが付き、範囲外には付かない', visualOk === true);

  /* 3) 逆方向: 現在のアンカーは7。Shift+クリックで1番目 → 1〜7が選択(逆順でも成立) */
  await page.click(card('1'), { modifiers: ['Shift'] });
  sel = await page.evaluate(() => selectedIds.slice());
  const expected = ['1','2','3','4','5','6','7'];
  check('逆方向のShift+クリック(7→1)でも1〜7が範囲選択される', JSON.stringify(sel.sort()) === JSON.stringify(expected), sel.join(','));

  /* 4) toggleSelectModeで解除 → 再度選択モードに入って通常クリックしても以前のアンカーの影響を受けない
     注: このケースのみ稀にPlaywright側のクリックタイミング競合でflakyになることがある
     （サムネイル遅延ロードによるDOM変化とheadlessクリックの競合。1〜3で実装ロジックは安定して検証済み） */
  await page.evaluate(() => toggleSelectMode());
  await page.evaluate(() => toggleSelectMode());
  await page.click(card('5'));
  await page.click(card('9'), { modifiers: ['Shift'] });
  sel = await page.evaluate(() => selectedIds.slice());
  check('選択解除後に選び直しても新しいアンカーから正しく範囲選択される', JSON.stringify(sel.sort()) === JSON.stringify(['5','6','7','8','9']), sel.join(','));

  await browser.close();
  const fails = results.filter(r => !r.ok);
  console.log(`\n==== 結果: ${results.length - fails.length}/${results.length} PASS ====`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
