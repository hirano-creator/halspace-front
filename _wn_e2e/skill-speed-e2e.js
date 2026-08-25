/* What'sNo スキルバー（検索欄→自動でメーラー起動）の待ち時間検証・バックエンドなし。

   直したかった構造:
     旧: 連絡先取得 → AI応答待ち → そこから共有リンク発行 → メーラー起動（全部足し算）
     新: 共有リンク発行はAI待ちの裏で走らせ、連絡先は入力開始時に先読みする

   ここではAPIを遅延つきモックにして「合計時間が足し算になっていないこと」を測る。
   実ブラウザでは mailto が外部ハンドラに渡るため、<a>.click() をフックしてURLだけ捕まえる。 */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');

const BASE   = 'http://127.0.0.1:8765/whatsno';
const AI_MS  = 900;   // AI（skills/run）の応答にかかる時間
const SHR_MS = 600;   // 共有リンク発行にかかる時間

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com', wn_extended_options_enabled: true }));
    localStorage.setItem('space_token', 'mock-token-e2e');
    localStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com', wn_extended_options_enabled: true }));
    localStorage.setItem('wn_mailer_pref', 'mailto');   // 2回目以降＝メーラー自動起動の状態
  });

  const page = await ctx.newPage();
  await page.route('**/api/**', r => r.fulfill({ json: { data: [] } }));
  await page.route('http://localhost:39876/sync', r => r.fulfill({ status: 200, body: 'ok', headers: { 'Access-Control-Allow-Origin': '*' } }));
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
  await page.goto(`${BASE}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const FILE_N = 8;
  await page.evaluate(({ n, aiMs, shrMs }) => {
    window.__t = { bulkStart: null, aiDone: null, mailto: null, contactCalls: 0, bulkCalls: 0, singleCalls: 0, t0: 0 };
    const now = () => performance.now();

    // 選択済みのファイル一覧を用意する（一覧APIを通さず直接状態を作る）
    allFiles = Array.from({ length: n }, (_, i) => ({ id: 100 + i, file_name: `図面_${i + 1}.pdf` }));
    selectedIds = allFiles.map(f => f.id);

    window.wnGetContacts = async () => {
      window.__t.contactCalls++;
      await new Promise(r => setTimeout(r, 200));
      return [{ id: 1, name: '取引先 太郎', email: 'to@example.com' }];
    };
    window.wnCreateShare = async (id) => { window.__t.singleCalls++; return { url: `https://x/app/share.html?token=${id}` }; };
    window.wnCreateSharesBulk = async (ids) => {
      window.__t.bulkCalls++;
      if (window.__t.bulkStart === null) window.__t.bulkStart = now() - window.__t.t0;
      await new Promise(r => setTimeout(r, shrMs));
      const map = {};
      for (const id of ids) map[id] = { url: `https://x/app/share.html?token=${id}` };
      return map;
    };
    window.wnRunSkill = async () => {
      await new Promise(r => setTimeout(r, aiMs));
      window.__t.aiDone = now() - window.__t.t0;
      return {
        action_type: 'email',
        draft: { to_email: 'to@example.com', to_name: '取引先 太郎', subject: '件名', body_message: 'お世話になっております。' },
        missing: [], run_id: 1,
      };
    };

    // mailto の <a>.click() を捕捉（実際の外部起動はさせない）
    const origCreate = document.createElement.bind(document);
    document.createElement = (tag, ...rest) => {
      const el = origCreate(tag, ...rest);
      if (String(tag).toLowerCase() === 'a') {
        el.click = () => {
          const href = el.getAttribute('href') || '';
          if (href.startsWith('mailto:')) { window.__t.mailto = el.href; window.__t.mailtoAt = now() - window.__t.t0; return; }
        };
      }
      return el;
    };
  }, { n: FILE_N, aiMs: AI_MS, shrMs: SHR_MS });

  /* 入力開始（focus）で連絡先を先読みしているか */
  await page.click('#searchInput');
  await page.waitForTimeout(400);
  const preloaded = await page.evaluate(() => ({ calls: window.__t.contactCalls, loaded: allContactsLoaded }));
  check('入力開始で連絡先を先読みする', preloaded.calls === 1 && preloaded.loaded === true,
    `calls=${preloaded.calls} loaded=${preloaded.loaded}`);

  /* スキル実行（Enter） */
  await page.evaluate(() => { window.__t.t0 = performance.now(); });
  await page.fill('#searchInput', '取引先 太郎さんに見積依頼メールして');
  await page.press('#searchInput', 'Enter');
  await page.waitForFunction(() => window.__t.mailto !== null, null, { timeout: 15000 });

  const t = await page.evaluate(() => window.__t);
  const total = Math.round(t.mailtoAt);

  check('メーラー（mailto）が自動で起動する', !!t.mailto && t.mailto.startsWith('mailto:to@example.com?'),
    t.mailto ? `len=${t.mailto.length}` : 'null');

  const links = (decodeURIComponent((t.mailto || '').split('body=')[1] || '').match(/share\.html\?token=/g) || []).length;
  check(`${FILE_N}件ぶんの共有リンクが本文に入る`, links === FILE_N, `links=${links}`);

  check(`${FILE_N}件でも発行APIは1回`, t.bulkCalls === 1 && t.singleCalls === 0,
    `bulk=${t.bulkCalls} single=${t.singleCalls}`);

  // 本命: リンク発行をAIの応答より先に始めている（＝待ち時間が足し算にならない）
  check('共有リンクの発行がAI応答より先に始まる', t.bulkStart !== null && t.bulkStart < t.aiDone,
    `bulkStart=${Math.round(t.bulkStart)}ms aiDone=${Math.round(t.aiDone)}ms`);

  // 合計が「AI + リンク発行」の足し算になっていない（重なっている）
  check('合計待ち時間が足し算になっていない', total < AI_MS + SHR_MS,
    `total=${total}ms < ${AI_MS}+${SHR_MS}=${AI_MS + SHR_MS}ms`);

  // 実行中に連絡先を再取得していない（先読み済みを使う）
  check('実行時に連絡先を取り直さない', t.contactCalls === 1, `calls=${t.contactCalls}`);

  await ctx.close();
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
