/* Schedule Studio — 画面の部品（月・週・日、予定詳細、入力画面）。モック B 案から移したもの。
   予定名などの表示は必ず SS.h() でエスケープする。 */
(function (SS) {
  const { h, S, parse, addD, iso, WD, PAL } = SS;
  const V = SS.V = {};

  /* ---------- アイコン ---------- */
  const P = {
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17.5 14.5c2.4 0 4 1.5 4 4"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
    truck: '<path d="M2 6h11v10H2zM13 9h4l4 4v3h-8z"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    factory: '<path d="M3 21V10l6 4v-4l6 4V5h6v16z"/>',
    video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3"/>',
    flag: '<path d="M5 21V4h12l-2 4 2 4H5"/>',
    wrench: '<path d="M14 6a4 4 0 0 0 5 5l-9 9a2.1 2.1 0 0 1-3-3l9-9a4 4 0 0 1-2-2z"/>',
    building: '<rect x="5" y="3" width="14" height="18"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', chevL: '<path d="M15 5l-7 7 7 7"/>', chevR: '<path d="M9 5l7 7-7 7"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
    pin: '<path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    edit: '<path d="M4 20h4l10-10-4-4L4 16z"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    repeat: '<path d="M4 11V9a3 3 0 0 1 3-3h11l-3-3M20 13v2a3 3 0 0 1-3 3H6l3 3"/>',
    note: '<path d="M5 4h14v16H5zM8 9h8M8 13h8M8 17h5"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 11l7.6-4M8.2 13l7.6 4"/>',
    back: '<path d="M10 6l-6 6 6 6M4 12h16"/>', grid: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>'
  };
  const I = SS.I = (n, sz) => `<svg class="ic" viewBox="0 0 24 24" width="${sz || 16}" height="${sz || 16}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || P.cal}</svg>`;
  V.logo = () => `<span class="logo"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16.5" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect class="logo-dot" x="13" y="12.5" width="5" height="5" rx="1"/></svg><span class="logo-t">Schedule <b>Studio</b></span></span>`;
  V.avatar = (name, cls) => `<span class="av ${cls || ''}">${h((name || '?').charAt(0))}</span>`;
  const sty = c => `style="--c:${c[0]};--cb:${c[1]}"`;
  V.sty = sty;

  /* ---------- ヘッダーの部品 ---------- */
  V.title = function () {
    const v = SS.view(), d = parse(S.date);
    if (v === 'month') return d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
    if (v === 'day') return d.getFullYear() + '年' + SS.md(S.date);
    const a = parse(addD(S.date, -d.getDay())), b = parse(addD(S.date, 6 - d.getDay()));
    return a.getFullYear() + '年' + (a.getMonth() + 1) + '月' + a.getDate() + '日 – ' + (a.getMonth() !== b.getMonth() ? (b.getMonth() + 1) + '月' : '') + b.getDate() + '日';
  };
  V.dateNav = () => `<div class="datenav"><button class="btn" data-act="today">今日</button><button class="icon-btn" data-act="nav" data-arg="-1" aria-label="前へ">${I('chevL')}</button><button class="icon-btn" data-act="nav" data-arg="1" aria-label="次へ">${I('chevR')}</button></div>`;
  V.seg = () => `<div class="seg" role="tablist">${[['month', '月'], ['week', '週'], ['day', '日']].map(x => `<button class="${SS.view() === x[0] ? 'on' : ''}" data-act="view" data-arg="${x[0]}">${x[1]}</button>`).join('')}</div>`;
  V.search = () => `<label class="search">${I('search')}<input id="q" type="search" data-input="q" placeholder="予定を検索" value="${h(S.q)}" autocomplete="off"></label>`;
  V.loading = () => S.loading ? `<span class="loading" role="status">${I('clock', 14)}読み込み中</span>` : '';

  /* メニューの一番下（Space.app 共通の決まり: 利用者 → アプリ選択に戻る。ログアウトは出さない） */
  V.sidebarBottom = function () {
    const me = SS.D.me;
    return `<div class="sidebar-bottom">
      <div class="sb-user">${V.avatar(me.name, 'me')}<span><b>${h(me.name)}</b><small>${SS.roleLabel()}</small></span></div>
      <a class="sb-back" href="../../space/apps.html">${I('back', 15)}アプリ選択に戻る</a></div>`;
  };

  /* ---------- 予定の小さな表示（月表示・終日欄） ---------- */
  function chip(o, d) {
    const long = SS.isLong(o), multi = o.start !== o.end, t = SS.titleOf(o);
    return `<div class="chip ${long ? 'solid' : ''} ${multi && d !== o.start ? 'cl' : ''} ${multi && d !== o.end ? 'cr' : ''} ${S.selEvent === o.id ? 'sel' : ''} ${SS.masked(o) ? 'busy' : ''}" data-act="ev" data-arg="${o.id}" data-d="${d}" ${sty(SS.colorOf(o))} title="${h(t)}"><i class="dot"></i>${long ? '' : `<span class="t">${o.st}</span>`}<span class="n">${o.important ? '<b class="imp mini" title="重要">!</b>' : ''}${h(t)}</span></div>`;
  }
  const sortDay = list => list.slice().sort((a, b) => (SS.isLong(b) - SS.isLong(a)) || a.st.localeCompare(b.st));

  /* ---------- 月表示 ---------- */
  V.month = function () {
    const d = parse(S.date), y = d.getFullYear(), m = d.getMonth(), first = new Date(y, m, 1);
    const start = addD(iso(first), -first.getDay());
    const weeks = Math.ceil((first.getDay() + new Date(y, m + 1, 0).getDate()) / 7);
    const end = addD(start, weeks * 7 - 1), occ = SS.query(S.cal, start, end), td = SS.today();
    let cells = '';
    for (let i = 0; i < weeks * 7; i++) {
      const x = addD(start, i), dx = parse(x), list = sortDay(SS.onDay(occ, x)), max = 3;
      cells += `<div class="mcell ${dx.getMonth() !== m ? 'out' : ''} ${x === td ? 'today' : ''} ${x === S.selDate ? 'sel' : ''} wd${dx.getDay()}" data-act="day" data-arg="${x}">
        <div class="mnum"><span data-act="goday" data-arg="${x}">${dx.getDate() === 1 ? (dx.getMonth() + 1) + '/1' : dx.getDate()}</span></div>
        <div class="mevs">${list.slice(0, max).map(o => chip(o, x)).join('')}${list.length > max ? `<div class="more" data-act="more" data-arg="${x}">他 ${list.length - max} 件</div>` : ''}</div></div>`;
    }
    return `<div class="month"><div class="m-head">${WD.map((w, i) => `<div class="wd${i}">${w}</div>`).join('')}</div><div class="m-grid" style="grid-template-rows:repeat(${weeks},minmax(var(--mrow),1fr))">${cells}</div></div>`;
  };

  /* ---------- 週・日表示（時間軸） ---------- */
  function layout(list) {   // 重なる予定を横に並べる
    list.sort((a, b) => a.s - b.s || b.e - a.e);
    let cluster = [], end = -1;
    const flush = () => {
      const cols = [];
      cluster.forEach(it => { let c = cols.findIndex(t => t <= it.s); if (c < 0) { c = cols.length; cols.push(0); } cols[c] = it.e; it.col = c; });
      cluster.forEach(it => it.cols = cols.length); cluster = [];
    };
    list.forEach(it => { if (cluster.length && it.s >= end) { flush(); end = -1; } cluster.push(it); end = Math.max(end, it.e); });
    flush();
  }
  V.timegrid = function (days) {
    const H = SS.HOUR, occ = SS.query(S.cal, days[0], days[days.length - 1]), td = SS.today();
    const cols = `style="grid-template-columns:var(--gut) repeat(${days.length},minmax(0,1fr))"`;
    const head = days.map(x => { const dx = parse(x); return `<div class="tg-dh ${x === td ? 'today' : ''} wd${dx.getDay()}" data-act="goday" data-arg="${x}"><span class="w">${WD[dx.getDay()]}</span><span class="n">${dx.getDate()}</span></div>`; }).join('');
    const all = days.map(x => `<div class="tg-ac" data-act="slot" data-d="${x}" data-arg="all">${sortDay(SS.onDay(occ, x).filter(SS.isLong)).map(o => chip(o, x)).join('')}</div>`).join('');
    let hours = '', lines = '';
    for (let i = 0; i < 24; i++) { hours += `<div class="tg-hr" style="height:${H}px"><span>${i ? i + ':00' : ''}</span></div>`; lines += `<div class="tg-ln" style="height:${H}px"></div>`; }
    const now = new Date(), nowTop = (now.getHours() * 60 + now.getMinutes()) / 60 * H;
    const body = days.map(x => {
      const list = occ.filter(o => !SS.isLong(o) && o.start === x).map(o => ({ o, s: SS.mins(o.st), e: Math.max(SS.mins(o.en), SS.mins(o.st) + 30) }));
      layout(list);
      return `<div class="tg-col ${x === td ? 'today' : ''}" data-act="slot" data-d="${x}"><div class="tg-lines">${lines}</div>` + list.map(it => {
        const o = it.o, short = it.e - it.s <= 30;
        return `<div class="tev ${short ? 'short' : ''} ${S.selEvent === o.id ? 'sel' : ''} ${SS.masked(o) ? 'busy' : ''} ${SS.canEdit(o) ? 'drag' : ''}" data-act="ev" data-arg="${o.id}" data-d="${x}"
          style="top:${it.s / 60 * H}px;height:${(it.e - it.s) / 60 * H - 2}px;left:calc(${it.col / it.cols * 100}% + 2px);width:calc(${100 / it.cols}% - 5px);--c:${SS.colorOf(o)[0]};--cb:${SS.colorOf(o)[1]}">
          <b>${o.important ? '<i class="imp mini" title="重要">!</i>' : ''}${h(SS.titleOf(o))}</b><span>${o.st} – ${o.en}${!SS.masked(o) && o.place ? '・' + h(o.place) : ''}</span></div>`;
      }).join('') + (x === td ? `<div class="tg-now" style="top:${nowTop}px"></div>` : '') + '</div>';
    }).join('');
    return `<div class="tg ${days.length === 1 ? 'one' : ''}"><div class="tg-scroll" id="tgScroll">
      <div class="tg-head" ${cols}><div class="tg-gut"></div>${head}</div>
      <div class="tg-all" ${cols}><div class="tg-gut">終日</div>${all}</div>
      <div class="tg-body" ${cols}><div class="tg-gut">${hours}</div>${body}</div></div></div>`;
  };
  V.week = () => { const s = addD(S.date, -parse(S.date).getDay()); return V.timegrid([0, 1, 2, 3, 4, 5, 6].map(i => addD(s, i))); };
  V.day = () => V.timegrid([S.date]);

  /* 絞り込み・状態の帯 */
  V.filterBar = function () {
    const D = SS.D, out = [];
    if (S.loadError) out.push(`<span class="fb-err" role="alert">${I('lock', 14)}${h(S.loadError)} <button class="link" data-act="reload">読み込み直す</button></span>`);
    if (S.cal === 'shared') {
      out.push(`<span class="fb-l">絞り込み</span>
        <select data-change="fDept" aria-label="部署"><option value="">全社（すべての部署）</option>${D.departments.map(d => `<option value="${d.id}" ${S.fDept === String(d.id) ? 'selected' : ''}>${h(d.name)}</option>`).join('')}</select>
        ${D.sites.length ? `<select data-change="fSite" aria-label="工場・拠点"><option value="">すべての工場・拠点</option>${D.sites.map(s => `<option value="${s.id}" ${S.fSite === String(s.id) ? 'selected' : ''}>${h(s.name)}</option>`).join('')}</select>` : ''}
        <span class="fb-note">${I('share', 14)}個人カレンダーで共有ONにした予定が自動で表示されます</span>`);
    } else if (S.cal === 'all') {
      out.push(`<span class="fb-l">重ねて表示中</span>` + SS.calList().filter(c => !S.hidden[c.id]).map(c => `<span class="lg" ${sty(PAL[c.color] || PAL.gray)}><i class="dot"></i>${h(c.name.replace('カレンダー', ''))}</span>`).join(''));
    } else if (S.cal === 'personal') {
      out.push(`<span class="fb-note">${I('lock', 14)}共有OFFの予定は本人だけに表示されます</span>`);
    } else {
      const c = SS.cal(S.cal); if (c) out.push(`<span class="fb-note">${h(c.desc || '')}</span>`);
    }
    if (S.q.trim()) out.push(`<span class="fb-q">「${h(S.q.trim())}」で検索中 <button class="link" data-act="clearq">解除</button></span>`);
    return `<div class="filterbar ${S.loadError ? 'has-err' : ''}">${out.join('')}</div>`;
  };
  V.calendar = () => V.filterBar() + `<div class="cal-area">${V[SS.view()]()}</div>`;

  /* 小さな月カレンダー */
  V.miniMonth = function () {
    const d = parse(S.date), y = d.getFullYear(), m = d.getMonth(), first = new Date(y, m, 1);
    const start = addD(iso(first), -first.getDay()), occ = SS.query(S.cal, start, addD(start, 41)), td = SS.today();
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const x = addD(start, i), dx = parse(x);
      cells += `<button class="mm-d ${dx.getMonth() !== m ? 'out' : ''} ${x === td ? 'today' : ''} ${x === S.selDate ? 'sel' : ''} ${SS.onDay(occ, x).length ? 'has' : ''}" data-act="pick" data-arg="${x}">${dx.getDate()}</button>`;
    }
    return `<div class="mini"><div class="mini-h"><b>${y}年${m + 1}月</b><span><button class="icon-btn sm" data-act="mnav" data-arg="-1" aria-label="前の月">${I('chevL', 14)}</button><button class="icon-btn sm" data-act="mnav" data-arg="1" aria-label="次の月">${I('chevR', 14)}</button></span></div>
      <div class="mini-g">${WD.map(w => `<i>${w}</i>`).join('')}${cells}</div></div>`;
  };

  /* ---------- 予定詳細 ---------- */
  V.detail = function (id, d, closable) {
    const base = SS.ev(id); if (!base) return '';
    const o = SS.occ(base, d, d)[0] || base, m = SS.masked(o), c = SS.cal(o.cal) || { name: '' }, a = o.assignee ? SS.emp(o.assignee) : null, ow = SS.emp(o.owner);
    const when = o.start === o.end ? SS.md(o.start) + '　' + (o.allDay ? '終日' : o.st + ' – ' + o.en) : SS.md(o.start) + (o.allDay ? '' : ' ' + o.st) + ' 〜 ' + SS.md(o.end) + (o.allDay ? '' : ' ' + o.en);
    const row = (icon, label, val) => val ? `<div class="d-row">${I(icon)}<div><span class="d-l">${label}</span><span class="d-v">${val}</span></div></div>` : '';
    const share = o.cal !== 'personal' ? h(c.name) + 'の利用者に公開' : !o.shared ? '共有OFF（本人のみ閲覧）' : o.scope === 'busy' ? '共有ON・予定ありのみ公開' : '共有ON・詳細を公開';
    const dept = SS.deptName(o.deptId) || (a ? a.dept : '');
    const repeat = o.repeat !== 'none' ? SS.REPEAT[o.repeat] + (o.until ? '（' + SS.md(o.until) + 'まで）' : '') : '';
    return `<div class="detail" ${sty(SS.colorOf(o))}>
      <div class="d-head"><i class="d-bar"></i><div><h3>${o.important && !m ? '<i class="imp">重要</i>' : ''}${h(SS.titleOf(o))}</h3><p>${when}</p></div>${closable ? `<button class="icon-btn" data-act="closefloat" aria-label="閉じる">${I('x')}</button>` : ''}</div>
      ${m ? `<div class="d-mask">${I('lock')}この予定は「予定ありのみ公開」です。詳細は登録者だけが見られます。</div>${row('user', '登録者', h(ow.name) + (ow.dept ? '（' + h(ow.dept) + '）' : ''))}`
        : row('cal', 'カレンダー', `<span class="lg"><i class="dot"></i>${h(c.name)}</span>`) + row('pin', '場所', h(o.place)) + row('user', '担当者', a ? h(a.name) : '')
        + row('building', '部署・工場', h(dept) + (a && a.site ? '／' + h(a.site) : '')) + row('edit', '登録者', h(ow.name)) + row('share', '共有', share)
        + row('repeat', '繰り返し', h(repeat)) + row('bell', '通知', SS.NOTIFY[o.notify] || '') + row('note', 'メモ', h(o.memo).replace(/\n/g, '<br>'))}
      <div class="d-foot">${SS.canEdit(o) && !m ? `<button class="btn" data-act="edit" data-arg="${o.id}">${I('edit', 14)}編集</button><button class="btn danger" data-act="askdel" data-arg="${o.id}">${I('trash', 14)}削除</button>` : `<span class="ro">${I('lock', 14)}閲覧のみ</span>`}</div></div>`;
  };

  /* ---------- 入力画面（モーダル） ---------- */
  const opt = (v, l, cur) => `<option value="${h(v)}" ${String(v) === String(cur == null ? '' : cur) ? 'selected' : ''}>${h(l)}</option>`;
  const err = () => S.modal && S.modal.err ? `<p class="form-err" role="alert">${h(S.modal.err)}</p>` : '';
  function eventModal(ev, isNew) {
    const D = SS.D, cals = D.calendars.filter(c => c.type === 'personal' || (c.type === 'custom' && (SS.canAddTo(c.id) || c.id === ev.cal)));
    return `<div class="modal-bg" data-act="close-bg"><div class="modal" role="dialog" aria-modal="true" aria-label="${isNew ? '予定を追加' : '予定を編集'}">
      <div class="modal-h"><h2>${isNew ? '予定を追加' : '予定を編集'}</h2><button class="icon-btn" data-act="close" aria-label="閉じる">${I('x')}</button></div>
      <div class="modal-b">${err()}
        <label class="fld full"><span>予定名</span><input id="f_title" value="${h(ev.title)}" placeholder="例）A社 打合せ" maxlength="200"></label>
        <div class="fld-4"><label class="fld"><span>開始日</span><input type="date" id="f_start" value="${ev.start}"></label><label class="fld"><span>開始時間</span><input type="time" id="f_st" value="${ev.st}" step="900"></label>
          <label class="fld"><span>終了日</span><input type="date" id="f_end" value="${ev.end}"></label><label class="fld"><span>終了時間</span><input type="time" id="f_en" value="${ev.en}" step="900"></label></div>
        <div class="checks"><label class="ckl"><input type="checkbox" id="f_allday" ${ev.allDay ? 'checked' : ''}>終日</label><label class="ckl"><input type="checkbox" id="f_imp" ${ev.important ? 'checked' : ''}>重要な予定にする</label></div>
        <div class="fld-2"><label class="fld"><span>所属カレンダー</span><select id="f_cal">${cals.map(c => opt(c.id, c.name, ev.cal)).join('')}</select></label>
          <label class="fld"><span>場所</span><input id="f_place" value="${h(ev.place)}" placeholder="会議室・訪問先など" maxlength="200"></label></div>
        <div class="fld-2"><label class="fld"><span>担当者</span><select id="f_assignee">${opt('', '（なし）', ev.assignee)}${D.members.map(e => opt(e.id, e.name + (SS.deptName(e.department_id) ? '（' + SS.deptName(e.department_id) + '）' : ''), ev.assignee)).join('')}</select></label>
          <label class="fld"><span>部署</span><select id="f_dept">${opt('', '（なし）', ev.deptId)}${D.departments.map(d => opt(d.id, d.name, ev.deptId)).join('')}</select></label></div>
        <div class="fld-2"><label class="fld"><span>繰り返し</span><select id="f_repeat">${Object.keys(SS.REPEAT).map(k => opt(k, SS.REPEAT[k], ev.repeat)).join('')}</select></label>
          <label class="fld"><span>通知設定</span><select id="f_notify">${Object.keys(SS.NOTIFY).map(k => opt(k, SS.NOTIFY[k], ev.notify)).join('')}</select></label></div>
        <label class="fld" id="untilBox"><span>繰り返しの終わり（空欄なら続ける）</span><input type="date" id="f_until" value="${ev.until || ''}"></label>
        <div class="share-box" id="shareBox">
          <label class="share-top"><div><b>共有カレンダーに表示する</b><small id="shareHint"></small></div><span class="swi"><input type="checkbox" id="f_shared" ${ev.shared ? 'checked' : ''}><i></i></span></label>
          <div class="scope" id="scopeBox"><span>公開範囲</span>
            <label class="radio"><input type="radio" name="f_scope" value="detail" ${ev.scope !== 'busy' ? 'checked' : ''}><span><b>詳細を公開</b><small>予定名・場所・メモまで見える</small></span></label>
            <label class="radio"><input type="radio" name="f_scope" value="busy" ${ev.scope === 'busy' ? 'checked' : ''}><span><b>予定ありのみ公開</b><small>時間帯だけ見え、中身は「予定あり」</small></span></label></div>
        </div>
        <div class="cal-note" id="calNote">${I('users', 14)}このカレンダーの利用者全員に表示されます。</div>
        <label class="fld full"><span>メモ</span><textarea id="f_memo" rows="3" placeholder="持ち物・連絡事項など" maxlength="5000">${h(ev.memo)}</textarea></label>
        <p class="hint">通知はまだ送られません（設定だけ保存されます）。</p>
      </div>
      <div class="modal-f">${isNew ? '' : `<button class="btn danger" data-act="askdel" data-arg="${ev.id}">${I('trash', 14)}削除</button>`}<span class="grow"></span><button class="btn" data-act="close">キャンセル</button><button class="btn primary" data-act="save" id="saveBtn">保存</button></div></div></div>`;
  }
  function calModal(c, isNew) {
    return `<div class="modal-bg" data-act="close-bg"><div class="modal narrow" role="dialog" aria-modal="true" aria-label="カレンダーの設定">
      <div class="modal-h"><h2>${isNew ? '新しいカレンダー' : 'カレンダーの設定'}</h2><button class="icon-btn" data-act="close" aria-label="閉じる">${I('x')}</button></div>
      <div class="modal-b">${err()}
        <label class="fld full"><span>カレンダー名</span><input id="c_name" value="${h(c.name)}" placeholder="例）出張カレンダー" maxlength="100"></label>
        <label class="fld full"><span>説明</span><input id="c_desc" value="${h(c.desc)}" placeholder="何の予定を入れるカレンダーか" maxlength="255"></label>
        <div class="fld full"><span>色</span><div class="swatches">${Object.keys(PAL).filter(k => k !== 'blue' && k !== 'green').map(k => `<label><input type="radio" name="c_color" value="${k}" ${c.color === k ? 'checked' : ''} aria-label="${k}"><i style="--c:${PAL[k][0]};--cb:${PAL[k][1]}"></i></label>`).join('')}</div></div>
        <div class="fld-2"><label class="fld"><span>閲覧権限</span><select id="c_view">${Object.keys(SS.PERM).map(k => opt(k, SS.PERM[k], c.view)).join('')}</select></label>
          <label class="fld"><span>編集権限</span><select id="c_edit">${Object.keys(SS.PERM).map(k => opt(k, SS.PERM[k], c.edit)).join('')}</select></label></div>
        <label class="fld full"><span>利用者（説明）</span><input id="c_users" value="${h(c.users)}" placeholder="全社員／部署名など" maxlength="255"></label>
        <div class="checks"><label class="ckl"><input type="checkbox" id="c_notify" ${c.notify ? 'checked' : ''}>予定の追加・変更を利用者に通知する</label><label class="ckl"><input type="checkbox" id="c_visible" ${c.visible !== false ? 'checked' : ''}>メニューに表示する</label></div>
      </div>
      <div class="modal-f">${isNew ? '' : `<button class="btn danger" data-act="askdelcal" data-arg="${c.id}">${I('trash', 14)}削除</button>`}<span class="grow"></span><button class="btn" data-act="close">キャンセル</button><button class="btn primary" data-act="calsave" id="saveBtn">保存</button></div></div></div>`;
  }
  V.modal = function () {
    const m = S.modal; if (!m) return '';
    if (m.type === 'event') return eventModal(m.ev, m.isNew);
    if (m.type === 'cal') return calModal(m.cal, m.isNew);
    if (m.type === 'site' || m.type === 'dept') return V.orgModal(m);
    if (m.type === 'confirm') return `<div class="modal-bg" data-act="close-bg"><div class="modal confirm" role="alertdialog" aria-modal="true"><div class="modal-b">${err()}<p>${h(m.msg)}</p></div><div class="modal-f"><span class="grow"></span><button class="btn" data-act="close">キャンセル</button><button class="btn danger solid" data-act="confirm" id="saveBtn">削除する</button></div></div></div>`;
    return '';
  };

  /* 浮かせて出すもの（予定詳細の吹き出し・すばやい追加）。スマホでは下から出る板 */
  V.floats = function () {
    let out = '';
    if (S.float) out += `<div class="pop float" id="float">${V.detail(S.float.id, S.float.d, true)}</div>`;
    if (S.quick) {
      const q = S.quick;
      out += `<div class="pop float quick" id="float"><div class="q-h"><b>予定をすばやく追加</b><button class="icon-btn" data-act="closefloat" aria-label="閉じる">${I('x')}</button></div>
        <input id="q_title" placeholder="予定名を入力して Enter" autocomplete="off" maxlength="200"><p>${SS.md(q.d)}　${q.allDay ? '終日' : q.st + ' – ' + q.en}・${h((SS.cal(q.cal) || {}).name || '')}</p>
        <div class="q-f"><button class="btn" data-act="quickmore">詳細を設定</button><button class="btn primary" data-act="quicksave" id="quickBtn">保存</button></div></div>`;
    }
    return out;
  };
  V.fab = () => `<button class="fab" data-act="add" aria-label="予定を追加">${I('plus', 22)}</button>`;

  /* ---------- 管理画面 ---------- */
  const page = (title, sub, actions, body) => `<div class="page"><div class="page-h"><div><h1>${title}</h1><p>${sub}</p></div><div class="page-a">${actions || ''}</div></div>${body}</div>`;
  const sw = (on, act, arg, label) => `<button class="sw ${on ? 'on' : ''}" data-act="${act}" data-arg="${arg}" role="switch" aria-checked="${!!on}" aria-label="${h(label)}"><i></i></button>`;

  /* カレンダー管理（企業管理者） */
  V.calmanage = function () {
    const rows = SS.D.calendars.map(c => {
      const fixed = c.type !== 'custom';
      return `<tr><td><span class="lg strong" ${sty(PAL[c.color] || PAL.gray)}><i class="dot"></i>${h(c.name)}</span>${fixed ? '<span class="tag">標準</span>' : ''}<small>${h(c.desc || '')}</small></td>
        <td>${fixed ? (c.type === 'personal' ? '本人のみ' : '全社員') : SS.PERM[c.view]}</td>
        <td>${fixed ? (c.type === 'personal' ? '本人' : '登録者・部署管理者') : SS.PERM[c.edit]}</td>
        <td>${fixed ? '全社員' : h(c.users || '—')}</td>
        <td>${fixed ? '—' : c.notify ? '通知する' : '通知しない'}</td>
        <td>${fixed ? '<span class="mute">常に表示</span>' : sw(c.visible, 'calvis', c.id, c.name + 'をメニューに表示')}</td>
        <td class="r">${fixed ? '' : `<button class="btn sm" data-act="caledit" data-arg="${c.id}">設定</button>`}</td></tr>`;
    }).join('');
    return page('カレンダー管理', '業務に合わせてカレンダーを追加し、見られる人・予定を入れられる人を決めます。', `<button class="btn primary" data-act="calnew">${I('plus')}新しいカレンダー</button>`,
      `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>カレンダー</th><th>閲覧できる人</th><th>予定を入れられる人</th><th>利用者</th><th>通知</th><th>メニューに表示</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="hint">「メニューに表示」をオフにすると、管理者以外のメニューから消え、その予定も見えなくなります。通知はまだ送られません（設定だけ保存されます）。</p>`);
  };

  /* 部署・拠点（企業管理者は編集、部署管理者は閲覧のみ） */
  V.departments = function () {
    const D = SS.D, admin = SS.isAdmin(), mine = D.me.department_id;
    const siteRows = D.sites.map(s => `<div class="org-row"><span>${I('pin', 14)}${h(s.name)}</span><small>${D.departments.filter(d => d.site_id === s.id).length} 部署・${D.members.filter(m => m.site_id === s.id).length} 名</small>
      ${admin ? `<span class="org-a"><button class="btn sm" data-act="siteedit" data-arg="${s.id}">名前を変更</button><button class="btn sm danger" data-act="askdelsite" data-arg="${s.id}" aria-label="${h(s.name)}を削除">${I('trash', 13)}</button></span>` : ''}</div>`).join('');
    const cards = D.departments.map(d => {
      const mem = D.members.filter(m => m.department_id === d.id), mgrs = mem.filter(m => m.is_dept_manager), isMine = d.id === mine;
      return `<div class="card dept ${isMine ? 'mine' : ''}"><div class="card-h"><b>${h(d.name)}</b>${isMine ? '<span class="tag on">あなたの部署</span>' : ''}</div>
        <dl><dt>工場・拠点</dt><dd>${h(SS.siteName(d.site_id)) || '—'}</dd><dt>部署管理者</dt><dd>${mgrs.map(m => h(m.name)).join('、') || '—'}</dd><dt>所属</dt><dd>${mem.length} 名</dd></dl>
        <div class="avs">${mem.map(m => V.avatar(m.name)).join('')}</div>
        <div class="card-f"><button class="btn sm" data-act="deptcal" data-arg="${d.id}">共有予定を見る</button>${admin ? `<button class="btn sm" data-act="deptedit" data-arg="${d.id}">編集</button><button class="btn sm danger" data-act="askdeldept" data-arg="${d.id}" aria-label="${h(d.name)}を削除">${I('trash', 13)}</button>` : ''}</div></div>`;
    }).join('');
    const none = D.members.filter(m => !m.department_id).length;
    return page('部署・拠点', admin ? '部署と工場・拠点を登録します。社員の所属と部署管理者は「社員の所属」で決めます。' : '部署と工場・拠点の一覧です（変更は企業管理者が行います）。', '',
      `<section class="org-sec"><div class="sec-t">工場・拠点${admin ? `<button class="btn sm" data-act="sitenew">${I('plus', 13)}拠点を追加</button>` : ''}</div>
        <div class="org-list">${siteRows || '<p class="empty small">まだ登録されていません</p>'}</div></section>
      <section class="org-sec"><div class="sec-t">部署${admin ? `<button class="btn sm" data-act="deptnew">${I('plus', 13)}部署を追加</button>` : ''}</div>
        ${cards ? `<div class="cards">${cards}</div>` : '<p class="empty small">まだ登録されていません</p>'}
        ${none ? `<p class="hint">部署が決まっていない社員が ${none} 名います。${admin ? '「社員の所属」で設定できます。' : ''}</p>` : ''}</section>`);
  };

  /* 社員の所属（企業管理者）。変えるとすぐ保存する */
  V.members = function () {
    const D = SS.D;
    const list = D.members.slice().sort((a, b) => (SS.deptName(a.department_id) || '￿').localeCompare(SS.deptName(b.department_id) || '￿', 'ja') || a.id - b.id);
    const rows = list.map(m => `<tr data-member="${m.id}"><td><span class="who">${V.avatar(m.name)}<span><b>${h(m.name)}</b><small>${h(m.email || '')}</small></span></span></td>
      <td><select data-mem="department_id" aria-label="${h(m.name)}の部署">${opt('', '（なし）', m.department_id)}${D.departments.map(d => opt(d.id, d.name, m.department_id)).join('')}</select></td>
      <td><select data-mem="site_id" aria-label="${h(m.name)}の工場・拠点">${opt('', '（なし）', m.site_id)}${D.sites.map(s => opt(s.id, s.name, m.site_id)).join('')}</select></td>
      <td><label class="ckl"><input type="checkbox" data-mem="is_dept_manager" ${m.is_dept_manager ? 'checked' : ''} ${m.department_id ? '' : 'disabled'}>部署管理者</label></td></tr>`).join('');
    return page('社員の所属', 'Schedule Studio を使える社員の部署・工場・部署管理者を決めます。変えるとすぐ保存されます。', `<a class="btn" href="../../space/admin.html">${I('users')}社員の追加・権限は Space.app 管理画面へ</a>`,
      `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>氏名</th><th>部署</th><th>工場・拠点</th><th>部署管理者</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="hint">部署管理者は、同じ部署の人が共有ONにした予定を変更できます。部署が「（なし）」の人は部署管理者にできません。</p>`);
  };
  V.screen = () => (V[S.screen] || (() => ''))();

  /* 拠点・部署の入力画面 */
  V.orgModal = function (m) {
    const isSite = m.type === 'site', o = m.item;
    return `<div class="modal-bg" data-act="close-bg"><div class="modal narrow" role="dialog" aria-modal="true" aria-label="${isSite ? '拠点' : '部署'}">
      <div class="modal-h"><h2>${m.isNew ? (isSite ? '拠点を追加' : '部署を追加') : (isSite ? '拠点の名前を変更' : '部署を編集')}</h2><button class="icon-btn" data-act="close" aria-label="閉じる">${I('x')}</button></div>
      <div class="modal-b">${err()}
        <label class="fld full"><span>${isSite ? '拠点名' : '部署名'}</span><input id="o_name" value="${h(o.name)}" placeholder="${isSite ? '例）本社工場' : '例）製造部'}" maxlength="100"></label>
        ${isSite ? '' : `<label class="fld full"><span>主な工場・拠点</span><select id="o_site">${opt('', '（なし）', o.site_id)}${SS.D.sites.map(s => opt(s.id, s.name, o.site_id)).join('')}</select></label>`}
      </div>
      <div class="modal-f"><span class="grow"></span><button class="btn" data-act="close">キャンセル</button><button class="btn primary" data-act="orgsave" id="saveBtn">保存</button></div></div></div>`;
  };
})(window.SS);
