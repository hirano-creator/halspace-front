'use strict';
/* ファイルアップロード共通モジュール */

function formatBytes(b) {
  if (b < 1024)       return b + ' B';
  if (b < 1048576)    return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(1) + ' MB';
}

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'dxf') return '<i class="fa-solid fa-file-lines file-type-icon file-type-dxf"></i>';
  if (ext === 'pdf') return '<i class="fa-solid fa-file-pdf file-type-icon file-type-pdf"></i>';
  if (['stp','step','stl','obj','iges','fbx'].includes(ext))
    return '<i class="fa-solid fa-cube file-type-icon file-type-3d"></i>';
  return '<i class="fa-solid fa-file file-type-icon file-type-ref"></i>';
}

function showToast(msg, type = '') {
  const c = document.getElementById('toastContainer');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast ${type ? 'toast-'+type : ''}`;
  t.innerHTML = `<i class="fa-solid ${type==='success'?'fa-check-circle':type==='danger'?'fa-circle-xmark':'fa-info-circle'}"></i>${msg}`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

/* ドラッグ&ドロップ初期化 */
function initDropzone(zoneId, inputId, listId, onFilesChanged) {
  const zone  = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  const list  = document.getElementById(listId);
  if (!zone || !input || !list) return;

  let files = [];

  function render() {
    list.innerHTML = '';
    files.forEach((f, i) => {
      const item = document.createElement('div');
      item.className = 'upload-file-item';
      item.innerHTML = `
        ${getFileIcon(f.name)}
        <span class="upload-file-name">${f.name}</span>
        <span class="upload-file-size">${formatBytes(f.size)}</span>
        <div class="progress-wrap" id="prog_${i}" style="display:none;width:120px;">
          <div class="progress-label"><span>0%</span></div>
          <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:0%"></div></div>
        </div>
        <button class="upload-file-remove" data-idx="${i}" title="削除">
          <i class="fa-solid fa-xmark"></i>
        </button>`;
      list.appendChild(item);
    });
    list.querySelectorAll('.upload-file-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        files.splice(Number(e.currentTarget.dataset.idx), 1);
        render();
        onFilesChanged(files);
      });
    });
    onFilesChanged(files);
  }

  function addFiles(newFiles) {
    const MAX = 500 * 1024 * 1024;
    Array.from(newFiles).forEach(f => {
      if (f.size > MAX) { showToast(`${f.name} は500MBを超えています`, 'danger'); return; }
      if (!files.find(x => x.name === f.name && x.size === f.size)) files.push(f);
    });
    render();
  }

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', ()=> zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('dragover');
    addFiles(e.dataTransfer.files);
  });
  input.addEventListener('change', () => { addFiles(input.files); input.value=''; });

  /* モックアップロード進捗シミュレーション */
  function simulateUpload(idx, cb) {
    const prog = document.getElementById(`prog_${idx}`);
    if (!prog) return cb();
    prog.style.display = '';
    const fill  = prog.querySelector('.progress-bar-fill');
    const label = prog.querySelector('.progress-label span');
    let pct = 0;
    const iv = setInterval(() => {
      pct += Math.random() * 20;
      if (pct >= 100) { pct = 100; clearInterval(iv); cb(); }
      fill.style.width = pct.toFixed(0) + '%';
      label.textContent = pct.toFixed(0) + '%';
    }, 150);
  }

  return { getFiles: () => files, simulateUpload };
}
