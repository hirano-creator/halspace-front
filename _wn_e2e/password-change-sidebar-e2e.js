/* auth.js に追加した「パスワード変更」モーダル（全アプリ共通・サイドバー挿入方式）の検証。

   背景: これまで自分でパスワードを変えられる場所はSpaceのアプリ選択画面（apps.html）にしか
   無かった。SOLID独自ログイン（solid/login.html、Space.appを経由しないURL）で直接ログインした
   利用者はapps.htmlを一度も経由しないため、初期パスワードのまま変更する手段が無かった。
   auth.js（SOLID/What'sNo等の全ページから共有読み込みされる）のrequireSpaceAuth()にモーダル
   挿入フックを足すことで、サイドバーのあるページ全部（両アプリ）に一括で出るようにした。

   確認すること:
   - SOLID: サイドバーのあるページ（dashboard.html）にボタン・モーダルが出て、変更が動く
   - SOLID: サイドバーの無いページ（viewer-page.html）では何も挿入されない（エラーも出ない）
   - What'sNo: dashboard.htmlでも同じ機構が動く（wn-app.css側のスタイルも当たる）
   - スマホ幅で入力欄が16px以上（自動ズーム対策）

   実行: node _wn_e2e/password-change-sidebar-e2e.js （バックエンド不要・APIは全部スタブ） */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8798;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
               '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.json':'application/json' };

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

const captured = { changePw: [] };

async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'e2e-fake-token');
    sessionStorage.setItem('space_user', JSON.stringify({
      id: 1, name: 'テスト太郎', email: 't@example.com', role: 'general', solid_type: 'jp_client',
      company: 'テスト社', company_id: 1, apps: ['solid', 'whatsno'],
    }));
  });
  await ctx.route('**/api/**', async route => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const j = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p.endsWith('/auth/change-password')) {
      const body = JSON.parse(req.postData() || '{}');
      captured.changePw.push(body);
      if (body.current_password === 'wrong-pass') return j({ message: '現在のパスワードが正しくありません。' }, 422);
      return j({ message: 'パスワードを変更しました。' });
    }
    if (p.endsWith('/admin/companies')) return j({ companies: [] });
    if (p.endsWith('/projects'))        return j({ data: [], meta: { total: 0 } });
    if (p.endsWith('/wn/files'))        return j({ data: [], meta: { current_page: 1, last_page: 1, per_page: 60, total: 0, storage_mode: 'personal' } });
    if (p.endsWith('/wn/settings'))     return j({ data: { storage_mode: 'personal', my_private_count: 0 } });
    if (p.endsWith('/wn/tags'))         return j({ data: [] });
    if (p.endsWith('/wn/notifications')) return j({ data: [] });
    if (p.endsWith('/chat/unread'))     return j({ unread: 0 });
    return j({ data: [] });
  });
  return ctx;
}

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch();

  /* ---------- 1) SOLID: サイドバーのあるページ（dashboard.html） ---------- */
  {
    const ctx  = await newCtx(browser);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${BASE}/solid/app/dashboard.html`, { waitUntil: 'load' });
    await page.waitForSelector('#sidebarUser .sidebar-user-name');

    check('SOLIDダッシュボードに「パスワード変更」ボタンが挿入される', await page.locator('#btnChangePassword').isVisible());
    check('初期状態でモーダルは閉じている', await page.locator('#pwChangeModal').evaluate(el => el.classList.contains('hidden')));

    await page.click('#btnChangePassword');
    check('ボタンでモーダルが開く', await page.locator('#pwChangeModal').isVisible());
    check('開いたら現在のパスワード欄にフォーカス', await page.evaluate(() => document.activeElement && document.activeElement.id === 'pwChangeCurrent'));
    await page.screenshot({ path: path.join(SHOTS, 'solid-pw-modal.png') });

    // 未入力
    await page.click('#pwChangeSubmit');
    check('未入力でエラー表示', (await page.locator('#pwChangeError').textContent()).includes('入力してください'));
    check('未入力ではAPIを呼ばない', captured.changePw.length === 0);

    // 8文字未満
    await page.fill('#pwChangeCurrent', 'oldpass123'); await page.fill('#pwChangeNew', 'short'); await page.fill('#pwChangeConfirm', 'short');
    await page.click('#pwChangeSubmit');
    check('8文字未満でエラー', (await page.locator('#pwChangeError').textContent()).includes('8文字以上'));

    // 不一致
    await page.fill('#pwChangeNew', 'newpass12345'); await page.fill('#pwChangeConfirm', 'newpass1234x');
    await page.click('#pwChangeSubmit');
    check('確認不一致でエラー', (await page.locator('#pwChangeError').textContent()).includes('一致しません'));

    // 目アイコン
    await page.click('.pw-eye-btn[data-target="pwChangeNew"]');
    check('目アイコンで表示切替', await page.locator('#pwChangeNew').evaluate(el => el.type) === 'text');

    // サーバー422
    await page.fill('#pwChangeCurrent', 'wrong-pass'); await page.fill('#pwChangeConfirm', 'newpass12345');
    await page.click('#pwChangeSubmit');
    await page.waitForFunction(() => document.getElementById('pwChangeError').classList.contains('show'));
    check('サーバーの422メッセージをそのまま表示', (await page.locator('#pwChangeError').textContent()).includes('現在のパスワードが正しくありません'));

    // 成功
    await page.fill('#pwChangeCurrent', 'oldpass123');
    await page.click('#pwChangeSubmit');
    await page.waitForFunction(() => document.getElementById('pwChangeSuccess').classList.contains('show'));
    const last = captured.changePw[captured.changePw.length - 1];
    check('current/new を送る', last && last.current_password === 'oldpass123' && last.new_password === 'newpass12345');
    await page.waitForFunction(() => document.getElementById('pwChangeModal').classList.contains('hidden'), null, { timeout: 4000 });
    check('成功後に自動で閉じる', true);

    check('JSエラーなし（SOLID dashboard）', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  /* ---------- 2) SOLID: サイドバーの無いページ（viewer-page.html）では何も挿入されない ---------- */
  {
    const ctx  = await newCtx(browser);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${BASE}/solid/app/viewer-page.html`, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    check('サイドバーの無いページではボタンを挿入しない', await page.locator('#btnChangePassword').count() === 0);
    check('サイドバーの無いページではモーダルも挿入しない', await page.locator('#pwChangeModal').count() === 0);
    check('JSエラーなし（viewer-page）', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  /* ---------- 3) What'sNo: dashboard.html でも同じ機構が動く ---------- */
  {
    const ctx  = await newCtx(browser);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${BASE}/whatsno/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sidebarUser .sidebar-user-name');

    check("What'sNoダッシュボードにも「パスワード変更」ボタンが挿入される", await page.locator('#btnChangePassword').isVisible());
    await page.click('#btnChangePassword');
    check('モーダルが開く（wn-app.cssのスタイルも適用される）', await page.locator('#pwChangeModal').isVisible());
    const bg = await page.locator('#pwChangeModal .modal').evaluate(el => getComputedStyle(el).backgroundColor);
    check('モーダルにwn-app.css側のスタイルが当たっている（透明でない）', bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent', bg);
    await page.screenshot({ path: path.join(SHOTS, 'whatsno-pw-modal.png') });

    await page.fill('#pwChangeCurrent', 'oldpass123');
    await page.fill('#pwChangeNew', 'newpass99999');
    await page.fill('#pwChangeConfirm', 'newpass99999');
    await page.click('#pwChangeSubmit');
    await page.waitForFunction(() => document.getElementById('pwChangeSuccess').classList.contains('show'));
    check("What'sNo側からも変更APIが呼べる", captured.changePw.some(b => b.new_password === 'newpass99999'));
    check('JSエラーなし（whatsno dashboard）', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  /* ---------- 4) スマホ幅: 入力欄16px以上・横スクロールなし ---------- */
  {
    const ctx  = await newCtx(browser, { viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/solid/app/dashboard.html`, { waitUntil: 'load' });
    await page.waitForSelector('#sidebarUser .sidebar-user-name');
    // モバイル幅ではサイドバーがオフキャンバス化しているページ構成のため、ハンバーガー等を気にせずDOM操作で開閉確認
    await page.evaluate(() => document.getElementById('btnChangePassword').click());
    const fs16 = await page.locator('#pwChangeCurrent').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    check('スマホの入力欄は16px以上（自動ズーム対策）', fs16 >= 16, `${fs16}px`);
    const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    check('モーダル表示中も横スクロールなし', noHScroll);
    await ctx.close();
  }

  await browser.close();
  server.close();
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - fails}/${results.length} PASS`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
