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
   API経由(POST /projects/{id}/files)は 1ファイル=1リクエストで、実体が
   ブラウザ→API→R2 と2段で転送されるうえ、ファイルごとにフレームワーク起動＋認証
   （本番実測0.3〜0.5秒）が積み上がる。これがフォルダアップロードの待ち時間の正体。

   そこで既定では、署名付きURLを1リクエストでまとめて受け取り、実体はブラウザから
   R2へ直接PUTして転送を1段にする。APIへの往復は「署名発行」と「一括登録」の2回だけ。
   R2のCORSが効かない環境（ローカル開発など）では従来のAPI経由へ自動で切り替える。 */

const UPLOAD_CONCURRENCY = 6; // HTTP/1.1のブラウザ側同時接続上限に合わせる

/* 0..count-1 のタスクを指定本数だけ並行に走らせる */
async function runWithConcurrency(count, concurrency, task) {
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, count)) },
    async () => {
      while (next < count) {
        const idx = next++;
        await task(idx);
      }
    });
  await Promise.all(workers);
}

/* 進捗の集計（直送・API経由の両方から使う） */
function createProgressTracker(items, onProgress) {
  const totalBytes = items.reduce((s, it) => s + it.file.size, 0);
  let doneBytes = 0;
  let doneCount = 0;
  let phase = '';
  const inFlight = new Map(); // idx → ファイル名（並列中の表示用）

  function report() {
    const names = [...inFlight.values()];
    onProgress?.({
      doneCount,
      total: items.length,
      currentName: phase || (names.length > 1 ? `${names[0]} ほか${names.length - 1}件` : (names[0] ?? '')),
      currentPct: totalBytes ? Math.round((doneBytes / totalBytes) * 100) : 100,
      doneBytes,
      totalBytes,
    });
  }

  return {
    report,
    start(idx, name) { inFlight.set(idx, name); report(); },
    addBytes(n) { doneBytes += n; report(); },
    finish(idx) { inFlight.delete(idx); doneCount++; report(); },
    setPhase(text) { phase = text; report(); },
  };
}

function authHeaders() {
  const token = sessionStorage.getItem('space_token');
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };
}

function uploadItems(projectId, items, {
  fileType = 'model_3d',
  onProgress,
  concurrency = UPLOAD_CONCURRENCY,
} = {}) {
  const resolveType = item => (typeof fileType === 'function' ? fileType(item) : fileType);

  return (async () => {
    try {
      return await uploadItemsDirect(projectId, items, { resolveType, onProgress, concurrency });
    } catch (err) {
      console.warn('[uploader] R2直送を使えないためAPI経由で送信します:', err?.message ?? err);
      return await uploadItemsViaApi(projectId, items, { resolveType, onProgress, concurrency });
    }
  })();
}

/* R2直送。署名一括取得 → ブラウザからR2へ並列PUT → 一括登録 の3ステップ */
async function uploadItemsDirect(projectId, items, { resolveType, onProgress, concurrency }) {
  const tracker = createProgressTracker(items, onProgress);
  tracker.setPhase('アップロードの準備中…');

  const res = await fetch(`${API_BASE}/projects/${projectId}/files/upload-urls`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ files: items.map(it => ({ name: it.file.name })) }),
  });
  if (!res.ok) throw new Error(`署名URLの取得に失敗しました (HTTP ${res.status})`);

  const { uploads } = await res.json();
  if (!Array.isArray(uploads) || uploads.length !== items.length) {
    throw new Error('署名URLの件数がファイル数と一致しません');
  }
  tracker.setPhase('');

  const succeeded = new Array(items.length).fill(false);
  const errors = [];

  /* 署名URLへ実体をPUTする。ヘッダは付けない——署名はクエリ側(SigV4)にあり、
     余計なヘッダを足すとCORSプリフライトが増えるだけになる。 */
  function putOne(idx) {
    const item = items[idx];
    return new Promise((resolve, reject) => {
      tracker.start(idx, item.file.name);
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploads[idx].url);

      let lastLoaded = 0;
      xhr.upload.onprogress = e => {
        const loaded = e.lengthComputable ? e.loaded : lastLoaded;
        tracker.addBytes(loaded - lastLoaded);
        lastLoaded = loaded;
      };
      xhr.onload = () => {
        tracker.finish(idx);
        if (xhr.status >= 200 && xhr.status < 300) { succeeded[idx] = true; resolve(); }
        else reject(new Error(`R2へのPUTが失敗しました (HTTP ${xhr.status})`));
      };
      xhr.onerror = () => { tracker.finish(idx); reject(new Error('R2へ接続できません')); };
      xhr.send(item.file);
    });
  }

  // 1件目は疎通確認を兼ねる。ここで落ちた場合だけAPI経由へ丸ごと切り替える
  await putOne(0);
  await runWithConcurrency(items.length - 1, concurrency, i =>
    putOne(i + 1).catch(() => { errors.push(items[i + 1].file.name); }));

  const okIdx = items.map((_, i) => i).filter(i => succeeded[i]);
  if (!okIdx.length) return { uploaded: [], errors };

  tracker.setPhase('登録中…');
  const regRes = await fetch(`${API_BASE}/projects/${projectId}/files/register`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      files: okIdx.map(i => ({
        key: uploads[i].key,
        file_name: items[i].file.name,
        relative_path: items[i].relativePath || null,
        file_type: resolveType(items[i]),
        file_size: items[i].file.size,
        mime_type: items[i].file.type || null,
      })),
    }),
  });

  if (!regRes.ok) {
    // 実体はR2に載っているが登録できなかった。二重アップロードを避けるため再送はしない
    return { uploaded: [], errors: [...errors, ...okIdx.map(i => items[i].file.name)] };
  }

  const { files } = await regRes.json();
  return { uploaded: files ?? [], errors };
}

/* 従来のAPI経由アップロード（R2直送が使えない環境向けのフォールバック） */
async function uploadItemsViaApi(projectId, items, { resolveType, onProgress, concurrency }) {
  const token = sessionStorage.getItem('space_token');
  const tracker = createProgressTracker(items, onProgress);
  const uploaded = [];
  const errors = [];

  function uploadOne(idx) {
    const item = items[idx];
    return new Promise(resolve => {
      tracker.start(idx, item.file.name);
      const fd = new FormData();
      fd.append('file', item.file);
      fd.append('file_type', resolveType(item));
      if (item.relativePath) fd.append('relative_path', item.relativePath);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/projects/${projectId}/files`);
      xhr.setRequestHeader('Accept', 'application/json');
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      let lastLoaded = 0;
      xhr.upload.onprogress = e => {
        const loaded = e.lengthComputable ? e.loaded : lastLoaded;
        tracker.addBytes(loaded - lastLoaded);
        lastLoaded = loaded;
      };

      const finish = () => { tracker.finish(idx); resolve(); };

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

  await runWithConcurrency(items.length, concurrency, uploadOne);
  return { uploaded, errors };
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
