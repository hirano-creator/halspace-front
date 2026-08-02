/* 本番(space-apps.pages.dev + Railway API)でマニュアル検索/タグ/並べ替えが動くかの確認。
   静的サーバー不要・APIモックなし（実データを読むだけで、書き込みは閲覧記録のみ）。 */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');

const FRONT = 'https://space-apps.pages.dev/whatsno';
const API   = 'https://halspace-api-production.up.railway.app/api';
const EMAIL = process.env.WN_EMAIL || 'admin@halspace.co.jp';
const PASS  = process.env.WN_PASS  || 'password';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  }).then(r => r.json());
  if (!login.token) { console.error('ログイン失敗', login); process.exit(1); }
  console.log(`ログイン: ${login.user.name} (company_id=${login.user.company_id})`);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(([t, u]) => {
    sessionStorage.setItem('space_token', t);
    sessionStorage.setItem('space_user', u);
  }, [login.token, JSON.stringify(login.user)]);

  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));

  /* 実際に飛んだAPIリクエストを記録して、期待どおりのクエリが送られているか見る */
  const reqs = [];
  page.on('request', r => { if (r.url().includes('/api/wn/manuals')) reqs.push(r.url()); });

  await page.goto(`${FRONT}/app/manuals.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelectorAll('.m-card').length > 0 || document.querySelector('.m-empty'),
    { timeout: 20000 });

  const cards = await page.locator('.m-card').count();
  check('本番の一覧が描画される（ログイン画面へ飛ばされない）',
    !page.url().includes('login'), page.url());
  check('マニュアルカードが表示される', cards > 0, `${cards}件`);
  check('件数ラベルが出る', (await page.textContent('#countLabel')).includes('件'),
    (await page.textContent('#countLabel')).trim());
  check('一覧APIにsort/per_pageが載っている',
    reqs.some(u => u.includes('sort=recent') && u.includes('per_page=24')), reqs[0] || '(なし)');
  check('タグ一覧APIが呼ばれている（404で落ちていない）',
    reqs.some(u => u.includes('/manuals/tags')), reqs.filter(u => u.includes('tags')).join(','));

  /* 検索: 実タイトルの一部で引いてヒットすること */
  const firstTitle = await page.locator('.m-name').first().textContent();
  const term = firstTitle.trim().slice(0, 3);
  await page.fill('#searchInput', term);
  await page.waitForTimeout(1500);
  const hit = await page.locator('.m-card').count();
  check(`検索「${term}」で結果が返る`, hit > 0 && hit <= cards, `${hit}/${cards}件`);

  await page.fill('#searchInput', 'zzz絶対に存在しない語zzz');
  await page.waitForTimeout(1500);
  check('該当なしで空状態が出る（エラーにならない）',
    await page.locator('.m-empty .et').count() === 1,
    (await page.locator('.m-empty .et').textContent().catch(() => '')).trim());

  await page.click('#clearAllBtn');
  await page.waitForTimeout(1500);
  check('絞り込み解除で件数が戻る', await page.locator('.m-card').count() === cards);

  /* 並べ替えが本番APIで500にならないこと */
  for (const s of ['popular', 'newest', 'oldest', 'name']) {
    const before = await page.locator('.m-card').count();
    await page.selectOption('#sortSelect', s);
    await page.waitForTimeout(1500);
    const after = await page.locator('.m-card').count();
    check(`sort=${s} が本番で成立する`, after === before, `${after}件`);
  }

  /* 閲覧画面 → 閲覧記録 → recent で先頭に来る */
  const viewed = await page.locator('.m-card').first().getAttribute('href');
  const vp = await ctx.newPage();
  vp.on('pageerror', e => console.log('PAGE ERROR(view):', e.message));
  const viewPosts = [];
  vp.on('response', r => { if (r.url().endsWith('/view')) viewPosts.push(r.status()); });
  await vp.goto(`${FRONT}/app/${viewed}`, { waitUntil: 'domcontentloaded' });
  await vp.waitForSelector('.v-h1', { timeout: 20000 });
  await vp.waitForTimeout(2500);
  check('閲覧画面が本番で開く', (await vp.locator('.v-h1').textContent()).length > 0,
    (await vp.locator('.v-h1').textContent()).trim());
  check('閲覧記録APIが200を返す', viewPosts.length > 0 && viewPosts.every(s => s === 200),
    viewPosts.join(','));

  await page.selectOption('#sortSelect', 'recent');
  await page.waitForTimeout(1500);
  const topHref = await page.locator('.m-card').first().getAttribute('href');
  check('閲覧したマニュアルが「最近見た順」の先頭に来る', topHref === viewed, `${topHref} / 期待 ${viewed}`);

  await page.screenshot({ path: 'shots/manual-search-prod.png' });

  await browser.close();
  const fails = results.filter(r => !r.ok);
  console.log(`\n==== 本番確認: ${results.length - fails.length}/${results.length} PASS ====`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
