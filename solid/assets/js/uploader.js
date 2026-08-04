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

/* ── アップロード実行 ──
   1ファイル=1リクエストのため、直列だとファイル数ぶんの往復待ちがそのまま積み上がり、
   フォルダアップロード（小さいファイルが数十件）で待ち時間が極端に長くなる。
   APIはFrankenPHPで並行処理でき、last_used_at行ロックもPersonalAccessToken側の
   書き込み間引きで解消済みのため、同時本数を絞ったうえで並列送信する。 */

const UPLOAD_CONCURRENCY = 4;

function uploadItems(projectId, items, {
  fileType = 'model_3d',
  onProgress,
  concurrency = UPLOAD_CONCURRENCY,
} = {}) {
  const token = sessionStorage.getItem('space_token');
  const totalBytes = items.reduce((s, it) => s + it.file.size, 0);
  let doneBytes = 0;
  let doneCount = 0;
  const uploaded = [];
  const errors = [];
  const inFlight = new Map(); // idx → ファイル名（並列中の表示用）

  function report() {
    const names = [...inFlight.values()];
    onProgress?.({
      doneCount,
      total: items.length,
      currentName: names.length > 1 ? `${names[0]} ほか${names.length - 1}件` : (names[0] ?? ''),
      currentPct: totalBytes ? Math.round((doneBytes / totalBytes) * 100) : 100,
      doneBytes,
      totalBytes,
    });
  }

  function uploadOne(item, idx) {
    return new Promise(resolve => {
      inFlight.set(idx, item.file.name);
      report();
      const fd = new FormData();
      fd.append('file', item.file);
      fd.append('file_type', typeof fileType === 'function' ? fileType(item) : fileType);
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
        report();
      };

      const finish = () => {
        inFlight.delete(idx);
        doneCount++;
        report();
        resolve();
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
        finish();
      };
      xhr.onerror = () => { errors.push(item.file.name); finish(); };
      xhr.send(fd);
    });
  }

  return (async () => {
    let next = 0;
    const workers = Array.from(
      { length: Math.max(1, Math.min(concurrency, items.length)) },
      async () => {
        while (next < items.length) {
          const idx = next++;
          await uploadOne(items[idx], idx);
        }
      });
    await Promise.all(workers);
    return { uploaded, errors };
  })();
}

/* ── アップロード進捗パネル（画面右下に固定表示） ──
   フォルダアップロードは完了まで数十秒かかることがあり、無表示だと固まったように見えるため、
   件数・ファイル名・全体進捗を常時出す。onProgressにそのまま渡せる形で返す。 */
function createUploadProgressPanel(title = 'アップロード中') {
  const el = document.createElement('div');
  el.className = 'upload-progress-panel';
  el.innerHTML = `
    <div class="upload-progress-head">
      <i class="fa-solid fa-cloud-arrow-up"></i>
      <span class="upload-progress-title">${title}</span>
      <span class="upload-progress-count">0 / 0</span>
    </div>
    <div class="upload-progress-name"></div>
    <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:0%"></div></div>`;
  document.body.appendChild(el);

  const countEl = el.querySelector('.upload-progress-count');
  const nameEl  = el.querySelector('.upload-progress-name');
  const fillEl  = el.querySelector('.progress-bar-fill');

  return {
    onProgress({ doneCount, total, currentName, doneBytes, totalBytes }) {
      countEl.textContent = `${doneCount} / ${total} ファイル`;
      nameEl.textContent = currentName || '';
      fillEl.style.width = totalBytes ? `${Math.round((doneBytes / totalBytes) * 100)}%` : '0%';
    },
    close() { el.remove(); },
  };
}
