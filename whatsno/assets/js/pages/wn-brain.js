'use strict';

let currentSessionId = null;
let isThinking = false;

// ─── 初期化 ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const currentUser = requireSpaceAuth();
  if (!currentUser) return;

  const user = currentUser;
  if (user) {
    document.getElementById('sidebarUser').innerHTML =
      `<div style="font-size:13px;font-weight:600;color:var(--text);">${escHtml(user.name)}</div>` +
      `<div style="font-size:11px;color:var(--muted);">${escHtml(user.email ?? '')}</div>`;
    if (isAdmin(user)) {
      const adminLink = document.getElementById('adminLink');
      if (adminLink) adminLink.style.display = '';
    }
  }

  initInput();
  initHistoryPanel();

  await Promise.all([loadMeter(), loadHistory()]);
});

// ─── Knowl メーター ───────────────────────────────────────
async function loadMeter() {
  try {
    const data = await wnBrainMeter();
    const rate = data.fill_rate ?? 0;
    document.getElementById('meterRate').textContent = rate + '%';
    document.getElementById('meterBar').style.width = rate + '%';
    document.getElementById('meterLabel').textContent =
      `学習済み ${data.indexed_files ?? 0} 件 / 全 ${data.total_files ?? 0} 件`;

    if (data.gap_tags && data.gap_tags.length > 0) {
      document.getElementById('meterGapText').textContent = data.gap_tags.join('・');
      document.getElementById('meterGapAlert').style.display = '';
    }
  } catch (e) {
    document.getElementById('meterLabel').textContent = '取得失敗';
  }
}

// ─── チャット送信 ─────────────────────────────────────────
async function sendQuestion(question) {
  if (isThinking || !question.trim()) return;
  isThinking = true;

  const input = document.getElementById('brainInput');
  const sendBtn = document.getElementById('brainSendBtn');
  input.value = '';
  input.style.height = 'auto';
  sendBtn.disabled = true;

  setEmptyIconThinking(true);
  hideBrainEmpty();
  appendUserBubble(question);
  const thinkingEl = appendThinkingBubble();

  try {
    const res = await wnBrainAsk(question, currentSessionId);
    thinkingEl.remove();
    appendAiBubble(res.answer, res.sources ?? []);
    currentSessionId = res.session_id;
    loadHistory();
  } catch (err) {
    thinkingEl.remove();
    const msg = err?.status === 429
      ? 'AI の利用制限に達しました。しばらく経ってからお試しください。'
      : '回答の取得中にエラーが発生しました。';
    appendAiBubble(msg, []);
  } finally {
    isThinking = false;
    setEmptyIconThinking(false);
    sendBtn.disabled = (input.value.trim() === '');
  }
}

function setEmptyIconThinking(on) {
  document.getElementById('brainEmpty')
    ?.querySelector('.brain-empty-icon')
    ?.classList.toggle('thinking', on);
}

// ─── バブル描画 ───────────────────────────────────────────
function hideBrainEmpty() {
  const el = document.getElementById('brainEmpty');
  if (el) el.style.display = 'none';
}

function appendUserBubble(text) {
  const chatArea = document.getElementById('chatArea');
  const div = document.createElement('div');
  div.className = 'brain-bubble-user';
  div.textContent = text;
  chatArea.appendChild(div);
  scrollToBottom();
}

function appendThinkingBubble() {
  const chatArea = document.getElementById('chatArea');
  const div = document.createElement('div');
  div.className = 'brain-bubble-ai';
  div.innerHTML =
    '<span class="brain-thinking"><span></span><span></span><span></span></span>';
  chatArea.appendChild(div);
  scrollToBottom();
  return div;
}

function appendAiBubble(answer, sources) {
  const chatArea = document.getElementById('chatArea');
  const div = document.createElement('div');
  div.className = 'brain-bubble-ai';

  // テキスト（改行を<br>に変換）
  const textNode = document.createElement('div');
  textNode.innerHTML = escHtml(answer).replace(/\n/g, '<br>');
  div.appendChild(textNode);

  // 出典
  if (sources.length > 0) {
    const sourcesEl = document.createElement('div');
    sourcesEl.className = 'brain-sources';
    sources.forEach(s => {
      const tag = document.createElement('a');
      tag.className = 'brain-source-tag';
      tag.href = `file-detail.html?id=${s.id}`;
      tag.innerHTML = `<i class="fa-solid fa-file-lines"></i> ${escHtml(s.file_name)}`;
      sourcesEl.appendChild(tag);
    });
    div.appendChild(sourcesEl);
  }

  chatArea.appendChild(div);
  scrollToBottom();
}

function scrollToBottom() {
  const chatArea = document.getElementById('chatArea');
  chatArea.scrollTop = chatArea.scrollHeight;
}

// ─── 入力エリア ───────────────────────────────────────────
function initInput() {
  const input = document.getElementById('brainInput');
  const sendBtn = document.getElementById('brainSendBtn');

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
    sendBtn.disabled = input.value.trim() === '';
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) sendQuestion(input.value.trim());
    }
  });

  sendBtn.addEventListener('click', () => {
    if (!sendBtn.disabled) sendQuestion(input.value.trim());
  });

  // サンプル質問ボタン
  document.getElementById('exampleList')?.querySelectorAll('.brain-example-btn').forEach(btn => {
    btn.addEventListener('click', () => sendQuestion(btn.dataset.q));
  });

  // 新しい会話
  document.getElementById('newSessionBtn').addEventListener('click', startNewSession);

  initVoice();
}

// ─── 音声入力 ────────────────────────────────────────────
function initVoice() {
  const btn = document.getElementById('brainVoiceBtn');
  const icon = document.getElementById('brainVoiceIcon');
  if (!btn) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    btn.style.display = 'none';
    return;
  }

  const recog = new SpeechRecognition();
  recog.lang = 'ja-JP';
  recog.interimResults = true;
  recog.continuous = false;

  let isRecording = false;

  btn.addEventListener('click', () => {
    if (isThinking) return;
    if (isRecording) {
      recog.stop();
    } else {
      recog.start();
    }
  });

  recog.onstart = () => {
    isRecording = true;
    btn.classList.add('recording');
    icon.className = 'fa-solid fa-stop';
    wnShowToast('音声認識中…', 'info');
  };

  recog.onresult = (e) => {
    const input = document.getElementById('brainInput');
    const transcript = Array.from(e.results)
      .map(r => r[0].transcript)
      .join('');
    input.value = transcript;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
  };

  recog.onend = () => {
    isRecording = false;
    btn.classList.remove('recording');
    icon.className = 'fa-solid fa-microphone';

    const input = document.getElementById('brainInput');
    const q = correctVoiceQuery(input.value.trim());
    if (q) {
      input.value = q;
      sendQuestion(q);
    }
  };

  recog.onerror = (e) => {
    isRecording = false;
    btn.classList.remove('recording');
    icon.className = 'fa-solid fa-microphone';
    if (e.error !== 'no-speech') {
      wnShowToast('音声認識エラー: ' + e.error, 'error');
    }
  };
}

// ダッシュボードの補正辞書を流用（簡易版）
const KNOWL_CORRECTION_DICT = {
  'はるすぺーす': 'HaLSpace',
  'でぃーえっくすえふ': 'DXF',
  'えすてぃーえる': 'STL',
  'えすてぃーぴー': 'STP',
  'ぴーでぃーえふ': 'PDF',
  'えすゆーえす': 'SUS',
  'すてんれす': 'ステンレス',
  'ようせつ': '溶接',
  'よねつ': '予熱',
  'とそう': '塗装',
  'けんさ': '検査',
  'ひんしつ': '品質',
  'てじゅん': '手順',
  'しようしょ': '仕様書',
  'きじゅん': '基準',
};

function correctVoiceQuery(text) {
  if (!text) return text;
  const lower = text.toLowerCase();
  for (const [k, v] of Object.entries(KNOWL_CORRECTION_DICT)) {
    if (lower.includes(k)) return text.replace(new RegExp(k, 'gi'), v);
  }
  return text;
}

// ─── セッション管理 ───────────────────────────────────────
function startNewSession() {
  currentSessionId = null;
  const chatArea = document.getElementById('chatArea');
  // チャット内のバブルを全削除してemptyを再表示
  Array.from(chatArea.children).forEach(c => {
    if (!c.id) c.remove();
  });
  const emptyEl = document.getElementById('brainEmpty');
  if (emptyEl) emptyEl.style.display = '';
}

// ─── 会話履歴パネル ───────────────────────────────────────
function initHistoryPanel() {
  const btn = document.getElementById('historyToggleBtn');
  const panel = document.getElementById('historyPanel');

  btn.addEventListener('click', () => {
    panel.classList.toggle('open');
  });

  // パネル外クリックで閉じる
  document.addEventListener('click', e => {
    if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      panel.classList.remove('open');
    }
  });
}

async function loadHistory() {
  const listEl = document.getElementById('historyList');
  try {
    const res = await wnBrainSessions();
    const sessions = res.data ?? res ?? [];
    if (!sessions.length) {
      listEl.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0;">履歴はありません</div>';
      return;
    }
    listEl.innerHTML = '';
    sessions.forEach(s => {
      const item = document.createElement('div');
      item.className = 'brain-history-item' + (s.id === currentSessionId ? ' active' : '');
      item.innerHTML =
        `<div class="brain-history-preview">${escHtml(s.preview ?? '（空の会話）')}</div>` +
        `<div class="brain-history-date">${formatDate(s.updated_at)}</div>`;
      item.addEventListener('click', () => loadSession(s.id));
      listEl.appendChild(item);
    });
  } catch {
    listEl.innerHTML = '<div style="font-size:12px;color:var(--muted);">取得失敗</div>';
  }
}

async function loadSession(id) {
  if (isThinking) return;
  currentSessionId = id;

  const panel = document.getElementById('historyPanel');
  panel.classList.remove('open');

  const chatArea = document.getElementById('chatArea');
  // バブルをクリア
  Array.from(chatArea.children).forEach(c => { if (!c.id) c.remove(); });

  const emptyEl = document.getElementById('brainEmpty');
  if (emptyEl) emptyEl.style.display = 'none';

  try {
    const data = await wnBrainSession(id);
    const messages = data.messages ?? [];
    if (!messages.length) {
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    messages.forEach(msg => {
      if (msg.role === 'user') {
        appendUserBubble(msg.content);
      } else {
        appendAiBubble(msg.content, msg.sources ?? []);
      }
    });
  } catch {
    appendAiBubble('セッションの読み込みに失敗しました。', []);
  }

  // 履歴アイテムのアクティブ状態を更新
  document.querySelectorAll('.brain-history-item').forEach(el => el.classList.remove('active'));
}

// ─── ユーティリティ ───────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'たった今';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '時間前';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}
