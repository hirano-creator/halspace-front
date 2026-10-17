/* ファイル詳細画面（目的別メニューバー型・2026-10 刷新）のE2E検証（バックエンドなし・APIモック）

   確認すること:
   - ヘッダーの目的別ボタン（社外に送る／社内で使う／加工・出力／3D化を発注／ダウンロード）とメニューの中身
   - メニューの項目は既存ボタン（id同じ）なので、押すと既存の処理（メールモーダル等）が動く
   - 「その他」からファイル情報・タグ・バージョン・承認が開ける（ヘッダーから外した機能の行き先）
   - 類似ファイルの「関連に追加」で関連付けされ、関連タブに反映される
   - SOLID未契約は「3D化を発注」を出さず「その他」に案内、拡張オプション無しはメール/LINE/注釈を出さない
   - 1920〜880pxを40px刻み＋スマホで、ヘッダーが崩れない（タイトルが潰れない・文字がはみ出さない・横スクロール無し）

   実行: node _wn_e2e/file-detail-layout-e2e.js（サーバーはこのスクリプトが立てる）
   SHOT=1 を付けると shots/fd-*.png を残す */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8796;
const BASE = `http://127.0.0.1:${PORT}/whatsno`;
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
               '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml',
               '.png':'image/png', '.json':'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404); return res.end('nf');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

const PNG = fs.readFileSync(path.join(ROOT, 'solid', 'icon-512.png'));
const FILE = {
  id: 1, file_name: '3Dデータから2D図面へ.png', mime_type: 'image/png', file_size: 2516582,
  version: 3, created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-16T00:00:00Z',
  uploader: { id: 1, name: '平野' }, tags: [{ id: 11, name: '販促' }, { id: 12, name: 'SOLIDWORKS' }],
  like_count: 2, liked: false, view_count: 5, approval_status: 'pending',
  visibility: 'private', can_edit: true,
};
const SIMILAR = [
  { id: 21, file_name: '3Dデータから2D図面へ_横長.png', mime_type: 'image/png', similarity: 0.96, file_size: 1000 },
  { id: 22, file_name: 'サービス紹介_2026.pdf', mime_type: 'application/pdf', similarity: 0.88, file_size: 2000 },
];

async function mockApi(page) {
  const relations = [
    { id: 31, relation_id: 501, file_name: '板金BOX_外形図.dxf', mime_type: 'application/dxf', version: 1, created_at: '2026-10-02T00:00:00Z' },
  ];
  const calls = { addRelation: 0 };
  await page.route('**/api/wn/**', r => r.fulfill({ json: { data: [] } }));
  await page.route('**/api/wn/files/1', r => r.fulfill({ json: { data: FILE } }));
  await page.route('**/api/wn/files/1/view*', r => r.fulfill({ json: { url: `http://127.0.0.1:${PORT}/__png` } }));
  await page.route('**/__png', r => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.route('**/api/wn/files/1/public-view*', r => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.route('**/api/wn/files/1/similar', r => r.fulfill({ json: { data: SIMILAR } }));
  await page.route('**/api/wn/files/1/versions', r => r.fulfill({ json: { data: [
    { id: 1, version: 3, file_name: FILE.file_name, created_at: '2026-10-16T00:00:00Z', file_size: 100 },
    { id: 2, version: 2, file_name: FILE.file_name, created_at: '2026-10-15T00:00:00Z', file_size: 100 },
  ] } }));
  await page.route('**/api/wn/files/1/comments', r => r.fulfill({ json: { data: [
    { id: 1, body: '矢印の色、もう少し濃くできますか？', created_at: '2026-10-16T05:02:00Z', user: { id: 2, name: '山田' } },
  ] } }));
  await page.route('**/api/wn/files/1/relations', r => {
    if (r.request().method() === 'POST') {
      calls.addRelation++;
      const rid = JSON.parse(r.request().postData()).related_id;
      const s = SIMILAR.find(x => x.id === rid);
      relations.push({ id: rid, relation_id: 600 + rid, file_name: s.file_name, mime_type: s.mime_type, version: 1 });
      return r.fulfill({ json: { data: { id: 600 + rid } } });
    }
    return r.fulfill({ json: { data: relations } });
  });
  return calls;
}

function userJson({ solid = true, ext = true } = {}) {
  return JSON.stringify({
    id: 1, name: '平野', role: 'admin', email: 't@example.com', company_id: 1,
    apps: solid ? ['whatsno', 'solid'] : ['whatsno'],
    wn_extended_options_enabled: ext, wn_storage_mode: 'personal',
  });
}

async function openDetail(browser, opts = {}, viewport = { width: 1600, height: 900 }) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport });
  await ctx.addInitScript(u => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', u);
  }, userJson(opts));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const calls = await mockApi(page);
  await page.goto(`${BASE}/app/file-detail.html?id=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.getElementById('topFileName').textContent.length > 0);
  await page.waitForTimeout(400);
  return { ctx, page, errors, calls };
}

const visible = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) return false;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
}, sel);

/* ヘッダーの崩れを実測する（タイトルの潰れ・ボタン内の文字はみ出し・横スクロール） */
const HEAD_PROBE = () => {
  const head = document.querySelector('.fd-head');
  const title = document.getElementById('topFileName');
  const over = [...document.querySelectorAll('.fd-ib > span, .fd-sq')]
    .filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1)
    .map(e => e.textContent.trim().slice(0, 12));
  const hr = head.getBoundingClientRect();
  const outside = [...head.querySelectorAll('.fd-ib, .fd-sq')]
    .filter(e => e.offsetParent)
    .filter(e => { const r = e.getBoundingClientRect(); return r.right > hr.right + 1 || r.left < hr.left - 1; })
    .map(e => e.textContent.trim().slice(0, 8));
  return {
    headH: Math.round(hr.height),
    titleH: title.offsetHeight,
    titleW: title.clientWidth,
    over, outside,
    hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  /* ════ 1. PC：ヘッダーとメニュー ════ */
  {
    const { ctx, page, errors, calls } = await openDetail(browser);
    const labels = await page.$$eval('.fd-intent .fd-ib b', els => els.filter(e => e.offsetParent).map(e => e.textContent));
    check('目的別ボタンが5つ並ぶ（SOLID契約あり）', labels.join('/') === '社外に送る/社内で使う/加工・出力/3D化を発注/ダウンロード', labels.join('/'));
    const chips = await page.$$eval('#fdMeta .fd-chip', els => els.map(e => e.textContent.trim()));
    check('タイトル下は公開範囲とタグだけ（容量は出さない）', chips.join(',') === '自分のみ,#販促,#SOLIDWORKS', chips.join(','));
    check('いいねの件数が出る', (await page.textContent('#likeCount')) === '2');
    check('承認・バージョンはヘッダーに出ない', !(await visible(page, '#approvalBadge')) && !(await visible(page, '#fileVersionBadge')));

    await page.click('.fd-intent .fd-dd:nth-child(1) [data-fd-menu]');
    const outItems = await page.$$eval('.fd-dd.open .fd-mi', els => els.filter(e => getComputedStyle(e).display !== 'none').map(e => e.querySelector('b').textContent));
    check('社外に送る：メール・LINE・QR', outItems.join('/') === 'メールで送る/LINEで送る/QRコード', outItems.join('/'));
    if (process.env.SHOT) await page.screenshot({ path: path.join(SHOTS, 'fd-menu-out.png') });
    await page.click('#emailShareBtn');
    await page.waitForTimeout(300);
    check('メニューの「メールで送る」で既存のメール画面が開く', await visible(page, '#emailModal'));
    check('項目を押したらメニューは閉じる', (await page.$$('.fd-dd.open')).length === 0);
    await page.click('#emailModalClose');

    await page.click('.fd-intent .fd-dd:nth-child(3) [data-fd-menu]');
    check('加工・出力：注釈が出る（拡張オプションあり・PNG）', await visible(page, '#annotateBtn'));
    check('加工・出力：形式を変換が出る（PNGは変換対応）', await visible(page, '#fdConvertOpen'));
    await page.click('#fdConvertOpen');
    check('形式を変換の画面に変換フォームが出る', await visible(page, '#fdConvertModal #convertBtn'));
    await page.click('#fdConvertModal [data-fd-close]');

    await page.click('.fd-util [data-fd-menu]');
    const approvalDesc = await page.textContent('#fdApprovalMenuDesc');
    check('その他：承認の説明に今の状況が出る', approvalDesc.includes('承認申請中'), approvalDesc);
    await page.click('[data-fd-open="fdInfoModal"]');
    const info = await page.textContent('#fileInfo');
    check('ファイル情報に種類・容量が出る', info.includes('PNG') && /2\.\d\s*MB/.test(info), info.replace(/\s+/g, ' ').slice(0, 80));
    if (process.env.SHOT) await page.screenshot({ path: path.join(SHOTS, 'fd-info.png') });
    await page.mouse.click(5, 5);
    check('モーダルの外側を押すと閉じる', !(await visible(page, '#fdInfoModal')));

    await page.click('.fd-util [data-fd-menu]');
    await page.click('[data-fd-open="fdVersionModal"]');
    await page.waitForTimeout(200);
    const vers = await page.$$eval('#versionList .version-item', els => els.length);
    check('その他：バージョン履歴が開ける', vers === 2, `${vers}件`);
    await page.click('#fdVersionModal [data-fd-close]');

    await page.click('.fd-util [data-fd-menu]');
    await page.click('[data-fd-open="fdApprovalModal"]');
    const apBody = await page.textContent('#approvalCardBody');
    check('その他：承認画面に状況と操作が出る', apBody.includes('承認申請中') && await visible(page, '#approveBtn'), apBody.trim().slice(0, 20));
    await page.click('#fdApprovalModal [data-fd-close]');

    await page.click('#fdMeta');
    check('タイトル下のタグを押すとタグ編集が開く', await visible(page, '#fdTagModal') && (await page.$$('#tagList .tag-removable')).length === 2);
    await page.click('#fdTagModal [data-fd-close]');

    /* 関連・類似 */
    check('関連タブに関連ファイルが出る', (await page.$$('#relationList .relation-item')).length === 1);
    await page.click('#tabSimilarBtn');
    const sims = await page.$$eval('#similarList .similar-item', els => els.length);
    check('類似タブに類似ファイルが出る', sims === 2 && (await page.textContent('#similarBadge')) === '2', `${sims}件`);
    await page.click('#similarList button.similar-link-btn');
    await page.waitForTimeout(400);
    const done = await page.$$eval('#similarList .similar-link-btn.done', els => els.length);
    await page.click('#tabRelationBtn');
    const rels = (await page.$$('#relationList .relation-item')).length;
    check('類似の「関連に追加」で関連付けされ、関連タブに増える', calls.addRelation === 1 && done === 1 && rels === 2,
      `POST=${calls.addRelation} 済=${done} 関連=${rels}`);
    check('コメント件数がカード見出しに出る', (await page.textContent('#commentBadge')) === '1');

    await page.click('#topFileName');
    check('タイトルを押すとファイル名を変更できる', await visible(page, '#topFileNameInput'));
    await page.keyboard.press('Escape');

    if (process.env.SHOT) await page.screenshot({ path: path.join(SHOTS, 'fd-pc-1600.png') });
    check('PC: JSエラーが出ない', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  /* ════ 2. SOLID未契約・拡張オプション無し ════ */
  {
    const { ctx, page, errors } = await openDetail(browser, { solid: false, ext: false });
    const labels = await page.$$eval('.fd-intent .fd-ib b', els => els.filter(e => e.offsetParent).map(e => e.textContent));
    check('SOLID未契約：「3D化を発注」を出さない', !labels.includes('3D化を発注'), labels.join('/'));
    await page.click('.fd-util [data-fd-menu]');
    check('SOLID未契約：「その他」に3Dモデル制作のご案内', await visible(page, '#fdSolidInfoBtn'));
    await page.click('#fdSolidInfoBtn');
    const href = await page.getAttribute('#fdSolidModal a.btn-outline', 'href');
    check('ご案内に紹介・問い合わせのリンク', await visible(page, '#fdSolidModal') && href.endsWith('solid/index.html#contact'), href);
    await page.click('#fdSolidModal [data-fd-close]');
    await page.click('.fd-intent .fd-dd:nth-child(1) [data-fd-menu]');
    const outItems = await page.$$eval('.fd-dd.open .fd-mi', els => els.filter(e => getComputedStyle(e).display !== 'none').map(e => e.querySelector('b').textContent));
    check('拡張オプション無し：社外に送るはQRだけ', outItems.join('/') === 'QRコード', outItems.join('/'));
    await page.click('.fd-intent .fd-dd:nth-child(3) [data-fd-menu]');
    check('拡張オプション無し：注釈を出さない', !(await visible(page, '#annotateBtn')));
    check('未契約: JSエラーが出ない', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  /* ════ 3. 幅を振ってヘッダーの崩れを実測 ════ */
  {
    const { ctx, page, errors } = await openDetail(browser);
    const bad = [];
    const heights = new Set();
    for (let w = 1920; w >= 880; w -= 40) {
      await page.setViewportSize({ width: w, height: 860 });
      await page.waitForTimeout(80);
      const r = await page.evaluate(HEAD_PROBE);
      heights.add(`${w > 1180 ? '1段' : '2段'}:${r.headH}`);
      if (r.titleH > 30 || r.titleW < 150 || r.over.length || r.outside.length || r.hscroll > 1) {
        bad.push(`${w}px ${JSON.stringify(r)}`);
      }
    }
    check('1920〜880px: タイトルが潰れず・文字がはみ出さず・横スクロール無し', bad.length === 0, bad.slice(0, 3).join(' / '));
    check('1920〜880px: ヘッダーの高さが段ごとに一定', heights.size === 2, [...heights].join(' '));

    await page.setViewportSize({ width: 1200, height: 860 });
    await page.hover('.fd-intent .fd-dd:nth-child(2) .fd-ib');
    await page.waitForTimeout(500);
    const tip = await page.evaluate(() => getComputedStyle(document.querySelector('.fd-intent .fd-dd:nth-child(2) .fd-ib'), '::after').opacity);
    check('説明文を隠す幅(1200px)ではマウスを乗せると説明が出る', tip === '1', `opacity=${tip}`);

    /* スマホ */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    const m = await page.evaluate(HEAD_PROBE);
    check('スマホ: ボタンの文字がはみ出さない・横スクロール無し', !m.over.length && !m.outside.length && m.hscroll <= 1, JSON.stringify(m));
    await page.click('.fd-intent .fd-dd:nth-child(1) [data-fd-menu]');
    const sheet = await page.evaluate(() => {
      const r = document.querySelector('.fd-dd.open .fd-menu').getBoundingClientRect();
      return { l: r.left, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight, dim: document.body.classList.contains('fd-menu-open') };
    });
    check('スマホ: メニューは画面下のシートで画面内に収まる', sheet.l >= 0 && sheet.r <= sheet.vw && sheet.b <= sheet.vh && sheet.dim, JSON.stringify(sheet));
    if (process.env.SHOT) await page.screenshot({ path: path.join(SHOTS, 'fd-mobile-menu.png') });
    await page.mouse.click(200, 100);
    check('スマホ: 背景を押すとシートが閉じる', (await page.$$('.fd-dd.open')).length === 0);
    if (process.env.SHOT) await page.screenshot({ path: path.join(SHOTS, 'fd-mobile.png'), fullPage: true });
    check('幅振り: JSエラーが出ない', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('FAILED:\n' + failed.map(f => ` - ${f.name} ${f.detail}`).join('\n'));
  process.exit(failed.length ? 1 : 0);
})();
