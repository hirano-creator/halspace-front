/* ファイル詳細「手元のアプリで編集して戻す」のE2E検証（バックエンドなし・APIモック）

   確認すること:
   - Excel/Word ではメニュー「加工・出力」に「Excel で編集」「編集したファイルを戻す」が出る。PDF では出ない
   - 「Excel で編集」でダウンロードが走り、手順の画面が開く
   - 名前の違うファイルを戻すと、元の名前・元のフォルダーで POST /wn/files される（＝API が新しいバージョンにする）
   - 形式が違うファイルは送らない
   - 編集中に新しい版が上がっていたら確認を出し、キャンセルなら送らない
   - 成功したら新しい版の詳細へ移動する
   - 個人保管モードで持ち主以外のときは「戻す」を出さない

   実行: node _wn_e2e/office-edit-back-e2e.js（サーバーはこのスクリプトが立てる） */
let pw;
try { pw = require('../_aa_e2e/node_modules/playwright-core'); }
catch { pw = require('c:/dev/my-programming/_aa_e2e/node_modules/playwright-core'); }   /* worktree から動かすとき */
const { chromium } = pw;
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8797;
const BASE = `http://127.0.0.1:${PORT}/whatsno`;

const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
               '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml',
               '.png':'image/png', '.json':'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404); return res.end('nf');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function fileOf(overrides = {}) {
  return {
    id: 1, file_name: '検査成績書_A-102.xlsx', mime_type: XLSX_MIME, file_size: 12000,
    version: 2, folder_id: 5, created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T00:00:00Z',
    uploader: { id: 1, name: '平野' }, tags: [], like_count: 0, liked: false, view_count: 1,
    approval_status: null, visibility: 'company', can_edit: true, ...overrides,
  };
}

async function openDetail(browser, { file = fileOf(), latest = 2, storage = 'company' } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(u => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', u);
  }, JSON.stringify({
    id: 1, name: '平野', role: 'admin', email: 't@example.com', company_id: 1,
    apps: ['whatsno'], wn_extended_options_enabled: true, wn_storage_mode: storage,
  }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  const calls = { uploads: [], downloads: 0 };
  /* wnDownload は別タブでダウンロードURLを開くので、タブをまたいで数える */
  await ctx.route('**/api/wn/files/1/download*', r => { calls.downloads++; return r.fulfill({ body: 'x' }); });
  await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
  await page.route('**/api/wn/files/1', r => r.fulfill({ json: { data: file } }));
  await page.route('**/api/wn/files/1/view*', r => r.fulfill({ json: { url: null } }));
  await page.route('**/api/wn/files/1/versions', r => r.fulfill({ json: { data:
    Array.from({ length: latest }, (_, i) => ({ id: i === latest - 1 ? 1 : 100 + i, version: i + 1, file_name: file.file_name, file_size: 1 })) } }));
  await page.route(/\/api\/wn\/files(\?.*)?$/, r => {
    if (r.request().method() !== 'POST') return r.fulfill({ json: { data: [] } });
    const h = r.request().headers();
    calls.uploads.push({ name: decodeURIComponent(h['x-file-name'] || ''), folder: h['x-folder-id'] || null });
    return r.fulfill({ status: 201, json: { data: { ...file, id: 77, version: latest + 1 } } });
  });
  await page.route('**/whatsno/app/file-detail.html?id=77', r => r.fulfill({ contentType: 'text/html', body: '<p id="moved">moved</p>' }));

  await page.goto(`${BASE}/app/file-detail.html?id=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.getElementById('topFileName').textContent.length > 0);
  await page.waitForTimeout(300);
  return { ctx, page, errors, calls };
}

const shown = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  return !!el && getComputedStyle(el).display !== 'none';
}, sel);

async function pickFile(page, name) {
  await page.setInputFiles('#officeEditInput', { name, mimeType: XLSX_MIME, buffer: Buffer.from('edited') });
}

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    /* 1. Excel：項目が出る → 編集でダウンロード＋手順 → 名前違いを戻す → 元の名前・フォルダーで送る → 移動 */
    {
      const { ctx, page, errors, calls } = await openDetail(browser);
      check('Excel: 「Excel で編集」が出る', await shown(page, '#officeEditBtn')
        && (await page.textContent('#officeEditLabel')) === 'Excel で編集');
      check('Excel: 「編集したファイルを戻す」が出る', await shown(page, '#officeReturnBtn'));

      await page.click('.fd-dd:has(#officeEditBtn) [data-fd-menu]');
      await page.click('#officeEditBtn');
      check('編集でダウンロードが走る', (await page.waitForTimeout(500), calls.downloads) === 1, `downloads=${calls.downloads}`);
      check('手順の画面が開く', !(await page.getAttribute('#fdOfficeEditModal', 'class')).includes('hidden'));
      check('次のバージョン番号を案内する', (await page.textContent('#officeEditNextVer')).includes('v3'));

      await pickFile(page, 'コピー ～ 検査成績書_A-102(修正).xlsx');
      await page.waitForSelector('#moved', { timeout: 5000 }).catch(() => {});
      check('1回だけ送る', calls.uploads.length === 1, JSON.stringify(calls.uploads));
      check('元の名前にそろえて送る', calls.uploads[0]?.name === '検査成績書_A-102.xlsx', calls.uploads[0]?.name);
      check('元のフォルダーに送る', calls.uploads[0]?.folder === '5', calls.uploads[0]?.folder);
      check('新しい版の詳細へ移動する', page.url().endsWith('file-detail.html?id=77'), page.url());
      check('Excel: ページエラーなし', errors.length === 0, errors.join(' / '));
      await ctx.close();
    }

    /* 2. 形式違いは送らない */
    {
      const { ctx, page, calls } = await openDetail(browser);
      await page.evaluate(() => document.getElementById('fdOfficeEditModal').classList.remove('hidden'));
      await pickFile(page, '検査成績書_A-102.csv');
      await page.waitForTimeout(500);
      check('形式違いは送らない', calls.uploads.length === 0);
      await ctx.close();
    }

    /* 3. 編集中に新しい版 → 確認。キャンセルなら送らない／OKなら送る */
    {
      const { ctx, page, calls } = await openDetail(browser, { latest: 4 });
      let msg = '';
      page.once('dialog', d => { msg = d.message(); d.dismiss(); });
      await pickFile(page, 'a.xlsx');
      await page.waitForTimeout(600);
      check('新しい版があると確認を出す', msg.includes('v4') && msg.includes('v5'), msg);
      check('キャンセルなら送らない', calls.uploads.length === 0);
      page.once('dialog', d => d.accept());
      await pickFile(page, 'a.xlsx');
      await page.waitForSelector('#moved', { timeout: 5000 }).catch(() => {});
      check('OKなら送る', calls.uploads.length === 1);
      await ctx.close();
    }

    /* 4. Word は「Word で編集」 */
    {
      const { ctx, page } = await openDetail(browser, { file: fileOf({ file_name: '手順書.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }) });
      check('Word: 「Word で編集」', (await page.textContent('#officeEditLabel')) === 'Word で編集');
      check('Word: 選べる形式が .docx', (await page.getAttribute('#officeEditInput', 'accept')) === '.docx');
      await ctx.close();
    }

    /* 5. PDF には出さない */
    {
      const { ctx, page } = await openDetail(browser, { file: fileOf({ file_name: '図面.pdf', mime_type: 'application/pdf' }) });
      check('PDF: 編集項目を出さない', !(await shown(page, '#officeEditBtn')) && !(await shown(page, '#officeReturnBtn')));
      await ctx.close();
    }

    /* 6. 個人保管モードで持ち主以外：編集（ダウンロード）はできるが戻せない */
    {
      const { ctx, page } = await openDetail(browser, { storage: 'personal', file: fileOf({ can_edit: false }) });
      check('他人のファイル: 「Excel で編集」は出る', await shown(page, '#officeEditBtn'));
      check('他人のファイル: 「戻す」は出さない', !(await shown(page, '#officeReturnBtn')));
      check('他人のファイル: 持ち主だけと案内', await shown(page, '#officeEditOwnerNote') && !(await shown(page, '#officeEditDrop')));
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  process.exit(failed ? 1 : 0);
})();
