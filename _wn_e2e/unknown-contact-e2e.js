/* What'sNo「連絡先に未登録の宛先」ポップアップのE2E検証（バックエンドなし・APIモック）
   メール送信ボタンを押したとき、TO/CC/BCC に連絡先へ未登録のアドレスがあれば
   ポップアップで報告し、その場で連絡先に登録できることを確認する。
   mailto: は外部ハンドラ任せで検証できないため email-e2e.js と同じく <a>.click() を捕捉する。 */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');

const BASE = 'http://127.0.0.1:8765/whatsno';
const KNOWN = { id: 1, name: '取引先 太郎', email: 'known@example.com' };

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

/* 共有リンクAPIのモックと mailto / 新規タブの捕捉（email-e2e.js と同じ手口） */
async function prepare(page) {
  await page.evaluate(() => {
    window.__mailto = null;
    window.__nav    = null;
    const mockUrl = (id) => `https://space-apps.pages.dev/whatsno/app/share.html?token=${String(id).padStart(2, '0')}${'a'.repeat(62)}`;
    window.wnCreateShare = async (id) => ({ url: mockUrl(id) });
    window.wnCreateSharesBulk = async (ids) => {
      const map = {};
      for (const id of ids) map[id] = { url: mockUrl(id) };
      return map;
    };
    const origCreate = document.createElement.bind(document);
    document.createElement = (tag, ...rest) => {
      const el = origCreate(tag, ...rest);
      if (String(tag).toLowerCase() === 'a') {
        el.click = () => {
          const href = el.getAttribute('href') || '';
          if (href.startsWith('mailto:'))     { window.__mailto = el.href; return; }
          if (el.target === '_blank' && href) { window.__nav    = el.href; return; }
        };
      }
      return el;
    };
    window.open = (u) => { window.__nav = u; return { closed: false }; };
  });
}

/* メールモーダルを開き、宛先を入れて共有リンクの発行完了まで待つ */
async function openWith(page, chips) {
  await page.evaluate(() => { closeEmailModal(); });
  await prepare(page);
  await page.evaluate((c) => {
    openEmailModal([{ id: 1, name: '図面_A棟.pdf' }]);
    emailFieldChips.to  = (c.to  || []).map(email => ({ email }));
    emailFieldChips.cc  = (c.cc  || []).map(email => ({ email }));
    emailFieldChips.bcc = (c.bcc || []).map(email => ({ email }));
  }, chips);
  await page.waitForFunction(() => Array.isArray(emailPregenShares) && emailPregenShares.length > 0, null, { timeout: 5000 });
  await page.waitForFunction(() => allContactsLoaded === true, null, { timeout: 5000 });
}

const popup = (page) => page.locator('#wnUnknownContactsModal');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com' }));
    localStorage.setItem('space_token', 'mock-token-e2e');
    localStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com' }));
  });

  const page = await ctx.newPage();
  const posted = [];   // 連絡先の登録リクエスト

  await page.route('**/api/**', r => r.fulfill({ json: { data: [] } }));
  await page.route('**/api/wn/contacts', r => {
    if (r.request().method() === 'POST') {
      posted.push(JSON.parse(r.request().postData() || '{}'));
      return r.fulfill({ status: 201, json: { data: { id: 99, ...JSON.parse(r.request().postData() || '{}') } } });
    }
    return r.fulfill({ json: { data: [KNOWN] } });
  });
  // PCコンテキストでは同期サーバー失敗→whatsno://フォールバックが実クリックを飲み込むため成功で返す
  await page.route('http://localhost:39876/sync', r => r.fulfill({ status: 200, body: 'ok', headers: { 'Access-Control-Allow-Origin': '*' } }));
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));

  await page.goto(`${BASE}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  /* ── 1. 登録済みの宛先だけならポップアップは出ない ── */
  await openWith(page, { to: [KNOWN.email] });
  await page.click('#emailMailtoBtn');
  await page.waitForTimeout(300);
  check('登録済みのみ: ポップアップは出ない', await popup(page).count() === 0);
  check('登録済みのみ: そのまま送信される', !!(await page.evaluate(() => window.__mailto)));

  /* ── 2. 未登録の宛先があるとポップアップで報告し、送信は保留される ── */
  await openWith(page, { to: [KNOWN.email, 'new1@example.com'], cc: ['new2@example.com'], bcc: [KNOWN.email] });
  await page.click('#emailMailtoBtn');
  await page.waitForTimeout(300);
  check('未登録あり: ポップアップが出る', await popup(page).count() === 1);
  check('未登録あり: 送信は保留される', (await page.evaluate(() => window.__mailto)) === null);

  const listed = await page.locator('#wnUnknownContactsModal input.form-input').evaluateAll(
    els => els.map(e => e.dataset.email));
  check('TO/CC/BCC の未登録だけを列挙する',
    JSON.stringify(listed) === JSON.stringify(['new1@example.com', 'new2@example.com']), listed.join(','));
  check('名前が空だと「登録して送信」は押せない',
    await page.locator('#wnUnknownContactsModal [data-act="save"]').isDisabled());

  /* ── 3. キャンセル: モーダルは残り、送信もしない ── */
  await page.click('#wnUnknownContactsModal [data-act="cancel"]');
  await page.waitForTimeout(200);
  check('キャンセル: ポップアップが閉じる', await popup(page).count() === 0);
  check('キャンセル: 送信しない', (await page.evaluate(() => window.__mailto)) === null);
  check('キャンセル: メールモーダルは残る',
    await page.evaluate(() => !document.getElementById('emailModal').classList.contains('hidden')));

  /* ── 4. 「登録せずに送信」: 登録はせずに送信だけ進む ── */
  await page.click('#emailMailtoBtn');
  await page.waitForTimeout(300);
  await page.click('#wnUnknownContactsModal [data-act="skip"]');
  await page.waitForTimeout(400);
  const skipMailto = await page.evaluate(() => window.__mailto);
  check('登録せずに送信: mailto が生成される', !!skipMailto, skipMailto ? `len=${skipMailto.length}` : 'null');
  check('登録せずに送信: 連絡先は登録されない', posted.length === 0, `posted=${posted.length}`);

  /* ── 5. 一度確認したら同じモーダル内で二度目は聞かれない ── */
  await page.evaluate(() => { window.__mailto = null; });
  await page.click('#emailMailtoBtn');
  await page.waitForTimeout(300);
  check('確認済み: 2回目はポップアップを出さない', await popup(page).count() === 0);
  check('確認済み: そのまま送信される', !!(await page.evaluate(() => window.__mailto)));

  /* ── 6. 「登録して送信」: 名前を入れた分だけ登録し、送信も進む ── */
  await openWith(page, { to: ['new1@example.com', 'new3@example.com'] });
  await page.click('#emailGmailBtn');
  await page.waitForTimeout(300);
  check('Gmail側もポップアップが出る', await popup(page).count() === 1);

  const inputs = page.locator('#wnUnknownContactsModal input.form-input');
  await inputs.nth(0).fill('新規 花子');
  check('名前を入れると「登録して送信」が押せる',
    await page.locator('#wnUnknownContactsModal [data-act="save"]').isEnabled());
  await page.click('#wnUnknownContactsModal [data-act="save"]');
  await page.waitForTimeout(600);

  check('登録して送信: Gmail作成画面が開く',
    (await page.evaluate(() => window.__nav || '')).startsWith('https://mail.google.com/mail/?view=cm'));
  check('登録して送信: 名前を入れた宛先だけ登録される',
    posted.length === 1 && posted[0].email === 'new1@example.com' && posted[0].name === '新規 花子',
    JSON.stringify(posted));
  const toast = await page.evaluate(() => document.getElementById('toastContainer')?.textContent || '');
  check('登録して送信: 登録件数を通知する', toast.includes('1件を連絡先に登録しました'), toast.trim().slice(0, 60));

  /* ── 7. 大文字小文字の違いは同じ宛先として扱う ── */
  await openWith(page, { to: [KNOWN.email.toUpperCase()] });
  await page.click('#emailMailtoBtn');
  await page.waitForTimeout(300);
  check('大文字小文字違いは登録済み扱い', await popup(page).count() === 0);

  /* ── 8. 「今後は表示しない」: チェックして送信すると以後出ない・メールモーダルから戻せる ── */
  await openWith(page, { to: ['new4@example.com'] });
  await page.click('#emailMailtoBtn');
  await page.waitForTimeout(300);
  await page.check('#wnUnknownContactsModal [data-dontask]');
  await page.click('#wnUnknownContactsModal [data-act="skip"]');
  await page.waitForTimeout(400);
  check('今後表示しない: 設定が保存される',
    await page.evaluate(() => localStorage.getItem('wn_unknown_contact_popup_off') === '1'));

  await openWith(page, { to: ['new5@example.com'] });
  await page.click('#emailMailtoBtn');
  await page.waitForTimeout(300);
  check('今後表示しない: 別の未登録宛先でも出ない', await popup(page).count() === 0);
  check('今後表示しない: そのまま送信される', !!(await page.evaluate(() => window.__mailto)));
  check('今後表示しない: 「元に戻す」導線が出る',
    await page.locator('#wnUnknownContactNotice [data-act="restore"]').count() === 1);
  await page.screenshot({ path: 'shots/unknown-contact-notice.png' });

  await openWith(page, { to: ['new6@example.com'] });
  await page.click('#wnUnknownContactNotice [data-act="restore"]');
  await page.waitForTimeout(200);
  check('元に戻す: 設定が消える',
    await page.evaluate(() => localStorage.getItem('wn_unknown_contact_popup_off') === null));
  check('元に戻す: 導線が消える', await page.locator('#wnUnknownContactNotice').count() === 0);
  await page.click('#emailMailtoBtn');
  await page.waitForTimeout(300);
  check('元に戻す: ポップアップが再び出る', await popup(page).count() === 1);
  // キャンセルでは設定を変えない（チェックしたまま閉じても記憶しない）
  await page.check('#wnUnknownContactsModal [data-dontask]');
  await page.click('#wnUnknownContactsModal [data-act="cancel"]');
  await page.waitForTimeout(200);
  check('キャンセル: 「今後は表示しない」は記憶しない',
    await page.evaluate(() => localStorage.getItem('wn_unknown_contact_popup_off') === null));

  /* ── 9. ファイル詳細画面のメールモーダルでも同じように出る ── */
  const dpage = await ctx.newPage();
  await dpage.route('**/api/**', r => r.fulfill({ json: { data: [] } }));
  await dpage.route('**/api/wn/contacts', r => r.fulfill({ json: { data: [KNOWN] } }));
  // ファイル詳細は形が合っていないと描画で落ちて初期化が途中で止まる
  await dpage.route('**/api/wn/files/1', r => r.fulfill({
    json: { data: { id: 1, file_name: '図面_A棟.pdf', file_size: 12345, mime_type: 'application/pdf',
                    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', folder_id: null } },
  }));
  await dpage.route('http://localhost:39876/sync', r => r.fulfill({ status: 200, body: 'ok', headers: { 'Access-Control-Allow-Origin': '*' } }));
  dpage.on('pageerror', e => console.log('PAGE ERROR(file-detail):', e.message));
  await dpage.goto(`${BASE}/app/file-detail.html?id=1`, { waitUntil: 'domcontentloaded' });
  await dpage.waitForTimeout(1200);
  await prepare(dpage);
  await dpage.evaluate(() => {
    openEmailModal(1, '図面_A棟.pdf');
    emailFieldChips.to = [{ email: 'new9@example.com' }];
  });
  await dpage.waitForFunction(() => _allContactsLoaded === true && _emailPregenShare, null, { timeout: 5000 });
  await dpage.click('#emailMailtoBtn');
  await dpage.waitForTimeout(300);
  check('[file-detail] 未登録ありでポップアップが出る', await dpage.locator('#wnUnknownContactsModal').count() === 1);
  check('[file-detail] 送信は保留される', (await dpage.evaluate(() => window.__mailto)) === null);
  await dpage.screenshot({ path: 'shots/unknown-contact-popup.png' });
  check('[file-detail] ポップアップのボタンが1行に収まる', await dpage.evaluate(() => {
    const f = document.querySelector('#wnUnknownContactsModal .modal-footer');
    const tops = [...f.querySelectorAll('button')].map(b => Math.round(b.getBoundingClientRect().top));
    return new Set(tops).size === 1;
  }));
  await dpage.click('#wnUnknownContactsModal [data-act="skip"]');
  await dpage.waitForTimeout(300);
  check('[file-detail] 登録せずに送信で mailto が生成される', !!(await dpage.evaluate(() => window.__mailto)));

  await ctx.close();
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
