/* サイドバー2ビュー化（マイファイル / 社内共有）と、検索の全体横断の検証

   確認すること:
   - 既定が「マイファイル」で、社内共有が全社共有モードでも出ていること
   - ビュー切替で scope=mine / scope=company が送られること
   - 検索中は scope が外れ、見出しが「◯◯」の検索結果 になること
   - ビューを切り替えると検索が解除されること
   - タグ共有リンク(?tags=)で開くと scope なし（全体）になること
   - JSエラーが出ないこと（navAll 削除の取りこぼし検出）

   実行: node _wn_e2e/nav-two-views-e2e.js
   （バックエンド不要。APIはこのスクリプトが route で全部スタブする） */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;

const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
               '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml',
               '.png':'image/png', '.json':'application/json' };

/* デスクトップ連携のローカル同期サーバー(:39876)への問い合わせは
   try/catch で握られている想定の失敗。ブラウザがコンソールへ出すCORS警告まで
   拾ってしまうと、無関係なノイズでテストが落ちるので除外する。 */
const IGNORE_ERR = /39876|localhost:39876|ERR_FAILED/;
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

/* /wn/files に飛んできたクエリを順に記録する */
const calls = [];

function fileRow(id, name, visibility, owner) {
  return {
    id, file_name: name, file_size: 1234, mime_type: 'application/pdf',
    version: 1, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
    uploader: { id: owner, name: 'テスト太郎' }, tags: [],
    like_count: 0, liked: false, view_count: 0, comment_count: 0,
    approval_status: 'none', visibility, owner_user_id: owner, shared_at: null,
    can_edit: owner === 1,
  };
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });

  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({
      id: 1, name: 'テスト太郎', email: 't@example.com', role: 'general',
      company: 'テスト社', company_id: 1, apps: ['whatsno'],
      wn_storage_mode: 'shared',          // まず全社共有モードで確認する
    }));
  });

  /* APIは全部スタブ。実サーバーは立てない */
  await ctx.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const p   = url.pathname;
    const j   = (body) => route.fulfill({ status: 200, contentType: 'application/json',
                                          body: JSON.stringify(body) });

    if (p.endsWith('/wn/files')) {
      calls.push(Object.fromEntries(url.searchParams));
      return j({
        data: [fileRow(1, '自分の図面.pdf', 'company', 1), fileRow(2, '他人の図面.pdf', 'company', 2)],
        meta: { current_page: 1, last_page: 1, per_page: 60, total: 2, storage_mode: 'shared' },
      });
    }
    if (p.endsWith('/wn/settings'))       return j({ data: { storage_mode: 'shared', my_private_count: 0 } });
    if (p.endsWith('/wn/tags'))           return j({ data: [] });
    if (p.endsWith('/wn/notifications'))  return j({ data: [] });
    if (p.endsWith('/wn/contacts'))       return j({ data: [] });
    if (p.endsWith('/wn/contact-tags'))   return j({ data: [], groups: [] });
    if (p.endsWith('/wn/storage'))        return j({ data: [] });
    return j({ data: [] });
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { if (!noise(e)) errors.push(String(e)); });
  page.on('console', m => { if (m.type() === 'error' && !noise(m.text())) errors.push(m.text()); });

  const lastCall = () => calls[calls.length - 1] ?? {};

  /* ── 1. 既定表示 ── */
  await page.goto(`${BASE}/whatsno/app/dashboard.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  check('JSエラーが出ない（navAll削除の取りこぼし検出）', errors.length === 0, errors.join(' | '));

  const homeGone = await page.locator('#navAll').count();
  check('ホームがサイドバーから消えている', homeGone === 0, `#navAll=${homeGone}件`);

  const mineActive = await page.locator('#navMine.active').count();
  check('既定がマイファイル', mineActive === 1);

  const companyVisible = await page.locator('#navCompany').isVisible();
  check('全社共有モードでも社内共有が出る', companyVisible === true);

  check('初回は scope=mine を送る', lastCall().scope === 'mine', JSON.stringify(lastCall()));

  const title0 = await page.locator('#areaTitle').textContent();
  check('見出しがマイファイル', title0.trim() === 'マイファイル', title0);

  /* ── 2. 社内共有へ切替 ── */
  await page.click('#navCompany');
  await page.waitForTimeout(500);
  check('社内共有で scope=company を送る', lastCall().scope === 'company', JSON.stringify(lastCall()));
  const title1 = await page.locator('#areaTitle').textContent();
  check('見出しが社内共有', title1.trim() === '社内共有', title1);

  /* ── 3. 検索するとビューの絞り込みが外れる ── */
  await page.fill('#searchInput', '図面');
  await page.press('#searchInput', 'Enter');
  await page.waitForTimeout(900);

  const sc = lastCall();
  check('検索中は scope を送らない（全体横断）', sc.scope === undefined && sc.search === '図面',
    JSON.stringify(sc));

  const title2 = await page.locator('#areaTitle').textContent();
  check('見出しが検索結果に変わる', title2.includes('検索結果') && title2.includes('図面'), title2);

  /* ── 4. ビューを切り替えると検索が解除される ── */
  await page.click('#navMine');
  await page.waitForTimeout(600);
  const searchVal = await page.inputValue('#searchInput');
  check('切替で検索が解除される', searchVal === '', `"${searchVal}"`);
  check('切替後は scope=mine に戻る', lastCall().scope === 'mine', JSON.stringify(lastCall()));

  /* ── 5. タグ共有リンクは全体表示 ── */
  calls.length = 0;
  await page.goto(`${BASE}/whatsno/app/dashboard.html?tags=1,2`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const tc = lastCall();
  check('タグ共有リンクは scope なし（全体から探す）', tc.scope === undefined && tc.tag === '1,2',
    JSON.stringify(tc));

  /* ── 6. 個人保管モードのときのUI ── */
  await ctx.addInitScript(() => {
    const u = JSON.parse(sessionStorage.getItem('space_user') || '{}');
    u.wn_storage_mode = 'personal';
    sessionStorage.setItem('space_user', JSON.stringify(u));
  });
  await ctx.route('**/api/wn/files*', async route => {
    const url = new URL(route.request().url());
    calls.push(Object.fromEntries(url.searchParams));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      data: [fileRow(1, '自分の図面.pdf', 'private', 1), fileRow(2, '共有の図面.pdf', 'company', 2)],
      meta: { current_page: 1, last_page: 1, per_page: 60, total: 2, storage_mode: 'personal' },
    })});
  });

  errors.length = 0;
  const page2 = await ctx.newPage();
  page2.on('pageerror', e => { if (!noise(e)) errors.push(String(e)); });
  page2.on('console', m => { if (m.type() === 'error' && !noise(m.text())) errors.push(m.text()); });
  await page2.goto(`${BASE}/whatsno/app/dashboard.html`, { waitUntil: 'networkidle' });
  await page2.waitForTimeout(900);

  check('個人保管モードでもJSエラーが出ない', errors.length === 0, errors.join(' | '));

  const badges = await page2.locator('.file-card').first().innerText().catch(() => '');
  check('個人保管モードで可視範囲バッジが出る',
    badges.includes('個人') || badges.includes('社内共有'), badges.replace(/\n/g, ' / ').slice(0, 80));

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
