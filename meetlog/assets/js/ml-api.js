'use strict';
/* MeetLog API ラッパー */

const ML_API_BASE = (() => {
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.test')) return 'http://127.0.0.1:8000/api';
  return 'https://halspace-api-production.up.railway.app/api';
})();

/* ログイン情報はタブごとに独立したsessionStorageに保存しているため、
   別タブで別アカウントにログインしても、このタブのセッションには影響しない。 */

async function mlFetch(path, options = {}) {
  const token = sessionStorage.getItem('space_token');
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(ML_API_BASE + path, { ...options, headers });
  if (res.status === 401) {
    if (token && token.startsWith('mock-token')) {
      mlShowToast('テスト用ログインでは本番APIを使用できません。メール・パスワードでログインしてください。', 'danger');
      setTimeout(() => { location.href = '../../../space/login.html'; }, 2500);
      return null;
    }
    sessionStorage.removeItem('space_token');
    sessionStorage.removeItem('space_user');
    location.href = '../../../space/login.html';
    return null;
  }
  return res;
}

/* ──────────────────────────────
   議事録 CRUD
   ────────────────────────────── */

async function mlGetMinutes(params = {}) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.set(k, v); });
  const res = await mlFetch('/meetlog/minutes?' + q.toString());
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

async function mlGetMinute(id) {
  const res = await mlFetch(`/meetlog/minutes/${id}`);
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

async function mlCreateMinute(data) {
  const res = await mlFetch('/meetlog/minutes', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!res || !res.ok) {
    const body = res ? await res.json().catch(() => ({})) : {};
    const msg = body.message || (body.errors ? JSON.stringify(body.errors) : `HTTP ${res?.status}`);
    console.error('mlCreateMinute error:', msg, body);
    return { _error: msg };
  }
  return (await res.json()).data ?? null;
}

async function mlUpdateMinute(id, data) {
  const res = await mlFetch(`/meetlog/minutes/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  if (!res || !res.ok) {
    const body = res ? await res.json().catch(() => ({})) : {};
    const msg = body.message || (body.errors ? JSON.stringify(body.errors) : `HTTP ${res?.status}`);
    console.error('mlUpdateMinute error:', msg, body);
    return { _error: msg };
  }
  return (await res.json()).data ?? null;
}

async function mlDeleteMinute(id) {
  const res = await mlFetch(`/meetlog/minutes/${id}`, { method: 'DELETE' });
  return res && res.ok;
}

/* ──────────────────────────────
   AI支援
   ────────────────────────────── */

async function mlAiFormat(rawText, templateType = '', outputStyle = 'standard') {
  const res = await mlFetch('/meetlog/minutes/ai-format', {
    method: 'POST',
    body: JSON.stringify({ raw_text: rawText, template_type: templateType, output_style: outputStyle }),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data?.body ?? null;
}

async function mlAiExtractActions(id) {
  const res = await mlFetch(`/meetlog/minutes/${id}/ai-extract-actions`, { method: 'POST' });
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

async function mlAiGenerateFollowUpEmail(id) {
  const res = await mlFetch(`/meetlog/minutes/${id}/ai-follow-up-email`, { method: 'POST' });
  if (!res || !res.ok) return null;
  return (await res.json()).data?.email_text ?? null;
}

/* ──────────────────────────────
   承認ワークフロー
   ────────────────────────────── */

async function mlSubmitApproval(id) {
  const res = await mlFetch(`/meetlog/minutes/${id}/submit-approval`, { method: 'POST' });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}
async function mlApprove(id, comment = '') {
  const res = await mlFetch(`/meetlog/minutes/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}
async function mlReject(id, comment = '') {
  const res = await mlFetch(`/meetlog/minutes/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}
async function mlCancelApproval(id) {
  const res = await mlFetch(`/meetlog/minutes/${id}/cancel-approval`, { method: 'POST' });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

/* ──────────────────────────────
   アクションアイテム
   ────────────────────────────── */

async function mlGetActions(minuteId) {
  const res = await mlFetch(`/meetlog/minutes/${minuteId}/actions`);
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

async function mlAddAction(minuteId, data) {
  const res = await mlFetch(`/meetlog/minutes/${minuteId}/actions`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

async function mlUpdateAction(minuteId, actionId, data) {
  const res = await mlFetch(`/meetlog/minutes/${minuteId}/actions/${actionId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

async function mlDeleteAction(minuteId, actionId) {
  const res = await mlFetch(`/meetlog/minutes/${minuteId}/actions/${actionId}`, { method: 'DELETE' });
  return res && res.ok;
}

async function mlGetMyActions() {
  const res = await mlFetch('/meetlog/my-actions');
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

/* ──────────────────────────────
   テンプレート
   ────────────────────────────── */

async function mlGetTemplates() {
  const res = await mlFetch('/meetlog/templates');
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

async function mlCreateTemplate(data) {
  const res = await mlFetch('/meetlog/templates', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

async function mlUpdateTemplate(id, data) {
  const res = await mlFetch(`/meetlog/templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

async function mlDeleteTemplate(id) {
  const res = await mlFetch(`/meetlog/templates/${id}`, { method: 'DELETE' });
  return res && res.ok;
}

async function mlReorderTemplates(ids) {
  const res = await mlFetch('/meetlog/templates/reorder', {
    method: 'PATCH',
    body: JSON.stringify({ ids }),
  });
  return res && res.ok;
}

/* ──────────────────────────────
   添付画像
   ────────────────────────────── */

async function mlUploadAttachment(minuteId, file) {
  const token = sessionStorage.getItem('space_token');
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${ML_API_BASE}/meetlog/minutes/${minuteId}/attachments`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: formData,
  });
  if (res.status === 401) {
    if (token && token.startsWith('mock-token')) {
      mlShowToast('テスト用ログインでは本番APIを使用できません。メール・パスワードでログインしてください。', 'danger');
      setTimeout(() => { location.href = '../../../space/login.html'; }, 2500);
      return null;
    }
    sessionStorage.removeItem('space_token');
    sessionStorage.removeItem('space_user');
    location.href = '../../../space/login.html';
    return null;
  }
  if (!res.ok) return null;
  return (await res.json()).data ?? null;
}

async function mlGetAttachmentUrl(minuteId, attachmentId) {
  const res = await mlFetch(`/meetlog/minutes/${minuteId}/attachments/${attachmentId}/view`);
  if (!res || !res.ok) return null;
  return (await res.json()).data?.url ?? null;
}

async function mlDeleteAttachment(minuteId, attachmentId) {
  const res = await mlFetch(`/meetlog/minutes/${minuteId}/attachments/${attachmentId}`, { method: 'DELETE' });
  return res && res.ok;
}

/* ──────────────────────────────
   QR
   ────────────────────────────── */

async function mlIssueQr(minuteId) {
  const res = await mlFetch(`/meetlog/minutes/${minuteId}/qr`, { method: 'POST' });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

function mlQrViewUrl(token) {
  return ML_API_BASE + `/meetlog/minutes/qr/${token}`;
}

/* ──────────────────────────────
   ユーティリティ
   ────────────────────────────── */

function mlShowToast(msg, type = '') {
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

function mlFormatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function mlApprovalBadge(status) {
  const map = {
    none:     { label: '承認なし',  color: '#90A4AE', bg: '#ECEFF1' },
    pending:  { label: '承認申請中', color: '#F57C00', bg: '#FFF3E0' },
    approved: { label: '承認済み',  color: '#2E7D32', bg: '#E8F5E9' },
    rejected: { label: '差し戻し',  color: '#C62828', bg: '#FFEBEE' },
  };
  return map[status] ?? map.none;
}

function mlIsOverdue(dueDateStr) {
  if (!dueDateStr) return false;
  return new Date(dueDateStr) < new Date(new Date().toDateString());
}
