/* Schedule Studio — 画面の配置（B案: 操作性重視）。
   左＝細いメニュー列＋小さな月カレンダーとチェック式のカレンダー一覧、中央＝時間軸。
   チェック＝重ねて表示、名前＝そのカレンダーだけ表示。 */
(function (SS) {
  const { h, S } = SS, V = SS.V, I = SS.I;
  const RAIL = { calmanage: '管理', departments: '部署', members: '社員' };

  SS.layout = function () {
    const isCal = S.screen === 'calendar', nav = SS.navItems();
    const row = c => {
      const on = S.cal === 'all' ? !S.hidden[c.id] : S.cal === c.id;
      return `<div class="b-cal ${isCal && S.cal === c.id ? 'solo' : ''}"><button class="ck ${on ? 'on' : ''}" data-act="bcheck" data-arg="${c.id}" style="--c:${(SS.PAL[c.color] || SS.PAL.gray)[0]}" aria-pressed="${on}" aria-label="${h(c.name)}を重ねて表示">${I('check', 12)}</button>
        <button class="b-cal-n" data-act="cal" data-arg="${c.id}" title="このカレンダーだけ表示">${h(c.name)}</button></div>`;
    };
    const cals = SS.calList();
    /* 管理メニューがない人（一般社員）には細い列を出さない */
    const rail = nav.length ? `<nav class="b-rail" aria-label="メニュー">
      <button class="${isCal ? 'on' : ''}" data-act="go" data-arg="calendar">${I('cal', 20)}<span>カレンダー</span></button>
      ${nav.map(n => `<button class="${S.screen === n[0] ? 'on' : ''}" data-act="go" data-arg="${n[0]}">${I(n[2], 20)}<span>${RAIL[n[0]] || n[1]}</span></button>`).join('')}</nav>` : '';
    const panel = `<aside class="b-panel ${S.drawer ? 'open' : ''}" aria-label="カレンダーの一覧">
      <div class="b-brand">${V.logo()}</div>
      ${isCal ? `<button class="btn primary b-create" data-act="add">${I('plus')}予定を作成</button>
      ${V.miniMonth()}
      <div class="b-grp"><span>マイカレンダー</span></div>
      ${cals.filter(c => c.type !== 'custom').map(row).join('')}
      <div class="b-grp"><span>業務別カレンダー</span>${SS.isAdmin() ? `<button class="icon-btn sm" data-act="calnew" aria-label="カレンダーを追加">${I('plus', 14)}</button>` : ''}</div>
      ${cals.filter(c => c.type === 'custom').map(row).join('') || '<p class="b-empty">まだありません</p>'}
      <button class="b-all ${S.cal === 'all' ? 'on' : ''}" data-act="cal" data-arg="all">${I('layers', 14)}すべて重ねて表示</button>`
      : nav.map(n => `<button class="b-all ${S.screen === n[0] ? 'on' : ''}" data-act="go" data-arg="${n[0]}">${I(n[2], 14)}${n[1]}</button>`).join('')}
      ${V.sidebarBottom()}
    </aside>${S.drawer ? '<div class="scrim" data-act="drawer"></div>' : ''}`;
    const top = `<header class="b-top ${isCal ? '' : 'manage'}">
      <button class="icon-btn only-m" data-act="drawer" aria-label="メニュー">${I('menu', 20)}</button>
      ${isCal ? `${V.dateNav()}<h1>${V.title()}<small>${h(SS.screenTitle())}</small></h1>${V.loading()}<span class="grow"></span>${V.search()}${V.seg()}`
        : `<h1>${h(SS.screenTitle())}</h1>${V.loading()}<span class="grow"></span>`}</header>`;
    return `<div class="b-shell ${nav.length ? 'has-rail' : ''}">${rail}${panel}<div class="b-main">${top}
      ${isCal ? `<div class="b-cal-wrap">${V.calendar()}</div><div class="b-tip">空いている時間をクリックで追加・予定はドラッグで移動できます</div>${V.fab()}` : `<div class="b-page">${V.screen()}</div>`}</div></div>`;
  };
})(window.SS);
