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
  /* 画像の実体（原本 / サムネ）。中身は1x1でよく、寸法別の検証は data URL を流し込んで行う */
  const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  await page.route('**/wn/files/*/public-view*', r => r.fulfill({ contentType: 'image/png', body: PNG_1x1 }));
  await page.route('**/wn/files/*/thumb*',       r => r.fulfill({ contentType: 'image/png', body: PNG_1x1 }));
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
  /* PCで一番よく使うのは撮影ではなく「画像を選ぶ」なので、そちらが目立つ側にいること */
  const emph = await page.evaluate(() => {
    const pick = getComputedStyle(document.querySelector('#addImg'));
    const cam  = getComputedStyle(document.querySelector('#addCam'));
    const acc  = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const norm = c => c.replace(/\s/g, '');
    const toRgb = hex => {
      const m = hex.replace('#', '');
      return `rgb(${parseInt(m.slice(0,2),16)},${parseInt(m.slice(2,4),16)},${parseInt(m.slice(4,6),16)})`;
    };
    return { pickBg: norm(pick.backgroundColor), camBg: norm(cam.backgroundColor), accent: toRgb(acc),
             pickH: Math.round(document.querySelector('#addImg').getBoundingClientRect().height) };
  });
  check('PCでは「画像を選ぶ」がアクセント色で主役', emph.pickBg === emph.accent,
    `${emph.pickBg} / accent=${emph.accent}`);
  check('PCではカメラは主役ではない', emph.camBg !== emph.accent, emph.camBg);
  check('PCの追加ボタンの高さが62px', emph.pickH === 62, `${emph.pickH}px`);

  /* 音声入力ボタン（Chromeは webkitSpeechRecognition を持つ） */
  const srSupported = await page.evaluate(() => !!(window.SpeechRecognition || window.webkitSpeechRecognition));
  if (srSupported) {
    check('説明欄の枠内に音声入力ボタンが出る',
      await page.locator('#detail .e-caphints .e-voice').isVisible());
    check('PCの音声入力ボタンは「音声で入力」',
      (await page.textContent('#detail .e-caphints .e-voice')).trim() === '音声で入力',
      (await page.textContent('#detail .e-caphints .e-voice')).trim());
    const hints = (await page.textContent('#detail .e-caphints')).replace(/\s+/g, ' ').trim();
    check('押している間だけ聞くこととF2が示されている',
      hints.includes('押している間だけ聞く') && hints.includes('F2'), hints);
  } else {
    check('非対応ブラウザでは音声入力ボタンを出さない', await page.locator('#detail .e-voice').count() === 0);
  }

  /* モックどおりの構成になっていること */
  const capHints = (await page.textContent('#detail .e-caphints')).replace(/\s+/g, ' ').trim();
  check('説明欄にキー操作の案内がある',
    capHints.includes('Enter') && capHints.includes('確定して次の手順へ') && capHints.includes('改行'), capHints);
  check('写真の操作が写真の上に重なっている',
    await page.locator('#detail .e-detail-shot .e-shot-acts').isVisible());
  check('「差し替え」がある',
    (await page.textContent('#detail .e-shot-acts')).includes('差し替え'));
  check('表紙・削除はヘッダー側にある',
    await page.locator('#detail .e-detail-head .e-dbtn').count() === 2,
    `${await page.locator('#detail .e-detail-head .e-dbtn').count()}個`);
  check('タイトルはヘッダーで直接編集できる',
    await page.locator('.e-head input#fTitle').isVisible());
  check('プレビューボタンがある', await page.locator('#viewLink').isVisible());
  check('手順の件数が左パネルに出る',
    (await page.textContent('#stepCount')).trim() === '3件',
    (await page.textContent('#stepCount')).trim());

  /* 二面はページ全体が伸びず、左右のペインが内側でスクロールする */
  const shell = await page.evaluate(() => ({
    pageScroll: document.documentElement.scrollHeight - window.innerHeight,
    listScrolls: getComputedStyle(document.querySelector('#steps')).overflowY,
  }));
  check('PCではページ全体がスクロールしない', shell.pageScroll <= 1, `${shell.pageScroll}px`);
  check('手順リストが内側でスクロールする', shell.listScrolls === 'auto', shell.listScrolls);

  /* 写真は切れずに全体が見えること（縦長でも横長でも枠に収まる） */
  for (const [w, h, label] of [[300, 900, '縦長'], [1600, 500, '横長']]) {
    await page.evaluate(([w, h]) => {
      const img = document.querySelector('#detail .e-detail-shot img');
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d');
      x.fillStyle = '#c00'; x.fillRect(0, 0, w, h);
      img.onerror = null;
      img.src = c.toDataURL('image/png');
    }, [w, h]);
    await page.waitForFunction(([w]) => {
      const img = document.querySelector('#detail .e-detail-shot img');
      return img && img.complete && img.naturalWidth === w;
    }, [w], { timeout: 5000 });

    const fit = await page.evaluate(() => {
      const img = document.querySelector('#detail .e-detail-shot img');
      const box = document.querySelector('#detail .e-detail-shot');
      const i = img.getBoundingClientRect(), b = box.getBoundingClientRect();
      return { iw: Math.round(i.width), ih: Math.round(i.height),
               bw: Math.round(b.width), bh: Math.round(b.height) };
    });
    check(`${label}の写真が枠に収まり切れない`,
      fit.iw <= fit.bw + 1 && fit.ih <= fit.bh + 1,
      `画像 ${fit.iw}x${fit.ih} / 枠 ${fit.bw}x${fit.bh}`);
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

  /* スマホでもヘッダーが1行に収まり、タイトルが押し出されないこと */
  const head = await page.evaluate(() => {
    const h = document.querySelector('.e-head').getBoundingClientRect();
    const t = document.querySelector('#fTitle').getBoundingClientRect();
    const st = document.querySelector('.e-status').getBoundingClientRect();
    return { headH: Math.round(h.height), titleW: Math.round(t.width),
             statusH: Math.round(st.height), sameRow: Math.abs(t.top - st.top) < 20 };
  });
  check('スマホのヘッダーが1行に収まる', head.headH <= 68 && head.sameRow,
    `高さ${head.headH}px / 同じ行=${head.sameRow}`);
  check('スマホでもタイトル欄が確保される', head.titleW >= 100, `${head.titleW}px`);
  check('下書き/公開が潰れていない', head.statusH <= 44, `${head.statusH}px`);

  /* スマホは逆に、撮影が62pxの主役であること */
  const spEmph = await page.evaluate(() => {
    const cam = document.querySelector('#addCam');
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const m = acc.replace('#', '');
    return { text: cam.textContent.trim(),
             h: Math.round(cam.getBoundingClientRect().height),
             bg: getComputedStyle(cam).backgroundColor.replace(/\s/g, ''),
             accent: `rgb(${parseInt(m.slice(0,2),16)},${parseInt(m.slice(2,4),16)},${parseInt(m.slice(4,6),16)})` };
  });
  check('スマホの主要動作は「写真を撮って手順にする」', spEmph.text === '写真を撮って手順にする', spEmph.text);
  check('スマホの主要動作がアクセント色で62px',
    spEmph.bg === spEmph.accent && spEmph.h === 62, `${spEmph.bg} / ${spEmph.h}px`);

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
