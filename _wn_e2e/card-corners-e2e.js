/* ファイルカードの下段（個人・登録者・日付・ページ数）をサムネイルの四隅へ移した B案 の検証

   確認すること:
   - 名前の下に行が残っていない（本文は名前＋右端のいいねだけ）
   - 「個人」は左上、種類とページ数は左下、登録者と日付は右下に載る
   - ページ数が分からないPDFでは、数字なしのアイコンだけが出ない（hidden が効く）
   - マウスを乗せると四隅の札が消え、操作ボタンと重ならない
   - スマホ（2列）でも名前が潰れず、「その他」ボタンが押せる
   - JSエラーが出ない

   実行: node _wn_e2e/card-corners-e2e.js
   別の作業ツリーを見るとき: WN_ROOT=<my-programming相当のパス> node _wn_e2e/card-corners-e2e.js
   SHOT=1 で shots/card-corners-*.png を保存 */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.WN_ROOT || path.join(__dirname, '..'));
const PORT = 8793;
const BASE = `http://127.0.0.1:${PORT}`;

const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
               '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml',
               '.png':'image/png', '.json':'application/json' };
const IGNORE_ERR = /39876|localhost:39876|ERR_FAILED|pdf|PDF/;
const noise = e => IGNORE_ERR.test(String(e));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404); return res.end('nf');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

const now = Date.now();
const iso = ms => new Date(ms).toISOString();
function fileRow(id, name, o = {}) {
  return {
    id, file_name: name, file_size: 123456, mime_type: 'application/pdf',
    version: 1, created_at: iso(now - 5 * 86400e3), updated_at: '2026-10-01T00:00:00Z',
    uploader: { id: 1, name: '平野' }, tags: [],
    like_count: 0, liked: false, view_count: 0, comment_count: 0,
    approval_status: 'none', visibility: 'private', owner_user_id: 1, shared_at: null,
    can_edit: true, folder_id: null, ...o,
  };
}
const FILES = [
  fileRow(1, 'A_44371_DOI_UTBS1635-07D-2_管路挿入型防水装置_φ_125_261030.pdf', { created_at: iso(now - 3600e3) }),
  fileRow(2, 'P15_ブラケット組立図_rev3.pdf', { version: 2, liked: true, like_count: 2, comment_count: 3 }),
  fileRow(3, '検査成績書_2026年10月.pdf', { visibility: 'company', approval_status: 'pending' }),
  fileRow(4, 'ページ数不明.pdf'),
];

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({ channel: 'chrome' });

  async function open(viewport, isMobile) {
    const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, serviceWorkers: 'block' });
    await ctx.addInitScript(() => {
      sessionStorage.setItem('space_token', 'mock-token-e2e');
      sessionStorage.setItem('space_user', JSON.stringify({
        id: 1, name: '平野', email: 't@example.com', role: 'admin',
        company: 'テスト社', company_id: 1, apps: ['whatsno'], wn_storage_mode: 'personal',
      }));
      /* ページ数はキャッシュから入れる（pdf.js を走らせない） */
      localStorage.setItem('wn_pdf_pages_1_2026-10-01T00:00:00Z', '3');
      localStorage.setItem('wn_pdf_pages_2_2026-10-01T00:00:00Z', '12');
      localStorage.setItem('wn_pdf_pages_3_2026-10-01T00:00:00Z', '1');
    });
    await ctx.route('**/api/**', route => {
      const p = new URL(route.request().url()).pathname;
      const j = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (p.endsWith('/wn/files')) return j({ data: FILES,
        meta: { current_page: 1, last_page: 1, per_page: 60, total: FILES.length, storage_mode: 'personal' } });
      if (p.endsWith('/wn/settings')) return j({ data: { storage_mode: 'personal', my_private_count: 3 } });
      if (p.endsWith('/wn/pins')) return j({ data: [{ id: 9, scope: 'me', file_id: 2, file: FILES[1] }] });
      if (/thumbnail|view|preview/.test(p)) return route.fulfill({ status: 404, body: '' });
      return j({ data: [] });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => { if (!noise(e)) errors.push(String(e)); });
    await page.goto(`${BASE}/whatsno/app/dashboard.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wn-card');
    await page.waitForTimeout(800);
    return { ctx, page, errors };
  }

  const card = id => `.wn-card[data-file-id="${id}"]`;
  const box  = (page, sel) => page.locator(sel).first().boundingBox();

  /* ── PC ── */
  {
    const { ctx, page, errors } = await open({ width: 1440, height: 950 }, false);
    check('PC: JSエラーが出ない', errors.length === 0, errors.join(' | '));

    const body = await page.locator(`${card(1)} .file-card-body`).innerText();
    check('本文に「個人」も日付も残っていない', !/個人|前|平/.test(body.replace(/A_44371.*$/s, '')), JSON.stringify(body));

    const t  = await box(page, `${card(1)} .file-card-thumb`);
    const bd = await box(page, `${card(1)} .wn-card-badges`);
    const kd = await box(page, `${card(1)} .wn-card-kind`);
    const wh = await box(page, `${card(1)} .wn-card-who`);
    check('「個人」は左上', bd && bd.x - t.x < 20 && bd.y - t.y < 20, JSON.stringify(bd));
    check('種類は左下', kd && kd.x - t.x < 20 && (t.y + t.height) - (kd.y + kd.height) < 20, JSON.stringify(kd));
    check('登録者・日付は右下', wh && (t.x + t.width) - (wh.x + wh.width) < 20 && (t.y + t.height) - (wh.y + wh.height) < 20, JSON.stringify(wh));

    const whoTxt = await page.locator(`${card(1)} .wn-card-who`).innerText();
    check('右下に NEW・登録者・日付', /NEW/.test(whoTxt) && /平/.test(whoTxt) && /前|今日|昨日/.test(whoTxt), JSON.stringify(whoTxt));

    const kind1 = await page.locator(`${card(1)} .wn-card-pages .cnt`).evaluate(e => e.textContent + getComputedStyle(e, '::after').content.replace(/"/g, ''));
    const kind4 = await page.locator(`${card(4)} .wn-card-kind`).innerText();
    const pg4   = await page.locator(`${card(4)} .wn-card-pages`).isVisible();
    check('ページ数が「3枚」と出る', /3\s*枚/.test(kind1), JSON.stringify(kind1));
    check('ページ数不明・1枚のときは何も出ない', !pg4 && kind4.trim() === 'PDF', JSON.stringify(kind4));

    const b2 = await page.locator(`${card(3)} .wn-card-badges`).innerText();
    check('承認バッジも左上に並ぶ', /承認申請中/.test(b2), JSON.stringify(b2));

    const ch = await page.locator(`${card(1)} .file-card-body`).evaluate(e => e.getBoundingClientRect().height);
    check('文字部分が名前2行ぶんに縮んでいる', ch < 62, `${Math.round(ch)}px`);

    const like = await box(page, `${card(2)} .like-btn`);
    const nm   = await box(page, `${card(2)} .file-card-name`);
    check('いいねが名前の右にある', like && like.x > nm.x + nm.width - 2, JSON.stringify({ like, nm }));

    /* このページは Playwright のマウス移動で :hover が付かない（変更前から同じ）ので、CDP でホバー状態にする */
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: card(1) });
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
    await page.waitForTimeout(300);
    const op = await page.locator(`${card(1)} .wn-card-who`).evaluate(e => getComputedStyle(e).opacity);
    const hov = await page.locator(`${card(1)} .wn-card-hover`).evaluate(e => getComputedStyle(e).opacity);
    check('マウスを乗せると札が消えて操作ボタンが出る', op === '0' && hov === '1', `who=${op} hover=${hov}`);
    if (process.env.SHOT) await page.screenshot({ path: path.join(__dirname, 'shots/card-corners-pc.png'), clip: { x: 200, y: 0, width: 1240, height: 950 } });
    await ctx.close();
  }

  /* ── スマホ ── */
  {
    const { ctx, page, errors } = await open({ width: 390, height: 844 }, true);
    check('スマホ: JSエラーが出ない', errors.length === 0, errors.join(' | '));
    const more = await page.locator(`${card(1)} .wn-card-more`).isVisible();
    check('スマホ: 「その他」ボタンが見える', more);
    const nm = await box(page, `${card(1)} .file-card-name`);
    check('スマホ: 名前の幅が十分ある', nm && nm.width > 100, `${Math.round(nm?.width)}px`);
    const who = await box(page, `${card(1)} .wn-card-who`);
    const kd  = await box(page, `${card(1)} .wn-card-kind`);
    check('スマホ: 左下と右下の札が重ならない', who && kd && kd.x + kd.width < who.x, JSON.stringify({ kd, who }));
    if (process.env.SHOT) await page.screenshot({ path: path.join(__dirname, 'shots/card-corners-sp.png') });
    await ctx.close();
  }

  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) process.exit(1);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
