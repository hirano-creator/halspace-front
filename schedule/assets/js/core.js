/* Schedule Studio — 画面の状態・日付処理・データの持ち方。
   データは API（/api/schedule/…）から取り、メモリに持つ。権限は API が返す印（can_edit など）に従い、
   画面側で計算し直さない。設計書: Schedule Studio/docs/design.md §3-5 */
window.SS = window.SS || {};
(function (SS) {
  /* ---------- 小道具 ---------- */
  const pad = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = s => { const a = s.split('-'); return new Date(+a[0], a[1] - 1, +a[2]); };
  const addD = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const diffD = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const today = () => iso(new Date());
  const mins = t => { if (!t) return 0; const a = t.split(':'); return a[0] * 60 + +a[1]; };
  const hm = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const md = s => { const d = parse(s); return (d.getMonth() + 1) + '月' + d.getDate() + '日（' + WD[d.getDay()] + '）'; };
  Object.assign(SS, { pad, iso, parse, addD, diffD, today, mins, hm, h, WD, md, HOUR: 56 });

  /* カレンダーの色（濃い色＝線・点、淡い色＝背景）。API は色の名前だけを持つ */
  SS.PAL = {
    blue: ['#3565c9', '#e8eefb'], green: ['#2c8a69', '#e2f3ec'], orange: ['#c4622b', '#fbebdf'],
    violet: ['#7158c4', '#eeeafa'], teal: ['#1d8795', '#e0f2f4'], rose: ['#bf4f68', '#fae8ec'],
    amber: ['#a9781c', '#f8efd9'], gray: ['#6b7078', '#eceef0']
  };
  SS.COLOR_NAMES = { blue: '青', green: '緑', orange: 'オレンジ', violet: '紫', teal: '青緑', rose: 'ローズ', amber: '山吹', gray: 'グレー' };
  SS.NOTIFY = { '': '通知なし', '10': '10分前', '30': '30分前', '60': '1時間前', '1440': '前日' };
  SS.REPEAT = { none: '繰り返しなし', daily: '毎日', weekly: '毎週', monthly: '毎月' };
  SS.PERM = { all: '全社員', manager: '部署管理者以上', admin: '企業管理者のみ' };

  /* ---------- 画面の状態 ---------- */
  const S = SS.S = {
    screen: 'calendar', cal: 'personal', view: 'week', date: today(), selDate: today(), selEvent: null,
    hidden: {}, fDept: '', fSite: '', q: '', drawer: false,
    modal: null, float: null, quick: null, loading: false, loadError: null
  };
  const KEEP = ['screen', 'cal', 'view', 'hidden'];
  let uiKey = null;
  SS.loadUI = userId => {
    uiKey = 'ss_ui_v1_' + userId;   // 端末の表示の好みだけ（どのカレンダーを開いていたか等）。データは置かない
    try { Object.assign(S, JSON.parse(localStorage.getItem(uiKey) || '{}')); } catch (e) { }
    if (!['month', 'week', 'day'].includes(S.view)) S.view = 'week';
  };
  SS.saveUI = () => { if (!uiKey) return; try { const o = {}; KEEP.forEach(k => o[k] = S[k]); localStorage.setItem(uiKey, JSON.stringify(o)); } catch (e) { } };
  SS.view = () => S.view;
  SS.isMobile = () => window.matchMedia('(max-width: 860px)').matches;

  /* ---------- データ ---------- */
  const D = SS.D = { me: null, company: null, members: [], departments: [], sites: [], calendars: [], events: [], range: null };

  const FIXED = [
    { id: 'shared', type: 'shared', name: '共有カレンダー', color: 'green', icon: 'users', desc: '社員の予定は基本ここに集まります（個人の予定にしたものを除く）。' },
    { id: 'personal', type: 'personal', name: '個人カレンダー', color: 'blue', icon: 'user', desc: '自分が登録した予定。「個人の予定にする」にした予定は自分だけに表示されます。' }
  ];
  const calFromApi = c => ({
    id: 'c' + c.id, sid: c.id, type: 'custom', parentId: c.parent_id ? 'c' + c.parent_id : null, name: c.name, desc: c.description || '', color: c.color, icon: c.icon,
    view: c.view_perm, edit: c.edit_perm, users: c.users_note || '', notify: c.notify, visible: c.visible, canEdit: c.can_edit_events
  });
  /* 予定は画面では文字の番号で扱う（data-arg が文字になるため） */
  const evFromApi = e => ({
    id: String(e.id), sid: e.id, title: e.title, start: e.start_date, end: e.end_date, allDay: e.all_day,
    st: e.start_time || '09:00', en: e.end_time || '10:00',
    place: e.place || '', memo: e.memo || '', owner: e.owner_user_id, assignee: e.assignee_user_id || null, deptId: e.department_id || null,
    cal: e.calendar_id == null ? 'personal' : 'c' + e.calendar_id, shared: e.shared, scope: e.share_scope,
    notify: e.notify_minutes == null ? '' : String(e.notify_minutes), repeat: e.repeat_rule, until: e.repeat_until || '',
    important: !!e.important, color: e.color || '', version: e.version, masked: !!e.masked, canEdit: !!e.can_edit
  });
  SS.toApi = ev => ({
    title: ev.title, calendar_id: ev.cal === 'personal' ? null : +ev.cal.slice(1),
    start_date: ev.start, end_date: ev.end, all_day: ev.allDay,
    start_time: ev.allDay ? null : ev.st, end_time: ev.allDay ? null : ev.en,
    place: ev.place || null, memo: ev.memo || null,
    assignee_user_id: ev.assignee ? +ev.assignee : null, department_id: ev.deptId ? +ev.deptId : null,
    shared: ev.cal === 'personal' && !!ev.shared, share_scope: ev.scope || 'detail',
    notify_minutes: ev.notify ? +ev.notify : null, repeat_rule: ev.repeat || 'none',
    repeat_until: ev.repeat && ev.repeat !== 'none' && ev.until ? ev.until : null,
    important: !!ev.important, color: ev.color || null, ...(ev.version ? { version: ev.version } : {})
  });

  SS.boot = async () => {
    const b = await SS.api('GET', '/schedule/bootstrap');
    D.me = b.me; D.company = b.company; D.members = b.members; D.departments = b.departments; D.sites = b.sites;
    D.calendars = FIXED.concat(b.calendars.map(calFromApi));
  };

  /* 表示中の月を含む範囲（前後 1 週間の余裕つき・56 日）。月・週・日・小さな月カレンダーのどれでも足りる */
  function windowFor(date) {
    const d = parse(date), first = new Date(d.getFullYear(), d.getMonth(), 1);
    const gridStart = addD(iso(first), -first.getDay());
    return { from: addD(gridStart, -7), to: addD(gridStart, 41 + 7) };
  }
  let loadSeq = 0;
  /* 予定を取る。範囲内なら取り直さない（force で取り直す）。古い要求の結果で新しい結果を上書きしない */
  SS.ensureEvents = async force => {
    const w = windowFor(S.date);
    if (!force && D.range && D.range.from <= w.from && D.range.to >= w.to) return false;
    const seq = ++loadSeq;
    S.loading = true; S.loadError = null;
    try {
      const r = await SS.api('GET', '/schedule/events?from=' + w.from + '&to=' + w.to);
      if (seq !== loadSeq) return false;
      D.events = r.events.map(evFromApi); D.range = w; SS.lastLoad = Date.now();
      return true;
    } catch (e) {
      if (seq === loadSeq) S.loadError = e.message;   // 前の表示は残す（ダミーに差し替えない）
      return true;
    } finally {
      if (seq === loadSeq) S.loading = false;
    }
  };

  /* ---------- 参照 ---------- */
  SS.me = () => SS.emp(D.me.id);
  SS.deptName = id => (D.departments.find(d => d.id === +id) || {}).name || '';
  SS.siteName = id => (D.sites.find(s => s.id === +id) || {}).name || '';
  SS.emp = id => {
    const m = D.members.find(x => x.id === +id);
    if (!m) return { id, name: '—', dept: '', site: '' };
    return { id: m.id, name: m.name, dept: SS.deptName(m.department_id), site: SS.siteName(m.site_id), deptId: m.department_id, siteId: m.site_id, isMgr: m.is_dept_manager, mail: m.email };
  };
  SS.cal = id => D.calendars.find(c => c.id === id);
  SS.ev = id => D.events.find(e => e.id === String(id));
  SS.isAdmin = () => !!D.me.can_manage;
  SS.roleLabel = () => D.me.role === 'super_admin' ? 'システム管理者' : D.me.role === 'admin' ? '企業管理者' : D.me.is_dept_manager ? '部署管理者' : '一般社員';

  /* 子カレンダー（業務別カレンダーの中のカレンダー。1 段だけ。権限は親と同じ） */
  SS.childrenOf = id => D.calendars.filter(c => c.parentId === id);
  SS.isParentCal = c => !!c && c.type === 'custom' && !c.parentId;
  /* 親のすぐ後ろに子が並ぶ順にする（親が入っていない子は出さない） */
  SS.calTree = list => list.filter(c => !c.parentId).flatMap(p => [p].concat(list.filter(c => c.parentId === p.id)));
  /* 左の一覧に出すカレンダー（非表示にしたものは管理者にも出さない。管理画面からは見える）。子は親も表示中のときだけ */
  SS.calList = () => SS.calTree(D.calendars.filter(c => c.type !== 'custom' || c.visible));
  SS.customCals = () => SS.calList().filter(c => c.type === 'custom');

  /* 管理メニュー（権限ごと）。部署管理者は部署・拠点を見るだけ（変更は企業管理者） */
  SS.navItems = () => {
    if (SS.isAdmin()) return [['calmanage', 'カレンダー管理', 'layers'], ['departments', '部署・拠点', 'building'], ['members', '社員の所属', 'users']];
    if (D.me.is_dept_manager) return [['departments', '部署・拠点', 'building']];
    return [];
  };
  SS.screenTitle = () => {
    if (S.screen === 'calendar') return S.cal === 'all' ? '全体表示' : (SS.cal(S.cal) || {}).name || '';
    const n = SS.navItems().find(x => x[0] === S.screen); return n ? n[1] : '';
  };

  /* ---------- 予定の取り出し ---------- */
  /* 繰り返し予定を期間内の 1 回ずつに展開する。毎月は同じ「日」で、その日がない月は飛ばす */
  function occurrences(ev, from, to) {
    const out = [], len = diffD(ev.start, ev.end), last = ev.repeat !== 'none' && ev.until ? ev.until : null;
    let s = ev.start, k = 0;
    while (s <= to && k < 800 && (!last || s <= last)) {
      const e = addD(s, len);
      if (e >= from) out.push(Object.assign({}, ev, { start: s, end: e }));
      if (!ev.repeat || ev.repeat === 'none') break;
      k++;
      if (ev.repeat === 'daily') s = addD(ev.start, k);
      else if (ev.repeat === 'weekly') s = addD(ev.start, k * 7);
      else {
        const b = parse(ev.start); let n = k, d;
        for (; n < k + 12; n++) { d = new Date(b.getFullYear(), b.getMonth() + n, b.getDate()); if (d.getDate() === b.getDate()) break; }
        k = n; s = iso(d);
      }
    }
    return out;
  }
  SS.occ = occurrences;

  /* 選んでいるカレンダーで、見える予定が決まる。
     共有予定は「個人予定に共有ONの印を付けたもの」で、二重には持たない */
  function match(ev, sel, raw) {
    const mine = ev.owner === D.me.id;
    if (sel === 'personal') return ev.cal === 'personal' && mine;
    if (sel === 'shared') {
      if (!(ev.cal === 'personal' && ev.shared)) return false;
      const o = SS.emp(ev.owner);
      if (!raw && S.fDept && String(o.deptId) !== S.fDept) return false;
      if (!raw && S.fSite && String(o.siteId) !== S.fSite) return false;
      return true;
    }
    if (sel === 'all') {
      // 自分の共有予定は、個人カレンダーを外していても共有カレンダーにチェックがあれば出す
      if (ev.cal === 'personal') return raw || (mine && !S.hidden.personal) || (ev.shared && !S.hidden.shared);
      const c = SS.calList().find(x => x.id === ev.cal);
      return !!c && (raw || !S.hidden[c.id]);
    }
    if (ev.cal === sel) return true;
    const c = SS.cal(ev.cal);   // 親カレンダーを選ぶと、中のカレンダーの予定も出す
    return !!c && c.parentId === sel;
  }
  SS.query = (sel, from, to, raw) => {
    const q = raw ? '' : S.q.trim().toLowerCase();
    let out = [];
    D.events.forEach(ev => {
      if (!match(ev, sel, raw)) return;
      if (q && !((ev.title + ' ' + ev.place + ' ' + (ev.assignee ? SS.emp(ev.assignee).name : '')).toLowerCase().includes(q))) return;
      out = out.concat(occurrences(ev, from, to));
    });
    return out.sort((a, b) => (a.start + (a.allDay ? '00:00' : a.st)).localeCompare(b.start + (b.allDay ? '00:00' : b.st)));
  };
  SS.onDay = (list, d) => list.filter(o => o.start <= d && o.end >= d);
  SS.isLong = o => o.allDay || o.start !== o.end;

  /* 中身は API が消して返す（予定ありのみ公開）。画面は印を見るだけ */
  SS.masked = ev => !!ev.masked;
  SS.titleOf = ev => ev.title;
  SS.layerOf = ev => ev.cal !== 'personal' ? ev.cal : (ev.owner === D.me.id && S.cal !== 'shared' && !(S.cal === 'all' && S.hidden.personal) ? 'personal' : 'shared');
  /* 予定に色を付けていればその色、なければ所属カレンダーの色 */
  SS.calColor = calId => { const c = SS.cal(calId); return SS.PAL[(c && c.color) || 'gray'] || SS.PAL.gray; };
  SS.colorOf = ev => (ev.color && SS.PAL[ev.color]) || SS.calColor(SS.layerOf(ev));
  SS.timeOf = o => o.allDay ? '終日' : o.st + '–' + o.en;

  /* ---------- 権限（API の印を見る） ---------- */
  SS.canAddTo = calId => calId === 'personal' || !!(SS.cal(calId) || {}).canEdit;
  SS.canEdit = ev => !!ev.canEdit;

  /* ---------- 書き込み ---------- */
  SS.createEvent = async ev => {
    const r = await SS.api('POST', '/schedule/events', SS.toApi(Object.assign({}, ev, { version: 0 })));
    const saved = evFromApi(r.event); D.events.push(saved); return saved;
  };
  SS.updateEvent = async ev => {
    const r = await SS.api('PUT', '/schedule/events/' + ev.sid, SS.toApi(ev));
    const saved = evFromApi(r.event), i = D.events.findIndex(e => e.id === saved.id);
    if (i >= 0) D.events[i] = saved; else D.events.push(saved);
    return saved;
  };
  SS.deleteEvent = async id => {
    const ev = SS.ev(id);
    await SS.api('DELETE', '/schedule/events/' + ev.sid);
    D.events = D.events.filter(e => e.id !== ev.id);
  };
  SS.saveCalendar = async (cal, isNew) => {
    const body = { parent_id: cal.parentId ? +cal.parentId.slice(1) : null, name: cal.name, description: cal.desc || null, color: cal.color, icon: cal.icon || 'cal', view_perm: cal.view, edit_perm: cal.edit, users_note: cal.users || null, notify: !!cal.notify, visible: cal.visible !== false };
    const r = isNew ? await SS.api('POST', '/schedule/calendars', body) : await SS.api('PUT', '/schedule/calendars/' + cal.sid, body);
    const saved = calFromApi(r.calendar), i = D.calendars.findIndex(c => c.id === saved.id);
    if (i >= 0) D.calendars[i] = saved; else D.calendars.push(saved);
    // 中のカレンダーの権限は外側と同じ（API も外側の設定で判定する）
    SS.childrenOf(saved.id).forEach(k => Object.assign(k, { view: saved.view, edit: saved.edit, users: saved.users, notify: saved.notify, canEdit: saved.canEdit }));
    return saved;
  };
  SS.deleteCalendar = async id => {
    const c = SS.cal(id);
    await SS.api('DELETE', '/schedule/calendars/' + c.sid);
    const gone = [id].concat(SS.childrenOf(id).map(x => x.id));   // 中のカレンダーとその予定も消える
    D.calendars = D.calendars.filter(x => !gone.includes(x.id));
    D.events = D.events.filter(e => !gone.includes(e.cal));
  };

  /* 拠点・部署・社員の所属（管理者のみ。API 側でも確認している） */
  const sortBy = list => list.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  SS.saveSite = async (site, isNew) => {
    const r = isNew ? await SS.api('POST', '/schedule/sites', { name: site.name }) : await SS.api('PUT', '/schedule/sites/' + site.id, { name: site.name });
    D.sites = sortBy(D.sites.filter(s => s.id !== r.site.id).concat(r.site));
  };
  SS.deleteSite = async id => {
    await SS.api('DELETE', '/schedule/sites/' + id);
    D.sites = D.sites.filter(s => s.id !== id);
    D.departments.forEach(d => { if (d.site_id === id) d.site_id = null; });   // 外部キーで空になるのと同じ
    D.members.forEach(m => { if (m.site_id === id) m.site_id = null; });
  };
  SS.saveDept = async (dept, isNew) => {
    const body = { name: dept.name, site_id: dept.site_id || null };
    const r = isNew ? await SS.api('POST', '/schedule/departments', body) : await SS.api('PUT', '/schedule/departments/' + dept.id, body);
    D.departments = sortBy(D.departments.filter(d => d.id !== r.department.id).concat(r.department));
  };
  SS.deleteDept = async id => {
    await SS.api('DELETE', '/schedule/departments/' + id);
    D.departments = D.departments.filter(d => d.id !== id);
    D.members.forEach(m => { if (m.department_id === id) { m.department_id = null; m.is_dept_manager = false; } });
    D.events.forEach(e => { if (e.deptId === id) e.deptId = null; });
  };
  SS.saveMember = async (userId, body) => {
    const r = await SS.api('PUT', '/schedule/members/' + userId, body);
    const m = D.members.find(x => x.id === userId);
    if (m) Object.assign(m, { department_id: r.member.department_id, site_id: r.member.site_id, is_dept_manager: r.member.is_dept_manager });
    if (userId === D.me.id) Object.assign(D.me, { department_id: r.member.department_id, site_id: r.member.site_id, is_dept_manager: r.member.is_dept_manager });
    return r.member;
  };

  SS.toast = msg => {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.className = 'show';
    clearTimeout(SS._tt); SS._tt = setTimeout(() => t.className = '', 2600);
  };
})(window.SS);
