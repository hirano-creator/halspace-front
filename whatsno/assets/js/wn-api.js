'use strict';
/* What'sNo API ラッパー */

const WN_API_BASE = (() => {
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.test')) return 'http://127.0.0.1:8000/api';
  return 'https://halspace-api-production.up.railway.app/api';
})();

async function wnFetch(path, options = {}) {
  const token = localStorage.getItem('space_token');
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(WN_API_BASE + path, { ...options, headers });
  if (res.status === 401) {
    /* モックトークンはAPIが401を返して当然 — リダイレクトしない */
    if (token && token.startsWith('mock-token')) return null;
    localStorage.removeItem('space_token');
    localStorage.removeItem('space_user');
    location.href = '../../../space/login.html';
    return null;
  }
  return res;
}

/* ファイル一覧
   params: { tag, sort, search, liked, recent, mine, company_id } */
async function wnGetFiles(params = {}) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.set(k, v); });
  const res = await wnFetch('/wn/files?' + q.toString());
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

/* ファイル詳細 */
async function wnGetFile(id) {
  const res = await wnFetch(`/wn/files/${id}`);
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

/* ファイルアップロード（XHR・進捗コールバック付き） */
async function wnUploadFile(file, { onProgress } = {}) {
  const token = localStorage.getItem('space_token');

  // iOS Safari対策: ファイルをArrayBufferとして先読みしてからBlobに変換
  if (onProgress) onProgress(5);
  const buffer = await file.arrayBuffer();
  const blob = new Blob([buffer], { type: file.type || 'application/octet-stream' });
  const fd = new FormData();
  fd.append('file', blob, file.name);

  if (onProgress) onProgress(20);

  const res = await fetch(WN_API_BASE + '/wn/files', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: fd,
  });

  if (onProgress) onProgress(100);

  if (res.status === 401) {
    localStorage.removeItem('space_token');
    location.href = '../../../space/login.html';
    throw new Error('認証エラー');
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || `アップロードエラー (${res.status})`);
  }
  return data;
}

/* ファイル削除 */
async function wnDeleteFile(id) {
  const res = await wnFetch(`/wn/files/${id}`, { method: 'DELETE' });
  return res && res.ok;
}

/* ファイル名変更 */
async function wnRenameFile(id, fileName) {
  const res = await wnFetch(`/wn/files/${id}/rename`, {
    method: 'PATCH',
    body: JSON.stringify({ file_name: fileName }),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

/* タグ一覧 */
async function wnGetTags() {
  const res = await wnFetch('/wn/tags');
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

/* タグ並び替え保存 */
async function wnReorderTags(orders) {
  const res = await wnFetch('/wn/tags/reorder', {
    method: 'PATCH',
    body: JSON.stringify({ orders }),
  });
  return res && res.ok;
}

/* いいねトグル */
async function wnToggleLike(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/like`, { method: 'POST' });
  if (!res || !res.ok) return null;
  return res.json();
}

/* コメント一覧 */
async function wnGetComments(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/comments`);
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

/* コメント投稿 */
async function wnPostComment(fileId, body) {
  const res = await wnFetch(`/wn/files/${fileId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

/* バージョン履歴 */
async function wnGetVersions(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/versions`);
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

/* プレビュー用URL */
async function wnGetViewUrl(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/view`);
  if (!res || !res.ok) return null;
  return (await res.json()).url ?? null;
}

/* AIタグ提案取得 */
async function wnGetAiTags(fileId) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const token = localStorage.getItem('space_token');
    const res = await fetch(WN_API_BASE + `/wn/files/${fileId}/ai-tags`, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    return (await res.json()).data ?? [];
  } catch {
    return [];
  }
}

/* AIタグ確定保存 */
async function wnApplyAiTags(fileId, tags) {
  const res = await wnFetch(`/wn/files/${fileId}/ai-tags`, {
    method: 'POST',
    body: JSON.stringify({ tags }),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

/* タグ追加 */
async function wnAddTag(fileId, name) {
  const res = await wnFetch(`/wn/files/${fileId}/tags`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

/* タグ削除 */
async function wnRemoveTag(fileId, tagId) {
  const res = await wnFetch(`/wn/files/${fileId}/tags/${tagId}`, { method: 'DELETE' });
  return res && res.ok;
}

/* 類似ファイル検索 */
async function wnGetSimilarFiles(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/similar`);
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

/* 自然言語検索 */
async function wnSemanticSearch(query) {
  const res = await wnFetch(`/wn/search/semantic?q=${encodeURIComponent(query)}`);
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

/* public-view プロキシURL（認証トークン付き） */
function wnPublicViewUrl(fileId) {
  const token = localStorage.getItem('space_token');
  return WN_API_BASE + `/wn/files/${fileId}/public-view` + (token ? `?token=${encodeURIComponent(token)}` : '');
}

/* DXF テキストを取得（Shift-JIS自動判定） */
async function wnFetchDxfText(fileId) {
  const res = await fetch(wnPublicViewUrl(fileId));
  if (!res.ok) return null;
  const buffer = await res.arrayBuffer();
  // UTF-8で試してShift-JIS文字化け（0x80以上で日本語なし）なら再デコード
  let text = new TextDecoder('utf-8').decode(buffer);
  if (/�/.test(text) || (/[\x80-\xFF]/.test(text) && !/[　-鿿]/.test(text))) {
    try { text = new TextDecoder('shift-jis').decode(buffer); } catch (e) {}
  }
  return text;
}

/* ファイルを ArrayBuffer で取得（R2 署名付きURL or ローカルプロキシ両対応）
   onProgress(pct) を渡すと 0〜100 のダウンロード進捗を通知する */
async function wnFetchFileBuffer(fileId, { onProgress } = {}) {
  const urlRes = await wnFetch(`/wn/files/${fileId}/view`);
  if (!urlRes || !urlRes.ok) return null;
  const { url } = await urlRes.json();
  if (!url) return null;

  const res = await fetch(url);
  if (!res.ok) return null;

  // Content-Length があれば進捗通知、なければそのまま
  const contentLength = res.headers.get('Content-Length');
  if (!onProgress || !contentLength) return res.arrayBuffer();

  const total  = parseInt(contentLength, 10);
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.round(received / total * 100));
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  return merged.buffer;
}

/* Office Online Viewer 用パブリックプロキシURL */
function wnOfficeViewerUrl(fileId) {
  const proxyUrl = WN_API_BASE + `/wn/files/${fileId}/public-view`;
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(proxyUrl)}`;
}

/* Officeプレビュー対応拡張子か判定 */
function wnIsOfficeFile(fileName) {
  const ext = (fileName || '').split('.').pop().toLowerCase();
  return ['xlsx','xls','xlsm','docx','doc','docm','pptx','ppt','pptm'].includes(ext);
}

/* ファイル削除 */
async function wnDeleteFile(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}`, { method: 'DELETE' });
  return res && res.ok;
}

/* ダウンロード */
function wnDownload(fileId) {
  const token = localStorage.getItem('space_token');
  const a = document.createElement('a');
  a.href = WN_API_BASE + `/wn/files/${fileId}/download` +
           (token ? `?token=${encodeURIComponent(token)}` : '');
  a.target = '_blank';
  a.click();
}

/* 承認ワークフロー */
async function wnSubmitApproval(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/submit-approval`, { method: 'POST' });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}
async function wnApprove(fileId, comment = '') {
  const res = await wnFetch(`/wn/files/${fileId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}
async function wnReject(fileId, comment = '') {
  const res = await wnFetch(`/wn/files/${fileId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}
async function wnCancelApproval(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/cancel-approval`, { method: 'POST' });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

/* 承認ステータスのラベル・色 */
function wnApprovalBadge(status) {
  const map = {
    none:     { label: '承認なし',  color: '#90A4AE', bg: '#ECEFF1' },
    pending:  { label: '承認申請中', color: '#F57C00', bg: '#FFF3E0' },
    approved: { label: '承認済み',  color: '#2E7D32', bg: '#E8F5E9' },
    rejected: { label: '差し戻し',  color: '#C62828', bg: '#FFEBEE' },
  };
  return map[status] ?? map.none;
}

/* QRトークン発行 */
async function wnIssueQr(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/qr`, { method: 'POST' });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

/* アクセス分析 */
async function wnGetStats(days = 30) {
  const res = await wnFetch(`/wn/stats?days=${days}`);
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

/* 既読ユーザー一覧 */
async function wnGetViewers(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/viewers`);
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

/* 外部共有 */
async function wnCreateShare(fileId, { expiresDays, password, accessLimit } = {}) {
  const res = await wnFetch(`/wn/files/${fileId}/share`, {
    method: 'POST',
    body: JSON.stringify({
      expires_days:  expiresDays  || null,
      password:      password     || null,
      access_limit:  accessLimit  || null,
    }),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}
async function wnGetShares(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/shares`);
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}
async function wnDeleteShare(fileId, shareId) {
  const res = await wnFetch(`/wn/files/${fileId}/shares/${shareId}`, { method: 'DELETE' });
  return res && res.ok;
}

/* 通知一覧 */
async function wnGetNotifications() {
  const res = await wnFetch('/wn/notifications');
  if (!res || !res.ok) return { data: [], unread: 0 };
  return res.json();
}

/* 全件既読 */
async function wnReadAllNotifications() {
  await wnFetch('/wn/notifications/read-all', { method: 'POST' });
}

/* 1件既読 */
async function wnReadNotification(id) {
  await wnFetch(`/wn/notifications/${id}/read`, { method: 'POST' });
}

/* ファイルをメールで送信 */
async function wnSendFileByEmail(fileId, emails, message) {
  const res = await wnFetch(`/wn/files/${fileId}/send-email`, {
    method: 'POST',
    body: JSON.stringify({ emails, message }),
  });
  if (!res || !res.ok) {
    const err = await res?.json().catch(() => ({}));
    throw new Error(err.message || 'メール送信に失敗しました');
  }
  return res.json();
}

/* ── 関連ファイル ── */
async function wnGetRelations(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/relations`);
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}
async function wnAddRelation(fileId, relatedId) {
  const res = await wnFetch(`/wn/files/${fileId}/relations`, {
    method: 'POST',
    body: JSON.stringify({ related_id: relatedId }),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}
async function wnRemoveRelation(fileId, relationId) {
  const res = await wnFetch(`/wn/files/${fileId}/relations/${relationId}`, { method: 'DELETE' });
  return res && res.ok;
}
async function wnSuggestRelations(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/relations/suggest`);
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

/* ──────────────────────────────
   ユーティリティ
   ────────────────────────────── */

function wnFormatSize(bytes) {
  if (bytes < 1024)        return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 ** 3)   return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 ** 3).toFixed(2) + ' GB';
}

function wnFormatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function wnFileIcon(fileName, mimeType = '') {
  if (mimeType.startsWith('image/')) return { icon: 'fa-file-image', cls: 'file-icon-img' };
  if (mimeType.startsWith('video/')) return { icon: 'fa-file-video', cls: 'file-icon-img' };
  const ext = (fileName || '').split('.').pop().toLowerCase();
  const map = {
    pdf:  { icon: 'fa-file-pdf',    cls: 'file-icon-pdf' },
    dxf:  { icon: 'fa-file-lines',  cls: 'file-icon-dxf' },
    dwg:  { icon: 'fa-file-lines',  cls: 'file-icon-dxf' },
    stl:  { icon: 'fa-cube',        cls: 'file-icon-stl' },
    stp:  { icon: 'fa-cube',        cls: 'file-icon-stl' },
    step: { icon: 'fa-cube',        cls: 'file-icon-stl' },
    obj:  { icon: 'fa-cube',        cls: 'file-icon-stl' },
    png:  { icon: 'fa-file-image',  cls: 'file-icon-img' },
    jpg:  { icon: 'fa-file-image',  cls: 'file-icon-img' },
    jpeg: { icon: 'fa-file-image',  cls: 'file-icon-img' },
    gif:  { icon: 'fa-file-image',  cls: 'file-icon-img' },
    webp: { icon: 'fa-file-image',  cls: 'file-icon-img' },
    heic: { icon: 'fa-file-image',  cls: 'file-icon-img' },
    heif: { icon: 'fa-file-image',  cls: 'file-icon-img' },
    svg:  { icon: 'fa-file-image',  cls: 'file-icon-img' },
    mp4:  { icon: 'fa-file-video',  cls: 'file-icon-img' },
    mov:  { icon: 'fa-file-video',  cls: 'file-icon-img' },
    avi:  { icon: 'fa-file-video',  cls: 'file-icon-img' },
    xlsx: { icon: 'fa-file-excel',  cls: 'file-icon-xls' },
    xls:  { icon: 'fa-file-excel',  cls: 'file-icon-xls' },
    csv:  { icon: 'fa-file-csv',    cls: 'file-icon-xls' },
    docx: { icon: 'fa-file-word',   cls: 'file-icon-doc' },
    doc:  { icon: 'fa-file-word',   cls: 'file-icon-doc' },
    zip:  { icon: 'fa-file-zipper', cls: 'file-icon-zip' },
    rar:  { icon: 'fa-file-zipper', cls: 'file-icon-zip' },
  };
  return map[ext] ?? { icon: 'fa-file', cls: 'file-icon-other' };
}

/* ── Knowl ── */
async function wnBrainAsk(question, sessionId = null, folderId = null) {
  const res = await wnFetch('/wn/brain/ask', {
    method: 'POST',
    body: JSON.stringify({ question, session_id: sessionId, folder_id: folderId }),
  });
  if (!res || !res.ok) throw { status: res?.status };
  return res.json();
}
async function wnBrainSessions() {
  const res = await wnFetch('/wn/brain/sessions');
  if (!res || !res.ok) return [];
  return res.json();
}
async function wnBrainSession(id) {
  const res = await wnFetch(`/wn/brain/sessions/${id}`);
  if (!res || !res.ok) return {};
  return res.json();
}
async function wnBrainNewSession() {
  const res = await wnFetch('/wn/brain/sessions', { method: 'POST', body: JSON.stringify({}) });
  if (!res || !res.ok) return null;
  return res.json();
}
async function wnBrainMeter() {
  const res = await wnFetch('/wn/brain/meter');
  if (!res || !res.ok) throw new Error('meter fetch failed');
  return res.json();
}

function wnShowToast(msg, type = '') {
  const c = document.getElementById('toastContainer');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast${type ? ' toast-' + type : ''}`;
  const iconMap = { success: 'circle-check', danger: 'circle-exclamation', warning: 'triangle-exclamation' };
  t.innerHTML = `<i class="fa-solid fa-${iconMap[type] ?? 'bell'}"></i> ${msg}`;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
}
