/* マニュアル閲覧画面のレイアウト検証（PC=画像の右にコメント / モバイル=縦積み）
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

const manualFixture = () => ({
  id: 12, title: 'ロボット溶接の段取り', description: '初回セットアップ手順', status: 'published',
  updated_at: '2026-08-03T00:00:00Z', cover_file_id: 101,
  steps: [
    { id: 71, type: 'heading', sort_order: 1, caption: null, body: '準備', file: null },
    { id: 72, type: 'photo', sort_order: 2, caption: '電源をOFFにしてから治具を外す。長めのコメントでも右側に回り込むことを確認する。', body: null,
      file: { id: 101, file_name: 'robot.jpg', mime_type: 'image/jpeg', updated_at: '2026-08-01T00:00:00Z' } },
    { id: 73, type: 'file', sort_order: 3, caption: '加工図面を参照', body: null,
      file: { id: 102, file_name: 'zumen.pdf', mime_type: 'application/pdf', updated_at: '2026-08-01T00:00:00Z' } },
    { id: 74, type: 'text', sort_order: 4, caption: null, body: '注意: 保護具を必ず着用すること', file: null },
  ],
});

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ serviceWorkers: 'block' });

  await ctx.addInitScript(() => {
    const u = JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com', company_id: 1 });
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', u);
    localStorage.setItem('space_token', 'mock-token-e2e');
    localStorage.setItem('space_user', u);
  });

  /* サムネイル用のダミーPNG（横長=実写真に近い比率） */
  const genPage = await ctx.newPage();
  await genPage.goto('about:blank');
  const b64 = await genPage.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    const g = c.getContext('2d'); g.fillStyle = '#456'; g.fillRect(0, 0, 640, 480);
    return c.toDataURL('image/png').split(',')[1];
  });
  await genPage.close();
  const pngBuf = Buffer.from(b64, 'base64');

  async function openView(page) {
    page.on('pageerror', e => console.log('PAGE ERROR(manual-view):', e.message));
    await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
    await page.route('**/api/wn/files/*/thumb*', r => r.fulfill({ contentType: 'image/png', body: pngBuf }));
    await page.route('**/api/wn/manuals/12', r => r.fulfill({ json: { data: manualFixture() } }));
    await page.goto(`${BASE}/app/manual-view.html?id=12`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.v-step', { timeout: 5000 });
    await page.waitForTimeout(300);
  }

  /* ════ 1. PC（1280px）: コメントが画像の右側 ════ */
  {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await openView(page);

    const box = await page.evaluate(() => {
      const shot = document.querySelector('.v-shot');
      const cap = document.querySelector('.v-step .v-cap');
      const r1 = shot.getBoundingClientRect(), r2 = cap.getBoundingClientRect();
      return { shot: { x: r1.x, y: r1.y, w: r1.width, h: r1.height },
               cap: { x: r2.x, y: r2.y, w: r2.width, h: r2.height } };
    });
    check('PC: コメントが画像の右に開始する', box.cap.x >= box.shot.x + box.shot.w - 1,
      `img.right=${Math.round(box.shot.x + box.shot.w)} cap.x=${Math.round(box.cap.x)}`);
    check('PC: コメントが画像と同じ高さ帯にある', box.cap.y < box.shot.y + box.shot.h,
      `img.y=${Math.round(box.shot.y)} cap.y=${Math.round(box.cap.y)}`);
    check('PC: コメント幅が十分にある', box.cap.w >= 200, `cap.w=${Math.round(box.cap.w)}`);

    /* ファイル行ステップが潰れていないこと */
    const fw = await page.evaluate(() => document.querySelector('.v-filerow').getBoundingClientRect().width);
    check('PC: ファイル行が潰れていない', fw >= 200, `filerow.w=${Math.round(fw)}`);

    /* 横スクロールが発生しないこと */
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('PC: 横スクロールなし', overflow <= 0, `overflow=${overflow}`);

    await page.screenshot({ path: path.join(SHOTS, 'manual-view-pc.png'), fullPage: true });
    await page.close();
  }

  /* ════ 2. モバイル（390px）: 従来どおり縦積み ════ */
  {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await openView(page);

    const box = await page.evaluate(() => {
      const shot = document.querySelector('.v-shot');
      const cap = document.querySelector('.v-step .v-cap');
      const r1 = shot.getBoundingClientRect(), r2 = cap.getBoundingClientRect();
      return { shot: { x: r1.x, y: r1.y, w: r1.width, h: r1.height }, cap: { x: r2.x, y: r2.y } };
    });
    check('SP: コメントが画像の下にある', box.cap.y >= box.shot.y + box.shot.h - 1,
      `img.bottom=${Math.round(box.shot.y + box.shot.h)} cap.y=${Math.round(box.cap.y)}`);

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('SP: 横スクロールなし', overflow <= 0, `overflow=${overflow}`);

    await page.screenshot({ path: path.join(SHOTS, 'manual-view-sp.png'), fullPage: true });
    await page.close();
  }

  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  process.exit(failed.length ? 1 : 0);
})();
