/* What'sNo「並べる」機能(align.html)のE2E検証（バックエンドなし・APIモック）
   masonryグリッド(8列)＋クリックで実物大ライトボックスを開く方式 */
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
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1920, height: 1000 } });

  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com' }));
    localStorage.setItem('space_token', 'mock-token-e2e');
    localStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com' }));
  });

  /* テスト画像生成（縦長・横長・正方形をミックスしてmasonryらしさを出す） */
  const genPage = await ctx.newPage();
  await genPage.goto('about:blank');
  const thumbs = await genPage.evaluate(() => {
    const make = (w, h, draw) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      draw(g, w, h);
      return c.toDataURL('image/png').split(',')[1];
    };
    const out = {};
    for (let i = 1; i <= 8; i++) {
      const tall = i % 3 === 0;
      const wide = i % 3 === 1;
      const w = wide ? 400 : 240, h = tall ? 400 : 240;
      out[i] = make(w, h, g => { g.strokeStyle = '#000'; g.lineWidth = 4; g.strokeRect(10, 10, w - 20, h - 20); g.font = '20px sans-serif'; g.fillText('#' + i, 20, 40); });
    }
    return out;
  });
  await genPage.close();
  const thumbBufs = {};
  for (const k of Object.keys(thumbs)) thumbBufs[k] = Buffer.from(thumbs[k], 'base64');

  const makePdf = (stream) => {
    const objs = [];
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
    objs[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R >>';
    objs[4] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    let out = '%PDF-1.4\n';
    const offsets = [];
    for (let i = 1; i <= 4; i++) { offsets[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
    const xrefPos = out.length;
    out += 'xref\n0 5\n0000000000 65535 f \n';
    for (let i = 1; i <= 4; i++) out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    out += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
    return Buffer.from(out, 'latin1');
  };
  const pdfBuf = makePdf('4 w 20 20 200 100 re S');

  const dxfText =
`0
SECTION
2
ENTITIES
0
LINE
8
0
10
0
20
0
30
0
11
100
21
100
31
0
0
ENDSEC
0
EOF
`;

  /* ════ 1. ダッシュボード: 「並べる」ボタンの有効化ロジックと遷移 ════ */
  {
    const page = await ctx.newPage();
    await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
    page.on('pageerror', e => console.log('PAGE ERROR(dashboard):', e.message));
    await page.goto(`${BASE}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    await page.evaluate(() => {
      allFiles = [
        { id: '1', file_name: 'a.pdf', mime_type: 'application/pdf', size: 100, updated_at: '2026-07-01', tags: [] },
        { id: '2', file_name: 'b.png', mime_type: 'image/png', size: 100, updated_at: '2026-07-01', tags: [] },
        { id: '3', file_name: 'c.dxf', mime_type: 'application/dxf', size: 100, updated_at: '2026-07-01', tags: [] },
        { id: '4', file_name: 'd.xlsx', mime_type: 'application/vnd.ms-excel', size: 100, updated_at: '2026-07-01', tags: [] },
      ];
      renderFiles();
    });

    const state = () => page.evaluate(() => ({ disabled: document.getElementById('alignSelBtn').disabled }));
    await page.evaluate(() => { if (!selectMode) toggleSelectMode(); });
    await page.evaluate(() => toggleMergeSelect('1'));
    check('1件選択で並べるボタン無効', (await state()).disabled === true);
    await page.evaluate(() => toggleMergeSelect('2'));
    check('PDF+画像の2件選択で並べるボタン有効(種別混在OK)', (await state()).disabled === false);
    await page.evaluate(() => { toggleMergeSelect('3'); toggleMergeSelect('4'); });
    check('4件・種別混在(pdf/png/dxf/xlsx)でも並べるボタン有効', (await state()).disabled === false);

    await page.evaluate(() => document.getElementById('alignSelBtn').click());
    await page.waitForTimeout(500);
    const url = page.url();
    check('並べるボタンでalign.htmlへ遷移(選択順を維持)',
      url.includes('align.html') && /ids=1[,%2C]2[,%2C]3[,%2C]4/.test(url), url);
    await page.close();
  }

  /* ════ 2. align.html: 8件のグリッドが8列のmasonryで表示される ════ */
  {
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGE ERROR(align):', e.message));
    page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERROR(align):', m.text()); });

    await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
    const ids = [1, 2, 3, 4, 5, 6, 7, 8];
    for (const id of ids) {
      await page.route(`**/api/wn/files/${id}`, r => r.fulfill({ json: { data: { id, file_name: `写真${id}.png`, mime_type: 'image/png', updated_at: '2026-07-01T00:00:00Z' } } }));
      await page.route(`**/api/wn/files/${id}/thumb*`, r => r.fulfill({ contentType: 'image/png', body: thumbBufs[id] }));
      await page.route(`**/api/wn/files/${id}/view`, r => r.fulfill({ json: { url: `http://127.0.0.1:8765/__align_full_${id}.png` } }));
      await page.route(`**/__align_full_${id}.png`, r => r.fulfill({ contentType: 'image/png', body: thumbBufs[id] }));
    }

    await page.goto(`${BASE}/app/align.html?ids=1,2,3,4,5,6,7,8`, { waitUntil: 'domcontentloaded' });
    check('タイトルに件数表示', (await page.evaluate(() => document.getElementById('alignTitle').textContent)).includes('8件'));

    await page.waitForFunction(() => document.querySelectorAll('.align-thumb-wrap img').length === 8, { timeout: 15000 });

    const colTrackCount = await page.evaluate(() =>
      getComputedStyle(document.getElementById('alignGrid')).gridTemplateColumns.split(' ').length);
    check('広い画面(1920px)で8件が7〜8列程度に収まる(auto-fitで実トラック数のみ確保)',
      colTrackCount >= 7 && colTrackCount <= 9, 'tracks=' + colTrackCount);

    const cardCount = await page.evaluate(() => document.querySelectorAll('.align-card').length);
    check('カード数がids数と一致(8)', cardCount === 8, 'count=' + cardCount);

    const badges = await page.evaluate(() => [...document.querySelectorAll('.align-badge')].map(b => b.textContent));
    check('各カードに選択順バッジ(1〜8)が表示される', JSON.stringify(badges) === JSON.stringify(['1','2','3','4','5','6','7','8']), badges.join(','));

    await page.screenshot({ path: path.join(SHOTS, 'align-grid-8col.png') });
    await page.close();
  }

  /* ════ 3. align.html: 少件数(4件)でも画面幅いっぱいに引き伸ばされる(実バグの再発防止)
     報告されたバグ: column-count方式だと件数に関わらず固定8トラックを確保するため、
     4件では左側だけ埋まり右半分が空白のまま・画像もサムネイル並みに小さいままだった。 */
  {
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGE ERROR(align-fullwidth):', e.message));
    await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
    for (const id of [1, 2, 3, 4]) {
      await page.route(`**/api/wn/files/${id}`, r => r.fulfill({ json: { data: { id, file_name: `写真${id}.png`, mime_type: 'image/png', updated_at: '2026-07-01T00:00:00Z' } } }));
      await page.route(`**/api/wn/files/${id}/thumb*`, r => r.fulfill({ contentType: 'image/png', body: thumbBufs[id] }));
    }
    await page.goto(`${BASE}/app/align.html?ids=1,2,3,4`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('.align-thumb-wrap img').length === 4, { timeout: 15000 });
    await page.waitForTimeout(200);

    const fit = await page.evaluate(() => {
      const grid = document.getElementById('alignGrid');
      const cards = [...document.querySelectorAll('.align-card')];
      const gridRect = grid.getBoundingClientRect();
      const lastRect = cards[cards.length - 1].getBoundingClientRect();
      const firstW = cards[0].getBoundingClientRect().width;
      return {
        gridRight: gridRect.right,
        lastCardRight: lastRect.right,
        cardWidth: Math.round(firstW),
      };
    });
    check('4件を1920px幅で表示: 最後のカードが画面右端付近まで届く(右半分が空白のまま残らない)',
      Math.abs(fit.gridRight - fit.lastCardRight) < 5, JSON.stringify(fit));
    check('4件を1920px幅で表示: カード幅が旧サムネイル幅(約224px)より大幅に大きい(実画像サイズに近い)',
      fit.cardWidth > 400, 'cardWidth=' + fit.cardWidth);

    await page.screenshot({ path: path.join(SHOTS, 'align-grid-4col-fullwidth.png') });
    await page.close();
  }

  /* ════ 4. align.html: レスポンシブ(狭い画面では列数が自然に減る) ════ */
  {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 900, height: 800 });
    await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
    for (const id of [1, 2]) {
      await page.route(`**/api/wn/files/${id}`, r => r.fulfill({ json: { data: { id, file_name: `写真${id}.png`, mime_type: 'image/png', updated_at: '2026-07-01T00:00:00Z' } } }));
      await page.route(`**/api/wn/files/${id}/thumb*`, r => r.fulfill({ contentType: 'image/png', body: thumbBufs[id] }));
    }
    await page.goto(`${BASE}/app/align.html?ids=1,2`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('.align-thumb-wrap img').length === 2, { timeout: 15000 });
    await page.waitForTimeout(200);
    const colTracks = await page.evaluate(() =>
      getComputedStyle(document.getElementById('alignGrid')).gridTemplateColumns.split(' ').length);
    check('900px幅では2件がminmax(260px)により2〜3列相当に収まる(auto-fitで自然に縮小)',
      colTracks >= 2 && colTracks <= 3, 'tracks=' + colTracks);
    await page.close();
  }

  /* ════ 4. align.html: カードクリックでライトボックスが開き、実プレビュー(PDF/DXF)が描画される ════ */
  {
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGE ERROR(lightbox):', e.message));
    page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERROR(lightbox):', m.text()); });

    await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
    await page.route('**/api/wn/files/11', r => r.fulfill({ json: { data: { id: 11, file_name: '部品図.pdf', mime_type: 'application/pdf', updated_at: '2026-07-01T00:00:00Z' } } }));
    await page.route('**/api/wn/files/11/thumb*', r => r.fulfill({ contentType: 'image/png', body: thumbBufs[1] }));
    await page.route('**/api/wn/files/11/view', r => r.fulfill({ json: { url: 'http://127.0.0.1:8765/__lb.pdf' } }));
    await page.route('**/__lb.pdf', r => r.fulfill({ contentType: 'application/pdf', body: pdfBuf }));

    await page.route('**/api/wn/files/12', r => r.fulfill({ json: { data: { id: 12, file_name: '図面.dxf', mime_type: 'application/dxf', updated_at: '2026-07-01T00:00:00Z' } } }));
    await page.route('**/api/wn/files/12/thumb*', r => r.fulfill({ contentType: 'image/png', body: thumbBufs[2] }));
    await page.route('**/api/wn/files/12/public-view*', r => r.fulfill({ contentType: 'text/plain', body: dxfText }));

    await page.goto(`${BASE}/app/align.html?ids=11,12`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('.align-thumb-wrap img').length === 2, { timeout: 15000 });

    /* 1件目(PDF)をクリック → ライトボックスが開く */
    await page.click('#alignCard-11');
    await page.waitForFunction(() => document.getElementById('alignLightbox').classList.contains('show'), { timeout: 5000 });
    await page.waitForFunction(() => !!document.querySelector('#lbContentWrap canvas'), { timeout: 15000 });

    const lbPdf = await page.evaluate(() => {
      const c = document.querySelector('#lbContentWrap canvas');
      if (!c) return 'canvasなし';
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 250 && d[i + 3] > 0) return 'ok';
      return '白紙canvas';
    });
    check('ライトボックス: PDFがpdf.js経由で実レンダリングされる', lbPdf === 'ok', lbPdf);
    const lbTitle = await page.evaluate(() => document.getElementById('lbTitle').textContent);
    check('ライトボックスのタイトルがファイル名', lbTitle === '部品図.pdf', lbTitle);
    const counter1 = await page.evaluate(() => document.getElementById('lbCounter').textContent);
    check('カウンターが1/2', counter1 === '1 / 2', counter1);
    await page.screenshot({ path: path.join(SHOTS, 'align-lightbox-pdf.png') });

    /* 次へ→DXF */
    await page.click('#lbNextBtn');
    await page.waitForFunction(() => {
      const wrap = document.querySelector('#lbContentWrap .align-dxf-wrap');
      return !!(wrap && wrap.querySelector('canvas'));
    }, { timeout: 15000 });
    const lbTitle2 = await page.evaluate(() => document.getElementById('lbTitle').textContent);
    check('次へボタンでDXFファイルに切り替わる', lbTitle2 === '図面.dxf', lbTitle2);
    await page.screenshot({ path: path.join(SHOTS, 'align-lightbox-dxf.png') });

    /* 前へで戻る */
    await page.click('#lbPrevBtn');
    await page.waitForTimeout(400);
    const lbTitle3 = await page.evaluate(() => document.getElementById('lbTitle').textContent);
    check('前へボタンで最初のファイルに戻る', lbTitle3 === '部品図.pdf', lbTitle3);

    /* Escで閉じる */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const closed = await page.evaluate(() => !document.getElementById('alignLightbox').classList.contains('show'));
    check('Escキーでライトボックスが閉じる', closed === true);

    await page.close();
  }

  /* ════ 5. align.html: サムネイル取得失敗時はアイコンにフォールバックし、他カードは影響を受けない ════ */
  {
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGE ERROR(align-fail):', e.message));

    await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
    await page.route('**/api/wn/files/21', r => r.fulfill({ status: 404, json: { message: 'not found' } }));
    await page.route('**/api/wn/files/22', r => r.fulfill({ json: { data: { id: 22, file_name: '正常画像.png', mime_type: 'image/png', updated_at: '2026-07-01T00:00:00Z' } } }));
    await page.route('**/api/wn/files/22/thumb*', r => r.fulfill({ contentType: 'image/png', body: thumbBufs[1] }));

    await page.goto(`${BASE}/app/align.html?ids=21,22`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const c21 = document.getElementById('alignThumb-21');
      const c22 = document.getElementById('alignThumb-22');
      return c21 && c21.querySelector('.align-card-error') && c22 && c22.querySelector('img');
    }, { timeout: 15000 });

    const partial = await page.evaluate(() => ({
      errText: document.querySelector('#alignThumb-21 .align-card-error')?.textContent ?? '',
      img22: !!document.querySelector('#alignThumb-22 img'),
    }));
    check('1件失敗しても他カードは正常にサムネイル表示される(部分失敗の分離)',
      partial.errText.length > 0 && partial.img22 === true, JSON.stringify(partial));
    await page.close();
  }

  /* ════ 6. align.html: idsが1件以下なら全体エラー表示 ════ */
  {
    const page = await ctx.newPage();
    await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
    await page.goto(`${BASE}/app/align.html?ids=99`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const fatal = await page.evaluate(() => document.querySelector('.align-error')?.textContent ?? '');
    check('ids1件のみでは全体エラーメッセージを表示', fatal.includes('指定されていません'), fatal.trim());
    await page.close();
  }

  await browser.close();
  const fails = results.filter(r => !r.ok);
  console.log(`\n==== 結果: ${results.length - fails.length}/${results.length} PASS ====`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
