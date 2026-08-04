/* What'sNo「並べる」機能(align.html)のE2E検証（バックエンドなし・APIモック）
   justified layout（行ごとに高さを揃え幅いっぱいに埋める）＋クリックで実物大ライトボックスを開く方式 */
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

/* justified layout の実測: 行ごとに「右端まで届いているか」「行内で下端が揃っているか」を返す。
   この2つが崩れると、カードの右や下に空白（報告された赤丸箇所）が出る。 */
function readAlignRows(page) {
  return page.evaluate(() => {
    const grid = document.getElementById('alignGrid');
    const gRect = grid.getBoundingClientRect();
    return [...grid.querySelectorAll('.align-row')].map(row => {
      const cards = [...row.querySelectorAll('.align-card')];
      const rects = cards.map(c => c.getBoundingClientRect());
      const imgs = cards.map(c => {
        const img = c.querySelector('.align-thumb-wrap img');
        if (!img || !img.naturalWidth) return null;
        const w = c.querySelector('.align-thumb-wrap').getBoundingClientRect();
        return { natural: img.naturalWidth / img.naturalHeight, box: w.width / w.height };
      });
      return {
        count: cards.length,
        gapToRight: Math.round(gRect.right - Math.max(...rects.map(r => r.right))),
        heightSpread: Math.round(Math.max(...rects.map(r => r.height)) - Math.min(...rects.map(r => r.height))),
        bottomSpread: Math.round(Math.max(...rects.map(r => r.bottom)) - Math.min(...rects.map(r => r.bottom))),
        minWidth: Math.round(Math.min(...rects.map(r => r.width))),
        maxWidth: Math.round(Math.max(...rects.map(r => r.width))),
        thumbH: Math.round(row.querySelector('.align-thumb-wrap').getBoundingClientRect().height),
        aspectErr: Math.max(0, ...imgs.filter(Boolean).map(x => Math.abs(x.box - x.natural) / x.natural)),
      };
    });
  });
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

  /* ════ 2. align.html: 8件が縦横比バラバラでも隙間なく並ぶ ════ */
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
    await page.waitForTimeout(300);

    const rows8 = await readAlignRows(page);
    check('8件が複数行のjustified layoutで並ぶ', rows8.length >= 2 && rows8.reduce((s, r) => s + r.count, 0) === 8,
      JSON.stringify(rows8.map(r => r.count)));
    check('どの行も右端まで埋まる(カード右側に空白が残らない)',
      rows8.every(r => r.gapToRight <= 2), JSON.stringify(rows8.map(r => r.gapToRight)));
    check('行内のカード下端が揃う(縦横比の違いでカード下に空白が残らない)',
      rows8.every(r => r.bottomSpread <= 1), JSON.stringify(rows8.map(r => r.bottomSpread)));
    check('サムネイル枠の縦横比が元画像と一致(引き伸ばし・レターボックスなし)',
      rows8.every(r => r.aspectErr < 0.06), JSON.stringify(rows8.map(r => +r.aspectErr.toFixed(3))));

    const cardCount = await page.evaluate(() => document.querySelectorAll('.align-card').length);
    check('カード数がids数と一致(8)', cardCount === 8, 'count=' + cardCount);

    const badges = await page.evaluate(() => [...document.querySelectorAll('.align-badge')].map(b => b.textContent));
    check('各カードに選択順バッジ(1〜8)が表示される', JSON.stringify(badges) === JSON.stringify(['1','2','3','4','5','6','7','8']), badges.join(','));

    await page.screenshot({ path: path.join(SHOTS, 'align-justified-8.png') });
    await page.close();
  }

  /* ════ 3. align.html: 少件数(4件)でも画面いっぱいに大きく表示される(実バグの再発防止)
     報告されたバグ1: column-count方式だと件数に関わらず固定8トラックを確保するため、
     4件では左側だけ埋まり右半分が空白のまま・画像もサムネイル並みに小さいままだった。
     報告されたバグ2: sqrt(件数×アスペクト比)だけで列数を決めると4件で3列を選んでしまい、
     最終行が1件だけ埋まって右側が広く空白のまま残ることがあった（見た目はバグ1と同じ）。
     報告されたバグ3: 列幅を固定するCSS Gridでは、縦長画像と横長画像が同じ行に並ぶと
     行の高さが最も高いカードに合わせて確保され、低いカードの下に空白が残っていた。
     → justified layout により、どの行も右端まで埋まり行内の下端も揃うはず。 */
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

    const rows4 = await readAlignRows(page);
    check('4件を1920px幅で表示: 1件だけ孤立した行を作らない(2件×2行など均等に分ける)',
      rows4.every(r => r.count >= 2), JSON.stringify(rows4.map(r => r.count)));
    check('4件を1920px幅で表示: 最後の行も画面右端まで届く(空白が残らない)',
      rows4.every(r => r.gapToRight <= 2), JSON.stringify(rows4.map(r => r.gapToRight)));
    check('4件を1920px幅で表示: 行内のカード下端が揃う',
      rows4.every(r => r.bottomSpread <= 1), JSON.stringify(rows4.map(r => r.bottomSpread)));
    check('4件を1920px幅で表示: サムネイルが旧グリッド(高さ約200px)より大きく表示される',
      rows4.every(r => r.thumbH > 300), JSON.stringify(rows4.map(r => r.thumbH)));

    await page.screenshot({ path: path.join(SHOTS, 'align-justified-4.png') });
    await page.close();
  }

  /* ════ 4. align.html: レスポンシブ(狭い画面でも件数×アスペクト比から自然な列数になる) ════ */
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
    await page.waitForTimeout(300);
    const rowsNarrow = await readAlignRows(page);
    check('900px幅でも2件が1行に収まり右端まで埋まる',
      rowsNarrow.length === 1 && rowsNarrow[0].count === 2 && rowsNarrow[0].gapToRight <= 2,
      JSON.stringify(rowsNarrow));
    await page.close();
  }

  /* ════ 4b. align.html: 実運用に近い21件（縦長パネル多数＋横長の使用イメージ混在）でも
     すべての行が隙間なく埋まる。報告されたスクリーンショットの再現ケース。 ════ */
  {
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGE ERROR(align-21):', e.message));
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));

    /* 縦長(2:3)・横長(16:9)・正方形を不規則に混ぜる */
    const mixPage = await ctx.newPage();
    await mixPage.goto('about:blank');
    const mix = await mixPage.evaluate(() => {
      const shapes = [[300,450],[480,270],[300,450],[480,270],[400,400],[300,450],[300,450],
                      [480,270],[300,450],[300,450],[480,270],[300,450],[300,450],[300,450],
                      [400,400],[300,450],[300,450],[300,450],[300,450],[480,270],[300,450]];
      return shapes.map(([w, h], i) => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d');
        g.fillStyle = '#eef'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#333'; g.lineWidth = 3; g.strokeRect(6, 6, w - 12, h - 12);
        g.fillStyle = '#000'; g.font = '28px sans-serif'; g.fillText('#' + (i + 1), 16, 40);
        return c.toDataURL('image/png').split(',')[1];
      });
    });
    await mixPage.close();

    const ids21 = mix.map((_, i) => 100 + i);
    for (let k = 0; k < ids21.length; k++) {
      const id = ids21[k];
      const buf = Buffer.from(mix[k], 'base64');
      await page.route(`**/api/wn/files/${id}`, r => r.fulfill({ json: { data: { id, file_name: `p${id}.jpg`, mime_type: 'image/jpeg', updated_at: '2026-07-01T00:00:00Z' } } }));
      await page.route(`**/api/wn/files/${id}/thumb*`, r => r.fulfill({ contentType: 'image/png', body: buf }));
    }

    await page.goto(`${BASE}/app/align.html?ids=${ids21.join(',')}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('.align-thumb-wrap img').length === 21, { timeout: 20000 });
    await page.waitForTimeout(400);

    const rows21 = await readAlignRows(page);
    const total = rows21.reduce((s, r) => s + r.count, 0);
    check('21件(縦長多数＋横長混在)が全件表示される', total === 21, 'total=' + total);
    check('21件: どの行も右端まで埋まる(赤丸で指摘された右側の空白が出ない)',
      rows21.every(r => r.gapToRight <= 2), JSON.stringify(rows21.map(r => r.gapToRight)));
    check('21件: 行内のカード下端が揃う(横長画像の下に空白が出ない)',
      rows21.every(r => r.bottomSpread <= 1), JSON.stringify(rows21.map(r => r.bottomSpread)));
    check('21件: 1行あたりのカード数が下限幅(190px)を割り込まない',
      rows21.every(r => r.minWidth >= 150), JSON.stringify(rows21.map(r => r.minWidth)));

    await page.screenshot({ path: path.join(SHOTS, 'align-justified-21.png'), fullPage: true });

    /* スマホ幅: 1行1枚に落ちて縦に長大化しないこと＋横幅は埋まること */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    const rowsSp = await readAlignRows(page);
    /* 横長画像は1枚で幅いっぱいになるのが正しいので全行2枚は求めない。
       下限幅の設定ミスで「全行1枚(＝ただの縦並び)」に落ちていないことを見る。 */
    check('スマホ幅(390px)でも大半の行が2枚並ぶ(1列になって縦に長くならない)',
      rowsSp.filter(r => r.count >= 2).length >= Math.ceil(rowsSp.length * 0.6),
      JSON.stringify(rowsSp.map(r => r.count)));
    check('スマホ幅でも各行が右端まで埋まる',
      rowsSp.slice(0, -1).every(r => r.gapToRight <= 2), JSON.stringify(rowsSp.map(r => r.gapToRight)));
    await page.screenshot({ path: path.join(SHOTS, 'align-justified-21-sp.png'), fullPage: true });
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
