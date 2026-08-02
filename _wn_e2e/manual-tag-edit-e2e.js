/* マニュアル編集画面のタグ付与UI・ファイルピッカー検索と、閲覧画面のタグ表示・閲覧記録の検証
   （バックエンドなし・APIモック） */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');

const BASE = 'http://127.0.0.1:8765/whatsno';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

const MASTER = [
  { id: 1, name: '集塵機' }, { id: 2, name: '日常点検' },
  { id: 3, name: 'プレス機' }, { id: 4, name: '安全手順' },
];

const FILES = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1, file_name: i < 3 ? `集塵機図面${i + 1}.pdf` : `プレス治具${i + 1}.pdf`,
  mime_type: 'application/pdf', created_at: '2026-07-01', tags: [],
}));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });

  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com' }));
  });

  /* サーバー側のタグ状態を模す */
  let manualTags = [{ id: 1, name: '集塵機' }];
  const addTagCalls = [], removeTagCalls = [], viewCalls = [], fileSearches = [];

  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));

  await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));

  await page.route('**/api/wn/files?**', r => {
    const q = new URL(r.request().url()).searchParams.get('search') || '';
    fileSearches.push(q);
    const list = q ? FILES.filter(f => f.file_name.includes(q)) : FILES;
    r.fulfill({ json: { data: list, meta: { current_page: 1, last_page: 1, per_page: 60, total: list.length } } });
  });

  await page.route('**/api/wn/manuals/tags*', r => r.fulfill({ json: { data: MASTER } }));

  await page.route('**/api/wn/manuals/5/tags/*', r => {
    removeTagCalls.push(r.request().url());
    manualTags = manualTags.filter(t => t.id !== Number(r.request().url().split('/').pop()));
    r.fulfill({ json: { ok: true } });
  });

  await page.route('**/api/wn/manuals/5/tags', r => {
    const body = JSON.parse(r.request().postData() || '{}');
    addTagCalls.push(body);
    const tag = body.tag_id
      ? MASTER.find(t => t.id === body.tag_id)
      : { id: 99, name: body.name };          // 名前指定は新規作成される想定
    manualTags.push(tag);
    r.fulfill({ json: { data: tag } });
  });

  await page.route('**/api/wn/manuals/5/view', r => { viewCalls.push(1); r.fulfill({ json: { ok: true, view_count: 1 } }); });

  await page.route('**/api/wn/manuals/5', r => r.fulfill({
    json: { data: {
      id: 5, title: '集塵機フィルター交換手順', description: '所要15分', status: 'published',
      cover_file_id: null, created_by: 1, created_at: '2026-07-01', updated_at: '2026-07-30',
      tags: manualTags,
      steps: [{ id: 51, type: 'text', sort_order: 1, caption: null, body: '電源をOFFにする', file: null }],
    } },
  }));

  /* ───── 編集画面 ───── */
  await page.goto(`${BASE}/app/manual-edit.html?id=5`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tagChips .tag', { timeout: 8000 });

  check('編集画面に既存タグが表示される', await page.locator('#tagChips .tag').count() === 1,
    (await page.locator('#tagChips').textContent()).trim());

  /* 1) ピッカーを開く → 付与済みタグは候補から除外される */
  await page.click('#tagAddBtn');
  await page.waitForSelector('#tagPickPanel.show', { timeout: 5000 });
  const cand = await page.locator('#tagPickList .tag').allTextContents();
  check('ピッカーの候補から付与済みタグが除かれる',
    cand.length === 3 && !cand.some(c => c.trim() === '集塵機'), cand.map(c => c.trim()).join(','));

  /* 2) ピッカー内検索はクライアント側で絞る（通信しない） */
  await page.fill('#tagPickSearch', 'プレス');
  await page.waitForTimeout(200);
  const filtered = await page.locator('#tagPickList .tag').allTextContents();
  check('ピッカー検索で候補が絞り込まれる',
    filtered.length === 1 && filtered[0].trim() === 'プレス機', filtered.map(c => c.trim()).join(','));

  /* 3) 候補クリックで tag_id 指定の付与が飛ぶ */
  await page.locator('#tagPickList .tag').first().click();
  await page.waitForFunction(() => document.querySelectorAll('#tagChips .tag').length === 2, { timeout: 5000 });
  check('候補クリックでタグが付与される（tag_id指定）',
    addTagCalls.length === 1 && addTagCalls[0].tag_id === 3, JSON.stringify(addTagCalls));

  /* 4) 未登録の名前を Enter → name 指定でその場作成 */
  await page.fill('#tagPickSearch', '新規タグXYZ');
  await page.waitForTimeout(150);
  const hint = await page.textContent('#tagPickHint');
  check('未登録の語には新規作成のヒントが出る', hint.includes('新しいタグとして作成'), hint.trim());
  await page.press('#tagPickSearch', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#tagChips .tag').length === 3, { timeout: 5000 });
  check('Enterで新しいタグを作成して付与できる（name指定）',
    addTagCalls.length === 2 && addTagCalls[1].name === '新規タグXYZ', JSON.stringify(addTagCalls[1]));

  /* 5) ×でタグを外す */
  await page.click('body', { position: { x: 5, y: 5 } });   // ピッカーを閉じる
  await page.locator('#tagChips .tag-removable button').first().click();
  await page.waitForFunction(() => document.querySelectorAll('#tagChips .tag').length === 2, { timeout: 5000 });
  check('×クリックでタグを外せる', removeTagCalls.length === 1 && removeTagCalls[0].endsWith('/tags/1'),
    removeTagCalls.join(','));

  /* 6) ファイルピッカーの検索 */
  await page.click('#addFile');
  await page.waitForSelector('.e-pick-item', { timeout: 5000 });
  check('ファイルピッカーが全件（12件）で開く', await page.locator('.e-pick-item').count() === 12,
    `${await page.locator('.e-pick-item').count()}件`);

  await page.fill('#pickSearch', '集塵機');
  await page.waitForFunction(() => document.querySelectorAll('.e-pick-item').length === 3, { timeout: 5000 })
    .then(() => check('ファイルピッカーで検索して絞り込める', true))
    .catch(async () => check('ファイルピッカーで検索して絞り込める', false,
      `${await page.locator('.e-pick-item').count()}件`));
  check('検索語がAPIのsearchパラメータで送られる', fileSearches.includes('集塵機'), fileSearches.join('|'));

  await page.screenshot({ path: 'shots/manual-tag-edit.png' });

  /* ───── 閲覧画面 ───── */
  const vp = await ctx.newPage();
  vp.on('pageerror', e => console.log('PAGE ERROR(view):', e.message));
  await vp.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
  await vp.route('**/api/wn/manuals/5/view', r => { viewCalls.push(1); r.fulfill({ json: { ok: true, view_count: 1 } }); });
  await vp.route('**/api/wn/manuals/5', r => r.fulfill({
    json: { data: {
      id: 5, title: '集塵機フィルター交換手順', description: '所要15分', status: 'published',
      cover_file_id: null, created_by: 1, created_at: '2026-07-01', updated_at: '2026-07-30',
      tags: [{ id: 1, name: '集塵機' }, { id: 2, name: '日常点検' }],
      steps: [{ id: 51, type: 'text', sort_order: 1, caption: null, body: '電源をOFFにする', file: null }],
    } },
  }));

  await vp.goto(`${BASE}/app/manual-view.html?id=5`, { waitUntil: 'domcontentloaded' });
  await vp.waitForSelector('.v-tags .tag', { timeout: 8000 });
  check('閲覧画面のヒーローにタグが表示される', await vp.locator('.v-tags .tag').count() === 2);
  check('タグのリンク先が一覧のtag絞り込みになっている',
    (await vp.locator('.v-tags .tag').first().getAttribute('href')) === 'manuals.html?tag=1',
    await vp.locator('.v-tags .tag').first().getAttribute('href'));

  await vp.waitForTimeout(800);
  check('閲覧画面を開くと閲覧記録APIが呼ばれる', viewCalls.length >= 1, `${viewCalls.length}回`);

  await vp.screenshot({ path: 'shots/manual-view-tags.png' });

  await browser.close();
  const fails = results.filter(r => !r.ok);
  console.log(`\n==== 結果: ${results.length - fails.length}/${results.length} PASS ====`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
