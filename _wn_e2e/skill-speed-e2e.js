/* What'sNo スキルバー（検索欄→自動でメーラー起動）の待ち時間検証・バックエンドなし。

   直したかった構造:
     旧: 連絡先取得 → AI応答待ち → そこから共有リンク発行 → メーラー起動（全部足し算）
     新: ①宛先が連絡先で特定できる定型の指示はブラウザ内で下書きしてAIを呼ばない
         ②AIを使う場合も共有リンク発行はAI待ちの裏で走らせる
         ③連絡先は入力開始時、共有リンクは入力中に先読みする

   APIは遅延つきモックにして「AIを呼んでいないこと」と「足し算になっていないこと」を測る。
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
    localStorage.setItem('wn_unknown_contact_popup_off', '1');   // 未登録宛先の確認ポップアップは別E2Eの担当
  });

  const page = await ctx.newPage();
  await page.route('**/api/**', r => r.fulfill({ json: { data: [] } }));
  await page.route('http://localhost:39876/sync', r => r.fulfill({ status: 200, body: 'ok', headers: { 'Access-Control-Allow-Origin': '*' } }));
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
  await page.goto(`${BASE}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const FILE_N = 8;
  await page.evaluate(({ n, aiMs, shrMs }) => {
    window.__t = { bulkStart: null, aiDone: null, aiCalls: 0, logCalls: 0, mailto: null, mailtoAt: null,
                   contactCalls: 0, bulkCalls: 0, singleCalls: 0, t0: 0 };
    const now = () => performance.now();

    // 選択済みのファイル一覧を用意する（一覧APIを通さず直接状態を作る）
    allFiles = Array.from({ length: n }, (_, i) => ({ id: 100 + i, file_name: '図面_' + (i + 1) + '.pdf' }));
    selectedIds = allFiles.map(f => f.id);

    window.wnGetContacts = async () => {
      window.__t.contactCalls++;
      await new Promise(r => setTimeout(r, 200));
      return [{ id: 1, name: '取引先 太郎', company_name: '取引先工業', email: 'to@example.com' }];
    };
    window.wnCreateShare = async (id) => { window.__t.singleCalls++; return { url: 'https://x/app/share.html?token=' + id }; };
    window.wnCreateSharesBulk = async (ids) => {
      window.__t.bulkCalls++;
      if (window.__t.bulkStart === null) window.__t.bulkStart = now() - window.__t.t0;
      await new Promise(r => setTimeout(r, shrMs));
      const map = {};
      for (const id of ids) map[id] = { url: 'https://x/app/share.html?token=' + id };
      return map;
    };
    window.wnRunSkill = async () => {
      window.__t.aiCalls++;
      await new Promise(r => setTimeout(r, aiMs));
      window.__t.aiDone = now() - window.__t.t0;
      return {
        action_type: 'email',
        draft: { to_email: 'ai@example.com', to_name: '鈴木', subject: '件名', body_message: 'AIが書いた本文' },
        missing: [], run_id: 1,
      };
    };
    window.wnLogSkillRun = async () => { window.__t.logCalls++; };

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
    'calls=' + preloaded.calls + ' loaded=' + preloaded.loaded);

  /* 打っている間に共有リンクを先読みしているか（Enterより前に発行が始まる） */
  await page.fill('#searchInput', '取引先 太郎さんに見積依頼メールして');
  await page.waitForTimeout(500 + SHR_MS + 200);   // デバウンス＋発行ぶん（実際は文章を打つ数秒で終わる）
  const prefetched = await page.evaluate(() => window.__t.bulkCalls);
  check('入力中に共有リンクの発行が始まる', prefetched === 1, 'bulkCalls=' + prefetched);

  /* ケースA: 連絡先で宛先が特定できる定型の指示 → AIを呼ばずに即メーラー */
  await page.evaluate(() => { window.__t.t0 = performance.now(); });
  await page.press('#searchInput', 'Enter');
  await page.waitForFunction(() => window.__t.mailto !== null, null, { timeout: 15000 });

  const a = await page.evaluate(() => window.__t);
  const totalA = Math.round(a.mailtoAt);

  check('メーラー（mailto）が自動で起動する', !!a.mailto && a.mailto.startsWith('mailto:to@example.com?'),
    a.mailto ? 'len=' + a.mailto.length : 'null');
  check('連絡先で決まる指示ではAIを呼ばない', a.aiCalls === 0, 'aiCalls=' + a.aiCalls);

  const bodyA = decodeURIComponent((a.mailto || '').split('body=')[1] || '');
  check('宛名（会社名＋様）が本文の先頭に付く',
    bodyA.startsWith('取引先工業\r\n取引先 太郎様') || bodyA.startsWith('取引先工業\n取引先 太郎様'),
    JSON.stringify(bodyA.slice(0, 24)));
  check('用件（見積）に沿った本文になる', bodyA.includes('お見積もりをご依頼いたします'), '');

  const links = (bodyA.match(/share\.html\?token=/g) || []).length;
  check(FILE_N + '件ぶんの共有リンクが本文に入る', links === FILE_N, 'links=' + links);
  check(FILE_N + '件でも発行APIは1回', a.bulkCalls === 1 && a.singleCalls === 0,
    'bulk=' + a.bulkCalls + ' single=' + a.singleCalls);

  // 本命: 先読み済みなので、Enterからメーラー起動までがほぼ待ちなし
  check('Enterからメーラー起動まで100ms未満', totalA < 100,
    'total=' + totalA + 'ms（AI経路なら' + (AI_MS + SHR_MS) + 'ms相当）');
  check('実行時に連絡先を取り直さない', a.contactCalls === 1, 'calls=' + a.contactCalls);
  check('AI未使用でも履歴に記録を投げる', a.logCalls === 1, 'logCalls=' + a.logCalls);

  /* ケースB: 連絡先に無い宛先 → 従来どおりAIに任せる。リンク発行はAI待ちに重ねる */
  await page.evaluate(() => {
    window.__t.mailto = null; window.__t.mailtoAt = null; window.__t.bulkStart = null;
    window.__t.t0 = performance.now();
    emailShareCache.clear();          // 別ファイル群を送る状況を再現（発行済みキャッシュを使わせない）
    closeEmailModal();
  });
  await page.fill('#searchInput', '新規取引の鈴木さんにメールして');
  await page.press('#searchInput', 'Enter');
  await page.waitForFunction(() => window.__t.mailto !== null, null, { timeout: 15000 });

  const b = await page.evaluate(() => window.__t);
  const totalB = Math.round(b.mailtoAt);

  check('連絡先に無い宛先はAIに任せる', b.aiCalls === 1 && b.mailto.startsWith('mailto:ai@example.com?'),
    'aiCalls=' + b.aiCalls);
  check('AI経路でもリンク発行がAI応答より先に始まる', b.bulkStart !== null && b.bulkStart < b.aiDone,
    'bulkStart=' + Math.round(b.bulkStart) + 'ms aiDone=' + Math.round(b.aiDone) + 'ms');
  check('AI経路でも合計が足し算にならない', totalB < AI_MS + SHR_MS,
    'total=' + totalB + 'ms < ' + AI_MS + '+' + SHR_MS + '=' + (AI_MS + SHR_MS) + 'ms');

  await ctx.close();
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
  process.exit(failed.length ? 1 : 0);
})();
