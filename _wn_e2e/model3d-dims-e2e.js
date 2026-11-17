/* 3Dモデル (STL / STEP) の寸法の E2E（バックエンドなし・APIモック）

   確認すること:
   - ファイル詳細の3D表示に「寸法を入れる」「寸法 N」「図面」が出る（寸法APIが無いときは出ない）
   - 2点を押すと、角に吸い付いた正しい長さ（40×20×10 の箱で確認）の寸法が残り、保存される
   - 寸法を押すと 直線／X／Y／Z の切り替え・メモ・削除ができる
   - 保存済みの寸法は開き直すと表示される
   - 図面（PDF）を選ぶと横に並び、どの図面かも保存される
   - スマホ幅でもボタンが出て、横にはみ出さない

   実行: node _wn_e2e/model3d-dims-e2e.js（サーバーはこのスクリプトが立てる）
   SHOT=1 を付けると shots/model3d-dims-*.png を残す */
const path = require('path');
const fs   = require('fs');
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const PW = [path.join(ROOT, '_aa_e2e/node_modules/playwright-core'), 'c:/dev/my-programming/_aa_e2e/node_modules/playwright-core'].find(p => fs.existsSync(p));
const { chromium } = require(PW);

const PORT = 8798;
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

/* 40 × 20 × 10 の箱（バイナリSTL）。寸法の正しさを確かめるための、大きさが分かっている形 */
function boxStl(sx, sy, sz) {
  const v = [[0,0,0],[sx,0,0],[sx,sy,0],[0,sy,0],[0,0,sz],[sx,0,sz],[sx,sy,sz],[0,sy,sz]];
  const quads = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[2,3,7,6],[1,2,6,5],[0,4,7,3]];
  const tris = [];
  for (const [a,b,c,d] of quads) tris.push([v[a],v[b],v[c]], [v[a],v[c],v[d]]);
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => {
    let o = 84 + i * 50 + 12;   // 法線は 0 のまま（表示側で計算される）
    for (const p of t) for (const n of p) { buf.writeFloatLE(n, o); o += 4; }
  });
  return buf;
}

/* 1ページだけの最小のPDF */
function tinyPdf() {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 297] /Contents 4 0 R /Resources << >> >>',
  ];
  const stream = '0.9 0.2 0.2 rg 40 40 200 120 re f 0 0 0 RG 2 w 40 40 340 217 re S';
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const STL = boxStl(40, 20, 10);
const PDF = tinyPdf();
const STEP_PATH = path.join(__dirname, 'fixtures', 'cube.stp');
const STEP = fs.existsSync(STEP_PATH) ? fs.readFileSync(STEP_PATH) : null;

async function open(browser, { fileName = '箱.stl', body = STL, saved = { dims: [], drawing: null }, dimsApi = true, viewport = { width: 1400, height: 900 }, touch = false } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport, hasTouch: touch });
  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({ id: 1, name: '平野', role: 'admin', company_id: 1,
      apps: ['whatsno', 'solid'], wn_extended_options_enabled: true }));
  });
  const page = await ctx.newPage();
  const errors = [], puts = [];
  page.on('pageerror', e => errors.push(e.message));
  const FILE = { id: 1, file_name: fileName, mime_type: 'application/octet-stream', file_size: body.length,
    version: 1, created_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-12T00:00:00Z',
    uploader: { id: 1, name: '平野' }, tags: [], visibility: 'private', can_edit: true };
  const state = JSON.parse(JSON.stringify(saved));
  await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
  await page.route(/\/api\/wn\/files\?/, r => r.fulfill({ json: { data: [
    { id: 2, file_name: '箱_図面.pdf', mime_type: 'application/pdf', version: 1 },
    { id: 3, file_name: '箱_写真.jpg', mime_type: 'image/jpeg', version: 1 },
  ] } }));
  await page.route('**/api/wn/files/1', r => r.fulfill({ json: { data: FILE } }));
  await page.route('**/api/wn/files/1/view*', r => r.fulfill({ json: { url: `http://127.0.0.1:${PORT}/__model` } }));
  await page.route('**/api/wn/files/2/view*', r => r.fulfill({ json: { url: `http://127.0.0.1:${PORT}/__pdf` } }));
  await page.route('**/__model', r => r.fulfill({ contentType: 'application/octet-stream', body }));
  await page.route('**/__pdf', r => r.fulfill({ contentType: 'application/pdf', body: PDF }));
  await page.route('**/api/wn/files/1/dims', r => {
    if (!dimsApi) return r.fulfill({ status: 404, json: { message: 'Not found' } });
    if (r.request().method() === 'PUT') {
      const b = r.request().postDataJSON();
      puts.push(b);
      state.dims = b.dims;
      if ('drawing_file_id' in b) state.drawing = b.drawing_file_id ? { id: b.drawing_file_id, file_name: '箱_図面.pdf' } : null;
    }
    return r.fulfill({ json: state });
  });
  await page.goto(`${BASE}/app/file-detail.html?id=1`, { waitUntil: 'domcontentloaded' });
  const frame = await (await page.waitForSelector('#previewFrame[src*="model3d"]', { timeout: 15000 })).contentFrame();
  await frame.waitForSelector('#stage canvas', { timeout: 60000 });
  return { ctx, page, frame, errors, puts };
}

/* モデル上の点 p が、ページ全体のどこに見えているか */
async function screenOf(page, frame, p) {
  const [x, y] = await frame.evaluate(q => {
    const r = document.getElementById('stage').getBoundingClientRect();
    const s = window.wnModelMeasure._project(q);
    return [r.left + s[0], r.top + s[1]];
  }, p);
  const fr = await page.$eval('#previewFrame', f => { const r = f.getBoundingClientRect(); return [r.left, r.top]; });
  return [fr[0] + x, fr[1] + y];
}
const labelsOf = frame => frame.$$eval('.dm-label', l => l.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
const waitPut = async (page, puts, n) => { for (let i = 0; i < 40 && puts.length < n; i++) await page.waitForTimeout(100); };

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

  /* ── 1. 寸法を入れる・直す・消す ── */
  {
    const { ctx, page, frame, errors, puts } = await open(browser);
    await frame.waitForFunction(() => !!window.wnModelMeasure, null, { timeout: 15000 });
    const btns = await frame.$$eval('#toolbar button', b => b.map(x => x.textContent.trim()).join('/'));
    check('寸法のボタンが出る', /寸法を入れる\/寸法 0\/図面/.test(btns), btns);
    check('視点のボタンはそのまま', /等角\/正面\/上面\/右側面\/エッジ/.test(btns));

    await frame.click('button:has-text("寸法を入れる")');
    check('案内が出る', /1点目/.test(await frame.$eval('.dm-hint', e => e.textContent)));
    const edgesBefore = await frame.$eval('[data-edges]', b => b.style.opacity);
    check('寸法のボタンでエッジ表示が切り替わらない', edgesBefore !== '0.5', `opacity=${edgesBefore}`);

    /* 角から少しずらして押す → 角に吸い付く */
    let a = await screenOf(page, frame, [0, 20, 10]), b = await screenOf(page, frame, [40, 20, 10]);
    await page.mouse.click(a[0] + 4, a[1] + 3);
    check('1点目のあと2点目の案内になる', /2点目/.test(await frame.$eval('.dm-hint', e => e.textContent)));
    await page.mouse.move(b[0] - 30, b[1] - 10); await page.mouse.move(b[0] - 3, b[1] + 3);
    await page.waitForTimeout(150);
    const live = await frame.$eval('.dm-marker', m => [m.hidden, m.className, m.dataset.len]);
    check('動かしている間、吸い付き先と長さが出る', live[0] === false && /vertex/.test(live[1]) && live[2] === '40.00', live.join(' '));
    await page.mouse.click(b[0] - 3, b[1] + 3);
    let labels = await labelsOf(frame);
    check('寸法 40.00 が入る（角に吸い付く）', labels.length === 1 && labels[0] === '40.00', labels.join(','));
    await waitPut(page, puts, 1);
    const d0 = puts[0]?.dims?.[0];
    check('寸法が保存される', !!d0 && Math.abs(d0.a[0]) < 1e-3 && Math.abs(d0.b[0] - 40) < 1e-3 && !('drawing_file_id' in puts[0]), JSON.stringify(puts[0]));

    /* 続けてもう1本（斜め）: (40,20,10) → (0,0,10) = 44.72、X=40、Y=20 */
    a = await screenOf(page, frame, [40, 20, 10]); b = await screenOf(page, frame, [0, 0, 10]);
    await page.mouse.click(a[0], a[1]);
    await page.mouse.click(b[0] + 2, b[1] - 2);
    labels = await labelsOf(frame);
    check('2本目（斜め）は 44.72', labels.length === 2 && labels[1] === '44.72', labels.join(','));
    check('件数が出る', /寸法 2/.test(await frame.$eval('#toolbar', t => t.textContent)));

    /* 回しても寸法がモデルに付いてくる */
    await frame.click('button:has-text("正面")');
    await page.waitForTimeout(200);
    const front = await frame.evaluate(() => { const s = window.wnModelMeasure._project([0, 20, 10]), e = window.wnModelMeasure._project([40, 20, 10]); return Math.abs(s[1] - e[1]); });
    check('正面にすると寸法線が水平になる', front < 1, `dy=${front.toFixed(2)}`);
    await frame.click('button:has-text("等角")');

    /* 寸法を押して、X方向に切り替え・メモ */
    await frame.locator('.dm-label').nth(1).click();
    check('寸法を押すと編集の小窓が出る', await frame.$eval('.dm-panel', p => !p.hidden && /44\.72/.test(p.textContent)));
    const seg = await frame.$$eval('.dm-seg button', b => b.map(x => x.innerText.replace(/\s+/g, ' ')).join('|'));
    check('直線／X／Y／Z の値が出る', seg === '直線 44.72|X 40.00|Y 20.00|Z 0.00', seg);
    await frame.locator('.dm-seg button').nth(2).click();
    labels = await labelsOf(frame);
    check('Y方向にすると Y 20.00 になる', labels[1] === 'Y 20.00', labels.join(','));
    await frame.fill('.dm-p-note input', '20±0.1');
    labels = await labelsOf(frame);
    check('メモが寸法に出る', labels[1] === 'Y 20.00 20±0.1', labels.join(','));
    const n = puts.length;
    await page.waitForTimeout(1200);
    const last = puts[puts.length - 1];
    check('向きとメモが保存される', puts.length > n - 1 && last.dims[1].axis === 'y' && last.dims[1].note === '20±0.1', JSON.stringify(last.dims[1]));
    if (process.env.SHOT) await page.screenshot({ path: path.join(SHOTS, 'model3d-dims-edit.png') });

    /* 消す */
    await frame.click('.dm-p-del');
    labels = await labelsOf(frame);
    check('消すと1本に戻る', labels.length === 1 && labels[0] === '40.00', labels.join(','));
    await page.waitForTimeout(1000);
    check('消したことが保存される', puts[puts.length - 1].dims.length === 1);

    /* 隠す */
    await frame.click('button:has-text("寸法 1")');
    check('寸法を隠せる', await frame.$eval('.dm-labels', e => getComputedStyle(e).display === 'none'));
    await frame.click('button:has-text("寸法 1")');

    /* Esc でやめる */
    await frame.click('button:has-text("寸法を入れる")');
    await page.mouse.click(a[0], a[1]);
    await frame.press('body', 'Escape'); await frame.press('body', 'Escape');
    check('Esc で寸法入れをやめる', await frame.evaluate(() => { const s = window.wnModelMeasure._state(); return !s.measuring && !s.pending && s.dims.length === 1; }));
    check('ページエラーなし', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  /* ── 2. 保存済みの寸法と図面 ── */
  {
    const saved = { dims: [{ id: 'k1', a: [0, 20, 10], b: [40, 20, 10], axis: null, note: '40±0.2' }], drawing: null };
    const { ctx, page, frame, errors, puts } = await open(browser, { saved });
    await frame.waitForFunction(() => !!window.wnModelMeasure, null, { timeout: 15000 });
    const labels = await labelsOf(frame);
    check('開き直すと保存済みの寸法が出る', labels.length === 1 && labels[0] === '40.00 40±0.2', labels.join(','));

    await frame.click('button:has-text("図面")');
    await frame.waitForSelector('.dp-row', { timeout: 10000 });
    const rows = await frame.$$eval('.dp-row', r => r.map(x => x.textContent.trim()));
    check('図面の候補は PDF だけ', rows.length === 1 && rows[0] === '箱_図面.pdf', rows.join(','));
    await frame.click('.dp-row');
    await frame.waitForFunction(() => { const c = document.querySelector('.dp-view canvas'); return c && c.width > 300 && c.style.display !== 'none'; }, null, { timeout: 30000 });
    const lay = await frame.evaluate(() => {
      const s = document.getElementById('stage').getBoundingClientRect(), d = document.getElementById('drawPane').getBoundingClientRect();
      const c = document.querySelector('.dp-view canvas').getBoundingClientRect();
      return { s: [s.left, s.width], d: [d.left, d.width], c: [c.width, c.height], name: document.querySelector('.dp-name').textContent };
    });
    check('3Dと図面が横に並ぶ', lay.s[1] > 300 && lay.d[1] > 300 && lay.d[0] >= lay.s[0] + lay.s[1] - 1, JSON.stringify(lay));
    check('図面が描かれる', lay.c[0] > 200 && lay.name === '箱_図面.pdf', JSON.stringify(lay.c));
    const p = puts.find(x => 'drawing_file_id' in x);
    check('どの図面かが保存される（寸法は消えない）', !!p && p.drawing_file_id === 2 && p.dims.length === 1, JSON.stringify(p));

    /* 図面を拡大 */
    const w0 = lay.c[0];
    const vr = await frame.$eval('.dp-view', v => { const r = v.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const fr = await page.$eval('#previewFrame', f => { const r = f.getBoundingClientRect(); return [r.left, r.top]; });
    await page.mouse.move(fr[0] + vr[0], fr[1] + vr[1]);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(500);
    const w1 = await frame.$eval('.dp-view canvas', c => c.getBoundingClientRect().width);
    check('図面をホイールで拡大できる', w1 > w0 * 1.1, `${w0.toFixed(0)} → ${w1.toFixed(0)}`);

    /* 図面を並べたまま寸法を入れられる */
    await frame.click('button:has-text("寸法を入れる")');
    const a = await screenOf(page, frame, [40, 20, 10]), b = await screenOf(page, frame, [40, 0, 10]);
    await page.mouse.click(a[0], a[1]); await page.mouse.click(b[0], b[1]);
    const l2 = await labelsOf(frame);
    check('図面を並べたまま寸法 20.00 を入れられる', l2.length === 2 && l2[1] === '20.00', l2.join(','));
    if (process.env.SHOT) { await page.waitForTimeout(600); await page.screenshot({ path: path.join(SHOTS, 'model3d-dims-drawing.png') }); }

    await frame.click('.dp-head button:has-text("×")');
    check('図面を閉じると3Dが元の幅に戻る', await frame.evaluate(() => document.getElementById('drawPane').hidden && document.getElementById('stage').clientWidth > window.innerWidth - 4));
    check('ページエラーなし（図面）', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  /* ── 3. 寸法のAPIが無い（APIが古い）ときはボタンを出さない ── */
  {
    const { ctx, page, frame, errors } = await open(browser, { dimsApi: false });
    await page.waitForTimeout(1500);
    const btns = await frame.$$eval('#toolbar button', b => b.map(x => x.textContent.trim()).join('/'));
    check('APIが無いときは寸法のボタンを出さない', !/寸法/.test(btns) && /等角/.test(btns), btns);
    check('ページエラーなし（APIなし）', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  /* ── 4. STEP ── */
  if (STEP) {
    const { ctx, frame, errors } = await open(browser, { fileName: '部品.step', body: STEP });
    await frame.waitForFunction(() => !!window.wnModelMeasure, null, { timeout: 15000 });
    check('STEP でも寸法のボタンが出る', /寸法を入れる/.test(await frame.$eval('#toolbar', t => t.textContent)));
    check('ページエラーなし（STEP）', errors.length === 0, errors.join(' | '));
    await ctx.close();
  } else console.log('SKIP: fixtures/cube.stp が無いので STEP は確認しない');

  /* ── 5. スマホ幅 ── */
  {
    const { ctx, page, frame, errors } = await open(browser, { viewport: { width: 390, height: 780 }, touch: true });
    await frame.waitForFunction(() => !!window.wnModelMeasure, null, { timeout: 15000 });
    const m = await frame.evaluate(() => {
      const bs = [...document.querySelectorAll('#toolbar button')].filter(b => b.offsetWidth > 0);
      return { n: bs.length, over: document.documentElement.scrollWidth - window.innerWidth, right: Math.max(...bs.map(b => b.getBoundingClientRect().right)), w: window.innerWidth };
    });
    check('スマホ幅: ボタンが全部見えて横にはみ出さない', m.n === 8 && m.over <= 0 && m.right <= m.w, JSON.stringify(m));
    await frame.tap('button[title^="2点"]');
    const a = await screenOf(page, frame, [0, 20, 10]), b = await screenOf(page, frame, [40, 20, 10]);
    await page.touchscreen.tap(a[0] + 8, a[1] + 6); await page.touchscreen.tap(b[0] - 8, b[1] + 6);
    const labels = await labelsOf(frame);
    check('スマホ: 指で2点を押して 40.00 が入る', labels.length === 1 && labels[0] === '40.00', labels.join(','));
    await frame.tap('.dm-label');
    const fs16 = await frame.$eval('.dm-p-note input', i => parseFloat(getComputedStyle(i).fontSize));
    check('スマホ: メモ欄の文字は16px以上', fs16 >= 16, String(fs16));
    if (process.env.SHOT) await page.screenshot({ path: path.join(SHOTS, 'model3d-dims-mobile.png') });
    check('ページエラーなし（スマホ）', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  await browser.close(); server.close();
  const ng = results.filter(r => !r.ok);
  console.log(`\n${results.length - ng.length}/${results.length} PASS`);
  process.exit(ng.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
