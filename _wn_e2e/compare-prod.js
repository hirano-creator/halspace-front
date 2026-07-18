/* 本番デプロイ済みページ(space-apps.pages.dev)をそのまま検証（APIはモック） */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = 'https://space-apps.pages.dev/whatsno';
const SHOTS = path.join(__dirname, 'shots');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

function makeMultiPagePdf(pageStreams) {
  const n = pageStreams.length;
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const kids = pageStreams.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`;
  pageStreams.forEach((s, i) => {
    objs[3 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${3 + n * 2} 0 R >> >> >>`;
    objs[4 + i * 2] = `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
  });
  objs[3 + n * 2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  const total = 3 + n * 2;
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i <= total; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefPos = out.length;
  out += `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= total; i++) out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
const pageStream = (label, extra = '') =>
  `BT /F1 36 Tf 60 760 Td (${label}) Tj ET 4 w 40 40 515 762 re S ${extra}`;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1350, height: 760 } });
  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin' }));
  });

  const pdfA = makeMultiPagePdf([pageStream('Page 1 A'), pageStream('Page 2 A', '100 200 m 400 500 l S')]);
  const pdfB = makeMultiPagePdf([pageStream('Page 1 B'), pageStream('Page 2 B', '100 500 m 400 200 l S')]);

  const page = await ctx.newPage();
  await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
  await page.route('**/api/wn/files/301', r => r.fulfill({ json: { data: { id: 301, file_name: '図面A.pdf', version: 1, mime_type: 'application/pdf' } } }));
  await page.route('**/api/wn/files/302', r => r.fulfill({ json: { data: { id: 302, file_name: '報告書B.pdf', version: 1, mime_type: 'application/pdf' } } }));
  await page.route('**/api/wn/files/301/view', r => r.fulfill({ json: { url: 'https://space-apps.pages.dev/__mp_a.pdf' } }));
  await page.route('**/api/wn/files/302/view', r => r.fulfill({ json: { url: 'https://space-apps.pages.dev/__mp_b.pdf' } }));
  await page.route('**/__mp_a.pdf', r => r.fulfill({ contentType: 'application/pdf', body: pdfA }));
  await page.route('**/__mp_b.pdf', r => r.fulfill({ contentType: 'application/pdf', body: pdfB }));
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });

  await page.goto(`${BASE}/app/diff.html?a=301&b=302&type=files`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('diffLoading').style.display === 'none', { timeout: 25000 });
  await page.waitForTimeout(500);

  const layout = await page.evaluate(() => {
    const panelA = document.getElementById('panelA');
    const c = document.querySelector('#canvasWrapA canvas');
    return {
      canvases: document.querySelectorAll('#diffBody canvas').length,
      canvasW: c ? Math.round(c.getBoundingClientRect().width) : 0,
      panelW: panelA ? panelA.clientWidth : 0,
      bodyText: document.getElementById('diffBody').textContent.trim().slice(0, 60),
    };
  });
  check('本番ページ: 並列表示でcanvas描画・パネル幅にフィット',
    layout.canvases === 4 && layout.canvasW > 0 && layout.canvasW <= layout.panelW, JSON.stringify(layout));

  for (const m of ['overlay', 'swipe', 'diff', 'side']) {
    await page.click(`[data-mode="${m}"]`);
    await page.waitForFunction(() => document.getElementById('diffLoading').style.display === 'none', { timeout: 20000 });
    await page.waitForTimeout(300);
    const n = await page.evaluate(() => document.querySelectorAll('#diffBody canvas').length);
    check(`本番ページ: ${m}モードでcanvasあり`, n > 0, `canvas=${n}`);
  }
  await page.screenshot({ path: path.join(SHOTS, 'prod-diff.png') });

  await browser.close();
  const fails = results.filter(r => !r.ok);
  console.log(`\n==== 結果: ${results.length - fails.length}/${results.length} PASS ====`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
