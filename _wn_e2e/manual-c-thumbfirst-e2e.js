/* C案「親指ファースト」の検証
   ・一覧/編集とも主要動作が画面下端の固定帯にある
   ・編集はスマホ=1列カード、PC(>=1000px)=左リスト＋右エディタの二面
   ・説明欄に音声入力（プッシュトゥトーク）が出る
   ・一覧の「写真から作る」で 1枚=1手順の下書きができる
   （バックエンドなし・APIモック） */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');

const BASE = 'http://127.0.0.1:8765/whatsno';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

const STEPS = [
  { id: 51, type: 'photo', sort_order: 1, caption: '主電源をOFFにし、施錠札を掛ける', body: null,
    file: { id: 11, file_name: 'a.jpg', mime_type: 'image/jpeg', updated_at: '2026-08-01' } },
  { id: 52, type: 'photo', sort_order: 2, caption: '前面カバーの蝶ネジ4本を外す', body: null,
    file: { id: 12, file_name: 'b.jpg', mime_type: 'image/jpeg', updated_at: '2026-08-01' } },
  { id: 53, type: 'text', sort_order: 3, caption: null, body: '粉じんが落ちるので受け皿を先に敷く', file: null },
];

function manualJson() {
  return { data: {
    id: 5, title: '集塵機フィルター交換手順', description: '', status: 'draft',
    cover_file_id: 11, created_by: 1, created_at: '2026-08-01', updated_at: '2026-08-01',
    tags: [], steps: STEPS,
  } };
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });

  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({
      id: 1, name: 'テスト', role: 'admin', email: 't@example.com', wn_extended_options_enabled: true,
    }));
  });

  /* ───── 編集画面（PC幅 = 二面） ───── */
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
  await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
  await page.route('**/api/wn/manuals/5', r => r.fulfill({ json: manualJson() }));

  await page.goto(`${BASE}/app/manual-edit.html?id=5`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.e-row', { timeout: 8000 });

  check('PC幅では手順が1行リストになる', await page.locator('.e-row').count() === 3,
    `${await page.locator('.e-row').count()}行`);
  check('PC幅では右に選択中の手順が出る', await page.locator('#detail .e-detail-card').isVisible());
  check('最初の手順が選択されている',
    await page.locator('.e-row').first().evaluate(el => el.classList.contains('active')));
  check('右ペインに STEP 1 と出る',
    (await page.textContent('#detail .e-detail-kind')).trim() === 'STEP 1',
    (await page.textContent('#detail .e-detail-kind')).trim());
  check('右ペインの説明が1件目のキャプションになっている',
    (await page.inputValue('#detail .e-detail-cap')) === STEPS[0].caption);

  /* 行クリックで右ペインが切り替わる */
  await page.locator('.e-row').nth(1).click();
  await page.waitForFunction(() =>
    document.querySelector('#detail .e-detail-kind').textContent.trim() === 'STEP 2', { timeout: 5000 })
    .then(() => check('行をクリックすると右ペインが切り替わる', true))
    .catch(() => check('行をクリックすると右ペインが切り替わる', false));
  check('切り替え後の説明が2件目になっている',
    (await page.inputValue('#detail .e-detail-cap')) === STEPS[1].caption);

  /* ↑↓キーで手順を移動できる */
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() =>
    document.querySelector('#detail .e-detail-kind').textContent.trim() === 'STEP 3', { timeout: 5000 })
    .then(() => check('↓キーで次の手順へ移動する', true))
    .catch(async () => check('↓キーで次の手順へ移動する', false,
      (await page.textContent('#detail .e-detail-kind')).trim()));
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() =>
    document.querySelector('#detail .e-detail-kind').textContent.trim() === 'STEP 2', { timeout: 5000 })
    .then(() => check('↑キーで前の手順へ戻る', true))
    .catch(() => check('↑キーで前の手順へ戻る', false));

  /* 追加バーが画面下端に固定されている */
  const bar = await page.evaluate(() => {
    const el = document.querySelector('.e-addbar');
    const r  = el.getBoundingClientRect();
    return { pos: getComputedStyle(el).position, bottom: Math.round(r.bottom), vh: window.innerHeight };
  });
  check('追加バーが画面下端に固定されている', bar.pos === 'fixed' && Math.abs(bar.bottom - bar.vh) <= 1,
    `${bar.pos} / bottom=${bar.bottom} vh=${bar.vh}`);
  check('主要動作は「写真を撮って手順にする」',
    (await page.textContent('#addCam')).trim() === '写真を撮って手順にする',
    (await page.textContent('#addCam')).trim());
  const primH = await page.locator('#addCam').evaluate(el => Math.round(el.getBoundingClientRect().height));
  check('主要動作の高さが62px', primH === 62, `${primH}px`);

  /* 音声入力ボタン（Chromeは webkitSpeechRecognition を持つ） */
  const srSupported = await page.evaluate(() => !!(window.SpeechRecognition || window.webkitSpeechRecognition));
  if (srSupported) {
    check('説明欄に音声入力ボタンが出る', await page.locator('#detail .e-voice').isVisible());
    check('音声入力は押している間だけ聞く文言',
      (await page.textContent('#detail .e-voice')).trim() === '押している間、話す',
      (await page.textContent('#detail .e-voice')).trim());
  } else {
    check('非対応ブラウザでは音声入力ボタンを出さない', await page.locator('#detail .e-voice').count() === 0);
  }

  /* 説明欄は一番よく使うので、固定バーに隠れず1画面に収まっていること */
  const capFits = await page.evaluate(() => {
    const cap = document.querySelector('#detail .e-detail-cap');
    const bar = document.querySelector('.e-addbar');
    if (!cap) return null;
    const c = cap.getBoundingClientRect(), b = bar.getBoundingClientRect();
    return { capBottom: Math.round(c.bottom), barTop: Math.round(b.top) };
  });
  check('説明欄が固定バーに隠れず1画面に収まっている',
    capFits && capFits.capBottom <= capFits.barTop,
    capFits ? `説明欄の下端=${capFits.capBottom} / バー上端=${capFits.barTop}` : '説明欄が無い');

  await page.screenshot({ path: 'shots/c-edit-pc.png' });

  /* ───── 編集画面（スマホ幅 = 1列） ───── */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelectorAll('.e-step').length === 3, { timeout: 5000 })
    .then(() => check('スマホ幅では1列のカードに切り替わる', true))
    .catch(async () => check('スマホ幅では1列のカードに切り替わる', false,
      `${await page.locator('.e-step').count()}枚`));
  check('スマホ幅では右ペインを出さない', !(await page.locator('#detail .e-detail-card').isVisible()));

  const noHScroll = await page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth + 1);
  check('スマホ幅で横スクロールが発生しない', noHScroll);

  const barM = await page.evaluate(() => {
    const r = document.querySelector('.e-addbar').getBoundingClientRect();
    return { bottom: Math.round(r.bottom), vh: window.innerHeight };
  });
  check('スマホでも追加バーは画面下端', Math.abs(barM.bottom - barM.vh) <= 1,
    `bottom=${barM.bottom} vh=${barM.vh}`);

  /* 固定バーが最後のカードを隠していない */
  const notHidden = await page.evaluate(() => {
    const last = document.querySelector('#steps .e-step:last-child');
    const bar  = document.querySelector('.e-addbar');
    if (!last) return false;
    window.scrollTo(0, document.body.scrollHeight);
    return last.getBoundingClientRect().bottom <= bar.getBoundingClientRect().top + 1;
  });
  check('最後まで送っても固定バーがカードを隠さない', notHidden);

  /* スマホでは説明欄が細くならないこと（横並びだと潰れる） */
  const capW = await page.evaluate(() => {
    const ta = document.querySelector('#steps .e-step .e-scap textarea.cap');
    return ta ? Math.round(ta.getBoundingClientRect().width) : 0;
  });
  check('スマホの説明欄が十分な幅を持つ（250px以上）', capW >= 250, `${capW}px`);

  const ctrlOk = await page.evaluate(() => {
    const b = document.querySelector('#steps .e-step .e-sctrl button');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  check('スマホの操作ボタンが指で押せる大きさ（40px以上）',
    ctrlOk && ctrlOk.w >= 40 && ctrlOk.h >= 40, ctrlOk ? `${ctrlOk.w}x${ctrlOk.h}` : 'なし');

  await page.screenshot({ path: 'shots/c-edit-sp.png' });

  /* ───── 一覧画面 ───── */
  const lp = await ctx.newPage();
  lp.on('pageerror', e => console.log('PAGE ERROR(list):', e.message));

  const created = [];
  const addedSteps = [];
  await lp.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
  await lp.route('**/api/wn/manuals?**', r => r.fulfill({
    json: { data: [], meta: { current_page: 1, last_page: 1, per_page: 24, total: 0 } },
  }));
  await lp.route('**/api/wn/manuals', r => {
    if (r.request().method() !== 'POST') return r.fulfill({ json: { data: [] } });
    created.push(JSON.parse(r.request().postData() || '{}'));
    return r.fulfill({ json: { data: { id: 77, title: '写真から', steps: [] } } });
  });
  await lp.route('**/api/wn/files', r => r.fulfill({ json: { data: { id: 900 + addedSteps.length } } }));
  await lp.route('**/api/wn/manuals/77/steps', r => {
    addedSteps.push(JSON.parse(r.request().postData() || '{}'));
    return r.fulfill({ json: { data: { id: 600 + addedSteps.length, type: 'photo' } } });
  });

  await lp.goto(`${BASE}/app/manuals.html`, { waitUntil: 'domcontentloaded' });
  await lp.waitForSelector('#newBtn', { timeout: 8000 });

  const lbar = await lp.evaluate(() => {
    const el = document.querySelector('.m-bottombar');
    const r  = el.getBoundingClientRect();
    return { pos: getComputedStyle(el).position, bottom: Math.round(r.bottom), vh: window.innerHeight };
  });
  check('一覧も主要動作が画面下端に固定されている',
    lbar.pos === 'fixed' && Math.abs(lbar.bottom - lbar.vh) <= 1,
    `${lbar.pos} / bottom=${lbar.bottom} vh=${lbar.vh}`);
  check('「新しいマニュアル」が下端にある',
    (await lp.textContent('#newBtn')).trim() === '新しいマニュアル',
    (await lp.textContent('#newBtn')).trim());
  check('ヘッダーから新規ボタンが消えている', await lp.locator('.m-head #newBtn').count() === 0);
  check('「写真から作る」がある', await lp.locator('#fromPhotosBtn').isVisible());

  /* 写真から作る: 2枚選ぶ → タイトル入力 → 1枚=1手順で積まれる */
  await lp.setInputFiles('#photoInput', [
    { name: 's1.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
    { name: 's2.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
  ]);
  await lp.waitForSelector('#newModal.show', { timeout: 5000 });
  check('写真を選ぶとタイトル入力が出る', (await lp.textContent('#modalHint')).includes('2枚'),
    (await lp.textContent('#modalHint')).trim());

  await lp.fill('#newTitle', '写真から作る手順');
  await lp.click('#createBtn');
  await lp.waitForFunction(() => location.pathname.includes('manual-edit.html'), { timeout: 15000 })
    .then(() => check('作成後に編集画面へ遷移する', true))
    .catch(() => check('作成後に編集画面へ遷移する', false, lp.url()));
  check('選んだ写真の枚数だけ手順が積まれる', addedSteps.length === 2, `${addedSteps.length}件`);
  check('積まれた手順の種別が photo', addedSteps.every(s => s.type === 'photo'),
    JSON.stringify(addedSteps));

  await browser.close();
  const fails = results.filter(r => !r.ok);
  console.log(`\n==== 結果: ${results.length - fails.length}/${results.length} PASS ====`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
