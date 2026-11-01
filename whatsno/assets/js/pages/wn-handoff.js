'use strict';
/* What'sNo 手渡し（特定の人へ期限付きでファイルを渡す・受け取り箱）
   ダッシュボードとファイル詳細の両方から使う。モーダルの DOM はここで差し込むので、
   各画面の HTML には置かない。

   - 渡す: wnOpenHandoffModal(files, { onFallbackEmail })   files = [{ id, name }]
   - 受け取り箱・渡したもの: wnShowHandoffView('inbox' | 'sent')（ダッシュボードのみ）
   - バッジ: wnHandoffRefreshBadge() */

const WN_HO_EXPIRES = [1, 3, 7, 30];

/* 開いたときの ?view=inbox|sent（届いたお知らせメールのリンク）。他の初期化が URL を書き換える前に控える */
const WN_HO_START_VIEW = new URLSearchParams(location.search).get('view');

function wnHoEsc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function wnHoSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function wnHoAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)    return 'たった今';
  if (diff < 3600)  return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  return `${Math.floor(diff / 86400)}日前`;
}

function wnHoDateTime(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* 残り時間（「あと3日」「あと5時間」） */
function wnHoLeft(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return '期限切れ';
  const h = Math.floor(ms / 3600000);
  if (h < 24) return h <= 0 ? 'まもなく期限' : `あと${h}時間`;
  return `あと${Math.ceil(h / 24)}日`;
}

function wnHoKindIcon(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'fa-file-pdf';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff'].includes(ext)) return 'fa-file-image';
  if (['mp4', 'mov', 'webm', 'm4v', 'avi'].includes(ext)) return 'fa-file-video';
  if (['xlsx', 'xls', 'xlsm', 'csv'].includes(ext)) return 'fa-file-excel';
  if (['docx', 'doc', 'docm'].includes(ext)) return 'fa-file-word';
  if (['pptx', 'ppt', 'pptm'].includes(ext)) return 'fa-file-powerpoint';
  if (['dxf', 'dwg'].includes(ext)) return 'fa-compass-drafting';
  if (['zip', 'rar', '7z'].includes(ext)) return 'fa-file-zipper';
  return 'fa-file';
}

/* ════════════════════════════════
   渡す（送信モーダル）
   ════════════════════════════════ */
const wnHo = {
  files: [],
  picked: [],          // [{ key, id?, email?, name, company? }]
  colleagues: null,    // 社内の宛先候補（初回だけ取得）
  expires: 7,
  onFallbackEmail: null,
};

function wnHoEnsureModal() {
  if (document.getElementById('wnHoModal')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
<div class="modal-overlay hidden" id="wnHoModal">
  <div class="modal wn-ho-modal" role="dialog" aria-labelledby="wnHoTitle">
    <div class="modal-header">
      <span class="modal-title" id="wnHoTitle"><i class="fa-solid fa-hand-holding" style="color:var(--accent);"></i> 人に渡す</span>
      <button type="button" class="modal-close" id="wnHoClose" aria-label="閉じる"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="wn-ho-files" id="wnHoFiles"></div>

    <div class="wn-ho-label">渡す相手</div>
    <div class="wn-ho-chips" id="wnHoChips"></div>
    <div class="wn-ho-pick">
      <input type="text" class="form-input" id="wnHoSearch" placeholder="社内の人を名前で探す" autocomplete="off">
      <div class="wn-ho-suggest hidden" id="wnHoSuggest"></div>
    </div>
    <details class="wn-ho-other" id="wnHoOther">
      <summary>他社の方に渡す（メールアドレスで探す）</summary>
      <div class="wn-ho-email-row">
        <input type="email" class="form-input" id="wnHoEmail" placeholder="name@example.com" autocomplete="off" inputmode="email">
        <button type="button" class="btn btn-outline btn-sm" id="wnHoEmailBtn">探す</button>
      </div>
      <div class="wn-ho-note" id="wnHoEmailMsg">HaLSpace で What'sNo を使っている方に渡せます。</div>
    </details>

    <label class="wn-ho-label" for="wnHoMsg">ひとこと（任意）</label>
    <textarea class="form-textarea wn-ho-msg" id="wnHoMsg" rows="3" maxlength="500" placeholder="例: 明日の打ち合わせ用です。確認お願いします"></textarea>

    <div class="wn-ho-label">受け取り期限</div>
    <div class="wn-ho-seg" id="wnHoExpires">
      ${WN_HO_EXPIRES.map(d => `<button type="button" data-days="${d}">${d}日</button>`).join('')}
    </div>
    <div class="wn-ho-note">期限を過ぎると相手は開けなくなります。相手が「保存」したものは相手のファイルとして残ります。</div>

    <div class="modal-footer">
      <button type="button" class="btn btn-outline" id="wnHoCancel">キャンセル</button>
      <button type="button" class="btn btn-accent" id="wnHoSend" disabled><i class="fa-solid fa-paper-plane"></i> 渡す</button>
    </div>
  </div>
</div>

<div class="modal-overlay hidden" id="wnHoPreview">
  <div class="modal wn-ho-preview" role="dialog" aria-labelledby="wnHoPreviewTitle">
    <div class="modal-header">
      <span class="modal-title wn-ho-preview-title" id="wnHoPreviewTitle"></span>
      <button type="button" class="modal-close" id="wnHoPreviewClose" aria-label="閉じる"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="wn-ho-preview-body" id="wnHoPreviewBody"></div>
    <div class="modal-footer">
      <a class="btn btn-outline" id="wnHoPreviewDl" target="_blank" rel="noopener"><i class="fa-solid fa-download"></i> ダウンロード</a>
      <button type="button" class="btn btn-accent" id="wnHoPreviewSave"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
    </div>
  </div>
</div>`;
  document.body.append(...wrap.children);

  const close = () => document.getElementById('wnHoModal').classList.add('hidden');
  document.getElementById('wnHoClose').addEventListener('click', close);
  document.getElementById('wnHoCancel').addEventListener('click', close);
  document.getElementById('wnHoModal').addEventListener('click', e => { if (e.target.id === 'wnHoModal') close(); });

  document.getElementById('wnHoExpires').addEventListener('click', e => {
    const b = e.target.closest('button[data-days]');
    if (!b) return;
    wnHo.expires = Number(b.dataset.days);
    wnHoRenderExpires();
  });

  const search = document.getElementById('wnHoSearch');
  search.addEventListener('input', wnHoRenderSuggest);
  search.addEventListener('focus', wnHoRenderSuggest);
  search.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.querySelector('#wnHoSuggest .wn-ho-sg-item')?.click();
    }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.wn-ho-pick')) document.getElementById('wnHoSuggest')?.classList.add('hidden');
  });

  document.getElementById('wnHoEmailBtn').addEventListener('click', wnHoResolveEmail);
  document.getElementById('wnHoEmail').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); wnHoResolveEmail(); }
  });
  document.getElementById('wnHoSend').addEventListener('click', wnHoSubmit);

  const closePreview = () => {
    document.getElementById('wnHoPreview').classList.add('hidden');
    document.getElementById('wnHoPreviewBody').innerHTML = '';   // 動画を止める
  };
  document.getElementById('wnHoPreviewClose').addEventListener('click', closePreview);
  document.getElementById('wnHoPreview').addEventListener('click', e => { if (e.target.id === 'wnHoPreview') closePreview(); });
}

function wnOpenHandoffModal(files, { onFallbackEmail = null } = {}) {
  if (!files || !files.length) return;
  wnHoEnsureModal();
  wnHo.files = files;
  wnHo.picked = [];
  wnHo.expires = 7;
  wnHo.onFallbackEmail = onFallbackEmail;

  const names = files.slice(0, 5).map(f => `<div><i class="fa-solid ${wnHoKindIcon(f.name)}"></i> ${wnHoEsc(f.name)}</div>`).join('');
  const more  = files.length > 5 ? `<div class="wn-ho-more">ほか ${files.length - 5} 件</div>` : '';
  document.getElementById('wnHoFiles').innerHTML = names + more;
  document.getElementById('wnHoSearch').value = '';
  document.getElementById('wnHoEmail').value = '';
  document.getElementById('wnHoMsg').value = '';
  document.getElementById('wnHoOther').open = false;
  wnHoSetEmailMsg('HaLSpace で What\'sNo を使っている方に渡せます。');
  wnHoRenderChips();
  wnHoRenderExpires();
  document.getElementById('wnHoModal').classList.remove('hidden');

  if (!wnHo.colleagues) {
    wnHandoffRecipients().then(r => {
      wnHo.colleagues = r.ok ? (r.data || []) : [];
      if (document.activeElement?.id === 'wnHoSearch') wnHoRenderSuggest();
    });
  }
}

function wnHoRenderExpires() {
  document.querySelectorAll('#wnHoExpires button').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.days) === wnHo.expires);
  });
}

function wnHoRenderChips() {
  const el = document.getElementById('wnHoChips');
  if (!wnHo.picked.length) {
    el.innerHTML = '<span class="wn-ho-empty">まだ選んでいません</span>';
  } else {
    el.innerHTML = wnHo.picked.map((p, i) => `
      <span class="wn-ho-chip${p.email ? ' other' : ''}">
        <i class="fa-solid ${p.email ? 'fa-building' : 'fa-user'}"></i>
        ${wnHoEsc(p.name)}${p.company ? `<small>${wnHoEsc(p.company)}</small>` : ''}
        <button type="button" data-i="${i}" aria-label="${wnHoEsc(p.name)} を外す"><i class="fa-solid fa-xmark"></i></button>
      </span>`).join('');
    el.querySelectorAll('button[data-i]').forEach(b => b.addEventListener('click', () => {
      wnHo.picked.splice(Number(b.dataset.i), 1);
      wnHoRenderChips();
    }));
  }
  document.getElementById('wnHoSend').disabled = wnHo.picked.length === 0;
}

function wnHoRenderSuggest() {
  const box = document.getElementById('wnHoSuggest');
  const q = document.getElementById('wnHoSearch').value.trim().toLowerCase();
  if (wnHo.colleagues === null) {
    box.innerHTML = '<div class="wn-ho-sg-none"><i class="fa-solid fa-spinner fa-spin"></i> 読み込み中…</div>';
    box.classList.remove('hidden');
    return;
  }
  const pickedIds = new Set(wnHo.picked.filter(p => p.id).map(p => p.id));
  const list = wnHo.colleagues
    .filter(u => !pickedIds.has(u.id))
    .filter(u => !q || String(u.name).toLowerCase().includes(q))
    .slice(0, 30);
  box.innerHTML = list.length
    ? list.map(u => `<button type="button" class="wn-ho-sg-item" data-id="${u.id}"><i class="fa-solid fa-user"></i> ${wnHoEsc(u.name)}</button>`).join('')
    : `<div class="wn-ho-sg-none">${wnHo.colleagues.length ? '見つかりません' : '渡せる社内の方がいません'}</div>`;
  box.classList.remove('hidden');
  box.querySelectorAll('.wn-ho-sg-item').forEach(b => b.addEventListener('click', () => {
    const u = wnHo.colleagues.find(x => x.id === Number(b.dataset.id));
    if (!u) return;
    if (wnHo.picked.length >= 10) { wnShowToast('相手は一度に10人までです', 'warning'); return; }
    wnHo.picked.push({ key: `u${u.id}`, id: u.id, name: u.name });
    document.getElementById('wnHoSearch').value = '';
    wnHoRenderChips();
    box.classList.add('hidden');
  }));
}

function wnHoSetEmailMsg(text, kind = '', withFallback = false) {
  const el = document.getElementById('wnHoEmailMsg');
  el.className = `wn-ho-note${kind ? ' ' + kind : ''}`;
  el.textContent = text;
  if (withFallback && wnHo.onFallbackEmail) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wn-ho-linkbtn';
    b.textContent = 'メールで共有リンクを送る';
    const email = document.getElementById('wnHoEmail').value.trim();
    b.addEventListener('click', () => {
      document.getElementById('wnHoModal').classList.add('hidden');
      wnHo.onFallbackEmail(email);
    });
    el.append(' ', b);
  }
}

async function wnHoResolveEmail() {
  const input = document.getElementById('wnHoEmail');
  const email = input.value.trim();
  if (!email || !input.checkValidity()) {
    wnHoSetEmailMsg('メールアドレスを正しく入力してください', 'error');
    return;
  }
  if (wnHo.picked.some(p => p.email && p.email.toLowerCase() === email.toLowerCase())) {
    wnHoSetEmailMsg('すでに選んでいます');
    return;
  }
  if (wnHo.picked.length >= 10) { wnHoSetEmailMsg('相手は一度に10人までです', 'error'); return; }

  const btn = document.getElementById('wnHoEmailBtn');
  btn.disabled = true;
  const r = await wnHandoffResolve(email);
  btn.disabled = false;

  if (!r.ok) {
    const msg = r.status === 429
      ? '短い時間に何度も探したため、少し待ってからお試しください'
      : 'What\'sNo を使っている方が見つかりませんでした。';
    wnHoSetEmailMsg(msg, 'error', r.status !== 429);
    return;
  }
  const u = r.data;
  // 社内の人をメールで見つけた場合は、社内の宛先（ID）として扱う
  if (u.same_company) {
    if (!wnHo.picked.some(p => p.id === u.id)) wnHo.picked.push({ key: `u${u.id}`, id: u.id, name: u.name });
  } else {
    wnHo.picked.push({ key: `e${email}`, email, name: u.name, company: u.company_name });
  }
  input.value = '';
  wnHoSetEmailMsg(`${u.name} さん${u.company_name ? `（${u.company_name}）` : ''}を追加しました`, 'ok');
  wnHoRenderChips();
}

async function wnHoSubmit() {
  const btn = document.getElementById('wnHoSend');
  if (!wnHo.picked.length) return;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 渡しています…';

  const r = await wnHandoffSend({
    fileIds: wnHo.files.map(f => f.id),
    recipientIds: wnHo.picked.filter(p => p.id).map(p => p.id),
    recipientEmails: wnHo.picked.filter(p => p.email).map(p => p.email),
    message: document.getElementById('wnHoMsg').value.trim(),
    expiresDays: wnHo.expires,
  });

  btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> 渡す';
  btn.disabled = false;
  if (!r.ok) {
    wnShowToast(wnHoEsc(r.message), 'danger');
    return;
  }
  document.getElementById('wnHoModal').classList.add('hidden');
  const names = (r.data?.recipients || []).map(x => x.name);
  const who = names.length > 2 ? `${names.slice(0, 2).join('・')} ほか${names.length - 2}人` : names.join('・');
  wnShowToast(`${wnHoEsc(who)} さんに渡しました`, 'success');
  if (document.body.classList.contains('wn-ho-mode') && wnHoView.mode === 'sent') wnHoRenderPanel();
}

/* ════════════════════════════════
   受け取り箱 / 渡したもの（ダッシュボード）
   ════════════════════════════════ */
const wnHoView = { mode: 'inbox', prevTitle: null, prevActive: null, mailOn: true };

function wnShowHandoffView(mode) {
  const panel = document.getElementById('handoffPanel');
  if (!panel) return;
  wnHoEnsureModal();
  if (typeof selectMode !== 'undefined' && selectMode && typeof toggleSelectMode === 'function') toggleSelectMode();

  const titleEl = document.getElementById('topBarTitle');
  if (!document.body.classList.contains('wn-ho-mode')) {
    wnHoView.prevTitle  = titleEl?.textContent ?? null;
    wnHoView.prevActive = document.querySelector('.sidebar-nav a.active')?.id ?? null;
  }
  wnHoView.mode = mode === 'sent' ? 'sent' : 'inbox';
  document.body.classList.add('wn-ho-mode');
  panel.classList.remove('hidden');

  document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
  document.getElementById(wnHoView.mode === 'sent' ? 'navSent' : 'navInbox')?.classList.add('active');
  if (titleEl) titleEl.textContent = wnHoView.mode === 'sent' ? '渡したもの' : '受け取り箱';
  if (typeof setBottomActive === 'function') setBottomActive('bnInbox');

  wnHoRenderPanel();
}

/* 一覧（マイファイル等）へ戻るとき。ナビ側が自分で active とタイトルを付け直す */
function wnHideHandoffView() {
  if (!document.body.classList.contains('wn-ho-mode')) return;
  document.body.classList.remove('wn-ho-mode');
  document.getElementById('handoffPanel')?.classList.add('hidden');
  document.getElementById('navInbox')?.classList.remove('active');
  document.getElementById('navSent')?.classList.remove('active');
}

/* 検索を打ったときなど、ナビを経由せずに一覧へ戻る */
function wnLeaveHandoffViewToFiles() {
  if (!document.body.classList.contains('wn-ho-mode')) return;
  wnHideHandoffView();
  const titleEl = document.getElementById('topBarTitle');
  if (titleEl && wnHoView.prevTitle != null) titleEl.textContent = wnHoView.prevTitle;
  if (wnHoView.prevActive) document.getElementById(wnHoView.prevActive)?.classList.add('active');
}

async function wnHoRenderPanel() {
  const panel = document.getElementById('handoffPanel');
  if (!panel) return;
  const mode = wnHoView.mode;

  panel.innerHTML = `
    <div class="wn-ho-head">
      <div class="wn-ho-tabs" role="tablist">
        <button type="button" role="tab" data-mode="inbox" class="${mode === 'inbox' ? 'active' : ''}"><i class="fa-solid fa-inbox"></i> 受け取り箱</button>
        <button type="button" role="tab" data-mode="sent" class="${mode === 'sent' ? 'active' : ''}"><i class="fa-solid fa-paper-plane"></i> 渡したもの</button>
      </div>
      ${mode === 'inbox' ? `
      <label class="wn-ho-mail-toggle" title="手渡しが届いたときにメールでも知らせます">
        <input type="checkbox" id="wnHoMailToggle" ${wnHoView.mailOn ? 'checked' : ''}> メールで知らせる
      </label>` : ''}
    </div>
    <div class="wn-ho-list" id="wnHoList"><div class="wn-ho-loading"><i class="fa-solid fa-spinner fa-spin"></i></div></div>`;

  panel.querySelectorAll('.wn-ho-tabs button').forEach(b => b.addEventListener('click', () => wnShowHandoffView(b.dataset.mode)));
  document.getElementById('wnHoMailToggle')?.addEventListener('change', async e => {
    const on = e.target.checked;
    const r = await wnHandoffSetMail(on);
    if (!r.ok) { e.target.checked = !on; wnShowToast('設定を変更できませんでした', 'danger'); return; }
    wnHoView.mailOn = on;
    wnShowToast(on ? '届いたらメールでも知らせます' : 'メールでのお知らせを止めました', 'success');
  });

  if (mode === 'inbox') await wnHoRenderInbox();
  else await wnHoRenderSent();
}

/* 同じ操作で届いた物（batch）をひとまとまりにする。並びは届いた順のまま */
function wnHoGroup(items) {
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.batch_id)) map.set(it.batch_id, []);
    map.get(it.batch_id).push(it);
  }
  return [...map.values()];
}

async function wnHoRenderInbox() {
  const list = document.getElementById('wnHoList');
  const r = await wnHandoffInbox();
  if (wnHoView.mode !== 'inbox' || !document.getElementById('wnHoList')) return;
  if (!r.ok) { list.innerHTML = `<div class="wn-ho-empty-box">${wnHoEsc(r.message)}</div>`; return; }
  wnHandoffSetBadge(r.unopened || 0);

  const items = r.data || [];
  if (!items.length) {
    list.innerHTML = `
      <div class="wn-ho-empty-box">
        <i class="fa-solid fa-inbox"></i>
        <p>届いているファイルはありません</p>
        <small>社内や取引先の方から渡されたファイルがここに届きます</small>
      </div>`;
    return;
  }

  list.innerHTML = wnHoGroup(items).map(group => {
    const g = group[0];
    const from = g.from || {};
    const company = !from.same_company && from.company_name ? `<span class="wn-ho-company">${wnHoEsc(from.company_name)}</span>` : '';
    return `
      <section class="wn-ho-batch">
        <header class="wn-ho-batch-head">
          <span class="wn-ho-avatar">${wnHoEsc(String(from.name || '?').slice(0, 1))}</span>
          <div class="wn-ho-batch-who">
            <div><b>${wnHoEsc(from.name)}</b> さんから ${company}</div>
            <small>${wnHoAgo(g.created_at)}</small>
          </div>
        </header>
        ${g.message ? `<div class="wn-ho-bubble">${wnHoEsc(g.message)}</div>` : ''}
        <div class="wn-ho-items">${group.map(wnHoInboxItemHtml).join('')}</div>
      </section>`;
  }).join('');

  wnHoBindThumbs(list);
  list.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
    const it = items.find(x => x.id === Number(b.dataset.id));
    if (!it) return;
    if (b.dataset.act === 'open')    wnHoOpenPreview(it);
    if (b.dataset.act === 'save')    wnHoDoSave(it, b);
    if (b.dataset.act === 'dismiss') wnHoDoDismiss(it);
    if (b.dataset.act === 'goto')    location.href = `file-detail.html?id=${encodeURIComponent(it.saved_file_id)}`;
  }));
}

function wnHoInboxItemHtml(it) {
  const f = it.file || {};
  const active = it.state === 'active';
  const unopened = active && !it.opened_at;
  let status;
  if (it.state === 'revoked')      status = '<span class="wn-ho-st muted">送り主が取り消しました</span>';
  else if (it.state === 'expired') status = '<span class="wn-ho-st muted">期限切れ</span>';
  else if (it.saved_at)            status = '<span class="wn-ho-st ok"><i class="fa-solid fa-check"></i> 保存済み</span>';
  else                             status = `<span class="wn-ho-st${unopened ? ' new' : ''}">${unopened ? '未開封・' : ''}${wnHoLeft(it.expires_at)}</span>`;

  const thumb = active
    ? `<img data-ho-thumb src="${wnHoEsc(wnHandoffFileUrl('thumb', f.id, it.id) + '&g=' + (typeof WN_THUMB_GEN !== 'undefined' ? WN_THUMB_GEN : ''))}" alt="" loading="lazy">`
    : '';

  let acts = '';
  if (active) {
    acts += `<button type="button" class="btn btn-outline btn-sm" data-act="open" data-id="${it.id}"><i class="fa-solid fa-eye"></i> 開く</button>`;
    acts += it.saved_at
      ? `<button type="button" class="btn btn-outline btn-sm" data-act="goto" data-id="${it.id}"><i class="fa-solid fa-arrow-right"></i> 保存先</button>`
      : `<button type="button" class="btn btn-accent btn-sm" data-act="save" data-id="${it.id}"><i class="fa-solid fa-floppy-disk"></i> 保存</button>`;
  } else if (it.saved_at && it.saved_file_id) {
    acts += `<button type="button" class="btn btn-outline btn-sm" data-act="goto" data-id="${it.id}"><i class="fa-solid fa-arrow-right"></i> 保存先</button>`;
  }
  acts += `<button type="button" class="wn-ho-x" data-act="dismiss" data-id="${it.id}" title="受け取り箱から消す" aria-label="受け取り箱から消す"><i class="fa-solid fa-xmark"></i></button>`;

  return `
    <div class="wn-ho-item${unopened ? ' unopened' : ''}${active ? '' : ' inactive'}">
      <div class="wn-ho-thumb"><i class="fa-solid ${wnHoKindIcon(f.file_name)}"></i>${thumb}</div>
      <div class="wn-ho-main">
        <div class="wn-ho-name" title="${wnHoEsc(f.file_name)}">${wnHoEsc(f.file_name)}</div>
        <div class="wn-ho-sub">${f.file_size != null ? `${wnHoSize(f.file_size)} · ` : ''}${status}</div>
      </div>
      <div class="wn-ho-acts">${acts}</div>
    </div>`;
}

/* サムネが無い（404）ときは種類アイコンのまま */
function wnHoBindThumbs(root) {
  root.querySelectorAll('img[data-ho-thumb]').forEach(img => {
    img.addEventListener('load',  () => img.classList.add('loaded'));
    img.addEventListener('error', () => img.remove());
  });
}

async function wnHoOpenPreview(it) {
  const f = it.file || {};
  const ext  = String(f.file_name || '').split('.').pop().toLowerCase();
  const mime = f.mime_type || '';
  const body = document.getElementById('wnHoPreviewBody');
  document.getElementById('wnHoPreviewTitle').textContent = f.file_name || '';
  document.getElementById('wnHoPreviewDl').href = wnHandoffFileUrl('download', f.id, it.id);
  const saveBtn = document.getElementById('wnHoPreviewSave');
  saveBtn.style.display = it.saved_at ? 'none' : '';
  saveBtn.disabled = false;
  saveBtn.onclick = () => wnHoDoSave(it, saveBtn, true);
  body.innerHTML = '<div class="wn-ho-loading"><i class="fa-solid fa-spinner fa-spin fa-2x"></i></div>';
  document.getElementById('wnHoPreview').classList.remove('hidden');

  const isImage = mime.startsWith('image/') && !['heic', 'heif', 'tif', 'tiff'].includes(ext);
  const isVideo = mime.startsWith('video/') || ['mp4', 'mov', 'webm', 'm4v'].includes(ext);
  const isPdf   = ext === 'pdf' || mime === 'application/pdf';

  if (!isImage && !isVideo && !isPdf) {
    wnHandoffOpen(it.id).then(() => wnHoAfterChange());
    body.innerHTML = `
      <div class="wn-ho-noprev">
        <i class="fa-solid ${wnHoKindIcon(f.file_name)}"></i>
        <p>このファイルはここでは表示できません。</p>
        <small>「ダウンロード」で手元のアプリで開くか、「保存」して自分のファイルとして開いてください。</small>
      </div>`;
    return;
  }

  // view は開封記録も付ける
  const res = await wnFetch(`/wn/files/${f.id}/view?handoff=${encodeURIComponent(it.id)}`);
  let url = null;
  if (res && res.ok) { try { url = (await res.json()).url; } catch {} }
  if (!url) {
    body.innerHTML = '<div class="wn-ho-noprev"><i class="fa-solid fa-triangle-exclamation"></i><p>表示できませんでした。期限が切れたか、送り主が取り消した可能性があります。</p></div>';
    wnHoAfterChange();
    return;
  }
  if (isImage) {
    body.innerHTML = '';
    const img = document.createElement('img');
    img.src = url;
    img.alt = f.file_name || '';
    body.appendChild(img);
  } else if (isVideo) {
    body.innerHTML = '';
    const v = document.createElement('video');
    v.src = url; v.controls = true; v.playsInline = true;
    body.appendChild(v);
  } else {
    body.innerHTML = '';
    const fr = document.createElement('iframe');
    fr.src = url;
    fr.title = f.file_name || '';
    body.appendChild(fr);
  }
  wnHoAfterChange();
}

async function wnHoDoSave(it, btn, fromPreview = false) {
  btn.disabled = true;
  const label = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 保存中…';
  const r = await wnHandoffSave(it.id);
  btn.innerHTML = label;
  if (!r.ok) {
    btn.disabled = false;
    wnShowToast(wnHoEsc(r.message), 'danger');
    return;
  }
  wnShowToast(`「${wnHoEsc(r.data.file_name)}」を自分のファイルに保存しました`, 'success');
  if (fromPreview) btn.style.display = 'none';
  wnHoAfterChange();
}

async function wnHoDoDismiss(it) {
  if (it.state === 'active' && !it.saved_at &&
      !confirm(`「${it.file?.file_name ?? ''}」を受け取り箱から消しますか？\n保存していないので、もう開けなくなります。`)) return;
  const r = await wnHandoffDismiss(it.id);
  if (!r.ok) { wnShowToast(wnHoEsc(r.message), 'danger'); return; }
  wnHoAfterChange();
}

/* 開封・保存・削除のあと、一覧とバッジを最新にする */
function wnHoAfterChange() {
  if (document.body.classList.contains('wn-ho-mode')) {
    if (wnHoView.mode === 'inbox') wnHoRenderInbox();
    else wnHoRenderSent();
  } else {
    wnHandoffRefreshBadge();
  }
}

async function wnHoRenderSent() {
  const list = document.getElementById('wnHoList');
  const r = await wnHandoffSent();
  if (wnHoView.mode !== 'sent' || !document.getElementById('wnHoList')) return;
  if (!r.ok) { list.innerHTML = `<div class="wn-ho-empty-box">${wnHoEsc(r.message)}</div>`; return; }

  const items = r.data || [];
  if (!items.length) {
    list.innerHTML = `
      <div class="wn-ho-empty-box">
        <i class="fa-solid fa-paper-plane"></i>
        <p>まだ誰にも渡していません</p>
        <small>ファイルの「社内で使う」→「人に渡す」や、選択して「人に渡す」から渡せます</small>
      </div>`;
    return;
  }

  list.innerHTML = wnHoGroup(items).map(group => {
    const g = group[0];
    const fileNames = [...new Map(group.map(x => [x.file.id, x.file])).values()];
    const byTo = new Map();
    for (const x of group) {
      if (!byTo.has(x.to.id)) byTo.set(x.to.id, []);
      byTo.get(x.to.id).push(x);
    }
    const rows = [...byTo.values()].map(rows => {
      const to = rows[0].to;
      const company = !to.same_company && to.company_name ? `<span class="wn-ho-company">${wnHoEsc(to.company_name)}</span>` : '';
      const saved  = rows.filter(x => x.saved_at).length;
      const opened = rows.filter(x => x.opened_at).length;
      const revoked = rows.every(x => x.revoked_at);
      const expired = rows.every(x => x.expired);
      let st;
      if (revoked)                     st = '<span class="wn-ho-st muted">取り消し済み</span>';
      else if (saved === rows.length)  st = '<span class="wn-ho-st ok"><i class="fa-solid fa-check"></i> 保存しました</span>';
      else if (opened > 0) {
        const last = rows.filter(x => x.opened_at).map(x => x.opened_at).sort().pop();
        st = `<span class="wn-ho-st ok"><i class="fa-solid fa-eye"></i> 開きました ${wnHoDateTime(last)}${rows.length > 1 ? `（${opened}/${rows.length}件）` : ''}</span>`;
      }
      else if (expired)                st = '<span class="wn-ho-st muted">開かれないまま期限切れ</span>';
      else                             st = '<span class="wn-ho-st new">まだ開いていません</span>';
      const canRevoke = !revoked && !expired && rows.some(x => !x.revoked_at);
      return `
        <div class="wn-ho-to">
          <span class="wn-ho-avatar sm">${wnHoEsc(String(to.name || '?').slice(0, 1))}</span>
          <div class="wn-ho-main">
            <div class="wn-ho-name">${wnHoEsc(to.name)} さん ${company}</div>
            <div class="wn-ho-sub">${st}</div>
          </div>
          ${canRevoke ? `<button type="button" class="btn btn-outline btn-sm wn-ho-revoke" data-ids="${rows.filter(x => !x.revoked_at).map(x => x.id).join(',')}" data-name="${wnHoEsc(to.name)}">取り消す</button>` : ''}
        </div>`;
    }).join('');

    return `
      <section class="wn-ho-batch">
        <header class="wn-ho-batch-head">
          <div class="wn-ho-batch-who">
            <div class="wn-ho-sent-files">${fileNames.map(f => `<span><i class="fa-solid ${wnHoKindIcon(f.file_name)}"></i> ${wnHoEsc(f.file_name || '（削除済み）')}</span>`).join('')}</div>
            <small>${wnHoAgo(g.created_at)}に渡しました · ${g.expired ? '期限切れ' : `期限 ${wnHoDateTime(g.expires_at)}`}</small>
          </div>
        </header>
        ${g.message ? `<div class="wn-ho-bubble mine">${wnHoEsc(g.message)}</div>` : ''}
        <div class="wn-ho-items">${rows}</div>
      </section>`;
  }).join('');

  list.querySelectorAll('.wn-ho-revoke').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(`${b.dataset.name} さんへの手渡しを取り消しますか？\n相手はもう開けなくなります（相手が保存した分は残ります）。`)) return;
    b.disabled = true;
    // 並列に投げない（本番APIは単一ワーカーで、並列リクエストはトークン行のロック待ちを招く）
    const results = [];
    for (const id of b.dataset.ids.split(',').map(Number)) results.push(await wnHandoffRevoke(id));
    if (results.some(x => !x.ok)) wnShowToast('取り消せなかったものがあります', 'warning');
    else wnShowToast('取り消しました', 'success');
    wnHoRenderSent();
  }));
}

/* ── バッジ（未開封の数） ── */
function wnHandoffSetBadge(n) {
  ['navInboxBadge', 'bnInboxBadge'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = n > 99 ? '99+' : String(n);
    el.style.display = n > 0 ? '' : 'none';
  });
}

async function wnHandoffRefreshBadge() {
  const r = await wnHandoffSummary();
  if (!r.ok) return;
  wnHoView.mailOn = r.handoff_mail !== false;
  wnHandoffSetBadge(r.unopened || 0);
}
