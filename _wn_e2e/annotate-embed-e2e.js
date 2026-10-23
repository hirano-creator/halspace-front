/* ファイル詳細画面の「注釈を書き込む」で、右パネルが注釈メニューに替わる（annotate.html?embed=1）E2E
   バックエンドなし・APIモック。サーバーはこのスクリプトが立てる。SHOT=1 で shots/embed-*.png

   確認すること:
   - 変わるのは右パネルだけ：ヘッダーはそのまま、図面は同じ位置・同じ大きさ・同じ背景で描かれる（1ページのPDF）
   - 図面の準備ができるまでは元の画面のまま、右パネルの場所に「準備中」
   - 元に戻す・やり直し・ページ送り・その他・やめる は注釈メニューの上部にある
   - 右パネルの幅がファイル詳細画面の右カラムと同じ
   - 道具ごとに右パネルの中身が切り替わる（文字＝色・文字 / ペン＝色・太さ / 四角＝＋塗りつぶし / スタンプ）
   - 文字サイズの数値（小中大・−／＋・直接入力でボタンの選択が追従）、揃え、フォント・太字
   - 書きかけで「やめる」と確認が出る。保存すると新しいファイルで詳細画面を開き直す
   - スマホ幅はこれまで通り注釈編集画面へ移る。単独の注釈編集画面は従来のレイアウトのまま */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8797;
const BASE = `http://127.0.0.1:${PORT}/whatsno`;
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const SHOT = !!process.env.SHOT;

const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
               '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml',
               '.png':'image/png', '.json':'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404); return res.end('nf');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

const FILE = {
  id: 1, file_name: '5K0-02362-00_加工指示書.pdf', mime_type: 'application/pdf', file_size: 250000,
  version: 1, created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-16T00:00:00Z',
  uploader: { id: 1, name: '平野' }, tags: [], like_count: 0, liked: false, view_count: 1,
  visibility: 'private', can_edit: true,
};

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  /* 横長PDF（3ページと1ページ） */
  const gen = await browser.newPage();
  await gen.goto('about:blank');
  await gen.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js' });
  const mkPdf = n => gen.evaluate(async n => {
    const doc = await PDFLib.PDFDocument.create();
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    for (let i = 1; i <= n; i++) {
      const p = doc.addPage([842, 595]);
      p.drawRectangle({ x: 20, y: 20, width: 802, height: 555, borderWidth: 1.5, borderColor: PDFLib.rgb(0, 0, 0) });
      p.drawCircle({ x: 300, y: 320, size: 140, borderWidth: 1.5, borderColor: PDFLib.rgb(0, 0, 0) });
      p.drawText(`5K0-02362 SHEET ${i}`, { x: 600, y: 40, size: 18, font });
    }
    const bytes = await doc.save();
    let s = ''; bytes.forEach(b => s += String.fromCharCode(b));
    return btoa(s);
  }, n);
  const PDF  = Buffer.from(await mkPdf(3), 'base64');
  const PDF1 = Buffer.from(await mkPdf(1), 'base64');
  await gen.close();

  /* delay: 開いた後の PDF の配信を遅らせる（準備中の表示を見るため） */
  async function open(viewport, pdf = PDF, delay = 0) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport });
    await ctx.addInitScript(() => {
      const u = JSON.stringify({ id: 1, name: '平野', role: 'admin', email: 't@example.com', company_id: 1,
        wn_extended_options_enabled: true, apps: ['whatsno', 'solid'] });
      sessionStorage.setItem('space_token', 'mock-token-e2e');
      sessionStorage.setItem('space_user', u);
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const uploads = [];
    const state = { delay: 0 };
    const sendPdf = async r => {
      if (state.delay) await new Promise(x => setTimeout(x, state.delay));
      r.fulfill({ contentType: 'application/pdf', body: pdf });
    };
    await page.route('**/api/wn/**', r => {
      const u = r.request().url(), m = r.request().method();
      if (/\/thumb/.test(u)) return r.fulfill({ status: 404, body: '' });
      if (/public-view/.test(u)) return sendPdf(r);
      if (/\/wn\/files\/[12]\/view/.test(u)) return r.fulfill({ json: { url: `http://127.0.0.1:${PORT}/__pdf` } });
      if (m === 'POST' && /\/wn\/files(\?|$)/.test(u)) { uploads.push(u); return r.fulfill({ json: { data: { ...FILE, id: 2, version: 2, updated_at: '2026-10-24T00:00:00Z' } } }); }
      if (/\/wn\/files\/1(\?|$)/.test(u)) return r.fulfill({ json: { data: FILE } });
      if (/\/wn\/files\/2(\?|$)/.test(u)) return r.fulfill({ json: { data: { ...FILE, id: 2, version: 2 } } });
      return r.fulfill({ json: { data: [] } });
    });
    await page.route('**/__pdf', sendPdf);
    await page.goto(`${BASE}/app/file-detail.html?id=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('annotateBtn')?.style.display !== 'none'
      && document.getElementById('topFileName').textContent.length > 0, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    state.delay = delay;
    return { ctx, page, errors, uploads };
  }

  async function clickAnnotate(page) {
    await page.click('[data-tip="注釈・変換・印刷"]');
    await page.click('#annotateBtn');
  }
  async function enterAnnot(page) {
    await clickAnnotate(page);
    await page.waitForFunction(() => document.body.classList.contains('fd-annot-ready'), null, { timeout: 20000 });
    await page.waitForTimeout(500);
    return page.frameLocator('#fdAnnotFrame');
  }
  const fw = page => page.frame({ url: /annotate\.html/ });

  async function dragCanvas(page, fx1, fy1, fx2, fy2) {
    const b = await page.frameLocator('#fdAnnotFrame').locator('#annotCanvas').boundingBox();
    await page.mouse.move(b.x + b.width * fx1, b.y + b.height * fy1);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + b.width * (fx1 + (fx2 - fx1) * i / 8), b.y + b.height * (fy1 + (fy2 - fy1) * i / 8));
    await page.mouse.up();
  }

  /* ════ 1. 1ページPDF：図面は同じ位置・同じ大きさのまま、右パネルだけが替わる ════ */
  {
    const { ctx, page, errors } = await open({ width: 1440, height: 900 }, PDF1, 1500);
    await page.waitForFunction(() => document.getElementById('pdfCanvas')?.getBoundingClientRect().width > 0, null, { timeout: 15000 });
    await page.waitForTimeout(800);
    const before = await page.evaluate(() => {
      const c = document.getElementById('pdfCanvas').getBoundingClientRect();
      const a = document.getElementById('previewArea').getBoundingClientRect();
      return { c: [c.left, c.top, c.width, c.height], a: [a.left, a.top, a.width, a.height],
               bg: getComputedStyle(document.getElementById('pdfContainer')).backgroundColor };
    });
    await clickAnnotate(page);
    await page.waitForTimeout(300);
    const waiting = await page.evaluate(() => {
      const w = document.getElementById('fdAnnotWait').getBoundingClientRect();
      const card = document.querySelector('.detail-right .fd-card').getBoundingClientRect();
      return {
        wait: getComputedStyle(document.getElementById('fdAnnotWait')).display,
        left: getComputedStyle(document.querySelector('.detail-left')).visibility,
        frame: getComputedStyle(document.getElementById('fdAnnotFrame')).visibility,
        sameX: Math.abs(w.left - card.left) <= 1 && Math.abs(w.right - card.right) <= 1,
      };
    });
    check('準備中は図面がそのまま見え、右パネルの場所に「準備中」', waiting.wait === 'flex' && waiting.left === 'visible' && waiting.frame === 'hidden', JSON.stringify(waiting));
    check('「準備中」は右カラムのカードと同じ幅', waiting.sameX);
    if (SHOT) await page.screenshot({ path: path.join(SHOTS, 'embed-wait.png') });
    await page.waitForFunction(() => document.body.classList.contains('fd-annot-ready'), null, { timeout: 20000 });
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => {
      const fr = document.getElementById('fdAnnotFrame');
      const o = fr.getBoundingClientRect();
      const w = fr.contentWindow;
      const c = w.document.getElementById('baseCanvas').getBoundingClientRect();
      const a = w.document.getElementById('canvasArea');
      const ar = a.getBoundingClientRect();
      return { c: [o.left + c.left, o.top + c.top, c.width, c.height], a: [o.left + ar.left, o.top + ar.top, ar.width, ar.height],
               bg: w.getComputedStyle(a).backgroundColor, radius: w.getComputedStyle(a).borderTopRightRadius,
               scrollbar: a.offsetWidth - a.clientWidth,
               intent: getComputedStyle(document.querySelector('.fd-intent')).display,
               util: getComputedStyle(document.querySelector('.fd-util')).display };
    });
    const near = (x, y, t) => x.every((v, i) => Math.abs(v - y[i]) <= t);
    check('ヘッダーはそのまま（目的別ボタン・いいね・その他）', after.intent !== 'none' && after.util !== 'none');
    check('図面の枠が同じ位置・大きさ', near(before.a, after.a, 1), `${before.a.map(Math.round)} → ${after.a.map(Math.round)}`);
    check('図面が同じ位置・大きさで描かれる', near(before.c, after.c, 3), `${before.c.map(Math.round)} → ${after.c.map(Math.round)}`);
    check('図面の背景色が同じ', before.bg === after.bg, `${before.bg} / ${after.bg}`);
    check('図面の右上の角も丸い（スクロールバーが被らない）', after.radius === '14px' && after.scrollbar === 0, `${after.radius} / ${after.scrollbar}`);
    if (SHOT) await page.screenshot({ path: path.join(SHOTS, 'embed-1page.png') });
    check('ページエラーなし（1ページ）', errors.length === 0, errors.join(' / '));
    await ctx.close();
  }

  /* ════ 2. 3ページPDF 1440px：右パネル ════ */
  const { ctx, page, errors, uploads } = await open({ width: 1440, height: 900 });
  const rightW = await page.evaluate(() => document.querySelector('.detail-right').getBoundingClientRect().width);
  const frame = await enterAnnot(page);
  const f = fw(page);
  {
    check('注釈モードになる', await page.evaluate(() => document.body.classList.contains('fd-annot')));
    check('タイトルはそのまま', (await page.textContent('#topFileName')).includes('加工指示書'));
    const bar = await f.evaluate(() => ({
      page: document.getElementById('pageLabel').textContent,
      inBar: ['#undoBtn', '#redoBtn', '.top-pagenav', '.more-wrap'].every(q => document.querySelector('#ePanel .ep-bar ' + q)),
      nav: getComputedStyle(document.querySelector('#ePanel .top-pagenav')).display,
      undo: document.getElementById('undoBtn').disabled,
      quit: !!document.querySelector('#ePanel #epQuit'),
    }));
    check('元に戻す・やり直し・ページ送り・その他・やめる が注釈メニューの上部にある', bar.inBar && bar.quit);
    check('複数ページなのでページ送り 1 / 3 が出る', bar.nav !== 'none' && bar.page === '1 / 3', bar.page);
    check('最初は元に戻せない', bar.undo);

    const lay = await f.evaluate(() => {
      const r = s => document.querySelector(s).getBoundingClientRect();
      const vis = s => getComputedStyle(document.querySelector(s)).display;
      return { panel: r('#ePanel'), area: r('#canvasArea'), strip: r('#pageStrip'), w: innerWidth,
               topbar: vis('.topbar'), rail: vis('#rail'), ctxbar: vis('#ctxBar') };
    });
    check('単独画面のヘッダー・道具レール・設定帯は出ない', lay.topbar === 'none' && lay.rail === 'none' && lay.ctxbar === 'none',
      `${lay.topbar}/${lay.rail}/${lay.ctxbar}`);
    check('右パネルの幅がファイル詳細の右カラムと同じ', Math.round(lay.panel.width) === Math.round(rightW), `${lay.panel.width} vs ${rightW}`);
    check('右パネルが右端に付く', Math.round(lay.panel.right) === lay.w);
    check('ページ一覧が図面の左にある', Math.round(lay.strip.left) === 16 && Math.round(lay.strip.right) === Math.round(lay.area.left),
      `${lay.strip.left}-${lay.strip.right} / ${lay.area.left}`);
    check('図面がパネルの手前で終わる', Math.round(lay.area.right) === Math.round(lay.panel.left));
    if (SHOT) await page.screenshot({ path: path.join(SHOTS, 'embed-text.png') });
  }

  /* ════ 3. 道具ごとの右パネルの中身 ════ */
  {
    const vis = () => f.$$eval('#ePanel [data-sec]', ss => ss.filter(s => !s.hidden).map(s => s.dataset.sec).join(','));
    check('文字は 色・文字', (await vis()) === 'color,text', await vis());
    await frame.locator('#ePanel [data-tool="pen"]').click();
    check('ペンは 色・太さ', (await vis()) === 'color,width', await vis());
    await frame.locator('#ePanel [data-tool="rect"]').click();
    check('四角は 色・太さ・塗りつぶし', (await vis()) === 'color,width,fill', await vis());
    await frame.locator('#ePanel #fillToggle').click();
    check('塗りつぶしを入れられる', await f.evaluate(() => rectFill === true));
    await frame.locator('#ePanel [data-tool="stamp"]').click();
    check('スタンプはスタンプ・署名・押す範囲', (await vis()) === 'place'
      && await f.evaluate(() => document.querySelectorAll('#ePanel #stampPalette .stamp-item').length === 3
        && !!document.querySelector('#ePanel #sigName') && getComputedStyle(document.getElementById('rangeSec')).display !== 'none'),
      await vis());
    if (SHOT) await page.screenshot({ path: path.join(SHOTS, 'embed-stamp.png') });
    await page.keyboard.press('Escape');
    await frame.locator('#ePanel [data-tool="eraser"]').click();
    check('消しゴムは説明だけ', (await vis()) === '' && (await f.textContent('#ePanel .ctx-hint')).includes('消したい'));
    await frame.locator('#ePanel [data-tool="text"]').click();
  }

  /* ════ 4. 文字サイズ・揃え・フォント ════ */
  {
    const st = () => f.evaluate(() => ({
      fs: fontSize, input: document.getElementById('fontSize').value,
      on: [...document.querySelectorAll('#ePanel [data-fpreset]')].filter(b => b.classList.contains('active')).map(b => b.textContent.trim()).join(','),
      align: textAlign, bold: textBold, font: textFontFamily,
      prevAlign: document.getElementById('epPreview').style.textAlign,
    }));
    await frame.locator('#ePanel [data-fpreset="80"]').click();
    let s = await st();
    check('「大」で文字サイズ 80', s.fs === 80 && s.input === '80' && s.on === '大', JSON.stringify(s));
    await frame.locator('#ePanel [data-slot="fontSize"] button').last().click();
    s = await st();
    check('＋で 81、小中大はどれも選ばれない', s.fs === 81 && s.input === '81' && s.on === '', JSON.stringify(s));
    await frame.locator('#ePanel #fontSize').fill('50');
    s = await st();
    check('数値に 50 を入れると「中」が選ばれる', s.fs === 50 && s.on === '中', JSON.stringify(s));
    await frame.locator('#ePanel [data-align="center"]').click();
    await frame.locator('#epBold').click();
    await frame.locator('#epFont').selectOption('serif');
    s = await st();
    check('揃え・太字・フォントが変わる', s.align === 'center' && s.bold && s.font === 'serif' && s.prevAlign === 'center', JSON.stringify(s));
    check('太字ボタンが押された見た目になる', await f.evaluate(() => document.getElementById('epBold').classList.contains('active')));

    const h = await f.evaluate(() => [...document.querySelectorAll('#ePanel [data-sec="text"] .ep-seg, #ePanel #epFont, #ePanel [data-slot="fontSize"]')]
      .map(e => Math.round(e.getBoundingClientRect().height)));
    check('文字欄の操作の高さが揃っている', h.every(v => v === h[0]), JSON.stringify(h));
  }

  /* ════ 5. 元に戻す・選択・ページ送り（注釈メニューの上部） ════ */
  {
    await frame.locator('#ePanel [data-tool="rect"]').click();
    await dragCanvas(page, 0.3, 0.3, 0.6, 0.6);
    await page.waitForTimeout(200);
    check('書くと「元に戻す」が押せる', !(await frame.locator('#undoBtn').isDisabled()));
    await frame.locator('#undoBtn').click();
    check('「元に戻す」で消える', await f.evaluate(() => annotations.length === 0));
    check('やり直しが押せるようになる', !(await frame.locator('#redoBtn').isDisabled()));
    await frame.locator('#redoBtn').click();
    check('やり直しで戻る', await f.evaluate(() => annotations.length === 1));
    await frame.locator('#ePanel [data-tool="select"]').click();
    {
      const b = await frame.locator('#annotCanvas').boundingBox();
      await page.mouse.click(b.x + b.width * 0.3, b.y + b.height * 0.45);
    }
    await page.waitForTimeout(150);
    check('書き込みを選ぶと複製・削除が出る', await f.evaluate(() => selectedIdx === 0
      && !document.querySelector('#ePanel [data-sec="selacts"]').hidden));
    await frame.locator('#epDup').click();
    check('右パネルの「複製」で増える', await f.evaluate(() => annotations.length === 2));
    await frame.locator('#epDel').click();
    check('右パネルの「削除」で減る', await f.evaluate(() => annotations.length === 1));
    await frame.locator('#nextPage').click();
    await f.waitForFunction(() => document.getElementById('pageLabel').textContent === '2 / 3', null, { timeout: 5000 }).catch(() => {});
    check('ページ送りで 2 / 3', (await f.textContent('#pageLabel')) === '2 / 3', await f.textContent('#pageLabel'));
    await frame.locator('#prevPage').click();
    await page.waitForTimeout(300);
  }

  /* ════ 6. やめる（書きかけあり） ════ */
  {
    let asked = '';
    page.once('dialog', d => { asked = d.message(); d.dismiss(); });
    await frame.locator('#epQuit').click();
    await page.waitForTimeout(200);
    check('書きかけで「やめる」と確認が出る', asked.includes('保存していない'), asked);
    check('キャンセルすれば注釈モードのまま', await page.evaluate(() => document.body.classList.contains('fd-annot')));
  }

  /* ════ 7. 保存 → 新バージョンで開き直す ════ */
  {
    await frame.locator('#ePanel #saveBtn').click();
    await page.waitForURL(/file-detail\.html\?id=2/, { timeout: 20000 }).catch(() => {});
    check('保存でアップロードされる', uploads.length === 1, String(uploads.length));
    check('新しいファイルで詳細画面を開き直す', /id=2/.test(page.url()), page.url());
    await page.waitForTimeout(800);
    check('開き直したら注釈モードは終わっている', await page.evaluate(() => !document.body.classList.contains('fd-annot')));
    check('URLから annotated の印が消える', !/annotated/.test(page.url()), page.url());
  }
  check('ページエラーなし（PC）', errors.length === 0, errors.join(' / '));
  await ctx.close();

  /* ════ 8. 書きかけなしの「やめる」・幅1180px ════ */
  {
    const { ctx, page, errors } = await open({ width: 1180, height: 820 });
    const rw = await page.evaluate(() => document.querySelector('.detail-right').getBoundingClientRect().width);
    const frame = await enterAnnot(page);
    const f = fw(page);
    const pw = await f.evaluate(() => document.getElementById('ePanel').getBoundingClientRect().width);
    check('1180px でも右パネルの幅が右カラムと同じ', Math.round(pw) === Math.round(rw), `${pw} vs ${rw}`);
    const fit = await f.evaluate(() => [...document.querySelectorAll('.ep-scroll, .ep-bar, .ep-head')].every(s => s.scrollWidth <= s.clientWidth));
    check('1180px で右パネルが横にはみ出さない', fit);
    if (SHOT) await page.screenshot({ path: path.join(SHOTS, 'embed-1180.png') });
    let asked = false;
    page.once('dialog', d => { asked = true; d.accept(); });
    await frame.locator('#epQuit').click();
    await page.waitForTimeout(200);
    check('書きかけなしなら確認なしで戻る', !asked && await page.evaluate(() => !document.body.classList.contains('fd-annot')
      && document.getElementById('fdAnnotFrame').hidden
      && getComputedStyle(document.querySelector('.detail-left')).visibility === 'visible'));
    check('ページエラーなし（1180px）', errors.length === 0, errors.join(' / '));
    await ctx.close();
  }

  /* ════ 9. スマホ幅は注釈編集画面へ移る ════ */
  {
    const { ctx, page } = await open({ width: 390, height: 844 });
    await clickAnnotate(page);
    await page.waitForURL(/annotate\.html/, { timeout: 10000 }).catch(() => {});
    check('スマホ幅は annotate.html へ移る', /annotate\.html\?id=1&from=file-detail\.html$/.test(page.url()), page.url());
    await ctx.close();
  }

  /* ════ 10. 単独の注釈編集画面は従来のまま ════ */
  {
    const { ctx, page } = await open({ width: 1440, height: 900 });
    await page.goto(`${BASE}/app/annotate.html?id=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('loadingOverlay').classList.contains('hidden') && annotCanvas.width > 0, null, { timeout: 15000 });
    const st = await page.evaluate(() => ({
      embed: document.documentElement.classList.contains('embed'),
      panel: getComputedStyle(document.getElementById('ePanel')).display,
      rail: getComputedStyle(document.getElementById('rail')).display,
      ctxColor: !!document.querySelector('#ctxBar .tool-color-row'),
      save: !!document.querySelector('.topbar #saveSplitWrap'),
      undo: !!document.querySelector('.topbar #undoBtn'),
    }));
    check('単独画面は埋め込み扱いにならない', !st.embed && st.panel === 'none' && st.rail !== 'none', JSON.stringify(st));
    check('単独画面の設定帯・保存・元に戻すは元の場所のまま', st.ctxColor && st.save && st.undo);
    await ctx.close();
  }

  await browser.close();
  server.close();
  const fail = results.filter(r => !r.ok);
  console.log(`\n${results.length - fail.length}/${results.length} PASS`);
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
