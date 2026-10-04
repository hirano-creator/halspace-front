'use strict';

/* ============================================================
   パーツ集計タブ（管理者画面）
   SolidWorksの .SLDPRT / .SLDASM を発注者の会社ごと・月ごとに数え、
   月間パーツ上限と比べて見せる。社内管理者のみ（API側も isInternalAdmin で弾く）。
   数え方（上げ直しの重複除外・削除の扱い・計上日）はAPI側
   SolidPartUsageController のコメントが正。
   admin.js の後に読み込む（user / esc / showToast を使う）。
   ============================================================ */
(function () {
  const tabBtn = document.getElementById('tabBtnParts');
  const pane = document.getElementById('tab-parts');
  if (!tabBtn || !pane) return;
  /* 他社の発注量が見えるので、発注者会社のadminには出さない */
  if (!isInternalAdmin(user)) {
    tabBtn.remove();
    pane.remove();
    return;
  }

  /* 会社の識別色。固定順で割り当て、順位で塗り替えない。9社目以降は「その他」にまとめる */
  const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#e87ba4', '#eda100', '#008300', '#4a3aa7', '#e34948'];
  const OTHER_COLOR = '#9aa1aa';
  const ASM_ALPHA = 0.42; // アセンブリは会社色を薄くして部品と分ける
  const WARN_RATIO = 0.8;

  const nowYm = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const state = {
    month: nowYm(),
    sel: 'all',        // 'all' か company id
    monIdx: 11,        // 選択中の月（months配列の添字）
    data: null,
    projects: null,    // 会社ビューの物件別内訳
    loaded: false,
  };
  let reqSeq = 0, projSeq = 0; // 古い応答で新しい表示を上書きしないため

  /* ── 書式 ── */
  const ymLabel = ym => `${ym.slice(0, 4)}年${+ym.slice(5)}月`;
  const mLabel = ym => `${+ym.slice(5)}月`;
  const shortName = n => String(n).replace(/株式会社|有限会社|\(株\)|（株）/g, '').trim() || n;
  const addMonths = (ym, n) => {
    const d = new Date(+ym.slice(0, 4), +ym.slice(5) - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const tot = m => m.prt + m.asm;

  function statusOf(total, limit) {
    if (total > limit) return 'over';
    if (total >= limit * WARN_RATIO) return 'warn';
    return 'ok';
  }
  const STATUS_CHIP = {
    ok:   '<span class="pu-chip ok"><i class="fa-solid fa-circle-check"></i>余裕あり</span>',
    warn: '<span class="pu-chip warn"><i class="fa-solid fa-triangle-exclamation"></i>注意</span>',
    over: '<span class="pu-chip over"><i class="fa-solid fa-circle-xmark"></i>上限超過</span>',
  };

  /* ── 取得 ── */
  async function load() {
    const seq = ++reqSeq;
    pane.classList.add('pu-loading');
    try {
      const q = new URLSearchParams({ month: state.month });
      const data = await api.get('/admin/solid/part-usage?' + q);
      if (seq !== reqSeq) return;
      data.companies.forEach((c, i) => {
        c.color = data.companies.length <= PALETTE.length || i < PALETTE.length - 1 ? PALETTE[i] : OTHER_COLOR;
        c.isOther = c.color === OTHER_COLOR;
      });
      state.data = data;
      if (state.sel !== 'all' && !data.companies.some(c => c.id === state.sel)) state.sel = 'all';
      state.monIdx = Math.min(state.monIdx, data.months.length - 1);
      state.loaded = true;
      render();
      if (state.sel !== 'all') loadProjects();
    } catch (err) {
      /* 通信失敗時は前回の表示を残す（空にすると「数が消えた」と誤解される） */
      showToast('パーツ集計の取得に失敗しました: ' + err.message, 'danger');
      if (!state.data) pane.querySelector('#puMain').innerHTML =
        `<div class="pu-empty">取得できませんでした。<button class="btn btn-outline btn-sm" id="puRetry">再読み込み</button></div>`;
      pane.querySelector('#puRetry')?.addEventListener('click', load);
    } finally {
      if (seq === reqSeq) pane.classList.remove('pu-loading');
    }
  }

  async function loadProjects() {
    const seq = ++projSeq;
    state.projects = null;
    renderProjects();
    try {
      const q = new URLSearchParams({
        company_id: state.sel, month: state.data.months[state.monIdx],
      });
      const data = await api.get('/admin/solid/part-usage/projects?' + q);
      if (seq !== projSeq) return;
      state.projects = data.projects;
    } catch (err) {
      if (seq !== projSeq) return;
      state.projects = 'error';
      showToast('物件別の内訳を取得できませんでした: ' + err.message, 'danger');
    }
    renderProjects();
  }

  /* ── 描画: 全体 ── */
  function render() {
    const d = state.data;
    pane.querySelector('#puMonthLabel').textContent = ymLabel(state.month);
    pane.querySelector('#puNext').disabled = state.month >= nowYm();
    pane.querySelector('#puAsOf').textContent = `${d.as_of} 時点`;
    renderList();
    pane.querySelector('#puMain').innerHTML = state.sel === 'all' ? overallHtml() : companyHtml();
    bindMain();
  }

  const isPartial = i => state.data.months[i] === state.data.current_month;

  function renderList() {
    const d = state.data, last = d.months.length - 1;
    const cur = d.companies.map(c => ({ c, t: tot(c.months[last]), s: statusOf(tot(c.months[last]), c.limit) }));
    const overN = cur.filter(x => x.s === 'over').length, warnN = cur.filter(x => x.s === 'warn').length;
    const allTot = cur.reduce((a, x) => a + x.t, 0);
    pane.querySelector('#puList').innerHTML = `
      <button type="button" class="pu-co ${state.sel === 'all' ? 'on' : ''}" data-id="all">
        <span class="pu-dot" style="background:var(--dark)"></span>
        <span class="pu-co-b"><b>全社</b><small>${mLabel(d.months[last])} ${allTot}・${d.companies.length}社</small>
          <span class="pu-co-tags">${overN ? `<span class="pu-chip over sm">超過 ${overN}社</span>` : ''}${warnN ? `<span class="pu-chip warn sm">注意 ${warnN}社</span>` : ''}</span></span>
      </button>
      <div class="pu-sep"></div>
      ${cur.map(({ c, t, s }) => {
        const pct = Math.round(t / c.limit * 100);
        return `<button type="button" class="pu-co ${state.sel === c.id ? 'on' : ''}" data-id="${c.id}">
          <span class="pu-dot" style="background:${c.color}"></span>
          <span class="pu-co-b"><b>${esc(c.name)}</b><small>${mLabel(d.months[last])} ${t} / ${c.limit}（${pct}%）</small>
            <span class="pu-mini"><i class="${s}" style="width:${Math.min(100, pct)}%"></i></span></span>
        </button>`;
      }).join('') || '<div class="pu-empty sm">対象の会社がありません</div>'}`;
    pane.querySelectorAll('.pu-co').forEach(el => el.addEventListener('click', () => {
      state.sel = el.dataset.id === 'all' ? 'all' : +el.dataset.id;
      state.monIdx = state.data.months.length - 1;
      renderList();
      pane.querySelector('#puMain').innerHTML = state.sel === 'all' ? overallHtml() : companyHtml();
      bindMain();
      if (state.sel !== 'all') loadProjects();
    }));
  }

  /* 集計途中の月は前月（確定）と比べても意味がないので、前月の実績だけ出す */
  function diffKpi(diff, prevText, i) {
    if (isPartial(i) && i > 0) {
      return `<div class="pu-kpi"><small>前月の実績</small><b>${prevText.split(' ').pop()}</b><span>${prevText.split(' ')[0]}・今月は集計途中のため比較しません</span></div>`;
    }
    return `<div class="pu-kpi"><small>前月比</small><b>${diff === null ? '—' : (diff >= 0 ? '+' : '−') + Math.abs(diff)}</b><span>${prevText}</span></div>`;
  }

  /* ── 全社ビュー ── */
  function overallHtml() {
    const d = state.data, i = state.monIdx, last = d.months.length - 1;
    const monthTot = k => d.companies.reduce((a, c) => a + tot(c.months[k]), 0);
    const now = d.companies.map(c => statusOf(tot(c.months[last]), c.limit));
    const names = s => d.companies.filter((c, k) => now[k] === s).map(c => esc(shortName(c.name))).join('・') || '—';
    const diff = i > 0 ? monthTot(i) - monthTot(i - 1) : null;
    return `
      <div class="pu-kpis">
        <div class="pu-kpi"><small>${mLabel(d.months[i])}の全社計</small><b>${monthTot(i)}</b><span>${d.companies.length}社の合計${isPartial(i) ? '（集計途中）' : ''}</span></div>
        ${diffKpi(diff, i > 0 ? `${mLabel(d.months[i - 1])} ${monthTot(i - 1)}` : '', i)}
        <div class="pu-kpi"><small>${mLabel(d.months[last])} 上限超過</small><b class="${now.includes('over') ? 'c-over' : ''}">${now.filter(s => s === 'over').length}<em> 社</em></b><span>${names('over')}</span></div>
        <div class="pu-kpi"><small>${mLabel(d.months[last])} 注意</small><b class="${now.includes('warn') ? 'c-warn' : ''}">${now.filter(s => s === 'warn').length}<em> 社</em></b><span>${names('warn')}</span></div>
      </div>
      <div class="card pu-card">
        <div class="pu-card-h">
          <h3>全社の月別パーツ数</h3>
          <span class="pu-sub">会社ごとに積み上げ・▲は上限超過の会社数${d.months.includes(d.current_month) ? '・* は集計途中' : ''}</span>
        </div>
        ${legendHtml()}
        ${d.companies.length ? stackSvg() : '<div class="pu-empty">対象の会社がありません</div>'}
        <div class="pu-hint"><i class="fa-solid fa-hand-pointer"></i>月を押すと下の表がその月の会社別内訳に切り替わります</div>
      </div>
      ${companyTableHtml(i)}`;
  }

  function legendHtml() {
    const shown = seriesList();
    return `<div class="pu-legend">${shown.map(s => `<span><span class="pu-dot" style="background:${s.color}"></span>${esc(s.name)}</span>`).join('')}</div>`;
  }

  /* 9社目以降は1系列「その他」にまとめる（色を回して使い回さない） */
  function seriesList() {
    const d = state.data, main = d.companies.filter(c => !c.isOther), rest = d.companies.filter(c => c.isOther);
    const list = main.map(c => ({ name: c.name, color: c.color, months: c.months, limit: c.limit, id: c.id }));
    if (rest.length) list.push({
      name: `その他 ${rest.length}社`, color: OTHER_COLOR, limit: null, id: null,
      months: d.months.map((_, k) => ({ prt: rest.reduce((a, c) => a + c.months[k].prt, 0), asm: rest.reduce((a, c) => a + c.months[k].asm, 0) })),
    });
    return list;
  }

  function stackSvg() {
    const d = state.data, n = d.months.length, series = seriesList();
    const totals = d.months.map((_, k) => series.reduce((a, s) => a + tot(s.months[k]), 0));
    const W = 1000, H = 290, L = 46, R = 16, T = 34, B = 34, pw = W - L - R, ph = H - T - B;
    const step = niceStep(Math.max(1, ...totals) * 1.08), ymax = Math.max(step, Math.ceil(Math.max(1, ...totals) * 1.08 / step) * step);
    const bw = pw / n, y = v => v / ymax * ph;
    let s = gridY(L, pw, T, ph, ymax, step);
    d.months.forEach((ym, k) => {
      const cx = L + k * bw, bx = cx + bw * .18, w = bw * .64, op = isPartial(k) ? .6 : 1;
      if (k === state.monIdx) s += `<rect x="${cx + 2}" y="${T - 30}" width="${bw - 4}" height="${ph + 30}" rx="6" fill="rgba(9,132,227,.07)"/>`;
      const segs = series.map(sr => ({ sr, v: tot(sr.months[k]) })).filter(o => o.v > 0);
      let acc = 0;
      segs.forEach((o, j) => {
        const h = y(o.v), lastSeg = j === segs.length - 1, hh = Math.max(.5, h - (lastSeg ? 0 : 2)), top = T + ph - y(acc) - h + (h - hh);
        acc += o.v;
        s += lastSeg ? roundTop(bx, top, w, hh, o.sr.color, op) : `<rect x="${bx}" y="${top}" width="${w}" height="${hh}" fill="${o.sr.color}" opacity="${op}"/>`;
      });
      const over = d.companies.filter(c => tot(c.months[k]) > c.limit).length, top = T + ph - y(totals[k]);
      s += `<text x="${cx + bw / 2}" y="${top - 6}" text-anchor="middle" class="pu-val">${totals[k]}</text>`;
      if (over) s += `<text x="${cx + bw / 2}" y="${top - 20}" text-anchor="middle" class="pu-over-t">▲${over}社</text>`;
      s += xLabel(ym, k, cx + bw / 2, H - 18);
      s += `<rect class="pu-hitm" data-i="${k}" x="${cx}" y="${T - 30}" width="${bw}" height="${ph + 30}" fill="transparent"/>`;
    });
    s += `<line class="pu-base" x1="${L}" x2="${L + pw}" y1="${T + ph}" y2="${T + ph}"/>`;
    return `<div class="pu-chart"><svg class="pu-svg" viewBox="0 0 ${W} ${H}">${s}</svg></div>`;
  }

  function companyTableHtml(i) {
    const d = state.data, ym = d.months[i];
    const sum = k => d.companies.reduce((a, c) => a + c.months[i][k], 0);
    return `<div class="card pu-card">
      <div class="pu-card-h"><h3>会社別の内訳 — ${ymLabel(ym)}${isPartial(i) ? '（集計途中）' : ''}</h3><span class="pu-sub">行を押すとその会社の画面へ</span></div>
      <div class="pu-scroll"><table class="pu-tbl">
        <thead><tr><th>会社</th><th class="n">SLDPRT</th><th class="n">SLDASM</th><th class="n">計</th><th class="n">上限</th><th class="n">上限比</th><th>状態</th></tr></thead>
        <tbody>${d.companies.map(c => {
          const m = c.months[i], t = tot(m);
          return `<tr class="pu-go" data-id="${c.id}" data-i="${i}"><td><span class="pu-dot" style="background:${c.color}"></span><b>${esc(c.name)}</b></td>
            <td class="n">${m.prt}</td><td class="n">${m.asm}</td><td class="n"><b>${t}</b></td><td class="n">${c.limit}</td>
            <td class="n">${Math.round(t / c.limit * 100)}%</td><td>${STATUS_CHIP[statusOf(t, c.limit)]}</td></tr>`;
        }).join('')}</tbody>
        <tfoot><tr><td>全社計</td><td class="n">${sum('prt')}</td><td class="n">${sum('asm')}</td><td class="n">${sum('prt') + sum('asm')}</td><td></td><td></td><td></td></tr></tfoot>
      </table></div>
    </div>`;
  }

  /* ── 会社ビュー ── */
  function companyHtml() {
    const d = state.data, c = d.companies.find(x => x.id === state.sel), i = state.monIdx;
    const m = c.months[i], t = tot(m), prev = i > 0 ? c.months[i - 1] : null, diff = prev ? t - tot(prev) : null;
    const W = 1000, H = 270, L = 46, R = 76, T = 24, B = 34, pw = W - L - R, ph = H - T - B, n = d.months.length;
    const peak = Math.max(c.limit * 1.2, ...c.months.map(tot)) + 10, step = niceStep(peak), ymax = Math.ceil(peak / step) * step;
    const bw = pw / n, y = v => v / ymax * ph;
    let s = gridY(L, pw, T, ph, ymax, step);
    c.months.forEach((mm, k) => {
      const cx = L + k * bw, bx = cx + bw * .2, w = bw * .6, op = isPartial(k) ? .6 : 1, tt = tot(mm);
      if (k === i) s += `<rect x="${cx + 2}" y="${T}" width="${bw - 4}" height="${ph}" rx="6" fill="rgba(9,132,227,.07)"/>`;
      const hp = y(mm.prt), ha = mm.asm ? Math.max(.5, y(mm.asm) - (mm.prt ? 2 : 0)) : 0;
      if (mm.prt) s += mm.asm ? `<rect x="${bx}" y="${T + ph - hp}" width="${w}" height="${hp}" fill="${c.color}" opacity="${op}"/>` : roundTop(bx, T + ph - hp, w, hp, c.color, op);
      if (mm.asm) s += roundTop(bx, T + ph - y(tt), w, ha, c.color, op * ASM_ALPHA);
      const top = T + ph - y(tt) - 6;
      s += tt > c.limit ? `<text x="${cx + bw / 2}" y="${top}" text-anchor="middle" class="pu-over-t">▲${tt}</text>`
                        : `<text x="${cx + bw / 2}" y="${top}" text-anchor="middle" class="pu-val">${tt}</text>`;
      s += xLabel(d.months[k], k, cx + bw / 2, H - 18);
      s += `<rect class="pu-hit3" data-i="${k}" x="${cx}" y="${T}" width="${bw}" height="${ph}" fill="transparent"/>`;
    });
    s += `<line class="pu-base" x1="${L}" x2="${L + pw}" y1="${T + ph}" y2="${T + ph}"/>`;
    s += `<line x1="${L}" x2="${L + pw}" y1="${T + ph - y(c.limit)}" y2="${T + ph - y(c.limit)}" class="pu-limit"/><text x="${L + pw + 6}" y="${T + ph - y(c.limit) + 4}" class="pu-limit-t">上限 ${c.limit}</text>`;
    const st = statusOf(t, c.limit);
    return `
      <div class="pu-kpis">
        <div class="pu-kpi"><small>${mLabel(d.months[i])}のパーツ数${isPartial(i) ? '（集計途中）' : ''}</small><b>${t}</b><span>${STATUS_CHIP[st]}</span></div>
        <div class="pu-kpi"><small>上限まで</small><b class="${t > c.limit ? 'c-over' : ''}">${t > c.limit ? '−' + (t - c.limit) : c.limit - t}</b>
          <span id="puLimitBox">上限 ${c.limit} / 月${c.limit_is_default ? '（既定）' : ''}${d.can_edit_limit ? ' <button type="button" class="pu-link" id="puLimitEdit"><i class="fa-solid fa-pen"></i> 変更</button>' : ''}</span></div>
        <div class="pu-kpi"><small>内訳</small><b class="pu-kpi-split"><span class="pu-dot" style="background:${c.color}"></span>${m.prt}<em>部品</em><span class="pu-dot" style="background:${c.color};opacity:${ASM_ALPHA}"></span>${m.asm}<em>ASSY</em></b></div>
        ${diffKpi(diff, prev ? `${mLabel(d.months[i - 1])} ${tot(prev)}` : '', i)}
      </div>
      <div class="card pu-card">
        <div class="pu-card-h"><h3>月ごとの推移 — ${esc(c.name)}</h3>${d.months.includes(d.current_month) ? '<span class="pu-sub">* は集計途中の月</span>' : ''}<span class="pu-sp"></span>
          <div class="pu-legend in"><span><span class="pu-dot" style="background:${c.color}"></span>.SLDPRT（部品）</span><span><span class="pu-dot" style="background:${c.color};opacity:${ASM_ALPHA}"></span>.SLDASM（アセンブリ）</span><span><span class="pu-ln"></span>上限</span></div></div>
        <div class="pu-chart"><svg class="pu-svg" viewBox="0 0 ${W} ${H}">${s}</svg></div>
        <div class="pu-hint"><i class="fa-solid fa-hand-pointer"></i>棒を押すとその月の物件別内訳に切り替わります</div>
      </div>
      <div class="card pu-card" id="puProjects"></div>`;
  }

  function renderProjects() {
    const box = pane.querySelector('#puProjects');
    if (!box || state.sel === 'all') return;
    const d = state.data, ym = d.months[state.monIdx], p = state.projects;
    const head = `<div class="pu-card-h"><h3>物件別の内訳 — ${ymLabel(ym)}</h3>${Array.isArray(p) ? `<span class="pu-sub">${p.length}物件</span>` : ''}</div>`;
    if (p === null) { box.innerHTML = head + '<div class="pu-empty sm"><i class="fa-solid fa-spinner fa-spin"></i> 読み込み中…</div>'; return; }
    if (p === 'error') { box.innerHTML = head + '<div class="pu-empty sm">取得できませんでした。<button type="button" class="btn btn-outline btn-sm" id="puProjRetry">再読み込み</button></div>';
      box.querySelector('#puProjRetry').addEventListener('click', loadProjects); return; }
    if (!p.length) { box.innerHTML = head + '<div class="pu-empty sm">この月に数えたパーツはありません</div>'; return; }
    const sp = p.reduce((a, r) => a + r.prt, 0), sa = p.reduce((a, r) => a + r.asm, 0);
    box.innerHTML = head + `<div class="pu-scroll"><table class="pu-tbl">
      <thead><tr><th>物件コード</th><th>件名</th><th class="n">SLDPRT</th><th class="n">SLDASM</th><th class="n">計</th><th class="n">最終納品</th></tr></thead>
      <tbody>${p.map(r => `<tr><td>${r.deleted
          ? `<span class="pu-code del">${esc(r.project_code || '#' + r.project_id)}</span> <span class="pu-chip del sm" title="物件は削除済み。納品した数は残しています">削除済み</span>`
          : `<a class="pu-code" href="project-detail.html?id=${encodeURIComponent(r.project_id)}">${esc(r.project_code || '#' + r.project_id)}</a>`}</td><td>${esc(r.title || '')}</td>
        <td class="n">${r.prt}</td><td class="n">${r.asm}</td><td class="n"><b>${r.prt + r.asm}</b></td><td class="n pu-muted">${esc(r.last_at.slice(5, 10).replace('-', '/'))}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="2">合計</td><td class="n">${sp}</td><td class="n">${sa}</td><td class="n">${sp + sa}</td><td></td></tr></tfoot>
    </table></div>`;
  }

  /* ── 操作の結び付け ── */
  function bindMain() {
    const main = pane.querySelector('#puMain');
    main.querySelectorAll('.pu-hitm').forEach(el => {
      el.addEventListener('mousemove', ev => showTip(monthTip(+el.dataset.i), ev));
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('click', () => { hideTip(); state.monIdx = +el.dataset.i; rerenderMain(); });
    });
    main.querySelectorAll('.pu-go').forEach(el => {
      el.addEventListener('click', () => {
        hideTip();
        state.sel = +el.dataset.id; state.monIdx = +el.dataset.i;
        renderList(); rerenderMain(); loadProjects();
      });
    });
    main.querySelectorAll('.pu-hit3').forEach(el => {
      el.addEventListener('mousemove', ev => showTip(cellTip(state.sel, +el.dataset.i), ev));
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('click', () => { hideTip(); state.monIdx = +el.dataset.i; rerenderMain(); loadProjects(); });
    });
    main.querySelector('#puLimitEdit')?.addEventListener('click', openLimitEditor);
    /* スマホでグラフが横スクロールになるときは、最新の月が見える位置から始める */
    main.querySelectorAll('.pu-chart').forEach(el => { el.scrollLeft = el.scrollWidth; });
    if (state.sel !== 'all') renderProjects();
  }
  function rerenderMain() {
    pane.querySelector('#puMain').innerHTML = state.sel === 'all' ? overallHtml() : companyHtml();
    bindMain();
  }

  function openLimitEditor() {
    const c = state.data.companies.find(x => x.id === state.sel), box = pane.querySelector('#puLimitBox');
    box.innerHTML = `<span class="pu-limit-edit">
      <input type="number" min="1" max="100000" step="1" value="${c.limit_is_default ? '' : c.limit}" placeholder="${state.data.default_limit}" id="puLimitInput" class="form-input">
      <button type="button" class="btn btn-primary btn-sm" id="puLimitSave">保存</button>
      <button type="button" class="btn btn-ghost btn-sm" id="puLimitCancel">取消</button></span>
      <small class="pu-muted">空欄で既定（${state.data.default_limit}）</small>`;
    const input = box.querySelector('#puLimitInput');
    input.focus();
    box.querySelector('#puLimitCancel').addEventListener('click', rerenderMain);
    const save = async () => {
      const raw = input.value.trim();
      const limit = raw === '' ? null : Number(raw);
      if (limit !== null && (!Number.isInteger(limit) || limit < 1)) { showToast('上限は1以上の整数で入力してください', 'danger'); return; }
      const btn = box.querySelector('#puLimitSave'); btn.disabled = true;
      try {
        const res = await api.patch(`/admin/solid/part-usage/limit/${c.id}`, { limit });
        c.limit = res.limit; c.limit_is_default = res.limit_is_default;
        showToast(`${c.name} の上限を ${res.limit} にしました`, 'success');
        renderList(); rerenderMain();
      } catch (err) {
        btn.disabled = false;
        showToast('上限を保存できませんでした: ' + err.message, 'danger');
      }
    };
    box.querySelector('#puLimitSave').addEventListener('click', save);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') rerenderMain(); });
  }

  /* ── ツールチップ ── */
  const tip = document.createElement('div');
  tip.className = 'pu-tip';
  document.body.appendChild(tip);
  function showTip(html, ev) {
    tip.innerHTML = html; tip.classList.add('show');
    const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    let x = ev.clientX + pad, yy = ev.clientY + pad;
    if (x + w > innerWidth - 8) x = ev.clientX - w - pad;
    if (yy + h > innerHeight - 8) yy = ev.clientY - h - pad;
    tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, yy) + 'px';
  }
  function hideTip() { tip.classList.remove('show'); }
  const tipRow = (color, label, v) => `<div class="r"><span class="pu-dot" style="background:${color}"></span>${label}<span class="v">${v}</span></div>`;
  function monthTip(k) {
    const d = state.data, sum = d.companies.reduce((a, c) => a + tot(c.months[k]), 0);
    return `<b>${ymLabel(d.months[k])}</b>${isPartial(k) ? ' <span class="dim">集計途中</span>' : ''}<div class="hr"></div>` +
      d.companies.map(c => tipRow(c.color, esc(shortName(c.name)), `${tot(c.months[k])}${tot(c.months[k]) > c.limit ? ' <span class="ov">▲超過</span>' : ''}`)).join('') +
      `<div class="hr"></div>${tipRow('transparent', '全社計', sum)}`;
  }
  function cellTip(id, k) {
    const d = state.data, c = d.companies.find(x => x.id === id), m = c.months[k];
    return `<b>${esc(c.name)}</b><br>${ymLabel(d.months[k])}${isPartial(k) ? ' <span class="dim">集計途中</span>' : ''}<div class="hr"></div>` +
      tipRow(c.color, '部品 .SLDPRT', m.prt) + tipRow(c.color + '6b', 'ASSY .SLDASM', m.asm) +
      `<div class="hr"></div>${tipRow('transparent', '計', tot(m))}${tipRow('transparent', '上限比', Math.round(tot(m) / c.limit * 100) + '%')}`;
  }

  /* ── SVG部品 ── */
  function niceStep(max) {
    const raw = max / 5, p = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
    return [1, 2, 5, 10].map(m => m * p).find(v => v >= raw) || p * 10;
  }
  function gridY(L, pw, T, ph, ymax, step) {
    let s = '';
    for (let v = 0; v <= ymax + 1e-9; v += step) {
      const yy = T + ph - v / ymax * ph;
      s += `<line class="pu-grid" x1="${L}" x2="${L + pw}" y1="${yy}" y2="${yy}"/><text class="pu-ax" x="${L - 8}" y="${yy + 4}" text-anchor="end">${v}</text>`;
    }
    return s;
  }
  function xLabel(ym, k, x, yy) {
    const on = k === state.monIdx, yr = k === 0 || +ym.slice(5) === 1;
    return `<text class="pu-ax ${on ? 'on' : ''}" x="${x}" y="${yy}" text-anchor="middle">${mLabel(ym)}${isPartial(k) ? '*' : ''}</text>` +
      (yr ? `<text class="pu-ax yr" x="${x}" y="${yy + 13}" text-anchor="middle">${ym.slice(0, 4)}</text>` : '');
  }
  /* 上端だけ角丸の棒（低すぎる棒はただの矩形） */
  function roundTop(x, y, w, h, fill, op) {
    if (h <= 5) return `<rect x="${x}" y="${y}" width="${w}" height="${Math.max(0, h)}" fill="${fill}" opacity="${op}"/>`;
    return `<path d="M${x},${y + h} v${-(h - 4)} q0,-4 4,-4 h${w - 8} q4,0 4,4 v${h - 4} z" fill="${fill}" opacity="${op}"/>`;
  }

  /* ── CSV（Excelで開けるようBOM付き） ── */
  function downloadCsv() {
    const d = state.data;
    if (!d) return;
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    let rows, name;
    if (state.sel === 'all') {
      rows = [['会社', '上限', ...d.months.flatMap(ym => [`${ym} SLDPRT`, `${ym} SLDASM`, `${ym} 計`])]];
      d.companies.forEach(c => rows.push([c.name, c.limit, ...c.months.flatMap(m => [m.prt, m.asm, tot(m)])]));
      name = `SOLIDパーツ集計_全社_${d.months[0]}_${d.months[d.months.length - 1]}`;
    } else {
      const c = d.companies.find(x => x.id === state.sel), ym = d.months[state.monIdx];
      if (!Array.isArray(state.projects)) { showToast('内訳の読み込みが終わってから出力してください'); return; }
      rows = [['物件コード', '件名', 'SLDPRT', 'SLDASM', '計', '最終納品', '物件削除済み']];
      state.projects.forEach(r => rows.push([r.project_code, r.title, r.prt, r.asm, r.prt + r.asm, r.last_at, r.deleted ? '削除済み' : '']));
      name = `SOLIDパーツ集計_${c.name}_${ym}`;
    }
    const blob = new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name.replace(/[\\/:*?"<>|]/g, '_') + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ── 初期化（タブを開いたときに初めて取得する） ── */
  pane.querySelector('#puPrev').addEventListener('click', () => { state.month = addMonths(state.month, -1); state.monIdx = 11; load(); });
  pane.querySelector('#puNext').addEventListener('click', () => { if (state.month < nowYm()) { state.month = addMonths(state.month, 1); state.monIdx = 11; load(); } });
  pane.querySelector('#puCsv').addEventListener('click', downloadCsv);
  tabBtn.addEventListener('click', () => { if (!state.loaded) load(); });
  if (location.hash === '#parts') tabBtn.click();
})();
