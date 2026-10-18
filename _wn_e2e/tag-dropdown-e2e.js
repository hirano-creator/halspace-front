/* 一覧の「タグ ▾」化の検証（常設のタグ段をやめ、種類チップの右端から開くパネルにした）

   確認すること:
   - PC: タグの段が最初は出ていない／種類チップの右端に区切り線＋「タグ ▾」がある
   - PC: 押すとチップの真下にパネルが開き、タグを押すと tag= 付きで再取得・パネルは開いたまま
   - PC: 外側クリック・Esc で閉じる。絞り込み中はチップに件数が出る
   - 種類が1つしかない一覧でも「タグ ▾」だけは出る
   - スマホ: 「タグ ▾」でボトムシートが開き、背景タップで閉じる
   - JSエラーが出ない

   実行: node _wn_e2e/tag-dropdown-e2e.js [配信ルート]
   （配信ルートの既定は my-programming。worktree で試すときはそのルートを渡す） */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const PORT = 8793;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(__dirname, 'shots');

const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
               '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml',
               '.png':'image/png', '.json':'application/json' };
const IGNORE_ERR = /39876|ERR_FAILED|Failed to load resource/;
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

const TAGS = ['製造', '報告書', '図面', '品管', '検査', '樹脂', '動画', '本体部品', '溶接', '計画書', '治具', '外注']
  .map((name, i) => ({ id: i + 1, name, files_count: 3 + i }));

function fileRow(id, name, mime) {
  return {
    id, file_name: name, file_size: 1234, mime_type: mime,
    version: 1, created_at: '2026-10-17T00:00:00Z', updated_at: '2026-10-17T00:00:00Z',
    uploader: { id: 1, name: 'テスト太郎' }, tags: [],
    like_count: 0, liked: false, view_count: 0, comment_count: 0,
    approval_status: 'none', visibility: 'private', owner_user_id: 1, shared_at: null, can_edit: true,
  };
}

async function run(viewport, label, singleKind = false) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block',
    hasTouch: viewport.width < 768, isMobile: viewport.width < 768 });
  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({
      id: 1, name: 'テスト太郎', email: 't@example.com', role: 'admin',
      company: 'テスト社', company_id: 1, apps: ['whatsno'], wn_storage_mode: 'shared',
    }));
  });
  const calls = [];
  await ctx.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const p   = url.pathname;
    const j   = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (p.endsWith('/wn/files')) {
      calls.push(Object.fromEntries(url.searchParams));
      return j({
        data: [fileRow(1, '図面A.pdf', 'application/pdf'), fileRow(2, '写真.jpg', 'image/jpeg')],
        meta: { current_page: 1, last_page: 1, per_page: 60, total: 2, storage_mode: 'shared',
                type_counts: singleKind ? { pdf: 2 } : { pdf: 212, cad: 6, image: 95, video: 5, office: 19, other: 1 } },
      });
    }
    if (p.endsWith('/wn/tags'))          return j({ data: TAGS });
    if (p.endsWith('/wn/settings'))      return j({ data: { storage_mode: 'shared', my_private_count: 0 } });
    if (p.endsWith('/wn/contact-tags'))  return j({ data: [], groups: [] });
    if (/thumb/.test(p))                 return route.fulfill({ status: 404, body: '' });
    return j({ data: [] });
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { if (!noise(e)) errors.push(String(e)); });
  page.on('console', m => { if (m.type() === 'error' && !noise(m.text())) errors.push(m.text()); });

  await page.goto(`${BASE}/whatsno/app/dashboard.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const card = page.locator('#tagFilterCard');
  const chip = page.locator('#wnTagChip');

  if (singleKind) {
    check(`[${label}] 種類が1つでも「タグ ▾」は出る`, await chip.isVisible());
    check(`[${label}] 種類が1つなら種類チップは出ない`, await page.locator('[data-wn-kind]').count() === 0);
    await browser.close();
    return errors;
  }

  check(`[${label}] 最初はタグの段が出ていない`, !(await card.isVisible()));
  check(`[${label}] 種類チップの右端に「タグ ▾」`, await page.evaluate(() => {
    const bar = document.getElementById('wnKindBar');
    const last = bar.lastElementChild, sep = last?.previousElementSibling;
    return last?.id === 'wnTagChip' && sep?.classList.contains('wn-kind-sep') && bar.querySelectorAll('[data-wn-kind]').length >= 2;
  }));
  await page.screenshot({ path: path.join(SHOTS, `tag-dropdown-${label}-closed.png`) });

  await chip.click();
  await page.waitForTimeout(300);
  check(`[${label}] 押すとタグ一覧が開く`, await card.isVisible());

  if (label === 'pc') {
    const cb = await chip.boundingBox(), pb = await card.boundingBox();
    check('[pc] パネルはチップの真下', pb.y >= cb.y + cb.height && pb.y - (cb.y + cb.height) < 20, `chip下端=${cb.y + cb.height} panel上端=${pb.y}`);
    await page.screenshot({ path: path.join(SHOTS, 'tag-dropdown-pc-open.png') });

    const before = calls.length;
    await page.locator('#tagFilterList .tag[data-tag-id="3"]').click();
    await page.waitForTimeout(500);
    check('[pc] タグを押すと tag= 付きで取り直す', calls.length > before && calls[calls.length - 1].tag === '3', JSON.stringify(calls[calls.length - 1]));
    check('[pc] タグを押してもパネルは開いたまま', await card.isVisible());
    check('[pc] チップに絞り込み件数が出る', /1件で絞り込み中/.test(await chip.textContent()));

    /* 「その他 2個」から11個目以降も選べる（ポップアップで閉じない） */
    await page.locator('#tagMoreBtn').click();
    await page.waitForTimeout(200);
    await page.locator('#tagPopup .tag[data-tag-id="11"]').click();
    await page.waitForTimeout(400);
    check('[pc] その他のタグを押してもパネルは閉じない', await card.isVisible());
    check('[pc] その他のタグも AND で効く', calls[calls.length - 1].tag === '3,11', JSON.stringify(calls[calls.length - 1]));
    await page.screenshot({ path: path.join(SHOTS, 'tag-dropdown-pc-selected.png') });

    await page.mouse.click(700, 600);
    await page.waitForTimeout(300);
    check('[pc] 外側クリックで閉じる', !(await card.isVisible()) && !(await page.locator('#tagPopup').count()));
    check('[pc] 閉じても絞り込み中の表示は残る', (await chip.getAttribute('class')).includes('is-on') && /2件/.test(await chip.textContent()));

    await chip.click();
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check('[pc] Esc で閉じる', !(await card.isVisible()));

    /* 種類チップとタグは同時に効く */
    await page.locator('[data-wn-kind="pdf"]').click();
    await page.waitForTimeout(400);
    const lc = calls[calls.length - 1];
    check('[pc] 種類とタグは併用できる', lc.type === 'pdf' && lc.tag === '3,11', JSON.stringify(lc));
  } else {
    await page.screenshot({ path: path.join(SHOTS, `tag-dropdown-${label}-open.png`) });
    await page.locator('#tagSheetBackdrop').click({ position: { x: 20, y: 20 } });
    await page.waitForTimeout(300);
    check(`[${label}] 背景タップで閉じる`, !(await card.isVisible()));
  }

  check(`[${label}] JSエラーなし`, errors.length === 0, errors.join(' | '));
  await browser.close();
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await new Promise(r => server.listen(PORT, r));
  try {
    await run({ width: 1440, height: 900 }, 'pc');
    await run({ width: 1440, height: 900 }, 'pc-single', true);
    await run({ width: 390, height: 844 }, 'sp');
  } catch (e) {
    check('例外なく完走', false, e.stack);
  }
  server.close();
  const ng = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - ng}/${results.length} PASS`);
  process.exit(ng ? 1 : 0);
})();
