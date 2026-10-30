/* ファイル詳細の「写真アプリに保存」（iPhone・iPad で写真・動画を開いたとき）のE2E
   バックエンドなし・APIモック。navigator.share / canShare はスタブ（実機の共有シートは開かない）。
   サーバーはこのスクリプトが立てる。SHOT=1 で shots/photo-save-*.png

   確認すること:
   - iPhone で写真を開くと、ダウンロードがメニュー（写真アプリに保存／ファイルに保存）になる
   - メニューを開いた時点でファイルを読み込み、終わったら「写真アプリに保存」が押せる
   - 押すと共有シートに正しい名前・種類・中身のファイルが渡る。閉じただけ(AbortError)なら何も出さない
   - 「ファイルに保存」は従来のダウンロード
   - PDF・PC・100MB超・共有でファイルを渡せない端末は、従来どおりダウンロードを押すとすぐ保存 */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8798;
const BASE = `http://127.0.0.1:${PORT}/whatsno`;
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const SHOT = !!process.env.SHOT;

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
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const PC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function fileOf(name, mime, size = PNG.length) {
  return {
    id: 1, file_name: name, mime_type: mime, file_size: size,
    version: 1, created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-16T00:00:00Z',
    uploader: { id: 1, name: '平野' }, tags: [], like_count: 0, liked: false, view_count: 1,
    visibility: 'private', can_edit: true,
  };
}

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  /* share: 'ok' | 'abort' | 'none'（canShare なし）| 'nofiles'（canShare がファイルを断る） */
  async function open({ file, ua = IPHONE_UA, viewport = { width: 390, height: 844 }, share = 'ok', delay = 0 }) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport, userAgent: ua, hasTouch: ua === IPHONE_UA });
    await ctx.addInitScript(([share]) => {
      const u = JSON.stringify({ id: 1, name: '平野', role: 'admin', email: 't@example.com', company_id: 1,
        wn_extended_options_enabled: true, apps: ['whatsno'] });
      sessionStorage.setItem('space_token', 'mock-token-e2e');
      sessionStorage.setItem('space_user', u);
      window.__shared = [];
      window.__downloads = 0;
      if (share === 'none') { delete Navigator.prototype.canShare; delete Navigator.prototype.share; return; }
      Navigator.prototype.canShare = d => share !== 'nofiles' || !d?.files;
      Navigator.prototype.share = async d => {
        const f = d.files[0];
        const head = new Uint8Array(await f.slice(0, 8).arrayBuffer());
        window.__shared.push({ name: f.name, type: f.type, size: f.size, png: head[1] === 0x50 && head[2] === 0x4e, active: navigator.userActivation?.isActive });
        if (share === 'abort') throw new DOMException('cancelled', 'AbortError');
      };
    }, [share]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const fetched = { body: 0 };
    await page.route('**/api/wn/**', r => {
      const u = r.request().url();
      if (/\/thumb/.test(u)) return r.fulfill({ status: 404, body: '' });
      if (/public-view/.test(u)) return r.fulfill({ contentType: file.mime_type, body: PNG });
      if (/\/wn\/files\/1\/view/.test(u)) return r.fulfill({ json: { url: `http://127.0.0.1:${PORT}/__body` } });
      if (/\/wn\/files\/1(\?|$)/.test(u)) return r.fulfill({ json: { data: file } });
      return r.fulfill({ json: { data: [] } });
    });
    await page.route('**/__body', async r => {
      fetched.body++;
      if (delay) await new Promise(x => setTimeout(x, delay));
      r.fulfill({ contentType: file.mime_type, body: PNG, headers: { 'Content-Length': String(PNG.length) } });
    });
    await page.goto(`${BASE}/app/file-detail.html?id=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('topFileName').textContent.length > 0, null, { timeout: 15000 });
    await page.waitForTimeout(600);
    /* 従来のダウンロードは呼ばれた回数だけ数える（実際には落とさない） */
    await page.evaluate(() => { window.wnDownload = () => { window.__downloads++; }; });
    return { ctx, page, errors, fetched };
  }

  const menuOpen = page => page.evaluate(() => document.getElementById('downloadBtn').closest('.fd-dd').classList.contains('open'));

  /* ════ 1. iPhone・写真 ════ */
  {
    const { ctx, page, errors, fetched } = await open({ file: fileOf('現場写真_0012.png', 'image/png'), delay: 700 });
    const before = fetched.body;
    await page.click('#downloadBtn');
    await page.waitForTimeout(150);
    check('ダウンロードを押すとメニューが開く', await menuOpen(page));
    const sheet = await page.evaluate(() => { const r = document.getElementById('fdDlMenu').getBoundingClientRect(); return [r.left, r.right, innerWidth]; });
    check('メニューは画面下の幅いっぱいのシート', Math.round(sheet[0]) === 8 && Math.round(sheet[2] - sheet[1]) === 8, JSON.stringify(sheet));
    check('すぐには保存しない', (await page.evaluate(() => window.__downloads)) === 0);
    const st0 = await page.evaluate(() => ({ dis: document.getElementById('savePhotoBtn').disabled, t: document.getElementById('savePhotoDesc').textContent }));
    check('読み込み中は「写真アプリに保存」を押せない', st0.dis && st0.t.includes('準備'), st0.t);
    if (SHOT) await page.screenshot({ path: path.join(SHOTS, 'photo-save-loading.png') });
    await page.waitForFunction(() => !document.getElementById('savePhotoBtn').disabled, null, { timeout: 10000 });
    const st1 = await page.evaluate(() => document.getElementById('savePhotoDesc').textContent);
    check('読み込みが終わると押せて、次に押すボタンを案内する', st1.includes('画像を保存'), st1);
    check('メニューを開いた時点でファイルを読み込む', fetched.body === before + 1, `${before} → ${fetched.body}`);
    if (SHOT) await page.screenshot({ path: path.join(SHOTS, 'photo-save-ready.png') });
    await page.click('#savePhotoBtn');
    await page.waitForTimeout(200);
    const shared = await page.evaluate(() => window.__shared);
    check('共有シートにファイルが1つ渡る', shared.length === 1, JSON.stringify(shared));
    check('名前・種類・中身がそのまま', shared[0]?.name === '現場写真_0012.png' && shared[0]?.type === 'image/png'
      && shared[0]?.size === PNG.length && shared[0]?.png, JSON.stringify(shared[0]));
    check('押した直後に共有を呼ぶ（待たない）', shared[0]?.active === true, String(shared[0]?.active));
    check('メニューは閉じる', !(await menuOpen(page)));

    /* 2回目は読み込み直さない */
    await page.click('#downloadBtn');
    await page.waitForTimeout(200);
    check('2回目は読み込み直さずすぐ押せる', fetched.body === before + 1
      && !(await page.evaluate(() => document.getElementById('savePhotoBtn').disabled)));
    await page.click('#saveFileBtn');
    await page.waitForTimeout(150);
    check('「ファイルに保存」は従来のダウンロード', (await page.evaluate(() => window.__downloads)) === 1);
    check('ページエラーなし（写真）', errors.length === 0, errors.join(' / '));
    await ctx.close();
  }

  /* ════ 2. iPhone・動画、共有シートを閉じただけ ════ */
  {
    const { ctx, page, errors } = await open({ file: fileOf('検査動画.mov', 'video/quicktime'), share: 'abort' });
    await page.click('#downloadBtn');
    await page.waitForFunction(() => !document.getElementById('savePhotoBtn').disabled, null, { timeout: 10000 });
    const t = await page.evaluate(() => document.getElementById('savePhotoDesc').textContent);
    check('動画は「ビデオを保存」を案内する', t.includes('ビデオを保存'), t);
    await page.click('#savePhotoBtn');
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => ({ shared: window.__shared, toast: document.querySelector('.toast, .wn-toast')?.textContent || '' }));
    check('動画は video/quicktime で渡る', s.shared[0]?.type === 'video/quicktime' && s.shared[0]?.name === '検査動画.mov', JSON.stringify(s.shared[0]));
    check('共有シートを閉じただけならエラーを出さない', !s.toast.includes('保存できませんでした'), s.toast);
    check('ページエラーなし（動画）', errors.length === 0, errors.join(' / '));
    await ctx.close();
  }

  /* ════ 3. 従来どおりすぐ保存するもの ════ */
  const direct = [
    ['iPhone の PDF', { file: fileOf('図面.pdf', 'application/pdf') }],
    ['PC の写真', { file: fileOf('現場写真.png', 'image/png'), ua: PC_UA, viewport: { width: 1440, height: 900 } }],
    ['100MB を超える動画', { file: fileOf('長い動画.mp4', 'video/mp4', 150 * 1024 * 1024) }],
    ['共有の仕組みがない端末', { file: fileOf('現場写真.png', 'image/png'), share: 'none' }],
    ['共有でファイルを渡せない端末', { file: fileOf('現場写真.png', 'image/png'), share: 'nofiles' }],
  ];
  for (const [label, opt] of direct) {
    const { ctx, page, errors, fetched } = await open(opt);
    const before = fetched.body;
    await page.click('#downloadBtn');
    await page.waitForTimeout(300);
    const n = await page.evaluate(() => window.__downloads);
    check(`${label}：ダウンロードを押すとすぐ保存（メニューなし）`, n === 1 && !(await menuOpen(page)), `downloads=${n}`);
    check(`${label}：余計な読み込みをしない`, fetched.body === before, `${before} → ${fetched.body}`);
    check(`${label}：ページエラーなし`, errors.length === 0, errors.join(' / '));
    await ctx.close();
  }

  await browser.close();
  server.close();
  const fail = results.filter(r => !r.ok);
  console.log(`\n${results.length - fail.length}/${results.length} PASS`);
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
