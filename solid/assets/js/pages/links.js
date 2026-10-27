'use strict';
/* SOLID 外部リンク（よく使うサイトをカテゴリ別の棚に並べて共有する）
   不具合対策書と同じく HaLSpace と PT.HILANO LCZ INDONESIA の2社だけが使う画面。
   アクセス制御の正は API（solid.quality ミドルウェアが 403 を返す）。ここでは 403 なら案内を出すだけ。

   サムネイルは URL を入れた時点で API の /preview がリンク先の OGP 画像（無ければアイコン）を
   取り込んで data URL で返す。保存時はそれを画像として送る（手動で選んだ画像と同じ経路）。
   取れないサイト（ボット拒否・ログイン必須・画像なし）は、ドメインの頭文字の色付きタイルで代用する。 */

const user = requireSpaceAuth();
if (!user) throw new Error('未認証');
renderSidebarUser(user);
if (isAdmin(user)) {
  document.getElementById('adminLink').style.display = '';
}
initMobileMenu();

const BASE = '/solid/links';
const RECENT = 8;

let SIDE = null;        // 'hal' | 'lcz'
let LINKS = [];
let CATS = [];
let editing = null;     // 編集中のリンク（null = 新規）
let thumb = null;       // { blob, source, src } | { none: true } | null（変更なし）
let previewSeq = 0;
let previewFor = '';    // 最後にプレビューを取った URL

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const canEdit = l => SIDE === 'hal' || l.created_by === user.id;

function showToast(msg, type = '') {
  const c = $('toastContainer');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast${type ? ' toast-' + type : ''}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

/* 「今日 9:12」「昨日」「3日前」「10/14」「2025/12/01」 */
function relTime(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + ':00+09:00');
  const now = new Date();
  const day = x => Math.floor((x.getTime() + 9 * 3600e3) / 86400e3);
  const diff = day(now) - day(d);
  if (diff <= 0) return '今日 ' + s.slice(11, 16);
  if (diff === 1) return '昨日';
  if (diff < 7) return diff + '日前';
  return s.slice(0, 4) === String(now.getFullYear()) ? `${+s.slice(5, 7)}/${+s.slice(8, 10)}` : s.slice(0, 10).replace(/-/g, '/');
}
const fullTime = s => s ? s.replace(/-/g, '/') : '';

/* 名前の頭文字アイコン。色は ID で固定 */
const AV_COLORS = ['#FF6B35', '#0984E3', '#00B894', '#6c5ce7', '#e17055', '#00cec9', '#d63031', '#636e72'];
function avatar(id, name, cls = '') {
  const c = AV_COLORS[(id ?? 0) % AV_COLORS.length];
  return `<span class="el-av ${cls}" style="background:${c}">${esc((name || '?').slice(0, 1))}</span>`;
}

/* サムネイルが無いときの代わり。ドメインから色を決めて頭文字を出す */
const TILE_COLORS = [['#0984e3', '#74b9ff'], ['#00b894', '#55efc4'], ['#6c5ce7', '#a29bfe'], ['#e17055', '#fab1a0'], ['#2d3436', '#636e72'], ['#e84393', '#fd79a8'], ['#00cec9', '#81ecec'], ['#d35400', '#fdcb6e']];
function fallbackThumb(url) {
  const h = host(url);
  let n = 0;
  for (const ch of h) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = TILE_COLORS[n % TILE_COLORS.length];
  return `<span class="el-fb" style="background:linear-gradient(135deg,${a},${b})">${esc(h.slice(0, 1).toUpperCase())}</span>`;
}

/* ───────── サムネイル（Bearer が要るので fetch → Blob URL） ───────── */
const imgCache = new Map();
function authImage(url) {
  if (!imgCache.has(url)) {
    const token = sessionStorage.getItem('space_token');
    imgCache.set(url, fetch(API_BASE + url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.blob() : Promise.reject(r.status))
      .then(b => URL.createObjectURL(b))
      .catch(() => { imgCache.delete(url); return null; }));
  }
  return imgCache.get(url);
}
function thumbHtml(l) {
  const attrs = l.thumb_url ? ` data-img="${esc(l.thumb_url)}"` : '';
  return `<span class="el-th${l.thumb_source === 'icon' ? ' is-icon' : ''}"${attrs}>${fallbackThumb(l.url)}</span>`;
}
function hydrateImages(root) {
  root.querySelectorAll('[data-img]:not([data-done])').forEach(el => {
    el.dataset.done = '1';
    authImage(el.dataset.img).then(src => {
      if (!src) return;
      const im = document.createElement('img');
      im.src = src; im.alt = ''; im.loading = 'lazy';
      el.innerHTML = '';
      el.appendChild(im);
    });
  });
}

/* ───────── 読み込み ───────── */
async function init() {
  try {
    const a = await api.get('/solid/quality-reports/access');
    SIDE = a?.side ?? null;
  } catch (e) {
    if (/権限/.test(e.message)) {
      $('elDenied').style.display = '';
      return;
    }
    showToast(e.message, 'danger');
    return;
  }
  $('elMain').style.display = '';
  $('btnAdd').style.display = '';
  $('btnCats').style.display = '';
  await load();
}

async function load() {
  try {
    const d = await api.get(BASE);
    if (!d) return;
    LINKS = d.links;
    CATS = d.categories;
    render();
  } catch (e) {
    /* 前回取得分は残したまま知らせる（MOCK には差し替えない） */
    showToast('リンクを読み込めませんでした: ' + e.message, 'danger');
    if (!LINKS.length) $('elShelves').innerHTML = `<div class="el-empty">読み込めませんでした。時間をおいて再読み込みしてください。</div>`;
  }
}

/* ───────── 描画 ───────── */
function matches(l, q) {
  if (!q) return true;
  return [l.title, l.url, l.description, l.site_name, l.created_by_name].some(v => (v ?? '').toLowerCase().includes(q));
}

function tileHtml(l, inPinned) {
  const meta = `登録: ${l.created_by_name}${l.created_by_company ? `（${l.created_by_company}）` : ''} ${fullTime(l.created_at)}`
    + (l.updated_at !== l.created_at && l.updated_by_name ? `\n編集: ${l.updated_by_name} ${fullTime(l.updated_at)}` : '');
  return `<div class="el-tile" data-id="${l.id}">
    <a class="el-tile-a" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.url + '\n' + meta)}">
      ${thumbHtml(l)}
      <span class="el-tile-b">
        <span class="el-tile-t">${esc(l.title)}</span>
        ${l.description ? `<span class="el-tile-d">${esc(l.description)}</span>` : ''}
        <span class="el-tile-m">${avatar(l.created_by, l.created_by_name, 'sm')}${esc(l.created_by_name)}<span class="dot">·</span><span title="${esc(fullTime(l.created_at))}">${esc(relTime(l.created_at))}</span></span>
      </span>
    </a>
    ${l.pinned && !inPinned ? '<i class="fa-solid fa-thumbtack el-pin-mark" title="ピン留め中"></i>' : ''}
    <button class="el-more" data-more="${l.id}" title="メニュー"><i class="fa-solid fa-ellipsis-vertical"></i></button>
  </div>`;
}

function shelfHtml(name, icon, items, opts = {}) {
  return `<section class="el-sec${opts.pinned ? ' is-pinned' : ''}">
    <div class="el-sec-h"><i class="fa-solid ${icon}"></i><h3>${esc(name)}</h3><span class="n">${items.length}件</span></div>
    ${items.length ? `<div class="el-tiles">${items.map(l => tileHtml(l, opts.pinned)).join('')}</div>`
      : `<div class="el-sec-empty">${opts.empty ?? 'まだリンクがありません'}</div>`}
  </section>`;
}

function render() {
  const q = $('elQ').value.trim().toLowerCase();
  const list = LINKS.filter(l => matches(l, q));
  const out = [];

  if (!LINKS.length) {
    out.push(`<div class="el-welcome"><i class="fa-solid fa-link"></i><p>よく使うサイト（メーカーのカタログ・規格・共有フォルダなど）を登録して、みんなで使えるようにしましょう。</p><button class="btn btn-primary btn-sm" data-add><i class="fa-solid fa-plus"></i> 最初のリンクを追加</button></div>`);
  } else {
    const pinned = list.filter(l => l.pinned);
    if (pinned.length) out.push(shelfHtml('ピン留め', 'fa-thumbtack', pinned, { pinned: true }));
    for (const c of CATS) {
      const items = list.filter(l => l.category_id === c.id);
      if (q && !items.length) continue;
      out.push(shelfHtml(c.name, 'fa-folder', items));
    }
    const none = list.filter(l => !l.category_id || !CATS.some(c => c.id === l.category_id));
    if (none.length) out.push(shelfHtml('未分類', 'fa-folder-open', none));
    if (q && !list.length) out.push(`<div class="el-empty">「${esc(q)}」に一致するリンクはありません</div>`);
  }
  $('elShelves').innerHTML = out.join('');

  const recent = LINKS.slice(0, RECENT);
  $('elFeed').innerHTML = recent.length ? recent.map(l => `
    <a class="el-fi" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
      ${avatar(l.created_by, l.created_by_name)}
      <span class="el-fi-b"><b>${esc(l.created_by_name)}</b> さんが追加
        <span class="lk">${esc(l.title)}</span>
        <span class="tm">${esc(fullTime(l.created_at))}</span>
      </span>
    </a>`).join('') : '<div class="el-sec-empty">まだありません</div>';

  hydrateImages($('elShelves'));
}

$('elQ').addEventListener('input', render);

/* ───────── タイルのメニュー ───────── */
let menuEl = null;
function closeMenu() { menuEl?.remove(); menuEl = null; }
document.addEventListener('click', e => {
  if (e.target.closest('[data-add]')) { openLinkModal(null); return; }
  const more = e.target.closest('[data-more]');
  if (!more) { if (!e.target.closest('.el-menu')) closeMenu(); return; }
  e.preventDefault();
  const id = +more.dataset.more;
  if (menuEl?.dataset.for === String(id)) { closeMenu(); return; }
  closeMenu();
  const l = LINKS.find(x => x.id === id);
  if (!l) return;
  menuEl = document.createElement('div');
  menuEl.className = 'el-menu';
  menuEl.dataset.for = id;
  menuEl.innerHTML = `
    <button data-act="pin"><i class="fa-solid fa-thumbtack"></i> ${l.pinned ? 'ピン留めを外す' : 'ピン留めする'}</button>
    <button data-act="copy"><i class="fa-regular fa-copy"></i> URLをコピー</button>
    ${canEdit(l) ? `<button data-act="edit"><i class="fa-solid fa-pen"></i> 編集</button>
    <button data-act="del" class="danger"><i class="fa-solid fa-trash"></i> 削除</button>` : ''}
    <div class="el-menu-who">登録: ${esc(l.created_by_name)} ${esc(fullTime(l.created_at))}${l.updated_at !== l.created_at && l.updated_by_name ? `<br>編集: ${esc(l.updated_by_name)} ${esc(fullTime(l.updated_at))}` : ''}</div>`;
  document.body.appendChild(menuEl);
  const r = more.getBoundingClientRect();
  const w = menuEl.offsetWidth;
  menuEl.style.top = (r.bottom + window.scrollY + 4) + 'px';
  menuEl.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
  menuEl.onclick = ev => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    closeMenu();
    if (b.dataset.act === 'pin') togglePin(l);
    if (b.dataset.act === 'copy') navigator.clipboard?.writeText(l.url).then(() => showToast('URLをコピーしました', 'success'), () => showToast('コピーできませんでした', 'danger'));
    if (b.dataset.act === 'edit') openLinkModal(l);
    if (b.dataset.act === 'del') deleteLink(l);
  };
});
window.addEventListener('resize', closeMenu);

async function togglePin(l) {
  try {
    const d = await api.patch(`${BASE}/${l.id}/pin`, { pinned: !l.pinned });
    replaceLink(d.link);
  } catch (e) { showToast(e.message, 'danger'); }
}

async function deleteLink(l) {
  if (!confirm(`「${l.title}」を削除しますか？\nほかの人の一覧からも消えます。`)) return;
  try {
    await api.delete(`${BASE}/${l.id}`);
    LINKS = LINKS.filter(x => x.id !== l.id);
    render();
    closeModal($('linkModal'));
    showToast('削除しました', 'success');
  } catch (e) { showToast(e.message, 'danger'); }
}

function replaceLink(link) {
  const i = LINKS.findIndex(x => x.id === link.id);
  if (i >= 0) LINKS[i] = link; else LINKS.unshift(link);
  render();
}

/* ───────── モーダル共通 ───────── */
function openModal(el) { el.classList.add('open'); }
function closeModal(el) { el.classList.remove('open'); }
document.querySelectorAll('.el-modal-bg').forEach(bg => {
  bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) closeModal(bg); });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeMenu(); document.querySelectorAll('.el-modal-bg.open').forEach(closeModal); }
});

/* ───────── リンクの追加・編集 ───────── */
$('btnAdd').onclick = () => openLinkModal(null);

function catOptions(selected) {
  return `<option value="">未分類</option>` + CATS.map(c => `<option value="${c.id}"${c.id === selected ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
}

function setPreviewThumb(html, isIcon = false) {
  const t = $('lmThumb');
  t.className = 'el-th' + (isIcon ? ' is-icon' : '');
  t.innerHTML = html;
}

function openLinkModal(l) {
  editing = l;
  thumb = null;
  previewFor = l ? l.url : '';
  $('lmTitle').textContent = l ? 'リンクを編集' : 'リンクを追加';
  $('lmUrl').value = l?.url ?? '';
  $('lmName').value = l?.title ?? '';
  $('lmDesc').value = l?.description ?? '';
  $('lmPin').checked = !!l?.pinned;
  $('lmCat').innerHTML = catOptions(l?.category_id ?? null);
  $('lmDelete').style.display = l && canEdit(l) ? '' : 'none';
  $('lmWho').innerHTML = l
    ? `<i class="fa-solid fa-user-clock"></i> 登録: ${esc(l.created_by_name)} ${esc(fullTime(l.created_at))}${l.updated_at !== l.created_at && l.updated_by_name ? ` ／ 最終編集: ${esc(l.updated_by_name)} ${esc(fullTime(l.updated_at))}` : ''}`
    : `<i class="fa-solid fa-user-clock"></i> 登録者（${esc(user.name)}）と登録日時は自動で記録されます。`;
  $('lmStatus').textContent = l ? 'URL を変えたときは右の ↻ でサムネイルを取り直せます' : 'URL を貼ると、タイトルとサムネイルを自動で取得します';
  $('lmStatus').className = 'el-prev-st';
  if (l?.thumb_url) {
    setPreviewThumb('', l.thumb_source === 'icon');
    authImage(l.thumb_url).then(src => { if (src && editing === l && !thumb) setPreviewThumb(`<img src="${src}" alt="">`, l.thumb_source === 'icon'); });
  } else {
    setPreviewThumb(l ? fallbackThumb(l.url) : '<i class="fa-regular fa-image"></i>');
  }
  $('lmNoThumb').style.display = l?.thumb_url ? '' : 'none';
  openModal($('linkModal'));
  setTimeout(() => (l ? $('lmName') : $('lmUrl')).focus(), 50);
}

async function runPreview(force = false) {
  const url = $('lmUrl').value.trim();
  if (!url || (!force && url === previewFor)) return;
  previewFor = url;
  const seq = ++previewSeq;
  $('lmStatus').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> リンク先を確認しています…';
  $('lmStatus').className = 'el-prev-st';
  $('lmFetch').disabled = true;
  try {
    const d = await api.post(`${BASE}/preview`, { url });
    if (seq !== previewSeq) return;
    if (d.url !== url) $('lmUrl').value = d.url;
    previewFor = d.url;
    if (d.title && (!$('lmName').value.trim() || force)) $('lmName').value = d.title;
    if (d.thumb) {
      const blob = await (await fetch(d.thumb)).blob();
      thumb = { blob, source: d.thumb_source };
      setPreviewThumb(`<img src="${d.thumb}" alt="">`, d.thumb_source === 'icon');
      $('lmNoThumb').style.display = '';
    } else if (!editing?.thumb_url || force) {
      thumb = editing?.thumb_url ? { none: true } : null;
      setPreviewThumb(fallbackThumb(d.url));
    }
    let msg, cls = 'ok';
    if (!d.ok) { msg = 'リンク先を読み取れませんでした（ボット拒否・非公開など）。タイトルを入力し、必要なら画像を選んでください'; cls = 'warn'; }
    else if (d.login) { msg = 'ログインが必要なページのようです。タイトルを入力し、必要なら画像を選んでください'; cls = 'warn'; }
    else if (!d.thumb) { msg = 'タイトルを取得しました（このサイトには画像がありません。色付きの表示になります）'; cls = 'warn'; }
    else msg = d.thumb_source === 'icon' ? 'タイトルとサイトのアイコンを取得しました' : 'タイトルとサムネイルを取得しました';
    $('lmStatus').innerHTML = `<i class="fa-solid ${cls === 'ok' ? 'fa-circle-check' : 'fa-circle-info'}"></i> ${esc(msg)}`;
    $('lmStatus').className = 'el-prev-st ' + cls;
  } catch (e) {
    if (seq !== previewSeq) return;
    $('lmStatus').innerHTML = `<i class="fa-solid fa-circle-info"></i> ${esc(e.message)}`;
    $('lmStatus').className = 'el-prev-st warn';
  } finally {
    if (seq === previewSeq) $('lmFetch').disabled = false;
  }
}
$('lmUrl').addEventListener('change', () => runPreview());
$('lmUrl').addEventListener('paste', () => setTimeout(() => runPreview(), 0));
$('lmFetch').onclick = () => runPreview(true);

$('lmFile').onchange = e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (!f.type.startsWith('image/')) { showToast('画像ファイルを選んでください', 'danger'); return; }
  thumb = { blob: f, source: 'upload' };
  setPreviewThumb(`<img src="${URL.createObjectURL(f)}" alt="">`);
  $('lmNoThumb').style.display = '';
  $('lmStatus').innerHTML = '<i class="fa-solid fa-circle-check"></i> 選んだ画像をサムネイルにします';
  $('lmStatus').className = 'el-prev-st ok';
};
$('lmNoThumb').onclick = () => {
  thumb = { none: true };
  setPreviewThumb(fallbackThumb($('lmUrl').value.trim() || 'link'));
  $('lmNoThumb').style.display = 'none';
};

$('lmNewCat').onclick = async () => {
  const name = prompt('新しいカテゴリの名前');
  if (!name?.trim()) return;
  try {
    const d = await api.post(`${BASE}/categories`, { name: name.trim() });
    CATS.push(d.category);
    $('lmCat').innerHTML = catOptions(d.category.id);
    render();
  } catch (e) { showToast(e.message, 'danger'); }
};

let saving = false;
$('lmSave').onclick = async () => {
  if (saving) return;
  const form = $('lmForm');
  if (!form.reportValidity()) return;
  /* URL を貼ってすぐ保存したときは、プレビューの結果を待ってから送る */
  if ($('lmUrl').value.trim() !== previewFor) await runPreview();

  const fd = new FormData();
  fd.append('url', $('lmUrl').value.trim());
  fd.append('title', $('lmName').value.trim());
  fd.append('description', $('lmDesc').value.trim());
  fd.append('category_id', $('lmCat').value);
  fd.append('pinned', $('lmPin').checked ? '1' : '0');
  if (thumb?.blob) {
    fd.append('thumbnail', thumb.blob, 'thumb.' + (thumb.blob.type.split('/')[1] || 'png'));
    fd.append('thumb_source', thumb.source);
  } else if (thumb?.none && editing) {
    fd.append('remove_thumbnail', '1');
  }

  saving = true;
  $('lmSave').disabled = true;
  try {
    const d = await apiFetchForm(editing ? `${BASE}/${editing.id}` : BASE, fd);
    replaceLink(d.link);
    closeModal($('linkModal'));
    showToast(editing ? '保存しました' : 'リンクを追加しました', 'success');
  } catch (e) {
    showToast(e.message, 'danger');
  } finally {
    saving = false;
    $('lmSave').disabled = false;
  }
};
$('lmDelete').onclick = () => editing && deleteLink(editing);

/* ───────── カテゴリの管理 ───────── */
$('btnCats').onclick = () => { renderCats(); openModal($('catModal')); };

function renderCats() {
  const hal = SIDE === 'hal';
  $('cmList').innerHTML = CATS.length ? CATS.map((c, i) => {
    const n = LINKS.filter(l => l.category_id === c.id).length;
    return `<div class="el-cat-row" data-cat="${c.id}">
      <i class="fa-solid fa-folder"></i><span class="nm">${esc(c.name)}</span><span class="n">${n}件</span>
      ${hal ? `<button data-cact="up" title="上へ"${i === 0 ? ' disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
      <button data-cact="down" title="下へ"${i === CATS.length - 1 ? ' disabled' : ''}><i class="fa-solid fa-arrow-down"></i></button>
      <button data-cact="rename" title="名前を変える"><i class="fa-solid fa-pen"></i></button>
      <button data-cact="del" title="削除" class="danger"><i class="fa-solid fa-trash"></i></button>` : ''}
    </div>`;
  }).join('') : '<div class="el-sec-empty">カテゴリはまだありません</div>';
  $('cmNote').textContent = hal
    ? 'カテゴリを削除しても、中のリンクは「未分類」に移るだけで消えません。'
    : 'カテゴリの名前の変更・並べ替え・削除は HaLSpace の方が行います。';
}

$('cmList').onclick = async e => {
  const b = e.target.closest('[data-cact]');
  if (!b) return;
  const id = +b.closest('[data-cat]').dataset.cat;
  const c = CATS.find(x => x.id === id);
  try {
    if (b.dataset.cact === 'rename') {
      const name = prompt('カテゴリの名前', c.name);
      if (!name?.trim() || name.trim() === c.name) return;
      const d = await api.patch(`${BASE}/categories/${id}`, { name: name.trim() });
      c.name = d.category.name;
    } else if (b.dataset.cact === 'del') {
      if (!confirm(`カテゴリ「${c.name}」を削除しますか？\n中のリンクは「未分類」に移ります。`)) return;
      await api.delete(`${BASE}/categories/${id}`);
      CATS = CATS.filter(x => x.id !== id);
      LINKS.forEach(l => { if (l.category_id === id) l.category_id = null; });
    } else {
      const i = CATS.indexOf(c);
      const j = b.dataset.cact === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= CATS.length) return;
      [CATS[i], CATS[j]] = [CATS[j], CATS[i]];
      await api.put(`${BASE}/categories/order`, { ids: CATS.map(x => x.id) });
    }
    renderCats();
    render();
  } catch (err) {
    showToast(err.message, 'danger');
    load();
  }
};

$('cmForm').onsubmit = async e => {
  e.preventDefault();
  const name = $('cmName').value.trim();
  if (!name) return;
  try {
    const d = await api.post(`${BASE}/categories`, { name });
    CATS.push(d.category);
    $('cmName').value = '';
    renderCats();
    render();
  } catch (err) { showToast(err.message, 'danger'); }
};

init();
