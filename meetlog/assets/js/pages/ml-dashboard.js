'use strict';
/* MeetLog ダッシュボード — NotaAI スタイル */

let currentMode = 'all';
let allMinutes  = [];

/* ────────────────────────────
   初期化
──────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  const user = requireAuth();
  if (!user) return;

  renderSidebarUser(user);
  initAdminLinks(user);
  initNavEvents();
  initFilterEvents();
  await Promise.all([loadMinutes(), loadOverdueBadge()]);
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
  const initial = (user.name || user.email || '?')[0].toUpperCase();
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:9px;padding:6px 0;">
      <div style="width:32px;height:32px;border-radius:50%;background:var(--ml-purple);color:#fff;
        display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0;">
        ${initial}
      </div>
      <div style="min-width:0;">
        <div style="font-size:13px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${user.name || ''}
        </div>
        <div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${user.email || ''}
        </div>
      </div>
    </div>`;
}

function initAdminLinks(user) {
  const isAdmin = user.role === 'jp_admin' || user.role === 'super_admin';
  ['adminTemplateLink', 'adminLink'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isAdmin ? '' : 'none';
  });
}

/* ────────────────────────────
   ナビゲーション
──────────────────────────── */
function initNavEvents() {
  document.getElementById('navAll').addEventListener('click', e => { e.preventDefault(); setMode('all'); });
  document.getElementById('navMine').addEventListener('click', e => { e.preventDefault(); setMode('mine'); });
  document.getElementById('navMyAction').addEventListener('click', e => { e.preventDefault(); setMode('myaction'); });
}

function setMode(mode) {
  currentMode = mode;

  document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
  const navMap = { all: 'navAll', mine: 'navMine', myaction: 'navMyAction' };
  document.getElementById(navMap[mode])?.classList.add('active');

  const myActionPanel  = document.getElementById('myActionPanel');
  const filterBar      = document.getElementById('filterBar');
  const upcomingSection = document.getElementById('upcomingSection');
  const todaySection   = document.getElementById('todaySection');
  const pastSection    = document.getElementById('pastSection');

  if (mode === 'myaction') {
    myActionPanel.style.display   = '';
    filterBar.style.display       = 'none';
    upcomingSection.style.display = 'none';
    todaySection.style.display    = 'none';
    pastSection.style.display     = 'none';
    document.getElementById('loadingArea').style.display = 'none';
    document.getElementById('emptyMsg').style.display    = 'none';
    loadMyActions();
  } else {
    myActionPanel.style.display = 'none';
    filterBar.style.display     = '';
    loadMinutes();
  }
}

/* ────────────────────────────
   フィルター
──────────────────────────── */
function initFilterEvents() {
  // チップフィルター
  document.querySelectorAll('.filter-chip[data-status]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip[data-status]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      loadMinutes();
    });
  });

  // 日付フィルター
  document.getElementById('dateFrom').addEventListener('change', () => loadMinutes());
  document.getElementById('dateTo').addEventListener('change', () => loadMinutes());

  // リセット
  document.getElementById('filterResetBtn').addEventListener('click', () => {
    document.querySelectorAll('.filter-chip[data-status]').forEach(c => c.classList.remove('active'));
    document.querySelector('.filter-chip[data-status=""]').classList.add('active');
    document.getElementById('dateFrom').value = '';
    document.getElementById('dateTo').value   = '';
    document.getElementById('searchInput').value = '';
    loadMinutes();
  });

  // 検索
  let timer;
  document.getElementById('searchInput').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => loadMinutes(), 400);
  });
}

function getActiveStatus() {
  const active = document.querySelector('.filter-chip[data-status].active');
  return active ? active.dataset.status : '';
}

/* ────────────────────────────
   議事録一覧取得
──────────────────────────── */
async function loadMinutes() {
  if (currentMode === 'myaction') return;

  showLoading(true);

  const params = {};
  const search = document.getElementById('searchInput').value.trim();
  const status = getActiveStatus();
  const from   = document.getElementById('dateFrom').value;
  const to     = document.getElementById('dateTo').value;

  if (search) params.search = search;
  if (status) params.approval_status = status;
  if (from)   params.date_from = from;
  if (to)     params.date_to   = to;
  if (currentMode === 'mine') params.mine = 1;

  allMinutes = await mlGetMinutes(params);
  renderMinutes(allMinutes);
  showLoading(false);
}

function renderMinutes(minutes) {
  const today     = todayStr();
  const upcoming  = minutes.filter(m => (m.meeting_date || '').slice(0,10) > today)
                            .sort((a,b) => a.meeting_date > b.meeting_date ? 1 : -1);
  const todayList = minutes.filter(m => (m.meeting_date || '').slice(0,10) === today);
  const past      = minutes.filter(m => !m.meeting_date || m.meeting_date.slice(0,10) < today)
                            .sort((a,b) => a.meeting_date < b.meeting_date ? 1 : -1);

  const upcomingSection  = document.getElementById('upcomingSection');
  const todaySection     = document.getElementById('todaySection');
  const pastSection      = document.getElementById('pastSection');
  const emptyMsg         = document.getElementById('emptyMsg');

  if (!minutes.length) {
    upcomingSection.style.display = 'none';
    todaySection.style.display    = 'none';
    pastSection.style.display     = 'none';
    emptyMsg.style.display        = '';
    return;
  }
  emptyMsg.style.display = 'none';

  // Coming up
  if (upcoming.length) {
    document.getElementById('upcomingList').innerHTML = upcoming.map(m => renderListItem(m, 'upcoming')).join('');
    upcomingSection.style.display = '';
  } else {
    upcomingSection.style.display = 'none';
  }

  // Today
  if (todayList.length) {
    document.getElementById('todayList').innerHTML = todayList.map(m => renderListItem(m, 'today')).join('');
    todaySection.style.display = '';
  } else {
    todaySection.style.display = 'none';
  }

  // 過去
  if (past.length) {
    document.getElementById('pastList').innerHTML = past.map(m => renderListItem(m, 'past')).join('');
    pastSection.style.display = '';
  } else {
    pastSection.style.display = 'none';
  }
}

function renderListItem(m, type) {
  const badge     = mlApprovalBadge(m.approval_status);
  const dateLabel = m.meeting_date ? formatDisplayDate(m.meeting_date) : mlFormatDate(m.created_at);
  const location  = m.meeting_location ? ` · ${escHtml(m.meeting_location)}` : '';
  const attendees = formatAttendeesShort(m.attendees);
  const metaParts = [dateLabel + location, attendees].filter(Boolean);

  const iconClass = {
    upcoming: '',
    today:    'today',
    past:     m.approval_status === 'approved' ? 'approved'
            : m.approval_status === 'pending'  ? 'pending'
            : m.approval_status === 'rejected' ? 'rejected' : '',
  }[type] || '';

  const iconName = type === 'today' ? 'fa-calendar-check'
                 : m.approval_status === 'approved' ? 'fa-circle-check'
                 : m.approval_status === 'pending'  ? 'fa-clock'
                 : m.approval_status === 'rejected' ? 'fa-circle-xmark'
                 : 'fa-clipboard';

  const actions = m.action_count ?? 0;
  const done    = m.action_done  ?? 0;
  const actionBadge = actions > 0
    ? `<span style="font-size:11px;color:${done<actions?'var(--orange)':'var(--green)'};font-weight:600;margin-left:8px;">
         <i class="fa-solid fa-list-check"></i> ${done}/${actions}
       </span>` : '';

  // 未完了アクションの最近接期日ラベル
  const dueBadge = (() => {
    if (!m.nearest_due_date || done >= actions) return '';
    const today   = new Date(new Date().toDateString());
    const due     = new Date(m.nearest_due_date);
    const diffDay = Math.round((due - today) / 86400000);
    let color, icon;
    if (diffDay < 0)      { color = 'var(--red)';    icon = 'fa-circle-exclamation'; }
    else if (diffDay <= 3){ color = 'var(--orange)';  icon = 'fa-triangle-exclamation'; }
    else                  { color = 'var(--muted)';   icon = 'fa-calendar-days'; }
    const label = diffDay < 0  ? `${Math.abs(diffDay)}日超過`
                : diffDay === 0 ? '今日期限'
                : diffDay === 1 ? '明日期限'
                : `あと${diffDay}日`;
    return `<span class="action-due-badge" style="color:${color};">
              <i class="fa-solid ${icon}"></i> ${label}
            </span>`;
  })();

  // 登録日と登録者
  const createdDate  = m.created_at ? formatDisplayDate(m.created_at.slice(0, 10)) : '';
  const authorName   = m.author_name || '';
  const registryMeta = [
    createdDate ? `<i class="fa-regular fa-clock"></i> ${escHtml(createdDate)}` : '',
    authorName  ? `<i class="fa-regular fa-user"></i> ${escHtml(authorName)}`   : '',
  ].filter(Boolean).join('　');

  return `
    <div class="minute-list-item" onclick="location.href='edit.html?id=${m.id}'">
      <div class="minute-list-icon ${iconClass}">
        <i class="fa-solid ${iconName}"></i>
      </div>
      <div class="minute-list-body">
        <div class="minute-list-title">${escHtml(m.title || '（タイトルなし）')}</div>
        <div class="minute-list-meta">
          ${metaParts.map(escHtml).join(' · ')}
          ${actionBadge}
          ${dueBadge}
        </div>
        ${registryMeta ? `<div class="minute-list-registry">${registryMeta}</div>` : ''}
      </div>
      <span class="ml-approval-badge" style="color:${badge.color};background:${badge.bg};margin-right:6px;display:none;">
        ${badge.label}
      </span>
      <i class="fa-solid fa-chevron-right minute-list-arrow"></i>
    </div>`;
}

/* ────────────────────────────
   期限超過バッジ（サイドバー）
──────────────────────────── */
async function loadOverdueBadge() {
  const actions = await mlGetMyActions();
  const overdue = actions.filter(a => !a.is_done && mlIsOverdue(a.due_date));
  const badge   = document.getElementById('navMyActionBadge');
  const bnBadge = document.getElementById('bnMyActionBadge');
  const banner  = document.getElementById('overdueAlert');
  if (overdue.length > 0) {
    const label = overdue.length > 9 ? '9+' : String(overdue.length);
    if (badge)  { badge.textContent  = label; badge.style.display  = ''; }
    if (bnBadge){ bnBadge.textContent = label; bnBadge.style.display = ''; }
    if (banner) {
      banner.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <b>${overdue.length}件</b>のアクションが期限超過です。タップして確認 →`;
      banner.style.display = '';
    }
  } else {
    if (badge)  badge.style.display  = 'none';
    if (bnBadge) bnBadge.style.display = 'none';
    if (banner)  banner.style.display = 'none';
  }
}

/* ────────────────────────────
   マイアクション
──────────────────────────── */
async function loadMyActions() {
  const list = document.getElementById('myActionList');
  list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;"><i class="fa-solid fa-spinner fa-spin"></i></div>';

  const actions = await mlGetMyActions();
  const undone  = actions.filter(a => !a.is_done);
  const overdue = undone.filter(a => mlIsOverdue(a.due_date));
  document.getElementById('myActionCount').textContent = `${undone.length} 件未完了 / ${actions.length} 件`;

  // バッジ更新
  const badge = document.getElementById('navMyActionBadge');
  const bnBadge = document.getElementById('bnMyActionBadge');
  const label = overdue.length > 9 ? '9+' : String(overdue.length);
  if (overdue.length > 0) {
    if (badge)  { badge.textContent  = label; badge.style.display  = ''; }
    if (bnBadge){ bnBadge.textContent = label; bnBadge.style.display = ''; }
  } else {
    if (badge)  badge.style.display  = 'none';
    if (bnBadge) bnBadge.style.display = 'none';
  }

  // 期限超過アラートバナー
  const banner = document.getElementById('overdueAlert');
  if (banner) {
    if (overdue.length > 0) {
      banner.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <b>${overdue.length}件</b>のアクションが期限超過です。`;
      banner.style.display = '';
    } else {
      banner.style.display = 'none';
    }
  }

  if (!actions.length) {
    list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:28px;font-size:14px;">担当アクションはありません</div>';
    return;
  }

  list.innerHTML = actions.map(a => {
    const overdue    = mlIsOverdue(a.due_date);
    const doneStyle  = a.is_done ? 'opacity:.5;' : '';
    const dateColor  = !a.is_done && overdue ? 'color:var(--red);' : 'color:var(--muted);';
    return `
      <div class="action-item" style="${doneStyle}">
        <input type="checkbox" class="action-check" ${a.is_done ? 'checked' : ''}
          onchange="toggleMyAction(${a.minute_id},${a.id},this.checked)">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13.5px;color:var(--text);${a.is_done?'text-decoration:line-through;color:var(--muted);':''}">${escHtml(a.content)}</div>
          <div style="font-size:11.5px;margin-top:3px;${dateColor}">
            ${a.due_date ? `<i class="fa-solid fa-clock"></i> ${a.due_date}` : ''}
            ${overdue && !a.is_done ? ' <b>期限超過</b>' : ''}
          </div>
        </div>
        <a href="edit.html?id=${a.minute_id}" style="font-size:12px;color:var(--ml-purple);flex-shrink:0;">
          <i class="fa-solid fa-arrow-up-right-from-square"></i>
        </a>
      </div>`;
  }).join('');
}

async function toggleMyAction(minuteId, actionId, isDone) {
  await mlUpdateAction(minuteId, actionId, { is_done: isDone ? 1 : 0 });
  await loadMyActions();
}

/* ────────────────────────────
   ユーティリティ
──────────────────────────── */
function showLoading(show) {
  const loading = document.getElementById('loadingArea');
  loading.style.display = show ? '' : 'none';
  if (show) {
    ['upcomingSection','todaySection','pastSection','emptyMsg'].forEach(id => {
      document.getElementById(id).style.display = 'none';
    });
  }
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatDisplayDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' });
}

function formatAttendeesShort(attendees) {
  if (!attendees) return '';
  const arr = Array.isArray(attendees) ? attendees : [];
  const names = arr.map(a => typeof a === 'string' ? a : a.name).filter(Boolean);
  if (!names.length) return '';
  return names.length <= 3 ? names.join('、') : names.slice(0,3).join('、') + ` 他${names.length-3}名`;
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function solidLogout() {
  location.href = '../../../space/apps.html';
}
