/* What'sNo LINE共有導線のE2E検証（バックエンドなし・APIモック）
   LINEは line.me を実際に開いてしまうと以降の操作が届かなくなるため、
   <a target="_blank">.click() をフックしてURLだけ捕捉する（email-e2e.js と同じ手口）。
   捕捉時に blur を投げるのは、実機で画面がLINEに移るのと同じ状態を作って
   wnOpenExternalUrl の location.href フォールバックを走らせないため。 */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');

const BASE = 'http://127.0.0.1:8765/whatsno';
const IPHONE_UA  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

/* ページ側に仕込む: 共有リンクAPIのモックと外部遷移の捕捉 */
async function prepare(page) {
  await page.evaluate(() => {
    window.__nav = null;

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
        const origClick = el.click.bind(el);
        el.click = () => {
          const href = el.getAttribute('href') || '';
          if (el.target === '_blank' && href) {
            window.__nav = el.href;
            window.dispatchEvent(new Event('blur'));   // 実機で画面がLINEに移った状態
            return;
          }
          if (href.startsWith('mailto:')) return;      // メーラー未設定の実機と同じ「無反応」
          origClick();
        };
      }
      return el;
    };
    window.open = (u) => { window.__nav = u; return { closed: false }; };
  });
}

/* LINEモーダルを開いてリンク発行完了まで待つ */
async function openAndWait(page, files, message = '') {
  await page.evaluate(({ files, message }) => {
    openLineModal(files);
    document.getElementById('emailMessage').value = message;
  }, { files, message });
  await page.waitForFunction(
    (n) => Array.isArray(emailPregenShares) && emailPregenShares.length === n,
    files.length, { timeout: 5000 });
}

/* 一覧にダミーのファイルを流し込んで選択モードで選ぶ（下部メニューを出すため） */
async function selectFiles(page, files) {
  await page.evaluate((files) => {
    allFiles = files.map(f => ({ id: f.id, file_name: f.name, visibility: 'company', can_edit: true }));
    if (!selectMode) toggleSelectMode();
    for (const f of files) toggleMergeSelect(f.id);
  }, files);
}

/* モーダルがどちらのモードで開いているか */
async function readModalMode(page) {
  return page.evaluate(() => {
    const vis = (id) => {
      const el = document.getElementById(id);
      return !!el && el.style.display !== 'none' && !el.classList.contains('hidden');
    };
    return {
      open:   !document.getElementById('emailModal').classList.contains('hidden'),
      title:  document.getElementById('emailModalTitleText')?.textContent || '',
      toShown:     vis('emailToSection'),
      lineBtn:     vis('emailLineBtn'),
      mailtoBtn:   vis('emailMailtoBtn'),
      gmailBtn:    vis('emailGmailBtn'),
      hintLine:    vis('emailHintLine'),
      hintMail:    vis('emailHintMail'),
      hintMobile:  vis('emailMobileHint'),
    };
  });
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  for (const device of [
    { label: 'iPhone',  mobile: true,  ctxOpts: { userAgent: IPHONE_UA,  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { label: 'Android', mobile: true,  ctxOpts: { userAgent: ANDROID_UA, viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } },
    { label: 'PC',      mobile: false, ctxOpts: { viewport: { width: 1280, height: 800 } } },
  ]) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', ...device.ctxOpts });
    await ctx.addInitScript(() => {
      const user = { id: 1, name: 'テスト', role: 'admin', email: 't@example.com', wn_extended_options_enabled: true };
      sessionStorage.setItem('space_token', 'mock-token-e2e');
      sessionStorage.setItem('space_user', JSON.stringify(user));
      localStorage.setItem('space_token', 'mock-token-e2e');
      localStorage.setItem('space_user', JSON.stringify(user));
      localStorage.setItem('wn_mail_signature', '株式会社ハル\n山田 太郎\nTel: 000-0000-0000');
    });

    const page = await ctx.newPage();
    await page.route('**/api/**', r => r.fulfill({ json: { data: [] } }));
    // 連絡先は空。LINE経路で「未登録の宛先」ポップアップが挟まらないことを見るため
    await page.route('**/api/wn/contacts', r => r.fulfill({ json: { data: [] } }));
    await page.route('http://localhost:39876/sync', r => r.fulfill({ status: 200, body: 'ok', headers: { 'Access-Control-Allow-Origin': '*' } }));
    page.on('pageerror', e => console.log(`PAGE ERROR(${device.label}):`, e.message));
    await page.goto(`${BASE}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    /* ── 1. 独立した導線が3か所ある（検索欄・下部メニュー・モーダル内） ── */
    const entries = await page.evaluate(() => ({
      searchBar: !!document.getElementById('lineSendBtn'),
      selBar:    !!document.getElementById('lineSelBtn'),
      modalBtn:  !!document.getElementById('emailLineBtn'),
      selBarDisabled: document.getElementById('lineSelBtn')?.disabled,
    }));
    check(`[${device.label}] 検索欄にLINEボタンがある`, entries.searchBar);
    check(`[${device.label}] 下部メニューにLINEボタンがある`, entries.selBar);
    check(`[${device.label}] 未選択では下部メニューのLINEは押せない`, entries.selBarDisabled === true);

    /* ── 1b. 検索欄のLINEは未選択なら選択モードに入れて促す ── */
    await page.click('#lineSendBtn');
    await page.waitForTimeout(200);
    const promoted = await page.evaluate(() => ({
      selectMode,
      modalOpen: !document.getElementById('emailModal').classList.contains('hidden'),
      toast: document.getElementById('toastContainer')?.textContent || '',
    }));
    check(`[${device.label}] 未選択なら選択モードに入る`, promoted.selectMode === true);
    check(`[${device.label}] 未選択ではモーダルを開かない`, !promoted.modalOpen);
    check(`[${device.label}] 選択を促す案内が出る`, promoted.toast.includes('選択してください'), promoted.toast.trim().slice(0, 40));

    /* ── 1c. 選択してから押すとLINEモードで開く ── */
    await prepare(page);
    await selectFiles(page, [{ id: 7, name: '図面_C棟.pdf' }]);
    const selBarOn = await page.evaluate(() => !document.getElementById('lineSelBtn').disabled);
    check(`[${device.label}] 選択すると下部メニューのLINEが押せる`, selBarOn);

    await page.click('#lineSendBtn');
    await page.waitForTimeout(300);
    const lineMode = await readModalMode(page);
    check(`[${device.label}] 検索欄のLINEからモーダルが開く`, lineMode.open);
    check(`[${device.label}] タイトルがLINEになる`, lineMode.title.includes('LINE'), lineMode.title);
    check(`[${device.label}] 宛先メールアドレス欄は出ない`, !lineMode.toShown);
    check(`[${device.label}] 送信ボタンはLINEだけ`,
      lineMode.lineBtn && !lineMode.mailtoBtn && !lineMode.gmailBtn,
      `line=${lineMode.lineBtn} mailto=${lineMode.mailtoBtn} gmail=${lineMode.gmailBtn}`);
    check(`[${device.label}] LINE向けの案内に切り替わる`, lineMode.hintLine && !lineMode.hintMail);
    // 「メールアプリ／Gmailが開きます」の案内はLINEでは的外れなので出さない
    check(`[${device.label}] スマホ向けメール案内は出ない`, !lineMode.hintMobile);

    /* ── 1d. メールで開いたときはLINEボタンが混ざらない ── */
    await page.evaluate(() => { closeEmailModal(); openEmailModal([{ id: 7, name: '図面_C棟.pdf' }]); });
    await page.waitForTimeout(200);
    const mailMode = await readModalMode(page);
    check(`[${device.label}] メールのモーダルにLINEボタンは出ない`, !mailMode.lineBtn);
    check(`[${device.label}] メールでは宛先欄と2つの送信ボタンが出る`,
      mailMode.toShown && mailMode.mailtoBtn && mailMode.gmailBtn);
    check(`[${device.label}] メールの案内に戻る`, mailMode.hintMail && !mailMode.hintLine);
    check(`[${device.label}] スマホ向けメール案内はメールでは${device.mobile ? '出る' : '出ない'}`,
      mailMode.hintMobile === device.mobile);
    await page.evaluate(() => { closeEmailModal(); });

    /* ── 2. 日本語500字＋署名でもURLが上限内に収まり、共有リンクが残る ── */
    await prepare(page);
    await openAndWait(page, [{ id: 1, name: '図面_A棟_2026年度改訂版.pdf' }], 'あ'.repeat(500));

    const btnEnabled = await page.evaluate(() => !document.getElementById('emailLineBtn').disabled);
    check(`[${device.label}] 発行完了でLINEボタンが押せる`, btnEnabled);

    await page.click('#emailLineBtn');
    await page.waitForTimeout(300);

    const nav = await page.evaluate(() => window.__nav);
    check(`[${device.label}] LINEの共有URLを開く`, !!nav && nav.startsWith('https://line.me/R/share?text='),
      nav ? `len=${nav.length}` : 'null');
    if (nav) {
      const text = decodeURIComponent(nav.split('text=')[1] || '');
      check(`[${device.label}] 共有リンクを含む`, text.includes('/app/share.html?token='));
      check(`[${device.label}] 件名にあたる行が先頭に入る`, text.startsWith("【What'sNo】"), text.slice(0, 30));
      check(`[${device.label}] URL長が上限内`, nav.length <= 4000, `len=${nav.length}`);
    }
    // line:// のカスタムスキームは未インストール端末で「アドレスが無効です」になるため使わない
    check(`[${device.label}] カスタムスキームを使わない`, !nav || !nav.startsWith('line:'), String(nav).slice(0, 12));

    /* ── 3. 連絡先未登録ポップアップが挟まらない（LINEは宛先を使わない） ── */
    const popup = await page.evaluate(() => !!document.getElementById('wnUnknownContactsModal'));
    check(`[${device.label}] 未登録宛先のポップアップは出ない`, !popup);

    /* ── 4. 送信後にモーダルが閉じる ── */
    const closed = await page.evaluate(() => document.getElementById('emailModal').classList.contains('hidden'));
    check(`[${device.label}] 送信後にモーダルが閉じる`, closed);

    /* ── 5. 複数ファイル: 全件の共有リンクが本文に入る（削るのは署名と本文だけ） ── */
    await prepare(page);
    const FILE_N = 12;
    await openAndWait(page, Array.from({ length: FILE_N }, (_, i) => ({ id: 1000 + i, name: `図面_${i + 1}.pdf` })), 'あ'.repeat(300));
    await page.click('#emailLineBtn');
    await page.waitForTimeout(300);

    const multi = await page.evaluate(() => window.__nav);
    if (multi) {
      const text  = decodeURIComponent(multi.split('text=')[1] || '');
      const links = (text.match(/\/app\/share\.html\?token=/g) || []).length;
      check(`[${device.label}] ${FILE_N}件ぶんの共有リンクが本文に入る`, links === FILE_N, `links=${links}`);
    } else {
      check(`[${device.label}] ${FILE_N}件でもLINE共有URLが生成される`, false, 'null');
    }

    /* ── 6. スキル: 連絡先が引けなくてもLINEの下書きが立つ（AI往復なし） ── */
    const draft = await page.evaluate(() => wnLocalMailDraft('この図面を田中さんにLINEで送って', []));
    check(`[${device.label}] LINE指示はAIなしで下書きできる`, !!draft && draft.local === true, JSON.stringify(draft || null).slice(0, 80));
    check(`[${device.label}] channel=line が立つ`, draft?.channel === 'line', String(draft?.channel));
    check(`[${device.label}] 本文テンプレートが入る`, !!draft?.body_message);

    // メールの指示は従来どおり（宛先が引けなければAIに任せる＝null）
    const mailDraft = await page.evaluate(() => wnLocalMailDraft('この図面を田中さんにメールで送って', []));
    check(`[${device.label}] メール指示は宛先なしならAIに任せる`, mailDraft === null, JSON.stringify(mailDraft));

    await page.evaluate(() => { closeEmailModal(); });
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
