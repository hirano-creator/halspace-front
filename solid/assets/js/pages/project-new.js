'use strict';

const user = requireSpaceAuth();
if (!user) throw new Error('未認証');
renderSidebarUser(user);
if (isAdmin(user)) document.getElementById('adminLink').style.display = '';

/* ウィザード管理（2ステップ） */
const uploader = initDropzone('uploadZone', 'fileInput', 'fileList', files => {
  document.getElementById('step1Next').disabled = files.length === 0;
});

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
  const files    = uploader.getFiles();
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
          <td>${files.map(f => `<div style="font-size:13px;">${getFileIcon(f.name)} ${f.name}</div>`).join('') || '—'}</td></tr>
    </table>`;
}

/* ── ファイルアップロード（FormData、fetch直接） ── */
async function uploadFile(projectId, file) {
  const token = sessionStorage.getItem('space_token');
  const ext = file.name.split('.').pop().toLowerCase();
  const fileType = ['dxf', 'dwg'].includes(ext) ? 'drawing_dxf'
                 : ext === 'pdf'                 ? 'drawing_pdf'
                 : 'reference';

  const fd = new FormData();
  fd.append('file', file);
  fd.append('file_type', fileType);

  const res = await fetch(`${API_BASE}/projects/${projectId}/files`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      /* Content-Type は設定しない → ブラウザが multipart/form-data を自動設定 */
    },
    body: fd,
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`ファイルアップロード失敗 (${res.status}): ${errBody}`);
  }
  return res.json();
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

  /* ── Step2: ファイルアップロード ── */
  const files = uploader.getFiles();
  let uploadErrors = [];

  for (let i = 0; i < files.length; i++) {
    /* プログレスバーアニメーション開始（完了を待たない） */
    uploader.simulateUpload(i, () => {});

    try {
      await uploadFile(newProjId, files[i]);
    } catch (err) {
      uploadErrors.push(files[i].name);
    }
  }

  if (uploadErrors.length > 0) {
    showToast(`一部ファイルのアップロードに失敗しました: ${uploadErrors.join(', ')}`, 'warning');
  }

  /* ── 完了 ── */
  showToast('発注が完了しました！', 'success');
  setTimeout(() => { location.href = `project-detail.html?id=${newProjId}`; }, 1200);
});
