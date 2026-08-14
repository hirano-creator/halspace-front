'use strict';
/* ══════════════════════════════════════════════════════════════════════
   利用状況ダッシュボード（Analytics）
   admin.html の「分析 > 利用状況」セクションの描画。

   admin.html が既に1800行を超えているため、JSだけこのファイルに切り出している。
   HTML と CSS は admin.html のインラインのまま（既存の流儀を尊重）。

   このファイルは admin.html のインライン <script> の直後に読み込むこと。
   apiFetch / h / showToast / currentUser をグローバルとして使うため、順序は絶対。

   グラフは外部ライブラリを使わず素のSVGを組み立てる。文字列テンプレートなので
   既存の innerHTML パターンと書き味が揃い、CSS変数がそのまま効き、
   <title> でネイティブのツールチップが無料で付く。
   ══════════════════════════════════════════════════════════════════════ */

/* ── 状態 ── */
const AN = {
  period:  '30',
  company: '',      // '' = すべての会社
  metric:  'active_users',
  featApp: null,    // null = 最初のアプリ
  meta:    null,
  companies: [],
  /* 描画の世代。期間を素早く切り替えると古いレスポンスが後から届いて
     新しい描画を上書きしうるので、届いた時点で世代が変わっていたら捨てる */
  gen: 0,
};

const AN_SOURCE_BADGE = {
  derived:     '<span class="badge badge-gray" title="業務データの作成日時から逆算した値です">推定</span>',
  event:       '<span class="badge badge-green" title="計測イベントによる実測値です">実測</span>',
  unavailable: '<span class="badge badge-orange">計測なし</span>',
};

const AN_METRIC_LABEL = {
  active_users: 'ログインした人数',
  logins:       'ログイン数',
  events:       '操作数',
};

/* ══════════════ 小物 ══════════════ */

const anCv    = c => `var(--${c || 'gray'})`;
const anNum    = n => (n === null || n === undefined) ? '—' : Number(n).toLocaleString();
const anPct    = r => (r === null || r === undefined) ? '—' : Math.round(r * 100) + '%';
const anDash   = '<span style="color:var(--muted);">—</span>';

/* 定着率の色。0%は赤、低いとオレンジ、高いと緑 */
const anRateColor = r =>
  r === null || r === undefined ? 'gray' : r === 0 ? 'red' : r < 0.4 ? 'orange' : r < 0.7 ? 'blue' : 'green';

/* バケットキー(YYYY-MM-DD)を粒度に応じた軸ラベルにする */
function anBucketLabel(bucket, granularity) {
  const [y, m, d] = bucket.split('-').map(Number);
  if (granularity === 'month') return `${m}月`;
  if (granularity === 'week')  return `${m}/${d}週`;
  return `${m}/${d}`;
}
function anBucketFull(bucket, granularity) {
  const [y, m, d] = bucket.split('-').map(Number);
  if (granularity === 'month') return `${y}年${m}月`;
  if (granularity === 'week')  return `${y}/${m}/${d} の週`;
  return `${y}/${m}/${d}`;
}

/* 前期間比のチップ。delta が null なら「なぜ出せないか」を書く */
function anDelta(delta, unit = '', invert = false) {
  if (!delta) {
    return `<span style="opacity:.75;">前期間比は記録不足のため算出なし</span>`;
  }
  const up   = delta.diff > 0;
  const flat = delta.diff === 0;
  // 「未活用の会社」のように増えたら悪い指標は色を反転させる
  const good = invert ? !up : up;
  const color = flat ? 'muted' : good ? 'green' : 'red';
  const icon  = flat ? 'fa-minus' : up ? 'fa-arrow-up' : 'fa-arrow-down';
  const sign  = up ? '+' : '';
  return `<span class="an-delta" style="color:var(--${color});">
      <i class="fa-solid ${icon}"></i> ${sign}${anNum(delta.diff)}${unit}
    </span><span style="opacity:.7;">前期間比</span>`;
}

/* ══════════════ SVG ══════════════ */

/**
 * 折れ線。points は [{bucket, value}]。
 * gapFrom より前は記録が存在しない区間として斜線で塗り、境界に破線を引く。
 * 0で塗りつぶすと「使われていなかった」と誤読されるため、必ず区別する。
 */
function anSvgLine(points, { color = 'accent', unit = '', granularity = 'day', gapFrom = null } = {}) {
  if (!points || !points.length) return `<div class="an-empty">データがありません</div>`;

  const W = 900, H = 230, pad = { l: 44, r: 14, t: 14, b: 26 };
  const values = points.map(p => p.value);
  const max = Math.max(5, Math.ceil(Math.max(...values) * 1.2 / 5) * 5);
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const x = i => pad.l + (iw * i) / Math.max(1, points.length - 1);
  const y = v => pad.t + ih - (ih * v) / max;

  let grid = '';
  for (let g = 0; g <= 4; g++) {
    const v = (max / 4) * g, yy = y(v);
    grid += `<line x1="${pad.l}" y1="${yy}" x2="${W - pad.r}" y2="${yy}" stroke="var(--border)" stroke-width="1"/>`
          + `<text x="${pad.l - 8}" y="${yy + 3.5}" text-anchor="end" font-size="10" fill="var(--muted)">${anNum(Math.round(v))}</text>`;
  }

  /* 記録がない区間 */
  let gapArt = '';
  const gapIdx = gapFrom ? points.findIndex(p => p.bucket >= gapFrom) : -1;
  if (gapIdx > 0) {
    const gx = x(gapIdx);
    gapArt = `
      <rect x="${pad.l}" y="${pad.t}" width="${(gx - pad.l).toFixed(1)}" height="${ih}" fill="url(#anNoData)"/>
      <line x1="${gx.toFixed(1)}" y1="${pad.t}" x2="${gx.toFixed(1)}" y2="${pad.t + ih}"
            stroke="var(--orange)" stroke-width="1.5" stroke-dasharray="4 3"/>
      <text x="${(gx + 6).toFixed(1)}" y="${pad.t + 11}" font-size="10" font-weight="700" fill="var(--orange)">${h(gapFrom)} 記録開始</text>
      <text x="${((pad.l + gx) / 2).toFixed(1)}" y="${(pad.t + ih / 2).toFixed(1)}"
            text-anchor="middle" font-size="11" fill="#b58020">記録なし</text>`;
  }

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const dots = points.map((p, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="${points.length > 20 ? 2.4 : 3.2}" fill="${anCv(color)}">
       <title>${h(anBucketFull(p.bucket, granularity))}: ${anNum(p.value)}${h(unit)}</title></circle>`).join('');

  const step = Math.max(1, Math.ceil(points.length / 7));
  const xlab = points.map((p, i) =>
    (i % step && i !== points.length - 1) ? '' :
    `<text x="${x(i).toFixed(1)}" y="${H - 8}" font-size="10" fill="var(--muted)" text-anchor="middle">${h(anBucketLabel(p.bucket, granularity))}</text>`
  ).join('');

  /* preserveAspectRatio は既定のまま。none にすると線の太さと文字が横に伸びる */
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;height:auto;overflow:visible;">
    <defs><pattern id="anNoData" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <rect width="7" height="7" fill="#fafafa"/><line x1="0" y1="0" x2="0" y2="7" stroke="#e8e9ec" stroke-width="3"/>
    </pattern></defs>
    ${grid}${gapArt}
    <path d="${path}L${x(points.length - 1).toFixed(1)},${pad.t + ih}L${pad.l},${pad.t + ih}Z" fill="${anCv(color)}" opacity=".1"/>
    <path d="${path}" fill="none" stroke="${anCv(color)}" stroke-width="2" stroke-linejoin="round"/>
    ${dots}${xlab}</svg>`;
}

/** テーブルのセルに入れる30日推移 */
function anSvgSpark(points, color = 'accent') {
  if (!points || !points.length) return anDash;
  const values = points.map(p => p.value);
  const max = Math.max(...values) || 1;
  const pts = values.map((v, i) =>
    `${(58 * i / Math.max(1, values.length - 1)).toFixed(1)},${(16 - 14 * v / max).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 58 18" width="58" height="18" preserveAspectRatio="none" style="display:block;">
    <polyline points="${pts}" fill="none" stroke="${anCv(color)}" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
}

/** 操作数シェアのドーナツ */
function anSvgDonut(segs, size = 148) {
  const total = segs.reduce((s, x) => s + x.value, 0);
  if (!total) return `<div class="an-empty">操作の記録がありません</div>`;

  const R = 56, C = 2 * Math.PI * R;
  let off = 0;
  const rings = segs.map(s => {
    const len = C * s.value / total;
    const el = `<circle cx="${size / 2}" cy="${size / 2}" r="${R}" fill="none" stroke="${anCv(s.color)}"
      stroke-width="19" stroke-dasharray="${len.toFixed(1)} ${(C - len).toFixed(1)}"
      stroke-dashoffset="${(-off).toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})">
      <title>${h(s.label)}: ${anNum(s.value)}件 (${Math.round(s.value / total * 100)}%)</title></circle>`;
    off += len;
    return el;
  }).join('');

  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="flex-shrink:0;">
    <circle cx="${size/2}" cy="${size/2}" r="${R}" fill="none" stroke="var(--gray-lt)" stroke-width="19"/>
    ${rings}
    <text x="${size/2}" y="${size/2 - 2}" text-anchor="middle" font-family="Poppins" font-weight="800" font-size="21" fill="var(--text)">${anNum(total)}</text>
    <text x="${size/2}" y="${size/2 + 15}" text-anchor="middle" font-size="9.5" fill="var(--muted)">操作数</text></svg>`;
}

/* ══════════════ 入口 ══════════════ */

async function loadAnalytics() {
  anRenderFilterBar();

  if (currentUser.token?.startsWith('mock-token')) {
    document.getElementById('anBody').innerHTML =
      `<div class="an-empty" style="padding:60px 20px;">API未接続 — Laragonを起動するとデータが表示されます</div>`;
    return;
  }

  const gen = ++AN.gen;

  /* 古い期間の数字を「現在の値」として読ませないよう、先に読み込み中に戻す */
  anBusy('anKpis', 'anLine', 'anAppBars', 'anHeat', 'anDonut');
  anBusyTable('anCompanyTable', 9);
  anBusyTable('anFeatTable', 5);
  anBusyTable('anDormantTable', 6);

  /* overview を単独で投げて先に描く。残りは遅延ロード。
     2026-07-02 の行ロック全断は初期表示の並列リクエストが引き金だったので、
     重いクエリを一斉に投げない */
  await anLoadOverview(gen);
  anLoadTimeseries(gen);
  anLoadCompanies(gen);
  anLoadFeatures(gen);
  anLoadDormant(gen);
}

/** 応答が届いた時点で世代が進んでいたら、その結果は捨てる */
const anStale = gen => gen !== undefined && gen !== AN.gen;

function anReload() {
  loadAnalytics();
}

/* ══════════════ フィルタ ══════════════ */

function anRenderFilterBar() {
  const bar = document.getElementById('anFilterBar');
  if (!bar || bar.dataset.ready) return;
  bar.dataset.ready = '1';

  bar.innerHTML = `
    <select class="form-input" id="anPeriod">
      <option value="7">過去7日</option>
      <option value="30" selected>過去30日</option>
      <option value="90">過去90日</option>
      <option value="365">過去1年</option>
      <option value="fy">今年度</option>
    </select>
    <span id="anBucketHint" style="font-size:11px;color:var(--muted);">日次</span>
    <select class="form-input" id="anCompany"><option value="">すべての会社</option></select>
    <button class="btn btn-outline btn-sm" id="anRefresh"><i class="fa-solid fa-rotate"></i> 更新</button>
    <span id="anRange" style="margin-left:auto;font-size:11px;color:var(--muted);"></span>`;

  document.getElementById('anPeriod').addEventListener('change', e => { AN.period = e.target.value; anReload(); });
  document.getElementById('anCompany').addEventListener('change', e => { AN.company = e.target.value; anReload(); });
  document.getElementById('anRefresh').addEventListener('click', anReload);

  /* 推移の指標切替。折れ線だけ差し替えたいので全体は再読み込みしない */
  document.getElementById('anMetricTabs')?.addEventListener('click', e => {
    const b = e.target.closest('button[data-metric]');
    if (!b) return;
    AN.metric = b.dataset.metric;
    document.querySelectorAll('#anMetricTabs button').forEach(x => x.classList.toggle('an-on', x === b));
    anBusy('anLine');
    // 現在の世代を渡す。この直後に期間を変えられた場合は結果を捨てる
    anLoadTimeseries(AN.gen);
  });
}

/** クエリ文字列。company_id は空なら送らない（送ると全社集計にならない） */
function anQuery(extra = {}) {
  const p = new URLSearchParams({ period: AN.period, ...extra });
  if (AN.company) p.set('company_id', AN.company);
  return p.toString();
}

async function anGet(path, extra = {}) {
  const res = await apiFetch(`${path}?${anQuery(extra)}`);
  if (!res?.ok) return null;
  return res.json().catch(() => null);
}

function anFail(id, label) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="an-empty">${h(label)}の取得に失敗しました</div>`;
}

/** 読み込み中の表示に戻す。古い期間の数字を「現在の値」として読ませないため */
function anBusy(...ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<div class="an-empty"><span class="spinner"></span></div>`;
  });
}
function anBusyTable(id, cols) {
  const tbody = document.querySelector(`#${id} tbody`);
  if (tbody) tbody.innerHTML = `<tr class="loading-row"><td colspan="${cols}"><span class="spinner"></span></td></tr>`;
}

/* ══════════════ overview（KPI・アプリ別・シェア） ══════════════ */

async function anLoadOverview(gen) {
  const json = await anGet('/admin/analytics/overview');
  if (anStale(gen)) return;
  if (!json) { anFail('anKpis', 'サマリー'); return; }

  const d = json.data, m = json.meta;
  AN.meta = m;

  document.getElementById('anBucketHint').textContent =
    { day: '日次', week: '週次', month: '月次' }[m.bucket] ?? m.bucket;
  document.getElementById('anRange').textContent = `${m.from} 〜 ${m.to}（${m.label}）`;

  anRenderWarning(m);
  anRenderKpis(d, m);
  anRenderApps(d);
  anRenderNote(d);
}

/** 長期間を選んだときに「記録がどこから有るか」を先に伝える */
function anRenderWarning(meta) {
  const el = document.getElementById('anWarn');
  if (!el) return;

  if (!['365', 'fy'].includes(meta.period)) { el.style.display = 'none'; return; }

  el.style.display = '';
  el.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i>
    <div>${h(meta.label)}を表示していますが、ログイン・滞在時間の記録は
      <b>${h(meta.data_from.auth)}</b> 開始です。
      What'sNo は ${h(meta.data_from.whatsno)}、MeetLog は ${h(meta.data_from.meetlog)}、
      a.a は ${h(meta.data_from.aa)} 以降の記録しかありません
      （SOLID のみ ${h(meta.data_from.solid)} から遡れます）。
      それ以前の期間はグラフ上に境界線を引いて区別しています。</div>`;
}

function anRenderKpis(d, meta) {
  const a = d.activity, s = d.session, c = d.companies, u = d.users;
  const rate = d.adoption.rate;

  const cards = [
    { label: 'アクティブユーザー', icon: 'fa-solid fa-users', color: 'blue',
      value: anNum(a.active_users),
      sub: `全${anNum(u.total)}名中（${u.total ? Math.round(a.active_users / u.total * 100) : 0}%） / DAU ${anNum(a.dau)}・WAU ${anNum(a.wau)}`,
      delta: anDelta(a.active_users_delta, '名') },
    { label: '総利用時間', icon: 'fa-regular fa-clock', color: 'accent',
      value: `${anNum(s.total_hours)}<small>h</small>`,
      sub: `中央値 ${s.median_minutes === null ? '—' : s.median_minutes + '分'} / 算出率 ${anPct(s.coverage)}`,
      delta: anDelta(s.total_hours_delta, 'h') },
    { label: 'ログイン回数', icon: 'fa-solid fa-right-to-bracket', color: 'green',
      /* 分母は「ログインした人数(MAU)」。隣の「アクティブユーザー」は業務操作の
         痕跡がある人数で母数が違うので、どちらの1人あたりかを明示する */
      value: anNum(a.logins),
      sub: `ログインした1人あたり ${a.mau ? (a.logins / a.mau).toFixed(1) : '0.0'}回 / 失敗 ${anPct(a.failure_rate)}`,
      delta: anDelta(a.logins_delta, '回') },
    { label: '平均定着率', icon: 'fa-solid fa-bullseye', color: 'orange',
      value: `${rate === null ? '—' : Math.round(rate * 100)}<small>%</small>`,
      sub: `契約${anNum(d.adoption.seats)}席中 ${anNum(d.adoption.used_seats)}席が利用`,
      delta: `<span style="opacity:.7;">操作数 ${anNum(a.events)}件</span>` },
    { label: '未活用の会社', icon: 'fa-solid fa-triangle-exclamation', color: 'red',
      value: anNum(c.idle), valueColor: c.idle > 0 ? 'red' : null,
      sub: `${h(meta.label)}に利用の記録なし（全${anNum(c.total)}社・稼働 ${anNum(c.using)}社）`,
      delta: `<span style="opacity:.7;">ロール別 一般${anNum(u.by_role.general)}・管理${anNum(u.by_role.admin)}</span>` },
  ];

  document.getElementById('anKpis').innerHTML = cards.map(k => `
    <div class="kpi-card an-kpi">
      <div class="kpi-label">${h(k.label)}
        <div class="kpi-icon" style="background:var(--${k.color}-lt);color:var(--${k.color});"><i class="${k.icon}"></i></div>
      </div>
      <div class="kpi-value"${k.valueColor ? ` style="color:var(--${k.valueColor});"` : ''}>${k.value}</div>
      <div class="kpi-sub">${k.sub}<br>${k.delta}</div>
    </div>`).join('');
}

function anRenderApps(d) {
  const apps = d.apps ?? [];

  document.getElementById('anAppBars').innerHTML = apps.length ? apps.map(a => {
    const r = a.adoption_rate;
    return `<div class="an-appbar">
      <div class="an-appbar-head">
        <span class="an-appbar-name">${h(a.label)}</span>
        <span class="an-appbar-meta">契約${anNum(a.licensed_users)}席中 <b>${anNum(a.active_users)}</b>名</span>
      </div>
      <div class="an-appbar-row">
        <div class="an-appbar-track">
          <div style="width:${r === null ? 0 : Math.round(r * 100)}%;background:${anCv(a.color)};"></div>
        </div>
        <span class="an-appbar-pct" style="color:${anCv(a.color)};">${anPct(r)}</span>
      </div>
    </div>`;
  }).join('') : `<div class="an-empty">契約中のアプリがありません</div>`;

  const total = apps.reduce((s, a) => s + a.events, 0);
  document.getElementById('anDonut').innerHTML =
    anSvgDonut(apps.map(a => ({ label: a.label, value: a.events, color: a.color })))
    + `<div style="width:100%;">` + apps.map(a => `
      <div class="an-legend-row">
        <span class="an-legend-dot" style="background:${anCv(a.color)};"></span>
        <span style="flex:1;">${h(a.label)}</span>
        <span class="an-mono" style="color:var(--muted);font-size:11px;">${anNum(a.events)}</span>
        <span class="an-mono" style="min-width:34px;text-align:right;">${total ? Math.round(a.events / total * 100) : 0}%</span>
      </div>`).join('') + `</div>`;
}

function anRenderNote(d) {
  document.getElementById('anNote').innerHTML = `<i class="fa-solid fa-circle-info"></i>
    <div>${h(d.session.coverage_note)}
      <b>${h(d.session.per_app_note)}</b>
      アプリ横断の計測基盤を入れると <span class="badge badge-green">実測</span> に切り替わります。
      「マニュアル閲覧」「いいね」などは記録の作りから期間集計ができないため
      <span class="badge badge-orange">計測なし</span> と表示しています。</div>`;
}

/* ══════════════ timeseries ══════════════ */

async function anLoadTimeseries(gen) {
  const json = await anGet('/admin/analytics/timeseries', { metric: AN.metric });
  if (anStale(gen)) return;
  if (!json) { anFail('anLine', '推移'); return; }

  const d = json.data, m = json.meta;
  document.getElementById('anLineSub').textContent =
    `${AN_METRIC_LABEL[d.metric]}・${{ day:'日次', week:'週次', month:'月次' }[m.bucket]}・${m.label}`;

  /* 系列が1本なら折れ線1本、複数（操作数のアプリ別）なら重ねて描く */
  if (d.series.length <= 1) {
    const s = d.series[0];
    document.getElementById('anLine').innerHTML = anSvgLine(s?.points ?? d.total, {
      color: s?.color ?? 'accent', unit: d.unit, granularity: m.bucket, gapFrom: m.gap_from,
    });
    document.getElementById('anLineLegend').innerHTML = '';
  } else {
    document.getElementById('anLine').innerHTML = anSvgMultiLine(d.series, {
      unit: d.unit, granularity: m.bucket, gapFrom: m.gap_from,
    });
    document.getElementById('anLineLegend').innerHTML = d.series.map(s => `
      <span class="an-legend-inline"><span class="an-legend-dot" style="background:${anCv(s.color)};"></span>${h(s.label)}</span>
    `).join('');
  }
}

/** 複数系列の折れ線。軸は共通、系列ごとに色を変える */
function anSvgMultiLine(series, { unit = '', granularity = 'day', gapFrom = null } = {}) {
  const first = series[0]?.points ?? [];
  if (!first.length) return `<div class="an-empty">データがありません</div>`;

  const W = 900, H = 230, pad = { l: 44, r: 14, t: 14, b: 26 };
  const allMax = Math.max(...series.flatMap(s => s.points.map(p => p.value)), 1);
  const max = Math.max(5, Math.ceil(allMax * 1.2 / 5) * 5);
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const x = i => pad.l + (iw * i) / Math.max(1, first.length - 1);
  const y = v => pad.t + ih - (ih * v) / max;

  let grid = '';
  for (let g = 0; g <= 4; g++) {
    const v = (max / 4) * g, yy = y(v);
    grid += `<line x1="${pad.l}" y1="${yy}" x2="${W - pad.r}" y2="${yy}" stroke="var(--border)" stroke-width="1"/>`
          + `<text x="${pad.l - 8}" y="${yy + 3.5}" text-anchor="end" font-size="10" fill="var(--muted)">${anNum(Math.round(v))}</text>`;
  }

  let gapArt = '';
  const gapIdx = gapFrom ? first.findIndex(p => p.bucket >= gapFrom) : -1;
  if (gapIdx > 0) {
    const gx = x(gapIdx);
    gapArt = `<rect x="${pad.l}" y="${pad.t}" width="${(gx - pad.l).toFixed(1)}" height="${ih}" fill="url(#anNoData)"/>
      <line x1="${gx.toFixed(1)}" y1="${pad.t}" x2="${gx.toFixed(1)}" y2="${pad.t + ih}"
            stroke="var(--orange)" stroke-width="1.5" stroke-dasharray="4 3"/>`;
  }

  const lines = series.map(s => {
    const path = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
    const dots = s.points.map((p, i) =>
      `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="2.4" fill="${anCv(s.color)}">
         <title>${h(s.label)} / ${h(anBucketFull(p.bucket, granularity))}: ${anNum(p.value)}${h(unit)}</title></circle>`).join('');
    return `<path d="${path}" fill="none" stroke="${anCv(s.color)}" stroke-width="2" stroke-linejoin="round"/>${dots}`;
  }).join('');

  const step = Math.max(1, Math.ceil(first.length / 7));
  const xlab = first.map((p, i) =>
    (i % step && i !== first.length - 1) ? '' :
    `<text x="${x(i).toFixed(1)}" y="${H - 8}" font-size="10" fill="var(--muted)" text-anchor="middle">${h(anBucketLabel(p.bucket, granularity))}</text>`
  ).join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;height:auto;overflow:visible;">
    <defs><pattern id="anNoData" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <rect width="7" height="7" fill="#fafafa"/><line x1="0" y1="0" x2="0" y2="7" stroke="#e8e9ec" stroke-width="3"/>
    </pattern></defs>
    ${grid}${gapArt}${lines}${xlab}</svg>`;
}

/* ══════════════ companies（マトリクス + 一覧） ══════════════ */

async function anLoadCompanies(gen) {
  const json = await anGet('/admin/analytics/companies');
  if (anStale(gen)) return;
  if (!json) { anFail('anHeat', '会社別利用状況'); return; }

  const rows = json.data, m = json.meta;
  AN.companies = rows;
  anFillCompanySelect(rows);
  anRenderHeatmap(rows, m);
  anRenderCompanyTable(rows, m);
}

function anFillCompanySelect(rows) {
  const sel = document.getElementById('anCompany');
  if (!sel || sel.dataset.filled) return;
  sel.dataset.filled = '1';
  sel.insertAdjacentHTML('beforeend',
    rows.map(r => `<option value="${r.company_id}">${h(r.company_name)}</option>`).join(''));
  sel.value = AN.company;
}

/**
 * 会社 × アプリ の定着率マトリクス。
 * 「契約しているのに利用0名」のマスが一目で拾えることがこの表の狙いなので、
 * 未契約（斜線）と 契約済み0名（赤の破線）を必ず描き分ける。
 */
function anRenderHeatmap(rows, meta) {
  const apps = meta.apps ?? [];
  if (!rows.length || !apps.length) {
    document.getElementById('anHeat').innerHTML = `<div class="an-empty">会社がありません</div>`;
    return;
  }

  let zero = 0, none = 0, live = 0;

  const body = rows.map(r => {
    const cells = apps.map(a => {
      const c = r.by_app?.[a.app];
      if (!c) {
        none++;
        return `<td class="an-cell an-cell-none" title="${h(r.company_name)}: ${h(a.label)} は未契約">—</td>`;
      }
      const rate = c.adoption_rate;
      if (!c.active_users) {
        zero++;
        return `<td class="an-cell an-cell-zero" title="${h(r.company_name)} × ${h(a.label)}: 契約${c.seats}席・利用0名">
          0/${c.seats}<span class="an-cell-pct">0%</span></td>`;
      }
      live++;
      const pct = Math.round(14 + 86 * (rate ?? 0));
      return `<td class="an-cell" style="background:color-mix(in srgb, ${anCv(a.color)} ${pct}%, #fff);color:${(rate ?? 0) > 0.48 ? '#fff' : 'var(--text)'};"
        title="${h(r.company_name)} × ${h(a.label)}: 定着率 ${anPct(rate)}（${c.active_users}/${c.seats}名・操作${anNum(c.events)}件）">
        ${c.active_users}/${c.seats}<span class="an-cell-pct">${anPct(rate)}</span></td>`;
    }).join('');

    const tr = r.adoption_rate;
    return `<tr>
      <td class="an-rowhead"><span class="an-nm" title="${h(r.company_name)}">${h(r.company_name)}</span> ${planBadge(r.plan)}</td>
      ${cells}
      <td class="an-cell an-cell-total" style="color:${anCv(anRateColor(tr))};">
        ${anNum(r.active_users)}/${anNum(r.users.total)}<span class="an-cell-pct" style="opacity:1;">${anPct(tr)}</span></td>
    </tr>`;
  }).join('');

  /* 最下段のアプリ合計。縦からも横からも読めるようにする */
  const foot = apps.map(a => {
    const active = rows.reduce((s, r) => s + (r.by_app?.[a.app]?.active_users ?? 0), 0);
    const seats  = rows.reduce((s, r) => s + (r.by_app?.[a.app]?.seats ?? 0), 0);
    const rate   = seats ? active / seats : null;
    return `<td style="color:${anCv(anRateColor(rate))};">${active}/${seats}<span class="an-cell-pct" style="display:block;">${anPct(rate)}</span></td>`;
  }).join('');

  document.getElementById('anHeat').innerHTML = `
    <table class="an-heat">
      <thead><tr>
        <th class="an-rowhead">会社（${rows.length}社）</th>
        ${apps.map(a => `<th>${h(a.label)}<span class="an-seats">契約${a.seats}席</span></th>`).join('')}
        <th style="min-width:78px;">会社合計<span class="an-seats">実利用/在籍</span></th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td class="an-rowhead">アプリ合計（利用者/席）</td>${foot}<td class="an-cell an-cell-total">—</td></tr></tfoot>
    </table>`;

  document.getElementById('anHeatLegend').innerHTML = `
    <span>定着率</span>
    <div class="an-scale">${[14, 32, 50, 68, 86, 100]
      .map(p => `<span style="background:color-mix(in srgb, var(--blue) ${p}%, #fff);"></span>`).join('')}</div>
    <span>0% → 100%</span>
    <span class="an-key"><i style="border:1.5px dashed var(--red);"></i> 契約済み・利用0名（${zero}マス）</span>
    <span class="an-key"><i class="an-key-none"></i> 未契約（${none}マス＝アップセル余地）</span>
    <span class="an-key" style="color:var(--green);"><i style="background:var(--blue);"></i> 稼働（${live}マス）</span>
    ${meta.adoption_caveat ? `<span style="color:var(--orange);font-weight:700;">※${h(meta.adoption_caveat)}</span>` : ''}`;
}

function anRenderCompanyTable(rows, meta) {
  const tbody = document.querySelector('#anCompanyTable tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="9">会社がありません</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const rate = r.adoption_rate;
    const col  = anRateColor(rate);
    return `<tr>
      <td style="font-weight:500;">${h(r.company_name)}</td>
      <td>${planBadge(r.plan)}</td>
      <td class="an-mono">${anNum(r.users.total)}名</td>
      <td style="white-space:nowrap;">${(r.apps_enabled ?? []).map(a => {
        const meta2 = (meta.apps ?? []).find(x => x.app === a);
        return `<span class="an-chip" style="background:var(--${meta2?.color ?? 'gray'}-lt);color:var(--${meta2?.color ?? 'muted'});">${h(meta2?.label ?? a)}</span>`;
      }).join('')}</td>
      <td class="an-mono">${anNum(r.active_users)}名</td>
      <td><div class="an-rate">
        <div class="an-rate-track"><div style="width:${rate === null ? 0 : Math.round(rate * 100)}%;background:${anCv(col)};"></div></div>
        <span class="an-rate-num" style="color:${anCv(col)};">${anPct(rate)}</span>
      </div></td>
      <td class="an-mono">${anNum(r.events)}</td>
      <td>${anSvgSpark(r.trend, col)}</td>
      <td style="font-size:12px;white-space:nowrap;color:${r.last_login_at ? 'var(--muted)' : 'var(--red)'};">
        ${r.last_login_at ? h(r.last_login_at) : '<i class="fa-solid fa-circle-exclamation"></i> なし'}</td>
    </tr>`;
  }).join('');
}

/* ══════════════ features ══════════════ */

async function anLoadFeatures(gen) {
  const json = await anGet('/admin/analytics/features');
  if (anStale(gen)) return;
  if (!json) { anFail('anFeatTable', '機能使用状況'); return; }

  const groups = json.data.groups ?? [];
  if (!groups.length) {
    document.getElementById('anFeatTabs').innerHTML = '';
    document.querySelector('#anFeatTable tbody').innerHTML =
      `<tr class="empty-row"><td colspan="5">集計対象のアプリがありません</td></tr>`;
    return;
  }

  if (!AN.featApp || !groups.some(g => g.app === AN.featApp)) AN.featApp = groups[0].app;

  document.getElementById('anFeatTabs').innerHTML = groups.map(g =>
    `<button class="btn btn-outline btn-xs ${g.app === AN.featApp ? 'an-on' : ''}" data-app="${g.app}">${h(g.label)}</button>`).join('');
  document.getElementById('anFeatTabs').onclick = e => {
    const b = e.target.closest('button[data-app]');
    if (!b) return;
    AN.featApp = b.dataset.app;
    document.querySelectorAll('#anFeatTabs button').forEach(x => x.classList.toggle('an-on', x === b));
    anRenderFeatures(groups);
  };

  anRenderFeatures(groups);
}

function anRenderFeatures(groups) {
  const g = groups.find(x => x.app === AN.featApp) ?? groups[0];
  document.getElementById('anFeatSub').textContent = `${g.label}・操作 ${anNum(g.total)}件`;

  document.querySelector('#anFeatTable tbody').innerHTML = g.features.map(f => {
    const note  = f.note ? ` <i class="fa-solid fa-circle-info an-info" title="${h(f.note)}"></i>` : '';
    const extra = f.breakdown?.length
      ? `<div class="an-breakdown">${f.breakdown.map(b =>
          `<span>${h(b.label)} <b>${anNum(b.count)}</b>（成功 ${anPct(b.success_rate)}）</span>`).join('')}</div>`
      : '';
    return `<tr>
      <td>${h(f.label)}${note}${extra}</td>
      <td class="an-mono">${f.count === null ? anDash : anNum(f.count)}</td>
      <td class="an-mono">${f.users === null ? anDash : anNum(f.users) + '名'}</td>
      <td>${f.trend ? anSvgSpark(f.trend, g.color) : anDash}</td>
      <td>${AN_SOURCE_BADGE[f.source] ?? ''}</td>
    </tr>`;
  }).join('');
}

/* ══════════════ dormant（休眠ユーザー） ══════════════ */

async function anLoadDormant(gen) {
  /* 期間ではなく「何日ログインしていないか」で見るので period は送らない */
  const params = new URLSearchParams({ days: '30' });
  if (AN.company) params.set('company_id', AN.company);
  const res = await apiFetch(`/admin/analytics/dormant?${params}`);
  if (anStale(gen)) return;
  if (!res?.ok) { anFail('anDormantTable', '休眠ユーザー'); return; }

  const { data } = await res.json();
  document.getElementById('anDormantSub').textContent = `30日以上ログインなし・${data.length}名`;

  const tbody = document.querySelector('#anDormantTable tbody');
  tbody.innerHTML = data.length ? data.map(u => `
    <tr>
      <td style="font-weight:500;">${h(u.name)}</td>
      <td style="font-size:12px;color:var(--muted);">${h(u.company_name ?? '—')}</td>
      <td>${roleBadge(u.role)}</td>
      <td style="white-space:nowrap;">${u.apps.map(a =>
        `<span class="an-chip" style="background:var(--${a.color}-lt);color:var(--${a.color});">${h(a.label)}</span>`).join('') || anDash}</td>
      <td style="font-size:12px;color:${u.last_login_at ? 'var(--muted)' : 'var(--red)'};">
        ${u.last_login_at ? h(u.last_login_at) : 'ログインなし'}</td>
      <td class="an-mono" style="color:${(u.days_since ?? 999) > 40 ? 'var(--red)' : 'var(--orange)'};">
        ${u.days_since === null ? anDash : u.days_since + '日'}</td>
    </tr>`).join('')
    : `<tr class="empty-row"><td colspan="6">30日以上ログインしていないユーザーはいません</td></tr>`;
}

/* admin.html の switchSection から呼ばれる */
window.loadAnalytics = loadAnalytics;
