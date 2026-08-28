'use strict';

const user = requireSpaceAuth();
if (!user) throw new Error('未認証');
renderSidebarUser(user);
if (isAdmin(user)) {
  document.getElementById('adminLink').style.display = '';
  const adminNav = document.getElementById('adminNav');
  if (adminNav) adminNav.style.display = '';
}

/* ── 会社フィルタ ──
   /admin/companiesは会社スコープがかかりsuper_admin以外には自社1件しか返さないため、
   モデラー専属会社の管理者のように「自社は発注元ではないが他社の案件を見る」ユーザーでは
   フィルタとして成立しない。選択肢はプロジェクトの会社から作る。 */
const companyOptions = new Map();   // String(company_id) → 会社名

document.getElementById('companyFilter')?.addEventListener('change', loadAndRender);

function collectCompanies(projects) {
  projects.forEach(p => {
    if (p.company_id != null) {
      companyOptions.set(String(p.company_id), p.company_name ?? p.company ?? '(会社名なし)');
    }
  });
}

async function loadCompanyFilter() {
  /* 表示中の月に案件が無い会社が選択肢から抜けないよう、会社は全期間の一覧から拾う */
  try {
    const data = await api.get('/projects');
    collectCompanies(data?.projects ?? []);
  } catch { /* カレンダーの取得結果からも拾うので握り潰してよい */ }

  /* 運営者だけは発注実績0件の会社も選べるようにする（SOLID未契約の会社は除く） */
  if (user.role === 'super_admin') {
    try {
      const data = await api.get('/admin/companies');
      (data?.companies ?? MOCK.companies)
        .filter(c => !Array.isArray(c.apps_enabled) || c.apps_enabled.includes('solid'))
        .forEach(c => companyOptions.set(String(c.id), c.name));
    } catch {
      MOCK.companies.forEach(c => companyOptions.set(String(c.id), c.name));
    }
  }
  renderCompanyFilter();
}

/* 会社が1つしか見えないユーザー（自社の案件だけを見る発注者会社）にはフィルタ自体を出さない */
function renderCompanyFilter() {
  const sel = document.getElementById('companyFilter');
  if (!sel) return;
  if (companyOptions.size < 2) { sel.style.display = 'none'; return; }
  const cur = sel.value;
  sel.innerHTML = '<option value="">全会社</option>';
  [...companyOptions.entries()]
    .sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'ja'))
    .forEach(([id, name]) => {
      const opt = document.createElement('option');
      opt.value = id; opt.textContent = name;
      if (id === cur) opt.selected = true;
      sel.appendChild(opt);
    });
  sel.style.display = '';
}

/* 会社名は全ロールで物件名の下に表示する */
document.body.classList.add('show-company');

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
  revision_requested:'修正依頼中', approved:'納品待ち', delivered:'納品完了',
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
    cachedProjects.forEach(p => { p._slot = _displaySlot(p); });
    /* 絞り込み中は全社分を取り直せないため、一度見つけた会社は消さずに積み上げる */
    collectCompanies(cachedProjects);
    renderCompanyFilter();
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

/* 1案件につきカレンダーに出すバーは1本だけ。
   納品日 > 回答納期 > 希望納期 の優先順で表示日を決める。
   回答納期が決まった時点で希望納期のバーは出さない（重複表示の防止）。 */
function _displaySlot(p) {
  const delivered = p.delivered_at       ? p.delivered_at.slice(0, 10)       : null;
  const replied   = p.deadline_replied   ? p.deadline_replied.slice(0, 10)   : null;
  const requested = p.deadline_requested ? p.deadline_requested.slice(0, 10) : null;

  if (delivered) return { date: delivered, type: 'delivered' };
  if (replied)   return { date: replied,   type: 'replied'   };
  if (requested) return { date: requested, type: 'requested' };
  return { date: null, type: 'no_date' };
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
    const slot = p._slot ?? _displaySlot(p);

    // 1. 表示日がこの日（当月より前のセルには出さず、3. の期限超過として月初にまとめる）
    if (slot.date && slot.date === ds && ds >= curMonthFirst) {
      items.push({ p, type: slot.type });
      return;
    }

    // 2. 納期未設定 → 当月1日に表示
    if (!slot.date && ds === curMonthFirst) { items.push({ p, type: 'no_date' }); return; }

    // 3. 表示日が当月より前の未納品案件（期限超過）→ 当月1日に表示
    if (slot.date && slot.date < curMonthFirst && slot.type !== 'delivered' && ds === curMonthFirst) {
      items.push({ p, type: 'overdue' });
    }
  });

  const MAX_VISIBLE = 3;
  items.slice(0, MAX_VISIBLE).forEach(({ p, type }) => {
    const bar = document.createElement('div');
    const co  = _companyLine(p);
    let reason;
    if (type === 'delivered') {
      bar.className = 'cal-bar cal-bar-delivered';
      bar.innerHTML = `<div class="cal-bar-title"><i class="fa-solid fa-circle-check" style="font-size:10px;margin-right:3px;"></i>${_short(p.title)}</div>${co}`;
      reason = `納品完了: ${p.delivered_at}`;
    } else if (type === 'replied') {
      bar.className = `cal-bar cal-bar-${p.status}`;
      bar.innerHTML = `<div class="cal-bar-title"><i class="fa-solid fa-flag" style="font-size:10px;margin-right:3px;"></i>${_short(p.title)}</div>${co}`;
      reason = `回答納期: ${p.deadline_replied}`;
    } else if (type === 'requested') {
      bar.className = `cal-bar cal-bar-${p.status}`;
      bar.innerHTML = `<div class="cal-bar-title"><i class="fa-solid fa-clock" style="font-size:10px;margin-right:3px;"></i>${_short(p.title)}</div>${co}`;
      reason = `希望納期: ${p.deadline_requested}（回答待ち）`;
    } else if (type === 'overdue') {
      bar.className = `cal-bar cal-bar-${p.status}`;
      bar.innerHTML = `<div class="cal-bar-title"><i class="fa-solid fa-triangle-exclamation" style="font-size:10px;margin-right:3px;"></i>${_short(p.title)}</div>${co}`;
      reason = `期限超過（納期: ${p.deadline_replied || p.deadline_requested}）`;
    } else {
      bar.className = `cal-bar cal-bar-${p.status}`;
      bar.innerHTML = `<div class="cal-bar-title">${_short(p.title)}</div>${co}`;
      reason = '納期未設定';
    }
    /* この日に出ている理由（納期の種別）が分かるようにする。会社名は末尾に添える */
    const coName = _companyName(p);
    bar.title = `${p.title}${coName ? '（' + coName + '）' : ''}
${reason}`;
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

function _esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function _short(title) {
  const limit = window.innerWidth <= 374 ? 5 : window.innerWidth <= 540 ? 7 : window.innerWidth <= 768 ? 10 : 14;
  return _esc(title.length > limit ? title.slice(0, limit) + '…' : title);
}

/* 法人格（株式会社・(有)・㈱ など）を除いた社名を返す */
const _CORP_RE = /(株式会社|有限会社|合同会社|合資会社|合名会社|(一般|公益)?(社団|財団)法人|\(株\)|（株）|\(有\)|（有）|㈱|㈲)/g;
function _companyName(p) {
  const raw = p.company_name ?? p.company ?? '';
  return raw.replace(_CORP_RE, '').replace(/[\s　]+/g, ' ').trim();
}

function _companyLine(p) {
  const name = _companyName(p);
  if (!name) return '';
  const limit = window.innerWidth <= 374 ? 6 : window.innerWidth <= 540 ? 8 : window.innerWidth <= 768 ? 11 : 16;
  const text = name.length > limit ? name.slice(0, limit) + '…' : name;
  return `<div class="cal-bar-company">${_esc(text)}</div>`;
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

    const dateInfo = type === 'delivered' ? `納品完了: ${p.delivered_at}`
      : type === 'replied'   ? `回答納期: ${p.deadline_replied}`
      : type === 'requested' ? `希望納期: ${p.deadline_requested}（回答待ち）`
      : type === 'overdue'   ? `期限超過（納期: ${p.deadline_replied || p.deadline_requested}）`
      : '納期未設定';

    const coName = _companyName(p);
    item.innerHTML = `
      <div style="font-weight:700;font-size:13px;">${icon}${_esc(p.title)}</div>
      ${coName ? `<div style="font-size:11px;margin-top:2px;opacity:.75;">${_esc(coName)}</div>` : ''}
      <div style="font-size:11px;margin-top:3px;opacity:.8;">
        <code style="font-size:10px;">${_esc(p.project_code)}</code>
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

loadCompanyFilter();
loadAndRender();
