'use strict';
/* SOLID お知らせ（B案：左に一覧・右に本文。画像と資料つき）
   読むのは SOLID の全員。書く・直す・消す・既読の人の一覧は社内管理者だけ
   （画面で隠すだけでなく API が 403 を返す。判定は User::isInternalAdmin）。

   - 本文を開いた時点で API 側で既読になる（GET /solid/announcements/{id}）
   - 赤丸の数の表示は auth.js の solidNewsSetCount() に集約している（サイドバー・ベル・メニューボタン）
   - 画像・資料の実体は /files/{id}/view。本番は R2 の署名URL（15分）を JSON で返し、
     ローカルは本体をそのまま返すので両方に対応する
   - 資料のプレビューは既存の viewer.html（?ann_file_id=）で開く。動画は受け付けない */

const user = requireSpaceAuth();
if (!user) throw new Error('未認証');
renderSidebarUser(user);
if (isAdmin(user)) {
  document.getElementById('adminLink').style.display = '';
}
initMobileMenu();

const BASE = '/solid/announcements';
const CAT = {
  important: ['重要', 'fa-circle-exclamation'],
  feature:   ['機能追加', 'fa-wand-magic-sparkles'],
  maint:     ['メンテナンス', 'fa-screwdriver-wrench'],
  info:      ['お知らせ', 'fa-circle-info'],
};
const CAT_STYLE = {
  important: 'background:#ffe3e3;color:#c92a2a',
  feature:   'background:#e3f2ff;color:#0a6fc2',
  maint:     'background:#fff3d6;color:#b26a00',
  info:      'background:#e6f7f1;color:#0b8a66',
};
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const VIDEO_EXTS = ['mp4', 'mov', 'm4v', 'avi', 'wmv', 'mkv', 'webm', 'flv', 'mpg', 'mpeg', '3gp'];
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 20;
/* viewer.html で開ける形式（viewer.html の OFFICE_KIND と揃える） */
const PREVIEW_EXTS = ['pdf', 'dxf', 'dwg', 'stl', 'stp', 'step',
  'xlsx', 'xlsm', 'xls', 'csv', 'docx', 'docm', 'doc', 'pptx', 'pptm', 'ppt'];

let ITEMS = [];
let CAN_WRITE = false;
let filter = 'all';
let selId = null;
let current = null;      // 開いているお知らせ（本文・添付つき）
let loadedOnce = false;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const extOf = n => (String(n).split('.').pop() || '').toLowerCase();
const fmtDate = s => (s ? s.slice(0, 10).replace(/-/g, '.') : '');
const fmtSize = b => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const catTag = c => {
  const k = CAT[c] ? c : 'info';
  return `<span class="an-cat" style="${CAT_STYLE[k]}"><i class="fa-solid ${CAT[k][1]}"></i>${CAT[k][0]}</span>`;
};
const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

function showToast(msg, type = '') {
  const c = $('toastContainer');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast${type ? ' toast-' + type : ''}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function fileIcon(name) {
  const e = extOf(name);
  if (e === 'pdf') return ['fa-file-pdf', 'f-pdf', 'PDF'];
  if (['xlsx', 'xlsm', 'xls', 'csv'].includes(e)) return ['fa-file-excel', 'f-xls', e.toUpperCase()];
  if (['docx', 'docm', 'doc'].includes(e)) return ['fa-file-word', 'f-doc', e.toUpperCase()];
  if (['pptx', 'pptm', 'ppt'].includes(e)) return ['fa-file-powerpoint', 'f-ppt', e.toUpperCase()];
  if (['stl', 'stp', 'step'].includes(e)) return ['fa-cube', 'f-3d', e.toUpperCase()];
  if (['dxf', 'dwg'].includes(e)) return ['fa-compass-drafting', 'f-cad', e.toUpperCase()];
  if (['zip', '7z', 'rar', 'lzh'].includes(e)) return ['fa-file-zipper', 'f-zip', e.toUpperCase()];
  if (IMAGE_EXTS.includes(e)) return ['fa-image', 'f-img', e.toUpperCase()];
  return ['fa-file', 'f-etc', (e || 'FILE').toUpperCase().slice(0, 4)];
}

/* 本文：エスケープ → URL をリンクに → 空行で段落・改行は <br> */
function renderBody(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  return t.split(/\n{2,}/).map(p => {
    const h = esc(p).replace(/https?:\/\/[^\s<>"']+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
    return `<p>${h.replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

/* ───────── 添付の実体（署名URL か Blob URL） ───────── */
const srcCache = new Map();   // id -> { p: Promise<string>, t: 取得時刻 }
async function fetchView(id, kind = 'view') {
  const token = sessionStorage.getItem('space_token');
  const r = await fetch(`${API_BASE}${BASE}/files/${id}/${kind}`, {
    headers: { 'Accept': '*/*', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
  });
  if (r.status === 401) { spaceLogout(); throw new Error('ログインし直してください'); }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const ct = r.headers.get('Content-Type') || '';
  if (ct.includes('application/json')) {
    const d = await r.json();
    if (!d.url) throw new Error('URL を取得できませんでした');
    return { url: d.url };
  }
  return { blob: await r.blob() };
}
function fileSrc(id) {
  const hit = srcCache.get(id);
  // 署名URLは15分で切れるので10分で取り直す（Blob URL は切れない）
  if (hit && (hit.blob || Date.now() - hit.t < 10 * 60 * 1000)) return hit.p;
  const entry = { t: Date.now(), blob: false };
  entry.p = fetchView(id).then(r => {
    if (r.blob) { entry.blob = true; return URL.createObjectURL(r.blob); }
    return r.url;
  });
  entry.p.catch(() => srcCache.delete(id));
  srcCache.set(id, entry);
  return entry.p;
}
function fillImages(root) {
  root.querySelectorAll('img[data-fid]').forEach(img => {
    fileSrc(Number(img.dataset.fid)).then(u => { img.src = u; }).catch(() => {
      img.replaceWith(Object.assign(document.createElement('i'), { className: 'fa-regular fa-image' }));
    });
  });
}

async function downloadFile(f) {
  try {
    const r = await fetchView(f.id, 'download');
    const a = document.createElement('a');
    if (r.url) {
      a.href = r.url;            // 署名URLに attachment を付けてあるので、そのまま保存になる
    } else {
      a.href = URL.createObjectURL(r.blob);
      a.download = f.file_name;
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    showToast('ダウンロードできませんでした: ' + e.message, 'error');
  }
}

/* ───────── 一覧 ───────── */
async function load() {
  try {
    const d = await api.get(BASE);
    if (!d) return;
    ITEMS = d.items || [];
    CAN_WRITE = !!d.can_write;
    $('btnCompose').style.display = CAN_WRITE ? '' : 'none';
    solidNewsSetCount(d.unread_count);
    loadedOnce = true;
    renderList();
  } catch (e) {
    // 通信に失敗しても前回取得分は残す（MOCK 等に差し替えない）
    if (!loadedOnce) $('anList').innerHTML = `<div class="an-empty">読み込めませんでした。<br>${esc(e.message)}</div>`;
    showToast('お知らせを読み込めませんでした: ' + e.message, 'error');
  }
}

function renderList() {
  const counts = {
    all: ITEMS.length,
    unread: ITEMS.filter(x => x.unread).length,
    important: ITEMS.filter(x => x.category === 'important').length,
    feature: ITEMS.filter(x => x.category === 'feature').length,
    maint: ITEMS.filter(x => x.category === 'maint').length,
  };
  const chips = [['all', 'すべて'], ['unread', '未読'], ['important', '重要'], ['feature', '機能追加'], ['maint', 'メンテ']];
  if (CAN_WRITE && ITEMS.some(x => x.is_draft)) chips.push(['draft', '下書き']);
  counts.draft = ITEMS.filter(x => x.is_draft).length;
  $('anChips').innerHTML = chips.map(([k, l]) =>
    `<button type="button" class="an-chip${filter === k ? ' on' : ''}" data-f="${k}">${l}<span class="n${k === 'unread' && counts[k] ? ' r' : ''}">${counts[k]}</span></button>`).join('');

  const list = ITEMS.filter(x => {
    if (filter === 'all') return true;
    if (filter === 'unread') return x.unread;
    if (filter === 'draft') return x.is_draft;
    return x.category === filter;
  });

  $('anList').innerHTML = list.length ? list.map(x => `
    <button type="button" class="an-li${x.unread ? ' unread' : ''}${selId === x.id ? ' sel' : ''}" data-id="${x.id}">
      <span class="an-thumb">${x.cover_file_id ? `<img data-fid="${x.cover_file_id}" alt="">` : `<i class="fa-solid ${x.file_count ? 'fa-paperclip' : (CAT[x.category] || CAT.info)[1]}"></i>`}</span>
      <span class="an-li-tx">
        <span class="an-li-l1">${catTag(x.category)}${x.is_draft ? '<span class="an-cat an-draft">下書き</span>' : ''}${x.pinned ? '<i class="fa-solid fa-thumbtack an-pin"></i>' : ''}<span class="sp"></span>${x.unread ? '<span class="an-dot"></span>' : ''}</span>
        <span class="an-li-tt">${esc(x.title)}</span>
        <span class="an-li-l3"><span class="an-date">${x.is_draft ? '未公開' : fmtDate(x.published_at)}</span>${x.image_count ? `<span><i class="fa-regular fa-image"></i>${x.image_count}</span>` : ''}${x.file_count ? `<span><i class="fa-solid fa-paperclip"></i>${x.file_count}</span>` : ''}</span>
      </span>
    </button>`).join('')
    : `<div class="an-empty">${filter === 'all' ? 'お知らせはまだありません' : '該当するお知らせはありません'}</div>`;
  fillImages($('anList'));

  if (!selId && !isMobile()) renderEmptyDetail();
}

function renderEmptyDetail() {
  $('anDetail').innerHTML = `<div class="an-empty" style="height:100%;display:grid;place-items:center;"><div>
    <i class="fa-regular fa-envelope-open" style="font-size:34px;display:block;margin-bottom:10px;color:#cfd4d8"></i>
    左のお知らせを選ぶと<br>本文・画像・資料が表示されます</div></div>`;
}

/* ───────── 本文 ───────── */
async function openItem(id, { push = true } = {}) {
  selId = id;
  $('anSplit').classList.add('show-detail');
  document.querySelectorAll('.an-li').forEach(b => b.classList.toggle('sel', Number(b.dataset.id) === id));
  if (push) history.replaceState(null, '', `?id=${id}`);
  $('anDetail').innerHTML = '<div class="an-empty"><i class="fa-solid fa-spinner fa-spin"></i> 読み込み中…</div>';
  $('anDetail').scrollTop = 0;
  try {
    const d = await api.get(`${BASE}/${id}`);
    if (!d || selId !== id) return;
    current = d.item;
    solidNewsSetCount(d.unread_count);
    const li = ITEMS.find(x => x.id === id);
    if (li && li.unread) { li.unread = false; renderList(); }
    renderDetail();
  } catch (e) {
    if (selId !== id) return;
    $('anDetail').innerHTML = `<button type="button" class="btn btn-outline btn-sm an-back" data-back><i class="fa-solid fa-chevron-left"></i> 一覧</button>
      <div class="an-empty">${/404/.test(e.message) ? 'このお知らせは見つかりませんでした（削除された可能性があります）' : '読み込めませんでした: ' + esc(e.message)}</div>`;
  }
}
window.solidNewsOpen = id => openItem(id);
window.solidNewsReload = () => load();

function renderDetail() {
  const a = current;
  const imgs = a.files.filter(f => f.kind === 'image');
  const docs = a.files.filter(f => f.kind !== 'image');
  const stats = a.read_stats;

  $('anDetail').innerHTML = `
    <button type="button" class="btn btn-outline btn-sm an-back" data-back><i class="fa-solid fa-chevron-left"></i> 一覧</button>
    <div>${catTag(a.category)} ${a.is_draft ? '<span class="an-cat an-draft">下書き（まだ公開していません）</span>' : ''} ${a.pinned ? '<i class="fa-solid fa-thumbtack an-pin" title="固定"></i>' : ''}</div>
    <h2>${esc(a.title)}</h2>
    <div class="an-by">
      <span class="an-av">${esc((a.author || '?').charAt(0))}</span>${esc(a.author || '')}
      <span class="an-date">${a.is_draft ? '' : fmtDate(a.published_at)}</span>
      ${CAN_WRITE ? `<span class="sp"></span><span class="an-only">社内管理者のみ</span>
        <button type="button" class="btn btn-outline btn-sm" id="anEdit"><i class="fa-solid fa-pen"></i> 編集</button>
        ${stats ? `<span class="an-readers-wrap"><button type="button" class="btn btn-outline btn-sm" id="anReadersBtn"><i class="fa-solid fa-eye"></i> 既読 ${stats.read}/${stats.total}人</button><div id="anReaders"></div></span>` : ''}` : ''}
    </div>
    ${imgs[0] ? `<button type="button" class="an-hero" data-lb="0"><img data-fid="${imgs[0].id}" alt="${esc(imgs[0].file_name)}"></button>` : ''}
    <div class="an-text">${renderBody(a.body)}</div>
    ${imgs.length > 1 ? `<div class="an-sec"><i class="fa-regular fa-images"></i> 画像 <small>${imgs.length}枚・押すと拡大</small></div>
      <div class="an-gal">${imgs.map((f, i) => `<button type="button" data-lb="${i}" title="${esc(f.file_name)}"><img data-fid="${f.id}" alt=""></button>`).join('')}</div>` : ''}
    ${docs.length ? `<div class="an-sec"><i class="fa-solid fa-paperclip"></i> 資料 <small>${docs.length}件</small><span class="sp"></span>
        ${docs.length > 1 ? '<button type="button" class="an-link-btn" id="anDlAll"><i class="fa-solid fa-download"></i> まとめてダウンロード</button>' : ''}</div>
      <div class="an-files">${docs.map(f => {
        const [ic, cls, lbl] = fileIcon(f.file_name);
        const canPv = PREVIEW_EXTS.includes(extOf(f.file_name));
        return `<div class="an-file">
          <span class="an-fi ${cls}"><i class="fa-solid ${ic}"></i>${cls === 'f-pdf' ? '' : `<small>${esc(lbl)}</small>`}</span>
          <span class="an-fn"><b title="${esc(f.file_name)}">${esc(f.file_name)}</b><small>${fmtSize(f.file_size)}</small></span>
          <span class="an-acts">${canPv ? `<button type="button" title="プレビュー" data-pv="${f.id}"><i class="fa-solid fa-eye"></i></button>` : ''}<button type="button" title="ダウンロード" data-dl="${f.id}"><i class="fa-solid fa-download"></i></button></span>
        </div>`;
      }).join('')}</div>` : ''}`;
  fillImages($('anDetail'));

  const edit = $('anEdit');
  if (edit) edit.onclick = () => openCompose(current);
  const rb = $('anReadersBtn');
  if (rb) rb.onclick = e => { e.stopPropagation(); toggleReaders(); };
  const all = $('anDlAll');
  if (all) all.onclick = async () => {
    for (const f of docs) { await downloadFile(f); await new Promise(r => setTimeout(r, 700)); }
  };
}

async function toggleReaders() {
  const box = $('anReaders');
  if (!box) return;
  if (box.innerHTML) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="an-readers"><div class="an-empty"><i class="fa-solid fa-spinner fa-spin"></i></div></div>';
  try {
    const d = await api.get(`${BASE}/${current.id}/readers`);
    box.innerHTML = `<div class="an-readers">
      <div class="an-rd-h">既読 ${d.read}/${d.total}人<span class="sp"></span><button type="button" data-rdclose><i class="fa-solid fa-xmark"></i></button></div>
      <div class="an-rd-b">${d.groups.map(g => {
        const n = g.users.filter(u => u.read).length;
        return `<div class="an-rd-co"><b>${esc(g.company)}</b><small>${n}/${g.users.length}</small>
          <div>${g.users.map(u => `<span class="an-rd-p${u.read ? ' on' : ''}" title="${u.read ? esc(u.read_at) + ' に既読' : 'まだ読んでいません'}">${u.read ? '<i class="fa-solid fa-check"></i>' : ''}${esc(u.name)}</span>`).join('')}</div></div>`;
      }).join('') || '<div class="an-empty">対象者がいません</div>'}</div>
      <div class="an-rd-f"><i class="fa-solid fa-lock"></i> 社内管理者だけに表示しています</div></div>`;
  } catch (e) {
    box.innerHTML = `<div class="an-readers"><div class="an-empty">読み込めませんでした: ${esc(e.message)}</div></div>`;
  }
}

/* ───────── 画像の拡大 ───────── */
let lbIdx = 0;
function lbImages() { return current ? current.files.filter(f => f.kind === 'image') : []; }
function openLb(i) {
  const imgs = lbImages();
  if (!imgs.length) return;
  lbIdx = (i + imgs.length) % imgs.length;
  const f = imgs[lbIdx];
  $('anLb').hidden = false;
  $('anLbName').textContent = f.file_name;
  $('anLbCnt').textContent = `${lbIdx + 1} / ${imgs.length}`;
  $('anLbPrev').style.display = $('anLbNext').style.display = imgs.length > 1 ? '' : 'none';
  const img = $('anLbImg');
  img.removeAttribute('src');
  fileSrc(f.id).then(u => { if (lbImages()[lbIdx]?.id === f.id) img.src = u; }).catch(() => {});
}
function closeLb() { $('anLb').hidden = true; }
$('anLbClose').onclick = closeLb;
$('anLbPrev').onclick = () => openLb(lbIdx - 1);
$('anLbNext').onclick = () => openLb(lbIdx + 1);
$('anLbDl').onclick = () => { const f = lbImages()[lbIdx]; if (f) downloadFile(f); };
$('anLb').addEventListener('click', e => { if (e.target.classList.contains('an-lb-stage')) closeLb(); });
let touchX = null;
$('anLb').addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
$('anLb').addEventListener('touchend', e => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 50) openLb(lbIdx + (dx < 0 ? 1 : -1));
});
document.addEventListener('keydown', e => {
  if ($('anLb').hidden) return;
  if (e.key === 'Escape') closeLb();
  if (e.key === 'ArrowLeft') openLb(lbIdx - 1);
  if (e.key === 'ArrowRight') openLb(lbIdx + 1);
});

/* ───────── 画面のクリック ───────── */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-f],[data-id],[data-back],[data-lb],[data-pv],[data-dl],[data-rdclose]');
  if (!t) {
    const box = $('anReaders');
    if (box && box.innerHTML && !e.target.closest('.an-readers-wrap')) box.innerHTML = '';
    return;
  }
  if (t.dataset.f) { filter = t.dataset.f; renderList(); }
  else if (t.dataset.id && t.closest('#anList')) openItem(Number(t.dataset.id));
  else if (t.hasAttribute('data-back')) {
    $('anSplit').classList.remove('show-detail');
    selId = null; current = null;
    history.replaceState(null, '', location.pathname);
    renderList();
  }
  else if (t.dataset.lb !== undefined) openLb(Number(t.dataset.lb));
  else if (t.dataset.pv) {
    const f = current?.files.find(x => x.id === Number(t.dataset.pv));
    if (f) window.open(`viewer.html?ann_file_id=${f.id}&file_name=${encodeURIComponent(f.file_name)}`, '_blank', 'noopener');
  }
  else if (t.dataset.dl) {
    const f = current?.files.find(x => x.id === Number(t.dataset.dl));
    if (f) downloadFile(f);
  }
  else if (t.hasAttribute('data-rdclose')) $('anReaders').innerHTML = '';
});

/* ───────── 書く・直す（社内管理者） ───────── */
let editing = null;      // 直しているお知らせ（null = 新規）
let existing = [];       // 保存済みの添付 [{id, kind, file_name, file_size}]（並び順＝表示順）
let removed = new Set(); // 消す予定の保存済み添付の id
let pending = [];        // これから送るファイル [{key, file, kind, url}]
let orderChanged = false;
let saving = false;

function openCompose(item) {
  editing = item || null;
  existing = item ? item.files.map(f => ({ ...f })) : [];
  removed = new Set();
  pending.forEach(p => p.url && URL.revokeObjectURL(p.url));
  pending = [];
  orderChanged = false;
  $('cmTitle').textContent = item ? 'お知らせを直す' : 'お知らせを書く';
  $('cmName').value = item ? item.title : '';
  $('cmCat').value = item ? item.category : 'info';
  $('cmPin').checked = item ? !!item.pinned : false;
  $('cmBody').value = item ? (item.body || '') : '';
  $('cmNotify').checked = false;
  $('cmStatus').textContent = '';
  const published = item && !item.is_draft;
  $('cmDelete').style.display = item ? '' : 'none';
  $('cmUnpublish').style.display = published ? '' : 'none';
  $('cmNotifyWrap').style.display = published ? '' : 'none';
  $('cmNote').style.display = published ? 'none' : '';
  $('cmDraft').style.display = published ? 'none' : '';
  $('cmSave').innerHTML = published ? '<i class="fa-solid fa-check"></i> 保存' : '<i class="fa-solid fa-paper-plane"></i> 公開する';
  renderUploads();
  $('anCompose').hidden = false;
  setTimeout(() => $('cmName').focus(), 50);
}
function closeCompose() {
  if (saving) return;
  $('anCompose').hidden = true;
}

function attachCount() { return existing.filter(f => !removed.has(f.id)).length + pending.length; }

function addFiles(list) {
  const rejected = [];
  for (const file of list) {
    const e = extOf(file.name);
    if (VIDEO_EXTS.includes(e) || (file.type || '').startsWith('video/')) { rejected.push(`${file.name}（動画は添付できません）`); continue; }
    if (file.size > MAX_BYTES) { rejected.push(`${file.name}（50MB を超えています）`); continue; }
    if (attachCount() >= MAX_FILES) { rejected.push(`${file.name}（20ファイルまでです）`); continue; }
    const isImg = IMAGE_EXTS.includes(e) && (file.type || '').startsWith('image/');
    pending.push({ key: Math.random().toString(36).slice(2), file, kind: isImg ? 'image' : 'file', url: isImg ? URL.createObjectURL(file) : null });
  }
  if (rejected.length) showToast('追加できなかったファイル: ' + rejected.join('、'), 'error');
  renderUploads();
}

function renderUploads() {
  const ex = existing.filter(f => !removed.has(f.id));
  const firstImgId = ex.find(f => f.kind === 'image')?.id;
  const exHtml = ex.map(f => {
    if (f.kind === 'image') {
      return `<div class="an-up-img"><img data-fid="${f.id}" alt="">
        ${f.id === firstImgId ? '<span class="an-up-cover">先頭</span>' : `<button type="button" class="an-up-first" data-first="${f.id}" title="本文の上と一覧に出す画像にする">先頭にする</button>`}
        <button type="button" class="an-up-x" data-rmex="${f.id}" title="外す"><i class="fa-solid fa-xmark"></i></button></div>`;
    }
    const [ic, cls] = fileIcon(f.file_name);
    return `<div class="an-up-f"><span class="an-fi ${cls}"><i class="fa-solid ${ic}"></i></span>
      <span><span class="nm" title="${esc(f.file_name)}">${esc(f.file_name)}</span><small>${fmtSize(f.file_size)}</small></span>
      <button type="button" class="an-up-x" data-rmex="${f.id}" title="外す"><i class="fa-solid fa-xmark"></i></button></div>`;
  }).join('');
  const pendHtml = pending.map(p => {
    const state = p.state === 'up' ? '<span class="an-up-state"><i class="fa-solid fa-spinner fa-spin"></i></span>' : '';
    if (p.kind === 'image') {
      return `<div class="an-up-img an-up-new"><img src="${p.url}" alt="">${!ex.some(f => f.kind === 'image') && pending.find(q => q.kind === 'image') === p ? '<span class="an-up-cover">先頭</span>' : ''}
        <button type="button" class="an-up-x" data-rmnew="${p.key}" title="外す"><i class="fa-solid fa-xmark"></i></button>${state}</div>`;
    }
    const [ic, cls] = fileIcon(p.file.name);
    return `<div class="an-up-f an-up-new"><span class="an-fi ${cls}"><i class="fa-solid ${ic}"></i></span>
      <span><span class="nm" title="${esc(p.file.name)}">${esc(p.file.name)}</span><small>${fmtSize(p.file.size)}・未送信</small></span>
      <button type="button" class="an-up-x" data-rmnew="${p.key}" title="外す"><i class="fa-solid fa-xmark"></i></button>${state}</div>`;
  }).join('');
  $('cmUp').innerHTML = exHtml + pendHtml;
  fillImages($('cmUp'));
}

$('cmUp').addEventListener('click', e => {
  if (saving) return;
  const t = e.target.closest('[data-rmex],[data-rmnew],[data-first]');
  if (!t) return;
  if (t.dataset.rmex) removed.add(Number(t.dataset.rmex));
  else if (t.dataset.rmnew) {
    const p = pending.find(x => x.key === t.dataset.rmnew);
    if (p?.url) URL.revokeObjectURL(p.url);
    pending = pending.filter(x => x.key !== t.dataset.rmnew);
  } else if (t.dataset.first) {
    const id = Number(t.dataset.first);
    const i = existing.findIndex(f => f.id === id);
    if (i > 0) { existing.unshift(...existing.splice(i, 1)); orderChanged = true; }
  }
  renderUploads();
});

const drop = $('cmDrop');
drop.addEventListener('click', () => $('cmFile').click());
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('cmFile').click(); } });
$('cmFile').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => addFiles([...(e.dataTransfer?.files || [])]));
$('cmBody').addEventListener('paste', e => {
  // 画面のコピー（スクリーンショット）を本文欄に貼ったら画像として追加する
  const files = [...(e.clipboardData?.files || [])].filter(f => (f.type || '').startsWith('image/'));
  if (files.length) { e.preventDefault(); addFiles(files.map((f, i) => new File([f], f.name && f.name !== 'image.png' ? f.name : `貼り付け画像${i + 1}.png`, { type: f.type }))); }
});

$('anCompose').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeCompose(); });
$('cmForm').addEventListener('submit', e => e.preventDefault());
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('anCompose').hidden && $('anLb').hidden) closeCompose(); });
$('btnCompose').onclick = () => openCompose(null);

function setBusy(on, msg = '') {
  saving = on;
  ['cmSave', 'cmDraft', 'cmDelete', 'cmUnpublish'].forEach(id => { $(id).disabled = on; });
  $('cmStatus').textContent = msg;
}

/* 保存の流れ：本文を保存 → 外した添付を消す → 新しい添付を1件ずつ送る → 並びを保存 → 公開。
   途中で失敗したら、作ったお知らせは下書きのまま残し、同じ画面からやり直せるようにする
   （新規でも2回目は「直す」になるので二重に作られない） */
async function save(mode) {   // mode: 'publish' | 'draft' | 'update'
  if (saving) return;
  const title = $('cmName').value.trim();
  if (!title) { showToast('タイトルを入れてください', 'error'); $('cmName').focus(); return; }
  const payload = { title, category: $('cmCat').value, pinned: $('cmPin').checked, body: $('cmBody').value };

  setBusy(true, '保存中…');
  try {
    let id;
    if (editing) {
      await api.patch(`${BASE}/${editing.id}`, payload);
      id = editing.id;
    } else {
      const d = await api.post(BASE, payload);
      id = d.item.id;
      editing = { ...d.item, files: [] };   // 以降の失敗→やり直しは「直す」扱い
    }

    for (const fid of [...removed]) {
      await api.delete(`${BASE}/files/${fid}`);
      existing = existing.filter(f => f.id !== fid);
      removed.delete(fid);
    }

    const total = pending.length;
    let n = 0;
    while (pending.length) {
      const p = pending[0];
      n++;
      p.state = 'up';
      renderUploads();
      setBusy(true, `送信中 ${n}/${total}：${p.file.name}`);
      const fd = new FormData();
      fd.append('file', p.file, p.file.name);
      const r = await apiFetchForm(`${BASE}/${id}/files`, fd);
      existing.push(r.file);
      if (p.url) URL.revokeObjectURL(p.url);
      pending.shift();
      renderUploads();
    }

    if (orderChanged) {
      await api.put(`${BASE}/${id}/files/order`, { ids: existing.map(f => f.id) });
      orderChanged = false;
    }

    if (mode === 'publish') await api.post(`${BASE}/${id}/publish`, {});
    if (mode === 'update' && $('cmNotify').checked) await api.post(`${BASE}/${id}/publish`, { notify: true });

    setBusy(false);
    $('anCompose').hidden = true;
    showToast(mode === 'publish' ? '公開しました' : mode === 'draft' ? '下書きを保存しました' : '保存しました', 'success');
    await load();
    openItem(id);
  } catch (e) {
    pending.forEach(p => { p.state = null; });
    renderUploads();
    setBusy(false);
    showToast('保存できませんでした: ' + e.message + (editing ? '（ここまでの内容は下書きとして残っています）' : ''), 'error');
    if (editing) {
      $('cmDelete').style.display = '';
      load();
    }
  }
}
$('cmSave').onclick = () => save(editing && !editing.is_draft ? 'update' : 'publish');
$('cmDraft').onclick = () => save('draft');

$('cmDelete').onclick = async () => {
  if (!editing || saving) return;
  if (!confirm(`「${editing.title}」を削除します。画像・資料も消え、元に戻せません。よろしいですか？`)) return;
  setBusy(true, '削除中…');
  try {
    await api.delete(`${BASE}/${editing.id}`);
    setBusy(false);
    $('anCompose').hidden = true;
    selId = null; current = null;
    history.replaceState(null, '', location.pathname);
    $('anSplit').classList.remove('show-detail');
    showToast('削除しました', 'success');
    await load();
  } catch (e) {
    setBusy(false);
    showToast('削除できませんでした: ' + e.message, 'error');
  }
};

$('cmUnpublish').onclick = async () => {
  if (!editing || saving) return;
  if (!confirm('公開をやめて下書きに戻します。社内管理者以外からは見えなくなります。よろしいですか？')) return;
  setBusy(true, '処理中…');
  try {
    await api.post(`${BASE}/${editing.id}/unpublish`, {});
    setBusy(false);
    $('anCompose').hidden = true;
    showToast('下書きに戻しました', 'success');
    await load();
    openItem(editing.id);
  } catch (e) {
    setBusy(false);
    showToast('できませんでした: ' + e.message, 'error');
  }
};

window.addEventListener('beforeunload', e => { if (saving) { e.preventDefault(); e.returnValue = ''; } });

/* ───────── 起動 ───────── */
(async () => {
  await load();
  const q = Number(new URLSearchParams(location.search).get('id'));
  if (q) openItem(q, { push: false });
})();
