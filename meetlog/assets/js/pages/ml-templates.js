'use strict';
/* MeetLog テンプレート管理（管理者向け） */

let templates = [];
let editingId = null;
let dragSrcIdx = null;

/* ────────────────────────────
   初期化
──────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  const user = requireAuth();
  if (!user) return;

  // 管理者以外はダッシュボードへ
  if (user.role !== 'admin' && user.role !== 'super_admin') {
    location.href = 'dashboard.html';
    return;
  }

  renderSidebarUser(user);
  initModalEvents();
  await loadTemplates();
});

function requireAuth() {
  if (typeof solidRequireAuth === 'function') return solidRequireAuth();
  const raw = localStorage.getItem('space_user');
  if (!raw) { location.href = '../../../space/login.html'; return null; }
  return JSON.parse(raw);
}

function renderSidebarUser(user) {
  const el = document.getElementById('sidebarUser');
  if (!el) return;
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 0;font-size:13px;">
      <div style="width:30px;height:30px;border-radius:50%;background:var(--ml-accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0;">
        ${(user.name || user.email || '?')[0].toUpperCase()}
      </div>
      <div style="min-width:0;">
        <div style="font-weight:700;color:var(--primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${user.name || ''}</div>
        <div style="font-size:11px;color:var(--muted);">${user.role}</div>
      </div>
    </div>`;
}

/* ────────────────────────────
   一覧取得・描画
──────────────────────────── */
async function loadTemplates() {
  showLoading(true);
  templates = await mlGetTemplates();
  renderTemplates();
  showLoading(false);
}

function renderTemplates() {
  const list  = document.getElementById('tplList');
  const wrap  = document.getElementById('tplListWrap');
  const empty = document.getElementById('emptyMsg');
  const count = document.getElementById('tplCount');

  count.textContent = templates.length ? `${templates.length} 件` : '';

  if (!templates.length) {
    wrap.style.display  = 'none';
    empty.style.display = '';
    return;
  }

  wrap.style.display  = '';
  empty.style.display = 'none';

  list.innerHTML = templates.map((t, i) => `
    <div class="tpl-card" draggable="true" data-idx="${i}" data-id="${t.id}"
      ondragstart="onDragStart(event,${i})"
      ondragover="onDragOver(event)"
      ondrop="onDrop(event,${i})"
      ondragend="onDragEnd()">
      <span class="tpl-drag-handle" title="ドラッグして並び替え">
        <i class="fa-solid fa-grip-vertical"></i>
      </span>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:15px;font-weight:700;color:var(--primary);">${escHtml(t.name)}</span>
          ${t.is_default ? '<span style="font-size:11px;font-weight:700;color:var(--ml-accent);background:var(--ml-accent-lt);padding:2px 8px;border-radius:20px;">デフォルト</span>' : ''}
        </div>
        <div class="tpl-body-preview">${escHtml(t.body)}</div>
      </div>
      <div class="tpl-actions">
        <button class="btn btn-outline btn-sm" onclick="openEditModal(${i})">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn btn-ghost btn-sm" onclick="deleteTpl(${t.id})" style="color:var(--red);">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>`).join('');
}

/* ────────────────────────────
   モーダル
──────────────────────────── */
function initModalEvents() {
  document.getElementById('newTplBtn').addEventListener('click', openNewModal);
  document.getElementById('tplModalClose').addEventListener('click', closeModal);
  document.getElementById('tplModalCancel').addEventListener('click', closeModal);
  document.getElementById('tplModalSave').addEventListener('click', saveTemplate);

  // モーダル外クリックで閉じる
  document.getElementById('tplModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
}

function openNewModal() {
  editingId = null;
  document.getElementById('tplModalTitle').innerHTML =
    '<i class="fa-solid fa-layer-group" style="color:var(--ml-accent);"></i> テンプレートを追加';
  document.getElementById('tplNameInput').value  = '';
  document.getElementById('tplBodyInput').value  = '';
  document.getElementById('tplIsDefault').checked = false;
  document.getElementById('tplModal').classList.remove('hidden');
  document.getElementById('tplNameInput').focus();
}

function openEditModal(idx) {
  const t = templates[idx];
  editingId = t.id;
  document.getElementById('tplModalTitle').innerHTML =
    '<i class="fa-solid fa-pen" style="color:var(--ml-accent);"></i> テンプレートを編集';
  document.getElementById('tplNameInput').value   = t.name;
  document.getElementById('tplBodyInput').value   = t.body;
  document.getElementById('tplIsDefault').checked = !!t.is_default;
  document.getElementById('tplModal').classList.remove('hidden');
  document.getElementById('tplNameInput').focus();
}

function closeModal() {
  document.getElementById('tplModal').classList.add('hidden');
}

async function saveTemplate() {
  const name      = document.getElementById('tplNameInput').value.trim();
  const body      = document.getElementById('tplBodyInput').value;
  const isDefault = document.getElementById('tplIsDefault').checked;

  if (!name) {
    mlShowToast('テンプレート名を入力してください', 'warning');
    document.getElementById('tplNameInput').focus();
    return;
  }

  const btn = document.getElementById('tplModalSave');
  btn.disabled = true;

  const data = { name, body, is_default: isDefault };

  let result;
  if (editingId) {
    result = await mlUpdateTemplate(editingId, data);
  } else {
    data.sort_order = templates.length;
    result = await mlCreateTemplate(data);
  }

  btn.disabled = false;

  if (!result) {
    mlShowToast('保存に失敗しました', 'danger');
    return;
  }

  closeModal();
  mlShowToast(editingId ? 'テンプレートを更新しました' : 'テンプレートを追加しました', 'success');
  await loadTemplates();
}

async function deleteTpl(id) {
  if (!confirm('このテンプレートを削除しますか？')) return;
  const ok = await mlDeleteTemplate(id);
  if (ok) {
    mlShowToast('削除しました');
    await loadTemplates();
  } else {
    mlShowToast('削除に失敗しました', 'danger');
  }
}

/* ────────────────────────────
   ドラッグ＆ドロップ並び替え
──────────────────────────── */
function onDragStart(e, idx) {
  dragSrcIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.style.opacity = '.5';
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function onDrop(e, idx) {
  e.stopPropagation();
  if (dragSrcIdx === null || dragSrcIdx === idx) return;

  const moved = templates.splice(dragSrcIdx, 1)[0];
  templates.splice(idx, 0, moved);
  renderTemplates();

  const ids = templates.map(t => t.id);
  mlReorderTemplates(ids).then(ok => {
    if (!ok) mlShowToast('並び替えの保存に失敗しました', 'danger');
  });
}

function onDragEnd() {
  dragSrcIdx = null;
  document.querySelectorAll('.tpl-card').forEach(el => { el.style.opacity = ''; });
}

/* ────────────────────────────
   ユーティリティ
──────────────────────────── */
function showLoading(show) {
  document.getElementById('loadingArea').style.display  = show ? '' : 'none';
  document.getElementById('tplListWrap').style.display  = show ? 'none' : '';
  document.getElementById('emptyMsg').style.display     = 'none';
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function solidLogout() {
  location.href = '../../../space/apps.html';
}
