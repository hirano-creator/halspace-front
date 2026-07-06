'use strict';

const user = requireSpaceAuth();
if (!user) throw new Error('未認証');
renderSidebarUser(user);
document.getElementById('adminLink').style.display = '';
if (!isAdmin(user)) {
  alert('このページにはアクセスできません。');
  location.href = 'dashboard.html';
}

const STATUS_LABEL = {
  draft:'下書き', submitted:'提出済み', in_progress:'モデリング中',
  review_pending:'検査待ち', revision_requested:'修正依頼中',
  approved:'承認済み', delivered:'納品完了', cancelled:'キャンセル',
};
const PRIORITY_LABEL = { urgent:'緊急', high:'高', normal:'通常', low:'低' };
const PLAN_LABEL = { trial:'トライアル', standard:'スタンダード', pro:'プロ' };
const ROLE_LABEL = { general:'一般会員', admin:'管理者', super_admin:'スーパー管理者' };
const SOLID_TYPE_LABEL = { jp_client:'発注担当', id_modeler:'モデラー' };

/* ── インメモリキャッシュ ── */
let allProjects  = [];
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
function isNearDeadline(dateStr) {
  if (!dateStr) return false;
  const diff = (new Date(dateStr) - new Date()) / 86400000;
  return diff >= 0 && diff <= 3;
}
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
   タブ1: 全プロジェクト
   ============================================================ */
async function loadProjects() {
  try {
    const data = await api.get('/projects');
    allProjects = data?.projects ?? [];
  } catch {
    allProjects = (MOCK?.projects ?? []);
  }
  populateCompanyFilter('filterCompany', allCompanies);
  renderProjects();
}

function renderProjects() {
  const cFilter = document.getElementById('filterCompany').value;
  const sFilter = document.getElementById('filterStatus').value;
  let ps = allProjects;
  if (cFilter) ps = ps.filter(p => String(p.company_id) === cFilter);
  if (sFilter) ps = ps.filter(p => p.status === sFilter);

  const tbody = document.getElementById('adminProjectBody');
  if (!ps.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:32px;">該当するプロジェクトがありません</td></tr>';
    return;
  }
  tbody.innerHTML = ps.map(p => {
    const deadlineAlert = isNearDeadline(p.deadline_at) && !['approved','delivered','cancelled'].includes(p.status)
      ? '<i class="fa-solid fa-triangle-exclamation" style="color:var(--danger);margin-left:4px;" title="期限3日以内"></i>' : '';
    return `<tr style="cursor:pointer;" onclick="location.href='project-detail.html?id=${p.id}'">
      <td><code style="color:var(--blue);font-size:12px;">${p.project_code}</code></td>
      <td>
        <span style="font-weight:600;">${p.title}</span>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${p.company_name ?? '—'}</div>
      </td>
      <td style="font-size:13px;color:var(--muted);">${p.modeler_name ?? '<span style="color:#ccc;">未割当</span>'}</td>
      <td><span class="badge badge-${p.status}">${STATUS_LABEL[p.status]||p.status}</span></td>
      <td><span class="priority-${p.priority}">${PRIORITY_LABEL[p.priority]||p.priority}</span></td>
      <td style="font-size:13px;">${p.deadline_at||'—'}${deadlineAlert}</td>
    </tr>`;
  }).join('');
}

document.getElementById('filterCompany').addEventListener('change', renderProjects);
document.getElementById('filterStatus').addEventListener('change', renderProjects);

/* ステータス変更モーダル */
let editingProjectId = null;
document.getElementById('adminProjectBody').addEventListener('click', e => {
  const btn = e.target.closest('[data-status-id]');
  if (!btn) return;
  editingProjectId = Number(btn.dataset.statusId);
  const proj = allProjects.find(p => p.id === editingProjectId);
  if (!proj) return;
  document.getElementById('statusModalDesc').textContent = `「${proj.title}」のステータスを変更します。`;
  document.getElementById('statusSelect').value = proj.status;
  document.getElementById('statusModal').classList.remove('hidden');
});
['statusModalClose','statusModalClose2'].forEach(id =>
  document.getElementById(id).addEventListener('click', () =>
    document.getElementById('statusModal').classList.add('hidden')));

document.getElementById('statusModalSubmit').addEventListener('click', async () => {
  const newStatus = document.getElementById('statusSelect').value;
  const btn = document.getElementById('statusModalSubmit');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    await api.patch(`/projects/${editingProjectId}/status`, { status: newStatus });
    const idx = allProjects.findIndex(p => p.id === editingProjectId);
    if (idx !== -1) allProjects[idx].status = newStatus;
    document.getElementById('statusModal').classList.add('hidden');
    renderProjects();
    showToast('ステータスを変更しました', 'success');
  } catch (err) {
    showToast('変更に失敗しました: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-pen"></i> 変更する';
  }
});

/* ============================================================
   タブ2: 会社管理
   ============================================================ */
async function loadCompanies() {
  try {
    const data = await api.get('/admin/companies');
    allCompanies = data?.companies ?? [];
  } catch {
    allCompanies = (MOCK?.companies ?? []);
  }
  renderCompanies();
  renderContractWarningBanner();
  populateCompanyFilter('filterCompany', allCompanies);
  populateCompanyFilter('filterUserCompany', allCompanies);
  populateInviteCompany(allCompanies);
}

function renderContractWarningBanner() {
  const warnings = allCompanies.filter(c => c.contract_expiry_warning);
  const existing = document.getElementById('contractWarningBanner');
  if (existing) existing.remove();
  if (!warnings.length) return;

  const names = warnings.map(c => {
    const days = c.contract_days_left ?? '?';
    return `<strong>${c.name}</strong>（残り ${days} 日）`;
  }).join('、');

  const banner = document.createElement('div');
  banner.id = 'contractWarningBanner';
  banner.style.cssText = `
    background:rgba(253,203,110,.2);border:1px solid #fdcb6e;border-radius:10px;
    padding:12px 16px;margin-bottom:20px;display:flex;align-items:flex-start;gap:10px;
    font-size:13px;color:#7d5200;
  `;
  banner.innerHTML = `
    <i class="fa-solid fa-triangle-exclamation" style="font-size:16px;color:#e17055;flex-shrink:0;margin-top:1px;"></i>
    <div>
      <strong>年間契約の更新期限が近づいています</strong><br>
      <span style="font-size:12px;">${names} — 請求手続きをお忘れなく。</span>
    </div>`;

  const tabPane = document.getElementById('tab-companies');
  tabPane.insertBefore(banner, tabPane.firstChild);
}

const BILLING_LABEL = { subscription:'月次サブスク', annual:'年間契約' };

function formatPrice(price) {
  if (!price && price !== 0) return '—';
  return '¥' + Number(price).toLocaleString('ja-JP');
}

function contractExpiryBadge(c) {
  if (c.billing_type !== 'annual' || !c.contract_end_date) return '';
  const days = Math.ceil((new Date(c.contract_end_date) - new Date()) / 86400000);
  if (days < 0) {
    return `<div style="margin-top:8px;padding:6px 10px;border-radius:8px;background:rgba(225,112,85,.12);
            color:var(--danger);font-size:11px;font-weight:700;display:flex;align-items:center;gap:6px;">
              <i class="fa-solid fa-circle-exclamation"></i>
              契約期限切れ（${c.contract_end_date}）
            </div>`;
  }
  if (days <= 30) {
    return `<div style="margin-top:8px;padding:6px 10px;border-radius:8px;background:rgba(253,203,110,.2);
            color:#b8690f;font-size:11px;font-weight:700;display:flex;align-items:center;gap:6px;">
              <i class="fa-solid fa-triangle-exclamation"></i>
              契約終了まで残り ${days} 日（${c.contract_end_date}）— 請求確認を忘れずに
            </div>`;
  }
  return `<div style="margin-top:8px;font-size:11px;color:var(--muted);display:flex;align-items:center;gap:5px;">
            <i class="fa-solid fa-calendar-check"></i> 契約終了: ${c.contract_end_date}（残り ${days} 日）
          </div>`;
}

function renderCompanies() {
  const grid = document.getElementById('companyGrid');

  // 警告ありを先頭に
  const sorted = [...allCompanies].sort((a, b) => {
    const wa = a.contract_expiry_warning ? 0 : 1;
    const wb = b.contract_expiry_warning ? 0 : 1;
    return wa - wb;
  });

  grid.innerHTML = sorted.map(c => `
    <div class="company-card ${c.is_active ? '' : 'inactive'}">
      <div class="company-card-head">
        <div>
          <div class="company-name">${c.name}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px;">/${c.slug}</div>
        </div>
        <span class="plan-badge plan-${c.plan}">${PLAN_LABEL[c.plan]??c.plan}</span>
      </div>
      <div class="company-meta">
        <span><i class="fa-solid fa-users" style="font-size:11px;"></i> ${c.users_count??c.users??0}人</span>
        <span><i class="fa-solid fa-folder" style="font-size:11px;"></i> ${c.projects_count??c.projects??0}件</span>
        <span style="margin-left:auto;">
          ${c.is_active
            ? '<span style="color:var(--accent);font-weight:700;font-size:12px;"><i class="fa-solid fa-circle" style="font-size:8px;"></i> 有効</span>'
            : '<span style="color:var(--muted);font-size:12px;"><i class="fa-solid fa-circle" style="font-size:8px;"></i> 無効</span>'}
        </span>
      </div>
      <!-- 契約情報 -->
      <div style="border-top:1px solid var(--border);margin:10px 0;padding-top:10px;display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:11px;color:var(--muted);">
            <i class="fa-solid fa-rotate" style="font-size:10px;"></i>
            ${BILLING_LABEL[c.billing_type] ?? '—'}
          </span>
          <span style="font-size:13px;font-weight:700;color:var(--dark);">${formatPrice(c.price)}</span>
        </div>
        ${c.contract_date ? `<div style="font-size:11px;color:var(--muted);"><i class="fa-solid fa-calendar-day" style="font-size:10px;"></i> 契約開始: ${c.contract_date}</div>` : ''}
        ${contractExpiryBadge(c)}
      </div>
      <div class="company-actions">
        <button class="btn btn-outline btn-sm" data-edit-company="${c.id}">
          <i class="fa-solid fa-pen"></i> 編集
        </button>
        <button class="btn btn-ghost btn-sm" data-toggle-company="${c.id}" data-active="${c.is_active?'1':'0'}"
                style="color:${c.is_active?'var(--danger)':'var(--accent)'};">
          <i class="fa-solid fa-${c.is_active?'ban':'circle-check'}"></i>
          ${c.is_active ? '無効化' : '有効化'}
        </button>
      </div>
    </div>`).join('');

  /* プラン統計 */
  const planColors = { trial:'#fdcb6e', standard:'#0984E3', pro:'#00B894' };
  const planDesc   = { trial:'無料お試し期間', standard:'標準プラン', pro:'フルプラン' };
  const plans = ['trial','standard','pro'];
  const total = allCompanies.length || 1;
  const counts = Object.fromEntries(plans.map(p => [p, allCompanies.filter(c => c.plan === p).length]));
  const active = allCompanies.filter(c => c.is_active).length;
  const inactive = allCompanies.length - active;

  /* ドーナツチャート用 SVG arc
     stroke-dashoffset で各セグメントの開始位置をずらす方式（rotate不要） */
  function donutArc(counts, colors, r, stroke) {
    const cx = 60, cy = 60;
    const circumference = 2 * Math.PI * r;
    const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    let accumulated = 0; // 12時スタート = dashoffset を circumference/4 から始める
    return Object.entries(counts).map(([key, val]) => {
      const pct  = val / total;
      const dash = circumference * pct;
      // dashoffset: circumference/4 引くと12時スタート、前の累積分を引く
      const offset = circumference * (0.25 - accumulated);
      const arc = `<circle cx="${cx}" cy="${cy}" r="${r}"
        fill="none" stroke="${colors[key]}" stroke-width="${stroke}"
        stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
        stroke-dashoffset="${offset.toFixed(2)}"
        style="transition:stroke-dasharray .6s ease;"/>`;
      accumulated += pct;
      return arc;
    }).join('');
  }

  const arcs = donutArc(counts, planColors, 42, 18);

  document.getElementById('planStats').innerHTML = `
    <div style="display:flex;align-items:center;gap:32px;padding:16px 8px;flex-wrap:wrap;">
      <!-- ドーナツチャート -->
      <div style="flex-shrink:0;position:relative;">
        <svg width="120" height="120" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="42" fill="none" stroke="var(--border)" stroke-width="18"/>
          ${arcs}
          <text x="60" y="55" text-anchor="middle" font-size="22" font-weight="700" fill="var(--dark)">${allCompanies.length}</text>
          <text x="60" y="71" text-anchor="middle" font-size="10" fill="var(--muted)">社</text>
        </svg>
      </div>
      <!-- プラン別カード -->
      <div style="flex:1;min-width:220px;">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;">
          ${plans.map(p => `
          <div style="background:var(--bg);border-radius:10px;padding:12px 10px;text-align:center;">
            <div style="font-size:22px;font-weight:800;color:${planColors[p]};">${counts[p]}</div>
            <div style="font-size:11px;font-weight:700;color:${planColors[p]};margin:2px 0;">${PLAN_LABEL[p]}</div>
            <div style="font-size:10px;color:var(--muted);">${planDesc[p]}</div>
          </div>`).join('')}
        </div>
        <!-- アクティブ/非アクティブ -->
        <div style="display:flex;gap:16px;padding-top:10px;border-top:1px solid var(--border);">
          <div style="display:flex;align-items:center;gap:6px;font-size:12px;">
            <span style="width:8px;height:8px;border-radius:50%;background:var(--accent);display:inline-block;"></span>
            <span style="color:var(--muted);">有効</span>
            <span style="font-weight:700;color:var(--dark);">${active}社</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;font-size:12px;">
            <span style="width:8px;height:8px;border-radius:50%;background:#b2bec3;display:inline-block;"></span>
            <span style="color:var(--muted);">無効</span>
            <span style="font-weight:700;color:var(--dark);">${inactive}社</span>
          </div>
          <div style="margin-left:auto;font-size:11px;color:var(--muted);">合計 ${allCompanies.length} 社</div>
        </div>
      </div>
    </div>`;
}

document.getElementById('companyGrid').addEventListener('click', async e => {
  const editBtn   = e.target.closest('[data-edit-company]');
  const toggleBtn = e.target.closest('[data-toggle-company]');

  if (editBtn) {
    const c = allCompanies.find(c => c.id === Number(editBtn.dataset.editCompany));
    if (!c) return;
    openCompanyModal(c);
  }

  if (toggleBtn) {
    const cid      = Number(toggleBtn.dataset.toggleCompany);
    const isActive = toggleBtn.dataset.active === '1';
    try {
      const data = await api.patch(`/admin/companies/${cid}`, { is_active: !isActive });
      const idx = allCompanies.findIndex(c => c.id === cid);
      if (idx !== -1) allCompanies[idx] = { ...allCompanies[idx], ...data.company };
      renderCompanies();
      showToast(`${allCompanies.find(c=>c.id===cid)?.name} を${!isActive?'有効化':'無効化'}しました`, !isActive?'success':'warning');
    } catch (err) {
      showToast('更新に失敗しました: ' + err.message, 'danger');
    }
  }
});

function openCompanyModal(c = null) {
  document.getElementById('companyModalTitle').textContent = c ? '会社を編集' : '会社を追加';
  document.getElementById('companyName').value             = c?.name ?? '';
  document.getElementById('companySlug').value             = c?.slug ?? '';
  document.getElementById('companyPlan').value             = c?.plan ?? 'trial';
  document.getElementById('companyBillingType').value      = c?.billing_type ?? 'subscription';
  document.getElementById('companyPrice').value            = c?.price ?? 150000;
  document.getElementById('companyContractDate').value     = c?.contract_date ?? '';
  document.getElementById('companyContractEndDate').value  = c?.contract_end_date ?? '';
  const modal = document.getElementById('companyModal');
  if (c) modal.dataset.editId = c.id; else delete modal.dataset.editId;
  updateContractEndRow();
  modal.classList.remove('hidden');
}

function updateContractEndRow() {
  const isAnnual = document.getElementById('companyBillingType').value === 'annual';
  document.getElementById('contractEndRow').style.display = isAnnual ? '' : 'none';
  document.getElementById('companyPriceLabel').textContent = isAnnual ? '年額（円）' : '月額（円）';
}

document.getElementById('companyBillingType').addEventListener('change', updateContractEndRow);

document.getElementById('addCompanyBtn').addEventListener('click', () => openCompanyModal());

['companyModalClose','companyModalClose2'].forEach(id =>
  document.getElementById(id).addEventListener('click', () =>
    document.getElementById('companyModal').classList.add('hidden')));

document.getElementById('companyModalSubmit').addEventListener('click', async () => {
  const name        = document.getElementById('companyName').value.trim();
  const plan        = document.getElementById('companyPlan').value;
  const billingType = document.getElementById('companyBillingType').value;
  const price       = parseInt(document.getElementById('companyPrice').value, 10) || 0;
  const contractDate    = document.getElementById('companyContractDate').value || null;
  const contractEndDate = document.getElementById('companyContractEndDate').value || null;
  if (!name) { showToast('会社名は必須です', 'danger'); return; }

  const editId = document.getElementById('companyModal').dataset.editId;
  const btn = document.getElementById('companyModalSubmit');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  const payload = { name, plan, billing_type: billingType, price, contract_date: contractDate, contract_end_date: contractEndDate };

  try {
    if (editId) {
      const data = await api.patch(`/admin/companies/${editId}`, payload);
      const idx = allCompanies.findIndex(c => c.id === Number(editId));
      if (idx !== -1) allCompanies[idx] = { ...allCompanies[idx], ...data.company };
      showToast('会社情報を更新しました', 'success');
    } else {
      const data = await api.post('/admin/companies', payload);
      allCompanies.push(data.company);
      showToast('会社を追加しました', 'success');
    }
    document.getElementById('companyModal').classList.add('hidden');
    renderCompanies();
    populateInviteCompany(allCompanies);
  } catch (err) {
    showToast('保存に失敗しました: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> 保存';
  }
});

/* ============================================================
   タブ3: ユーザー管理
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
   タブ4: 自動削除管理
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
   初期化（会社 → プロジェクト・ユーザー・削除管理を並行ロード）
   ============================================================ */
async function init() {
  await loadCompanies();
  await Promise.all([loadProjects(), loadUsers(), loadCleanup()]);
}
init();

// タブ表示中は30秒ごと＋タブ復帰時に即時、プロジェクト一覧を自動更新
startAutoRefresh(loadProjects, 30000);
