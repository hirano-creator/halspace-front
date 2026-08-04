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
/* 発注者確認（approved）ステップは廃止し、管理者検査 → 納品完了 で確定する。
   approved は既存案件が残っているため「納品待ち」として管理者検査の位置に表示する */
const STEPS = [
  { key:'submitted',      label:'図面提出' },
  { key:'in_progress',    label:'モデリング中' },
  { key:'review_pending', label:'管理者検査' },
  { key:'delivered',      label:'納品完了' },
];
const STATUS_ORDER = ['draft','submitted','in_progress','review_pending',
                      'revision_requested','approved','delivered'];
function statusRank(s) { return STATUS_ORDER.indexOf(s); }

const STATUS_LABEL = {
  draft:'下書き', submitted:'提出済み', in_progress:'モデリング中',
  review_pending:'検査待ち', revision_requested:'修正依頼中',
  approved:'納品待ち', delivered:'納品完了', cancelled:'キャンセル',
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
  const tl = document.getElementById('timeline');
  // 廃止した発注者確認(approved)の既存案件は「管理者検査を終えた納品待ち」として同じ位置に出す
  const rank = statusRank(project.status === 'approved' ? 'review_pending' : project.status);
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

  // 管理者検査バー: review_pending × 管理者（approved の既存案件も納品確定できるよう表示する）
  const adminReviewBar = document.getElementById('adminReviewBar');
  adminReviewBar.style.display =
    (['review_pending','approved'].includes(project.status) && hasAdminLevelAccess(user)) ? '' : 'none';

  // モデラー用アクションバー
  // 検査依頼はファイル単位（一覧の「検査依頼」）に一本化したため、ここには開始／再開のみ置く
  const modelerActionBar = document.getElementById('modelerActionBar');
  const startBtn  = document.getElementById('startModelingBtn');
  const resumeBtn = document.getElementById('resumeModelingBtn');
  if (isModeler(user)) {
    const s = project.status;
    modelerActionBar.style.display = ['submitted','revision_requested'].includes(s) ? '' : 'none';
    startBtn.style.display  = s === 'submitted' ? '' : 'none';
    resumeBtn.style.display = s === 'revision_requested' ? '' : 'none';
  } else {
    modelerActionBar.style.display = 'none';
  }

  /* キャンセルボタン: 発注者・管理者のみ、完了・キャンセル済み以外で表示 */
  const cancelBtn = document.getElementById('cancelBtn');
  const canCancel = (isClient(user) || hasAdminLevelAccess(user))
    && !['delivered', 'cancelled'].includes(project.status);
  cancelBtn.style.display = canCancel ? '' : 'none';
}

/* ── プロジェクト情報テーブル ── */
function renderInfo() {
  document.getElementById('topBarTitle').textContent = project.title;
  document.getElementById('statusBadge').className   = `badge badge-${project.status}`;
  document.getElementById('statusBadge').textContent  = STATUS_LABEL[project.status];

  const companyName = project.company_name ?? project.company ?? '—';
  const clientName  = project.client_name ?? project.client ?? '—';

  const deadlineRequested = project.deadline_requested || project.deadline_at || '—';
  const deadlineReplied   = project.deadline_replied ?? project.deadline_reply?.date ?? '—';

  const rows = [
    ['プロジェクトコード', `<code style="color:var(--blue)">${project.project_code}</code>`],
    ['会社名', companyName],
    ['担当者名', clientName],
    ['発注日', (project.created_at||'—').slice(0,10)],
    ['希望納期', deadlineRequested],
    ['納期回答', deadlineReplied],
    ['納品日', (project.delivered_at || '—').slice(0, 10)],
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
  // ⋯メニューを開いている最中に自動更新で作り直すと操作が中断されるため、
  // メニューが閉じるまで再描画を保留する
  if (document.querySelector('.row-menu-wrap.open')) {
    pendingFileRerender = true;
    return;
  }

  const allFiles     = project.files ?? [];
  const drawingFiles  = allFiles.filter(f => DRAWING_TYPES.includes(f.file_type));
  const modelFiles    = allFiles.filter(f => MODEL_TYPES.includes(f.file_type));

  // 3Dモデルエリアの表示制御
  const modelArea = document.getElementById('modelFileArea');
  const lockedMsg = document.getElementById('modelFileLockedMsg');
  const opts      = currentReviewOpts();

  // 発注者には「納品済み」ファイル＋（承認後は）検査OKファイルを表示
  const visibleModelFiles = isClient(user)
    ? modelFiles.filter(f =>
        f.review_status === 'delivered' ||
        (['approved','delivered'].includes(project.status) && f.review_status === 'ok'))
    : modelFiles;
  const clientLocked = isClient(user)
    && !['approved','delivered'].includes(project.status)
    && visibleModelFiles.length === 0;

  // 削除・納品などで消えたファイルの選択が残らないようにする
  const visibleIds = new Set(visibleModelFiles.map(f => f.id));
  [...selectedFileIds].forEach(id => { if (!visibleIds.has(id)) selectedFileIds.delete(id); });

  // 状態フィルタ（サマリー行のバッジで絞り込み）
  const shownModelFiles = modelStatusFilter
    ? visibleModelFiles.filter(f => (f.review_status || 'pending') === modelStatusFilter)
    : visibleModelFiles;

  // 選択しても何もできない状態ではチェックボックスを出さない
  // （管理者の検査／モデラーの検査依頼／発注者の一括ダウンロードのいずれかがあるとき）
  const selectable = opts.showAdminBtns || opts.showModelerBtns || isClient(user);
  if (!selectable) selectedFileIds.clear();

  if (clientLocked) {
    lockedMsg.style.display = '';
    modelArea.innerHTML = '';
    document.getElementById('modelFileSummary').style.display = 'none';
    document.getElementById('modelFileGuide').style.display = 'none';
  } else {
    lockedMsg.style.display = 'none';
    renderModelGuide(visibleModelFiles, opts);
    renderModelSummary(visibleModelFiles, shownModelFiles, selectable);
    renderFileSection(modelArea, shownModelFiles, {
      canDelete: !isClient(user),
      showAdminBtns: opts.showAdminBtns,
      showModelerBtns: opts.showModelerBtns,
      selectable,
      emptyMsg: modelStatusFilter
        ? `${REVIEW_STATUS_META[modelStatusFilter]?.label ?? ''}のファイルはありません`
        : 'ファイルがありません',
    });
  }
  refreshSelectionUI();

  // 図面・参考資料エリア（全員表示）
  renderFileSection(document.getElementById('drawingFileArea'), drawingFiles, {
    canDelete: hasAdminLevelAccess(user) || isModeler(user),
  });

  // 修正依頼ファイルエリア: file_type=revision OR (model_3d && review_status=revision)
  const allRevisionFiles = allFiles.filter(f =>
    REVISION_TYPES.includes(f.file_type) ||
    (MODEL_TYPES.includes(f.file_type) && f.review_status === 'revision')
  );
  const revisionCard = document.getElementById('revisionFileCard');
  if (allRevisionFiles.length > 0) {
    revisionCard.style.display = '';
    renderFileSection(document.getElementById('revisionFileArea'), allRevisionFiles, {
      canDelete: hasAdminLevelAccess(user) || isModeler(user),
    });
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
    document.getElementById('uploadDrawingMenuWn').addEventListener('click', () => {
      uploadDrawingMenu.classList.remove('open');
      openWnPicker({ onConfirm: attachWnFilesAndRefresh });
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
      saveFilesToLocalFolder(visibleModelFilesForBulk()));
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

/* What'sNoから選択されたファイルをプロジェクトの図面・参考資料として紐付け、画面へ反映する */
async function attachWnFilesAndRefresh(wnFiles) {
  const uploaded = [];
  const errors = [];
  for (const wnFile of wnFiles) {
    try {
      const data = await api.post(`/projects/${projId}/files/from-wn`, {
        wn_file_id: wnFile.id,
        file_type: resolveDrawingFileType({ name: wnFile.file_name }),
      });
      if (data?.file?.id) uploaded.push(data.file);
    } catch {
      errors.push(wnFile.file_name);
    }
  }
  if (uploaded.length) {
    project.files = [...(project.files ?? []), ...uploaded];
    renderFiles();
    showToast(`${uploaded.length}件のファイルを追加しました`, 'success');
  }
  if (errors.length) {
    showToast(`What'sNoファイルの追加に失敗しました: ${errors.join(', ')}`, 'danger');
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
   「選んだ保存先/relative_path...」にそのまま書き込む。プロジェクトコードの階層は挟まない
   （選んだフォルダがそのまま保存先になるので、余計な入れ子ができないようにするため）。*/
async function saveFilesToLocalFolder(files) {
  if (!files.length) return;

  let rootHandle;
  try {
    /* startIn/id: 初回はデスクトップを開き（直下はChromeが禁止するのでサブフォルダを作って選ぶ）、
       2回目以降は前回選んだ場所を復元する */
    rootHandle = await window.showDirectoryPicker({
      mode: 'readwrite',
      id: 'solid-model-save',
      startIn: 'desktop',
    });
  } catch (err) {
    if (err?.name === 'AbortError') return;
    showToast('保存先フォルダの選択に失敗しました', 'danger');
    return;
  }

  const progressEl = document.getElementById('modelFolderSaveProgress');
  const token = sessionStorage.getItem('space_token');
  if (progressEl) progressEl.style.display = '';

  let done = 0;
  for (const f of files) {
    if (progressEl) progressEl.textContent = `${done} / ${files.length} 件保存中: ${f.file_name}`;
    const segs = (f.relative_path || f.file_name).split('/').filter(Boolean);
    let dirHandle = rootHandle;
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

const REVIEW_STATUS_META = {
  pending:   { cls: 'badge-submitted',          label: '検査依頼前' },
  submitted: { cls: 'badge-review_pending',     label: '検査依頼中' },
  ok:        { cls: 'badge-approved',           label: 'OK' },
  revision:  { cls: 'badge-revision_requested', label: '修正依頼' },
  delivered: { cls: 'badge-delivered',          label: '納品済み', icon: 'fa-truck' },
};

/* review_status のバッジ。count を渡すとフォルダ行用に「（N件）」付きで出す */
function reviewBadge(status, count = null) {
  const m = REVIEW_STATUS_META[status];
  if (!m) return '';
  const icon = m.icon ? `<i class="fa-solid ${m.icon}" style="margin-right:3px;"></i>` : '';
  return `<span class="badge ${m.cls}" style="font-size:11px;margin-right:4px;">${icon}${m.label}${count === null ? '' : `（${count}件）`}</span>`;
}

function fileDirOf(f) {
  return f.relative_path ? f.relative_path.split('/').slice(0, -1).join('/') : '';
}

function fileTopDirOf(f) {
  return f.relative_path ? f.relative_path.split('/')[0] : null;
}

/* ── 一覧の表示状態（3秒ポーリングによる再描画をまたいで保持する） ── */
/* フォルダ行の開閉状態（area.id::トップフォルダ名 をキー。初期値は折りたたみ） */
const expandedFolderKeys = new Set();
/* 一括操作の選択状態（ファイルID） */
const selectedFileIds = new Set();
/* 3Dモデルエリアの状態フィルタ（null＝絞り込みなし） */
let modelStatusFilter = null;
/* ⋯メニューを開いている間は自動更新の再描画を保留する */
let pendingFileRerender = false;
/* 一括処理の実行中フラグ（多重実行の防止） */
let bulkBusy = false;

/* 現在のユーザー・プロジェクト状況で出せる検査操作の種別。
   一覧・⋯メニュー・一括バーがすべてこの判定を共有する */
function currentReviewOpts() {
  return {
    // 管理者はプロジェクト進行中ならいつでもファイル単位の検査・納品が可能
    showAdminBtns: hasAdminLevelAccess(user)
      && ['in_progress','review_pending','revision_requested','approved'].includes(project.status),
    // モデラーはファイル単位で検査依頼が可能
    showModelerBtns: isModeler(user)
      && ['in_progress','review_pending','revision_requested'].includes(project.status),
  };
}

/* アクション種別 → 遷移先の review_status */
const ACTION_TARGET_STATUS = {
  ok: 'ok', revision: 'revision', deliver: 'delivered',
  reopen: 'submitted', request: 'submitted', cancel: 'pending',
};

/* 実行後のトースト（1件のときはファイル名、複数のときは件数を差し込む） */
const ACTION_TOAST = {
  ok:       { type: 'success', msg: t => `${t}を検査OKにしました` },
  revision: { type: 'warning', msg: t => `${t}を修正依頼にしました` },
  deliver:  { type: 'success', msg: t => `${t}を納品しました。発注者に公開されます。` },
  reopen:   { type: 'warning', msg: t => `${t}の検査結果を取り消し、検査待ちに戻しました` },
  request:  { type: 'success', msg: t => `${t}の検査を依頼しました` },
  cancel:   { type: 'warning', msg: t => `${t}の検査依頼を取り消しました` },
};

/* 一括アクションバーのボタン定義（key は fileReviewActions と対応） */
const BULK_ACTIONS = {
  ok:       { icon: 'fa-check',       label: '検査OK',   cls: 'btn-success' },
  revision: { icon: 'fa-rotate-left', label: '修正依頼', cls: 'btn-outline' },
  deliver:  { icon: 'fa-truck',       label: '納品',     cls: 'btn-primary' },
  request:  { icon: 'fa-paper-plane', label: '検査依頼', cls: 'btn-success' },
  cancel:   { icon: 'fa-xmark',       label: '依頼取消', cls: 'btn-outline' },
};

/* ファイル1件に対する検査アクションを、実行可否と「できない理由」付きで列挙する。
   ボタンを消さずに理由を見せるため、実行できないものも reason 付きで返す */
function fileReviewActions(f, { showAdminBtns = false, showModelerBtns = false } = {}) {
  const st = f.review_status || 'pending';
  const acts = [];
  const add = (key, icon, label, enabled, reason) =>
    acts.push({ key, icon, label, enabled, reason });

  if (showAdminBtns) {
    add('ok', 'fa-check', '検査OKにする',
      ['submitted','revision'].includes(st),
      st === 'pending' ? 'モデラーがまだ検査依頼していません'
      : st === 'ok'    ? 'すでに検査OKです'
      :                  '納品済みのため変更できません');
    add('revision', 'fa-rotate-left', '修正依頼にする',
      ['submitted','ok'].includes(st),
      st === 'pending'    ? 'モデラーがまだ検査依頼していません'
      : st === 'revision' ? 'すでに修正依頼中です'
      :                     '納品済みのため変更できません');
    add('deliver', 'fa-truck', '発注者へ納品する',
      st === 'ok',
      st === 'delivered' ? 'すでに納品済みです' : '検査OKにすると納品できます');
    add('reopen', 'fa-arrow-rotate-left', '検査結果を取り消す',
      ['ok','revision'].includes(st),
      st === 'delivered' ? '納品済みのため取り消せません' : '取り消せる検査結果がありません');
  }
  if (showModelerBtns) {
    add('request', 'fa-paper-plane', '検査を依頼する',
      ['pending','revision'].includes(st),
      st === 'submitted' ? 'すでに検査依頼中です'
      : st === 'delivered' ? '納品済みです' : '検査が完了しています');
    add('cancel', 'fa-xmark', '検査依頼を取り消す',
      st === 'submitted',
      st === 'pending' ? 'まだ検査依頼していません'
      : st === 'delivered' ? '納品済みです' : '検査が完了しています');
  }
  return acts;
}

/* そのロールが指定ステータスへ戻せるか（「元に戻す」を出せるかの判定）。
   モデラーはサーバー側で pending / submitted 以外に変更できない */
function canSetStatus(status, opts) {
  if (opts.showAdminBtns)   return status !== 'delivered';
  if (opts.showModelerBtns) return ['pending','submitted'].includes(status);
  return false;
}

function renderFileSection(area, files, opts = {}) {
  const {
    canDelete = false, showAdminBtns = false, showModelerBtns = false,
    selectable = false, emptyMsg = 'ファイルがありません',
  } = opts;

  if (!files.length) {
    area.innerHTML = `<p style="color:var(--muted);padding:12px 0;font-size:13px;">${emptyMsg}</p>`;
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
    const name  = escapeHtml(f.file_name);
    const isSel = selectedFileIds.has(f.id);

    // 検査依頼前（pending）バッジは3Dモデルエリア（検査対象）でのみ表示
    const badge = (f.review_status === 'pending' || !f.review_status)
      ? ((showAdminBtns || showModelerBtns) ? reviewBadge('pending') : '')
      : reviewBadge(f.review_status);

    // バッジ横の検査者・依頼者表示（誰がいつ操作したか）
    const reviewMetaText = f.review_status === 'submitted'
      ? (f.review_requested_by_name ? `依頼: ${escapeHtml(f.review_requested_by_name)} ${f.review_requested_at || ''}` : '')
      : (['ok', 'revision', 'delivered'].includes(f.review_status) && f.reviewed_by_name
          ? `検査: ${escapeHtml(f.reviewed_by_name)} ${f.reviewed_at || ''}` : '');
    const reviewMeta = reviewMetaText
      ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">${reviewMetaText}</div>`
      : '';

    // 検査アクションは「⋯」メニューに集約する（行に3ボタン並べると
    // フォルダ行と重複して押し分けが分からなくなるため）。
    // 実行できない項目も消さず、その場に理由を出す
    const menuItems = fileReviewActions(f, { showAdminBtns, showModelerBtns }).map(a => `
      <button type="button" class="row-menu-item file-action-item"
              data-file-id="${f.id}" data-action="${a.key}" ${a.enabled ? '' : 'disabled'}>
        <i class="fa-solid ${a.icon}"></i>
        <span>${a.label}${a.enabled ? '' : `<span class="row-menu-item-reason">${a.reason}</span>`}</span>
      </button>`).join('');
    const deleteItem = canDelete ? `
      ${menuItems ? '<div class="row-menu-sep"></div>' : ''}
      <button type="button" class="row-menu-item is-danger file-delete-btn"
              data-file-id="${f.id}" data-file-name="${name}">
        <i class="fa-solid fa-trash"></i><span>このファイルを削除</span>
      </button>` : '';
    const rowMenu = (menuItems || deleteItem) ? `
      <div class="row-menu-wrap">
        <button type="button" class="row-menu-btn" title="その他の操作" aria-label="その他の操作">
          <i class="fa-solid fa-ellipsis"></i>
        </button>
        <div class="row-menu">${menuItems}${deleteItem}</div>
      </div>` : '';

    return `
    <div class="upload-file-item${isSel ? ' is-selected' : ''}" data-file-id="${f.id}" style="margin-left:${indentPx}px;">
      ${selectable ? `<input type="checkbox" class="file-select-cb" data-file-id="${f.id}"
              ${isSel ? 'checked' : ''} aria-label="このファイルを選択">` : ''}
      <div class="file-item-main">
        ${getFileIcon(f.file_name)}
        <div class="file-item-info">
          <div class="file-item-name">${name}</div>
          <div style="font-size:12px;color:var(--muted);">
            ${TYPE_LABEL[f.file_type]||f.file_type||'ファイル'} · ${formatBytes(f.file_size)} · ${escapeHtml(f.uploaded_by_name||f.uploaded_by||'')}
          </div>
          ${reviewMeta}
        </div>
      </div>
      <div class="file-item-actions">
        ${badge}
        ${canPreview ? `<button class="file-preview-btn" data-file-id="${f.id}" title="プレビュー">
          <i class="fa-solid fa-eye"></i>
        </button>` : ''}
        <button class="btn btn-ghost btn-sm file-download-btn" data-file-id="${f.id}"
                data-file-name="${name}" title="ダウンロード">
          <i class="fa-solid fa-download"></i>
        </button>
        ${rowMenu}
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
          subHeader = `<div class="file-tree-subdir" style="padding-left:${depth * 18}px;">
            <i class="fa-solid fa-folder"></i>${escapeHtml(subDir)}
          </div>`;
        }
      }
      return subHeader + renderFileItem(f, (depth + 1) * 18);
    }).join('');
  }

  let html = rootFiles.map(f => renderFileItem(f, 0)).join('');

  html += folderEntries.map(([topDir, groupFiles], idx) => {
    const isOpen = expandedFolderKeys.has(`${area.id}::${topDir}`);
    const totalSize = groupFiles.reduce((s, f) => s + (f.file_size || 0), 0);

    // フォルダ内の検査状況をまとめたバッジ（状態ごとに件数を表示）
    const statusCounts = {};
    groupFiles.forEach(f => {
      const s = f.review_status || 'pending';
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    });
    // 折りたたんだままでも「自分が対応すべき件数」が読めるようにする。
    // 要対応チップに含めた状態はバッジ側から外し、同じ件数を二重に出さない
    const attentionStatuses = showAdminBtns   ? ['submitted']
                            : showModelerBtns ? ['pending', 'revision']
                            : [];
    const attentionCount = attentionStatuses.reduce((n, s) => n + (statusCounts[s] || 0), 0);
    const attention = attentionCount
      ? `<span class="folder-attention"><i class="fa-solid fa-circle-exclamation"></i>要対応 ${attentionCount}件</span>`
      : '';

    const folderBadges = (showAdminBtns || showModelerBtns)
      ? ['submitted', 'revision', 'ok', 'delivered', 'pending']
          .filter(s => statusCounts[s] && !(attentionCount && attentionStatuses.includes(s)))
          .map(s => reviewBadge(s, statusCounts[s])).join('')
      : '';

    const ids = groupFiles.map(f => f.id);
    const selectedCount = ids.filter(id => selectedFileIds.has(id)).length;

    return `
    <div class="file-tree-group">
      <div class="file-tree-folder-row${selectedCount ? ' is-selected' : ''}" data-folder-idx="${idx}">
        ${selectable ? `<input type="checkbox" class="file-select-cb folder-select-cb"
                data-folder-idx="${idx}" data-file-ids="${ids.join(',')}"
                ${selectedCount === ids.length ? 'checked' : ''} aria-label="このフォルダのファイルをすべて選択">` : ''}
        <i class="fa-solid ${isOpen ? 'fa-chevron-down' : 'fa-chevron-right'} folder-toggle-icon"></i>
        <i class="fa-solid fa-folder" style="color:var(--accent);"></i>
        <div class="file-tree-folder-name">${escapeHtml(topDir)}</div>
        ${attention}
        ${folderBadges}
        <span class="file-tree-folder-meta">${groupFiles.length}件 · ${formatBytes(totalSize)}</span>
        <button class="btn btn-ghost btn-sm folder-save-btn tooltip-hint" data-folder-idx="${idx}"
                data-tooltip="クリック後に表示されるフォルダ選択画面で、デスクトップ・ドキュメント・ダウンロード自体は選択できません。その中のサブフォルダ（または新規作成したフォルダ）を選んでください。"
                style="${'showDirectoryPicker' in window ? '' : 'display:none;'}">
          <i class="fa-solid fa-folder-tree"></i>
        </button>
        <button class="btn btn-ghost btn-sm folder-zip-btn" data-folder-idx="${idx}"
                title="このフォルダをzipダウンロード">
          <i class="fa-solid fa-file-zipper"></i>
        </button>
      </div>
      <div class="file-tree-group-body" style="display:${isOpen ? '' : 'none'};">
        ${renderFolderBody(topDir, groupFiles)}
      </div>
    </div>`;
  }).join('');

  area.innerHTML = html;
  syncFolderCheckboxes(area);

  // フォルダ行の開閉トグル（チェックボックス・ボタンのクリックは伝播させない）
  area.querySelectorAll('.file-tree-folder-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('button') || e.target.closest('input')) return;
      const [topDir] = folderEntries[Number(row.dataset.folderIdx)];
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
  area.querySelectorAll('.folder-save-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const [, groupFiles] = folderEntries[Number(btn.dataset.folderIdx)];
      saveFilesToLocalFolder(groupFiles);
    });
  });
  area.querySelectorAll('.folder-zip-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const [, groupFiles] = folderEntries[Number(btn.dataset.folderIdx)];
      downloadFilesAsZip(groupFiles);
    });
  });

  // 選択チェックボックス（ファイル単位／フォルダ単位）
  area.querySelectorAll('.file-select-cb[data-file-id]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = Number(cb.dataset.fileId);
      if (cb.checked) selectedFileIds.add(id); else selectedFileIds.delete(id);
      refreshSelectionUI();
    });
  });
  area.querySelectorAll('.folder-select-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const ids = (cb.dataset.fileIds || '').split(',').filter(Boolean).map(Number);
      ids.forEach(id => cb.checked ? selectedFileIds.add(id) : selectedFileIds.delete(id));
      refreshSelectionUI();
    });
  });

  // 「⋯」メニューの開閉
  area.querySelectorAll('.row-menu-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const wrap = btn.closest('.row-menu-wrap');
      const willOpen = !wrap.classList.contains('open');
      closeAllRowMenus();
      if (!willOpen) return;
      wrap.classList.add('open');
      // 画面下部の行では上向きに開く
      const menu = wrap.querySelector('.row-menu');
      menu.classList.remove('drop-up');
      if (menu.getBoundingClientRect().bottom > window.innerHeight - 8) {
        menu.classList.add('drop-up');
      }
    });
  });

  // 「⋯」メニュー内の検査アクション
  area.querySelectorAll('.file-action-item:not([disabled])').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const fileId = Number(btn.dataset.fileId);
      const action = btn.dataset.action;
      closeAllRowMenus();
      const f = (project.files ?? []).find(x => x.id === fileId);
      if (f) runReviewAction(action, [f]);
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
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const fid  = Number(btn.dataset.fileId);
      const file = (project.files ?? []).find(x => x.id === fid);
      const fileName = file?.file_name ?? '';
      closeAllRowMenus();
      const ok = await openConfirmModal({
        title: 'ファイルの削除', icon: 'fa-trash', danger: true,
        body: 'このファイルを削除します。',
        files: [fileName],
        warn: '削除したファイルは元に戻せません。',
        okLabel: '削除する',
      });
      if (!ok) return;
      try {
        await api.delete(`/files/${fid}`);
        project.files = project.files.filter(f => f.id !== fid);
        selectedFileIds.delete(fid);
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

/* ══════════════════════════════════════════
   選択（チェックボックス）と一括アクションバー
   ══════════════════════════════════════════ */

function selectedFilesList() {
  return (project.files ?? []).filter(f => selectedFileIds.has(f.id));
}

function clearSelection() {
  selectedFileIds.clear();
  refreshSelectionUI();
}

/* フォルダ行のチェックボックスを 全選択／一部選択／未選択 の3状態に同期する */
function syncFolderCheckboxes(area) {
  area.querySelectorAll('.folder-select-cb').forEach(cb => {
    const ids = (cb.dataset.fileIds || '').split(',').filter(Boolean).map(Number);
    const n = ids.filter(id => selectedFileIds.has(id)).length;
    cb.checked = n > 0 && n === ids.length;
    cb.indeterminate = n > 0 && n < ids.length;
    cb.closest('.file-tree-folder-row')?.classList.toggle('is-selected', n > 0);
  });
}

/* チェック状態・行のハイライト・一括バーを、一覧を作り直さずにその場で同期する */
function refreshSelectionUI() {
  document.querySelectorAll('.upload-file-item[data-file-id]').forEach(row => {
    const sel = selectedFileIds.has(Number(row.dataset.fileId));
    row.classList.toggle('is-selected', sel);
    const cb = row.querySelector('.file-select-cb');
    if (cb) cb.checked = sel;
  });
  const modelArea = document.getElementById('modelFileArea');
  if (modelArea) syncFolderCheckboxes(modelArea);

  // サマリー行の「表示中を全選択」
  const all = document.getElementById('modelSelectAll');
  if (all) {
    const ids = (all.dataset.fileIds || '').split(',').filter(Boolean).map(Number);
    const n = ids.filter(id => selectedFileIds.has(id)).length;
    all.checked = n > 0 && n === ids.length;
    all.indeterminate = n > 0 && n < ids.length;
  }
  renderBulkBar();
}

/* 選択中のファイルに対する一括アクションバー。
   ボタンには実際に処理される件数を出し、0件のときは理由を帯の中に表示する */
function renderBulkBar() {
  const bar = document.getElementById('fileBulkBar');
  if (!bar) return;
  const files = selectedFilesList();
  if (!files.length) {
    bar.classList.add('hidden');
    document.body.classList.remove('has-bulk-bar');
    return;
  }
  bar.classList.remove('hidden');
  document.body.classList.add('has-bulk-bar');
  document.getElementById('fileBulkCount').textContent = `${files.length}件を選択中`;

  const opts = currentReviewOpts();
  const keys = opts.showAdminBtns   ? ['ok', 'revision', 'deliver']
             : opts.showModelerBtns ? ['request', 'cancel']
             : [];
  const notes = [];

  let html = keys.map(key => {
    const def  = BULK_ACTIONS[key];
    const acts = files.map(f => fileReviewActions(f, opts).find(a => a.key === key)).filter(Boolean);
    const n    = acts.filter(a => a.enabled).length;
    if (!n) {
      // できない理由は title 頼みにせず帯の中に出す
      const reason = [...new Set(acts.map(a => a.reason).filter(Boolean))][0];
      notes.push(`${def.label}: ${reason || '対象のファイルがありません'}`);
    } else if (n < files.length) {
      notes.push(`${def.label}にできるのは選択中${files.length}件のうち${n}件です`);
    }
    return `<button type="button" class="btn btn-sm ${n ? def.cls : 'btn-outline'} bulk-action-btn"
              data-action="${key}" ${n && !bulkBusy ? '' : 'disabled'}>
              <i class="fa-solid ${def.icon}"></i> ${def.label}${n ? ` ${n}件` : ''}
            </button>`;
  }).join('');

  // 発注者は選択したファイルのダウンロード
  if (isClient(user)) {
    html = `
      ${'showDirectoryPicker' in window ? `
      <button type="button" class="btn btn-sm btn-outline bulk-save-btn">
        <i class="fa-solid fa-folder-tree"></i> フォルダに保存
      </button>` : ''}
      <button type="button" class="btn btn-sm btn-primary bulk-zip-btn">
        <i class="fa-solid fa-file-zipper"></i> zipでダウンロード
      </button>`;
  }

  const actionsEl = document.getElementById('fileBulkActions');
  actionsEl.innerHTML = html || `<span style="font-size:13px;opacity:.75;">この状態では一括操作できません</span>`;

  const noteEl = document.getElementById('fileBulkNote');
  noteEl.style.display = notes.length ? '' : 'none';
  noteEl.textContent = notes.join(' ／ ');

  actionsEl.querySelectorAll('.bulk-action-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => runReviewAction(btn.dataset.action, selectedFilesList()));
  });
  actionsEl.querySelector('.bulk-save-btn')?.addEventListener('click', () =>
    saveFilesToLocalFolder(selectedFilesList()));
  actionsEl.querySelector('.bulk-zip-btn')?.addEventListener('click', () =>
    downloadFilesAsZip(selectedFilesList()));
}

document.getElementById('fileBulkClear')?.addEventListener('click', () => clearSelection());

/* 一括処理の進捗表示（逐次PATCHのため件数で出す） */
function setBulkProgress(done, total) {
  const wrap = document.getElementById('fileBulkProgress');
  if (!wrap) return;
  if (done >= total) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  document.getElementById('fileBulkProgressLabel').textContent = `${done} / ${total}件を処理中…`;
  document.getElementById('fileBulkProgressFill').style.width = `${Math.round(done / total * 100)}%`;
}

/* ══════════════════════════════════════════
   検査アクションの実行（行の⋯メニューと一括バーで共通）
   ══════════════════════════════════════════ */

async function runReviewAction(key, files) {
  if (bulkBusy) return;
  const opts = currentReviewOpts();
  // 実行できるファイルだけに絞る（選択の中に対象外が混ざっていても止めない）
  const targets = files.filter(f =>
    fileReviewActions(f, opts).some(a => a.key === key && a.enabled));
  if (!targets.length) return;

  const label = targets.length === 1 ? `「${targets[0].file_name}」` : `${targets.length}件`;

  // 納品はサーバー側で以後変更できない＝元に戻せないため、必ず確認する
  if (key === 'deliver') {
    const ok = await openConfirmModal({
      title: '発注者へ納品', icon: 'fa-truck',
      body: `検査OKの ${targets.length}件を発注者へ納品します。納品すると発注者がこれらのファイルを閲覧・ダウンロードできるようになります。`,
      files: targets.map(f => f.file_name),
      warn: '納品したファイルは元に戻せません。',
      okLabel: `${targets.length}件を納品する`,
    });
    if (!ok) return;
  }

  // 「元に戻す」用に実行前の状態を控える
  const prev = targets.map(f => ({ id: f.id, status: f.review_status || 'pending' }));

  bulkBusy = true;
  renderBulkBar();
  const failed = await setFilesReviewStatus(
    targets.map(f => f.id), ACTION_TARGET_STATUS[key],
    targets.length > 1 ? setBulkProgress : null);
  bulkBusy = false;
  setBulkProgress(1, 1);

  if (failed) {
    showToast(`${failed}件の更新に失敗しました`, 'danger');
    refreshSelectionUI();
    return;
  }

  // 処理し終えた分は選択から外す（同じ操作の二度押しを防ぐ）
  prev.forEach(p => selectedFileIds.delete(p.id));
  refreshSelectionUI();

  const { type, msg } = ACTION_TOAST[key];
  // 納品は取り消せない。権限的に戻せない状態が混ざる場合もUndoは出さない
  const undoable = key !== 'deliver' && prev.every(p => canSetStatus(p.status, opts));
  if (undoable) showUndoToast(msg(label), () => undoReviewStatuses(prev), type);
  else showToast(msg(label), type);
}

/* 「元に戻す」: 実行前の状態ごとにまとめて戻す */
async function undoReviewStatuses(prev) {
  const byStatus = new Map();
  prev.forEach(p => {
    if (!byStatus.has(p.status)) byStatus.set(p.status, []);
    byStatus.get(p.status).push(p.id);
  });
  let failed = 0;
  for (const [status, ids] of byStatus) {
    failed += await setFilesReviewStatus(ids, status);
  }
  if (failed) showToast(`${failed}件を元に戻せませんでした`, 'danger');
  else        showToast('元に戻しました', 'success');
}

/* ══════════════════════════════════════════
   「⋯」メニュー・Undoトースト・確認モーダル
   ══════════════════════════════════════════ */

/* ⋯メニューをすべて閉じる。開いている間に保留した再描画があればここで流す */
function closeAllRowMenus() {
  document.querySelectorAll('.row-menu-wrap.open').forEach(w => w.classList.remove('open'));
  if (pendingFileRerender) {
    pendingFileRerender = false;
    renderFiles();
  }
}
document.addEventListener('click', () => closeAllRowMenus());
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllRowMenus(); });

/* 「元に戻す」ボタン付きトースト。undoFn 実行後はトーストを閉じる */
function showUndoToast(msg, undoFn, type = 'success', seconds = 8) {
  const c = document.getElementById('toastContainer');
  if (!c) { return; }
  const t = document.createElement('div');
  t.className = `toast ${type ? 'toast-' + type : ''}`;
  t.innerHTML = `
    <i class="fa-solid ${type === 'danger' ? 'fa-circle-xmark' : 'fa-check-circle'}"></i>
    <span style="flex:1;">${escapeHtml(msg)}</span>
    <button type="button" class="toast-undo-btn">
      <i class="fa-solid fa-rotate-left"></i> 元に戻す <span class="toast-undo-sec">${seconds}</span>
    </button>
    <button type="button" class="toast-close-btn" aria-label="閉じる"><i class="fa-solid fa-xmark"></i></button>`;
  c.appendChild(t);

  let left = seconds;
  const secEl = t.querySelector('.toast-undo-sec');
  const timer = setInterval(() => {
    left--;
    if (secEl) secEl.textContent = left;
    if (left <= 0) { clearInterval(timer); t.remove(); }
  }, 1000);
  const close = () => { clearInterval(timer); t.remove(); };

  t.querySelector('.toast-close-btn').addEventListener('click', close);
  t.querySelector('.toast-undo-btn').addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    clearInterval(timer);
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 戻しています';
    try { await undoFn(); } finally { close(); }
  });
}

/* 取り消せない操作の確認モーダル。OK なら true を返す */
function openConfirmModal({ title, icon = 'fa-circle-question', body = '', files = [],
                           warn = '', okLabel = '実行する', danger = false }) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirmActionModal');
    if (!overlay) { resolve(false); return; }

    overlay.querySelector('#confirmActionTitle').innerHTML =
      `<i class="fa-solid ${icon}" style="margin-right:6px;${danger ? 'color:#e74c3c;' : ''}"></i>${escapeHtml(title)}`;
    overlay.querySelector('#confirmActionBody').textContent = body;

    const listEl = overlay.querySelector('#confirmActionFiles');
    listEl.style.display = files.length ? '' : 'none';
    listEl.innerHTML = files
      .map(n => `<li><i class="fa-solid fa-file"></i>${escapeHtml(n)}</li>`).join('');

    const warnEl = overlay.querySelector('#confirmActionWarn');
    warnEl.style.display = warn ? '' : 'none';
    overlay.querySelector('#confirmActionWarnText').textContent = warn;

    const okBtn = overlay.querySelector('#confirmActionOk');
    okBtn.textContent = okLabel;
    okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;

    overlay.classList.remove('hidden');

    const done = (result) => {
      overlay.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      overlay.querySelector('#confirmActionCancel').removeEventListener('click', onCancel);
      overlay.querySelector('#confirmActionClose').removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onOk      = () => done(true);
    const onCancel  = () => done(false);
    const onOverlay = e => { if (e.target === overlay) done(false); };
    const onKey     = e => { if (e.key === 'Escape') done(false); };

    okBtn.addEventListener('click', onOk);
    overlay.querySelector('#confirmActionCancel').addEventListener('click', onCancel);
    overlay.querySelector('#confirmActionClose').addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
  });
}

/* ══════════════════════════════════════════
   3Dモデルエリアのサマリー行・ガイド行
   ══════════════════════════════════════════ */

/* 状態別の件数バッジ（クリックで絞り込み）＋「表示中を全選択」 */
function renderModelSummary(visible, shown, selectable) {
  const el = document.getElementById('modelFileSummary');
  if (!el) return;
  if (!visible.length) { el.style.display = 'none'; return; }
  el.style.display = '';

  const counts = {};
  visible.forEach(f => { const s = f.review_status || 'pending'; counts[s] = (counts[s] || 0) + 1; });

  const chips = ['submitted', 'revision', 'ok', 'delivered', 'pending']
    .filter(s => counts[s])
    .map(s => {
      const m = REVIEW_STATUS_META[s];
      const active = modelStatusFilter === s;
      return `<button type="button" class="badge ${m.cls} status-filter-chip${active ? ' is-active' : ''}"
                data-status="${s}"
                title="${active ? 'クリックで絞り込みを解除' : `${m.label}のファイルだけ表示`}">
                ${m.label} ${counts[s]}
              </button>`;
    }).join('');

  const ids = shown.map(f => f.id);
  const selectAll = selectable && ids.length ? `
    <label class="file-select-all-label">
      <input type="checkbox" class="file-select-cb" id="modelSelectAll" data-file-ids="${ids.join(',')}">
      表示中の${ids.length}件を選択
    </label>` : '';

  el.innerHTML = `
    ${selectAll}
    <span class="file-status-summary-total">全${visible.length}件</span>
    <span class="file-status-summary-spacer"></span>
    ${chips}
    ${modelStatusFilter ? `
      <button type="button" class="btn btn-ghost btn-sm" id="modelFilterClear" style="font-size:12px;">
        <i class="fa-solid fa-xmark"></i> 絞り込み解除
      </button>` : ''}`;

  el.querySelectorAll('.status-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      modelStatusFilter = modelStatusFilter === chip.dataset.status ? null : chip.dataset.status;
      renderFiles();
    });
  });
  el.querySelector('#modelFilterClear')?.addEventListener('click', () => {
    modelStatusFilter = null;
    renderFiles();
  });
  el.querySelector('#modelSelectAll')?.addEventListener('change', e => {
    ids.forEach(id => e.target.checked ? selectedFileIds.add(id) : selectedFileIds.delete(id));
    refreshSelectionUI();
  });
}

/* 「次に何をすべきか」を1行だけ案内する */
function renderModelGuide(visible, opts) {
  const el = document.getElementById('modelFileGuide');
  if (!el) return;
  const c = {};
  visible.forEach(f => { const s = f.review_status || 'pending'; c[s] = (c[s] || 0) + 1; });

  let text = '', cls = '';
  if (opts.showAdminBtns) {
    if (c.submitted)      { text = `検査依頼中のファイルが${c.submitted}件あります。ファイルを選んで「検査OK」または「修正依頼」を実行してください。`; cls = 'guide-action'; }
    else if (c.ok)        { text = `検査OKが${c.ok}件あります。「納品」すると発注者に公開されます。`; cls = 'guide-action'; }
    else if (c.revision)  { text = `修正依頼中が${c.revision}件あります。モデラーの再提出をお待ちください。`; cls = 'guide-wait'; }
    else if (c.pending)   { text = 'モデラーが作業中です。検査依頼が届くとここに表示されます。'; cls = 'guide-wait'; }
    else if (c.delivered) { text = 'すべて納品済みです。'; }
  } else if (opts.showModelerBtns) {
    if (c.revision)       { text = `修正依頼が${c.revision}件あります。修正データをアップロードし、あらためて検査を依頼してください。`; cls = 'guide-action'; }
    else if (c.pending)   { text = `未提出のファイルが${c.pending}件あります。ファイルを選んで「検査依頼」してください。`; cls = 'guide-action'; }
    else if (c.submitted) { text = `${c.submitted}件を検査依頼中です。管理者の検査をお待ちください。`; cls = 'guide-wait'; }
    else if (c.ok || c.delivered) { text = '検査が完了しています。'; }
  } else if (isClient(user) && visible.length) {
    text = '納品されたデータです。個別またはまとめてダウンロードできます。';
  }

  el.style.display = text ? '' : 'none';
  el.className = `file-guide-row ${cls}`;
  el.innerHTML = text
    ? `<i class="fa-solid ${cls === 'guide-action' ? 'fa-circle-exclamation' : 'fa-circle-info'}"></i><span>${text}</span>`
    : '';
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

/* 「制作チーム」は社内側（HaLSpace運営会社＋モデラー専属会社）のやり取り用なので
   発注者には見せない。発注者会社の管理者(role=admin)も外部なので同じ扱いにする
   （hasAdminLevelAccess で判定しないのはこのため）。
   モデラーは発注者⇄管理者間の「お客様連絡」には入らない。
   バックエンドの User::accessibleCommentChannels() と揃えること。 */
function canAccessChannel(ch) {
  if (isSuperAdmin(user) || isOperator(user)) return true;
  if (ch === 'client')  return !isModeler(user);
  if (ch === 'modeler') return isModeler(user);
  return false;
}

let currentChannel = isModeler(user) ? 'modeler' : 'client';
let pendingImages  = [];

function initChatTabs() {
  const tabs = document.getElementById('chatTabs');

  tabs.querySelectorAll('.chat-tab').forEach(btn => {
    // 閲覧権限のないチャンネルのタブは出さない
    //（発注者に「制作チーム」、モデラーに「お客様連絡」は見せない）
    btn.style.display = canAccessChannel(btn.dataset.ch) ? '' : 'none';
    btn.classList.toggle('active', btn.dataset.ch === currentChannel);

    btn.addEventListener('click', () => {
      if (!canAccessChannel(btn.dataset.ch)) return;
      currentChannel = btn.dataset.ch;
      tabs.querySelectorAll('.chat-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderChat();
      updateChatBadges();
      markChannelRead(currentChannel);
    });
  });

  // 表示中のタブは常に既読扱いにする（未読バッジは「今見ていないタブに新着がある」ことだけを示す）
  updateChatBadges();
  markChannelRead(currentChannel);
}

/* タブの未読バッジ（project.unread_client / unread_modeler）を反映する。
   今表示中のチャンネルは既読マーク済みなので出さない。 */
function updateChatBadges() {
  const tabs = document.getElementById('chatTabs');
  if (!tabs) return;
  ['client', 'modeler'].forEach(ch => {
    const badge = tabs.querySelector(`[data-badge="${ch}"]`);
    if (!badge) return;
    const n = ch === 'client' ? (project.unread_client ?? 0) : (project.unread_modeler ?? 0);
    if (n > 0 && ch !== currentChannel) {
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  });
}

/* 案件一覧のバッジ用に project.comments 読了時刻をサーバーへ記録する */
async function markChannelRead(channel) {
  try {
    await api.post(`/projects/${projId}/comments/read`, { channel });
  } catch {
    return;
  }
  if (channel === 'client')  project.unread_client  = 0;
  if (channel === 'modeler') project.unread_modeler = 0;
  updateChatBadges();
}

/* チャットカードの高さを実際のビューポート残り分に合わせる
   （sticky固定前はカードの上端が画面上部より下にあるため、
   固定のcalc(100vh - 100px)だけでは入力欄が画面外にはみ出すことがある） */
function adjustChatCardHeight() {
  const card = document.querySelector('.chat-card');
  if (!card) return;
  if (window.innerWidth <= 1024) {
    card.style.height = '';
    return;
  }
  const top = card.getBoundingClientRect().top;
  const available = window.innerHeight - top - 20;
  card.style.height = Math.max(300, available) + 'px';
}
window.addEventListener('resize', adjustChatCardHeight);
window.addEventListener('scroll', adjustChatCardHeight, { passive: true });

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
    const canDel = Number(c.user_id) === Number(user.id) || hasAdminLevelAccess(user);
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

/* ── review_status 一括更新（同時リクエストを避けるため逐次実行し、描画は最後に1回）。
      1件のときも同じ経路を通す ── */
async function setFilesReviewStatus(fileIds, status, onProgress = null) {
  let failed = 0;
  let projectStatus = null;
  let done = 0;
  for (const fileId of fileIds) {
    onProgress?.(done, fileIds.length);
    try {
      const data = await api.patch(`/files/${fileId}/review-status`, { review_status: status });
      const f = project.files.find(x => x.id === fileId);
      if (f) Object.assign(f, data?.file ?? { review_status: status });
      if (data?.project_status) projectStatus = data.project_status;
      if (data?.project_delivered_at) project.delivered_at = data.project_delivered_at;
    } catch (err) {
      failed++;
    }
    done++;
  }
  onProgress?.(done, fileIds.length);
  if (projectStatus && projectStatus !== project.status) {
    project.status = projectStatus;
    renderInfo();
  }
  renderFiles();
  renderTimeline();
  return failed;
}

/* 管理者検査バーのボタンは状況で役割が変わるため、ラベル・色・活性をここで決める。
   修正依頼が1件でもあれば差し戻し、なければ納品完了の確定 */
function updateAdminReviewBarState() {
  const btn = document.getElementById('adminPublishBtn');
  if (!btn) return;
  const modelFiles  = (project.files ?? []).filter(f => MODEL_TYPES.includes(f.file_type));
  const hasRevision = modelFiles.some(f => f.review_status === 'revision');
  const hasOk       = modelFiles.some(f => ['ok', 'delivered'].includes(f.review_status));

  btn.dataset.mode = hasRevision ? 'revision' : 'deliver';
  btn.innerHTML = hasRevision
    ? '<i class="fa-solid fa-rotate-left"></i> 修正依頼をモデラーへ差し戻す'
    : '<i class="fa-solid fa-flag-checkered"></i> 納品完了にする';
  btn.className = `btn btn-sm ${hasRevision ? 'btn-outline' : 'btn-success'}`;

  const enabled = hasRevision || hasOk;
  btn.disabled = !enabled;
  btn.style.opacity = enabled ? '1' : '0.5';

  const note = document.getElementById('adminReviewBarNote');
  if (note) {
    note.textContent = hasRevision
      ? '修正依頼のファイルがあります。差し戻すとモデラーの作業に戻ります。'
      : '各ファイルを検査・納品したうえで、案件を納品完了にしてください。3Dデータを全件納品すると自動で完了します。';
  }
}

/* ── 管理者: 納品完了の確定／修正依頼の差し戻し ── */
document.getElementById('adminPublishBtn')?.addEventListener('click', async () => {
  const modelFiles = (project.files ?? []).filter(f => MODEL_TYPES.includes(f.file_type));

  if (document.getElementById('adminPublishBtn').dataset.mode === 'revision') {
    await updateStatus('revision_requested');
    showToast('修正依頼のファイルをモデラーへ差し戻しました', 'warning');
    return;
  }

  // 未納品のまま完了にすると発注者に届かないファイルが残るため、件数を出して確認する
  const undelivered = modelFiles.filter(f => f.review_status !== 'delivered');
  const ok = await openConfirmModal({
    title: '案件を納品完了にする', icon: 'fa-flag-checkered',
    body: 'この案件を納品完了にします。以降このプロジェクトのステータスは変更できません。',
    files: undelivered.map(f => f.file_name),
    warn: undelivered.length
      ? `未納品のファイルが${undelivered.length}件あります。納品しないと発注者には表示されません。`
      : '',
    okLabel: '納品完了にする',
  });
  if (!ok) return;

  await updateStatus('delivered');
  showToast('案件を納品完了にしました', 'success');
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
  if (!isModeler(user) && !hasAdminLevelAccess(user)) {
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
  if (hasAdminLevelAccess(user) || isModeler(user)) {
    try {
      const data = await api.get('/projects/modelers');
      allModelers = data.modelers || [];
    } catch {}
  }
  await loadProject();
  adjustChatCardHeight();

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
    if (commentsChanged) {
      renderChat();
      updateChatBadges();
      // 表示中のチャンネルに新着が来ても、開いたまま見ているので既読のまま維持する
      markChannelRead(currentChannel);
    }
    // 納期回答フォームに入力中は再描画しない（入力内容が消えるのを防ぐ）
    if ((statusChanged || deadlineChanged)
        && !document.getElementById('deadlinePanel')?.contains(document.activeElement)) {
      renderDeadlinePanel();
    }
  }, 3000);
}
init();
