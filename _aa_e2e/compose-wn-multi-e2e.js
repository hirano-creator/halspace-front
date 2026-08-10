// a.aの新規投稿で「What'sNoのファイルを複数選んで1投稿にまとめる」動作の検証：
// ①モーダルで複数選択でき、選んだ順に番号が出る
// ②選択解除できる／再度開いても選択状態が残る
// ③プレビューに「N枚のスライドとして投稿されます」が出る
// ④送信ボディに wn_file_ids[] が選んだ順で入る
// ⑤端末の写真と混在させると media[] と wn_file_ids[] の両方が入る
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = 'c:/dev/my-programming/a.a';
const PORT = 8132;
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

const wnItems = [
  { id: 11, file_name: '図面A.pdf', mime_type: 'application/pdf' },
  { id: 12, file_name: '図面B.pdf', mime_type: 'application/pdf' },
  { id: 13, file_name: '設備写真.jpg', mime_type: 'image/jpeg' },
];

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => localStorage.setItem('aa_token', 'mock-token'));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));

  let lastPost = null; // 直近の POST /aa/posts のボディ
  await page.route('**/cdnjs.cloudflare.com/**', (route) => route.abort());
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const url = req.url();
    if (url.includes('/wn/files')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: wnItems }) });
    }
    if (url.includes('/aa/posts') && req.method() === 'POST') {
      lastPost = req.postData() || '';
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 99, kind: 'post', media: [], reactions: {}, my_reactions: [] } }) });
    }
    if (url.includes('/aa/feed')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' });
  });

  const results = [];
  const check = (name, ok, extra) => { results.push([name, ok]); console.log((ok ? 'OK   ' : 'NG   ') + name + (extra ? '  ' + extra : '')); };
  // multipartボディから指定フィールドの値を出現順に取り出す
  const fieldValues = (body, name) => {
    const out = [];
    const re = new RegExp('name="' + name.replace(/[[\]]/g, '\\$&') + '"\\r?\\n\\r?\\n([^\\r\\n]*)', 'g');
    let m;
    while ((m = re.exec(body || ''))) out.push(m[1]);
    return out;
  };

  await page.goto(`http://localhost:${PORT}/app/compose.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  // モーダルを開いて 図面B → 図面A → 設備写真 の順に選ぶ
  await page.click('#fromWn');
  await page.waitForSelector('.wnitem', { timeout: 5000 });
  await page.click('.wnitem[data-id="12"]');
  await page.click('.wnitem[data-id="11"]');
  await page.click('.wnitem[data-id="13"]');
  const picked = await page.evaluate(() => ({
    marks: [...document.querySelectorAll('.wnitem')].map(b => b.dataset.id + ':' + b.querySelector('.wnck').textContent),
    onCount: document.querySelectorAll('.wnitem.on').length,
    doneLabel: document.getElementById('wnDone').textContent.trim(),
  }));
  check('選んだ順の番号が出る', picked.marks.join(',') === '11:2,12:1,13:3', picked.marks.join(','));
  check('3件が選択状態', picked.onCount === 3);
  check('決定ボタンに件数が出る', picked.doneLabel === '選択した3件を使う', picked.doneLabel);
  await page.screenshot({ path: 'c:/dev/my-programming/_aa_e2e/shots/compose-wn-picker.png' });

  // 選択解除 → 再選択（末尾に付き直す）
  await page.click('.wnitem[data-id="12"]');
  const afterOff = await page.evaluate(() => [...document.querySelectorAll('.wnitem')].map(b => b.dataset.id + ':' + b.querySelector('.wnck').textContent).join(','));
  check('解除すると後続の番号が繰り上がる', afterOff === '11:1,12:,13:2', afterOff);
  await page.click('.wnitem[data-id="12"]');

  await page.click('#wnDone');
  await page.waitForTimeout(300);
  const preview = await page.evaluate(() => document.getElementById('preview').textContent.replace(/\s+/g, ' ').trim());
  check('プレビューに3件のチップが出る', (preview.match(/What'sNo/g) || []).length === 3, preview.slice(0, 90));
  check('スライドになる旨の案内が出る', preview.includes('3枚のスライドとして投稿されます'));

  // モーダルを開き直しても選択が残る
  await page.click('#fromWn');
  await page.waitForTimeout(400);
  const reopened = await page.evaluate(() => document.querySelectorAll('.wnitem.on').length);
  check('開き直しても選択が残る', reopened === 3, 'on=' + reopened);
  await page.click('#wnDone');

  // 投稿 → wn_file_ids[] が選んだ順で入る
  await page.fill('#body', 'まとめて公開');
  await page.click('#submit');
  await page.waitForTimeout(800);
  const ids = fieldValues(lastPost, 'wn_file_ids[]');
  check('wn_file_ids[]が選んだ順で送られる', ids.join(',') === '11,13,12', ids.join(','));
  check('1リクエストにまとまっている', (lastPost.match(/name="body"/g) || []).length === 1);

  // 端末の写真とWhat'sNoファイルの混在
  lastPost = null;
  await page.goto(`http://localhost:${PORT}/app/compose.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.setInputFiles('#fPhoto', {
    name: 'genba.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  });
  await page.click('#fromWn');
  await page.waitForSelector('.wnitem', { timeout: 5000 });
  await page.click('.wnitem[data-id="11"]');
  await page.click('#wnDone');
  await page.waitForTimeout(200);
  const mixPreview = await page.evaluate(() => document.getElementById('preview').textContent.replace(/\s+/g, ' ').trim());
  check('混在でもスライド案内が出る', mixPreview.includes('2枚のスライドとして投稿されます'), mixPreview.slice(0, 90));
  await page.click('#submit');
  await page.waitForTimeout(800);
  check('混在時は media[] と wn_file_ids[] が両方入る',
    (lastPost || '').includes('name="media[]"') && fieldValues(lastPost, 'wn_file_ids[]').join(',') === '11',
    'wn=' + fieldValues(lastPost, 'wn_file_ids[]').join(','));
  await page.screenshot({ path: 'c:/dev/my-programming/_aa_e2e/shots/compose-wn-mixed.png' });

  if (errs.length) console.log('ERRS', errs.join(' | '));
  await browser.close();
  server.close();
  const ok = results.every(([, v]) => v) && !errs.length;
  console.log(ok ? 'ALL OK' : 'NG: ' + results.filter(([, v]) => !v).map(([n]) => n).join(' / '));
  process.exit(ok ? 0 : 2);
})();
