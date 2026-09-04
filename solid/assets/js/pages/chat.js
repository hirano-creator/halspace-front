'use strict';
/* チャット画面
   物件チャット（既存コメント）／会社スペース／グループ／ダイレクトメッセージを1画面に並べる。
   発注者には出さない画面。ナビの出し分けは auth.js の applyChatNav() と
   バックエンドの SolidChatController::canUseChat() の両方で担保している。 */

const user = requireSpaceAuth();
renderSidebarUser(user);
initMobileMenu();

/* 発注者がURL直打ちで来た場合はダッシュボードへ戻す */
if (!canUseChat(user)) {
  location.replace('dashboard.html');
}

document.getElementById('companyLabel').textContent = user.company_name ?? user.company ?? '';

/* 管理リンクは管理者のみ（他ページと同じ扱い） */
if (isAdmin(user)) {
  document.getElementById('adminLink').style.display = '';
  const adminNav = document.getElementById('adminNav');
  if (adminNav) adminNav.style.display = '';
}

/* ===== 状態 ===== */
let rooms = [];             // 一覧（着信順）
let activeKey = null;       // 開いているルーム
let activeRoom = null;      // 開いているルームの詳細
let activeChannel = null;   // 物件チャットのチャンネル
let messages = [];
let replyTo = null;         // 引用返信の対象
let pendingImages = [];     // 添付予定の画像（複数可）
let searchWord = '';
let listWidth = Number(localStorage.getItem('solid_chat_list_w')) || 388;

const LIST_MIN = 250, LIST_MAX = 660, LIST_DEFAULT = 388;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ===== 表示ヘルパー ===== */

const STATUS_LABEL = {
  draft: '下書き', submitted: '提出済み', in_progress: 'モデリング中', review_pending: '検査待ち',
  revision_requested: '修正依頼中', approved: '納品待ち', delivered: '納品完了', cancelled: 'キャンセル',
};
const STATUS_CLASS = {
  submitted: 'code', in_progress: 'code', review_pending: 'code', revision_requested: 'code',
  approved: 'code', delivered: 'lock', cancelled: 'lock', draft: 'lock',
};

/* 名前から色を決める（同じ人はいつも同じ色になる） */
const AV_COLORS = ['#0984E3', '#00B894', '#6C5CE7', '#e17055', '#00857a', '#c0392b', '#7b8794', '#FF6B35'];
function avColor(seed) {
  const s = String(seed ?? '');
  let n = 0;
  for (let i = 0; i < s.length; i++) n = (n + s.charCodeAt(i)) % AV_COLORS.length;
  return AV_COLORS[n];
}
function initials(name) {
  const s = String(name ?? '').trim();
  if (!s) return '?';
  /* 英字名はイニシャル2文字、日本語は先頭1文字 */
  if (/^[\x20-\x7E]+$/.test(s)) {
    return s.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }
  return s.slice(0, 1);
}
function avatar(name, cls = '') {
  return `<div class="cr-av rd ${cls}" style="background:${avColor(name)}">${esc(initials(name))}</div>`;
}
function roomAvatar(room) {
  const name = room.name ?? '';
  const round = room.kind === 'dm' ? 'rd' : '';
  return `<div class="cr-av ${round}" style="background:${avColor(room.key || name)}">${esc(initials(name))}</div>`;
}

/* 役割ラベル（コメントの吹き出しに出す） */
function roleTag(m) {
  if (m.user_solid_type === 'id_modeler') return '<span class="cr-tag mod">モデラー</span>';
  if (m.user_solid_type === 'jp_client') return '<span class="cr-tag cli">発注者</span>';
  return '<span class="cr-tag adm">HaLSpace</span>';
}

/* 「10:42」「昨日」「8/27」 */
function shortTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(/-/g, '/'));
  if (isNaN(d)) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const yst = new Date(now); yst.setDate(now.getDate() - 1);
  if (d.toDateString() === yst.toDateString()) return '昨日';
  return (d.getMonth() + 1) + '/' + d.getDate();
}
function dayLabel(iso) {
  const d = new Date(String(iso).replace(/-/g, '/'));
  if (isNaN(d)) return '';
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${w}）`;
}
const timeOnly = iso => (iso ? String(iso).slice(11, 16) : '');
const dateOnly = iso => (iso ? String(iso).slice(0, 10) : '');

/* ===== ルーム一覧 ===== */

async function loadRooms(autoOpenFirst = false) {
  try {
    const data = await api.get('/chat/rooms');
    if (!data) return;
    rooms = (data.rooms ?? []).sort((a, b) => String(b.sort_at ?? '').localeCompare(String(a.sort_at ?? '')));
    renderRooms();
    updateNavBadge();
    /* 起動直後だけ、先頭のルームを開いておく（狭い画面では一覧のまま） */
    if (autoOpenFirst && !activeKey) {
      const first = rooms.find(r => !r.archived);
      if (first && window.innerWidth > 900) await openRoom(first.key);
    }
  } catch (e) {
    solidToast(e.message || 'チャットの読み込みに失敗しました', false);
  }
}

function matchSearch(r) {
  if (!searchWord) return true;
  const w = searchWord.toLowerCase();
  return [r.name, r.code, r.company, r.last_body].some(v => String(v ?? '').toLowerCase().includes(w));
}

function roomRow(r) {
  const unread = r.unread > 0;
  const mini = [];
  if (r.kind === 'project' && r.status) {
    mini.push(`<span class="cr-mini ${STATUS_CLASS[r.status] ?? 'code'}">${STATUS_LABEL[r.status] ?? r.status}</span>`);
  }
  if (r.kind === 'group') mini.push('<span class="cr-mini group">グループ</span>');
  if (r.kind === 'space') mini.push('<span class="cr-mini lock">社内</span>');

  const sub = r.kind === 'project' && r.company ? `${esc(r.company)} · ` : '';

  return `<div class="cr-room ${unread ? 'unread' : ''} ${r.key === activeKey ? 'on' : ''}" data-key="${r.key}">
    ${roomAvatar(r)}
    <div class="cr-room-b">
      <div class="cr-room-t">
        <span class="cr-room-name">${esc(r.name)}</span>
        ${mini.join('')}
        <span class="cr-room-time">${shortTime(r.last_at)}</span>
      </div>
      <div class="cr-room-t">
        <span class="cr-room-last">${sub}${esc(r.last_body)}</span>
        ${unread ? `<span class="cr-badge">${r.unread}</span>` : ''}
      </div>
    </div>
  </div>`;
}

function renderRooms() {
  const box = $('roomList');
  const shown = rooms.filter(matchSearch);
  const sec = (label, icon, list) => list.length
    ? `<div class="cr-sec"><i class="fa-solid ${icon}"></i>${label}<span class="n">${list.length}</span></div>${list.map(roomRow).join('')}`
    : '';

  const projects = shown.filter(r => r.kind === 'project' && !r.archived);
  const spaces = shown.filter(r => r.kind === 'space' || r.kind === 'group');
  const dms = shown.filter(r => r.kind === 'dm');
  const archived = shown.filter(r => r.archived);

  const html = sec('物件チャット（着信順）', 'fa-cube', projects)
    + sec('スペース・グループ', 'fa-users', spaces)
    + sec('ダイレクトメッセージ', 'fa-user', dms)
    + sec('アーカイブ', 'fa-box-archive', archived);

  box.innerHTML = html || '<div class="cr-empty-list">チャットがありません</div>';
  box.querySelectorAll('[data-key]').forEach(el =>
    el.addEventListener('click', () => openRoom(el.dataset.key)));
}

/* ===== 会話 ===== */

async function openRoom(key, channel = null) {
  activeKey = key;
  $('convEmpty').style.display = 'none';
  $('convBody').style.display = 'flex';
  $('chatShell').classList.add('show-conv');
  clearReply();
  clearImage();

  try {
    const q = channel ? `?channel=${encodeURIComponent(channel)}` : '';
    const data = await api.get(`/chat/rooms/${encodeURIComponent(key)}/messages${q}`);
    if (!data) return;
    activeRoom = data.room;
    activeChannel = data.channel;
    messages = data.messages ?? [];
    renderConv(data.channels ?? []);
    renderMessages();
    await markRead(key);
  } catch (e) {
    solidToast(e.message || 'メッセージの読み込みに失敗しました', false);
  }
}

function renderConv(channels) {
  const r = activeRoom;
  $('convAvatar').innerHTML = roomAvatar({ key: activeKey, name: r.name, kind: r.kind });

  const badges = [];
  if (r.code) badges.push(`<span class="cr-mini code">${esc(r.code)}</span>`);
  if (r.kind === 'project' && r.status) {
    badges.push(`<span class="cr-mini ${STATUS_CLASS[r.status] ?? 'code'}">${STATUS_LABEL[r.status] ?? r.status}</span>`);
  }
  if (r.kind === 'space' || r.is_internal) badges.push('<span class="cr-mini lock"><i class="fa-solid fa-lock"></i> 社内</span>');

  $('convTitle').innerHTML = esc(r.name) + badges.join('');
  $('convSub').textContent = r.kind === 'project'
    ? (r.company ?? '')
    : (r.members ? `メンバー ${r.members.length}名` : '');

  /* 参加者の顔（ルームメッセージのみ。物件チャットは投稿者から拾う） */
  const faces = r.members?.length
    ? r.members.slice(0, 4).map(m => avatar(m.name))
    : [...new Set(messages.map(m => m.user_name))].slice(0, 4).map(n => avatar(n));
  $('convFaces').innerHTML = faces.join('');

  /* 物件チャットのチャンネル切替 */
  const tabs = $('convChannels');
  if (r.kind === 'project' && channels.length > 1) {
    const label = { client: 'お客様連絡', modeler: '制作チーム' };
    const icon = { client: 'fa-user', modeler: 'fa-drafting-compass' };
    tabs.innerHTML = channels.map(ch =>
      `<button class="cr-chtab ${ch === activeChannel ? 'on' : ''}" data-ch="${ch}">
        <i class="fa-solid ${icon[ch]}"></i> ${label[ch] ?? ch}</button>`).join('');
    tabs.style.display = 'flex';
    tabs.querySelectorAll('[data-ch]').forEach(b =>
      b.addEventListener('click', () => openRoom(activeKey, b.dataset.ch)));
  } else {
    tabs.style.display = 'none';
  }

  /* ピン留め */
  if (r.pin?.text) {
    $('pinLabel').textContent = r.pin.label ?? '';
    $('pinText').textContent = r.pin.text;
    $('convPin').style.display = 'flex';
  } else {
    $('convPin').style.display = 'none';
  }

  /* プロジェクト詳細へのリンク */
  const openBtn = $('btnOpenProject');
  if (r.kind === 'project') {
    const id = String(activeKey).replace(/^p/, '');
    openBtn.style.display = 'grid';
    openBtn.onclick = () => { location.href = `project-detail.html?id=${id}`; };
  } else {
    openBtn.style.display = 'none';
  }

  $('msgInput').placeholder = `メッセージを入力… （${r.name}）`;
}

/* 複数画像対応（旧データは image_path 1枚のみ） */
function imagesHtml(m) {
  const urls = m.images ?? (m.image_path ? [m.image_path] : []);
  if (!urls.length) return '';
  if (urls.length === 1) return `<img class="cr-img" data-src="${urls[0]}" alt="添付画像">`;
  return `<div class="cr-img-grid">${urls.map(u =>
    `<img class="cr-img" data-src="${u}" alt="添付画像">`).join('')}</div>`;
}

function messageHtml(m, prevDate) {
  const blocks = [];
  const date = dateOnly(m.created_at);
  if (date && date !== prevDate) blocks.push(`<div class="cr-day">${dayLabel(m.created_at)}</div>`);

  const mine = Number(m.user_id) === Number(user.id);
  const body = esc(m.body).replace(/@([^\s@]{1,20})/g, '<span class="mention">@$1</span>');

  blocks.push(`<div class="cr-msg" data-id="${m.id}">
    ${avatar(m.user_name)}
    <div class="cr-msg-b">
      <div class="cr-msg-acts">
        <button data-act="reply" title="引用して返信"><i class="fa-solid fa-reply"></i></button>
        ${mine ? `<button data-act="edit" title="編集"><i class="fa-solid fa-pen"></i></button>` : ''}
        ${mine || isInternalAdmin(user) ? `<button data-act="del" class="del" title="削除"><i class="fa-solid fa-trash-can"></i></button>` : ''}
      </div>
      <div class="cr-msg-h">
        <span class="cr-name">${esc(m.user_name)}</span>
        ${roleTag(m)}
        <span class="cr-time">${timeOnly(m.created_at)}</span>
        ${m.edited_at ? '<span class="cr-edited">（編集済み）</span>' : ''}
      </div>
      ${m.quote ? `<div class="cr-quote"><i class="fa-solid fa-reply" style="font-size:9px"></i>
        <b>${esc(m.quote.user_name)}</b><span>${esc(m.quote.body)}</span></div>` : ''}
      ${m.body ? `<div class="cr-text">${body}</div>` : ''}
      ${imagesHtml(m)}
    </div>
  </div>`);

  return { html: blocks.join(''), date };
}

function renderMessages() {
  const box = $('msgList');
  let prevDate = '';
  const parts = messages.map(m => {
    const r = messageHtml(m, prevDate);
    prevDate = r.date || prevDate;
    return r.html;
  });

  box.innerHTML = parts.join('') || `<div class="cr-empty" style="background:none;">
    <div class="big"><i class="fa-regular fa-comment"></i></div>
    <div>まだメッセージはありません</div></div>`;

  /* 画像はBearer認証が要るので fetch してから差し込む */
  box.querySelectorAll('img[data-src]').forEach(loadAuthImage);

  box.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
    const id = Number(btn.closest('[data-id]').dataset.id);
    if (btn.dataset.act === 'reply') startReply(id);
    if (btn.dataset.act === 'edit') startEdit(id);
    if (btn.dataset.act === 'del') removeMessage(id);
  }));

  box.scrollTop = box.scrollHeight;
}

async function loadAuthImage(img) {
  try {
    const token = sessionStorage.getItem('space_token');
    const res = await fetch(img.dataset.src, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    img.src = URL.createObjectURL(await res.blob());
    img.addEventListener('click', () => window.open(img.src, '_blank'));
  } catch { /* 画像が出ないだけなので黙って諦める */ }
}

/* ===== 送信・編集・削除 ===== */

function startReply(id) {
  const m = messages.find(x => Number(x.id) === id);
  if (!m) return;
  replyTo = m;
  $('replyName').textContent = m.user_name;
  $('replyBody').textContent = (m.body || '［画像］').replace(/\n/g, ' ').slice(0, 60);
  $('replyBar').style.display = 'flex';
  $('msgInput').focus();
}
function clearReply() {
  replyTo = null;
  $('replyBar').style.display = 'none';
}

function clearImage() {
  pendingImages = [];
  $('imgPreview').style.display = 'none';
  $('imgPreview').innerHTML = '';
  $('imgInput').value = '';
}

function renderImagePreview() {
  const area = $('imgPreview');
  if (!pendingImages.length) { area.style.display = 'none'; area.innerHTML = ''; return; }
  area.style.display = 'flex';
  area.innerHTML = pendingImages.map((file, i) => `
    <div><img src="${URL.createObjectURL(file)}" alt="添付予定"><button data-rm="${i}"><i class="fa-solid fa-xmark"></i></button></div>
  `).join('');
  area.querySelectorAll('[data-rm]').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingImages.splice(Number(btn.dataset.rm), 1);
      renderImagePreview();
    });
  });
}

async function send() {
  const input = $('msgInput');
  const body = input.value.trim();
  if (!body && !pendingImages.length) return;

  const fd = new FormData();
  if (body) fd.append('body', body);
  pendingImages.forEach(f => fd.append('images[]', f));
  if (replyTo) fd.append('parent_id', replyTo.id);
  if (activeChannel) fd.append('channel', activeChannel);

  $('btnSend').disabled = true;
  try {
    const data = await apiFetchForm(`/chat/rooms/${encodeURIComponent(activeKey)}/messages`, fd);
    if (data?.message) {
      messages.push(data.message);
      renderMessages();
    }
    input.value = '';
    input.style.height = 'auto';
    clearReply();
    clearImage();
    loadRooms();          // 一覧の並びと最終メッセージを更新
  } catch (e) {
    solidToast(e.message || '送信に失敗しました', false);
  } finally {
    $('btnSend').disabled = false;
  }
}

async function startEdit(id) {
  const m = messages.find(x => Number(x.id) === id);
  if (!m) return;
  const body = prompt('メッセージを編集', m.body);
  if (body === null || body.trim() === '' || body === m.body) return;

  try {
    const path = activeRoom.kind === 'project' ? `/comments/${id}` : `/chat/messages/${id}`;
    await api.patch(path, { body: body.trim() });
    m.body = body.trim();
    m.edited_at = 'edited';
    renderMessages();
  } catch (e) {
    solidToast(e.message || '編集に失敗しました', false);
  }
}

async function removeMessage(id) {
  if (!confirm('このメッセージを削除しますか？')) return;
  try {
    const path = activeRoom.kind === 'project' ? `/comments/${id}` : `/chat/messages/${id}`;
    await api.delete(path);
    messages = messages.filter(x => Number(x.id) !== id);
    renderMessages();
    loadRooms();
  } catch (e) {
    solidToast(e.message || '削除に失敗しました', false);
  }
}

async function markRead(key) {
  try {
    await api.post(`/chat/rooms/${encodeURIComponent(key)}/read`, {});
    const r = rooms.find(x => x.key === key);
    if (r) { r.unread = 0; renderRooms(); updateNavBadge(); }
  } catch { /* 既読は失敗しても致命的ではない */ }
}

function updateNavBadge() {
  const total = rooms.reduce((n, r) => n + (r.unread || 0), 0);
  const badge = $('navChatBadge');
  if (!badge) return;
  badge.textContent = total > 99 ? '99+' : total;
  badge.style.display = total > 0 ? 'grid' : 'none';
}

/* ===== ピン留め ===== */

$('btnPin').addEventListener('click', openPinModal);
$('pinEdit').addEventListener('click', openPinModal);

function openPinModal() {
  if (!activeRoom) return;
  $('pinLabelInput').value = activeRoom.pin?.label ?? '確定仕様';
  $('pinTextInput').value = activeRoom.pin?.text ?? '';
  $('pinModal').classList.remove('hidden');
}
const closePin = () => $('pinModal').classList.add('hidden');
$('pinClose').addEventListener('click', closePin);
$('pinCancel').addEventListener('click', closePin);

$('pinSave').addEventListener('click', async () => {
  try {
    const data = await api.patch(`/chat/rooms/${encodeURIComponent(activeKey)}/pin`, {
      label: $('pinLabelInput').value.trim(),
      text: $('pinTextInput').value.trim(),
    });
    activeRoom.pin = data?.pin ?? null;
    if (activeRoom.pin?.text) {
      $('pinLabel').textContent = activeRoom.pin.label;
      $('pinText').textContent = activeRoom.pin.text;
      $('convPin').style.display = 'flex';
    } else {
      $('convPin').style.display = 'none';
    }
    closePin();
    solidToast('ピン留めを更新しました');
  } catch (e) {
    solidToast(e.message || 'ピン留めの更新に失敗しました', false);
  }
});

/* ===== 新しいチャット ===== */

let newRoomKind = 'group';
let candidates = [];
let selected = new Set();

$('btnNewRoom').addEventListener('click', async () => {
  selected.clear();
  $('newRoomName').value = '';
  $('newRoomModal').classList.remove('hidden');
  try {
    const data = await api.get('/chat/candidates');
    candidates = data?.users ?? [];
    renderCandidates();
  } catch (e) {
    solidToast(e.message || 'ユーザー一覧の取得に失敗しました', false);
  }
});

function renderCandidates() {
  $('userList').innerHTML = candidates.map(u => `
    <div class="cr-userrow ${selected.has(u.id) ? 'on' : ''}" data-uid="${u.id}">
      ${avatar(u.name, 'sm')}
      <div>
        <div class="nm">${esc(u.name)}</div>
        <div class="co">${esc(u.company ?? '')}</div>
      </div>
      <input type="checkbox" ${selected.has(u.id) ? 'checked' : ''}>
    </div>`).join('') || '<div class="cr-empty-list">対象のユーザーがいません</div>';

  $('userList').querySelectorAll('[data-uid]').forEach(row =>
    row.addEventListener('click', () => {
      const id = Number(row.dataset.uid);
      if (newRoomKind === 'dm') {
        selected.clear();
        selected.add(id);
      } else {
        selected.has(id) ? selected.delete(id) : selected.add(id);
      }
      renderCandidates();
    }));

  $('memberCount').textContent = selected.size ? `（${selected.size}名選択中）` : '';
}

$('newRoomKind').querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
  newRoomKind = b.dataset.kind;
  $('newRoomKind').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  $('groupNameField').style.display = newRoomKind === 'group' ? '' : 'none';
  if (newRoomKind === 'dm' && selected.size > 1) selected = new Set([[...selected][0]]);
  renderCandidates();
}));

const closeNewRoom = () => $('newRoomModal').classList.add('hidden');
$('newRoomClose').addEventListener('click', closeNewRoom);
$('newRoomCancel').addEventListener('click', closeNewRoom);

$('newRoomCreate').addEventListener('click', async () => {
  if (!selected.size) { solidToast('メンバーを選んでください', false); return; }
  if (newRoomKind === 'group' && !$('newRoomName').value.trim()) {
    solidToast('グループ名を入力してください', false); return;
  }
  try {
    const data = await api.post('/chat/rooms', {
      kind: newRoomKind,
      name: $('newRoomName').value.trim(),
      member_ids: [...selected],
    });
    closeNewRoom();
    if (data?.room?.key) await openRoom(data.room.key);
    await loadRooms();
    solidToast(data?.existing ? '既存のチャットを開きました' : 'チャットを作成しました');
  } catch (e) {
    solidToast(e.message || '作成に失敗しました', false);
  }
});

/* ===== 一覧幅のドラッグ ===== */

function applyListWidth() {
  $('crList').style.width = listWidth + 'px';
}
applyListWidth();

$('crSplit').addEventListener('mousedown', e => {
  e.preventDefault();
  const x0 = e.clientX, w0 = $('crList').getBoundingClientRect().width;
  $('crSplit').classList.add('on');
  document.body.classList.add('cr-resizing');

  const move = ev => {
    listWidth = Math.round(Math.max(LIST_MIN, Math.min(LIST_MAX, w0 + ev.clientX - x0)));
    applyListWidth();
  };
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    $('crSplit').classList.remove('on');
    document.body.classList.remove('cr-resizing');
    localStorage.setItem('solid_chat_list_w', listWidth);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
});

$('crSplit').addEventListener('dblclick', () => {
  listWidth = LIST_DEFAULT;
  applyListWidth();
  localStorage.setItem('solid_chat_list_w', listWidth);
});

/* ===== 入力まわり ===== */

const input = $('msgInput');
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 140) + 'px';
});
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
});
$('btnSend').addEventListener('click', send);

$('imgInput').addEventListener('change', e => {
  Array.from(e.target.files ?? []).forEach(f => {
    if (f.type.startsWith('image/')) pendingImages.push(f);
  });
  renderImagePreview();
  e.target.value = '';
});

$('roomSearch').addEventListener('input', e => {
  searchWord = e.target.value.trim();
  renderRooms();
});

$('btnBack').addEventListener('click', () => {
  $('chatShell').classList.remove('show-conv');
});

$('btnReload').addEventListener('click', () => {
  loadRooms();
  if (activeKey) openRoom(activeKey, activeChannel);
});

/* ===== 起動と自動更新 ===== */

loadRooms(true);

/* タブを見ている間だけ30秒ごとに更新する（api.jsのヘルパー） */
if (typeof startAutoRefresh === 'function') {
  startAutoRefresh(async () => {
    await loadRooms();
    if (activeKey) {
      const data = await api.get(`/chat/rooms/${encodeURIComponent(activeKey)}/messages`
        + (activeChannel ? `?channel=${encodeURIComponent(activeChannel)}` : ''));
      if (data && data.messages.length !== messages.length) {
        messages = data.messages;
        renderMessages();
        markRead(activeKey);
      }
    }
  }, 30000);
}
