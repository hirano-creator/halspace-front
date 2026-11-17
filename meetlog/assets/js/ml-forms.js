'use strict';
/* MeetLog 会社の様式（Excel）
   - MLForms : .xlsx を読んで「どのセルに何を入れるか」を見つけ、値を書き込む部品
               （ロゴ・罫線・印刷範囲を壊さないよう、セルの文字だけを書き換える）
   - その下  : 編集画面の様式まわり（様式の切り替え・紙の表示・Excel保存・登録・画像/PDFの挿入）
   ml-edit.js のあとに読み込む。 */

const ML_LIBS = {
  JSZip:    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  pdfjsLib: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
};
const ML_PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

function mlEnsureLib(name) {
  if (window[name]) return Promise.resolve(window[name]);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = ML_LIBS[name];
    s.onload = () => resolve(window[name]);
    s.onerror = () => reject(new Error(name + ' を読み込めませんでした'));
    document.head.appendChild(s);
  });
}

/* ══════════════════════════════════════
   MLForms: xlsx の読み書き
   ══════════════════════════════════════ */
const MLForms = (() => {
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  const colToNum = s => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  const numToCol = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const parseAddr = a => { const m = /^\$?([A-Z]{1,3})\$?(\d{1,7})$/.exec(String(a || '').trim().toUpperCase()); return m ? { col: colToNum(m[1]), row: +m[2] } : null; };
  const toAddr = (col, row) => numToCol(col) + row;
  const parseRange = r => { const [a, b] = String(r).split(':'); const s = parseAddr(a), e = parseAddr(b || a); return (s && e) ? { c1: s.col, r1: s.row, c2: e.col, r2: e.row } : null; };
  const norm = s => String(s || '').replace(/[\s　:：]/g, '');
  const parseXml = str => new DOMParser().parseFromString(str, 'application/xml');

  // 見出しとして探すことば（左ほど優先）
  const LABELS = {
    title:     ['件名', '会議名', '議題', '案件名', 'タイトル', 'テーマ', '表題'],
    datetime:  ['日時', '開催日時', '日付', '開催日', '年月日', '実施日'],
    place:     ['場所', '開催場所', '会場'],
    attendees: ['出席者', '参加者', '出席', 'メンバー'],
    author:    ['作成者', '記録者', '書記', '記録', '作成'],
    body:      ['打合せ事項', '打合事項', '打ち合わせ事項', '打合せ内容', '打ち合わせ内容', '議事内容', '協議事項', '議事', '内容'],
  };

  async function parse(buf) {
    const JSZip = await mlEnsureLib('JSZip');
    let zip;
    try { zip = await JSZip.loadAsync(buf); } catch (_) { throw new Error('Excelファイル（.xlsx）として開けませんでした'); }
    const xml = async p => { const f = zip.file(p); return f ? parseXml(await f.async('string')) : null; };

    const wb = await xml('xl/workbook.xml');
    if (!wb) throw new Error('Excelファイル（.xlsx）ではないようです');

    // 1枚目のシートの場所
    let target = 'worksheets/sheet1.xml';
    const sheetEl = wb.getElementsByTagName('sheet')[0];
    const rels = await xml('xl/_rels/workbook.xml.rels');
    if (sheetEl && rels) {
      const rid = sheetEl.getAttribute('r:id');
      for (const r of rels.getElementsByTagName('Relationship')) {
        if (r.getAttribute('Id') === rid) target = r.getAttribute('Target');
      }
    }
    const sheetPath = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    const sh = await xml(sheetPath);
    if (!sh) throw new Error('シートを読み取れませんでした');

    // 文字の一覧（ふりがなは除く）
    const textOf = node => { let t = ''; for (const el of node.getElementsByTagName('t')) if (el.parentNode.localName !== 'rPh') t += el.textContent; return t; };
    const shared = [];
    const ss = await xml('xl/sharedStrings.xml');
    if (ss) for (const si of ss.getElementsByTagName('si')) shared.push(textOf(si));

    const cells = new Map();
    for (const c of sh.getElementsByTagName('c')) {
      const ref = c.getAttribute('r'), t = c.getAttribute('t');
      let v = '';
      if (t === 'inlineStr') v = textOf(c);
      else { const ve = c.getElementsByTagName('v')[0]; if (ve) v = (t === 's') ? (shared[+ve.textContent] || '') : ve.textContent; }
      if (ref && String(v).trim()) cells.set(ref, String(v));
    }
    const merges = [...sh.getElementsByTagName('mergeCell')].map(m => parseRange(m.getAttribute('ref'))).filter(Boolean);

    // 列の幅
    const fmt = sh.getElementsByTagName('sheetFormatPr')[0];
    const defW = +(fmt && fmt.getAttribute('defaultColWidth')) || 8.43;
    const cols = [...sh.getElementsByTagName('col')].map(c => ({ min: +c.getAttribute('min'), max: +c.getAttribute('max'), width: +c.getAttribute('width') || defW }));
    const colWidth = n => { for (const c of cols) if (n >= c.min && n <= c.max) return c.width; return defW; };

    // 印刷範囲
    let printEnd = null;
    for (const dn of wb.getElementsByTagName('definedName')) {
      if (dn.getAttribute('name') === '_xlnm.Print_Area') {
        const m = /\$?([A-Z]{1,3})\$?(\d+)\s*$/.exec(dn.textContent || '');
        if (m) { printEnd = { col: colToNum(m[1]), row: +m[2] }; break; }
      }
    }

    // ロゴ（最初の画像）
    let logo = null;
    const media = Object.keys(zip.files).filter(p => /^xl\/media\/.+\.(png|jpe?g|gif)$/i.test(p)).sort()[0];
    if (media) {
      try {
        const b64 = await zip.file(media).async('base64');
        const ext = media.split('.').pop().toLowerCase().replace('jpg', 'jpeg');
        logo = await shrinkImage(`data:image/${ext};base64,${b64}`, 96);
      } catch (_) { logo = null; }
    }

    return { sheetPath, cells, merges, colWidth, printEnd, logo };
  }

  function shrinkImage(dataUrl, maxH) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, maxH / img.height);
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * k));
        cv.height = Math.max(1, Math.round(img.height * k));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        const out = cv.toDataURL('image/png');
        resolve(out.length < 200000 ? out : null);
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  /* 見出し（件名・日時…）を探して、値を入れるセルを決める */
  function detect(p) {
    const list = [...p.cells.entries()].map(([ref, text]) => ({ ref, text, n: norm(text), ...parseAddr(ref) }))
      .filter(c => c.col).sort((a, b) => a.row - b.row || a.col - b.col);
    const rangeOf = c => p.merges.find(m => c.col >= m.c1 && c.col <= m.c2 && c.row >= m.r1 && c.row <= m.r2) || { c1: c.col, r1: c.row, c2: c.col, r2: c.row };

    const found = {};
    for (const key of Object.keys(LABELS)) {
      for (const word of LABELS[key]) {
        const hit = list.find(c => c.n === word && !Object.values(found).some(f => f.ref === c.ref));
        if (hit) { found[key] = hit; break; }
      }
    }

    const cells = {}, labels = {};
    for (const key of ['title', 'datetime', 'place', 'attendees', 'author']) {
      const f = found[key];
      if (!f) continue;
      const r = rangeOf(f);
      cells[key] = toAddr(r.c2 + 1, r.r1);
      labels[key] = f.text.replace(/[\s　]/g, '');
    }

    // 本文
    const metaRows = ['title', 'datetime', 'place', 'attendees', 'author'].filter(k => found[k]).map(k => rangeOf(found[k]).r2);
    let bodyChars = 36, bodyEndRow = null;
    if (found.body && (!metaRows.length || found.body.row > Math.min(...metaRows))) {
      const r = rangeOf(found.body);
      cells.bodyStart = toAddr(r.c1, r.r2 + 1);
      labels.body = found.body.text.replace(/[\s　]/g, '');
      const endCol = r.c2 > r.c1 ? r.c2 : (p.printEnd ? p.printEnd.col : r.c1 + 8);
      let w = 0; for (let c = r.c1; c <= endCol; c++) w += p.colWidth(c);
      bodyChars = Math.max(15, Math.min(60, Math.floor(w / 2.05) - 1));
    } else if (metaRows.length) {
      const minCol = Math.min(...Object.values(found).map(f => rangeOf(f).c1));
      cells.bodyStart = toAddr(minCol, Math.max(...metaRows) + 2);
    } else {
      cells.bodyStart = 'A5';
    }
    const bs = parseAddr(cells.bodyStart);
    bodyEndRow = (p.printEnd && p.printEnd.row > bs.row) ? p.printEnd.row : bs.row + 35;

    // 表題（見出しより上にある最初の文字）
    const firstRow = Math.min(...Object.values(found).map(f => f.row), 9999);
    const head = list.find(c => c.row < firstRow && c.n.length >= 2);

    return {
      sheet: p.sheetPath, cells, labels,
      bodyChars, bodyEndRow,
      heading: head ? head.text.replace(/[\s　]+/g, '') : '議事録',
      logo: p.logo || null,
    };
  }

  /* 全角=1・半角=0.5 で数えて折り返す */
  function wrapLine(line, n) {
    const out = [];
    const hang = /^[\s　]*[・■\-]/.test(line) ? '　' : '';
    let cur = '', w = 0, first = true;
    for (const ch of line) {
      const cw = /[\x00-\xff｡-ﾟ]/.test(ch) ? 0.5 : 1;
      const limit = first ? n : n - hang.length;
      if (w + cw > limit && cur) { out.push((first ? '' : hang) + cur); cur = ''; w = 0; first = false; }
      cur += ch; w += cw;
    }
    out.push((first ? '' : hang) + cur);
    return out;
  }
  const wrapLines = (lines, n) => lines.flatMap(l => l ? wrapLine(l, n) : ['']);

  const clean = s => String(s == null ? '' : s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  /* 様式ファイルに値を書き込んで Blob を返す */
  async function fill(buf, config, values) {
    const JSZip = await mlEnsureLib('JSZip');
    const zip = await JSZip.loadAsync(buf);
    const path = config.sheet || 'xl/worksheets/sheet1.xml';
    const file = zip.file(path);
    if (!file) throw new Error('様式のシートが見つかりません');
    const doc = parseXml(await file.async('string'));
    const sheetData = doc.getElementsByTagName('sheetData')[0];
    const merges = [...doc.getElementsByTagName('mergeCell')].map(m => parseRange(m.getAttribute('ref'))).filter(Boolean);

    const getRow = r => {
      for (const row of sheetData.children) {
        const n = +row.getAttribute('r');
        if (n === r) return row;
        if (n > r) { const nr = doc.createElementNS(NS, 'row'); nr.setAttribute('r', r); sheetData.insertBefore(nr, row); return nr; }
      }
      const nr = doc.createElementNS(NS, 'row'); nr.setAttribute('r', r); sheetData.appendChild(nr); return nr;
    };
    const setCell = (a, text) => {
      const p = parseAddr(a);
      if (!p) return null;
      const row = getRow(p.row);
      row.removeAttribute('spans');
      let cell = null, before = null;
      for (const c of row.children) {
        const q = parseAddr(c.getAttribute('r'));
        if (!q) continue;
        if (q.col === p.col) { cell = c; break; }
        if (q.col > p.col) { before = c; break; }
      }
      if (!cell) { cell = doc.createElementNS(NS, 'c'); cell.setAttribute('r', toAddr(p.col, p.row)); row.insertBefore(cell, before); }
      while (cell.firstChild) cell.removeChild(cell.firstChild);
      text = clean(text);
      if (!text) { cell.removeAttribute('t'); return cell; }
      cell.setAttribute('t', 'inlineStr');
      const is = doc.createElementNS(NS, 'is'), t = doc.createElementNS(NS, 't');
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      t.textContent = text;
      is.appendChild(t); cell.appendChild(is);
      return cell;
    };

    const c = config.cells || {};
    for (const key of ['title', 'datetime', 'place', 'attendees', 'author']) {
      if (c[key] && parseAddr(c[key])) setCell(c[key], values[key] || '');
    }

    let overflow = 0;
    const bs = parseAddr(c.bodyStart);
    const lines = values.bodyLines || [];
    if (bs) {
      const merged = merges.find(m => bs.col >= m.c1 && bs.col <= m.c2 && bs.row >= m.r1 && bs.row <= m.r2);
      if (merged && merged.r2 > merged.r1) {
        // 本文の枠が1つの大きなセル: 改行つきでまとめて入れ、折り返しを有効にする
        const cell = setCell(toAddr(merged.c1, merged.r1), lines.join('\n'));
        const sIdx = await wrapStyle(zip, +(cell.getAttribute('s') || 0));
        if (sIdx != null) cell.setAttribute('s', sIdx);
      } else {
        const wrapped = wrapLines(lines, config.bodyChars || 36);
        wrapped.forEach((l, i) => setCell(toAddr(bs.col, bs.row + i), l));
        const room = (config.bodyEndRow || bs.row + 35) - bs.row + 1;
        overflow = Math.max(0, wrapped.length - room);
      }
    }

    let out = new XMLSerializer().serializeToString(doc);
    if (!out.startsWith('<?xml')) out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + out;
    zip.file(path, out);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: XLSX_MIME });
    return { blob, overflow };
  }

  // 折り返し・上詰めの書式を1つ足して、その番号を返す
  async function wrapStyle(zip, baseIdx) {
    try {
      const f = zip.file('xl/styles.xml');
      if (!f) return null;
      const sdoc = parseXml(await f.async('string'));
      const xfs = sdoc.getElementsByTagName('cellXfs')[0];
      const base = xfs.children[baseIdx] || xfs.children[0];
      const nx = base.cloneNode(true);
      nx.setAttribute('applyAlignment', '1');
      let al = nx.getElementsByTagName('alignment')[0];
      if (!al) { al = sdoc.createElementNS(NS, 'alignment'); nx.insertBefore(al, nx.firstChild); }
      al.setAttribute('wrapText', '1');
      al.setAttribute('vertical', 'top');
      xfs.appendChild(nx);
      xfs.setAttribute('count', xfs.children.length);
      let out = new XMLSerializer().serializeToString(sdoc);
      if (!out.startsWith('<?xml')) out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + out;
      zip.file('xl/styles.xml', out);
      return xfs.children.length - 1;
    } catch (_) { return null; }
  }

  /* 画面・印刷用の紙（様式に似せた見た目。正確な体裁はExcel保存で出る） */
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function paperHtml(config, values, bodyHtml) {
    const c = config.cells || {}, lb = config.labels || {};
    const names = { title: '件名', datetime: '日時', place: '場所', author: '作成者', attendees: '出席者' };
    const left = ['title', 'datetime', 'place', 'author'].filter(k => c[k]);
    const hasAtt = !!c.attendees;
    let rows = '';
    left.forEach((k, i) => {
      rows += `<tr><th>${esc(lb[k] || names[k])}</th><td>${esc(values[k] || '')}</td>`
        + (hasAtt && i === 0 ? `<th rowspan="${left.length}" class="fp-att-h">${esc(lb.attendees || names.attendees)}</th><td rowspan="${left.length}" class="fp-att">${esc(values.attendees || '')}</td>` : '')
        + '</tr>';
    });
    if (!left.length && hasAtt) rows = `<tr><th>${esc(lb.attendees || names.attendees)}</th><td>${esc(values.attendees || '')}</td></tr>`;
    return `<div class="fp-frame">
      <div class="fp-top"><div class="fp-title">${esc(config.heading || '議事録')}</div>${config.logo ? `<img class="fp-logo" src="${config.logo}" alt="">` : ''}</div>
      ${rows ? `<table class="fp-meta">${rows}</table>` : ''}
      ${lb.body ? `<div class="fp-band">${esc(lb.body)}</div>` : ''}
      <div class="fp-body">${bodyHtml || ''}</div>
    </div>`;
  }

  const PAPER_CSS = `
.fp{font-family:'Noto Sans JP','Hiragino Kaku Gothic Pro','Meiryo',sans-serif;font-size:12.5px;line-height:1.75;color:#1a1a1a;}
.fp-frame{border:1.5px solid #222;min-height:980px;display:flex;flex-direction:column;}
.fp-top{display:flex;align-items:center;justify-content:center;position:relative;padding:12px 16px 10px;min-height:52px;}
.fp-title{font-size:18px;letter-spacing:.45em;text-indent:.45em;}
.fp-logo{position:absolute;right:14px;top:50%;transform:translateY(-50%);max-height:34px;max-width:150px;margin:0;border:none;border-radius:0;}
.fp-meta{width:100%;border-collapse:collapse;border-top:1.5px solid #222;border-bottom:1.5px solid #222;margin:0;font-size:12.5px;}
.fp-meta th,.fp-meta td{border:1px solid #222;padding:3px 9px;font-weight:400;height:26px;vertical-align:middle;background:none;text-align:left;}
.fp-meta tr:first-child th,.fp-meta tr:first-child td{border-top:none;}
.fp-meta tr:last-child th,.fp-meta tr:last-child td{border-bottom:none;}
.fp-meta th:first-child{border-left:none;}
.fp-meta td:last-child{border-right:none;}
.fp-meta th{width:64px;text-align:center;white-space:nowrap;}
.fp-meta td.fp-att{vertical-align:top;width:34%;}
.fp-band{margin-top:7px;border-top:1.5px solid #222;border-bottom:1.5px solid #222;text-align:center;letter-spacing:.45em;text-indent:.45em;padding:3px;}
.fp-body{padding:12px 16px 16px;flex:1;}
.fp-body h1,.fp-body h2{font-size:13px;font-weight:700;margin:12px 0 4px;padding:0;border:none;}
.fp-body h3{font-size:12.5px;font-weight:700;margin:12px 0 2px;padding:0;background:none !important;color:#1a1a1a !important;border-radius:0;}
.fp-body h3::before{content:'【';}
.fp-body h3::after{content:'】';}
.fp-body > h3:first-child{margin-top:0;}
.fp-body h4{font-size:12.5px;font-weight:700;margin:6px 0 0;padding:0;border:none;}
.fp-body h4::before{content:'■ ';}
.fp-body p{margin:0 0 4px;}
.fp-body ul{list-style:none;margin:0 0 4px;padding-left:1em;}
.fp-body ul li{margin:0;}
.fp-body ul li::before{content:'・';margin-left:-1em;}
.fp-body ol{margin:0 0 4px;padding-left:1.6em;}
.fp-body table{border-collapse:collapse;width:100%;margin:4px 0 8px;font-size:12px;}
.fp-body th,.fp-body td{border:1px solid #999;padding:3px 8px;text-align:left;}
.fp-body th{background:#F3F4F6;font-weight:700;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.fp-body img{max-width:100%;display:block;margin:6px 0;}
.fp-body hr{display:none;}
.fp-empty{color:#aaa;text-align:center;padding:80px 20px;line-height:2;}
`;

  const bufToB64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const b64ToBuf = b64 => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };

  return { parse, detect, fill, wrapLines, paperHtml, parseAddr, PAPER_CSS, bufToB64, b64ToBuf };
})();

/* ══════════════════════════════════════
   編集画面：様式まわり
   ══════════════════════════════════════ */
let forms = [];              // 会社の様式（kind = xlsx）
let selectedForm = null;
const formFileCache = {};    // id → ArrayBuffer
const $id = id => document.getElementById(id);

(function injectFormCss() {
  const st = document.createElement('style');
  st.textContent = MLForms.PAPER_CSS;
  document.head.appendChild(st);
})();

function isAdminUser() {
  const r = currentUser && currentUser.role;
  return r === 'admin' || r === 'super_admin';
}

function formatDateJp(dateVal, timeVal) {
  if (!dateVal) return timeVal || '';
  const d = new Date(dateVal + 'T00:00:00');
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${w}）` + (timeVal ? ' ' + timeVal.slice(0, 5) : '');
}

function metaValues() {
  return {
    title:     $id('titleInput').value.trim(),
    datetime:  formatDateJp($id('meetingDate').value, $id('meetingTime').value),
    place:     $id('meetingLocation').value.trim(),
    attendees: parseAttendees($id('attendeesInput').value).map(a => a.name).join('、'),
    author:    $id('authorNameInput').value.trim(),
  };
}

/* いま紙に入っている文章（Markdown）。まだ無ければ空文字 */
function currentMarkdown() {
  if (previewIsEditing) return $id('previewEditArea').value;
  const p = $id('mdPreview');
  if (p.querySelector('.preview-placeholder')) return '';
  return p.dataset.markdown || '';
}

/* ── 様式の切り替え ── */
function renderFormPills() {
  const box = $id('formPills');
  if (!box) return;
  let html = `<button class="pill${selectedForm ? '' : ' on'}" onclick="selectForm(null)">標準</button>`;
  html += forms.map(f =>
    `<button class="pill${selectedForm && selectedForm.id === f.id ? ' on' : ''}" onclick="selectForm(${f.id})"><i class="fa-solid fa-file-excel"></i>${escHtml(f.name)}</button>`).join('');
  if (isAdminUser()) {
    if (selectedForm) html += `<button class="pill pill-icon" title="この様式の設定" onclick="openFormReg(${selectedForm.id})"><i class="fa-solid fa-gear"></i></button>`;
    html += `<button class="pill dash" onclick="openFormReg()"><i class="fa-solid fa-plus"></i>会社の様式を登録</button>`;
  }
  box.innerHTML = html;
  $id('excelBtn').style.display = selectedForm ? '' : 'none';
}

function selectForm(id, silent) {
  selectedForm = id ? (forms.find(f => f.id === id) || null) : null;
  renderFormPills();
  syncPaperView();
  renderFormPaper();
  if (!silent) markDirty();
}

/* 紙の中のどれを見せるか（標準 / 様式 / 文章をなおす） */
function syncPaperView() {
  const p = $id('stdWrap'), f = $id('formPaper'), e = $id('previewEditArea');
  if (!p || !f || !e) return;
  $id('mdPreview').style.display = '';
  e.style.display = previewIsEditing ? 'block' : 'none';
  p.style.display = (!previewIsEditing && !selectedForm) ? '' : 'none';
  f.style.display = (!previewIsEditing && selectedForm) ? '' : 'none';
}

const stripEmoji = s => String(s).replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '').trim();
const ACTION_HEADING = /アクション|次にやること|次回までの対応|TODO|ToDo|やること/;

/* 表題と「日時/場所/参加者」の段落は様式の枠に入るので、本文からは外す */
function stripTitleAndMeta(div) {
  const first = div.firstElementChild;
  if (first && /^H[12]$/.test(first.tagName)) first.remove();
  [...div.children].slice(0, 3).forEach(el => {
    if (el.tagName === 'HR') el.remove();
    else if ((el.tagName === 'P' || el.classList.contains('preview-meta')) && /日時|参加者|出席者|作成者/.test(el.textContent) && /[:：]/.test(el.textContent)) el.remove();
  });
}

function visibleActions() {
  return (actions || []).filter(a => (a.content || '').trim());
}

function actionsTableHtml(md) {
  const acts = visibleActions();
  if (!acts.length || ACTION_HEADING.test(md)) return '';
  return '<h3>次にやること</h3><table><tr><th>内容</th><th style="width:80px">担当</th><th style="width:90px">期限</th></tr>'
    + acts.map(a => `<tr><td>${escHtml(a.content)}</td><td>${escHtml(a.assignee_name || '')}</td><td>${escHtml(a.due_date || '')}</td></tr>`).join('') + '</table>';
}

/* 標準の紙にも「次にやること」を出す（画面と印刷を同じにするため） */
function renderStdActions() {
  const el = $id('stdActions');
  if (!el) return;
  const md = currentMarkdown();
  el.innerHTML = md.trim() ? actionsTableHtml(md) : '';
}

let _fpSeq = 0;
async function renderFormPaper() {
  renderStdActions();
  const el = $id('formPaper');
  if (!el) return;
  if (!selectedForm) { el.innerHTML = ''; return; }
  const seq = ++_fpSeq;
  const md = currentMarkdown();
  let body;
  if (md.trim()) {
    const div = document.createElement('div');
    div.innerHTML = await parseMarkdownWithImages(md);
    stripTitleAndMeta(div);
    div.querySelectorAll('h1,h2,h3,h4').forEach(h => { h.textContent = stripEmoji(h.textContent); });
    body = div.innerHTML;
    body += actionsTableHtml(md);
  } else {
    body = '<div class="fp-empty"><i class="fa-solid fa-wand-magic-sparkles" style="font-size:28px;display:block;margin-bottom:10px"></i>左にメモを書いて「AIで整えて紙に入れる」を押すと<br>ここに入ります</div>';
  }
  if (seq !== _fpSeq) return;
  el.innerHTML = MLForms.paperHtml(selectedForm.config || {}, metaValues(), body);
}

let _fpTimer = null;
function scheduleFormPaper() {
  if (previewIsEditing) return;
  clearTimeout(_fpTimer);
  _fpTimer = setTimeout(renderFormPaper, 250);
}

/* Markdown → Excelに入れる行（飾りなしの文字） */
function mdToPlainLines(md) {
  const div = document.createElement('div');
  marked.setOptions({ headerIds: false, mangle: false });
  div.innerHTML = marked.parse(String(md || '').replace(/!\[[^\]]*\]\(mlimg:\/\/\d+\)(\{width=\d+\})?/g, ''));
  stripTitleAndMeta(div);
  const out = [];
  const txt = el => el.textContent.replace(/\s+/g, ' ').trim();
  const walkList = (list, depth) => {
    [...list.children].forEach((li, i) => {
      if (li.tagName !== 'LI') return;
      const own = [...li.childNodes].filter(n => !(n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName))).map(n => n.textContent).join('').replace(/\s+/g, ' ').trim();
      out.push('　'.repeat(depth) + (list.tagName === 'OL' ? `${i + 1}. ` : '・') + own);
      [...li.children].filter(n => /^(UL|OL)$/.test(n.tagName)).forEach(n => walkList(n, depth + 1));
    });
  };
  [...div.children].forEach(el => {
    const tag = el.tagName;
    if (tag === 'H1' || tag === 'H2' || tag === 'H3') { if (out.length) out.push(''); out.push('【' + stripEmoji(txt(el)) + '】'); }
    else if (tag === 'H4' || tag === 'H5') out.push('■ ' + stripEmoji(txt(el)));
    else if (tag === 'UL' || tag === 'OL') walkList(el, 0);
    else if (tag === 'TABLE') el.querySelectorAll('tr').forEach(tr => out.push([...tr.children].map(txt).join(' ／ ')));
    else if (tag === 'HR') { /* 何もしない */ }
    else { el.innerText ? el.innerText.split('\n').forEach(l => l.trim() && out.push(l.trim())) : (txt(el) && out.push(txt(el))); }
  });
  return out;
}

/* ── Excelで保存 ── */
async function getFormFile(id) {
  if (formFileCache[id]) return formFileCache[id];
  const data = await mlGetTemplateFile(id);
  if (!data || !data.file_b64) return null;
  formFileCache[id] = MLForms.b64ToBuf(data.file_b64);
  return formFileCache[id];
}

function buildFillValues() {
  const md = currentMarkdown() || $id('bodyInput').value || '';
  const lines = mdToPlainLines(md);
  const acts = visibleActions();
  if (acts.length && !ACTION_HEADING.test(md)) {
    if (lines.length) lines.push('');
    lines.push('【次にやること】');
    acts.forEach(a => {
      const extra = [a.assignee_name ? `担当：${a.assignee_name}` : '', a.due_date ? `期限：${a.due_date}` : ''].filter(Boolean).join('／');
      lines.push('・' + a.content + (extra ? `（${extra}）` : ''));
    });
  }
  return { ...metaValues(), bodyLines: lines, hasImage: /mlimg:\/\//.test(md) };
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name.replace(/[\\/:*?"<>|]/g, '_');
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

async function exportExcel() {
  if (!selectedForm) return;
  const btn = $id('excelBtn');
  const keep = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>作成中';
  try {
    const buf = await getFormFile(selectedForm.id);
    if (!buf) { mlShowToast('様式ファイルを読み込めませんでした', 'danger'); return; }
    const values = buildFillValues();
    const { blob, overflow } = await MLForms.fill(buf, selectedForm.config || {}, values);
    downloadBlob(blob, (values.title || '議事録') + '.xlsx');
    if (overflow > 0) mlShowToast(`本文が長く、様式の枠から${overflow}行はみ出しています。Excelで調整してください`, 'warning');
    else if (values.hasImage) mlShowToast('Excelで保存しました（画像はExcelには入りません。印刷・PDFには入ります）', 'success');
    else mlShowToast('Excelで保存しました', 'success');
  } catch (e) {
    console.error('exportExcel error:', e);
    mlShowToast('Excelの作成に失敗しました: ' + e.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = keep;
  }
}

/* ══════════════════════════════════════
   様式の登録（管理者）
   ══════════════════════════════════════ */
let regState = null;
const REG_FIELDS = [
  ['title', '件名'], ['datetime', '日時'], ['place', '場所'],
  ['attendees', '出席者'], ['author', '作成者'], ['bodyStart', '本文の始まり'],
];

function openFormReg(editId) {
  if (!isAdminUser()) return;
  if (editId) {
    const f = forms.find(x => x.id === editId);
    if (!f) return;
    regState = { mode: 'edit', id: f.id, buf: null, fileName: f.file_name, config: JSON.parse(JSON.stringify(f.config || { cells: {}, labels: {} })) };
    $id('regName').value = f.name;
    $id('regDefault').checked = !!f.is_default;
    regShowStep(2);
  } else {
    regState = { mode: 'new', id: null, buf: null, fileName: '', config: null };
    $id('regName').value = '';
    $id('regDefault').checked = false;
    regShowStep(1);
  }
  $id('regDeleteBtn').style.display = editId ? '' : 'none';
  $id('regTitle').textContent = editId ? '様式の設定' : '会社の様式を登録する';
  $id('formRegModal').classList.remove('hidden');
}

function closeFormReg() {
  $id('formRegModal').classList.add('hidden');
  regState = null;
}

function regShowStep(n) {
  $id('regStep1').style.display = n === 1 ? '' : 'none';
  $id('regStep2').style.display = n === 2 ? '' : 'none';
  $id('regFoot').style.display = n === 2 ? '' : 'none';
  document.querySelectorAll('#regSteps span').forEach((s, i) => s.classList.toggle('on', i === n - 1));
  if (n === 2) renderRegFields();
}

async function onRegFile(file) {
  if (!file || !regState) return;
  if (!/\.xlsx$/i.test(file.name)) {
    mlShowToast('いまは .xlsx だけ使えます。Excelの「名前を付けて保存」で .xlsx にしてから選んでください', 'warning');
    return;
  }
  if (file.size > 3 * 1024 * 1024) { mlShowToast('ファイルが大きすぎます（3MBまで）', 'warning'); return; }
  try {
    const buf = await file.arrayBuffer();
    const parsed = await MLForms.parse(buf);
    regState.buf = buf;
    regState.fileName = file.name;
    regState.config = MLForms.detect(parsed);
    if (!$id('regName').value) $id('regName').value = file.name.replace(/\.xlsx$/i, '');
    regShowStep(2);
  } catch (e) {
    console.error('onRegFile error:', e);
    mlShowToast(e.message || 'ファイルを読み取れませんでした', 'danger');
  }
}

function renderRegFields() {
  const cfg = regState.config;
  cfg.cells = cfg.cells || {}; cfg.labels = cfg.labels || {};
  const foundCount = REG_FIELDS.filter(([k]) => cfg.cells[k]).length;
  $id('regLead').textContent = regState.mode === 'new'
    ? `入れる場所を${foundCount}か所見つけました。違っていたらセルの番地を直してください。`
    : 'どのセルに何を入れるかを直せます。';
  $id('regFields').innerHTML = REG_FIELDS.map(([k, name]) => {
    const lbKey = k === 'bodyStart' ? 'body' : k;
    const hint = cfg.labels[lbKey] ? `「${escHtml(cfg.labels[lbKey])}」${k === 'bodyStart' ? 'の下' : 'の右'}` : (cfg.cells[k] ? '' : '入れない');
    return `<div class="reg-row"><b>${name}</b><span class="reg-hint">${hint}</span>
      <input class="form-input reg-cell" data-k="${k}" value="${escHtml(cfg.cells[k] || '')}" placeholder="例: D3" maxlength="8" oninput="onRegCellInput(this)"></div>`;
  }).join('') + `
    <div class="reg-row"><b>本文の1行</b><span class="reg-hint">全角で何文字まで</span>
      <input class="form-input reg-cell" type="number" min="10" max="80" value="${cfg.bodyChars || 36}" oninput="regState.config.bodyChars=Math.max(10,Math.min(80,+this.value||36))"></div>
    <div class="reg-row"><b>本文の最後</b><span class="reg-hint">何行目まで入れるか</span>
      <input class="form-input reg-cell" type="number" min="1" max="2000" value="${cfg.bodyEndRow || ''}" oninput="regState.config.bodyEndRow=+this.value||null"></div>`;
  renderRegPaper();
}

function onRegCellInput(inp) {
  const v = inp.value.trim().toUpperCase();
  const ok = !v || MLForms.parseAddr(v);
  inp.classList.toggle('bad', !ok);
  if (ok) { if (v) regState.config.cells[inp.dataset.k] = v; else delete regState.config.cells[inp.dataset.k]; }
  renderRegPaper();
}

function renderRegPaper() {
  const cfg = regState.config;
  const slot = (k, t) => cfg.cells[k] ? `［${cfg.cells[k]}］${t}` : '';
  const vals = { title: slot('title', '件名'), datetime: slot('datetime', '日時'), place: slot('place', '場所'), attendees: slot('attendees', '出席者'), author: slot('author', '作成者') };
  const body = `<div class="reg-slot">${cfg.cells.bodyStart ? `［${escHtml(cfg.cells.bodyStart)}］から下へ、議事録の本文が1行ずつ入ります` : '本文の始まりのセルを入れてください'}</div>`;
  $id('regPaper').innerHTML = MLForms.paperHtml(cfg, vals, body);
}

async function regGetBuf() {
  if (regState.buf) return regState.buf;
  if (regState.id) regState.buf = await getFormFile(regState.id);
  return regState.buf;
}

/* 試しにExcelで出す：いまの議事録（無ければ見本）を入れて確かめる */
async function regTrial() {
  const buf = await regGetBuf();
  if (!buf) { mlShowToast('様式ファイルを読み込めませんでした', 'danger'); return; }
  const v = buildFillValues();
  const values = {
    title: v.title || '（件名の見本）', datetime: v.datetime || formatDateJp(todayIso(), '13:30'),
    place: v.place || '（場所の見本）', attendees: v.attendees || '見本 太郎、見本 花子', author: v.author || '（作成者）',
    bodyLines: v.bodyLines.length ? v.bodyLines : ['【決定事項】', '・ここに議事録の本文が1行ずつ入ります', '', '【次にやること】', '・見本の行です（担当：見本／期限：2026-01-01）'],
  };
  try {
    const { blob } = await MLForms.fill(buf, regState.config, values);
    downloadBlob(blob, '様式の確認.xlsx');
    mlShowToast('Excelで開いて、入る場所を確かめてください', 'success');
  } catch (e) {
    mlShowToast('作成に失敗しました: ' + e.message, 'danger');
  }
}

async function regSave() {
  const name = $id('regName').value.trim();
  if (!name) { mlShowToast('様式の名前を入れてください', 'warning'); $id('regName').focus(); return; }
  if (document.querySelector('#regFields .bad')) { mlShowToast('セルの番地は「D3」のように入れてください', 'warning'); return; }
  if (!regState.config.cells.bodyStart) { mlShowToast('本文の始まりのセルを入れてください', 'warning'); return; }

  const btn = $id('regSaveBtn');
  btn.disabled = true;
  const payload = { name, kind: 'xlsx', config: regState.config, is_default: $id('regDefault').checked };
  let res;
  if (regState.mode === 'new') {
    payload.file_name = regState.fileName;
    payload.file_b64 = MLForms.bufToB64(regState.buf);
    payload.sort_order = templates.length;
    res = await mlCreateTemplate(payload);
  } else {
    res = await mlUpdateTemplate(regState.id, payload);
  }
  btn.disabled = false;
  if (!res) { mlShowToast('登録に失敗しました', 'danger'); return; }

  if (regState.buf) formFileCache[res.id] = regState.buf;
  const id = res.id;
  closeFormReg();
  await loadTemplates();
  selectForm(id);
  mlShowToast('様式を登録しました', 'success');
}

async function regDelete() {
  if (!regState || !regState.id) return;
  if (!confirm('この様式を削除しますか？（この様式で作った議事録は「標準」で表示されます）')) return;
  const ok = await mlDeleteTemplate(regState.id);
  if (!ok) { mlShowToast('削除に失敗しました', 'danger'); return; }
  closeFormReg();
  await loadTemplates();
  selectForm(null);
  mlShowToast('様式を削除しました');
}

/* ══════════════════════════════════════
   画像・PDFを紙に入れる
   ══════════════════════════════════════ */
async function ensureSavedForInsert() {
  if (curId()) return curId();
  if (!$id('titleInput').value.trim()) {
    mlShowToast('先に件名を入れてください（画像を入れる前に保存します）', 'warning');
    $id('titleInput').focus();
    return null;
  }
  await save();
  return curId();
}

async function onInsertFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  const mid = await ensureSavedForInsert();
  if (!mid) return;

  const tags = [];
  try {
    for (const f of files) {
      const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      if (isPdf) tags.push(...await uploadPdfPages(mid, f));
      else if (f.type.startsWith('image/')) { const t = await uploadOneImage(mid, f); if (t) tags.push(t); }
      else mlShowToast(`「${f.name}」は入れられません（画像とPDFだけ使えます）`, 'warning');
    }
  } catch (e) {
    console.error('insert error:', e);
    mlShowToast('読み込みに失敗しました: ' + (e.message || ''), 'danger');
  }
  setStatus('');
  if (!tags.length) return;

  const block = '\n\n' + tags.join('\n\n') + '\n';
  if (previewIsEditing) {
    const ta = $id('previewEditArea');
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + block + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + block.length;
    ta.focus();
  } else {
    const base = currentMarkdown() || $id('bodyInput').value || '';
    await showPreviewMode(base.replace(/\s+$/, '') + block);
  }
  markDirty();
  mlShowToast(`${tags.length}枚を紙に入れました。画像を押すと大きさを変えられます`, 'success');
}

async function uploadOneImage(mid, file) {
  setStatus('<i class="fa-solid fa-spinner spinner"></i> 画像を送っています…', true);
  const result = await mlUploadAttachment(mid, file);
  if (!result) { mlShowToast(`「${file.name}」を送れませんでした`, 'danger'); return null; }
  attachments.push(result);
  delete imageUrlCache[result.id];
  const alt = String(result.original_name || file.name).replace(/[\[\]()\n]/g, '');
  return `![${alt}](mlimg://${result.id})`;
}

/* PDFは1ページずつ画像にして入れる */
async function uploadPdfPages(mid, file) {
  const pdfjsLib = await mlEnsureLib('pdfjsLib');
  pdfjsLib.GlobalWorkerOptions.workerSrc = ML_PDF_WORKER;
  setStatus('<i class="fa-solid fa-spinner spinner"></i> PDFを開いています…', true);
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const MAX = 20;
  let pages = pdf.numPages;
  if (pages > MAX) {
    if (!confirm(`このPDFは${pages}ページあります。最初の${MAX}ページだけ入れますか？`)) return [];
    pages = MAX;
  }
  const base = file.name.replace(/\.pdf$/i, '');
  const tags = [];
  for (let i = 1; i <= pages; i++) {
    setStatus(`<i class="fa-solid fa-spinner spinner"></i> PDFを入れています… ${i} / ${pages}ページ`, true);
    const page = await pdf.getPage(i);
    const v1 = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2.5, 1500 / v1.width) });
    const cv = document.createElement('canvas');
    cv.width = Math.round(viewport.width);
    cv.height = Math.round(viewport.height);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.88));
    cv.width = cv.height = 0;
    const tag = await uploadOneImage(mid, new File([blob], `${base}_${i}.jpg`, { type: 'image/jpeg' }));
    if (tag) tags.push(tag);
  }
  return tags;
}

/* ── 様式まわりの初期化（ml-edit.js の DOMContentLoaded から呼ぶ） ── */
function initFormsUi() {
  // 様式の紙の中の画像も、押すと大きさを変えられる
  $id('formPaper').addEventListener('click', e => {
    if (e.target.tagName === 'IMG' && e.target.dataset.mlimgId) selectImg(e.target);
  });

  // 会議情報が変わったら様式の紙にも反映
  ['titleInput', 'meetingDate', 'meetingTime', 'meetingLocation', 'attendeesInput', 'authorNameInput']
    .forEach(id => $id(id).addEventListener('input', scheduleFormPaper));

  // 画像・PDFのドラッグ＆ドロップ
  const desk = $id('desk');
  desk.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); desk.classList.add('drop-on'); } });
  desk.addEventListener('dragleave', () => desk.classList.remove('drop-on'));
  desk.addEventListener('drop', e => {
    desk.classList.remove('drop-on');
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    onInsertFiles(e.dataTransfer.files);
  });

  // 様式登録のファイル選択
  const drop = $id('regDrop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('on'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('on'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('on'); onRegFile(e.dataTransfer.files[0]); });
  $id('regFileInput').addEventListener('change', function () { const f = this.files[0]; this.value = ''; onRegFile(f); });
}
