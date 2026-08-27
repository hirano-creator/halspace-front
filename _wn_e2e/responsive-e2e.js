/* レスポンシブ崩れの検出（幅を振ってレイアウトを実測する）

   確認すること:
   - 選択モードの下部アクションバーで「◯件選択中」が縦書きに潰れないこと
   - 下部アクションバーが横にはみ出さないこと（ボタンの文字がクリップされない）
   - どの幅でもページ全体に横スクロールが出ないこと
   - テキストが「1文字ずつ改行される」潰れ方をしている要素が無いこと（汎用検出）

   実行: node _wn_e2e/responsive-e2e.js
   （バックエンド不要。APIはこのスクリプトが route で全部スタブする）
   SHOT=1 を付けると shots/resp-<幅>.png を残す */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8794;
const BASE = `http://127.0.0.1:${PORT}`;

const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
               '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml',
               '.png':'image/png', '.json':'application/json' };

const IGNORE_ERR = /39876|localhost:39876|ERR_FAILED/;
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

function fileRow(id, name, mime) {
  return {
    id, file_name: name, file_size: 1234567, mime_type: mime,
    version: 1, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
    uploader: { id: 1, name: 'テスト太郎' }, tags: [],
    like_count: 0, liked: false, view_count: 1, comment_count: 0,
    approval_status: 'none', visibility: 'private', owner_user_id: 1, shared_at: null,
    can_edit: true,
  };
}
const FILES = [
  fileRow(1, '製造図面_A-1234_最終版.pdf', 'application/pdf'),
  fileRow(2, 'IMG_7815.jpeg', 'image/jpeg'),
  fileRow(3, 'ヒラノWILL活用フロー_250619.pptx',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
  fileRow(4, '検査報告書.pdf', 'application/pdf'),
];

/* 「1文字ずつ改行される」潰れ方の汎用検出。
   テキストを持つ末端要素で、幅がフォント2文字ぶんも無いのに
   高さが3行以上ある = 縦書きに潰れている。 */
const SQUASH_PROBE = () => {
  const bad = [];
  document.querySelectorAll('body *').forEach(el => {
    if (el.children.length) return;                       // 末端だけ
    const t = (el.textContent || '').trim();
    if (t.length < 2 || t.length > 40) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.writingMode.indexOf('vertical') === 0) return;
    const size  = parseFloat(cs.fontSize) || 14;
    const lineH = parseFloat(cs.lineHeight) || size * 1.4;
    const lines = Math.round(r.height / lineH);
    if (r.width < size * 2.2 && lines >= 3) {
      const who = el.id ? '#' + el.id : (el.className || el.tagName);
      bad.push(`${who}"${t.slice(0, 12)}" ${Math.round(r.width)}x${Math.round(r.height)}px`);
    }
  });
  return bad;
};

/* スマホの固定ボトムナビ（60px）が後ろの操作を覆っていないか。
   ページ側で padding-bottom を確保し忘れると「最後のボタンが押せない」になる */
const NAV_COVER_PROBE = () => {
  const nav = document.querySelector('.bottom-nav');
  /* position:fixed の要素は offsetParent が null になるので表示判定に使えない */
  if (!nav || getComputedStyle(nav).display === 'none') return [];
  const nr = nav.getBoundingClientRect();
  return [...document.querySelectorAll('button, a, textarea, input, select')]
    .filter(el => !nav.contains(el) && el.getClientRects().length > 0
                  && getComputedStyle(el).visibility !== 'hidden')
    .filter(el => {
      const r = el.getBoundingClientRect();
      /* オフキャンバスのサイドバー（画面外へ translate 済み）は対象外 */
      if (r.right <= 0 || r.left >= window.innerWidth) return false;
      return r.height > 0 && r.bottom > nr.top + 2 && r.top < nr.bottom - 2;
    })
    .map(el => el.id || el.className || el.tagName);
};

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });

  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({
      id: 1, name: 'テスト太郎', email: 't@example.com', role: 'super_admin',
      company: 'テスト社', company_id: 1, apps: ['whatsno'],
      wn_storage_mode: 'personal',            // 共有/個人ボタンが両方出る最も混む状態
      wn_extended_options_enabled: true,
    }));
  });

  await ctx.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const p   = url.pathname;
    const j   = (body) => route.fulfill({ status: 200, contentType: 'application/json',
                                          body: JSON.stringify(body) });
    if (p.endsWith('/wn/files')) {
      return j({ data: FILES,
                 meta: { current_page: 1, last_page: 1, per_page: 60, total: FILES.length,
                         storage_mode: 'personal' } });
    }
    if (p.endsWith('/wn/settings'))      return j({ data: { storage_mode: 'personal', my_private_count: 4 } });
    if (p.endsWith('/wn/tags'))          return j({ data: [
      { id: 1, name: '製造',     file_count: 22 }, { id: 2, name: '報告書',   file_count: 3 },
      { id: 3, name: '図面',     file_count: 54 }, { id: 4, name: '品管',     file_count: 4 },
      { id: 5, name: '検査',     file_count: 3 },  { id: 6, name: '樹脂',     file_count: 2 },
      { id: 7, name: '動画',     file_count: 5 },  { id: 8, name: '本体部品', file_count: 2 },
      { id: 9, name: '溶接',     file_count: 2 },  { id: 10, name: '計画書',  file_count: 3 },
    ] });
    /* 他ページ用の最低限のスタブ（レイアウトが出れば十分） */
    if (/\/wn\/files\/\d+$/.test(p))     return j({ data: FILES[0] });
    if (/\/wn\/files\/\d+\/comments$/.test(p)) return j({ data: [] });
    if (p.endsWith('/wn/manuals'))       return j({ data: [
      { id: 1, title: '射出成形機の段取り替え手順（A号機）', updated_at: '2026-08-20T00:00:00Z',
        created_by_name: 'テスト太郎', step_count: 8, tags: [{ id: 1, name: '製造' }, { id: 2, name: '品管' }] },
      { id: 2, title: '検査治具の使い方', updated_at: '2026-08-18T00:00:00Z',
        created_by_name: 'テスト太郎', step_count: 3, tags: [] },
    ] });
    if (p.endsWith('/wn/manuals/tags')) return j({ data: [{ id: 1, name: '製造' }, { id: 2, name: '品管' }] });
    if (p.endsWith('/wn/notifications')) return j({ data: [] });
    if (p.endsWith('/wn/contacts'))      return j({ data: [] });
    if (p.endsWith('/wn/contact-tags'))  return j({ data: [], groups: [] });
    if (p.endsWith('/wn/storage'))       return j({ data: [] });
    return j({ data: [] });
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { if (!noise(e)) errors.push(String(e)); });
  page.on('console', m => { if (m.type() === 'error' && !noise(m.text())) errors.push(m.text()); });

  const WIDTHS = (process.env.WIDTHS || "1920,1600,1500,1440,1400,1366,1280,1100,900,768,430,390,360").split(",").map(Number);

  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: w < 768 ? 780 : 950 });
    await page.goto(`${BASE}/whatsno/app/dashboard.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    /* 選択前（通常表示）でボトムナビが操作を覆っていないか */
    if (w < 768) {
      const covered = await page.evaluate(NAV_COVER_PROBE);
      check(`w=${w} ボトムナビが操作を覆っていない`, covered.length === 0, covered.slice(0, 4).join(' / '));
    }

    /* 選択モードに入って1件選ぶ（スマホは上部の選択ボタンが隠れるので関数を直に叩く） */
    await page.evaluate(() => {
      if (!document.body.classList.contains('select-mode')) toggleSelectMode();
      const card = document.querySelector('[data-file-id]');
      if (card) card.click();
    });
    await page.waitForTimeout(300);

    const m = await page.evaluate(() => {
      const bar   = document.getElementById('mergeActionBar');
      const count = document.getElementById('mergeSelCount');
      const cr    = count.getBoundingClientRect();
      const br    = bar.getBoundingClientRect();
      const btns  = [...bar.querySelectorAll('.btn')].filter(b => b.offsetParent !== null);
      /* ボタンがクリップされていないか（中身の自然幅 > 実幅 なら文字が切れている） */
      const clipped = btns.filter(b => b.scrollWidth - b.clientWidth > 1)
                          .map(b => `${b.id}(${b.clientWidth}<${b.scrollWidth})`);
      /* justify-content:flex-end のはみ出しは左（＝スクロールで追えない側）へ流れ、
         scrollWidth には出ない。中の要素の実座標で見る */
      const cs   = getComputedStyle(bar);
      const padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight);
      const items = [...bar.querySelectorAll('.btn, .merge-sel-count')].filter(b => b.offsetParent !== null);
      const outside = items.filter(b => {
        const r = b.getBoundingClientRect();
        return r.left < br.left + padL - 1 || r.right > br.right - padR + 1;
      }).map(b => b.id || b.className);
      /* 1行に収まっている余裕（負なら折り返している）。フォントが変われば
         必要幅も変わるので、ラベル短縮の境目を決めるときはこの数字を見る */
      const head    = bar.querySelector('.mab-head').getBoundingClientRect().width;
      const actions = bar.querySelector('.mab-actions');
      const kids    = [...actions.children].filter(k => k.offsetParent !== null);
      const aGap    = parseFloat(getComputedStyle(actions).columnGap) || 0;
      const natural = kids.reduce((s, k) => s + k.getBoundingClientRect().width, 0)
                    + Math.max(0, kids.length - 1) * aGap;
      const slack   = Math.round(bar.clientWidth - padL - padR - head
                    - (parseFloat(cs.columnGap) || 0) - natural);
      return {
        countW: Math.round(cr.width), countH: Math.round(cr.height),
        outside, slack,
        barOver: bar.scrollWidth - bar.clientWidth,
        barH: Math.round(br.height),
        clipped,
        docOver: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        visible: btns.length,
      };
    });

    check(`w=${w} 「◯件選択中」が1行`, m.countH <= 26 && m.countW >= 55, `${m.countW}x${m.countH}px`);
    check(`w=${w} アクションバーがはみ出さない`, m.barOver <= 1 && m.outside.length === 0,
      `over=${m.barOver}px bar高${m.barH}px 余裕${m.slack}px ${m.outside.join(" ")}`);
    check(`w=${w} ボタンの文字が切れない`, m.clipped.length === 0, m.clipped.join(' '));
    check(`w=${w} ページ全体に横スクロールが出ない`, m.docOver <= 1, `over=${m.docOver}px`);

    /* ファイルカード: 日付/サイズ行が途中で折り返さないか、
       アクションアイコン（ダウンロード等）がカードの overflow:hidden で切れていないか */
    const card = await page.evaluate(() => {
      const bodies = [...document.querySelectorAll('.file-card')];
      const wrapMeta = [], clipAct = [];
      bodies.forEach((c, i) => {
        const meta = c.querySelector('.file-card-meta');
        const act  = c.querySelector('.file-card-actions');
        /* 行そのものが折り返すのは可（狭ければ仕方ない）。
           「1.2 / MB」のように項目の途中で改行されていたら崩れ */
        if (meta) {
          [...meta.children].forEach(s => {
            const cs   = getComputedStyle(s);
            const size = parseFloat(cs.fontSize) || 11;
            const lh   = parseFloat(cs.lineHeight) || size * 1.4;
            const pad  = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
            const lines = Math.round((s.getBoundingClientRect().height - pad) / lh);
            if (lines >= 2) wrapMeta.push(`card${i}"${s.textContent.trim()}"`);
          });
        }
        if (act && act.scrollWidth - act.clientWidth > 1) {
          clipAct.push(`card${i}(${act.clientWidth}<${act.scrollWidth})`);
        }
      });
      return { wrapMeta, clipAct, cards: bodies.length,
               cardW: bodies[0] ? Math.round(bodies[0].getBoundingClientRect().width) : 0 };
    });
    check(`w=${w} カードの日付/サイズが途中で改行されない`, card.wrapMeta.length === 0,
      `カード幅${card.cardW}px ${card.wrapMeta.join(' ')}`);
    check(`w=${w} カードの操作アイコンが切れない`, card.clipAct.length === 0,
      `カード幅${card.cardW}px ${card.clipAct.join(' ')}`);

    const squashed = await page.evaluate(SQUASH_PROBE);
    check(`w=${w} 縦書きに潰れた文字が無い`, squashed.length === 0, squashed.slice(0, 5).join(' / '));

    if (process.env.SHOT) {
      await page.screenshot({ path: path.join(__dirname, 'shots', `resp-${w}.png`) });
    }
  }

  check('ダッシュボードでJSエラーが出ない', errors.length === 0, errors.slice(0, 3).join(' | '));

  /* ── 他ページ: 同じ潰れ方をしていないかを横断で見る ──
     細かい画面仕様までは踏み込まず、「文字が縦書きに潰れる」「横スクロールが出る」
     の2点だけを全ページ・全幅で当てる（この2つは仕様に関係なく常に崩れ） */
  const PAGES = [
    ['マニュアル一覧', 'app/manuals.html'],
    ['ファイル詳細',   'app/file-detail.html?id=1'],
    ['並べる',         'app/align.html?ids=1,2,3'],
    ['Knowl',          'app/brain.html'],
  ];
  for (const [label, rel] of PAGES) {
    for (const w of [1600, 1280, 900, 390]) {
      errors.length = 0;
      await page.setViewportSize({ width: w, height: w < 768 ? 780 : 950 });
      await page.goto(`${BASE}/whatsno/${rel}`, { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(600);

      const squashed = await page.evaluate(SQUASH_PROBE);
      const over = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);

      /* スマホの固定ボトムナビは後ろの操作を覆う。ページ側で余白を確保していないと
         「最後のボタンが押せない」になる */
      if (w < 768) {
        const covered = await page.evaluate(NAV_COVER_PROBE);
        check(`${label} w=${w} ボトムナビが操作を覆っていない`, covered.length === 0,
          covered.slice(0, 4).join(' / '));
      }
      check(`${label} w=${w} 縦書きに潰れた文字が無い`, squashed.length === 0, squashed.slice(0, 5).join(' / '));
      check(`${label} w=${w} 横スクロールが出ない`, over <= 1, `over=${over}px`);

      /* ファイル詳細: ツールバーは flex-shrink:0 の帯なので、
         はみ出すと押せないまま切り落とされる。実座標で見る */
      if (rel.startsWith('app/file-detail')) {
        const tb = await page.evaluate(() => {
          const bar   = document.querySelector('.detail-topbar');
          const strip = document.querySelector('.detail-topbar-actions');
          if (!bar || !strip) return null;
          const br = bar.getBoundingClientRect();
          const sr = strip.getBoundingClientRect();
          const cs = getComputedStyle(bar);
          const padR = parseFloat(cs.paddingRight);
          return {
            /* 帯そのものがバーからはみ出していたら、その先は取り出せない */
            cut: Math.round(sr.right - (br.right - padR)),
            /* 帯の中で横スクロールしているぶんは指で送れば届く */
            scrollable: strip.scrollWidth - strip.clientWidth,
          };
        });
        check(`${label} w=${w} ツールバーのボタンが切れない`, tb && tb.cut <= 1,
          tb ? `はみ出し${tb.cut}px / 帯内スクロール${tb.scrollable}px` : 'topbarが無い');
      }

      if (process.env.SHOT) {
        await page.screenshot({ path: path.join(__dirname, 'shots', `resp-${rel.replace(/[\/?=,.]/g, '_')}-${w}.png`) });
      }
    }
  }

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('FAILED:\n' + failed.map(f => ` - ${f.name} ${f.detail}`).join('\n'));
  process.exit(failed.length ? 1 : 0);
})();
