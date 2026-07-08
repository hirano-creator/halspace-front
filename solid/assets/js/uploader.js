'use strict';
/* ファイルアップロード共通モジュール */

function formatBytes(b) {
  if (b < 1024)       return b + ' B';
  if (b < 1048576)    return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(1) + ' MB';
}

/* SolidWorksネイティブ形式(sldprt/sldasm/slddrw)を含む3Dデータの許可拡張子 */
const SOLID_3D_EXTS = ['stp','step','stl','obj','iges','fbx','sldprt','sldasm','slddrw'];

/* フォルダ走査時に無視するファイル名 */
const IGNORED_FILE_NAMES = /^(Thumbs\.db|\.DS_Store|desktop\.ini|~\$.*)$/i;

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'dxf') return '<i class="fa-solid fa-file-lines file-type-icon file-type-dxf"></i>';
  if (ext === 'pdf') return '<i class="fa-solid fa-file-pdf file-type-icon file-type-pdf"></i>';
  if (SOLID_3D_EXTS.includes(ext))
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
    const MAX = 100 * 1024 * 1024;
    Array.from(newFiles).forEach(f => {
      if (f.size > MAX) { showToast(`${f.name} は100MBを超えています`, 'danger'); return; }
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

/* ── フォルダドロップ/選択の走査（{file, relativePath}[] を返す） ── */

async function collectDroppedItems(dataTransfer) {
  const results = [];

  async function readAllEntries(reader) {
    let all = [];
    let batch;
    do {
      batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      all = all.concat(batch);
    } while (batch.length > 0);
    return all;
  }

  async function walkEntry(entry, prefix) {
    if (entry.isFile) {
      if (IGNORED_FILE_NAMES.test(entry.name)) return;
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      results.push({ file, relativePath: prefix + entry.name });
    } else if (entry.isDirectory) {
      const entries = await readAllEntries(entry.createReader());
      for (const child of entries) {
        await walkEntry(child, prefix + entry.name + '/');
      }
    }
  }

  const items = dataTransfer.items;
  if (items && items.length && typeof items[0].webkitGetAsEntry === 'function') {
    const entries = Array.from(items).map(it => it.webkitGetAsEntry()).filter(Boolean);
    for (const entry of entries) {
      await walkEntry(entry, '');
    }
    return results;
  }

  /* entry API非対応ブラウザ向けフォールバック（フォルダ構造は保持できない） */
  return Array.from(dataTransfer.files)
    .filter(f => !IGNORED_FILE_NAMES.test(f.name))
    .map(f => ({ file: f, relativePath: '' }));
}

function filesFromDirectoryInput(input) {
  return Array.from(input.files)
    .filter(f => !IGNORED_FILE_NAMES.test(f.name))
    .map(f => ({ file: f, relativePath: f.webkitRelativePath || '' }));
}

/* ── アップロード実行（直列。Sanctumトークンの行ロック競合を避けるため並列化しない） ── */

function uploadItemsSequential(projectId, items, { fileType = 'model_3d', onProgress } = {}) {
  const token = sessionStorage.getItem('space_token');
  const totalBytes = items.reduce((s, it) => s + it.file.size, 0);
  let doneBytes = 0;
  const uploaded = [];
  const errors = [];

  function uploadOne(item, idx) {
    return new Promise(resolve => {
      const fd = new FormData();
      fd.append('file', item.file);
      fd.append('file_type', fileType);
      if (item.relativePath) fd.append('relative_path', item.relativePath);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/projects/${projectId}/files`);
      xhr.setRequestHeader('Accept', 'application/json');
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      let lastLoaded = 0;
      xhr.upload.onprogress = e => {
        const loaded = e.lengthComputable ? e.loaded : lastLoaded;
        doneBytes += (loaded - lastLoaded);
        lastLoaded = loaded;
        onProgress?.({
          doneCount: idx,
          total: items.length,
          currentName: item.file.name,
          currentPct: item.file.size ? Math.round((loaded / item.file.size) * 100) : 100,
          doneBytes,
          totalBytes,
        });
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data?.file?.id) uploaded.push(data.file);
          } catch {
            errors.push(item.file.name);
          }
        } else {
          errors.push(item.file.name);
        }
        resolve();
      };
      xhr.onerror = () => { errors.push(item.file.name); resolve(); };
      xhr.send(fd);
    });
  }

  return (async () => {
    for (let i = 0; i < items.length; i++) {
      await uploadOne(items[i], i);
      onProgress?.({
        doneCount: i + 1,
        total: items.length,
        currentName: '',
        currentPct: 100,
        doneBytes,
        totalBytes,
      });
    }
    return { uploaded, errors };
  })();
}
