/* ファイル詳細の 3Dモデル (STL / STEP) プレビューの E2E（バックエンドなし・APIモック）

   確認すること:
   - STL / STEP のファイル詳細で、プレビュー枠に model3d.html が埋め込まれ、WebGL の canvas が出る
   - 視点切り替えのツールバー（等角・正面・上面・右側面・エッジ）が出る
   - 壊れたファイルでは「表示できませんでした」の案内になり、ページはエラーで止まらない

   実行: node _wn_e2e/model3d-e2e.js（サーバーはこのスクリプトが立てる）
   STEP のサンプルは fixtures/cube.stp（無ければ STEP の確認は飛ばす）
   SHOT=1 を付けると shots/model3d-*.png を残す */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8797;
const BASE = `http://127.0.0.1:${PORT}/whatsno`;
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
               '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

const STL = fs.readFileSync(path.join(ROOT, '3d-data_shop/models/couplings/jaw_d19_d8.stl'));
const STEP_PATH = path.join(__dirname, 'fixtures', 'cube.stp');
const STEP = fs.existsSync(STEP_PATH) ? fs.readFileSync(STEP_PATH) : null;

async function open(browser, fileName, body, { thumbStatus = 404 } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({ id: 1, name: '平野', role: 'admin', company_id: 1,
      apps: ['whatsno', 'solid'], wn_extended_options_enabled: true }));
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const FILE = { id: 1, file_name: fileName, mime_type: 'application/octet-stream', file_size: body.length,
    version: 1, created_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-12T00:00:00Z',
    uploader: { id: 1, name: '平野' }, tags: [], visibility: 'private', can_edit: true };
  await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
  await page.route('**/api/wn/files/1', r => r.fulfill({ json: { data: FILE } }));
  await page.route('**/api/wn/files/1/view*', r => r.fulfill({ json: { url: `http://127.0.0.1:${PORT}/__model` } }));
  await page.route('**/__model', r => r.fulfill({ contentType: 'application/octet-stream', body }));
  const posts = [];
  await page.route('**/api/wn/files/1/thumb*', r => {
    if (r.request().method() === 'POST') { posts.push(r.request().postDataBuffer()); return r.fulfill({ json: { ok: true } }); }
    return thumbStatus === 404 ? r.fulfill({ status: 404, json: { message: 'nf' } })
                               : r.fulfill({ contentType: 'image/jpeg', body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  });
  await page.goto(`${BASE}/app/file-detail.html?id=1`, { waitUntil: 'domcontentloaded' });
  return { ctx, page, errors, posts };
}

async function waitResult(page, timeout = 60000) {
  const frame = await (await page.waitForSelector('#previewFrame[src*="model3d"]', { timeout: 15000 })).contentFrame();
  await frame.waitForFunction(() => document.querySelector('#stage canvas')
    || /表示できません/.test(document.getElementById('msg').textContent), null, { timeout });
  return frame;
}

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

  const cases = [['部品.stl', STL]];
  if (STEP) cases.push(['部品.step', STEP]); else console.log('SKIP: fixtures/cube.stp が無いので STEP は確認しない');

  for (const [name, body] of cases) {
    const { ctx, page, errors, posts } = await open(browser, name, body);
    const frame = await waitResult(page);
    const hasCanvas = await frame.evaluate(() => !!document.querySelector('#stage canvas'));
    check(`${name}: 3Dの canvas が出る`, hasCanvas, await frame.evaluate(() => document.getElementById('msg').textContent));
    const btns = await frame.$$eval('#toolbar button', b => b.map(x => x.textContent.trim()).join('/'));
    check(`${name}: 視点切り替えボタンが出る`, /等角\/正面\/上面\/右側面\/エッジ/.test(btns), btns);
    const size = await page.$eval('#previewFrame', f => [f.offsetWidth, f.offsetHeight]);
    check(`${name}: プレビュー枠いっぱいに出る`, size[0] > 300 && size[1] > 300, size.join('x'));
    check(`${name}: ページエラーなし`, errors.length === 0, errors.join(' | '));
    await page.waitForTimeout(1500);
    check(`${name}: サムネ未作成なら一覧用サムネを保存する`, posts.length === 1 && /image\/jpeg/.test(posts[0]?.toString('latin1') || ''), `POST ${posts.length}件`);
    if (process.env.SHOT && posts[0]) {
      const raw = posts[0].toString('latin1'); const a = raw.indexOf('\xff\xd8'); const b = raw.lastIndexOf('\xff\xd9');
      fs.writeFileSync(path.join(SHOTS, `model3d-thumb-${path.extname(name).slice(1)}.jpg`), posts[0].subarray(a, b + 2));
    }
    if (process.env.SHOT) { await page.waitForTimeout(800); await page.screenshot({ path: path.join(SHOTS, `model3d-${path.extname(name).slice(1)}.png`) }); }
    await ctx.close();
  }

  {
    const { ctx, page, errors } = await open(browser, '壊れた.step', Buffer.from('not a step file'));
    const frame = await waitResult(page);
    const text = await frame.evaluate(() => document.getElementById('msg').textContent);
    check('壊れたSTEP: 表示できない旨の案内になる', /表示できません/.test(text), text);
    check('壊れたSTEP: ページエラーなし', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  /* サムネが既にサーバーにあるなら作り直さない */
  {
    const { ctx, page, posts } = await open(browser, '部品.stl', STL, { thumbStatus: 200 });
    await waitResult(page);
    await page.waitForTimeout(1500);
    check('詳細: サムネ保存済みなら送らない', posts.length === 0, `POST ${posts.length}件`);
    await ctx.close();
  }

  /* ── ダッシュボード一覧 ── */
  const row = (id, name, o = {}) => ({ id, file_name: name, file_size: 50000, mime_type: 'application/octet-stream',
    version: 1, created_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-12T00:00:00Z', uploader: { id: 1, name: '平野' },
    tags: [], like_count: 0, liked: false, view_count: 0, comment_count: 0, approval_status: 'none',
    visibility: 'private', owner_user_id: 1, can_edit: true, folder_id: null, ...o });
  const FILES = [row(11, 'カップリング.stl', { file_size: STL.length }), row(12, '立方体.step', { file_size: STEP ? STEP.length : 1 }),
                 row(13, '大きい.stl', { file_size: 40 * 1024 * 1024 })];
  async function openDash(mobile) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: mobile ? { width: 390, height: 844 } : { width: 1400, height: 900 },
      isMobile: mobile, hasTouch: mobile, userAgent: mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' : undefined });
    await ctx.addInitScript(() => {
      sessionStorage.setItem('space_token', 'mock-token-e2e');
      sessionStorage.setItem('space_user', JSON.stringify({ id: 1, name: '平野', role: 'admin', company_id: 1,
        apps: ['whatsno'], wn_storage_mode: 'personal' }));
    });
    const posts = {}, downloads = [];
    await ctx.route('**/api/**', route => {
      const req = route.request(); const p = new URL(req.url()).pathname;
      const j = b => route.fulfill({ json: b });
      let m;
      if (p.endsWith('/wn/files')) return j({ data: FILES, meta: { current_page: 1, last_page: 1, per_page: 60, total: FILES.length, storage_mode: 'personal' } });
      if ((m = p.match(/\/wn\/files\/(\d+)\/thumb$/))) {
        if (req.method() === 'POST') { posts[m[1]] = (posts[m[1]] || 0) + 1; return j({ ok: true }); }
        return route.fulfill({ status: 404, json: {} });
      }
      if ((m = p.match(/\/wn\/files\/(\d+)\/view$/))) { downloads.push(m[1]); return j({ url: `http://127.0.0.1:${PORT}/__m${m[1]}` }); }
      return j({ data: [] });
    });
    await ctx.route('**/__m*', r => r.fulfill({ contentType: 'application/octet-stream', body: r.request().url().endsWith('12') ? (STEP || Buffer.alloc(0)) : STL }));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${BASE}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
    return { ctx, page, errors, posts, downloads };
  }
  {
    const { ctx, page, errors, posts, downloads } = await openDash(false);
    const want = STEP ? ['11', '12'] : ['11'];
    const t0 = Date.now();
    while (Date.now() - t0 < 90000 && !want.every(id => posts[id])) await page.waitForTimeout(500);
    check('一覧(PC): STL/STEP のサムネを作ってサーバーに保存する', want.every(id => posts[id] === 1), JSON.stringify(posts));
    const imgs = await page.$$eval('.wn-card img, [id^="thumb-icon"] img', els => els.length).catch(() => 0);
    const thumbImgs = await page.evaluate(() => [...document.querySelectorAll('img')].filter(i => i.src.startsWith('blob:')).length);
    check('一覧(PC): カードにサムネ画像が出る', thumbImgs >= want.length, `blob画像 ${thumbImgs}件`);
    check('一覧(PC): 30MB超は一覧で作らない（ダウンロードもしない）', !downloads.includes('13') && !posts['13'], downloads.join(','));
    check('一覧(PC): 画面外の生成用 iframe は片付いている', await page.evaluate(() => !document.querySelector('iframe[src*="model3d"]')));
    check('一覧(PC): ページエラーなし', errors.length === 0, errors.join(' | '));
    if (process.env.SHOT) await page.screenshot({ path: path.join(SHOTS, 'model3d-dashboard.png') });
    await ctx.close();
  }
  {
    const { ctx, page, posts, downloads } = await openDash(true);
    await page.waitForTimeout(6000);
    check('一覧(スマホ): 3Dのサムネは作らない（ダウンロードしない）', downloads.length === 0 && Object.keys(posts).length === 0, downloads.join(','));
    await ctx.close();
  }

  await browser.close(); server.close();
  const ng = results.filter(r => !r.ok);
  console.log(`\n${results.length - ng.length}/${results.length} PASS`);
  process.exit(ng.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
