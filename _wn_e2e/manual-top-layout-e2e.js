/* マニュアル一覧トップのレイアウト検証（モック _mock-manual-ui.html の C-PC① と突き合わせる）
   ・上部バー1本に 戻る/タイトル/件数/検索/並び替え が収まっている
   ・固定幅の中央寄せではなく画面幅いっぱい。広い画面ほどカードの列が増える
   ・状態チップとタグチップが同じ行に並ぶ
   ・カードは 表紙(4:3)＋下書きバッジ＋ステップ数、本文は 名前/日付・作成者
   ・未読み込み分を「ほかN件」で出す
   ・主要動作は画面下端の固定帯
   （バックエンドなし・APIモック） */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');
const path = require('path');

const BASE = 'http://127.0.0.1:8765/whatsno';
const SHOTS = path.join(__dirname, 'shots');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

/* モックと同じ8件（＋総数32件で「ほか24件」が出る） */
const MANUALS = [
  ['集塵機フィルター交換手順', 12, 'published', '田中'],
  ['プレス機 段取り替え（100t）', 8, 'published', '佐藤'],
  ['溶接ロボット 週次点検', 15, 'published', '田中'],
  ['2号ライン 立ち上げ前チェック', 6, 'draft', '鈴木'],
  ['刃物交換と研磨の基準', 9, 'published', '佐藤'],
  ['フォークリフト 始業前点検', 11, 'published', '山口'],
  ['塗装ブース フィルター清掃', 7, 'published', '鈴木'],
  ['エアコンプレッサー ドレン抜き', 5, 'published', '山口'],
].map(([title, steps, status, who], i) => ({
  id: i + 1, title, description: '', status, step_count: steps,
  cover: { id: 100 + i, mime_type: 'image/jpeg', updated_at: '2026-08-15' },
  tags: [], viewed_at: null, view_count: 0,
  updated_at: `2026-08-${String(15 - i).padStart(2, '0')}`,
  created_by_name: who,
}));

const TAGS = [
  { id: 1, name: '集塵機' }, { id: 2, name: '日常点検' },
  { id: 3, name: 'プレス機' }, { id: 4, name: '安全手順' },
];

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

async function routeAll(page) {
  await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
  await page.route('**/wn/files/*/thumb*', r => r.fulfill({ contentType: 'image/png', body: PNG_1x1 }));
  /* 具体パスは汎用の後（LIFO で先に当たる） */
  await page.route('**/api/wn/manuals/tags*', r => r.fulfill({ json: { data: TAGS } }));
  await page.route('**/api/wn/manuals?**', r => r.fulfill({
    json: { data: MANUALS, meta: { current_page: 1, last_page: 2, per_page: 24, total: 32 } },
  }));
}

/* 一覧が描き終わるまで待つ */
async function openList(ctx, width, height) {
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
  await page.setViewportSize({ width, height });
  await routeAll(page);
  await page.goto(`${BASE}/app/manuals.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.m-card', { timeout: 8000 });
  return page;
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({
      id: 1, name: 'テスト', role: 'admin', email: 't@example.com', wn_extended_options_enabled: true,
    }));
  });

  /* ───── PC幅（1440） ───── */
  const p = await openList(ctx, 1440, 900);

  const bar = await p.evaluate(() => {
    const el = document.querySelector('.m-topbar');
    const r  = el.getBoundingClientRect();
    const s  = document.querySelector('.m-search').getBoundingClientRect();
    const so = document.querySelector('#sortSelect').getBoundingClientRect();
    const c  = document.querySelector('#countLabel').getBoundingClientRect();
    return {
      pos: getComputedStyle(el).position, top: Math.round(r.top),
      left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height),
      vw: window.innerWidth,
      searchInBar: s.top >= r.top - 1 && s.bottom <= r.bottom + 1,
      sortInBar:   so.top >= r.top - 1 && so.bottom <= r.bottom + 1,
      countInBar:  c.top >= r.top - 1 && c.bottom <= r.bottom + 1,
      searchW: Math.round(s.width), sortRight: Math.round(so.right),
    };
  });
  check('上部バーが画面幅いっぱいにある',
    bar.left === 0 && Math.abs(bar.width - bar.vw) <= 1, `left=${bar.left} w=${bar.width} vw=${bar.vw}`);
  check('検索ボックスが上部バーの中にある（モック同様の1本化）', bar.searchInBar, `幅${bar.searchW}px`);
  check('件数が上部バーの中にある', bar.countInBar);
  check('並び替えが上部バーの右端にある',
    bar.sortInBar && bar.vw - bar.sortRight < 40, `右端まで${bar.vw - bar.sortRight}px`);
  check('上部バーは1行に収まる（高さ58px前後）', bar.height <= 70, `${bar.height}px`);
  check('件数が「32件」で出る', (await p.textContent('#countLabel')).trim() === '32件',
    (await p.textContent('#countLabel')).trim());

  /* スクロールしても上部バーが残る */
  await p.evaluate(() => window.scrollTo(0, 400));
  await p.waitForTimeout(120);
  const stickyTop = await p.evaluate(() => Math.round(document.querySelector('.m-topbar').getBoundingClientRect().top));
  check('スクロールしても上部バーが残る（sticky）', stickyTop === 0, `top=${stickyTop}`);
  await p.evaluate(() => window.scrollTo(0, 0));

  /* 絞り込み: 状態チップとタグチップが同じ行 */
  const chips = await p.evaluate(() => {
    const st = [...document.querySelectorAll('#statusChips .m-chip')];
    const tg = [...document.querySelectorAll('#tagList .m-chip')];
    const y  = el => Math.round(el.getBoundingClientRect().top);
    return {
      status: st.map(e => e.textContent.trim()), tags: tg.map(e => e.textContent.trim()),
      sameRow: st.length && tg.length && y(st[0]) === y(tg[0]),
      dividerVisible: !!document.querySelector('.m-tagrow .m-div')?.getBoundingClientRect().height,
      activeBg: getComputedStyle(st[0]).backgroundColor,
    };
  });
  check('状態チップが すべて/公開中/下書き',
    chips.status.join(',') === 'すべて,公開中,下書き', chips.status.join(','));
  check('タグチップが状態チップと同じ行に並ぶ', chips.sameRow, `tags=${chips.tags.join(',')}`);
  check('状態とタグの間に区切り線がある', chips.dividerVisible);
  check('選択中のチップが濃紺で塗られる（モック同様）',
    chips.activeBg === 'rgb(10, 37, 64)', chips.activeBg);

  /* カード */
  const card = await p.evaluate(() => {
    const c = document.querySelector('.m-card');
    const cov = c.querySelector('.m-cover').getBoundingClientRect();
    const draft = document.querySelectorAll('.m-badge');
    return {
      ratio: +(cov.width / cov.height).toFixed(2),
      coverBg: getComputedStyle(c.querySelector('.m-cover')).backgroundColor,
      steps: c.querySelector('.m-steps')?.textContent.trim(),
      meta: c.querySelector('.m-meta span')?.textContent.trim(),
      badgeCount: draft.length,
      badgeText: draft[0]?.textContent.trim(),
      editOpacity: getComputedStyle(c.querySelector('.m-edit')).opacity,
    };
  });
  check('表紙が4:3', Math.abs(card.ratio - 4 / 3) < 0.03, `${card.ratio}`);
  check('表紙の下地がモックの薄いグレー', card.coverBg === 'rgb(238, 241, 246)', card.coverBg);
  check('表紙の右下にステップ数', card.steps === '12ステップ', card.steps);
  check('バッジは下書きの1件だけ（公開中には出さない）',
    card.badgeCount === 1 && card.badgeText === '下書き', `${card.badgeCount}件 / ${card.badgeText}`);
  check('カード本文がモックと同じ「8月15日・田中」', card.meta === '8月15日・田中', card.meta);
  check('編集リンクは既定で隠れている（ホバーで出る）', card.editOpacity === '0', card.editOpacity);

  check('未読み込み分が「ほか24件」で出る',
    (await p.textContent('.m-more')).trim() === 'ほか24件', (await p.textContent('.m-more')).trim());

  /* 下端の固定帯 */
  const bb = await p.evaluate(() => {
    const el = document.querySelector('.m-bottombar');
    const r  = el.getBoundingClientRect();
    return { pos: getComputedStyle(el).position, bottom: Math.round(r.bottom), vh: window.innerHeight,
             width: Math.round(r.width), vw: window.innerWidth };
  });
  check('主要動作が画面下端に固定されている',
    bb.pos === 'fixed' && Math.abs(bb.bottom - bb.vh) <= 1, `${bb.pos} bottom=${bb.bottom} vh=${bb.vh}`);
  check('下端の帯も画面幅いっぱい', Math.abs(bb.width - bb.vw) <= 1, `${bb.width}/${bb.vw}`);

  /* 画面下端の帯にカードが隠れない */
  const overlap = await p.evaluate(() => {
    document.querySelector('#scrollSentinel').scrollIntoView();
    const barTop = document.querySelector('.m-bottombar').getBoundingClientRect().top;
    const last   = [...document.querySelectorAll('.m-card')].pop().getBoundingClientRect();
    const more   = document.querySelector('.m-more').getBoundingClientRect();
    return { hidden: last.bottom > barTop || more.bottom > barTop,
             gap: Math.round(barTop - more.bottom) };
  });
  check('一番下のカードが固定帯に隠れない', !overlap.hidden, `余白${overlap.gap}px`);

  await p.screenshot({ path: path.join(SHOTS, 'manual-top-1440.png'), fullPage: false });

  /* ───── 画面の大きさに追従するか（1280 → 1920 → 2560 で列が増える） ───── */
  const cols = {};
  for (const w of [1280, 1600, 1920, 2560]) {
    await p.setViewportSize({ width: w, height: 900 });
    await p.waitForTimeout(150);
    cols[w] = await p.evaluate(() => {
      const g = document.querySelector('.m-grid');
      const n = getComputedStyle(g).gridTemplateColumns.split(' ').length;
      const r = g.getBoundingClientRect();
      return { n, right: Math.round(window.innerWidth - r.right), left: Math.round(r.left) };
    });
  }
  check('画面が広いほど列が増える',
    cols[1280].n < cols[1920].n && cols[1920].n < cols[2560].n,
    Object.entries(cols).map(([w, c]) => `${w}px:${c.n}列`).join(' / '));
  check('グリッドが画面幅を使い切る（左右の余白が同じ）',
    Object.values(cols).every(c => Math.abs(c.left - c.right) <= 1 && c.left <= 24),
    JSON.stringify(cols[2560]));

  await p.setViewportSize({ width: 1920, height: 1080 });
  await p.waitForTimeout(150);
  await p.screenshot({ path: path.join(SHOTS, 'manual-top-1920.png'), fullPage: false });

  /* ───── 狭い画面（上部バーが2段に折り返し、検索は幅いっぱい） ───── */
  const sp = await openList(ctx, 390, 844);
  const mob = await sp.evaluate(() => {
    const bar = document.querySelector('.m-topbar').getBoundingClientRect();
    const s   = document.querySelector('.m-search').getBoundingClientRect();
    const t   = document.querySelector('.m-title').getBoundingClientRect();
    const g   = document.querySelector('.m-grid');
    return {
      wrapped: s.top > t.bottom - 1,
      searchInBar: s.bottom <= bar.bottom + 1,
      searchW: Math.round(s.width), vw: window.innerWidth,
      cols: getComputedStyle(g).gridTemplateColumns.split(' ').length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  check('狭い画面では検索が2段目に回る', mob.wrapped && mob.searchInBar);
  check('2段目の検索は幅いっぱい', mob.vw - mob.searchW < 40, `${mob.searchW}/${mob.vw}`);
  check('スマホ幅は2列', mob.cols === 2, `${mob.cols}列`);
  check('横スクロールが出ない', !mob.overflow);
  await sp.screenshot({ path: path.join(SHOTS, 'manual-top-390.png'), fullPage: false });

  await browser.close();
  const fails = results.filter(r => !r.ok);
  console.log(`\n==== 結果: ${results.length - fails.length}/${results.length} PASS ====`);
  console.log(`スクリーンショット: ${SHOTS}`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
