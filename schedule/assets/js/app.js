/* Schedule Studio — 描画と操作。クリックは data-act で受け、状態を変えて全体を描き直す。
   - 入力画面（モーダル）を開いている間は、裏で予定を読み込み直しても描き直さない（入力中の文字が消えるため）
   - 保存に失敗したときは入力内容を残して、理由を入力画面の上に出す
   - ドラッグ移動は先に画面へ反映し、保存に失敗したら元に戻す */
(function (SS) {
  const S = SS.S, V = SS.V, D = SS.D;
  const $ = id => document.getElementById(id);
  let wasMobile = SS.isMobile(), justDragged = false, focusNew = false, ready = false, pending = false, busy = false;

  function render() {
    if (!ready) return;
    if (S.screen !== 'calendar' && !SS.navItems().some(n => n[0] === S.screen)) S.screen = 'calendar';
    if (S.cal !== 'all' && !SS.calList().some(c => c.id === S.cal)) S.cal = 'personal';
    if (S.selEvent && !SS.ev(S.selEvent)) S.selEvent = null;
    if (S.float && !SS.ev(S.float.id)) S.float = null;
    pending = false;

    const act = document.activeElement, keepQ = act && act.id === 'q', pos = keepQ ? act.selectionStart : 0;
    document.body.dataset.screen = S.screen;
    $('app').innerHTML = SS.layout() + V.floats() + ((S.float || S.quick) && SS.isMobile() ? '<div class="sheet-scrim"></div>' : '') + V.modal();
    SS.saveUI();

    if (keepQ && $('q')) { $('q').focus(); try { $('q').setSelectionRange(pos, pos); } catch (e) { } }
    const tg = $('tgScroll');
    if (tg) { tg.scrollTop = SS._scroll == null ? 7.5 * SS.HOUR : SS._scroll; tg.addEventListener('scroll', () => SS._scroll = tg.scrollTop); }
    const f = $('float'), p = S.float || S.quick;
    if (f && p && !SS.isMobile()) {
      const w = f.offsetWidth, hh = f.offsetHeight;
      let x = p.x + 14, y = p.y - 24;
      if (x + w > innerWidth - 10) x = p.x - w - 14;
      f.style.left = Math.max(10, x) + 'px'; f.style.top = Math.max(10, Math.min(y, innerHeight - hh - 10)) + 'px';
    }
    syncForm();
    if (focusNew) { focusNew = false; const t = $('q_title') || $('f_title') || $('c_name') || $('o_name'); if (t && !SS.isMobile()) t.focus(); }
  }
  SS.render = render;
  /* 裏の読み込みが終わったとき用。入力中なら後回しにする */
  const softRender = () => { if (S.modal || S.quick) pending = true; else render(); };

  /* 予定を（必要なら）読み込んで描き直す */
  async function load(force) {
    const p = SS.ensureEvents(force);
    if (S.loading) softRender();   // 「読み込み中」を出す
    if (await p) softRender();
  }

  /* 入力画面：カレンダーの種類・共有・終日・繰り返しに応じて欄を出し入れする（描き直さずに DOM を直接切り替える） */
  function syncForm() {
    if (!$('f_cal')) return;
    const personal = $('f_cal').value === 'personal', sh = $('f_shared').checked, ad = $('f_allday').checked;
    $('shareBox').hidden = !personal; $('calNote').hidden = personal; $('scopeBox').hidden = !sh;
    $('shareHint').textContent = sh ? '共有ON：共有カレンダーにも表示されます（予定は1件のまま・二重登録なし）' : '共有OFF：自分だけが見られます';
    $('f_st').disabled = $('f_en').disabled = ad;
    $('untilBox').hidden = $('f_repeat').value === 'none';
  }
  /* 入力画面の内容を状態に写す（保存に失敗して描き直しても、入力が消えないように） */
  function readForm(ev) {
    const g = id => $(id).value;
    Object.assign(ev, {
      title: g('f_title').trim(), start: g('f_start') || ev.start, end: g('f_end') || g('f_start') || ev.end,
      allDay: $('f_allday').checked, st: g('f_st') || '09:00', en: g('f_en') || '10:00', place: g('f_place').trim(),
      assignee: g('f_assignee') ? +g('f_assignee') : null, deptId: g('f_dept') ? +g('f_dept') : null,
      repeat: g('f_repeat'), until: g('f_until'), notify: g('f_notify'), memo: g('f_memo').trim(), cal: g('f_cal'),
      important: $('f_imp').checked, shared: $('f_shared').checked,
      scope: (document.querySelector('[name=f_scope]:checked') || {}).value || 'detail'
    });
    if (ev.end < ev.start) ev.end = ev.start;
    if (!ev.allDay && ev.start === ev.end && ev.en <= ev.st) ev.en = SS.hm(Math.min(1439, SS.mins(ev.st) + 60));
    return ev;
  }

  function draft(d, st, en, allDay) {
    const me = SS.D.me, custom = !['personal', 'shared', 'all'].includes(S.cal) && SS.canAddTo(S.cal);
    return {
      id: null, title: '', start: d, end: d, allDay: !!allDay, st: st || '09:00', en: en || '10:00', place: '', owner: me.id, assignee: me.id, deptId: me.department_id,
      memo: '', cal: custom ? S.cal : 'personal', shared: S.cal === 'shared', scope: 'detail', notify: '10', repeat: 'none', until: '', important: false
    };
  }
  const openEvent = (ev, isNew) => { S.modal = { type: 'event', ev, isNew }; S.float = S.quick = null; focusNew = isNew; };
  const shiftMonth = n => { const d = SS.parse(S.date); d.setDate(1); d.setMonth(d.getMonth() + n); S.date = SS.iso(d); };

  /* 保存ボタンを押せなくして API を呼ぶ（二度押しで二重登録しない） */
  async function withBusy(fn) {
    if (busy) return;
    busy = true;
    const b = $('saveBtn') || $('quickBtn');
    if (b) { b.disabled = true; b.dataset.label = b.textContent; b.textContent = '保存中…'; }
    try { await fn(); }
    finally { busy = false; }
  }
  /* 失敗したとき: 入力画面があればその上に理由を出す。他の人が先に変えていたら読み込み直す */
  function fail(e) {
    if (e.status === 409) { S.modal = null; SS.toast(e.message); load(true); render(); return; }
    if (S.modal) { S.modal.err = e.message; render(); return; }
    SS.toast(e.message); render();
  }

  /* ---------- 操作 ---------- */
  const A = {
    go(a) { S.screen = a; S.drawer = false; S.selEvent = null; },
    cal(a) { S.cal = a; S.screen = 'calendar'; S.selEvent = null; S.drawer = false; },
    bcheck(a) {   // チェックを入れたカレンダーを重ねて表示
      if (S.cal === 'all') { S.hidden[a] = !S.hidden[a]; return; }
      const cur = S.cal; S.hidden = {};
      SS.calList().forEach(c => { if (c.id !== cur && c.id !== a) S.hidden[c.id] = true; });
      if (cur === a) return;
      S.cal = 'all'; S.selEvent = null;
    },
    view(a) { S.view = a; SS._scroll = null; },
    nav(a) {
      const n = +a, v = SS.view();
      if (v === 'month') shiftMonth(n); else { S.date = SS.addD(S.date, v === 'week' ? 7 * n : n); S.selDate = S.date; }
      load();
    },
    mnav(a) { shiftMonth(+a); load(); },
    today() { S.date = S.selDate = SS.today(); SS._scroll = null; load(); },
    reload() { load(true); return false; },
    day(a, el, e) {
      S.selDate = S.date = a; S.selEvent = null;
      if (SS.isMobile()) { S.view = 'day'; return; }
      S.quick = { d: a, st: '09:00', en: '10:00', cal: draft(a).cal, x: e.clientX, y: e.clientY }; focusNew = true;
    },
    goday(a) { S.date = S.selDate = a; S.view = 'day'; SS._scroll = null; load(); },
    more(a) { A.goday(a); },
    pick(a) { S.date = S.selDate = a; load(); },
    ev(a, el, e) {
      S.selDate = el.dataset.d; S.selEvent = a; S.quick = null;
      S.float = { id: a, d: el.dataset.d, x: e.clientX, y: e.clientY };
    },
    slot(a, el, e) {
      const d = el.dataset.d; let st = '09:00', en = '10:00';
      if (a !== 'all') { const m = Math.max(0, Math.min(1380, Math.floor((e.clientY - el.getBoundingClientRect().top) / SS.HOUR * 2) * 30)); st = SS.hm(m); en = SS.hm(m + 60); }
      S.selDate = d;
      if (!SS.isMobile()) { S.quick = { d, st, en, allDay: a === 'all', cal: draft(d).cal, x: e.clientX, y: e.clientY }; S.float = null; focusNew = true; }
      else openEvent(draft(d, st, en, a === 'all'), true);
    },
    add() { openEvent(draft(S.selDate), true); S.drawer = false; },
    edit(a) { openEvent(Object.assign({}, SS.ev(a)), false); },
    quicksave() {
      const q = S.quick, t = $('q_title').value.trim();
      if (!t) { $('q_title').focus(); SS.toast('予定名を入力してください'); return false; }
      const ev = draft(q.d, q.st, q.en, q.allDay); ev.title = t;
      withBusy(async () => {
        try { const saved = await SS.createEvent(ev); S.quick = null; S.selEvent = saved.id; SS.toast('予定を追加しました'); render(); }
        catch (e) { const b = $('quickBtn'); if (b) { b.disabled = false; b.textContent = '保存'; } SS.toast(e.message); }
      });
      return false;
    },
    quickmore() { const q = S.quick, ev = draft(q.d, q.st, q.en, q.allDay); ev.title = $('q_title').value.trim(); openEvent(ev, true); },
    save() {
      const m = S.modal, ev = readForm(m.ev);
      if (!ev.title) { $('f_title').focus(); SS.toast('予定名を入力してください'); return false; }
      m.err = null;
      withBusy(async () => {
        try {
          const saved = m.isNew ? await SS.createEvent(ev) : await SS.updateEvent(ev);
          S.modal = null; S.selEvent = saved.id; S.selDate = saved.start;
          if (!D.range || saved.start < D.range.from || saved.start > D.range.to) { S.date = saved.start; load(); }
          SS.toast(m.isNew ? (saved.shared ? '予定を追加し、共有カレンダーにも表示しました' : '予定を追加しました') : '予定を更新しました');
          render();
        } catch (e) { fail(e); }
      });
      return false;
    },
    askdel(a) { const ev = SS.ev(a); S.float = null; S.modal = { type: 'confirm', msg: `「${ev.title}」を削除します。${ev.repeat !== 'none' ? '繰り返しの予定はすべて削除されます。' : ''}よろしいですか？`, fn: 'ev', arg: a }; },
    askdelcal(a) { const c = SS.cal(a); S.modal = { type: 'confirm', msg: `「${c.name}」と、その中の予定をすべて削除します。元に戻せません。よろしいですか？`, fn: 'cal', arg: a }; },
    confirm() {
      const m = S.modal; m.err = null;
      withBusy(async () => {
        try {
          if (m.fn === 'ev') { await SS.deleteEvent(m.arg); S.selEvent = null; SS.toast('予定を削除しました'); }
          else if (m.fn === 'site') { await SS.deleteSite(m.arg); SS.toast('拠点を削除しました'); }
          else if (m.fn === 'dept') { await SS.deleteDept(m.arg); SS.toast('部署を削除しました'); }
          else { await SS.deleteCalendar(m.arg); SS.toast('カレンダーを削除しました'); }
          S.modal = null; render();
        } catch (e) { fail(e); }
      });
      return false;
    },
    close() { if (busy) return false; S.modal = null; },
    'close-bg'(a, el, e) { if (e.target !== el || busy) return false; S.modal = null; },
    closefloat() { S.float = S.quick = null; },
    drawer() { S.drawer = !S.drawer; },
    calnew() { S.modal = { type: 'cal', isNew: true, cal: { id: null, type: 'custom', name: '', desc: '', color: 'gray', icon: 'cal', view: 'all', edit: 'manager', users: '全社員', notify: true, visible: true } }; S.drawer = false; focusNew = true; },
    caledit(a) { S.modal = { type: 'cal', isNew: false, cal: Object.assign({}, SS.cal(a)) }; },
    calsave() {
      const m = S.modal, c = m.cal;
      Object.assign(c, { name: $('c_name').value.trim(), desc: $('c_desc').value.trim(), color: (document.querySelector('[name=c_color]:checked') || {}).value || 'gray', view: $('c_view').value, edit: $('c_edit').value, users: $('c_users').value.trim(), notify: $('c_notify').checked, visible: $('c_visible').checked });
      if (!c.name) { $('c_name').focus(); SS.toast('カレンダー名を入力してください'); return false; }
      m.err = null;
      withBusy(async () => {
        try {
          const saved = await SS.saveCalendar(c, m.isNew);
          S.modal = null;
          if (m.isNew && S.screen === 'calendar') { S.cal = saved.id; SS.toast('「' + saved.name + '」を追加しました'); }
          else SS.toast(m.isNew ? '「' + saved.name + '」を追加しました' : 'カレンダーの設定を保存しました');
          render();
        } catch (e) { fail(e); }
      });
      return false;
    },
    clearq() { S.q = ''; },

    /* ---------- 管理画面 ---------- */
    calvis(a) {
      const c = Object.assign({}, SS.cal(a), { visible: !SS.cal(a).visible });
      withBusy(async () => {
        try { await SS.saveCalendar(c, false); SS.toast(c.visible ? '「' + c.name + '」をメニューに表示しました' : '「' + c.name + '」をメニューから外しました'); }
        catch (e) { SS.toast(e.message); }
        render();
      });
      return false;
    },
    sitenew() { S.modal = { type: 'site', isNew: true, item: { name: '' } }; focusNew = true; },
    siteedit(a) { S.modal = { type: 'site', isNew: false, item: Object.assign({}, D.sites.find(s => s.id === +a)) }; focusNew = true; },
    deptnew() { S.modal = { type: 'dept', isNew: true, item: { name: '', site_id: null } }; focusNew = true; },
    deptedit(a) { S.modal = { type: 'dept', isNew: false, item: Object.assign({}, D.departments.find(d => d.id === +a)) }; focusNew = true; },
    orgsave() {
      const m = S.modal, o = m.item;
      o.name = $('o_name').value.trim();
      if ($('o_site')) o.site_id = $('o_site').value ? +$('o_site').value : null;
      if (!o.name) { $('o_name').focus(); SS.toast('名前を入力してください'); return false; }
      m.err = null;
      withBusy(async () => {
        try {
          if (m.type === 'site') await SS.saveSite(o, m.isNew); else await SS.saveDept(o, m.isNew);
          S.modal = null; SS.toast((m.type === 'site' ? '拠点' : '部署') + '「' + o.name + '」を' + (m.isNew ? '追加' : '保存') + 'しました'); render();
        } catch (e) { fail(e); }
      });
      return false;
    },
    askdelsite(a) { const s = D.sites.find(x => x.id === +a); S.modal = { type: 'confirm', msg: `拠点「${s.name}」を削除します。この拠点に属する部署・社員の拠点は空欄になります。よろしいですか？`, fn: 'site', arg: +a }; },
    askdeldept(a) { const d = D.departments.find(x => x.id === +a); S.modal = { type: 'confirm', msg: `部署「${d.name}」を削除します。所属していた社員と予定の部署は空欄になり、この部署の部署管理者も外れます。よろしいですか？`, fn: 'dept', arg: +a }; },
    deptcal(a) { S.screen = 'calendar'; S.cal = 'shared'; S.fDept = String(a); S.fSite = ''; S.selEvent = null; }
  };

  document.addEventListener('click', e => {
    if (justDragged || !ready) return;
    let dirty = false;
    if (!e.target.closest('.pop') && (S.float || S.quick) && !busy) { S.float = S.quick = null; dirty = true; }
    const el = e.target.closest('[data-act]');
    const fn = el && A[el.dataset.act];
    if (fn && fn(el.dataset.arg, el, e) !== false) dirty = true;
    if (dirty) render();
    else if (pending && !S.modal && !S.quick) render();
  });
  document.addEventListener('dblclick', e => { if (e.target.closest('.mcell') && !e.target.closest('.chip')) { S.quick = null; A.add(); render(); } });
  document.addEventListener('change', e => {
    if (e.target.closest('.modal')) { syncForm(); return; }
    /* 社員の所属: 変えた行をすぐ保存する。失敗したら元の表示に戻す */
    const row = e.target.closest('[data-member]');
    if (row && e.target.dataset.mem) {
      const uid = +row.dataset.member, q = s => row.querySelector('[data-mem=' + s + ']');
      const dept = q('department_id').value ? +q('department_id').value : null;
      const body = { department_id: dept, site_id: q('site_id').value ? +q('site_id').value : null, is_dept_manager: !!dept && q('is_dept_manager').checked };
      row.querySelectorAll('select,input').forEach(x => x.disabled = true);
      SS.saveMember(uid, body)
        .then(() => SS.toast((D.members.find(x => x.id === uid) || {}).name + ' さんの所属を保存しました'))
        .catch(err => SS.toast('保存できませんでした。' + err.message))
        .finally(() => { if (!S.modal) render(); });
      return;
    }
    const el = e.target.closest('[data-change]'); if (!el) return;
    S[el.dataset.change] = el.value;
    render();
  });
  document.addEventListener('input', e => { if (e.target.id === 'q' && !e.isComposing) { S.q = e.target.value; render(); } });
  document.addEventListener('compositionend', e => { if (e.target.id === 'q') { S.q = e.target.value; render(); } });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !busy && (S.modal || S.float || S.quick || S.drawer)) { S.modal = S.float = S.quick = null; S.drawer = false; render(); }
    if (e.key === 'Enter' && !e.isComposing && e.target.id === 'q_title') A.quicksave();
  });

  /* 時間軸の予定をドラッグで移動（15 分きざみ・日をまたげる）。繰り返し予定は全部の回が同じだけ動く */
  let drag = null;
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0 || SS.isMobile() || busy) return;
    const el = e.target.closest('.tev.drag'); if (el) drag = { el, id: el.dataset.arg, d: el.dataset.d, x: e.clientX, y: e.clientY, moved: false };
  });
  document.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true; drag.el.classList.add('dragging'); drag.el.style.transform = `translate(${dx}px,${dy}px)`;
  });
  document.addEventListener('pointerup', async e => {
    const g = drag; drag = null; if (!g || !g.moved) return;
    justDragged = true; setTimeout(() => justDragged = false, 60);
    g.el.style.pointerEvents = 'none';
    const under = document.elementFromPoint(e.clientX, e.clientY), col = under && under.closest('.tg-col');
    const ev = SS.ev(g.id), before = Object.assign({}, ev), len = SS.mins(ev.en) - SS.mins(ev.st);
    const s = Math.max(0, Math.min(1440 - len, SS.mins(ev.st) + Math.round((e.clientY - g.y) / SS.HOUR * 4) * 15)), dd = col ? SS.diffD(g.d, col.dataset.d) : 0;
    if (s === SS.mins(ev.st) && dd === 0) { render(); return; }
    Object.assign(ev, { st: SS.hm(s), en: SS.hm(s + len), start: SS.addD(ev.start, dd), end: SS.addD(ev.end, dd) });
    S.selEvent = ev.id; S.float = null; render();
    busy = true;
    try {
      await SS.updateEvent(ev);
      SS.toast('予定を ' + SS.md(SS.addD(g.d, dd)) + ' ' + SS.hm(s) + ' に移動しました');
    } catch (err) {
      Object.assign(ev, before);
      if (err.status === 409) { SS.toast(err.message); load(true); } else SS.toast('移動できませんでした。' + err.message);
    } finally { busy = false; render(); }
  });

  window.addEventListener('resize', () => { const m = SS.isMobile(); if (m !== wasMobile) { wasMobile = m; S.float = S.quick = null; if (!S.modal) render(); } });
  /* 他の人の変更: 画面に戻ってきたとき（1 分以上たっていたら）と、5 分ごとに読み込み直す */
  document.addEventListener('visibilitychange', () => { if (ready && document.visibilityState === 'visible' && Date.now() - (SS.lastLoad || 0) > 60e3) load(true); });
  setInterval(() => { if (ready && document.visibilityState === 'visible' && !busy) load(true); }, 5 * 60e3);

  /* ---------- 起動 ---------- */
  function fatal(title, msg) {
    $('app').innerHTML = `<div class="boot"><div class="boot-card">${V.logo()}<h1>${SS.h(title)}</h1><p>${SS.h(msg)}</p>
      <div class="boot-a"><button class="btn primary" onclick="location.reload()">読み込み直す</button><a class="btn" href="../../space/apps.html">アプリ選択に戻る</a></div></div></div>`;
  }
  async function start() {
    const user = requireSpaceAuth();   // solid/assets/js/auth.js。未ログインなら Space.app のログイン画面へ
    if (!user) return;
    SS.loadUI(user.id);
    try { await SS.boot(); }
    catch (e) {
      if (e.status === 401) return;
      if (e.status === 403) fatal('Schedule Studio を利用できません', 'この会社またはアカウントでは Schedule Studio が有効になっていません。Space.app の管理者に、利用アプリへの追加を依頼してください。');
      else fatal('読み込めませんでした', e.message);
      return;
    }
    if (SS.isMobile() && !localStorage.getItem('ss_ui_v1_' + user.id)) S.view = 'day';
    ready = true;
    render();
    load();
  }
  start();
})(window.SS);
