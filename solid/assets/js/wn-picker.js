'use strict';
/* What'sNo保存済みファイルのピッカーモーダル（共有コンポーネント）
   project-new.js / project-detail.js の両方から openWnPicker() で呼び出す。
   uploader.js（formatBytes/getFileIcon）と api.js（api/API_BASE）が先に読み込まれている前提。 */

let wnPickerModal = null;
let wnPickerGrid = null;
let wnPickerSearchInput = null;
let wnPickerConfirmBtn = null;
let wnPickerCountEl = null;
let wnPickerSelected = new Map(); // id -> {id, file_name, file_size, mime_type}
let wnPickerOnConfirm = null;
let wnPickerSearchTimer = null;
let wnPickerRequestSeq = 0;

function ensureWnPickerModal() {
  if (wnPickerModal) return;

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="modal-overlay hidden" id="wnPickerModal">
      <div class="modal" style="max-width:680px;">
        <div class="modal-header">
          <span class="modal-title"><i class="fa-solid fa-cloud" style="color:var(--blue);margin-right:6px;"></i>What'sNoから選択</span>
          <button class="modal-close" id="wnPickerClose"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <input type="text" class="form-input" id="wnPickerSearch" placeholder="ファイル名で検索" style="margin-bottom:14px;">
        <div class="wn-picker-grid" id="wnPickerGrid">
          <div class="wn-picker-empty">読み込み中...</div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="wnPickerCancel">キャンセル</button>
          <button class="btn btn-primary" id="wnPickerConfirm" disabled>
            <i class="fa-solid fa-check"></i> 選択したファイルを追加（<span id="wnPickerCount">0</span>）
          </button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap.firstElementChild);

  wnPickerModal = document.getElementById('wnPickerModal');
  wnPickerGrid = document.getElementById('wnPickerGrid');
  wnPickerSearchInput = document.getElementById('wnPickerSearch');
  wnPickerConfirmBtn = document.getElementById('wnPickerConfirm');
  wnPickerCountEl = document.getElementById('wnPickerCount');

  const close = () => { wnPickerModal.classList.add('hidden'); };
  document.getElementById('wnPickerClose').addEventListener('click', close);
  document.getElementById('wnPickerCancel').addEventListener('click', close);
  wnPickerModal.addEventListener('click', e => { if (e.target === wnPickerModal) close(); });

  wnPickerSearchInput.addEventListener('input', () => {
    clearTimeout(wnPickerSearchTimer);
    wnPickerSearchTimer = setTimeout(() => loadWnPickerFiles(wnPickerSearchInput.value.trim()), 300);
  });

  wnPickerConfirmBtn.addEventListener('click', () => {
    const files = Array.from(wnPickerSelected.values());
    close();
    wnPickerOnConfirm?.(files);
  });
}

function updateWnPickerConfirmState() {
  wnPickerCountEl.textContent = String(wnPickerSelected.size);
  wnPickerConfirmBtn.disabled = wnPickerSelected.size === 0;
}

async function loadWnPickerFiles(search) {
  const seq = ++wnPickerRequestSeq;
  wnPickerGrid.innerHTML = '<div class="wn-picker-empty">読み込み中...</div>';

  let data;
  try {
    const qs = search ? `?per_page=60&search=${encodeURIComponent(search)}` : '?per_page=60';
    data = await api.get('/wn/files' + qs);
  } catch (err) {
    if (seq !== wnPickerRequestSeq) return;
    wnPickerGrid.innerHTML = `<div class="wn-picker-empty">読み込みに失敗しました: ${err.message}</div>`;
    return;
  }
  if (seq !== wnPickerRequestSeq) return;

  const files = data?.data ?? [];
  if (files.length === 0) {
    wnPickerGrid.innerHTML = '<div class="wn-picker-empty">該当するファイルがありません</div>';
    return;
  }

  wnPickerGrid.innerHTML = files.map(f => `
    <div class="wn-picker-item${wnPickerSelected.has(f.id) ? ' selected' : ''}" data-id="${f.id}">
      <div class="wn-picker-thumb">
        <img loading="lazy">
        <div class="wn-picker-thumb-fallback">${getFileIcon(f.file_name)}</div>
      </div>
      <div class="wn-picker-name" title="${f.file_name}">${f.file_name}</div>
      <div class="wn-picker-size">${formatBytes(f.file_size)}</div>
      <div class="wn-picker-check"><i class="fa-solid fa-check"></i></div>
    </div>`).join('');

  wnPickerGrid.querySelectorAll('.wn-picker-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = Number(el.dataset.id);
      const file = files.find(f => f.id === id);
      if (wnPickerSelected.has(id)) {
        wnPickerSelected.delete(id);
        el.classList.remove('selected');
      } else {
        wnPickerSelected.set(id, file);
        el.classList.add('selected');
      }
      updateWnPickerConfirmState();
    });
  });

  loadWnPickerThumbsThrottled(files, seq);
}

/**
 * サムネイルを同時数を絞って順に読み込む。
 * 一覧全件ぶんの<img>を一斉にsrc設定すると、同一Sanctumトークンでの認証リクエストが
 * 大量同時発火し、last_used_at更新の行ロック競合でAPI全体が詰まることがある
 * （2026-07-02の本番障害と同じパターン）。6件ずつの直列読み込みで回避する。
 */
async function loadWnPickerThumbsThrottled(files, seq) {
  const token = sessionStorage.getItem('space_token') || '';
  const CONCURRENCY = 6;
  let idx = 0;

  async function worker() {
    while (idx < files.length) {
      if (seq !== wnPickerRequestSeq) return; // 別の検索/再読み込みが走ったら中断
      const f = files[idx++];
      const img = wnPickerGrid.querySelector(`.wn-picker-item[data-id="${f.id}"] img`);
      if (!img) continue;
      await new Promise(resolve => {
        img.onload = resolve;
        img.onerror = () => {
          img.style.display = 'none';
          img.nextElementSibling.style.display = 'flex';
          resolve();
        };
        img.src = `${API_BASE}/wn/files/${f.id}/thumb?token=${encodeURIComponent(token)}`;
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
}

/**
 * What'sNoファイルピッカーを開く。
 * onConfirm({id, file_name, file_size, mime_type}[]) が選択確定時に呼ばれる。
 */
function openWnPicker({ onConfirm }) {
  ensureWnPickerModal();
  wnPickerSelected = new Map();
  wnPickerOnConfirm = onConfirm;
  wnPickerSearchInput.value = '';
  updateWnPickerConfirmState();
  wnPickerModal.classList.remove('hidden');
  loadWnPickerFiles('');
}
