'use strict';
/* SOLID 不具合対策書（納品した3Dモデルの不具合）
   HaLSpace と PT.HILANO LCZ INDONESIA の2社だけが使う画面。アクセス制御の正は API
   （solid.quality ミドルウェアが 403 を返す）。ここでは 403 なら案内を出すだけ。

   作成フロー: ① HILANO 発生原因・対策 → ② HaLSpace 確認（OK / 差し戻し）
             → ③ HaLSpace 流出原因 → ④ HaLSpace お客様向けの文面 → ⑤ 提出
   トップは台帳型の一覧、1件を開くと作成ウィザード（左: ステップ / 右: 対策書プレビュー）。 */

const user = requireSpaceAuth();
if (!user) throw new Error('未認証');
renderSidebarUser(user);
if (isAdmin(user)) {
  document.getElementById('adminNav').style.display = '';
  document.getElementById('adminLink').style.display = '';
}
initMobileMenu();

const BASE = '/solid/quality-reports';
const STEPS = [
  { n: 1, who: 'lcz', t: '発生原因・対策' },
  { n: 2, who: 'hal', t: '内容の確認' },
  { n: 3, who: 'hal', t: '検査での原因・対策' },
  { n: 4, who: 'hal', t: 'まとめ' },
  { n: 5, who: 'hal', t: 'お客様へ提出' },
];
const NUM = '①②③④⑤';
const WHO = { lcz: 'HILANO', hal: 'HaLSpace' };
const TYPES = ['寸法違い', '改訂の反映漏れ', '板厚・材質違い', '形状の誤り', '形状の抜け', 'その他'];
const OCC = ['図面の読み違い', '改訂内容の確認漏れ', '入力ミス', '作業手順がない', 'その他'];   // 発生原因（HILANO）
const OUT = ['検査項目の不足', '検査での見落とし', '改訂版との照合なし', 'その他'];             // 流出原因（HaLSpace）

let SIDE = null;          // 'hal' | 'lcz'
let REPORTS = [];         // 一覧（要約）
let CUR = null;           // 開いている1件（詳細）
let viewStep = null;      // ステッパーで選んでいるステップ（null = 今のステップ）
let quick = 'all';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtJa = d => { if (!d) return ''; const [y, m, dd] = d.slice(0, 10).split('-'); return `${y}年${+m}月${+dd}日`; };
const md = d => d ? d.slice(5, 10).replace('-', '/') : '';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const isMine = r => r.stage < 6 && r.owner === SIDE;
const clientName = r => r.client?.name ?? '（客先未設定）';

/* ───────── 画像（Bearer が要るので fetch → Blob URL） ───────── */
const imgCache = new Map();
function authImage(url) {
  if (!imgCache.has(url)) {
    const token = sessionStorage.getItem('space_token');
    imgCache.set(url, fetch(API_BASE + url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.blob() : Promise.reject(r.status))
      .then(b => URL.createObjectURL(b))
      .catch(() => { imgCache.delete(url); return null; }));
  }
  return imgCache.get(url);
}
function shotHtml(img, label) {
  const lbl = label ? `<span class="lbl ${img?.kind ?? ''}">${img?.kind === 'fixed' ? '修正後' : '不具合箇所'}</span>` : '';
  if (!img) return `<div class="qr-shot"><i class="fa-regular fa-image"></i></div>`;
  return `<div class="qr-shot" data-img="${esc(img.url)}">${lbl}<i class="fa-regular fa-image"></i></div>`;
}
function hydrateImages(root) {
  root.querySelectorAll('[data-img]:not([data-done])').forEach(el => {
    el.dataset.done = '1';
    authImage(el.dataset.img).then(src => {
      if (!src) return;
      const im = document.createElement('img');
      im.src = src; im.alt = '';
      if (!el.closest('.qr-paper')) im.onclick = e => { e.stopPropagation(); openLightbox(src); };
      el.appendChild(im);
    });
  });
}
function openLightbox(src) {
  const box = document.createElement('div');
  box.className = 'qr-lightbox';
  box.innerHTML = `<img src="${src}" alt="">`;
  box.onclick = () => box.remove();
  document.body.appendChild(box);
}
const firstImg = (r, kind) => (r.images || []).find(i => i.kind === kind) ?? null;

/* ───────── 状態の表示 ───────── */
function stChip(r) {
  if (r.stage >= 6) return `<span class="qr-st done"><i class="fa-solid fa-circle-check"></i>提出済み ${md(r.submitted_on)}</span>`;
  if (r.returned) return `<span class="qr-st ret ${isMine(r) ? 'mine' : ''}"><i class="fa-solid fa-rotate-left"></i>差し戻し · HILANO</span>`;
  const s = STEPS[r.stage - 1];
  return `<span class="qr-st ${s.who} ${isMine(r) ? 'mine' : ''}">${NUM[s.n - 1]} ${s.t} · ${WHO[s.who]}</span>`;
}
const clientTag = r => `<span class="qr-client"><i class="fa-regular fa-building"></i>${esc(clientName(r))}</span>`;
function updateBadge() {
  const n = REPORTS.filter(isMine).length;
  const b = $('navQualityBadge');
  if (b) { b.textContent = n > 99 ? '99+' : n; b.style.display = n ? '' : 'none'; }
}

/* ───────── 読み込み ───────── */
async function loadList() {
  try {
    const d = await api.get(BASE);
    if (!d) return false;
    SIDE = d.side;
    REPORTS = d.reports;
    return true;
  } catch (e) {
    if (/権限/.test(e.message)) {
      $('qrDenied').style.display = '';
      $('viewList').style.display = 'none';
      $('viewDetail').style.display = 'none';
      return false;
    }
    $('lList').innerHTML = `<div class="qr-empty">読み込みに失敗しました: ${esc(e.message)}</div>`;
    $('viewList').style.display = '';
    return false;
  }
}
function syncSummary(r) {
  const i = REPORTS.findIndex(x => x.id === r.id);
  if (i >= 0) REPORTS[i] = r; else REPORTS.unshift(r);
  updateBadge();
}

/* ───────── 一覧（トップ） ───────── */
function buildFilters() {
  const clients = [...new Map(REPORTS.filter(r => r.client).map(r => [r.client.id, r.client.name])).entries()];
  const cSel = $('lClient'), cur = cSel.value;
  cSel.innerHTML = '<option value="">すべての客先</option>' + clients.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('');
  cSel.value = clients.some(([id]) => String(id) === cur) ? cur : '';
  const years = [...new Set(REPORTS.map(r => r.found_on?.slice(0, 4)).filter(Boolean))].sort().reverse();
  const ySel = $('lYear'), yCur = ySel.value;
  ySel.innerHTML = '<option value="">すべての年</option>' + years.map(y => `<option>${y}</option>`).join('');
  ySel.value = years.includes(yCur) ? yCur : '';
}
function renderList() {
  const q = $('lQ').value.trim(), cl = $('lClient').value, yr = $('lYear').value;
  const base = REPORTS.filter(r => (!cl || String(r.client?.id) === cl) && (!yr || r.found_on?.startsWith(yr)));
  const Q = { all: ['すべて', () => true], mine: ['自分の番', isMine], wip: ['作成中', r => r.stage < 6], done: ['提出済み', r => r.stage >= 6] };
  $('lQuick').innerHTML = Object.entries(Q).map(([k, [l, f]]) =>
    `<button class="${quick === k ? 'on' : ''}" data-q="${k}">${k === 'mine' ? '<i class="fa-solid fa-hand-point-right"></i> ' : ''}${l}<b>${base.filter(f).length}</b></button>`).join('');
  $('lQuick').querySelectorAll('button').forEach(b => b.onclick = () => { quick = b.dataset.q; renderList(); });

  const sub = base.filter(r => r.stage >= 6);
  $('lClientSum').innerHTML = cl ? `<div class="qr-client-sum"><div><div class="nm"><i class="fa-regular fa-building" style="color:var(--muted)"></i>${esc(base[0]?.client?.name ?? '')}</div>
    <div class="ss"><span><b>${base.length}</b>件</span><span>提出済み <b>${sub.length}</b></span><span>作成中 <b>${base.length - sub.length}</b></span></div></div><span class="sp"></span>
    ${sub.length ? `<button class="btn btn-outline btn-sm" id="bulkOut"><i class="fa-regular fa-copy"></i> 提出済みの対策書をまとめて出力</button>` : ''}</div>` : '';
  $('bulkOut')?.addEventListener('click', () => openReports(sub.map(r => r.id), `${base[0].client.name} 様 不具合対策書（${sub.length}件）`));

  const text = r => [r.no, r.title, r.project?.code, r.project?.title, r.client?.name, r.symptom, r.defect_type, r.occ_category, r.out_category].join(' ');
  const list = base.filter(Q[quick][1]).filter(r => !q || text(r).includes(q))
    .sort((a, b) => (isMine(b) - isMine(a)) || (b.found_on || '').localeCompare(a.found_on || '') || b.id - a.id);

  $('lList').innerHTML = list.map(r => `<div class="qr-row ${isMine(r) ? 'mine' : ''}" data-id="${r.id}">
      ${shotHtml(firstImg(r, 'defect'), false)}
      <div style="min-width:0"><div class="m"><span class="docno">${esc(r.no)}</span>${r.defect_type ? `<span class="qr-type">${esc(r.defect_type)}</span>` : ''}</div>
        <div class="t">${esc(r.title)}</div>
        <div class="m">${clientTag(r)}${r.project ? `<span class="qr-pjcode">${esc(r.project.code)}</span><span>${esc(r.project.title)}</span>` : ''}</div></div>
      <div class="c-st">${stChip(r)}</div>
      <div class="col c-date">ご指摘 <b>${md(r.found_on)}</b><br>${r.submitted_on ? `提出 <b>${md(r.submitted_on)}</b>` : '未提出'}</div>
      <i class="fa-solid fa-chevron-right go"></i></div>`).join('')
    || `<div class="qr-empty">${REPORTS.length ? '条件に合う記録はありません' : 'まだ記録はありません。「不具合を記録」から登録してください。'}</div>`;
  $('lList').querySelectorAll('.qr-row').forEach(el => el.onclick = () => openDetail(+el.dataset.id, true));
  hydrateImages($('lList'));
}
['lQ', 'lClient', 'lYear'].forEach(id => $(id).addEventListener(id === 'lQ' ? 'input' : 'change', renderList));

function showList(push) {
  CUR = null;
  $('viewDetail').style.display = 'none';
  $('viewList').style.display = '';
  if (push) history.pushState({}, '', location.pathname);
  buildFilters(); renderList(); updateBadge();
  window.scrollTo(0, 0);
}

/* ───────── 中身（作成ウィザード） ───────── */
async function openDetail(id, push) {
  try {
    const d = await api.get(`${BASE}/${id}`);
    if (!d) return;
    SIDE = d.side; CUR = d.report; viewStep = null;
    if (push) history.pushState({ id }, '', `${location.pathname}?id=${id}`);
    $('viewList').style.display = 'none';
    $('viewDetail').style.display = '';
    $('dEvent').classList.remove('open');
    $('dSeg').querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === 0));
    $('dGrid').dataset.view = 'form';
    renderDetail();
    window.scrollTo(0, 0);
  } catch (e) {
    showToast(e.message, 'danger');
    showList(true);
  }
}
$('dBack').onclick = () => showList(true);
window.addEventListener('popstate', () => {
  const id = +new URLSearchParams(location.search).get('id');
  id ? openDetail(id, false) : showList(false);
});
$('dSeg').querySelectorAll('button').forEach(b => b.onclick = () => {
  $('dSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  $('dGrid').dataset.view = b.dataset.v;
});
$('dOpenReport').onclick = () => openReports([CUR.id], `不具合対策書 ${CUR.no}${CUR.stage < 5 ? '（下書き）' : ''}`, [CUR]);

const canEditBasic = r => r.stage < 6 || SIDE === 'hal';
function renderDetail() {
  const r = CUR;
  $('dTop').innerHTML = `<div class="ttl"><div class="docno">${esc(r.no)}</div><h2>${esc(r.title)}</h2>
      <div class="m">${stChip(r)}${clientTag(r)}${r.project ? `<span class="qr-pjcode">${esc(r.project.code)}</span><span style="color:var(--muted)">${esc(r.project.title)}</span>` : ''}${r.defect_type ? `<span class="qr-type">${esc(r.defect_type)}</span>` : ''}</div></div>
    <div class="acts">${canEditBasic(r) ? '<button class="btn btn-outline btn-sm" id="dEdit"><i class="fa-solid fa-pen"></i> 基本情報を編集</button>' : ''}
      ${SIDE === 'hal' ? '<button class="btn btn-ghost btn-sm" id="dDel" title="削除"><i class="fa-solid fa-trash-can"></i></button>' : ''}</div>`;
  $('dEdit')?.addEventListener('click', () => openEdit(r));
  $('dDel')?.addEventListener('click', deleteCurrent);

  const defects = r.images.filter(i => i.kind === 'defect'), fixes = r.images.filter(i => i.kind === 'fixed');
  const extra = [...defects.slice(1), ...fixes.slice(1)];
  $('dEvent').innerHTML = `<button class="qr-ev-toggle" id="evToggle" type="button"><span><i class="fa-solid fa-triangle-exclamation" style="color:var(--danger)"></i> 発生事象を見る</span><i class="fa-solid fa-chevron-down"></i></button>
    <div class="qr-ev"><div class="qr-ev-imgs"><div class="qr-pair">${shotHtml(defects[0] ?? null, true)}${shotHtml(fixes[0] ? fixes[0] : null, true)}</div>
        ${extra.length ? `<div class="qr-ev-more">${extra.map(i => shotHtml(i, false)).join('')}</div>` : ''}</div>
      <div><div class="qr-sec-h"><i class="fa-solid fa-triangle-exclamation" style="color:var(--danger)"></i>発生事象<span class="sp"></span>
        <span class="by">${r.reporter_name ? esc(r.reporter_name) + ' 様より ' : ''}${esc(r.found_on)} ご指摘</span></div>
      <dl class="qr-kv"><dt>内容</dt><dd>${esc(r.symptom)}</dd><dt>影響範囲</dt><dd>${esc(r.impact) || '—'}</dd>
        <dt>納品 / 再納品</dt><dd>${esc(r.delivered_on) || '—'} / ${esc(r.redelivered_on) || '—'}</dd></dl></div></div>`;
  $('evToggle').onclick = () => $('dEvent').classList.toggle('open');
  hydrateImages($('dEvent'));

  const vs = viewStep ?? Math.min(r.stage, 5);
  $('dSteps').innerHTML = STEPS.map(s => {
    const done = r.stage > s.n, cur = r.stage === s.n, ret = s.n === 1 && r.returned;
    return `<div class="s ${done ? 'done' : ''} ${cur ? 'cur' : ''} ${ret ? 'ret' : ''} ${vs === s.n ? 'view' : ''}" data-step="${s.n}">
      <span class="n">${done ? '<i class="fa-solid fa-check"></i>' : s.n}</span><b>${s.t}</b><small><span class="qr-who ${s.who}">${WHO[s.who]}</span>${ret ? ' 差し戻し' : ''}</small></div>`;
  }).join('');
  $('dSteps').querySelectorAll('.s').forEach(el => el.onclick = () => { viewStep = +el.dataset.step; renderDetail(); });

  const step = STEPS[vs - 1];
  const can = r.stage === vs && step.who === SIDE;
  const status = can ? '<span class="qr-st mine" style="color:var(--primary)"><i class="fa-solid fa-hand-point-right"></i>あなたの番</span>'
    : r.stage < vs ? '<span class="qr-lock"><i class="fa-regular fa-clock"></i>前のステップの完了待ち</span>'
    : r.stage === vs ? `<span class="qr-lock"><i class="fa-solid fa-lock"></i>${WHO[step.who]}が入力します</span>`
    : '<span class="qr-lock"><i class="fa-solid fa-check"></i>完了</span>';
  let body = '';
  if (vs === 1) body = can ? occForm(r) : occView(r);
  if (vs === 2) body = `<div class="qr-ref lcz"><b>① HILANO の入力</b>${r.occ.cause ? `発生原因: ${esc(r.occ.cause)}\n対策: ${esc(r.occ.fix)}\n再発防止: ${esc(r.occ.prevent)}` : '未入力'}</div>` + (can ? reviewForm() : reviewView(r));
  if (vs === 3) body = (r.occ.cause ? `<div class="qr-ref lcz"><b>① 発生原因（HILANO）</b>${esc(r.occ.cause)}</div>` : '') + (can ? outForm(r) : outView(r));
  if (vs === 4) body = can ? custForm(r) : custView(r);
  if (vs === 5) body = r.stage >= 6 ? submittedView(r) : can ? submitForm(r) : '<p class="qr-note">④ の確定後に提出します</p>';
  const f = $('dForm');
  f.innerHTML = `<div class="qr-sec ${step.who === 'lcz' ? 'lcz' : vs >= 4 ? 'cus' : 'hal'} ${can ? 'active' : ''}">
    <div class="qr-sec-h" style="margin-bottom:10px"><span class="qr-who ${step.who}">${WHO[step.who]}</span>${NUM[vs - 1]} ${step.t}<span class="sp"></span>${status}</div>${body}</div>`;
  bindStep(f, vs);
  renderHistory(r);
  renderPaperPreview();
}

/* ステップごとの中身 */
const ta = (k, label, v, hint = '') => `<div class="qr-fld"><label>${label}</label><textarea class="form-textarea" data-f="${k}" rows="3" maxlength="5000">${esc(v)}</textarea>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
const sel = (k, label, arr, v) => `<div class="qr-fld"><label>${label}</label><select class="form-select" data-f="${k}"><option value="">選択してください</option>${arr.map(x => `<option ${x === v ? 'selected' : ''}>${x}</option>`).join('')}</select></div>`;
const byLine = (by, at, who) => by ? `<p class="qr-note" style="margin-top:6px">${esc(by)}（${who}）· ${esc((at || '').slice(0, 16))}</p>` : '';
function occView(r) {
  if (!r.occ.cause) return '<p class="qr-note">まだ入力されていません</p>';
  return `<dl class="qr-kv"><dt>発生原因</dt><dd>${esc(r.occ.cause)}</dd><dt>原因の分類</dt><dd>${esc(r.occ.category) || '—'}</dd>
    <dt>対策</dt><dd>${esc(r.occ.fix)}</dd><dt>再発防止</dt><dd>${esc(r.occ.prevent)}</dd></dl>${byLine(r.occ.by, r.occ.at, 'HILANO')}`;
}
function occForm(r) {
  return `${r.returned && r.review ? `<div class="qr-ret"><b><i class="fa-solid fa-rotate-left"></i> HaLSpace からの差し戻し（${esc(r.review.by)}・${esc((r.review.at || '').slice(0, 16))}）</b>\n${esc(r.review.comment)}</div>` : ''}
    ${ta('occ_cause', '発生原因（なぜ間違えたか）', r.occ.cause, 'なぜ起きたかを具体的に。「確認不足」だけでは差し戻しになります')}
    ${sel('occ_category', '原因の分類', OCC, r.occ.category)}
    ${ta('occ_fix', '対策（今回の修正内容）', r.occ.fix)}
    ${ta('occ_prevent', '再発防止策', r.occ.prevent, '誰が・いつ・何をするか分かるように')}
    <div class="qr-acts"><button class="btn btn-outline btn-sm" data-act="save"><i class="fa-regular fa-floppy-disk"></i> 下書き保存</button>
      <button class="btn btn-primary btn-sm" data-act="submit"><i class="fa-solid fa-paper-plane"></i> HaLSpace へ提出</button></div>`;
}
function reviewView(r) {
  if (!r.review || r.review.ok === null || r.review.ok === undefined) {
    return r.stage === 2 && r.review ? '<p class="qr-note">HILANO が再提出しました。確認待ちです。</p>' : '<p class="qr-note">HILANO の入力後に確認します</p>';
  }
  return r.review.ok
    ? `<div class="qr-ok"><b><i class="fa-solid fa-check"></i> 確認OK</b>（${esc(r.review.by)}・${esc((r.review.at || '').slice(0, 16))}）${r.review.comment ? '\n' + esc(r.review.comment) : ''}</div>`
    : `<div class="qr-ret"><b><i class="fa-solid fa-rotate-left"></i> 差し戻し</b>（${esc(r.review.by)}・${esc((r.review.at || '').slice(0, 16))}）\n${esc(r.review.comment)}</div>`;
}
function reviewForm() {
  return `<p class="qr-note" style="margin-bottom:8px">① の内容を確認し、原因が具体的か・再発防止が実行できる内容かを見てください。</p>
    ${ta('comment', 'コメント（差し戻す場合は理由を必ず）', '')}
    <div class="qr-acts"><button class="btn btn-outline btn-sm" data-act="return" style="color:var(--danger)"><i class="fa-solid fa-rotate-left"></i> 差し戻す</button>
      <button class="btn btn-success btn-sm" data-act="submit"><i class="fa-solid fa-check"></i> 確認OK</button></div>`;
}
function outView(r) {
  if (!r.out.cause) return '<p class="qr-note">② 確認OK の後に入力します</p>';
  return `<dl class="qr-kv"><dt>流出原因</dt><dd>${esc(r.out.cause)}</dd><dt>原因の分類</dt><dd>${esc(r.out.category) || '—'}</dd><dt>再発防止</dt><dd>${esc(r.out.prevent)}</dd></dl>${byLine(r.out.by, r.out.at, 'HaLSpace')}`;
}
function outForm(r) {
  return `${ta('out_cause', '流出原因（なぜ検査で見つけられなかったか）', r.out.cause)}
    ${sel('out_category', '原因の分類', OUT, r.out.category)}
    ${ta('out_prevent', '検査工程の再発防止策', r.out.prevent)}
    <div class="qr-acts"><button class="btn btn-outline btn-sm" data-act="save"><i class="fa-regular fa-floppy-disk"></i> 下書き保存</button>
      <button class="btn btn-primary btn-sm" data-act="submit"><i class="fa-solid fa-arrow-right"></i> 保存して ④ まとめへ</button></div>`;
}
const CUST_LABELS = [['cust_cause', 'cause', '3. 発生原因'], ['cust_outflow', 'outflow', '4. 流出原因'], ['cust_fix', 'fix', '5. 対策'],
  ['cust_prevent_modeling', 'prevent_modeling', '6-(1) 再発防止策（モデリング工程）'], ['cust_prevent_inspection', 'prevent_inspection', '6-(2) 再発防止策（検査工程）'], ['cust_verify', 'verify', '7. 確認結果']];
function custView(r) {
  if (!r.cust.cause && !r.cust.verify) return '<p class="qr-note">③ の後に、お客様向けの文面にまとめます</p>';
  return `<dl class="qr-kv">${CUST_LABELS.map(([, k, l]) => `<dt>${l.replace(/^[\d().-]+\s*/, '')}</dt><dd>${esc(r.cust[k]) || '—'}</dd>`).join('')}</dl>`;
}
function custForm(r) {
  const ref = (who, label, v) => `<div class="qr-ref ${who}"><b>${label}（${WHO[who]}の原文）</b>${esc(v) || '—'}</div>`;
  const refs = { cust_cause: ref('lcz', '発生原因', r.occ.cause), cust_outflow: ref('hal', '流出原因', r.out.cause),
    cust_prevent_modeling: ref('lcz', '再発防止', r.occ.prevent), cust_prevent_inspection: ref('hal', '再発防止', r.out.prevent) };
  return `<button class="btn qr-draft btn-sm" data-draft type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> ①③の内容から下書きを作る（空欄だけ）</button>
    <p class="qr-note" style="margin:-4px 0 10px">お客様向けに言い回しを整えてください（社内用語・担当者名は書かない）</p>
    ${CUST_LABELS.map(([f, k, l]) => (refs[f] ?? '') + ta(f, l, r.cust[k])).join('')}
    <div class="qr-acts"><button class="btn btn-outline btn-sm" data-act="save"><i class="fa-regular fa-floppy-disk"></i> 下書き保存</button>
      <button class="btn btn-primary btn-sm" data-act="submit"><i class="fa-solid fa-check"></i> 対策書を確定</button></div>`;
}
function submitForm(r) {
  return `<p class="qr-note" style="margin-bottom:8px">宛先: <b style="color:var(--text)">${esc(clientName(r))} 御中</b>${r.reporter_name ? `（${esc(r.reporter_name)} 様）` : ''}</p>
    <div class="qr-fld" style="max-width:220px"><label>提出日</label><input class="form-input" type="date" data-f="submitted_on" value="${today()}"></div>
    <div class="qr-acts" style="justify-content:flex-start"><button class="btn btn-blue btn-sm" data-open-report type="button"><i class="fa-regular fa-file-lines"></i> 対策書を開く / 印刷</button>
      <button class="btn btn-success btn-sm" data-act="submit"><i class="fa-solid fa-paper-plane"></i> 提出済みにする</button></div>`;
}
function submittedView(r) {
  return `<div class="qr-ok" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span><i class="fa-solid fa-circle-check"></i> ${fmtJa(r.submitted_on)} に提出済み</span>
    <button class="btn btn-outline btn-sm" data-open-report type="button"><i class="fa-regular fa-file-lines"></i> 対策書</button></div>`;
}

/* ステップの保存・進行 */
function bindStep(root, vs) {
  root.querySelectorAll('[data-open-report]').forEach(b => b.onclick = () => $('dOpenReport').click());
  root.querySelectorAll('[data-draft]').forEach(b => b.onclick = () => {
    const d = draftFromSteps(CUR);
    Object.entries(d).forEach(([k, v]) => { const el = root.querySelector(`[data-f="${k}"]`); if (el && !el.value.trim()) el.value = v; });
    renderPaperPreview();
    showToast('空欄に ①③ の内容を転記しました', 'success');
  });
  root.querySelectorAll('[data-f^="cust_"]').forEach(el => el.addEventListener('input', renderPaperPreview));
  root.querySelectorAll('[data-act]').forEach(btn => btn.onclick = async () => {
    const action = btn.dataset.act;
    const body = { step: vs, action };
    root.querySelectorAll('[data-f]').forEach(el => { body[el.dataset.f] = el.value; });
    if (action === 'return' && !(body.comment || '').trim()) { showToast('差し戻す理由を入力してください', 'danger'); return; }
    const confirmMsg = { 1: 'HaLSpace へ提出します。よろしいですか？', 4: '対策書を確定します。よろしいですか？', 5: '提出済みにします。よろしいですか？' };
    if (action === 'submit' && confirmMsg[vs] && !confirm(confirmMsg[vs])) return;
    if (action === 'return' && !confirm('HILANO へ差し戻します。よろしいですか？')) return;
    root.querySelectorAll('[data-act]').forEach(b => b.disabled = true);
    try {
      const d = await api.post(`${BASE}/${CUR.id}/step`, body);
      if (!d) return;
      CUR = d.report; viewStep = null;
      syncSummary(CUR);
      renderDetail();
      showToast({ save: '下書きを保存しました', return: 'HILANO へ差し戻しました', submit: vs === 5 ? '提出済みにしました' : '次のステップへ進みました' }[action], 'success');
    } catch (e) {
      showToast(e.message, 'danger');
      if (/既に進んで/.test(e.message)) openDetail(CUR.id, false);
      root.querySelectorAll('[data-act]').forEach(b => b.disabled = false);
    }
  });
}
function draftFromSteps(r) {
  return {
    cust_cause: r.occ.cause ?? '', cust_outflow: r.out.cause ?? '',
    cust_fix: (r.occ.fix ?? '') + (r.redelivered_on ? `\n修正した3Dモデルを ${fmtJa(r.redelivered_on)} に再納品いたしました。` : ''),
    cust_prevent_modeling: r.occ.prevent ?? '', cust_prevent_inspection: r.out.prevent ?? '', cust_verify: '',
  };
}

/* 履歴（差し戻し前の ① も見られる） */
const ACT_LABEL = { create: '記録を作成', save: '下書き保存', submit: '提出', approve: '確認OK', return: '差し戻し' };
function renderHistory(r) {
  const h = $('dHist');
  const open = h.open;
  h.innerHTML = `<summary><i class="fa-solid fa-clock-rotate-left"></i> 履歴（${r.events.length}件）</summary><ol>${r.events.slice().reverse().map(e => {
    const snap = e.snapshot ? `<div class="snap">この時の発生原因: ${esc(e.snapshot.occ_cause)}\n再発防止: ${esc(e.snapshot.occ_prevent)}</div>` : '';
    const label = e.step ? `${NUM[e.step - 1]} ${e.step === 5 && e.action === 'submit' ? 'お客様へ提出' : ACT_LABEL[e.action] ?? e.action}` : ACT_LABEL[e.action] ?? e.action;
    return `<li><span class="at">${esc((e.at || '').slice(0, 16))}</span><b>${label}</b> — ${esc(e.by || '')}${e.comment ? `<div class="snap">${esc(e.comment)}</div>` : ''}${snap}</li>`;
  }).join('')}</ol>`;
  h.open = open;
}

/* ───────── 対策書（④でまとめた文面だけを載せる） ───────── */
function paperHtml(r, custOverride) {
  const c = custOverride ?? r.cust ?? {};
  const P = v => v ? esc(v) : '<span class="ph">（④ まとめで作成）</span>';
  const d = firstImg(r, 'defect'), f = firstImg(r, 'fixed');
  const imgs = d || f ? `<div class="imgs">${d ? `<figure>${shotHtml(d, false)}<figcaption>図1 不具合箇所</figcaption></figure>` : '<div></div>'}${f ? `<figure>${shotHtml(f, false)}<figcaption>図2 修正後</figcaption></figure>` : ''}</div>` : '';
  return `<div class="qr-paper">
    <div class="doc-top"><span>文書番号：${esc(r.no)}</span><span>提出日：${fmtJa(r.submitted_on || today())}</span></div>
    <h1>不具合対策書</h1>
    <div class="to">${esc(r.client?.name ?? '　　　　　　　　')}　御中</div>
    <div class="from">株式会社HaLSpace<br>SOLID 3Dモデリングサービス</div>
    <p class="lead">平素より SOLID をご利用いただき、誠にありがとうございます。
このたびは納品物に不具合があり、多大なるご迷惑をおかけしましたことを深くお詫び申し上げます。下記のとおり原因と対策をご報告いたします。</p>
    <table>
      <tr><th>件名</th><td>${esc(r.title)}</td></tr>
      <tr><th>対象物件</th><td>${r.project ? `${esc(r.project.code)}　${esc(r.project.title)}` : '—'}</td></tr>
      <tr><th>納品日 / ご指摘日</th><td>${fmtJa(r.delivered_on) || '—'} / ${fmtJa(r.found_on)}</td></tr>
      <tr><th>再納品日</th><td>${fmtJa(r.redelivered_on) || '—'}</td></tr>
    </table>
    <h2>1. 発生事象</h2><p>${esc(r.symptom)}</p>${imgs}
    <h2>2. 影響範囲</h2><p>${esc(r.impact) || '—'}</p>
    <h2>3. 発生原因</h2><p>${P(c.cause)}</p>
    <h2>4. 流出原因</h2><p>${P(c.outflow)}</p>
    <h2>5. 対策</h2><p>${P(c.fix)}</p>
    <h2>6. 再発防止策</h2><h3>(1) モデリング工程</h3><p>${P(c.prevent_modeling)}</p><h3>(2) 検査工程</h3><p>${P(c.prevent_inspection)}</p>
    <h2>7. 確認結果</h2><p>${P(c.verify)}</p>
    <div class="sign"><div>承認<span></span></div><div>確認<span></span></div><div>作成<span></span></div></div>
    <p class="end">以上</p></div>`;
}
/* ④ の入力中はフォームの値をそのままプレビューに使う */
function renderPaperPreview() {
  const f = $('dForm');
  const inForm = f.querySelector('[data-f^="cust_"]');
  const cust = inForm ? Object.fromEntries(CUST_LABELS.map(([fk, k]) => [k, f.querySelector(`[data-f="${fk}"]`)?.value.trim() ?? ''])) : null;
  $('dPaper').innerHTML = paperHtml(CUR, cust);
  hydrateImages($('dPaper'));
}
async function openReports(ids, title, preloaded) {
  let list = preloaded;
  if (!list) {
    try { list = (await Promise.all(ids.map(id => api.get(`${BASE}/${id}`)))).map(d => d.report); }
    catch (e) { showToast(e.message, 'danger'); return; }
  }
  // 1件を開いているときは、④入力中の文面も含めて今の画面の内容で出す
  const cust = list.length === 1 && CUR && list[0].id === CUR.id && $('dForm').querySelector('[data-f^="cust_"]')
    ? Object.fromEntries(CUST_LABELS.map(([fk, k]) => [k, $('dForm').querySelector(`[data-f="${fk}"]`)?.value.trim() ?? ''])) : null;
  $('rPaper').innerHTML = list.map(r => paperHtml(r, cust)).join('');
  $('rTitle').innerHTML = `<i class="fa-regular fa-file-lines"></i> ${esc(title)}`;
  $('report').classList.add('open');
  document.body.style.overflow = 'hidden';
  hydrateImages($('rPaper'));
}
function closeReport() { $('report').classList.remove('open'); document.body.style.overflow = ''; }
$('rClose').onclick = closeReport;

async function deleteCurrent() {
  if (!confirm(`「${CUR.title}」を削除します。元に戻せません。よろしいですか？`)) return;
  try {
    await api.delete(`${BASE}/${CUR.id}`);
    REPORTS = REPORTS.filter(r => r.id !== CUR.id);
    showToast('削除しました', 'success');
    showList(true);
  } catch (e) { showToast(e.message, 'danger'); }
}

/* ───────── 起票・基本情報の編集 ───────── */
const modal = $('editModal'), form = $('editForm');
let editing = null;          // null = 新規
let pickedProject = null;
let pendingFiles = { defect: [], fixed: [] };   // 新規作成時に保存後まとめて送る画像
form.defect_type.innerHTML = '<option value="">選択してください</option>' + TYPES.map(t => `<option>${t}</option>`).join('');

function openEdit(r) {
  editing = r ?? null;
  pendingFiles = { defect: [], fixed: [] };
  form.reset();
  $('editTitle').textContent = r ? '基本情報を編集' : '不具合を記録';
  pickedProject = r?.project ? { id: r.project.id, code: r.project.code, title: r.project.title, client_company: r.client?.name } : null;
  if (r) {
    ['title', 'defect_type', 'reporter_name', 'found_on', 'delivered_on', 'redelivered_on', 'symptom', 'impact'].forEach(k => { form[k].value = r[k] ?? ''; });
  } else {
    form.found_on.value = today();
  }
  $('pjQ').value = '';
  $('pjList').innerHTML = '';
  renderPicked();
  renderEditImages();
  modal.classList.add('open');
  if (!r) searchProjects('');
}
function closeEdit() { modal.classList.remove('open'); }
modal.querySelectorAll('[data-close]').forEach(b => b.onclick = closeEdit);
$('btnNew').onclick = () => openEdit(null);

function renderPicked() {
  const p = pickedProject;
  $('pjPicked').innerHTML = p ? `<div class="picked"><span class="qr-pjcode">${esc(p.code)}</span><b>${esc(p.title)}</b><span class="qr-note">${esc(p.client_company ?? '')}</span>
    <button type="button" class="btn btn-ghost btn-sm" id="pjClear">変更</button></div>` : '';
  $('pjClear')?.addEventListener('click', () => { pickedProject = null; renderPicked(); searchProjects($('pjQ').value); });
  $('pjQ').closest('.qr-search').style.display = p ? 'none' : '';
  if (p) $('pjList').innerHTML = '';
}
let pjTimer = null, pjSeq = 0;
$('pjQ').addEventListener('input', () => { clearTimeout(pjTimer); pjTimer = setTimeout(() => searchProjects($('pjQ').value), 250); });
async function searchProjects(q) {
  const seq = ++pjSeq;
  try {
    const d = await api.get(`${BASE}/projects?q=${encodeURIComponent(q.trim())}`);
    if (seq !== pjSeq || pickedProject) return;
    $('pjList').innerHTML = d.projects.map(p => `<button type="button" data-id="${p.id}"><span class="qr-pjcode">${esc(p.code)}</span> <b>${esc(p.title)}</b>
      <div class="sub">${esc(p.client_company ?? '')}${p.client_name ? ' · ' + esc(p.client_name) : ''}${p.delivered_on ? ' · 納品 ' + esc(p.delivered_on) : ''}</div></button>`).join('')
      || '<div class="qr-empty" style="padding:14px">該当する物件がありません</div>';
    $('pjList').querySelectorAll('button').forEach(b => b.onclick = () => {
      const p = d.projects.find(x => x.id === +b.dataset.id);
      pickedProject = p;
      if (!form.delivered_on.value && p.delivered_on) form.delivered_on.value = p.delivered_on;
      renderPicked();
    });
  } catch (e) { $('pjList').innerHTML = `<div class="qr-empty" style="padding:14px">${esc(e.message)}</div>`; }
}

function renderEditImages() {
  modal.querySelectorAll('.qr-imgs').forEach(box => {
    const kind = box.dataset.kind;
    const saved = editing ? editing.images.filter(i => i.kind === kind) : [];
    const pend = pendingFiles[kind];
    box.innerHTML = saved.map(i => `<div class="qr-shot" data-img="${esc(i.url)}"><button type="button" class="rm" data-rm="${i.id}" title="削除"><i class="fa-solid fa-xmark"></i></button></div>`).join('')
      + pend.map((f, idx) => `<div class="qr-shot"><img src="${URL.createObjectURL(f)}" alt=""><button type="button" class="rm" data-rmp="${idx}" title="削除"><i class="fa-solid fa-xmark"></i></button></div>`).join('')
      + `<label class="add"><i class="fa-solid fa-plus"></i>追加<input type="file" accept="image/*" multiple hidden></label>`;
    box.querySelector('input[type=file]').onchange = async e => {
      const files = [...e.target.files];
      if (!files.length) return;
      if (editing) {
        await uploadImages(editing.id, kind, files);
      } else {
        pendingFiles[kind].push(...files);
      }
      renderEditImages();
    };
    box.querySelectorAll('[data-rmp]').forEach(b => b.onclick = () => { pendingFiles[kind].splice(+b.dataset.rmp, 1); renderEditImages(); });
    box.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
      if (!confirm('この画像を削除しますか？')) return;
      try {
        const d = await api.delete(`${BASE}/${editing.id}/images/${b.dataset.rm}`);
        editing = CUR = d.report; syncSummary(CUR); renderEditImages(); renderDetail();
      } catch (err) { showToast(err.message, 'danger'); }
    });
    hydrateImages(box);
  });
}
async function uploadImages(id, kind, files) {
  const fd = new FormData();
  fd.append('kind', kind);
  files.forEach(f => fd.append('images[]', f));
  try {
    const d = await apiFetchForm(`${BASE}/${id}/images`, fd);
    if (d?.report) {
      if (editing && editing.id === id) editing = d.report;
      if (CUR && CUR.id === id) { CUR = d.report; renderDetail(); }
      syncSummary(d.report);
    }
    return d?.report;
  } catch (e) { showToast('画像の保存に失敗しました: ' + e.message, 'danger'); return null; }
}

$('editSave').onclick = async () => {
  if (!pickedProject) { showToast('対象物件を選んでください', 'danger'); return; }
  if (!form.reportValidity()) return;
  const body = { project_id: pickedProject.id };
  ['title', 'defect_type', 'reporter_name', 'found_on', 'delivered_on', 'redelivered_on', 'symptom', 'impact'].forEach(k => { body[k] = form[k].value.trim() || null; });
  const btn = $('editSave');
  btn.disabled = true;
  try {
    let d;
    if (editing) {
      d = await api.patch(`${BASE}/${editing.id}`, body);
    } else {
      d = await api.post(BASE, body);
      for (const kind of ['defect', 'fixed']) {
        if (pendingFiles[kind].length) {
          const up = await uploadImages(d.report.id, kind, pendingFiles[kind]);
          if (up) d.report = up;
        }
      }
    }
    syncSummary(d.report);
    closeEdit();
    showToast(editing ? '保存しました' : `${d.report.no} を記録しました`, 'success');
    openDetail(d.report.id, !editing);
  } catch (e) {
    showToast(e.message, 'danger');
  } finally {
    btn.disabled = false;
  }
};

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.querySelector('.qr-lightbox')) return document.querySelector('.qr-lightbox').remove();
  if ($('report').classList.contains('open')) return closeReport();
  if (modal.classList.contains('open')) closeEdit();
});

/* ───────── 起動 ───────── */
(async () => {
  if (!(await loadList())) return;
  $('qrMe').innerHTML = `<span class="qr-me ${SIDE}"><i class="fa-solid ${SIDE === 'lcz' ? 'fa-user-gear' : 'fa-user-tie'}"></i>${WHO[SIDE]}</span>`;
  $('btnNew').style.display = '';
  const id = +new URLSearchParams(location.search).get('id');
  if (id) openDetail(id, false); else showList(false);
})();
