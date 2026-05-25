'use strict';
/* MeetLog エディタ */

const params  = new URLSearchParams(location.search);
const minuteId = params.get('id') ? Number(params.get('id')) : null;

let currentMinute   = null;
let templates       = [];
let actions         = [];
let attachments     = [];
let selectedTemplate  = null;
let selectedAiStyle   = 'standard';
let voiceRecognition  = null;
let isListening       = false;
let isDirty           = false;
let autoSaveTimer     = null;
let lastSavedAt       = null;
let pendingCarryoverActions = [];

/* ────────────────────────────
   初期化
──────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  const user = requireAuth();
  if (!user) return;

  initEvents();
  initImgResize();
  await Promise.all([loadTemplates(), minuteId ? loadMinute() : initNew()]);
  initVoiceRecognition();
});

function requireAuth() {
  if (typeof solidRequireAuth === 'function') return solidRequireAuth();
  const raw = localStorage.getItem('space_user');
  if (!raw) { location.href = '../../../space/login.html'; return null; }
  return JSON.parse(raw);
}

/* ────────────────────────────
   新規 / 既存読み込み
──────────────────────────── */
async function initNew() {
  document.getElementById('meetingDate').value = todayIso();
  document.getElementById('meetingTime').value = nowTimeStr();
  const savedAuthor = localStorage.getItem('ml_author_name') || '';
  document.getElementById('authorNameInput').value = savedAuthor;
  renderActionList([]);
  markDirty();

  // 前回の未完了アクションを取得してバナー表示
  const myActions = await mlGetMyActions();
  const undone = myActions.filter(a => !a.is_done);
  if (undone.length > 0) {
    pendingCarryoverActions = undone;
    const sub = undone.slice(0, 2).map(a => escHtml(a.content || '')).join(' / ')
      + (undone.length > 2 ? ` 他${undone.length - 2}件` : '');
    document.getElementById('carryoverBannerSub').textContent = `${undone.length}件: ${sub}`;
    document.getElementById('carryoverBanner').style.display = 'flex';
  }
}

async function loadMinute() {
  setStatus('読み込み中…', false);
  currentMinute = await mlGetMinute(minuteId);
  if (!currentMinute) {
    mlShowToast('議事録が見つかりません', 'danger');
    history.back();
    return;
  }

  document.getElementById('titleInput').value         = currentMinute.title || '';
  document.getElementById('authorNameInput').value    = localStorage.getItem('ml_author_name') || '';
  syncHeaderTitle();
  document.getElementById('meetingDate').value        = currentMinute.meeting_date ? currentMinute.meeting_date.substring(0, 10) : '';
  document.getElementById('meetingTime').value        = currentMinute.meeting_time || '';
  document.getElementById('meetingLocation').value   = currentMinute.meeting_location || '';
  document.getElementById('attendeesInput').value    = formatAttendeesForInput(currentMinute.attendees);
  // raw_memo があればメモ欄へ、なければ空のまま
  document.getElementById('bodyInput').value = currentMinute.raw_memo || '';
  updateClearMemoBtn();
  // body（AI整形済み）があればプレビューへ展開
  const bodyVal = currentMinute.body || '';
  if (bodyVal.trim()) showPreviewMode(bodyVal);
  updateClearMemoBtn();

  if (currentMinute.template_type) {
    setActiveTemplate(currentMinute.template_type);
  }

  const fetchedActions = await mlGetActions(minuteId);
  actions = fetchedActions.map(a => ({ ...a, _saved: true }));
  renderActionList(actions);

  updateFooter(currentMinute.approval_status);
  document.getElementById('editFooter').style.display = '';
  setStatus('');
}

/* ────────────────────────────
   テンプレート
──────────────────────────── */
async function loadTemplates() {
  templates = await mlGetTemplates();
  // テンプレートUIが存在する場合のみ描画
  const container = document.getElementById('templateBtns');
  if (!container || !templates.length) return;

  container.innerHTML = templates.map(t => `
    <button class="template-btn" data-id="${t.id}" data-name="${escHtml(t.name)}" data-body="${escHtml(t.body)}"
      onclick="onTemplateClick(this)">
      ${escHtml(t.name)}
    </button>`).join('');

  const def = templates.find(t => t.is_default);
  if (def && !minuteId) {
    const btn = container.querySelector(`[data-id="${def.id}"]`);
    if (btn) applyTemplate(btn);
  }
}

function onTemplateClick(btn) {
  const isActive = btn.classList.contains('active');
  document.querySelectorAll('.template-btn').forEach(b => b.classList.remove('active'));
  if (!isActive) applyTemplate(btn);
}

function applyTemplate(btn) {
  btn.classList.add('active');
  selectedTemplate = btn.dataset.name;
  const body = document.getElementById('bodyInput');
  if (!body.value.trim()) {
    body.value = btn.dataset.body.replace(/\\n/g, '\n');
    markDirty();
  }
}

function setActiveTemplate(name) {
  document.querySelectorAll('.template-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.name === name);
  });
  selectedTemplate = name;
}

/* ────────────────────────────
   音声入力
──────────────────────────── */
function initVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    document.getElementById('voiceBtn').style.display = 'none';
    return;
  }
  voiceRecognition = new SpeechRecognition();
  voiceRecognition.lang             = 'ja-JP';
  voiceRecognition.continuous       = true;
  voiceRecognition.interimResults   = true;

  let interim = '';
  voiceRecognition.onresult = (e) => {
    interim = '';
    let final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) {
        final += e.results[i][0].transcript;
      } else {
        interim += e.results[i][0].transcript;
      }
    }
    const body = document.getElementById('bodyInput');
    if (final) {
      body.value += final + '\n';
      markDirty();
    }
    setStatus(interim ? `認識中: ${interim}` : '音声入力中…', false);
  };

  voiceRecognition.onerror = (e) => {
    setStatus('音声認識エラー: ' + e.error, false);
    stopVoice();
  };

  voiceRecognition.onend = () => {
    if (isListening) voiceRecognition.start(); // 連続モード維持
  };
}

function toggleVoice() {
  if (isListening) {
    stopVoice();
  } else {
    startVoice();
  }
}

function startVoice() {
  if (!voiceRecognition) return;
  voiceRecognition.start();
  isListening = true;
  const btn = document.getElementById('voiceBtn');
  btn.classList.add('listening');
  document.getElementById('voiceBtnLabel').textContent = '停止';
  setStatus('音声入力中… マイクに向かって話してください', false);
}

function stopVoice() {
  if (!voiceRecognition) return;
  voiceRecognition.stop();
  isListening = false;
  const btn = document.getElementById('voiceBtn');
  btn.classList.remove('listening');
  document.getElementById('voiceBtnLabel').textContent = '音声入力';
  setStatus('');
}

/* ────────────────────────────
   AI整形
──────────────────────────── */
async function doAiFormat() {
  const body = document.getElementById('bodyInput').value.trim();
  if (!body) {
    mlShowToast('本文を入力してから整形してください', 'warning');
    return;
  }

  const btn = document.getElementById('aiFormatBtn');
  btn.disabled = true;
  setStatus('<i class="fa-solid fa-spinner spinner"></i> AI整形中… しばらくお待ちください', true);

  // 会議情報をメモ先頭に付加してAIに渡す
  const dateVal      = document.getElementById('meetingDate').value;
  const timeVal      = document.getElementById('meetingTime').value;
  const locationVal  = document.getElementById('meetingLocation').value.trim();
  const attendeesVal = document.getElementById('attendeesInput').value.trim();
  const authorVal    = document.getElementById('authorNameInput').value.trim();

  const metaLines = [];
  if (dateVal) {
    const d = new Date(dateVal);
    const weekdays = ['日','月','火','水','木','金','土'];
    const dateStr = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${weekdays[d.getDay()]}）`;
    metaLines.push(`日時: ${dateStr}${timeVal ? ' ' + timeVal : ''}`);
  }
  if (locationVal)  metaLines.push(`場所: ${locationVal}`);
  if (attendeesVal) metaLines.push(`参加者: ${attendeesVal}`);
  if (authorVal)    metaLines.push(`作成者: ${authorVal}`);

  const fullText = metaLines.length
    ? metaLines.join('\n') + '\n\n' + body
    : body;

  const result = await mlAiFormat(fullText, selectedTemplate || '', selectedAiStyle);
  if (result) {
    showPreviewMode(result);
    markDirty();
    setStatus('');
    mlShowToast('AI整形が完了しました', 'success');
  } else {
    setStatus('AI整形に失敗しました。しばらく後に再試行してください', false);
  }
  btn.disabled = false;
}

/* ────────────────────────────
   プレビュー / 編集モード切替
──────────────────────────── */
async function showPreviewMode(markdown) {
  const preview  = document.getElementById('mdPreview');
  const editArea = document.getElementById('previewEditArea');
  const editBtn  = document.getElementById('editPreviewBtn');

  // AI整形結果を保持（保存時に使用）
  preview.dataset.markdown = markdown;
  // 編集エリアにも反映
  if (editArea) editArea.value = markdown;

  // mlimg://ID を解決してからレンダリング
  preview.innerHTML = await parseMarkdownWithImages(markdown);
  preview.style.display = '';
  editArea.style.display = 'none';

  // ボタンを表示
  if (editBtn) editBtn.style.display = 'inline-flex';
  const clearBtn = document.getElementById('clearPreviewBtn');
  if (clearBtn) clearBtn.style.display = 'inline-flex';
  setInsertImageBtnVisible(false);

  // スマホ: AI整形後は自動でプレビュータブへ切替
  if (window.innerWidth < 768 && typeof switchMobileTab === 'function') {
    switchMobileTab('preview');
  }

  // h3の絵文字に応じて背景色を色分け
  preview.querySelectorAll('h3').forEach(h => {
    const t = h.textContent;
    if (t.includes('✅'))           { h.style.background = '#DCFCE7'; h.style.color = '#15803D'; }
    else if (t.includes('⚠️'))      { h.style.background = '#FEF9C3'; h.style.color = '#92400E'; }
    else if (t.includes('📌'))      { h.style.background = '#EDE9FE'; h.style.color = '#6D28D9'; }
    else if (t.includes('サマリー')) { h.style.background = '#DBEAFE'; h.style.color = '#1D4ED8'; }
  });
}

let previewIsEditing = false;

function togglePreviewEdit() {
  const preview  = document.getElementById('mdPreview');
  const editArea = document.getElementById('previewEditArea');
  const editBtn  = document.getElementById('editPreviewBtn');

  previewIsEditing = !previewIsEditing;

  if (previewIsEditing) {
    // 編集モード：プレビューを隠してテキストエリアを表示
    if (!editArea.value.trim() && preview.dataset.markdown) {
      editArea.value = preview.dataset.markdown;
    }
    preview.style.display = 'none';
    editArea.style.display = 'block';
    editBtn.innerHTML = '<i class="fa-solid fa-eye"></i> プレビュー';
    editArea.focus();
    setInsertImageBtnVisible(true);

    editArea.addEventListener('input', syncFromPreviewEdit);
  } else {
    // プレビューモードに戻す
    editArea.removeEventListener('input', syncFromPreviewEdit);
    deselectImg();
    const md = editArea.value;
    showPreviewMode(md);
    editBtn.innerHTML = '<i class="fa-solid fa-pen"></i> 編集';
    setInsertImageBtnVisible(false);
    markDirty();
  }
}

function getBodyToSave() {
  // AI整形済み内容があればそちらを保存、なければメモをそのまま保存
  const editArea = document.getElementById('previewEditArea');
  if (editArea && editArea.value.trim()) return editArea.value;
  const preview = document.getElementById('mdPreview');
  if (preview && !preview.querySelector('.preview-placeholder') && preview.dataset.markdown) {
    return preview.dataset.markdown;
  }
  return document.getElementById('bodyInput').value;
}

function syncFromPreviewEdit() {
  markDirty();
}

function clearMemo() {
  if (!confirm('メモ入力欄をクリアしますか？')) return;
  const ta = document.getElementById('bodyInput');
  ta.value = '';
  updateClearMemoBtn();
  markDirty();
}

function updateClearMemoBtn() {
  const btn = document.getElementById('clearMemoBtn');
  if (!btn) return;
  const hasText = document.getElementById('bodyInput').value.trim().length > 0;
  btn.style.display = hasText ? 'inline-flex' : 'none';
}

function clearPreview() {
  if (!confirm('議事録プレビューをクリアしますか？')) return;

  const preview  = document.getElementById('mdPreview');
  const editArea = document.getElementById('previewEditArea');
  const editBtn  = document.getElementById('editPreviewBtn');
  const clearBtn = document.getElementById('clearPreviewBtn');

  // プレビュー・編集エリアをリセット（左側メモは保持）
  preview.innerHTML = `
    <div class="preview-placeholder">
      <i class="fa-solid fa-wand-magic-sparkles"></i>
      <span>左側にメモを入力して<br>「AI整形」ボタンを押してください</span>
    </div>`;
  delete preview.dataset.markdown;
  preview.style.display = '';
  editArea.style.display = 'none';
  editArea.value = '';

  // ボタンを非表示
  if (editBtn)  { editBtn.style.display  = 'none'; editBtn.innerHTML = '<i class="fa-solid fa-pen"></i> 編集'; }
  if (clearBtn) clearBtn.style.display = 'none';
  setInsertImageBtnVisible(false);

  previewIsEditing = false;
  markDirty();
}

/* ────────────────────────────
   アクションアイテム
──────────────────────────── */
function renderActionList(list) {
  actions = list;
  const container = document.getElementById('actionList');
  container.innerHTML = list.map((a, i) => renderActionItem(a, i)).join('');
}

function renderActionItem(a, idx) {
  const overdue = a.due_date && mlIsOverdue(a.due_date);
  const carryoverBadge = a._carryover
    ? `<span class="action-carryover-badge"><i class="fa-solid fa-arrow-rotate-right"></i> 繰り越し</span>`
    : '';
  return `
    <div class="action-item${a._carryover ? ' is-carryover' : ''}" data-idx="${idx}">
      <input type="checkbox" class="action-check" ${a.is_done ? 'checked' : ''}
        onchange="onActionCheck(${idx}, this.checked)">
      <input type="text" class="action-content-input" value="${escHtml(a.content || '')}"
        placeholder="アクション内容を入力…"
        onchange="onActionChange(${idx}, 'content', this.value)">
      ${carryoverBadge}
      <div class="action-meta">
        <input type="text" class="action-assignee-input" value="${escHtml(a.assignee_name || '')}"
          placeholder="担当者"
          onchange="onActionChange(${idx}, 'assignee_name', this.value)">
        <input type="date" class="action-due-input ${overdue && !a.is_done ? 'overdue' : ''}"
          value="${a.due_date || ''}"
          onchange="onActionChange(${idx}, 'due_date', this.value)">
        <button class="action-del-btn" onclick="deleteActionItem(${idx})">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    </div>`;
}

function addActionItem() {
  actions.push({ content: '', assignee_name: '', due_date: '', is_done: false, _saved: false });
  renderActionList(actions);
  // 最後のアクション内容にフォーカス
  const inputs = document.querySelectorAll('.action-content-input');
  if (inputs.length) inputs[inputs.length - 1].focus();
  markDirty();
}

function deleteActionItem(idx) {
  const a = actions[idx];
  if (a._saved && minuteId && a.id) {
    mlDeleteAction(minuteId, a.id).then(() => {});
  }
  actions.splice(idx, 1);
  renderActionList(actions);
  markDirty();
}

function onActionCheck(idx, checked) {
  actions[idx].is_done = checked;
  if (actions[idx]._saved && minuteId && actions[idx].id) {
    mlUpdateAction(minuteId, actions[idx].id, { is_done: checked ? 1 : 0 });
  }
  markDirty();
}

function onActionChange(idx, field, value) {
  actions[idx][field] = value;
  markDirty();
}

/* ────────────────────────────
   未完了アクション繰り越し
──────────────────────────── */
function applyCarryover() {
  const carryovers = pendingCarryoverActions.map(a => ({
    content:       a.content || '',
    assignee_name: a.assignee_name || '',
    due_date:      a.due_date || '',
    is_done:       false,
    _saved:        false,
    _carryover:    true,
  }));
  actions = [...carryovers, ...actions];
  renderActionList(actions);
  document.getElementById('carryoverBanner').style.display = 'none';
  pendingCarryoverActions = [];
  mlShowToast(`${carryovers.length}件のアクションを引き継ぎました`, 'success');
  markDirty();
}

function dismissCarryover() {
  document.getElementById('carryoverBanner').style.display = 'none';
  pendingCarryoverActions = [];
}

/* ────────────────────────────
   AIアクション抽出
──────────────────────────── */
async function doAiExtractActions() {
  const mid = currentMinute?.id || minuteId;
  if (!mid) {
    mlShowToast('先に議事録を保存してからAI抽出を実行してください', 'warning');
    return;
  }
  const btn = document.getElementById('aiExtractBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner spinner"></i> 抽出中…';

  const extracted = await mlAiExtractActions(mid);
  if (extracted && extracted.length) {
    const newActions = extracted.map(a => ({ ...a, is_done: false, _saved: false }));
    actions = [...actions, ...newActions];
    renderActionList(actions);
    mlShowToast(`${extracted.length} 件のアクションを抽出しました`, 'success');
    markDirty();
  } else {
    mlShowToast('アクションが見つかりませんでした', 'warning');
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles" style="color:var(--ml-accent);"></i> AIで抽出';
}

/* ────────────────────────────
   保存
──────────────────────────── */
async function save() {
  const title = document.getElementById('titleInput').value.trim();
  if (!title) {
    mlShowToast('タイトルを入力してください', 'warning');
    document.getElementById('titleInput').focus();
    return;
  }

  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner spinner"></i> <span>保存中…</span>';

  const attendees  = parseAttendees(document.getElementById('attendeesInput').value);
  const authorName = document.getElementById('authorNameInput').value.trim();
  if (authorName) localStorage.setItem('ml_author_name', authorName);

  const data = {
    title,
    meeting_date:     document.getElementById('meetingDate').value || null,
    meeting_time:     (document.getElementById('meetingTime').value || '').slice(0, 5) || null,
    meeting_location: document.getElementById('meetingLocation').value.trim() || null,
    attendees,
    body:             getBodyToSave(),
    raw_memo:         document.getElementById('bodyInput').value || null,
    template_type:    selectedTemplate || null,
  };

  let saved;
  if (minuteId) {
    saved = await mlUpdateMinute(minuteId, data);
  } else {
    saved = await mlCreateMinute(data);
    if (saved) {
      history.replaceState(null, '', `edit.html?id=${saved.id}`);
      currentMinute = saved;
      // 新規作成後のフッター表示
      document.getElementById('editFooter').style.display = '';
    }
  }

  if (!saved || saved._error) {
    mlShowToast('保存に失敗しました: ' + (saved?._error || '不明なエラー'), 'danger');
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> <span>保存</span>';
    return;
  }

  currentMinute = saved;

  // アクション保存（未保存分をPOST）
  const newActions = actions.filter(a => !a._saved);
  for (const a of newActions) {
    if (!a.content.trim()) continue;
    const created = await mlAddAction(saved.id, {
      content:       a.content,
      assignee_name: a.assignee_name || null,
      due_date:      a.due_date || null,
      is_done:       a.is_done ? 1 : 0,
    });
    if (created) a._saved = true;
  }

  updateFooter(saved.approval_status);
  isDirty = false;
  lastSavedAt = new Date();
  updateAutoSaveStatus();
  if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
  mlShowToast('保存しました', 'success');

  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> <span>保存</span>';
}

/* ────────────────────────────
   承認ワークフロー
──────────────────────────── */
function updateFooter(status) {
  const btn   = document.getElementById('approvalBtn');
  const label = document.getElementById('approvalBtnLabel');

  const styleMap = {
    none:     { label: '承認申請',    style: 'btn-outline',  icon: 'fa-circle-check' },
    pending:  { label: '申請を取消',  style: 'btn-warning',  icon: 'fa-clock-rotate-left' },
    approved: { label: '承認済み',    style: 'btn-success',  icon: 'fa-check-double' },
    rejected: { label: '再申請',      style: 'btn-danger',   icon: 'fa-rotate-right' },
  };
  const s = styleMap[status] ?? styleMap.none;

  btn.className = `btn ${s.style}`;
  btn.style.cssText = 'flex:1;justify-content:center;';
  label.textContent = s.label;
  btn.querySelector('i').className = `fa-solid ${s.icon}`;
  btn.disabled = (status === 'approved');
}

async function onApprovalBtn() {
  if (!currentMinute) return;
  const status = currentMinute.approval_status;

  if (status === 'none' || status === 'rejected') {
    if (!confirm('承認申請を送信しますか？')) return;
    const result = await mlSubmitApproval(currentMinute.id);
    if (result) { currentMinute = result; updateFooter(result.approval_status); mlShowToast('承認申請を送信しました', 'success'); }
  } else if (status === 'pending') {
    if (!confirm('承認申請を取り消しますか？')) return;
    const result = await mlCancelApproval(currentMinute.id);
    if (result) { currentMinute = result; updateFooter(result.approval_status); mlShowToast('申請を取り消しました'); }
  }
}

/* 管理者用：承認 / 差し戻し（将来拡張向けに用意） */
async function onApprove(comment = '') {
  if (!currentMinute) return;
  const result = await mlApprove(currentMinute.id, comment);
  if (result) { currentMinute = result; updateFooter(result.approval_status); mlShowToast('承認しました', 'success'); }
}

async function onReject(comment = '') {
  if (!currentMinute) return;
  const result = await mlReject(currentMinute.id, comment);
  if (result) { currentMinute = result; updateFooter(result.approval_status); mlShowToast('差し戻しました', 'warning'); }
}

/* ────────────────────────────
   QRコード
──────────────────────────── */
async function openQrModal() {
  if (!currentMinute) return;
  const data = await mlIssueQr(currentMinute.id);
  if (!data || !data.token) {
    mlShowToast('QR発行に失敗しました', 'danger');
    return;
  }

  const url = mlQrViewUrl(data.token);
  document.getElementById('qrUrlInput').value = url;

  const area = document.getElementById('qrCodeArea');
  area.innerHTML = '';
  const canvas = document.createElement('canvas');
  area.appendChild(canvas);
  QRCode.toCanvas(canvas, url, { width: 200, margin: 2 }, () => {});

  document.getElementById('qrModal').classList.remove('hidden');
}

function copyQrUrl() {
  const inp = document.getElementById('qrUrlInput');
  navigator.clipboard.writeText(inp.value).then(() => mlShowToast('URLをコピーしました', 'success'));
}

/* ────────────────────────────
   添付画像（mlimg://ID 方式）
──────────────────────────── */

// mlimg://ID → 署名付きURLのキャッシュ
const imageUrlCache = {};

async function resolveImageUrl(id) {
  // キャッシュに文字列URLがあればそのまま返す（null/undefinedはキャッシュなし）
  if (typeof imageUrlCache[id] === 'string') return imageUrlCache[id];
  const mid = currentMinute?.id || minuteId;
  if (!mid) return null;
  const url = await mlGetAttachmentUrl(mid, id);
  if (url) imageUrlCache[id] = url;
  return url || null;
}

// Markdown中の mlimg://ID を署名付きURLに置換してからparseする
async function parseMarkdownWithImages(md) {
  const refs = [...md.matchAll(/mlimg:\/\/(\d+)/g)].map(m => Number(m[1]));
  const uniqueIds = [...new Set(refs)];
  await Promise.all(uniqueIds.map(id => resolveImageUrl(id)));

  // ![alt](mlimg://ID){width=N} → 幅指定付きimgタグに変換
  const resolved = md.replace(/!\[([^\]]*)\]\(mlimg:\/\/(\d+)\)(\{width=(\d+)\})?/g, (orig, alt, id, _suf, w) => {
    const url = imageUrlCache[Number(id)];
    if (!url) return `*(画像 ${alt || id} を読み込めません)*`;
    const styleStr = w ? `style="width:${w}px;max-width:${w}px;"` : 'style="max-width:100%;"';
    return `<img src="${url}" alt="${alt}" ${styleStr} data-mlimg-id="${id}" class="preview-img">`;
  });
  // marked.parseに通すと<img>がそのままHTMLとして出力される
  marked.setOptions({ headerIds: false, mangle: false });
  return marked.parse(resolved);
}

/* ────────────────────────────
   画像リサイズ（クリック→ポップアップ）
──────────────────────────── */
let _selectedImg    = null; // 現在選択中のimg要素
let _selectedImgId  = null; // mlimg ID

function initImgResize() {
  // プレビューエリア内の画像クリックを委譲で拾う
  document.getElementById('mdPreview').addEventListener('click', (e) => {
    if (e.target.tagName === 'IMG') {
      selectImg(e.target);
    } else {
      deselectImg();
    }
  });

  // ポップアップ外クリックで閉じる
  document.addEventListener('click', (e) => {
    const popup = document.getElementById('imgResizePopup');
    if (!popup.contains(e.target) && e.target.tagName !== 'IMG') {
      deselectImg();
    }
  });
}

function selectImg(imgEl) {
  // 以前の選択を解除
  if (_selectedImg) _selectedImg.classList.remove('img-selected');

  _selectedImg = imgEl;
  imgEl.classList.add('img-selected');

  // data-mlimg-id → dataset.mlimgId（ハイフンはキャメルケース変換される）
  _selectedImgId = imgEl.dataset.mlimgId || null;

  // 現在の幅を読んでボタンのactiveを更新
  const curW = imgEl.style.width ? parseInt(imgEl.style.width) : 0;
  updateSizeBtns(curW);

  // ポップアップ位置を画像の下に表示
  showResizePopup(imgEl);
}

function deselectImg() {
  if (_selectedImg) {
    _selectedImg.classList.remove('img-selected');
    _selectedImg = null;
    _selectedImgId = null;
  }
  const popup = document.getElementById('imgResizePopup');
  popup.classList.remove('show');
}

function showResizePopup(imgEl) {
  const popup = document.getElementById('imgResizePopup');
  const rect  = imgEl.getBoundingClientRect();
  popup.classList.add('show');

  // 画像の下中央に配置（画面外にはみ出さないよう調整）
  const pw = popup.offsetWidth || 220;
  let left = rect.left + rect.width / 2 - pw / 2;
  let top  = rect.bottom + 8;
  left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
  if (top + 60 > window.innerHeight) top = rect.top - 52;

  popup.style.left = left + 'px';
  popup.style.top  = top  + 'px';
}

function updateSizeBtns(width) {
  document.querySelectorAll('.img-size-btn').forEach(btn => {
    const bw = Number(btn.dataset.width);
    btn.classList.toggle('active', bw === width);
  });
}

function applyImgSize(width) {
  if (!_selectedImg || !_selectedImgId) return;

  // プレビュー内のimgに即反映
  if (width === 0) {
    _selectedImg.style.width    = '';
    _selectedImg.style.maxWidth = '100%';
  } else {
    _selectedImg.style.width    = width + 'px';
    _selectedImg.style.maxWidth = width + 'px';
  }
  updateSizeBtns(width);

  // previewEditArea の Markdown を書き換える
  const ta  = document.getElementById('previewEditArea');
  if (!ta) return;
  const id  = _selectedImgId;
  const sizeStr = width === 0 ? '' : `{width=${width}}`;

  // ![alt](mlimg://ID) or ![alt](mlimg://ID){width=N} → 更新
  ta.value = ta.value.replace(
    /!\[([^\]]*)\]\(mlimg:\/\/(\d+)\)(\{width=\d+\})?/g,
    (orig, alt, imgId) => {
      if (Number(imgId) !== Number(id)) return orig;
      return `![${alt}](mlimg://${imgId})${sizeStr}`;
    }
  );

  // dataset.markdown も更新（保存用）
  const preview = document.getElementById('mdPreview');
  if (preview) preview.dataset.markdown = ta.value;

  markDirty();
}

// 編集モード時に「画像挿入」ボタンを表示/非表示
function setInsertImageBtnVisible(visible) {
  const btn = document.getElementById('insertImageBtn');
  if (btn) btn.style.display = visible ? 'inline-flex' : 'none';
}

// ファイル選択後の処理
async function onInsertImageSelect(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  await insertImageToEditor(file);
}

async function insertImageToEditor(file) {
  const mid = currentMinute?.id || minuteId;
  if (!mid) {
    mlShowToast('先に議事録を保存してから画像を挿入してください', 'warning');
    return;
  }
  if (!file.type.startsWith('image/')) {
    mlShowToast('画像ファイルのみ挿入できます', 'warning');
    return;
  }

  const btn = document.getElementById('insertImageBtn');
  if (btn) btn.style.opacity = '0.5';
  setStatus('<i class="fa-solid fa-spinner spinner"></i> 画像をアップロード中…', true);

  const result = await mlUploadAttachment(mid, file);

  if (btn) btn.style.opacity = '';
  setStatus('');

  if (!result) {
    mlShowToast('画像のアップロードに失敗しました', 'danger');
    return;
  }

  attachments.push(result);
  delete imageUrlCache[result.id]; // キャッシュをリセットして次回プレビュー時に再取得

  // カーソル位置に挿入
  const ta = document.getElementById('previewEditArea');
  const tag = `\n![${escHtml(result.original_name)}](mlimg://${result.id})\n`;
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + tag + ta.value.slice(e);
  ta.selectionStart = ta.selectionEnd = s + tag.length;
  ta.focus();
  markDirty();

  mlShowToast('画像を挿入しました', 'success');
}

/* ────────────────────────────
   共通：印刷コンテンツ生成
──────────────────────────── */
async function buildPrintContent() {
  const preview = document.getElementById('mdPreview');
  const hasAiContent = preview && !preview.querySelector('.preview-placeholder') && preview.dataset.markdown;
  const title = document.getElementById('titleInput').value || '（無題）';

  let bodyHtml;
  if (hasAiContent) {
    const helper = document.getElementById('printPreviewHelper');
    helper.innerHTML = await parseMarkdownWithImages(preview.dataset.markdown);
    helper.querySelectorAll('h3').forEach(h => {
      const t = h.textContent;
      if      (t.includes('✅'))       { h.style.background = '#DCFCE7'; h.style.color = '#15803D'; }
      else if (t.includes('⚠️'))      { h.style.background = '#FEF9C3'; h.style.color = '#92400E'; }
      else if (t.includes('📌'))       { h.style.background = '#EDE9FE'; h.style.color = '#6D28D9'; }
      else if (t.includes('サマリー')) { h.style.background = '#DBEAFE'; h.style.color = '#1D4ED8'; }
    });
    bodyHtml = helper.innerHTML;
  } else {
    bodyHtml = marked.parse(document.getElementById('bodyInput').value || '');
  }

  let actHtml = '';
  if (actions.length) {
    const rows = actions.map(a => {
      const done  = a.is_done ? '☑' : '☐';
      const name  = escHtml(a.assignee_name || '—');
      const due   = a.due_date || '—';
      const cont  = escHtml(a.content || '');
      const style = a.is_done ? 'text-decoration:line-through;color:#999;' : '';
      return `<tr>
        <td style="width:1.5em;text-align:center;">${done}</td>
        <td style="${style}">${cont}</td>
        <td style="width:6em;text-align:center;">${name}</td>
        <td style="width:7em;text-align:center;">${due}</td>
      </tr>`;
    }).join('');
    actHtml = `<div style="margin-top:28px;border-top:2px solid #111;padding-top:16px;">
      <h3 style="font-size:10.5pt;background:#e8e8f4 !important;padding:4px 10px;margin:0 0 8px;border-radius:4px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">📌 アクションアイテム</h3>
      <table style="border-collapse:collapse;width:100%;font-size:10pt;">
        <thead><tr>
          <th style="border:1px solid #aaa;padding:5px 8px;background:#e8e8f4 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;"></th>
          <th style="border:1px solid #aaa;padding:5px 8px;background:#e8e8f4 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;">内容</th>
          <th style="border:1px solid #aaa;padding:5px 8px;background:#e8e8f4 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;width:6em;">担当者</th>
          <th style="border:1px solid #aaa;padding:5px 8px;background:#e8e8f4 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;width:7em;">期日</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  return { title, bodyHtml, actHtml };
}

/* ────────────────────────────
   共通：印刷HTML文書を生成
   autoprint=false → プレビュー iframe 用（body padding で画面表示）
   autoprint=true  → 印刷ウィンドウ用（@page margin で全ページに余白）
──────────────────────────── */
function buildPrintHtml(title, bodyHtml, actHtml, autoprint = false) {
  // 画面表示用：body padding で余白を表現
  // 印刷用：@page margin で全ページの上下余白を保証
  const screenCss = autoprint
    ? 'padding:0;'
    : 'padding:80px 65px;';
  const autoprintScript = autoprint
    ? `<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};};<\/script>`
    : '';
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><title>${escHtml(title)}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Noto Sans JP','Hiragino Kaku Gothic Pro','Meiryo',sans-serif;font-size:10.5pt;line-height:1.8;color:#111;${screenCss}}
h1{font-size:1.1em;font-weight:900;margin:0 0 16px;}
h2{font-size:14pt;font-weight:900;margin:28px 0 12px;padding-bottom:6px;border-bottom:2px solid #111;}
h3{font-size:10.5pt;font-weight:700;margin:20px 0 8px;padding:4px 10px;border-radius:4px;background:#eee;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
h2+h3,h1+h3{margin-top:12px;}
h4{font-size:10pt;font-weight:700;margin:16px 0 6px;border-bottom:.5pt solid #bbb;padding-bottom:2pt;}
p{margin:0 0 8px;}
strong{font-weight:700;}
ul{list-style:none;padding-left:1em;margin:4px 0 12px;}
ul li::before{content:'・';margin-left:-1em;}
ol{padding-left:1.5em;margin:4px 0 12px;}
li{margin:4px 0;}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:10pt;}
th{background:#eee;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-weight:700;padding:5px 8px;border:1px solid #aaa;text-align:left;}
td{padding:5px 8px;border:1px solid #aaa;}
img{max-width:100%;display:block;margin:8px 0;}
hr{border:none;border-top:1px solid #ddd;margin:12px 0;}
.print-footer{margin-top:32px;font-size:8.5pt;color:#bbb;text-align:right;border-top:1px solid #eee;padding-top:6px;}
@page{size:A4;margin:80px 65px;}
@media print{body{padding:0;}h2,h3{page-break-after:avoid;}table{page-break-inside:avoid;}}
</style></head>
<body>
${bodyHtml}
${actHtml}
<div class="print-footer">MeetLog by HaLSpace　／　印刷日: ${new Date().toLocaleDateString('ja-JP')}</div>
${autoprintScript}
</body></html>`;
}

/* ────────────────────────────
   印刷（常に新規ウィンドウ + @page margin で全ページ余白を保証）
──────────────────────────── */
async function printMinute() {
  const { title, bodyHtml, actHtml } = await buildPrintContent();
  const html = buildPrintHtml(title, bodyHtml, actHtml, true);
  const w = window.open('', '_blank', 'width=900,height=700');
  w.document.write(html);
  w.document.close();
}

/* プレビューモーダル内の印刷ボタン：printMinute() に統一 */
function previewPrint() {
  printMinute();
}

/* ────────────────────────────
   PDF出力
──────────────────────────── */
async function exportPdf() {
  if (typeof window.jspdf === 'undefined' || typeof html2canvas === 'undefined') {
    mlShowToast('PDFライブラリの読み込み中です。しばらくお待ちください。', 'warning');
    return;
  }

  const preview = document.getElementById('mdPreview');
  const title   = document.getElementById('titleInput').value || '議事録';
  const hasContent = preview && !preview.querySelector('.preview-placeholder') && preview.dataset.markdown;

  if (!hasContent) {
    mlShowToast('AI整形後の議事録がありません', 'warning');
    return;
  }

  const pdfBtn = document.getElementById('pdfBtn');
  pdfBtn.disabled = true;
  pdfBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="color:#E53E3E;"></i><span>生成中</span>';

  try {
    const canvas = await html2canvas(preview, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const pageW  = pdf.internal.pageSize.getWidth();
    const pageH  = pdf.internal.pageSize.getHeight();
    const margin = 12;
    const imgW   = pageW - margin * 2;
    const imgH   = (canvas.height * imgW) / canvas.width;
    const imgData = canvas.toDataURL('image/jpeg', 0.92);

    let yPos = margin;
    let remaining = imgH;

    while (remaining > 0) {
      const sliceH = Math.min(remaining, pageH - margin * 2);
      const srcY   = (imgH - remaining) * (canvas.height / imgH);
      const srcH   = sliceH * (canvas.height / imgH);

      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width  = canvas.width;
      sliceCanvas.height = srcH;
      const ctx = sliceCanvas.getContext('2d');
      ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);

      pdf.addImage(sliceCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, yPos, imgW, sliceH);

      remaining -= sliceH;
      if (remaining > 0) { pdf.addPage(); yPos = margin; }
    }

    pdf.save(`${title}.pdf`);
    mlShowToast('PDFを保存しました', 'success');
  } catch (e) {
    console.error('PDF export error:', e);
    mlShowToast('PDF生成に失敗しました', 'danger');
  } finally {
    pdfBtn.disabled = false;
    pdfBtn.innerHTML = '<i class="fa-solid fa-file-pdf" style="color:#E53E3E;"></i><span>PDF</span>';
  }
}

/* ────────────────────────────
   フォローメール生成
──────────────────────────── */
function openFollowUpEmailModal() {
  if (!currentMinute) {
    mlShowToast('先に議事録を保存してください', 'warning');
    return;
  }
  document.getElementById('emailOutput').style.display = 'none';
  document.getElementById('emailOutput').value = '';
  document.getElementById('emailCopyBtn').style.display = 'none';
  document.getElementById('emailLoadingArea').style.display = 'none';
  document.getElementById('emailGenerateBtn').disabled = false;
  document.getElementById('emailModal').classList.remove('hidden');
}

async function generateFollowUpEmail() {
  if (!currentMinute) return;

  const generateBtn = document.getElementById('emailGenerateBtn');
  const loadingArea = document.getElementById('emailLoadingArea');
  const output      = document.getElementById('emailOutput');
  const copyBtn     = document.getElementById('emailCopyBtn');

  generateBtn.disabled = true;
  loadingArea.style.display = '';
  output.style.display = 'none';
  copyBtn.style.display = 'none';

  const text = await mlAiGenerateFollowUpEmail(currentMinute.id);

  loadingArea.style.display = 'none';
  generateBtn.disabled = false;

  if (!text) {
    mlShowToast('メール生成に失敗しました。しばらく後に再試行してください。', 'danger');
    return;
  }

  output.value = text;
  output.style.display = '';
  copyBtn.style.display = '';
}

function copyEmailText() {
  const output = document.getElementById('emailOutput');
  if (!output.value) return;
  navigator.clipboard.writeText(output.value).then(() => {
    mlShowToast('クリップボードにコピーしました', 'success');
  }).catch(() => {
    output.select();
    document.execCommand('copy');
    mlShowToast('コピーしました', 'success');
  });
}

/* ────────────────────────────
   プレビューモーダル（印刷と同一HTMLをiframeで表示）
──────────────────────────── */
async function openPreviewModal() {
  const preview = document.getElementById('mdPreview');
  if (!preview || preview.querySelector('.preview-placeholder') || !preview.dataset.markdown) {
    mlShowToast('プレビューがありません。AI整形を実行してください。', 'warning');
    return;
  }

  const modal = document.getElementById('previewFullModal');
  const area  = document.getElementById('previewPagesArea');

  area.innerHTML = `<div style="color:#94a3b8;text-align:center;margin:auto;">
    <i class="fa-solid fa-spinner fa-spin" style="font-size:2rem;"></i>
    <p style="margin-top:14px;font-size:13px;">読み込み中…</p>
  </div>`;
  modal.classList.remove('hidden');

  try {
    const { title, bodyHtml, actHtml } = await buildPrintContent();
    const html = buildPrintHtml(title, bodyHtml, actHtml, false); // autoprint=false

    area.innerHTML = '';
    area.style.cssText = 'flex:1;overflow:auto;background:#3a3a4a;display:flex;align-items:flex-start;justify-content:center;padding:24px;min-height:0;';

    const iframe = document.createElement('iframe');
    iframe.id = 'previewIframe';
    iframe.style.cssText = 'width:794px;border:none;box-shadow:0 4px 32px rgba(0,0,0,.7);background:#fff;display:block;flex-shrink:0;';
    iframe.scrolling = 'no';
    area.appendChild(iframe);

    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();

    // コンテンツ高さに合わせてiframe高さを自動設定
    const adjustHeight = () => {
      try {
        const h = iframe.contentDocument.body.scrollHeight;
        if (h > 0) iframe.style.height = h + 'px';
      } catch (_) {}
    };
    iframe.addEventListener('load', adjustHeight);
    setTimeout(adjustHeight, 400);

  } catch (e) {
    console.error('Preview error:', e);
    area.innerHTML = `<div style="color:#94a3b8;text-align:center;padding:60px 0;margin:auto;">
      <i class="fa-solid fa-circle-exclamation" style="font-size:2rem;color:#f87171;"></i>
      <p style="margin-top:16px;font-size:13px;">プレビューの生成に失敗しました</p>
    </div>`;
  }
}

/* ────────────────────────────
   削除
──────────────────────────── */
async function deleteMinute() {
  if (!currentMinute) return;
  if (!confirm('この議事録を削除しますか？この操作は取り消せません。')) return;
  const ok = await mlDeleteMinute(currentMinute.id);
  if (ok) {
    mlShowToast('削除しました');
    setTimeout(() => location.href = 'dashboard.html', 800);
  } else {
    mlShowToast('削除に失敗しました', 'danger');
  }
}

/* ────────────────────────────
   Markdownツールバー
──────────────────────────── */
function insertMd(before, after) {
  const ta  = document.getElementById('bodyInput');
  const s   = ta.selectionStart;
  const e   = ta.selectionEnd;
  const sel = ta.value.slice(s, e);
  ta.value  = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e);
  ta.selectionStart = s + before.length;
  ta.selectionEnd   = s + before.length + sel.length;
  ta.focus();
  markDirty();
}

/* ────────────────────────────
   イベント初期化
──────────────────────────── */
const AI_STYLE_LABELS = {
  standard: '標準',
  bullet:   '箇条書き',
  formal:   '報告書',
  visual:   '現場向け',
  summary:  '要約',
};

function selectAiStyle(el) {
  selectedAiStyle = el.dataset.style;
  document.getElementById('aiFormatBtnLabel').textContent = `AI整形：${AI_STYLE_LABELS[selectedAiStyle]}`;
  document.getElementById('aiStylePopup').classList.remove('show');
  doAiFormat();
}

function initEvents() {
  document.getElementById('saveBtn').addEventListener('click', save);
  document.getElementById('voiceBtn').addEventListener('click', toggleVoice);

  // AI整形ボタン：クリックでポップアップ開閉
  document.getElementById('aiFormatBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('aiStylePopup').classList.toggle('show');
  });

  // ポップアップ外クリックで閉じる
  document.addEventListener('click', () => {
    document.getElementById('aiStylePopup')?.classList.remove('show');
  });

  document.getElementById('aiExtractBtn').addEventListener('click', doAiExtractActions);
  document.getElementById('addActionBtn').addEventListener('click', addActionItem);
  document.getElementById('approvalBtn').addEventListener('click', onApprovalBtn);
  document.getElementById('qrBtn').addEventListener('click', openQrModal);
  document.getElementById('deleteBtn').addEventListener('click', deleteMinute);
  document.getElementById('qrModalClose').addEventListener('click', () => {
    document.getElementById('qrModal').classList.add('hidden');
  });
  document.getElementById('emailModalClose').addEventListener('click', () => {
    document.getElementById('emailModal').classList.add('hidden');
  });
  document.getElementById('previewModalBtn').addEventListener('click', openPreviewModal);
  document.getElementById('previewFullModalClose').addEventListener('click', () => {
    document.getElementById('previewFullModal').classList.add('hidden');
  });

  document.getElementById('titleInput').addEventListener('input', () => { markDirty(); syncHeaderTitle(); });
  document.getElementById('bodyInput').addEventListener('input', () => { markDirty(); updateClearMemoBtn(); });

  // 未保存離脱警告
  window.addEventListener('beforeunload', (e) => {
    if (isDirty) { e.preventDefault(); e.returnValue = ''; }
  });
}

/* ────────────────────────────
   ユーティリティ
──────────────────────────── */
function setStatus(html, isRaw = false) {
  const el = document.getElementById('aiStatus');
  if (isRaw) el.innerHTML = html;
  else        el.textContent = html;
}

function markDirty() {
  isDirty = true;
  scheduleAutoSave();
}

/* ────────────────────────────
   自動保存
──────────────────────────── */
function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(autoSave, 30000); // 30秒後
}

async function autoSave() {
  // 新規未保存（IDなし）・変更なし・タイトル未入力 はスキップ
  const mid = currentMinute?.id || new URLSearchParams(location.search).get('id');
  if (!mid) return;
  if (!isDirty) return;
  const title = document.getElementById('titleInput').value.trim();
  if (!title) return;

  const attendees  = parseAttendees(document.getElementById('attendeesInput').value);
  const data = {
    title,
    meeting_date:     document.getElementById('meetingDate').value || null,
    meeting_time:     (document.getElementById('meetingTime').value || '').slice(0, 5) || null,
    meeting_location: document.getElementById('meetingLocation').value.trim() || null,
    attendees,
    body:             getBodyToSave(),
    raw_memo:         document.getElementById('bodyInput').value || null,
    template_type:    selectedTemplate || null,
  };

  const saved = await mlUpdateMinute(mid, data);
  if (saved && !saved._error) {
    currentMinute = saved;
    isDirty = false;
    lastSavedAt = new Date();
    updateAutoSaveStatus();
  }
}

function updateAutoSaveStatus() {
  const el = document.getElementById('autoSaveStatus');
  if (!el || !lastSavedAt) return;
  const diff = Math.floor((Date.now() - lastSavedAt) / 1000);
  if (diff < 60) el.textContent = '自動保存済み（たった今）';
  else if (diff < 3600) el.textContent = `自動保存済み（${Math.floor(diff / 60)}分前）`;
  else el.textContent = '自動保存済み';
}

// 1分ごとに「〇分前」表示を更新
setInterval(() => { if (lastSavedAt) updateAutoSaveStatus(); }, 60000);

function syncHeaderTitle() {
  const val = document.getElementById('titleInput').value.trim();
  const el  = document.getElementById('headerTitle');
  if (el) el.textContent = val || '新規議事録';
}

function goBack() {
  if (isDirty) {
    if (!confirm('保存されていない変更があります。ページを離れますか？')) return;
  }
  isDirty = false;
  location.href = 'dashboard.html';
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function nowTimeStr() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}

function parseAttendees(str) {
  return str.split(/[,、，]/).map(s => s.trim()).filter(Boolean).map(name => ({ name }));
}

function formatAttendeesForInput(attendees) {
  if (!attendees) return '';
  if (typeof attendees === 'string') return attendees;
  return attendees.map(a => (typeof a === 'string' ? a : a.name)).filter(Boolean).join(', ');
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function solidLogout() {
  location.href = '../../../space/apps.html';
}
