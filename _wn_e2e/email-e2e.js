/* What'sNo メール送信導線のE2E検証（バックエンドなし・APIモック）
   スマホでメールアプリが起動しない問題の再発防止用。
   mailto: は実ブラウザでは外部ハンドラに委ねられ検証できないため、
   <a>.click() をフックして生成URLを捕捉し、起動失敗時のフォールバックUIを確認する。 */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');

const BASE = 'http://127.0.0.1:8765/whatsno';
const IPHONE_UA  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

/* ページ側に仕込む: 共有リンクAPIのモックと mailto/遷移の捕捉 */
async function prepare(page, shareCount = 1) {
  await page.evaluate((n) => {
    window.__mailto = null;
    window.__nav    = null;

    // 共有リンク発行をモック（トークンは実物と同じ64文字相当）
    window.wnCreateShare = async () => ({ url: `https://space-apps.pages.dev/whatsno/app/share.html?token=${'a'.repeat(64)}` });

    // <a>.click() を捕捉する。mailto は外部ハンドラ未登録＝実機の「起動しない」状態、
    // Gmail は target="_blank" の新規タブなので、どちらも実遷移させずにURLだけ取る
    const origCreate = document.createElement.bind(document);
    document.createElement = (tag, ...rest) => {
      const el = origCreate(tag, ...rest);
      if (String(tag).toLowerCase() === 'a') {
        const origClick = el.click.bind(el);
        el.click = () => {
          const href = el.getAttribute('href') || '';
          if (href.startsWith('mailto:'))              { window.__mailto = el.href; return; }
          if (el.target === '_blank' && href)          { window.__nav    = el.href; return; }
          origClick();
        };
      }
      return el;
    };
    // PCの Gmail は window.open 経路なのでこちらで捕捉する
    window.open = (u) => { window.__nav = u; return { closed: false }; };
    void n;
  }, shareCount);
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
      sessionStorage.setItem('space_token', 'mock-token-e2e');
      sessionStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com' }));
      localStorage.setItem('space_token', 'mock-token-e2e');
      localStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com' }));
      localStorage.setItem('wn_mail_signature', '株式会社ハル\n山田 太郎\nTel: 000-0000-0000');
    });

    const page = await ctx.newPage();
    await page.route('**/api/**', r => r.fulfill({ json: { data: [] } }));
    // デスクトップ同期サーバーを成功扱いにする。失敗させると whatsno:// のフォールバックが走り、
    // Chromeの外部プロトコルダイアログでその後の page.click が一切届かなくなる（PCコンテキストのみ）
    await page.route('http://localhost:39876/sync', r => r.fulfill({ status: 200, body: 'ok', headers: { 'Access-Control-Allow-Origin': '*' } }));
    page.on('pageerror', e => console.log(`PAGE ERROR(${device.label}):`, e.message));
    await page.goto(`${BASE}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    /* ── 1. UA判定とスマホ向けレイアウト ── */
    const isMobile = await page.evaluate(() => wnIsMobileDevice());
    check(`[${device.label}] wnIsMobileDevice()`, isMobile === device.mobile, String(isMobile));

    const layout = await page.evaluate(() => ({
      hint:   !document.getElementById('emailMobileHint').classList.contains('hidden'),
      mailto: document.getElementById('emailMailtoBtn').className,
      gmail:  document.getElementById('emailGmailBtn').className,
    }));
    if (device.mobile) {
      check(`[${device.label}] スマホ向け案内が出る`, layout.hint);
      check(`[${device.label}] 「メールアプリ」が主ボタン`, layout.mailto.includes('btn-accent') && layout.gmail.includes('btn-outline'),
        `${layout.mailto} / ${layout.gmail}`);
    } else {
      check(`[${device.label}] スマホ向け案内は出ない`, !layout.hint);
      check(`[${device.label}] 「Gmailで送る」が主ボタンのまま`, layout.gmail.includes('btn-accent') && layout.mailto.includes('btn-outline'),
        `${layout.mailto} / ${layout.gmail}`);
    }

    /* ── 2. メールアプリ（mailto）: 日本語500字＋署名 ── */
    await prepare(page);
    await page.evaluate(() => {
      openEmailModal([{ id: 1, name: '図面_A棟_2026年度改訂版.pdf' }]);
      emailFieldChips.to = [{ email: 'to@example.com' }];
      document.getElementById('emailMessage').value = 'あ'.repeat(500);
    });
    await page.waitForFunction(() => Array.isArray(emailPregenShares) && emailPregenShares.length > 0, null, { timeout: 5000 });
    await page.click('#emailMailtoBtn');
    await page.waitForTimeout(300);

    const mailto = await page.evaluate(() => window.__mailto);
    check(`[${device.label}] mailto URLが生成される`, !!mailto, mailto ? `len=${mailto.length}` : 'null');
    if (mailto) {
      const body = decodeURIComponent(mailto.split('body=')[1] || '');
      check(`[${device.label}] 共有リンクを含む`, body.includes('/app/share.html?token='));
      check(`[${device.label}] 宛先を含む`, mailto.startsWith('mailto:to@example.com?'));
      const limitOk = device.mobile ? mailto.length <= 4000 : mailto.length > 4000;
      check(`[${device.label}] URL長${device.mobile ? 'が上限内' : 'は従来どおり無制限'}`, limitOk, `len=${mailto.length}`);
    }

    /* ── 3. 起動できなかったとき: モーダルが閉じず案内が出る ── */
    await page.waitForTimeout(1600);   // wnOpenMailto の判定タイマー
    const stillOpen = await page.evaluate(() => !document.getElementById('emailModal').classList.contains('hidden'));
    const toast     = await page.evaluate(() => document.getElementById('toastContainer')?.textContent || '');
    check(`[${device.label}] 起動失敗時にモーダルが残る`, stillOpen);
    check(`[${device.label}] 起動失敗を通知する`, toast.includes('メールアプリを起動できませんでした'), toast.trim().slice(0, 60));

    /* ── 4. Gmail 導線 ── */
    await page.evaluate(() => { closeEmailModal(); });
    await prepare(page);
    await page.evaluate(() => {
      openEmailModal([{ id: 2, name: '図面_B棟.pdf' }]);
      emailFieldChips.to = [{ email: 'to@example.com' }];
    });
    await page.waitForFunction(() => Array.isArray(emailPregenShares) && emailPregenShares.length > 0, null, { timeout: 5000 });
    await page.click('#emailGmailBtn');
    await page.waitForTimeout(300);   // wnOpenExternalUrl のフォールバック遷移(1000ms)より前に読む
    const nav = await page.evaluate(() => window.__nav);
    check(`[${device.label}] Gmail作成画面URLを開く`, !!nav && nav.startsWith('https://mail.google.com/mail/?view=cm'),
      nav ? `len=${nav.length}` : 'null');
    if (device.mobile) {
      // ホーム画面アプリ（standalone）では window.open が無視されるため <a target="_blank"> 経由であること
      check(`[${device.label}] 新規タブ用の<a>経由で開く`, !!nav);
    }

    await ctx.close();
  }

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
