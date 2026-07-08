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
  // 1件でも検査依頼中のファイルがあれば「管理者検査」ステップを点灯させる
  const hasSubmittedFile = (project.files ?? []).some(f =>
    MODEL_TYPES.includes(f.file_type) && f.review_status === 'submitted');
  tl.innerHTML = STEPS.map((s, i) => {
    const stepRank = statusRank(s.key);
    const isDone   = rank > stepRank;
    const partialReview = s.key === 'review_pending' && rank < stepRank && hasSubmittedFile;
    const isActive = rank === stepRank
      || (project.status === 'revision_requested' && s.key === 'review_pending')
      || partialReview;
    return `
      <div class="timeline-step ${isDone?'done':''} ${isActive?'active':''}">
        <div class="timeline-dot">
          <i class="fa-solid ${isDone?'fa-check':partialReview?'fa-paper-plane':isActive?'fa-spinner':String(i+1)}"></i>
        </div>
        <span class="timeline-label">${s.label}${partialReview
          ? '<br><span style="font-size:10px;font-weight:600;color:var(--accent-strong,#E55A2B);">検査依頼あり</span>'
          : ''}</span>
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
  const longRows = [];
  if (project.description) longRows.push(['説明', `<span style="white-space:pre-wrap;font-size:13px;">${escapeHtml(project.description)}</span>`]);
  if (project.spec_note)   longRows.push(['仕様・備考', `<span style="white-space:pre-wrap;font-size:13px;">${escapeHtml(project.spec_note)}</span>`]);

  const itemHtml = ([k, v]) =>
    `<div class="info-item">
       <div class="info-item-label">${k}</div>
       <div class="info-item-value">${v}</div>
     </div>`;

  document.getElementById('infoTable').innerHTML =
    rows.map(itemHtml).join('') +
    longRows.map(r => `<div class="info-item info-item-wide">
       <div class="info-item-label">${r[0]}</div>
       <div class="info-item-value">${r[1]}</div>
     </div>`).join('');
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
  const canUploadModel = isModeler(user)
    && ['in_progress', 'revision_requested', 'review_pending'].includes(project.status);
  document.getElementById('uploadModelBtn').style.display = canUploadModel ? '' : 'none';

  // 発注者用: フォルダごと保存 / zip一括ダウンロード
  const saveFolderBtn = document.getElementById('saveFolderBtn');
  const zipAllBtn      = document.getElementById('zipAllBtn');
  const canBulkDownload = isClient(user) && visibleModelFiles.length > 0;
  saveFolderBtn.style.display = (canBulkDownload && 'showDirectoryPicker' in window) ? '' : 'none';
  zipAllBtn.style.display = canBulkDownload ? '' : 'none';

  /* 図面・参考資料の追加（全ロール共通、ファイル/フォルダ両対応）*/
  const uploadDrawingBtn = document.getElementById('uploadDrawingBtn');
  const uploadDrawingMenu = document.getElementById('uploadDrawingMenu');
  if (uploadDrawingBtn && !uploadDrawingBtn.dataset.bound) {
    uploadDrawingBtn.dataset.bound = '1';
    uploadDrawingBtn.addEventListener('click', e => {
      e.stopPropagation();
      uploadDrawingMenu.classList.toggle('open');
    });
    document.getElementById('uploadDrawingMenuFile').addEventListener('click', () => {
      uploadDrawingMenu.classList.remove('open');
      document.getElementById('drawingFileInput').click();
    });
    document.getElementById('uploadDrawingMenuFolder').addEventListener('click', () => {
      uploadDrawingMenu.classList.remove('open');
      document.getElementById('drawingFolderInput').click();
    });
    document.addEventListener('click', () => uploadDrawingMenu.classList.remove('open'));
  }

  const drawingInput = document.getElementById('drawingFileInput');
  if (drawingInput && !drawingInput.dataset.bound) {
    drawingInput.dataset.bound = '1';
    drawingInput.addEventListener('change', async e => {
      const items = Array.from(e.target.files).map(f => ({ file: f, relativePath: '' }));
      e.target.value = '';
      if (!items.length) return;
      await uploadDrawingItemsAndRefresh(items);
    });
  }

  const drawingFolderInput = document.getElementById('drawingFolderInput');
  if (drawingFolderInput && !drawingFolderInput.dataset.bound) {
    drawingFolderInput.dataset.bound = '1';
    drawingFolderInput.addEventListener('change', async e => {
      const items = filesFromDirectoryInput(e.target);
      e.target.value = '';
      if (!items.length) return;
      await uploadDrawingItemsAndRefresh(items);
    });
  }

  /* アップロードボタン: クリックで「ファイルを選択/フォルダを選択」メニューを開閉 */
  const uploadModelBtn = document.getElementById('uploadModelBtn');
  const uploadModelMenu = document.getElementById('uploadModelMenu');
  if (uploadModelBtn && !uploadModelBtn.dataset.bound) {
    uploadModelBtn.dataset.bound = '1';
    uploadModelBtn.addEventListener('click', e => {
      e.stopPropagation();
      uploadModelMenu.classList.toggle('open');
    });
    document.getElementById('uploadModelMenuFile').addEventListener('click', () => {
      uploadModelMenu.classList.remove('open');
      document.getElementById('modelFileInput').click();
    });
    document.getElementById('uploadModelMenuFolder').addEventListener('click', () => {
      uploadModelMenu.classList.remove('open');
      document.getElementById('modelFolderInput').click();
    });
    document.addEventListener('click', () => uploadModelMenu.classList.remove('open'));
  }

  /* モデラー用ファイルアップロード（アップロードボタンから直接追加する場合）*/
  const modelInput = document.getElementById('modelFileInput');
  if (modelInput && !modelInput.dataset.bound) {
    modelInput.dataset.bound = '1';
    modelInput.addEventListener('change', async e => {
      const items = Array.from(e.target.files).map(f => ({ file: f, relativePath: '' }));
      e.target.value = '';
      if (!items.length) return;
      await uploadModelItemsAndRefresh(items);
    });
  }

  const modelFolderInput = document.getElementById('modelFolderInput');
  if (modelFolderInput && !modelFolderInput.dataset.bound) {
    modelFolderInput.dataset.bound = '1';
    modelFolderInput.addEventListener('change', async e => {
      const items = filesFromDirectoryInput(e.target);
      e.target.value = '';
      if (!items.length) return;
      await uploadModelItemsAndRefresh(items);
    });
  }

  const saveFolderBtnEl = document.getElementById('saveFolderBtn');
  if (saveFolderBtnEl && !saveFolderBtnEl.dataset.bound) {
    saveFolderBtnEl.dataset.bound = '1';
    saveFolderBtnEl.addEventListener('click', () =>
      saveFilesToLocalFolder(visibleModelFilesForBulk(), project.project_code || `project-${projId}`));
  }

  const zipAllBtnEl = document.getElementById('zipAllBtn');
  if (zipAllBtnEl && !zipAllBtnEl.dataset.bound) {
    zipAllBtnEl.dataset.bound = '1';
    zipAllBtnEl.addEventListener('click', () => downloadFilesAsZip(visibleModelFilesForBulk()));
  }
}

/* 3Dデータをアップロードし、file-type別に検査依頼前(pending)のまま画面へ反映する */
async function uploadModelItemsAndRefresh(items) {
  const { uploaded, errors } = await uploadItemsSequential(projId, items, { fileType: 'model_3d' });
  if (uploaded.length) {
    project.files = [...(project.files ?? []), ...uploaded];
    renderFiles();
    showToast(`${uploaded.length}件のファイルをアップロードしました`, 'success');
  }
  if (errors.length) {
    showToast(`アップロードに失敗しました: ${errors.join(', ')}`, 'danger');
  }
}

/* 図面・参考資料の拡張子からfile_typeを判定 */
function resolveDrawingFileType(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  return ['dxf', 'dwg'].includes(ext) ? 'drawing_dxf'
       : ext === 'pdf'                ? 'drawing_pdf'
       : 'reference';
}

/* 図面・参考資料をアップロードし、画面へ反映する */
async function uploadDrawingItemsAndRefresh(items) {
  const { uploaded, errors } = await uploadItemsSequential(projId, items, {
    fileType: item => resolveDrawingFileType(item.file),
  });
  if (uploaded.length) {
    project.files = [...(project.files ?? []), ...uploaded];
    renderFiles();
    showToast(`${uploaded.length}件のファイルを追加しました`, 'success');
  }
  if (errors.length) {
    showToast(`アップロードに失敗しました: ${errors.join(', ')}`, 'danger');
  }
}

/* 発注者に見えている3Dモデルファイル一覧（一括DL・全体保存の対象） */
function visibleModelFilesForBulk() {
  const modelFiles = (project.files ?? []).filter(f => MODEL_TYPES.includes(f.file_type));
  return isClient(user)
    ? modelFiles.filter(f =>
        f.review_status === 'delivered' ||
        (['approved','delivered'].includes(project.status) && f.review_status === 'ok'))
    : modelFiles;
}

/* 指定ファイル群をローカルへ直接保存（Chrome/Edge, File System Access API）。
   wrapperNameを渡すと「保存先/wrapperName/relative_path...」に、省略時は
   「保存先/relative_path...」にそのまま書き込む（フォルダ単体保存でトップ階層が二重にならないように）。*/
async function saveFilesToLocalFolder(files, wrapperName) {
  if (!files.length) return;

  let rootHandle;
  try {
    rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (err) {
    if (err?.name === 'AbortError') return;
    showToast('保存先フォルダの選択に失敗しました', 'danger');
    return;
  }

  const baseHandle = wrapperName
    ? await rootHandle.getDirectoryHandle(wrapperName, { create: true })
    : rootHandle;
  const progressEl = document.getElementById('modelFolderSaveProgress');
  const token = sessionStorage.getItem('space_token');
  if (progressEl) progressEl.style.display = '';

  let done = 0;
  for (const f of files) {
    if (progressEl) progressEl.textContent = `${done} / ${files.length} 件保存中: ${f.file_name}`;
    const segs = (f.relative_path || f.file_name).split('/').filter(Boolean);
    let dirHandle = baseHandle;
    for (const seg of segs.slice(0, -1)) {
      dirHandle = await dirHandle.getDirectoryHandle(seg, { create: true });
    }
    try {
      const res = await fetch(`${API_BASE}/files/${f.id}/raw`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const fileHandle = await dirHandle.getFileHandle(segs.at(-1), { create: true });
      const writable = await fileHandle.createWritable();
      await res.body.pipeTo(writable);
    } catch (err) {
      showToast(`${f.file_name} の保存に失敗しました`, 'danger');
    }
    done++;
  }

  if (progressEl) {
    progressEl.textContent = `${done} / ${files.length} 件保存しました`;
    setTimeout(() => { progressEl.style.display = 'none'; }, 4000);
  }
  showToast('フォルダへの保存が完了しました', 'success');
}

/* 指定ファイル群をzipにまとめてダウンロード（サーバー側でrelative_path構造を保持） */
function downloadFilesAsZip(files) {
  if (!files.length) return;
  const token = sessionStorage.getItem('space_token');
  const ids = files.map(f => f.id).join(',');
  const url = `${API_BASE}/projects/${projId}/files/zip?token=${encodeURIComponent(token || '')}&ids=${ids}`;
  const a = document.createElement('a');
  a.href = url;
  a.click();
}

const REVIEW_BADGE = {
  submitted: '<span class="badge badge-review_pending" style="font-size:11px;margin-right:4px;">検査依頼中</span>',
  ok:        '<span class="badge badge-approved" style="font-size:11px;margin-right:4px;">OK</span>',
  revision:  '<span class="badge badge-revision_requested" style="font-size:11px;margin-right:4px;">修正依頼</span>',
  delivered: '<span class="badge badge-delivered" style="font-size:11px;margin-right:4px;"><i class="fa-solid fa-truck" style="margin-right:3px;"></i>納品済み</span>',
};

function fileDirOf(f) {
  return f.relative_path ? f.relative_path.split('/').slice(0, -1).join('/') : '';
}

function fileTopDirOf(f) {
  return f.relative_path ? f.relative_path.split('/')[0] : null;
}

/* フォルダ行の開閉状態（area.id::トップフォルダ名 をキーに再描画をまたいで保持。初期値は折りたたみ） */
const expandedFolderKeys = new Set();

function renderFileSection(area, files, canDelete, showAdminBtns = false, showModelerBtns = false) {
  if (!files.length) {
    area.innerHTML = '<p style="color:var(--muted);padding:12px 0;font-size:13px;">ファイルがありません</p>';
    return;
  }

  // トップレベルフォルダ単位でまとめる。フォルダに属さない単発アップロードはそのまま並べる
  const rootFiles = [];
  const folderGroups = new Map(); // topDir -> files[]
  files.forEach(f => {
    const top = fileTopDirOf(f);
    if (!top) { rootFiles.push(f); return; }
    if (!folderGroups.has(top)) folderGroups.set(top, []);
    folderGroups.get(top).push(f);
  });
  rootFiles.sort((a, b) => a.file_name.localeCompare(b.file_name));
  folderGroups.forEach(list => list.sort((a, b) => (a.relative_path || '').localeCompare(b.relative_path || '')));
  const folderEntries = [...folderGroups.entries()];

  function renderFileItem(f, indentPx) {
    const ext = f.file_name.split('.').pop().toLowerCase();
    const canPreview = ['pdf', 'dxf', 'dwg', 'stl', 'stp', 'step'].includes(ext);

    // 検査依頼前（pending）バッジは3Dモデルエリア（検査対象）でのみ表示
    const reviewBadge = (f.review_status === 'pending' || !f.review_status)
      ? ((showAdminBtns || showModelerBtns)
          ? '<span class="badge badge-submitted" style="font-size:11px;margin-right:4px;">検査依頼前</span>'
          : '')
      : (REVIEW_BADGE[f.review_status] || '');

    // バッジ横の検査者・依頼者表示（誰がいつ操作したか）
    const reviewMetaText = f.review_status === 'submitted'
      ? (f.review_requested_by_name ? `依頼: ${f.review_requested_by_name} ${f.review_requested_at || ''}` : '')
      : (['ok', 'revision', 'delivered'].includes(f.review_status) && f.reviewed_by_name
          ? `検査: ${f.reviewed_by_name} ${f.reviewed_at || ''}` : '');
    const reviewMeta = reviewMetaText
      ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">${reviewMetaText}</div>`
      : '';

    // 管理者: OK / 修正依頼 / 納品
    // 検査依頼前（pending）のファイルは検査・納品の対象外、納品済みはバッジのみ
    const canAdminReview = showAdminBtns && ['submitted', 'ok', 'revision'].includes(f.review_status);
    const reviewBtns = canAdminReview ? `
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
    <div class="upload-file-item" data-file-id="${f.id}" style="margin-left:${indentPx}px;">
      <div class="file-item-main">
        ${getFileIcon(f.file_name)}
        <div class="file-item-info">
          <div class="file-item-name">${f.file_name}</div>
          <div style="font-size:12px;color:var(--muted);">
            ${TYPE_LABEL[f.file_type]||f.file_type||'ファイル'} · ${formatBytes(f.file_size)} · ${f.uploaded_by_name||f.uploaded_by||''}
          </div>
          ${reviewMeta}
        </div>
      </div>
      <div class="file-item-actions">
        ${reviewBadge}
        ${reviewBtns}
        ${modelerBtns}
        ${canPreview ? `<button class="file-preview-btn" data-file-id="${f.id}" title="プレビュー">
          <i class="fa-solid fa-eye"></i>
        </button>` : ''}
        <button class="btn btn-ghost btn-sm file-download-btn" data-file-id="${f.id}"
                data-file-name="${f.file_name}" title="ダウンロード">
          <i class="fa-solid fa-download"></i>
        </button>
        ${canDelete ? `<button class="btn btn-ghost btn-sm file-delete-btn" data-file-id="${f.id}"
                data-file-name="${f.file_name}" title="削除" style="color:#e74c3c;">
          <i class="fa-solid fa-trash"></i>
        </button>` : ''}
      </div>
    </div>`;
  }

  /* フォルダ内は、トップフォルダより下のサブパスごとに見出し（非開閉）を挟んで表示 */
  function renderFolderBody(topDir, groupFiles) {
    let prevSub = null;
    return groupFiles.map(f => {
      const fullDir = fileDirOf(f);
      const subDir = fullDir.length > topDir.length ? fullDir.slice(topDir.length + 1) : '';
      const depth = subDir ? subDir.split('/').length : 0;
      let subHeader = '';
      if (subDir !== prevSub) {
        prevSub = subDir;
        if (subDir) {
          subHeader = `<div style="padding-left:${depth * 18}px;font-size:11px;color:var(--muted);
            margin:8px 0 3px;display:flex;align-items:center;gap:5px;">
            <i class="fa-solid fa-folder"></i>${subDir}
          </div>`;
        }
      }
      return subHeader + renderFileItem(f, (depth + 1) * 18);
    }).join('');
  }

  let html = rootFiles.map(f => renderFileItem(f, 0)).join('');

  html += folderEntries.map(([topDir, groupFiles]) => {
    const isOpen = expandedFolderKeys.has(`${area.id}::${topDir}`);
    const totalSize = groupFiles.reduce((s, f) => s + (f.file_size || 0), 0);
    return `
    <div class="file-tree-group" style="margin:8px 0;">
      <div class="file-tree-folder-row" style="display:flex;align-items:center;gap:8px;padding:10px 12px;
           border:1px solid var(--border);border-radius:8px;cursor:pointer;background:var(--surface);">
        <i class="fa-solid ${isOpen ? 'fa-chevron-down' : 'fa-chevron-right'} folder-toggle-icon"
           style="font-size:11px;color:var(--muted);width:12px;"></i>
        <i class="fa-solid fa-folder" style="color:var(--accent);"></i>
        <div style="flex:1;font-size:13px;font-weight:600;">${topDir}</div>
        <div style="font-size:12px;color:var(--muted);">${groupFiles.length}件 · ${formatBytes(totalSize)}</div>
        <button class="btn btn-ghost btn-sm folder-save-btn tooltip-hint"
                data-tooltip="クリック後に表示されるフォルダ選択画面で、デスクトップ・ドキュメント・ダウンロード自体は選択できません。その中のサブフォルダ（または新規作成したフォルダ）を選んでください。"
                style="${'showDirectoryPicker' in window ? '' : 'display:none;'}">
          <i class="fa-solid fa-folder-tree"></i>
        </button>
        <button class="btn btn-ghost btn-sm folder-zip-btn" title="このフォルダをzipダウンロード">
          <i class="fa-solid fa-file-zipper"></i>
        </button>
      </div>
      <div class="file-tree-group-body" style="display:${isOpen ? '' : 'none'};padding-top:6px;">
        ${renderFolderBody(topDir, groupFiles)}
      </div>
    </div>`;
  }).join('');

  area.innerHTML = html;

  // フォルダ行の開閉トグル（保存・zipボタンのクリックは伝播させない）
  area.querySelectorAll('.file-tree-folder-row').forEach((row, idx) => {
    row.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      const [topDir] = folderEntries[idx];
      const key = `${area.id}::${topDir}`;
      const body = row.nextElementSibling;
      const icon = row.querySelector('.folder-toggle-icon');
      if (expandedFolderKeys.has(key)) {
        expandedFolderKeys.delete(key);
        body.style.display = 'none';
        icon.classList.replace('fa-chevron-down', 'fa-chevron-right');
      } else {
        expandedFolderKeys.add(key);
        body.style.display = '';
        icon.classList.replace('fa-chevron-right', 'fa-chevron-down');
      }
    });
  });

  // フォルダ単位の保存・zipダウンロード
  area.querySelectorAll('.folder-save-btn').forEach((btn, idx) => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const [, groupFiles] = folderEntries[idx];
      saveFilesToLocalFolder(groupFiles);
    });
  });
  area.querySelectorAll('.folder-zip-btn').forEach((btn, idx) => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const [, groupFiles] = folderEntries[idx];
      downloadFilesAsZip(groupFiles);
    });
  });

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
        const token = sessionStorage.getItem('space_token');
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
  const token = sessionStorage.getItem('space_token');
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: formData,
  });
  if (!res.ok) {
    let msg = `API Error ${res.status}`;
    try {
      const body = await res.json();
      if (body.message) msg = body.message;
    } catch {}
    throw new Error(msg);
  }
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

function avatarCls(role, solidType) {
  if (role === 'admin')          return 'chat-avatar-admin';
  if (solidType === 'id_modeler') return 'chat-avatar-modeler';
  return '';
}

function renderChat() {
  const box  = document.getElementById('chatMessages');
  // 最下部付近にいるときだけ自動スクロール（過去ログを読んでいる最中は位置を保持）
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const prevScrollTop = box.scrollTop;
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
    const solidType = c.user_solid_type ?? c.solid_type ?? '';
    const canDel = Number(c.user_id) === Number(user.id) || isAdmin(user);
    const delBtn = canDel
      ? `<button class="chat-del-btn" data-comment-id="${c.id}" title="削除"><i class="fa-solid fa-trash-can"></i></button>`
      : '';

    return `${divider}
    <div class="chat-msg${isMine?' mine':''}">
      ${!isMine ? `<div class="chat-avatar ${avatarCls(role, solidType)}">${userName.charAt(0)}</div>` : ''}
      <div class="chat-bubble-wrap">
        <div class="chat-meta">
          <span class="chat-meta-name">${isMine ? 'あなた' : userName}</span>
          <span>${roleLabel(role, solidType)}</span>
          <span>${(c.created_at||'').split(' ')[1] || c.created_at || ''}</span>
          ${delBtn}
        </div>
        <div class="chat-bubble">${textHtml}${imgHtml}</div>
      </div>
      ${isMine ? `<div class="chat-avatar ${avatarCls(role, solidType)}">${userName.charAt(0)}</div>` : ''}
    </div>`;
  }).join('');

  box.scrollTop = nearBottom ? box.scrollHeight : prevScrollTop;

  box.querySelectorAll('[data-lightbox]').forEach(img => {
    img.addEventListener('click', () => openLightbox(img.src));
  });

  box.querySelectorAll('.chat-del-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteComment(Number(btn.dataset.commentId)));
  });

  // 認証付きで画像を非同期ロード
  loadAuthImages(box);
}

/* 認証付き画像のblob URLキャッシュ（再描画ごとの再フェッチ・ちらつき防止） */
const authImgCache = new Map();

function loadAuthImages(container) {
  container.querySelectorAll('[data-auth-img]').forEach(async img => {
    let url = img.dataset.authImg;
    if (!url) return;
    // APIが http:// のURLを返してもMixed Contentでブロックされないよう https に昇格
    if (location.protocol === 'https:' && url.startsWith('http://')) {
      url = 'https://' + url.slice('http://'.length);
    }
    const cached = authImgCache.get(url);
    if (cached) {
      img.src = cached;
      img.style.opacity = '1';
      img.dataset.lightbox = '';
      img.addEventListener('click', () => openLightbox(cached));
      return;
    }
    try {
      const token = sessionStorage.getItem('space_token');
      const res = await fetch(url, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      authImgCache.set(url, blobUrl);
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
  const fd = new FormData();
  fd.append('body', body);
  fd.append('channel', ch);
  if (imageFile) fd.append('image', imageFile);

  try {
    const data = await apiFetchForm(`/projects/${projId}/comments`, fd);
    // 投稿直後は Blob URL を使って即表示（再描画後も認証エンドポイントに差し替え）
    if (imageFile && data.comment.image_path) {
      data.comment._blobUrl = URL.createObjectURL(imageFile);
    }
    comments.push(data.comment);
    renderChat();
  } catch (err) {
    // サーバーに保存されていないのにローカル表示すると「送れたように見えるのに相手に届かない」
    // 状態になるため、フォールバック表示はせず失敗を明示する
    showToast(`メッセージを送信できませんでした: ${err.message || 'サーバーエラー'}`, 'danger');
    throw err;
  }
}

document.getElementById('commentSubmit').addEventListener('click', async () => {
  const input = document.getElementById('commentInput');
  const body  = input.value.trim();
  if (!body && !pendingImages.length) return;

  try {
    if (pendingImages.length) {
      for (const img of pendingImages) {
        await submitComment(body, img.file);
      }
      pendingImages = [];
      renderImagePreview();
    } else {
      await submitComment(body, null);
    }
    // 成功時のみクリア（失敗時は入力を残してそのまま再送できるように）
    input.value = '';
  } catch {}
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
    const data = await api.patch(`/files/${fileId}/review-status`, { review_status: status });
    const f = project.files.find(x => x.id === fileId);
    if (f) Object.assign(f, data?.file ?? { review_status: status });
    // ファイル納品でプロジェクトステータスが進んだ場合（例: → 発注者確認）も反映
    if (data?.project_status && data.project_status !== project.status) {
      project.status = data.project_status;
      renderInfo();
    }
    renderFiles();
    renderTimeline();
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
  document.getElementById('submitModelProgress').style.display = 'none';
  document.getElementById('submitModelProgressFill').style.width = '0%';

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

// 新規ファイル追加プレビュー（単発選択・フォルダ選択共通）
function addSubmitNewItems(items) {
  let skipped = 0;
  items.forEach(({ file, relativePath }) => {
    const ext = file.name.split('.').pop().toLowerCase();
    if (![...SOLID_3D_EXTS, 'dxf', 'pdf'].includes(ext)) { skipped++; return; }
    submitNewFiles.push({ file, relativePath });
  });
  if (skipped > 0) showToast(`対応外の形式のファイルを${skipped}件スキップしました`, 'warning');

  const preview = document.getElementById('submitNewFilePreview');
  preview.innerHTML = submitNewFiles.map((item, i) => `
    <span style="display:inline-flex;align-items:center;gap:4px;background:var(--surface);
                 border:1px solid var(--border);border-radius:6px;padding:3px 8px;font-size:12px;">
      <i class="fa-solid fa-file" style="color:var(--muted);font-size:10px;"></i>
      ${item.relativePath || item.file.name}
      <button data-rm="${i}" style="background:none;border:none;cursor:pointer;color:var(--muted);padding:0 2px;">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </span>`).join('');
  preview.querySelectorAll('[data-rm]').forEach(btn =>
    btn.addEventListener('click', () => {
      submitNewFiles.splice(Number(btn.dataset.rm), 1);
      addSubmitNewItems([]);
    }));
  updateSubmitConfirmBtn();
}

document.getElementById('submitNewFileInput')?.addEventListener('change', e => {
  addSubmitNewItems(Array.from(e.target.files).map(f => ({ file: f, relativePath: '' })));
  e.target.value = '';
});
document.getElementById('submitNewFolderInput')?.addEventListener('change', e => {
  addSubmitNewItems(filesFromDirectoryInput(e.target));
  e.target.value = '';
});

document.getElementById('submitModelConfirmBtn')?.addEventListener('click', async () => {
  // チェックされた既存ファイルIDを取得
  const checkedIds = Array.from(document.querySelectorAll('.submit-file-check:checked'))
    .map(cb => Number(cb.value));
  if (checkedIds.length === 0 && submitNewFiles.length === 0) {
    showToast('提出するファイルを1件以上選択してください', 'warning');
    return;
  }

  // 新規ファイルを直列アップロード（Sanctumの行ロック競合を避けるため並列化しない）
  const newIds = [];
  if (submitNewFiles.length > 0) {
    const progressWrap  = document.getElementById('submitModelProgress');
    const progressCount = document.getElementById('submitModelProgressCount');
    const progressName  = document.getElementById('submitModelProgressName');
    const progressFill  = document.getElementById('submitModelProgressFill');
    progressWrap.style.display = '';

    const { uploaded, errors } = await uploadItemsSequential(projId, submitNewFiles, {
      fileType: 'model_3d',
      onProgress: ({ doneCount, total, currentName, doneBytes, totalBytes }) => {
        progressCount.textContent = `${doneCount} / ${total} ファイル`;
        progressName.textContent = currentName;
        progressFill.style.width = totalBytes ? `${Math.round((doneBytes / totalBytes) * 100)}%` : '0%';
      },
    });
    project.files = [...(project.files ?? []), ...uploaded];
    newIds.push(...uploaded.map(f => f.id));
    if (errors.length) {
      showToast(`アップロードに失敗しました: ${errors.join(', ')}`, 'danger');
      return;
    }
  }

  // 選択されたファイルをファイル単位で検査依頼（submitted）にする
  for (const id of [...checkedIds, ...newIds]) {
    try {
      const data = await api.patch(`/files/${id}/review-status`, { review_status: 'submitted' });
      const f = project.files.find(x => x.id === id);
      if (f) Object.assign(f, data?.file ?? { review_status: 'submitted' });
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
  if (note) {
    try { await submitComment(`【キャンセル】${note}`, null); } catch { return; }
  }
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

  try { await submitComment(`【修正依頼】${note}`, null); } catch { return; }
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
      try { await submitComment(`【納期再調整依頼】新しい希望納期: ${newDate}`, null); } catch { return; }
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
      try { await submitComment(msg, null, 'modeler'); } catch { return; }
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

  // ほぼリアルタイム更新: 3秒ごとに軽量version APIをポーリングし、
  // 変化があったときだけ詳細を再取得して差分単位で再描画する
  const reviewSig   = fs => (fs ?? []).map(f => `${f.id}:${f.review_status}`).join(',');
  const commentsSig = cs => (cs ?? []).map(c => c.id).join(',');
  const deadlineSig = p  => [p.deadline_requested, p.deadline_replied, p.deadline_reply_status,
                             p.deadline_reply_note, p.deadline_at].join('|');

  startAutoRefresh(async () => {
    const v = await api.get(`/projects/${projId}/version`);
    if (!v?.version || v.version === project.version) return;

    const data = await api.get(`/projects/${projId}`);
    if (!data?.project) return;
    const updated = data.project;

    const statusChanged   = updated.status !== project.status
                         || updated.modeler_id !== project.modeler_id;
    const filesChanged    = reviewSig(updated.files) !== reviewSig(project.files);
    const commentsChanged = commentsSig(updated.comments) !== commentsSig(comments);
    const deadlineChanged = deadlineSig(updated) !== deadlineSig(project);

    project  = updated;
    comments = project.comments ?? [];

    if (statusChanged) { renderInfo(); renderTimeline(); }
    if (filesChanged)  { renderFiles(); renderTimeline(); }
    if (commentsChanged) renderChat();
    // 納期回答フォームに入力中は再描画しない（入力内容が消えるのを防ぐ）
    if ((statusChanged || deadlineChanged)
        && !document.getElementById('deadlinePanel')?.contains(document.activeElement)) {
      renderDeadlinePanel();
    }
  }, 3000);
}
init();
