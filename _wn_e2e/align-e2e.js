/* What'sNo「並べる」機能(align.html)のE2E検証（バックエンドなし・APIモック）
   justified layout（行ごとに高さを揃え幅いっぱいに埋める）＋クリックで実物大ライトボックスを開く方式 */
const { chromium } = require('c:/dev/my-programming/_aa_e2e/node_modules/playwright-core');
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
    /* 行の入れ物は無い（カードを付け替えないため flex-wrap で折り返す）ので、上端の位置で行に分ける */
    const groups = [];
    [...grid.querySelectorAll('.align-card')].forEach(c => {
      const t = Math.round(c.getBoundingClientRect().top);
      const g = groups.find(x => Math.abs(x.top - t) <= 2);
      if (g) g.cards.push(c); else groups.push({ top: t, cards: [c] });
    });
    return groups.map(({ cards }) => {
      const row = cards[0];
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
    sessionStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com', wn_extended_options_enabled: true }));
    localStorage.setItem('space_token', 'mock-token-e2e');
    localStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com', wn_extended_options_enabled: true }));
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

  /* ════ 6. align.html: サーバーにサムネが無い種別(PDF/DXF)もクライアント生成で表示する ════ */
  {
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGE ERROR(align-gen):', e.message));

    const stored = [];
    await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
    await page.route('**/api/wn/files/31', r => r.fulfill({ json: { data: { id: 31, file_name: '部品図.pdf', mime_type: 'application/pdf', updated_at: '2026-07-01T00:00:00Z' } } }));
    await page.route('**/api/wn/files/32', r => r.fulfill({ json: { data: { id: 32, file_name: '図面.dxf', mime_type: 'application/dxf', updated_at: '2026-07-01T00:00:00Z' } } }));
    /* 本番と同じく PDF/DXF のサムネは 404。POST は生成物の保存 */
    await page.route('**/api/wn/files/3*/thumb*', r => {
      const req = r.request();
      if (req.method() === 'POST') {
        stored.push(Number(req.url().match(/\/files\/(\d+)\/thumb/)[1]));
        return r.fulfill({ json: { ok: true } });
      }
      return r.fulfill({ status: 404, json: { message: 'thumbnail not available' } });
    });
    await page.route('**/api/wn/files/31/public-view*', r => r.fulfill({ contentType: 'application/pdf', body: pdfBuf }));
    await page.route('**/api/wn/files/32/public-view*', r => r.fulfill({ contentType: 'text/plain', body: dxfText }));

    await page.goto(`${BASE}/app/align.html?ids=31,32`, { waitUntil: 'domcontentloaded' });
    const gen = await page.waitForFunction(() => {
      const a = document.querySelector('#alignThumb-31 img');
      const b = document.querySelector('#alignThumb-32 img');
      return a && b && a.naturalWidth > 50 && b.naturalWidth > 50;
    }, { timeout: 30000 }).then(() => true).catch(() => false);
    check('サーバーにサムネが無いPDF/DXFでもカードに画像が出る', gen);

    const noPreview = await page.locator('.align-card-noPreview').count();
    check('「プレビューなし」に落ちない', noPreview === 0, `${noPreview}件`);

    await page.waitForTimeout(500);
    check('生成したサムネをサーバーへ保存している', stored.includes(31) && stored.includes(32),
      JSON.stringify(stored));

    await page.screenshot({ path: path.join(SHOTS, 'align-thumb-generated.png'), fullPage: true });
    await page.close();
  }

  /* ════ 6b. align.html: 3D(STL)とPDFはカードの中でそのまま動かせる（静止画で終わらない）
     報告: 並べたときSTLが静止画のまま回せない／PDFがぼやけて拡大・移動ができない ════ */
  {
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGE ERROR(align-live):', e.message));
    await page.setViewportSize({ width: 1600, height: 900 });

    /* 20×20×100 の細長い箱（バイナリSTL） */
    const boxStl = (sx, sy, sz) => {
      const v = [[0,0,0],[sx,0,0],[sx,sy,0],[0,sy,0],[0,0,sz],[sx,0,sz],[sx,sy,sz],[0,sy,sz]];
      const quads = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[2,3,7,6],[1,2,6,5],[0,4,7,3]];
      const tris = [];
      for (const [a,b,c,d] of quads) tris.push([v[a],v[b],v[c]], [v[a],v[c],v[d]]);
      const buf = Buffer.alloc(84 + tris.length * 50);
      buf.writeUInt32LE(tris.length, 80);
      tris.forEach((t, i) => { let o = 84 + i * 50 + 12; for (const q of t) for (const n of q) { buf.writeFloatLE(n, o); o += 4; } });
      return buf;
    };
    const stl = boxStl(20, 20, 100);
    /* A4横・2ページの図面風PDF。0.3pt の細い線を細かく引く（ぼやけると消える太さ） */
    let lines = '0.3 w\n';
    for (let x = 40; x < 800; x += 6) lines += `${x} 40 m ${x} 555 l S\n`;
    lines += '2 w 30 30 782 535 re S';
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R >>', `<< /Length ${lines.length} >>\nstream\n${lines}\nendstream`,
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R >>'];
    let pdf = '%PDF-1.4\n'; const offs = [];
    objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const bigPdf = Buffer.from(pdf, 'latin1');

    await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
    await page.route('**/api/wn/files/41', r => r.fulfill({ json: { data: { id: 41, file_name: 'N11187.STL', file_size: stl.length, updated_at: '2026-07-01T00:00:00Z' } } }));
    await page.route('**/api/wn/files/42', r => r.fulfill({ json: { data: { id: 42, file_name: '図面.pdf', mime_type: 'application/pdf', updated_at: '2026-07-01T00:00:00Z' } } }));
    await page.route('**/api/wn/files/4*/thumb*', r => r.fulfill({ contentType: 'image/png', body: thumbBufs[1] }));
    await page.route('**/api/wn/files/41/view*', r => r.fulfill({ json: { url: 'http://127.0.0.1:8765/__live.stl' } }));
    await page.route('**/api/wn/files/42/view*', r => r.fulfill({ json: { url: 'http://127.0.0.1:8765/__live.pdf' } }));
    await page.route('**/__live.stl', r => r.fulfill({ contentType: 'application/octet-stream', body: stl }));
    await page.route('**/__live.pdf', r => r.fulfill({ contentType: 'application/pdf', body: bigPdf }));

    await page.goto(`${BASE}/app/align.html?ids=41,42`, { waitUntil: 'domcontentloaded' });
    const live = await page.waitForFunction(() =>
      document.getElementById('alignCard-41')?.classList.contains('is-live') &&
      document.getElementById('alignCard-42')?.classList.contains('is-live') &&
      document.querySelector('#alignThumb-42 canvas.apv-sharp'), null, { timeout: 60000 }).then(() => true).catch(() => false);
    check('STLとPDFのカードがそのまま動かせる表示に切り替わる', live);
    await page.waitForTimeout(600);

    /* 3D: iframe の中に WebGL のキャンバスがあり、ドラッグで画が変わる（＝回せる） */
    const frameEl = await page.$('#alignThumb-41 iframe.align-model-frame');
    const frame = frameEl && await frameEl.contentFrame();
    const hasGl = frame ? await frame.evaluate(() => !!document.querySelector('#stage canvas')) : false;
    check('3D: カードの中に3D表示(WebGL)がある', hasGl);
    if (hasGl) {
      /* WebGL の画は読み出すと空になることがあるので、カメラの位置で「回ったか」を見る */
      const snap = () => frame.evaluate(() => viewer.ctx.camera.position.toArray().map(v => v.toFixed(3)).join(','));
      const r41 = await (await page.$('#alignThumb-41')).boundingBox();
      const before = await snap();
      await page.mouse.move(r41.x + r41.width / 2, r41.y + r41.height / 2);
      await page.mouse.down();
      await page.mouse.move(r41.x + r41.width / 2 + 160, r41.y + r41.height / 2 + 40, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      check('3D: ドラッグでモデルが回る（画が変わる）', before !== await snap());
      check('3D: カードの上を操作してもライトボックスは開かない',
        await page.evaluate(() => !document.getElementById('alignLightbox').classList.contains('show')));
      check('3D: 視点ボタン（ツールバー）が出ている', await frame.evaluate(() => document.getElementById('toolbar').classList.contains('visible')));
    }

    /* PDF: 表示している画が画面の実ピクセルと同じ細かさで描かれている（ぼやけない） */
    const sharpInfo = () => page.evaluate(() => {
      const c = document.querySelector('#alignThumb-42 canvas.apv-sharp');
      const r = c.getBoundingClientRect();
      return { ratio: +(c.width / (r.width * devicePixelRatio)).toFixed(3), cssW: Math.round(r.width) };
    });
    const s0 = await sharpInfo();
    check('PDF: 表示中の画が画面の画素と1:1（縮小表示のぼやけがない）', Math.abs(s0.ratio - 1) < 0.02, JSON.stringify(s0));

    const st = () => page.evaluate(() => {
      const base = document.querySelector('#alignThumb-42 canvas.apv-base');
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(base.style.transform) || [];
      return { w: parseFloat(base.style.width), x: +m[1], y: +m[2] };
    });
    const r42 = await (await page.$('#alignThumb-42')).boundingBox();
    const z0 = await st();
    await page.mouse.move(r42.x + r42.width / 2, r42.y + r42.height / 2);
    for (let k = 0; k < 6; k++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(30); }
    await page.waitForTimeout(600);
    const z1 = await st();
    check('PDF: ホイールで拡大できる', z1.w > z0.w * 1.8, `${Math.round(z0.w)} → ${Math.round(z1.w)}`);
    const s1 = await sharpInfo();
    check('PDF: 拡大後も描き直して画素と1:1（拡大してもぼやけない）', Math.abs(s1.ratio - 1) < 0.02, JSON.stringify(s1));

    await page.mouse.down();
    await page.mouse.move(r42.x + r42.width / 2 + 120, r42.y + r42.height / 2 + 60, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const z2 = await st();
    check('PDF: ドラッグで動かせる', Math.abs(z2.x - z1.x) > 60 && Math.abs(z2.y - z1.y) > 20, JSON.stringify({ z1, z2 }));
    check('PDF: ドラッグしてもライトボックスは開かない',
      await page.evaluate(() => !document.getElementById('alignLightbox').classList.contains('show')));

    await page.click('#alignThumb-42 .apv-bar [data-act="fit"]');
    await page.waitForTimeout(200);
    check('PDF: 「全体を表示」で元の大きさに戻る', Math.abs((await st()).w - z0.w) < 1);
    await page.click('#alignThumb-42 .apv-bar [data-act="next"]');
    await page.waitForFunction(() => document.querySelector('#alignThumb-42 .apv-page')?.textContent === '2 / 2', null, { timeout: 5000 }).catch(() => {});
    check('PDF: 複数ページはページ送りできる', await page.evaluate(() => document.querySelector('#alignThumb-42 .apv-page')?.textContent) === '2 / 2');

    const rowsLive = await readAlignRows(page);
    check('3D・PDFを並べても行は右端まで埋まる', rowsLive.every(r => r.gapToRight <= 2), JSON.stringify(rowsLive.map(r => r.gapToRight)));
    await page.screenshot({ path: path.join(SHOTS, 'align-live.png') });

    /* 「大きく表示」ボタンからはライトボックスが開き、PDF もそのまま動かせる */
    await page.click('#alignCard-42 .align-card-expand');
    const lbOk = await page.waitForFunction(() => document.querySelector('#lbContentWrap .apv canvas.apv-sharp'), null, { timeout: 15000 }).then(() => true).catch(() => false);
    check('「大きく表示」でライトボックスが開き、PDFが鮮明な描き直し表示になる', lbOk);
    await page.screenshot({ path: path.join(SHOTS, 'align-live-lightbox.png') });
    await page.keyboard.press('Escape');
    await page.close();
  }

  /* ════ 7. align.html: idsが1件以下なら全体エラー表示 ════ */
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
