/* マニュアル機能のサムネイル検証（wn-thumb.js）
   ・PDF はサーバーが 404 を返す種別なので、画面側で生成して表示する
   ・生成したサムネはサーバーへ POST され、次回以降は即配信になる
   ・サーバーに保存済みの画像は生成せずそのまま出す（POSTしない）
   ・生成も保存もできない種別（xlsx）は崩れずアイコン/ファイル行のまま
   ・一覧の表紙・編集画面（行/右ペイン）・ファイル選択モーダルでも同じ扱い
   （バックエンドなし・APIモック） */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');
const path = require('path');

const BASE  = 'http://127.0.0.1:8765/whatsno';
const SHOTS = path.join(__dirname, 'shots');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

/* 1ページのPDFを組み立てる（pdf.js が実際に描画できる本物のPDF） */
function makePdf(stream) {
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>';
  objs[4] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefPos = out.length;
  out += `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

/* 図面らしく枠線と文字を入れる（余白トリミングが効くよう中央寄りに描く） */
const PDF = makePdf('BT /F1 36 Tf 120 600 Td (DRAWING A-1024) Tj ET 4 w 100 200 400 500 re S 150 300 m 450 650 l S');

/* 1x1 PNG（サーバー保存済みサムネの代役） */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

const F_PHOTO = { id: 11, file_name: '取り外した部品.jpg', mime_type: 'image/jpeg', updated_at: '2026-08-01T00:00:00Z' };
const F_PDF   = { id: 12, file_name: '組立図_A-1024.pdf', mime_type: 'application/pdf', updated_at: '2026-08-01T00:00:00Z' };
const F_XLS   = { id: 13, file_name: '点検記録.xlsx',      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', updated_at: '2026-08-01T00:00:00Z' };

const STEPS = [
  { id: 51, type: 'photo', sort_order: 1, caption: '主電源をOFFにする', body: null, file: F_PHOTO },
  { id: 52, type: 'file',  sort_order: 2, caption: '組立図の寸法を確認', body: null, file: F_PDF },
  { id: 53, type: 'file',  sort_order: 3, caption: '記録票に記入',       body: null, file: F_XLS },
];

const MANUAL = {
  id: 5, title: '集塵機フィルター交換手順', description: '', status: 'published',
  cover_file_id: F_PDF.id, cover: F_PDF, step_count: 3,
  created_by: 1, created_by_name: '田中', created_at: '2026-08-01', updated_at: '2026-08-01',
  tags: [], steps: STEPS,
};

/* 旧API（file_name を返さない表紙）でも mime_type だけでPDFと判定できること */
const MANUAL_OLD_COVER = {
  ...MANUAL, id: 6, title: '旧APIの表紙（file_name なし）',
  cover: { id: F_PDF.id, mime_type: 'application/pdf', updated_at: F_PDF.updated_at },
};

/* サーバーへ保存された（＝クライアントが生成した）ファイルIDを記録する */
const storedThumbs = [];

async function routeAll(page) {
  await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));

  /* 具体パスは汎用の後に登録（LIFOで先に当たる） */
  await page.route('**/wn/files/*/thumb*', r => {
    const req = r.request();
    const id  = req.url().match(/\/files\/(\d+)\/thumb/)[1];
    if (req.method() === 'POST') {          /* クライアント生成サムネの保存 */
      storedThumbs.push(Number(id));
      return r.fulfill({ json: { ok: true } });
    }
    /* 画像はサーバーが生成できる。PDF/Officeは 404 を返す（本番と同じ） */
    if (id === String(F_PHOTO.id)) return r.fulfill({ contentType: 'image/png', body: PNG_1x1 });
    return r.fulfill({ status: 404, json: { message: 'thumbnail not available' } });
  });
  await page.route('**/wn/files/*/public-view*', r => {
    const id = r.request().url().match(/\/files\/(\d+)\/public-view/)[1];
    if (id === String(F_PDF.id)) return r.fulfill({ contentType: 'application/pdf', body: PDF });
    return r.fulfill({ contentType: 'image/png', body: PNG_1x1 });
  });
  await page.route('**/api/wn/manuals/5', r => r.fulfill({ json: { data: MANUAL } }));
  await page.route('**/api/wn/manuals/tags*', r => r.fulfill({ json: { data: [] } }));
  await page.route('**/api/wn/manuals?**', r => r.fulfill({
    json: { data: [MANUAL, MANUAL_OLD_COVER], meta: { current_page: 1, last_page: 1, per_page: 24, total: 2 } },
  }));
  await page.route('**/api/wn/files?**', r => r.fulfill({
    json: { data: [F_PHOTO, F_PDF, F_XLS], meta: { current_page: 1, last_page: 1, total: 3 } },
  }));
}

function newPage(ctx, width, height) {
  return (async () => {
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
    await page.setViewportSize({ width, height });
    await routeAll(page);
    return page;
  })();
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({
      id: 1, name: 'テスト', role: 'admin', email: 't@example.com', wn_extended_options_enabled: true,
    }));
  });

  /* ════ 1. 閲覧画面: PDFがサムネイルになる（クライアント生成） ════ */
  {
    const page = await newPage(ctx, 1280, 900);
    await page.goto(`${BASE}/app/manual-view.html?id=5`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.v-step', { timeout: 8000 });

    /* pdf.js の遅延読込＋描画があるので長めに待つ */
    const pdfShot = await page.waitForSelector('.v-fileshot.wn-has-thumb img.v-shot', { timeout: 30000 })
      .catch(() => null);
    check('閲覧: PDFの手順にサムネイルが出る', !!pdfShot);

    if (pdfShot) {
      const size = await pdfShot.evaluate(el => ({ w: el.naturalWidth, h: el.naturalHeight }));
      check('閲覧: PDFサムネが実画像として読めている', size.w > 100 && size.h > 100, JSON.stringify(size));
      /* 白紙ではなく中身が描かれているか（明るいピクセルだけではない） */
      const inked = await pdfShot.evaluate(el => {
        const c = document.createElement('canvas');
        c.width = el.naturalWidth; c.height = el.naturalHeight;
        c.getContext('2d').drawImage(el, 0, 0);
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let dark = 0;
        for (let i = 0; i < d.length; i += 4 * 37) if (d[i] < 200) dark++;
        return dark;
      });
      check('閲覧: PDFサムネが白紙でない', inked > 0, `暗いピクセル=${inked}`);
    }

    check('閲覧: 生成したサムネをサーバーへ保存している', storedThumbs.includes(F_PDF.id),
      JSON.stringify(storedThumbs));
    check('閲覧: サーバーにある画像は作り直さない', !storedThumbs.includes(F_PHOTO.id),
      JSON.stringify(storedThumbs));

    const photoOk = await page.waitForSelector('.v-shotwrap.wn-has-thumb img.v-shot', { timeout: 10000 })
      .then(() => true).catch(() => false);
    check('閲覧: 写真の手順は従来どおりサムネイルが出る', photoOk);

    /* xlsx は生成できない → 枠を出さず、ファイル行だけが残る */
    const xls = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.v-step')];
      const last = rows[rows.length - 1];
      const shot = last.querySelector('.v-fileshot');
      return {
        hasThumb: !!(shot && shot.classList.contains('wn-has-thumb')),
        shotVisible: !!(shot && shot.getClientRects().length),
        fileRow: !!last.querySelector('.v-filerow'),
        name: last.querySelector('.v-fn')?.textContent,
      };
    });
    check('閲覧: 生成できない種別は空の枠を出さない', !xls.hasThumb && !xls.shotVisible, JSON.stringify(xls));
    check('閲覧: 生成できない種別もファイル行は出る', xls.fileRow && /xlsx/.test(xls.name || ''), JSON.stringify(xls));

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('閲覧: 横スクロールなし', overflow <= 0, `overflow=${overflow}`);

    await page.screenshot({ path: path.join(SHOTS, 'manual-thumb-view.png'), fullPage: true });
    await page.close();
  }

  /* ════ 2. 一覧: 表紙がPDFでもサムネイルが出る ════ */
  {
    const page = await newPage(ctx, 1280, 900);
    await page.goto(`${BASE}/app/manuals.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.m-card', { timeout: 8000 });
    const ok = await page.waitForSelector('.m-cover.wn-has-thumb img', { timeout: 30000 })
      .then(() => true).catch(() => false);
    check('一覧: PDFの表紙がサムネイルで出る', ok);

    /* API が file_name を返さない旧レスポンスでも mime_type だけで判定できる */
    await page.waitForTimeout(1500);
    const covers = await page.locator('.m-cover.wn-has-thumb img').count();
    check('一覧: file_name が無い表紙でもサムネイルが出る', covers === 2, `${covers}件`);
    await page.screenshot({ path: path.join(SHOTS, 'manual-thumb-list.png'), fullPage: true });
    await page.close();
  }

  /* ════ 3. 編集画面(PC=二面): 行リストと右ペインの両方にサムネイル ════ */
  {
    const page = await newPage(ctx, 1280, 900);
    await page.goto(`${BASE}/app/manual-edit.html?id=5`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.e-row', { timeout: 8000 });

    const rowOk = await page.waitForSelector('.e-row:nth-child(2) .e-rowth img', { timeout: 30000 })
      .then(() => true).catch(() => false);
    check('編集: 手順リストのPDFにサムネイルが出る', rowOk);

    await page.locator('.e-row').nth(1).click();
    const detailOk = await page.waitForSelector('.e-detail-shot img', { timeout: 30000 })
      .then(() => true).catch(() => false);
    check('編集: 右ペインのPDFにサムネイルが出る', detailOk);

    /* 枠に対して小さく表示されていないこと（幅か高さのどちらかが枠いっぱい） */
    const fit = await page.evaluate(() => {
      const img = document.querySelector('.e-detail-shot img');
      const box = document.querySelector('.e-detail-shot');
      if (!img || !box) return null;
      const i = img.getBoundingClientRect(), b = box.getBoundingClientRect();
      return { fillW: i.width / b.width, fillH: i.height / b.height,
               natural: img.naturalWidth, boxW: Math.round(b.width) };
    });
    check('編集: 右ペインのサムネイルが枠いっぱいに表示される',
      fit && (fit.fillW > 0.95 || fit.fillH > 0.95), JSON.stringify(fit));
    check('編集: 右ペインは拡大表示用の大きい版を使う（引き伸ばしでぼやけない）',
      fit && fit.natural >= 1000, JSON.stringify(fit));

    /* ファイル選択モーダル（What'sNoから選ぶ）でもPDFがサムネイルになる */
    await page.click('#addFile');
    await page.waitForSelector('.e-pick-item', { timeout: 8000 });
    const pickOk = await page.waitForSelector('.e-pick-thumb.wn-has-thumb img', { timeout: 30000 })
      .then(() => true).catch(() => false);
    check('編集: ファイル選択でもサムネイルが出る', pickOk);

    const pickCount = await page.locator('.e-pick-thumb.wn-has-thumb img').count();
    check('編集: 画像とPDFの2件がサムネイルになる（xlsxはアイコン）', pickCount === 2, `${pickCount}件`);

    await page.screenshot({ path: path.join(SHOTS, 'manual-thumb-edit.png'), fullPage: true });
    await page.close();
  }

  /* ════ 4. スマホ幅（1列カード）でもPDFがサムネイルになる ════ */
  {
    const page = await newPage(ctx, 390, 844);
    await page.goto(`${BASE}/app/manual-edit.html?id=5`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.e-step', { timeout: 8000 });
    const ok = await page.waitForSelector('.e-thumb.file.wn-has-thumb img', { timeout: 30000 })
      .then(() => true).catch(() => false);
    check('編集(スマホ): PDFのカードにサムネイルが出る', ok);

    const bgOk = await page.evaluate(() => {
      const el = document.querySelector('.e-thumb.file.wn-has-thumb');
      return el ? getComputedStyle(el).backgroundColor : '';
    });
    check('編集(スマホ): サムネ表示後はアイコン用の青地を残さない',
      bgOk !== 'rgb(238, 240, 255)', bgOk);

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('編集(スマホ): 横スクロールなし', overflow <= 0, `overflow=${overflow}`);

    await page.screenshot({ path: path.join(SHOTS, 'manual-thumb-edit-sp.png'), fullPage: true });
    await page.close();
  }

  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    console.log('FAILED:');
    failed.forEach(f => console.log(' - ' + f.name + (f.detail ? ' — ' + f.detail : '')));
    process.exit(1);
  }
})();
