/* wnHtmlToCanvas（HTMLサムネイル）の単体検証。Chromium と WebKit(Safari相当) の両方で
   - インライン style の見た目が描かれる / 真っ白は null / スクリプト・onerror は動かない / Shift_JIS */
const pw = require('../_aa_e2e/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../whatsno/assets/js/wn-api.js'), 'utf8');
const code = src.slice(src.indexOf('const WN_HTML_THUMB_MAX_BYTES'), src.indexOf('/* annotate.html で注釈編集'));

const deck = `<!doctype html><html><head><meta charset="utf-8"><title>d</title>
<link rel="stylesheet" href="https://example.com/x.css"><style>
body{margin:0;font-family:sans-serif} .slide{width:100vw;height:100vh;background:linear-gradient(135deg,#1e3a8a,#7c3aed);color:#fff;display:flex;align-items:center;justify-content:center;font-size:72px}
</style></head><body><div class="slide">Space.app 提案 &amp; 資料&nbsp;</div>
<img src="https://example.com/a.png" onerror="window.parent.__pwned=1">
<img src="x" onerror="window.__pwned=1"><script>window.__pwned=2</script></body></html>`;
const blank = `<!doctype html><html><body><div id="app"></div><script>document.body.innerHTML='x'</script></body></html>`;

(async () => {
  let fail = 0;
  for (const [name, bt] of [['chromium', pw.chromium], ['webkit', pw.webkit]]) {
    const b = await bt.launch();
    const p = await b.newPage();
    await p.goto('http://127.0.0.1:8765/whatsno/index.html');
    await p.addScriptTag({ content: code + '\nwindow.wnHtmlToCanvas = wnHtmlToCanvas;' });
    const r = await p.evaluate(async ({ deck, blank }) => {
      const enc = s => new TextEncoder().encode(s).buffer;
      const out = {};
      try {
        const c = await wnHtmlToCanvas(enc(deck));
        out.deck = c ? c.getContext('2d').getImageData(640, 400, 1, 1).data.join(',') : null;
        out.deckUrl = c ? c.toDataURL('image/jpeg', 0.8) : null;
      } catch (e) { out.deckErr = String(e); }
      try { out.blank = await wnHtmlToCanvas(enc(blank)); } catch (e) { out.blankErr = String(e); }
      /* Shift_JIS: 「図面」= 0x90 0x7D 0x96 0xCA */
      const pre = new TextEncoder().encode('<html><head><meta charset="Shift_JIS"><style>body{background:#000;color:#fff;font-size:120px}</style></head><body>');
      const sj = new Uint8Array([...pre, 0x90, 0x7D, 0x96, 0xCA, ...new TextEncoder().encode('</body></html>')]);
      out.sjisText = wnDecodeHtmlBuffer(sj.buffer).includes('図面');
      try { out.sjis = !!(await wnHtmlToCanvas(sj.buffer)); } catch (e) { out.sjisErr = String(e); }
      await new Promise(r => setTimeout(r, 500));
      out.pwned = window.__pwned || 0;
      return out;
    }, { deck, blank });
    if (r.deckUrl) fs.writeFileSync(path.join(__dirname, `shots/html-thumb-${name}.jpg`), Buffer.from(r.deckUrl.split(',')[1], 'base64'));
    delete r.deckUrl;
    const ok = r.deck && r.blank === null && r.sjis && r.sjisText && r.pwned === 0;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, JSON.stringify(r));
    await b.close();
  }
  process.exit(fail ? 1 : 0);
})();
