/* What'sNo ファイル比較機能のE2E検証（バックエンドなし・APIモック） */
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
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });

  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com' }));
    localStorage.setItem('space_token', 'mock-token-e2e');
    localStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com' }));
  });

  /* ── テスト画像を生成（赤い矩形＋対角線 / 青い円） ── */
  const genPage = await ctx.newPage();
  await genPage.goto('about:blank');
  const [pngA, pngB] = await genPage.evaluate(() => {
    const make = draw => {
      const c = document.createElement('canvas');
      c.width = 400; c.height = 300;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 300);
      draw(g);
      return c.toDataURL('image/png').split(',')[1];
    };
    const a = make(g => {
      g.strokeStyle = '#000'; g.lineWidth = 4;
      g.strokeRect(40, 40, 200, 150);
      g.beginPath(); g.moveTo(40, 40); g.lineTo(240, 190); g.stroke();
    });
    const b = make(g => {
      g.strokeStyle = '#000'; g.lineWidth = 4;
      g.strokeRect(40, 40, 200, 150);
      g.beginPath(); g.arc(300, 150, 60, 0, Math.PI * 2); g.stroke();
    });
    return [a, b];
  });
  await genPage.close();
  const bufA = Buffer.from(pngA, 'base64');
  const bufB = Buffer.from(pngB, 'base64');

  /* ── 共通APIモック ── */
  const files = {
    101: { id: 101, file_name: '図面_旧.png', version: 1, mime_type: 'image/png', updated_at: '2026-07-01T00:00:00Z' },
    102: { id: 102, file_name: '図面_新.png', version: 1, mime_type: 'image/png', updated_at: '2026-07-02T00:00:00Z' },
  };
  const setupRoutes = async (page) => {
    await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
    await page.route('**/api/wn/files/101', r => r.fulfill({ json: { data: files[101] } }));
    await page.route('**/api/wn/files/102', r => r.fulfill({ json: { data: files[102] } }));
    await page.route('**/api/wn/files/101/view', r => r.fulfill({ json: { url: 'http://127.0.0.1:8765/__test_a.png' } }));
    await page.route('**/api/wn/files/102/view', r => r.fulfill({ json: { url: 'http://127.0.0.1:8765/__test_b.png' } }));
    await page.route('**/__test_a.png', r => r.fulfill({ contentType: 'image/png', body: bufA }));
    await page.route('**/__test_b.png', r => r.fulfill({ contentType: 'image/png', body: bufB }));
  };

  /* ════ 1. ダッシュボード: 比較ボタンの有効化ロジック ════ */
  {
    const page = await ctx.newPage();
    await setupRoutes(page);
    page.on('pageerror', e => console.log('PAGE ERROR(dashboard):', e.message));
    await page.goto(`${BASE}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    await page.evaluate(() => {
      allFiles = [
        { id: '1', file_name: 'a.pdf', mime_type: 'application/pdf', size: 100, updated_at: '2026-07-01', tags: [] },
        { id: '2', file_name: 'b.pdf', mime_type: 'application/pdf', size: 100, updated_at: '2026-07-01', tags: [] },
        { id: '3', file_name: 'c.png', mime_type: 'image/png', size: 100, updated_at: '2026-07-01', tags: [] },
        { id: '4', file_name: 'd.dxf', mime_type: 'application/dxf', size: 100, updated_at: '2026-07-01', tags: [] },
        { id: '5', file_name: 'e.xlsx', mime_type: 'application/vnd.ms-excel', size: 100, updated_at: '2026-07-01', tags: [] },
      ];
      renderFiles();
    });

    const state = () => page.evaluate(() => ({
      disabled: document.getElementById('compareSelBtn').disabled,
      title: document.getElementById('compareSelBtn').title,
    }));

    /* 選択モードに入って選択をJSで操作（DOMクリックはレイアウト依存を避ける） */
    await page.evaluate(() => { if (!selectMode) toggleSelectMode(); });

    await page.evaluate(() => toggleMergeSelect('1'));
    check('1件選択で比較ボタン無効', (await state()).disabled === true);

    await page.evaluate(() => toggleMergeSelect('2'));
    check('PDF2件選択で比較ボタン有効', (await state()).disabled === false);

    await page.evaluate(() => toggleMergeSelect('3'));
    check('3件選択で比較ボタン無効', (await state()).disabled === true);

    await page.evaluate(() => { toggleMergeSelect('2'); }); /* 残り: 1(pdf), 3(png) */
    check('PDF+画像の2件で比較ボタン有効', (await state()).disabled === false);

    await page.evaluate(() => { toggleMergeSelect('1'); toggleMergeSelect('4'); }); /* 残り: 3(png), 4(dxf) */
    check('画像+DXFの2件で比較ボタン無効', (await state()).disabled === true);

    await page.evaluate(() => { toggleMergeSelect('3'); toggleMergeSelect('5'); }); /* 残り: 4(dxf), 5(xlsx) */
    check('DXF+xlsxの2件で比較ボタン無効', (await state()).disabled === true);

    await page.evaluate(() => { toggleMergeSelect('5'); toggleMergeSelect('1'); }); /* 残り: 4(dxf), 1(pdf)→dxf,pdf 無効 */
    await page.evaluate(() => { toggleMergeSelect('4'); toggleMergeSelect('2'); }); /* 残り: 1(pdf), 2(pdf) */

    /* 遷移確認 */
    await page.evaluate(() => document.getElementById('compareSelBtn').click());
    await page.waitForTimeout(800);
    const url = page.url();
    check('比較ボタンでdiff.htmlへ遷移(選択順=a,b + type=files)',
      url.includes('diff.html') && url.includes('a=1') && url.includes('b=2') && url.includes('type=files'), url);
    await page.screenshot({ path: path.join(SHOTS, 'cmp-1-actionbar.png') });
    await page.close();
  }

  /* ════ 2. diff.html filesモード: 画像×画像 4モード ════ */
  {
    const page = await ctx.newPage();
    await setupRoutes(page);
    page.on('pageerror', e => console.log('PAGE ERROR(diff):', e.message));
    page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERROR(diff):', m.text()); });
    await page.goto(`${BASE}/app/diff.html?a=101&b=102&type=files`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('diffLoading').style.display === 'none', { timeout: 15000 });

    check('タイトルが「ファイル比較」', await page.evaluate(() => document.getElementById('diffTitle').textContent) === 'ファイル比較');
    const badges = await page.evaluate(() => [
      document.getElementById('badgeA').textContent,
      document.getElementById('badgeB').textContent,
      document.getElementById('badgeA').className,
    ]);
    check('バッジがファイル名表示(A/B)', badges[0] === 'A: 図面_旧.png' && badges[1] === 'B: 図面_新.png', badges.join(' | '));
    check('バッジ色がfiles用クラス', badges[2].includes('diff-ver-fa'));
    check('戻りリンクがダッシュボード', (await page.evaluate(() => document.getElementById('backBtn').getAttribute('href'))) === 'dashboard.html');

    const modes = await page.evaluate(() => [...document.querySelectorAll('.diff-mode-btn')].map(b => b.dataset.mode));
    check('モードボタンが4つ(side/overlay/swipe/diff)', JSON.stringify(modes) === JSON.stringify(['side', 'overlay', 'swipe', 'diff']), modes.join(','));

    /* 並列: canvasが白紙でないこと（cloneNodeバグ修正の確認） */
    const sideOk = await page.evaluate(() => {
      const canvases = document.querySelectorAll('#canvasWrapA canvas, #canvasWrapB canvas');
      if (canvases.length !== 2) return 'canvas数=' + canvases.length;
      const nonBlank = c => {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 250 && d[i + 3] > 0) return true;
        return false;
      };
      return (nonBlank(canvases[0]) && nonBlank(canvases[1])) ? 'ok' : '白紙canvas';
    });
    check('並列表示: 両canvasに描画内容あり', sideOk === 'ok', sideOk);
    const labels = await page.evaluate(() => [...document.querySelectorAll('.diff-panel-label')].map(l => l.textContent.trim()));
    check('並列ラベルがファイル名', labels[0].includes('図面_旧.png') && labels[1].includes('図面_新.png'), labels.join(' | '));
    await page.screenshot({ path: path.join(SHOTS, 'cmp-2-side.png') });

    /* 同期スクロール&ズーム: Ctrl+ホイール */
    const wBefore = await page.evaluate(() => document.querySelector('#canvasWrapA canvas').getBoundingClientRect().width);
    await page.mouse.move(400, 400);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    await page.waitForTimeout(300);
    const wAfterA = await page.evaluate(() => document.querySelector('#canvasWrapA canvas').getBoundingClientRect().width);
    const wAfterB = await page.evaluate(() => document.querySelector('#canvasWrapB canvas').getBoundingClientRect().width);
    check('Ctrl+ホイールで両パネル同時ズーム', wAfterA > wBefore && Math.abs(wAfterA - wAfterB) < 2,
      `before=${wBefore.toFixed(0)} A=${wAfterA.toFixed(0)} B=${wAfterB.toFixed(0)}`);
    await page.screenshot({ path: path.join(SHOTS, 'cmp-3-zoom.png') });

    /* オーバーレイ */
    await page.click('[data-mode="overlay"]');
    await page.waitForTimeout(500);
    const ovl = await page.evaluate(() => {
      const top = document.querySelector('[data-overlay="true"]');
      return {
        exists: !!top,
        opacity: top ? top.style.opacity : null,
        slider: document.getElementById('opacityWrap').style.display,
        label: document.getElementById('opacityLabel').textContent,
      };
    });
    check('オーバーレイ: 重ね描画+スライダー表示', ovl.exists && ovl.slider !== 'none' && ovl.label === 'Aの透明度:', JSON.stringify(ovl));
    await page.evaluate(() => {
      const s = document.getElementById('opacitySlider');
      s.value = 80; s.dispatchEvent(new Event('input'));
    });
    const op = await page.evaluate(() => document.querySelector('[data-overlay="true"]').style.opacity);
    check('透明度スライダー反映', op === '0.8', 'opacity=' + op);
    await page.screenshot({ path: path.join(SHOTS, 'cmp-4-overlay.png') });

    /* スワイプ */
    await page.click('[data-mode="swipe"]');
    await page.waitForTimeout(500);
    const swipeInit = await page.evaluate(() => {
      const top = document.querySelector('.swipe-top');
      const div = document.querySelector('.swipe-divider');
      return { clip: top?.style.clipPath, left: div?.style.left, tags: [...document.querySelectorAll('.swipe-tag')].map(t => t.textContent).join(',') };
    });
    check('スワイプ: 初期50%+A/Bタグ', swipeInit.clip === 'inset(0px 50% 0px 0px)' && swipeInit.left === '50%' && swipeInit.tags === 'A,B', JSON.stringify(swipeInit));

    /* ハンドルをドラッグ */
    const grip = await page.locator('.swipe-grip').boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 - 100, grip.y + grip.height / 2, { steps: 8 });
    await page.mouse.up();
    const swipeAfter = await page.evaluate(() => document.querySelector('.swipe-top').style.clipPath);
    check('スワイプハンドルのドラッグで境界移動', swipeAfter !== 'inset(0px 50% 0px 0px)', swipeAfter);
    await page.screenshot({ path: path.join(SHOTS, 'cmp-5-swipe.png') });

    /* ピクセル差分 */
    await page.click('[data-mode="diff"]');
    await page.waitForTimeout(800);
    const diffRes = await page.evaluate(() => {
      const c = document.querySelector('#diffWrap canvas');
      if (!c) return 'canvasなし';
      let red = 0, green = 0;
      try {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        /* alpha=200書き込みのpremultiply往復で±数値ずれるため範囲判定 */
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] > 180 && d[i + 1] < 100 && d[i + 2] < 100) red++;
          if (d[i] < 100 && d[i + 1] > 140 && d[i + 2] < 130) green++;
        }
      } catch (e) { return 'taint: ' + e.message; }
      const legend = [document.getElementById('legendDel').textContent, document.getElementById('legendAdd').textContent].join(',');
      return { red, green, legend };
    });
    check('ピクセル差分: 赤(Aのみ)と緑(Bのみ)が検出・canvas汚染なし',
      typeof diffRes === 'object' && diffRes.red > 100 && diffRes.green > 100 && diffRes.legend === 'Aのみ,Bのみ',
      JSON.stringify(diffRes));
    await page.screenshot({ path: path.join(SHOTS, 'cmp-6-pixeldiff.png') });
    await page.close();
  }

  /* ════ 3. diff.html 従来のバージョン比較モード（後方互換） ════ */
  {
    const page = await ctx.newPage();
    await setupRoutes(page);
    /* pdf扱いにするとCDNのpdf.js+実PDFが要るため、既存互換はラベル系のみ確認（typeなしURL） */
    await page.route('**/api/wn/files/101', r => r.fulfill({ json: { data: { ...files[101], file_name: 'part.png', version: 2 } } }));
    await page.route('**/api/wn/files/102', r => r.fulfill({ json: { data: { ...files[102], file_name: 'part.png', version: 3 } } }));
    page.on('pageerror', e => console.log('PAGE ERROR(ver):', e.message));
    await page.goto(`${BASE}/app/diff.html?a=101&b=102`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('diffLoading').style.display === 'none', { timeout: 15000 });
    const ver = await page.evaluate(() => ({
      title: document.getElementById('diffTitle').textContent,
      a: document.getElementById('badgeA').textContent,
      b: document.getElementById('badgeB').textContent,
      back: document.getElementById('backBtn').getAttribute('href'),
      clsA: document.getElementById('badgeA').className,
    }));
    check('バージョン比較: 従来ラベル維持',
      ver.title.startsWith('差分比較:') && ver.a === 'v2 (旧)' && ver.b === 'v3 (新)' &&
      ver.back === 'file-detail.html?id=102' && ver.clsA.includes('diff-ver-a'),
      JSON.stringify(ver));
    await page.screenshot({ path: path.join(SHOTS, 'cmp-7-version-mode.png') });
    await page.close();
  }

  /* ════ 4. diff.html filesモード: PDF×PDF（pdf.js実レンダリング） ════ */
  {
    const makePdf = (stream) => {
      const objs = [];
      objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
      objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
      objs[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R >>';
      objs[4] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
      let out = '%PDF-1.4\n';
      const offsets = [];
      for (let i = 1; i <= 4; i++) {
        offsets[i] = out.length;
        out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
      }
      const xrefPos = out.length;
      out += 'xref\n0 5\n0000000000 65535 f \n';
      for (let i = 1; i <= 4; i++) out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
      out += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
      return Buffer.from(out, 'latin1');
    };
    const pdfA = makePdf('4 w 20 20 200 100 re S');
    const pdfB = makePdf('4 w 20 20 200 100 re S 240 30 m 280 170 l S');

    const page = await ctx.newPage();
    await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
    await page.route('**/api/wn/files/101', r => r.fulfill({ json: { data: { id: 101, file_name: '部品A.pdf', version: 1, mime_type: 'application/pdf' } } }));
    await page.route('**/api/wn/files/102', r => r.fulfill({ json: { data: { id: 102, file_name: '部品B.pdf', version: 1, mime_type: 'application/pdf' } } }));
    await page.route('**/api/wn/files/101/view', r => r.fulfill({ json: { url: 'http://127.0.0.1:8765/__test_a.pdf' } }));
    await page.route('**/api/wn/files/102/view', r => r.fulfill({ json: { url: 'http://127.0.0.1:8765/__test_b.pdf' } }));
    await page.route('**/__test_a.pdf', r => r.fulfill({ contentType: 'application/pdf', body: pdfA }));
    await page.route('**/__test_b.pdf', r => r.fulfill({ contentType: 'application/pdf', body: pdfB }));
    page.on('pageerror', e => console.log('PAGE ERROR(pdf):', e.message));
    page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERROR(pdf):', m.text()); });

    await page.goto(`${BASE}/app/diff.html?a=101&b=102&type=files`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('diffLoading').style.display === 'none', { timeout: 20000 });

    const pdfSide = await page.evaluate(() => {
      const canvases = document.querySelectorAll('#canvasWrapA canvas, #canvasWrapB canvas');
      if (canvases.length !== 2) return 'canvas数=' + canvases.length;
      const nonBlank = c => {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 250 && d[i + 3] > 0) return true;
        return false;
      };
      return (nonBlank(canvases[0]) && nonBlank(canvases[1])) ? 'ok' : '白紙canvas';
    });
    check('PDF×PDF: pdf.js経由で並列表示に描画あり', pdfSide === 'ok', pdfSide);

    await page.click('[data-mode="diff"]');
    await page.waitForTimeout(1000);
    const pdfDiff = await page.evaluate(() => {
      const c = document.querySelector('#diffWrap canvas');
      if (!c) return 'canvasなし';
      let red = 0, green = 0;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 180 && d[i + 1] < 100 && d[i + 2] < 100) red++;
        if (d[i] < 100 && d[i + 1] > 140 && d[i + 2] < 130) green++;
      }
      return { red, green };
    });
    check('PDF×PDF: ピクセル差分で追加線(緑)を検出', typeof pdfDiff === 'object' && pdfDiff.green > 50, JSON.stringify(pdfDiff));
    await page.screenshot({ path: path.join(SHOTS, 'cmp-8-pdf.png') });
    await page.close();
  }

  /* ════ 5. 大きなファイル（パネル幅超のcanvas）がパネル内に収まるか ════ */
  {
    const genPage2 = await ctx.newPage();
    await genPage2.goto('about:blank');
    const [bigA, bigB] = await genPage2.evaluate(() => {
      const make = seed => {
        const c = document.createElement('canvas');
        c.width = 3000; c.height = 1000;
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, 3000, 1000);
        g.strokeStyle = '#000'; g.lineWidth = 8;
        g.strokeRect(100, 100, 2800, 800);
        g.font = '120px sans-serif'; g.fillStyle = '#000';
        g.fillText('WIDE DRAWING ' + seed, 200, 500);
        return c.toDataURL('image/png').split(',')[1];
      };
      return [make('A'), make('B')];
    });
    await genPage2.close();

    const page = await ctx.newPage();
    await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
    await page.route('**/api/wn/files/201', r => r.fulfill({ json: { data: { id: 201, file_name: '横長図面A.png', version: 1, mime_type: 'image/png' } } }));
    await page.route('**/api/wn/files/202', r => r.fulfill({ json: { data: { id: 202, file_name: '横長図面B.png', version: 1, mime_type: 'image/png' } } }));
    await page.route('**/api/wn/files/201/view', r => r.fulfill({ json: { url: 'http://127.0.0.1:8765/__big_a.png' } }));
    await page.route('**/api/wn/files/202/view', r => r.fulfill({ json: { url: 'http://127.0.0.1:8765/__big_b.png' } }));
    await page.route('**/__big_a.png', r => r.fulfill({ contentType: 'image/png', body: Buffer.from(bigA, 'base64') }));
    await page.route('**/__big_b.png', r => r.fulfill({ contentType: 'image/png', body: Buffer.from(bigB, 'base64') }));
    page.on('pageerror', e => console.log('PAGE ERROR(big):', e.message));

    await page.goto(`${BASE}/app/diff.html?a=201&b=202&type=files`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('diffLoading').style.display === 'none', { timeout: 15000 });

    const fit = await page.evaluate(() => {
      const panelA = document.getElementById('panelA');
      const panelB = document.getElementById('panelB');
      const cA = panelA.querySelector('canvas');
      const cB = panelB.querySelector('canvas');
      const bodyW = document.getElementById('diffBody').clientWidth;
      return {
        bodyW,
        panelAW: Math.round(panelA.getBoundingClientRect().width),
        panelBW: Math.round(panelB.getBoundingClientRect().width),
        canvasAW: Math.round(cA.getBoundingClientRect().width),
        canvasBW: Math.round(cB.getBoundingClientRect().width),
        hOverflowA: panelA.scrollWidth > panelA.clientWidth + 1,
      };
    });
    check('横長大画像: パネルが画面の半分に収まる',
      fit.panelAW <= fit.bodyW / 2 + 2 && fit.panelBW <= fit.bodyW / 2 + 2, JSON.stringify(fit));
    check('横長大画像: canvasがパネル幅にフィット(はみ出しなし)',
      fit.canvasAW <= fit.panelAW && fit.canvasBW <= fit.panelBW && !fit.hOverflowA, JSON.stringify(fit));
    await page.screenshot({ path: path.join(SHOTS, 'cmp-9-bigfit.png') });

    /* オーバーレイでも収まること */
    await page.click('[data-mode="overlay"]');
    await page.waitForTimeout(500);
    const ovlFit = await page.evaluate(() => {
      const wrap = document.getElementById('overlayWrap');
      const c = wrap.querySelector('canvas');
      return { wrapW: wrap.clientWidth, canvasW: Math.round(c.getBoundingClientRect().width) };
    });
    check('横長大画像: オーバーレイも画面内にフィット', ovlFit.canvasW <= ovlFit.wrapW, JSON.stringify(ovlFit));
    await page.close();
  }

  /* ════ 6. 失敗時に沈黙しないこと（スピナー放置の防止） ════ */
  {
    /* 6a. pdf.js CDN障害 → 明示エラー */
    const page = await ctx.newPage();
    await page.route('**/pdf.min.js', r => r.abort());
    await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
    await page.route('**/api/wn/files/101', r => r.fulfill({ json: { data: { id: 101, file_name: 'a.pdf', version: 1 } } }));
    await page.route('**/api/wn/files/102', r => r.fulfill({ json: { data: { id: 102, file_name: 'b.pdf', version: 1 } } }));
    await page.goto(`${BASE}/app/diff.html?a=101&b=102&type=files`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const err1 = await page.evaluate(() => ({
      spinner: document.getElementById('diffLoading').style.display !== 'none',
      text: document.querySelector('.diff-error')?.textContent ?? '',
    }));
    check('CDN障害時: スピナー放置せず明示エラー', !err1.spinner && err1.text.includes('PDF表示ライブラリ'), JSON.stringify(err1));
    await page.close();
  }
  {
    /* 6b. ファイル実体が壊れている → どのファイルかを含むエラー */
    const page = await ctx.newPage();
    await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
    await page.route('**/api/wn/files/101', r => r.fulfill({ json: { data: { id: 101, file_name: '壊れた画像.png', version: 1 } } }));
    await page.route('**/api/wn/files/102', r => r.fulfill({ json: { data: { id: 102, file_name: '正常.png', version: 1 } } }));
    await page.route('**/api/wn/files/101/view', r => r.fulfill({ json: { url: 'http://127.0.0.1:8765/__broken.png' } }));
    await page.route('**/api/wn/files/102/view', r => r.fulfill({ json: { url: 'http://127.0.0.1:8765/__ok.png' } }));
    await page.route('**/__broken.png', r => r.fulfill({ contentType: 'image/png', body: Buffer.from('not a png') }));
    await page.route('**/__ok.png', r => r.fulfill({ contentType: 'image/png', body: bufB }));
    await page.goto(`${BASE}/app/diff.html?a=101&b=102&type=files`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('.diff-error') || document.getElementById('diffLoading').style.display === 'none', { timeout: 15000 });
    const err2 = await page.evaluate(() => document.querySelector('.diff-error')?.textContent ?? '(エラー表示なし)');
    check('破損ファイル時: ファイル名入りの明示エラー', err2.includes('壊れた画像.png'), err2.trim().slice(0, 80));
    await page.close();
  }

  /* ════ 7. 全角記号入りファイル名でA/Bラベル帯の高さが揃うこと ════
     (line-height:normal だと全角記号がフォールバックフォントで描画され、
     行高メトリクスの違いでA/Bの帯の高さがずれた実バグの再発防止) */
  {
    const page = await ctx.newPage();
    await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
    await page.route('**/api/wn/files/101', r => r.fulfill({ json: { data: { id: 101, file_name: '06-0341見積依頼書.png', version: 1 } } }));
    await page.route('**/api/wn/files/102', r => r.fulfill({ json: { data: { id: 102, file_name: 'A_44101_NDC_MCMO16-6000_【再見積り】起動装置格納箱_260623.png', version: 1 } } }));
    await page.route('**/api/wn/files/101/view', r => r.fulfill({ json: { url: 'http://127.0.0.1:8765/__zenkaku_a.png' } }));
    await page.route('**/api/wn/files/102/view', r => r.fulfill({ json: { url: 'http://127.0.0.1:8765/__zenkaku_b.png' } }));
    await page.route('**/__zenkaku_a.png', r => r.fulfill({ contentType: 'image/png', body: bufA }));
    await page.route('**/__zenkaku_b.png', r => r.fulfill({ contentType: 'image/png', body: bufB }));
    await page.goto(`${BASE}/app/diff.html?a=101&b=102&type=files`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('diffLoading').style.display === 'none', { timeout: 15000 });
    await page.waitForTimeout(300);
    const heights = await page.evaluate(() => ({
      a: document.querySelector('#panelA .diff-panel-label').getBoundingClientRect().height,
      b: document.querySelector('#panelB .diff-panel-label').getBoundingClientRect().height,
    }));
    check('全角記号入りファイル名でもA/Bラベル帯の高さが一致', Math.abs(heights.a - heights.b) < 0.5, JSON.stringify(heights));
    await page.close();
  }

  await browser.close();
  const fails = results.filter(r => !r.ok);
  console.log(`\n==== 結果: ${results.length - fails.length}/${results.length} PASS ====`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
