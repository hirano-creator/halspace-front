/* 本番相当条件での再現テスト: 複数ページA4 PDF、全モード巡回、可視ピクセル検査 */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:8765/whatsno';
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

/* 複数ページのA4 PDF（595x842pt）を生成 */
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

  const pdfA = makeMultiPagePdf([
    pageStream('Page 1 A'),
    pageStream('Page 2 A', '100 200 m 400 500 l S'),
    pageStream('Page 3 A'),
  ]);
  const pdfB = makeMultiPagePdf([
    pageStream('Page 1 B'),
    pageStream('Page 2 B', '100 500 m 400 200 l S 200 600 80 0 360 arc'),
    pageStream('Page 3 B'),
    pageStream('Page 4 B only'),
  ]);

  const page = await ctx.newPage();
  await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
  await page.route('**/api/wn/files/301', r => r.fulfill({ json: { data: { id: 301, file_name: '図面_カタログ.pdf', version: 1, mime_type: 'application/pdf' } } }));
  await page.route('**/api/wn/files/302', r => r.fulfill({ json: { data: { id: 302, file_name: '巡視報告書.pdf', version: 1, mime_type: 'application/pdf' } } }));
  await page.route('**/api/wn/files/301/view', r => r.fulfill({ json: { url: 'http://127.0.0.1:8765/__mp_a.pdf' } }));
  await page.route('**/api/wn/files/302/view', r => r.fulfill({ json: { url: 'http://127.0.0.1:8765/__mp_b.pdf' } }));
  await page.route('**/__mp_a.pdf', r => r.fulfill({ contentType: 'application/pdf', body: pdfA }));
  await page.route('**/__mp_b.pdf', r => r.fulfill({ contentType: 'application/pdf', body: pdfB }));
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });

  await page.goto(`${BASE}/app/diff.html?a=301&b=302&type=files`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('diffLoading').style.display === 'none', { timeout: 20000 });
  await page.waitForTimeout(400);

  /* diffBodyのスクリーンショットに「白/背景以外のピクセル」があるか＝実際に見えているか */
  const visiblePainted = async () => {
    const el = await page.locator('#diffBody').elementHandle();
    const buf = await el.screenshot();
    const png = buf;
    /* 簡易判定: PNGバイナリではなくcanvasで解析 */
    return page.evaluate(async (b64) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64; });
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 40) { /* サンプリング */
        if (d[i] < 200 && d[i + 1] < 200 && d[i + 2] < 200) dark++;
      }
      return dark;
    }, png.toString('base64'));
  };

  const modes = ['side', 'overlay', 'swipe', 'diff', 'side', 'overlay', 'side', 'swipe', 'diff', 'side'];
  for (let i = 0; i < modes.length; i++) {
    const m = modes[i];
    await page.click(`[data-mode="${m}"]`);
    await page.waitForFunction(() => document.getElementById('diffLoading').style.display === 'none', { timeout: 20000 });
    await page.waitForTimeout(300);
    const dark = await visiblePainted();
    check(`巡回${i + 1}(${m}): 画面内に描画ピクセルあり`, dark > 50, `dark=${dark}`);
    if (i === modes.length - 1) await page.screenshot({ path: path.join(SHOTS, 'repro-final-side.png') });
  }

  /* 並列モードでページ数・スクロール可否 */
  const layout = await page.evaluate(() => {
    const panelA = document.getElementById('panelA');
    const body = document.getElementById('diffBody');
    return {
      canvasesA: document.querySelectorAll('#canvasWrapA canvas').length,
      canvasesB: document.querySelectorAll('#canvasWrapB canvas').length,
      panelH: Math.round(panelA.getBoundingClientRect().height),
      bodyH: body.clientHeight,
      scrollable: panelA.scrollHeight > panelA.clientHeight,
      canvasW: Math.round(document.querySelector('#canvasWrapA canvas').getBoundingClientRect().width),
      panelW: panelA.clientWidth,
    };
  });
  check('並列: A=3ページ/B=4ページ', layout.canvasesA === 3 && layout.canvasesB === 4, JSON.stringify(layout));
  check('並列: パネル高が画面内に収まり縦スクロール可能',
    layout.panelH <= layout.bodyH + 2 && layout.scrollable, JSON.stringify(layout));
  check('並列: canvasがパネル幅以内', layout.canvasW <= layout.panelW, `canvasW=${layout.canvasW} panelW=${layout.panelW}`);

  /* スクロール同期 */
  await page.evaluate(() => { document.getElementById('panelA').scrollTop = 500; });
  await page.waitForTimeout(200);
  const syncTop = await page.evaluate(() => document.getElementById('panelB').scrollTop);
  check('並列: スクロール同期', Math.abs(syncTop - 500) < 5, `panelB.scrollTop=${syncTop}`);

  /* ズーム→等倍戻しでフィット表示を維持できるか */
  await page.mouse.move(400, 400);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Control');
  await page.waitForTimeout(200);
  const zoomedW = await page.evaluate(() => Math.round(document.querySelector('#canvasWrapA canvas').getBoundingClientRect().width));
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 480);
  await page.keyboard.up('Control');
  await page.waitForTimeout(200);
  const backW = await page.evaluate(() => ({
    w: Math.round(document.querySelector('#canvasWrapA canvas').getBoundingClientRect().width),
    maxW: document.querySelector('#canvasWrapA canvas').style.maxWidth,
    panelW: document.getElementById('panelA').clientWidth,
  }));
  check('ズーム後に等倍へ戻すとフィット表示', zoomedW > backW.w && backW.w <= backW.panelW && backW.maxW === '100%', JSON.stringify({ zoomedW, ...backW }));

  await page.screenshot({ path: path.join(SHOTS, 'repro-multipage.png') });
  await browser.close();
  const fails = results.filter(r => !r.ok);
  console.log(`\n==== 結果: ${results.length - fails.length}/${results.length} PASS ====`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
