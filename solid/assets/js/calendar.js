'use strict';

const user = requireSpaceAuth();
if (!user) throw new Error('未認証');
renderSidebarUser(user);
if (isAdmin(user)) {
  const cf = document.getElementById('companyFilter');
  cf.style.display = '';
  document.getElementById('adminLink').style.display = '';
  api.get('/admin/companies').then(data => {
    (data?.companies ?? MOCK.companies).forEach(c => {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.name; cf.appendChild(o);
    });
  }).catch(() => {
    MOCK.companies.forEach(c => {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.name; cf.appendChild(o);
    });
  });
  cf.addEventListener('change', loadAndRender);
  const adminNav = document.getElementById('adminNav');
  if (adminNav) adminNav.style.display = '';
}

function showToast(msg, type = '') {
  const c = document.getElementById('toastContainer');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast${type ? ' toast-' + type : ''}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

const DOW = ['日','月','火','水','木','金','土'];
const STATUS_LABEL = {
  submitted:'提出済み', in_progress:'モデリング中', review_pending:'検査待ち',
  revision_requested:'修正依頼中', approved:'承認済み', delivered:'納品完了',
};

let curYear  = new Date().getFullYear();
let curMonth = new Date().getMonth();

function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

let cachedProjects = [];

async function loadAndRender() {
  const cf = document.getElementById('companyFilter')?.value;
  try {
    let url = `/projects/calendar?year=${curYear}&month=${curMonth + 1}`;
    if (cf) url += `&company_id=${cf}`;
    const data = await api.get(url);
    cachedProjects = data?.projects ?? [];
  } catch(e) {
    console.error('カレンダーAPI取得失敗:', e);
    showToast('カレンダーデータの取得に失敗しました: ' + e.message, 'danger');
    cachedProjects = [];
  }
  renderCalendar();
}

function renderCalendar() {
  const grid = document.getElementById('calGrid');
  document.getElementById('monthTitle').textContent = `${curYear}年 ${curMonth+1}月`;

  grid.innerHTML = DOW.map(d => `<div class="cal-dow">${d}</div>`).join('');

  const firstDay = new Date(curYear, curMonth, 1);
  const lastDay  = new Date(curYear, curMonth + 1, 0);
  const startDow = firstDay.getDay();

  /* 前月の空白セル */
  for (let i = 0; i < startDow; i++) {
    const d = new Date(curYear, curMonth, -startDow + i + 1);
    grid.appendChild(makeCell(d, true));
  }
  /* 当月 */
  for (let d = 1; d <= lastDay.getDate(); d++) {
    grid.appendChild(makeCell(new Date(curYear, curMonth, d), false));
  }
  /* 次月補完 */
  const totalCells = startDow + lastDay.getDate();
  const remain = (7 - (totalCells % 7)) % 7;
  for (let i = 1; i <= remain; i++) {
    grid.appendChild(makeCell(new Date(curYear, curMonth + 1, i), true));
  }
}

function makeCell(date, otherMonth) {
  const cell = document.createElement('div');
  const ds   = fmt(date);
  const today = fmt(new Date());
  cell.className = `cal-cell${otherMonth ? ' other-month' : ''}${ds === today ? ' today' : ''}`;

  const dateEl = document.createElement('div');
  dateEl.className = 'cal-date';
  dateEl.textContent = date.getDate();
  cell.appendChild(dateEl);

  /* このセルに表示するプロジェクトを収集 */
  const curMonthFirst = fmt(new Date(curYear, curMonth, 1));

  const items = [];
  cachedProjects.forEach(p => {
    const replied   = p.deadline_replied   ? p.deadline_replied.slice(0, 10)   : null;
    const requested = p.deadline_requested ? p.deadline_requested.slice(0, 10) : null;
    const delivered = p.delivered_at       ? p.delivered_at.slice(0, 10)       : null;

    // 1. 納品日がこの日
    if (delivered === ds) { items.push({ p, type: 'delivered' }); return; }

    // 2. 回答納期がこの日
    if (replied && replied === ds) { items.push({ p, type: 'replied' }); return; }

    // 3. 回答納期なし・希望納期がこの日
    if (!replied && requested && requested === ds) { items.push({ p, type: 'requested' }); return; }

    // 4. 回答納期も希望納期も当月より前または未設定 → 当月1日に表示
    const showDate = replied || requested;
    const isOverdue = showDate && showDate < curMonthFirst;
    const noDate = !showDate;
    if ((isOverdue || noDate) && ds === curMonthFirst) {
      items.push({ p, type: isOverdue ? 'overdue' : 'no_date' });
    }
  });

  const MAX_VISIBLE = 3;
  items.slice(0, MAX_VISIBLE).forEach(({ p, type }) => {
    const bar = document.createElement('div');
    if (type === 'delivered') {
      bar.className = 'cal-bar cal-bar-delivered';
      bar.innerHTML = `<i class="fa-solid fa-circle-check" style="font-size:10px;margin-right:3px;"></i>${_short(p.title)}`;
    } else if (type === 'replied') {
      bar.className = `cal-bar cal-bar-${p.status}`;
      bar.innerHTML = `<i class="fa-solid fa-flag" style="font-size:10px;margin-right:3px;"></i>${_short(p.title)}`;
      bar.title = `${p.title}（回答納期: ${p.deadline_replied}）`;
    } else if (type === 'requested') {
      bar.className = `cal-bar cal-bar-${p.status}`;
      bar.innerHTML = `<i class="fa-solid fa-clock" style="font-size:10px;margin-right:3px;"></i>${_short(p.title)}`;
      bar.title = `${p.title}（希望納期: ${p.deadline_requested} / 未回答）`;
    } else if (type === 'overdue') {
      bar.className = `cal-bar cal-bar-${p.status}`;
      bar.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="font-size:10px;margin-right:3px;"></i>${_short(p.title)}`;
      bar.title = `${p.title}（期限超過）`;
    } else {
      bar.className = `cal-bar cal-bar-${p.status}`;
      bar.innerHTML = _short(p.title);
    }
    bar.title = p.title;
    bar.style.cursor = 'pointer';
    bar.addEventListener('click', () => { location.href = `project-detail.html?id=${p.id}`; });
    cell.appendChild(bar);
  });

  /* 3件超の場合は「+N件」クリックでポップアップ */
  if (items.length > MAX_VISIBLE) {
    const more = document.createElement('div');
    more.style.cssText = 'font-size:11px;color:var(--primary);padding:1px 6px;cursor:pointer;font-weight:600;';
    more.textContent = `+${items.length - MAX_VISIBLE}件`;
    more.addEventListener('click', e => { e.stopPropagation(); showDayPopup(items, ds, cell); });
    cell.appendChild(more);
  }

  /* セルの日付部分クリックで全件ポップアップ */
  if (items.length > 0) {
    dateEl.style.cursor = 'pointer';
    dateEl.addEventListener('click', e => { e.stopPropagation(); showDayPopup(items, ds, cell); });
  }

  return cell;
}

function _short(title) {
  const limit = window.innerWidth <= 374 ? 5 : window.innerWidth <= 540 ? 7 : window.innerWidth <= 768 ? 10 : 14;
  return title.length > limit ? title.slice(0, limit) + '…' : title;
}

/* ── 日別ポップアップ ── */
const dayPopup     = document.getElementById('dayPopup');
const dayPopupList = document.getElementById('dayPopupList');

function showDayPopup(items, dateStr, anchorEl) {
  const title = document.getElementById('dayPopupTitle');
  const d = new Date(dateStr + 'T00:00:00');
  title.textContent = `${d.getMonth()+1}月${d.getDate()}日（${['日','月','火','水','木','金','土'][d.getDay()]}）`;

  dayPopupList.innerHTML = '';
  items.forEach(({ p, type }) => {
    const item = document.createElement('div');
    item.style.cssText = 'padding:8px 10px;border-radius:8px;cursor:pointer;transition:opacity .15s;';
    item.classList.add(`cal-bar`, `cal-bar-${type === 'delivered' ? 'delivered' : p.status}`);

    let icon = '';
    if (type === 'delivered')  icon = '<i class="fa-solid fa-circle-check" style="margin-right:5px;"></i>';
    else if (type === 'replied')   icon = '<i class="fa-solid fa-flag" style="margin-right:5px;"></i>';
    else if (type === 'requested') icon = '<i class="fa-solid fa-clock" style="margin-right:5px;"></i>';
    else if (type === 'overdue')   icon = '<i class="fa-solid fa-triangle-exclamation" style="margin-right:5px;"></i>';

    const dateInfo = type === 'delivered' ? p.delivered_at
      : type === 'replied'   ? `回答納期: ${p.deadline_replied}`
      : type === 'requested' ? `希望納期: ${p.deadline_requested}`
      : type === 'overdue'   ? '期限超過' : '';

    item.innerHTML = `
      <div style="font-weight:700;font-size:13px;">${icon}${p.title}</div>
      <div style="font-size:11px;margin-top:3px;opacity:.8;">
        <code style="font-size:10px;">${p.project_code}</code>
        ${dateInfo ? `· ${dateInfo}` : ''}
      </div>`;
    item.addEventListener('click', () => { location.href = `project-detail.html?id=${p.id}`; });
    dayPopupList.appendChild(item);
  });

  /* 位置計算：画面内に収まるよう調整 */
  const rect   = anchorEl.getBoundingClientRect();
  const margin = 8;
  const pw     = 300;
  /* リストの高さを制限してからポップアップを表示 */
  const maxListH = window.innerHeight - 60 - 50; // ヘッダー分引く
  dayPopupList.style.maxHeight = maxListH + 'px';

  dayPopup.style.visibility = 'hidden';
  dayPopup.style.display    = 'flex';

  const ph = dayPopup.offsetHeight;

  /* 左右 */
  let left = rect.left;
  if (left + pw > window.innerWidth - margin) left = window.innerWidth - pw - margin;
  if (left < margin) left = margin;

  /* 上下：セルの下に出す。はみ出すならセルの上に出す。それでも入らないなら画面中央 */
  let top = rect.bottom + margin;
  if (top + ph > window.innerHeight - margin) {
    top = rect.top - ph - margin;
  }
  if (top < margin) {
    top = Math.max(margin, (window.innerHeight - ph) / 2);
  }

  dayPopup.style.left       = left + 'px';
  dayPopup.style.top        = top  + 'px';
  dayPopup.style.visibility = 'visible';
}

document.getElementById('dayPopupClose').addEventListener('click', () => {
  dayPopup.style.display = 'none';
});
document.addEventListener('click', e => {
  if (!dayPopup.contains(e.target) && !e.target.closest('.cal-cell')) {
    dayPopup.style.display = 'none';
  }
});

/* ナビゲーション */
document.getElementById('prevMonth').addEventListener('click', () => {
  curMonth--; if (curMonth < 0) { curMonth = 11; curYear--; }
  loadAndRender();
});
document.getElementById('nextMonth').addEventListener('click', () => {
  curMonth++; if (curMonth > 11) { curMonth = 0; curYear++; }
  loadAndRender();
});
document.getElementById('todayBtn').addEventListener('click', () => {
  curYear  = new Date().getFullYear();
  curMonth = new Date().getMonth();
  loadAndRender();
});

loadAndRender();
