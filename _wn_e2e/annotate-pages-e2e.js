/* 注釈編集画面（annotate.html）K案レイアウトのE2E検証
   左=道具レール / 上=設定帯 / 右=ページ一覧 / スタンプ・署名の押す範囲（このページ・全ページ・選ぶ）
   バックエンドなし・APIモック。静的サーバー: python -m http.server 8765（my-programmingルート） */
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

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  /* 5ページの横長PDFを pdf-lib で作る */
  const gen = await browser.newPage();
  await gen.goto('about:blank');
  await gen.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js' });
  const pdfB64 = await gen.evaluate(async () => {
    const doc = await PDFLib.PDFDocument.create();
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    for (let i = 1; i <= 5; i++) {
      const p = doc.addPage([842, 595]);
      p.drawRectangle({ x: 20, y: 20, width: 802, height: 555, borderWidth: 1.5, borderColor: PDFLib.rgb(0, 0, 0) });
      p.drawCircle({ x: 300, y: 320, size: 140, borderWidth: 1.5, borderColor: PDFLib.rgb(0, 0, 0) });
      p.drawText(`DR-04 SHEET ${i}`, { x: 620, y: 40, size: 18, font });
    }
    const bytes = await doc.save();
    let s = ''; bytes.forEach(b => s += String.fromCharCode(b));
    return btoa(s);
  });
  await gen.close();
  const pdfBuf = Buffer.from(pdfB64, 'base64');

  async function openPage(viewport, file = { id: 55, file_name: 'DR-04_組図一式.pdf', mime_type: 'application/pdf' }, body = pdfBuf) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport });
    await ctx.addInitScript(() => {
      const u = JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com', company_id: 1, wn_extended_options_enabled: true });
      sessionStorage.setItem('space_token', 'mock-token-e2e');
      sessionStorage.setItem('space_user', u);
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const uploads = [];
    await page.route('**/api/wn/**', async r => {
      const u = r.request().url();
      const m = r.request().method();
      if (/public-view/.test(u)) return r.fulfill({ contentType: file.mime_type, body });
      if (m === 'POST' && /\/wn\/files(\?|$)/.test(u)) { uploads.push(u); return r.fulfill({ json: { data: { ...file, id: 56, updated_at: 'x' } } }); }
      if (new RegExp(`/wn/files/${file.id}(\\?|$)`).test(u) || /\/wn\/files\/56(\?|$)/.test(u)) return r.fulfill({ json: { data: file } });
      return r.fulfill({ json: { data: [] } });
    });
    await page.goto(`${BASE}/app/annotate.html?id=${file.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('loadingOverlay').classList.contains('hidden') && annotCanvas.width > 0, null, { timeout: 15000 });
    await page.waitForTimeout(400);
    return { ctx, page, errors, uploads };
  }

  /* キャンバス上の相対位置をクリック／ドラッグ */
  async function canvasBox(page) { return page.locator('#annotCanvas').boundingBox(); }
  async function clickCanvas(page, fx, fy) {
    const b = await canvasBox(page);
    await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
  }
  async function dragCanvas(page, fx1, fy1, fx2, fy2) {
    const b = await canvasBox(page);
    await page.mouse.move(b.x + b.width * fx1, b.y + b.height * fy1);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + b.width * (fx1 + (fx2 - fx1) * i / 8), b.y + b.height * (fy1 + (fy2 - fy1) * i / 8));
    await page.mouse.up();
  }

  /* ════ 1. PC：骨組み（左レール・設定帯・右ページ一覧） ════ */
  const { ctx, page, errors, uploads } = await openPage({ width: 1440, height: 900 });
  {
    const lay = await page.evaluate(() => {
      const r = s => document.querySelector(s).getBoundingClientRect();
      return {
        rail: r('#rail'), ctx: r('#ctxBar'), strip: r('#pageStrip'), area: r('#canvasArea'),
        hasPages: document.body.classList.contains('has-pages'),
        items: document.querySelectorAll('#psList .ps-item').length,
        oldPanel: !!document.getElementById('toolbar'),
        sub: document.getElementById('topSub').textContent,
        label: document.getElementById('pageLabel').textContent,
      };
    });
    check('複数ページPDFでページ一覧モードになる', lay.hasPages);
    check('右パネル(#toolbar)は無くなっている', !lay.oldPanel);
    check('道具レールが左端・幅62px', lay.rail.left === 0 && Math.round(lay.rail.width) === 62, JSON.stringify(lay.rail));
    check('ページ一覧が右端にある', Math.round(lay.strip.right) === 1440 && Math.round(lay.strip.width) === 176, JSON.stringify(lay.strip));
    check('図面エリアがレールとページ一覧の間に収まる', Math.round(lay.area.left) === 62 && Math.round(lay.area.right) === 1440 - 176, `${lay.area.left}-${lay.area.right}`);
    check('設定帯が上のバーの下にある', Math.round(lay.ctx.top) === 52 && Math.round(lay.ctx.height) === 50);
    check('ページ一覧に5ページ並ぶ', lay.items === 5, String(lay.items));
    check('上のバーにページ送り 1 / 5', lay.label === '1 / 5', lay.label);
    check('上のバーにページ数の要約', /5ページ/.test(lay.sub), lay.sub);

    await page.waitForTimeout(1200);
    const thumbs = await page.$$eval('#psList .ps-item canvas', cs => cs.map(c => c.width));
    check('ページ一覧のサムネが描かれる', thumbs.filter(w => w > 0).length >= 3, JSON.stringify(thumbs));
  }

  /* ════ 2. 設定帯：道具ごとに中身が切り替わる ════ */
  {
    const vis = async () => page.$$eval('#ctxBar [data-sec]', ss => ss.filter(s => !s.hidden).map(s => s.dataset.sec).join(','));
    check('初期（文字）は 色・文字 の設定', (await vis()) === 'color,text', await vis());
    await page.keyboard.press('p');
    check('ペン(P)は 色・太さ', (await vis()) === 'color,width', await vis());
    await page.keyboard.press('r');
    check('四角(R)は 色・太さ・塗りつぶし', (await vis()) === 'color,width,fill', await vis());
    await page.keyboard.press('e');
    check('消しゴム(E)は設定なし＋ヒント', (await vis()) === '' && (await page.textContent('#ctxHint')).includes('消したい'), await vis());
    await page.keyboard.press('p');
    await page.click('[data-wpreset="2"]');
    const ss = await page.evaluate(() => [strokeSize, document.getElementById('strokeSize').value, document.querySelector('[data-wpreset="2"]').classList.contains('active')]);
    check('「太」を押すとペンの太さ20になり強調される', ss[0] === 20 && ss[1] === '20' && ss[2], JSON.stringify(ss));
  }

  /* ════ 3. ペンとマーカー → ページ一覧のバッジ ════ */
  {
    await dragCanvas(page, 0.2, 0.2, 0.4, 0.3);
    await page.keyboard.press('h');
    await dragCanvas(page, 0.2, 0.6, 0.5, 0.6);
    const st = await page.evaluate(() => annotations.map(a => ({ t: a.type, o: a.opacity || 0 })));
    check('ペンとマーカーで2つ描ける', st.length === 2, JSON.stringify(st));
    check('マーカーは半透明のペン', st[1] && st[1].t === 'pen' && st[1].o > 0 && st[1].o < 1, JSON.stringify(st[1]));
    await page.waitForTimeout(500);
    const badge = await page.$eval('#psList .ps-item[data-page="1"] .ps-badge', el => [el.textContent, getComputedStyle(el).display]);
    check('1ページ目に注釈件数バッジ 2', badge[0] === '2' && badge[1] !== 'none', JSON.stringify(badge));
  }

  /* ════ 4. スタンプ：全ページに押す → 元に戻す ════ */
  {
    await page.keyboard.press('s');
    const open = await page.$eval('#stampFly', el => el.classList.contains('open'));
    check('S でスタンプ・署名の吹き出しが開く', open);
    check('押す範囲の選択が出る（複数ページ）', await page.isVisible('#rangeSeg'));
    check('既定で「承認済み」が選ばれている', /承認済み/.test(await page.textContent('#placeInfo')), await page.textContent('#placeInfo'));
    await page.click('#rangeSeg [data-range="all"]');
    await page.screenshot({ path: path.join(SHOTS, 'annotate-k-stamp-all.png') });
    await clickCanvas(page, 0.8, 0.75);
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const per = [];
      for (let n = 1; n <= 5; n++) per.push(pageAnnots(n).filter(a => a.type === 'stamp').length);
      return { per, tool, marked: [...document.querySelectorAll('#psList .ps-item.has-stamp')].length };
    });
    check('全5ページにスタンプが1つずつ押される', JSON.stringify(r.per) === '[1,1,1,1,1]', JSON.stringify(r.per));
    check('押したあとは選択モードに戻る', r.tool === 'select', r.tool);
    check('ページ一覧の全ページにスタンプ印', r.marked === 5, String(r.marked));

    /* もう一度「全ページ」で押しても二重にならない */
    await page.keyboard.press('s');
    await page.click('#rangeSeg [data-range="all"]');
    await clickCanvas(page, 0.6, 0.75);
    await page.waitForTimeout(400);
    const per2 = await page.evaluate(() => [1,2,3,4,5].map(n => pageAnnots(n).filter(a => a.type === 'stamp').length));
    check('同じスタンプがあるページは飛ばす', JSON.stringify(per2) === '[1,1,1,1,1]', JSON.stringify(per2));

    /* 1回目の一括押印をトーストの「元に戻す」で取り消す（最初のトーストのボタン） */
    const btns = page.locator('#toastContainer button', { hasText: '元に戻す' });
    const cnt = await btns.count();
    if (cnt) await btns.first().click();
    await page.waitForTimeout(300);
    const per3 = await page.evaluate(() => [1,2,3,4,5].map(n => pageAnnots(n).filter(a => a.type === 'stamp').length));
    check('トーストの「元に戻す」で全ページ分が消える', cnt > 0 && JSON.stringify(per3) === '[0,0,0,0,0]', `${cnt} ${JSON.stringify(per3)}`);
  }

  /* ════ 5. 「選ぶ」：ページ一覧で 2・4 を選んで押す ════ */
  {
    await page.keyboard.press('s');
    await page.click('#rangeSeg [data-range="pick"]');
    const chk = await page.$eval('#psList .ps-item .ps-check', el => getComputedStyle(el).display);
    check('「選ぶ」でページ一覧にチェック欄が出る', chk === 'flex', chk);
    await page.click('#psList .ps-item[data-page="1"]');   /* 既定で入っている今のページを外す */
    await page.click('#psList .ps-item[data-page="2"]');
    await page.click('#psList .ps-item[data-page="4"]');
    const info = await page.textContent('#placeInfo');
    check('設定帯に選んだページが出る', /2ページ：2・4/.test(info), info);
    await clickCanvas(page, 0.8, 0.75);
    await page.waitForTimeout(500);
    const per = await page.evaluate(() => [1,2,3,4,5].map(n => pageAnnots(n).filter(a => a.type === 'stamp').length));
    check('選んだ 2・4 ページだけに押される', JSON.stringify(per) === '[0,1,0,1,0]', JSON.stringify(per));
  }

  /* ════ 6. 保存メニューの押し忘れ通知 → まとめて押す ════ */
  {
    await page.click('#saveDropBtn');
    const warn = await page.evaluate(() => [document.getElementById('saveWarn').classList.contains('show'), document.getElementById('saveWarnText').textContent]);
    check('押し忘れ通知に 1・3・5 が出る', warn[0] && /1・3・5/.test(warn[1]), JSON.stringify(warn));
    await page.screenshot({ path: path.join(SHOTS, 'annotate-k-save-warn.png') });
    await page.click('#saveWarnBtn');
    const st = await page.evaluate(() => ({ tool, placeRange, picked: [...pickedPages].sort() }));
    check('「まとめて押す」で押していないページが選ばれる', st.tool === 'stamp' && st.placeRange === 'pick' && JSON.stringify(st.picked) === '[1,3,5]', JSON.stringify(st));
    /* 右下のトースト（元に戻す付き）に重ならない位置をクリック */
    await clickCanvas(page, 0.6, 0.3);
    await page.waitForTimeout(500);
    const per = await page.evaluate(() => [1,2,3,4,5].map(n => pageAnnots(n).filter(a => a.type === 'stamp').length));
    check('残りのページにも押されて全ページ揃う', JSON.stringify(per) === '[1,1,1,1,1]', JSON.stringify(per));
  }

  /* ════ 7. ページ移動（PageDown・ページ一覧クリック）と元に戻すの独立 ════ */
  {
    await page.keyboard.press('Escape');
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(800);
    const s = await page.evaluate(() => ({ cur: currentPage, label: document.getElementById('pageLabel').textContent,
      active: document.querySelector('#psList .ps-item.active')?.dataset.page, n: annotations.length }));
    check('PageDown で2ページ目へ', s.cur === 2 && s.label === '2 / 5' && s.active === '2', JSON.stringify(s));
    check('2ページ目の注釈（スタンプ1つ）が表示される', s.n === 1, String(s.n));
    await page.click('#psList .ps-item[data-page="1"]');
    await page.waitForTimeout(800);
    const n1 = await page.evaluate(() => [currentPage, annotations.length]);
    check('ページ一覧クリックで1ページ目へ戻る（ペン・マーカー・スタンプの3つ）', n1[0] === 1 && n1[1] === 3, JSON.stringify(n1));
  }

  /* ════ 8. 署名を押す（入力 → 選択 → クリック） ════ */
  {
    await page.keyboard.press('s');
    await page.fill('#sigDate', '2026/10/18');
    await page.fill('#sigCompany', '株式会社テスト');
    await page.fill('#sigName', '山田');
    await page.click('#signatureDragItem');
    await page.click('#rangeSeg [data-range="one"]');
    await clickCanvas(page, 0.3, 0.85);
    await page.waitForTimeout(300);
    const sig = await page.evaluate(() => annotations.filter(a => a.sig).map(a => a.text));
    check('署名が3行の文字として置かれる', sig.length === 1 && sig[0] === '2026/10/18\n株式会社テスト\n山田', JSON.stringify(sig));
  }

  /* ════ 9. 保存（全ページ分を焼き込んでアップロード） ════ */
  {
    await page.screenshot({ path: path.join(SHOTS, 'annotate-k-desktop.png') });
    await page.click('#saveBtn');
    for (let i = 0; i < 60 && !uploads.length; i++) await page.waitForTimeout(200);
    check('保存でアップロードされる', uploads.length === 1, String(uploads.length));
    check('PCでJSエラーなし', errors.length === 0, errors.join(' | '));
  }
  await ctx.close();

  /* ════ 10. スマホ：レールは下・ページ一覧は隠す・横スクロールなし ════ */
  {
    const m = await openPage({ width: 390, height: 844 });
    const lay = await m.page.evaluate(() => {
      const r = s => document.querySelector(s).getBoundingClientRect();
      return { rail: r('#rail'), strip: getComputedStyle(document.getElementById('pageStrip')).display,
        nav: getComputedStyle(document.querySelector('.top-pagenav')).display,
        area: r('#canvasArea'), sw: document.documentElement.scrollWidth };
    });
    check('スマホ：道具レールが画面下', Math.round(lay.rail.bottom) === 844 && Math.round(lay.rail.height) === 60, JSON.stringify(lay.rail));
    check('スマホ：ページ一覧は出さない', lay.strip === 'none', lay.strip);
    check('スマホ：上のバーでページ送りできる', lay.nav === 'flex', lay.nav);
    check('スマホ：図面エリアが全幅', Math.round(lay.area.left) === 0 && Math.round(lay.area.right) === 390, `${lay.area.left}-${lay.area.right}`);
    check('スマホ：横にはみ出さない', lay.sw <= 390, String(lay.sw));
    await m.page.keyboard.press('s');
    const fly = await m.page.$eval('#stampFly', el => { const r = el.getBoundingClientRect(); return [r.left, r.right, r.bottom]; });
    check('スマホ：吹き出しは画面幅に収まり、レールの上に出る', fly[0] >= 0 && fly[1] <= 390 && fly[2] <= 844 - 60, JSON.stringify(fly));
    await m.page.screenshot({ path: path.join(SHOTS, 'annotate-k-mobile.png') });
    check('スマホでJSエラーなし', m.errors.length === 0, m.errors.join(' | '));
    await m.ctx.close();
  }

  /* ════ 11. 画像（1枚もの）：ページ一覧も押す範囲も出ない ════ */
  {
    const gp = await browser.newPage();
    const png = Buffer.from(await gp.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 800; c.height = 500;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 800, 500); g.strokeRect(20, 20, 760, 460);
      return c.toDataURL('image/png').split(',')[1];
    }), 'base64');
    await gp.close();
    const im = await openPage({ width: 1280, height: 800 }, { id: 77, file_name: 'photo.png', mime_type: 'image/png' }, png);
    const st = await im.page.evaluate(() => ({ hp: document.body.classList.contains('has-pages'),
      strip: getComputedStyle(document.getElementById('pageStrip')).display,
      range: getComputedStyle(document.getElementById('rangeSec')).display,
      right: document.getElementById('canvasArea').getBoundingClientRect().right }));
    check('画像ではページ一覧を出さない', !st.hp && st.strip === 'none' && Math.round(st.right) === 1280, JSON.stringify(st));
    await im.page.keyboard.press('s');
    check('画像では押す範囲の選択を出さない', st.range === 'none');
    await clickCanvas(im.page, 0.5, 0.5);
    const n = await im.page.evaluate(() => annotations.filter(a => a.type === 'stamp').length);
    check('画像にもクリックでスタンプを押せる', n === 1, String(n));
    check('画像でJSエラーなし', im.errors.length === 0, im.errors.join(' | '));
    await im.ctx.close();
  }

  await browser.close();
  const fail = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - fail}/${results.length} PASS`);
  process.exit(fail ? 1 : 0);
})();
