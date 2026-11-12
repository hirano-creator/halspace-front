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

async function open(browser, fileName, body) {
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
  await page.goto(`${BASE}/app/file-detail.html?id=1`, { waitUntil: 'domcontentloaded' });
  return { ctx, page, errors };
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
    const { ctx, page, errors } = await open(browser, name, body);
    const frame = await waitResult(page);
    const hasCanvas = await frame.evaluate(() => !!document.querySelector('#stage canvas'));
    check(`${name}: 3Dの canvas が出る`, hasCanvas, await frame.evaluate(() => document.getElementById('msg').textContent));
    const btns = await frame.$$eval('#toolbar button', b => b.map(x => x.textContent.trim()).join('/'));
    check(`${name}: 視点切り替えボタンが出る`, /等角\/正面\/上面\/右側面\/エッジ/.test(btns), btns);
    const size = await page.$eval('#previewFrame', f => [f.offsetWidth, f.offsetHeight]);
    check(`${name}: プレビュー枠いっぱいに出る`, size[0] > 300 && size[1] > 300, size.join('x'));
    check(`${name}: ページエラーなし`, errors.length === 0, errors.join(' | '));
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

  await browser.close(); server.close();
  const ng = results.filter(r => !r.ok);
  console.log(`\n${results.length - ng.length}/${results.length} PASS`);
  process.exit(ng.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
