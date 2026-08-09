// 複数メディア投稿のスライド表示（横スワイプ）の検証：
// ①フィードカードで複数枚が1つの .slides にまとまり、カウンタ/ドット/矢印が出る
// ②横スクロールでカウンタ・ドットが追従する／矢印で送れる
// ③1枚だけの投稿はスライドにならない（従来どおり）
// ④画像をタップすると投稿詳細へ遷移する（スワイプ直後は遷移しない）
// ⑤投稿詳細でも複数枚がスライドになる
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = 'c:/dev/my-programming/a.a';
const PORT = 8131;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
});

const API = 'http://127.0.0.1:8000/api';
const COLORS = { 101: '#1f48ff', 102: '#0a0a0a', 103: '#9b9ba3', 201: '#1f48ff' };
// 何枚目か目視できるよう、メディアIDを大きく描いたSVGを画像として返す
const svgFor = (id) => `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
  <rect width="800" height="600" fill="${COLORS[id] || '#c0392b'}"/>
  <text x="400" y="340" font-size="180" fill="#fff" text-anchor="middle" font-family="sans-serif">${id}</text></svg>`;

const img = (id) => ({ id, kind: 'image', mime: 'image/svg+xml', view: API + `/aa/media/${id}/view`, url: API + `/aa/media/${id}/full.svg` });
const mkPost = (id, media, body) => ({
  id, kind: 'post', body, category: '設備紹介', author_name: 'A', company_name: 'B',
  media, reactions: { helpful: 0 }, my_reactions: [], comment_count: 0, is_mine: false,
});
const multi  = mkPost(1, [img(101), img(102), img(103)], '複数枚ポスト');
const single = mkPost(2, [img(201)], '1枚だけポスト');
// 画像＋動画＋資料の混在（2コマ目以降は横スクロールで初めて表示されるため遅延処理の確認用）
const mixed = mkPost(3, [
  img(301),
  { id: 302, kind: 'video', mime: 'video/mp4', view: API + '/aa/media/302/view', url: API + '/aa/media/302/full.mp4' },
  { id: 303, kind: 'document', mime: 'application/pdf', view: API + '/aa/media/303/view', url: '' },
], '混在ポスト');
const posts = [multi, single, mixed];

function stub(page) {
  page.route('**/cdnjs.cloudflare.com/**', (route) => route.abort());
  return page.route('**/api/**', (route) => {
    const url = route.request().url();
    const m = url.match(/\/aa\/media\/(\d+)\/(thumb|full\.svg)/);
    if (m) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svgFor(m[1]) });
    if (url.includes('/aa/posts/1/comments')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' });
    if (url.includes('/aa/posts/1')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: multi }) });
    if (url.includes('/aa/feed')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: posts }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' });
  });
}

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => localStorage.setItem('aa_token', 'mock-token'));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' <- ')));
  await stub(page);

  const results = [];
  const check = (name, ok, extra) => { results.push([name, ok]); console.log((ok ? 'OK   ' : 'NG   ') + name + (extra ? '  ' + extra : '')); };

  // ── フィード ──
  await page.goto(`http://localhost:${PORT}/app/feed.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('article[data-id="1"] .slides', { timeout: 5000 });
  await page.waitForTimeout(800);

  const s = await page.evaluate(() => {
    const a1 = document.querySelector('article[data-id="1"]');
    const a2 = document.querySelector('article[data-id="2"]');
    const sl = a1.querySelector('.slides');
    return {
      slideCount: sl.querySelectorAll('.slide').length,
      counter: sl.querySelector('.slides-count').textContent.trim(),
      dots: sl.querySelectorAll('.slides-dots i').length,
      dotOn: [...sl.querySelectorAll('.slides-dots i')].findIndex(d => d.classList.contains('on')),
      prevDisabled: sl.querySelector('.slides-arrow.prev').disabled,
      nextDisabled: sl.querySelector('.slides-arrow.next').disabled,
      singleHasSlides: !!a2.querySelector('.slides'),
      singleHasMedia: !!a2.querySelector('.media img'),
      // 横スクロールできる＝トラック幅が表示幅より広い
      scrollable: (() => { const t = sl.querySelector('.slides-track'); return t.scrollWidth > t.clientWidth + 10; })(),
      cardOverflow: document.documentElement.scrollWidth <= window.innerWidth, // 横にはみ出していない
    };
  });
  check('複数枚が3コマのスライドになる', s.slideCount === 3, `slides=${s.slideCount}`);
  check('カウンタが 1/3', s.counter === '1/3', s.counter);
  check('ドット3個・1個目が点灯', s.dots === 3 && s.dotOn === 0, `dots=${s.dots} on=${s.dotOn}`);
  check('先頭では「前へ」が無効', s.prevDisabled === true && s.nextDisabled === false);
  check('1枚だけの投稿はスライドにしない', !s.singleHasSlides && s.singleHasMedia);
  check('トラックが横スクロール可能', s.scrollable);
  check('カードが横にはみ出さない', s.cardOverflow);
  await page.screenshot({ path: 'c:/dev/my-programming/_aa_e2e/shots/slides-feed-1.png' });

  // 2枚目へ横スクロール（指スワイプ相当）→ 直後のタップでは詳細に飛ばない
  // ※ Playwrightのclick()は要素を可視位置までスクロールしてしまい判定を汚すので、
  //   スクロールもクリックもページ内(evaluate)で行う
  const s2 = await page.evaluate(async () => {
    const sl = document.querySelector('article[data-id="1"] .slides');
    const t = sl.querySelector('.slides-track');
    t.scrollLeft = t.clientWidth;
    t.dispatchEvent(new Event('scroll'));
    await new Promise(r => setTimeout(r, 60));
    const swiping = sl.dataset.swiping === '1';
    sl.querySelectorAll('.slide .media img')[1].click(); // スワイプ直後のタップ
    await new Promise(r => setTimeout(r, 150));
    return {
      counter: sl.querySelector('.slides-count').textContent.trim(),
      dotOn: [...sl.querySelectorAll('.slides-dots i')].findIndex(d => d.classList.contains('on')),
      swiping,
      url: location.href,
    };
  });
  check('スクロールでカウンタが 2/3 になる', s2.counter === '2/3', s2.counter);
  check('スクロールでドットが2個目に移る', s2.dotOn === 1, 'on=' + s2.dotOn);
  check('スワイプ直後は swiping フラグが立つ', s2.swiping);
  check('スワイプ直後のタップで詳細に飛ばない', s2.url.includes('feed.html'), s2.url);
  await page.screenshot({ path: 'c:/dev/my-programming/_aa_e2e/shots/slides-feed-2.png' });

  // 「次へ」矢印で3枚目
  await page.waitForTimeout(500); // swiping解除待ち
  await page.evaluate(() => document.querySelector('article[data-id="1"] .slides-arrow.next').click());
  await page.waitForTimeout(900);
  const s3 = await page.evaluate(() => {
    const sl = document.querySelector('article[data-id="1"] .slides');
    return {
      counter: sl.querySelector('.slides-count').textContent.trim(),
      nextDisabled: sl.querySelector('.slides-arrow.next').disabled,
      onFeed: location.pathname.includes('feed.html'),
    };
  });
  check('矢印で3/3まで送れる', s3.counter === '3/3', s3.counter);
  check('末尾では「次へ」が無効', s3.nextDisabled === true);
  check('矢印クリックで詳細に飛ばない', s3.onFeed);
  await page.screenshot({ path: 'c:/dev/my-programming/_aa_e2e/shots/slides-feed-3.png' });

  // 静止状態で画像をタップ → 投稿詳細へ（表示中の3枚目をページ内からクリック）
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelectorAll('article[data-id="1"] .slide .media img')[2].click());
  await page.waitForTimeout(800);
  check('静止中のタップで投稿詳細へ遷移', page.url().includes('post.html?id=1'), page.url());

  // ── 混在メディア（画像/動画/資料）：2コマ目以降も横スクロールで遅延処理される ──
  await page.goto(`http://localhost:${PORT}/app/feed.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('article[data-id="3"] .slides', { timeout: 5000 });
  await page.evaluate(() => document.querySelector('article[data-id="3"]').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(1200);
  const before = await page.evaluate(() => ({
    vidThumb: !!document.querySelector('article[data-id="3"] .vidthumb[src]'),
    docPending: !!document.querySelector('article[data-id="3"] .docprev[data-view]'),
  }));
  check('混在: 未表示コマの資料は先読みしない', before.docPending);
  await page.evaluate(() => {
    const t = document.querySelector('article[data-id="3"] .slides-track');
    t.scrollLeft = t.clientWidth * 2; // 3コマ目(資料)まで送る
  });
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => {
    const a = document.querySelector('article[data-id="3"]');
    const doc = a.querySelector('.docprev');
    return {
      docProcessed: !doc.hasAttribute('data-view'),
      docHasContent: doc.children.length > 0,
      vidThumb: !!a.querySelector('.vidthumb[src]'),
      counter: a.querySelector('.slides-count').textContent.trim(),
    };
  });
  check('混在: 送ったコマの資料が処理される', after.docProcessed && after.docHasContent, JSON.stringify(after));
  check('混在: 動画コマのサムネが読み込まれる', after.vidThumb);
  check('混在: カウンタが 3/3', after.counter === '3/3', after.counter);
  await page.screenshot({ path: 'c:/dev/my-programming/_aa_e2e/shots/slides-mixed.png' });

  // ── 投稿詳細 ──
  await page.goto(`http://localhost:${PORT}/app/post.html?id=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#detail .slides', { timeout: 5000 });
  await page.waitForTimeout(800);
  const d = await page.evaluate(() => {
    const sl = document.querySelector('#detail .slides');
    const t = sl.querySelector('.slides-track');
    return {
      slideCount: sl.querySelectorAll('.slide').length,
      counter: sl.querySelector('.slides-count').textContent.trim(),
      trackH: Math.round(t.getBoundingClientRect().height),
      noHScroll: document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
  check('詳細でも3コマのスライドになる', d.slideCount === 3, `slides=${d.slideCount}`);
  check('詳細のカウンタが 1/3', d.counter === '1/3', d.counter);
  check('詳細のスライドに高さがある', d.trackH > 100, d.trackH + 'px');
  check('詳細が横にはみ出さない', d.noHScroll);
  await page.screenshot({ path: 'c:/dev/my-programming/_aa_e2e/shots/slides-detail.png' });

  // PC幅でも崩れない
  const pc = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await pc.addInitScript(() => localStorage.setItem('aa_token', 'mock-token'));
  const pcPage = await pc.newPage();
  pcPage.on('pageerror', (e) => errs.push('PC PAGEERROR ' + e.message));
  await stub(pcPage);
  await pcPage.goto(`http://localhost:${PORT}/app/feed.html`, { waitUntil: 'domcontentloaded' });
  await pcPage.waitForSelector('article[data-id="1"] .slides', { timeout: 5000 });
  await pcPage.waitForTimeout(800);
  const pcState = await pcPage.evaluate(() => ({
    arrowVisible: getComputedStyle(document.querySelector('article[data-id="1"] .slides-arrow.next')).display !== 'none',
    noHScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
  }));
  await pcPage.hover('article[data-id="1"] .slides');
  await pcPage.waitForTimeout(200);
  const pcHover = await pcPage.evaluate(() => getComputedStyle(document.querySelector('article[data-id="1"] .slides-arrow.next')).display);
  check('PC: ホバーで矢印が出る', pcHover === 'flex', 'display=' + pcHover);
  check('PC: 横にはみ出さない', pcState.noHScroll);
  await pcPage.screenshot({ path: 'c:/dev/my-programming/_aa_e2e/shots/slides-pc.png' });

  if (errs.length) console.log('ERRS', errs.join(' | '));
  await browser.close();
  server.close();
  const ok = results.every(([, v]) => v) && !errs.length;
  console.log(ok ? 'ALL OK' : 'NG: ' + results.filter(([, v]) => !v).map(([n]) => n).join(' / '));
  process.exit(ok ? 0 : 2);
})();
