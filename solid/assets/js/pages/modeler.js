'use strict';

const user = requireSpaceAuth();
if (!user) throw new Error('未認証');
renderSidebarUser(user);

const STATUS_LABEL = {
  submitted:          '提出済み（未着手）',
  in_progress:        'モデリング中',
  review_pending:     '検査待ち',
  revision_requested: '修正依頼中',
  cancelled:          'キャンセル',
};

/* ステータスに応じた次アクション */
const NEXT_ACTION = {
  submitted:          { label:'モデリング開始', next:'in_progress',    cls:'btn-blue',    icon:'fa-play' },
  in_progress:        { label:'完成・提出',     next:'review_pending', cls:'btn-success',  icon:'fa-paper-plane', showUpload: true },
  revision_requested: { label:'修正完了・再提出', next:'review_pending', cls:'btn-warning', icon:'fa-rotate-right', showUpload: true },
};

let projects = [];
let uploadTargetId = null;
let pendingFiles   = [];

/* ── データ取得 ── */
async function loadProjects() {
  try {
    const data = await api.get('/projects');
    projects = (data?.projects ?? []).filter(p =>
      ['submitted', 'in_progress', 'review_pending', 'revision_requested', 'cancelled'].includes(p.status)
    );
  } catch {
    projects = MOCK.projects.filter(p =>
      ['submitted', 'in_progress', 'review_pending', 'revision_requested', 'cancelled'].includes(p.status)
    );
  }
  renderTable();
}

/* ── テーブル描画 ── */
function renderTable() {
  document.getElementById('cntNew').textContent      = projects.filter(p => p.status === 'submitted').length;
  document.getElementById('cntProgress').textContent = projects.filter(p => p.status === 'in_progress').length;
  document.getElementById('cntRevision').textContent = projects.filter(p => p.status === 'revision_requested').length;

  const tbody = document.getElementById('modelerBody');
  const empty = document.getElementById('emptyMsg');
  const table = document.getElementById('modelerTable');

  tbody.innerHTML = '';

  if (!projects.length) {
    empty.style.display = '';
    table.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  table.style.display = '';

  projects.forEach(p => {
    const act = NEXT_ACTION[p.status];
    const companyName = p.company_name ?? p.company ?? '—';
    const isCancelled = p.status === 'cancelled';
    const tr = document.createElement('tr');
    if (isCancelled) tr.style.opacity = '0.5';
    tr.innerHTML = `
      <td><code style="color:var(--blue);font-size:12px;">${p.project_code}</code></td>
      <td><a href="project-detail.html?id=${p.id}" style="font-weight:600;${isCancelled?'text-decoration:line-through;color:var(--muted);':''}">${p.title}</a></td>
      <td style="font-size:13px;">${companyName}</td>
      <td><span class="badge badge-${p.status}">${STATUS_LABEL[p.status] || p.status}</span></td>
      <td style="font-size:13px;">${p.deadline_requested || '—'}</td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${!isCancelled && act ? `<button class="btn ${act.cls} btn-sm action-btn"
              data-id="${p.id}" data-next="${act.next}" data-upload="${act.showUpload ? '1' : '0'}">
              <i class="fa-solid ${act.icon}"></i> ${act.label}
            </button>` : ''}
          <a href="project-detail.html?id=${p.id}" class="btn btn-ghost btn-sm">
            <i class="fa-solid fa-arrow-right"></i> 詳細
          </a>
        </div>
      </td>`;
    tbody.appendChild(tr);
  });
}

/* ── ステータス変更 ── */
async function updateStatus(projectId, nextStatus) {
  try {
    const data = await api.patch(`/projects/${projectId}/status`, { status: nextStatus });
    const updated = data.project;
    const idx = projects.findIndex(p => p.id === projectId);
    if (idx !== -1) projects[idx] = { ...projects[idx], ...updated };
    renderTable();
    showToast('ステータスを更新しました', 'success');
  } catch (err) {
    showToast('更新に失敗しました: ' + err.message, 'danger');
  }
}

/* ── テーブルのボタンクリック ── */
document.getElementById('modelerBody').addEventListener('click', async e => {
  const btn = e.target.closest('.action-btn');
  if (!btn) return;

  const pid    = Number(btn.dataset.id);
  const next   = btn.dataset.next;
  const upload = btn.dataset.upload === '1';

  if (upload) {
    /* アップロードモーダルを開く */
    const proj = projects.find(p => p.id === pid);
    openUploadModal(pid, proj?.title ?? '');
  } else {
    /* 直接ステータス変更（モデリング開始） */
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    await updateStatus(pid, next);
  }
});

/* ── アップロードモーダル ── */
function openUploadModal(projectId, projectTitle) {
  uploadTargetId = projectId;
  pendingFiles   = [];
  document.getElementById('uploadModalProject').textContent = `対象: ${projectTitle}`;
  document.getElementById('modalFileList').innerHTML = '';
  document.getElementById('uploadSubmitBtn').disabled = true;
  document.getElementById('modalUploadProgress').style.display = 'none';
  document.getElementById('modalUploadProgressFill').style.width = '0%';
  document.getElementById('uploadModal').classList.remove('hidden');
}

function closeUploadModal() {
  document.getElementById('uploadModal').classList.add('hidden');
  uploadTargetId = null;
  pendingFiles   = [];
}

['uploadModalClose', 'uploadModalClose2'].forEach(id =>
  document.getElementById(id).addEventListener('click', closeUploadModal)
);

/* ドラッグ&ドロップ（フォルダ対応） */
const dropZone = document.getElementById('modalUploadZone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', async e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  addItems(await collectDroppedItems(e.dataTransfer));
});
document.getElementById('modalFileInput').addEventListener('change', e => {
  addItems(Array.from(e.target.files).map(f => ({ file: f, relativePath: '' })));
  e.target.value = '';
});
document.getElementById('modalFolderPickBtn').addEventListener('click', () => {
  document.getElementById('modalFolderInput').click();
});
document.getElementById('modalFolderInput').addEventListener('change', e => {
  addItems(filesFromDirectoryInput(e.target));
  e.target.value = '';
});

function addItems(items) {
  let skipped = 0;
  items.forEach(({ file, relativePath }) => {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!SOLID_3D_EXTS.includes(ext)) {
      skipped++;
      return;
    }
    if (!pendingFiles.find(x => x.file.name === file.name && x.file.size === file.size && x.relativePath === relativePath)) {
      pendingFiles.push({ file, relativePath });
    }
  });
  if (skipped > 0) {
    showToast(`対応外の形式のファイルを${skipped}件スキップしました`, 'warning');
  }
  renderModalFileList();
}

function renderModalFileList() {
  const list = document.getElementById('modalFileList');
  list.innerHTML = pendingFiles.map((item, i) => `
    <div class="upload-file-item">
      <i class="fa-solid fa-cube file-type-icon file-type-3d"></i>
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:600;">${item.file.name}</div>
        <div style="font-size:12px;color:var(--muted);">
          ${item.relativePath ? item.relativePath.split('/').slice(0, -1).join('/') + ' · ' : ''}${formatBytes(item.file.size)}
        </div>
      </div>
      <button class="upload-file-remove" data-idx="${i}"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('');

  list.querySelectorAll('.upload-file-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingFiles.splice(Number(btn.dataset.idx), 1);
      renderModalFileList();
    });
  });

  document.getElementById('uploadSubmitBtn').disabled = pendingFiles.length === 0;
}

/* ── アップロード実行 ── */
document.getElementById('uploadSubmitBtn').addEventListener('click', async () => {
  if (!uploadTargetId || !pendingFiles.length) return;

  const btn = document.getElementById('uploadSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> アップロード中...';

  const progressWrap  = document.getElementById('modalUploadProgress');
  const progressCount = document.getElementById('modalUploadProgressCount');
  const progressName  = document.getElementById('modalUploadProgressName');
  const progressFill  = document.getElementById('modalUploadProgressFill');
  progressWrap.style.display = '';

  const { uploaded, errors } = await uploadItemsSequential(uploadTargetId, pendingFiles, {
    fileType: 'model_3d',
    onProgress: ({ doneCount, total, currentName, doneBytes, totalBytes }) => {
      progressCount.textContent = `${doneCount} / ${total} ファイル`;
      progressName.textContent = currentName;
      progressFill.style.width = totalBytes ? `${Math.round((doneBytes / totalBytes) * 100)}%` : '0%';
    },
  });

  // アップロードしたファイルをファイル単位で検査依頼（submitted）にする
  for (const f of uploaded) {
    try {
      await api.patch(`/files/${f.id}/review-status`, { review_status: 'submitted' });
    } catch {}
  }

  if (errors.length) {
    showToast(`アップロード失敗: ${errors.join(', ')}`, 'danger');
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-upload"></i> アップロードして提出する';
    return;
  }

  /* アップロード成功 → ステータスを review_pending に変更 */
  const proj = projects.find(p => p.id === uploadTargetId);
  const nextStatus = NEXT_ACTION[proj?.status]?.next ?? 'review_pending';
  closeUploadModal();
  await updateStatus(uploadTargetId, nextStatus);
  showToast('3Dデータをアップロードし、検査待ちにしました', 'success');
});

/* ── 初期化 ── */
loadProjects();

// タブ表示中は30秒ごと＋タブ復帰時に即時、一覧を自動更新
startAutoRefresh(loadProjects, 30000);
