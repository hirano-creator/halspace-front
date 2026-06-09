'use strict';
/* What'sNo ダッシュボード */

let currentUser  = null;
let allFiles     = [];
let allTags      = [];
let selectedTags = [];
let navView      = 'all';   // 'all' | 'mine' | 'recent' | 'liked'
const LAYOUT_VIEW_STORAGE_KEY = 'wn_layout_view';
let layoutView   = (() => {
  const saved = localStorage.getItem(LAYOUT_VIEW_STORAGE_KEY);
  return saved === 'list' ? 'list' : 'grid';   // 'grid' | 'list'
})();
let uploadQueue  = [];
let semanticMode = false;   // AI自然言語検索モード中かどうか

/* ────────────────────────────────
   初期化
   ──────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  /* モバイルでカードを全幅に強制（CSS/SWキャッシュ回避） */
  applyMobileLayout();
  window.addEventListener('resize', applyMobileLayout);

  currentUser = requireSpaceAuth();
  if (!currentUser) return;

  renderSidebarUser(currentUser);
  if (isAdmin(currentUser)) document.getElementById('adminLink').style.display = '';

  await loadTags();
  await loadFiles();
  initNav();
  initDragDrop();
  initUploadModal();
  initFilters();
  initViewToggle();
  initSearch();
  initVoiceSearch();
  initNotifications();
  initEmailModal();
  loadBrainMeter();
  initDashBrain();
});

let _lastIsMobile = null;
function applyMobileLayout() {
  const isMobile = window.innerWidth <= 767;

  /* page-body の左右padding をゼロに */
  const pageBody = document.querySelector('.page-body');
  if (pageBody) {
    pageBody.style.paddingLeft  = isMobile ? '0' : '';
    pageBody.style.paddingRight = isMobile ? '0' : '';
    if (isMobile) pageBody.style.paddingBottom = '72px';
  }

  /* fileListCard を全幅に（角丸・左右ボーダー・マージン除去） */
  const fileListCard = document.getElementById('fileListCard');
  if (fileListCard) {
    fileListCard.style.borderRadius = isMobile ? '0' : '';
    fileListCard.style.borderLeft   = isMobile ? 'none' : '';
    fileListCard.style.borderRight  = isMobile ? 'none' : '';
    fileListCard.style.marginLeft   = isMobile ? '0' : '';
    fileListCard.style.marginRight  = isMobile ? '0' : '';
    fileListCard.style.width        = isMobile ? '100%' : '';
    fileListCard.style.boxSizing    = isMobile ? 'border-box' : '';
  }

  /* gridArea の左右padding を縮小（本当の原因） */
  const gridArea = document.getElementById('gridArea');
  if (gridArea) {
    gridArea.style.paddingLeft  = isMobile ? '6px' : '';
    gridArea.style.paddingRight = isMobile ? '6px' : '';
  }

  /* listArea の Instagram風フィードクラス（モバイル時のみ） */
  const listArea = document.getElementById('listArea');
  if (listArea) listArea.classList.toggle('ig-feed', isMobile);

  /* breakpoint を跨いだら、リスト表示を再レンダリング（モバイル⇔PC で markup が違うため） */
  if (_lastIsMobile !== null && _lastIsMobile !== isMobile && allFiles.length > 0) {
    renderFiles();
  }
  _lastIsMobile = isMobile;
}

/* ────────────────────────────────
   ダッシュボード上のミニKnowl
   brain.html に遷移せず、ここで質問→回答まで完結
   ──────────────────────────────── */
let dashBrainSessionId = null;
let dashBrainBusy      = false;

function initDashBrain() {
  const input = document.getElementById('dashBrainInput');
  const send  = document.getElementById('dashBrainSendBtn');
  const voice = document.getElementById('dashBrainVoiceBtn');
  const close = document.getElementById('dashBrainAnswerClose');
  if (!input || !send) return;

  input.addEventListener('input', () => {
    send.disabled = input.value.trim() === '' || dashBrainBusy;
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !send.disabled) {
      e.preventDefault();
      dashBrainAsk(input.value.trim());
    }
  });
  send.addEventListener('click', () => {
    if (!send.disabled) dashBrainAsk(input.value.trim());
  });

  if (close) close.addEventListener('click', () => {
    document.getElementById('dashBrainAnswer').style.display = 'none';
  });

  initDashBrainVoice();
}

async function dashBrainAsk(question) {
  if (dashBrainBusy || !question) return;
  dashBrainBusy = true;

  const input = document.getElementById('dashBrainInput');
  const send  = document.getElementById('dashBrainSendBtn');
  const ans   = document.getElementById('dashBrainAnswer');
  const ansQ  = document.getElementById('dashBrainAnswerQ');
  const body  = document.getElementById('dashBrainAnswerBody');
  const srcs  = document.getElementById('dashBrainAnswerSources');
  const more  = document.querySelector('.brain-widget-answer-more');

  send.disabled = true;
  ansQ.textContent = question;
  body.className   = 'brain-widget-answer-body thinking';
  body.innerHTML   = '<span></span><span></span><span></span>';
  srcs.innerHTML   = '';
  ans.style.display = 'block';

  try {
    const res = await wnBrainAsk(question, dashBrainSessionId);
    dashBrainSessionId = res.session_id ?? dashBrainSessionId;

    body.className = 'brain-widget-answer-body';
    body.textContent = res.answer ?? '回答が得られませんでした。';

    const sources = res.sources ?? [];
    srcs.innerHTML = sources.map(s =>
      `<a href="file-detail.html?id=${s.id}">
         <i class="fa-solid fa-file-lines"></i>${h(s.file_name)}
       </a>`
    ).join('');

    // 「続ける」リンクは現セッションを引き継ぐ
    if (more && dashBrainSessionId) {
      more.href = `brain.html?session=${dashBrainSessionId}`;
    }

    // 入力欄はクリアして次の質問を受け付ける
    input.value = '';
  } catch (err) {
    body.className = 'brain-widget-answer-body';
    body.textContent = err?.status === 429
      ? 'AIの利用制限に達しました。しばらく経ってから再度お試しください。'
      : '回答の取得中にエラーが発生しました。';
  } finally {
    dashBrainBusy = false;
    send.disabled = input.value.trim() === '';
  }
}

function initDashBrainVoice() {
  const btn  = document.getElementById('dashBrainVoiceBtn');
  const icon = document.getElementById('dashBrainVoiceIcon');
  if (!btn) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { btn.style.display = 'none'; return; }

  const recog = new SpeechRecognition();
  recog.lang = 'ja-JP';
  recog.interimResults = true;
  recog.continuous = false;
  let recording = false;

  btn.addEventListener('click', () => {
    if (dashBrainBusy) return;
    if (recording) recog.stop(); else recog.start();
  });

  recog.onstart = () => {
    recording = true;
    btn.classList.add('recording');
    icon.className = 'fa-solid fa-stop';
  };

  recog.onresult = e => {
    const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
    document.getElementById('dashBrainInput').value = transcript;
  };

  recog.onend = () => {
    recording = false;
    btn.classList.remove('recording');
    icon.className = 'fa-solid fa-microphone';
    const input = document.getElementById('dashBrainInput');
    const q = input.value.trim();
    if (q) dashBrainAsk(q);
  };

  recog.onerror = () => {
    recording = false;
    btn.classList.remove('recording');
    icon.className = 'fa-solid fa-microphone';
  };
}

async function loadBrainMeter() {
  try {
    const data = await wnBrainMeter();
    const widget = document.getElementById('dashBrainWidget');
    if (!widget) return;
    widget.style.display = 'block';
    const rate = data.fill_rate ?? 0;
    document.getElementById('dashBrainRate').textContent = rate + '%';
    document.getElementById('dashBrainBar').style.width = rate + '%';
    document.getElementById('dashBrainLabel').textContent =
      `学習済み ${data.indexed_files ?? 0} 件 / 全 ${data.total_files ?? 0} 件`;
    if (data.gap_tags && data.gap_tags.length > 0) {
      document.getElementById('dashBrainGapText').textContent = data.gap_tags.join('・');
      document.getElementById('dashBrainGap').style.display = 'block';
    }
  } catch {
    // メーター取得失敗は無視（サイレント）
  }
}

/* ────────────────────────────────
   データ取得
   ──────────────────────────────── */
async function loadFiles() {
  showLoading(true);

  const rawSearch = document.getElementById('searchInput').value.trim();
  const normalizedSearch = rawSearch ? normalizeVoiceQuery(rawSearch) : undefined;
  const params = {
    sort:           document.getElementById('sortFilter').value || 'newest',
    search:         normalizedSearch,
    search_reading: normalizedSearch ? toHiraganaQuery(normalizedSearch) : undefined,
  };
  if (selectedTags.length) params.tag = selectedTags.join(',');
  if (navView === 'mine')   params.mine   = 1;
  if (navView === 'recent') params.recent = 1;
  if (navView === 'liked')  params.liked  = 1;

  const result = await wnGetFiles(params);
  showLoading(false);

  if (result.error) {
    /* 取得失敗時は既存リストを保持してエラートースト表示（誤った「空表示」を避ける） */
    if (typeof wnShowToast === 'function') {
      wnShowToast('ファイル一覧の取得に失敗しました。再読み込みしてください', 'danger');
    } else {
      console.warn('[loadFiles] error:', result.error);
    }
    return;
  }

  allFiles = result.data;
  renderFiles();
}

async function loadTags() {
  allTags = await wnGetTags();
  renderTagFilter();
}

/* ────────────────────────────────
   描画
   ──────────────────────────────── */
function renderFiles() {
  const grid  = document.getElementById('fileGrid');
  const rows  = document.getElementById('fileListRows');
  const empty = document.getElementById('emptyMsg');
  const countLabel = document.getElementById('fileCountLabel');

  const viewLabels = { all: 'すべてのファイル', mine: 'マイファイル', recent: '最近のファイル', liked: 'いいね済み' };
  document.getElementById('areaTitle').textContent = viewLabels[navView] ?? 'すべてのファイル';
  countLabel.textContent = allFiles.length ? `（${allFiles.length}件）` : '';

  if (!allFiles.length) {
    grid.innerHTML = '';
    rows.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  grid.innerHTML = allFiles.map(fileCardHtml).join('');
  rows.innerHTML = allFiles.map(fileRowHtml).join('');

  // サムネイルを非同期で差し込む（画像・PDF・動画）
  loadFileThumbnails();
  // リスト表示時のみコメントを非同期で差し込む
  if (layoutView === 'list') loadRowComments();

  document.querySelectorAll('[data-file-id]').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.like-btn') || e.target.closest('.file-action-btn')) return;
      location.href = `file-detail.html?id=${el.dataset.fileId}`;
    });
  });

  document.querySelectorAll('.like-btn[data-id]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const res = await wnToggleLike(btn.dataset.id);
      if (res) {
        btn.classList.toggle('liked', res.liked);
        btn.querySelector('i').className = `fa-${res.liked ? 'solid' : 'regular'} fa-heart`;
        btn.querySelector('span').textContent = res.count;

        // IG-feed の場合、メタ行のいいね数も同期
        const post = btn.closest('[data-file-id]');
        const metaLike = post?.querySelector('.ig-post-meta .liked-count');
        if (metaLike) {
          metaLike.classList.toggle('is-liked', res.liked);
          metaLike.innerHTML = `<i class="fa-${res.liked ? 'solid' : 'regular'} fa-heart"></i>${res.count}`;
        }
      }
    });
  });
}

/* ────────────────────────────────
   サムネイルキャッシュ（IndexedDB）
   キー: `thumb_{fileId}_{updated_at}`
   値:   Blob（JPEG）
   ──────────────────────────────── */
const ThumbCache = (() => {
  const DB_NAME    = 'wn-thumb-cache';
  const STORE_NAME = 'thumbs';
  const VERSION    = 1;
  let db = null;

  function open() {
    if (db) return Promise.resolve(db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = e => {
        e.target.result.createObjectStore(STORE_NAME);
      };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror   = () => reject(req.error);
    });
  }

  async function get(key) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx  = d.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror   = () => reject(req.error);
    });
  }

  async function set(key, blob) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx  = d.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(blob, key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  /* 古いキャッシュを削除（同じfileIdで別バージョンのキー） */
  async function evictOld(fileId) {
    const d = await open();
    return new Promise(resolve => {
      const tx    = d.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req   = store.openCursor();
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (!cursor) { resolve(); return; }
        if (String(cursor.key).startsWith(`thumb_${fileId}_`)) cursor.delete();
        cursor.continue();
      };
      req.onerror = () => resolve();
    });
  }

  return { get, set, evictOld };
})();

/* ページ内メモリキャッシュ（ObjectURL、タブを閉じると消える） */
const thumbMemCache = {};

async function loadFileThumbnails() {
  const CONCURRENCY        = 4;          /* 一般ファイルの同時取得数 */
  const OFFICE_CONCURRENCY = 1;          /* Office は1ずつ（API帯域を奪わない） */
  const OFFICE_MAX_BYTES   = 2 * 1024 * 1024; /* 2MB超のOfficeはサムネ生成スキップ */

  const isOffice = (f) => {
    const ext = (f.file_name || '').split('.').pop().toLowerCase();
    return ['xlsx','xls','xlsm','docx','docm'].includes(ext);
  };

  const targets = allFiles.filter(f => {
    const ext  = (f.file_name || '').split('.').pop().toLowerCase();
    const mime = f.mime_type ?? '';
    /* Office で 2MB 超は重すぎてAPIを詰まらせるためスキップ */
    if (isOffice(f) && (f.file_size ?? 0) > OFFICE_MAX_BYTES) return false;
    return mime.startsWith('image/') || ['png','jpg','jpeg','gif','webp','heic','heif','svg'].includes(ext)
        || mime === 'application/pdf' || ext === 'pdf'
        || mime.startsWith('video/') || ['mp4','mov','avi','webm'].includes(ext)
        || ext === 'dxf'
        || isOffice(f);
  });

  /* 軽量ファイルとOfficeを分離してスケジュール */
  const lightTargets  = targets.filter(f => !isOffice(f));
  const officeTargets = targets.filter(isOffice);

  /* 軽量ファイル: 並列処理 */
  for (let i = 0; i < lightTargets.length; i += CONCURRENCY) {
    await Promise.allSettled(
      lightTargets.slice(i, i + CONCURRENCY).map(f => loadOneThumbnail(f))
    );
  }
  /* Office: 1つずつ順番に（重いダウンロードでAPIを詰まらせないため） */
  for (let i = 0; i < officeTargets.length; i += OFFICE_CONCURRENCY) {
    await Promise.allSettled(
      officeTargets.slice(i, i + OFFICE_CONCURRENCY).map(f => loadOneThumbnail(f))
    );
  }
}

async function loadOneThumbnail(f) {
  const iconId = `thumb-icon-${f.id}`;
  if (!document.getElementById(iconId) && !document.getElementById(`thumb-icon-row-${f.id}`)) return;

  const ext      = (f.file_name || '').split('.').pop().toLowerCase();
  const mime     = f.mime_type ?? '';
  const cacheKey = `thumb_${f.id}_${f.updated_at ?? f.created_at ?? ''}`;

  /* 文書系 (PDF/Excel/Word) は先頭(タイトル付近)を見せたいので object-position:top */
  const isDoc = (mime === 'application/pdf' || ext === 'pdf'
              || ['xlsx','xls','xlsm','docx','docm'].includes(ext));
  const appendOpts = isDoc ? { anchor: 'top' } : {};

  try {
    /* ── メモリキャッシュ確認 ── */
    if (thumbMemCache[cacheKey]) {
      appendImg(iconId, thumbMemCache[cacheKey], appendOpts);
      return;
    }

    /* ── IndexedDBキャッシュ確認 ── */
    const cached = await ThumbCache.get(cacheKey).catch(() => null);
    if (cached) {
      const url = URL.createObjectURL(cached);
      thumbMemCache[cacheKey] = url;
      appendImg(iconId, url, appendOpts);
      return;
    }

    /* ── キャッシュなし → 取得・生成 ── */
    let blob = null;

    /* ローカル環境では public-view を直接使い、view エンドポイントの呼び出しを省く */
    const directUrl = wnPublicViewUrl(f.id);

    if (['heic','heif'].includes(ext) || mime === 'image/heic' || mime === 'image/heif') {
      if (typeof heic2any === 'undefined') return;
      const res = await fetch(directUrl);
      if (!res.ok) return;
      const buffer = await res.arrayBuffer();
      let b = await heic2any({ blob: new Blob([buffer], { type: 'image/heic' }), toType: 'image/jpeg', quality: 0.70 });
      blob = Array.isArray(b) ? b[0] : b;

    } else if (mime.startsWith('image/') || ['png','jpg','jpeg','gif','webp','svg'].includes(ext)) {
      const res = await fetch(directUrl);
      if (!res.ok) return;
      blob = await res.blob();

    } else if (mime === 'application/pdf' || ext === 'pdf') {
      if (typeof pdfjsLib === 'undefined') return;
      const pdf      = await pdfjsLib.getDocument(directUrl).promise;
      const page     = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas   = document.createElement('canvas');
      canvas.width   = viewport.width;
      canvas.height  = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.80));

    } else if (mime.startsWith('video/') || ['mp4','mov','avi','webm'].includes(ext)) {
      blob = await new Promise(resolve => {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.muted = true; video.playsInline = true; video.preload = 'metadata';
        video.style.cssText = 'display:none;';
        document.body.appendChild(video);
        video.addEventListener('loadedmetadata', () => { video.currentTime = 1; });
        video.addEventListener('seeked', () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width  = video.videoWidth  || 320;
            canvas.height = video.videoHeight || 180;
            canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(b => { document.body.removeChild(video); resolve(b); }, 'image/jpeg', 0.80);
          } catch { document.body.removeChild(video); resolve(null); }
        }, { once: true });
        video.addEventListener('error', () => { document.body.removeChild(video); resolve(null); }, { once: true });
        video.src = directUrl;
      });

    } else if (ext === 'dxf') {
      if (typeof wnDxfThumbnail !== 'function') return;
      const text = await wnFetchDxfText(f.id);
      if (!text) return;
      const canvas = document.createElement('canvas');
      canvas.width = 300; canvas.height = 150;
      if (!wnDxfThumbnail(canvas, text)) return;
      blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.80));

    } else if (['xlsx','xls','xlsm'].includes(ext)) {
      if (typeof XLSX === 'undefined') return;
      const res = await fetch(directUrl);
      if (!res.ok) return;
      const buffer = await res.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
      const canvas = document.createElement('canvas');
      canvas.width = 360; canvas.height = 480;
      if (!drawExcelThumbnail(canvas, wb)) return;
      blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));

    } else if (['docx','docm'].includes(ext)) {
      if (typeof mammoth === 'undefined') return;
      const res = await fetch(directUrl);
      if (!res.ok) return;
      const buffer = await res.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      const canvas = document.createElement('canvas');
      canvas.width = 360; canvas.height = 480;
      if (!drawWordThumbnail(canvas, result.value || '')) return;
      blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
    }

    if (!blob) return;

    /* ── IndexedDBに保存 ── */
    await ThumbCache.evictOld(f.id).catch(() => {});
    await ThumbCache.set(cacheKey, blob).catch(() => {});

    /* ── 表示 ── */
    const objUrl = URL.createObjectURL(blob);
    thumbMemCache[cacheKey] = objUrl;
    appendImg(iconId, objUrl, appendOpts);

  } catch(e) { console.warn('thumb error:', f.file_name, e); }
}

/* Excelサムネイル: 最初のシートをミニ表として描画 */
function drawExcelThumbnail(canvas, workbook) {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return false;
  const ws = workbook.Sheets[sheetName];
  if (!ws || !ws['!ref']) return false;

  const range = XLSX.utils.decode_range(ws['!ref']);
  const MAX_ROWS = 22;
  const MAX_COLS = 9;
  const rows = Math.min(range.e.r - range.s.r + 1, MAX_ROWS);
  const cols = Math.min(range.e.c - range.s.c + 1, MAX_COLS);
  if (rows <= 0 || cols <= 0) return false;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  /* 上部: Excelタイトルバー */
  const headerH = 22;
  ctx.fillStyle = '#107c41';
  ctx.fillRect(0, 0, canvas.width, headerH);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('Excel', 8, headerH / 2);

  /* 表領域 */
  const tableY = headerH;
  const tableH = canvas.height - tableY;
  const cellW = canvas.width / cols;
  const cellH = tableH / rows;

  ctx.font = '9px "Yu Gothic","Hiragino Sans","Meiryo",sans-serif';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = '#d0d0d0';

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cellW;
      const y = tableY + r * cellH;

      /* ヘッダー行（1行目）: 薄青背景 */
      if (r === 0) {
        ctx.fillStyle = '#e3f2fd';
        ctx.fillRect(x, y, cellW, cellH);
      }

      ctx.strokeRect(x, y, cellW, cellH);

      const cellAddr = XLSX.utils.encode_cell({ r: range.s.r + r, c: range.s.c + c });
      const cell = ws[cellAddr];
      if (cell && cell.v !== undefined && cell.v !== null && cell.v !== '') {
        const raw = String(cell.w ?? cell.v);
        const text = raw.length > 8 ? raw.slice(0, 7) + '…' : raw;
        ctx.fillStyle = r === 0 ? '#0d47a1' : '#222';
        ctx.fillText(text, x + 3, y + cellH / 2);
      }
    }
  }

  return true;
}

/* Wordサムネイル: テキスト先頭をページ風に描画 */
function drawWordThumbnail(canvas, text) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  /* 上部: Wordタイトルバー */
  const headerH = 22;
  ctx.fillStyle = '#2b579a';
  ctx.fillRect(0, 0, canvas.width, headerH);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('Word', 8, headerH / 2);

  /* 本文を行に分割して描画 */
  const padding = 14;
  const startY = headerH + 16;
  const lineH = 12;
  const maxWidth = canvas.width - padding * 2;
  ctx.font = '10px "Yu Gothic","Hiragino Sans","Meiryo",sans-serif';
  ctx.fillStyle = '#222';
  ctx.textBaseline = 'top';

  const lines = (text || '').split(/\n+/).filter(l => l.trim()).slice(0, 40);
  let y = startY;
  for (const line of lines) {
    if (y + lineH > canvas.height - 4) break;
    /* 長すぎる行は折り返し */
    let remaining = line.trim();
    while (remaining && y + lineH <= canvas.height - 4) {
      let len = remaining.length;
      while (len > 0 && ctx.measureText(remaining.slice(0, len)).width > maxWidth) len--;
      if (len === 0) break;
      ctx.fillText(remaining.slice(0, len), padding, y);
      remaining = remaining.slice(len);
      y += lineH;
    }
  }

  return true;
}

function appendImg(iconId, url, opts = {}) {
  /* 文書系 (PDF/Excel/Word) は object-position:top で先頭(タイトル)を表示。
     画像/動画は中央クロップのまま。 */
  const objectPosition = opts.anchor === 'top' ? 'top' : 'center';

  /* カードビュー */
  const iconEl = document.getElementById(iconId);
  if (iconEl) {
    const thumb = iconEl.closest('.file-card-thumb');
    if (thumb) {
      const img = document.createElement('img');
      img.alt = '';
      img.style.cssText = `width:100%;height:100%;object-fit:cover;object-position:${objectPosition};display:block;position:absolute;inset:0;border-radius:4px 4px 0 0;`;
      img.onload = () => { iconEl.style.display = 'none'; thumb.appendChild(img); };
      img.onerror = () => {};
      img.src = url;
    }
  }

  /* リストビュー（行サムネイル） */
  const fileId = iconId.replace('thumb-icon-', '');
  const rowIconEl = document.getElementById(`thumb-icon-row-${fileId}`);
  if (rowIconEl) {
    const rowThumb = rowIconEl.closest('.file-row-thumb');
    if (rowThumb) {
      const img = document.createElement('img');
      img.alt = '';
      img.style.cssText = `width:100%;height:100%;object-fit:cover;object-position:${objectPosition};display:block;border-radius:4px;`;
      img.onload = () => { rowIconEl.style.display = 'none'; rowThumb.appendChild(img); };
      img.onerror = () => {};
      img.src = url;
    }
  }
}

function fileCardHtml(f) {
  const { icon, cls } = wnFileIcon(f.file_name, f.mime_type);
  const vBadge = f.version > 1 ? `<span class="file-card-version">v${f.version}</span>` : '';
  const ext  = (f.file_name || '').split('.').pop().toLowerCase();
  const mime = f.mime_type ?? '';
  const hasThumb = mime.startsWith('image/') || ['png','jpg','jpeg','gif','webp','heic','heif','svg'].includes(ext)
                || mime === 'application/pdf' || ext === 'pdf'
                || mime.startsWith('video/') || ['mp4','mov','avi','webm'].includes(ext)
                || ext === 'dxf'
                || ['xlsx','xls','xlsm','docx','docm'].includes(ext);
  const thumbHtml = hasThumb
    ? `<i class="fa-solid ${icon} file-type-icon ${cls}" id="thumb-icon-${f.id}"></i>`
    : `<i class="fa-solid ${icon} file-type-icon ${cls}"></i>`;

  const apStatus = f.approval_status ?? 'none';
  const apBadge  = wnApprovalBadge(apStatus);
  const apBadgeHtml = apStatus !== 'none'
    ? `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;
        color:${apBadge.color};background:${apBadge.bg};white-space:nowrap;">
        ${apBadge.label}
       </span>`
    : '';

  return `
  <div class="file-card" data-file-id="${f.id}">
    <div class="file-card-thumb">${thumbHtml}</div>
    ${vBadge ? `<div class="file-card-badge">${vBadge}</div>` : ''}
    <div class="file-card-body">
      <div class="file-card-name" title="${h(f.file_name)}">${h(f.file_name)}</div>
      ${apBadgeHtml ? `<div style="margin-bottom:4px;">${apBadgeHtml}</div>` : ''}
      <div class="file-card-meta">
        <span>${wnFormatDate(f.created_at)}</span>
        <span>${wnFormatSize(f.file_size)}</span>
        ${ext ? `<span class="file-card-ext">${ext.toUpperCase()}</span>` : ''}
      </div>
      <div class="file-card-actions">
        <span class="file-card-stat" title="閲覧数">
          <i class="fa-regular fa-eye"></i>${f.view_count ?? 0}
        </span>
        <span class="file-card-stat" title="コメント数">
          <i class="fa-regular fa-comment"></i>${f.comment_count ?? 0}
        </span>
        <button class="file-action-btn like-btn${f.liked ? ' liked' : ''}" data-id="${f.id}" title="いいね">
          <i class="fa-${f.liked ? 'solid' : 'regular'} fa-heart"></i>
          <span>${f.like_count ?? 0}</span>
        </button>
        <button class="file-action-btn" title="メールで共有"
                onclick="event.stopPropagation();openEmailModal(${f.id},'${h(f.file_name)}')">
          <i class="fa-solid fa-envelope"></i>
        </button>
        <button class="file-action-btn file-action-delete" title="削除"
                onclick="event.stopPropagation();confirmDeleteFile(${f.id},'${h(f.file_name)}')">
          <i class="fa-solid fa-trash"></i>
        </button>
        <button class="file-action-btn" title="ダウンロード"
                onclick="event.stopPropagation();wnDownload(${f.id})">
          <i class="fa-solid fa-download"></i>
        </button>
      </div>
    </div>
  </div>`;
}

/* リスト行の描画: モバイルは Instagram 風（B案）、PC は従来のテーブル風 */
function fileRowHtml(f) {
  return isMobileViewport() ? fileRowHtmlIG(f) : fileRowHtmlClassic(f);
}

function isMobileViewport() {
  return window.innerWidth <= 767;
}

/* === 従来のテーブル風（PC専用） === */
function fileRowHtmlClassic(f) {
  const { icon, cls } = wnFileIcon(f.file_name, f.mime_type);
  const ext  = (f.file_name || '').split('.').pop().toLowerCase();
  const mime = f.mime_type ?? '';
  const hasThumb = mime.startsWith('image/') || ['png','jpg','jpeg','gif','webp','heic','heif','svg'].includes(ext)
                || mime === 'application/pdf' || ext === 'pdf'
                || mime.startsWith('video/') || ['mp4','mov','avi','webm'].includes(ext)
                || ext === 'dxf'
                || ['xlsx','xls','xlsm','docx','docm'].includes(ext);
  const iconContent = hasThumb
    ? `<i class="fa-solid ${icon} ${cls}" id="thumb-icon-row-${f.id}"></i>`
    : `<i class="fa-solid ${icon} ${cls}"></i>`;
  const aiDesc = f.ai_description ? h(f.ai_description) : '';
  const approvalBadge = (() => {
    const s = f.approval_status ?? 'none';
    if (s === 'none') return '';
    const b = wnApprovalBadge(s);
    return `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;color:${b.color};background:${b.bg};">${b.label}</span>`;
  })();
  const fnameSafe = h(f.file_name);
  return `
  <div class="file-row" data-file-id="${f.id}">
    <div class="file-row-thumb">${iconContent}</div>
    <div class="file-row-name">
      <div class="file-row-filename">${fnameSafe}</div>
      ${aiDesc ? `<div class="file-row-ai-desc">${aiDesc}</div>` : ''}
      <div class="file-row-tags">${(f.tags || []).slice(0, 5).map(t =>
        `<span class="tag${t.source === 'ai' ? ' tag-ai' : ''}" style="font-size:10px;padding:2px 7px;line-height:1.4;">${h(t.name)}</span>`
      ).join('')}</div>
      <div class="file-row-meta">
        ${f.version > 1 ? `<span class="file-card-version">v${f.version}</span>` : ''}
        ${approvalBadge}
        <span class="file-row-size">${wnFormatSize(f.file_size)}</span>
        <span class="file-row-date">${wnFormatDate(f.created_at)}</span>
        <span class="file-row-stat" title="閲覧数">
          <i class="fa-regular fa-eye"></i>${f.view_count ?? 0}
        </span>
        <span class="file-row-stat" title="コメント数">
          <i class="fa-regular fa-comment"></i>${f.comment_count ?? 0}
        </span>
        <button class="like-btn${f.liked ? ' liked' : ''}" data-id="${f.id}" title="いいね">
          <i class="fa-${f.liked ? 'solid' : 'regular'} fa-heart"></i>
          <span>${f.like_count ?? 0}</span>
        </button>
        <button class="btn btn-ghost btn-sm" title="メールで共有"
                onclick="event.stopPropagation();openEmailModal(${f.id},'${fnameSafe}')">
          <i class="fa-solid fa-envelope"></i>
        </button>
        <button class="btn btn-ghost btn-sm" title="削除"
                onclick="event.stopPropagation();confirmDeleteFile(${f.id},'${fnameSafe}')">
          <i class="fa-solid fa-trash"></i>
        </button>
        <button class="btn btn-ghost btn-sm" title="ダウンロード"
                onclick="event.stopPropagation();wnDownload(${f.id})">
          <i class="fa-solid fa-download"></i>
        </button>
      </div>
    </div>
    <div class="file-row-comments" id="row-comments-${f.id}">
      <div class="file-row-comments-loading"><i class="fa-solid fa-spinner fa-spin" style="font-size:11px;"></i></div>
    </div>
  </div>`;
}

/* === Instagram 風フィード（モバイル専用） === */
function fileRowHtmlIG(f) {
  const { icon, cls } = wnFileIcon(f.file_name, f.mime_type);
  const ext  = (f.file_name || '').split('.').pop().toLowerCase();
  const mime = f.mime_type ?? '';
  const hasThumb = mime.startsWith('image/') || ['png','jpg','jpeg','gif','webp','heic','heif','svg'].includes(ext)
                || mime === 'application/pdf' || ext === 'pdf'
                || mime.startsWith('video/') || ['mp4','mov','avi','webm'].includes(ext)
                || ext === 'dxf'
                || ['xlsx','xls','xlsm','docx','docm'].includes(ext);
  const placeholderIcon = hasThumb
    ? `<i class="fa-solid ${icon} ${cls}" id="thumb-icon-row-${f.id}"></i>`
    : `<i class="fa-solid ${icon} ${cls}"></i>`;

  const aiDesc = f.ai_description ? h(f.ai_description) : '';
  const fnameSafe = h(f.file_name);

  const tagList = f.tags || [];
  const headTag = tagList[0];
  const headTagHtml = headTag
    ? `<span class="ig-post-tag${headTag.source === 'ai' ? ' ai' : ''}">
         <i class="fa-solid ${headTag.source === 'ai' ? 'fa-wand-magic-sparkles' : 'fa-tag'}"></i>${h(headTag.name)}
       </span>`
    : '';

  const apStatus = f.approval_status ?? 'none';
  const apBadgeHtml = (() => {
    if (apStatus === 'none') return '';
    const b = wnApprovalBadge(apStatus);
    return `<span class="ig-post-approval" style="color:${b.color};background:${b.bg};">${b.label}</span>`;
  })();

  const versionHtml = f.version > 1
    ? `<span class="ig-post-version">v${f.version}</span>`
    : '';

  const restTags = tagList.slice(1, 5);
  const chipsHtml = restTags.length
    ? `<div class="ig-post-chips">${restTags.map(t =>
        `<span class="tag${t.source === 'ai' ? ' tag-ai' : ''}">${h(t.name)}</span>`
      ).join('')}</div>`
    : '';

  const likeCount = f.like_count ?? 0;
  const viewCount = f.view_count ?? 0;
  const cmtCount  = f.comment_count ?? 0;

  return `
  <article class="ig-post" data-file-id="${f.id}">
    <div class="file-row-thumb">
      ${headTagHtml}
      ${apBadgeHtml}
      ${placeholderIcon}
      ${versionHtml}
      <span class="ig-post-size"><i class="fa-solid fa-file"></i>${wnFormatSize(f.file_size)}</span>
    </div>

    <div class="ig-post-actions">
      <div class="left">
        <span class="ig-view-count" title="閲覧数">
          <i class="fa-regular fa-eye"></i><span>${viewCount}</span>
        </span>
        <button class="like-btn${f.liked ? ' liked' : ''}" data-id="${f.id}" title="いいね">
          <i class="fa-${f.liked ? 'solid' : 'regular'} fa-heart"></i>
          <span>${likeCount}</span>
        </button>
        <button class="file-action-btn ig-cmt-btn" title="コメント"
                onclick="event.stopPropagation();wnScrollToComment('${f.id}');">
          <i class="fa-regular fa-comment"></i><span class="ig-cmt-cnt">${cmtCount}</span>
        </button>
        <button class="file-action-btn" title="メールで共有"
                onclick="event.stopPropagation();openEmailModal(${f.id},'${fnameSafe}')">
          <i class="fa-regular fa-paper-plane"></i>
        </button>
        <button class="file-action-btn" title="ダウンロード"
                onclick="event.stopPropagation();wnDownload(${f.id})">
          <i class="fa-solid fa-download"></i>
        </button>
      </div>
      <div class="right">
        <button class="file-action-btn file-action-delete" title="削除"
                onclick="event.stopPropagation();confirmDeleteFile(${f.id},'${fnameSafe}')">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>

    <div class="ig-post-date"><i class="fa-regular fa-clock"></i>${wnFormatDate(f.created_at)}</div>

    <div class="ig-post-caption">
      <span class="filename">${fnameSafe}</span>
      ${aiDesc ? `<span class="desc">${aiDesc}</span>` : ''}
    </div>

    ${chipsHtml}

    <div class="file-row-comments" id="row-comments-${f.id}">
      <div class="file-row-comments-loading"><i class="fa-solid fa-spinner fa-spin" style="font-size:11px;"></i></div>
    </div>
  </article>`;
}

function renderTagFilter() {
  const list     = document.getElementById('tagFilterList');
  const clearBtn = document.getElementById('tagClearBtn');

  if (!allTags.length) {
    list.innerHTML = '<span style="font-size:12px;color:var(--muted);">タグなし</span>';
    if (clearBtn) clearBtn.style.display = 'none';
    return;
  }

  const visible = allTags.slice(0, TAG_BAR_MAX);
  const rest    = allTags.slice(TAG_BAR_MAX);

  const tagHtml = (t) =>
    `<span class="tag tag-draggable${t.source === 'ai' ? ' tag-ai' : ''}${selectedTags.includes(String(t.id)) ? ' active' : ''}"
           data-tag-id="${t.id}">${h(t.name)}${t.files_count ? `<span style="margin-left:4px;opacity:.6;font-size:10px;">${t.files_count}</span>` : ''}</span>`;

  let html = visible.map(tagHtml).join('');
  if (rest.length) {
    html += `<button class="btn btn-ghost btn-sm" id="tagMoreBtn" style="font-size:12px;padding:3px 8px;">
               その他 ${rest.length}個 <i class="fa-solid fa-chevron-down" style="font-size:10px;"></i>
             </button>`;
  }
  list.innerHTML = html;

  list.querySelectorAll('.tag[data-tag-id]').forEach(el => initTagDragSort(el));

  const moreBtn = document.getElementById('tagMoreBtn');
  if (moreBtn) {
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showTagPopup(moreBtn, rest);
    });
  }

  // 全解除・ANDバッジの表示制御
  updateTagFilterControls();
}

function updateTagFilterControls() {
  const n        = selectedTags.length;
  const clearBtn = document.getElementById('tagClearBtn');
  const andBadge = document.getElementById('tagAndBadge');
  if (clearBtn) clearBtn.style.display = n ? '' : 'none';
  if (andBadge) andBadge.style.display = n >= 2 ? '' : 'none';
}

/* ─── タグ グローバルドラッグ並び替え ─── */
// バーとポップアップをまたいだドラッグに対応。
// 「バー」= #tagFilterList、「ポップアップ」= #tagPopupList の両方を常に候補として探す。
const TAG_BAR_MAX = 10; // バーに表示する最大タグ数
let _tagDrag = null;

function initTagDragSort(el) {
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    _tagDrag = { el, startX: e.clientX, startY: e.clientY, isDragging: false, ghost: null, marker: null };

    const onMouseMove = (me) => {
      if (!_tagDrag) return;
      const dx = me.clientX - _tagDrag.startX;
      const dy = me.clientY - _tagDrag.startY;

      if (!_tagDrag.isDragging && Math.sqrt(dx * dx + dy * dy) > 6) {
        _tagDrag.isDragging = true;
        el.classList.add('tag-dragging');

        const ghost = el.cloneNode(true);
        ghost.style.cssText = `
          position:fixed;z-index:99999;pointer-events:none;
          opacity:.85;transform:scale(1.05) rotate(-2deg);
          box-shadow:0 4px 16px rgba(0,0,0,.18);transition:none;
        `;
        document.body.appendChild(ghost);
        _tagDrag.ghost = ghost;

        const marker = document.createElement('span');
        marker.className = 'tag-insert-marker';
        document.body.appendChild(marker);
        _tagDrag.marker = marker;
      }

      if (_tagDrag.isDragging) {
        const r = el.getBoundingClientRect();
        _tagDrag.ghost.style.left = (me.clientX - r.width / 2) + 'px';
        _tagDrag.ghost.style.top  = (me.clientY - r.height / 2) + 'px';
        updateTagMarker(me.clientX, me.clientY);
      }
    };

    const onMouseUp = (ue) => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (!_tagDrag) return;

      if (_tagDrag.isDragging) {
        el.classList.remove('tag-dragging');
        _tagDrag.ghost?.remove();
        _tagDrag.marker?.remove();
        dropTag(ue.clientX, ue.clientY, el);
      } else {
        // クリック扱い
        toggleTag(el);
        // ポップアップ内タグのクリックはバーの選択状態も同期
        if (el.closest('#tagPopup')) renderTagFilter();
      }
      _tagDrag = null;
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    e.preventDefault();
  });
}

/** バー・ポップアップ全タグからカーソル最近傍を返す */
function findNearestTag(x, y) {
  const barTags  = [...(document.getElementById('tagFilterList')?.querySelectorAll('.tag[data-tag-id]') ?? [])];
  const popTags  = [...(document.getElementById('tagPopupList')?.querySelectorAll('.tag[data-tag-id]') ?? [])];
  const allEls   = [...barTags, ...popTags].filter(t => t !== _tagDrag?.el);

  let closest = null, minDist = Infinity;
  for (const t of allEls) {
    const r  = t.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    if (y >= r.top - 10 && y <= r.bottom + 10) {
      const dist = Math.abs(x - cx);
      if (dist < minDist) { minDist = dist; closest = t; }
    }
  }
  return closest;
}

function updateTagMarker(x, y) {
  const marker = _tagDrag?.marker;
  if (!marker) return;
  const target = findNearestTag(x, y);
  if (!target) { marker.style.display = 'none'; return; }
  const r = target.getBoundingClientRect();
  const before = x < r.left + r.width / 2;
  marker.style.cssText = `
    position:fixed;z-index:99998;pointer-events:none;display:block;
    width:3px;height:${r.height}px;background:var(--accent);border-radius:2px;
    top:${r.top}px;left:${(before ? r.left : r.right) - 1.5}px;
  `;
}

function dropTag(x, y, dragEl) {
  const target = findNearestTag(x, y);

  // ドラッグ元とドロップ先のコンテナを特定
  const barList = document.getElementById('tagFilterList');
  const popList = document.getElementById('tagPopupList');
  const srcInBar = barList?.contains(dragEl);
  const srcInPop = popList?.contains(dragEl);
  const dstInBar = target && barList?.contains(target);
  const dstInPop = target && popList?.contains(target);

  if (!target) return; // ドロップ先なし

  // allTags 上での移動先インデックスを計算
  const tagById    = id => allTags.find(t => String(t.id) === id);
  const dragTagObj = tagById(dragEl.dataset.tagId);
  const targTagObj = tagById(target.dataset.tagId);
  if (!dragTagObj || !targTagObj) return;

  const r       = target.getBoundingClientRect();
  const before  = x < r.left + r.width / 2;
  const fromIdx = allTags.indexOf(dragTagObj);
  let   toIdx   = allTags.indexOf(targTagObj);
  if (!before) toIdx++;
  if (toIdx > fromIdx) toIdx--; // 自分を抜いた後の位置補正

  // allTags を並び替え
  allTags.splice(fromIdx, 1);
  allTags.splice(toIdx, 0, dragTagObj);

  // バー・ポップアップを両方再描画
  renderTagFilter();
  rebuildPopupList();
  saveTagOrderFromFilter();
}

/** ポップアップが開いていれば中身だけ再描画する */
function rebuildPopupList() {
  const popList = document.getElementById('tagPopupList');
  if (!popList) return;
  const rest = allTags.slice(TAG_BAR_MAX);
  popList.innerHTML = rest.map(t =>
    `<span class="tag tag-draggable${t.source === 'ai' ? ' tag-ai' : ''}${selectedTags.includes(String(t.id)) ? ' active' : ''}"
           data-tag-id="${t.id}">
       ${h(t.name)}${t.files_count ? `<span style="margin-left:4px;opacity:.6;font-size:10px;">${t.files_count}</span>` : ''}
     </span>`
  ).join('');
  popList.querySelectorAll('.tag[data-tag-id]').forEach(el => initTagDragSort(el));
}

let _saveTagOrderTimer = null;
function saveTagOrderFromFilter() {
  clearTimeout(_saveTagOrderTimer);
  _saveTagOrderTimer = setTimeout(async () => {
    const orders = allTags.map((t, i) => ({ id: t.id, sort_order: i }));
    const ok = await wnReorderTags(orders);
    if (ok) wnShowToast('タグの並び順を保存しました', 'success');
    else wnShowToast('並び順の保存に失敗しました', 'danger');
  }, 400);
}

function toggleTag(el) {
  const id = String(el.dataset.tagId);
  if (selectedTags.includes(id)) {
    selectedTags = selectedTags.filter(x => x !== id);
    el.classList.remove('active');
  } else {
    selectedTags.push(id);
    el.classList.add('active');
  }
  updateTagFilterControls();
  loadFiles();
}

function clearAllTags() {
  selectedTags = [];
  renderTagFilter();
  // ポップアップ内のタグも更新
  document.querySelectorAll('#tagPopupList .tag[data-tag-id]').forEach(el => el.classList.remove('active'));
  loadFiles();
}

function showTagPopup(anchor, rest) {
  // 既存ポップアップを閉じる
  document.getElementById('tagPopup')?.remove();

  const popup = document.createElement('div');
  popup.id = 'tagPopup';
  popup.style.cssText = `
    position:fixed;z-index:9999;background:#ffffff;border:1px solid var(--border);
    border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:14px 16px;
    max-width:340px;max-height:300px;overflow-y:auto;
  `;

  popup.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <span style="font-size:13px;font-weight:700;color:var(--primary);">その他のタグ</span>
      <button id="tagPopupClose" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:16px;">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <p style="font-size:11px;color:var(--muted);margin:0 0 10px;">バーへドラッグで移動・クリックで絞り込み</p>
    <div class="tag-list" id="tagPopupList" style="gap:8px;">
      ${rest.map(t =>
        `<span class="tag tag-draggable${t.source === 'ai' ? ' tag-ai' : ''}${selectedTags.includes(String(t.id)) ? ' active' : ''}"
               data-tag-id="${t.id}">
           ${h(t.name)}${t.files_count ? `<span style="margin-left:4px;opacity:.6;font-size:10px;">${t.files_count}</span>` : ''}
         </span>`
      ).join('')}
    </div>
  `;

  document.body.appendChild(popup);

  // アンカー位置に配置
  const rect = anchor.getBoundingClientRect();
  const popW = 340;
  let left = rect.left;
  if (left + popW > window.innerWidth - 16) left = window.innerWidth - popW - 16;
  popup.style.top  = (rect.bottom + 8) + 'px';
  popup.style.left = Math.max(8, left) + 'px';

  popup.querySelectorAll('.tag[data-tag-id]').forEach(el => initTagDragSort(el));

  document.getElementById('tagPopupClose').addEventListener('click', () => popup.remove());

  // 外クリックで閉じる
  setTimeout(() => {
    document.addEventListener('click', function closePopup(e) {
      if (!popup.contains(e.target) && e.target !== anchor) {
        popup.remove();
        document.removeEventListener('click', closePopup);
      }
    });
  }, 0);
}

function showLoading(show) {
  document.getElementById('loadingArea').style.display = show ? 'block' : 'none';
  if (!show) {
    document.getElementById('gridArea').style.display = layoutView === 'grid' ? 'block' : 'none';
    document.getElementById('listArea').style.display = layoutView === 'list' ? 'block' : 'none';
  } else {
    document.getElementById('gridArea').style.display = 'none';
    document.getElementById('listArea').style.display = 'none';
  }
}

/* ────────────────────────────────
   サイドバーナビ（ビュー切替）
   ──────────────────────────────── */
function initNav() {
  const navMap = { navAll: 'all', navMine: 'mine', navRecent: 'recent', navLiked: 'liked' };
  const navLabels = { navAll: 'ホーム', navMine: 'マイファイル', navRecent: '最近のファイル', navLiked: 'いいね済み' };
  const titleEl = document.getElementById('topBarTitle');
  Object.entries(navMap).forEach(([id, view]) => {
    document.getElementById(id)?.addEventListener('click', e => {
      e.preventDefault();
      navView = view;
      Object.keys(navMap).forEach(k => document.getElementById(k)?.classList.remove('active'));
      document.getElementById(id)?.classList.add('active');
      if (titleEl) titleEl.textContent = navLabels[id];
      // ホームは検索・タグ選択をリセットして全件表示
      if (id === 'navAll') {
        selectedTags = [];
        semanticMode = false;
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';
        document.getElementById('semanticClearBtn')?.style && (document.getElementById('semanticClearBtn').style.display = 'none');
        document.getElementById('semanticHint')?.style && (document.getElementById('semanticHint').style.display = 'none');
        document.getElementById('searchIcon')?.classList.remove('fa-wand-magic-sparkles');
        document.getElementById('searchIcon')?.classList.add('fa-magnifying-glass');
        renderTagFilter();
      }
      loadFiles();
    });
  });
  // 初期アクティブ状態を設定
  document.getElementById('navAll')?.classList.add('active');
  if (titleEl) titleEl.textContent = 'ホーム';
}

/* ────────────────────────────────
   グリッド / リスト切替 — 選択は localStorage に永続化
   ──────────────────────────────── */
function applyLayoutView(view, { loadComments = false } = {}) {
  layoutView = view === 'list' ? 'list' : 'grid';
  localStorage.setItem(LAYOUT_VIEW_STORAGE_KEY, layoutView);

  const isList = layoutView === 'list';
  document.getElementById('viewGrid')?.classList.toggle('active', !isList);
  document.getElementById('viewList')?.classList.toggle('active',  isList);
  const gridArea = document.getElementById('gridArea');
  const listArea = document.getElementById('listArea');
  if (gridArea) gridArea.style.display = isList ? 'none'  : 'block';
  if (listArea) listArea.style.display = isList ? 'block' : 'none';

  if (isList && loadComments) loadRowComments();
}

function initViewToggle() {
  // 起動時に保存されたビューを適用（HTMLのデフォルトは grid なので、 list の時だけスワップ）
  applyLayoutView(layoutView);

  document.getElementById('viewGrid').addEventListener('click', () => applyLayoutView('grid'));
  document.getElementById('viewList').addEventListener('click', () => applyLayoutView('list', { loadComments: true }));
}

/* ────────────────────────────────
   フィルター・検索
   ──────────────────────────────── */
function initFilters() {
  document.getElementById('sortFilter').addEventListener('change', loadFiles);
  document.getElementById('tagClearBtn')?.addEventListener('click', clearAllTags);
}

function initSearch() {
  let timer;
  document.getElementById('searchInput').addEventListener('input', () => {
    if (semanticMode) return; // AI検索中は通常検索をスキップ
    clearTimeout(timer);
    timer = setTimeout(loadFiles, 400);
  });

  // AI自然言語検索ボタン
  const runSemanticSearch = async () => {
    const q = document.getElementById('searchInput').value.trim();
    if (!q) { wnShowToast('検索キーワードを入力してください', 'warning'); return; }

    const btn      = document.getElementById('semanticSearchBtn');
    const bar      = document.getElementById('searchBar');
    const hint     = document.getElementById('semanticHint');
    const clearBtn = document.getElementById('semanticClearBtn');

    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="color:var(--accent);"></i><span style="font-size:11px;color:var(--accent);font-weight:700;">AI</span>';
    btn.disabled  = true;
    bar.style.outline = '2px solid var(--accent)';

    const results = await wnSemanticSearch(q);

    btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles" style="color:var(--accent);"></i><span style="font-size:11px;color:var(--accent);font-weight:700;">AI</span>';
    btn.disabled  = false;

    if (!results.length) {
      bar.style.outline = '';
      wnShowToast('類似するファイルが見つかりませんでした。AI要約が生成されていないファイルは対象外です。', 'warning');
      return;
    }

    // AI検索モードに切替
    semanticMode = true;
    bar.style.outline  = '2px solid var(--accent)';
    hint.style.display = '';
    clearBtn.style.display = '';

    allFiles = results;
    document.getElementById('areaTitle').textContent = `AI検索: "${q}"`;
    renderFiles();
    wnShowToast(`${results.length}件のファイルが見つかりました`, 'success');
  };

  document.getElementById('semanticSearchBtn')?.addEventListener('click', runSemanticSearch);

  // クリアボタン：通常検索に戻る
  document.getElementById('semanticClearBtn')?.addEventListener('click', () => {
    semanticMode = false;
    document.getElementById('searchBar').style.outline  = '';
    document.getElementById('semanticHint').style.display  = 'none';
    document.getElementById('semanticClearBtn').style.display = 'none';
    document.getElementById('searchInput').value = '';
    loadFiles();
  });
}

/* ────────────────────────────────
   音声検索
   ──────────────────────────────── */
function initVoiceSearch() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  // トップバーボタン（小）
  const topBtn  = document.getElementById('voiceSearchBtn');
  const topIcon = document.getElementById('voiceSearchIcon');

  // サイドバーボタン（大）
  const sideBtn       = document.getElementById('sidebarVoiceBtn');
  const sideIconWrap  = document.getElementById('sidebarVoiceIconWrap');
  const sideIcon      = sideIconWrap?.querySelector('i');
  const sideLabel     = document.getElementById('sidebarVoiceLabel');

  const input = document.getElementById('searchInput');

  if (!SpeechRecognition) {
    // 非対応ブラウザ: サイドバーボタンを無効表示
    if (sideBtn) {
      sideBtn.style.opacity = '.4';
      sideBtn.style.cursor  = 'not-allowed';
      if (sideLabel) sideLabel.textContent = '非対応ブラウザ';
    }
    return;
  }

  // トップバーの小ボタンも表示
  if (topBtn) topBtn.style.display = '';

  const recog = new SpeechRecognition();
  recog.lang            = 'ja-JP';
  recog.interimResults  = true;
  recog.maxAlternatives = 1;

  let isListening = false;

  function startListening() {
    if (!isListening) recog.start();
  }
  function stopListening() {
    if (isListening) recog.stop();
  }
  function toggleListening() {
    isListening ? stopListening() : startListening();
  }

  if (topBtn)  topBtn.addEventListener('click',  toggleListening);
  if (sideBtn) sideBtn.addEventListener('click', toggleListening);

  recog.onstart = () => {
    isListening = true;
    // トップ
    if (topBtn)  topBtn.classList.add('listening');
    if (topIcon) topIcon.className = 'fa-solid fa-microphone-lines';
    // サイド
    if (sideBtn)   sideBtn.classList.add('listening');
    if (sideIcon)  sideIcon.className = 'fa-solid fa-microphone-lines';
    if (sideLabel) sideLabel.textContent = '聞いています…';
    // 検索バー
    input.placeholder = '話してください…';
    input.value = '';
    // トップバーの検索バーにフォーカスを当てて入力中を明示
    document.getElementById('searchBar')?.classList.add('voice-active');
  };

  recog.onresult = (e) => {
    const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
    input.value = transcript;
  };

  recog.onend = async () => {
    isListening = false;
    // トップ
    if (topBtn)  topBtn.classList.remove('listening');
    if (topIcon) topIcon.className = 'fa-solid fa-microphone';
    // サイド
    if (sideBtn)   sideBtn.classList.remove('listening');
    if (sideIcon)  sideIcon.className = 'fa-solid fa-microphone';
    if (sideLabel) sideLabel.textContent = '音声で検索';
    // 検索バー
    input.placeholder = 'ファイル名・タグで検索…';
    document.getElementById('searchBar')?.classList.remove('voice-active');

    const raw = input.value.trim();
    if (!raw) return;

    // 音声入力の正規化
    let q = normalizeVoiceQuery(raw);

    // ファジーマッチで実在ファイル名・タグ名に補正
    const corrected = fuzzyCorrectVoiceQuery(q);
    if (corrected && corrected !== q) {
      wnShowToast(`「${q}」→「${corrected}」に補正して検索します`, 'info');
      q = corrected;
    }
    if (q !== raw) input.value = q;

    // 10文字超 → AI自然言語検索、それ以下 → 通常検索
    if (q.length > 10) {
      wnShowToast(`「${q}」でAI検索します`, 'success');
      document.getElementById('semanticSearchBtn').click();
    } else {
      if (!corrected) wnShowToast(`「${q}」で検索します`, 'success');
      loadFiles();
    }
  };

  recog.onerror = (e) => {
    isListening = false;
    if (topBtn)  topBtn.classList.remove('listening');
    if (topIcon) topIcon.className = 'fa-solid fa-microphone';
    if (sideBtn)   sideBtn.classList.remove('listening');
    if (sideIcon)  sideIcon.className = 'fa-solid fa-microphone';
    if (sideLabel) sideLabel.textContent = '音声で検索';
    input.placeholder = 'ファイル名・タグで検索…';
    document.getElementById('searchBar')?.classList.remove('voice-active');
    if (e.error === 'not-allowed') {
      wnShowToast('マイクの使用が許可されていません。ブラウザの設定を確認してください。', 'danger');
    } else if (e.error !== 'no-speech') {
      wnShowToast('音声認識に失敗しました。もう一度お試しください。', 'warning');
    }
  };
}

/* ────────────────────────────────
   全画面ドラッグ&ドロップ
   ──────────────────────────────── */
function initDragDrop() {
  const overlay = document.getElementById('dropOverlay');
  let dragCount = 0;

  document.addEventListener('dragenter', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    dragCount++;
    if (dragCount === 1) overlay.classList.add('active');
  });
  document.addEventListener('dragleave', () => {
    dragCount--;
    if (dragCount <= 0) { dragCount = 0; overlay.classList.remove('active'); }
  });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    dragCount = 0;
    overlay.classList.remove('active');
    const files = Array.from(e.dataTransfer.files);
    if (files.length) openUploadModal(files);
  });
}

/* ────────────────────────────────
   アップロードモーダル
   ──────────────────────────────── */
function initUploadModal() {
  document.getElementById('uploadBtn').addEventListener('click', () => openUploadModal());

  /* ソース選択ボタン */
  document.getElementById('pickFileBtn').addEventListener('click',  () => document.getElementById('inputFile').click());
  document.getElementById('takePhotoBtn').addEventListener('click', () => document.getElementById('inputPhoto').click());
  document.getElementById('takeVideoBtn').addEventListener('click', () => document.getElementById('inputVideo').click());

  ['inputFile','inputPhoto','inputVideo'].forEach(id => {
    document.getElementById(id).addEventListener('change', function() {
      addToQueue(Array.from(this.files));
      this.value = '';
    });
  });

  /* モーダル内ドラッグ&ドロップゾーン */
  const zone = document.getElementById('uploadZone');
  zone.addEventListener('click', () => document.getElementById('inputFile').click());
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    addToQueue(Array.from(e.dataTransfer.files));
  });

  document.getElementById('uploadCancelBtn').addEventListener('click', closeUploadModal);
  document.getElementById('uploadModalClose').addEventListener('click', closeUploadModal);
  document.getElementById('uploadSubmitBtn').addEventListener('click', doUpload);
}

function openUploadModal(files = []) {
  uploadQueue = [];
  renderUploadQueue();
  document.getElementById('uploadModal').classList.remove('hidden');
  if (files.length) addToQueue(files);
}

function closeUploadModal() {
  document.getElementById('uploadModal').classList.add('hidden');
  uploadQueue = [];
  document.getElementById('uploadFileList').innerHTML = '';
  document.getElementById('uploadSubmitBtn').disabled = true;
}

function addToQueue(files) {
  files.forEach(f => {
    if (f.size > 100 * 1024 * 1024) {
      wnShowToast(`${f.name} は100MBを超えています`, 'danger');
      return;
    }
    uploadQueue.push(f);
  });
  renderUploadQueue();
  document.getElementById('uploadSubmitBtn').disabled = uploadQueue.length === 0;
}

function removeFromQueue(i) {
  uploadQueue.splice(i, 1);
  renderUploadQueue();
  document.getElementById('uploadSubmitBtn').disabled = uploadQueue.length === 0;
}

function renderUploadQueue() {
  const list = document.getElementById('uploadFileList');
  list.innerHTML = uploadQueue.map((f, i) => {
    const { icon, cls } = wnFileIcon(f.name, f.type);
    const isImg = f.type.startsWith('image/');
    const thumb = isImg
      ? `<img src="${URL.createObjectURL(f)}" style="width:32px;height:32px;object-fit:cover;border-radius:6px;flex-shrink:0;" alt="">`
      : `<i class="fa-solid ${icon} ${cls}"></i>`;
    return `
    <div class="upload-file-item" id="qitem-${i}">
      ${thumb}
      <span class="upload-file-name">${h(f.name)}</span>
      <span class="upload-file-size">${wnFormatSize(f.size)}</span>
      <button class="upload-file-remove" onclick="removeFromQueue(${i})">
        <i class="fa-solid fa-xmark"></i>
      </button>
      <div class="progress-bar-bg" style="width:100%;margin-top:0;display:none;">
        <div class="progress-bar-fill" id="prog-${i}" style="width:0%"></div>
      </div>
      <div class="upload-status-text" id="stat-${i}"
           style="width:100%;font-size:11px;color:var(--muted);margin-top:4px;display:none;"></div>
    </div>`;
  }).join('');
}

async function doUpload() {
  if (!uploadQueue.length) return;
  const submitBtn = document.getElementById('uploadSubmitBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'アップロード中…';

  const uploadedFiles = [];
  let failCount = 0;

  for (let i = 0; i < uploadQueue.length; i++) {
    const file = uploadQueue[i];
    const prog = document.getElementById(`prog-${i}`);
    const bar  = prog?.parentElement;
    const stat = document.getElementById(`stat-${i}`);
    if (bar) bar.style.display = 'block';
    if (stat) { stat.style.display = 'block'; stat.textContent = 'アップロード中…'; }
    try {
      const result = await wnUploadFile(file, {
        onProgress: pct => {
          if (prog) prog.style.width = pct + '%';
          if (pct >= 100 && stat) {
            stat.innerHTML = '<i class="fa-solid fa-circle-nodes fa-spin" style="color:var(--accent);"></i> KnowlがAI学習中…';
          }
        },
      });
      document.getElementById(`qitem-${i}`)?.style.setProperty('background', 'rgba(0,184,148,.08)');
      if (stat) stat.innerHTML = '<i class="fa-solid fa-check" style="color:#2E7D32;"></i> 学習完了';
      if (result?.data?.id) uploadedFiles.push(result.data);
    } catch (err) {
      failCount++;
      document.getElementById(`qitem-${i}`)?.style.setProperty('background', 'rgba(231,76,60,.08)');
      if (stat) stat.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color:#C62828;"></i> 失敗';
      wnShowToast(`${file.name} のアップロードに失敗しました: ${err.message}`, 'danger');
    }
  }

  closeUploadModal();
  await loadFiles();

  // アップロード成功ファイルのAIタグ提案モーダルを表示
  if (uploadedFiles.length > 0) {
    showAiTagModal(uploadedFiles);
  } else if (failCount === 0) {
    wnShowToast('アップロードが完了しました', 'success');
  }
}

/* ────────────────────────────────
   AIタグ提案モーダル
   ──────────────────────────────── */
let aiTagQueue      = [];
let aiTagCurrent    = 0;
let aiTagController = null;  // 進行中リクエストのAbortController
let aiTagLoading    = false;

async function showAiTagModal(files) {
  aiTagQueue   = files;
  aiTagCurrent = 0;
  document.getElementById('aiTagModal').classList.remove('hidden');
  await loadAiTagSuggestion();
}

function aiTagSkip() {
  if (aiTagController) { aiTagController.abort(); aiTagController = null; }
  aiTagCurrent++;
  loadAiTagSuggestion();
}

async function loadAiTagSuggestion() {
  if (aiTagCurrent >= aiTagQueue.length) {
    document.getElementById('aiTagModal').classList.add('hidden');
    wnShowToast('アップロードとタグ設定が完了しました', 'success');
    await loadFiles();
    return;
  }

  const file = aiTagQueue[aiTagCurrent];
  document.getElementById('aiTagFileName').textContent = file.file_name;
  document.getElementById('aiTagStep').textContent     = `${aiTagCurrent + 1} / ${aiTagQueue.length}`;
  document.getElementById('aiTagSuggested').innerHTML  =
    '<span style="color:var(--muted);font-size:13px;">' +
    '<i class="fa-solid fa-spinner fa-spin"></i> AIがタグを解析中…</span>';

  // スキップは解析中でも即反応
  document.getElementById('aiTagSkipBtn').onclick = aiTagSkip;
  document.getElementById('aiTagApplyBtn').onclick = null;

  // タイムアウト付きでAIタグ取得
  aiTagController = new AbortController();
  const timer = setTimeout(() => {
    if (aiTagController) { aiTagController.abort(); aiTagController = null; }
  }, 20000);

  let tags = [];
  try {
    const token = localStorage.getItem('space_token');
    const res = await fetch(WN_API_BASE + `/wn/files/${file.id}/ai-tags`, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      signal: aiTagController.signal,
    });
    clearTimeout(timer);
    aiTagController = null;
    if (res.ok) tags = (await res.json()).data ?? [];
  } catch {
    clearTimeout(timer);
    aiTagController = null;
    // abortまたはタイムアウト → タグなしで続行
  }

  // スキップされていたら何もしない
  if (aiTagCurrent >= aiTagQueue.length) return;
  if (aiTagQueue[aiTagCurrent]?.id !== file.id) return;

  const selectedTags = new Set((file.tags ?? []).map(t => t.name));

  const renderAll = () => {
    // 提案タグ（選択状態をトグル）
    document.getElementById('aiTagSuggested').innerHTML = tags.length
      ? tags.map(t => `
          <span class="tag${selectedTags.has(t) ? ' active' : ''}" data-tag="${h(t)}" style="cursor:pointer;">
            ✦ ${h(t)}
          </span>`).join('')
      : '<span style="font-size:13px;color:var(--muted);">提案なし（スキップしてください）</span>';

    document.getElementById('aiTagSuggested').querySelectorAll('.tag').forEach(el => {
      el.addEventListener('click', () => {
        const name = el.dataset.tag;
        if (selectedTags.has(name)) selectedTags.delete(name);
        else selectedTags.add(name);
        renderAll();
      });
    });

    // 選択済みタグ（×で削除）
    const wrap = document.getElementById('aiTagSelectedWrap');
    const sel  = document.getElementById('aiTagSelected');
    if (selectedTags.size > 0) {
      wrap.style.display = '';
      sel.innerHTML = [...selectedTags].map(t => `
        <span class="tag tag-removable active" data-tag="${h(t)}" style="cursor:pointer;">
          ${h(t)} <i class="fa-solid fa-xmark" style="font-size:10px;opacity:.7;margin-left:3px;"></i>
        </span>`).join('');
      sel.querySelectorAll('.tag-removable').forEach(el => {
        el.addEventListener('click', () => {
          selectedTags.delete(el.dataset.tag);
          renderAll();
        });
      });
    } else {
      wrap.style.display = 'none';
      sel.innerHTML = '';
    }

    // 既存タグの選択状態を同期
    document.querySelectorAll('#aiTagExistingList .tag[data-tag]').forEach(el => {
      el.classList.toggle('active', selectedTags.has(el.dataset.tag));
    });
  };

  renderAll();

  // 手動タグ入力 + 既存タグ選択
  const manualInput  = document.getElementById('aiTagManualInput');
  const manualAddBtn = document.getElementById('aiTagManualAddBtn');
  manualInput.value  = '';

  // 既存タグをインプット下に候補表示
  const existingWrap = document.getElementById('aiTagExistingWrap');
  if (existingWrap) {
    const otherTags = allTags.filter(t => !tags.includes(t.name)); // AI提案と被らないもの
    if (otherTags.length) {
      existingWrap.style.display = '';
      existingWrap.querySelector('#aiTagExistingList').innerHTML = otherTags.map(t =>
        `<span class="tag${selectedTags.has(t.name) ? ' active' : ''}" data-tag="${h(t.name)}" style="cursor:pointer;">${h(t.name)}</span>`
      ).join('');
      existingWrap.querySelectorAll('.tag[data-tag]').forEach(el => {
        el.addEventListener('click', () => {
          const name = el.dataset.tag;
          if (selectedTags.has(name)) selectedTags.delete(name);
          else selectedTags.add(name);
          renderAll();
          // 既存タグの選択状態も更新
          el.classList.toggle('active', selectedTags.has(name));
        });
      });
    } else {
      existingWrap.style.display = 'none';
    }
  }

  const addManualTag = () => {
    const name = manualInput.value.trim();
    if (!name) return;
    selectedTags.add(name);
    manualInput.value = '';
    renderAll();
    manualInput.focus();
  };
  manualAddBtn.onclick = addManualTag;
  manualInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addManualTag(); } };

  document.getElementById('aiTagApplyBtn').onclick = async () => {
    const selected = [...selectedTags];
    const btn = document.getElementById('aiTagApplyBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 保存中…';
    if (selected.length) await wnApplyAiTags(file.id, selected);
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> 選択したタグを保存';
    aiTagCurrent++;
    await loadAiTagSuggestion();
  };

  document.getElementById('aiTagSkipBtn').onclick = aiTagSkip;
}

/* ────────────────────────────────
   ファイル削除
   ──────────────────────────────── */
async function confirmDeleteFile(fileId, fileName) {
  if (!confirm(`「${fileName}」を削除しますか？\nこの操作は元に戻せません。`)) return;
  const ok = await wnDeleteFile(fileId);
  if (ok) {
    wnShowToast('ファイルを削除しました', 'success');
    allFiles = allFiles.filter(f => f.id !== fileId);
    renderFiles();
  } else {
    wnShowToast('削除に失敗しました', 'danger');
  }
}

/* ────────────────────────────────
   行内コメント表示
   ──────────────────────────────── */
async function loadRowComments() {
  // 表示中のファイルのコメントを並列取得
  await Promise.all(allFiles.map(async (f) => {
    const el = document.getElementById(`row-comments-${f.id}`);
    if (!el) return;
    // コメント0件のファイルはAPIを叩かず空表示にする（一覧の comment_count を利用）。
    // 全行で /comments を叩くと1表示で数十リクエストになり 429 を誘発するため。
    if (!f.comment_count) { renderRowComments(el, f.id, []); return; }
    const comments = await wnGetComments(f.id);
    renderRowComments(el, f.id, comments);
  }));
}

function wnScrollToComment(fileId) {
  const cmtEl = document.getElementById(`row-comments-${fileId}`);
  if (!cmtEl) return;
  cmtEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(() => document.getElementById(`rci-${fileId}`)?.focus(), 300);
}

function renderRowComments(el, fileId, comments) {
  const latestThree = comments.slice(-3); // 最新3件のみ表示
  const hasMore = comments.length > 3;

  const bubbles = latestThree.map(c => {
    const isMine = currentUser && c.user_id === currentUser.id;
    const initial = (c.user?.name ?? '?').charAt(0).toUpperCase();
    return `<div class="row-comment-item">
      <div class="row-comment-avatar" style="${isMine ? 'background:var(--accent);' : ''}">${initial}</div>
      <div class="row-comment-content">
        <span class="row-comment-name">${isMine ? 'あなた' : h(c.user?.name ?? '')}</span>
        <span class="row-comment-body">${h(c.body)}</span>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = comments.length === 0
    ? `<div class="row-comment-empty"><i class="fa-regular fa-comment"></i> コメントなし</div>`
    : `${hasMore ? `<div class="row-comment-more">他 ${comments.length - 3} 件</div>` : ''}${bubbles}
       <div class="row-comment-input-wrap" onclick="event.stopPropagation();">
         <input class="row-comment-input" id="rci-${fileId}" placeholder="コメントを追加…" type="text">
         <button class="row-comment-send" onclick="sendRowComment(${fileId})">
           <i class="fa-solid fa-paper-plane"></i>
         </button>
       </div>`;

  if (comments.length === 0) {
    // コメントなしの場合も入力欄を表示
    el.innerHTML += `<div class="row-comment-input-wrap" onclick="event.stopPropagation();">
      <input class="row-comment-input" id="rci-${fileId}" placeholder="コメントを追加…" type="text">
      <button class="row-comment-send" onclick="sendRowComment(${fileId})">
        <i class="fa-solid fa-paper-plane"></i>
      </button>
    </div>`;
  }

  // Enterキーで送信
  const input = document.getElementById(`rci-${fileId}`);
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendRowComment(fileId); }
    });
  }
}

async function sendRowComment(fileId) {
  const input = document.getElementById(`rci-${fileId}`);
  if (!input) return;
  const body = input.value.trim();
  if (!body) return;
  input.value = '';
  input.disabled = true;
  const result = await wnPostComment(fileId, body);
  input.disabled = false;
  if (result) {
    const el = document.getElementById(`row-comments-${fileId}`);
    if (el) {
      const comments = await wnGetComments(fileId);
      renderRowComments(el, fileId, comments);
    }
  } else {
    wnShowToast('コメントの送信に失敗しました', 'danger');
  }
}

/* ────────────────────────────────
   通知
   ──────────────────────────────── */
let notifPollingTimer = null;

function initNotifications() {
  const btn      = document.getElementById('notifBtn');
  const dropdown = document.getElementById('notifDropdown');
  const readAll  = document.getElementById('notifReadAll');

  // ベルボタンでドロップダウン開閉
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  // 外側クリックで閉じる
  document.addEventListener('click', (e) => {
    if (!document.getElementById('notifWrap').contains(e.target)) {
      dropdown.classList.remove('open');
    }
  });

  // 全件既読
  readAll.addEventListener('click', async () => {
    await wnReadAllNotifications();
    await refreshNotifications();
  });

  // 初回取得 + 30秒ポーリング
  refreshNotifications();
  notifPollingTimer = setInterval(refreshNotifications, 30000);
}

async function refreshNotifications() {
  const res = await wnGetNotifications();
  const badge = document.getElementById('notifBadge');
  const list  = document.getElementById('notifList');

  // バッジ
  if (res.unread > 0) {
    badge.textContent = res.unread > 99 ? '99+' : res.unread;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }

  // 一覧
  if (!res.data || res.data.length === 0) {
    list.innerHTML = '<div class="notif-empty">通知はありません</div>';
    return;
  }

  list.innerHTML = res.data.map(n => notifItemHtml(n)).join('');

  // クリックで既読 & ファイル詳細へ（将来的にfile-detail.htmlへ）
  list.querySelectorAll('.notif-item').forEach(el => {
    el.addEventListener('click', async () => {
      const id = Number(el.dataset.id);
      const fileId = Number(el.dataset.fileId);
      if (!el.classList.contains('unread')) return;
      await wnReadNotification(id);
      el.classList.remove('unread');
      await refreshNotifications();
    });
  });
}

function notifItemHtml(n) {
  const iconMap = {
    comment:  { cls: 'notif-icon-comment',  icon: 'fa-comment' },
    like:     { cls: 'notif-icon-like',     icon: 'fa-heart' },
    approved: { cls: 'notif-icon-approved', icon: 'fa-circle-check' },
    rejected: { cls: 'notif-icon-rejected', icon: 'fa-circle-xmark' },
    submit:   { cls: 'notif-icon-submit',   icon: 'fa-paper-plane' },
  };
  const { cls, icon } = iconMap[n.type] ?? { cls: 'notif-icon-comment', icon: 'fa-bell' };

  const textMap = {
    comment:  `<strong>${h(n.actor_name)}</strong> がコメントしました`,
    like:     `<strong>${h(n.actor_name)}</strong> がいいねしました`,
    approved: `<strong>${h(n.actor_name)}</strong> が承認しました`,
    rejected: `<strong>${h(n.actor_name)}</strong> が差し戻しました`,
    submit:   `<strong>${h(n.actor_name)}</strong> が承認を申請しました`,
  };
  const text = textMap[n.type] ?? '通知があります';

  const timeAgo = notifTimeAgo(n.created_at);
  const unreadCls = n.read_at ? '' : ' unread';

  return `<div class="notif-item${unreadCls}" data-id="${n.id}" data-file-id="${n.file_id}">
    <div class="notif-icon ${cls}"><i class="fa-solid ${icon}"></i></div>
    <div class="notif-body">
      <div class="notif-body-text">${text}</div>
      <div class="notif-body-sub">${h(n.file_name)}</div>
      ${n.body ? `<div class="notif-body-sub">${h(n.body)}</div>` : ''}
      <div class="notif-body-time">${timeAgo}</div>
    </div>
  </div>`;
}

function notifTimeAgo(isoString) {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60)   return 'たった今';
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  return `${Math.floor(diff / 86400)}日前`;
}

/* ────────────────────────────────
   音声ファジーマッチ
   allFiles のファイル名・タグ名をひらがな化して照合し、
   最も近い実在ワードに補正する。
   ──────────────────────────────── */

/**
 * 文字列をひらがな読み候補に変換する（複数パターン生成）
 * カタカナ→ひらがな、英字→辞書変換、大文字→小文字
 */
function toReadingVariants(str) {
  const variants = new Set();
  const base = str.trim();
  variants.add(base.toLowerCase());

  // カタカナ → ひらがな
  const hira = katakanaToHiragana(base);
  variants.add(hira.toLowerCase());

  // 英語辞書変換 → ひらがな
  let mapped = base;
  for (const [re, kata] of EN_KANA_MAP) {
    mapped = mapped.replace(re, kata);
  }
  if (mapped !== base) {
    variants.add(katakanaToHiragana(mapped).toLowerCase());
  }

  // 英字だけなら読みも追加（ファイル名の拡張子なし部分）
  const noExt = base.replace(/\.[^.]+$/, '');
  if (noExt !== base) {
    variants.add(noExt.toLowerCase());
    variants.add(katakanaToHiragana(noExt).toLowerCase());
  }

  return [...variants].filter(v => v.length >= 2);
}

/**
 * 2文字列間の編集距離（Levenshtein）
 * 短い文字列同士のみ使用（コスト管理のため15文字以下）
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length > 15 || b.length > 15) return 999;
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[a.length][b.length];
}

/**
 * 音声認識テキスト（ひらがな化済み）と候補ワードのスコアを計算。
 * 0〜100 で返す（高いほど類似）。
 */
function voiceSimilarityScore(query, candidate) {
  const q = katakanaToHiragana(query).toLowerCase();

  for (const v of toReadingVariants(candidate)) {
    // 完全一致
    if (q === v) return 100;
    // 部分一致（クエリがvに含まれる、またはvがクエリに含まれる）
    if (v.includes(q) || q.includes(v)) {
      const ratio = Math.min(q.length, v.length) / Math.max(q.length, v.length);
      if (ratio >= 0.6) return Math.round(80 * ratio);
    }
    // 編集距離
    const dist = levenshtein(q, v);
    const maxLen = Math.max(q.length, v.length);
    if (maxLen > 0) {
      const sim = 1 - dist / maxLen;
      if (sim >= 0.6) return Math.round(75 * sim);
    }
  }
  return 0;
}

/**
 * 音声入力クエリを allFiles のファイル名・タグ名と照合して補正する。
 * 最高スコア 60 以上かつ元クエリと異なる場合のみ補正テキストを返す。
 * 補正不要なら null を返す。
 */
function fuzzyCorrectVoiceQuery(raw) {
  if (!allFiles.length) return null;

  const normalized = normalizeVoiceQuery(raw);

  // 候補ワードを収集（ファイル名のワード分割 + タグ名）
  const candidates = new Map(); // originalText → display用
  for (const f of allFiles) {
    if (f.file_name) {
      const noExt = f.file_name.replace(/\.[^.]+$/, '');
      // スペース・アンダースコア・ハイフンで分割して個別ワードも候補に
      const words = noExt.split(/[\s_\-\.]+/).filter(w => w.length >= 2);
      candidates.set(noExt, noExt);
      for (const w of words) candidates.set(w, w);
    }
    for (const t of (f.tags || [])) {
      if (t.name && t.name.length >= 2) candidates.set(t.name, t.name);
    }
  }

  // 後処理辞書（音声認識の典型誤変換）を先に試す
  const corrected = VOICE_CORRECTION_DICT[katakanaToHiragana(normalized).toLowerCase()]
    ?? VOICE_CORRECTION_DICT[normalized.toLowerCase()];
  if (corrected) return corrected;

  // スコアリング
  let bestScore = 0;
  let bestCandidate = null;
  for (const [cand] of candidates) {
    const score = voiceSimilarityScore(normalized, cand);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = cand;
    }
  }

  // 60点以上 かつ 元クエリと異なる場合のみ補正
  if (bestScore >= 60 && bestCandidate && bestCandidate !== normalized) {
    return bestCandidate;
  }
  return null;
}

/* ────────────────────────────────
   音声入力の正規化
   ──────────────────────────────── */
function normalizeVoiceQuery(str) {
  return str
    // 読み上げ語を記号に変換
    .replace(/アンダーバー/g, '_')
    .replace(/アンダースコア/g, '_')
    .replace(/ハイフン/g,      '-')
    .replace(/マイナス/g,      '-')
    .replace(/スラッシュ/g,    '/')
    .replace(/ドット/g,        '.')
    .replace(/てん/g,          '.')
    .replace(/スペース/g,      ' ')
    // 全角英数字 → 半角
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    // 全角記号
    .replace(/＿/g, '_')
    .replace(/－/g, '-')
    // ファイル名検索用：記号をそのまま残しつつ余分な空白を除去
    .replace(/\s+/g, ' ')
    .trim();
}

/* ────────────────────────────────
   カタカナ→ひらがな変換（検索クエリ用）
   ──────────────────────────────── */
function katakanaToHiragana(str) {
  return str.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/* ────────────────────────────────
   英語カタカナ読み変換テーブル
   音声入力「アフェクト」→ファイル名「AFFECT」をヒットさせるために
   英単語→カタカナ読みを補完する。
   ──────────────────────────────── */
const EN_KANA_MAP = [
  // よく使われる英語→カタカナ読みの対応
  [/\baffect(s|ed|ing|ion)?\b/gi, 'アフェクト'],
  [/\banalysis\b/gi,   'アナリシス'],
  [/\bassembly\b/gi,   'アッセンブリ'],
  [/\bcheck(s|ed|ing)?\b/gi, 'チェック'],
  [/\bcontrol(s|led|ling)?\b/gi, 'コントロール'],
  [/\bdata\b/gi,       'データ'],
  [/\bdesign(s|ed|ing)?\b/gi, 'デザイン'],
  [/\bdrawing(s)?\b/gi, 'ドローイング'],
  [/\bfile(s)?\b/gi,   'ファイル'],
  [/\bfinal\b/gi,      'ファイナル'],
  [/\binspection\b/gi, 'インスペクション'],
  [/\bmanual(s)?\b/gi, 'マニュアル'],
  [/\bmodel(s|ed|ing)?\b/gi, 'モデル'],
  [/\bnew\b/gi,        'ニュー'],
  [/\bpart(s)?\b/gi,   'パーツ'],
  [/\bplan(s|ned|ning)?\b/gi, 'プラン'],
  [/\bprocess\b/gi,    'プロセス'],
  [/\bproduct(s|ion)?\b/gi, 'プロダクト'],
  [/\bproject(s)?\b/gi, 'プロジェクト'],
  [/\breport(s|ed|ing)?\b/gi, 'レポート'],
  [/\brev(ision)?\b/gi, 'リビジョン'],
  [/\breview(s|ed|ing)?\b/gi, 'レビュー'],
  [/\bsample(s)?\b/gi, 'サンプル'],
  [/\bsheet(s)?\b/gi,  'シート'],
  [/\bspec(s|ification)?\b/gi, 'スペック'],
  [/\bstandard(s)?\b/gi, 'スタンダード'],
  [/\btest(s|ed|ing)?\b/gi, 'テスト'],
  [/\btype(s)?\b/gi,   'タイプ'],
  [/\bversion\b/gi,    'バージョン'],
  // ブランド・サービス名
  [/\bhalspace\b/gi,   'ハルスペース'],
  [/\bsolid\b/gi,      'ソリッド'],
  [/\bmeetlog\b/gi,    'ミートログ'],
];

/* ────────────────────────────────
   後処理辞書（ひらがなキー → 正しいテキスト）
   音声認識の典型的な誤変換パターンを強制的に補正する。
   キーはひらがな小文字、値は表示・検索に使う正しい表記。
   ──────────────────────────────── */
const VOICE_CORRECTION_DICT = {
  // HaLSpace ブランド
  'はるすぺーす':       'HaLSpace',
  'はるすペース':       'HaLSpace',
  '春スペース':         'HaLSpace',
  '晴れスペース':       'HaLSpace',
  'ハルスペース':       'HaLSpace',
  // CADファイル形式
  'でぃーえっくすえふ': 'DXF',
  'でぃーえくすえふ':   'DXF',
  'えすてぃーえる':     'STL',
  'えすてぃーぴー':     'STP',
  'すてっぷ':           'STEP',
  'えすてっぷ':         'STEP',
  'おーびーじぇー':     'OBJ',
  'いーじぇす':         'IGES',
  'ぴーでぃーえふ':     'PDF',
  'えくせる':           'Excel',
  'えくすえる':         'Excel',
  'えくせるる':         'Excel',
  'かど':               'CAD',
  'きゃど':             'CAD',
  'びーおーえむ':       'BOM',
  // 製造業用語
  'ようせつ':           '溶接',
  'とそう':             '塗装',
  'くみたて':           '組立',
  'かこう':             '加工',
  'けんさ':             '検査',
  'しゅっか':           '出荷',
  'ぷろじぇくと':       'プロジェクト',
  'しようしょ':         '仕様書',
  'てじゅんしょ':       '手順書',
  'けんさひょう':       '検査表',
  'みつもり':           '見積',
  'ほうこくしょ':       '報告書',
  'ずめん':             '図面',
  // その他よくある誤変換
  'ばーじょん':         'バージョン',
  'りびじょん':         'リビジョン',
  'さいしんばん':       '最新版',
  'はいばん':           '廃版',
};

/**
 * 検索クエリを読みがなに変換する。
 * ・カタカナ → ひらがな（「ハルスペース」→「はるすぺーす」）
 * ・辞書登録済み英単語 → ひらがな（「AFFECT」→「あふぇくと」）
 * ・辞書にない英語はそのまま返す → バックエンドの file_name LIKE 検索でカバー
 */
function toHiraganaQuery(str) {
  // カタカナ → ひらがな
  const hira = katakanaToHiragana(str);
  if (hira !== str) return hira;

  if (/[A-Za-z]/.test(str)) {
    // 静的辞書で変換（製造業用語のみ）
    let mapped = str;
    for (const [re, kata] of EN_KANA_MAP) {
      mapped = mapped.replace(re, kata);
    }
    if (mapped !== str) {
      return katakanaToHiragana(mapped);
    }
    // 辞書にない英語: そのまま返して file_name の LIKE にヒットさせる
    return str.toLowerCase();
  }

  return null;
}

/* ────────────────────────────────
   HTML エスケープ
   ──────────────────────────────── */
function h(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ────────────────────────────────
   メール送信モーダル
   ──────────────────────────────── */
let emailModalFileId   = null;
let emailModalFileName = '';
let emailChips         = [];  // { email: string }[]

function initEmailModal() {
  const overlay   = document.getElementById('emailModal');
  const closeBtn  = document.getElementById('emailModalClose');
  const cancelBtn = document.getElementById('emailCancelBtn');
  const addBtn    = document.getElementById('emailAddBtn');
  const input     = document.getElementById('emailInput');
  const msgArea   = document.getElementById('emailMessage');
  const msgCount  = document.getElementById('emailMsgCount');

  closeBtn.addEventListener('click',  closeEmailModal);
  cancelBtn.addEventListener('click', closeEmailModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeEmailModal();
  });

  addBtn.addEventListener('click', addEmailChip);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addEmailChip(); }
  });

  msgArea.addEventListener('input', () => {
    msgCount.textContent = msgArea.value.length;
    if (msgArea.value.length > 500) {
      msgArea.value = msgArea.value.slice(0, 500);
      msgCount.textContent = 500;
    }
  });

  document.getElementById('emailMailtoBtn').addEventListener('click', doSendEmailMailto);
  document.getElementById('emailGmailBtn').addEventListener('click', doSendEmailGmail);
}

function openEmailModal(fileId, fileName) {
  emailModalFileId   = fileId;
  emailModalFileName = fileName;
  emailChips         = [];

  document.getElementById('emailModalFileNameText').textContent = fileName;
  document.getElementById('emailInput').value    = '';
  document.getElementById('emailMessage').value  = '';
  document.getElementById('emailMsgCount').textContent = '0';
  document.getElementById('emailInputError').style.display = 'none';
  renderEmailChips();
  updateEmailSendBtn();

  document.getElementById('emailModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('emailInput').focus(), 100);
}

function closeEmailModal() {
  document.getElementById('emailModal').classList.add('hidden');
  emailModalFileId = null;
  emailChips       = [];
}

function addEmailChip() {
  const input = document.getElementById('emailInput');
  const val   = input.value.trim().replace(/,$/, '');
  if (!val) return;

  const errEl   = document.getElementById('emailInputError');
  const errText = document.getElementById('emailInputErrorText');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
    errText.textContent = '有効なメールアドレスを入力してください';
    errEl.style.display = 'flex';
    return;
  }
  if (emailChips.some(c => c.email === val)) {
    errText.textContent = 'すでに追加済みです';
    errEl.style.display = 'flex';
    return;
  }
  if (emailChips.length >= 10) {
    errText.textContent = '送信先は最大10件です';
    errEl.style.display = 'flex';
    return;
  }

  errEl.style.display = 'none';
  emailChips.push({ email: val });
  input.value = '';
  renderEmailChips();
  updateEmailSendBtn();
  input.focus();
}

function removeEmailChip(email) {
  emailChips = emailChips.filter(c => c.email !== email);
  renderEmailChips();
  updateEmailSendBtn();
}

function renderEmailChips() {
  const list = document.getElementById('emailChipList');
  list.innerHTML = emailChips.map(c => `
    <span style="display:inline-flex;align-items:center;gap:5px;background:rgba(33,150,243,.12);
      color:#1565C0;padding:3px 10px 3px 12px;border-radius:20px;font-size:12px;font-weight:600;">
      ${h(c.email)}
      <button onclick="removeEmailChip('${h(c.email)}')"
        style="background:none;border:none;cursor:pointer;color:#1565C0;font-size:12px;padding:0;line-height:1;display:flex;align-items:center;">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </span>
  `).join('');
}

function updateEmailSendBtn() {
  // 送信ボタンは常時有効（mailto・Gmailとも宛先が空でも操作可）
}

function setEmailBtnsLoading(loading) {
  ['emailMailtoBtn', 'emailGmailBtn'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.disabled = loading;
  });
}

/* 共有リンクを発行し、メールの宛先・件名・本文を組み立てて返す（失敗時 null） */
async function buildEmailShare() {
  if (!emailModalFileId) return null;

  // 入力欄に未確定のアドレスが残っていれば取り込む
  const inputEl = document.getElementById('emailInput');
  const pending = inputEl.value.trim().replace(/,$/, '');
  if (pending && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pending) && !emailChips.some(c => c.email === pending)) {
    emailChips.push({ email: pending });
    inputEl.value = '';
    renderEmailChips();
  }

  // ログイン不要の共有リンクを発行（有効期限30日）
  const share = await wnCreateShare(emailModalFileId, { expiresDays: 30 });
  if (!share || !share.url) {
    wnShowToast('共有リンクの発行に失敗しました', 'danger');
    return null;
  }

  const message = document.getElementById('emailMessage').value.trim();
  const subject = `【What'sNo】${emailModalFileName} を共有します`;
  const lines = [];
  if (message) { lines.push(message, ''); }
  lines.push('▼ ファイルはこちらからご確認ください');
  lines.push(share.url);
  lines.push('');
  lines.push('※ リンクからダウンロードできます（有効期限：発行から30日）');
  const body = lines.join('\r\n');
  const to   = emailChips.map(c => c.email).join(',');

  return { to, subject, body };
}

/* Gmail の作成画面を新しいタブで開く（既定メーラー不要） */
async function doSendEmailGmail() {
  // ポップアップブロック回避のため、クリック直後に同期的に空タブを開いておく
  const win = window.open('about:blank', '_blank');
  setEmailBtnsLoading(true);
  try {
    const m = await buildEmailShare();
    if (!m) { if (win) win.close(); return; }
    const url = 'https://mail.google.com/mail/?view=cm&fs=1'
      + `&to=${encodeURIComponent(m.to)}`
      + `&su=${encodeURIComponent(m.subject)}`
      + `&body=${encodeURIComponent(m.body)}`;
    if (win) { win.location.href = url; } else { window.open(url, '_blank'); }
    wnShowToast('Gmailの作成画面を開きました', 'success');
    closeEmailModal();
  } catch (err) {
    if (win) win.close();
    wnShowToast(err.message || 'メールの作成に失敗しました', 'danger');
  } finally {
    setEmailBtnsLoading(false);
  }
}

/* 既定のメールアプリ（Outlook等）を mailto で起動 */
async function doSendEmailMailto() {
  setEmailBtnsLoading(true);
  try {
    const m = await buildEmailShare();
    if (!m) return;
    const url = `mailto:${m.to}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
    window.location.href = url;
    wnShowToast('メールアプリを起動しました', 'success');
    closeEmailModal();
  } catch (err) {
    wnShowToast(err.message || 'メールの作成に失敗しました', 'danger');
  } finally {
    setEmailBtnsLoading(false);
  }
}
