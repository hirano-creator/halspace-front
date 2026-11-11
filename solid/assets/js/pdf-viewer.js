'use strict';
/* PDFプレビュー（つかんで移動・拡大・テキスト・ペン・矢印・書き込み一覧）

   使い方: SolidPdfViewer.open(container, { file: { id, file_name }, buf: ArrayBuffer })
   - 図面は pdf.js で自前描画する（Chrome 内蔵ビューアには「つかんで動かす」が無く、外から足せないため）
   - 書き込みは HaLSpace と PT.HILANO LCZ INDONESIA の人だけ。使えるかどうかは API
     （GET /files/{id}/annotations の can_annotate）が決める。画面側では会社を判定しない
   - 立ち上げを速くするため、最初に読むのは pdf.js だけ。書き込みの取得は図面の描画と並行、
     pdf-lib（書き込み入りPDFの書き出し）はダウンロード・印刷を押したときに初めて読む
   - 書き込みの座標・太さ・文字サイズは「ページを等倍で表示したときの位置（左上が原点）」で持つ。
     太さと文字サイズは、書いたときに画面で見えていた大きさを基準にする（拡大して書けば細かく書ける）
   - 回転（90度単位）は、まず見る向きだけを変える。座標はページの向きのまま持つので、回しても書き込みの位置はずれない。
     文字だけは、回した画面で書いたときに横倒しにならないよう、書いたときの向き(r)を持つ
   - 「この向きで保存」を押すと PDF ファイル自体を回す（pdf-lib で各ページの向きを書き換え → R2 へ直送 → 差し替え）。
     書き込みの座標はサーバーが同じ角度で回す。回せるのはファイルを見られる人全員 */
const SolidPdfViewer = (() => {
  const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/';
  const PDFJS = CDN + 'pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = CDN + 'pdf.js/3.11.174/pdf.worker.min.js';
  const PDFLIB = CDN + 'pdf-lib/1.17.1/pdf-lib.min.js';

  const TOOLS = [
    ['move',  'fa-hand',             '移動'],
    ['text',  'fa-font',             'テキスト'],
    ['pen',   'fa-pen',              'ペン'],
    ['arrow', 'fa-arrow-right-long', '矢印'],
    ['erase', 'fa-eraser',           '消しゴム'],
  ];
  const COLORS = ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#111111'];
  const WIDTHS = [['細', 2], ['中', 4], ['太', 8]];        // 画面上の太さ(px)
  const SIZES  = [['小', 16], ['中', 22], ['大', 34]];      // 画面上の文字サイズ(px)
  const LINE_H = 1.3;
  const FONT = "'Noto Sans JP', sans-serif";

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const r1 = n => Math.round(n * 10) / 10;
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)));

  const scripts = {};
  function loadScript(src) {
    return scripts[src] || (scripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { delete scripts[src]; reject(new Error('表示ライブラリの読み込みに失敗しました')); };
      document.head.appendChild(s);
    }));
  }
  /* PDFだと分かった時点で呼ぶ。ファイル本体の取得と並行して pdf.js を読み始める */
  function preload() {
    return loadScript(PDFJS).then(() => { pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; });
  }

  function injectCss() {
    if (document.getElementById('pvCss')) return;
    const st = document.createElement('style');
    st.id = 'pvCss';
    st.textContent = `
.pv { position:absolute; inset:0; display:flex; color:#cdd6f4; font-family:${FONT}; --pv-pri:#ff6b35; --pv-bd:#2d2d44; --pv-sf:#1a1a2e; }
.pv button { font-family:inherit; }
.pv-main { flex:1; position:relative; min-width:0; background:#2a2a30; }
.pv-stage { position:absolute; inset:0; overflow:hidden; touch-action:none; user-select:none; -webkit-user-select:none; cursor:grab; }
.pv-stage.pv-panning { cursor:grabbing !important; }
.pv.t-text .pv-stage { cursor:text; }
.pv.t-pen .pv-stage, .pv.t-arrow .pv-stage { cursor:crosshair; }
.pv.t-erase .pv-stage { cursor:cell; }
.pv-world { position:absolute; left:0; top:0; transform-origin:0 0; }
.pv-paper { position:relative; background:#fff; box-shadow:0 4px 24px rgba(0,0,0,.5); }
.pv-paper canvas { position:absolute; display:block; }
.pv-ink { position:absolute; left:0; top:0; pointer-events:none; overflow:visible; }
.pv.t-erase .pv-ink g { pointer-events:stroke; }
.pv-txt { position:absolute; inset:0; pointer-events:none; }
.pv.pv-hide .pv-ink, .pv.pv-hide .pv-txt { display:none; }
.pv-tx { position:absolute; transform-origin:0 0; white-space:pre; line-height:${LINE_H}; font-weight:700; pointer-events:auto; outline:1px dashed transparent; outline-offset:2px; }
.pv.t-move .pv-tx.pv-mine:hover { outline-color:#4dabf7; cursor:move; }
.pv.t-pen .pv-tx, .pv.t-arrow .pv-tx { pointer-events:none; }
.pv-over { position:absolute; inset:0; pointer-events:none; overflow:hidden; }
.pv-editing { position:absolute; transform-origin:0 0; white-space:pre; line-height:${LINE_H}; font-weight:700; pointer-events:auto; min-width:24px;
  outline:1px dashed var(--pv-pri); outline-offset:2px; background:rgba(255,255,255,.85); user-select:text; -webkit-user-select:text; cursor:text; }
.pv-ping { position:absolute; width:60px; height:60px; margin:-30px 0 0 -30px; border-radius:50%; border:3px solid var(--pv-pri); animation:pvPing 1s ease-out 2; }
@keyframes pvPing { from { transform:scale(.3); opacity:1; } to { transform:scale(2); opacity:0; } }
.pv-spin { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); display:none; align-items:center; gap:8px;
  padding:8px 14px; border-radius:20px; background:rgba(26,26,46,.9); font-size:13px; pointer-events:none; }
.pv-spin.pv-on { display:flex; }

.pv-float { position:absolute; z-index:5; display:flex; align-items:center; gap:4px; padding:5px 6px;
  background:rgba(26,26,46,.94); border:1px solid var(--pv-bd); border-radius:28px; box-shadow:0 6px 24px rgba(0,0,0,.45); }
.pv-tl { top:12px; left:12px; padding:7px 14px; gap:10px; font-size:12px; max-width:calc(100% - 330px); }
.pv-tr { top:12px; right:12px; }
.pv-br { right:12px; bottom:18px; }
.pv-dock { left:50%; bottom:18px; transform:translateX(-50%); padding:6px; }
.pv-set { left:50%; bottom:82px; transform:translateX(-50%); padding:8px 14px 8px 10px; gap:6px; }
.pv.t-move .pv-set, .pv.t-erase .pv-set, .pv:not(.pv-can) .pv-set, .pv:not(.pv-can) .pv-dock, .pv:not(.pv-can) .pv-tl, .pv:not(.pv-can) .pv-only-can { display:none; }
.pv:not(.t-text) .pv-for-text, .pv.t-text .pv-for-stroke { display:none; }
.pv-b { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-width:34px; height:34px; padding:0 9px;
  border-radius:17px; border:1px solid transparent; background:transparent; color:#cdd6f4; font-size:13px; cursor:pointer; white-space:nowrap; }
.pv-b:hover { background:rgba(255,255,255,.1); }
.pv-b.pv-on { background:var(--pv-pri); color:#fff; }
.pv-b:disabled { opacity:.3; cursor:default; background:transparent; }
.pv-dock .pv-b { width:42px; height:42px; padding:0; border-radius:50%; font-size:16px; }
.pv-b.pv-sm { min-width:0; height:28px; padding:0 10px; font-size:12px; border-color:var(--pv-bd); border-radius:8px; }
.pv-sep { width:1px; height:22px; background:var(--pv-bd); margin:0 5px; }
.pv-lbl { font-size:12px; color:#8a8fa8; min-width:44px; text-align:center; }
.pv-cap { font-size:11px; color:#8a8fa8; margin:0 2px 0 8px; white-space:nowrap; }
.pv-sw { width:22px; height:22px; border-radius:50%; border:2px solid rgba(255,255,255,.25); cursor:pointer; padding:0; }
.pv-sw.pv-on { box-shadow:0 0 0 2px #1a1a2e, 0 0 0 4px #fff; }
.pv-chip { display:inline-flex; align-items:center; gap:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pv-chip i { color:#ffd43b; }
.pv-save { display:inline-flex; align-items:center; gap:5px; white-space:nowrap; color:#69db7c; background:none; border:none; font-size:12px; padding:0; }
.pv-save.pv-busy { color:#8a8fa8; }
.pv-save.pv-err { color:#ff8787; cursor:pointer; text-decoration:underline; }
.pv-menu { position:absolute; z-index:20; top:58px; right:12px; display:none; flex-direction:column; min-width:230px; padding:6px;
  background:var(--pv-sf); border:1px solid var(--pv-bd); border-radius:10px; box-shadow:0 8px 30px rgba(0,0,0,.5); }
.pv-menu.pv-on { display:flex; }
.pv-menu button { display:flex; align-items:center; gap:10px; padding:10px 12px; border:none; background:none; color:#cdd6f4;
  font-size:13px; text-align:left; border-radius:6px; cursor:pointer; }
.pv-menu button:hover { background:rgba(255,255,255,.08); }
.pv-rotbar { top:12px; left:50%; transform:translateX(-50%); padding:5px 6px 5px 14px; gap:8px; font-size:12px; display:none; }
.pv.pv-rotated .pv-rotbar { display:flex; }
.pv.pv-can .pv-rotbar { top:60px; }          /* 左上の「社内のみ」表示と重ならないよう1段下げる */
.pv-rotbar .pv-b.pv-sm { height:30px; }
.pv-rotbar .pv-go { background:var(--pv-pri); border-color:var(--pv-pri); color:#fff; }
.pv-toast { position:absolute; left:50%; bottom:140px; transform:translateX(-50%); z-index:30; background:#222; color:#fff;
  font-size:13px; padding:10px 18px; border-radius:8px; opacity:0; pointer-events:none; transition:opacity .2s; white-space:nowrap; }
.pv-toast.pv-on { opacity:1; }

.pv-drawer { width:290px; flex-shrink:0; display:none; flex-direction:column; min-height:0; background:var(--pv-sf); border-left:1px solid var(--pv-bd); }
.pv.pv-open .pv-drawer { display:flex; }
.pv-drawer h3 { display:flex; align-items:center; gap:8px; font-size:13px; padding:12px 14px; border-bottom:1px solid var(--pv-bd); margin:0; }
.pv-drawer h3 span { flex:1; }
.pv-list { flex:1; overflow-y:auto; }
.pv-di { display:flex; gap:10px; padding:10px 8px 10px 14px; border-bottom:1px solid var(--pv-bd); cursor:pointer; font-size:13px; }
.pv-di:hover { background:rgba(255,255,255,.06); }
.pv-di > i { margin-top:3px; width:16px; text-align:center; flex-shrink:0; }
.pv-di > div { flex:1; min-width:0; overflow-wrap:anywhere; }
.pv-di small { display:block; font-size:11px; color:#8a8fa8; margin-top:3px; }
.pv-di .pv-b { min-width:30px; height:30px; padding:0; color:#8a8fa8; flex-shrink:0; }
.pv-foot { padding:10px 14px; font-size:11px; color:#8a8fa8; border-top:1px solid var(--pv-bd); line-height:1.7; }

@media (max-width:760px) {
  .pv-br, .pv-chip span { display:none; }
  .pv-tl { max-width:none; top:64px; }      /* 右上のボタン列と重なるので1段下げる */
  .pv-rotbar { top:auto; bottom:84px; }      /* 上は詰まっているので、下の道具の上に出す */
  .pv.pv-can .pv-rotbar { top:auto; bottom:140px; }
  .pv-tr .pv-lbl { min-width:34px; }
  .pv-drawer { position:absolute; z-index:25; right:0; top:0; bottom:0; width:min(290px,86%); box-shadow:-8px 0 30px rgba(0,0,0,.5); }
}`;
    document.head.appendChild(st);
  }

  /* ───────────────────────── 本体 ───────────────────────── */
  async function open(container, { file, buf }) {
    injectCss();
    await preload();
    /* pdf.js は渡したデータを自分のものにする（元が使えなくなる）ので、写しを渡す。
       元の buf はダウンロード・印刷・書き込み入りPDFの書き出しに使う */
    let doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;

    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const MAXPX = coarse ? 5e6 : 16e6;     // 1枚のcanvasに使う画素の上限（スマホはメモリ不足で落ちるので小さく）

    const root = document.createElement('div');
    root.className = 'pv t-move';
    root.innerHTML = `
<div class="pv-main">
  <div class="pv-stage">
    <div class="pv-world"><div class="pv-paper"><svg class="pv-ink"></svg><div class="pv-txt"></div></div></div>
    <div class="pv-over"></div>
    <div class="pv-spin"><i class="fa-solid fa-spinner fa-spin"></i> 読み込み中…</div>
  </div>
  <div class="pv-float pv-tl">
    <span class="pv-chip"><i class="fa-solid fa-lock"></i><span></span></span>
    <button type="button" class="pv-save"></button>
  </div>
  <div class="pv-float pv-tr">
    <span class="pv-pages" style="display:none;align-items:center;gap:4px;">
      <button type="button" class="pv-b" data-act="prev" title="前のページ"><i class="fa-solid fa-chevron-left"></i></button>
      <span class="pv-lbl pv-pagelbl"></span>
      <button type="button" class="pv-b" data-act="next" title="次のページ"><i class="fa-solid fa-chevron-right"></i></button>
      <span class="pv-sep"></span>
    </span>
    <button type="button" class="pv-b" data-act="rotl" title="左に90°回す（Shift+R）"><i class="fa-solid fa-rotate-left"></i></button>
    <button type="button" class="pv-b" data-act="rotr" title="右に90°回す（R）"><i class="fa-solid fa-rotate-right"></i></button>
    <span class="pv-sep"></span>
    <button type="button" class="pv-b pv-only-can" data-act="drawer" title="書き込み一覧"><i class="fa-solid fa-list"></i><b class="pv-cnt"></b></button>
    <button type="button" class="pv-b pv-only-can" data-act="eye" title="書き込みを表示／隠す"><i class="fa-solid fa-eye"></i></button>
    <button type="button" class="pv-b" data-act="print" title="印刷"><i class="fa-solid fa-print"></i></button>
    <button type="button" class="pv-b" data-act="dl" title="ダウンロード"><i class="fa-solid fa-download"></i></button>
  </div>
  <div class="pv-menu">
    <button type="button" data-act="dl-baked"><i class="fa-solid fa-pen"></i> 書き込み入りでダウンロード</button>
    <button type="button" data-act="dl-orig"><i class="fa-solid fa-file-pdf"></i> 元のPDFをダウンロード</button>
  </div>
  <div class="pv-float pv-br">
    <button type="button" class="pv-b" data-act="zoomout" title="縮小"><i class="fa-solid fa-minus"></i></button>
    <span class="pv-lbl pv-zoomlbl">100%</span>
    <button type="button" class="pv-b" data-act="zoomin" title="拡大"><i class="fa-solid fa-plus"></i></button>
    <button type="button" class="pv-b" data-act="fit" title="全体表示"><i class="fa-solid fa-expand"></i></button>
  </div>
  <div class="pv-float pv-set">
    ${COLORS.map(c => `<button type="button" class="pv-sw" data-color="${c}" style="background:${c}" title="色"></button>`).join('')}
    <span class="pv-cap pv-for-stroke">太さ</span>
    ${WIDTHS.map(([n, v]) => `<button type="button" class="pv-b pv-sm pv-for-stroke" data-w="${v}">${n}</button>`).join('')}
    <span class="pv-cap pv-for-text">文字</span>
    ${SIZES.map(([n, v]) => `<button type="button" class="pv-b pv-sm pv-for-text" data-fs="${v}">${n}</button>`).join('')}
  </div>
  <div class="pv-float pv-dock">
    ${TOOLS.map(([k, ic, name]) => `<button type="button" class="pv-b" data-tool="${k}" title="${name}"><i class="fa-solid ${ic}"></i></button>`).join('')}
    <span class="pv-sep"></span>
    <button type="button" class="pv-b" data-act="undo" title="元に戻す"><i class="fa-solid fa-rotate-left"></i></button>
    <button type="button" class="pv-b" data-act="redo" title="やり直す"><i class="fa-solid fa-rotate-right"></i></button>
  </div>
  <div class="pv-float pv-rotbar">
    <span class="pv-rotlbl"></span>
    <button type="button" class="pv-b pv-sm pv-go" data-act="rotsave"><i class="fa-solid fa-floppy-disk"></i> この向きで保存</button>
    <button type="button" class="pv-b pv-sm" data-act="rotreset">元の向き</button>
  </div>
  <div class="pv-toast"></div>
</div>
<div class="pv-drawer">
  <h3><i class="fa-solid fa-list"></i><span>書き込み一覧</span>
    <button type="button" class="pv-b" data-act="drawer" title="閉じる"><i class="fa-solid fa-xmark"></i></button></h3>
  <div class="pv-list"></div>
  <div class="pv-foot"></div>
</div>`;
    container.appendChild(root);

    const $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
    const stage = $('.pv-stage'), world = $('.pv-world'), paper = $('.pv-paper'),
          ink = $('.pv-ink'), txt = $('.pv-txt'), over = $('.pv-over');

    const S = { tool: 'move', color: COLORS[0], w: 4, fs: 22 };
    const cam = { x: 0, y: 0, z: 1 };
    let pageNo = 1, page = null, PW = 1, PH = 1, fitted = true, rot = 0;
    let base = null, baseScale = 0, baseTask = null, detail = null, detailTask = null, detailMeta = null, pageToken = 0;
    let meta = null;                    // API が返した権限など（書き込みを使えない人は null のまま）
    let items = [];                     // 書き込み { id, cid, page, type, data, by, name, at }
    const undoS = [], redoS = [];
    let destroyed = false, rotSaving = false;

    /* ───────── 表示 ─────────
       画面の位置 = cam + z × (回したページの位置 + off)。off は回したページの左上を (0,0) に戻すずらし */
    const VW = () => rot % 180 ? PH : PW, VH = () => rot % 180 ? PW : PH;
    const rotOff = () => ({ 0: [0, 0], 90: [PH, 0], 180: [PW, PH], 270: [0, PW] })[rot];
    function toScreen(x, y) {           // ページの座標 → stage 内の画面座標
      const [ox, oy] = rotOff();
      const [rx, ry] = rot === 90 ? [-y, x] : rot === 180 ? [-x, -y] : rot === 270 ? [y, -x] : [x, y];
      return [cam.x + (rx + ox) * cam.z, cam.y + (ry + oy) * cam.z];
    }
    function fromScreen(sx, sy) {       // stage 内の画面座標 → ページの座標
      const [ox, oy] = rotOff();
      const qx = (sx - cam.x) / cam.z - ox, qy = (sy - cam.y) / cam.z - oy;
      return rot === 90 ? [qy, -qx] : rot === 180 ? [-qx, -qy] : rot === 270 ? [-qy, qx] : [qx, qy];
    }
    function applyCam() {
      const [ox, oy] = rotOff();
      world.style.transform = `translate(${cam.x}px,${cam.y}px) scale(${cam.z}) translate(${ox}px,${oy}px) rotate(${rot}deg)`;
      $('.pv-zoomlbl').textContent = Math.round(cam.z * 100) + '%';
      placeEditor();
      clearTimeout(applyCam.t);
      applyCam.t = setTimeout(() => { renderDetail(); if (S.tool === 'erase') render(); }, 160);
    }
    function fit() {
      const sw = stage.clientWidth, sh = stage.clientHeight;
      if (!sw || !sh) return;
      const z = Math.min((sw - 32) / VW(), (sh - 32) / VH());
      cam.z = z; cam.x = (sw - VW() * z) / 2; cam.y = (sh - VH() * z) / 2;
      fitted = true;
      applyCam();
    }
    function zoomAt(cx, cy, f) {
      const nz = Math.min(40, Math.max(.05, cam.z * f));
      cam.x = cx - (cx - cam.x) * nz / cam.z; cam.y = cy - (cy - cam.y) * nz / cam.z; cam.z = nz;
      fitted = false;
      applyCam();
    }
    const zoomCenter = f => zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, f);
    function toPaper(e) {
      const r = stage.getBoundingClientRect();
      return fromScreen(e.clientX - r.left, e.clientY - r.top);
    }
    /* 90度ずつ回す（全ページ共通・見る向きだけ）。全体表示のままなら全体表示し直し、動かしていたら画面の真ん中を保つ */
    function rotate(step) {
      if (rotSaving) return;
      commitEdit(false);
      const sw = stage.clientWidth, sh = stage.clientHeight;
      const [px, py] = fromScreen(sw / 2, sh / 2);
      rot = (rot + step + 360) % 360;
      root.classList.toggle('pv-rotated', rot !== 0);
      $('.pv-rotlbl').textContent = { 90: '右に90°', 180: '180°', 270: '左に90°' }[rot] || '';
      if (fitted) return fit();
      const [cx, cy] = toScreen(px, py);
      cam.x += sw / 2 - cx; cam.y += sh / 2 - cy;
      applyCam();
    }
    /* host 側の「#viewerContent canvas { width:100% !important }」に負けないよう important で指定する */
    function place(c, x, y, w, h) {
      for (const [k, v] of [['left', x], ['top', y], ['width', w], ['height', h]]) c.style.setProperty(k, v + 'px', 'important');
    }
    function dropDetail() { if (detail) detail.remove(); detail = null; detailMeta = null; }

    async function showPage(n) {
      if (n < 1 || n > doc.numPages) return;
      commitEdit(false);
      const my = ++pageToken;
      pageNo = n;
      if (baseTask) baseTask.cancel();
      if (detailTask) detailTask.cancel();
      dropDetail();
      if (base) { base.remove(); base = null; }
      $('.pv-spin').classList.add('pv-on');
      const pg = await doc.getPage(n);
      if (my !== pageToken || destroyed) return;
      page = pg;
      const v = pg.getViewport({ scale: 1 });
      PW = v.width; PH = v.height;
      paper.style.width = PW + 'px'; paper.style.height = PH + 'px';
      ink.setAttribute('viewBox', `0 0 ${PW} ${PH}`);
      ink.setAttribute('width', PW); ink.setAttribute('height', PH);
      fit(); render();

      /* 全体表示の2倍まではこの1枚で鮮明に見せる。それ以上の拡大は、見えている範囲だけを描き直す */
      let s = Math.max(cam.z * DPR * 2, .5);
      if (PW * PH * s * s > MAXPX) s = Math.sqrt(MAXPX / (PW * PH));
      const c = document.createElement('canvas');
      c.width = Math.floor(PW * s); c.height = Math.floor(PH * s);
      place(c, 0, 0, PW, PH);
      const task = baseTask = pg.render({ canvasContext: c.getContext('2d'), viewport: pg.getViewport({ scale: s }) });
      try { await task.promise; } catch { return; }
      if (my !== pageToken || destroyed) return;
      paper.insertBefore(c, paper.firstChild);
      base = c; baseScale = s;
      $('.pv-spin').classList.remove('pv-on');
      renderDetail();
    }

    /* 大きく拡大したとき、見えている範囲だけを高い解像度で描いて重ねる（細い線の図面がぼやけないように） */
    async function renderDetail() {
      if (!page || !base || destroyed) return;
      const z = cam.z, need = z * DPR;
      if (need <= baseScale * 1.05) { if (detailTask) detailTask.cancel(); dropDetail(); return; }
      const sw = stage.clientWidth, sh = stage.clientHeight;
      const cs = [fromScreen(0, 0), fromScreen(sw, 0), fromScreen(0, sh), fromScreen(sw, sh)];   // 見えている範囲（ページの座標）
      const vx0 = Math.min(...cs.map(c => c[0])), vx1 = Math.max(...cs.map(c => c[0]));
      const vy0 = Math.min(...cs.map(c => c[1])), vy1 = Math.max(...cs.map(c => c[1]));
      if (detailMeta && detailMeta.s >= need * .95
          && detailMeta.x0 <= Math.max(0, vx0) && detailMeta.y0 <= Math.max(0, vy0)
          && detailMeta.x1 >= Math.min(PW, vx1) && detailMeta.y1 >= Math.min(PH, vy1)) return;
      const mx = (vx1 - vx0) * .25, my = (vy1 - vy0) * .25;       // 少し動かしてもすぐ描き直しにならないよう余白を付ける
      const x0 = Math.max(0, vx0 - mx), y0 = Math.max(0, vy0 - my), x1 = Math.min(PW, vx1 + mx), y1 = Math.min(PH, vy1 + my);
      if (x1 <= x0 || y1 <= y0) return;
      let s = need;
      const px = (x1 - x0) * (y1 - y0) * s * s;
      if (px > MAXPX) s *= Math.sqrt(MAXPX / px);
      if (s <= baseScale * 1.05) return;
      const c = document.createElement('canvas');
      c.width = Math.ceil((x1 - x0) * s); c.height = Math.ceil((y1 - y0) * s);
      place(c, x0, y0, x1 - x0, y1 - y0);
      if (detailTask) detailTask.cancel();
      const task = detailTask = page.render({
        canvasContext: c.getContext('2d'),
        viewport: page.getViewport({ scale: s, offsetX: -x0 * s, offsetY: -y0 * s }),
      });
      try { await task.promise; } catch { return; }
      if (task !== detailTask || destroyed) return;
      dropDetail();
      paper.insertBefore(c, ink);
      detail = c; detailMeta = { x0, y0, x1, y1, s };
    }

    /* ───────── 書き込みの描画 ───────── */
    const mine = it => meta && it.by === meta.me;
    const canDelete = it => mine(it) || (meta && meta.can_delete_any);
    const center = it => {
      const d = it.data;
      if (it.type === 'text') return [d.x + d.fs * 2, d.y + d.fs * .65];
      if (it.type === 'arrow') return [(d.x1 + d.x2) / 2, (d.y1 + d.y2) / 2];
      return [d.pts.reduce((s, q) => s + q[0], 0) / d.pts.length, d.pts.reduce((s, q) => s + q[1], 0) / d.pts.length];
    };
    const penPath = pts => 'M' + pts.map(p => p[0] + ' ' + p[1]).join('L');
    function arrowParts(d) {
      const ang = Math.atan2(d.y2 - d.y1, d.x2 - d.x1), hd = d.w * 3 + 8 * (d.w / 4);
      const bx = d.x2 - Math.cos(ang) * hd, by = d.y2 - Math.sin(ang) * hd;
      const p = k => [bx + Math.cos(ang + k * Math.PI / 2) * hd * .5, by + Math.sin(ang + k * Math.PI / 2) * hd * .5];
      return { bx, by, a: p(1), b: p(-1) };
    }

    function render() {
      let svg = '', html = '';
      const hitW = 16 / cam.z;        // 細い線でも消しゴムで拾えるよう、当たり判定だけ太くする
      for (const it of items) {
        if (it.page !== pageNo || it === editing) continue;
        const d = it.data, k = esc(it.cid), c = esc(d.c);
        if (it.type === 'pen') {
          const p = penPath(d.pts);
          svg += `<g data-k="${k}"><path d="${p}" fill="none" stroke="${c}" stroke-width="${d.w}" stroke-linecap="round" stroke-linejoin="round"/>`
               + `<path d="${p}" fill="none" stroke="transparent" stroke-width="${Math.max(d.w, hitW)}" stroke-linecap="round"/></g>`;
        } else if (it.type === 'arrow') {
          const a = arrowParts(d);
          svg += `<g data-k="${k}"><line x1="${d.x1}" y1="${d.y1}" x2="${a.bx}" y2="${a.by}" stroke="${c}" stroke-width="${d.w}" stroke-linecap="round"/>`
               + `<polygon points="${d.x2},${d.y2} ${a.a} ${a.b}" fill="${c}"/>`
               + `<line x1="${d.x1}" y1="${d.y1}" x2="${d.x2}" y2="${d.y2}" stroke="transparent" stroke-width="${Math.max(d.w, hitW)}"/></g>`;
        } else if (it.type === 'text') {
          const tr = d.r ? `;transform:rotate(${-d.r}deg)` : '';
          html += `<div class="pv-tx${mine(it) ? ' pv-mine' : ''}" data-k="${k}" style="left:${d.x}px;top:${d.y}px;color:${c};font-size:${d.fs}px${tr}">${esc(d.s)}</div>`;
        }
      }
      ink.innerHTML = svg;
      txt.innerHTML = html;
      refreshUI();
      renderList();
    }

    function refreshUI() {
      $$('[data-tool]').forEach(b => b.classList.toggle('pv-on', b.dataset.tool === S.tool));
      $$('[data-color]').forEach(b => b.classList.toggle('pv-on', b.dataset.color === S.color));
      $$('[data-w]').forEach(b => b.classList.toggle('pv-on', +b.dataset.w === S.w));
      $$('[data-fs]').forEach(b => b.classList.toggle('pv-on', +b.dataset.fs === S.fs));
      $('[data-act="undo"]').disabled = !undoS.length;
      $('[data-act="redo"]').disabled = !redoS.length;
      $('[data-act="prev"]').disabled = pageNo <= 1;
      $('[data-act="next"]').disabled = pageNo >= doc.numPages;
      $('.pv-pagelbl').textContent = pageNo + ' / ' + doc.numPages;
    }

    function renderList() {
      if (!meta) return;
      const sorted = [...items].sort((a, b) => a.page - b.page);
      $('.pv-list').innerHTML = sorted.map(it => {
        const ic = { pen: 'fa-pen', arrow: 'fa-arrow-right-long', text: 'fa-font' }[it.type];
        const label = it.type === 'text' ? esc(it.data.s) : it.type === 'pen' ? 'ペンの書き込み' : '矢印';
        return `<div class="pv-di" data-jump="${esc(it.cid)}"><i class="fa-solid ${ic}" style="color:${esc(it.data.c)}"></i>`
          + `<div>${label}<small>${esc(it.name || '')} ・ ${esc(it.at || '')} ・ ${it.page}ページ</small></div>`
          + (canDelete(it) ? `<button type="button" class="pv-b" data-del="${esc(it.cid)}" title="消す"><i class="fa-solid fa-trash"></i></button>` : '')
          + '</div>';
      }).join('') || '<div class="pv-foot" style="border:none">まだ書き込みはありません</div>';
      $('.pv-cnt').textContent = items.length || '';
    }

    function jump(it) {
      const go = () => {
        const [cx, cy] = center(it), z = Math.max(cam.z, 1.3 * Math.min((stage.clientWidth - 32) / VW(), (stage.clientHeight - 32) / VH()));
        cam.z = z;
        const [sx, sy] = toScreen(cx, cy);
        cam.x += stage.clientWidth / 2 - sx; cam.y += stage.clientHeight / 2 - sy;
        fitted = false;
        applyCam();
        const ping = document.createElement('div');
        ping.className = 'pv-ping';
        ping.style.left = stage.clientWidth / 2 + 'px'; ping.style.top = stage.clientHeight / 2 + 'px';
        over.appendChild(ping);
        setTimeout(() => ping.remove(), 2000);
      };
      if (root.classList.contains('pv-hide')) toggleEye();
      if (window.matchMedia('(max-width:760px)').matches) root.classList.remove('pv-open');
      if (it.page !== pageNo) showPage(it.page).then(go); else go();
    }

    let toastTimer;
    function toast(s) {
      const t = $('.pv-toast');
      t.textContent = s; t.classList.add('pv-on');
      clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('pv-on'), 2200);
    }

    /* ───────── 保存（書くたびに自動で送る） ─────────
       1件ずつ順番に送る（並べて送るとサーバー側で詰まった前例がある）。失敗したらそこで止め、
       「やり直す」を押してもらう。送り直しても2件にならないよう、追加には画面側で振った番号(cid)を付ける */
    const queue = [];
    let running = false, failed = false;
    function setSave(state) {
      const el = $('.pv-save');
      el.className = 'pv-save' + (state === 'busy' ? ' pv-busy' : state === 'err' ? ' pv-err' : '');
      el.innerHTML = state === 'busy' ? '<i class="fa-solid fa-rotate fa-spin"></i> 保存中…'
        : state === 'err' ? '<i class="fa-solid fa-triangle-exclamation"></i> 保存できませんでした（押してやり直す）'
        : '<i class="fa-solid fa-check"></i> 保存済み';
    }
    function push(op) { queue.push(op); pump(); }
    async function pump() {
      if (running || failed) return;
      running = true; setSave('busy');
      while (queue.length) {
        try { await queue[0](); queue.shift(); }
        catch { failed = true; running = false; setSave('err'); toast('保存できませんでした。通信環境を確認してください'); return; }
      }
      running = false; setSave('ok');
    }
    const call = async p => { const r = await p; if (!r) throw new Error('unauthorized'); return r; };
    const opCreate = it => async () => {
      const r = await call(api.post(`/files/${file.id}/annotations`, { client_id: it.cid, page: it.page, type: it.type, data: it.data }));
      it.id = r.item.id; it.name = r.item.user_name; it.at = r.item.created_at;
      renderList();
    };
    const opUpdate = it => async () => { if (it.id) await call(api.put(`/file-annotations/${it.id}`, { data: it.data })); };
    const opRemove = it => async () => { if (it.id) { await call(api.delete(`/file-annotations/${it.id}`)); it.id = null; } };

    const myName = () => { try { return JSON.parse(sessionStorage.getItem('space_user')).name || ''; } catch { return ''; } };
    const nowLabel = () => { const d = new Date(), z = n => String(n).padStart(2, '0'); return `${d.getMonth() + 1}/${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };

    function addItem(type, data) {
      const it = { id: null, cid: uuid(), page: pageNo, type, data, by: meta.me, name: myName(), at: nowLabel() };
      items.push(it);
      undoS.push({ k: 'add', it }); redoS.length = 0;
      push(opCreate(it));
      render();
      return it;
    }
    function removeItem(it, withHistory) {
      const i = items.indexOf(it);
      if (i < 0) return;
      items.splice(i, 1);
      if (withHistory) { undoS.push({ k: 'del', it }); redoS.length = 0; }
      push(opRemove(it));
      render();
    }
    function changeItem(it, before) {
      undoS.push({ k: 'upd', it, before, after: clone(it.data) }); redoS.length = 0;
      push(opUpdate(it));
      render();
    }
    /* ほかの人の書き込みを管理者が消すときは確認する（元に戻すと自分の書き込みとして作り直されてしまうので、戻せない） */
    function askRemove(it) {
      if (mine(it)) return removeItem(it, true);
      if (!canDelete(it)) return toast('ほかの人の書き込みは消せません');
      if (confirm(`${it.name || 'ほかの人'} さんの書き込みを消します。元に戻せません。よろしいですか？`)) removeItem(it, false);
    }
    function step(from, to, back) {
      const h = from.pop();
      if (!h) return;
      commitEdit(false);
      const add = back ? h.k === 'del' : h.k === 'add';
      if (h.k === 'upd') { h.it.data = clone(back ? h.before : h.after); push(opUpdate(h.it)); }
      else if (add) { items.push(h.it); push(opCreate(h.it)); }
      else { const i = items.indexOf(h.it); if (i >= 0) items.splice(i, 1); push(opRemove(h.it)); }
      to.push(h);
      render();
    }
    const undo = () => step(undoS, redoS, true), redo = () => step(redoS, undoS, false);

    /* ───────── テキスト入力 ─────────
       入力欄は図面と一緒に拡大縮小せず、画面上の大きさで置く（スマホで文字が16px未満になると画面が勝手に拡大されるため） */
    let editor = null, editing = null;
    function placeEditor() {
      if (!editor) return;
      const [sx, sy] = toScreen(editor._x, editor._y);
      editor.style.left = sx + 'px';
      editor.style.top = sy + 'px';
      editor.style.fontSize = editor._fs * cam.z + 'px';
      editor.style.transform = rot !== editor._r ? `rotate(${rot - editor._r}deg)` : '';
    }
    function startEdit(x, y, it) {
      commitEdit(false);
      editor = document.createElement('div');
      editor.className = 'pv-editing';
      try { editor.contentEditable = 'plaintext-only'; } catch { editor.contentEditable = 'true'; }
      editor._x = x; editor._y = y;
      editor._r = it ? (it.data.r || 0) : rot;
      editor._fs = it ? it.data.fs : S.fs / cam.z;
      editor.style.color = it ? it.data.c : S.color;
      if (it) { editor.textContent = it.data.s; editing = it; }
      over.appendChild(editor);
      placeEditor();
      if (it) render();
      editor.focus();
      const r = document.createRange(); r.selectNodeContents(editor); r.collapse(false);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }
    function commitEdit(backToMove) {
      if (!editor) return;
      const ed = editor, it = editing, s = ed.innerText.replace(/\r/g, '').replace(/\n+$/, '').slice(0, 2000);
      const color = COLORS.find(c => c === ed.dataset.color) || (it ? it.data.c : S.color);
      editor = null; editing = null; ed.remove();
      if (it) {
        if (!s.trim()) removeItem(it, true);
        else if (s !== it.data.s || color !== it.data.c || ed._fs !== it.data.fs) {
          const before = clone(it.data);
          it.data.s = s; it.data.c = color; it.data.fs = r1(ed._fs);
          changeItem(it, before);
        } else render();
      } else if (s.trim()) {
        addItem('text', { x: r1(ed._x), y: r1(ed._y), s, c: color, fs: r1(ed._fs), ...(ed._r ? { r: ed._r } : {}) });
      }
      if (backToMove) setTool('move');
    }

    function setTool(t) {
      if (t !== 'text') commitEdit(false);
      if (t !== 'move' && root.classList.contains('pv-hide')) toggleEye();
      S.tool = t;
      root.className = root.className.replace(/\bt-\w+/, 't-' + t);
      render();
    }
    function toggleEye() {
      const off = root.classList.toggle('pv-hide');
      $('[data-act="eye"] i').className = 'fa-solid ' + (off ? 'fa-eye-slash' : 'fa-eye');
      if (off && S.tool !== 'move') setTool('move');
    }

    /* ───────── 図面の上での操作 ───────── */
    const pts = new Map();
    let drag = null, pinch = null, lastTap = { it: null, t: 0 }, live = null;
    const findItem = el => { const h = el && el.closest('[data-k]'); return h ? items.find(i => i.cid === h.dataset.k) : null; };

    stage.addEventListener('mousedown', e => { if (!e.target.closest('.pv-editing')) e.preventDefault(); });
    stage.addEventListener('contextmenu', e => e.preventDefault());
    stage.addEventListener('wheel', e => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * .0015));
    }, { passive: false });

    stage.addEventListener('pointerdown', e => {
      if (e.target.closest('.pv-editing')) return;
      $('.pv-menu').classList.remove('pv-on');
      const hadEditor = !!editor;
      if (hadEditor) commitEdit(true);
      try { stage.setPointerCapture(e.pointerId); } catch {}
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { cancelLive(); drag = null; return; }
      const hit = findItem(e.target), p = toPaper(e);
      const myText = hit && hit.type === 'text' && mine(hit);     // 動かす・書き直すのは自分の文字だけ
      const tool = meta ? S.tool : 'move';
      if (e.button === 1 || e.button === 2 || (tool === 'move' && !myText)) {
        drag = { k: 'pan', sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y };
        stage.classList.add('pv-panning');
      } else if (tool === 'move') {
        drag = { k: 'mv', it: hit, p, before: clone(hit.data), moved: false };
      } else if (tool === 'pen' || tool === 'arrow') {
        const w = r1(S.w / cam.z);
        live = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        live.setAttribute('fill', 'none'); live.setAttribute('stroke', S.color); live.setAttribute('stroke-width', w);
        live.setAttribute('stroke-linecap', 'round'); live.setAttribute('stroke-linejoin', 'round');
        ink.appendChild(live);
        drag = { k: tool, pts: [[r1(p[0]), r1(p[1])]], w, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY };
      } else if (tool === 'erase') {
        drag = { k: 'erase' };
        eraseAt(e, true);
      } else if (tool === 'text' && !hadEditor) {
        drag = { k: 'txt', p, hit: myText ? hit : null, sx: e.clientX, sy: e.clientY };
      }
    });

    stage.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        if (pinch && pinch.d > 0) {
          cam.x += cx - pinch.cx; cam.y += cy - pinch.cy;
          const r = stage.getBoundingClientRect();
          zoomAt(cx - r.left, cy - r.top, d / pinch.d);
        }
        pinch = { d, cx, cy };
        return;
      }
      if (!drag) return;
      const p = toPaper(e);
      if (drag.k === 'pan') {
        cam.x = drag.cx + e.clientX - drag.sx; cam.y = drag.cy + e.clientY - drag.sy;
        fitted = false; applyCam();
      } else if (drag.k === 'pen') {
        if (Math.hypot(e.clientX - drag.lx, e.clientY - drag.ly) < 1.5 || drag.pts.length >= 5000) return;
        drag.lx = e.clientX; drag.ly = e.clientY;
        drag.pts.push([r1(p[0]), r1(p[1])]);
        live.setAttribute('d', penPath(drag.pts));
      } else if (drag.k === 'arrow') {
        drag.pts[1] = [r1(p[0]), r1(p[1])];
        live.setAttribute('d', penPath(drag.pts));
      } else if (drag.k === 'erase') {
        eraseAt(e, false);
      } else if (drag.k === 'mv') {
        const dx = p[0] - drag.p[0], dy = p[1] - drag.p[1];
        if (!drag.moved && Math.hypot(dx, dy) * cam.z < 4) return;
        drag.moved = true;
        drag.it.data.x = r1(drag.before.x + dx); drag.it.data.y = r1(drag.before.y + dy);
        const el = txt.querySelector(`[data-k="${drag.it.cid}"]`);
        if (el) { el.style.left = drag.it.data.x + 'px'; el.style.top = drag.it.data.y + 'px'; }
      }
    });

    function cancelLive() { if (live) live.remove(); live = null; }
    function endPointer(e) {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      stage.classList.remove('pv-panning');
      const d = drag; drag = null;
      if (!d) return;
      const still = d.sx !== undefined && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6;
      if (d.k === 'pen') {
        cancelLive();
        if (d.pts.length === 1) d.pts.push([r1(d.pts[0][0] + .1), d.pts[0][1]]);   // 押しただけなら点を打つ
        addItem('pen', { pts: d.pts, c: S.color, w: d.w });
      } else if (d.k === 'arrow') {
        cancelLive();
        if (!still && d.pts[1]) addItem('arrow', { x1: d.pts[0][0], y1: d.pts[0][1], x2: d.pts[1][0], y2: d.pts[1][1], c: S.color, w: d.w });
      } else if (d.k === 'txt' && still) {
        if (d.hit) startEdit(d.hit.data.x, d.hit.data.y, d.hit);
        else {      // 押した位置が1行目の高さの真ん中に来るよう、画面の上方向へずらして置く
          const r = stage.getBoundingClientRect();
          const [x, y] = fromScreen(d.sx - r.left, d.sy - r.top - S.fs * LINE_H / 2);
          startEdit(x, y);
        }
      } else if (d.k === 'mv') {
        if (d.moved) changeItem(d.it, d.before);
        else {
          const now = Date.now();
          if (lastTap.it === d.it && now - lastTap.t < 400) { lastTap = { it: null, t: 0 }; setTool('text'); startEdit(d.it.data.x, d.it.data.y, d.it); }
          else lastTap = { it: d.it, t: now };
        }
      }
    }
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);

    function eraseAt(e, isDown) {
      const it = findItem(document.elementFromPoint(e.clientX, e.clientY));
      if (!it) return;
      if (mine(it)) return removeItem(it, true);
      if (!isDown) return;                       // なぞって消すのは自分の分だけ。ほかの人の分は1つずつ押して確認
      pts.clear(); drag = null;
      askRemove(it);
    }

    /* ───────── 回転を保存（PDFファイル自体を回す） ─────────
       回すのはブラウザ。実体は R2 へ直送するので API には小さな通信が2回だけ。
       ローカル（署名URLなし）は API へ実体を送る */
    async function saveRotation() {
      if (!rot || rotSaving) return;
      if (running || queue.length || failed) return toast('書き込みの保存が終わってからもう一度押してください');
      const label = { 90: '右に90°', 180: '180°', 270: '左に90°' }[rot];
      if (!confirm(`PDFファイルを${label}回した向きで保存します。\n発注者を含め、このファイルを見る全員にこの向きで表示されます。よろしいですか？`)) return;
      commitEdit(false);
      rotSaving = true;
      const btn = $('[data-act="rotsave"]');
      btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 保存中…';
      try {
        await loadScript(PDFLIB);
        const { PDFDocument, degrees } = PDFLib;
        const pdf = await PDFDocument.load(buf, { ignoreEncryption: true });
        if (pdf.isEncrypted) throw new Error('保護（パスワード・編集制限）がかかったPDFは回転して保存できません');
        for (const pg of pdf.getPages()) pg.setRotation(degrees((((pg.getRotation().angle + rot) % 360) + 360) % 360));
        const bytes = await pdf.save();
        /* 書き込みの座標を回すのに、回す前の各ページの大きさ（画面の座標の単位）を送る */
        const pages = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const v = (await doc.getPage(n)).getViewport({ scale: 1 });
          pages.push([r1(v.width), r1(v.height)]);
        }
        const angle = rot;
        let sign = null;
        try { sign = await api.post(`/files/${file.id}/rotate-url`, {}); }
        catch (err) { if (!/直接アップロード/.test(err.message)) throw err; }
        if (sign) {
          const res = await fetch(sign.url, { method: 'PUT', body: new Blob([bytes], { type: 'application/pdf' }) });
          if (!res.ok) throw new Error(`ファイルを送れませんでした (HTTP ${res.status})`);
          await call(api.post(`/files/${file.id}/rotate`, { key: sign.key, file_size: bytes.byteLength, angle, pages }));
        } else {
          const fd = new FormData();
          fd.append('file', new Blob([bytes], { type: 'application/pdf' }), 'rotated.pdf');
          fd.append('angle', angle);
          fd.append('pages', JSON.stringify(pages));
          await apiFetchForm(`/files/${file.id}/rotate`, fd);
        }
        /* 保存できたら、回したPDFを開き直す（見る向きは元に戻す＝もうファイルがその向き） */
        buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const old = doc;
        doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
        old.destroy();
        rot = 0;
        root.classList.remove('pv-rotated');
        undoS.length = 0; redoS.length = 0;        // 履歴は回す前の座標なので捨てる
        if (meta) {
          const r = await api.get(`/files/${file.id}/annotations`).catch(() => null);
          if (r && r.items) items = r.items.map(a => ({ id: a.id, cid: a.client_id, page: a.page, type: a.type, data: a.data, by: a.user_id, name: a.user_name, at: a.created_at }));
        }
        await showPage(Math.min(pageNo, doc.numPages));
        toast('この向きで保存しました');
      } catch (err) {
        console.error(err);
        toast(err.message && err.message.length < 60 ? err.message : '回転して保存できませんでした');
      } finally {
        rotSaving = false;
        btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> この向きで保存';
      }
    }

    /* ───────── ダウンロード・印刷 ───────── */
    const visibleItems = () => (meta && !root.classList.contains('pv-hide')) ? items : [];
    function saveBlob(bytes, name) {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    /* 文字はPDFに画像として載せる（日本語フォントをPDFに埋め込むと数MBの読み込みが要るため）。線と矢印は線のまま */
    async function textPng(d) {
      const lines = d.s.split('\n');
      let k = 4;
      const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
      const font = s => `700 ${d.fs * s}px ${FONT}`;
      try { await document.fonts.load(font(1), d.s); } catch {}
      ctx.font = font(1);
      const w = Math.max(1, ...lines.map(l => ctx.measureText(l).width)), h = lines.length * d.fs * LINE_H;
      k = Math.min(k, 4096 / w, 4096 / h);
      cv.width = Math.ceil(w * k); cv.height = Math.ceil(h * k);
      ctx.font = font(k); ctx.fillStyle = d.c; ctx.textBaseline = 'alphabetic';
      const m = ctx.measureText('あ');
      const asc = m.fontBoundingBoxAscent || d.fs * k * .88, desc = m.fontBoundingBoxDescent || d.fs * k * .12;
      const lh = d.fs * k * LINE_H;
      lines.forEach((l, i) => ctx.fillText(l, 0, i * lh + (lh - asc - desc) / 2 + asc));
      const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
      return { bytes: await blob.arrayBuffer(), w, h };
    }
    async function bake(list) {
      await loadScript(PDFLIB);
      const { PDFDocument, rgb, degrees, LineCapStyle, pushGraphicsState, popGraphicsState, concatTransformationMatrix } = PDFLib;
      const pdf = await PDFDocument.load(buf, { ignoreEncryption: true });
      const pages = pdf.getPages();
      const col = c => rgb(parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255);
      for (let n = 1; n <= pages.length; n++) {
        const its = list.filter(i => i.page === n);
        if (!its.length) continue;
        const pg = pages[n - 1], b = pg.getCropBox();
        const rot = ((pg.getRotation().angle % 360) + 360) % 360;
        const x0 = b.x, y0 = b.y, x1 = b.x + b.width, y1 = b.y + b.height;
        const H = rot % 180 === 0 ? b.height : b.width;            // 画面で見えている向きでのページの高さ
        /* 画面の向き（回転つきのページは回した後）で描けるよう、座標の向きを合わせてから描く */
        const M = { 0: [1, 0, 0, 1, x0, y0], 90: [0, 1, -1, 0, x1, y0], 180: [-1, 0, 0, -1, x1, y1], 270: [0, -1, 1, 0, x0, y1] }[rot] || [1, 0, 0, 1, x0, y0];
        pg.pushOperators(pushGraphicsState(), concatTransformationMatrix(...M));
        for (const it of its) {
          const d = it.data, c = col(d.c);
          const stroke = { x: 0, y: H, borderColor: c, borderWidth: d.w, borderLineCap: LineCapStyle.Round };
          if (it.type === 'pen') {
            pg.drawSvgPath(penPath(d.pts), stroke);
          } else if (it.type === 'arrow') {
            const a = arrowParts(d);
            pg.drawSvgPath(`M${d.x1} ${d.y1}L${a.bx} ${a.by}`, stroke);
            pg.drawSvgPath(`M${d.x2} ${d.y2}L${a.a[0]} ${a.a[1]}L${a.b[0]} ${a.b[1]}Z`, { x: 0, y: H, color: c });
          } else {
            const t = await textPng(d);
            /* 回した画面で書いた文字は、左上を軸に r 度だけ左回りに傾けて置く（pdf-lib は左下が回転の軸） */
            const a = (d.r || 0) * Math.PI / 180;
            pg.drawImage(await pdf.embedPng(t.bytes), { x: d.x + t.h * Math.sin(a), y: H - d.y - t.h * Math.cos(a),
              width: t.w, height: t.h, rotate: degrees(d.r || 0) });
          }
        }
        pg.pushOperators(popGraphicsState());
      }
      return pdf.save();
    }
    const bakedName = () => file.file_name.replace(/\.pdf$/i, '') + '（書き込み入り）.pdf';
    async function downloadBaked() {
      toast('書き込み入りのPDFを作っています…');
      try { saveBlob(await bake(items), bakedName()); }
      catch (err) { console.error(err); toast('書き込み入りのPDFを作れませんでした'); }
    }
    async function print() {
      let bytes = buf;
      const list = visibleItems();
      if (list.length) {
        toast('印刷の準備をしています…');
        try { bytes = await bake(list); } catch (err) { console.error(err); toast('書き込みを入れられなかったため、元のPDFを印刷します'); }
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const done = () => setTimeout(() => URL.revokeObjectURL(url), 120000);
      if (coarse) { window.open(url, '_blank'); return done(); }      // スマホは埋め込みPDFを印刷できないので別タブで開く
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;';
      f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { window.open(url, '_blank'); } };
      f.src = url;
      document.body.appendChild(f);
      setTimeout(() => f.remove(), 600000);
      done();
    }

    /* ───────── ボタン・キー ───────── */
    root.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });   // 入力中の文字からカーソルを奪わない
    root.addEventListener('click', e => {
      const b = e.target.closest('button, .pv-di');
      if (!b || !root.contains(b)) return;
      const d = b.dataset;
      if (b.classList.contains('pv-save')) { if (failed) { failed = false; pump(); } return; }
      if (d.del) { const it = items.find(i => i.cid === d.del); if (it) askRemove(it); return; }
      if (d.jump) { const it = items.find(i => i.cid === d.jump); if (it) jump(it); return; }
      if (d.tool) return setTool(d.tool);
      if (d.color) { S.color = d.color; if (editor) { editor.style.color = d.color; editor.dataset.color = d.color; } return refreshUI(); }
      if (d.w) { S.w = +d.w; return refreshUI(); }
      if (d.fs) { S.fs = +d.fs; if (editor) { editor._fs = S.fs / cam.z; placeEditor(); } return refreshUI(); }
      if (d.act !== 'dl') $('.pv-menu').classList.remove('pv-on');
      ({
        undo, redo, fit, print,
        rotr: () => rotate(90), rotl: () => rotate(-90), rotsave: saveRotation,
        rotreset: () => rotate(-rot),
        zoomin: () => zoomCenter(1.25), zoomout: () => zoomCenter(.8),
        prev: () => showPage(pageNo - 1), next: () => showPage(pageNo + 1),
        eye: toggleEye,
        drawer: () => { root.classList.toggle('pv-open'); },
        dl: () => { if (meta && items.length) $('.pv-menu').classList.toggle('pv-on'); else saveBlob(buf, file.file_name); },
        'dl-orig': () => saveBlob(buf, file.file_name),
        'dl-baked': downloadBaked,
      })[d.act]?.();
    });

    const onKey = e => {
      if (destroyed || !root.isConnected) return;
      if (e.key === 'Escape') { if (editor) commitEdit(true); else if (meta) setTool('move'); return; }
      if (editor) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitEdit(true); } return; }
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
      if (meta && mod && key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (meta && mod && key === 'y') { e.preventDefault(); redo(); }
      else if (!mod && key === 'r') rotate(e.shiftKey ? -90 : 90);
      else if (e.key === 'PageDown') showPage(pageNo + 1);
      else if (e.key === 'PageUp') showPage(pageNo - 1);
    };
    document.addEventListener('keydown', onKey);
    const onUnload = e => { if (queue.length) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onUnload);
    /* 画面の大きさが変わったとき（一覧の開閉を含む）。まだ動かしていなければ全体表示をやり直す */
    const ro = new ResizeObserver(() => { if (fitted) fit(); else applyCam(); });
    ro.observe(stage);

    /* ───────── 起動 ───────── */
    if (doc.numPages > 1) $('.pv-pages').style.display = 'inline-flex';
    /* 書き込みは図面の描画と並行して取りに行く（図面の表示を待たせない）。
       取れなかった場合は書き込みの道具を出さない（図面を見る・移動する・ダウンロードはそのまま使える） */
    const annoReady = (file.id && typeof api !== 'undefined' ? api.get(`/files/${file.id}/annotations`) : Promise.resolve(null))
      .then(r => {
        if (destroyed || !r || !r.can_annotate) return;
        meta = r;
        items = r.items.map(a => ({ id: a.id, cid: a.client_id, page: a.page, type: a.type, data: a.data, by: a.user_id, name: a.user_name, at: a.created_at }));
        const exp = r.expires_at ? (() => { const [, m, d] = r.expires_at.split('-'); return `${+m}/${+d} まで保存`; })() : '物件のファイルと同じ期限まで保存';
        $('.pv-chip span').textContent = `社内のみ（発注者には見えません）・ ${exp}`;
        $('.pv-chip').title = '書き込みは HaLSpace と PT.HILANO LCZ INDONESIA の人だけに見えます';
        $('.pv-foot').innerHTML = '<i class="fa-solid fa-lock" style="color:#ffd43b"></i> HaLSpace と PT.HILANO LCZ INDONESIA の人だけに見えます。<br>'
          + (r.expires_at ? `物件の保持期限（${esc(r.expires_at.replace(/-/g, '/'))}）で消えます。` : '物件のファイルが保持期限で消えるとき、一緒に消えます。');
        setSave('ok');
        root.classList.add('pv-can');
        if (items.length && root.clientWidth >= 1100) root.classList.add('pv-open');
        render();
      })
      .catch(() => { if (!destroyed) toast('書き込みを読み込めませんでした（図面はそのまま見られます）'); });

    await showPage(1);

    return {
      ready: annoReady,
      destroy() {
        destroyed = true;
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('beforeunload', onUnload);
        ro.disconnect();
        if (baseTask) baseTask.cancel();
        if (detailTask) detailTask.cancel();
        doc.destroy();
        root.remove();
      },
    };
  }

  return { open, preload };
})();
