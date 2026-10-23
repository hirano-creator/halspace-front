/* ファイル詳細画面の「注釈を書き込む」で、図面と右パネルの場所に注釈メニューが出る（annotate.html?embed=1）E2E
   バックエンドなし・APIモック。サーバーはこのスクリプトが立てる。SHOT=1 で shots/embed-*.png

   確認すること:
   - ヘッダーが目的別ボタン → 注釈の操作（元に戻す・やり直し・ページ送り・その他・やめる）に替わる
   - 右パネルの幅がファイル詳細画面の右カラムと同じ（切り替えで図面が動かない）
   - 道具ごとに右パネルの中身が切り替わる（文字＝色・文字 / ペン＝色・太さ / 四角＝＋塗りつぶし / スタンプ）
   - 文字サイズの数値（小中大・−／＋・直接入力でボタンの選択が追従）、揃え、フォント・太字
   - ヘッダーの元に戻す・ページ送りが注釈画面に効き、状態がヘッダーに返ってくる
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

  /* 3ページの横長PDF */
  const gen = await browser.newPage();
  await gen.goto('about:blank');
  await gen.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js' });
  const pdfB64 = await gen.evaluate(async () => {
    const doc = await PDFLib.PDFDocument.create();
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    for (let i = 1; i <= 3; i++) {
      const p = doc.addPage([842, 595]);
      p.drawRectangle({ x: 20, y: 20, width: 802, height: 555, borderWidth: 1.5, borderColor: PDFLib.rgb(0, 0, 0) });
      p.drawCircle({ x: 300, y: 320, size: 140, borderWidth: 1.5, borderColor: PDFLib.rgb(0, 0, 0) });
      p.drawText(`5K0-02362 SHEET ${i}`, { x: 600, y: 40, size: 18, font });
    }
    const bytes = await doc.save();
    let s = ''; bytes.forEach(b => s += String.fromCharCode(b));
    return btoa(s);
  });
  await gen.close();
  const PDF = Buffer.from(pdfB64, 'base64');

  async function open(viewport) {
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
    await page.route('**/api/wn/**', r => {
      const u = r.request().url(), m = r.request().method();
      if (/\/thumb/.test(u)) return r.fulfill({ status: 404, body: '' });
      if (/public-view/.test(u)) return r.fulfill({ contentType: 'application/pdf', body: PDF });
      if (/\/wn\/files\/[12]\/view/.test(u)) return r.fulfill({ json: { url: `http://127.0.0.1:${PORT}/__pdf` } });
      if (m === 'POST' && /\/wn\/files(\?|$)/.test(u)) { uploads.push(u); return r.fulfill({ json: { data: { ...FILE, id: 2, version: 2, updated_at: '2026-10-24T00:00:00Z' } } }); }
      if (/\/wn\/files\/1(\?|$)/.test(u)) return r.fulfill({ json: { data: FILE } });
      if (/\/wn\/files\/2(\?|$)/.test(u)) return r.fulfill({ json: { data: { ...FILE, id: 2, version: 2 } } });
      return r.fulfill({ json: { data: [] } });
    });
    await page.route('**/__pdf', r => r.fulfill({ contentType: 'application/pdf', body: PDF }));
    await page.goto(`${BASE}/app/file-detail.html?id=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('annotateBtn')?.style.display !== 'none'
      && document.getElementById('topFileName').textContent.length > 0, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    return { ctx, page, errors, uploads };
  }

  async function enterAnnot(page) {
    await page.click('[data-tip="注釈・変換・印刷"]');
    await page.click('#annotateBtn');
    const frame = page.frameLocator('#fdAnnotFrame');
    await page.waitForFunction(() => {
      const w = document.getElementById('fdAnnotFrame').contentWindow;
      return w && w.document.getElementById('loadingOverlay')?.classList.contains('hidden') && w.annotCanvas?.width > 0;
    }, null, { timeout: 20000 });
    await page.waitForTimeout(500);
    return frame;
  }
  const fw = page => page.frame({ url: /annotate\.html/ });

  async function dragCanvas(page, fx1, fy1, fx2, fy2) {
    const b = await page.frameLocator('#fdAnnotFrame').locator('#annotCanvas').boundingBox();
    await page.mouse.move(b.x + b.width * fx1, b.y + b.height * fy1);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + b.width * (fx1 + (fx2 - fx1) * i / 8), b.y + b.height * (fy1 + (fy2 - fy1) * i / 8));
    await page.mouse.up();
  }

  /* ════ 1. PC 1440px：注釈モードに入る ════ */
  const { ctx, page, errors, uploads } = await open({ width: 1440, height: 900 });
  const rightW = await page.evaluate(() => document.querySelector('.detail-right').getBoundingClientRect().width);
  const frame = await enterAnnot(page);
  const f = await fw(page);
  {
    const st = await page.evaluate(() => ({
      annot: document.body.classList.contains('fd-annot'),
      intent: getComputedStyle(document.querySelector('.fd-intent')).display,
      util: getComputedStyle(document.querySelector('.fd-util')).display,
      bar: getComputedStyle(document.getElementById('fdAnnotBar')).display,
      page: document.getElementById('fdAnnotPage').textContent,
      pager: document.getElementById('fdAnnotPager').hidden,
      clearAll: document.getElementById('fdAnnotClearAll').hidden,
      undo: document.getElementById('fdAnnotUndo').disabled,
      title: document.getElementById('topFileName').textContent,
    }));
    check('注釈モードになる', st.annot);
    check('目的別ボタン・いいね・その他が隠れる', st.intent === 'none' && st.util === 'none', `${st.intent}/${st.util}`);
    check('ヘッダーに注釈の操作が出る', st.bar === 'flex');
    check('タイトルはそのまま', st.title.includes('加工指示書'), st.title);
    check('複数ページなのでページ送り 1 / 3 と全ページ消去が出る', !st.pager && st.page === '1 / 3' && !st.clearAll, `${st.page}`);
    check('最初は元に戻せない', st.undo);

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

  /* ════ 2. 道具ごとの右パネルの中身 ════ */
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
    await f.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Escape');
    await frame.locator('#ePanel [data-tool="eraser"]').click();
    check('消しゴムは説明だけ', (await vis()) === '' && (await f.textContent('#ePanel .ctx-hint')).includes('消したい'));
    await frame.locator('#ePanel [data-tool="text"]').click();
  }

  /* ════ 3. 文字サイズ・揃え・フォント ════ */
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

  /* ════ 4. ヘッダーの元に戻す・ページ送り ════ */
  {
    await frame.locator('#ePanel [data-tool="rect"]').click();
    await dragCanvas(page, 0.3, 0.3, 0.6, 0.6);
    await page.waitForTimeout(200);
    check('書くとヘッダーの「元に戻す」が押せる', !(await page.isDisabled('#fdAnnotUndo')));
    await page.click('#fdAnnotUndo');
    check('ヘッダーの「元に戻す」で消える', await f.evaluate(() => annotations.length === 0));
    check('やり直しが押せるようになる', !(await page.isDisabled('#fdAnnotRedo')));
    await page.click('#fdAnnotRedo');
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
    await page.click('#fdAnnotNext');
    await page.waitForFunction(() => document.getElementById('fdAnnotPage').textContent === '2 / 3', null, { timeout: 5000 }).catch(() => {});
    check('ヘッダーのページ送りで 2 / 3', (await page.textContent('#fdAnnotPage')) === '2 / 3', await page.textContent('#fdAnnotPage'));
    await page.click('#fdAnnotPrev');
    await page.waitForTimeout(300);
  }

  /* ════ 5. やめる（書きかけあり） ════ */
  {
    let asked = '';
    page.once('dialog', d => { asked = d.message(); d.dismiss(); });
    await page.click('#fdAnnotQuit');
    await page.waitForTimeout(200);
    check('書きかけで「やめる」と確認が出る', asked.includes('保存していない'), asked);
    check('キャンセルすれば注釈モードのまま', await page.evaluate(() => document.body.classList.contains('fd-annot')));
  }

  /* ════ 6. 保存 → 新バージョンで開き直す ════ */
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

  /* ════ 7. 書きかけなしの「やめる」・幅1180px ════ */
  {
    const { ctx, page, errors } = await open({ width: 1180, height: 820 });
    const rw = await page.evaluate(() => document.querySelector('.detail-right').getBoundingClientRect().width);
    await enterAnnot(page);
    const f = await fw(page);
    const pw = await f.evaluate(() => document.getElementById('ePanel').getBoundingClientRect().width);
    check('1180px でも右パネルの幅が右カラムと同じ', Math.round(pw) === Math.round(rw), `${pw} vs ${rw}`);
    const scroll = await f.evaluate(() => { const s = document.querySelector('.ep-scroll'); return s.scrollWidth <= s.clientWidth; });
    check('1180px で右パネルが横にはみ出さない', scroll);
    if (SHOT) await page.screenshot({ path: path.join(SHOTS, 'embed-1180.png') });
    let asked = false;
    page.once('dialog', d => { asked = true; d.accept(); });
    await page.click('#fdAnnotQuit');
    await page.waitForTimeout(200);
    check('書きかけなしなら確認なしで戻る', !asked && await page.evaluate(() => !document.body.classList.contains('fd-annot')
      && document.getElementById('fdAnnotFrame').hidden && getComputedStyle(document.querySelector('.fd-intent')).display !== 'none'));
    check('ページエラーなし（1180px）', errors.length === 0, errors.join(' / '));
    await ctx.close();
  }

  /* ════ 8. スマホ幅は注釈編集画面へ移る ════ */
  {
    const { ctx, page } = await open({ width: 390, height: 844 });
    await page.click('[data-tip="注釈・変換・印刷"]');
    await page.click('#annotateBtn');
    await page.waitForURL(/annotate\.html/, { timeout: 10000 }).catch(() => {});
    check('スマホ幅は annotate.html へ移る', /annotate\.html\?id=1&from=file-detail\.html$/.test(page.url()), page.url());
    await ctx.close();
  }

  /* ════ 9. 単独の注釈編集画面は従来のまま ════ */
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
    }));
    check('単独画面は埋め込み扱いにならない', !st.embed && st.panel === 'none' && st.rail !== 'none', JSON.stringify(st));
    check('単独画面の設定帯・保存ボタンは元の場所のまま', st.ctxColor && st.save);
    await ctx.close();
  }

  await browser.close();
  server.close();
  const fail = results.filter(r => !r.ok);
  console.log(`\n${results.length - fail.length}/${results.length} PASS`);
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
