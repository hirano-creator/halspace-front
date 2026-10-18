'use strict';
/* What'sNo 一覧画面: フォルダー・ピン留め・種類チップ・日付の見出し・項目メニュー・スマホ操作

   wn-dashboard.js の後に読み込む。状態（allFiles / navView / selectMode など）は
   wn-dashboard.js のものをそのまま使い、こちらは差し込み口（wnLoadTopZone など）から呼ばれる。

   フォルダー = 置き場所（ファイルは1つにだけ入る）。タグ = 横断の目印（いくつでも）。
   ピン = 一覧のいちばん上に固定。me=自分用 / all=全員用（管理者のみ）。 */

/* ── 種類チップ（API の FILE_KINDS とキーをそろえる） ── */
const WN_KINDS = [
  { k: 'all',    l: 'すべて',     i: 'fa-border-all' },
  { k: 'pdf',    l: 'PDF',        i: 'fa-file-pdf' },
  { k: 'cad',    l: '図面・CAD',  i: 'fa-compass-drafting' },
  { k: 'image',  l: '写真・画像', i: 'fa-image' },
  { k: 'video',  l: '動画',       i: 'fa-film' },
  { k: 'office', l: 'Office',     i: 'fa-file-lines' },
  { k: 'other',  l: 'その他',     i: 'fa-file' },
];
const WN_KIND_EXTS = {
  pdf:    ['pdf'],
  cad:    ['dxf', 'dwg', 'stp', 'step', 'igs', 'iges', 'stl', 'obj', 'prc', '3dm', 'sldprt', 'sldasm', 'x_t', 'ipt', 'iam', 'catpart'],
  image:  ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'svg'],
  video:  ['mp4', 'mov', 'avi', 'webm', 'm4v', 'mkv'],
  office: ['xlsx', 'xls', 'xlsm', 'csv', 'docx', 'doc', 'docm', 'pptx', 'ppt', 'pptm'],
};

let wnKind          = 'all';
let wnKindCounts    = null;   // { pdf: 12, image: 40, ... }（1ページ目の応答で更新）
let wnCurrentFolder = null;   // { id, name, path?, can_edit?, visibility? }
let wnFolders       = [];     // 今いる階層のフォルダー
let wnPins          = [];     // ピン一覧（サーバーの /wn/pins）
let wnInternalDrag  = false;  // 一覧内のカードをドラッグ中（画面全体のアップロード受けと区別する）
let wnSuppressClick = false;  // 長押しでメニューを開いた直後のクリックを無視する
let wnDateHeadLast  = { grid: null, list: null };

/* ────────────────────────────────
   小さな表示部品
   ──────────────────────────────── */
function wnRelativeDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const now = new Date();
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff <= 0) return '今日';
  if (diff === 1) return '昨日';
  if (diff < 7) return `${diff}日前`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function wnKindOfExt(ext) {
  ext = String(ext || '').toLowerCase();
  return Object.keys(WN_KIND_EXTS).find(k => WN_KIND_EXTS[k].includes(ext)) || 'other';
}
function wnKindColor(ext) {
  ext = String(ext || '').toLowerCase();
  if (['xlsx', 'xls', 'xlsm', 'csv'].includes(ext)) return '#2E7D32';
  if (['docx', 'doc', 'docm'].includes(ext)) return '#1565C0';
  if (['pptx', 'ppt', 'pptm'].includes(ext)) return '#D35400';
  return { pdf: '#E53935', cad: '#2563EB', image: '#D97706', video: '#7C3AED' }[wnKindOfExt(ext)] || '#607D8B';
}

const WN_AVATAR_COLORS = ['#6366F1', '#0EA5E9', '#F43F5E', '#10B981', '#F59E0B', '#8B5CF6', '#14B8A6', '#EC4899'];
function wnAvatarColor(name) {
  let n = 0;
  for (const ch of String(name)) n = (n * 31 + ch.codePointAt(0)) >>> 0;
  return WN_AVATAR_COLORS[n % WN_AVATAR_COLORS.length];
}

/* PCのマウス操作のときだけカードをドラッグ可能にする（スマホは長押しメニューと競合する） */
function wnCanDragCards() {
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function wnIsNarrow() { return window.innerWidth <= 767; }

function wnAdmin() { return typeof isAdmin === 'function' && isAdmin(currentUser); }

/* サーバー保存のサムネイル。無いもの（未生成のPDF等）はアイコンに差し替える */
function wnThumbFallback(img) {
  const ext = img.dataset.ext || '';
  const { icon, cls } = wnFileIcon('x.' + ext, '');
  const i = document.createElement('i');
  i.className = `fa-solid ${icon} ${cls} wn-mini-icon`;
  img.replaceWith(i);
}
function wnMiniThumbHtml(file) {
  const ext = (file.file_name || '').split('.').pop().toLowerCase();
  return `<img src="${h(wnThumbUrl(file.id, file.updated_at))}" alt="" loading="lazy" decoding="async"
    data-ext="${h(ext)}" onerror="wnThumbFallback(this)">`;
}

/* ────────────────────────────────
   状態（URL ?view=&folder= と同期。ブラウザの戻るで1つ上へ戻れる）
   ──────────────────────────────── */
function wnFoldersInitState() {
  const q = new URLSearchParams(location.search);
  const view = q.get('view');
  if ((view === 'mine' || view === 'company') && navView !== 'all') navView = view;
  const fid = parseInt(q.get('folder') || '', 10);
  if (fid > 0 && navView !== 'all') wnCurrentFolder = { id: fid, name: '' };
}

function wnFolderUrl() {
  const q = new URLSearchParams(location.search);
  q.delete('folder'); q.delete('view');
  if (wnCurrentFolder) { q.set('view', navView); q.set('folder', wnCurrentFolder.id); }
  const s = q.toString();
  return location.pathname + (s ? '?' + s : '');
}

/* マイファイル / 社内共有のいちばん上を見ている（検索・タグ絞り込みをしていない）か */
function wnFolderViewActive() {
  const search = document.getElementById('searchInput')?.value.trim();
  return (navView === 'mine' || navView === 'company') && !search && !selectedTags.length;
}
function wnSearching() { return !!document.getElementById('searchInput')?.value.trim(); }

function wnSetNavActive(view) {
  const ids = { mine: 'navMine', company: 'navCompany', recent: 'navRecent', liked: 'navLiked' };
  Object.values(ids).forEach(id => document.getElementById(id)?.classList.remove('active'));
  document.getElementById(ids[view])?.classList.add('active');
  const bn = { mine: 'bnHome', company: 'bnCompany', liked: 'bnLiked' }[view];
  if (bn && typeof setBottomActive === 'function') setBottomActive(bn);
  const labels = { mine: 'マイファイル', company: '社内共有', recent: '最近のファイル', liked: 'いいね済み' };
  const t = document.getElementById('topBarTitle');
  if (t && labels[view]) t.textContent = labels[view];
}

function wnOpenFolder(folder, { push = true } = {}) {
  if (!folder) return;
  if (selectMode) toggleSelectMode();
  wnCurrentFolder = { ...folder };
  wnKind = 'all';
  const si = document.getElementById('searchInput');
  if (si?.value) si.value = '';
  if (selectedTags.length) clearAllTags?.();
  if (push) history.pushState({ wnFolder: folder.id, view: navView }, '', wnFolderUrl());
  wnScrollListTop();
  loadFiles();
}

function wnGoRoot({ push = true } = {}) {
  if (!wnCurrentFolder) return;
  if (selectMode) toggleSelectMode();
  wnCurrentFolder = null;
  wnKind = 'all';
  if (push) history.pushState({ wnFolder: null, view: navView }, '', wnFolderUrl());
  wnScrollListTop();
  loadFiles();
}

/* サイドバー・下部タブでビューを切り替えたら、フォルダーの外へ出る */
function wnOnNavChange() {
  wnCurrentFolder = null;
  wnKind = 'all';
  history.replaceState(history.state, '', wnFolderUrl());
}

function wnScrollListTop() {
  ['gridArea', 'listArea'].forEach(id => { const el = document.getElementById(id); if (el) el.scrollTop = 0; });
  if (wnIsNarrow()) window.scrollTo({ top: 0 });
}

window.addEventListener('popstate', () => {
  const q = new URLSearchParams(location.search);
  const view = q.get('view');
  const fid = parseInt(q.get('folder') || '', 10);
  if (view === 'mine' || view === 'company') { navView = view; wnSetNavActive(view); }
  wnCurrentFolder = fid > 0 ? { id: fid, name: '' } : null;
  wnKind = 'all';
  loadFiles();
});

/* ────────────────────────────────
   読み込み（一覧の1ページ目と並行して、ピンとフォルダーを取る）
   ──────────────────────────────── */
async function wnLoadTopZone() {
  const showFolders = !wnSearching() && (wnCurrentFolder || wnFolderViewActive());
  const jobs = [];

  jobs.push(wnGetPins().then(r => { if (!r.error) wnPins = r.data || []; }));

  if (wnCurrentFolder && !wnCurrentFolder.path) {
    jobs.push(wnGetFolder(wnCurrentFolder.id).then(r => {
      if (r.error) {
        wnShowToast('フォルダーが見つかりません（削除されたか、見る権限がありません）', 'danger');
        wnCurrentFolder = null;
        history.replaceState(history.state, '', wnFolderUrl());
      } else {
        wnCurrentFolder = r.data;
      }
    }));
  }
  await Promise.all(jobs);

  wnFolders = [];
  if (showFolders && (wnCurrentFolder || wnFolderViewActive())) {
    const r = await wnGetFolders(wnCurrentFolder ? { parentId: wnCurrentFolder.id } : { scope: navView });
    if (!r.error) wnFolders = r.data || [];
  }
  wnRenderTopZone();
  wnRenderSidebarPins();
}

function wnSetKindCounts(counts) {
  if (counts) wnKindCounts = counts;
  wnRenderKindBar();
}

/* ────────────────────────────────
   上部（ピン留め・フォルダー）
   ──────────────────────────────── */
function wnPinOfFile(id)   { return wnPins.find(p => p.kind === 'file'   && String(p.file?.id)   === String(id)) || null; }
function wnPinOfFolder(id) { return wnPins.find(p => p.kind === 'folder' && String(p.folder?.id) === String(id)) || null; }
function wnPinOfKey(key) {
  const [t, id] = key.split(':');
  return t === 'f' ? wnPinOfFile(id) : wnPinOfFolder(id);
}
function wnCanUnpin(pin) {
  return pin && (pin.scope === 'me' || wnAdmin());
}

function wnEnsureTopZone() {
  let zone = document.getElementById('wnTopZone');
  if (!zone) {
    zone = document.createElement('div');
    zone.id = 'wnTopZone';
    zone.className = 'wn-top-zone';
    wnPlaceTopZone(zone);
  }
  return zone;
}

/* グリッド表示とリスト表示で、見えている方の先頭へ置く */
function wnPlaceTopZone(zone = document.getElementById('wnTopZone')) {
  if (!zone) return;
  const isList = layoutView === 'list';
  const area = document.getElementById(isList ? 'listArea' : 'gridArea');
  const anchor = document.getElementById(isList ? 'fileListRows' : 'fileGrid');
  if (area && anchor && zone.nextElementSibling !== anchor) area.insertBefore(zone, anchor);
}

function wnRenderTopZone() {
  const zone = wnEnsureTopZone();
  const showPins    = !wnCurrentFolder && wnFolderViewActive() && wnKind === 'all';
  const showFolders = !wnSearching() && wnKind === 'all' && (wnCurrentFolder || wnFolderViewActive());
  let html = '';

  if (showPins && wnPins.length) {
    html += `<div class="wn-sec-head"><i class="fa-solid fa-thumbtack" style="color:var(--wn-pin)"></i>ピン留め<small>${wnPins.length}</small></div>
      <div class="wn-pins">${wnPins.map(wnPinCardHtml).join('')}</div>`;
  }
  if (showFolders && wnFolders.length) {
    html += `<div class="wn-sec-head"><i class="fa-solid fa-folder" style="color:var(--wn-folder)"></i>フォルダー<small>${wnFolders.length}</small>
        <button type="button" class="wn-sec-act" data-wn-act="new-folder"><i class="fa-solid fa-folder-plus"></i>新しいフォルダー</button></div>
      <div class="file-grid wn-folder-grid">${wnFolders.map(wnFolderCardHtml).join('')}</div>`;
  }
  if (html && (allFiles.length || wnTotalCount)) {
    const sort = document.getElementById('sortFilter')?.value;
    if (!['newest', 'oldest'].includes(sort)) html += `<div class="wn-sec-head"><i class="fa-regular fa-file"></i>ファイル</div>`;
  }
  zone.innerHTML = html;
  zone.style.display = html ? '' : 'none';
  /* 新しいフォルダーボタン（ヘッダー）はフォルダーを置ける場所でだけ出す */
  const nb = document.getElementById('newFolderBtn');
  if (nb) nb.style.display = (!wnSearching() && (wnCurrentFolder || wnFolderViewActive())) ? '' : 'none';
}

function wnPinCardHtml(p) {
  const isDir = p.kind === 'folder';
  const o = isDir ? p.folder : p.file;
  const name = isDir ? o.name : o.file_name;
  const sub = p.scope === 'all'
    ? `<span class="wn-pin-all"><i class="fa-solid fa-bullhorn"></i>全員に</span>`
    : `<i class="fa-solid fa-thumbtack" style="color:var(--wn-pin)"></i>自分用`;
  const extra = isDir ? `${o.file_count}件` : h(wnRelativeDate(o.created_at));
  return `<div class="wn-pin" data-pin-key="${isDir ? 'd' : 'f'}:${o.id}" data-pin-id="${p.id}" title="${h(name)}">
    <div class="wn-pin-mini${isDir ? ' is-folder' : ''}">${isDir ? '<i class="fa-solid fa-folder"></i>' : wnMiniThumbHtml(o)}</div>
    <div class="wn-pin-t"><b>${h(name)}</b><small>${sub}<span>· ${extra}</span></small></div>
    ${wnCanUnpin(p) ? `<button type="button" class="wn-pin-x" data-wn-act="unpin" data-pin-id="${p.id}" title="ピン留めを外す"><i class="fa-solid fa-xmark"></i></button>` : ''}
  </div>`;
}

function wnFolderCardHtml(d) {
  const key = `d:${d.id}`;
  const pin = wnPinOfFolder(d.id);
  const prev = d.previews || [];
  const cells = [0, 1, 2, 3].map(i => prev[i]
    ? `<div class="wn-mos-cell">${wnMiniThumbHtml(prev[i])}</div>`
    : `<div class="wn-mos-cell is-empty"></div>`).join('');
  const meta = [`${d.file_count}件`];
  if (d.folder_count) meta.push(`フォルダー${d.folder_count}`);
  meta.push(`${wnRelativeDate(d.updated_at)} 更新`);
  const priv = wnIsPersonalMode() && d.visibility === 'private'
    ? '<i class="fa-solid fa-lock wn-folder-lock" title="自分だけが見られるフォルダー"></i>' : '';
  return `<div class="wn-folder-card" data-folder-id="${d.id}" data-wn-drop="${d.id}">
    <div class="wn-folder-mos${prev.length ? '' : ' is-blank'}">
      ${prev.length ? cells : '<i class="fa-solid fa-folder wn-folder-big"></i>'}
      <span class="wn-card-pin${pin ? (pin.scope === 'all' ? ' is-all' : ' is-me') : ''}" data-pin-mark="${key}"><i class="fa-solid ${pin?.scope === 'all' ? 'fa-bullhorn' : 'fa-thumbtack'}"></i></span>
      <div class="wn-card-hover">
        <button type="button" class="file-action-btn" data-wn-act="pin" data-key="${key}" title="ピン留め"><i class="fa-solid fa-thumbtack"></i></button>
        <button type="button" class="file-action-btn" data-wn-act="menu" data-key="${key}" title="その他"><i class="fa-solid fa-ellipsis"></i></button>
      </div>
    </div>
    <div class="wn-folder-body">
      <i class="fa-solid fa-folder wn-folder-ico"></i>
      <div class="wn-folder-t">
        <div class="wn-folder-name" title="${h(d.name)}">${h(d.name)}${priv}</div>
        <div class="wn-folder-meta">${h(meta.join(' · '))}</div>
      </div>
      <button type="button" class="file-action-btn wn-card-more" data-wn-act="menu" data-key="${key}" title="その他"><i class="fa-solid fa-ellipsis-vertical"></i></button>
    </div>
  </div>`;
}

/* ピンの付け外し後に、一覧に出ているカードの印だけを更新する（再取得はしない） */
function wnRefreshPinMarks() {
  document.querySelectorAll('[data-pin-mark]').forEach(el => {
    const pin = wnPinOfKey(el.dataset.pinMark);
    el.className = 'wn-card-pin' + (pin ? (pin.scope === 'all' ? ' is-all' : ' is-me') : '');
    el.title = pin ? (pin.scope === 'all' ? '全員にピン留め' : 'ピン留め中') : '';
    el.innerHTML = `<i class="fa-solid ${pin?.scope === 'all' ? 'fa-bullhorn' : 'fa-thumbtack'}"></i>`;
  });
  document.querySelectorAll('[data-wn-act="pin"]').forEach(b => b.classList.toggle('is-pinned', !!wnPinOfKey(b.dataset.key)));
}

function wnRenderSidebarPins() {
  const box = document.getElementById('wnSidebarPins');
  if (!box) return;
  const dirs = wnPins.filter(p => p.kind === 'folder');
  box.style.display = dirs.length ? '' : 'none';
  box.innerHTML = dirs.length
    ? `<div class="sidebar-nav-label" style="margin-top:16px;"><i class="fa-solid fa-thumbtack" style="color:var(--wn-pin);margin-right:4px;"></i>ピン留めしたフォルダー</div>` +
      dirs.map(p => `<a href="#" class="wn-side-pin" data-wn-act="open-folder" data-folder-id="${p.folder.id}"><i class="fa-solid fa-folder" style="color:var(--wn-folder)"></i> <span>${h(p.folder.name)}</span></a>`).join('')
    : '';
}

/* ────────────────────────────────
   種類チップ・パンくず・空表示・日付の見出し
   ──────────────────────────────── */
function wnRenderKindBar() {
  const bar = document.getElementById('wnKindBar');
  if (!bar) return;
  const c = wnKindCounts || {};
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  const chips = WN_KINDS.filter(k => k.k === 'all' || k.k === wnKind || (c[k.k] || 0) > 0);
  /* 種類が1つしかないなら絞り込む意味がないので出さない */
  if (chips.length <= 2 && wnKind === 'all') { bar.innerHTML = ''; bar.style.display = 'none'; return; }
  bar.style.display = '';
  bar.innerHTML = chips.map(k => {
    const n = k.k === 'all' ? (wnKind === 'all' ? total : '') : (c[k.k] ?? '');
    return `<button type="button" class="wn-chip${wnKind === k.k ? ' is-on' : ''}" data-wn-kind="${k.k}">
      <i class="fa-solid ${k.i}"></i>${k.l}${n !== '' ? `<small>${n}</small>` : ''}</button>`;
  }).join('');
}

function wnRenderCrumbs() {
  const title = document.getElementById('areaTitle');
  const acts  = document.getElementById('wnFolderActs');
  if (!title) return;
  if (!wnCurrentFolder || wnSearching()) {
    title.classList.remove('wn-crumbs');
    if (acts) acts.innerHTML = '';
    return;
  }
  const viewLabel = { mine: 'マイファイル', company: '社内共有' }[navView] || 'ファイル';
  const path = wnCurrentFolder.path || [{ id: wnCurrentFolder.id, name: wnCurrentFolder.name || '…' }];
  const up = path.length > 1 ? path[path.length - 2].id : '';
  title.classList.add('wn-crumbs');
  title.innerHTML =
    `<button type="button" class="wn-crumb-back" data-wn-act="go" data-folder-id="${up}" title="1つ上へ"><i class="fa-solid fa-arrow-left"></i></button>` +
    `<button type="button" class="wn-crumb" data-wn-act="go" data-folder-id="" data-wn-drop="">${h(viewLabel)}</button>` +
    path.map((p, i) => i === path.length - 1
      ? `<span class="wn-crumb-sep"><i class="fa-solid fa-chevron-right"></i></span><span class="wn-crumb-cur" title="${h(p.name)}"><i class="fa-solid fa-folder"></i><span class="wn-crumb-name">${h(p.name)}</span></span>`
      : `<span class="wn-crumb-sep"><i class="fa-solid fa-chevron-right"></i></span><button type="button" class="wn-crumb" data-wn-act="go" data-folder-id="${p.id}" data-wn-drop="${p.id}">${h(p.name)}</button>`
    ).join('');
  if (acts) {
    const key = `d:${wnCurrentFolder.id}`;
    const pin = wnPinOfFolder(wnCurrentFolder.id);
    acts.innerHTML =
      `<button type="button" class="wn-icon-btn${pin ? ' is-pinned' : ''}" data-wn-act="pin" data-key="${key}" title="${pin ? 'ピン留めを外す' : 'このフォルダーをピン留め'}"><i class="fa-solid fa-thumbtack"></i></button>` +
      `<button type="button" class="wn-icon-btn" data-wn-act="menu" data-key="${key}" title="フォルダーの操作"><i class="fa-solid fa-ellipsis"></i></button>`;
  }
}

/* 一覧が空のときの表示。フォルダーやピンが出ているなら大きな「ありません」は出さない */
function wnRenderEmpty(empty) {
  if (!empty.dataset.orig) empty.dataset.orig = empty.innerHTML;
  const zoneHasItems = !!document.getElementById('wnTopZone')?.innerHTML.trim();
  if (wnCurrentFolder && !wnFolders.length && !wnSearching() && wnKind === 'all') {
    empty.innerHTML = `<i class="fa-regular fa-folder-open fa-3x" style="opacity:.3;margin-bottom:14px;display:block;"></i>
      <p style="font-size:14px;">このフォルダーは空です</p>
      <p style="font-size:13px;margin-top:6px;">ファイルやフォルダーをドラッグ＆ドロップするか、アップロードから追加してください</p>`;
    empty.classList.remove('hidden');
    return;
  }
  empty.innerHTML = empty.dataset.orig;
  empty.classList.toggle('hidden', zoneHasItems);
}

function wnDateHeadReset() { wnDateHeadLast = { grid: null, list: null }; }

function wnDateKey(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const now = new Date();
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff <= 0) return '今日';
  if (diff === 1) return '昨日';
  if (diff < 7) return '今週';
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

/* 日付順のときだけ「今日 / 昨日 / 今週 / 9月 …」の見出しを挟む。
   無限スクロールの追加分は、直前の見出しを引き継ぐ（同じ見出しを繰り返さない） */
function wnWithDateHeads(files, rowFn, area) {
  const sort = document.getElementById('sortFilter')?.value || 'newest';
  if (!['newest', 'oldest'].includes(sort)) return files.map(rowFn).join('');
  let html = '';
  files.forEach(f => {
    const key = wnDateKey(f.created_at);
    if (key && key !== wnDateHeadLast[area]) {
      html += `<div class="wn-date-head">${h(key)}</div>`;
      wnDateHeadLast[area] = key;
    }
    html += rowFn(f);
  });
  return html;
}

function wnAfterRender() {
  wnRenderCrumbs();
  wnRenderKindBar();
}

/* ────────────────────────────────
   項目メニュー（PCはポップオーバー / スマホは下から出るシート）
   ──────────────────────────────── */
function wnFindFile(id) {
  return allFiles.find(f => String(f.id) === String(id))
    || wnPins.find(p => p.kind === 'file' && String(p.file.id) === String(id))?.file
    || null;
}
function wnFindFolder(id) {
  if (wnCurrentFolder && String(wnCurrentFolder.id) === String(id)) return wnCurrentFolder;
  return wnFolders.find(d => String(d.id) === String(id))
    || wnPins.find(p => p.kind === 'folder' && String(p.folder.id) === String(id))?.folder
    || null;
}

function wnMenuEl() {
  let menu = document.getElementById('wnItemMenu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'wnItemMenu';
    menu.className = 'wn-menu';
    menu.setAttribute('role', 'menu');
    const bd = document.createElement('div');
    bd.id = 'wnMenuBackdrop';
    bd.className = 'wn-menu-backdrop';
    bd.addEventListener('click', wnCloseMenu);
    document.body.append(bd, menu);
  }
  return menu;
}

function wnCloseMenu() {
  document.getElementById('wnItemMenu')?.classList.remove('is-open', 'as-sheet');
  document.getElementById('wnMenuBackdrop')?.classList.remove('is-open');
}

function wnShowMenu(html, anchor) {
  const menu = wnMenuEl();
  menu.innerHTML = html;
  const sheet = wnIsNarrow() || !anchor;
  menu.classList.toggle('as-sheet', sheet);
  menu.classList.add('is-open');
  document.getElementById('wnMenuBackdrop').classList.add('is-open');
  if (sheet) { menu.style.left = menu.style.top = ''; return; }
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth, hh = menu.offsetHeight;
  let left = Math.min(window.innerWidth - w - 8, Math.max(8, r.right - w));
  let top = r.bottom + 6;
  if (top + hh > window.innerHeight - 8) top = Math.max(8, r.top - hh - 6);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}

function wnMenuItem(act, icon, label, { key = '', danger = false, sub = '', extra = '' } = {}) {
  return `<button type="button" class="wn-mi${danger ? ' is-danger' : ''}" data-wn-act="${act}" data-key="${h(key)}" ${extra}>
    <i class="fa-solid ${icon}"></i><span>${label}${sub ? `<small>${sub}</small>` : ''}</span></button>`;
}

function wnPinMenuItems(key) {
  const pin = wnPinOfKey(key);
  if (pin) {
    return wnCanUnpin(pin)
      ? wnMenuItem('unpin-key', 'fa-thumbtack wn-mi-unpin', 'ピン留めを外す', { key, sub: pin.scope === 'all' ? '全員の一覧から外れます' : '' })
      : `<div class="wn-mi-note"><i class="fa-solid fa-bullhorn"></i>管理者が全員にピン留めしています</div>`;
  }
  let html = wnMenuItem('pin-me', 'fa-thumbtack', 'ピン留め', { key, sub: '自分の一覧の上に固定' });
  if (wnAdmin()) html += wnMenuItem('pin-all', 'fa-bullhorn', '全員にピン留め', { key, sub: '社内の全員の一覧に出ます' });
  return html;
}

function wnOpenItemMenu(key, anchor) {
  const [t, id] = key.split(':');
  let head = '', body = '';
  if (t === 'f') {
    const f = wnFindFile(id);
    if (!f) return;
    const canEdit = f.can_edit !== false && f.can_edit !== undefined;
    const canMail = typeof wnHasExtendedOptions !== 'function' || wnHasExtendedOptions();
    head = `<div class="wn-menu-head"><div class="wn-menu-mini">${wnMiniThumbHtml(f)}</div>
      <div><b>${h(f.file_name)}</b><small>${h(wnRelativeDate(f.created_at))}${f.uploader?.name ? ' · ' + h(f.uploader.name) : ''}</small></div></div>`;
    body = wnPinMenuItems(key) + '<hr>' +
      wnMenuItem('open', 'fa-up-right-from-square', '開く', { key }) +
      wnMenuItem('download', 'fa-download', 'ダウンロード', { key }) +
      (canMail ? wnMenuItem('email', 'fa-envelope', 'メールで送る', { key }) : '') +
      (canEdit ? wnMenuItem('move', 'fa-folder-tree', 'フォルダーへ移動', { key }) : '') +
      (canEdit ? wnMenuItem('rename', 'fa-pen', '名前を変更', { key }) : '') +
      (canEdit ? '<hr>' + wnMenuItem('delete', 'fa-trash', '削除', { key, danger: true }) : '');
  } else {
    const d = wnFindFolder(id);
    if (!d) return;
    const canEdit = !!d.can_edit;
    head = `<div class="wn-menu-head"><div class="wn-menu-mini is-folder"><i class="fa-solid fa-folder"></i></div>
      <div><b>${h(d.name)}</b><small>${d.file_count != null ? d.file_count + '件のフォルダー' : 'フォルダー'}</small></div></div>`;
    body = wnPinMenuItems(key) + '<hr>' +
      (String(wnCurrentFolder?.id) === String(id) ? '' : wnMenuItem('open-folder-key', 'fa-folder-open', '開く', { key })) +
      (canEdit ? wnMenuItem('rename', 'fa-pen', '名前を変更', { key }) : '') +
      (canEdit ? wnMenuItem('move', 'fa-folder-tree', '移動', { key }) : '') +
      (canEdit ? '<hr>' + wnMenuItem('delete', 'fa-trash', 'フォルダーを削除', { key, danger: true, sub: '中のファイルもすべて削除されます' }) : '');
  }
  wnShowMenu(`<div class="wn-sheet-grab"></div>${head}<div class="wn-menu-body">${body}</div>`, anchor);
}

/* ピンボタン: 付いていれば外す。管理者は「自分用 / 全員に」を選ぶ */
function wnPinButton(key, anchor) {
  const pin = wnPinOfKey(key);
  if (pin) {
    if (wnCanUnpin(pin)) wnUnpinKey(key);
    else wnShowToast('管理者が全員にピン留めしています', '');
    return;
  }
  if (!wnAdmin()) { wnPinKey(key, 'me'); return; }
  wnShowMenu(`<div class="wn-sheet-grab"></div><div class="wn-menu-body">${wnPinMenuItems(key)}</div>`, anchor);
}

async function wnReloadPins() {
  const r = await wnGetPins();
  if (!r.error) wnPins = r.data || [];
  wnRenderTopZone();
  wnRenderSidebarPins();
  wnRefreshPinMarks();
  wnRenderCrumbs();
}

async function wnPinKey(key, scope) {
  const [t, id] = key.split(':');
  const r = await wnPin(t === 'f' ? { fileId: id, scope } : { folderId: id, scope });
  if (r.error) { wnShowToast(r.error, 'danger'); return; }
  wnShowToast(scope === 'all' ? '全員の一覧の上に固定しました' : 'ピン留めしました', 'success');
  await wnReloadPins();
}

async function wnUnpinKey(key) {
  const pin = wnPinOfKey(key);
  if (!pin) return;
  const r = await wnUnpin(pin.id);
  if (r.error) { wnShowToast(r.error, 'danger'); return; }
  wnShowToast('ピン留めを外しました', '');
  await wnReloadPins();
}

/* ────────────────────────────────
   名前の入力（新しいフォルダー・名前変更）とフォルダーの選択（移動先）
   ──────────────────────────────── */
function wnModal(id, html) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'modal-overlay hidden wn-modal';
    el.addEventListener('click', e => { if (e.target === el) wnCloseModal(el); });
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="modal" style="max-width:440px;">${html}</div>`;
  el.classList.remove('hidden');
  wnLockBodyScroll();
  el.querySelectorAll('[data-wn-close]').forEach(b => b.addEventListener('click', () => wnCloseModal(el)));
  return el;
}
function wnCloseModal(el) {
  if (!el || el.classList.contains('hidden')) return;
  el.classList.add('hidden');
  wnUnlockBodyScroll();
}

/* 新しいフォルダーを社内共有にするか（個人保管モードのいちばん上でだけ意味がある） */
function wnShareForNewFolder() {
  if (!wnIsPersonalMode()) return true;
  if (wnCurrentFolder) return wnCurrentFolder.visibility === 'company';
  return navView === 'company' || !!document.getElementById('uploadShareToCompany')?.checked;
}

function wnNameDialog({ title, value = '', okLabel, showShare = false, onOk }) {
  const el = wnModal('wnNameModal', `
    <div class="modal-header"><span class="modal-title"><i class="fa-solid fa-folder-plus" style="color:var(--wn-folder);"></i> ${h(title)}</span>
      <button class="modal-close" data-wn-close><i class="fa-solid fa-xmark"></i></button></div>
    <input type="text" class="form-input wn-name-input" id="wnNameInput" value="${h(value)}" maxlength="255" placeholder="例：BF6シリーズ 図面一式">
    ${showShare ? `<label class="wn-share-opt"><input type="checkbox" id="wnNameShare" ${navView === 'company' ? 'checked' : ''}>
      <span><b>社内共有にする</b><br><small>チェックしない場合、自分だけが見られるフォルダーになります</small></span></label>` : ''}
    <div class="wn-name-err" id="wnNameErr"></div>
    <div class="modal-footer">
      <button class="btn btn-outline" data-wn-close>キャンセル</button>
      <button class="btn btn-accent" id="wnNameOk">${h(okLabel)}</button>
    </div>`);
  const input = el.querySelector('#wnNameInput');
  const ok = el.querySelector('#wnNameOk');
  const submit = async () => {
    const name = input.value.trim();
    if (!name) { el.querySelector('#wnNameErr').textContent = '名前を入力してください'; return; }
    ok.disabled = true;
    const err = await onOk(name, !!el.querySelector('#wnNameShare')?.checked);
    ok.disabled = false;
    if (err) { el.querySelector('#wnNameErr').textContent = err; return; }
    wnCloseModal(el);
  };
  ok.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) submit(); });
  setTimeout(() => { input.focus({ preventScroll: true }); input.select(); }, 60);
}

function wnNewFolderDialog() {
  wnNameDialog({
    title: wnCurrentFolder ? `「${wnCurrentFolder.name}」の中に新しいフォルダー` : '新しいフォルダー',
    okLabel: '作成',
    showShare: wnIsPersonalMode() && !wnCurrentFolder,
    onOk: async (name, share) => {
      const r = await wnCreateFolder(name, { parentId: wnCurrentFolder?.id ?? null, share: wnIsPersonalMode() && !wnCurrentFolder ? share : true });
      if (r.error) return r.error;
      wnShowToast(`「${name}」を作成しました`, 'success');
      loadFiles();
    },
  });
}

async function wnOpenMoveDialog({ fileIds = [], folderId = null }) {
  const r = await wnGetAllFolders();
  if (r.error) { wnShowToast(r.error, 'danger'); return; }
  const all = r.data || [];
  /* フォルダーを動かすときは、自分自身とその中へは動かせない */
  const banned = new Set();
  if (folderId) {
    const walk = id => { banned.add(String(id)); all.filter(x => String(x.parent_id) === String(id)).forEach(x => walk(x.id)); };
    walk(folderId);
  }
  const rows = [];
  const add = (parent, depth) => all
    .filter(x => String(x.parent_id ?? '') === String(parent ?? '') && !banned.has(String(x.id)))
    .forEach(x => { rows.push({ ...x, depth }); add(x.id, depth + 1); });
  add(null, 1);

  const count = fileIds.length || 1;
  const title = folderId ? 'フォルダーの移動先' : `${count}件の移動先`;
  let target;   // undefined = 未選択 / null = いちばん上 / 数値
  const el = wnModal('wnMoveModal', `
    <div class="modal-header"><span class="modal-title"><i class="fa-solid fa-folder-tree" style="color:var(--wn-folder);"></i> ${h(title)}</span>
      <button class="modal-close" data-wn-close><i class="fa-solid fa-xmark"></i></button></div>
    <div class="wn-move-list">
      <button type="button" class="wn-move-row" data-to=""><i class="fa-solid fa-layer-group" style="color:var(--muted)"></i>フォルダーの外（いちばん上）</button>
      ${rows.map(x => `<button type="button" class="wn-move-row" data-to="${x.id}" style="padding-left:${12 + x.depth * 18}px">
        <i class="fa-solid fa-folder"></i>${h(x.name)}${x.visibility === 'private' && wnIsPersonalMode() ? ' <i class="fa-solid fa-lock" style="font-size:11px;color:var(--muted)"></i>' : ''}</button>`).join('')}
      ${rows.length ? '' : '<p class="wn-move-empty">まだフォルダーがありません</p>'}
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" data-wn-close>キャンセル</button>
      <button class="btn btn-accent" id="wnMoveOk" disabled>ここへ移動</button>
    </div>`);
  el.querySelector('.wn-move-list').addEventListener('click', e => {
    const b = e.target.closest('[data-to]');
    if (!b) return;
    target = b.dataset.to ? Number(b.dataset.to) : null;
    el.querySelectorAll('.wn-move-row').forEach(x => x.classList.toggle('is-on', x === b));
    el.querySelector('#wnMoveOk').disabled = false;
  });
  el.querySelector('#wnMoveOk').addEventListener('click', async () => {
    if (target === undefined) return;
    const btn = el.querySelector('#wnMoveOk');
    btn.disabled = true;
    const ok = folderId ? await wnMoveFolderTo(folderId, target) : await wnMoveFilesTo(fileIds, target);
    btn.disabled = false;
    if (ok) wnCloseModal(el);
  });
}

async function wnMoveFilesTo(fileIds, folderId) {
  const r = await wnMoveFiles(fileIds.map(Number), folderId);
  if (r.error) { wnShowToast(r.error, 'danger'); return false; }
  const name = folderId ? (wnFindFolder(folderId)?.name || 'フォルダー') : 'フォルダーの外';
  if (r.moved) wnShowToast(`${r.moved}件を「${name}」へ移動しました`, 'success');
  if (r.skipped?.length) wnShowToast(`移動先に同じ名前のファイルがあるため移動しませんでした: ${r.skipped.slice(0, 3).join('、')}${r.skipped.length > 3 ? ' ほか' : ''}`, 'danger');
  if (r.denied) wnShowToast(`${r.denied}件は移動する権限がありません`, 'danger');
  if (selectMode) toggleSelectMode();
  loadFiles();
  return true;
}

async function wnMoveFolderTo(folderId, parentId) {
  const r = await wnUpdateFolder(folderId, { parent_id: parentId });
  if (r.error) { wnShowToast(r.error, 'danger'); return false; }
  wnShowToast('フォルダーを移動しました', 'success');
  if (String(wnCurrentFolder?.id) === String(folderId)) wnCurrentFolder = { id: folderId, name: r.data?.name || '' };
  loadFiles();
  return true;
}

/* ────────────────────────────────
   操作の振り分け（クリックはすべてここで受ける）
   ──────────────────────────────── */
async function wnHandleAct(act, el, e) {
  const key = el.dataset.key || '';
  const [t, id] = key.split(':');
  switch (act) {
    case 'menu':        wnOpenItemMenu(key, el); return;
    case 'pin':         wnPinButton(key, el); return;
    case 'pin-me':      wnCloseMenu(); wnPinKey(key, 'me'); return;
    case 'pin-all':     wnCloseMenu(); wnPinKey(key, 'all'); return;
    case 'unpin-key':   wnCloseMenu(); wnUnpinKey(key); return;
    case 'unpin': {
      const pin = wnPins.find(p => String(p.id) === el.dataset.pinId);
      if (pin) wnUnpinKey(pin.kind === 'file' ? `f:${pin.file.id}` : `d:${pin.folder.id}`);
      return;
    }
    case 'download':    wnCloseMenu(); wnDownload(el.dataset.id || id); return;
    case 'email': {
      wnCloseMenu();
      const f = wnFindFile(el.dataset.id || id);
      if (f) openEmailModal([{ id: f.id, name: f.file_name }]);
      return;
    }
    case 'open':        wnCloseMenu(); location.href = `file-detail.html?id=${encodeURIComponent(id)}`; return;
    case 'open-folder-key': wnCloseMenu(); wnOpenFolder(wnFindFolder(id)); return;
    case 'open-folder': {
      e?.preventDefault();
      const fid = el.dataset.folderId;
      wnOpenFolder(wnFindFolder(fid) || { id: Number(fid), name: '' });
      return;
    }
    case 'go': {
      const fid = el.dataset.folderId;
      if (!fid) wnGoRoot();
      else wnOpenFolder({ id: Number(fid), name: '' });
      return;
    }
    case 'new-folder':  wnNewFolderDialog(); return;
    case 'move':
      wnCloseMenu();
      if (t === 'f') wnOpenMoveDialog({ fileIds: [id] });
      else wnOpenMoveDialog({ folderId: Number(id) });
      return;
    case 'rename': {
      wnCloseMenu();
      if (t === 'f') {
        const f = wnFindFile(id);
        if (!f) return;
        wnNameDialog({ title: '名前を変更', value: f.file_name, okLabel: '変更', onOk: async name => {
          const res = await wnRenameFile(f.id, name);
          if (!res) return '名前を変更できませんでした';
          wnShowToast('名前を変更しました', 'success');
          loadFiles();
        } });
      } else {
        const d = wnFindFolder(id);
        if (!d) return;
        wnNameDialog({ title: 'フォルダー名を変更', value: d.name, okLabel: '変更', onOk: async name => {
          const r = await wnUpdateFolder(d.id, { name });
          if (r.error) return r.error;
          if (String(wnCurrentFolder?.id) === String(d.id)) wnCurrentFolder = { ...wnCurrentFolder, path: null };
          wnShowToast('フォルダー名を変更しました', 'success');
          loadFiles();
        } });
      }
      return;
    }
    case 'delete': {
      wnCloseMenu();
      if (t === 'f') {
        const f = wnFindFile(id);
        if (f) confirmDeleteFile(f.id, f.file_name);
        return;
      }
      const d = wnFindFolder(id);
      if (!d) return;
      if (!confirm(`フォルダー「${d.name}」を削除しますか？\n中のファイルとフォルダーもすべて削除されます。この操作は元に戻せません。`)) return;
      const r = await wnDeleteFolder(d.id);
      if (r.error) { wnShowToast(r.error, 'danger'); return; }
      wnShowToast('フォルダーを削除しました', 'success');
      if (String(wnCurrentFolder?.id) === String(d.id)) {
        const path = wnCurrentFolder.path || [];
        const parent = path.length > 1 ? path[path.length - 2] : null;
        if (parent) wnOpenFolder({ id: parent.id, name: parent.name });
        else wnGoRoot();
      } else {
        loadFiles();
      }
      return;
    }
  }
}

/* ────────────────────────────────
   ドラッグで移動（PC）: カード → フォルダーのカード / パンくず
   ──────────────────────────────── */
function wnInitCardDrag() {
  document.addEventListener('dragstart', e => {
    const card = e.target.closest?.('.wn-card[data-file-id]');
    if (!card) return;
    wnInternalDrag = true;
    const id = card.dataset.fileId;
    /* 選択中のカードを掴んだら、選択中のもの全部を動かす */
    const ids = selectMode && selectedIds.includes(String(id)) ? [...selectedIds] : [id];
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-wn-files', ids.join(','));
    card.classList.add('wn-dragging');
    document.body.classList.add('wn-drag-active');
  });
  document.addEventListener('dragend', () => {
    wnInternalDrag = false;
    document.querySelectorAll('.wn-dragging').forEach(x => x.classList.remove('wn-dragging'));
    document.querySelectorAll('.wn-drop-over').forEach(x => x.classList.remove('wn-drop-over'));
    document.body.classList.remove('wn-drag-active');
  });
  document.addEventListener('dragover', e => {
    if (!wnInternalDrag) return;
    const t = e.target.closest?.('[data-wn-drop]');
    document.querySelectorAll('.wn-drop-over').forEach(x => x !== t && x.classList.remove('wn-drop-over'));
    if (!t) return;
    /* 今いるフォルダーそのものへは落とせない */
    if (String(t.dataset.wnDrop) === String(wnCurrentFolder?.id ?? '')) return;
    e.preventDefault();
    t.classList.add('wn-drop-over');
  });
  document.addEventListener('drop', e => {
    if (!wnInternalDrag) return;
    const t = e.target.closest?.('[data-wn-drop]');
    if (!t) return;
    e.preventDefault();
    const ids = (e.dataTransfer.getData('text/x-wn-files') || '').split(',').filter(Boolean);
    const to = t.dataset.wnDrop ? Number(t.dataset.wnDrop) : null;
    wnInternalDrag = false;
    if (ids.length) wnMoveFilesTo(ids, to);
  }, true);
}

/* ────────────────────────────────
   スマホ: 長押しでメニュー
   ──────────────────────────────── */
function wnInitLongPress() {
  let timer = null, start = null, target = null;
  const cancel = () => { clearTimeout(timer); timer = null; target?.classList.remove('wn-pressing'); target = null; };
  document.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || selectMode) return;
    const el = e.target.closest('[data-file-id], [data-folder-id], [data-pin-key]');
    if (!el || e.target.closest('button, a, input')) return;
    const key = el.dataset.pinKey || (el.dataset.folderId ? `d:${el.dataset.folderId}` : `f:${el.dataset.fileId}`);
    start = [e.clientX, e.clientY];
    target = el;
    el.classList.add('wn-pressing');
    timer = setTimeout(() => {
      timer = null;
      el.classList.remove('wn-pressing');
      wnSuppressClick = true;
      if (navigator.vibrate) navigator.vibrate(10);
      wnOpenItemMenu(key, null);
    }, 480);
  }, { passive: true });
  document.addEventListener('pointermove', e => {
    if (timer && start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 10) cancel();
  }, { passive: true });
  document.addEventListener('pointerup', () => { if (timer) cancel(); }, { passive: true });
  document.addEventListener('pointercancel', cancel, { passive: true });
  /* 長押しで開いた直後に指を離したときのクリックで、カードを開かないようにする */
  document.addEventListener('click', e => {
    if (!wnSuppressClick) return;
    wnSuppressClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
  document.addEventListener('contextmenu', e => {
    if (e.target.closest?.('.wn-card, .wn-folder-card, .wn-pin, .ig-post, .file-row') && matchMedia('(pointer: coarse)').matches) e.preventDefault();
  });
}

/* ────────────────────────────────
   スマホ: 下のメニューはスクロールで縮める（iOS 26 のタブバーと同じ動き）
   ──────────────────────────────── */
function wnInitBottomNavMinimize() {
  let lastY = window.scrollY;
  window.addEventListener('scroll', () => {
    if (!wnIsNarrow()) return;
    const y = window.scrollY, dy = y - lastY;
    if (Math.abs(dy) < 8) return;
    document.body.classList.toggle('bn-min', dy > 0 && y > 120);
    lastY = y;
  }, { passive: true });
  /* 縮んでいるときにタブを押したら、まず元に戻すだけにする */
  document.querySelector('.bottom-nav-inner')?.addEventListener('click', e => {
    if (!document.body.classList.contains('bn-min')) return;
    document.body.classList.remove('bn-min');
    e.stopPropagation();
  }, true);
}

/* ────────────────────────────────
   フォルダーごとのアップロード（ドロップ / フォルダー選択）
   ──────────────────────────────── */
const WN_SKIP_NAMES = ['thumbs.db', 'desktop.ini', '.ds_store'];
function wnSkipName(name) {
  const n = String(name || '').toLowerCase();
  return !n || n.startsWith('.') || n.startsWith('~$') || WN_SKIP_NAMES.includes(n);
}

/* drop の中でしか DataTransferItem は読めないので、エントリーだけ先に取り出す */
function wnDropEntries(dt) {
  const out = [];
  for (const it of Array.from(dt?.items || [])) {
    if (it.kind !== 'file') continue;
    const en = it.webkitGetAsEntry?.();
    if (en) out.push(en);
  }
  return out;
}

async function wnFilesFromEntries(entries) {
  const files = [];
  const readAll = dir => new Promise(resolve => {
    const reader = dir.createReader();
    const acc = [];
    /* readEntries は1回で全部返らない（Chrome は100件ずつ）ので空になるまで呼ぶ */
    const next = () => reader.readEntries(batch => {
      if (!batch.length) return resolve(acc);
      acc.push(...batch);
      next();
    }, () => resolve(acc));
    next();
  });
  const walk = async (entry, dir) => {
    if (wnSkipName(entry.name)) return;
    if (entry.isFile) {
      const file = await new Promise(res => entry.file(res, () => res(null)));
      if (file) { file._wnDir = dir; files.push(file); }
    } else if (entry.isDirectory) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      for (const child of await readAll(entry)) await walk(child, path);
    }
  };
  for (const en of entries) await walk(en, '');
  if (!files.length) wnShowToast('フォルダーの中にファイルがありませんでした', '');
  return files;
}

function wnFilesFromDirectoryInput(fileList) {
  return Array.from(fileList || []).filter(f => {
    const parts = (f.webkitRelativePath || f.name).split('/');
    return !parts.some(wnSkipName);
  }).map(f => {
    const parts = (f.webkitRelativePath || '').split('/');
    f._wnDir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    return f;
  });
}

/* アップロード画面の「保存先」表示と、フォルダーの中では共有チェックを隠す */
function wnUpdateUploadDest() {
  const el = document.getElementById('uploadDestLabel');
  if (el) {
    const viewLabel = { mine: 'マイファイル', company: '社内共有' }[navView] || 'マイファイル';
    const names = wnCurrentFolder ? (wnCurrentFolder.path || [{ name: wnCurrentFolder.name }]).map(p => p.name) : [];
    el.innerHTML = `<i class="fa-solid fa-folder-open"></i>保存先：<b>${h([viewLabel, ...names].join(' › '))}</b>`;
  }
  const row = document.getElementById('uploadShareRow');
  if (row && wnCurrentFolder) {
    row.style.display = 'none';
    const cb = document.getElementById('uploadShareToCompany');
    if (cb) cb.checked = false;
  } else if (row) {
    row.style.display = wnIsPersonalMode() ? '' : 'none';
  }
}

/* ────────────────────────────────
   選択バー: フォルダーへ移動・ピン留め
   ──────────────────────────────── */
function wnUpdateFolderSelButtons() {
  const n = selectedIds.length;
  const sel = selectedIds.map(id => allFiles.find(f => String(f.id) === String(id))).filter(Boolean);
  const editable = sel.filter(f => f.can_edit !== false).length;
  const mv = document.getElementById('moveSelBtn');
  if (mv) { mv.disabled = editable === 0; mv.title = editable ? `${editable}件をフォルダーへ移動` : '移動できるファイルが選択されていません'; }
  const pn = document.getElementById('pinSelBtn');
  if (pn) pn.disabled = n === 0;
}

async function wnPinSelected(scope) {
  const ids = [...selectedIds];
  let ok = 0;
  for (const id of ids) {
    const r = await wnPin({ fileId: id, scope });
    if (!r.error) ok++;
  }
  wnShowToast(`${ok}件をピン留めしました`, ok ? 'success' : 'danger');
  if (selectMode) toggleSelectMode();
  await wnReloadPins();
}

/* ────────────────────────────────
   初期化
   ──────────────────────────────── */
function initFolders() {
  document.addEventListener('click', e => {
    const kindBtn = e.target.closest('[data-wn-kind]');
    if (kindBtn) {
      wnKind = kindBtn.dataset.wnKind;
      loadFiles();
      return;
    }
    const actEl = e.target.closest('[data-wn-act]');
    if (actEl) {
      e.preventDefault();
      e.stopPropagation();
      wnHandleAct(actEl.dataset.wnAct, actEl, e);
      return;
    }
    /* ピンのカード・フォルダーのカード本体のクリック */
    const pinCard = e.target.closest('.wn-pin');
    if (pinCard) {
      const [t, id] = pinCard.dataset.pinKey.split(':');
      if (t === 'f') location.href = `file-detail.html?id=${encodeURIComponent(id)}`;
      else wnOpenFolder(wnFindFolder(id) || { id: Number(id), name: '' });
      return;
    }
    const folderCard = e.target.closest('.wn-folder-card');
    if (folderCard) {
      wnOpenFolder(wnFindFolder(folderCard.dataset.folderId));
      return;
    }
    if (!e.target.closest('#wnItemMenu')) wnCloseMenu();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      wnCloseMenu();
      document.querySelectorAll('.wn-modal:not(.hidden)').forEach(wnCloseModal);
    }
  });
  window.addEventListener('resize', wnCloseMenu);

  document.getElementById('newFolderBtn')?.addEventListener('click', wnNewFolderDialog);
  document.getElementById('makeFolderBtn')?.addEventListener('click', () => { closeUploadModal(); wnNewFolderDialog(); });
  document.getElementById('moveSelBtn')?.addEventListener('click', () => {
    const ids = selectedIds.filter(id => allFiles.find(f => String(f.id) === String(id))?.can_edit !== false);
    if (ids.length) wnOpenMoveDialog({ fileIds: ids });
  });
  document.getElementById('pinSelBtn')?.addEventListener('click', e => {
    if (!selectedIds.length) return;
    if (!wnAdmin()) { wnPinSelected('me'); return; }
    wnShowMenu(`<div class="wn-sheet-grab"></div><div class="wn-menu-body">
      ${wnMenuItem('pinsel-me', 'fa-thumbtack', `${selectedIds.length}件をピン留め`, { sub: '自分の一覧の上に固定' })}
      ${wnMenuItem('pinsel-all', 'fa-bullhorn', `${selectedIds.length}件を全員にピン留め`, { sub: '社内の全員の一覧に出ます' })}</div>`, e.currentTarget);
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-wn-act="pinsel-me"], [data-wn-act="pinsel-all"]');
    if (!b) return;
    wnCloseMenu();
    wnPinSelected(b.dataset.wnAct === 'pinsel-all' ? 'all' : 'me');
  }, true);

  /* フォルダー選択はPCだけ（スマホのブラウザはフォルダーを選んで送れない） */
  const pickFolder = document.getElementById('pickFolderBtn');
  if (pickFolder && matchMedia('(pointer: coarse)').matches) pickFolder.style.display = 'none';

  wnInitCardDrag();
  wnInitLongPress();
  wnInitBottomNavMinimize();
  wnRenderCrumbs();
  /* ?view=company で開いたとき、HTML既定の「マイファイル」の選択表示が残らないようにする */
  if (navView === 'mine' || navView === 'company') wnSetNavActive(navView);

  /* 初回に ?folder= で開いた場合、ブラウザの「戻る」でいちばん上に戻れるよう履歴の状態を入れる */
  history.replaceState({ wnFolder: wnCurrentFolder?.id ?? null, view: navView }, '', wnFolderUrl());
}
