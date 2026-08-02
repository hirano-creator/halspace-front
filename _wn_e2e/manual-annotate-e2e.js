/* マニュアル編集画面のサムネイル → 注釈編集（annotate.html）導線のE2E検証
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

const STUB = { contentType: 'text/html', body: '<html><body>stub</body></html>' };

/* マニュアル: 見出し / 写真(表紙) / PDF / Excel(注釈非対応) */
const manualFixture = () => ({
  id: 12, title: 'test', description: '', status: 'draft', cover_file_id: 101,
  steps: [
    { id: 71, type: 'heading', sort_order: 1, caption: null, body: 'ロボット溶接-機械加工', file: null },
    { id: 72, type: 'photo', sort_order: 2, caption: '2台のロボット', body: null,
      file: { id: 101, file_name: 'robot.jpg', mime_type: 'image/jpeg', updated_at: '2026-08-01T00:00:00Z' } },
    { id: 73, type: 'file', sort_order: 3, caption: '加工図面', body: null,
      file: { id: 102, file_name: 'zumen.pdf', mime_type: 'application/pdf', updated_at: '2026-08-01T00:00:00Z' } },
    { id: 74, type: 'file', sort_order: 4, caption: '管理台帳', body: null,
      file: { id: 103, file_name: 'daicho.xlsx', updated_at: '2026-08-01T00:00:00Z',
              mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } },
  ],
});

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 900, height: 1000 } });

  await ctx.addInitScript(() => {
    const u = JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com', company_id: 1 });
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', u);
    localStorage.setItem('space_token', 'mock-token-e2e');
    localStorage.setItem('space_user', u);
  });

  /* サムネイル用のダミーPNG */
  const genPage = await ctx.newPage();
  await genPage.goto('about:blank');
  const b64 = await genPage.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 120; c.height = 120;
    const g = c.getContext('2d'); g.fillStyle = '#456'; g.fillRect(0, 0, 120, 120);
    return c.toDataURL('image/png').split(',')[1];
  });
  await genPage.close();
  const pngBuf = Buffer.from(b64, 'base64');

  /* マニュアル編集画面を開く共通処理 */
  async function openManualEdit(page, opts = {}) {
    page.on('pageerror', e => console.log('PAGE ERROR(manual-edit):', e.message));
    await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
    await page.route('**/api/wn/files/*/thumb*', r => r.fulfill({ contentType: 'image/png', body: pngBuf }));
    await page.route('**/api/wn/manuals/12', r => r.fulfill({ json: { data: manualFixture() } }));
    if (opts.stubAnnotate) await page.route('**/app/annotate.html*', r => r.fulfill(STUB));
    await page.goto(`${BASE}/app/manual-edit.html?id=12`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.e-step', { timeout: 5000 });
  }

  /* ════ 1. サムネイルの clickable 判定（画像・PDFのみ） ════ */
  {
    const page = await ctx.newPage();
    await openManualEdit(page);

    const info = await page.evaluate(() => {
      const steps = [...document.querySelectorAll('.e-step')];
      return steps.map(s => {
        const t = s.querySelector('.e-thumb');
        return t ? { cls: t.className, onclick: t.getAttribute('onclick'), title: t.getAttribute('title') } : null;
      });
    });

    check('見出しステップにはサムネイルが無い', info[0] === null, JSON.stringify(info[0]));
    check('写真(jpg)サムネがクリック可能', /annotatable/.test(info[1].cls) && info[1].onclick === 'openAnnotate(72)', JSON.stringify(info[1]));
    check('PDFサムネがクリック可能', /annotatable/.test(info[2].cls) && info[2].onclick === 'openAnnotate(73)', JSON.stringify(info[2]));
    check('Excelサムネはクリック不可（従来どおり）', !/annotatable/.test(info[3].cls) && info[3].onclick === null, JSON.stringify(info[3]));
    check('クリック可能サムネに説明ツールチップがある', info[1].title === 'クリックして注釈を編集', String(info[1].title));

    const cursor = await page.$eval('.e-thumb.annotatable', el => getComputedStyle(el).cursor);
    check('クリック可能サムネのカーソルが pointer', cursor === 'pointer', cursor);

    await page.screenshot({ path: path.join(SHOTS, 'manual-edit-annotatable.png'), fullPage: true });
    await page.close();
  }

  /* ════ 2. 写真クリック → annotate.html へ正しいパラメータで遷移（表紙なので cover=1） ════ */
  {
    const page = await ctx.newPage();
    await openManualEdit(page, { stubAnnotate: true });
    await page.click('.e-step:nth-child(2) .e-thumb');
    await page.waitForURL('**/annotate.html*', { timeout: 5000 });

    const u = new URL(page.url());
    const q = u.searchParams;
    check('遷移先が annotate.html', u.pathname.endsWith('/app/annotate.html'), u.pathname);
    check('id が写真のファイルID', q.get('id') === '101', String(q.get('id')));
    check('back がマニュアル編集画面のURL全体', q.get('back') === 'manual-edit.html?id=12', String(q.get('back')));
    check('manual_id / step_id を渡す', q.get('manual_id') === '12' && q.get('step_id') === '72',
      `${q.get('manual_id')}/${q.get('step_id')}`);
    check('表紙の写真なので cover=1', q.get('cover') === '1', String(q.get('cover')));
    await page.close();
  }

  /* ════ 3. PDFクリック → cover は付かない ════ */
  {
    const page = await ctx.newPage();
    await openManualEdit(page, { stubAnnotate: true });
    await page.click('.e-step:nth-child(3) .e-thumb');
    await page.waitForURL('**/annotate.html*', { timeout: 5000 });

    const q = new URL(page.url()).searchParams;
    check('PDFステップのIDが渡る', q.get('id') === '102' && q.get('step_id') === '73', `${q.get('id')}/${q.get('step_id')}`);
    check('表紙でなければ cover は付かない', q.get('cover') === null, String(q.get('cover')));
    await page.close();
  }

  /* ════ 4. Excelサムネをクリックしても遷移しない ════ */
  {
    const page = await ctx.newPage();
    await openManualEdit(page, { stubAnnotate: true });
    await page.click('.e-step:nth-child(4) .e-thumb');
    await page.waitForTimeout(600);
    check('注釈非対応のサムネはクリックしても遷移しない', page.url().includes('manual-edit.html'), page.url());
    await page.close();
  }

  /* ════ 5. 入力中のキャプションを取りこぼさずに遷移する ════ */
  {
    const page = await ctx.newPage();
    let patchBody = null, patchFulfilled = false;
    page.on('pageerror', e => console.log('PAGE ERROR(caption):', e.message));
    await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
    await page.route('**/api/wn/files/*/thumb*', r => r.fulfill({ contentType: 'image/png', body: pngBuf }));
    await page.route('**/api/wn/manuals/12', r => r.fulfill({ json: { data: manualFixture() } }));
    /* 保存を 400ms 遅らせる: 待ち合わせが無ければ遷移でリクエストが中断される */
    await page.route('**/api/wn/manuals/12/steps/72', async r => {
      patchBody = r.request().postDataJSON();
      await new Promise(res => setTimeout(res, 400));
      try {
        await r.fulfill({ json: { data: { id: 72 } } });
        patchFulfilled = true;
      } catch (_) { patchFulfilled = false; }
    });
    await page.route('**/app/annotate.html*', r => r.fulfill(STUB));

    await page.goto(`${BASE}/app/manual-edit.html?id=12`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.e-step', { timeout: 5000 });

    /* 写真ステップのキャプションを書き換え、Enterもblurもせずに別のサムネをクリック */
    await page.fill('.e-step:nth-child(2) .e-scap input', '電源をOFFにする');
    await page.click('.e-step:nth-child(3) .e-thumb');
    await page.waitForURL('**/annotate.html*', { timeout: 5000 });

    check('キャプションのPATCHが送信された', patchBody && patchBody.caption === '電源をOFFにする', JSON.stringify(patchBody));
    check('遷移前に保存が完走している（中断されない）', patchFulfilled === true, String(patchFulfilled));
    await page.close();
  }

  /* annotate.html を開く共通処理（ファイル取得は失敗させ、URL周りのロジックだけ見る） */
  async function openAnnotate(page, query, extraRoutes) {
    page.on('pageerror', e => console.log('PAGE ERROR(annotate):', e.message));
    await page.route('**/api/wn/**', r => r.fulfill({ status: 404, json: { message: 'not found' } }));
    if (extraRoutes) await extraRoutes(page);
    await page.goto(`${BASE}/app/annotate.html?${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.backUrl === 'function', { timeout: 8000 });
  }

  /* ════ 6. 戻るボタンが back のURLへ戻る ════ */
  {
    const page = await ctx.newPage();
    await openAnnotate(page, 'id=101&back=' + encodeURIComponent('manual-edit.html?id=12') + '&manual_id=12&step_id=72');
    const back = await page.evaluate(() => backUrl());
    check('backUrl() が manual-edit.html?id=12 を返す', back === 'manual-edit.html?id=12', back);

    await page.route('**/app/manual-edit.html*', r => r.fulfill(STUB));
    /* ファイル取得を404にしているためローディングオーバーレイが残る。閉じてから実クリック */
    await page.evaluate(() => setLoading(false));
    await page.click('#backBtn');
    await page.waitForURL('**/manual-edit.html*', { timeout: 5000 });
    check('戻るボタンでマニュアル編集画面に戻る', page.url().endsWith('/app/manual-edit.html?id=12'), page.url());
    await page.close();
  }

  /* ════ 7. 不正な back は無視して従来の戻り先にフォールバック ════ */
  {
    const page = await ctx.newPage();
    await openAnnotate(page, 'id=101&back=' + encodeURIComponent('https://example.com/evil'));
    const back = await page.evaluate(() => backUrl());
    check('外部URLの back は採用しない', back === 'file-detail.html?id=101', back);

    const page2 = await ctx.newPage();
    await openAnnotate(page2, 'id=101&from=file-detail.html');
    const back2 = await page2.evaluate(() => backUrl());
    check('back 無しは従来どおり from + fileId（既存導線の互換）', back2 === 'file-detail.html?id=101', back2);
    await page.close(); await page2.close();
  }

  /* ════ 8. 保存後の再ロードURLがマニュアル用パラメータを保持する ════ */
  {
    const page = await ctx.newPage();
    await openAnnotate(page, 'id=101&back=' + encodeURIComponent('manual-edit.html?id=12') + '&manual_id=12&step_id=72&cover=1');
    const self = await page.evaluate(() => selfUrl('999', true));
    const q = new URL(self, 'http://x/').searchParams;
    check('selfUrl が新ファイルIDに差し替わる', q.get('id') === '999', String(q.get('id')));
    check('selfUrl が saved=1 を付ける', q.get('saved') === '1', String(q.get('saved')));
    check('selfUrl が back/manual_id/step_id/cover を保持する',
      q.get('back') === 'manual-edit.html?id=12' && q.get('manual_id') === '12'
      && q.get('step_id') === '72' && q.get('cover') === '1', self);

    const noSaved = await page.evaluate(() => selfUrl('999', false));
    check('selfUrl(saved=false) は saved を落とす', !noSaved.includes('saved='), noSaved);
    await page.close();
  }

  /* ════ 9. 新バージョン保存でステップと表紙が新ファイルへ差し替わる ════ */
  {
    const page = await ctx.newPage();
    let stepPatch = null, manualPatch = null;
    await openAnnotate(page,
      'id=101&back=' + encodeURIComponent('manual-edit.html?id=12') + '&manual_id=12&step_id=72&cover=1',
      async p => {
        await p.route('**/api/wn/manuals/12/steps/72', r => {
          stepPatch = { method: r.request().method(), body: r.request().postDataJSON() };
          r.fulfill({ json: { data: { id: 72, file: { id: 999 } } } });
        });
        await p.route('**/api/wn/manuals/12', r => {
          manualPatch = { method: r.request().method(), body: r.request().postDataJSON() };
          r.fulfill({ json: { data: { id: 12 } } });
        });
      });

    await page.evaluate(() => repointManualStep(999));
    check('ステップを新ファイルへ差し替える PATCH が飛ぶ',
      stepPatch && stepPatch.method === 'PATCH' && stepPatch.body.file_id === 999, JSON.stringify(stepPatch));
    check('表紙(cover=1)も新ファイルへ追従する',
      manualPatch && manualPatch.body.cover_file_id === 999, JSON.stringify(manualPatch));
    await page.close();
  }

  /* ════ 10. マニュアル経由でない場合は差し替えAPIを呼ばない（既存導線の非リグレッション） ════ */
  {
    const page = await ctx.newPage();
    let called = false;
    await openAnnotate(page, 'id=101&from=file-detail.html', async p => {
      await p.route('**/api/wn/manuals/**', r => { called = true; r.fulfill({ json: { data: {} } }); });
    });
    await page.evaluate(() => repointManualStep(999));
    await page.waitForTimeout(300);
    check('file-detail 経由ではマニュアルAPIを呼ばない', called === false, String(called));
    await page.close();
  }

  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log(' - ' + f.name + (f.detail ? ' — ' + f.detail : ''))); }
  process.exit(failed.length ? 1 : 0);
})();
