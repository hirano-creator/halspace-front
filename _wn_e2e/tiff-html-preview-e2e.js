/* TIFF / HTML プレビューのE2E検証（バックエンドなし・APIモック）
   静的サーバー: python -m http.server 8765（my-programmingルート）
   - ファイル詳細: TIFF(Deflate/LZW/CCITT G4/マルチページ)が画像として表示される・注釈ボタンは出ない
   - ファイル詳細: HTML(Shift_JIS/UTF-8)が sandbox iframe に表示され、スクリプトは動かない
   - ダッシュボード / 並べる(wn-thumb.js): TIFF のサムネイルが JPEG 化されて出る */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:8765/whatsno';
const FIX  = path.join(__dirname, 'fixtures');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

const FILES = {
  201: { name: '図面_deflate.tif',  fix: 'sample-deflate.tif', mime: 'image/tiff', expect: [220, 0, 0] },
  202: { name: '図面_lzw.tif',      fix: 'sample-lzw.tif',     mime: 'image/tiff', expect: [0, 0, 220] },
  203: { name: '複数ページ.tiff',    fix: 'sample-multi.tiff',  mime: 'image/tiff', expect: [220, 0, 0] },
  204: { name: 'FAX.tif',           fix: 'sample-g4.tif',      mime: 'application/octet-stream', expect: [0, 0, 0] },
  301: { name: '見積書.html',        fix: 'sample-sjis.html',   mime: 'text/html' },
  302: { name: 'メモ.htm',           fix: 'sample-utf8.htm',    mime: 'application/octet-stream' },
};

async function mockFiles(page) {
  await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
  for (const [id, f] of Object.entries(FILES)) {
    const body = fs.readFileSync(path.join(FIX, f.fix));
    const data = { id: +id, file_name: f.name, mime_type: f.mime, file_size: body.length,
                   updated_at: '2026-09-30T00:00:00Z', created_at: '2026-09-30T00:00:00Z' };
    await page.route(`**/api/wn/files/${id}`, r => r.fulfill({ json: { data } }));
    await page.route(`**/api/wn/files/${id}/view`, r => r.fulfill({ json: { url: `http://127.0.0.1:8765/__fix_${id}` } }));
    await page.route(`**/__fix_${id}`, r => r.fulfill({ contentType: f.mime, body }));
    await page.route(`**/api/wn/files/${id}/public-view*`, r => r.fulfill({ contentType: f.mime, body }));
    await page.route(`**/api/wn/files/${id}/thumb*`, r => r.request().method() === 'POST'
      ? r.fulfill({ json: { ok: true } })
      : r.fulfill({ status: 404, json: { message: 'thumbnail not available' } }));
  }
}

/* 画像の中心付近の円の色を測る（描いた図形の色で「正しいページ・正しい色」を判定） */
async function sampleImg(page, sel) {
  return page.evaluate(sel => {
    const img = document.querySelector(sel);
    if (!img || !img.naturalWidth) return null;
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const x = Math.round(img.naturalWidth / 3 + img.naturalWidth * 0.075);
    const y = Math.round(img.naturalHeight / 3 + img.naturalHeight * 0.1);
    const d = g.getImageData(x, y, 1, 1).data;
    return { w: img.naturalWidth, h: img.naturalHeight, rgb: [d[0], d[1], d[2]] };
  }, sel);
}
const near = (a, b, tol = 40) => a && b && a.every((v, i) => Math.abs(v - b[i]) <= tol);

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    const u = JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com', company_id: 1, wn_extended_options_enabled: true });
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', u);
  });

  /* ════ 1. ファイル詳細: TIFF ════ */
  for (const id of [201, 202, 203, 204]) {
    const f = FILES[id];
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await mockFiles(page);
    await page.goto(`${BASE}/app/file-detail.html?id=${id}`, { waitUntil: 'domcontentloaded' });
    let s = null;
    try {
      await page.waitForSelector('#previewArea > img', { timeout: 15000 });
      s = await sampleImg(page, '#previewArea > img');
    } catch {}
    const hint = await page.textContent('#previewHint').catch(() => '');
    check(`詳細 TIFF表示 ${f.name}`, !!s && near(s.rgb, f.expect),
      s ? `${s.w}x${s.h} rgb=${s.rgb}` : `画像なし hint=${hint} ${errs.join(' / ')}`);
    const annot = await page.$eval('#annotateBtn', el => getComputedStyle(el).display).catch(() => 'none');
    check(`詳細 TIFF 注釈ボタン非表示 ${f.name}`, annot === 'none', annot);
    if (id === 201) await page.screenshot({ path: path.join(SHOTS, 'tiff-detail.png') });
    await page.close();
  }

  /* ════ 2. ファイル詳細: HTML ════ */
  for (const [id, expectText] of [[301, '見積書テスト'], [302, 'UTF8の見出し']]) {
    const f = FILES[id];
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await mockFiles(page);
    await page.goto(`${BASE}/app/file-detail.html?id=${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const fr = document.getElementById('previewFrame');
      return fr && fr.style.display === 'block' && fr.srcdoc
          && getComputedStyle(document.getElementById('previewPlaceholder')).display === 'none';
    }, null, { timeout: 15000 }).catch(() => {});
    const info = await page.evaluate(() => {
      const fr = document.getElementById('previewFrame');
      return { sandbox: fr.getAttribute('sandbox'), placeholder: getComputedStyle(document.getElementById('previewPlaceholder')).display,
               h: fr.getBoundingClientRect().height, title: document.title };
    });
    let h1 = null;
    for (const fr of page.mainFrame().childFrames()) {
      h1 = await fr.$eval('#h', el => el.textContent).catch(() => null);
      if (h1) break;
    }
    check(`詳細 HTML表示（文字化けなし） ${f.name}`, h1 === expectText, `h1=${h1} ${errs.join(' / ')}`);
    check(`詳細 HTML sandbox（スクリプト無効） ${f.name}`, info.sandbox === '' && h1 !== 'SCRIPT RAN' && info.title !== 'HACKED',
      JSON.stringify(info));
    check(`詳細 HTML 枠が表示されている ${f.name}`, info.placeholder === 'none' && info.h > 200, `h=${info.h}`);
    if (id === 301) await page.screenshot({ path: path.join(SHOTS, 'html-detail.png') });
    await page.close();
  }

  /* ════ 3. ダッシュボード: TIFF サムネイル（PC=原本<img>直貼りを通らない） ════ */
  {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await mockFiles(page);
    let uploaded = 0;
    await page.route('**/api/wn/files/201/thumb*', r => {
      if (r.request().method() === 'POST') { uploaded++; return r.fulfill({ json: { ok: true } }); }
      return r.fulfill({ status: 404, json: {} });
    });
    await page.goto(`${BASE}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof loadOneThumbnail === 'function', null, { timeout: 10000 });
    await page.evaluate(() => {
      const box = document.createElement('div');
      box.id = 'e2eBox';
      box.innerHTML = '<div class="file-card-thumb" style="position:relative;width:200px;height:150px"><i id="thumb-icon-201"></i></div>';
      document.body.appendChild(box);
      return loadOneThumbnail({ id: 201, file_name: '図面_deflate.tif', mime_type: 'image/tiff', updated_at: '2026-09-30T00:00:00Z' });
    });
    await page.waitForSelector('#e2eBox img', { timeout: 10000 }).catch(() => {});
    const s = await sampleImg(page, '#e2eBox img');
    const src = await page.$eval('#e2eBox img', el => el.src).catch(() => '');
    check('ダッシュボード TIFFサムネ表示', !!s && src.startsWith('blob:'), s ? `${s.w}x${s.h} src=${src.slice(0, 20)}` : `なし ${errs.join(' / ')}`);
    await page.waitForTimeout(500);
    check('ダッシュボード TIFFサムネをサーバーへ保存', uploaded === 1, `POST=${uploaded}`);
    await page.close();
  }

  /* ════ 4. 並べる(wn-thumb.js): TIFF サムネイル ════ */
  {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await mockFiles(page);
    await page.goto(`${BASE}/app/align.html?ids=202,203`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('img[src^="blob:"]').length >= 2, null, { timeout: 15000 }).catch(() => {});
    const n = await page.$$eval('img[src^="blob:"]', els => els.filter(e => e.naturalWidth > 0).length);
    check('並べる TIFFサムネ表示', n >= 2, `blob img=${n} ${errs.join(' / ')}`);
    await page.screenshot({ path: path.join(SHOTS, 'tiff-align.png') });
    await page.close();
  }

  /* ════ 5. ダッシュボード: HTML サムネイル（SVG foreignObject 経由・スクリプトは動かない） ════ */
  {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await mockFiles(page);
    let uploaded = 0;
    await page.route('**/api/wn/files/301/thumb*', r => {
      if (r.request().method() === 'POST') { uploaded++; return r.fulfill({ json: { ok: true } }); }
      return r.fulfill({ status: 404, json: {} });
    });
    await page.goto(`${BASE}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof loadOneThumbnail === 'function', null, { timeout: 10000 });
    const card = await page.evaluate(() => fileCardHtml({ id: 301, file_name: '見積書.html', mime_type: 'text/html', file_size: 1000 }));
    check('ダッシュボード HTMLカードにサムネ受け皿', card.includes('id="thumb-icon-301"'));
    await page.evaluate(() => {
      const box = document.createElement('div');
      box.id = 'e2eBoxH';
      box.innerHTML = '<div class="file-card-thumb" style="position:relative;width:200px;height:150px"><i id="thumb-icon-301"></i></div>';
      document.body.appendChild(box);
      return loadOneThumbnail({ id: 301, file_name: '見積書.html', mime_type: 'text/html', file_size: 1000, updated_at: '2026-09-30T00:00:00Z' });
    });
    await page.waitForSelector('#e2eBoxH img', { timeout: 10000 }).catch(() => {});
    const src = await page.$eval('#e2eBoxH img', el => el.naturalWidth > 0 ? el.src : '').catch(() => '');
    const title = await page.title();
    check('ダッシュボード HTMLサムネ表示', src.startsWith('blob:'), `src=${src.slice(0, 20)} ${errs.join(' / ')}`);
    check('ダッシュボード HTMLサムネ生成でスクリプトが動かない', title !== 'HACKED', title);
    await page.waitForTimeout(500);
    check('ダッシュボード HTMLサムネをサーバーへ保存', uploaded === 1, `POST=${uploaded}`);
    await page.screenshot({ path: path.join(SHOTS, 'html-thumb-dashboard.png'), clip: { x: 0, y: 0, width: 1280, height: 900 } });
    await page.close();
  }

  /* ════ 6. 並べる(wn-thumb.js): HTML サムネイル ════ */
  {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await mockFiles(page);
    await page.goto(`${BASE}/app/align.html?ids=301,302`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('img[src^="blob:"]').length >= 2, null, { timeout: 15000 }).catch(() => {});
    const n = await page.$$eval('img[src^="blob:"]', els => els.filter(e => e.naturalWidth > 0).length);
    check('並べる HTMLサムネ表示', n >= 2, `blob img=${n} ${errs.join(' / ')}`);
    await page.screenshot({ path: path.join(SHOTS, 'html-align.png') });
    await page.close();
  }

  await browser.close();
  const fail = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - fail}/${results.length} PASS`);
  process.exit(fail ? 1 : 0);
})();
