/* マニュアル一覧に追加した 検索 / タグAND / 並べ替え / 無限スクロール / URL同期 の検証
   （バックエンドなし・APIモック） */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');

const BASE = 'http://127.0.0.1:8765/whatsno';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

/* 疑似データ: 30件。うち5件に tag1、3件に tag1+tag2 を付ける */
const ALL = Array.from({ length: 30 }, (_, i) => {
  const n = i + 1;
  const tags = [];
  if (n <= 5) tags.push({ id: 1, name: '集塵機' });
  if (n <= 3) tags.push({ id: 2, name: '日常点検' });
  return {
    id: n,
    title: n <= 5 ? `集塵機フィルター交換手順${n}` : `プレス機の段取り${n}`,
    description: null,
    status: n % 2 ? 'published' : 'draft',
    step_count: 3,
    cover: null,
    tags,
    viewed_at: n === 12 ? '2026-08-02T10:00:00Z' : null,
    view_count: n === 12 ? 7 : 0,
    updated_at: `2026-07-${String(31 - i).padStart(2, '0')}T00:00:00Z`,
  };
});

const apiCalls = [];   /* 実際に飛んだ一覧リクエストのクエリを記録する */

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });

  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com', wn_extended_options_enabled: true }));
  });

  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));

  await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));

  await page.route('**/api/wn/manuals/tags*', r => r.fulfill({
    json: { data: [{ id: 1, name: '集塵機', manuals_count: 5 }, { id: 2, name: '日常点検', manuals_count: 3 }] },
  }));

  /* サーバー側の絞り込み・並べ替え・ページングを模す */
  await page.route('**/api/wn/manuals?**', r => {
    const u = new URL(r.request().url());
    const p = u.searchParams;
    apiCalls.push(u.search);

    let list = ALL.slice();
    const q = p.get('search');
    if (q) list = list.filter(m => m.title.includes(q));
    const tag = p.get('tag');
    if (tag) {
      const ids = tag.split(',').map(Number);
      list = list.filter(m => ids.every(id => m.tags.some(t => t.id === id)));   // AND
    }
    if (p.get('status')) list = list.filter(m => m.status === p.get('status'));

    const sort = p.get('sort') || 'recent';
    if (sort === 'name')   list.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'oldest') list.sort((a, b) => a.updated_at.localeCompare(b.updated_at));
    if (sort === 'recent') list.sort((a, b) => (b.viewed_at || '').localeCompare(a.viewed_at || ''));

    const per  = Number(p.get('per_page') || 24);
    const pg   = Number(p.get('page') || 1);
    const page_ = list.slice((pg - 1) * per, pg * per);
    r.fulfill({
      json: {
        data: page_,
        meta: { current_page: pg, last_page: Math.max(1, Math.ceil(list.length / per)), per_page: per, total: list.length },
      },
    });
  });

  const cardCount = () => page.locator('.m-card').count();
  const titles    = () => page.locator('.m-name').allTextContents();

  await page.goto(`${BASE}/app/manuals.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.m-card', { timeout: 8000 });

  /* 1) 初期表示: 1ページ目24件・件数ラベル・タグバー */
  check('初期表示で1ページ目24件が並ぶ', await cardCount() === 24, `${await cardCount()}件`);
  check('件数ラベルに総件数が出る', (await page.textContent('#countLabel')).trim() === '30件',
    (await page.textContent('#countLabel')).trim());
  check('タグバーに使用中タグが出る', await page.locator('#tagList .tag').count() === 2);
  check('既定の並び順は「最近見た順」', await page.inputValue('#sortSelect') === 'recent');

  /* 2) 無限スクロール: 末尾まで送ると残り6件が追記される */
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => document.querySelectorAll('.m-card').length === 30, { timeout: 8000 })
    .then(() => check('末尾までスクロールで2ページ目が追記され30件になる', true))
    .catch(async () => check('末尾までスクロールで2ページ目が追記され30件になる', false, `${await cardCount()}件`));
  const uniq = new Set(await titles());
  check('ページ横断で重複が出ない', uniq.size === 30, `ユニーク${uniq.size}件`);

  /* 3) 検索デバウンス: 1文字ずつ打っても400ms後に1回だけ飛ぶ */
  await page.evaluate(() => window.scrollTo(0, 0));
  const before = apiCalls.length;
  await page.click('#searchInput');
  await page.keyboard.type('集塵機', { delay: 60 });
  await page.waitForTimeout(900);
  const fired = apiCalls.length - before;
  check('検索は400msデバウンスされ1回だけリクエストする', fired === 1, `${fired}回`);
  check('検索結果が5件に絞られる', await cardCount() === 5, `${await cardCount()}件`);
  check('検索語がURLの q= に反映される', new URL(page.url()).searchParams.get('q') === '集塵機', page.url());

  /* 4) 検索クリア */
  await page.click('#searchClear');
  await page.waitForFunction(() => document.querySelectorAll('.m-card').length === 24, { timeout: 5000 });
  check('検索クリアで全件表示に戻る', await cardCount() === 24);
  check('クリア後はURLからq=が消える', new URL(page.url()).searchParams.get('q') === null, page.url());

  /* 5) タグAND: 集塵機(5件) → +日常点検(3件) */
  await page.locator('#tagList .tag', { hasText: '集塵機' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.m-card').length === 5, { timeout: 5000 });
  check('タグ1つで5件に絞られる', await cardCount() === 5);
  check('タグ1つではANDバッジが出ない', !(await page.locator('#tagAndBadge').isVisible()));

  await page.locator('#tagList .tag', { hasText: '日常点検' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.m-card').length === 3, { timeout: 5000 });
  check('タグ2つのAND検索で3件に絞られる', await cardCount() === 3, `${await cardCount()}件`);
  check('タグ2つでANDバッジが表示される', await page.locator('#tagAndBadge').isVisible());
  check('タグがURLの tag= に反映される', new URL(page.url()).searchParams.get('tag') === '1,2', page.url());
  check('カードにタグチップが表示される', await page.locator('.m-card .m-card-tags .tag').count() > 0);

  /* 6) URL復元: リロードして絞り込み状態が戻る */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.m-card', { timeout: 8000 });
  check('リロードしても絞り込み状態が復元される（3件）', await cardCount() === 3, `${await cardCount()}件`);
  check('復元時にタグチップがactiveになる', await page.locator('#tagList .tag.active').count() === 2);

  /* 7) 全解除 */
  await page.click('#tagClearBtn');
  await page.waitForFunction(() => document.querySelectorAll('.m-card').length === 24, { timeout: 5000 });
  check('全解除で絞り込みが外れる', await cardCount() === 24);

  /* 8) 並べ替え */
  await page.selectOption('#sortSelect', 'name');
  await page.waitForTimeout(600);
  const t = await titles();
  check('タイトル順に並べ替えできる', t[0].localeCompare(t[1]) <= 0, `${t[0]} / ${t[1]}`);
  check('sortがURLに反映される', new URL(page.url()).searchParams.get('sort') === 'name');

  /* 9) 状態チップ */
  await page.locator('#statusChips .m-chip', { hasText: '下書き' }).click();
  await page.waitForTimeout(600);
  check('下書きチップで絞り込める', await cardCount() === 15, `${await cardCount()}件`);
  check('statusがURLに反映される', new URL(page.url()).searchParams.get('status') === 'draft');

  /* 10) 0件の空状態 */
  await page.fill('#searchInput', 'ぜったいに存在しない語');
  await page.waitForTimeout(700);
  check('該当なしの空状態が出る', (await page.textContent('.m-empty .et')).includes('条件に合うマニュアルがありません'));
  await page.click('#clearAllBtn');
  await page.waitForFunction(() => document.querySelectorAll('.m-card').length === 24, { timeout: 5000 });
  check('「絞り込みを解除」で全件に戻る', await cardCount() === 24);

  await page.screenshot({ path: 'shots/manual-search-pc.png', fullPage: false });

  /* 11) スマホ幅でも崩れない */
  const sp = await ctx.newPage();
  await sp.setViewportSize({ width: 390, height: 844 });
  await sp.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
  await sp.route('**/api/wn/manuals/tags*', r => r.fulfill({
    json: { data: [{ id: 1, name: '集塵機', manuals_count: 5 }, { id: 2, name: '日常点検', manuals_count: 3 }] } }));
  await sp.route('**/api/wn/manuals?**', r => r.fulfill({
    json: { data: ALL.slice(0, 8), meta: { current_page: 1, last_page: 1, per_page: 24, total: 8 } } }));
  await sp.goto(`${BASE}/app/manuals.html`, { waitUntil: 'domcontentloaded' });
  await sp.waitForSelector('.m-card', { timeout: 8000 });
  const noHScroll = await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check('スマホ幅で横スクロールが発生しない', noHScroll,
    await sp.evaluate(() => `${document.documentElement.scrollWidth} / ${window.innerWidth}`));
  await sp.screenshot({ path: 'shots/manual-search-sp.png', fullPage: false });

  await browser.close();
  const fails = results.filter(r => !r.ok);
  console.log(`\n==== 結果: ${results.length - fails.length}/${results.length} PASS ====`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
