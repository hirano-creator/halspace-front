'use strict';

/* ===== 共通ユーティリティ ===== */
function getAuth() {
  const raw = sessionStorage.getItem('space_user');
  return raw ? JSON.parse(raw) : null;
}

/* ログイン情報はタブごとに独立したsessionStorageに保存しているため、
   別タブで別アカウントにログインしても、このタブのセッションには影響しない。 */

function getParam(key) {
  return new URLSearchParams(location.search).get(key) || '';
}

/* ===== バッジHTML生成 ===== */
function dlBadge(type) {
  return type === 'download'
    ? '<span class="badge badge-dl"><i class="fa-solid fa-download"></i> 直接DL</span>'
    : '<span class="badge badge-link"><i class="fa-solid fa-arrow-up-right-from-square"></i> メーカーサイト</span>';
}

function specBadge(spec) {
  if (!spec) return '';
  if (spec.includes('JIS')) return '<span class="badge badge-jis">JIS</span>';
  if (spec.includes('ISO')) return '<span class="badge badge-iso">ISO</span>';
  return '';
}

/* ===== 部品カードHTML ===== */
function renderPartCard(p) {
  const thumb = p.thumb
    ? `<div class="ds-part-thumb">${p.thumb}</div>`
    : `<div class="ds-part-thumb"><i class="fa-solid fa-cube"></i></div>`;
  const tags = p.tags.slice(0, 3).map(t =>
    `<span class="badge badge-link" style="font-size:10px">${t}</span>`
  ).join('');
  return `
    <div class="ds-part-card" onclick="location.href='product.html?id=${p.id}'">
      ${thumb}
      <div class="ds-part-info">
        <div class="ds-part-id">${p.id}</div>
        <div class="ds-part-name">${p.name}</div>
        <div class="ds-part-tags">
          ${dlBadge(p.type)}
          ${specBadge(p.spec)}
        </div>
      </div>
    </div>`;
}

/* ===== カテゴリーカードHTML ===== */
function renderCatCard(c) {
  const cnt = countByCategory(c.id);
  const typeBadge = c.type === 'download'
    ? '<span class="badge badge-dl ds-cat-badge"><i class="fa-solid fa-download"></i> 直接DL</span>'
    : '<span class="badge badge-link ds-cat-badge">リンク</span>';
  return `
    <div class="ds-cat-card" onclick="location.href='category.html?cat=${c.id}'">
      ${typeBadge}
      <div class="ds-cat-icon ${c.iconClass}">
        <i class="${c.icon}"></i>
      </div>
      <div class="ds-cat-name">${c.name}</div>
      <div class="ds-cat-count">${cnt} 点</div>
    </div>`;
}

/* ===== サイドバーHTML（category.html用） ===== */
function renderSidebar(activeCatId, typeFilter) {
  const allCnt = PARTS.length;
  let html = `
    <div class="ds-sidebar-section">
      <div class="ds-sidebar-label">カテゴリー</div>
      <div class="ds-sidebar-item ${!activeCatId ? 'active' : ''}"
           onclick="updateFilter('','${typeFilter}')">
        <span>すべて</span>
        <span class="cnt">${allCnt}</span>
      </div>`;
  CATEGORIES.forEach(c => {
    const cnt = countByCategory(c.id);
    const isActive = c.id === activeCatId;
    html += `
      <div class="ds-sidebar-item ${isActive ? 'active' : ''}"
           onclick="updateFilter('${c.id}','${typeFilter}')">
        <span><i class="${c.icon}" style="width:14px;margin-right:6px"></i>${c.name}</span>
        <span class="cnt">${cnt}</span>
      </div>`;
  });
  html += `</div><div class="ds-sidebar-divider"></div>
    <div class="ds-sidebar-section">
      <div class="ds-sidebar-label">データ形式</div>
      <div class="ds-sidebar-item ${!typeFilter ? 'active' : ''}"
           onclick="updateFilter('${activeCatId}','')">すべて</div>
      <div class="ds-sidebar-item ${typeFilter === 'download' ? 'active' : ''}"
           onclick="updateFilter('${activeCatId}','download')">
        <span><i class="fa-solid fa-download" style="margin-right:6px"></i>直接ダウンロード</span>
      </div>
      <div class="ds-sidebar-item ${typeFilter === 'link' ? 'active' : ''}"
           onclick="updateFilter('${activeCatId}','link')">
        <span><i class="fa-solid fa-arrow-up-right-from-square" style="margin-right:6px"></i>メーカーリンク</span>
      </div>
    </div>`;
  return html;
}

function updateFilter(cat, type) {
  const params = new URLSearchParams(location.search);
  cat  ? params.set('cat', cat)  : params.delete('cat');
  type ? params.set('type', type): params.delete('type');
  location.search = params.toString();
}

/* ===== 人気パーツ（固定） ===== */
const POPULAR_IDS = ['bolt-hex-m6', 'cap-m6', 'brg-6204', 'gear-sp-m2-20t', 'frame-40x40', 'lg-hsr15'];
