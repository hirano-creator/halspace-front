'use strict';

const user = requireSpaceAuth();
if (!user) throw new Error('未認証');
renderSidebarUser(user);
document.getElementById('adminLink').style.display = '';
if (!isAdmin(user)) {
  alert('このページにはアクセスできません。');
  location.href = 'dashboard.html';
}

const ROLE_LABEL = { general:'一般会員', admin:'管理者', super_admin:'スーパー管理者' };
const SOLID_TYPE_LABEL = { jp_client:'発注担当', id_modeler:'モデラー' };

/* ── インメモリキャッシュ ── */
let allCompanies = [];
let allUsers     = [];

/* ============================================================
   タブ切り替え
   ============================================================ */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

/* ============================================================
   ユーティリティ
   ============================================================ */
function daysUntil(dateStr) {
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
}
function formatBytesAdmin(bytes) {
  if (!bytes) return '0 B';
  if (bytes >= 1073741824) return (bytes/1073741824).toFixed(1)+' GB';
  if (bytes >= 1048576)    return (bytes/1048576).toFixed(1)+' MB';
  return (bytes/1024).toFixed(0)+' KB';
}

/* ============================================================
   会社データ取得（ユーザー管理タブの会社フィルタ・招待用に使用）
   ============================================================ */
async function loadCompanies() {
  try {
    const data = await api.get('/admin/companies');
    allCompanies = data?.companies ?? [];
  } catch {
    allCompanies = (MOCK?.companies ?? []);
  }
  populateCompanyFilter('filterUserCompany', allCompanies);
  populateInviteCompany(allCompanies);
}

/* ============================================================
   タブ1: ユーザー管理
   ============================================================ */
async function loadUsers() {
  try {
    const data = await api.get('/admin/users');
    allUsers = data?.users ?? [];
  } catch {
    allUsers = [];
  }
  renderUsers();
}

function renderUsers() {
  const cFilter  = document.getElementById('filterUserCompany').value;
  const rFilter  = document.getElementById('filterUserRole').value;
  const stFilter = document.getElementById('filterUserSolidType').value;
  let us = allUsers;
  if (cFilter) us = us.filter(u => String(u.company_id) === cFilter);
  if (rFilter) us = us.filter(u => u.role === rFilter);
  if (stFilter) us = us.filter(u => u.solid_type === stFilter);

  const tbody = document.getElementById('userBody');
  if (!us.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:32px;">該当するユーザーがいません</td></tr>';
    return;
  }
  tbody.innerHTML = us.map(u => `
    <tr style="cursor:pointer;" data-edit-user="${u.id}">
      <td style="font-size:12px;color:var(--muted);">${u.created_at||'—'}</td>
      <td style="font-weight:600;">${u.name}</td>
      <td style="font-size:13px;color:var(--muted);">${u.email}</td>
      <td style="font-size:13px;">${u.company_name??'—'}</td>
      <td>
        <span class="user-role-badge role-${u.role}">${ROLE_LABEL[u.role]??u.role}</span>
        ${u.solid_type ? `<span class="user-role-badge solid-type-${u.solid_type}">${SOLID_TYPE_LABEL[u.solid_type]??u.solid_type}</span>` : ''}
      </td>
      <td style="font-size:13px;">${u.country === 'JP' ? '🇯🇵 日本' : '🇮🇩 インドネシア'}</td>
      <td style="font-size:12px;color:var(--muted);">${u.last_login_at||'—'}</td>
    </tr>`).join('');
}

document.getElementById('filterUserCompany').addEventListener('change', renderUsers);
document.getElementById('filterUserRole').addEventListener('change', renderUsers);
document.getElementById('filterUserSolidType').addEventListener('change', renderUsers);

/* ユーザー行クリック → 編集モーダル */
let editingUserId = null;
let editExtraEmails = [];

document.getElementById('userBody').addEventListener('click', e => {
  const row = e.target.closest('tr[data-edit-user]');
  if (!row) return;
  openEditUserModal(Number(row.dataset.editUser));
});

async function openEditUserModal(userId) {
  editingUserId = userId;
  const u = allUsers.find(u => u.id === userId);
  if (!u) return;

  document.getElementById('editUserModalTitle').textContent = u.name + ' の設定';
  document.getElementById('editUserId').value = userId;
  document.getElementById('editUserRole').value = u.role;
  document.getElementById('editUserSolidType').value = u.solid_type ?? '';

  // 通知設定を取得
  const data = await api.get(`/admin/users/${userId}/notification-settings`);
  const s = data?.setting || { modeling_completed_enabled: true, expiring_file_enabled: true, extra_emails: [] };
  document.getElementById('editToggleModeling').checked = s.modeling_completed_enabled;
  document.getElementById('editToggleExpiring').checked = s.expiring_file_enabled;
  editExtraEmails = s.extra_emails || [];
  renderEditExtraEmails();

  document.getElementById('editUserModal').classList.remove('hidden');
}

function renderEditExtraEmails() {
  const list = document.getElementById('editExtraEmailList');
  list.innerHTML = editExtraEmails.map((email, i) => `
    <div style="display:flex;gap:8px;align-items:center;">
      <input type="email" class="form-input" value="${email}" style="flex:1;"
             oninput="editExtraEmails[${i}]=this.value">
      <button class="btn btn-outline btn-sm" onclick="removeEditExtraEmail(${i})"
              style="color:var(--danger);border-color:var(--danger);flex-shrink:0;">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>
  `).join('');
}

function removeEditExtraEmail(i) {
  editExtraEmails.splice(i, 1);
  renderEditExtraEmails();
}

document.getElementById('editAddExtraEmailBtn').addEventListener('click', () => {
  editExtraEmails.push('');
  renderEditExtraEmails();
  const inputs = document.querySelectorAll('#editExtraEmailList input[type=email]');
  if (inputs.length) inputs[inputs.length - 1].focus();
});

['editUserModalClose', 'editUserModalCancel'].forEach(id =>
  document.getElementById(id).addEventListener('click', () => {
    document.getElementById('editUserModal').classList.add('hidden');
    editingUserId = null;
    editExtraEmails = [];
  }));

document.getElementById('editUserModalSubmit').addEventListener('click', async () => {
  if (!editingUserId) return;
  const role = document.getElementById('editUserRole').value;
  const solidType = document.getElementById('editUserSolidType').value || null;
  const validEmails = editExtraEmails.filter(e => e.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()));

  const btn = document.getElementById('editUserModalSubmit');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    // ロール・種別変更
    await api.patch(`/admin/users/${editingUserId}`, { role, solid_type: solidType });
    const idx = allUsers.findIndex(u => u.id === editingUserId);
    if (idx !== -1) { allUsers[idx].role = role; allUsers[idx].solid_type = solidType; }

    // 通知設定保存
    await api.patch(`/admin/users/${editingUserId}/notification-settings`, {
      modeling_completed_enabled: document.getElementById('editToggleModeling').checked,
      expiring_file_enabled:      document.getElementById('editToggleExpiring').checked,
      extra_emails:               validEmails,
    });

    document.getElementById('editUserModal').classList.add('hidden');
    editingUserId = null;
    editExtraEmails = [];
    renderUsers();
    showToast('ユーザー設定を保存しました', 'success');
  } catch (err) {
    showToast('保存に失敗しました: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> 保存';
  }
});

function openInviteModal() {
  editingUserId = null;
  document.querySelector('#userModal .modal-title').textContent = 'ユーザーを招待';
  document.getElementById('inviteName').value    = '';
  document.getElementById('inviteEmail').value   = '';
  document.getElementById('inviteName').disabled  = false;
  document.getElementById('inviteEmail').disabled = false;
  document.getElementById('inviteCompany').disabled = false;
  document.getElementById('inviteRole').value = 'general';
  document.getElementById('inviteSolidType').value = '';
  document.getElementById('userModalSubmit').innerHTML =
    '<i class="fa-solid fa-paper-plane"></i> ユーザーを追加する';
  document.getElementById('userModal').classList.remove('hidden');
}

document.getElementById('inviteUserBtn').addEventListener('click', openInviteModal);
['userModalClose','userModalClose2'].forEach(id =>
  document.getElementById(id).addEventListener('click', () => {
    document.getElementById('userModal').classList.add('hidden');
    document.getElementById('inviteName').disabled  = false;
    document.getElementById('inviteEmail').disabled = false;
    document.getElementById('inviteCompany').disabled = false;
    editingUserId = null;
  }));

document.getElementById('userModalSubmit').addEventListener('click', async () => {
  const name    = document.getElementById('inviteName').value.trim();
  const email   = document.getElementById('inviteEmail').value.trim();
  const compSel = document.getElementById('inviteCompany');
  const role    = document.getElementById('inviteRole').value;
  const solidType = document.getElementById('inviteSolidType').value || null;

  const btn = document.getElementById('userModalSubmit');
  btn.disabled = true;
  const origLabel = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    if (editingUserId !== null) {
      /* ── ロール変更 ── */
      const data = await api.patch(`/admin/users/${editingUserId}`, { role, solid_type: solidType });
      const idx = allUsers.findIndex(u => u.id === editingUserId);
      if (idx !== -1) { allUsers[idx].role = role; allUsers[idx].solid_type = solidType; }
      document.getElementById('userModal').classList.add('hidden');
      document.getElementById('inviteName').disabled  = false;
      document.getElementById('inviteEmail').disabled = false;
      document.getElementById('inviteCompany').disabled = false;
      editingUserId = null;
      renderUsers();
      showToast('ロールを変更しました', 'success');
    } else {
      /* ── ユーザー追加 ── */
      if (!name || !email) { showToast('名前とメールアドレスは必須です', 'danger'); return; }
      const country = solidType === 'id_modeler' ? 'ID' : 'JP';
      const data = await api.post('/admin/users', {
        name, email,
        password: 'password',  // 初期パスワード（実運用では変更必須）
        role, solid_type: solidType, country,
        company_id: Number(compSel.value),
      });
      allUsers.push(data.user);
      document.getElementById('userModal').classList.add('hidden');
      renderUsers();
      showToast('ユーザーを追加しました（初期パスワード: password）', 'success');
    }
  } catch (err) {
    showToast('操作に失敗しました: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origLabel;
  }
});

/* ============================================================
   タブ2: 自動削除管理
   ============================================================ */
async function loadCleanup() {
  try {
    const data = await api.get('/admin/expiring-files');
    renderCleanup(data?.projects ?? []);
  } catch {
    renderCleanup([]);
  }
}

function renderCleanup(items) {
  const soon  = items.filter(e => daysUntil(e.expires_at) <= 7);
  const warn  = items.filter(e => daysUntil(e.expires_at) <= 14);

  document.getElementById('cntExpireSoon').textContent = soon.length;
  document.getElementById('cntExpireWarn').textContent = warn.length;
  document.getElementById('totalStorage').textContent  = items.length + '件';

  const list = document.getElementById('expireList');
  if (!items.length) {
    list.innerHTML = '<p style="color:var(--muted);padding:16px 0;">削除予定のプロジェクトはありません</p>';
    return;
  }
  list.innerHTML = items.map(e => {
    const days = daysUntil(e.expires_at);
    const cls  = days <= 7 ? 'expire-soon' : days <= 14 ? 'expire-warn' : 'expire-ok';
    const icon = days <= 7 ? 'fa-triangle-exclamation' : 'fa-clock';
    return `<div class="expire-item">
      <div class="expire-info">
        <span class="expire-title">${e.title}</span>
        <span class="expire-meta">
          <code style="color:var(--blue);font-size:11px;">${e.project_code}</code>
          · ${e.company_name??'—'}
          · ${e.file_count??0}ファイル
        </span>
      </div>
      <div class="expire-countdown ${cls}">
        <i class="fa-solid ${icon}"></i><br>
        あと ${days}日<br>
        <span style="font-size:11px;font-weight:400;">${e.expires_at}</span>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('cleanupNowBtn').addEventListener('click', async () => {
  if (!confirm('期限切れのプロジェクトファイルを今すぐ削除します。この操作は取り消せません。')) return;
  const btn = document.getElementById('cleanupNowBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 削除中...';
  try {
    const data = await api.post('/admin/cleanup', {});
    showToast(data.message || 'ファイルを削除しました', 'success');
    await loadCleanup();
  } catch (err) {
    showToast('削除に失敗しました: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-trash-can"></i> 今すぐ削除実行';
  }
});

/* ============================================================
   フィルターセレクトの動的生成
   ============================================================ */
function populateCompanyFilter(selectId, companies) {
  const sel = document.getElementById(selectId);
  /* 先頭の「全会社」オプション以外を削除して再生成 */
  while (sel.options.length > 1) sel.remove(1);
  companies.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.name;
    sel.appendChild(o);
  });
}

function populateInviteCompany(companies) {
  const sel = document.getElementById('inviteCompany');
  sel.innerHTML = '';
  companies.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.name;
    sel.appendChild(o);
  });
}

/* ============================================================
   初期化（会社 → ユーザー・削除管理を並行ロード）
   ============================================================ */
async function init() {
  await loadCompanies();
  await Promise.all([loadUsers(), loadCleanup()]);
}
init();
