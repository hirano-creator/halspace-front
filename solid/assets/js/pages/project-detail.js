'use strict';

const user = requireSpaceAuth();
if (!user) throw new Error('未認証');
renderSidebarUser(user);
if (isAdmin(user)) document.getElementById('adminLink').style.display = '';

const params = new URLSearchParams(location.search);
const projId = Number(params.get('id')) || 1;
let project  = null;
let comments = [];
let allModelers = [];

/* タイムライン設定 */
const STEPS = [
  { key:'submitted',      label:'図面提出' },
  { key:'in_progress',    label:'モデリング中' },
  { key:'review_pending', label:'管理者検査' },
  { key:'approved',       label:'発注者確認' },
  { key:'delivered',      label:'納品完了' },
];
const STATUS_ORDER = ['draft','submitted','in_progress','review_pending',
                      'revision_requested','approved','delivered'];
function statusRank(s) { return STATUS_ORDER.indexOf(s); }

const STATUS_LABEL = {
  draft:'下書き', submitted:'提出済み', in_progress:'モデリング中',
  review_pending:'検査待ち', revision_requested:'修正依頼中',
  approved:'承認済み', delivered:'納品完了', cancelled:'キャンセル',
};

/* ── データ取得 ── */
async function loadProject() {
  try {
    const data = await api.get(`/projects/${projId}`);
    project  = data.project;
    comments = project.comments ?? [];
  } catch {
    /* APIが使えない場合はモックにフォールバック */
    project  = MOCK.projects.find(p => p.id === projId) || MOCK.projects[0];
    comments = [...MOCK.comments];
    project.files = MOCK.files;
  }
  renderAll();
}

function renderAll() {
  renderTimeline();
  renderInfo();
  renderDeadlinePanel();
  renderFiles();
  initChatTabs();
  renderChat();
}

/* ── タイムライン描画 ── */
function renderTimeline() {
  const tl   = document.getElementById('timeline');
  const rank = statusRank(project.status);
  tl.innerHTML = STEPS.map((s, i) => {
    const stepRank = statusRank(s.key);
    const isDone   = rank > stepRank;
    const isActive = rank === stepRank || (project.status === 'revision_requested' && s.key === 'review_pending');
    return `
      <div class="timeline-step ${isDone?'done':''} ${isActive?'active':''}">
        <div class="timeline-dot">
          <i class="fa-solid ${isDone?'fa-check':isActive?'fa-spinner':String(i+1)}"></i>
        </div>
        <span class="timeline-label">${s.label}</span>
      </div>
      ${i < STEPS.length-1 ? `<div style="flex:1;height:2px;background:${isDone?'var(--accent)':'var(--border)'};align-self:flex-start;margin-top:15px;"></div>` : ''}`;
  }).join('');

  // 管理者検査バー: review_pending × 管理者
  const adminReviewBar = document.getElementById('adminReviewBar');
  adminReviewBar.style.display = (project.status === 'review_pending' && isAdmin(user)) ? '' : 'none';

  // 発注者確認バー: approved × 発注者
  const clientReviewBar = document.getElementById('clientReviewBar');
  clientReviewBar.style.display = (project.status === 'approved' && isClient(user)) ? '' : 'none';

  // モデラー用アクションバー
  const modelerActionBar = document.getElementById('modelerActionBar');
  const startBtn  = document.getElementById('startModelingBtn');
  const submitBtn = document.getElementById('submitModelBtn');
  const resumeBtn = document.getElementById('resumeModelingBtn');
  if (isModeler(user)) {
    const s = project.status;
    modelerActionBar.style.display = ['submitted','in_progress','revision_requested','review_pending'].includes(s) ? '' : 'none';
    startBtn.style.display  = s === 'submitted' ? '' : 'none';
    submitBtn.style.display = ['in_progress','review_pending'].includes(s) ? '' : 'none';
    resumeBtn.style.display = s === 'revision_requested' ? '' : 'none';
  } else {
    modelerActionBar.style.display = 'none';
  }

  /* キャンセルボタン: 発注者・管理者のみ、完了・キャンセル済み以外で表示 */
  const cancelBar = document.getElementById('cancelBar');
  const canCancel = (isClient(user) || isAdmin(user))
    && !['delivered', 'cancelled'].includes(project.status);
  cancelBar.style.display = canCancel ? '' : 'none';
}

/* ── プロジェクト情報テーブル ── */
function renderInfo() {
  document.getElementById('topBarTitle').textContent = project.title;
  document.getElementById('statusBadge').className   = `badge badge-${project.status}`;
  document.getElementById('statusBadge').textContent  = STATUS_LABEL[project.status];

  const companyName = project.company_name ?? project.company ?? '—';
  const modelerName = project.modeler_name ?? project.modeler;

  const modelerCell = modelerName || '<span style="color:var(--muted)">未割当</span>';

  const rows = [
    ['プロジェクトコード', `<code style="color:var(--blue)">${project.project_code}</code>`],
    ['会社名', companyName],
    ['担当モデラー', modelerCell],
    ['発注日', (project.created_at||'—').slice(0,10)],
    ['納品日', project.delivered_at || '—'],
    ['優先度', `<span class="priority-${project.priority}">${{urgent:'緊急',high:'高',normal:'通常',low:'低'}[project.priority]||project.priority}</span>`],
  ];
  if (project.description) rows.push(['説明', `<span style="white-space:pre-wrap;font-size:13px;">${escapeHtml(project.description)}</span>`]);
  if (project.spec_note)   rows.push(['仕様・備考', `<span style="white-space:pre-wrap;font-size:13px;">${escapeHtml(project.spec_note)}</span>`]);

  document.getElementById('infoTable').innerHTML = rows.map(([k, v]) =>
    `<tr style="border-bottom:1px solid var(--border);">
       <td style="padding:10px 0;color:var(--muted);width:140px;font-size:13px;vertical-align:top;">${k}</td>
       <td style="padding:10px 0;font-size:14px;">${v}</td>
     </tr>`).join('');

}

/* ── ファイル一覧 ── */
const TYPE_LABEL = {
  drawing_dxf:'図面（DXF）', drawing_pdf:'図面（PDF）',
  model_3d:'3Dモデル', reference:'参考資料', delivery:'納品データ',
  revision:'修正依頼資料',
};
const DRAWING_TYPES  = ['drawing_dxf', 'drawing_pdf', 'reference'];
const MODEL_TYPES    = ['model_3d', 'delivery'];
const REVISION_TYPES = ['revision'];

function renderFiles() {
  const allFiles     = project.files ?? [];
  const drawingFiles  = allFiles.filter(f => DRAWING_TYPES.includes(f.file_type));
  const modelFiles    = allFiles.filter(f => MODEL_TYPES.includes(f.file_type));
  const revisionFiles = allFiles.filter(f => REVISION_TYPES.includes(f.file_type));

  // 3Dモデルエリアの表示制御
  const modelArea      = document.getElementById('modelFileArea');
  const lockedMsg      = document.getElementById('modelFileLockedMsg');
  // 管理者はプロジェクト進行中ならいつでもファイル単位の検査・納品が可能
  const isAdminReview  = isAdmin(user)
    && ['in_progress','review_pending','revision_requested','approved'].includes(project.status);
  // モデラーはファイル単位で検査依頼が可能
  const isModelerSubmit = isModeler(user)
    && ['in_progress','review_pending','revision_requested'].includes(project.status);

  // 発注者には「納品済み」ファイル＋（承認後は）検査OKファイルを表示
  const visibleModelFiles = isClient(user)
    ? modelFiles.filter(f =>
        f.review_status === 'delivered' ||
        (['approved','delivered'].includes(project.status) && f.review_status === 'ok'))
    : modelFiles;
  const clientLocked = isClient(user)
    && !['approved','delivered'].includes(project.status)
    && visibleModelFiles.length === 0;

  if (clientLocked) {
    lockedMsg.style.display = '';
    modelArea.innerHTML = '';
  } else {
    lockedMsg.style.display = 'none';
    renderFileSection(modelArea, visibleModelFiles, !isClient(user), isAdminReview, isModelerSubmit);
  }

  // 図面・参考資料エリア（全員表示）
  renderFileSection(document.getElementById('drawingFileArea'), drawingFiles, isAdmin(user) || isModeler(user));

  // 修正依頼ファイルエリア: file_type=revision OR (model_3d && review_status=revision)
  const allRevisionFiles = allFiles.filter(f =>
    REVISION_TYPES.includes(f.file_type) ||
    (MODEL_TYPES.includes(f.file_type) && f.review_status === 'revision')
  );
  const revisionCard = document.getElementById('revisionFileCard');
  if (allRevisionFiles.length > 0) {
    revisionCard.style.display = '';
    renderFileSection(document.getElementById('revisionFileArea'), allRevisionFiles, isAdmin(user) || isModeler(user));
  } else {
    revisionCard.style.display = 'none';
  }

  // 管理者検査バーのボタン状態を更新
  updateAdminReviewBarState();

  // モデラーのアップロードボタン: in_progress / revision_requested / review_pending
  const uploadBtn = document.getElementById('uploadModelBtn');
  if (isModeler(user) && ['in_progress', 'revision_requested', 'review_pending'].includes(project.status)) {
    uploadBtn.style.display = '';
  } else {
    uploadBtn.style.display = 'none';
  }

  /* 図面・参考資料の追加（全ロール共通）*/
  const drawingInput = document.getElementById('drawingFileInput');
  if (drawingInput && !drawingInput.dataset.bound) {
    drawingInput.dataset.bound = '1';
    drawingInput.addEventListener('change', async e => {
      const files = Array.from(e.target.files);
      if (!files.length) return;
      for (const file of files) {
        const ext = file.name.split('.').pop().toLowerCase();
        const fileType = ['dxf', 'dwg'].includes(ext) ? 'drawing_dxf'
                       : ext === 'pdf'                ? 'drawing_pdf'
                       : 'reference';
        const fd = new FormData();
        fd.append('file', file);
        fd.append('file_type', fileType);
        try {
          const data = await apiFetchForm(`/projects/${projId}/files`, fd);
          project.files = [...(project.files ?? []), data.file];
          renderFiles();
          showToast(`${file.name} を追加しました`, 'success');
        } catch {
          showToast(`${file.name} のアップロードに失敗しました`, 'danger');
        }
      }
      e.target.value = '';
    });
  }

  /* モデラー用ファイルアップロード（アップロードボタンから直接追加する場合）*/
  const modelInput = document.getElementById('modelFileInput');
  if (modelInput && !modelInput.dataset.bound) {
    modelInput.dataset.bound = '1';
    modelInput.addEventListener('change', async e => {
      const files = Array.from(e.target.files);
      if (!files.length) return;
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('file_type', 'model_3d');
        try {
          const data = await apiFetchForm(`/projects/${projId}/files`, fd);
          project.files = [...(project.files ?? []), data.file];
          renderFiles();
          showToast(`${file.name} をアップロードしました`, 'success');
        } catch {
          showToast(`${file.name} のアップロードに失敗しました`, 'danger');
        }
      }
      e.target.value = '';
    });
  }
}

const REVIEW_BADGE = {
  submitted: '<span class="badge badge-review_pending" style="font-size:11px;margin-right:4px;">検査依頼中</span>',
  ok:        '<span class="badge badge-approved" style="font-size:11px;margin-right:4px;">OK</span>',
  revision:  '<span class="badge badge-revision_requested" style="font-size:11px;margin-right:4px;">修正依頼</span>',
  delivered: '<span class="badge badge-delivered" style="font-size:11px;margin-right:4px;"><i class="fa-solid fa-truck" style="margin-right:3px;"></i>納品済み</span>',
};

function renderFileSection(area, files, canDelete, showAdminBtns = false, showModelerBtns = false) {
  if (!files.length) {
    area.innerHTML = '<p style="color:var(--muted);padding:12px 0;font-size:13px;">ファイルがありません</p>';
    return;
  }

  area.innerHTML = files.map(f => {
    const ext = f.file_name.split('.').pop().toLowerCase();
    const canPreview = ['pdf', 'dxf', 'dwg', 'stl', 'stp', 'step'].includes(ext);

    const reviewBadge = REVIEW_BADGE[f.review_status] || '';
    const isDelivered = f.review_status === 'delivered';

    // 管理者: OK / 修正依頼 / 納品（納品済みのファイルはバッジのみ）
    const reviewBtns = (showAdminBtns && !isDelivered) ? `
      <button class="btn btn-sm file-review-ok-btn ${f.review_status === 'ok' ? 'btn-success' : 'btn-outline'}"
              data-file-id="${f.id}" style="min-width:52px;">
        <i class="fa-solid fa-check"></i> OK
      </button>
      <button class="btn btn-sm file-review-revision-btn"
              data-file-id="${f.id}"
              style="min-width:72px;${f.review_status === 'revision' ? 'background:var(--warning);color:var(--dark);border-color:var(--warning);' : ''}">
        <i class="fa-solid fa-rotate-left"></i> 修正依頼
      </button>
      <button class="btn btn-sm file-deliver-btn ${f.review_status === 'ok' ? 'btn-primary' : 'btn-outline'}"
              data-file-id="${f.id}" data-file-name="${f.file_name}"
              ${f.review_status !== 'ok' ? 'disabled style="min-width:64px;opacity:.45;cursor:not-allowed;" title="検査OKにすると納品できます"' : 'style="min-width:64px;" title="このファイルを発注者へ納品"'}>
        <i class="fa-solid fa-truck"></i> 納品
      </button>` : '';

    // モデラー: ファイル単位の検査依頼（pending/revision → submitted、submitted → 取消可）
    const modelerBtns = showModelerBtns
      ? (['pending','revision'].includes(f.review_status) ? `
      <button class="btn btn-sm btn-success file-request-review-btn"
              data-file-id="${f.id}" data-file-name="${f.file_name}" style="min-width:90px;">
        <i class="fa-solid fa-paper-plane"></i> 検査依頼
      </button>`
      : f.review_status === 'submitted' ? `
      <button class="btn btn-sm btn-outline file-cancel-review-btn"
              data-file-id="${f.id}" style="min-width:80px;">
        <i class="fa-solid fa-xmark"></i> 依頼取消
      </button>` : '')
      : '';

    return `
    <div class="upload-file-item" data-file-id="${f.id}">
      ${getFileIcon(f.file_name)}
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:600;">${f.file_name}</div>
        <div style="font-size:12px;color:var(--muted);">
          ${TYPE_LABEL[f.file_type]||f.file_type||'ファイル'} · ${formatBytes(f.file_size)} · ${f.uploaded_by_name||f.uploaded_by||''}
        </div>
      </div>
      ${reviewBadge}
      ${reviewBtns}
      ${modelerBtns}
      ${canPreview ? `<button class="file-preview-btn" data-file-id="${f.id}">
        <i class="fa-solid fa-eye"></i> プレビュー
      </button>` : ''}
      <button class="btn btn-ghost btn-sm file-download-btn" data-file-id="${f.id}"
              data-file-name="${f.file_name}" title="ダウンロード">
        <i class="fa-solid fa-download"></i>
      </button>
      ${canDelete ? `<button class="btn btn-ghost btn-sm file-delete-btn" data-file-id="${f.id}"
              data-file-name="${f.file_name}" title="削除" style="color:#e74c3c;">
        <i class="fa-solid fa-trash"></i>
      </button>` : ''}
    </div>`;
  }).join('');

  area.querySelectorAll('.file-review-ok-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = project.files.find(x => x.id === Number(btn.dataset.fileId));
      setFileReviewStatus(Number(btn.dataset.fileId), f?.review_status === 'ok' ? 'pending' : 'ok');
    });
  });
  area.querySelectorAll('.file-review-revision-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = project.files.find(x => x.id === Number(btn.dataset.fileId));
      setFileReviewStatus(Number(btn.dataset.fileId), f?.review_status === 'revision' ? 'pending' : 'revision');
    });
  });

  // 管理者: ファイル単位の納品
  area.querySelectorAll('.file-deliver-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fileName = btn.dataset.fileName;
      if (!confirm(`「${fileName}」を発注者へ納品しますか？\n納品後、発注者がこのファイルを閲覧・ダウンロードできるようになります。`)) return;
      await setFileReviewStatus(Number(btn.dataset.fileId), 'delivered');
      showToast(`${fileName} を納品しました。発注者に公開されます。`, 'success');
    });
  });

  // モデラー: ファイル単位の検査依頼／取消
  area.querySelectorAll('.file-request-review-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await setFileReviewStatus(Number(btn.dataset.fileId), 'submitted');
      showToast(`${btn.dataset.fileName} の検査を依頼しました`, 'success');
    });
  });
  area.querySelectorAll('.file-cancel-review-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await setFileReviewStatus(Number(btn.dataset.fileId), 'pending');
      showToast('検査依頼を取り消しました', 'warning');
    });
  });

  area.querySelectorAll('.file-preview-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const fid  = Number(btn.dataset.fileId);
      const file = files.find(x => x.id === fid);
      if (!file) return;
      const ext = file.file_name.split('.').pop().toLowerCase();
      if (ext === 'dxf') {
        // DXFはSheetEye（計測・寸法ツール付きビューア）で開く
        window.open(`sheeteye.html?file_id=${file.id}&name=${encodeURIComponent(file.file_name)}`, '_blank');
      } else {
        window.open(`viewer.html?file_id=${file.id}&file_name=${encodeURIComponent(file.file_name)}`, '_blank');
      }
    });
  });

  area.querySelectorAll('.file-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fid      = Number(btn.dataset.fileId);
      const fileName = btn.dataset.fileName;
      if (!confirm(`「${fileName}」を削除しますか？\nこの操作は取り消せません。`)) return;
      try {
        await api.delete(`/files/${fid}`);
        project.files = project.files.filter(f => f.id !== fid);
        renderFiles();
        showToast(`${fileName} を削除しました`, 'success');
      } catch (err) {
        showToast('削除に失敗しました: ' + (err.message || ''), 'danger');
      }
    });
  });

  area.querySelectorAll('.file-download-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fid      = Number(btn.dataset.fileId);
      const fileName = btn.dataset.fileName;
      try {
        const token = localStorage.getItem('space_token');
        const res = await fetch(`${API_BASE}/files/${fid}/download`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const contentType = res.headers.get('Content-Type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          const a = document.createElement('a');
          a.href = data.url;
          a.download = fileName;
          a.target = '_blank';
          a.click();
        } else {
          const blob = await res.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = fileName;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        }
      } catch (err) {
        showToast('ダウンロードに失敗しました: ' + err.message, 'danger');
      }
    });
  });
}

/* FormData用fetch */
async function apiFetchForm(path, formData) {
  const token = localStorage.getItem('space_token');
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: formData,
  });
  if (!res.ok) throw new Error(`API Error ${res.status}`);
  return res.json();
}

/* ══════════════════════════════════════════
   チャットルーム
   ══════════════════════════════════════════ */

function canAccessChannel(ch) {
  if (isAdmin(user)) return true;
  if (ch === 'client')  return isClient(user);
  if (ch === 'modeler') return isModeler(user);
  return false;
}

let currentChannel = isModeler(user) ? 'modeler' : 'client';
let pendingImages  = [];

function initChatTabs() {
  const tabs      = document.getElementById('chatTabs');
  const modelerTab = document.getElementById('modelerTab');

  if (isModeler(user)) {
    tabs.querySelector('[data-ch="client"]').style.display = 'none';
    currentChannel = 'modeler';
  }
  if (isClient(user)) {
    modelerTab.style.display = 'none';
  }

  tabs.querySelectorAll('.chat-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!canAccessChannel(btn.dataset.ch)) return;
      currentChannel = btn.dataset.ch;
      tabs.querySelectorAll('.chat-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderChat();
    });
  });
}

function avatarCls(role) {
  if (role === 'jp_admin')   return 'chat-avatar-admin';
  if (role === 'id_modeler') return 'chat-avatar-modeler';
  return '';
}

function renderChat() {
  const box  = document.getElementById('chatMessages');
  const list = comments.filter(c => c.channel === currentChannel);

  if (!list.length) {
    box.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:13px;padding:32px 0;">まだメッセージがありません</div>';
    return;
  }

  let lastDate = '';
  box.innerHTML = list.map(c => {
    const userName = c.user_name ?? c.user ?? '?';
    const isMine   = Number(c.user_id) === Number(user.id) || userName === user.name;
    const msgDate  = (c.created_at||'').split(' ')[0];
    let divider = '';
    if (msgDate !== lastDate) {
      lastDate = msgDate;
      divider = `<div class="chat-date-divider">${msgDate}</div>`;
    }

    const blobUrl = c._blobUrl ?? null;
    const imgApiUrl = c.image_path ?? c.image ?? null;
    // Blob URL があればそのまま表示、なければ認証付き遅延ロード
    const imgHtml = blobUrl
      ? `<img src="${blobUrl}" alt="添付画像" data-lightbox
              style="max-width:200px;border-radius:8px;cursor:pointer;">`
      : imgApiUrl
        ? `<img data-auth-img="${imgApiUrl}" alt="添付画像"
                style="max-width:200px;border-radius:8px;cursor:pointer;opacity:0.4;">`
        : '';
    const textHtml = c.body ? `<div>${escapeHtml(c.body)}</div>` : '';
    const role = c.user_role ?? c.role ?? '';
    const canDel = Number(c.user_id) === Number(user.id) || isAdmin(user);
    const delBtn = canDel
      ? `<button class="chat-del-btn" data-comment-id="${c.id}" title="削除"><i class="fa-solid fa-trash-can"></i></button>`
      : '';

    return `${divider}
    <div class="chat-msg${isMine?' mine':''}">
      ${!isMine ? `<div class="chat-avatar ${avatarCls(role)}">${userName.charAt(0)}</div>` : ''}
      <div class="chat-bubble-wrap">
        <div class="chat-meta">
          <span class="chat-meta-name">${isMine ? 'あなた' : userName}</span>
          <span>${roleLabel(role)}</span>
          <span>${(c.created_at||'').split(' ')[1] || c.created_at || ''}</span>
          ${delBtn}
        </div>
        <div class="chat-bubble">${textHtml}${imgHtml}</div>
      </div>
      ${isMine ? `<div class="chat-avatar ${avatarCls(role)}">${userName.charAt(0)}</div>` : ''}
    </div>`;
  }).join('');

  box.scrollTop = box.scrollHeight;

  box.querySelectorAll('[data-lightbox]').forEach(img => {
    img.addEventListener('click', () => openLightbox(img.src));
  });

  box.querySelectorAll('.chat-del-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteComment(Number(btn.dataset.commentId)));
  });

  // 認証付きで画像を非同期ロード
  loadAuthImages(box);
}

function loadAuthImages(container) {
  container.querySelectorAll('[data-auth-img]').forEach(async img => {
    const url = img.dataset.authImg;
    if (!url) return;
    try {
      const token = localStorage.getItem('space_token');
      const res = await fetch(url, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      img.src = blobUrl;
      img.style.opacity = '1';
      img.dataset.lightbox = '';
      img.addEventListener('click', () => openLightbox(blobUrl));
    } catch {
      img.style.display = 'none';
    }
  });
}

async function deleteComment(commentId) {
  if (!confirm('このメッセージを削除しますか？')) return;
  try {
    await apiFetch(`/comments/${commentId}`, { method: 'DELETE' });
    comments = comments.filter(c => c.id !== commentId);
    renderChat();
    showToast('メッセージを削除しました', 'success');
  } catch {
    showToast('削除に失敗しました', 'error');
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/\n/g,'<br>');
}

function renderImagePreview() {
  const area = document.getElementById('imagePreviewArea');
  if (!pendingImages.length) { area.style.display = 'none'; area.innerHTML = ''; return; }
  area.style.display = '';
  area.innerHTML = pendingImages.map((img, i) => `
    <span class="img-preview-chip">
      <img src="${img.dataUrl}" alt="">
      <span style="max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${img.name}</span>
      <button data-rm="${i}" title="削除"><i class="fa-solid fa-xmark"></i></button>
    </span>`).join('');
  area.querySelectorAll('[data-rm]').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingImages.splice(Number(btn.dataset.rm), 1);
      renderImagePreview();
    });
  });
}

document.getElementById('chatImageInput').addEventListener('change', e => {
  Array.from(e.target.files).forEach(f => {
    if (!f.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = ev => {
      pendingImages.push({ dataUrl: ev.target.result, name: f.name, file: f });
      renderImagePreview();
    };
    reader.readAsDataURL(f);
  });
  e.target.value = '';
});

async function submitComment(body, imageFile, channel) {
  const ch = channel || currentChannel;
  try {
    const fd = new FormData();
    fd.append('body', body);
    fd.append('channel', ch);
    if (imageFile) fd.append('image', imageFile);

    const data = await apiFetchForm(`/projects/${projId}/comments`, fd);
    // 投稿直後は Blob URL を使って即表示（再描画後も認証エンドポイントに差し替え）
    if (imageFile && data.comment.image_path) {
      data.comment._blobUrl = URL.createObjectURL(imageFile);
    }
    comments.push(data.comment);
    renderChat();
  } catch {
    /* フォールバック: ローカル追加 */
    comments.push({
      id: Date.now() + Math.random(),
      channel: ch,
      user_id: user.id,
      user_name: user.name,
      user_role: user.role,
      body,
      image_path: imageFile ? URL.createObjectURL(imageFile) : null,
      created_at: new Date().toLocaleString('ja-JP'),
    });
    renderChat();
  }
}

document.getElementById('commentSubmit').addEventListener('click', async () => {
  const input = document.getElementById('commentInput');
  const body  = input.value.trim();
  if (!body && !pendingImages.length) return;

  if (pendingImages.length) {
    for (const img of pendingImages) {
      await submitComment(body, img.file);
    }
    pendingImages = [];
    renderImagePreview();
  } else {
    await submitComment(body, null);
  }
  input.value = '';
});

document.getElementById('commentInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('commentSubmit').click();
  }
});

function openLightbox(src) {
  document.getElementById('imgLightboxImg').src = src;
  document.getElementById('imgLightbox').classList.remove('hidden');
}
document.getElementById('imgLightbox').addEventListener('click', () => {
  document.getElementById('imgLightbox').classList.add('hidden');
});

/* ── ステータス更新 共通 ── */
async function updateStatus(status, note) {
  try {
    const data = await api.patch(`/projects/${projId}/status`, { status, note });
    project  = data.project;
    comments = project.comments ?? [];
    renderAll();
  } catch {
    project.status = status;
    renderAll();
  }
}

/* ── ファイル単位 review_status 更新 ── */
async function setFileReviewStatus(fileId, status) {
  try {
    await api.patch(`/files/${fileId}/review-status`, { review_status: status });
    const f = project.files.find(x => x.id === fileId);
    if (f) f.review_status = status;
    renderFiles();
  } catch (err) {
    showToast('ステータス更新に失敗しました', 'danger');
  }
}

function updateAdminReviewBarState() {
  const btn = document.getElementById('adminPublishBtn');
  if (!btn) return;
  const modelFiles = (project.files ?? []).filter(f => MODEL_TYPES.includes(f.file_type));
  const hasOk = modelFiles.some(f => ['ok', 'delivered'].includes(f.review_status));
  btn.disabled = !hasOk;
  btn.style.opacity = hasOk ? '1' : '0.5';
}

/* ── 管理者: 検査完了・発注者へ公開 ── */
document.getElementById('adminPublishBtn')?.addEventListener('click', async () => {
  const modelFiles  = (project.files ?? []).filter(f => MODEL_TYPES.includes(f.file_type));
  const hasRevision = modelFiles.some(f => f.review_status === 'revision');
  const newStatus   = hasRevision ? 'revision_requested' : 'approved';
  await updateStatus(newStatus);
  if (hasRevision) {
    showToast('一部ファイルを公開しました。修正依頼ファイルはモデラーへ差し戻します。', 'warning');
  } else {
    showToast('検査OKです。発注者に3Dデータが公開されました。', 'success');
  }
});

/* ── 発注者: 納品承認 → delivered ── */
document.getElementById('clientApproveBtn')?.addEventListener('click', async () => {
  await updateStatus('delivered');
  showToast('納品を承認しました', 'success');
});

/* ── モデラーアクション ── */
document.getElementById('startModelingBtn')?.addEventListener('click', async () => {
  await updateStatus('in_progress');
  showToast('モデリングを開始しました', 'success');
});
document.getElementById('resumeModelingBtn')?.addEventListener('click', async () => {
  await updateStatus('in_progress');
  showToast('モデリングを再開しました', 'success');
});

/* ── 完成・提出モーダル ── */
let submitNewFiles = [];

function openSubmitModelModal() {
  submitNewFiles = [];
  document.getElementById('submitNewFilePreview').innerHTML = '';

  // 検査依頼の対象となる model_3d / delivery ファイルをチェックリストに表示
  // （検査OK・納品済みのファイルは再依頼不要のため除外）
  const modelFiles = (project.files ?? []).filter(f =>
    MODEL_TYPES.includes(f.file_type) && !['ok', 'delivered'].includes(f.review_status));
  const list = document.getElementById('submitFileCheckList');
  if (modelFiles.length === 0) {
    list.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0;">検査依頼できるファイルがありません</div>';
  } else {
    list.innerHTML = modelFiles.map(f => `
      <label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);
                    border-radius:8px;cursor:pointer;font-size:13px;background:var(--surface);">
        <input type="checkbox" class="submit-file-check" value="${f.id}" checked
               style="width:15px;height:15px;cursor:pointer;">
        ${getFileIcon(f.file_name)}
        <div style="flex:1;">
          <div style="font-weight:600;">${f.file_name}</div>
          <div style="font-size:11px;color:var(--muted);">${TYPE_LABEL[f.file_type]||''} · ${formatBytes(f.file_size)}${f.review_status === 'submitted' ? ' · 検査依頼中' : ''}</div>
        </div>
      </label>`).join('');
    list.querySelectorAll('.submit-file-check').forEach(cb =>
      cb.addEventListener('change', updateSubmitConfirmBtn));
  }

  document.getElementById('submitModelModal').classList.remove('hidden');
  updateSubmitConfirmBtn();
}

function updateSubmitConfirmBtn() {
  const checkedCount = document.querySelectorAll('.submit-file-check:checked').length;
  const btn = document.getElementById('submitModelConfirmBtn');
  if (!btn) return;
  const hasFile = checkedCount > 0 || submitNewFiles.length > 0;
  btn.disabled = !hasFile;
  btn.style.opacity = hasFile ? '1' : '0.45';
}

document.getElementById('submitModelBtn')?.addEventListener('click', openSubmitModelModal);
['submitModelModalClose','submitModelModalClose2'].forEach(id =>
  document.getElementById(id)?.addEventListener('click', () =>
    document.getElementById('submitModelModal').classList.add('hidden')));

// 新規ファイル追加プレビュー
document.getElementById('submitNewFileInput')?.addEventListener('change', e => {
  submitNewFiles = [...submitNewFiles, ...Array.from(e.target.files)];
  const preview = document.getElementById('submitNewFilePreview');
  preview.innerHTML = submitNewFiles.map((f, i) => `
    <span style="display:inline-flex;align-items:center;gap:4px;background:var(--surface);
                 border:1px solid var(--border);border-radius:6px;padding:3px 8px;font-size:12px;">
      <i class="fa-solid fa-file" style="color:var(--muted);font-size:10px;"></i>
      ${f.name}
      <button data-rm="${i}" style="background:none;border:none;cursor:pointer;color:var(--muted);padding:0 2px;">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </span>`).join('');
  preview.querySelectorAll('[data-rm]').forEach(btn =>
    btn.addEventListener('click', () => {
      submitNewFiles.splice(Number(btn.dataset.rm), 1);
      document.getElementById('submitNewFileInput').dispatchEvent(new Event('change'));
    }));
  e.target.value = '';
  updateSubmitConfirmBtn();
});

document.getElementById('submitModelConfirmBtn')?.addEventListener('click', async () => {
  // チェックされた既存ファイルIDを取得
  const checkedIds = Array.from(document.querySelectorAll('.submit-file-check:checked'))
    .map(cb => Number(cb.value));
  if (checkedIds.length === 0 && submitNewFiles.length === 0) {
    showToast('提出するファイルを1件以上選択してください', 'warning');
    return;
  }

  // 新規ファイルをアップロード
  const newIds = [];
  for (const file of submitNewFiles) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('file_type', 'model_3d');
    try {
      const data = await apiFetchForm(`/projects/${projId}/files`, fd);
      project.files = [...(project.files ?? []), data.file];
      newIds.push(data.file.id);
    } catch {
      showToast(`${file.name} のアップロードに失敗しました`, 'danger');
      return;
    }
  }

  // 選択されたファイルをファイル単位で検査依頼（submitted）にする
  for (const id of [...checkedIds, ...newIds]) {
    try {
      await api.patch(`/files/${id}/review-status`, { review_status: 'submitted' });
      const f = project.files.find(x => x.id === id);
      if (f) f.review_status = 'submitted';
    } catch {
      showToast('検査依頼の設定に失敗したファイルがあります', 'danger');
    }
  }

  document.getElementById('submitModelModal').classList.add('hidden');
  submitNewFiles = [];
  if (project.status === 'review_pending') {
    // すでに検査依頼中 → ステータス変更不要、ファイル追加のみ反映
    renderFiles();
    showToast('選択したファイルを検査依頼しました。管理者の検査をお待ちください。', 'success');
  } else {
    await updateStatus('review_pending');
    showToast('完成・提出しました。管理者の検査をお待ちください。', 'success');
  }
});

/* ── キャンセルモーダル ── */
const cancelModal = document.getElementById('cancelModal');
document.getElementById('cancelBtn')?.addEventListener('click', () => cancelModal.classList.remove('hidden'));
['cancelModalClose', 'cancelModalClose2'].forEach(id =>
  document.getElementById(id)?.addEventListener('click', () => cancelModal.classList.add('hidden')));
document.getElementById('cancelSubmit')?.addEventListener('click', async () => {
  const note = document.getElementById('cancelNote').value.trim();
  cancelModal.classList.add('hidden');
  if (note) await submitComment(`【キャンセル】${note}`, null);
  await updateStatus('cancelled', note || 'キャンセル');
  showToast('発注をキャンセルしました', 'warning');
});

/* ── 修正依頼モーダル ── */
let revisionPendingFiles = [];

const modal = document.getElementById('revisionModal');

function openRevisionModal() {
  revisionPendingFiles = [];
  document.getElementById('revisionNote').value = '';
  renderRevisionFilePreview();
  modal.classList.remove('hidden');
}

function renderRevisionFilePreview() {
  const area = document.getElementById('revisionFilePreview');
  if (!revisionPendingFiles.length) { area.innerHTML = ''; return; }
  area.innerHTML = revisionPendingFiles.map((f, i) => `
    <span style="display:inline-flex;align-items:center;gap:4px;background:var(--surface);
                 border:1px solid var(--border);border-radius:6px;padding:3px 8px;font-size:12px;">
      <i class="fa-solid fa-file" style="color:var(--muted);font-size:10px;"></i>
      ${f.name}
      <button data-rm="${i}" style="background:none;border:none;cursor:pointer;color:var(--muted);padding:0 2px;">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </span>`).join('');
  area.querySelectorAll('[data-rm]').forEach(btn => {
    btn.addEventListener('click', () => {
      revisionPendingFiles.splice(Number(btn.dataset.rm), 1);
      renderRevisionFilePreview();
    });
  });
}

document.getElementById('revisionFileInput')?.addEventListener('change', e => {
  revisionPendingFiles = [...revisionPendingFiles, ...Array.from(e.target.files)];
  renderRevisionFilePreview();
  e.target.value = '';
});

document.getElementById('revisionBtn')?.addEventListener('click', openRevisionModal);
['revisionModalClose', 'revisionModalClose2'].forEach(id =>
  document.getElementById(id)?.addEventListener('click', () => modal.classList.add('hidden')));

document.getElementById('revisionSubmit')?.addEventListener('click', async () => {
  const note = document.getElementById('revisionNote').value.trim();
  if (!note) { showToast('修正内容を入力してください', 'danger'); return; }

  // 添付ファイルを revision タイプでアップロード
  for (const file of revisionPendingFiles) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('file_type', 'revision');
    try {
      const data = await apiFetchForm(`/projects/${projId}/files`, fd);
      project.files = [...(project.files ?? []), data.file];
    } catch {
      showToast(`${file.name} のアップロードに失敗しました`, 'danger');
    }
  }

  await submitComment(`【修正依頼】${note}`, null);
  await updateStatus('revision_requested', note);
  modal.classList.add('hidden');
  revisionPendingFiles = [];
  showToast('修正依頼を送りました', 'warning');
});

/* ── 希望納期・納期回答パネル ── */
function renderDeadlinePanel() {
  const panel = document.getElementById('deadlinePanel');

  /* 管理者→発注者への回答（全員が参照する公式回答） */
  const replyStatus = project.deadline_reply_status ?? project.deadline_reply?.status;
  const replyDate   = project.deadline_replied      ?? project.deadline_reply?.date;
  const replyNote   = project.deadline_reply_note   ?? project.deadline_reply?.note;
  const repliedBy   = project.deadline_replied_by_name ?? project.deadline_reply?.replied_by;
  const repliedAt   = project.deadline_replied_at   ?? project.deadline_reply?.replied_at;

  const statusMap = {
    ok:          { label:'対応可能', cls:'badge-approved',            icon:'fa-circle-check' },
    negotiating: { label:'要調整',   cls:'badge-revision_requested', icon:'fa-arrows-rotate' },
  };
  const rs = statusMap[replyStatus] ?? { label:'未回答', cls:'badge-submitted', icon:'fa-clock' };

  const deadlineVal = project.deadline_requested || project.deadline_at || '—';

  /* ── 発注者ビュー ── */
  if (isClient(user)) {
    let html = `
      <div style="display:flex;align-items:center;gap:16px;padding:12px 0;flex-wrap:wrap;">
        <div style="flex:1;min-width:160px;">
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">希望納期</div>
          <div style="font-size:20px;font-weight:700;font-family:'Poppins',sans-serif;color:var(--dark);">${deadlineVal}</div>
        </div>
        <div style="flex:1;min-width:160px;">
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">回答納期</div>
          <div style="font-size:20px;font-weight:700;font-family:'Poppins',sans-serif;color:${
            replyStatus === 'ok' ? 'var(--accent)' : replyStatus === 'negotiating' ? 'var(--danger)' : 'var(--muted)'
          };">${replyDate || '—'}</div>
        </div>
        <span class="badge ${rs.cls}" style="align-self:center;">
          <i class="fa-solid ${rs.icon}" style="margin-right:4px;"></i>${rs.label}
        </span>
      </div>`;

    if (replyDate && replyNote) {
      html += `
        <div style="padding:10px 0;border-top:1px solid var(--border);font-size:13px;color:var(--muted);white-space:pre-wrap;">${escapeHtml(replyNote)}</div>`;
    }

    if (replyStatus === 'negotiating') {
      html += `
        <div style="padding:12px 0;border-top:1px solid var(--border);display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-success btn-sm" id="deadlineAcceptBtn">
            <i class="fa-solid fa-check"></i> この日程で了承する
          </button>
          <button class="btn btn-outline btn-sm" id="deadlineCounterBtn">
            <i class="fa-solid fa-rotate-left"></i> 別の日程を提案する
          </button>
        </div>`;
    }

    panel.innerHTML = html;

    document.getElementById('deadlineAcceptBtn')?.addEventListener('click', async () => {
      try {
        const data = await api.post(`/projects/${projId}/deadline-reply`, { date: replyDate, status: 'ok', note: replyNote || '' });
        project = data.project; comments = project.comments ?? [];
      } catch { project.deadline_reply_status = 'ok'; }
      renderDeadlinePanel(); renderInfo();
      showToast('日程を了承しました', 'success');
    });

    document.getElementById('deadlineCounterBtn')?.addEventListener('click', async () => {
      const newDate = prompt('新しい希望納期を入力してください（YYYY-MM-DD）:', project.deadline_requested || '');
      if (!newDate) return;
      await submitComment(`【納期再調整依頼】新しい希望納期: ${newDate}`, null);
      project.deadline_requested = newDate;
      renderDeadlinePanel(); renderInfo(); renderChat();
      showToast('新しい希望納期を送りました', 'warning');
    });
    return;
  }

  /* ── モデラービュー ── */
  if (isModeler(user)) {
    let html = `
      <div style="padding:12px 0;border-bottom:1px solid var(--border);">
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">発注者の希望納期</div>
        <div style="font-size:20px;font-weight:700;font-family:'Poppins',sans-serif;color:var(--dark);">${deadlineVal}</div>
      </div>`;

    if (!['delivered','cancelled'].includes(project.status)) {
      html += `
        <div style="padding:14px 0 4px;">
          <div style="font-size:13px;font-weight:700;margin-bottom:10px;">
            <i class="fa-solid fa-pen text-blue"></i> 管理者へ納期を回答する
          </div>
          <div style="background:rgba(9,132,227,.06);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:var(--muted);">
            <i class="fa-solid fa-lock" style="margin-right:4px;"></i>この回答は管理者にのみ通知されます。発注者には直接表示されません。
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:10px;">
            <div>
              <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">回答納期</label>
              <input type="date" id="replyDateInput" class="form-input"
                     value="${project.deadline_requested || project.deadline_at || ''}"
                     style="font-size:13px;padding:8px 10px;">
            </div>
            <div>
              <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">ステータス</label>
              <select id="replyStatusSelect" class="form-select" style="font-size:13px;padding:8px 10px;">
                <option value="ok">対応可能</option>
                <option value="negotiating">要調整</option>
              </select>
            </div>
            <div>
              <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">担当モデラー</label>
              <select id="replyModelerSelect" class="form-select" style="font-size:13px;padding:8px 10px;">
                <option value="">— 未割当 —</option>
                ${allModelers.map(m => `<option value="${m.id}" ${project.modeler_id == m.id ? 'selected' : ''}>${m.name}</option>`).join('')}
              </select>
            </div>
          </div>
          <textarea id="replyNoteInput" class="form-textarea" rows="2"
                    placeholder="管理者へのコメント（任意）"
                    style="font-size:13px;margin-bottom:8px;"></textarea>
          <button class="btn btn-primary btn-sm" id="deadlineReplySubmit">
            <i class="fa-solid fa-paper-plane"></i> 管理者へ送信する
          </button>
        </div>`;
    }

    panel.innerHTML = html;

    document.getElementById('deadlineReplySubmit')?.addEventListener('click', async () => {
      const date     = document.getElementById('replyDateInput').value;
      const status   = document.getElementById('replyStatusSelect').value;
      const note     = document.getElementById('replyNoteInput').value.trim();
      const modelerId = document.getElementById('replyModelerSelect')?.value;
      if (!date) { showToast('回答納期を選択してください', 'danger'); return; }

      // モデラー担当を更新
      if (modelerId !== undefined) {
        const upd = await api.patch(`/projects/${projId}/modeler`, {
          modeler_id: modelerId ? Number(modelerId) : null,
        });
        if (upd?.project) {
          project = upd.project;
          renderInfo();
        }
      }

      const msg = `【納期回答】${date}（${status === 'ok' ? '対応可能' : '要調整'}）${note ? '\n' + note : ''}`;
      await submitComment(msg, null, 'modeler');
      showToast('管理者へ回答を送りました', 'success');
    });
    return;
  }

  /* ── 管理者ビュー ── */
  let html = `
    <div style="display:flex;align-items:center;gap:16px;padding:12px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">
      <div style="flex:1;min-width:140px;">
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">発注者の希望納期</div>
        <div style="font-size:18px;font-weight:700;font-family:'Poppins',sans-serif;color:var(--dark);">${deadlineVal}</div>
      </div>
      <div style="flex:1;min-width:140px;">
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">発注者への回答納期</div>
        <div style="font-size:18px;font-weight:700;font-family:'Poppins',sans-serif;color:${
          replyStatus === 'ok' ? 'var(--accent)' : replyStatus === 'negotiating' ? 'var(--danger)' : 'var(--muted)'
        };">${replyDate || '未回答'}</div>
      </div>
      <span class="badge ${rs.cls}" style="align-self:center;">
        <i class="fa-solid ${rs.icon}" style="margin-right:4px;"></i>${rs.label}
      </span>
    </div>`;

  if (replyDate) {
    html += `
      <div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;color:var(--muted);">
        <i class="fa-solid fa-user" style="margin-right:4px;"></i>${repliedBy || '管理者'} &nbsp;·&nbsp; ${repliedAt || ''}
        ${replyNote ? `<div style="margin-top:4px;font-size:13px;color:var(--dark);white-space:pre-wrap;">${escapeHtml(replyNote)}</div>` : ''}
      </div>`;
  }

  if (!['delivered','cancelled'].includes(project.status)) {
    html += `
      <div style="padding:14px 0 4px;">
        <div style="font-size:13px;font-weight:700;margin-bottom:6px;">
          <i class="fa-solid fa-pen text-blue"></i> 発注者への回答納期を入力する
        </div>
        <div style="background:rgba(255,107,53,.06);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:var(--muted);">
          <i class="fa-solid fa-bullhorn" style="margin-right:4px;"></i>ここで入力した回答は発注者に表示されます。制作チームとの確認後に入力してください。
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px;">
          <div>
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">回答納期</label>
            <input type="date" id="replyDateInput" class="form-input"
                   value="${replyDate || project.deadline_requested || project.deadline_at || ''}"
                   style="font-size:13px;padding:8px 10px;">
          </div>
          <div>
            <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">ステータス</label>
            <select id="replyStatusSelect" class="form-select" style="font-size:13px;padding:8px 10px;">
              <option value="ok"          ${replyStatus==='ok'?'selected':''}>対応可能</option>
              <option value="negotiating" ${replyStatus==='negotiating'?'selected':''}>要調整</option>
            </select>
          </div>
        </div>
        <textarea id="replyNoteInput" class="form-textarea" rows="2"
                  placeholder="発注者へのコメント（任意）"
                  style="font-size:13px;margin-bottom:8px;">${replyNote || ''}</textarea>
        <button class="btn btn-primary btn-sm" id="deadlineReplySubmit">
          <i class="fa-solid fa-paper-plane"></i> 発注者へ回答を送信する
        </button>
      </div>`;
  }

  panel.innerHTML = html;

  document.getElementById('deadlineReplySubmit')?.addEventListener('click', async () => {
    const date   = document.getElementById('replyDateInput').value;
    const status = document.getElementById('replyStatusSelect').value;
    const note   = document.getElementById('replyNoteInput').value.trim();
    if (!date) { showToast('回答納期を選択してください', 'danger'); return; }
    try {
      const data = await api.post(`/projects/${projId}/deadline-reply`, { date, status, note });
      project = data.project; comments = project.comments ?? [];
    } catch {
      project.deadline_replied = date;
      project.deadline_reply_status = status;
      project.deadline_reply_note = note;
    }
    renderDeadlinePanel(); renderInfo();
    showToast('発注者へ回答を送信しました', 'success');
  });
}

/* ── 初期化 ── */
async function init() {
  if (isAdmin(user) || isModeler(user)) {
    try {
      const data = await api.get('/projects/modelers');
      allModelers = data.modelers || [];
    } catch {}
  }
  await loadProject();

  // 30秒ごとにプロジェクト情報を再取得して担当モデラー・ステータス・ファイル検査状況を自動更新
  const reviewSig = fs => (fs ?? []).map(f => `${f.id}:${f.review_status}`).join(',');
  setInterval(async () => {
    try {
      const data = await api.get(`/projects/${projId}`);
      if (!data?.project) return;
      const updated = data.project;
      if (updated.modeler_id !== project.modeler_id
          || updated.status !== project.status
          || reviewSig(updated.files) !== reviewSig(project.files)) {
        project = updated;
        comments = project.comments ?? [];
        renderInfo();
        renderTimeline();
        renderDeadlinePanel();
        renderFiles();
      }
    } catch {}
  }, 30000);
}
init();
