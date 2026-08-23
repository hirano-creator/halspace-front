'use strict';
/* ══════════════════════════════════════════════════════════════════════
   wn-thumb.js — サムネイル解決の共有モジュール（マニュアル系ページ用）

   サーバー（/wn/files/{id}/thumb）が作れるのは画像とOfficeの埋め込みサムネだけで、
   PDF・HEIC・動画・DXF は 404 を返す。ダッシュボードはその 404 を受けてクライアントで
   生成し POST で保存し直す仕組みを持つが、マニュアル画面はサーバーサムネを <img src> に
   貼るだけだったので、PDF は永久にアイコンのままだった（＝今回の不具合）。

   このモジュールは1枚のサムネを
     メモリ → IndexedDB → サーバー保存サムネ → クライアント生成（＋サーバーへ保存）
   の順で解決する。キャッシュキーと保存APIはダッシュボードと共通なので、
   どちらかで一度生成すれば、もう片方は通信ゼロ or 即配信になる。

   ・表示枠が大きい場所（編集画面の右ペインなど）は `{ preview: true }` で大きい版を作る。
     サーバーは長辺400pxに正規化して保存するため、それを引き伸ばすとぼやけるため。
     大きい版は端末内(IndexedDB)にだけ置き、サーバーへは送らない（一覧の通信量を増やさない）
   ・重い canvas 処理（PDF/DXF/動画/HEIC）は同時 1〜3 本に絞る（モバイルのOOM対策）
   ・pdf.js / three.js は「その種別が実際に画面に出たときだけ」CDNから遅延読込する
   ・キャッシュ版 WN_TH_VER は wn-dashboard.js の THUMB_VER と揃える
     （ズレても壊れはしないが、同じサムネを両画面で作り直すことになる）

   生成そのもののロジック（段階縮小・余白トリミング・線画強調）は
   wn-dashboard.js / annotate.html と同実装。片方を直したら他方も直すこと。
   ══════════════════════════════════════════════════════════════════════ */

/* wn-dashboard.js の THUMB_VER と必ず一致させる */
const WN_TH_VER = 'v17';

/* 自分自身の置き場所（兄弟スクリプトを遅延読込するときの基準）。
   マニュアル画面は app/*.html なので相対パスは呼び出し元によって変わる。 */
const WN_TH_BASE = (() => {
  try { return new URL('.', document.currentScript.src).href; }
  catch { return '../assets/js/'; }
})();

/* iOS / モバイル判定（wn-dashboard.js と同実装）。
   高解像度canvasの並列処理はタブごとメモリ上限の厳しい iOS Safari で落ちるため、
   モバイルでは解像度と並列数を絞る。 */
const WN_TH_MOBILE = (() => {
  try {
    const ua = navigator.userAgent || '';
    const iOS = /iP(hone|ad|od)/.test(ua)
             || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
    const android = /Android/.test(ua);
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return iOS || android || (coarse && (window.innerWidth || 0) < 1024);
  } catch { return false; }
})();

/* ── IndexedDB キャッシュ（wn-dashboard.js と同じDB・同じキー形式） ── */
const WnThumbStore = (() => {
  const DB_NAME = 'wn-thumb-cache';
  const STORE   = 'thumbs';
  const VERSION = 1;
  let db = null;

  function open() {
    if (db) return Promise.resolve(db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror   = () => reject(req.error);
    });
  }

  async function get(key) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror   = () => reject(req.error);
    });
  }

  async function set(key, blob) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const req = d.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  /* 同じファイルの古い版（別 updated_at / 別バージョン）を掃除する。
     prefix はサイズ違いのキャッシュ種別（thumb=一覧用 / preview=拡大表示用）。 */
  async function evictOld(fileId, prefix = 'thumb') {
    const d = await open();
    return new Promise(resolve => {
      const store = d.transaction(STORE, 'readwrite').objectStore(STORE);
      const req   = store.openCursor();
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (!cursor) { resolve(); return; }
        if (String(cursor.key).startsWith(`${prefix}_${fileId}_`)) cursor.delete();
        cursor.continue();
      };
      req.onerror = () => resolve();
    });
  }

  return { get, set, evictOld };
})();

/* ページ内メモリキャッシュ（ObjectURL）と、同じキーの二重解決を防ぐ in-flight 表 */
const wnThMem     = {};
const wnThPending = {};

/* ── canvas ユーティリティ（wn-dashboard.js と同実装） ── */
function wnThFree() {
  for (const c of arguments) {
    try { if (c) { c.width = 0; c.height = 0; } } catch {}
  }
}

function wnThTargetLong() {
  if (WN_TH_MOBILE) return 720;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return Math.round(Math.min(1440, Math.max(720, 720 * dpr)));
}

/* 拡大表示用（マニュアル編集の右ペインなど、枠が大きい場所）の長辺。
   一覧用サムネはサーバー側で長辺400pxに正規化されるため、大きな枠に引き伸ばすとぼやける。
   こちらは端末内(IndexedDB)にだけ持つ大きめの版で、サーバーへは送らない。 */
function wnThPreviewLong() {
  if (WN_TH_MOBILE) return 1200;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return Math.round(Math.min(2200, Math.max(1400, 1100 * dpr)));
}

/* 1/2ずつ段階縮小（一気に縮めると図面の細線が飛ぶ） */
function wnThShrink(src, targetLong) {
  let cur = src;
  const step = (w, h) => {
    const next = document.createElement('canvas');
    next.width  = Math.max(1, Math.round(w));
    next.height = Math.max(1, Math.round(h));
    const ctx = next.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, next.width, next.height);
    return next;
  };
  while (Math.max(cur.width, cur.height) > targetLong * 2) {
    cur = step(cur.width / 2, cur.height / 2);
  }
  if (Math.max(cur.width, cur.height) > targetLong) {
    const ratio = targetLong / Math.max(cur.width, cur.height);
    cur = step(cur.width * ratio, cur.height * ratio);
  }
  return cur;
}

/* 余白自動トリミング: 四隅の色を背景とみなし、内容の外接矩形＋少しの余白で切り出す */
function wnThTrim(canvas, pad = 0.03) {
  try {
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    const d = ctx.getImageData(0, 0, w, h).data;
    const idx = (x, y) => (y * w + x) * 4;

    let br = 0, bg = 0, bb = 0;
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
      const i = idx(x, y); br += d[i]; bg += d[i + 1]; bb += d[i + 2];
    }
    br /= 4; bg /= 4; bb /= 4;
    const isBg = i => Math.abs(d[i] - br) + Math.abs(d[i + 1] - bg) + Math.abs(d[i + 2] - bb) < 48;

    /* 速度のため間引き走査（長辺600サンプル程度） */
    const stepX = Math.max(1, Math.floor(w / 600));
    const stepY = Math.max(1, Math.floor(h / 600));
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y += stepY) {
      for (let x = 0; x < w; x += stepX) {
        if (!isBg(idx(x, y))) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return canvas;                        /* 全面背景 */

    minX = Math.max(0, minX - Math.round(w * pad));
    maxX = Math.min(w - 1, maxX + Math.round(w * pad));
    minY = Math.max(0, minY - Math.round(h * pad));
    maxY = Math.min(h - 1, maxY + Math.round(h * pad));
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    if (cw < w * 0.3 || ch < h * 0.3) return canvas;    /* 切りすぎ＝誤検出の可能性 */
    if (cw > w * 0.95 && ch > h * 0.95) return canvas;  /* ほぼ余白なし */

    const out = document.createElement('canvas');
    out.width = cw; out.height = ch;
    out.getContext('2d').drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
    return out;
  } catch { return canvas; }
}

/* 線画強調: アンシャープマスク＋ガンマで、縮小で薄くなった図面の細線を締める */
function wnThEnhance(canvas, amount = 1.3, gamma = 1.55) {
  try {
    const w = canvas.width, h = canvas.height;
    const ctx  = canvas.getContext('2d');
    const blur = document.createElement('canvas');
    blur.width = w; blur.height = h;
    const bctx = blur.getContext('2d');
    bctx.filter = 'blur(1px)';
    bctx.drawImage(canvas, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const bim = bctx.getImageData(0, 0, w, h);
    const s = img.data, b = bim.data;
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * Math.pow(v / 255, gamma));
    for (let i = 0; i < s.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        let v = s[i + c] + amount * (s[i + c] - b[i + c]);
        v = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
        s[i + c] = lut[v];
      }
    }
    ctx.putImageData(img, 0, 0);
    wnThFree(blur);
  } catch { /* 失敗しても無加工のサムネは出す */ }
}

/* ── 遅延読込（その種別が実際に画面に出たときだけライブラリを取りに行く） ── */
const wnThScripts = {};
function wnThLoadScript(src) {
  if (wnThScripts[src]) return wnThScripts[src];
  wnThScripts[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload  = () => resolve();
    s.onerror = () => reject(new Error('script load failed: ' + src));
    document.head.appendChild(s);
  });
  return wnThScripts[src];
}

async function wnThEnsurePdfjs() {
  try {
    if (typeof pdfjsLib === 'undefined') {
      await wnThLoadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    }
    if (typeof pdfjsLib === 'undefined') return false;
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    return true;
  } catch { return false; }
}

async function wnThEnsureDxf() {
  try {
    if (typeof THREE === 'undefined') {
      await wnThLoadScript('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js');
    }
    if (typeof DxfParser === 'undefined') {
      await wnThLoadScript('https://cdn.jsdelivr.net/npm/dxf-parser@1.1.2/dist/dxf-parser.js');
    }
    if (typeof wnDxfThumbnail === 'undefined') {
      await wnThLoadScript(WN_TH_BASE + 'wn-dxf-viewer.js');
    }
    return typeof wnDxfThumbnail === 'function' && typeof THREE !== 'undefined';
  } catch { return false; }
}

async function wnThEnsureHeic2any() {
  try {
    if (typeof heic2any === 'undefined') {
      await wnThLoadScript('https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js');
    }
    return typeof heic2any !== 'undefined';
  } catch { return false; }
}

/* ── 生成の同時実行数（重いcanvas処理だけを絞る） ── */
function wnThMakeSemaphore(max) {
  let active = 0;
  const waiters = [];
  return {
    async acquire() {
      if (active < max) { active++; return; }
      await new Promise(r => waiters.push(r));
      active++;
    },
    release() {
      active--;
      const w = waiters.shift();
      if (w) w();
    },
  };
}
const wnThGenSem = wnThMakeSemaphore(WN_TH_MOBILE ? 1 : 3);

/* ── 種別判定 ── */
function wnThExt(file)  { return (file?.file_name || '').split('.').pop().toLowerCase(); }
function wnThMime(file) { return file?.mime_type || ''; }

function wnThIsPdf(file)   { return wnThMime(file) === 'application/pdf' || wnThExt(file) === 'pdf'; }
function wnThIsSvg(file)   { return wnThMime(file) === 'image/svg+xml'   || wnThExt(file) === 'svg'; }
function wnThIsHeic(file)  { return ['heic', 'heif'].includes(wnThExt(file))
                                 || ['image/heic', 'image/heif'].includes(wnThMime(file)); }
function wnThIsVideo(file) { return wnThMime(file).startsWith('video/')
                                 || ['mp4', 'mov', 'avi', 'webm'].includes(wnThExt(file)); }
function wnThIsImage(file) { return wnThMime(file).startsWith('image/')
                                 || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'heif'].includes(wnThExt(file)); }

/* 動画は重いので上限を設ける（wn-dashboard.js と同値） */
const WN_TH_VIDEO_MAX_BYTES = 200 * 1024 * 1024;

/* サムネイルが出せる見込みのある種別か（＝アイコンではなく受け皿を描く価値があるか）。
   Office はサーバーの埋め込みサムネ抽出に賭ける（無ければアイコンのまま）。 */
function wnThumbSupported(file) {
  if (!file || !file.id) return false;
  const ext = wnThExt(file);
  if (wnThIsVideo(file) && (file.file_size ?? 0) > WN_TH_VIDEO_MAX_BYTES) return false;
  return wnThIsImage(file) || wnThIsPdf(file) || wnThIsVideo(file)
      || ext === 'dxf'
      || ['xlsx', 'xls', 'xlsm', 'docx', 'docm', 'pptx', 'ppt', 'pptm'].includes(ext);
}

/* ── クライアント生成（サーバーが404を返した種別だけここへ来る） ── */
async function wnThRenderPdfPage(pdf, targetLong = wnThTargetLong()) {
  const page   = await pdf.getPage(1);
  /* 大きめに描画（スーパーサンプリング）してから高品質縮小で表示サイズへ落とす。
     モバイルは getImageData のメモリが致命的なので長辺を絞る。 */
  const ssLong = Math.max(WN_TH_MOBILE ? 1400 : 2600, Math.round(targetLong * 1.4));
  const base   = page.getViewport({ scale: 1 });
  const scale  = Math.min(WN_TH_MOBILE ? 2 : 4,
                          Math.max(1.5, ssLong / Math.max(base.width, base.height)));
  const viewport = page.getViewport({ scale });
  const canvas   = document.createElement('canvas');
  canvas.width   = Math.round(viewport.width);
  canvas.height  = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';   /* 透過PDFをJPEG化すると黒くなるので必ず白で塗る */
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/* targetLong を変えるだけで一覧用サムネ / 拡大表示用プレビューを作り分ける */
async function wnThGenerateBlob(file, targetLong = wnThTargetLong()) {
  const ext = wnThExt(file);
  const url = wnPublicViewUrl(file.id);

  /* ── PDF ── */
  if (wnThIsPdf(file)) {
    if (!await wnThEnsurePdfjs()) return null;
    const pdf = await pdfjsLib.getDocument({
      url,
      cMapUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/standard_fonts/',
    }).promise;
    try {
      const canvas  = await wnThRenderPdfPage(pdf, targetLong);
      const trimmed = wnThTrim(canvas);              /* 図面は余白が多いので内容を大きく写す */
      const out     = wnThShrink(trimmed, targetLong);
      wnThEnhance(out);
      const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.90));
      wnThFree(canvas, trimmed, out);
      return blob;
    } finally { pdf.destroy?.(); }
  }

  /* ── PowerPoint: サーバー変換済みPDFの1ページ目 ── */
  if (['pptx', 'ppt', 'pptm'].includes(ext)) {
    if (!await wnThEnsurePdfjs()) return null;
    const res = await wnFetch(`/wn/files/${file.id}/preview-pdf`);
    if (!res || !res.ok) return null;
    const pdf = await pdfjsLib.getDocument({ data: await res.arrayBuffer() }).promise;
    try {
      const canvas = await wnThRenderPdfPage(pdf, targetLong);
      /* スライドは全面デザインなので余白カット・線画強調はかけない */
      const out  = wnThShrink(canvas, targetLong);
      const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.90));
      wnThFree(canvas, out);
      return blob;
    } finally { pdf.destroy?.(); }
  }

  /* ── HEIC/HEIF（iPhoneの写真。GDが読めないのでサーバーは常に404） ── */
  if (wnThIsHeic(file)) {
    const res = await fetch(url);
    if (!res.ok) return null;
    const srcBlob = await res.blob();
    /* iOS Safari はネイティブデコードできる。重い heic2any(WASM) は最後の手段。 */
    if (typeof createImageBitmap === 'function') {
      try {
        const bmp = await createImageBitmap(srcBlob, { imageOrientation: 'from-image' });
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close?.();
        const out  = wnThShrink(c, targetLong);
        const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.85));
        wnThFree(c, out);
        if (blob) return blob;
      } catch { /* ネイティブ非対応（Android等）→ heic2any へ */ }
    }
    if (!await wnThEnsureHeic2any()) return null;
    const buffer = await srcBlob.arrayBuffer();
    const b = await heic2any({ blob: new Blob([buffer], { type: 'image/heic' }), toType: 'image/jpeg', quality: 0.70 });
    return Array.isArray(b) ? b[0] : b;
  }

  /* ── DXF ── */
  if (ext === 'dxf') {
    if (!await wnThEnsureDxf()) return null;
    const text = await wnFetchDxfText(file.id);
    if (!text) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 2048; canvas.height = 1024;
    if (!wnDxfThumbnail(canvas, text)) { wnThFree(canvas); return null; }
    const out = wnThShrink(canvas, targetLong);
    wnThEnhance(out);
    const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.90));
    wnThFree(canvas, out);
    return blob;
  }

  /* ── 動画: 先頭付近の1フレーム ──
     iOS Safari は「再生」しないと canvas が黒くなるため、ミュート自動再生で
     実フレームをデコードさせてから取る（seek はフォールバック）。 */
  if (wnThIsVideo(file)) {
    return await new Promise(resolve => {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true; video.defaultMuted = true;
      video.playsInline = true; video.preload = 'auto';
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      /* display:none だと iOS Safari がデータを読まないので画面外に置く */
      video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:320px;height:180px;opacity:0.001;pointer-events:none;';
      document.body.appendChild(video);

      let captured = false;
      const finish = b => {
        if (captured) return;
        captured = true;
        clearTimeout(timer);
        try {
          try { video.pause(); } catch {}
          video.removeAttribute('src');
          video.src = '';
          video.load();          /* デコーダーバッファを即解放（iOSのメモリ対策） */
          document.body.removeChild(video);
        } catch {}
        resolve(b);
      };
      const timer = setTimeout(() => finish(null), 10000);

      const capture = () => {
        if (captured) return;
        try {
          const canvas = document.createElement('canvas');
          canvas.width  = video.videoWidth  || 320;
          canvas.height = video.videoHeight || 180;
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(b => { wnThFree(canvas); finish(b); }, 'image/jpeg', 0.80);
        } catch { finish(null); }
      };
      /* 直後は黒になる端末があるので rAF×2 で描画完了を待つ */
      const captureSoon = () => requestAnimationFrame(() => requestAnimationFrame(capture));

      video.addEventListener('loadedmetadata', () => {
        const seekTo = Math.min(0.5, (video.duration || 1) / 3);
        const p = video.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => { try { video.currentTime = seekTo; } catch {} });
        }
      });
      video.addEventListener('timeupdate', () => {
        if (!captured && video.currentTime >= 0.1) {
          try { video.pause(); } catch {}
          captureSoon();
        }
      });
      video.addEventListener('seeked', captureSoon, { once: true });
      video.addEventListener('error', () => finish(null), { once: true });
      video.src = url;
    });
  }

  /* ── 画像（サーバーGDが失敗したときの保険。SVGは呼び出し側が原本URLを使う） ── */
  if (wnThIsImage(file)) {
    if (wnThIsSvg(file)) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const srcBlob = await res.blob();
    if (typeof createImageBitmap !== 'function') return srcBlob;
    try {
      /* EXIF Orientation を画素へ焼き込みつつ縮小（iOS Safari の回転無視対策） */
      const bmp = await createImageBitmap(srcBlob, { imageOrientation: 'from-image' });
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      bmp.close?.();
      const out  = wnThShrink(c, targetLong);
      const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.90));
      wnThFree(c, out);
      return blob || srcBlob;
    } catch { return srcBlob; }
  }

  return null;   /* Office など: サーバーが作れなければアイコンのまま */
}

/* サーバー保存サムネを blob で取得（404・例外・タイムアウトは null → クライアント生成へ） */
async function wnThFetchServerThumb(file) {
  const ctl   = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(wnThumbUrl(file.id, file.updated_at ?? file.created_at), { signal: ctl.signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob && blob.size > 0 ? blob : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ── 1枚を解決して表示可能なURLを返す（出せなければ null） ──
   opts.preview=true で「拡大表示用の大きい版」を作る。サーバーのサムネは長辺400pxに
   正規化されるので、編集画面の右ペインのような大きな枠ではそれを引き伸ばさず、
   端末内キャッシュ(IndexedDB)に持つ大きい版を使う（サーバーへは送らない）。 */
function wnThumbResolve(file, opts = {}) {
  if (!file || !file.id) return Promise.resolve(null);

  const preview = !!opts.preview;
  const stamp   = file.updated_at ?? file.created_at ?? '';
  const gen     = (typeof WN_THUMB_GEN !== 'undefined') ? WN_THUMB_GEN : '';
  const prefix  = preview ? 'preview' : 'thumb';
  const key     = `${prefix}_${file.id}_${stamp}_${WN_TH_VER}_${gen}`;

  if (wnThMem[key])     return Promise.resolve(wnThMem[key]);
  if (wnThPending[key]) return wnThPending[key];

  wnThPending[key] = (async () => {
    try {
      /* 1) IndexedDB（同一端末で生成済み。一覧用はダッシュボードで作った分もヒットする） */
      const cached = await WnThumbStore.get(key).catch(() => null);
      if (cached) return (wnThMem[key] = URL.createObjectURL(cached));

      /* 2) サーバー保存サムネ（画像/Office、および誰かが生成済みのPDF等）。
            拡大表示用は 400px では足りないのでここは通さない。 */
      if (!preview) {
        const serverBlob = await wnThFetchServerThumb(file);
        if (serverBlob) {
          await WnThumbStore.evictOld(file.id, prefix).catch(() => {});
          await WnThumbStore.set(key, serverBlob).catch(() => {});
          return (wnThMem[key] = URL.createObjectURL(serverBlob));
        }
      }

      /* 3) クライアント生成（PDF/HEIC/動画/DXF）。一覧用の生成物はサーバーへも返す */
      if (!wnThumbSupported(file)) return preview ? wnThumbResolve(file) : null;
      let blob = null;
      await wnThGenSem.acquire();
      try { blob = await wnThGenerateBlob(file, preview ? wnThPreviewLong() : wnThTargetLong()); }
      finally { wnThGenSem.release(); }

      if (!blob) {
        /* SVGだけは原本をそのまま <img> で出せる */
        if (wnThIsSvg(file)) return (wnThMem[key] = wnPublicViewUrl(file.id));
        /* 大きい版を作れない種別（Office等）は一覧用サムネで妥協する */
        return preview ? wnThumbResolve(file) : null;
      }

      await WnThumbStore.evictOld(file.id, prefix).catch(() => {});
      await WnThumbStore.set(key, blob).catch(() => {});
      if (!preview) wnUploadThumb(file.id, blob);  /* 他端末・他ユーザーの次回を即配信化 */
      return (wnThMem[key] = URL.createObjectURL(blob));
    } catch (e) {
      console.warn('thumb resolve failed:', file.file_name, e);
      return null;
    } finally {
      delete wnThPending[key];
    }
  })();

  return wnThPending[key];
}

/* ══════════════════════════════════════════════════════════════════════
   受け皿（スロット）方式のDOM連携

   各画面は innerHTML でまとめて描くので、まずアイコンを「受け皿」として描き、
   描画後に wnThumbHydrate() が画面に入ったものから <img> へ差し替える。
   サムネが出せなければアイコンのまま残るので、失敗しても崩れない。
   差し替え時は親要素に wn-has-thumb が付くので、背景色などを切り替えられる。
   ══════════════════════════════════════════════════════════════════════ */
function wnThAttr(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* 受け皿HTML。opts: { imgClass, iconClass, icon, alt, preview } */
function wnThumbSlotHtml(file, opts = {}) {
  const fallback = (typeof wnFileIcon === 'function')
    ? wnFileIcon(file?.file_name, file?.mime_type)
    : { icon: 'fa-file', cls: '' };
  const cls = ['fa-solid', opts.icon || fallback.icon, opts.iconClass || ''].filter(Boolean).join(' ');
  if (!file || !file.id) return `<i class="${cls}"></i>`;
  return `<i class="${cls}" data-wn-thumb="${file.id}"`
       + ` data-wn-thumb-name="${wnThAttr(file.file_name)}"`
       + ` data-wn-thumb-mime="${wnThAttr(file.mime_type)}"`
       + ` data-wn-thumb-stamp="${wnThAttr(file.updated_at ?? file.created_at ?? '')}"`
       + ` data-wn-thumb-size="${file.file_size ?? ''}"`
       + ` data-wn-thumb-img="${wnThAttr(opts.imgClass || '')}"`
       + ` data-wn-thumb-alt="${wnThAttr(opts.alt || '')}"`
       + (opts.preview ? ' data-wn-thumb-preview="1"' : '') + `></i>`;
}

let wnThObserver = null;
/* 監視中の受け皿。編集画面は手順を選ぶたび描き直すので、DOMから消えた分を
   毎回掃除しないと監視対象が際限なく積み上がる。 */
const wnThWatched = new Set();

function wnThSwap(el) {
  const file = {
    id:         Number(el.dataset.wnThumb),
    file_name:  el.dataset.wnThumbName,
    mime_type:  el.dataset.wnThumbMime,
    updated_at: el.dataset.wnThumbStamp || null,
    file_size:  el.dataset.wnThumbSize ? Number(el.dataset.wnThumbSize) : null,
  };
  wnThumbResolve(file, { preview: el.dataset.wnThumbPreview === '1' }).then(url => {
    if (!url || !el.isConnected) return;
    const img = document.createElement('img');
    if (el.dataset.wnThumbImg) img.className = el.dataset.wnThumbImg;
    img.alt = el.dataset.wnThumbAlt || '';
    /* 読み込めたときだけ差し替える（失敗時はアイコンのまま残す） */
    img.onload = () => {
      if (!el.isConnected) return;
      el.parentElement?.classList.add('wn-has-thumb');
      el.replaceWith(img);
    };
    img.src = url;
  });
}

/* 描画のたびに呼ぶ。画面内（手前400px）に入った受け皿から順に解決する。 */
function wnThumbHydrate(root = document) {
  const slots = root.querySelectorAll('[data-wn-thumb]:not([data-wn-thumb-init])');
  if (!slots.length) return;

  if (typeof IntersectionObserver !== 'function') {
    slots.forEach(el => { el.dataset.wnThumbInit = '1'; wnThSwap(el); });
    return;
  }
  if (!wnThObserver) {
    wnThObserver = new IntersectionObserver((entries, obs) => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        obs.unobserve(e.target);
        wnThWatched.delete(e.target);
        wnThSwap(e.target);
      });
    }, { rootMargin: '400px' });
  }
  /* 前回の描画で消えた受け皿を監視から外す */
  wnThWatched.forEach(el => {
    if (!el.isConnected) { wnThObserver.unobserve(el); wnThWatched.delete(el); }
  });
  slots.forEach(el => {
    el.dataset.wnThumbInit = '1';
    /* 非表示の受け皿（サムネが出たときだけ見せる枠など）は交差が起きないので即解決する */
    if (!el.getClientRects().length) { wnThSwap(el); return; }
    wnThObserver.observe(el);
    wnThWatched.add(el);
  });
}
