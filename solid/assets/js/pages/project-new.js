'use strict';

const user = requireSpaceAuth();
if (!user) throw new Error('未認証');
renderSidebarUser(user);
if (isAdmin(user)) document.getElementById('adminLink').style.display = '';

/* ウィザード管理（2ステップ） */
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;
let pendingItems = []; // {file, relativePath}[]

/* ドラッグ&ドロップ（フォルダ対応） */
const dropZone = document.getElementById('uploadZone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', async e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  addItems(await collectDroppedItems(e.dataTransfer));
});
document.getElementById('fileInput').addEventListener('change', e => {
  addItems(Array.from(e.target.files).map(f => ({ file: f, relativePath: '' })));
  e.target.value = '';
});
document.getElementById('folderPickBtn').addEventListener('click', () => {
  document.getElementById('folderInput').click();
});
document.getElementById('folderInput').addEventListener('change', e => {
  addItems(filesFromDirectoryInput(e.target));
  e.target.value = '';
});
document.getElementById('wnPickBtn').addEventListener('click', () => {
  openWnPicker({ onConfirm: addWnItems });
});

function addItems(items) {
  let oversized = 0;
  items.forEach(({ file, relativePath }) => {
    if (file.size > MAX_UPLOAD_SIZE) { oversized++; return; }
    if (!pendingItems.find(x => x.file && x.file.name === file.name && x.file.size === file.size && x.relativePath === relativePath)) {
      pendingItems.push({ file, relativePath });
    }
  });
  if (oversized > 0) {
    showToast(`100MBを超えるファイルを${oversized}件スキップしました`, 'danger');
  }
  renderFileList();
}

/* What'sNoピッカーで選択されたファイルをpendingItemsに追加（wnFile.idで重複排除） */
function addWnItems(wnFiles) {
  let added = 0;
  wnFiles.forEach(wnFile => {
    if (!pendingItems.find(x => x.wnFile && x.wnFile.id === wnFile.id)) {
      pendingItems.push({ wnFile, relativePath: '' });
      added++;
    }
  });
  if (added > 0) renderFileList();
}

function fileNameOf(item) { return item.file ? item.file.name : item.wnFile.file_name; }
function fileSizeOf(item) { return item.file ? item.file.size : item.wnFile.file_size; }

function renderFileList() {
  const list = document.getElementById('fileList');
  list.innerHTML = pendingItems.map((item, i) => `
    <div class="upload-file-item">
      ${getFileIcon(fileNameOf(item))}
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:600;">${fileNameOf(item)}${item.wnFile ? ' <span style="font-weight:400;color:var(--blue);">(What\'sNo)</span>' : ''}</div>
        <div style="font-size:12px;color:var(--muted);">
          ${item.relativePath ? item.relativePath.split('/').slice(0, -1).join('/') + ' · ' : ''}${formatBytes(fileSizeOf(item))}
        </div>
      </div>
      <button class="upload-file-remove" data-idx="${i}"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('');

  list.querySelectorAll('.upload-file-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingItems.splice(Number(btn.dataset.idx), 1);
      renderFileList();
    });
  });

  document.getElementById('step1Next').disabled = pendingItems.length === 0;
}

function goStep(n) {
  [1, 2].forEach(i => {
    document.getElementById(`panel${i}`).style.display = i === n ? '' : 'none';
    const ws = document.getElementById(`wStep${i}`);
    ws.className = 'wizard-step' + (i < n ? ' done' : i === n ? ' active' : '');
    ws.querySelector('.wizard-num').innerHTML =
      i < n ? '<i class="fa-solid fa-check" style="font-size:12px;"></i>' : String(i);
  });
  document.getElementById('wLine1').className = 'wizard-line' + (n > 1 ? ' done' : '');
}

/* Step1 → 2 */
document.getElementById('step1Next').addEventListener('click', () => {
  const minDate = new Date();
  let added = 0;
  while (added < 3) {
    minDate.setDate(minDate.getDate() + 1);
    const dow = minDate.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  const minStr = minDate.toISOString().split('T')[0];
  const deadlineEl = document.getElementById('projDeadline');
  deadlineEl.min = minStr;
  if (!deadlineEl.value) deadlineEl.value = minStr;
  goStep(2);
  renderConfirm();
});

document.getElementById('step2Back').addEventListener('click', () => goStep(1));

['projTitle', 'projDeadline', 'projPriority', 'projDesc'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', renderConfirm);
  document.getElementById(id)?.addEventListener('change', renderConfirm);
});

function renderConfirm() {
  const title    = document.getElementById('projTitle').value || '（未入力）';
  const deadline = document.getElementById('projDeadline').value || '—';
  const priority = document.getElementById('projPriority').value;
  const desc     = document.getElementById('projDesc').value || '—';
  const priorityLabel = { normal:'通常', high:'高', urgent:'緊急' };

  document.getElementById('confirmSummary').innerHTML = `
    <div style="font-size:13px;font-weight:700;color:var(--muted);margin-bottom:12px;letter-spacing:.04em;">発注内容の確認</div>
    <table style="width:100%;font-size:14px;border-collapse:collapse;">
      <tr><td style="padding:8px 0;color:var(--muted);width:130px;vertical-align:top;">タイトル</td>
          <td style="font-weight:700;">${title}</td></tr>
      <tr><td style="padding:8px 0;color:var(--muted);vertical-align:top;">希望納期</td>
          <td style="${deadline==='—'?'color:var(--danger);':'font-weight:600;'}">${deadline}</td></tr>
      <tr><td style="padding:8px 0;color:var(--muted);vertical-align:top;">優先度</td>
          <td><span class="priority-${priority}">${priorityLabel[priority]||priority}</span></td></tr>
      <tr><td style="padding:8px 0;color:var(--muted);vertical-align:top;">備考</td>
          <td style="white-space:pre-wrap;font-size:13px;">${desc}</td></tr>
      <tr><td style="padding:8px 0;color:var(--muted);vertical-align:top;">添付ファイル</td>
          <td>${pendingItems.map(it => `<div style="font-size:13px;">${getFileIcon(fileNameOf(it))} ${fileNameOf(it)}</div>`).join('') || '—'}</td></tr>
    </table>`;
}

/* ── ファイル種別判定 ── */
function resolveDrawingFileType(name) {
  const ext = name.split('.').pop().toLowerCase();
  return ['dxf', 'dwg'].includes(ext) ? 'drawing_dxf'
       : ext === 'pdf'                ? 'drawing_pdf'
       : 'reference';
}

/* ── 発注確定 ── */
document.getElementById('submitBtn').addEventListener('click', async () => {
  const title    = document.getElementById('projTitle').value.trim();
  const deadline = document.getElementById('projDeadline').value;
  const priority = document.getElementById('projPriority').value;
  const desc     = document.getElementById('projDesc').value.trim();

  if (!title)    { showToast('タイトルを入力してください', 'danger'); return; }
  if (!deadline) { showToast('希望納期を設定してください', 'danger'); return; }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 送信中...';

  /* ── Step1: プロジェクト作成 ── */
  let newProjId;
  try {
    const data = await api.post('/projects', {
      title,
      deadline_requested: deadline,
      priority,
      spec_note: desc,
    });
    newProjId = data.project.id;
  } catch (err) {
    showToast('発注の作成に失敗しました: ' + err.message, 'danger');
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> 発注を確定する';
    return;
  }

  /* ── Step2: What'sNo由来ファイルの紐付け（直列） ── */
  const wnItems = pendingItems.filter(it => it.wnFile);
  if (wnItems.length > 0) {
    const wnErrors = [];
    for (const it of wnItems) {
      try {
        await api.post(`/projects/${newProjId}/files/from-wn`, {
          wn_file_id: it.wnFile.id,
          file_type: resolveDrawingFileType(it.wnFile.file_name),
        });
      } catch (err) {
        wnErrors.push(it.wnFile.file_name);
      }
    }
    if (wnErrors.length > 0) {
      showToast(`What'sNoファイルの追加に失敗しました: ${wnErrors.join(', ')}`, 'warning');
    }
  }

  /* ── Step2: ローカルファイルアップロード（直列） ── */
  const localItems = pendingItems.filter(it => it.file);
  if (localItems.length > 0) {
    const progressWrap  = document.getElementById('submitUploadProgress');
    const progressCount = document.getElementById('submitUploadProgressCount');
    const progressName  = document.getElementById('submitUploadProgressName');
    const progressFill  = document.getElementById('submitUploadProgressFill');
    progressWrap.style.display = '';

    const { errors } = await uploadItemsSequential(newProjId, localItems, {
      fileType: item => resolveDrawingFileType(item.file.name),
      onProgress: ({ doneCount, total, currentName, doneBytes, totalBytes }) => {
        progressCount.textContent = `${doneCount} / ${total} ファイル`;
        progressName.textContent = currentName;
        progressFill.style.width = totalBytes ? `${Math.round((doneBytes / totalBytes) * 100)}%` : '0%';
      },
    });

    if (errors.length > 0) {
      showToast(`一部ファイルのアップロードに失敗しました: ${errors.join(', ')}`, 'warning');
    }
  }

  /* ── 完了 ── */
  showToast('発注が完了しました！', 'success');
  setTimeout(() => { location.href = `project-detail.html?id=${newProjId}`; }, 1200);
});
