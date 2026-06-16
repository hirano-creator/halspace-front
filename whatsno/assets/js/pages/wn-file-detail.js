'use strict';
/* What'sNo ファイル詳細ページ */

let currentUser = null;
let fileData    = null;
const fileId    = new URLSearchParams(location.search).get('id');

/* ── PDF プレビュー回転状態 ── */
let pdfPreviewDoc  = null;
let pdfPreviewPage = 1;
let pdfPreviewRot  = 0;   // ビューア側追加回転: 0 | 90 | 180 | 270
let pdfViewMode    = 'single';  // 'single' | 'grid'
let pdfGridRendered = false;    // グリッド描画済みフラグ（回転時に無効化）

/* ── ズーム状態 ── */
let pdfZoomFactor    = 1.0;
let pdfBaseCssW      = 0;
let pdfBaseCssH      = 0;
let imgZoomFactor    = 1.0;
let imgPanX          = 0;   // 画像ドラッグ移動オフセット(px)
let imgPanY          = 0;
let pdfPanX          = 0;   // PDFドラッグ移動オフセット(px)
let pdfPanY          = 0;
let officeZoomFactor = 1.0; // Excel/Word (クライアント側レンダリング) ズーム倍率

/* ── Ctrl+ホイール：ブラウザズーム防止＋in-appズームを一本化 ── */
window.addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();                 // ブラウザズームを常時ブロック

  const pdfContainer  = document.getElementById('pdfContainer');
  const previewArea   = document.getElementById('previewArea');
  const factor        = e.deltaY < 0 ? 1.1 : 0.9;

  /* PDF ズーム */
  if (pdfContainer && pdfContainer.style.display !== 'none' && pdfContainer.contains(e.target)) {
    pdfZoomFactor = Math.max(0.25, Math.min(4.0, pdfZoomFactor * factor));
    if (pdfZoomFactor <= 1.0) { pdfPanX = 0; pdfPanY = 0; }
    const canvas = document.getElementById('pdfCanvas');
    if (canvas && pdfBaseCssW) {
      applyPdfTransform(canvas);
      showPreviewZoomLabel(Math.round(pdfZoomFactor * 100) + '%');
      updatePdfPanCursor();
    }
    return;
  }

  /* 画像ズーム */
  if (previewArea) {
    const img = previewArea.querySelector('img');
    if (img) {
      imgZoomFactor = Math.max(0.25, Math.min(4.0, imgZoomFactor * factor));
      if (imgZoomFactor <= 1.0) { imgPanX = 0; imgPanY = 0; }  // 等倍以下は再センタリング
      img.style.transformOrigin = 'center center';
      img.style.cursor          = imgZoomFactor > 1.0 ? 'grab' : '';
      applyImgTransform(img);
      showPreviewZoomLabel(Math.round(imgZoomFactor * 100) + '%');
      return;
    }
  }

  /* Excel/Word クライアント側レンダリングズーム (officeContainer が表示中) */
  const officeContainer = document.getElementById('officeContainer');
  if (officeContainer && officeContainer.style.display !== 'none') {
    officeZoomFactor = Math.max(0.25, Math.min(4.0, officeZoomFactor * factor));
    officeContainer.style.zoom = officeZoomFactor;
    showPreviewZoomLabel(Math.round(officeZoomFactor * 100) + '%');
  }
}, { passive: false, capture: true });

/* 画像の transform（移動＋拡大）を適用 */
function applyImgTransform(img) {
  img.style.transform = `translate(${imgPanX}px, ${imgPanY}px) scale(${imgZoomFactor})`;
}

/* PDF の transform（移動＋拡大）を適用（クランプ込み） */
function applyPdfTransform(canvas) {
  clampPdfPan();
  canvas.style.transform       = `translate(${pdfPanX}px, ${pdfPanY}px) scale(${pdfZoomFactor})`;
  canvas.style.transformOrigin = 'center center';
}

/* PDFのパン移動量をコンテナ内に制限 */
function clampPdfPan() {
  const c = document.getElementById('pdfContainer');
  if (!c || !pdfBaseCssW) return;
  const maxX = Math.max(0, (pdfBaseCssW * pdfZoomFactor - c.clientWidth)  / 2);
  const maxY = Math.max(0, (pdfBaseCssH * pdfZoomFactor - c.clientHeight) / 2);
  pdfPanX = Math.max(-maxX, Math.min(maxX, pdfPanX));
  pdfPanY = Math.max(-maxY, Math.min(maxY, pdfPanY));
}

/* PDFがパン可能なら grab カーソルに */
function updatePdfPanCursor() {
  const c = document.getElementById('pdfContainer');
  if (!c) return;
  const pannable = pdfBaseCssW * pdfZoomFactor > c.clientWidth ||
                   pdfBaseCssH * pdfZoomFactor > c.clientHeight;
  c.style.cursor = pannable ? 'grab' : '';
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!fileId) { location.href = 'dashboard.html'; return; }
  currentUser = requireSpaceAuth();
  if (!currentUser) return;
  applyMobileCommentPosition();
  window.addEventListener('resize', applyMobileCommentPosition);
  await loadFile();
  initActions();
  initComments();
  initTags();
  initQrModal();
  initRejectModal();
  initViewers();
  initShareModal();
  initConvert();
  initBottomNav();
  initRightPanelTabs();
  initRelations();
  initEmailModal();
});

/* モバイル時、コメントパネル(.detail-right)を .detail-info-section の前に
   移動する（PCに戻ったら元の位置に戻す） */
function applyMobileCommentPosition() {
  const isMobile     = window.innerWidth <= 768;
  const detailRight  = document.querySelector('.detail-right');
  const detailLeft   = document.querySelector('.detail-left');
  const detailBody   = document.querySelector('.detail-body');
  const infoSection  = document.querySelector('.detail-info-section');
  if (!detailRight || !detailLeft || !detailBody || !infoSection) return;

  const movedToLeft = detailRight.parentElement === detailLeft;
  if (isMobile && !movedToLeft) {
    detailLeft.insertBefore(detailRight, infoSection);
  } else if (!isMobile && movedToLeft) {
    detailBody.appendChild(detailRight);
  }
}

/* ────────────────────────────────
   ファイルデータ取得・描画
   ──────────────────────────────── */
async function loadFile() {
  fileData = await wnGetFile(fileId);
  if (!fileData) {
    wnShowToast('ファイルが見つかりません', 'danger');
    setTimeout(() => location.href = 'dashboard.html', 1500);
    return;
  }
  renderAll();
}

function renderAll() {
  renderHeader();
  renderActionBar();
  renderApproval();
  renderPreview();
  renderInfo();
  renderAiDescription();
  renderTags();
  renderVersions();
  loadComments();
  loadSimilarFiles();
}

function renderHeader() {
  document.title = `${fileData.file_name} | What'sNo`;
  document.getElementById('topFileName').textContent = fileData.file_name;
  initRename();
}

function initRename() {
  const label = document.getElementById('topFileName');
  const input = document.getElementById('topFileNameInput');
  if (!label || !input || label.dataset.renameInit) return;
  label.dataset.renameInit = '1';

  const enterEdit = () => {
    input.value = fileData.file_name;
    label.style.display = 'none';
    input.style.display = '';
    input.focus();
    input.select();
  };

  const commitEdit = async () => {
    const newName = input.value.trim();
    input.style.display = 'none';
    label.style.display = '';
    if (!newName || newName === fileData.file_name) return;

    const data = await wnRenameFile(fileId, newName);
    if (data) {
      fileData = { ...fileData, ...data };
      document.title = `${fileData.file_name} | What'sNo`;
      label.textContent = fileData.file_name;
      wnShowToast('ファイル名を変更しました', 'success');
    } else {
      wnShowToast('ファイル名の変更に失敗しました', 'danger');
    }
  };

  label.addEventListener('click', enterEdit);
  input.addEventListener('blur', commitEdit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = fileData.file_name; input.blur(); }
  });
}

function renderActionBar() {
  if (fileData.version > 1) {
    const vBadge = document.getElementById('fileVersionBadge');
    vBadge.textContent = `v${fileData.version}`;
    vBadge.style.display = '';
  }
  const likeBtn = document.getElementById('likeBtn');
  likeBtn.classList.toggle('liked', !!fileData.liked);
  likeBtn.querySelector('i').className = `fa-${fileData.liked ? 'solid' : 'regular'} fa-heart`;
  document.getElementById('likeCount').textContent = fileData.like_count ?? 0;
}

/* ────────────────────────────────
   承認ワークフロー
   ──────────────────────────────── */
function renderApproval() {
  const status  = fileData.approval_status ?? 'none';
  const badge   = wnApprovalBadge(status);
  const isOwner = currentUser && fileData.uploader && fileData.uploader.id === currentUser.id;
  const isAdmin = currentUser && ['jp_admin','super_admin'].includes(currentUser.role);

  // アクションバーのバッジ
  const badgeEl = document.getElementById('approvalBadge');
  if (status !== 'none') {
    badgeEl.innerHTML = `<span style="font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px;
      color:${badge.color};background:${badge.bg};">
      ${badge.label}
    </span>`;
  } else {
    badgeEl.innerHTML = '';
  }

  // アクションバーのボタン
  const actionsEl = document.getElementById('approvalActions');
  let btns = '';
  if (status === 'none' || status === 'rejected') {
    if (isOwner || isAdmin) {
      btns = `<button class="btn btn-outline btn-sm" id="submitApprovalBtn" style="color:#F57C00;border-color:#F57C00;">
        <i class="fa-solid fa-paper-plane"></i> 承認申請
      </button>`;
    }
  } else if (status === 'pending') {
    if (isAdmin) {
      btns = `
        <button class="btn btn-sm" id="approveBtn" style="background:#2E7D32;color:#fff;">
          <i class="fa-solid fa-check"></i> 承認
        </button>
        <button class="btn btn-outline btn-sm" id="rejectBtn" style="color:#C62828;border-color:#C62828;">
          <i class="fa-solid fa-rotate-left"></i> 差し戻し
        </button>`;
    }
    if (isOwner) {
      btns += `<button class="btn btn-ghost btn-sm" id="cancelApprovalBtn">
        <i class="fa-solid fa-xmark"></i> 申請取消
      </button>`;
    }
  } else if (status === 'approved') {
    if (isAdmin) {
      btns = `<button class="btn btn-ghost btn-sm" id="cancelApprovalBtn">
        <i class="fa-solid fa-xmark"></i> 承認取消
      </button>`;
    }
  }
  actionsEl.innerHTML = btns;

  // イベント登録
  document.getElementById('submitApprovalBtn')?.addEventListener('click', async () => {
    const data = await wnSubmitApproval(fileId);
    if (data) { fileData = { ...fileData, ...data }; renderApproval(); wnShowToast('承認を申請しました', 'success'); }
    else wnShowToast('申請に失敗しました', 'danger');
  });

  document.getElementById('approveBtn')?.addEventListener('click', async () => {
    if (!confirm('このファイルを承認しますか？')) return;
    const data = await wnApprove(fileId);
    if (data) { fileData = { ...fileData, ...data }; renderApproval(); wnShowToast('承認しました', 'success'); }
    else wnShowToast('承認に失敗しました', 'danger');
  });

  document.getElementById('rejectBtn')?.addEventListener('click', () => {
    document.getElementById('rejectComment').value = '';
    document.getElementById('rejectModal').classList.remove('hidden');
  });

  document.getElementById('cancelApprovalBtn')?.addEventListener('click', async () => {
    if (!confirm('承認申請を取り消しますか？')) return;
    const data = await wnCancelApproval(fileId);
    if (data) { fileData = { ...fileData, ...data }; renderApproval(); wnShowToast('申請を取り消しました', 'info'); }
    else wnShowToast('操作に失敗しました', 'danger');
  });

  // 承認ワークフローカード（サイドカード）
  const cardBody = document.getElementById('approvalCardBody');
  const statusLabels = { none: '未申請', pending: '承認申請中', approved: '承認済み', rejected: '差し戻し' };
  let cardHtml = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
    <span style="font-size:13px;font-weight:700;padding:4px 12px;border-radius:20px;
      color:${badge.color};background:${badge.bg};">${badge.label}</span>
  </div>`;

  if (status === 'approved' || status === 'rejected') {
    cardHtml += `<div style="font-size:12px;color:var(--muted);line-height:1.8;">
      <div>処理日時: ${fileData.approved_at ? new Date(fileData.approved_at).toLocaleString('ja-JP') : '—'}</div>
    </div>`;
  }
  if (fileData.approval_comment) {
    cardHtml += `<div style="margin-top:8px;padding:8px 10px;background:${badge.bg};border-radius:6px;
      font-size:12px;color:${badge.color};line-height:1.6;">
      <i class="fa-solid fa-comment-dots"></i> ${h(fileData.approval_comment)}
    </div>`;
  }
  if (status === 'none') {
    cardHtml += `<p style="font-size:12px;color:var(--muted);">承認申請すると、管理者が承認・差し戻しできるようになります。</p>`;
  }
  cardBody.innerHTML = cardHtml;
}

/* 差し戻しモーダル初期化 */
function initRejectModal() {
  document.getElementById('rejectModalClose').addEventListener('click', () => {
    document.getElementById('rejectModal').classList.add('hidden');
  });
  document.getElementById('rejectCancelBtn').addEventListener('click', () => {
    document.getElementById('rejectModal').classList.add('hidden');
  });
  document.getElementById('rejectSubmitBtn').addEventListener('click', async () => {
    const comment = document.getElementById('rejectComment').value.trim();
    const btn = document.getElementById('rejectSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 処理中…';
    const data = await wnReject(fileId, comment);
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> 差し戻す';
    document.getElementById('rejectModal').classList.add('hidden');
    if (data) { fileData = { ...fileData, ...data }; renderApproval(); wnShowToast('差し戻しました', 'info'); }
    else wnShowToast('差し戻しに失敗しました', 'danger');
  });
}

function renderPreview() {
  const { icon, cls } = wnFileIcon(fileData.file_name, fileData.mime_type);
  document.getElementById('previewIcon').className = `fa-solid ${icon} ${cls}`;

  const ext  = fileData.file_name.split('.').pop().toLowerCase();
  const mime = fileData.mime_type ?? '';
  console.log('[renderPreview] fileId=' + fileId, 'name=' + fileData.file_name, 'ext=' + ext, 'mime=' + mime, 'size=' + fileData.file_size);

  const showImg = (src) => {
    const img = document.createElement('img');
    img.src = src;
    img.onload = () => {
      document.getElementById('previewPlaceholder').style.display = 'none';
      document.getElementById('previewArea').appendChild(img);
      initImgWheelZoom(img);
    };
    img.onerror = () => { document.getElementById('previewHint').textContent = 'プレビューを読み込めませんでした'; };
  };

  /* ファイル種別判定: 拡張子を最優先。DB の mime_type が誤登録されているケースに耐える */
  if (ext === 'pdf' || mime === 'application/pdf') {
    document.getElementById('previewHint').textContent = 'PDF読み込み中…';
    loadPdfPreview(1);
  } else if (['heic', 'heif'].includes(ext) || mime === 'image/heic' || mime === 'image/heif') {
    document.getElementById('previewHint').textContent = 'HEICを変換中…';
    (async () => {
      try {
        if (typeof heic2any === 'undefined') throw new Error('heic2any未読み込み');
        /* キャッシュに変換済み JPEG があれば即表示 */
        const cached = await (window.WnPreviewCache?.get(fileId, fileData.updated_at) ?? null);
        if (cached) {
          showImg(URL.createObjectURL(cached));
          return;
        }
        const buffer = await wnFetchFileBuffer(fileId);
        if (!buffer) throw new Error('ファイル取得失敗');
        let blob = await heic2any({ blob: new Blob([buffer], { type: 'image/heic' }), toType: 'image/jpeg', quality: 0.85 });
        if (Array.isArray(blob)) blob = blob[0];
        /* 変換済み JPEG をキャッシュ保存（次回は変換不要） */
        window.WnPreviewCache?.set(fileId, fileData.updated_at, blob).catch(() => {});
        showImg(URL.createObjectURL(blob));
      } catch(e) {
        console.error('HEIC preview error:', e);
        document.getElementById('previewHint').textContent = 'HEICのプレビューに失敗しました: ' + e.message;
      }
    })();
  } else if (['png','jpg','jpeg','gif','webp','svg'].includes(ext) || mime.startsWith('image/')) {
    document.getElementById('previewHint').textContent = 'プレビュー読み込み中…';
    showImg(wnPublicViewUrl(fileId));
  } else if (mime.startsWith('video/') || ['mp4','mov','avi'].includes(ext)) {
    document.getElementById('previewHint').textContent = '';
    wnGetViewUrl(fileId).then(url => {
      if (!url) { document.getElementById('previewHint').textContent = 'プレビューを読み込めませんでした'; return; }
      const video = document.createElement('video');
      video.src = url;
      video.controls = true;
      video.style.cssText = 'width:100%;height:100%;object-fit:contain;';
      document.getElementById('previewPlaceholder').parentElement.appendChild(video);
      document.getElementById('previewPlaceholder').style.display = 'none';
    });
  } else if (['pptx','ppt','pptm'].includes(ext)) {
    /* サーバー側で PDF に変換し、既存の PDF.js ビューアで表示 */
    document.getElementById('previewHint').textContent = 'スライドを変換中…';
    loadPdfPreview(1);
  } else if (wnIsOfficeFile(fileData.file_name)) {
    showOfficePreview();
  } else if (['dxf'].includes(ext)) {
    loadSheetEyeEmbed(fileId, fileData.file_name);
  } else {
    document.getElementById('previewHint').textContent = 'このファイル形式はブラウザプレビュー非対応です';
  }

  /* 注釈ボタン：PDF・画像のみ表示（PowerPointは対象外） */
  const annotatable = (ext === 'pdf' || mime === 'application/pdf'
    || mime.startsWith('image/') || ['png','jpg','jpeg','gif','webp','heic','heif','svg'].includes(ext))
    && !['pptx','ppt','pptm'].includes(ext);
  const annotBtn = document.getElementById('annotateBtn');
  if (annotBtn) annotBtn.style.display = annotatable ? '' : 'none';
}

/* ────────────────────────────────
   Office (Excel / Word) プレビュー
   - クライアント側で直接レンダリング（Microsoft Office Online Viewerに依存しない）
   - Excel(.xlsx/.xls/.xlsm): SheetJS で全シートをHTMLテーブル化
   - Word(.docx): mammoth.js でHTML化
   - PowerPoint / 旧 .doc: クライアント側レンダラー無し → ダウンロード導線を表示
   ──────────────────────────────── */
async function showOfficePreview() {
  const placeholder = document.getElementById('previewPlaceholder');
  const hint        = document.getElementById('previewHint');
  const container   = document.getElementById('officeContainer');
  const frame       = document.getElementById('previewFrame');
  const ext         = fileData.file_name.split('.').pop().toLowerCase();

  officeZoomFactor = 1.0;
  container.style.zoom = '';

  const showFallback = (title, desc) => {
    container.style.display = 'none';
    frame.style.display = 'none';
    placeholder.style.display = '';
    placeholder.innerHTML = `
      <i class="fa-solid fa-file-lines" id="previewIcon" style="font-size:48px;color:#888;"></i>
      <p style="margin:12px 0 4px;font-weight:600;">${title}</p>
      <p style="margin:0 0 16px;color:#666;font-size:13px;">${desc}</p>
      <button id="officeDownloadBtn" class="btn btn-primary" style="padding:8px 18px;">
        <i class="fa-solid fa-download"></i> ダウンロードして開く
      </button>
    `;
    document.getElementById('officeDownloadBtn')?.addEventListener('click', () => wnDownload(fileId));
  };

  /* 本番環境 + Excel: Microsoft Office Online Viewer を iframe で埋め込み
     Word (.docx/.docm) は mammoth.js レンダリングを使う（Ctrl+ホイールズームのため） */
  const officeUrl = wnOfficeViewerUrl(fileId);
  if (officeUrl && ['xlsx','xls','xlsm'].includes(ext)) {
    hint.textContent = 'Office Online 読み込み中…';
    placeholder.style.display = '';
    container.style.display = 'none';
    frame.src = officeUrl;
    frame.style.display = 'block';
    frame.onload = () => { placeholder.style.display = 'none'; };
    return;
  }

  /* Word / ローカル環境: クライアント側レンダリング (SheetJS / mammoth.js) */

  /* PowerPoint と旧 .doc はクライアント側で簡単に描画できないためダウンロード導線 */
  if (['pptx','ppt','pptm','doc'].includes(ext)) {
    showFallback(
      'ブラウザプレビュー非対応',
      'この形式はダウンロードしてご確認ください。',
    );
    return;
  }

  hint.textContent = 'Officeファイル読み込み中…';

  try {
    const buffer = await wnFetchFileBuffer(fileId, {
      onProgress: pct => { hint.textContent = `読み込み中… ${pct}%`; },
    });
    if (!buffer) throw new Error('ファイル取得失敗');

    if (['xlsx','xls','xlsm'].includes(ext)) {
      if (typeof XLSX === 'undefined') throw new Error('SheetJS未読み込み');
      hint.textContent = 'Excel描画中…';
      renderExcelToContainer(buffer, container);
    } else if (ext === 'docx' || ext === 'docm') {
      if (typeof mammoth === 'undefined') throw new Error('mammoth.js未読み込み');
      hint.textContent = 'Word描画中…';
      const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
      container.innerHTML = `<div class="docx-body" style="max-width:820px;margin:0 auto;line-height:1.7;color:#222;">${result.value}</div>`;
    } else {
      throw new Error('未対応の拡張子: ' + ext);
    }

    placeholder.style.display = 'none';
    container.style.display = 'block';
  } catch (e) {
    console.error('Office preview error:', e);
    showFallback('プレビューを読み込めませんでした', (e.message || 'エラーが発生しました') + ' — ダウンロードしてご確認ください。');
  }
}

/* Excelワークブックを全シートHTMLテーブルとしてcontainerへ描画 */
function renderExcelToContainer(arrayBuffer, container) {
  const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellStyles: true });
  const parts = [];
  /* SheetJS のインライン color / background は薄くなりがちなので !important で強制上書き。
     セルの実値の有無や結合セル等もできるだけ素直に表示。 */
  parts.push(`<style>
    .xlsx-sheet-tabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px;border-bottom:2px solid #1976d2;padding-bottom:0;}
    .xlsx-sheet-tab{padding:8px 16px;background:#f5f5f5;border:1px solid #ccc;border-bottom:none;border-radius:6px 6px 0 0;cursor:pointer;font-size:13px;color:#444;}
    .xlsx-sheet-tab:hover{background:#eaeaea;}
    .xlsx-sheet-tab.active{background:#1976d2;color:#fff;border-color:#1976d2;font-weight:600;}
    .xlsx-sheet{display:none;}
    .xlsx-sheet.active{display:block;}
    .xlsx-sheet table{border-collapse:collapse;font-size:13px;font-family:"Yu Gothic","Hiragino Sans","Meiryo",sans-serif;color:#111 !important;background:#fff;}
    .xlsx-sheet td,.xlsx-sheet th{
      border:1px solid #bbb !important;
      padding:6px 10px !important;
      color:#111 !important;
      background:#fff;
      vertical-align:middle;
      min-width:48px;
      white-space:nowrap;
    }
    .xlsx-sheet td:empty{background:#fafafa;}
    .xlsx-sheet tr:first-child td{background:#e3f2fd !important;font-weight:600;color:#0d47a1 !important;}
    /* SheetJS が出力する <html><body> ラッパーをブロック化 */
    .xlsx-sheet > html, .xlsx-sheet > body{display:block;}
  </style>`);
  parts.push('<div class="xlsx-sheet-tabs">');
  wb.SheetNames.forEach((name, i) => {
    parts.push(`<div class="xlsx-sheet-tab${i===0?' active':''}" data-idx="${i}">${escapeHtml(name)}</div>`);
  });
  parts.push('</div>');
  wb.SheetNames.forEach((name, i) => {
    const ws = wb.Sheets[name];
    /* header / footer を空にして <html><body> ラッパーを抑止 */
    let html = XLSX.utils.sheet_to_html(ws, { editable: false, header: '', footer: '' });
    /* 念のため <html>...<body>...</body></html> ラッパーを剥がす */
    html = html.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '');
    /* インライン color / background-color の薄色（#999, #ccc 等）を除去して !important を効かせる */
    html = html.replace(/\scolor\s*:\s*[^;"']+/gi, '');
    parts.push(`<div class="xlsx-sheet${i===0?' active':''}" data-idx="${i}" style="overflow:auto;max-width:100%;">${html}</div>`);
  });
  container.innerHTML = parts.join('');
  container.querySelectorAll('.xlsx-sheet-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const idx = tab.dataset.idx;
      container.querySelectorAll('.xlsx-sheet-tab').forEach(t => t.classList.toggle('active', t.dataset.idx === idx));
      container.querySelectorAll('.xlsx-sheet').forEach(s => s.classList.toggle('active', s.dataset.idx === idx));
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* PowerPoint: サーバー側で変換した PDF を ArrayBuffer で取得
   （表示は loadPdfPreview の PDF.js ビューアに合流） */
async function wnFetchPptxPdfBuffer(id) {
  const res = await wnFetch(`/wn/files/${id}/preview-pdf`);
  if (!res) throw new Error('認証エラー');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `スライド変換に失敗しました (HTTP ${res.status})`);
  }
  return await res.arrayBuffer();
}

/* PDF ページナビゲーション */
function renderPdfNav(pdfDoc, _page, canvas, ctx, area, currentPageNum) {
  /* 既存のナビがあれば削除 */
  document.getElementById('pdfNavBar')?.remove();

  const total = pdfDoc.numPages;
  const nav = document.createElement('div');
  nav.id = 'pdfNavBar';
  nav.style.cssText = `
    position:absolute; bottom:12px; left:50%; transform:translateX(-50%);
    background:rgba(0,0,0,.6); backdrop-filter:blur(4px);
    color:#fff; border-radius:20px; padding:5px 14px;
    display:flex; align-items:center; gap:10px; font-size:13px; z-index:10;
  `;
  nav.innerHTML = `
    <button id="pdfPrev" style="background:none;border:none;color:#fff;cursor:pointer;font-size:14px;padding:0 4px;">&#8249;</button>
    <span id="pdfPageLabel">${currentPageNum} / ${total}</span>
    <button id="pdfNext" style="background:none;border:none;color:#fff;cursor:pointer;font-size:14px;padding:0 4px;">&#8250;</button>
  `;
  document.getElementById('previewArea').appendChild(nav);

  async function goTo(n) {
    if (n < 1 || n > total) return;
    pdfPreviewPage = n;
    const pg = await pdfDoc.getPage(n);
    const areaW = area.clientWidth  - 24;
    const areaH = area.clientHeight - 24;
    const dpr   = Math.max(window.devicePixelRatio || 1, 2);
    const _defVP  = pg.getViewport({ scale: 1 });
    const _totRot = (_defVP.rotation + pdfPreviewRot) % 360;
    const baseVP  = pg.getViewport({ scale: 1, rotation: _totRot });
    const scale   = Math.min(areaW / baseVP.width, areaH / baseVP.height);
    const vp = pg.getViewport({ scale: scale * dpr, rotation: _totRot });
    canvas.width  = vp.width;
    canvas.height = vp.height;
    pdfBaseCssW = baseVP.width  * scale;
    pdfBaseCssH = baseVP.height * scale;
    pdfZoomFactor = 1.0; pdfPanX = 0; pdfPanY = 0;
    canvas.style.width  = pdfBaseCssW + 'px';
    canvas.style.height = pdfBaseCssH + 'px';
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    applyPdfTransform(canvas);
    updatePdfPanCursor();
    document.getElementById('pdfPageLabel').textContent = `${n} / ${total}`;
  }

  nav.querySelector('#pdfPrev').addEventListener('click', () => goTo(pdfPreviewPage - 1));
  nav.querySelector('#pdfNext').addEventListener('click', () => goTo(pdfPreviewPage + 1));
}

/* ────────────────────────────────
   PDF グリッド表示（全ページ一覧）
   ──────────────────────────────── */

/* 単ページ⇔グリッドの表示切り替え */
async function setPdfViewMode(mode) {
  pdfViewMode = mode;
  const single = document.getElementById('pdfContainer');
  const nav    = document.getElementById('pdfNavBar');
  const toggle = document.getElementById('pdfViewToggle');

  if (mode === 'grid') {
    await renderPdfGrid();
    single.style.display = 'none';
    if (nav) nav.style.display = 'none';
    document.getElementById('pdfGridContainer').style.display = 'block';
    if (toggle) {
      toggle.innerHTML = '<i class="fa-regular fa-square"></i>';
      toggle.title = '単ページ表示に戻る';
    }
  } else {
    const grid = document.getElementById('pdfGridContainer');
    if (grid) grid.style.display = 'none';
    single.style.display = 'flex';
    if (nav) nav.style.display = 'flex';
    if (toggle) {
      toggle.innerHTML = '<i class="fa-solid fa-table-cells"></i>';
      toggle.title = '全ページを一覧表示';
    }
  }
}

/* 全ページをサムネイルサイズでグリッド描画（描画済みなら再利用） */
async function renderPdfGrid() {
  if (!pdfPreviewDoc) return;
  const area = document.getElementById('previewArea');

  let grid = document.getElementById('pdfGridContainer');
  if (!grid) {
    grid = document.createElement('div');
    grid.id = 'pdfGridContainer';
    grid.style.cssText =
      'display:none;width:100%;height:100%;overflow:auto;background:#525659;' +
      'padding:12px;box-sizing:border-box;';
    area.appendChild(grid);
  }
  if (pdfGridRendered) return;

  grid.innerHTML =
    '<div id="pdfGridInner" style="display:grid;' +
    'grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;"></div>';
  const inner = grid.querySelector('#pdfGridInner');
  const total = pdfPreviewDoc.numPages;

  /* セル幅相当の固定解像度で描画（縮小表示なので軽量。15ページ程度なら数MB） */
  const THUMB_RENDER_W = 480;

  for (let n = 1; n <= total; n++) {
    const cell = document.createElement('div');
    cell.style.cssText =
      'position:relative;cursor:pointer;background:#fff;border-radius:4px;' +
      'overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.4);transition:outline .1s;';
    cell.innerHTML =
      '<canvas style="display:block;width:100%;height:auto;"></canvas>' +
      `<span style="position:absolute;bottom:6px;right:8px;background:rgba(0,0,0,.6);` +
      `color:#fff;font-size:11px;border-radius:10px;padding:2px 8px;">p.${n}</span>`;
    cell.addEventListener('mouseenter', () => cell.style.outline = '3px solid #1976d2');
    cell.addEventListener('mouseleave', () => cell.style.outline = 'none');
    cell.addEventListener('click', async () => {
      pdfPreviewPage = n;
      await setPdfViewMode('single');
      await reRenderPdfPreviewPage();
      const label = document.getElementById('pdfPageLabel');
      if (label) label.textContent = `${n} / ${total}`;
    });
    inner.appendChild(cell);

    const page    = await pdfPreviewDoc.getPage(n);
    const _defVP  = page.getViewport({ scale: 1 });
    const _totRot = (_defVP.rotation + pdfPreviewRot) % 360;
    const baseVP  = page.getViewport({ scale: 1, rotation: _totRot });
    const scale   = THUMB_RENDER_W / baseVP.width;
    const vp      = page.getViewport({ scale, rotation: _totRot });
    const canvas  = cell.querySelector('canvas');
    canvas.width  = vp.width;
    canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  }
  pdfGridRendered = true;
}

/* PDF プレビューの現在ページを回転付きで再描画 */
async function reRenderPdfPreviewPage() {
  if (!pdfPreviewDoc) return;
  const page    = await pdfPreviewDoc.getPage(pdfPreviewPage);
  const canvas  = document.getElementById('pdfCanvas');
  const ctx     = canvas.getContext('2d');
  const area    = document.getElementById('previewArea');

  const dpr          = Math.max(window.devicePixelRatio || 1, 2);
  const _defVP       = page.getViewport({ scale: 1 });
  const _totRot      = (_defVP.rotation + pdfPreviewRot) % 360;
  const baseVP       = page.getViewport({ scale: 1, rotation: _totRot });
  const areaW        = Math.max(area.clientWidth  - 24, 100);
  const areaH        = Math.max(area.clientHeight - 24, 100);
  const fitScale     = Math.min(areaW / baseVP.width, areaH / baseVP.height);
  const MIN_SCALE    = 1.5;
  const MAX_DIM      = 4096;
  let   renderScale  = Math.max(fitScale * dpr, MIN_SCALE);
  if (Math.max(baseVP.width, baseVP.height) * renderScale > MAX_DIM) {
    renderScale = MAX_DIM / Math.max(baseVP.width, baseVP.height);
  }
  const viewport = page.getViewport({ scale: renderScale, rotation: _totRot });

  canvas.width  = viewport.width;
  canvas.height = viewport.height;
  pdfBaseCssW = baseVP.width  * fitScale;
  pdfBaseCssH = baseVP.height * fitScale;
  canvas.style.width  = pdfBaseCssW + 'px';
  canvas.style.height = pdfBaseCssH + 'px';

  await page.render({ canvasContext: ctx, viewport }).promise;
  applyPdfTransform(canvas);
}

/* PDF プレビューエリアに回転ボタンのオーバーレイを追加 */
function addPdfRotateOverlay() {
  document.getElementById('pdfRotateBar')?.remove();
  const bar = document.createElement('div');
  bar.id = 'pdfRotateBar';
  bar.style.cssText = [
    'position:absolute', 'top:12px', 'left:12px',
    'background:rgba(0,0,0,.55)', 'backdrop-filter:blur(4px)',
    'border-radius:20px', 'padding:3px 6px',
    'display:flex', 'align-items:center', 'gap:2px', 'z-index:10',
  ].join(';');

  const btnStyle = [
    'background:none', 'border:none', 'color:#fff', 'cursor:pointer',
    'font-size:15px', 'padding:4px 7px', 'border-radius:12px',
    'transition:background .15s',
  ].join(';');

  const multiPage = (pdfPreviewDoc?.numPages || 1) > 1;
  bar.innerHTML = `
    <button id="pdfRotCCW" title="左90°回転" style="${btnStyle}">
      <i class="fa-solid fa-rotate-left"></i>
    </button>
    <button id="pdfRotCW" title="右90°回転" style="${btnStyle}">
      <i class="fa-solid fa-rotate-right"></i>
    </button>
    ${multiPage ? `
    <button id="pdfViewToggle" title="全ページを一覧表示" style="${btnStyle}">
      <i class="fa-solid fa-table-cells"></i>
    </button>` : ''}
  `;
  document.getElementById('previewArea').appendChild(bar);

  bar.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('mouseenter', () => btn.style.background = 'rgba(255,255,255,.2)');
    btn.addEventListener('mouseleave', () => btn.style.background = 'none');
  });
  async function applyRotate(delta) {
    pdfPreviewRot = (pdfPreviewRot + delta + 360) % 360;
    pdfGridRendered = false;  /* グリッドのサムネイルも回転を反映させるため無効化 */
    if (pdfViewMode === 'grid') {
      await renderPdfGrid();
    } else {
      await reRenderPdfPreviewPage();
    }
  }
  bar.querySelector('#pdfRotCCW').addEventListener('click', () => applyRotate(-90));
  bar.querySelector('#pdfRotCW').addEventListener('click', () => applyRotate(90));
  bar.querySelector('#pdfViewToggle')?.addEventListener('click', () =>
    setPdfViewMode(pdfViewMode === 'grid' ? 'single' : 'grid'));
}

/* ── Ctrl+ホイール：PDFズーム（window リスナーへ一本化・ここは overscroll とパン初期化） ── */
function initPdfWheelZoom() {
  const container = document.getElementById('pdfContainer');
  if (!container) return;
  container.style.overscrollBehavior = 'contain';
  initPdfPan(container);
}

/* ── Ctrl+ホイール：画像ズーム（window リスナーへ一本化・状態リセットとパン初期化） ── */
function initImgWheelZoom(imgEl) {
  imgZoomFactor = 1.0;
  imgPanX = 0;
  imgPanY = 0;
  const area = document.getElementById('previewArea');
  if (area) area.style.overscrollBehavior = 'contain';
  if (imgEl) initImgPan(imgEl);
}

/* ── 左ドラッグでPDFをパン（transform translate を更新） ── */
function initPdfPan(container) {
  if (container._panInit) return;
  container._panInit = true;

  let panning = false;
  let startX = 0, startY = 0, startPX = 0, startPY = 0;

  container.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const pannable = pdfBaseCssW * pdfZoomFactor > container.clientWidth ||
                     pdfBaseCssH * pdfZoomFactor > container.clientHeight;
    if (!pannable) return;
    e.preventDefault();
    panning = true;
    startX  = e.clientX; startY = e.clientY;
    startPX = pdfPanX;   startPY = pdfPanY;
    container.setPointerCapture(e.pointerId);
    container.style.cursor = 'grabbing';
    container.style.userSelect = 'none';
  });
  container.addEventListener('pointermove', e => {
    if (!panning) return;
    pdfPanX = startPX + (e.clientX - startX);
    pdfPanY = startPY + (e.clientY - startY);
    const canvas = document.getElementById('pdfCanvas');
    if (canvas) applyPdfTransform(canvas);
  });
  const endPan = e => {
    if (!panning) return;
    panning = false;
    try { container.releasePointerCapture(e.pointerId); } catch (_) {}
    container.style.userSelect = '';
    updatePdfPanCursor();
  };
  container.addEventListener('pointerup', endPan);
  container.addEventListener('pointercancel', endPan);
}

/* ── 左ドラッグで画像をパン（transform の translate を更新） ── */
function initImgPan(imgEl) {
  imgEl.draggable = false;

  let panning = false;
  let startX = 0, startY = 0, startPX = 0, startPY = 0;

  imgEl.addEventListener('pointerdown', e => {
    if (e.button !== 0 || imgZoomFactor <= 1.0) return;
    e.preventDefault();
    panning = true;
    startX  = e.clientX; startY = e.clientY;
    startPX = imgPanX;   startPY = imgPanY;
    imgEl.setPointerCapture(e.pointerId);
    imgEl.style.cursor = 'grabbing';
  });
  imgEl.addEventListener('pointermove', e => {
    if (!panning) return;
    imgPanX = startPX + (e.clientX - startX);
    imgPanY = startPY + (e.clientY - startY);
    clampImgPan(imgEl);
    applyImgTransform(imgEl);
  });
  const endPan = e => {
    if (!panning) return;
    panning = false;
    try { imgEl.releasePointerCapture(e.pointerId); } catch (_) {}
    imgEl.style.cursor = imgZoomFactor > 1.0 ? 'grab' : '';
  };
  imgEl.addEventListener('pointerup', endPan);
  imgEl.addEventListener('pointercancel', endPan);
}

/* 画像が画面外へ完全に消えないよう移動量を制限（はみ出した分だけ動かせる） */
function clampImgPan(imgEl) {
  const area = document.getElementById('previewArea');
  if (!area) return;
  const ar = area.getBoundingClientRect();
  /* 拡大後の実寸（transform後の見た目サイズ） */
  const dispW = imgEl.offsetWidth  * imgZoomFactor;
  const dispH = imgEl.offsetHeight * imgZoomFactor;
  const maxX = Math.max(0, (dispW - ar.width)  / 2);
  const maxY = Math.max(0, (dispH - ar.height) / 2);
  imgPanX = Math.max(-maxX, Math.min(maxX, imgPanX));
  imgPanY = Math.max(-maxY, Math.min(maxY, imgPanY));
}

/* ── ズームレベルを一時表示 ── */
let _zoomLabelTimer = null;
function showPreviewZoomLabel(text) {
  let label = document.getElementById('previewZoomLabel');
  if (!label) {
    label = document.createElement('div');
    label.id = 'previewZoomLabel';
    label.style.cssText = [
      'position:absolute', 'bottom:52px', 'left:50%', 'transform:translateX(-50%)',
      'background:rgba(0,0,0,.65)', 'color:#fff', 'font-size:13px', 'font-weight:700',
      'padding:5px 14px', 'border-radius:14px', 'pointer-events:none', 'z-index:20',
      'transition:opacity .3s',
    ].join(';');
    document.getElementById('previewArea').appendChild(label);
  }
  label.textContent = text;
  label.style.opacity = '1';
  clearTimeout(_zoomLabelTimer);
  _zoomLabelTimer = setTimeout(() => { if (label) label.style.opacity = '0'; }, 1200);
}

/* ────────────────────────────────
   PDF プレビュー（自動リトライ付き）
   ──────────────────────────────── */
async function loadPdfPreview(attempt) {
  const MAX_ATTEMPTS = 3;
  const placeholder = document.getElementById('previewPlaceholder');

  /* previewHint は再試行ごとに再取得（innerHTML 置換後も正しく参照） */
  const hintEl = () => document.getElementById('previewHint');

  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    if (attempt > 1) {
      hintEl().textContent = `PDF読み込み中… (再試行 ${attempt}/${MAX_ATTEMPTS})`;
    }

    /* IndexedDB キャッシュ確認 */
    let buffer = null;
    const isPpt = ['pptx','ppt','pptm'].includes(fileData.file_name.split('.').pop().toLowerCase());
    const cachedBlob = await (window.WnPreviewCache?.get(fileId, fileData.updated_at) ?? null);
    if (cachedBlob) {
      hintEl().textContent = 'キャッシュから読み込み中…';
      buffer = await cachedBlob.arrayBuffer();
    } else if (isPpt) {
      /* PowerPoint はサーバー側で PDF 変換したものを取得（初回は変換に時間がかかる） */
      hintEl().textContent = 'スライドをPDFに変換中…（初回は1分ほどかかることがあります）';
      buffer = await wnFetchPptxPdfBuffer(fileId);
    } else {
      buffer = await wnFetchFileBuffer(fileId, {
        onProgress: pct => { hintEl().textContent = `PDF読み込み中… ${pct}%`; },
      });
      if (!buffer) throw new Error('ファイルの取得に失敗しました');
      /* バックグラウンドでキャッシュ保存（描画を待たせない） */
      window.WnPreviewCache?.set(fileId, fileData.updated_at, new Blob([buffer], { type: 'application/pdf' }))
        .catch(() => {});
    }

    hintEl().textContent = 'PDF描画中…';
    pdfPreviewDoc  = await pdfjsLib.getDocument({ data: buffer }).promise;
    pdfPreviewPage = 1;
    pdfViewMode    = 'single';
    pdfGridRendered = false;
    pdfZoomFactor  = 1.0;
    pdfPanX        = 0;
    pdfPanY        = 0;
    pdfBaseCssW    = 0;
    pdfBaseCssH    = 0;
    document.getElementById('pdfGridContainer')?.remove();
    const pdfDoc   = pdfPreviewDoc;
    const page     = await pdfDoc.getPage(1);
    const container = document.getElementById('pdfContainer');
    const canvas    = document.getElementById('pdfCanvas');
    const ctx       = canvas.getContext('2d');
    const area      = document.getElementById('previewArea');

    /* 寸法測定前に container を表示して、parent の高さを正しく確定させる */
    placeholder.style.display = 'none';
    container.style.display = 'flex';

    /* ブラウザに 1 フレーム描画させてから測定（モバイルで height: auto の親が確定するように） */
    await new Promise(r => requestAnimationFrame(r));

    const areaW     = Math.max(area.clientWidth  - 24, 100);
    const areaH     = Math.max(area.clientHeight - 24, 100);
    const dpr       = Math.max(window.devicePixelRatio || 1, 2);
    const _defVP    = page.getViewport({ scale: 1 });
    const _totRot   = (_defVP.rotation + pdfPreviewRot) % 360;
    const baseVP    = page.getViewport({ scale: 1, rotation: _totRot });
    /* 表示用スケール（エリアにフィット） */
    const fitScale  = Math.min(areaW / baseVP.width, areaH / baseVP.height);

    /* レンダリング用スケール：最低でも PDF 等倍解像度を確保（モバイルで小さくならないように）
       MAX_CANVAS_DIM で上限を設けてメモリ枯渇を防止 */
    const MIN_RENDER_SCALE = 1.5;   /* PDF寸法の1.5倍以上で描画 */
    const MAX_CANVAS_DIM   = 4096;
    let renderScale = Math.max(fitScale * dpr, MIN_RENDER_SCALE);
    const maxBaseDim = Math.max(baseVP.width, baseVP.height);
    if (maxBaseDim * renderScale > MAX_CANVAS_DIM) {
      renderScale = MAX_CANVAS_DIM / maxBaseDim;
    }
    const viewport = page.getViewport({ scale: renderScale, rotation: _totRot });

    canvas.width  = viewport.width;
    canvas.height = viewport.height;
    /* CSS表示サイズはエリアにフィット */
    pdfBaseCssW = baseVP.width  * fitScale;
    pdfBaseCssH = baseVP.height * fitScale;
    canvas.style.width  = pdfBaseCssW + 'px';
    canvas.style.height = pdfBaseCssH + 'px';

    await page.render({ canvasContext: ctx, viewport }).promise;
    applyPdfTransform(canvas);

    hintEl().textContent = '';

    if (pdfDoc.numPages > 1) {
      renderPdfNav(pdfDoc, page, canvas, ctx, area, 1);
    }
    addPdfRotateOverlay();
    initPdfWheelZoom();
    updatePdfPanCursor();
  } catch (e) {
    console.error(`PDF preview error (attempt ${attempt}):`, e);

    /* ファイル固有エラー（リトライ不要） */
    const isFileError = ['PasswordException', 'InvalidPDFException', 'MissingPDFException'].includes(e.name);

    if (!isFileError && attempt < MAX_ATTEMPTS) {
      /* ネットワーク系エラー: 自動リトライ */
      const waitSec = attempt * 2;
      hintEl().textContent = `読み込みに失敗しました。${waitSec}秒後に再試行します… (${attempt}/${MAX_ATTEMPTS})`;
      setTimeout(() => loadPdfPreview(attempt + 1), waitSec * 1000);
    } else {
      /* エラー種別に応じたメッセージ */
      let icon      = 'fa-triangle-exclamation';
      let iconColor = '#F57C00';
      let title     = 'PDFを読み込めませんでした';
      let desc      = 'ネットワーク状況をご確認のうえ再試行してください';
      let showRetry = true;

      if (e.name === 'PasswordException') {
        icon      = 'fa-lock';
        iconColor = '#546E7A';
        title     = 'パスワードで保護されたPDFです';
        desc      = 'ダウンロードしてPDFビューアで開き、パスワードを入力してください';
        showRetry = false;
      } else if (e.name === 'InvalidPDFException') {
        icon      = 'fa-file-circle-xmark';
        iconColor = '#E17055';
        title     = 'PDFファイルが破損しているか、非対応の形式です';
        desc      = 'ダウンロードしてPDFビューアで直接ご確認ください';
        showRetry = false;
      }

      placeholder.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;gap:14px;padding:28px 20px;text-align:center;">
          <i class="fa-solid ${icon}" style="font-size:36px;color:${iconColor};"></i>
          <div>
            <p style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px;">${title}</p>
            <p style="font-size:12px;color:var(--muted);">${desc}</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
            ${showRetry ? `<button id="pdfRetryManualBtn" class="btn btn-accent btn-sm">
              <i class="fa-solid fa-rotate-right"></i> 再試行
            </button>` : ''}
            <button id="pdfFallbackDownloadBtn" class="btn btn-ghost btn-sm">
              <i class="fa-solid fa-download"></i> ダウンロードして確認
            </button>
          </div>
          <p id="previewHint" style="font-size:11px;color:var(--muted);"></p>
        </div>`;
      document.getElementById('pdfRetryManualBtn')?.addEventListener('click', () => {
        placeholder.style.display = '';
        placeholder.innerHTML = `
          <i class="fa-regular fa-file-pdf" style="font-size:48px;color:#ccc;margin-bottom:8px;"></i>
          <p id="previewHint">PDF読み込み中…</p>`;
        loadPdfPreview(1);
      });
      document.getElementById('pdfFallbackDownloadBtn').addEventListener('click', () => wnDownload(fileId));
    }
  }
}

function renderInfo() {
  const f = fileData;
  const rows = [
    ['サイズ',        wnFormatSize(f.file_size)],
    ['アップロード',  wnFormatDate(f.created_at)],
    ['アップロード者', h(f.uploader?.name ?? '—')],
    ['バージョン',    `v${f.version}`],
    ['閲覧数',        `<i class="fa-solid fa-eye" style="color:var(--muted);font-size:11px;"></i> ${(f.view_count ?? 0).toLocaleString()}回`],
    ['いいね',        `<i class="fa-solid fa-heart" style="color:#e74c3c;font-size:11px;"></i> ${(f.like_count ?? 0).toLocaleString()}`],
  ];
  document.getElementById('fileInfo').innerHTML = rows.map(([l, v]) => `
    <div class="info-row">
      <span class="info-label">${l}</span>
      <span class="info-value">${v}</span>
    </div>
  `).join('');
}

function renderAiDescription() {
  const desc = fileData.ai_description;
  if (!desc) return;
  const card = document.getElementById('aiDescCard');
  const text = document.getElementById('aiDescText');
  if (!card || !text) return;
  text.textContent = desc;
  card.style.display = '';
}

function renderTags() {
  const list = document.getElementById('tagList');
  const tags = fileData.tags ?? [];
  if (!tags.length) {
    list.innerHTML = '<span style="font-size:13px;color:var(--muted);">タグなし</span>';
    return;
  }
  list.innerHTML = tags.map(t => `
    <span class="tag tag-removable${t.source === 'ai' ? ' tag-ai' : ''}" data-tag-id="${t.id}">
      ${t.source === 'ai' ? '✦ ' : ''}${h(t.name)}
      <i class="fa-solid fa-xmark" style="font-size:10px;opacity:.6;margin-left:3px;"></i>
    </span>
  `).join('');

  list.querySelectorAll('.tag-removable').forEach(tag => {
    tag.addEventListener('click', async () => {
      const tagId = tag.dataset.tagId;
      tag.style.opacity = '0';
      tag.style.transition = 'opacity .2s';
      setTimeout(() => tag.remove(), 200);
      await wnRemoveTag(fileId, tagId);
    });
  });
}

async function renderVersions() {
  const list = document.getElementById('versionList');
  list.innerHTML = '<p style="font-size:12px;color:var(--muted);">読み込み中…</p>';
  const versions = await wnGetVersions(fileId);

  if (!versions.length) {
    list.innerHTML = '<p style="font-size:12px;color:var(--muted);">バージョン履歴なし</p>';
    return;
  }
  const ext = fileData.file_name.split('.').pop().toLowerCase();
  const diffable = ['pdf', 'dxf'].includes(ext);

  // 現在版を先頭に、残りは新しい順に並べ替え
  const sorted = [
    ...versions.filter(v => v.id == fileId),
    ...versions.filter(v => v.id != fileId).sort((a, b) => b.version - a.version || b.id - a.id),
  ];

  const LIMIT = 3;
  const visible = sorted.slice(0, LIMIT);
  const hidden  = sorted.slice(LIMIT);

  function renderItem(v) {
    const isCurrent = v.id == fileId;
    const inner = `
      <div class="version-info">
        <div class="name" title="${h(v.file_name)}">
          <span class="ver-label">v${v.version}</span>
          <span class="ver-filename">${h(v.file_name)}</span>
        </div>
        <div class="meta">${wnFormatDate(v.created_at)} · ${wnFormatSize(v.file_size)}</div>
      </div>
      <div class="version-actions">
        ${!isCurrent && diffable
          ? `<a href="diff.html?a=${v.id}&b=${fileId}" class="btn btn-ghost btn-sm" style="padding:3px 7px;font-size:10px;color:var(--accent);" title="この版と現在を比較"><i class="fa-solid fa-left-right"></i></a>`
          : ''
        }
        ${isCurrent
          ? `<span style="font-size:11px;color:var(--accent);font-weight:700;white-space:nowrap;">現在</span>`
          : `<i class="fa-solid fa-chevron-right" style="color:var(--muted);font-size:11px;"></i>`
        }
      </div>`;
    return isCurrent
      ? `<div class="version-item current">${inner}</div>`
      : `<a class="version-item" href="file-detail.html?id=${v.id}">${inner}</a>`;
  }

  let html = visible.map(renderItem).join('');

  if (hidden.length) {
    const btnStyle = `width:100%;margin-top:6px;padding:6px;font-size:11px;color:var(--accent);background:none;border:1px dashed var(--border);border-radius:6px;cursor:pointer;`;
    html += `
      <div id="versionMoreWrap" style="display:none;">
        ${hidden.map(renderItem).join('')}
        <button onclick="
          document.getElementById('versionMoreWrap').style.display='none';
          document.getElementById('versionMoreBtn').style.display='';
        " style="${btnStyle}">
          閉じる <i class="fa-solid fa-chevron-up"></i>
        </button>
      </div>
      <button id="versionMoreBtn" onclick="
        document.getElementById('versionMoreWrap').style.display='';
        this.style.display='none';
      " style="${btnStyle}">
        残り ${hidden.length} 件を表示 <i class="fa-solid fa-chevron-down"></i>
      </button>`;
  }

  list.innerHTML = html;
}

/* ────────────────────────────────
   類似ファイル
   ──────────────────────────────── */
async function loadSimilarFiles() {
  const card = document.getElementById('similarCard');
  const list = document.getElementById('similarList');
  if (!card || !list) return;

  const files = await wnGetSimilarFiles(fileId);
  if (!files.length) return;

  card.style.display = '';
  list.innerHTML = files.map(f => `
    <a class="similar-item" href="file-detail.html?id=${f.id}">
      <div>
        <div class="name" title="${h(f.file_name)}">${h(f.file_name)}</div>
        <div class="meta">類似度 ${Math.round(f.similarity * 100)}% · ${wnFormatSize(f.file_size)}</div>
      </div>
      <i class="fa-solid fa-chevron-right arrow"></i>
    </a>
  `).join('');
}

/* ────────────────────────────────
   アクションボタン
   ──────────────────────────────── */
function initActions() {
  document.getElementById('likeBtn').addEventListener('click', async () => {
    const res = await wnToggleLike(fileId);
    if (res) {
      const btn = document.getElementById('likeBtn');
      btn.classList.toggle('liked', res.liked);
      btn.querySelector('i').className = `fa-${res.liked ? 'solid' : 'regular'} fa-heart`;
      document.getElementById('likeCount').textContent = res.count;
    }
  });

  document.getElementById('previewBtn').addEventListener('click', async () => {
    const ext = (fileData.file_name || '').split('.').pop().toLowerCase();
    if (ext === 'dxf') {
      openSheetEye(fileId, fileData.file_name);
      return;
    }
    /* Office系 (Excel/Word/PowerPoint) は生URLを開くとブラウザがダウンロードしてしまうため、
       Microsoft Office Online Viewer を新タブで開く */
    if (wnIsOfficeFile(fileData.file_name)) {
      const officeUrl = wnOfficeViewerUrl(fileId);
      if (officeUrl) {
        window.open(officeUrl, '_blank');
      } else {
        wnShowToast('別タブ表示は本番環境でご利用ください', 'info');
      }
      return;
    }
    const url = await wnGetViewUrl(fileId);
    if (url) window.open(url, '_blank');
    else wnShowToast('プレビューを開けませんでした', 'danger');
  });

  document.getElementById('downloadBtn').addEventListener('click', () => wnDownload(fileId));

  document.getElementById('emailShareBtn')?.addEventListener('click', () => {
    openEmailModal(fileId, fileData?.file_name ?? '');
  });

  document.getElementById('printBtn')?.addEventListener('click', async () => {
    const url = await wnGetViewUrl(fileId);
    if (!url) { wnShowToast('ファイルを取得できませんでした', 'danger'); return; }
    const win = window.open('', '_blank');
    if (!win) { wnShowToast('ポップアップを許可してください', 'danger'); return; }
    const isPdf = (fileData.file_name || '').split('.').pop().toLowerCase() === 'pdf';
    if (isPdf) {
      win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>印刷</title>
<style>@page{margin:0}body{margin:0}embed{width:100vw;height:100vh}</style></head>
<body><embed src="${url}" type="application/pdf" width="100%" height="100%">
<script>setTimeout(function(){window.focus();window.print();},1500);<\/script></body></html>`);
    } else {
      win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>印刷</title>
<style>@page{margin:10mm}body{margin:0;background:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh}img{max-width:100%;max-height:100vh;object-fit:contain;display:block}@media print{body{display:block}img{max-height:none;width:100%}}</style></head>
<body><img src="${url}" onload="window.focus();window.print();"></body></html>`);
    }
    win.document.close();
  });

  document.getElementById('annotateBtn')?.addEventListener('click', () => {
    location.href = `annotate.html?id=${fileId}&from=file-detail.html`;
  });

  document.getElementById('deleteBtn').addEventListener('click', async () => {
    const versionCount = fileData.version ?? 1;
    const msg = versionCount > 1
      ? `「${fileData.file_name}」\n全 ${versionCount} バージョンをまとめて削除します。\nこの操作は元に戻せません。`
      : `「${fileData.file_name}」を削除しますか？\nこの操作は元に戻せません。`;
    if (!confirm(msg)) return;
    const ok = await wnDeleteFile(fileId);
    if (ok) {
      wnShowToast('ファイルを削除しました', 'success');
      setTimeout(() => location.href = 'dashboard.html', 1200);
    } else {
      wnShowToast('削除に失敗しました', 'danger');
    }
  });
}

/* ────────────────────────────────
   タグ追加
   ──────────────────────────────── */
function initTags() {
  document.getElementById('addTagBtn').addEventListener('click', () => {
    const area = document.getElementById('tagAddArea');
    const show = area.style.display === 'none' || area.style.display === '';
    area.style.display = show ? 'flex' : 'none';
    if (show) document.getElementById('tagInput').focus();
  });

  const submitTag = async () => {
    const input = document.getElementById('tagInput');
    const name = input.value.trim();
    if (!name) return;
    input.disabled = true;
    const tag = await wnAddTag(fileId, name);
    input.disabled = false;
    if (!tag) { wnShowToast('タグの追加に失敗しました', 'danger'); return; }
    input.value = '';
    document.getElementById('tagAddArea').style.display = 'none';
    if (!fileData.tags) fileData.tags = [];
    fileData.tags.push(tag);
    renderTags();
  };

  document.getElementById('tagSubmitBtn').addEventListener('click', submitTag);
  document.getElementById('tagInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitTag();
  });
}

/* ────────────────────────────────
   コメント
   ──────────────────────────────── */
function initComments() {
  document.getElementById('commentSubmitBtn').addEventListener('click', postComment);
  document.getElementById('commentInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) postComment();
  });
}

async function loadComments() {
  const list = document.getElementById('commentList');
  const comments = await wnGetComments(fileId);
  const badge = document.getElementById('commentBadge');
  if (badge) badge.textContent = comments.length ? comments.length : '';

  if (!comments.length) {
    list.innerHTML = '<p style="font-size:13px;color:var(--muted);">まだコメントはありません</p>';
    return;
  }
  list.innerHTML = comments.map(c => `
    <div class="comment-item">
      <div class="comment-avatar">${h((c.user?.name ?? '?').charAt(0))}</div>
      <div class="comment-body-wrap">
        <div class="comment-meta">
          <span class="comment-user">${h(c.user?.name ?? '不明')}</span>
          <span class="comment-date">${wnFormatDate(c.created_at)}</span>
        </div>
        <div class="comment-text">${h(c.body).replace(/\n/g, '<br>')}</div>
      </div>
    </div>
  `).join('');

  const panelList = document.getElementById('commentList');
  panelList.scrollTop = panelList.scrollHeight;
}

async function postComment() {
  const input = document.getElementById('commentInput');
  const body = input.value.trim();
  if (!body) return;
  const res = await wnPostComment(fileId, body);
  if (res) {
    input.value = '';
    await loadComments();
  } else {
    wnShowToast('コメントの投稿に失敗しました', 'danger');
  }
}

/* ────────────────────────────────
   QRコードモーダル
   ──────────────────────────────── */
let qrInstance = null;

function initQrModal() {
  const modal    = document.getElementById('qrModal');
  const closeBtn = document.getElementById('qrModalClose');

  const openQr = async () => {
    modal.classList.remove('hidden');
    document.getElementById('qrFileName').textContent = fileData?.file_name ?? '';

    const qrData = await wnIssueQr(fileId);
    if (!qrData) { wnShowToast('QRの発行に失敗しました', 'danger'); return; }

    const qrUrl = qrData.url;
    document.getElementById('qrUrl').textContent = qrUrl;

    const qrWrap = document.getElementById('qrWrap');
    qrWrap.innerHTML = '';
    qrInstance = new QRCode(qrWrap, {
      text: qrUrl, width: 200, height: 200,
      colorDark: '#1E3A5F', colorLight: '#ffffff',
    });

    document.getElementById('qrDownloadBtn').onclick = () => {
      const img = qrWrap.querySelector('img') ?? qrWrap.querySelector('canvas');
      const a = document.createElement('a');
      a.href = img?.src ?? img?.toDataURL?.() ?? '';
      a.download = `qr_${fileData.file_name}.png`;
      a.click();
    };
    document.getElementById('qrCopyBtn').onclick = () => {
      navigator.clipboard.writeText(qrUrl).then(() => wnShowToast('URLをコピーしました', 'success'));
    };
    document.getElementById('qrPrintBtn').onclick = () => window.print();
  };

  document.getElementById('qrBtn').addEventListener('click', openQr);
  document.getElementById('qrBtn2').addEventListener('click', openQr);

  closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
}

/* ────────────────────────────────
   ボトムナビ
   ──────────────────────────────── */
function initBottomNav() {
  document.getElementById('bnLike')?.addEventListener('click', () =>
    document.getElementById('likeBtn').click()
  );
  document.getElementById('bnDownload')?.addEventListener('click', () =>
    wnDownload(fileId)
  );
  document.getElementById('bnQr')?.addEventListener('click', () =>
    document.getElementById('qrBtn').click()
  );
}

/* ────────────────────────────────
   既読確認
   ──────────────────────────────── */
function initViewers() {
  const header = document.getElementById('viewersCardHeader');
  const body   = document.getElementById('viewersBody');
  const badge  = document.getElementById('viewersBadge');
  if (!header || !body) return;

  let loaded = false;
  header.addEventListener('click', async () => {
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    if (!isOpen && !loaded) {
      loaded = true;
      body.innerHTML = '<p style="font-size:12px;color:var(--muted);">読み込み中…</p>';
      const viewers = await wnGetViewers(fileId);
      badge.textContent = viewers.length ? `${viewers.length}人` : '';
      if (!viewers.length) {
        body.innerHTML = '<p style="font-size:12px;color:var(--muted);">まだ誰も閲覧していません</p>';
        return;
      }
      body.innerHTML = viewers.map(v => `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);">
          <div style="width:26px;height:26px;border-radius:50%;background:var(--accent);color:#fff;
            font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            ${h((v.user_name ?? '?').charAt(0))}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${h(v.user_name ?? '不明')}</div>
            <div style="font-size:11px;color:var(--muted);">最終閲覧: ${v.last_viewed ? new Date(v.last_viewed).toLocaleDateString('ja-JP') : '—'}</div>
          </div>
          <div style="font-size:11px;color:var(--muted);flex-shrink:0;">${v.view_count ?? 1}回</div>
        </div>
      `).join('');
    }
  });
}

/* ────────────────────────────────
   外部共有リンク
   ──────────────────────────────── */
function initShareModal() {
  const modal      = document.getElementById('shareModal');
  const closeBtn   = document.getElementById('shareModalClose');
  const cancelBtn  = document.getElementById('shareModalCancel');
  const submitBtn  = document.getElementById('shareModalSubmit');
  const createBtn  = document.getElementById('createShareBtn');
  const shareBody  = document.getElementById('shareBody');
  if (!modal || !createBtn || !shareBody) return;

  const openModal = () => {
    document.getElementById('shareExpires').value  = '7';
    document.getElementById('sharePassword').value = '';
    document.getElementById('shareLimit').value    = '';
    modal.classList.remove('hidden');
  };
  const closeModal = () => modal.classList.add('hidden');

  createBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  submitBtn.addEventListener('click', async () => {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 発行中…';

    const expiresDays  = parseInt(document.getElementById('shareExpires').value) || null;
    const password     = document.getElementById('sharePassword').value.trim() || null;
    const accessLimit  = parseInt(document.getElementById('shareLimit').value) || null;

    const data = await wnCreateShare(fileId, { expiresDays, password, accessLimit });

    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-link"></i> リンクを発行';

    if (!data) { wnShowToast('共有リンクの発行に失敗しました', 'danger'); return; }
    closeModal();
    wnShowToast('共有リンクを発行しました', 'success');
    await renderShares();
  });

  renderShares();
}

async function renderShares() {
  const shareBody = document.getElementById('shareBody');
  if (!shareBody) return;

  const shares = await wnGetShares(fileId);
  if (!shares.length) {
    shareBody.innerHTML = '<p style="font-size:12px;color:var(--muted);">共有リンクなし</p>';
    return;
  }

  shareBody.innerHTML = shares.map(s => {
    const expired = s.expires_at && new Date(s.expires_at) < new Date();
    const expiryLabel = s.expires_at
      ? (expired ? `<span style="color:var(--red);">期限切れ: ${wnFormatDate(s.expires_at)}</span>`
                 : `有効期限: ${wnFormatDate(s.expires_at)}`)
      : '無期限';
    return `
      <div style="padding:8px 0;border-bottom:1px solid var(--border);" data-share-id="${s.id}">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <input type="text" readonly value="${h(s.url)}"
            style="flex:1;font-size:11px;padding:4px 8px;border:1px solid var(--border);border-radius:4px;
              background:var(--bg);color:var(--text);overflow:hidden;text-overflow:ellipsis;min-width:0;">
          <button class="btn btn-ghost btn-sm share-copy-btn" data-url="${h(s.url)}"
            style="padding:4px 8px;font-size:11px;flex-shrink:0;">
            <i class="fa-solid fa-copy"></i>
          </button>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div style="font-size:11px;color:var(--muted);line-height:1.6;">
            ${expiryLabel}
            ${s.password_hash ? ' · <i class="fa-solid fa-lock" title="パスワードあり"></i>' : ''}
            ${s.access_limit ? ` · ${s.access_count ?? 0}/${s.access_limit}回` : ` · ${s.access_count ?? 0}回アクセス`}
          </div>
          <button class="btn btn-ghost btn-sm share-delete-btn" data-share-id="${s.id}"
            style="padding:3px 7px;font-size:11px;color:var(--red);">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  shareBody.querySelectorAll('.share-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.url)
        .then(() => wnShowToast('URLをコピーしました', 'success'));
    });
  });

  shareBody.querySelectorAll('.share-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('この共有リンクを削除しますか？')) return;
      const shareId = btn.dataset.shareId;
      btn.closest('[data-share-id]').style.opacity = '0.4';
      const ok = await wnDeleteShare(fileId, shareId);
      if (ok) { wnShowToast('共有リンクを削除しました', 'success'); await renderShares(); }
      else { btn.closest('[data-share-id]').style.opacity = '1'; wnShowToast('削除に失敗しました', 'danger'); }
    });
  });
}

/* ────────────────────────────────
   ファイル変換
   ──────────────────────────────── */

/* 変換可能マップ: 拡張子 → [{value, label, quality, pdfPage, sheet}] */
const CONVERT_MAP = {
  /* 画像系 */
  png:  [
    { value: 'jpg',  label: 'JPG',  quality: true },
    { value: 'webp', label: 'WebP', quality: true },
  ],
  jpg:  [
    { value: 'png',  label: 'PNG' },
    { value: 'webp', label: 'WebP', quality: true },
  ],
  jpeg: [
    { value: 'png',  label: 'PNG' },
    { value: 'webp', label: 'WebP', quality: true },
  ],
  gif:  [
    { value: 'png',  label: 'PNG' },
    { value: 'jpg',  label: 'JPG',  quality: true },
  ],
  webp: [
    { value: 'png',  label: 'PNG' },
    { value: 'jpg',  label: 'JPG',  quality: true },
  ],
  svg: [
    { value: 'png',  label: 'PNG' },
  ],
  heic: [
    { value: 'jpg',  label: 'JPG',  quality: true },
    { value: 'png',  label: 'PNG' },
    { value: 'webp', label: 'WebP', quality: true },
  ],
  heif: [
    { value: 'jpg',  label: 'JPG',  quality: true },
    { value: 'png',  label: 'PNG' },
  ],
  /* PDF */
  pdf: [
    { value: 'split', label: 'PDF分割',        split: true },
    { value: 'png',   label: 'PNG（各ページ）', pdfPage: true },
    { value: 'jpg',   label: 'JPG（各ページ）', pdfPage: true, quality: true },
  ],
  /* Excel */
  xlsx: [{ value: 'csv', label: 'CSV', sheet: true }],
  xls:  [{ value: 'csv', label: 'CSV', sheet: true }],
  xlsm: [{ value: 'csv', label: 'CSV', sheet: true }],
  csv:  [{ value: 'xlsx', label: 'Excel (.xlsx)' }],
};

function initConvert() {
  const card      = document.getElementById('convertCard');
  const select    = document.getElementById('convertTarget');
  const qualSel   = document.getElementById('convertQuality');
  const pageWrap  = document.getElementById('convertPageWrap');
  const sheetWrap = document.getElementById('convertSheetWrap');
  const sheetSel  = document.getElementById('convertSheet');
  const btn       = document.getElementById('convertBtn');
  if (!card || !select || !btn) return;

  const ext = fileData.file_name.split('.').pop().toLowerCase();
  const targets = CONVERT_MAP[ext];
  if (!targets || !targets.length) return;

  /* カード表示 */
  card.style.display = '';

  /* 選択肢を埋める */
  select.innerHTML = targets.map(t => `<option value="${t.value}">${t.label}</option>`).join('');

  const splitWrap  = document.getElementById('splitWrap');
  const splitCount = document.getElementById('splitPageCount');

  const updateUi = () => {
    const t = targets[select.selectedIndex] ?? targets[0];
    qualSel.style.display   = t.quality ? '' : 'none';
    pageWrap.style.display  = t.pdfPage ? '' : 'none';
    sheetWrap.style.display = t.sheet   ? '' : 'none';
    splitWrap.style.display = t.split   ? '' : 'none';
    btn.innerHTML = t.split
      ? '<i class="fa-solid fa-scissors"></i> 分割してダウンロード'
      : '<i class="fa-solid fa-rotate"></i> 変換してダウンロード';

    if (t.sheet && !sheetSel.dataset.loaded) loadExcelSheets();
    if (t.split) initSplitUi();
  };
  select.addEventListener('change', updateUi);
  updateUi();

  /* ページ指定ラジオ（PNG/JPG変換用） */
  document.querySelectorAll('input[name="pageRange"]').forEach(r => {
    r.addEventListener('change', () => {
      document.getElementById('convertPageNum').style.display =
        r.value === 'single' ? '' : 'none';
    });
  });

  /* 変換ボタン */
  btn.addEventListener('click', async () => {
    const t = targets[select.selectedIndex] ?? targets[0];
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 処理中…';
    setConvertProgress(0, '');

    try {
      if (t.split)               await splitPdf();
      else if (t.pdfPage)        await convertPdfToImage(t.value, parseFloat(qualSel.value));
      else if (t.sheet)          await convertExcelToCsv();
      else if (t.value === 'xlsx') await convertCsvToExcel();
      else                       await convertImage(ext, t.value, parseFloat(qualSel.value));
    } catch(e) {
      console.error(e);
      wnShowToast('処理に失敗しました: ' + e.message, 'danger');
    }

    btn.disabled = false;
    const t2 = targets[select.selectedIndex] ?? targets[0];
    btn.innerHTML = t2.split
      ? '<i class="fa-solid fa-scissors"></i> 分割してダウンロード'
      : '<i class="fa-solid fa-rotate"></i> 変換してダウンロード';
    hideConvertProgress();
  });
}

/* ── プログレス ── */
function setConvertProgress(pct, msg) {
  const wrap = document.getElementById('convertProgress');
  const bar  = document.getElementById('convertProgressBar');
  const txt  = document.getElementById('convertProgressMsg');
  if (!wrap) return;
  wrap.style.display = '';
  bar.style.width = pct + '%';
  txt.textContent = msg;
}
function hideConvertProgress() {
  const wrap = document.getElementById('convertProgress');
  if (wrap) wrap.style.display = 'none';
}

/* ── ファイルのArrayBuffer取得（wn-api.js の wnFetchFileBuffer を使用） ── */
async function fetchFileBuffer() {
  const buf = await wnFetchFileBuffer(fileId);
  if (!buf) throw new Error('ファイルの取得失敗');
  return buf;
}

/* ── 画像変換（PNG/JPG/WebP/HEIC/GIF/SVG/WebP → 各形式） ── */
async function convertImage(srcExt, targetExt, quality = 0.80) {
  setConvertProgress(10, 'ファイルを読み込み中…');
  const buffer = await fetchFileBuffer();

  let blob;
  if (['heic', 'heif'].includes(srcExt)) {
    setConvertProgress(30, 'HEICを変換中…');
    if (typeof heic2any === 'undefined') throw new Error('heic2anyが読み込まれていません');
    blob = await heic2any({
      blob: new Blob([buffer], { type: 'image/heic' }),
      toType: targetExt === 'jpg' ? 'image/jpeg' : `image/${targetExt}`,
      quality,
    });
    if (Array.isArray(blob)) blob = blob[0];
  } else {
    setConvertProgress(30, '画像を読み込み中…');
    const srcBlob = new Blob([buffer]);
    const imgUrl  = URL.createObjectURL(srcBlob);
    blob = await imageToBlob(imgUrl, targetExt, quality);
    URL.revokeObjectURL(imgUrl);
  }

  setConvertProgress(90, 'ダウンロード準備中…');
  const baseName = fileData.file_name.replace(/\.[^.]+$/, '');
  downloadBlob(blob, `${baseName}.${targetExt}`);
  setConvertProgress(100, '完了');
  wnShowToast('変換が完了しました', 'success');
}

function imageToBlob(srcUrl, targetExt, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (targetExt !== 'png') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0);
      const mime = targetExt === 'jpg' ? 'image/jpeg'
                 : targetExt === 'webp' ? 'image/webp'
                 : 'image/png';
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas変換失敗')), mime, quality);
    };
    img.onerror = () => reject(new Error('画像の読み込み失敗'));
    img.src = srcUrl;
  });
}

/* ── PDF → 画像変換 ── */
async function convertPdfToImage(targetExt, quality = 0.80) {
  if (typeof pdfjsLib === 'undefined') throw new Error('PDF.jsが読み込まれていません');
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  setConvertProgress(5, 'PDFを読み込み中…');
  const buffer = await fetchFileBuffer();
  const pdf    = await pdfjsLib.getDocument({ data: buffer }).promise;
  const total  = pdf.numPages;
  const baseName = fileData.file_name.replace(/\.[^.]+$/, '');

  const pageRange = document.querySelector('input[name="pageRange"]:checked')?.value ?? 'all';

  if (pageRange === 'single') {
    /* 1ページのみ */
    const pageNum = parseInt(document.getElementById('convertPageNum').value) || 1;
    setConvertProgress(20, `ページ ${pageNum} を変換中…`);
    const blob = await pdfPageToBlob(pdf, Math.min(pageNum, total), targetExt, quality);
    downloadBlob(blob, `${baseName}_p${pageNum}.${targetExt}`);
    setConvertProgress(100, '完了');
    wnShowToast('変換が完了しました', 'success');
  } else {
    /* 全ページ ZIP */
    if (typeof JSZip === 'undefined') throw new Error('JSZipが読み込まれていません');
    const zip = new JSZip();
    for (let i = 1; i <= total; i++) {
      setConvertProgress(Math.round(i / total * 85) + 5, `ページ ${i}/${total} を変換中…`);
      const blob = await pdfPageToBlob(pdf, i, targetExt, quality);
      zip.file(`${baseName}_p${String(i).padStart(3,'0')}.${targetExt}`, blob);
    }
    setConvertProgress(95, 'ZIPを作成中…');
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, `${baseName}_images.zip`);
    setConvertProgress(100, '完了');
    wnShowToast(`${total}ページをZIPに変換しました`, 'success');
  }
}

async function pdfPageToBlob(pdf, pageNum, targetExt, quality) {
  const page  = await pdf.getPage(pageNum);
  const scale = 2.0;
  const vp    = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width  = vp.width;
  canvas.height = vp.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return new Promise((resolve, reject) => {
    const mime = targetExt === 'jpg' ? 'image/jpeg' : `image/${targetExt}`;
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('変換失敗')), mime, quality);
  });
}

/* ── Excel → CSV ── */
async function loadExcelSheets() {
  const sheetSel = document.getElementById('convertSheet');
  if (!sheetSel || sheetSel.dataset.loaded) return;
  sheetSel.innerHTML = '<option>読み込み中…</option>';
  try {
    const buffer = await fetchFileBuffer();
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    sheetSel.innerHTML = wb.SheetNames.map(n => `<option value="${h(n)}">${h(n)}</option>`).join('');
    sheetSel.dataset.loaded = '1';
    sheetSel.dataset.workbook = JSON.stringify(wb.SheetNames);
    window._wnWorkbook = wb;
  } catch(e) {
    sheetSel.innerHTML = '<option>読み込みエラー</option>';
  }
}

async function convertExcelToCsv() {
  if (typeof XLSX === 'undefined') throw new Error('SheetJSが読み込まれていません');
  setConvertProgress(10, 'Excelを読み込み中…');

  let wb = window._wnWorkbook;
  if (!wb) {
    const buffer = await fetchFileBuffer();
    wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    window._wnWorkbook = wb;
  }

  const sheetSel = document.getElementById('convertSheet');
  const sheetName = sheetSel.value || wb.SheetNames[0];
  setConvertProgress(60, `シート "${sheetName}" を変換中…`);

  const ws  = wb.Sheets[sheetName];
  const csv = XLSX.utils.sheet_to_csv(ws, { FS: ',', RS: '\n' });
  const bom = '﻿'; /* Excel用BOM付きUTF-8 */
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const baseName = fileData.file_name.replace(/\.[^.]+$/, '');
  downloadBlob(blob, `${baseName}_${sheetName}.csv`);
  setConvertProgress(100, '完了');
  wnShowToast('CSVに変換しました', 'success');
}

/* ── CSV → Excel ── */
async function convertCsvToExcel() {
  if (typeof XLSX === 'undefined') throw new Error('SheetJSが読み込まれていません');
  setConvertProgress(10, 'CSVを読み込み中…');
  const buffer = await fetchFileBuffer();
  const text   = new TextDecoder('utf-8').decode(buffer).replace(/^﻿/, '');
  setConvertProgress(50, 'Excelを生成中…');
  const ws = XLSX.utils.aoa_to_sheet(text.split('\n').map(r => r.split(',')));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const out  = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const baseName = fileData.file_name.replace(/\.[^.]+$/, '');
  downloadBlob(blob, `${baseName}.xlsx`);
  setConvertProgress(100, '完了');
  wnShowToast('Excelに変換しました', 'success');
}

/* ── PDF分割UI初期化 ── */
let pdfSplitDoc = null;   /* pdf-lib でロード済みドキュメント */
let pdfSplitTotal = 0;

async function initSplitUi() {
  const countEl = document.getElementById('splitPageCount');
  if (pdfSplitTotal) {
    countEl.textContent = `全 ${pdfSplitTotal} ページ`;
    return;
  }
  countEl.textContent = 'ページ数を取得中…';
  try {
    if (typeof PDFLib === 'undefined') throw new Error('pdf-lib未読み込み');
    const buffer = await fetchFileBuffer();
    pdfSplitDoc  = await PDFLib.PDFDocument.load(buffer);
    pdfSplitTotal = pdfSplitDoc.getPageCount();
    countEl.textContent = `全 ${pdfSplitTotal} ページ`;
  } catch(e) {
    countEl.textContent = 'ページ数の取得失敗: ' + e.message;
  }

  /* 分割モード切替 */
  document.querySelectorAll('input[name="splitMode"]').forEach(r => {
    r.addEventListener('change', () => {
      document.getElementById('splitRangeWrap').style.display =
        r.value === 'range' ? '' : 'none';
    });
  });

  /* 範囲プレビュー */
  document.getElementById('splitRangeInput')?.addEventListener('input', e => {
    const ranges = parseSplitRanges(e.target.value, pdfSplitTotal);
    const preview = document.getElementById('splitRangePreview');
    if (!ranges) {
      preview.textContent = '入力が正しくありません';
      preview.style.color = 'var(--red)';
    } else {
      preview.textContent = `→ ${ranges.length} 個のPDFを生成`;
      preview.style.color = 'var(--accent)';
    }
  });
}

/* ── PDF分割実行 ── */
async function splitPdf() {
  if (typeof PDFLib === 'undefined') throw new Error('pdf-libが読み込まれていません');
  if (typeof JSZip === 'undefined')  throw new Error('JSZipが読み込まれていません');

  setConvertProgress(5, 'PDFを読み込み中…');
  if (!pdfSplitDoc) {
    const buffer = await fetchFileBuffer();
    pdfSplitDoc   = await PDFLib.PDFDocument.load(buffer);
    pdfSplitTotal = pdfSplitDoc.getPageCount();
  }

  const mode = document.querySelector('input[name="splitMode"]:checked')?.value ?? 'each';
  const baseName = fileData.file_name.replace(/\.pdf$/i, '');

  let ranges;
  if (mode === 'each') {
    /* 1ページずつ */
    ranges = Array.from({ length: pdfSplitTotal }, (_, i) => ({ pages: [i], label: `p${i + 1}` }));
  } else {
    /* 範囲指定 */
    const input  = document.getElementById('splitRangeInput').value.trim();
    const parsed = parseSplitRanges(input, pdfSplitTotal);
    if (!parsed || !parsed.length) throw new Error('ページ範囲の指定が正しくありません');
    ranges = parsed;
  }

  setConvertProgress(10, `${ranges.length} 個のPDFを生成中…`);
  const zip = new JSZip();

  for (let i = 0; i < ranges.length; i++) {
    const { pages, label } = ranges[i];
    setConvertProgress(
      Math.round(10 + (i / ranges.length) * 80),
      `${i + 1} / ${ranges.length} 個目を処理中…`
    );

    const newDoc = await PDFLib.PDFDocument.create();
    const copied = await newDoc.copyPages(pdfSplitDoc, pages);
    copied.forEach(p => newDoc.addPage(p));
    const bytes = await newDoc.save();
    zip.file(`${baseName}_${label}.pdf`, bytes);
  }

  setConvertProgress(95, 'ZIPを作成中…');
  const zipBlob = await zip.generateAsync({ type: 'blob' });

  if (ranges.length === 1) {
    /* 1ファイルのみならZIPなしで直接DL */
    const { pages, label } = ranges[0];
    const newDoc = await PDFLib.PDFDocument.create();
    const copied = await newDoc.copyPages(pdfSplitDoc, pages);
    copied.forEach(p => newDoc.addPage(p));
    const bytes = await newDoc.save();
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${baseName}_${label}.pdf`);
  } else {
    downloadBlob(zipBlob, `${baseName}_split.zip`);
  }

  setConvertProgress(100, '完了');
  wnShowToast(`${ranges.length} 個のPDFに分割しました`, 'success');
}

/* ── ページ範囲パーサー ── */
/* 入力例: "1-3, 5, 7-9" → [{pages:[0,1,2], label:'1-3'}, {pages:[4], label:'5'}, ...] */
function parseSplitRanges(input, totalPages) {
  if (!input.trim()) return null;
  const parts = input.split(',').map(s => s.trim()).filter(Boolean);
  const result = [];
  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      const n = parseInt(part);
      if (n < 1 || (totalPages > 0 && n > totalPages)) return null;
      result.push({ pages: [n - 1], label: String(n) });
    } else if (/^\d+-\d+$/.test(part)) {
      const [a, b] = part.split('-').map(Number);
      if (a < 1 || a > b || (totalPages > 0 && b > totalPages)) return null;
      const pages = [];
      for (let i = a; i <= b; i++) pages.push(i - 1);
      result.push({ pages, label: `${a}-${b}` });
    } else {
      return null;
    }
  }
  return result.length ? result : null;
}

/* ── ダウンロードヘルパー ── */
function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ── HTMLエスケープ ── */
function h(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ─────────────────────────────────
   右パネル タブ切替
   ───────────────────────────────── */
function initRightPanelTabs() {
  document.querySelectorAll('.right-panel-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.right-panel-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.right-panel-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`pane${capitalize(btn.dataset.tab)}`).classList.add('active');
    });
  });
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ─────────────────────────────────
   関連ファイル
   ───────────────────────────────── */
let relationsCache = [];

function initRelations() {
  loadRelations();

  document.getElementById('addRelationBtn').addEventListener('click', () => {
    openRelationModal();
  });
  document.getElementById('relationModalClose').addEventListener('click', () => {
    document.getElementById('relationModal').classList.add('hidden');
  });
  document.getElementById('relationModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });

  /* 検索入力 */
  let searchTimer;
  document.getElementById('relationSearchInput').addEventListener('input', e => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    if (!q) {
      document.getElementById('relationSearchResults').innerHTML =
        '<p style="font-size:13px;color:var(--muted);text-align:center;padding:20px 0;">ファイル名を入力してください</p>';
      return;
    }
    searchTimer = setTimeout(() => searchRelationCandidates(q), 300);
  });
}

async function loadRelations() {
  relationsCache = await wnGetRelations(fileId);
  renderRelations();
  /* 初回ロード時にAI提案も取得 */
  loadRelationSuggestions();
}

function renderRelations() {
  const list = document.getElementById('relationList');
  const badge = document.getElementById('relationBadge');

  /* バッジ更新 */
  if (relationsCache.length > 0) {
    badge.textContent = relationsCache.length;
    badge.classList.add('show');
  } else {
    badge.classList.remove('show');
  }

  if (relationsCache.length === 0) {
    list.innerHTML = '<p style="font-size:13px;color:var(--muted);text-align:center;padding:24px 0;">関連ファイルはありません</p>';
    return;
  }

  list.innerHTML = relationsCache.map(r => `
    <a href="file-detail.html?id=${r.id}" class="relation-item" data-id="${r.id}">
      <div class="relation-item-icon">
        <i class="${wnFileIconClass(r.mime_type)}"></i>
      </div>
      <div class="relation-item-body">
        <div class="relation-item-name" title="${h(r.file_name)}">${h(r.file_name)}</div>
        <div class="relation-item-meta">
          v${r.version}
          ${r.approval_status === 'approved' ? '<span style="color:var(--green);">✓承認済</span>' : ''}
          ${r.source === 'ai' ? '<span style="color:var(--accent);">AI</span>' : ''}
        </div>
      </div>
      <button class="relation-item-del" data-relation-id="${r.relation_id}" title="関連を解除">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </a>
  `).join('');

  /* 削除ボタン */
  list.querySelectorAll('.relation-item-del').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.preventDefault();
      e.stopPropagation();
      const relationId = parseInt(btn.dataset.relationId);
      if (!confirm('この関連付けを解除しますか？')) return;
      const ok = await wnRemoveRelation(fileId, relationId);
      if (ok) {
        relationsCache = relationsCache.filter(r => r.relation_id !== relationId);
        renderRelations();
        wnShowToast('関連付けを解除しました', 'success');
      } else {
        wnShowToast('解除に失敗しました', 'danger');
      }
    });
  });
}

let suggestionsCache = [];

async function loadRelationSuggestions() {
  suggestionsCache = await wnSuggestRelations(fileId);
  renderRelationSuggestions();
}

function renderRelationSuggestions() {
  const list = document.getElementById('relationList');
  /* すでにあるサジェストセクションを削除 */
  list.querySelector('.relation-suggest-section')?.remove();

  if (!suggestionsCache.length) return;

  const section = document.createElement('div');
  section.className = 'relation-suggest-section';
  section.innerHTML = `
    <div class="relation-suggest-label">
      <i class="fa-solid fa-wand-magic-sparkles" style="color:var(--accent);"></i> AI提案
    </div>
    ${suggestionsCache.map(s => `
      <div class="relation-suggest-item" data-id="${s.id}">
        <div class="relation-item-icon" style="width:28px;height:28px;font-size:12px;">
          <i class="${wnFileIconClass(s.mime_type)}"></i>
        </div>
        <div class="relation-suggest-body">
          <div class="relation-suggest-name" title="${h(s.file_name)}">${h(s.file_name)}</div>
          <div class="relation-suggest-meta">v${s.version} · 一致度 ${s.score}%</div>
        </div>
        <div class="relation-suggest-actions">
          <button class="btn btn-accent btn-sm suggest-add-btn" data-id="${s.id}" style="font-size:11px;padding:4px 8px;">
            <i class="fa-solid fa-plus"></i>
          </button>
          <button class="btn btn-ghost btn-sm suggest-ignore-btn" data-id="${s.id}" style="font-size:11px;padding:4px 6px;">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>
    `).join('')}
  `;

  list.appendChild(section);

  /* 追加ボタン */
  section.querySelectorAll('.suggest-add-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const relatedId = parseInt(btn.dataset.id);
      const result = await wnAddRelation(fileId, relatedId);
      if (result) {
        suggestionsCache = suggestionsCache.filter(s => s.id !== relatedId);
        await loadRelations();
        wnShowToast('関連ファイルを追加しました', 'success');
      } else {
        wnShowToast('追加に失敗しました', 'danger');
      }
    });
  });

  /* 無視ボタン */
  section.querySelectorAll('.suggest-ignore-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id);
      suggestionsCache = suggestionsCache.filter(s => s.id !== id);
      renderRelationSuggestions();
    });
  });
}

function openRelationModal() {
  const modal = document.getElementById('relationModal');
  modal.classList.remove('hidden');
  document.getElementById('relationSearchInput').value = '';
  document.getElementById('relationSearchResults').innerHTML =
    '<p style="font-size:13px;color:var(--muted);text-align:center;padding:20px 0;">ファイル名を入力してください</p>';
  setTimeout(() => document.getElementById('relationSearchInput').focus(), 80);
}

async function searchRelationCandidates(query) {
  const results = document.getElementById('relationSearchResults');
  results.innerHTML = '<p style="font-size:13px;color:var(--muted);text-align:center;padding:16px 0;"><i class="fa-solid fa-spinner fa-spin"></i></p>';

  const existingIds = new Set([parseInt(fileId), ...relationsCache.map(r => r.id)]);
  const filesResult = await wnGetFiles({ search: query });
  const files = filesResult.data ?? [];
  const filtered = files.filter(f => !existingIds.has(f.id));

  if (!filtered.length) {
    results.innerHTML = '<p style="font-size:13px;color:var(--muted);text-align:center;padding:16px 0;">該当するファイルがありません</p>';
    return;
  }

  results.innerHTML = filtered.slice(0, 20).map(f => `
    <div class="relation-search-row" data-id="${f.id}">
      <i class="${wnFileIconClass(f.mime_type)}" style="color:var(--accent);width:16px;text-align:center;flex-shrink:0;"></i>
      <span class="relation-search-row-name" title="${h(f.file_name)}">${h(f.file_name)}</span>
      <span class="relation-search-row-meta">v${f.version}</span>
    </div>
  `).join('');

  results.querySelectorAll('.relation-search-row').forEach(row => {
    row.addEventListener('click', async () => {
      const relatedId = parseInt(row.dataset.id);
      const result = await wnAddRelation(fileId, relatedId);
      if (result) {
        document.getElementById('relationModal').classList.add('hidden');
        await loadRelations();
        /* 関連タブに切替 */
        document.querySelector('[data-tab="relation"]').click();
        wnShowToast('関連ファイルを追加しました', 'success');
      } else {
        wnShowToast('追加に失敗しました（既に追加済みかもしれません）', 'danger');
      }
    });
  });
}

/* ────────────────────────────────
   SheetEye 連携
   ──────────────────────────────── */
function openSheetEye(id, fileName) {
  const url = `sheeteye.html?id=${id}&name=${encodeURIComponent(fileName)}`;
  window.open(url, '_blank');
}

async function loadSheetEyeEmbed(fileId, fileName) {
  const placeholder = document.getElementById('previewPlaceholder');
  const hint = document.getElementById('previewHint');
  const container = document.getElementById('sheetEyeContainer');

  hint.textContent = 'DXFを読み込み中…';

  try {
    const text = await wnFetchDxfText(fileId);
    if (!text || text.trim().length < 10) throw new Error('empty');

    // SheetEyeコンテナを表示
    placeholder.style.display = 'none';
    container.style.display = 'flex';

    // SheetEye初期化（wn-sheeteye.jsのグローバル関数を呼ぶ）
    sheetEyeInit();
    sheetEyeLoadText(text, fileName);
  } catch (e) {
    console.error('SheetEye embed error:', e);
    hint.textContent = 'DXFのプレビューに失敗しました';
    placeholder.style.display = '';

    // フォールバック: 別タブで開くボタン
    const openBtn = document.createElement('button');
    openBtn.className = 'btn btn-accent btn-sm';
    openBtn.style.marginTop = '12px';
    openBtn.innerHTML = '<i class="fa-solid fa-arrow-up-right-from-square"></i> 別タブで開く';
    openBtn.addEventListener('click', () => openSheetEye(fileId, fileName));
    placeholder.appendChild(openBtn);
  }
}

/* MIME から FontAwesome クラス文字列を返す（wn-api.js の wnFileIcon を上書きしないよう別名にする） */
function wnFileIconClass(mimeType) {
  if (!mimeType) return 'fa-solid fa-file';
  if (mimeType.startsWith('image/')) return 'fa-solid fa-file-image';
  if (mimeType === 'application/pdf') return 'fa-solid fa-file-pdf';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'fa-solid fa-file-excel';
  if (mimeType.includes('word')) return 'fa-solid fa-file-word';
  if (mimeType.includes('dxf') || mimeType.includes('dwg')) return 'fa-solid fa-drafting-compass';
  if (mimeType.startsWith('video/')) return 'fa-solid fa-file-video';
  return 'fa-solid fa-file';
}

/* ────────────────────────────────
   メール共有モーダル
   ──────────────────────────────── */
let _emailFileId     = null;
let _emailFileName   = '';
let _emailChips      = [];
let _emailPregenShare = null; // モーダルオープン時に先行発行した共有リンク

function initEmailModal() {
  const overlay = document.getElementById('emailModal');
  if (!overlay) return;

  document.getElementById('emailModalClose').addEventListener('click', closeEmailModal);
  document.getElementById('emailCancelBtn').addEventListener('click', closeEmailModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeEmailModal(); });

  document.getElementById('emailAddBtn').addEventListener('click', addEmailChip);
  document.getElementById('emailInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addEmailChip(); }
  });

  const msgEl = document.getElementById('emailMessage');
  msgEl.addEventListener('input', () => {
    const count = document.getElementById('emailMsgCount');
    if (count) count.textContent = msgEl.value.length;
    if (msgEl.value.length > 500) { msgEl.value = msgEl.value.slice(0, 500); if (count) count.textContent = 500; }
  });

  document.getElementById('emailCopyLinkBtn')?.addEventListener('click', () => {
    if (!_emailPregenShare?.url) return;
    navigator.clipboard.writeText(_emailPregenShare.url)
      .then(() => wnShowToast('リンクをコピーしました', 'success'))
      .catch(() => wnShowToast('コピーに失敗しました', 'danger'));
  });

  document.getElementById('emailMailtoBtn').addEventListener('click', doSendEmailMailto);
  document.getElementById('emailGmailBtn').addEventListener('click', doSendEmailGmail);
}

function openEmailModal(fileId, fileName) {
  _emailFileId     = fileId;
  _emailFileName   = fileName;
  _emailChips      = [];
  _emailPregenShare = null;

  document.getElementById('emailModalFileNameText').textContent = fileName;
  document.getElementById('emailInput').value   = '';
  document.getElementById('emailMessage').value = '';
  const count = document.getElementById('emailMsgCount');
  if (count) count.textContent = '0';
  document.getElementById('emailInputError').style.display = 'none';
  renderEmailChips();

  // リンク生成中の表示
  _emailLinkShowLoading();
  setEmailBtnsLoading(true);

  // モーダルを開いた瞬間に先行発行（ボタン押下時は同期処理のみにするため）
  wnCreateShare(fileId, { expiresDays: 30 }).then(share => {
    _emailPregenShare = share;
    setEmailBtnsLoading(false);
    if (share?.url) {
      _emailLinkShowReady(share.url);
    } else {
      _emailLinkShowError();
      wnShowToast('共有リンクの発行に失敗しました', 'danger');
    }
  }).catch(() => {
    setEmailBtnsLoading(false);
    _emailLinkShowError();
    wnShowToast('共有リンクの発行に失敗しました', 'danger');
  });

  document.getElementById('emailModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('emailInput').focus(), 100);
}

function _emailLinkShowLoading() {
  const el = document.getElementById('emailLinkLoading');
  const rd = document.getElementById('emailLinkReady');
  if (el) el.style.display = 'flex';
  if (rd) rd.style.display = 'none';
}
function _emailLinkShowReady(url) {
  const el  = document.getElementById('emailLinkLoading');
  const rd  = document.getElementById('emailLinkReady');
  const txt = document.getElementById('emailLinkUrl');
  if (el)  el.style.display = 'none';
  if (rd)  rd.style.display = 'flex';
  if (txt) txt.textContent  = url;
}
function _emailLinkShowError() {
  const el = document.getElementById('emailLinkLoading');
  if (el) { el.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#E17055;"></i> リンクの生成に失敗しました'; }
}

function closeEmailModal() {
  document.getElementById('emailModal').classList.add('hidden');
  _emailFileId      = null;
  _emailPregenShare = null;
  _emailChips       = [];
}

function addEmailChip() {
  const input   = document.getElementById('emailInput');
  const errEl   = document.getElementById('emailInputError');
  const errText = document.getElementById('emailInputErrorText');
  const val = input.value.trim().replace(/,$/, '');
  if (!val) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
    errText.textContent = '有効なメールアドレスを入力してください';
    errEl.style.display = 'flex';
    return;
  }
  if (_emailChips.some(c => c.email === val)) {
    errText.textContent = 'すでに追加済みです';
    errEl.style.display = 'flex';
    return;
  }
  if (_emailChips.length >= 10) {
    errText.textContent = '送信先は最大10件です';
    errEl.style.display = 'flex';
    return;
  }
  errEl.style.display = 'none';
  _emailChips.push({ email: val });
  input.value = '';
  renderEmailChips();
  input.focus();
}

function removeEmailChip(email) {
  _emailChips = _emailChips.filter(c => c.email !== email);
  renderEmailChips();
}

function renderEmailChips() {
  const list = document.getElementById('emailChipList');
  list.innerHTML = _emailChips.map(c => `
    <span style="display:inline-flex;align-items:center;gap:5px;background:rgba(33,150,243,.12);
      color:#1565C0;padding:3px 10px 3px 12px;border-radius:20px;font-size:12px;font-weight:600;">
      ${h(c.email)}
      <button onclick="removeEmailChip('${h(c.email)}')"
        style="background:none;border:none;cursor:pointer;color:#1565C0;padding:0;font-size:12px;line-height:1;display:flex;align-items:center;">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </span>
  `).join('');
}

function setEmailBtnsLoading(loading) {
  ['emailMailtoBtn', 'emailGmailBtn'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.disabled = loading;
  });
}

/* 宛先・件名・本文を同期で組み立てる（先行発行済みの URL を使用） */
function _buildEmailContent() {
  if (!_emailPregenShare?.url) return null;

  const inputEl = document.getElementById('emailInput');
  const pending = inputEl.value.trim().replace(/,$/, '');
  if (pending && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pending) && !_emailChips.some(c => c.email === pending)) {
    _emailChips.push({ email: pending });
    inputEl.value = '';
    renderEmailChips();
  }

  const message = document.getElementById('emailMessage').value.trim();
  const subject = `【What'sNo】${_emailFileName} を共有します`;
  const lines = [];
  if (message) { lines.push(message, ''); }
  lines.push('▼ ファイルはこちらからご確認ください');
  lines.push(_emailPregenShare.url);
  lines.push('');
  lines.push('※ リンクからダウンロードできます（有効期限：発行から30日）');
  const body = lines.join('\r\n');
  const to   = _emailChips.map(c => c.email).join(',');

  return { to, subject, body };
}

/* Gmail の作成画面を開く */
function doSendEmailGmail() {
  const m = _buildEmailContent();
  if (!m) { wnShowToast('共有リンクを生成中です。少々お待ちください', 'info'); return; }

  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (isMobile) {
    // モバイルは googlegmail:// アプリURLスキームを試みる
    // アプリ未インストールの場合は 1.5 秒後に mailto にフォールバック
    const gmailScheme = 'googlegmail://co'
      + `?to=${encodeURIComponent(m.to)}`
      + `&subject=${encodeURIComponent(m.subject)}`
      + `&body=${encodeURIComponent(m.body)}`;
    window.location.href = gmailScheme;
    setTimeout(() => {
      if (!document.hidden) {
        window.location.href = `mailto:${m.to}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
        wnShowToast('メールアプリを起動しました', 'success');
      }
    }, 1500);
  } else {
    const url = 'https://mail.google.com/mail/?view=cm&fs=1'
      + `&to=${encodeURIComponent(m.to)}`
      + `&su=${encodeURIComponent(m.subject)}`
      + `&body=${encodeURIComponent(m.body)}`;
    window.open(url, '_blank');
    wnShowToast('Gmailの作成画面を開きました', 'success');
  }
  closeEmailModal();
}

/* 既定のメールアプリ（Outlook等）を mailto で起動 */
function doSendEmailMailto() {
  const m = _buildEmailContent();
  if (!m) { wnShowToast('共有リンクを生成中です。少々お待ちください', 'info'); return; }
  const url = `mailto:${m.to}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
  window.location.href = url;
  wnShowToast('メールアプリを起動しました', 'success');
  closeEmailModal();
}
