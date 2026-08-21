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

/* このアプリのキー。ユーザー一覧はこのアプリを利用できる人だけをサーバー側で絞って取得する。 */
const APP_KEY = 'solid';
const USER_PER_PAGE = 20;

const IS_SUPER = isSuperAdmin(user);

/* ── インメモリキャッシュ ── */
let allCompanies = [];
let allUsers     = [];
let userPage     = 1;

/* テーブル・トーストはinnerHTMLで組み立てるため、DB由来の文字列は必ずエスケープする */
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

/* ============================================================
   権限に応じたUIの出し分け
   （adminは自社スコープ。super_adminロールの付与・他社の閲覧はできない）
   ============================================================ */
if (!IS_SUPER) {
  document.getElementById('optFilterRoleSuperAdmin')?.remove();
  document.getElementById('optEditRoleSuperAdmin')?.remove();
  /* 自社ユーザーしか返らないため会社フィルタは意味を持たない */
  document.getElementById('filterUserCompany').style.display = 'none';
  /* 通知先はHaLSpace／PT.HILANOの社内アドレス。発注者会社のadminに見せると
     取引先の内部連絡先が漏れる（サーバー側もsuper_admin限定で弾いている） */
  document.getElementById('tabBtnNotify')?.remove();
  document.getElementById('tab-notify')?.remove();
}

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
    /* Space.appの管理画面と同じエンドポイント。?app= でSOLIDを利用できるユーザーだけに絞る */
    const data = await api.get(`/admin/users?app=${APP_KEY}`);
    allUsers = data?.data ?? [];
  } catch (err) {
    allUsers = [];
    showToast('ユーザー一覧を取得できませんでした: ' + esc(err.message), 'danger');
  }
  userPage = 1;
  renderUsers();
}

function filteredUsers() {
  const q        = document.getElementById('filterUserSearch').value.trim().toLowerCase();
  const cFilter  = document.getElementById('filterUserCompany').value;
  const rFilter  = document.getElementById('filterUserRole').value;
  const stFilter = document.getElementById('filterUserSolidType').value;

  return allUsers.filter(u => {
    if (q && !`${u.name} ${u.email}`.toLowerCase().includes(q)) return false;
    if (cFilter && String(u.company_id) !== cFilter) return false;
    if (rFilter && u.role !== rFilter) return false;
    if (stFilter && u.solid_type !== stFilter) return false;
    return true;
  });
}

function renderUsers() {
  const us    = filteredUsers();
  const pages = Math.max(1, Math.ceil(us.length / USER_PER_PAGE));
  if (userPage > pages) userPage = pages;
  const sliced = us.slice((userPage - 1) * USER_PER_PAGE, userPage * USER_PER_PAGE);

  const tbody = document.getElementById('userBody');
  if (!sliced.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:32px;">該当するユーザーがいません</td></tr>';
    renderUserPagination(1, 1, 0);
    return;
  }
  tbody.innerHTML = sliced.map(u => `
    <tr style="cursor:pointer;${u.is_active ? '' : 'opacity:.55;'}" data-edit-user="${u.id}">
      <td style="font-size:12px;color:var(--muted);">${esc(u.created_at) || '—'}</td>
      <td style="font-weight:600;">${esc(u.name)}</td>
      <td style="font-size:13px;color:var(--muted);">${esc(u.email)}</td>
      <td style="font-size:13px;">${esc(u.company?.name) || '—'}</td>
      <td>
        <span class="user-role-badge role-${esc(u.role)}">${esc(ROLE_LABEL[u.role] ?? u.role)}</span>
        ${u.solid_type ? `<span class="user-role-badge solid-type-${esc(u.solid_type)}">${esc(SOLID_TYPE_LABEL[u.solid_type] ?? u.solid_type)}</span>` : ''}
      </td>
      <td style="font-size:13px;">${u.country === 'JP' ? '🇯🇵 日本' : '🇮🇩 インドネシア'}</td>
      <td style="font-size:12px;color:var(--muted);">${esc(u.last_login_at) || '—'}</td>
      <td>
        <label class="toggle-switch" data-stop>
          <input type="checkbox" ${u.is_active ? 'checked' : ''} data-toggle-user="${u.id}">
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td>
        ${u.id === user.id ? '' : `
        <button class="row-action-btn danger" data-delete-user="${u.id}" title="削除">
          <i class="fa-solid fa-trash"></i>
        </button>`}
      </td>
    </tr>`).join('');

  renderUserPagination(userPage, pages, us.length);
}

function renderUserPagination(current, pages, total) {
  const el = document.getElementById('userPagination');
  if (pages <= 1) {
    el.innerHTML = total ? `<span class="page-info">全 ${total} 件</span>` : '';
    return;
  }
  /* 現在ページの前後2件だけを出し、離れたページは「…」で省略する */
  const nums = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - current) <= 2) nums.push(p);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }

  el.innerHTML = `
    <button data-page="${current - 1}" ${current === 1 ? 'disabled' : ''}>
      <i class="fa-solid fa-chevron-left"></i>
    </button>
    ${nums.map(p => p === '…'
      ? '<button disabled>…</button>'
      : `<button data-page="${p}" class="${p === current ? 'current' : ''}">${p}</button>`).join('')}
    <button data-page="${current + 1}" ${current === pages ? 'disabled' : ''}>
      <i class="fa-solid fa-chevron-right"></i>
    </button>
    <span class="page-info">全 ${total} 件</span>`;
}

document.getElementById('userPagination').addEventListener('click', e => {
  const btn = e.target.closest('button[data-page]');
  if (!btn || btn.disabled) return;
  userPage = Number(btn.dataset.page);
  renderUsers();
});

['filterUserCompany', 'filterUserRole', 'filterUserSolidType'].forEach(id =>
  document.getElementById(id).addEventListener('change', () => { userPage = 1; renderUsers(); }));
document.getElementById('filterUserSearch').addEventListener('input', () => { userPage = 1; renderUsers(); });

/* ============================================================
   有効/無効の切り替え・削除
   ============================================================ */
async function toggleUserActive(id, active, checkbox) {
  try {
    await api.patch(`/admin/users/${id}`, { is_active: active });
    const u = allUsers.find(x => x.id === id);
    if (u) u.is_active = active;
    renderUsers();
    showToast(active ? 'ユーザーを有効にしました' : 'ユーザーを無効にしました', active ? 'success' : '');
  } catch (err) {
    checkbox.checked = !active;   // サーバーに拒否されたらUIを元へ戻す
    showToast('更新に失敗しました: ' + esc(err.message), 'danger');
  }
}

async function deleteUser(id) {
  const u = allUsers.find(x => x.id === id);
  if (!u) return;
  if (!confirm(`「${u.name}」を削除しますか？この操作は取り消せません。\nSpace.app側の一覧からも削除されます。`)) return;

  try {
    await api.delete(`/admin/users/${id}`);
    allUsers = allUsers.filter(x => x.id !== id);
    renderUsers();
    showToast('ユーザーを削除しました', 'success');
  } catch (err) {
    showToast('削除に失敗しました: ' + esc(err.message), 'danger');
  }
}

/* ユーザー行クリック → 編集モーダル */
let editingUserId = null;
let editExtraEmails = [];

document.getElementById('userBody').addEventListener('click', e => {
  /* 有効トグルと削除ボタンは行クリック（編集モーダル）と競合させない */
  const del = e.target.closest('button[data-delete-user]');
  if (del) { deleteUser(Number(del.dataset.deleteUser)); return; }
  if (e.target.closest('[data-stop]')) return;

  const row = e.target.closest('tr[data-edit-user]');
  if (!row) return;
  openEditUserModal(Number(row.dataset.editUser));
});

document.getElementById('userBody').addEventListener('change', e => {
  const cb = e.target.closest('input[data-toggle-user]');
  if (!cb) return;
  toggleUserActive(Number(cb.dataset.toggleUser), cb.checked, cb);
});

async function openEditUserModal(userId) {
  editingUserId = userId;
  const u = allUsers.find(u => u.id === userId);
  if (!u) return;

  document.getElementById('editUserModalTitle').textContent = u.name + ' の設定';
  document.getElementById('editUserId').value = userId;
  document.getElementById('editUserName').value = u.name;
  document.getElementById('editUserEmail').value = u.email;
  document.getElementById('editUserRole').value = u.role;
  document.getElementById('editUserSolidType').value = u.solid_type ?? '';
  document.getElementById('editUserActive').checked = !!u.is_active;
  document.getElementById('editTempPwArea').style.display = 'none';

  document.getElementById('editUserModal').classList.remove('hidden');

  // 通知設定を取得
  try {
    const data = await api.get(`/admin/users/${userId}/notification-settings`);
    const s = data?.setting || { modeling_completed_enabled: true, expiring_file_enabled: true, extra_emails: [] };
    document.getElementById('editToggleModeling').checked = s.modeling_completed_enabled;
    document.getElementById('editToggleExpiring').checked = s.expiring_file_enabled;
    editExtraEmails = s.extra_emails || [];
  } catch {
    document.getElementById('editToggleModeling').checked = true;
    document.getElementById('editToggleExpiring').checked = true;
    editExtraEmails = [];
  }
  renderEditExtraEmails();

  /* 仮パスワードは本人が変更済みだと404が返るので、その場合は欄ごと出さない */
  try {
    const pw = await api.get(`/admin/users/${userId}/temp-password`);
    if (pw?.temp_password) {
      document.getElementById('editTempPw').value = pw.temp_password;
      document.getElementById('editTempPwArea').style.display = '';
    }
  } catch { /* 変更済み・権限なし。表示しないだけでよい */ }
}

document.getElementById('editTempPwCopy').addEventListener('click', () => {
  navigator.clipboard?.writeText(document.getElementById('editTempPw').value)
    .then(() => showToast('仮パスワードをコピーしました', 'success'))
    .catch(() => showToast('コピーできませんでした', 'danger'));
});

function renderEditExtraEmails() {
  const list = document.getElementById('editExtraEmailList');
  list.innerHTML = editExtraEmails.map((email, i) => `
    <div style="display:flex;gap:8px;align-items:center;">
      <input type="email" class="form-input" value="${esc(email)}" style="flex:1;"
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
  const name = document.getElementById('editUserName').value.trim();
  const role = document.getElementById('editUserRole').value;
  const solidType = document.getElementById('editUserSolidType').value || null;
  const isActive = document.getElementById('editUserActive').checked;
  const validEmails = editExtraEmails.filter(e => e.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()));

  if (!name) { showToast('名前は必須です', 'danger'); return; }

  const btn = document.getElementById('editUserModalSubmit');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    /* 名前・ロール・種別・有効状態。solid_type に null を送ると「種別なし」に戻る */
    const res = await api.patch(`/admin/users/${editingUserId}`, {
      name, role, solid_type: solidType, is_active: isActive,
    });
    const idx = allUsers.findIndex(u => u.id === editingUserId);
    if (idx !== -1 && res?.user) allUsers[idx] = res.user;

    // 通知設定保存
    await api.patch(`/admin/users/${editingUserId}/notification-settings`, {
      modeling_completed_enabled: document.getElementById('editToggleModeling').checked,
      expiring_file_enabled:      document.getElementById('editToggleExpiring').checked,
      extra_emails:               validEmails,
    });

    /* 自分自身を編集した場合はサイドバー表示も即時更新する（再ログイン不要） */
    if (editingUserId === user.id && res?.user) {
      user.name = res.user.name;
      user.role = res.user.role;
      user.solid_type = res.user.solid_type;
      sessionStorage.setItem('space_user', JSON.stringify(user));
      renderSidebarUser(user);
    }

    document.getElementById('editUserModal').classList.add('hidden');
    editingUserId = null;
    editExtraEmails = [];
    renderUsers();
    showToast('ユーザー設定を保存しました', 'success');
  } catch (err) {
    showToast('保存に失敗しました: ' + esc(err.message), 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> 保存';
  }
});

function openInviteModal() {
  document.querySelector('#userModal .modal-title').textContent = 'ユーザーを招待';
  document.getElementById('inviteName').value    = '';
  document.getElementById('inviteEmail').value   = '';
  document.getElementById('inviteRole').value = 'general';
  document.getElementById('inviteSolidType').value = '';
  document.getElementById('inviteTempPwArea').style.display = 'none';
  document.getElementById('userModalSubmit').style.display = '';
  document.getElementById('userModal').classList.remove('hidden');
}

document.getElementById('inviteUserBtn').addEventListener('click', openInviteModal);
['userModalClose','userModalClose2'].forEach(id =>
  document.getElementById(id).addEventListener('click', () => {
    document.getElementById('userModal').classList.add('hidden');
  }));

document.getElementById('inviteTempPwCopy').addEventListener('click', () => {
  navigator.clipboard?.writeText(document.getElementById('inviteTempPw').value)
    .then(() => showToast('仮パスワードをコピーしました', 'success'))
    .catch(() => showToast('コピーできませんでした', 'danger'));
});

document.getElementById('userModalSubmit').addEventListener('click', async () => {
  const name    = document.getElementById('inviteName').value.trim();
  const email   = document.getElementById('inviteEmail').value.trim();
  const compSel = document.getElementById('inviteCompany');
  const role    = document.getElementById('inviteRole').value;
  const solidType = document.getElementById('inviteSolidType').value || null;

  if (!name || !email) { showToast('名前とメールアドレスは必須です', 'danger'); return; }

  const btn = document.getElementById('userModalSubmit');
  btn.disabled = true;
  const origLabel = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    /* SOLIDの管理画面から作るユーザーには利用アプリとしてSOLIDだけを付与する。
       （会社契約の他アプリまで自動で使えてしまうのを防ぐ。追加はSpace.appの管理画面で行う） */
    const data = await api.post('/admin/users', {
      name, email, role,
      solid_type: solidType,
      company_id: Number(compSel.value),
      apps_enabled: [APP_KEY],
    });

    const created = data?.data;
    if (created) allUsers.push(created);
    renderUsers();

    /* 仮パスワードはこの場でしか安全に渡せないため、モーダルに残して手渡しできるようにする */
    document.getElementById('inviteTempPw').value = data?.temp_password ?? '';
    document.getElementById('inviteTempPwArea').style.display = '';
    btn.style.display = 'none';

    /* 会社がSOLID未契約だと effective_apps が空になり、作成できてもログインできない */
    if (created && !(created.effective_apps ?? []).includes(APP_KEY)) {
      showToast('ユーザーを作成しましたが、この会社はSOLIDを契約していないためログインできません', 'danger');
    } else {
      showToast('ユーザーを追加しました', 'success');
    }
  } catch (err) {
    showToast('操作に失敗しました: ' + esc(err.message), 'danger');
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
  /* adminは自社にしかユーザーを作れない（サーバー側でも会社IDを自社に強制上書きしている） */
  if (!IS_SUPER) {
    sel.value = user.company_id ?? sel.value;
    sel.disabled = true;
  }
}

/* ============================================================
   通知先管理（super_adminのみ）

   受注通知の宛先は「組織の窓口アドレス」で、ユーザー単位の通知設定
   （notification_settings）とは別物。担当者が退職してもアドレスは残る。
   言語は会社名から推測せず、宛先ごとに明示して持つ。
   ============================================================ */
const NOTIFY_CHANNELS = [
  { key:'order_halspace', label:'受注通知先（株式会社HaLSpace）',        defaultLocale:'ja' },
  { key:'order_hilano',   label:'受注通知先（PT.HILANO LCZ INDONESIA）', defaultLocale:'en' },
];
const LOCALE_LABEL = { ja:'日本語', en:'English' };

/* channelキー → 行の配列。保存はchannel単位の一括置換なのでここが正 */
let notifyRows = {};

async function loadNotifyRecipients() {
  try {
    const data = await api.get('/admin/solid/notify-recipients');
    notifyRows = {};
    NOTIFY_CHANNELS.forEach(c => { notifyRows[c.key] = []; });
    (data.recipients || []).forEach(r => {
      if (!notifyRows[r.channel]) notifyRows[r.channel] = [];
      notifyRows[r.channel].push({
        email: r.email, label: r.label || '', locale: r.locale, is_active: !!r.is_active,
      });
    });
    renderNotifyGroups();
  } catch (err) {
    showToast('通知先の取得に失敗しました: ' + err.message, 'danger');
  }
}

function renderNotifyGroups() {
  const wrap = document.getElementById('notifyGroups');
  if (!wrap) return;

  wrap.innerHTML = NOTIFY_CHANNELS.map(ch => {
    const rows = notifyRows[ch.key] || [];
    const rowsHtml = rows.length ? rows.map((r, i) => `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
        <input type="email" class="form-input" value="${esc(r.email)}" placeholder="メールアドレス"
               style="flex:2;min-width:200px;"
               oninput="updateNotifyRow('${ch.key}',${i},'email',this.value)">
        <input type="text" class="form-input" value="${esc(r.label)}" placeholder="表示名（任意）"
               style="flex:1;min-width:120px;"
               oninput="updateNotifyRow('${ch.key}',${i},'label',this.value)">
        <select class="form-input" style="flex:0 0 110px;"
                onchange="updateNotifyRow('${ch.key}',${i},'locale',this.value)">
          ${Object.keys(LOCALE_LABEL).map(l =>
            `<option value="${l}" ${r.locale === l ? 'selected' : ''}>${LOCALE_LABEL[l]}</option>`).join('')}
        </select>
        <label class="toggle-switch" title="有効／無効">
          <input type="checkbox" ${r.is_active ? 'checked' : ''}
                 onchange="updateNotifyRow('${ch.key}',${i},'is_active',this.checked)">
          <span class="toggle-slider"></span>
        </label>
        <button class="btn btn-outline btn-sm" onclick="removeNotifyRow('${ch.key}',${i})"
                style="color:var(--danger);border-color:var(--danger);flex-shrink:0;">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `).join('') : '<p style="font-size:12px;color:var(--muted);margin-bottom:8px;">送信先が登録されていません。</p>';

    return `
      <div style="margin-bottom:28px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:12px;">
          <i class="fa-solid fa-building"></i> ${esc(ch.label)}
        </div>
        ${rowsHtml}
        <button class="btn btn-outline btn-sm" onclick="addNotifyRow('${ch.key}','${ch.defaultLocale}')">
          <i class="fa-solid fa-plus"></i> 送信先を追加
        </button>
      </div>
    `;
  }).join('');
}

function updateNotifyRow(channel, i, field, value) {
  notifyRows[channel][i][field] = value;
}

function addNotifyRow(channel, defaultLocale) {
  if (!notifyRows[channel]) notifyRows[channel] = [];
  notifyRows[channel].push({ email:'', label:'', locale:defaultLocale, is_active:true });
  renderNotifyGroups();
  const inputs = document.querySelectorAll('#notifyGroups input[type=email]');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function removeNotifyRow(channel, i) {
  notifyRows[channel].splice(i, 1);
  renderNotifyGroups();
}

document.getElementById('notifySaveBtn')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;

  /* 空行はサーバーのemailバリデーションで弾かれて全体が保存できなくなるため、
     入力途中の行はここで落としてから送る */
  const payloads = NOTIFY_CHANNELS.map(ch => ({
    channel: ch.key,
    recipients: (notifyRows[ch.key] || []).filter(r => r.email.trim()),
  }));

  btn.disabled = true;
  try {
    /* channel単位の一括置換。送っていないchannelはサーバー側で触らない */
    for (const p of payloads) {
      await api.put('/admin/solid/notify-recipients', p);
    }
    showToast('送信先を保存しました', 'success');
    await loadNotifyRecipients();
  } catch (err) {
    showToast('保存に失敗しました: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
  }
});

async function loadNotifyLogs() {
  const wrap = document.getElementById('notifyLogList');
  if (!wrap) return;

  const EVENT_LABEL = { order_submitted:'受注通知', project_delivered:'納品通知' };
  try {
    const data = await api.get('/admin/solid/mail-logs');
    const logs = data.logs || [];
    if (!logs.length) {
      wrap.innerHTML = '<p style="font-size:12px;color:var(--muted);">送信履歴はまだありません。</p>';
      return;
    }
    wrap.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border);">
              <th style="padding:8px 12px 8px 0;white-space:nowrap;">日時</th>
              <th style="padding:8px 12px 8px 0;white-space:nowrap;">種別</th>
              <th style="padding:8px 12px 8px 0;white-space:nowrap;">案件</th>
              <th style="padding:8px 12px 8px 0;">宛先</th>
              <th style="padding:8px 0;white-space:nowrap;">結果</th>
            </tr>
          </thead>
          <tbody>
            ${logs.map(l => `
              <tr style="border-bottom:1px solid var(--border);">
                <td style="padding:8px 12px 8px 0;white-space:nowrap;">${esc(formatLogTime(l.created_at))}</td>
                <td style="padding:8px 12px 8px 0;white-space:nowrap;">${esc(EVENT_LABEL[l.event] || l.event)}</td>
                <td style="padding:8px 12px 8px 0;white-space:nowrap;">${esc(l.project?.project_code || '-')}</td>
                <td style="padding:8px 12px 8px 0;word-break:break-all;">${esc(l.to_email)}</td>
                <td style="padding:8px 0;white-space:nowrap;">
                  ${l.status === 'sent'
                    ? '<span style="color:var(--accent);font-weight:700;">送信</span>'
                    : `<span style="color:var(--danger);font-weight:700;" title="${esc(l.error || '')}">失敗</span>`}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    wrap.innerHTML = `<p style="font-size:12px;color:var(--danger);">送信履歴の取得に失敗しました: ${esc(err.message)}</p>`;
  }
}

/* APIはUTCで返す。ブラウザのローカル時刻へ寄せてから表示する */
function formatLogTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

document.getElementById('notifyLogsReload')?.addEventListener('click', loadNotifyLogs);

/* ============================================================
   初期化（会社 → ユーザー・削除管理を並行ロード）
   ============================================================ */
async function init() {
  await loadCompanies();
  const tasks = [loadUsers(), loadCleanup()];
  if (IS_SUPER) tasks.push(loadNotifyRecipients(), loadNotifyLogs());
  await Promise.all(tasks);
}
init();
