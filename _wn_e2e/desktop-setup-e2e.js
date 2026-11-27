/* デスクトップ連携のかんたん手順（Win+R に貼るだけ）の検証

   確認すること:
   - 「セットアップ用の文字をコピー」で、トークンと配布元URL入りの1行コマンドがコピーされる
   - Win+R の上限（259文字）に収まる
   - 手動手順（うまくいかないとき）のコピーは従来の wn-install.ps1 コマンドのまま
   - JSエラーが出ない
   実行: node _wn_e2e/desktop-setup-e2e.js （SHOT=1 で shots/desktop-setup.png） */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8792;
const BASE = `http://127.0.0.1:${PORT}`;
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
               '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png' };
const noise = e => /39876|ERR_FAILED|whatsno:/.test(String(e));
const TOKEN = '123|mock-token-0123456789abcdef0123456789abcdef01';

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
};

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, serviceWorkers: 'block' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await ctx.addInitScript(t => {
    sessionStorage.setItem('space_token', t);
    sessionStorage.setItem('space_user', JSON.stringify({
      id: 1, name: 'テスト太郎', email: 't@example.com', role: 'super_admin',
      company: 'テスト社', company_id: 1, apps: ['whatsno'], wn_storage_mode: 'shared' }));
  }, TOKEN);
  await ctx.route('**/api/**', route => {
    const p = new URL(route.request().url()).pathname;
    const j = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (p.endsWith('/wn/files'))         return j({ data: [], meta: { current_page: 1, last_page: 1, per_page: 60, total: 0, storage_mode: 'shared' } });
    if (p.endsWith('/wn/settings'))      return j({ data: { storage_mode: 'shared', my_private_count: 0 } });
    if (p.endsWith('/wn/contact-tags'))  return j({ data: [], groups: [] });
    return j({ data: [] });
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { if (!noise(e)) errors.push(String(e)); });
  await page.goto(`${BASE}/whatsno/app/dashboard.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  if (errors.length) console.log('  load errors:', errors);

  await page.evaluate(() => document.getElementById('navDesktop').click());
  await page.waitForTimeout(300);
  check('モーダルが開く', await page.locator('#desktopModal').isVisible());
  check('3ステップが出ている', await page.locator('.wn-desk-steps > li').count() === 3);

  await page.click('#desktopTokenCopy');
  await page.waitForTimeout(200);
  const quick = await page.evaluate(() => navigator.clipboard.readText());
  console.log('  copied:', quick);
  check('トークンが入っている', quick.includes(`$t='${TOKEN}'`));
  check('配布元はこのページと同じ場所の tools/', quick.includes(`$u='${BASE}/whatsno/tools/'`));
  check('wn-setup.ps1 を読む', quick.includes("irm($u+'wn-setup.ps1')|iex"));
  const prodLen = quick.replace(`${BASE}/whatsno/tools/`, 'https://space-apps.pages.dev/whatsno/tools/').length;
  check('Win+R の上限(259文字)に収まる（本番URL換算）', prodLen < 259, `${prodLen}文字`);
  check('ボタンがコピー済み表示になる', (await page.locator('#desktopTokenCopy').innerText()).includes('コピーしました'));

  if (process.env.SHOT) await page.locator('#desktopModal .modal').screenshot({ path: path.join(__dirname, 'shots/desktop-setup.png') });

  await page.click('#desktopModal details summary');
  await page.click('#desktopManualCopy');
  await page.waitForTimeout(200);
  const manual = await page.evaluate(() => navigator.clipboard.readText());
  check('手動手順は従来の wn-install.ps1 コマンド', manual.includes('wn-install.ps1') && manual.includes(TOKEN), manual);
  if (process.env.SHOT) await page.locator('#desktopModal .modal').screenshot({ path: path.join(__dirname, 'shots/desktop-setup-manual.png') });

  check('JSエラーが出ない', errors.length === 0, errors.join(' | '));
  await browser.close(); server.close();
  const failed = results.filter(x => !x).length;
  console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
  process.exit(failed ? 1 : 0);
})();
