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

let _activePdfRenderTask = null;  // 現在実行中のPDFレンダリングタスク（タイムアウト制御用）
let _pdfLoadGeneration   = 0;     // loadPdfPreview の呼び出し世代番号（古い呼び出しを無効化）

/* ── ズーム状態 ── */
let pdfZoomFactor    = 1.0;
let pdfBaseCssW      = 0;
let pdfBaseCssH      = 0;
let imgZoomFactor    = 1.0;
let imgPanX          = 0;   // 画像ドラッグ移動オフセット(px)
let imgPanY          = 0;
let imgPreviewRot    = 0;   // 画像ビューア回転: 0 | 90 | 180 | 270
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
      zoomImg(img, factor);
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

/* 画像をズーム（倍率を乗算。ホイール／ボタン共通） */
function zoomImg(img, factor) {
  imgZoomFactor = Math.max(0.25, Math.min(4.0, imgZoomFactor * factor));
  if (imgZoomFactor <= 1.0) { imgPanX = 0; imgPanY = 0; }  // 等倍以下は再センタリング
  img.style.transformOrigin = 'center center';
  img.style.cursor          = imgZoomFactor > 1.0 ? 'grab' : '';
  applyImgTransform(img);
  showPreviewZoomLabel(Math.round(imgZoomFactor * 100) + '%');
}

/* 画像の transform（移動＋回転＋拡大）を適用 */
function applyImgTransform(img) {
  /* 90°/270° 回転時は縦横が入れ替わるため、エリアに収まるよう補正倍率をかける */
  let rotFit = 1;
  if (imgPreviewRot === 90 || imgPreviewRot === 270) {
    const area = document.getElementById('previewArea');
    if (area && img.offsetWidth && img.offsetHeight) {
      const ar = area.getBoundingClientRect();
      rotFit = Math.min(1, ar.width / img.offsetHeight, ar.height / img.offsetWidth);
    }
  }
  img.style.transformOrigin = 'center center';
  img.style.transform = `translate(${imgPanX}px, ${imgPanY}px) rotate(${imgPreviewRot}deg) scale(${imgZoomFactor * rotFit})`;
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
  initAaPostModal();
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

/* 全ページをグリッド描画（ページ数が少ない場合は高さフィットの大表示） */
async function renderPdfGrid() {
  if (!pdfPreviewDoc) return;
  const area = document.getElementById('previewArea');

  let grid = document.getElementById('pdfGridContainer');
  if (!grid) {
    grid = document.createElement('div');
    grid.id = 'pdfGridContainer';
    area.appendChild(grid);
  }
  if (pdfGridRendered) return;

  const total   = pdfPreviewDoc.numPages;
  const areaW   = area.clientWidth  || 900;
  const areaH   = area.clientHeight || 600;
  /* ≤4ページ: 高さをフルに使った大表示モード */
  const bigMode = total <= 4;

  if (bigMode) {
    /* スクロール不要・高さフィット */
    grid.style.cssText =
      'display:none;width:100%;height:100%;overflow:hidden;background:#525659;' +
      'box-sizing:border-box;';
    /* 4ページは 2×2、それ以外は横一列 */
    const cols = total === 4 ? 2 : total;
    const rows = total === 4 ? 2 : 1;
    const colTemplate = `repeat(${cols}, 1fr)`;
    const rowTemplate = rows > 1 ? `repeat(${rows}, 1fr)` : '';
    /* 表示可能な最大サイズ（padding 12px×2 = 24px） */
    const maxH = Math.floor((areaH - 24 - (rows - 1) * 12) / rows);
    const maxW = Math.floor((areaW - 24 - (cols - 1) * 12) / cols);
    /* 高さ基準でレンダリング（Retina×2）、横長ページでも maxW 内に収まるよう両辺を渡す */
    const RENDER_H = maxH * 2;
    grid.innerHTML =
      `<div id="pdfGridInner" style="display:grid;grid-template-columns:${colTemplate};` +
      (rowTemplate ? `grid-template-rows:${rowTemplate};` : '') +
      `gap:12px;height:100%;padding:12px;box-sizing:border-box;align-items:center;"></div>`;
    const inner = grid.querySelector('#pdfGridInner');

    for (let n = 1; n <= total; n++) {
      /* セル自体は透明・サイズなし — ページコンテンツにぴったり合う wrap div に白背景を乗せる */
      const cell = document.createElement('div');
      cell.style.cssText = 'cursor:pointer;display:flex;align-items:center;justify-content:center;';
      const wrap = document.createElement('div');
      wrap.style.cssText =
        'position:relative;line-height:0;background:#fff;border-radius:4px;' +
        'overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.45);transition:outline .1s;';
      wrap.innerHTML =
        `<canvas style="display:block;max-width:${maxW}px;max-height:${maxH}px;width:auto;height:auto;"></canvas>` +
        `<span style="position:absolute;bottom:6px;right:8px;background:rgba(0,0,0,.6);` +
        `color:#fff;font-size:11px;border-radius:10px;padding:2px 8px;">p.${n}</span>`;
      cell.appendChild(wrap);
      cell.addEventListener('mouseenter', () => wrap.style.outline = '3px solid #1976d2');
      cell.addEventListener('mouseleave', () => wrap.style.outline = 'none');
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
      const scale   = RENDER_H / baseVP.height;
      const vp      = page.getViewport({ scale, rotation: _totRot });
      const canvas  = wrap.querySelector('canvas');
      canvas.width  = vp.width;
      canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    }
  } else {
    /* 多ページ: サムネイルグリッド */
    grid.style.cssText =
      'display:none;width:100%;height:100%;overflow:auto;background:#525659;' +
      'padding:12px;box-sizing:border-box;';
    const cols        = total <= 9 ? 3 : total <= 12 ? 4 : 0;
    const colTemplate = cols > 0
      ? `repeat(${cols}, 1fr)`
      : 'repeat(auto-fit,minmax(240px,1fr))';
    const THUMB_RENDER_W = cols > 0
      ? Math.round((areaW - 24 - (cols - 1) * 12) / cols) * 2
      : 480;
    grid.innerHTML =
      `<div id="pdfGridInner" style="display:grid;grid-template-columns:${colTemplate};gap:12px;"></div>`;
    const inner = grid.querySelector('#pdfGridInner');

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
  }   /* end if(bigMode)/else */
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
  const MAX_DIM      = window.innerWidth <= 768 ? 2048 : 4096;
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

  _activePdfRenderTask?.cancel();
  const _reRenderTask = page.render({ canvasContext: ctx, viewport });
  _activePdfRenderTask = _reRenderTask;
  const _reRenderTid = setTimeout(() => {
    if (_activePdfRenderTask === _reRenderTask) _reRenderTask.cancel();
  }, 20_000);
  try { await _reRenderTask.promise; }
  catch (e) {
    clearTimeout(_reRenderTid);
    if (_activePdfRenderTask === _reRenderTask) _activePdfRenderTask = null;
    if (e?.name !== 'RenderingCancelledException') throw e;
    return;   // キャンセル（タイムアウトまたは上書き）は黙って終了
  }
  clearTimeout(_reRenderTid);
  if (_activePdfRenderTask === _reRenderTask) _activePdfRenderTask = null;
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
  /* 回転を上書き保存できるのは実PDFのみ（PowerPoint変換表示は元が.pptxなので対象外） */
  const ext = (fileData?.file_name?.split('.').pop() || '').toLowerCase();
  const rotSavable = ext === 'pdf' || (fileData?.mime_type === 'application/pdf');
  const sepStyle = 'width:1px;height:18px;background:rgba(255,255,255,.25);margin:0 2px;';
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
    ${rotSavable ? `
    <span id="pdfRotSaveSep" style="${sepStyle};display:none;"></span>
    <button id="pdfRotSave" title="回転を上書き保存（全ページ）" style="${btnStyle};display:none;color:#FFD54F;">
      <i class="fa-solid fa-floppy-disk"></i>
    </button>` : ''}
  `;
  document.getElementById('previewArea').appendChild(bar);

  bar.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('mouseenter', () => btn.style.background = 'rgba(255,255,255,.2)');
    btn.addEventListener('mouseleave', () => btn.style.background = 'none');
  });

  /* 回転状態に応じて「保存」ボタンの表示を切り替える */
  const updateSaveBtn = () => {
    const saveBtn = bar.querySelector('#pdfRotSave');
    const saveSep = bar.querySelector('#pdfRotSaveSep');
    if (!saveBtn) return;
    const show = pdfPreviewRot !== 0 ? '' : 'none';
    saveBtn.style.display = show;
    if (saveSep) saveSep.style.display = show;
  };

  async function applyRotate(delta) {
    pdfPreviewRot = (pdfPreviewRot + delta + 360) % 360;
    pdfGridRendered = false;  /* グリッドのサムネイルも回転を反映させるため無効化 */
    if (pdfViewMode === 'grid') {
      await renderPdfGrid();
    } else {
      await reRenderPdfPreviewPage();
    }
    updateSaveBtn();
  }
  bar.querySelector('#pdfRotCCW').addEventListener('click', () => applyRotate(-90));
  bar.querySelector('#pdfRotCW').addEventListener('click', () => applyRotate(90));
  bar.querySelector('#pdfViewToggle')?.addEventListener('click', () =>
    setPdfViewMode(pdfViewMode === 'grid' ? 'single' : 'grid'));
  bar.querySelector('#pdfRotSave')?.addEventListener('click', () => savePdfRotation());
}

/* 現在のビューア回転を全ページに焼き込んで元PDFを上書き保存する */
async function savePdfRotation() {
  if (pdfPreviewRot === 0) return;
  if (typeof PDFLib === 'undefined') { wnShowToast('pdf-libが読み込まれていません', 'danger'); return; }
  if (!confirm('現在の回転を全ページに焼き込んで元PDFに上書き保存します。よろしいですか？\n（元の向きには戻せません）')) return;

  const saveBtn = document.getElementById('pdfRotSave');
  const origHtml = saveBtn ? saveBtn.innerHTML : '';
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }

  try {
    const buffer = await wnFetchFileBuffer(fileId);
    if (!buffer) throw new Error('ファイルの取得に失敗しました');

    const pdfLibDoc = await PDFLib.PDFDocument.load(buffer, { ignoreEncryption: true });
    pdfLibDoc.getPages().forEach(pg => {
      const cur = pg.getRotation?.()?.angle ?? 0;
      pg.setRotation(PDFLib.degrees((cur + pdfPreviewRot) % 360));
    });
    const bytes = await pdfLibDoc.save();
    const blob  = new Blob([bytes], { type: 'application/pdf' });

    const file = new File([blob], fileData.file_name, { type: 'application/pdf' });
    const res  = await wnOverwriteFile(fileId, file);
    if (!res?.data) throw new Error('保存に失敗しました');

    /* プレビューキャッシュは updated_at をキーに含むため、変化により次回自動ミス→最新PDF取得 */

    /* ダッシュボードのサムネイルを即時反映（回転後の1ページ目で先行生成） */
    await preGeneratePdfThumb(res.data.updated_at).catch(() => {});

    wnShowToast('回転を保存しました', 'success');
    setTimeout(() => location.reload(), 600);
  } catch (e) {
    console.error('pdf rotate save error:', e);
    wnShowToast('保存エラー: ' + e.message, 'danger');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origHtml; }
  }
}

/* 回転後のPDF 1ページ目から、ダッシュボードと同じパイプラインでサムネイルを先行生成 */
async function preGeneratePdfThumb(updatedAt) {
  if (!pdfPreviewDoc) return;
  const page     = await pdfPreviewDoc.getPage(1);
  const _defVP   = page.getViewport({ scale: 1 });
  /* 保存後のPDFは回転が焼き込まれるため、ダッシュボードが描く向き＝intrinsic+pdfPreviewRot */
  const rotation = (_defVP.rotation + pdfPreviewRot) % 360;
  const base     = page.getViewport({ scale: 1, rotation });
  const scale    = Math.min(4, Math.max(1.5, 2600 / Math.max(base.width, base.height)));
  const viewport = page.getViewport({ scale, rotation });
  const canvas   = document.createElement('canvas');
  canvas.width   = Math.round(viewport.width);
  canvas.height  = Math.round(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

  /* ダッシュボードのPDFサムネと同じ順序：余白カット → 高品質縮小 → 線画強調 */
  const trimmed = fdThumbTrim(canvas);
  const out     = fdThumbShrink(trimmed, fdThumbTargetLong());
  fdThumbEnhance(out);
  const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.90));
  if (blob) await writeThumbToCache(fileId, updatedAt, blob);
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
  imgPreviewRot = 0;
  const area = document.getElementById('previewArea');
  if (area) area.style.overscrollBehavior = 'contain';
  if (imgEl) initImgPan(imgEl);
  if (imgEl) addImgRotateOverlay(imgEl);
}

/* 画像プレビューエリアに拡大・縮小・回転ボタンのオーバーレイを追加 */
function addImgRotateOverlay(imgEl) {
  document.getElementById('imgRotateBar')?.remove();
  const bar = document.createElement('div');
  bar.id = 'imgRotateBar';
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

  /* 回転を焼き込んで上書き保存できる形式のみ「保存」ボタンを出す */
  const ext = (fileData?.file_name?.split('.').pop() || '').toLowerCase();
  const rotSavable = ['png', 'jpg', 'jpeg', 'webp'].includes(ext);

  const sepStyle = 'width:1px;height:18px;background:rgba(255,255,255,.25);margin:0 2px;';
  bar.innerHTML = `
    <button id="imgZoomOut" title="縮小" style="${btnStyle}">
      <i class="fa-solid fa-magnifying-glass-minus"></i>
    </button>
    <button id="imgZoomIn" title="拡大" style="${btnStyle}">
      <i class="fa-solid fa-magnifying-glass-plus"></i>
    </button>
    <button id="imgZoomReset" title="等倍に戻す" style="${btnStyle}">
      <i class="fa-solid fa-expand"></i>
    </button>
    <span style="${sepStyle}"></span>
    <button id="imgRotCCW" title="左90°回転" style="${btnStyle}">
      <i class="fa-solid fa-rotate-left"></i>
    </button>
    <button id="imgRotCW" title="右90°回転" style="${btnStyle}">
      <i class="fa-solid fa-rotate-right"></i>
    </button>
    ${rotSavable ? `
    <span id="imgRotSaveSep" style="${sepStyle};display:none;"></span>
    <button id="imgRotSave" title="回転を上書き保存" style="${btnStyle};display:none;color:#FFD54F;">
      <i class="fa-solid fa-floppy-disk"></i>
    </button>` : ''}
  `;
  document.getElementById('previewArea').appendChild(bar);

  bar.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('mouseenter', () => btn.style.background = 'rgba(255,255,255,.2)');
    btn.addEventListener('mouseleave', () => btn.style.background = 'none');
  });

  /* 回転状態に応じて「保存」ボタンの表示を切り替える */
  const updateSaveBtn = () => {
    const saveBtn = bar.querySelector('#imgRotSave');
    const saveSep = bar.querySelector('#imgRotSaveSep');
    if (!saveBtn) return;
    const show = imgPreviewRot !== 0 ? '' : 'none';
    saveBtn.style.display = show;
    if (saveSep) saveSep.style.display = show;
  };

  const applyRotate = (delta) => {
    imgPreviewRot = (imgPreviewRot + delta + 360) % 360;
    /* 回転後は中央に戻す（パン位置をリセット） */
    imgPanX = 0;
    imgPanY = 0;
    applyImgTransform(imgEl);
    updateSaveBtn();
  };
  bar.querySelector('#imgZoomIn').addEventListener('click', () => zoomImg(imgEl, 1.25));
  bar.querySelector('#imgZoomOut').addEventListener('click', () => zoomImg(imgEl, 0.8));
  bar.querySelector('#imgZoomReset').addEventListener('click', () => {
    imgZoomFactor = 1.0;
    imgPanX = 0;
    imgPanY = 0;
    imgEl.style.cursor = '';
    applyImgTransform(imgEl);
    showPreviewZoomLabel('100%');
  });
  bar.querySelector('#imgRotCCW').addEventListener('click', () => applyRotate(-90));
  bar.querySelector('#imgRotCW').addEventListener('click', () => applyRotate(90));
  bar.querySelector('#imgRotSave')?.addEventListener('click', () => saveImageRotation(ext));
}

/* 現在の回転を焼き込んで元ファイルに上書き保存する（画像のみ） */
async function saveImageRotation(ext) {
  if (imgPreviewRot === 0) return;
  if (!confirm('現在の回転を元ファイルに上書き保存します。よろしいですか？\n（元の向きには戻せません）')) return;

  const saveBtn = document.getElementById('imgRotSave');
  const origHtml = saveBtn ? saveBtn.innerHTML : '';
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }

  try {
    /* canvas へ書き出すため CORS クリーンな画像を別途読み込む（表示中imgはtaintされうる） */
    const src = await new Promise((resolve, reject) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload  = () => resolve(im);
      im.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
      im.src = wnPublicViewUrl(fileId);
    });

    const rot  = imgPreviewRot;
    const swap = (rot === 90 || rot === 270);
    const w = src.naturalWidth, h = src.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width  = swap ? h : w;
    canvas.height = swap ? w : h;
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, -w / 2, -h / 2, w, h);

    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const quality = mime === 'image/png' ? undefined : 0.92;
    const blob = await new Promise(r => canvas.toBlob(r, mime, quality));
    if (!blob) throw new Error('画像の生成に失敗しました');

    const file = new File([blob], fileData.file_name, { type: mime });
    const res  = await wnOverwriteFile(fileId, file);
    if (!res?.data) throw new Error('保存に失敗しました');

    /* ダッシュボードのサムネイルを即時反映：回転後blobを同じキャッシュキーで先行書き込み
       （画像のサムネイルは元blobそのものなので再利用できる） */
    await writeThumbToCache(fileId, res.data.updated_at, blob).catch(() => {});

    wnShowToast('回転を保存しました', 'success');
    /* 保存後の向きで再読み込み */
    setTimeout(() => location.reload(), 600);
  } catch (e) {
    console.error('rotate save error:', e);
    wnShowToast('保存エラー: ' + e.message, 'danger');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origHtml; }
  }
}

/* ダッシュボードのサムネイルキャッシュ（IndexedDB: wn-thumb-cache / thumbs）へ
   生成済みサムネイルblobを先行書き込みする（画像・PDF共通）。キー形式・バージョンは
   wn-dashboard.js の THUMB_VER と必ず一致させること（不一致だとヒットせず再生成される）。 */
const FD_THUMB_VER = 'v9';
function writeThumbToCache(id, updatedAt, blob) {
  const cacheKey = `thumb_${id}_${updatedAt ?? ''}_${FD_THUMB_VER}`;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('wn-thumb-cache', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('thumbs')) db.createObjectStore('thumbs');
    };
    req.onsuccess = e => {
      try {
        const db = e.target.result;
        const tx = db.transaction('thumbs', 'readwrite');
        const store = tx.objectStore('thumbs');
        /* 同ファイルの古いサムネイル（旧 updated_at）を一掃 */
        const cur = store.openCursor();
        cur.onsuccess = ev => {
          const c = ev.target.result;
          if (c) {
            if (String(c.key).startsWith(`thumb_${id}_`)) c.delete();
            c.continue();
          }
        };
        store.put(blob, cacheKey);
        tx.oncomplete = () => {
          /* ダッシュボード側のメモリキャッシュを次回表示時に破棄させる */
          localStorage.setItem('wn_thumb_bust', String(id));
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      } catch (err) { reject(err); }
    };
    req.onerror = () => reject(req.error);
  });
}

/* ── サムネイル生成パイプライン（wn-dashboard.js と同実装・PDFサムネ先行生成用） ── */
/* 保存するサムネイルの長辺ピクセル */
function fdThumbTargetLong() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return Math.round(Math.min(1440, Math.max(720, 720 * dpr)));
}

/* 高品質縮小: 1/2ずつ段階縮小して細線がかすれるのを防ぐ */
function fdThumbShrink(src, targetLong) {
  let cur = src;
  while (Math.max(cur.width, cur.height) > targetLong * 2) {
    const next = document.createElement('canvas');
    next.width  = Math.max(1, Math.round(cur.width  / 2));
    next.height = Math.max(1, Math.round(cur.height / 2));
    const ctx = next.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
  }
  if (Math.max(cur.width, cur.height) > targetLong) {
    const ratio = targetLong / Math.max(cur.width, cur.height);
    const next  = document.createElement('canvas');
    next.width  = Math.max(1, Math.round(cur.width  * ratio));
    next.height = Math.max(1, Math.round(cur.height * ratio));
    const ctx = next.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
  }
  return cur;
}

/* 余白自動トリミング: 四隅色を背景とみなし、内容の外接矩形+少しの余白で切り出す */
function fdThumbTrim(canvas, pad = 0.03) {
  try {
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    const d = ctx.getImageData(0, 0, w, h).data;
    const idx = (x, y) => (y * w + x) * 4;
    let br = 0, bg = 0, bb = 0;
    for (const [x, y] of [[0,0],[w-1,0],[0,h-1],[w-1,h-1]]) {
      const i = idx(x, y); br += d[i]; bg += d[i+1]; bb += d[i+2];
    }
    br /= 4; bg /= 4; bb /= 4;
    const isBg = i => Math.abs(d[i]-br) + Math.abs(d[i+1]-bg) + Math.abs(d[i+2]-bb) < 48;
    const stepX = Math.max(1, Math.floor(w / 600));
    const stepY = Math.max(1, Math.floor(h / 600));
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y += stepY) {
      for (let x = 0; x < w; x += stepX) {
        if (!isBg(idx(x, y))) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return canvas;
    minX = Math.max(0, minX - Math.round(w * pad));
    maxX = Math.min(w - 1, maxX + Math.round(w * pad));
    minY = Math.max(0, minY - Math.round(h * pad));
    maxY = Math.min(h - 1, maxY + Math.round(h * pad));
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    if (cw < w * 0.3 || ch < h * 0.3) return canvas;
    if (cw > w * 0.95 && ch > h * 0.95) return canvas;
    const out = document.createElement('canvas');
    out.width = cw; out.height = ch;
    out.getContext('2d').drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
    return out;
  } catch { return canvas; }
}

/* 線画強調: アンシャープマスク＋ガンマで細線をくっきりさせる */
function fdThumbEnhance(canvas, amount = 1.3, gamma = 1.55) {
  try {
    const w = canvas.width, h = canvas.height;
    const ctx  = canvas.getContext('2d');
    const blur = document.createElement('canvas');
    blur.width = w; blur.height = h;
    const bctx = blur.getContext('2d');
    bctx.filter = 'blur(1px)';
    bctx.drawImage(canvas, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const bim = bctx.getImageData(0, 0, w, h);
    const s = img.data, b = bim.data;
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * Math.pow(v / 255, gamma));
    for (let i = 0; i < s.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        let v = s[i+c] + amount * (s[i+c] - b[i+c]);
        v = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
        s[i+c] = lut[v];
      }
    }
    ctx.putImageData(img, 0, 0);
  } catch {}
}

/* ── 1本指ドラッグでPDFをパン、2本指ピンチでズーム ── */
function initPdfPan(container) {
  if (container._panInit) return;
  container._panInit = true;

  const ptrs = new Map();              // pointerId → {x, y}
  let panning = false, panPtrId = null;
  let startX = 0, startY = 0, startPX = 0, startPY = 0;
  let pinching = false, pinchStartDist = 0, pinchStartZoom = 1;

  container.addEventListener('pointerdown', e => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (ptrs.size >= 2) {
      /* 2本目が触れたらパン中止してピンチ開始 */
      if (panning) {
        panning = false;
        try { container.releasePointerCapture(panPtrId); } catch (_) {}
        panPtrId = null;
        container.style.cursor = '';
        container.style.userSelect = '';
      }
      if (ptrs.size === 2) {
        pinching = true;
        const [a, b] = [...ptrs.values()];
        pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
        pinchStartZoom = pdfZoomFactor;
      }
      return;
    }

    /* 1本指パン（拡大中のみ有効） */
    if (e.button !== 0) return;
    const pannable = pdfBaseCssW * pdfZoomFactor > container.clientWidth ||
                     pdfBaseCssH * pdfZoomFactor > container.clientHeight;
    if (!pannable) return;
    e.preventDefault();
    panning  = true;
    panPtrId = e.pointerId;
    startX   = e.clientX; startY = e.clientY;
    startPX  = pdfPanX;   startPY = pdfPanY;
    container.setPointerCapture(e.pointerId);
    container.style.cursor     = 'grabbing';
    container.style.userSelect = 'none';
  });

  container.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinching && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStartDist > 0) {
        pdfZoomFactor = Math.max(0.25, Math.min(4.0, pinchStartZoom * (dist / pinchStartDist)));
        if (pdfZoomFactor <= 1.0) { pdfPanX = 0; pdfPanY = 0; }
        const canvas = document.getElementById('pdfCanvas');
        if (canvas && pdfBaseCssW) {
          applyPdfTransform(canvas);
          showPreviewZoomLabel(Math.round(pdfZoomFactor * 100) + '%');
          updatePdfPanCursor();
        }
      }
      return;
    }

    if (!panning) return;
    pdfPanX = startPX + (e.clientX - startX);
    pdfPanY = startPY + (e.clientY - startY);
    const canvas = document.getElementById('pdfCanvas');
    if (canvas) applyPdfTransform(canvas);
  });

  const endPan = e => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinching = false;
    if (!panning || e.pointerId !== panPtrId) return;
    panning  = false;
    panPtrId = null;
    try { container.releasePointerCapture(e.pointerId); } catch (_) {}
    container.style.userSelect = '';
    updatePdfPanCursor();
  };
  container.addEventListener('pointerup', endPan);
  container.addEventListener('pointercancel', endPan);
}

/* ── 1本指ドラッグで画像をパン、2本指ピンチでズーム ── */
function initImgPan(imgEl) {
  imgEl.draggable = false;

  const ptrs = new Map();
  let panning = false, panPtrId = null;
  let startX = 0, startY = 0, startPX = 0, startPY = 0;
  let pinching = false, pinchStartDist = 0, pinchStartZoom = 1;

  imgEl.addEventListener('pointerdown', e => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (ptrs.size >= 2) {
      /* 2本目が触れたらパン中止してピンチ開始 */
      if (panning) {
        panning = false;
        try { imgEl.releasePointerCapture(panPtrId); } catch (_) {}
        panPtrId = null;
        imgEl.style.cursor = imgZoomFactor > 1.0 ? 'grab' : '';
      }
      if (ptrs.size === 2) {
        pinching = true;
        const [a, b] = [...ptrs.values()];
        pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
        pinchStartZoom = imgZoomFactor;
      }
      return;
    }

    /* 1本指パン（拡大中のみ有効） */
    if (e.button !== 0 || imgZoomFactor <= 1.0) return;
    e.preventDefault();
    panning  = true;
    panPtrId = e.pointerId;
    startX   = e.clientX; startY = e.clientY;
    startPX  = imgPanX;   startPY = imgPanY;
    imgEl.setPointerCapture(e.pointerId);
    imgEl.style.cursor = 'grabbing';
  });

  imgEl.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinching && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStartDist > 0) {
        imgZoomFactor = Math.max(0.25, Math.min(4.0, pinchStartZoom * (dist / pinchStartDist)));
        if (imgZoomFactor <= 1.0) { imgPanX = 0; imgPanY = 0; }
        applyImgTransform(imgEl);
        showPreviewZoomLabel(Math.round(imgZoomFactor * 100) + '%');
      }
      return;
    }

    if (!panning) return;
    imgPanX = startPX + (e.clientX - startX);
    imgPanY = startPY + (e.clientY - startY);
    clampImgPan(imgEl);
    applyImgTransform(imgEl);
  });

  const endPan = e => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinching = false;
    if (!panning || e.pointerId !== panPtrId) return;
    panning  = false;
    panPtrId = null;
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
  /* 90°/270° 回転時は縦横が入れ替わる＋収まり補正倍率を反映 */
  const rotated = (imgPreviewRot === 90 || imgPreviewRot === 270);
  let rotFit = 1;
  if (rotated && imgEl.offsetWidth && imgEl.offsetHeight) {
    rotFit = Math.min(1, ar.width / imgEl.offsetHeight, ar.height / imgEl.offsetWidth);
  }
  const baseW = rotated ? imgEl.offsetHeight : imgEl.offsetWidth;
  const baseH = rotated ? imgEl.offsetWidth  : imgEl.offsetHeight;
  /* 拡大後の実寸（transform後の見た目サイズ） */
  const dispW = baseW * imgZoomFactor * rotFit;
  const dispH = baseH * imgZoomFactor * rotFit;
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
  const gen = ++_pdfLoadGeneration;   // この呼び出しの世代番号
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
    pdfPreviewDoc  = await pdfjsLib.getDocument({
      data: buffer,
      cMapUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/standard_fonts/',
    }).promise;
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
    /* モバイルはメモリ節約のため上限を下げる（4096²≈64MB → 2048²≈16MB） */
    const MAX_CANVAS_DIM   = window.innerWidth <= 768 ? 2048 : 4096;
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

    /* 旧レンダリングをキャンセルして新しいタスクを開始（タイムアウト20秒） */
    _activePdfRenderTask?.cancel();
    const _renderTask = page.render({ canvasContext: ctx, viewport });
    _activePdfRenderTask = _renderTask;
    let _renderTimedOut = false;
    const _rendTid = setTimeout(() => {
      _renderTimedOut = true;
      if (_activePdfRenderTask === _renderTask) _renderTask.cancel();
    }, 20_000);
    try { await _renderTask.promise; }
    catch (e) {
      clearTimeout(_rendTid);
      if (_activePdfRenderTask === _renderTask) _activePdfRenderTask = null;
      if (e?.name === 'RenderingCancelledException' && _renderTimedOut) {
        throw new Error('PDFのレンダリングがタイムアウトしました（ファイルが大きすぎる可能性があります）');
      }
      throw e;
    }
    clearTimeout(_rendTid);
    if (_activePdfRenderTask === _renderTask) _activePdfRenderTask = null;
    applyPdfTransform(canvas);

    hintEl().textContent = '';

    if (pdfDoc.numPages > 1) {
      renderPdfNav(pdfDoc, page, canvas, ctx, area, 1);
    }
    addPdfRotateOverlay();
    initPdfWheelZoom();
    updatePdfPanCursor();
  } catch (e) {
    /* 新しいロードに追い越された場合はエラー処理をしない */
    if (gen !== _pdfLoadGeneration) return;

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

function renderTags() {
  const list = document.getElementById('tagList');
  const tags = fileData.tags ?? [];
  if (!tags.length) {
    list.innerHTML = '<span style="font-size:13px;color:var(--muted);">タグなし</span>';
    return;
  }
  list.innerHTML = tags.map(t => `
    <span class="tag tag-removable" data-tag-id="${t.id}">
      ${h(t.name)}
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

  document.getElementById('aaPostBtn')?.addEventListener('click', () => {
    openAaPostModal(fileId, fileData?.file_name ?? '');
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
  let allTagsForPicker = [];

  function renderTagPicker(tags) {
    const list = document.getElementById('tagPickerList');
    const currentIds = new Set((fileData.tags ?? []).map(t => String(t.id)));
    if (!tags.length) {
      list.innerHTML = '<span style="font-size:12px;color:var(--muted);">タグがありません</span>';
      return;
    }
    list.innerHTML = tags.map(t => {
      const already = currentIds.has(String(t.id));
      return `<span class="tag${already ? '' : ' tag-selectable'}"
                    data-tag-id="${t.id}"
                    style="cursor:${already ? 'default' : 'pointer'};opacity:${already ? '.4' : '1'};margin:2px;">
                ${h(t.name)}
              </span>`;
    }).join('');

    list.querySelectorAll('.tag-selectable').forEach(el => {
      el.addEventListener('click', async () => {
        const tagId = Number(el.dataset.tagId);
        const tag = await wnAddTag(fileId, tagId);
        if (!tag) { wnShowToast('タグの追加に失敗しました', 'danger'); return; }
        document.getElementById('tagPickerPanel').style.display = 'none';
        document.getElementById('tagPickerSearch').value = '';
        if (!fileData.tags) fileData.tags = [];
        fileData.tags.push(tag);
        renderTags();
      });
    });
  }

  document.getElementById('addTagBtn').addEventListener('click', async () => {
    const panel = document.getElementById('tagPickerPanel');
    const isOpen = panel.style.display !== 'none' && panel.style.display !== '';
    if (isOpen) { panel.style.display = 'none'; return; }
    if (!allTagsForPicker.length) allTagsForPicker = await wnGetTags();
    document.getElementById('tagPickerSearch').value = '';
    renderTagPicker(allTagsForPicker);
    panel.style.display = 'block';
    document.getElementById('tagPickerSearch').focus();
  });

  document.getElementById('tagPickerSearch').addEventListener('input', () => {
    const q = document.getElementById('tagPickerSearch').value.toLowerCase();
    const filtered = allTagsForPicker.filter(t => t.name.toLowerCase().includes(q));
    renderTagPicker(filtered);
  });

  document.addEventListener('click', e => {
    const panel = document.getElementById('tagPickerPanel');
    const btn   = document.getElementById('addTagBtn');
    if (panel && !panel.contains(e.target) && !btn.contains(e.target)) {
      panel.style.display = 'none';
    }
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
  const isAdmin = currentUser && ['jp_admin', 'super_admin'].includes(currentUser.role);
  list.innerHTML = comments.map(c => {
    const isMine  = currentUser && c.user && c.user.id === currentUser.id;
    const canEdit = isMine;
    const canDel  = isMine || isAdmin;
    const actions = (canEdit || canDel) ? `
      <span class="comment-actions">
        ${canEdit ? `<button class="comment-action-btn" data-comment-action="edit" data-id="${c.id}" title="編集"><i class="fa-solid fa-pen"></i></button>` : ''}
        ${canDel  ? `<button class="comment-action-btn danger" data-comment-action="delete" data-id="${c.id}" title="削除"><i class="fa-solid fa-trash"></i></button>` : ''}
      </span>` : '';
    return `
    <div class="comment-item" data-comment-id="${c.id}">
      <div class="comment-avatar">${h((c.user?.name ?? '?').charAt(0))}</div>
      <div class="comment-body-wrap">
        <div class="comment-meta">
          <span class="comment-user">${h(c.user?.name ?? '不明')}</span>
          <span class="comment-date">${wnFormatDate(c.created_at)}</span>
          ${actions}
        </div>
        <div class="comment-text" data-comment-text>${h(c.body).replace(/\n/g, '<br>')}</div>
      </div>
    </div>`;
  }).join('');

  // 編集／削除ボタン
  list.querySelectorAll('[data-comment-action]').forEach(btn => {
    const id     = Number(btn.dataset.id);
    const action = btn.dataset.commentAction;
    const comment = comments.find(c => c.id === id);
    if (action === 'edit') {
      btn.addEventListener('click', () => startEditComment(id, comment?.body ?? ''));
    } else if (action === 'delete') {
      btn.addEventListener('click', () => deleteCommentFlow(id));
    }
  });

  const panelList = document.getElementById('commentList');
  panelList.scrollTop = panelList.scrollHeight;
}

function startEditComment(commentId, currentBody) {
  const item = document.querySelector(`.comment-item[data-comment-id="${commentId}"]`);
  if (!item) return;
  const textEl = item.querySelector('[data-comment-text]');
  if (!textEl || item.querySelector('.comment-edit-area')) return;

  const area = document.createElement('div');
  area.className = 'comment-edit-area';
  area.innerHTML = `
    <textarea rows="3"></textarea>
    <div class="comment-edit-buttons">
      <button class="btn btn-accent btn-sm" data-edit-save>保存</button>
      <button class="btn btn-ghost btn-sm" data-edit-cancel>キャンセル</button>
    </div>`;
  const ta = area.querySelector('textarea');
  ta.value = currentBody;

  textEl.style.display = 'none';
  textEl.after(area);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  const cancel = () => { area.remove(); textEl.style.display = ''; };
  area.querySelector('[data-edit-cancel]').addEventListener('click', cancel);
  area.querySelector('[data-edit-save]').addEventListener('click', async () => {
    const body = ta.value.trim();
    if (!body) { wnShowToast('コメントを入力してください', 'danger'); return; }
    if (body === currentBody) { cancel(); return; }
    const res = await wnUpdateComment(fileId, commentId, body);
    if (res) {
      await loadComments();
    } else {
      wnShowToast('コメントの更新に失敗しました', 'danger');
    }
  });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) area.querySelector('[data-edit-save]').click();
    if (e.key === 'Escape') cancel();
  });
}

async function deleteCommentFlow(commentId) {
  if (!confirm('このコメントを削除しますか？')) return;
  const ok = await wnDeleteComment(fileId, commentId);
  if (ok) {
    await loadComments();
  } else {
    wnShowToast('コメントの削除に失敗しました', 'danger');
  }
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
      <div class="relation-item-thumb-wrap" id="rel-thumb-${r.id}">
        <i class="relation-item-icon ${wnFileIconClass(r.mime_type)}"></i>
      </div>
      <div class="relation-item-footer">
        <span class="relation-item-name" title="${h(r.file_name)}">${h(r.file_name)}</span>
        <div class="relation-item-meta">
          v${r.version}
          ${r.approval_status === 'approved' ? '<span style="color:#6ee7b7;">✓承認済</span>' : ''}
        </div>
      </div>
      <button class="relation-item-del" data-relation-id="${r.relation_id}" title="関連を解除">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </a>
  `).join('');

  loadRelationThumbnails();

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

/* ─────────────────────────────────
   関連ファイルサムネイル
   ───────────────────────────────── */
const RelationThumbCache = (() => {
  const DB_NAME = 'wn-thumb-cache';
  const STORE_NAME = 'thumbs';
  let db = null;
  function open() {
    if (db) return Promise.resolve(db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => { e.target.result.createObjectStore(STORE_NAME); };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }
  async function get(key) {
    try {
      const d = await open();
      return new Promise(resolve => {
        const req = d.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      });
    } catch { return null; }
  }
  async function set(key, blob) {
    try {
      const d = await open();
      return new Promise(resolve => {
        const tx = d.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(blob, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {}
  }
  return { get, set };
})();

const relationThumbMem = {};
const RELATION_THUMB_VER = 'v9';

function loadRelationThumbnails() {
  relationsCache.forEach(r => loadOneRelationThumb(r).catch(() => {}));
}

async function loadOneRelationThumb(r) {
  const wrapEl = document.getElementById(`rel-thumb-${r.id}`);
  if (!wrapEl) return;

  const ext = (r.file_name || '').split('.').pop().toLowerCase();
  const mime = r.mime_type ?? '';
  const cacheKey = `thumb_${r.id}_${r.updated_at ?? r.created_at ?? ''}_${RELATION_THUMB_VER}`;
  const isDoc = mime === 'application/pdf' || ext === 'pdf'
             || ['xlsx','xls','xlsm','docx','docm'].includes(ext);

  function setImg(url) {
    if (wrapEl.querySelector('img')) return;
    if (isDoc) wrapEl.style.background = '#fff';
    const img = document.createElement('img');
    img.alt = '';
    img.style.objectFit      = isDoc ? 'contain' : 'cover';
    img.style.objectPosition = isDoc ? 'top center' : 'center';
    img.onload = () => {
      const icon = wrapEl.querySelector('i');
      if (icon) icon.style.display = 'none';
      wrapEl.appendChild(img);
    };
    img.onerror = () => {};
    img.src = url;
  }

  if (relationThumbMem[cacheKey]) { setImg(relationThumbMem[cacheKey]); return; }

  const cached = await RelationThumbCache.get(cacheKey);
  if (cached) {
    const url = URL.createObjectURL(cached);
    relationThumbMem[cacheKey] = url;
    setImg(url);
    return;
  }

  const directUrl = wnPublicViewUrl(r.id);
  let blob = null;

  try {
    if (mime.startsWith('image/') || ['png','jpg','jpeg','gif','webp','svg'].includes(ext)) {
      const res = await fetch(directUrl);
      if (!res.ok) return;
      blob = await res.blob();

    } else if (mime === 'application/pdf' || ext === 'pdf') {
      if (typeof pdfjsLib === 'undefined') return;
      const pdf = await pdfjsLib.getDocument({
        url: directUrl,
        cMapUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/standard_fonts/',
      }).promise;
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(4, Math.max(1.5, 2600 / Math.max(base.width, base.height)));
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      const trimmed = fdThumbTrim(canvas);
      const out = fdThumbShrink(trimmed, fdThumbTargetLong());
      fdThumbEnhance(out);
      blob = await new Promise(res => out.toBlob(res, 'image/jpeg', 0.90));
    }
  } catch { return; }

  if (!blob) return;
  await RelationThumbCache.set(cacheKey, blob);
  const url = URL.createObjectURL(blob);
  relationThumbMem[cacheKey] = url;
  setImg(url);
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
      <i class="fa-solid fa-magnifying-glass" style="color:var(--muted);"></i> 候補
    </div>
    ${suggestionsCache.map(s => `
      <div class="relation-suggest-item" data-id="${s.id}">
        <div class="relation-item-icon" style="width:28px;height:28px;font-size:12px;">
          <i class="${wnFileIconClass(s.mime_type)}"></i>
        </div>
        <div class="relation-suggest-body">
          <div class="relation-suggest-name" title="${h(s.file_name)}">${h(s.file_name)}</div>
          <div class="relation-suggest-meta">v${s.version}${s.approval_status === 'approved' ? ' · <span style="color:#6ee7b7;">✓承認済</span>' : ''}</div>
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
let _emailPregenShare = null; // モーダルオープン時に先行発行した共有リンク
let _allContactsCache = [];   // 登録済み連絡先（オートコンプリート用）
const WN_MAIL_SIG_KEY = 'wn_mail_signature';

// TO/CC/BCC 共通のチップ状態・要素ID定義
const emailFieldChips = { to: [], cc: [], bcc: [] }; // field → { email: string }[]
const EMAIL_FIELD_IDS = {
  to:  { input: 'emailInput',    addBtn: 'emailAddBtn',    chipList: 'emailChipList',    suggest: 'emailSuggestList',    err: 'emailInputError',    errText: 'emailInputErrorText',    label: '送信先' },
  cc:  { input: 'emailCcInput',  addBtn: 'emailCcAddBtn',  chipList: 'emailCcChipList',  suggest: 'emailCcSuggestList',  err: 'emailCcInputError',  errText: 'emailCcInputErrorText',  label: 'CC' },
  bcc: { input: 'emailBccInput', addBtn: 'emailBccAddBtn', chipList: 'emailBccChipList', suggest: 'emailBccSuggestList', err: 'emailBccInputError', errText: 'emailBccInputErrorText', label: 'BCC' },
};

function initEmailModal() {
  const overlay = document.getElementById('emailModal');
  if (!overlay) return;

  document.getElementById('emailModalClose').addEventListener('click', closeEmailModal);
  document.getElementById('emailCancelBtn').addEventListener('click', closeEmailModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeEmailModal(); });

  // TO/CC/BCC 共通のチップ入力配線
  for (const field of Object.keys(EMAIL_FIELD_IDS)) {
    const ids   = EMAIL_FIELD_IDS[field];
    const input = document.getElementById(ids.input);

    document.getElementById(ids.addBtn).addEventListener('click', () => addEmailChip(field));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addEmailChip(field); }
      if (e.key === 'Escape') { _emailHideSuggest(field); }
    });
    input.addEventListener('input', () => _emailRenderSuggest(field, input.value.trim()));
    input.addEventListener('focus', () => _emailRenderSuggest(field, input.value.trim()));
    document.addEventListener('click', (e) => {
      if (!e.target.closest(`#${ids.suggest}`) && e.target !== input) _emailHideSuggest(field);
    });
  }

  // CC/BCC欄の表示切り替え（普段は隠す）
  document.getElementById('emailCcBccToggleBtn')?.addEventListener('click', () => {
    document.getElementById('emailCcSection').classList.remove('hidden');
    document.getElementById('emailBccSection').classList.remove('hidden');
    document.getElementById('emailCcBccToggleBtn').classList.add('hidden');
    document.getElementById('emailCcInput')?.focus();
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

  // 署名イベント
  document.getElementById('emailSigToggleBtn')?.addEventListener('click', () => {
    const editArea = document.getElementById('emailSigEditArea');
    const open = editArea.style.display === 'none';
    editArea.style.display = open ? 'block' : 'none';
    if (open) document.getElementById('emailSigInput').value = localStorage.getItem(WN_MAIL_SIG_KEY) || '';
  });
  document.getElementById('emailSigSaveBtn')?.addEventListener('click', () => {
    const sig = document.getElementById('emailSigInput').value.trim();
    localStorage.setItem(WN_MAIL_SIG_KEY, sig);
    _emailRenderSigPreview();
    document.getElementById('emailSigEditArea').style.display = 'none';
  });
  document.getElementById('emailSigCancelBtn')?.addEventListener('click', () => {
    document.getElementById('emailSigEditArea').style.display = 'none';
  });
}

function _emailRenderSigPreview() {
  const sig = localStorage.getItem(WN_MAIL_SIG_KEY) || '';
  const el  = document.getElementById('emailSigPreview');
  if (!el) return;
  el.textContent = sig || '（未設定）';
  el.style.color = sig ? 'var(--muted)' : '#bbb';
}

function openEmailModal(fileId, fileName) {
  _emailFileId      = fileId;
  _emailFileName    = fileName;
  _emailPregenShare = null;
  emailFieldChips.to  = [];
  emailFieldChips.cc  = [];
  emailFieldChips.bcc = [];

  document.getElementById('emailModalFileNameText').textContent = fileName;
  document.getElementById('emailMessage').value = '';
  const count = document.getElementById('emailMsgCount');
  if (count) count.textContent = '0';
  document.getElementById('emailCcSection').classList.add('hidden');
  document.getElementById('emailBccSection').classList.add('hidden');
  document.getElementById('emailCcBccToggleBtn').classList.remove('hidden');
  document.getElementById('emailSigEditArea').style.display = 'none';
  for (const field of Object.keys(EMAIL_FIELD_IDS)) {
    const ids = EMAIL_FIELD_IDS[field];
    document.getElementById(ids.input).value = '';
    document.getElementById(ids.err).style.display = 'none';
    renderEmailChips(field);
    _emailHideSuggest(field);
  }
  _emailRenderSigPreview();
  wnGetContacts().then(list => { _allContactsCache = list; }).catch(() => {});

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
  emailFieldChips.to  = [];
  emailFieldChips.cc  = [];
  emailFieldChips.bcc = [];
}

/* ────────────────────────────────
   a.aへ投稿（単一ファイル）
   ──────────────────────────────── */
let _aaPostFileId = null;
let _aaPostBusy   = false;

function initAaPostModal() {
  document.getElementById('aaPostModalClose')?.addEventListener('click', closeAaPostModal);
  document.getElementById('aaPostModalCancelBtn')?.addEventListener('click', closeAaPostModal);
  document.getElementById('aaPostExecBtn')?.addEventListener('click', () => {
    const btn = document.getElementById('aaPostExecBtn');
    if (btn.dataset.mode === 'done') closeAaPostModal();
    else executeAaPost();
  });
  document.getElementById('aaPostViewBtn')?.addEventListener('click', wnOpenAaInNewTab);
}

async function openAaPostModal(fileId, fileName) {
  // 事前会員チェック（フロント側のUX目的。バックエンドfromWnも同様のチェックで二重防御）
  const t = await wnGetAaTicket();
  if (!t || !t.is_member) {
    wnShowToast('この会社はまだa.aに参加していません', 'warning');
    return;
  }

  _aaPostFileId = fileId;
  _aaPostBusy   = false;
  document.getElementById('aaPostFileNameText').textContent = fileName;
  document.getElementById('aaPostCategory').value = '';
  document.getElementById('aaPostBody').value = '';
  document.getElementById('aaPostProgressText').style.display = 'none';
  document.getElementById('aaPostErrorText').style.display = 'none';
  document.getElementById('aaPostResultActions').style.display = 'none';
  const exec = document.getElementById('aaPostExecBtn');
  exec.dataset.mode = 'post';
  setAaPostModalBusy(false);
  document.getElementById('aaPostModal').classList.remove('hidden');
}

function closeAaPostModal() {
  if (_aaPostBusy) return;   // 投稿中は閉じない
  document.getElementById('aaPostModal').classList.add('hidden');
}

function setAaPostModalBusy(busy) {
  _aaPostBusy = busy;
  const exec = document.getElementById('aaPostExecBtn');
  exec.disabled = busy;
  if (busy) exec.textContent = '投稿中…';
  document.getElementById('aaPostModalClose').disabled = busy;
  document.getElementById('aaPostModalCancelBtn').disabled = busy;
  document.getElementById('aaPostCategory').disabled = busy;
  document.getElementById('aaPostBody').disabled = busy;
}

async function executeAaPost() {
  if (_aaPostBusy) return;
  const category = document.getElementById('aaPostCategory').value;
  if (!category) {
    wnShowToast('カテゴリを選択してください', 'warning');
    return;
  }
  const body = document.getElementById('aaPostBody').value.trim();

  setAaPostModalBusy(true);
  const progText = document.getElementById('aaPostProgressText');
  const errText  = document.getElementById('aaPostErrorText');
  progText.style.display = 'block';
  progText.textContent = '投稿中…';
  errText.style.display = 'none';

  try {
    await wnPostToAa(_aaPostFileId, { category, body });
    progText.textContent = '投稿が完了しました';
    document.getElementById('aaPostResultActions').style.display = 'block';
    wnShowToast('a.aへの投稿が完了しました', 'success');
    setAaPostModalBusy(false);
    const exec = document.getElementById('aaPostExecBtn');
    exec.textContent = '閉じる';
    exec.dataset.mode = 'done';
  } catch (e) {
    progText.style.display = 'none';
    errText.style.display = 'block';
    errText.textContent = e.message || '投稿に失敗しました';
    wnShowToast(e.message || 'a.aへの投稿に失敗しました', 'danger');
    setAaPostModalBusy(false);
    document.getElementById('aaPostExecBtn').textContent = '投稿する';
  }
}

function addEmailChip(field = 'to') {
  const input = document.getElementById(EMAIL_FIELD_IDS[field].input);
  const val   = input.value.trim().replace(/,$/, '');
  if (!val) return;
  if (_addEmailToChips(field, val)) {
    input.value = '';
    _emailHideSuggest(field);
  }
  input.focus();
}

// バリデーション込みでチップに追加。成功したら true を返す。
function _addEmailToChips(field, val) {
  const ids     = EMAIL_FIELD_IDS[field];
  const chips   = emailFieldChips[field];
  const errEl   = document.getElementById(ids.err);
  const errText = document.getElementById(ids.errText);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
    errText.textContent = '有効なメールアドレスを入力してください';
    errEl.style.display = 'flex';
    return false;
  }
  if (chips.some(c => c.email === val)) {
    errText.textContent = 'すでに追加済みです';
    errEl.style.display = 'flex';
    return false;
  }
  if (chips.length >= 10) {
    errText.textContent = `${ids.label}は最大10件です`;
    errEl.style.display = 'flex';
    return false;
  }

  errEl.style.display = 'none';
  chips.push({ email: val });
  renderEmailChips(field);
  return true;
}

function removeEmailChip(field, email) {
  emailFieldChips[field] = emailFieldChips[field].filter(c => c.email !== email);
  renderEmailChips(field);
}

// 登録済み連絡先のオートコンプリート候補
function _emailRenderSuggest(field, query) {
  const ids = EMAIL_FIELD_IDS[field];
  const box = document.getElementById(ids.suggest);
  if (!box) return;

  const addedEmails = new Set(emailFieldChips[field].map(c => c.email));
  const q = query.toLowerCase();
  const candidates = _allContactsCache.filter(c => !addedEmails.has(c.email));
  const matches = q
    ? candidates.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.name_kana || '').toLowerCase().includes(q) ||
        (c.company_name || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q))
    : candidates;

  if (!matches.length) { _emailHideSuggest(field); return; }

  box.innerHTML = matches.slice(0, 8).map(c => `
    <div class="email-suggest-item" data-email="${h(c.email)}"
      style="padding:7px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border);">
      <div style="font-weight:600;color:var(--primary);">${h(c.name)}${c.company_name ? `　<span style="font-weight:400;color:var(--muted);">${h(c.company_name)}</span>` : ''}</div>
      <div style="color:var(--muted);">${h(c.email)}</div>
    </div>
  `).join('');
  box.querySelectorAll('.email-suggest-item').forEach(el => {
    el.addEventListener('mouseenter', () => { el.style.background = 'rgba(33,150,243,.08)'; });
    el.addEventListener('mouseleave', () => { el.style.background = ''; });
    el.addEventListener('click', () => {
      const input = document.getElementById(ids.input);
      if (_addEmailToChips(field, el.dataset.email)) {
        input.value = '';
        _emailHideSuggest(field);
      }
      input.focus();
    });
  });
  box.classList.remove('hidden');
}

function _emailHideSuggest(field) {
  document.getElementById(EMAIL_FIELD_IDS[field].suggest)?.classList.add('hidden');
}

function renderEmailChips(field) {
  const ids  = EMAIL_FIELD_IDS[field];
  const list = document.getElementById(ids.chipList);
  list.innerHTML = emailFieldChips[field].map(c => `
    <span style="display:inline-flex;align-items:center;gap:5px;background:rgba(33,150,243,.12);
      color:#1565C0;padding:3px 10px 3px 12px;border-radius:20px;font-size:12px;font-weight:600;">
      ${h(c.email)}
      <button onclick="removeEmailChip('${field}','${h(c.email)}')"
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

  // 「追加」を押さずに入力欄に残っている値も送信直前に取り込む（TO/CC/BCC共通）
  for (const field of Object.keys(EMAIL_FIELD_IDS)) {
    const inputEl = document.getElementById(EMAIL_FIELD_IDS[field].input);
    const pending = inputEl.value.trim().replace(/,$/, '');
    if (pending && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pending) && !emailFieldChips[field].some(c => c.email === pending)) {
      emailFieldChips[field].push({ email: pending });
      inputEl.value = '';
      renderEmailChips(field);
    }
  }

  const message = document.getElementById('emailMessage').value.trim();
  const subject = `【What'sNo】${_emailFileName} を共有します`;
  const sig     = localStorage.getItem(WN_MAIL_SIG_KEY) || '';
  const sigText = sig ? `\r\n\r\n--\r\n${sig}` : '';
  const lines = [];
  if (message) { lines.push(message, ''); }
  lines.push('▼ ファイルはこちらからご確認ください');
  lines.push(_emailPregenShare.url);
  lines.push('');
  lines.push('※ リンクからダウンロードできます（有効期限：発行から30日）');
  const body = lines.join('\r\n') + sigText;
  const to   = emailFieldChips.to.map(c => c.email).join(',');
  const cc   = emailFieldChips.cc.map(c => c.email).join(',');
  const bcc  = emailFieldChips.bcc.map(c => c.email).join(',');

  return { to, cc, bcc, subject, body };
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
      + (m.cc  ? `&cc=${encodeURIComponent(m.cc)}`   : '')
      + (m.bcc ? `&bcc=${encodeURIComponent(m.bcc)}` : '')
      + `&subject=${encodeURIComponent(m.subject)}`
      + `&body=${encodeURIComponent(m.body)}`;
    window.location.href = gmailScheme;
    setTimeout(() => {
      if (!document.hidden) {
        window.location.href = `mailto:${m.to}`
          + `?${m.cc  ? `cc=${encodeURIComponent(m.cc)}&`   : ''}`
          + `${m.bcc ? `bcc=${encodeURIComponent(m.bcc)}&` : ''}`
          + `subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
        wnShowToast('メールアプリを起動しました', 'success');
      }
    }, 1500);
  } else {
    const url = 'https://mail.google.com/mail/?view=cm&fs=1'
      + `&to=${encodeURIComponent(m.to)}`
      + (m.cc  ? `&cc=${encodeURIComponent(m.cc)}`   : '')
      + (m.bcc ? `&bcc=${encodeURIComponent(m.bcc)}` : '')
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
  const url = `mailto:${m.to}`
    + `?${m.cc  ? `cc=${encodeURIComponent(m.cc)}&`   : ''}`
    + `${m.bcc ? `bcc=${encodeURIComponent(m.bcc)}&` : ''}`
    + `subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
  window.location.href = url;
  wnShowToast('メールアプリを起動しました', 'success');
  closeEmailModal();
}
