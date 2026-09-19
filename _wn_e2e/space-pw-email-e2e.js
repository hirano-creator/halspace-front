/* Space: (1) 全ロールのパスワード変更モーダル（apps.html）
          (2) 管理画面のユーザー編集でメールアドレスが PATCH に載ること（admin.html）
   実行: node _wn_e2e/space-pw-email-e2e.js  （バックエンド不要・APIは全部スタブ） */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8797;
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

const USER = { id: 7, name: '山田 太郎', email: 'yamada@example.com', role: 'general', solid_type: null, country: 'JP',
               company_id: 1, company: { name: 'テスト社', apps_enabled: ['solid','whatsno'], is_modeler_only: false, is_operator: false },
               apps_enabled: null, effective_apps: ['solid','whatsno'], is_active: true, last_login_at: null, created_at: '2026-01-01' };
// セッションのcurrentUser（id:1）自身の行。「自分自身はパスワードリセット対象外」の検証用
const SELF_USER = { ...USER, id: 1, name: 'テスト太郎', email: 't@example.com' };
// admin視点では触れないsuper_admin行。「adminはsuper_adminをリセット不可」の検証用
const SUPER_USER = { ...USER, id: 8, name: '運営 花子', email: 'hanako@example.com', role: 'super_admin' };

const captured = { changePw: [], patch: [], resetPw: [] };

async function newCtx(browser, role, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
  await ctx.addInitScript(r => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({
      id: 1, name: 'テスト太郎', email: 't@example.com', role: r,
      company: 'テスト社', company_id: 1, apps: ['solid','whatsno'],
    }));
  }, role);
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
    if (/\/admin\/users\/\d+$/.test(p) && req.method() === 'PATCH') {
      const body = JSON.parse(req.postData() || '{}');
      captured.patch.push(body);
      if (body.email === 'taken@example.com') return j({ message: 'このメールアドレスは既に別のユーザーに使われています。' }, 422);
      return j({ user: { ...USER, ...body } });
    }
    if (/\/admin\/users\/\d+\/temp-password$/.test(p)) return j({ message: 'none' }, 404);
    if (/\/admin\/users\/(\d+)\/reset-password$/.test(p) && req.method() === 'POST') {
      const targetId = Number(p.match(/\/admin\/users\/(\d+)\/reset-password$/)[1]);
      captured.resetPw.push(targetId);
      if (targetId === 1)  return j({ message: '自分自身のパスワードは画面右上の「パスワード変更」から変更してください。' }, 422);
      if (targetId === 8 && role !== 'super_admin') return j({ message: 'サイト管理者(super_admin)のパスワードはサイト運営者のみリセットできます。' }, 403);
      return j({ temp_password: 'newTempPw9x' });
    }
    if (p.endsWith('/admin/users'))     return j({ data: [USER, SELF_USER, SUPER_USER] });
    if (p.endsWith('/admin/companies')) return j({ companies: [{ id: 1, name: 'テスト社', apps_enabled: ['solid','whatsno'], user_count: 1, is_active: true, price: 0 }] });
    if (p.endsWith('/admin/stats'))     return j({ companies: 1, users: 1, active_users: 1 });
    if (p.endsWith('/admin/audit-logs')) return j({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } });
    return j({ data: [] });
  });
  return ctx;
}

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch();

  /* ---------- 1) 一般会員: apps.html にパスワード変更ボタンとモーダル ---------- */
  {
    const ctx  = await newCtx(browser, 'general');
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${BASE}/space/apps.html`, { waitUntil: 'load' });
    await page.waitForSelector('#appsGrid .app-card');

    check('一般会員でも「パスワード変更」ボタンが見える', await page.locator('#pwChangeBtn').isVisible());
    check('一般会員には管理者設定リンクが出ない', !(await page.locator('#adminLink').isVisible()));
    check('初期状態でモーダルは閉じている', await page.locator('#pwModal').evaluate(el => el.classList.contains('hidden')));

    await page.click('#pwChangeBtn');
    check('ボタンでモーダルが開く', await page.locator('#pwModal').isVisible());
    check('開いたら現在のパスワード欄にフォーカス', await page.evaluate(() => document.activeElement && document.activeElement.id === 'pwCurrent'));
    await page.screenshot({ path: path.join(SHOTS, 'space-pw-modal.png') });

    // 未入力
    await page.click('#pwSaveBtn');
    check('未入力でエラー表示', (await page.locator('#pwError').textContent()).includes('入力してください'));
    check('未入力ではAPIを呼ばない', captured.changePw.length === 0);

    // 8文字未満
    await page.fill('#pwCurrent', 'oldpass123'); await page.fill('#pwNew', 'short'); await page.fill('#pwConfirm', 'short');
    await page.click('#pwSaveBtn');
    check('8文字未満でエラー', (await page.locator('#pwError').textContent()).includes('8文字以上'));

    // 不一致
    await page.fill('#pwNew', 'newpass12345'); await page.fill('#pwConfirm', 'newpass1234x');
    await page.click('#pwSaveBtn');
    check('確認不一致でエラー', (await page.locator('#pwError').textContent()).includes('一致しません'));
    check('クライアント検証中はAPIを呼ばない', captured.changePw.length === 0);

    // 目アイコン
    await page.click('.pw-input-eye[data-target="pwNew"]');
    check('目アイコンで表示切替', await page.locator('#pwNew').evaluate(el => el.type) === 'text');

    // サーバー422（現在のPW違い）
    await page.fill('#pwCurrent', 'wrong-pass'); await page.fill('#pwConfirm', 'newpass12345');
    await page.click('#pwSaveBtn');
    await page.waitForFunction(() => document.getElementById('pwError').classList.contains('show'));
    check('サーバーの422メッセージをそのまま表示', (await page.locator('#pwError').textContent()).includes('現在のパスワードが正しくありません'));
    check('モーダルは開いたまま', await page.locator('#pwModal').isVisible());

    // 成功
    await page.fill('#pwCurrent', 'oldpass123');
    await page.click('#pwSaveBtn');
    await page.waitForFunction(() => document.getElementById('pwSuccess').classList.contains('show'));
    const last = captured.changePw[captured.changePw.length - 1];
    check('current/new を送る', last && last.current_password === 'oldpass123' && last.new_password === 'newpass12345');
    check('成功メッセージ表示', (await page.locator('#pwSuccess').textContent()).includes('変更しました'));
    await page.waitForFunction(() => document.getElementById('pwModal').classList.contains('hidden'), null, { timeout: 4000 });
    check('成功後に自動で閉じる', true);

    // 再度開くと初期化
    await page.click('#pwChangeBtn');
    check('再オープンで入力欄が空・メッセージ消去',
      (await page.locator('#pwCurrent').inputValue()) === '' && !(await page.locator('#pwSuccess').evaluate(el => el.classList.contains('show'))));
    await page.keyboard.press('Escape');
    check('Escで閉じる', await page.locator('#pwModal').evaluate(el => el.classList.contains('hidden')));

    check('JSエラーなし（一般会員）', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  /* ---------- 2) スマホ幅: ボタンがアイコンのみ・入力欄16px・横スクロールなし ---------- */
  {
    const ctx  = await newCtx(browser, 'admin', { viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/space/apps.html`, { waitUntil: 'load' });
    await page.waitForSelector('#appsGrid .app-card');
    check('スマホでもパスワード変更ボタンが見える', await page.locator('#pwChangeBtn').isVisible());
    check('スマホではアイコンのみ（テキスト非表示）', (await page.locator('#pwChangeBtn').evaluate(el => getComputedStyle(el).fontSize)) === '0px');
    await page.click('#pwChangeBtn');
    const fs16 = await page.locator('#pwCurrent').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    check('スマホの入力欄は16px以上（自動ズーム対策）', fs16 >= 16, `${fs16}px`);
    const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    check('モーダル表示中も横スクロールなし', noHScroll);
    await page.screenshot({ path: path.join(SHOTS, 'space-pw-modal-mobile.png') });
    await ctx.close();
  }

  /* ---------- 3) 管理画面: ユーザー編集でメールが PATCH に載る ---------- */
  {
    const ctx  = await newCtx(browser, 'super_admin');
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${BASE}/space/admin.html`, { waitUntil: 'load' });
    await page.click('[data-section="users"]');
    await page.waitForSelector('tr[data-user-id="7"]');
    await page.click('tr[data-user-id="7"]');
    await page.waitForSelector('#userModal:not(.hidden)');
    check('編集モーダルに現在のメールが入る', (await page.locator('#userModalEmail').inputValue()) === 'yamada@example.com');
    check('メール欄は編集可能', !(await page.locator('#userModalEmail').evaluate(el => el.readOnly || el.disabled)));

    // 重複メール → サーバー422を表示
    await page.fill('#userModalEmail', 'taken@example.com');
    await page.click('#userModalSave');
    await page.waitForFunction(() => document.getElementById('userModalError').style.display === 'block');
    check('重複メールのエラー文言を表示', (await page.locator('#userModalError').textContent()).includes('既に別のユーザー'));

    // 変更成功
    await page.fill('#userModalEmail', 'new-address@example.com');
    await page.click('#userModalSave');
    await page.waitForFunction(() => document.getElementById('userModal').classList.contains('hidden'));
    const last = captured.patch[captured.patch.length - 1];
    check('PATCH に email が載る', last && last.email === 'new-address@example.com', JSON.stringify(last));
    check('name/role/company_id も従来どおり送る', last && last.name === '山田 太郎' && last.role === 'general' && String(last.company_id) === '1');
    check('JSエラーなし（管理画面）', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  /* ---------- 4) 管理画面: パスワードを忘れたユーザーの仮パスワード再発行 ---------- */
  {
    const ctx  = await newCtx(browser, 'super_admin');
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept()); // confirm()を自動承認
    await page.goto(`${BASE}/space/admin.html`, { waitUntil: 'load' });
    await page.click('[data-section="users"]');
    await page.waitForSelector('tr[data-user-id="7"]');

    // 他人（一般会員）: ボタンが出て、実行すると新しい仮パスワードが表示される
    await page.click('tr[data-user-id="7"]');
    await page.waitForSelector('#userModal:not(.hidden)');
    check('他人にはリセットボタンが出る', await page.locator('#userModalResetPwGroup').isVisible());
    await page.click('#userModalResetPwBtn');
    await page.waitForFunction(() => document.getElementById('userModalPwArea').style.display !== 'none');
    check('新しい仮パスワードが表示される', (await page.locator('#userModalPw').inputValue()) === 'newTempPw9x');
    check('reset-password APIが対象IDで呼ばれる', captured.resetPw.includes(7));
    await page.evaluate(() => closeModal('userModal'));

    // 自分自身: リセットボタンを出さない（自己サービスへ誘導するため）
    await page.click('tr[data-user-id="1"]');
    await page.waitForSelector('#userModal:not(.hidden)');
    check('自分自身にはリセットボタンを出さない', !(await page.locator('#userModalResetPwGroup').isVisible()));
    await page.evaluate(() => closeModal('userModal'));

    // super_adminから見たsuper_admin: ボタンが出て実行できる
    await page.click('tr[data-user-id="8"]');
    await page.waitForSelector('#userModal:not(.hidden)');
    check('super_adminから見たsuper_adminにはリセットボタンが出る', await page.locator('#userModalResetPwGroup').isVisible());
    await page.evaluate(() => closeModal('userModal'));

    check('JSエラーなし（パスワードリセット・super_admin）', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  /* ---------- 5) 管理画面（admin視点）: super_adminのリセットボタンは出さない ---------- */
  {
    const ctx  = await newCtx(browser, 'admin');
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${BASE}/space/admin.html`, { waitUntil: 'load' });
    await page.click('[data-section="users"]');
    await page.waitForSelector('tr[data-user-id="8"]');
    await page.click('tr[data-user-id="8"]');
    await page.waitForSelector('#userModal:not(.hidden)');
    check('adminから見たsuper_adminにはリセットボタンを出さない', !(await page.locator('#userModalResetPwGroup').isVisible()));
    await page.evaluate(() => closeModal('userModal'));

    // admin役割でも「システム設定」（自分のパスワード変更）に到達できること
    // （以前はsuper_admin専用で、admin役割は自分のパスワードを変える手段がadmin.html内に無かった）
    check('adminにも「システム設定」ナビが見える', await page.locator('#sidebarSystem').isVisible());
    await page.click('#sidebarSystem');
    await page.waitForSelector('#sectionSystem.active');
    check('adminでもパスワード変更フォームが使える', await page.locator('#pwSaveBtn').isVisible());

    await page.fill('#pwCurrent', 'oldpass123');
    await page.fill('#pwNew', 'newpass55555');
    await page.fill('#pwConfirm', 'newpass55555');
    await page.click('#pwSaveBtn');
    await page.waitForFunction(() => document.getElementById('toastWrap').textContent.includes('変更しました'));
    check('admin自身のパスワード変更APIが呼べる', captured.changePw.some(b => b.new_password === 'newpass55555'));

    check('JSエラーなし（パスワードリセット・admin視点）', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  await browser.close();
  server.close();
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - fails}/${results.length} PASS`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
