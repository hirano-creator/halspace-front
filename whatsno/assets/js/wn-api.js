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
   params: { tag, sort, search, liked, recent, mine, company_id }
   返り値: { data: [], error: null }  or  { data: null, error: 'msg' }
   - エラーと「本当に空」を区別するため戻り値を構造化
   - 5xx/ネットワーク失敗は1回だけ自動リトライ */
async function wnGetFiles(params = {}) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.set(k, v); });
  const path = '/wn/files?' + q.toString();

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await wnFetch(path);
      if (!res) return { data: null, error: 'auth' };           /* wnFetchが401でリダイレクト済み */
      if (res.status >= 500) {
        if (attempt < 2) { await new Promise(r => setTimeout(r, 800)); continue; }
        return { data: null, error: `server-${res.status}` };
      }
      if (!res.ok) return { data: null, error: `http-${res.status}` };
      const json = await res.json();
      return { data: json.data ?? [], error: null };
    } catch (e) {
      if (attempt < 2) { await new Promise(r => setTimeout(r, 800)); continue; }
      return { data: null, error: 'network' };
    }
  }
  return { data: null, error: 'unknown' };
}

/* ファイル詳細 */
async function wnGetFile(id, { skipAi = true } = {}) {
  /* 既定で AI 生成をスキップしてレスポンスを即時化（重い PDF で詰まる対策）。
     AI 説明文の再生成が必要な時は skipAi: false で呼び出す */
  const qs  = skipAi ? '?skip_ai=1' : '';
  const res = await wnFetch(`/wn/files/${id}${qs}`);
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

/* ファイルアップロード（XHR・進捗コールバック付き）
   - multipart ではなく raw バイナリで送信（CF Workers のメモリ二重バッファ回避）
   - サーバー側は Content-Type が multipart 以外なら X-File-Name ヘッダーで名前を受け取る */
async function wnUploadFile(file, { onProgress } = {}) {
  const token = localStorage.getItem('space_token');

  // ArrayBuffer 経由で Blob に変換（iOS Safari の File 参照無効化対策）
  const buffer = await file.arrayBuffer();
  const blob = new Blob([buffer], { type: file.type || 'application/octet-stream' });

  // 本番環境では同一オリジンのプロキシ経由でアップロード（iOS Safari CORS回避）
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const uploadUrl = isLocal ? WN_API_BASE + '/wn/files' : '/api/wn-upload';

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Content-Type', blob.type);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.onprogress = e => {
      if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 401) {
        localStorage.removeItem('space_token');
        location.href = '../../../space/login.html';
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error('レスポンスの解析に失敗しました')); }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.message || `アップロードエラー (${xhr.status})`));
        } catch {
          reject(new Error(`アップロードエラー (${xhr.status})`));
        }
      }
    };
    xhr.onerror = () => reject(new Error(`ネットワークエラー (XHR)`));
    xhr.ontimeout = () => reject(new Error('タイムアウト'));
    xhr.timeout = 300000;
    xhr.send(blob);
  });
}

/* 既存ファイルの内容を上書き（新バージョンを作らない） */
async function wnOverwriteFile(id, file) {
  const token = localStorage.getItem('space_token');
  const buffer = await file.arrayBuffer();
  const blob = new Blob([buffer], { type: file.type || 'application/octet-stream' });

  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const url = isLocal ? WN_API_BASE + `/wn/files/${id}/overwrite` : `/api/wn-upload?overwrite=${id}`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Content-Type', blob.type);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.onload = () => {
      if (xhr.status === 401) {
        localStorage.removeItem('space_token');
        location.href = '../../../space/login.html';
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error('レスポンスの解析に失敗しました')); }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.message || `上書きエラー (${xhr.status})`));
        } catch {
          reject(new Error(`上書きエラー (${xhr.status})`));
        }
      }
    };
    xhr.onerror = () => reject(new Error('ネットワークエラー (XHR)'));
    xhr.ontimeout = () => reject(new Error('タイムアウト'));
    xhr.timeout = 300000;
    xhr.send(blob);
  });
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
async function wnFetchFileBuffer(fileId, { onProgress, timeoutMs = 120000 } = {}) {
  /* AbortController で各 fetch にタイムアウトを設ける（既定 120 秒） */
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error('タイムアウト（' + Math.round(timeoutMs/1000) + '秒）')), timeoutMs);
  try {
    const urlRes = await wnFetch(`/wn/files/${fileId}/view`, { signal: ctl.signal });
    if (!urlRes || !urlRes.ok) {
      throw new Error('署名URL取得に失敗 (status=' + (urlRes?.status ?? 'no response') + ')');
    }
    const { url } = await urlRes.json();
    if (!url) throw new Error('署名URLが空です');

    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error('ファイル取得に失敗 (status=' + res.status + ')');

    const contentLength = res.headers.get('Content-Length');
    if (!onProgress || !contentLength) return await res.arrayBuffer();

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
  } catch (e) {
    console.error('[wnFetchFileBuffer] fileId=' + fileId, e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* Office Online Viewer 用パブリックプロキシURL
   - Microsoft側がプロキシを取得するため token をURLに付与する
   - localhost / .test ではMicrosoftから到達不可能なため null を返す（呼び出し側でフォールバック表示） */
function wnOfficeViewerUrl(fileId) {
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.test')) return null;
  const token = localStorage.getItem('space_token');
  if (!token) return null;
  const proxyUrl = WN_API_BASE + `/wn/files/${fileId}/public-view?token=${encodeURIComponent(token)}`;
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
  /* 拡張子最優先（DB の mime_type が誤登録されていても正しいアイコンを返す）。
     map に該当しなければ mime_type からのフォールバックを使う */
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
  if (map[ext]) return map[ext];
  /* 拡張子マップに無ければ mime_type からフォールバック */
  if (mimeType.startsWith('image/')) return { icon: 'fa-file-image', cls: 'file-icon-img' };
  if (mimeType.startsWith('video/')) return { icon: 'fa-file-video', cls: 'file-icon-img' };
  return { icon: 'fa-file', cls: 'file-icon-other' };
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
