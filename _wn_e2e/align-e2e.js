/* What'sNo「並べる」機能(align.html)のE2E検証（バックエンドなし・APIモック） */
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
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });

  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com' }));
    localStorage.setItem('space_token', 'mock-token-e2e');
    localStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com' }));
  });

  /* テスト画像生成 */
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
    const a = make(g => { g.strokeStyle = '#000'; g.lineWidth = 4; g.strokeRect(40, 40, 200, 150); });
    const b = make(g => { g.strokeStyle = '#000'; g.lineWidth = 4; g.beginPath(); g.arc(200, 150, 80, 0, Math.PI * 2); g.stroke(); });
    return [a, b];
  });
  await genPage.close();
  const bufA = Buffer.from(pngA, 'base64');
  const bufB = Buffer.from(pngB, 'base64');

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
  const pdfC = makePdf('4 w 20 20 200 100 re S');

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

    const state = () => page.evaluate(() => ({
      disabled: document.getElementById('alignSelBtn').disabled,
    }));

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
    await page.screenshot({ path: path.join(SHOTS, 'align-1-actionbar.png') });
    await page.close();
  }

  /* ════ 2. align.html: 4種類混在(pdf/png/dxf/xlsxフォールバック)の描画 ════ */
  {
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGE ERROR(align):', e.message));
    page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERROR(align):', m.text()); });

    await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
    await page.route('**/api/wn/files/11', r => r.fulfill({ json: { data: { id: 11, file_name: '部品図.pdf', mime_type: 'application/pdf', updated_at: '2026-07-01T00:00:00Z' } } }));
    await page.route('**/api/wn/files/12', r => r.fulfill({ json: { data: { id: 12, file_name: '写真.png', mime_type: 'image/png', updated_at: '2026-07-01T00:00:00Z' } } }));
    await page.route('**/api/wn/files/13', r => r.fulfill({ json: { data: { id: 13, file_name: '図面.dxf', mime_type: 'application/dxf', updated_at: '2026-07-01T00:00:00Z' } } }));
    await page.route('**/api/wn/files/14', r => r.fulfill({ json: { data: { id: 14, file_name: '見積.xlsx', mime_type: 'application/vnd.ms-excel', updated_at: '2026-07-01T00:00:00Z' } } }));
    await page.route('**/api/wn/files/11/view', r => r.fulfill({ json: { url: 'http://127.0.0.1:8765/__align_c.pdf' } }));
    await page.route('**/__align_c.pdf', r => r.fulfill({ contentType: 'application/pdf', body: pdfC }));
    await page.route('**/api/wn/files/12/view', r => r.fulfill({ json: { url: 'http://127.0.0.1:8765/__align_a.png' } }));
    await page.route('**/__align_a.png', r => r.fulfill({ contentType: 'image/png', body: bufA }));
    await page.route('**/api/wn/files/13/public-view*', r => r.fulfill({ contentType: 'text/plain', body: dxfText }));
    await page.route('**/api/wn/files/14/thumb*', r => r.fulfill({ contentType: 'image/png', body: bufB }));

    await page.goto(`${BASE}/app/align.html?ids=11,12,13,14`, { waitUntil: 'domcontentloaded' });

    check('タイトルに件数表示', (await page.evaluate(() => document.getElementById('alignTitle').textContent)).includes('4件'));

    /* 各パネルの描画完了を待つ */
    await page.waitForFunction(() => {
      const ok = id => {
        const b = document.getElementById(`alignBody-${id}`);
        return b && (b.querySelector('canvas,img') || b.querySelector('.align-panel-error'));
      };
      return ok(11) && ok(12) && ok(13) && ok(14);
    }, { timeout: 20000 });
    await page.waitForTimeout(500);

    const names = await page.evaluate(() => [11, 12, 13, 14].map(id => document.getElementById(`alignName-${id}`).textContent));
    check('4パネルとも正しいファイル名を表示',
      JSON.stringify(names) === JSON.stringify(['部品図.pdf', '写真.png', '図面.dxf', '見積.xlsx']), names.join(' | '));

    const panelCount = await page.evaluate(() => document.querySelectorAll('.align-panel').length);
    check('パネル数がids数と一致(4)', panelCount === 4, 'count=' + panelCount);

    const pdfOk = await page.evaluate(() => {
      const c = document.querySelector('#alignBody-11 canvas');
      if (!c) return 'canvasなし';
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 250 && d[i + 3] > 0) return 'ok';
      return '白紙canvas';
    });
    check('PDFパネル: pdf.js経由でレンダリングされている', pdfOk === 'ok', pdfOk);

    const imgOk = await page.evaluate(() => !!document.querySelector('#alignBody-12 img.align-content'));
    check('画像パネル: imgタグで表示', imgOk === true);

    const dxfOk = await page.evaluate(() => {
      const wrap = document.querySelector('#alignBody-13 .align-dxf-wrap');
      return !!(wrap && wrap.querySelector('canvas'));
    });
    check('DXFパネル: Three.jsのcanvasが挿入されている', dxfOk === true);

    const xlsxOk = await page.evaluate(() => {
      const img = document.querySelector('#alignBody-14 img.align-content');
      const note = document.querySelector('#alignBody-14 .align-thumb-note');
      return !!(img && note && note.textContent.includes('サムネイル'));
    });
    check('xlsxパネル: サーバーサムネイルにフォールバック+注記表示', xlsxOk === true);

    await page.screenshot({ path: path.join(SHOTS, 'align-2-mixed.png') });
    await page.close();
  }

  /* ════ 3. align.html: 1件だけ壊れていても他のパネルは正常表示(部分失敗の分離) ════ */
  {
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGE ERROR(align-fail):', e.message));

    await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
    await page.route('**/api/wn/files/21', r => r.fulfill({ status: 404, json: { message: 'not found' } }));
    await page.route('**/api/wn/files/22', r => r.fulfill({ json: { data: { id: 22, file_name: '正常画像.png', mime_type: 'image/png', updated_at: '2026-07-01T00:00:00Z' } } }));
    await page.route('**/api/wn/files/22/view', r => r.fulfill({ json: { url: 'http://127.0.0.1:8765/__align_ok.png' } }));
    await page.route('**/__align_ok.png', r => r.fulfill({ contentType: 'image/png', body: bufA }));

    await page.goto(`${BASE}/app/align.html?ids=21,22`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const b21 = document.getElementById('alignBody-21');
      const b22 = document.getElementById('alignBody-22');
      return b21 && b21.querySelector('.align-panel-error') && b22 && b22.querySelector('img');
    }, { timeout: 15000 });

    const partial = await page.evaluate(() => ({
      errText: document.querySelector('#alignBody-21 .align-panel-error')?.textContent ?? '',
      img22: !!document.querySelector('#alignBody-22 img'),
    }));
    check('1件失敗しても他パネルは正常描画される(部分失敗の分離)',
      partial.errText.length > 0 && partial.img22 === true, JSON.stringify(partial));
    await page.screenshot({ path: path.join(SHOTS, 'align-3-partial-fail.png') });
    await page.close();
  }

  /* ════ 4. align.html: idsが1件以下なら全体エラー表示 ════ */
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
