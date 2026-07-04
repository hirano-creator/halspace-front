'use strict';
/* What'sNo ダッシュボード */

let currentUser  = null;
let allFiles     = [];      // 現在読み込み済みのページ分のみ（全件ではない）
let allTags      = [];
const WN_PAGE_SIZE  = 60;
let wnPage          = 1;
let wnHasMore       = true;
let wnTotalCount    = 0;
let wnLoadingMore    = false;
let wnLoadMoreObserver = null;
let selectedTags = [];
let navView      = 'all';   // 'all' | 'mine' | 'recent' | 'liked'
const LAYOUT_VIEW_STORAGE_KEY = 'wn_layout_view';
let layoutView   = (() => {
  const saved = localStorage.getItem(LAYOUT_VIEW_STORAGE_KEY);
  return saved === 'list' ? 'list' : 'grid';   // 'grid' | 'list'
})();
let uploadQueue  = [];
let semanticMode = false;   // AI自然言語検索モード中かどうか
let selectMode   = false;   // PDF結合の選択モード中かどうか
let selectedIds  = [];      // 選択中ファイルID（選択順を保持）
let mergeOrder   = [];      // 結合モーダル内の並び順

/* ────────────────────────────────
   初期化
   ──────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  /* モバイルでカードを全幅に強制（CSS/SWキャッシュ回避） */
  applyMobileLayout();
  window.addEventListener('resize', applyMobileLayout);

  currentUser = requireSpaceAuth();
  if (!currentUser) return;

  syncDesktopToken();
  renderSidebarUser(currentUser);
  if (isAdmin(currentUser)) document.getElementById('adminLink').style.display = '';

  const _tagsParam = new URLSearchParams(location.search).get('tags');
  if (_tagsParam) selectedTags = _tagsParam.split(',').map(Number).filter(Boolean);

  await loadTags();
  await loadFiles();
  initNav();
  initDragDrop();
  initPasteUpload();
  initUploadModal();
  initFilters();
  initViewToggle();
  initSearch();
  initVoiceSearch();
  initNotifications();
  initEmailModal();
  initSkillBar();
  initContactMailModal();
  initContactsModal();
  initMergeSelect();
  initThumbnailBust();
  initDesktopIntegrationModal();
  initTagManagePanel();
  initBulkTag();
  initTagShare();
  initScrollTopButton();
});

/* ページトップへ戻るボタン（無限スクロールで一覧が長くなるため）
   PC幅(768px以上)ではページ全体ではなく #gridArea / #listArea 側が内部スクロールするため、
   window だけでなくそれらのスクロールも監視・対象にする */
function wnScrollTopScrollables() {
  const gridArea = document.getElementById('gridArea');
  const listArea = document.getElementById('listArea');
  return [window, gridArea, listArea].filter(Boolean);
}

function wnIsAnyScrolledPast(threshold) {
  const scrollTopOf = (el) => el === window ? window.scrollY : el.scrollTop;
  return wnScrollTopScrollables().some(el => scrollTopOf(el) > threshold);
}

function updateScrollTopButtonVisibility() {
  document.getElementById('scrollTopBtn')?.classList.toggle('show', !selectMode && wnIsAnyScrolledPast(400));
}

function initScrollTopButton() {
  const btn = document.getElementById('scrollTopBtn');
  if (!btn) return;
  btn.classList.remove('hidden');

  let ticking = false;
  const update = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      updateScrollTopButtonVisibility();
      ticking = false;
    });
  };
  wnScrollTopScrollables().forEach(el => el.addEventListener('scroll', update, { passive: true }));

  btn.addEventListener('click', () => {
    wnScrollTopScrollables().forEach(el => el.scrollTo({ top: 0, behavior: 'smooth' }));
  });
}

/* 注釈編集後の新サムネイル取得用：ダッシュボード表示時にメモリキャッシュをリセット
   → IndexedDB の新しいキャッシュが確実に読まれるようにする */
function initThumbnailBust() {
  const bustFileId = localStorage.getItem('wn_thumb_bust');
  if (bustFileId) {
    const prefix = `thumb_${bustFileId}_`;
    let count = 0;
    Object.keys(thumbMemCache).forEach(k => {
      if (k.startsWith(prefix)) {
        URL.revokeObjectURL(thumbMemCache[k]);
        delete thumbMemCache[k];
        count++;
      }
    });
    if (count > 0) {
      console.log(`[Dashboard] Cleared ${count} memory cache entries for file ${bustFileId}`);
    }
    localStorage.removeItem('wn_thumb_bust');
  }
}

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
   スキルバー（自然言語 → アクション・PoC: メール見積依頼）
   ──────────────────────────────── */
// 連絡先は wn-api.js の wnGetContacts/wnSaveContact 等（バックエンドDB）を使用。
let skillBusy        = false;
let skillPendingName = '';   // 宛先未解決時に保持する人物名（送信時に連絡先へ保存）

// スキルで使うメーラーの記憶（1回目に選んだら2回目以降は自動でそのメーラーを起動）
const WN_MAILER_PREF_KEY = 'wn_mailer_pref';   // 'gmail' | 'mailto'
function wnGetMailerPref() {
  const v = localStorage.getItem(WN_MAILER_PREF_KEY);
  return (v === 'gmail' || v === 'mailto') ? v : null;
}
function wnSetMailerPref(v) {
  if (v === 'gmail' || v === 'mailto') localStorage.setItem(WN_MAILER_PREF_KEY, v);
}

function initSkillBar() {
  const input = document.getElementById('searchInput');
  const send  = document.getElementById('skillSendBtn');
  if (!input || !send) return;

  const syncSend = () => {
    const hasText = input.value.trim() !== '';
    send.disabled  = !hasText || skillBusy;
    send.style.opacity = (hasText && !skillBusy) ? '1' : '.4';
  };

  // searchInput の input イベントはすでに initSearch() が管理しているため、
  // ここでは送信ボタンの状態だけ同期する専用リスナーを追加する
  input.addEventListener('input', syncSend);

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !send.disabled) { e.preventDefault(); runSkill(input.value.trim()); }
  });
  send.addEventListener('click', () => { if (!send.disabled) runSkill(input.value.trim()); });
}

/* ────────────────────────────────
   連絡先メール（emailModalに委譲）
   ──────────────────────────────── */
const WN_MAIL_SIG_KEY = 'wn_mail_signature';

function openContactMail(email) {
  closeContactsModal();
  openEmailModal([], email);
}

function initContactMailModal() { /* 廃止 — initEmailModalに統合済み */ }

/* ────────────────────────────────
   連絡先管理モーダル（一覧・追加・編集・削除）
   ──────────────────────────────── */
let contactsBusy     = false;
let contactEditingId = null;
let allContactsCache = [];

function wnEscapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));
}

function initContactsModal() {
  const openBtn         = document.getElementById('contactsOpenBtn');
  const closeBtn        = document.getElementById('contactsModalClose');
  const cancelBtn       = document.getElementById('contactsCloseBtn');
  const addBtn          = document.getElementById('contactAddBtn');
  const cancelEditBtn   = document.getElementById('contactCancelEditBtn');
  const nameEl          = document.getElementById('contactNameInput');
  const kanaEl          = document.getElementById('contactKanaInput');
  const companyEl       = document.getElementById('contactCompanyInput');
  const emailEl         = document.getElementById('contactEmailInput');
  if (!openBtn) return;

  openBtn.addEventListener('click', openContactsModal);
  closeBtn?.addEventListener('click', closeContactsModal);
  cancelBtn?.addEventListener('click', closeContactsModal);
  addBtn?.addEventListener('click', addContactFromForm);
  cancelEditBtn?.addEventListener('click', _contactCancelEdit);
  nameEl?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); kanaEl?.focus(); } });
  kanaEl?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); companyEl?.focus(); } });
  companyEl?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); emailEl?.focus(); } });
  emailEl?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addContactFromForm(); } });

  const searchEl = document.getElementById('contactSearchInput');
  searchEl?.addEventListener('input', () => _renderFilteredContacts());
}

function openContactsModal() {
  document.getElementById('contactsModal').classList.remove('hidden');
  _contactCancelEdit();
  const searchEl = document.getElementById('contactSearchInput');
  if (searchEl) searchEl.value = '';
  renderContactsList();
}
function closeContactsModal() {
  document.getElementById('contactsModal').classList.add('hidden');
}

function _contactCancelEdit() {
  contactEditingId = null;
  document.getElementById('contactNameInput').value    = '';
  document.getElementById('contactKanaInput').value    = '';
  document.getElementById('contactCompanyInput').value = '';
  document.getElementById('contactEmailInput').value   = '';
  document.getElementById('contactAddBtnIcon').className  = 'fa-solid fa-plus';
  document.getElementById('contactAddBtnLabel').textContent = '追加';
  document.getElementById('contactCancelEditBtn')?.classList.add('hidden');
  _contactShowError('');
}

function _contactShowError(msg) {
  const box = document.getElementById('contactInputError');
  const txt = document.getElementById('contactInputErrorText');
  if (!box) return;
  if (msg) { txt.textContent = msg; box.style.display = 'block'; }
  else     { box.style.display = 'none'; }
}

async function renderContactsList() {
  const list = document.getElementById('contactsList');
  if (!list) return;
  list.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px;"><i class="fa-solid fa-spinner fa-spin"></i> 読み込み中…</div>';

  try { allContactsCache = await wnGetContacts(); }
  catch { list.innerHTML = '<div style="font-size:12px;color:#E17055;padding:8px;">連絡先の取得に失敗しました</div>'; return; }

  _renderFilteredContacts();
}

function _renderFilteredContacts() {
  const list = document.getElementById('contactsList');
  if (!list) return;

  const q = (document.getElementById('contactSearchInput')?.value ?? '').trim().toLowerCase();
  const contacts = q
    ? allContactsCache.filter(c =>
        [c.name, c.name_kana, c.company_name, c.email].some(v => v && v.toLowerCase().includes(q))
      )
    : allContactsCache;

  if (!allContactsCache.length) {
    list.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px;">まだ連絡先がありません。上のフォームから追加してください。</div>';
    return;
  }
  if (!contacts.length) {
    list.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px;">該当する連絡先が見つかりません。</div>';
    return;
  }

  list.innerHTML = contacts.map(c => `
    <div data-id="${c.id}" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:var(--primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${wnEscapeHtml(c.name)}${c.name_kana ? `<span style="font-size:11px;font-weight:400;color:var(--muted);margin-left:6px;">${wnEscapeHtml(c.name_kana)}</span>` : ''}
        </div>
        <div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${c.company_name ? `<span style="margin-right:4px;">${wnEscapeHtml(c.company_name)}</span><span style="margin-right:4px;">·</span>` : ''}${wnEscapeHtml(c.email)}
        </div>
      </div>
      <button class="btn btn-outline btn-sm contact-mail-btn" data-email="${wnEscapeHtml(c.email)}" data-name="${wnEscapeHtml(c.name)}" data-company="${wnEscapeHtml(c.company_name)}" style="flex-shrink:0;font-size:11px;padding:4px 8px;color:var(--accent);" title="メールを送る"><i class="fa-solid fa-envelope"></i></button>
      <button class="btn btn-outline btn-sm contact-edit-btn" style="flex-shrink:0;font-size:11px;padding:4px 8px;" title="編集"><i class="fa-solid fa-pen"></i></button>
      <button class="btn btn-outline btn-sm contact-del-btn" style="flex-shrink:0;font-size:11px;padding:4px 8px;color:#E17055;" title="削除"><i class="fa-solid fa-trash"></i></button>
    </div>
  `).join('');

  list.querySelectorAll('.contact-mail-btn').forEach(btn => {
    btn.addEventListener('click', () => openContactMail(btn.dataset.email, btn.dataset.name, btn.dataset.company));
  });
  list.querySelectorAll('.contact-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('[data-id]').dataset.id;
      deleteContactById(id);
    });
  });
  list.querySelectorAll('.contact-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('[data-id]');
      const c = contacts.find(x => String(x.id) === String(row.dataset.id));
      if (c) editContact(c);
    });
  });
}

async function addContactFromForm() {
  if (contactsBusy) return;
  const nameEl    = document.getElementById('contactNameInput');
  const kanaEl    = document.getElementById('contactKanaInput');
  const companyEl = document.getElementById('contactCompanyInput');
  const emailEl   = document.getElementById('contactEmailInput');
  const name    = nameEl.value.trim();
  const kana    = kanaEl.value.trim();
  const company = companyEl.value.trim();
  const email   = emailEl.value.trim();

  if (!name)  { _contactShowError('名前を入力してください'); nameEl.focus(); return; }
  if (kana && !/^[ァ-ヶー\s　]+$/.test(kana)) { _contactShowError('カナは全角カタカナで入力してください'); kanaEl.focus(); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { _contactShowError('メールアドレスの形式が正しくありません'); emailEl.focus(); return; }
  _contactShowError('');

  contactsBusy = true;
  try {
    if (contactEditingId) {
      await wnUpdateContact(contactEditingId, name, email, company || null, kana || null);
      wnShowToast('連絡先を更新しました', 'success');
    } else {
      await wnSaveContact(name, email, company || null, kana || null);
      wnShowToast('連絡先を登録しました', 'success');
    }
    _contactCancelEdit();
    await renderContactsList();
  } catch (err) {
    _contactShowError(err?.message || '連絡先の保存に失敗しました');
  } finally {
    contactsBusy = false;
  }
}

function editContact(c) {
  contactEditingId = c.id;
  document.getElementById('contactNameInput').value    = c.name        ?? '';
  document.getElementById('contactKanaInput').value    = c.name_kana   ?? '';
  document.getElementById('contactCompanyInput').value = c.company_name ?? '';
  document.getElementById('contactEmailInput').value   = c.email       ?? '';
  document.getElementById('contactAddBtnIcon').className  = 'fa-solid fa-check';
  document.getElementById('contactAddBtnLabel').textContent = '更新';
  document.getElementById('contactCancelEditBtn')?.classList.remove('hidden');
  _contactShowError('');
  document.getElementById('contactNameInput').focus();
  document.getElementById('contactsModal').querySelector('[style*="padding"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function deleteContactById(id) {
  if (!window.confirm('この連絡先を削除しますか？')) return;
  wnDeleteContact(id)
    .then(ok => {
      if (ok) { renderContactsList(); wnShowToast('連絡先を削除しました', 'success'); }
      else    { wnShowToast('削除に失敗しました', 'danger'); }
    });
}

async function runSkill(instruction) {
  if (skillBusy || !instruction) return;

  // 対象ファイル: 選択中の全ファイル。未選択なら促す。
  if (selectedIds.length === 0) { wnShowToast('対象のファイルを選択してください', 'info'); return; }
  const files = selectedIds.map(id => allFiles.find(f => String(f.id) === String(id))).filter(Boolean);
  if (files.length === 0) { wnShowToast('選択ファイルが見つかりません', 'danger'); return; }
  const file = files[0]; // スキルAPI（宛先・下書き解決）には代表ファイルを渡す

  skillBusy = true;
  const input = document.getElementById('searchInput');
  const send  = document.getElementById('skillSendBtn');
  send.disabled = true;
  send.style.opacity = '.4';

  try {
    const contacts = await wnGetContacts();
    const res   = await wnRunSkill(instruction, file.id, contacts);

    // スキルが特定できなかった場合は入力を残してエラーを表示
    if (!res.action_type) {
      wnShowToast(res.message || '対応するスキルが見つかりませんでした', 'warning');
      skillBusy = false;
      const hasText = input.value.trim() !== '';
      send.disabled = !hasText;
      send.style.opacity = hasText ? '1' : '.4';
      return;
    }

    const draft = res.draft || {};

    // メール送信モーダルを開く（全選択ファイルの共有リンクを先行発行）
    openEmailModal(files.map(f => ({ id: f.id, name: f.file_name })));

    // LLMの下書きを流し込む
    if (draft.to_email) {
      emailFieldChips.to = [{ email: draft.to_email }];
      renderEmailChips('to');
    }
    if (draft.body_message) {
      const msgEl = document.getElementById('emailMessage');
      const cnt   = document.getElementById('emailMsgCount');
      if (msgEl) msgEl.value = draft.body_message;
      if (cnt)   cnt.textContent = String(draft.body_message.length);
    }

    input.value = '';
    send.disabled = true;
    send.style.opacity = '.4';

    if (draft.to_email) {
      // 宛先が解決できた → 全ファイルの共有リンク発行完了を待つ
      skillPendingName = '';
      const sharePromises = files.map(f => emailShareCache.get(f.id) ?? Promise.resolve(null));
      const rawShares = await Promise.all(sharePromises);
      const shareResults = files.map((f, i) => ({ id: f.id, name: f.file_name, url: rawShares[i]?.url ?? null }));
      if (shareResults.some(s => !s.url)) {
        wnShowToast('共有リンクの生成を待っています。完了後に送信してください', 'info');
      } else {
        // _buildEmailContent() が参照する emailPregenShares を先に設定してからメーラーを起動する
        emailPregenShares = shareResults;
        const pref = wnGetMailerPref();
        if (pref === 'gmail')       doSendEmailGmail();   // 2回目以降: 記憶したGmailを自動起動
        else if (pref === 'mailto') doSendEmailMailto();  // 2回目以降: 記憶した既定メールアプリを自動起動
        else wnShowToast('送信方法を選んでください（次回から自動で起動します）', 'info');  // 初回はモーダルで選択
      }
    } else {
      // 宛先が未解決 → 手入力を促し、入力されたら連絡先に保存する
      skillPendingName = draft.to_name || '';
      wnShowToast(`「${draft.to_name || '宛先'}」のメールアドレスを入力してください`, 'info');
    }
  } catch (err) {
    wnShowToast(err?.message || 'スキルの実行に失敗しました', 'danger');
  } finally {
    skillBusy = false;
    const hasText = input.value.trim() !== '';
    send.disabled = !hasText;
    send.style.opacity = hasText ? '1' : '.4';
  }
}

/* ────────────────────────────────
   データ取得
   ──────────────────────────────── */
function buildFileListParams() {
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
  return params;
}

/* 1ページ目を取得（検索・タグ・並び替え等が変わった時の「やり直し」） */
async function loadFiles() {
  showLoading(true);
  wnPage    = 1;
  wnHasMore = true;

  const result = await wnGetFiles({ ...buildFileListParams(), page: 1, per_page: WN_PAGE_SIZE });
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

  allFiles     = result.data;
  wnTotalCount = result.meta?.total ?? result.data.length;
  wnHasMore    = result.meta ? result.meta.current_page < result.meta.last_page : false;
  renderFiles(true);
}

/* 続きのページを取得して末尾へ追加（無限スクロール） */
async function loadMoreFiles() {
  if (wnLoadingMore || !wnHasMore) return;
  wnLoadingMore = true;
  toggleLoadMoreSpinner(true);

  const nextPage = wnPage + 1;
  const result = await wnGetFiles({ ...buildFileListParams(), page: nextPage, per_page: WN_PAGE_SIZE });

  wnLoadingMore = false;
  toggleLoadMoreSpinner(false);

  if (result.error || !result.data || !result.data.length) {
    wnHasMore = false;   /* 失敗時は無限リトライを避け、次回の loadFiles() まで停止 */
    updateLoadMoreSentinel();
    return;
  }

  wnPage    = nextPage;
  wnHasMore = result.meta ? result.meta.current_page < result.meta.last_page : false;
  allFiles  = allFiles.concat(result.data);
  renderFiles(false, result.data);

  /* 追加後もまだ画面内に読み込み位置が残っていれば連鎖して次ページを読む
     （1ページ分がビューポートより短い画面で無限スクロールが止まらないように） */
  requestAnimationFrame(() => {
    const sentinel = document.getElementById('loadMoreSentinel');
    if (!sentinel || !wnHasMore || wnLoadingMore) return;
    const r = sentinel.getBoundingClientRect();
    if (r.top < window.innerHeight + 600) loadMoreFiles();
  });
}

function toggleLoadMoreSpinner(show) {
  const sentinel = document.getElementById('loadMoreSentinel');
  if (sentinel) sentinel.style.visibility = show ? 'visible' : 'hidden';
}

function ensureLoadMoreObserver() {
  if (wnLoadMoreObserver || typeof IntersectionObserver !== 'function') return;
  const sentinel = document.getElementById('loadMoreSentinel');
  if (!sentinel) return;
  wnLoadMoreObserver = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) loadMoreFiles();
  }, { rootMargin: '600px 0px' });
  wnLoadMoreObserver.observe(sentinel);
}

function updateLoadMoreSentinel() {
  const sentinel = document.getElementById('loadMoreSentinel');
  if (!sentinel) return;
  sentinel.classList.toggle('hidden', !wnHasMore);
  if (wnHasMore) ensureLoadMoreObserver();
}

async function loadTags() {
  allTags = await wnGetTags();
  renderTagFilter();
}

/* ────────────────────────────────
   描画
   ──────────────────────────────── */
/* reset=true: フィルタ変更等でグリッドを丸ごと作り直す（allFiles全体を描画）
   reset=false: 無限スクロールでの追加読み込み。newItems だけをDOM末尾に追加する */
function renderFiles(reset = true, newItems = null) {
  const grid  = document.getElementById('fileGrid');
  const rows  = document.getElementById('fileListRows');
  const empty = document.getElementById('emptyMsg');
  const countLabel = document.getElementById('fileCountLabel');

  const viewLabels = { all: 'すべてのファイル', mine: 'マイファイル', recent: '最近のファイル', liked: 'いいね済み' };
  document.getElementById('areaTitle').textContent = viewLabels[navView] ?? 'すべてのファイル';
  countLabel.textContent = wnTotalCount ? `（${wnTotalCount}件）` : '';

  if (!allFiles.length) {
    grid.innerHTML = '';
    rows.innerHTML = '';
    empty.classList.remove('hidden');
    updateLoadMoreSentinel();
    return;
  }
  empty.classList.add('hidden');

  const itemsToRender = reset ? allFiles : (newItems ?? []);
  if (reset) {
    grid.innerHTML = allFiles.map(fileCardHtml).join('');
    rows.innerHTML = allFiles.map(fileRowHtml).join('');
  } else if (itemsToRender.length) {
    grid.insertAdjacentHTML('beforeend', itemsToRender.map(fileCardHtml).join(''));
    rows.insertAdjacentHTML('beforeend', itemsToRender.map(fileRowHtml).join(''));
  }

  // サムネイルを非同期で差し込む（画像・PDF・動画） / reset時は全件、追加時は新規分のみ
  loadFileThumbnails(itemsToRender, { reset });
  // PDFのページ数バッジを非同期で差し込む（複数ページのみ表示）
  loadFilePageCounts(itemsToRender, { reset });
  // リスト表示時のみコメントを非同期で差し込む
  if (layoutView === 'list') loadRowComments(itemsToRender);

  // クリック等のイベントは新規追加分（reset時は全件）だけに束ねる。
  // 既存要素に張り直すと同一要素へのリスナー重複を招くため。
  const scopeEls = reset
    ? Array.from(document.querySelectorAll('[data-file-id]'))
    : itemsToRender.flatMap(f => Array.from(document.querySelectorAll(`[data-file-id="${f.id}"]`)));

  scopeEls.forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.like-btn') || e.target.closest('.file-action-btn')) return;
      if (selectMode) { toggleMergeSelect(el.dataset.fileId); return; }
      location.href = `file-detail.html?id=${el.dataset.fileId}`;
    });
  });

  // 選択モード中の再描画（ソート・フィルタ変更等）でも選択状態を復元
  if (selectMode) selectedIds.forEach(id => applySelectedVisual(id, true));

  const likeBtnScope = reset
    ? Array.from(document.querySelectorAll('.like-btn[data-id]'))
    : itemsToRender.flatMap(f => Array.from(document.querySelectorAll(`.like-btn[data-id="${f.id}"]`)));

  likeBtnScope.forEach(btn => {
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

  updateLoadMoreSentinel();
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

/* サムネイル生成バージョン（解像度等を変えたら上げてキャッシュを再生成させる） */
const THUMB_VER = 'v17'; // PDFサムネ白背景修正（透過→黒化を根本解消）
/* Excel/Word サムネイルの描画倍率（論理座標×この倍率で高解像度化） */
const THUMB_SS = 2;

/* iOS / モバイル判定。
   iOS Safari はタブ毎メモリ上限が厳しく、高解像度canvasのgetImageData/blur
   や動画デコードを並列実行すると数百MBに達してOOMでタブが落ちる
   （「問題が繰り返し起きました」）。モバイルでは並列数・描画解像度を絞り、
   動画は画像の後に1本ずつ処理してピークメモリを抑える。 */
const WN_IS_MOBILE = (() => {
  try {
    const ua = navigator.userAgent || '';
    const iOS = /iP(hone|ad|od)/.test(ua)
             || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1); // iPadOS
    const android = /Android/.test(ua);
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return iOS || android || (coarse && (window.innerWidth || 0) < 1024);
  } catch { return false; }
})();

/* canvas のバッキングストアを即解放（Safari は参照を切っても backing store の
   解放が遅く、連続生成でメモリが積み上がるため明示的に 0×0 にする）。 */
function wnFreeCanvas() {
  for (const c of arguments) {
    try { if (c) { c.width = 0; c.height = 0; } } catch {}
  }
}

/* 保存するサムネイルの長辺ピクセル（表示サイズ×DPRに近づけるほど細線が濃く残る）。
   モバイルはメモリ優先で 720px 固定（カードは小さく表示されるため実害なし）。 */
function wnThumbTargetLong() {
  if (WN_IS_MOBILE) return 720;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return Math.round(Math.min(1440, Math.max(720, 720 * dpr)));
}

/* 高品質縮小: 1/2ずつ段階的に縮小して図面の細線がかすれるのを防ぐ
   （大きい画像をブラウザに一気に縮小させると細線が飛ぶため、
    Googleドライブのサムネイルと同様に縮小済み画像を保存する） */
function wnShrinkCanvas(src, targetLong) {
  let cur = src;
  while (Math.max(cur.width, cur.height) > targetLong * 2) {
    const next = document.createElement('canvas');
    next.width  = Math.max(1, Math.round(cur.width / 2));
    next.height = Math.max(1, Math.round(cur.height / 2));
    const ctx = next.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
  }
  if (Math.max(cur.width, cur.height) > targetLong) {
    const ratio = targetLong / Math.max(cur.width, cur.height);
    const next = document.createElement('canvas');
    next.width  = Math.max(1, Math.round(cur.width * ratio));
    next.height = Math.max(1, Math.round(cur.height * ratio));
    const ctx = next.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
  }
  return cur;
}

/* EXIF Orientation を画素に焼き込んで再エンコード。
   iOS Safari が object-fit:cover + aspect-ratio で EXIF 回転を無視する不具合対策。
   対象は EXIF を持つ JPEG/HEIC のみ。失敗時は元 blob をそのまま返す。 */
async function wnNormalizeImageBlob(blob) {
  try {
    if (typeof createImageBitmap !== 'function') return blob;
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const canvas = document.createElement('canvas');
    canvas.width  = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close?.();
    const out = wnShrinkCanvas(canvas, wnThumbTargetLong());  // 既存の高品質段階縮小を再利用
    const re  = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.9));
    wnFreeCanvas(canvas, out);   // フル解像度canvasを即解放（モバイルOOM対策）
    return re || blob;
  } catch {
    return blob;  // createImageBitmap 非対応や失敗時は元のまま
  }
}

/* 余白自動トリミング: 四隅の色を背景色とみなし、内容の外接矩形+少しの余白で切り出す。
   余白が大きい図面ほど内容が拡大されて見やすくなる。
   誤検出防止のため、極端なクロップやほぼ余白なしの場合は元のまま返す */
function wnTrimMargins(canvas, pad = 0.03) {
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

    /* 速度のため間引き走査（長辺600サンプル程度） */
    const stepX = Math.max(1, Math.floor(w / 600));
    const stepY = Math.max(1, Math.floor(h / 600));
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y += stepY) {
      for (let x = 0; x < w; x += stepX) {
        if (!isBg(idx(x, y))) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return canvas;  /* 全面背景 */

    minX = Math.max(0, minX - Math.round(w * pad));
    maxX = Math.min(w - 1, maxX + Math.round(w * pad));
    minY = Math.max(0, minY - Math.round(h * pad));
    maxY = Math.min(h - 1, maxY + Math.round(h * pad));
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    if (cw < w * 0.3 || ch < h * 0.3) return canvas;    /* 切りすぎ→誤検出の可能性 */
    if (cw > w * 0.95 && ch > h * 0.95) return canvas;  /* ほぼ余白なし */

    const out = document.createElement('canvas');
    out.width = cw; out.height = ch;
    out.getContext('2d').drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
    return out;
  } catch { return canvas; }
}

/* 線画強調: アンシャープマスクで輪郭を立たせ、ガンマで薄くなった線を締める
   （縮小で淡いグレーになった図面の細線をGoogleドライブ風にくっきり見せる） */
function wnEnhanceLineArt(canvas, amount = 1.3, gamma = 1.55) {
  try {
    const w = canvas.width, h = canvas.height;
    const ctx  = canvas.getContext('2d');
    const blur = document.createElement('canvas');
    blur.width = w; blur.height = h;
    const bctx = blur.getContext('2d');
    bctx.filter = 'blur(1px)';  /* filter未対応ブラウザでは差分0となり実質ガンマのみ適用 */
    bctx.drawImage(canvas, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const bim = bctx.getImageData(0, 0, w, h);
    const s = img.data, b = bim.data;
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * Math.pow(v / 255, gamma));
    for (let i = 0; i < s.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        let v = s[i + c] + amount * (s[i + c] - b[i + c]);
        v = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
        s[i + c] = lut[v];
      }
    }
    ctx.putImageData(img, 0, 0);
  } catch { /* 失敗してもサムネイル自体は無加工で出す */ }
}

/* サムネ生成スキップ閾値（重すぎてモバイルで詰まる/落ちるもの） */
const OFFICE_MAX_BYTES = 2 * 1024 * 1024;     /* 2MB超のOffice（クライアント生成時のみ） */
const VIDEO_MAX_BYTES  = 200 * 1024 * 1024;   /* 200MB超の動画 */

function wnThumbEligible(f) {
  const ext  = (f.file_name || '').split('.').pop().toLowerCase();
  const mime = f.mime_type ?? '';
  const isOffice = ['xlsx','xls','xlsm','docx','docm'].includes(ext);
  const isVid    = mime.startsWith('video/') || ['mp4','mov','avi','webm'].includes(ext);
  if (isOffice && (f.file_size ?? 0) > OFFICE_MAX_BYTES) return false;
  if (isVid    && (f.file_size ?? 0) > VIDEO_MAX_BYTES)  return false;
  return mime.startsWith('image/') || ['png','jpg','jpeg','gif','webp','heic','heif','svg'].includes(ext)
      || mime === 'application/pdf' || ext === 'pdf'
      || isVid
      || ext === 'dxf'
      || isOffice
      || ['pptx','ppt','pptm'].includes(ext);
}

/* 取得キューの並列数。各タスクは主に軽い fetch/IDB 取得（サーバー保存済みサムネ or
   キャッシュヒット）なので広めに取り、グリッドを速く埋める。重いクライアント生成だけは
   別途 wnGenSem で厳しく絞る（モバイルOOM対策）。 */
const WN_THUMB_MAX = WN_IS_MOBILE ? 8 : 12;
let   wnThumbActive = 0;
const wnThumbQueue  = [];
let   wnThumbObserver = null;
let   wnPageCountObserver = null;
let   wnThumbById      = new Map();
let   wnThumbSeen       = new Set();
let   wnPageCountById   = new Map();
let   wnPageCountSeen   = new Set();

/* 重いクライアント生成（PDF/動画/HEIC等のcanvas処理）専用のセマフォ。
   取得が並列8でも、実際に生成まで進むタスクはモバイル1/PC3に制限してメモリ枯渇を防ぐ。 */
function wnMakeSemaphore(max) {
  let active = 0;
  const waiters = [];
  return {
    async acquire() {
      if (active < max) { active++; return; }
      await new Promise(r => waiters.push(r));
      active++;
    },
    release() {
      active--;
      const w = waiters.shift();
      if (w) w();
    },
  };
}
const wnGenSem = wnMakeSemaphore(WN_IS_MOBILE ? 1 : 3);

function wnPumpThumbs() {
  while (wnThumbActive < WN_THUMB_MAX && wnThumbQueue.length) {
    const f = wnThumbQueue.shift();
    wnThumbActive++;
    Promise.resolve(loadOneThumbnail(f)).finally(() => {
      wnThumbActive--;
      wnPumpThumbs();
    });
  }
}

/* ビューポート遅延ロード:
   画面に入った（手前400pxの先読み含む）カードのサムネイルだけ生成/取得する。
   全119件を一括処理していた旧方式では、動画/Officeがキュー後方に回り、
   モバイルでは表示まで時間がかかっていた。見ているカードを即処理する。 */
function wnThumbTrigger(el) {
  const m = (el.id || '').match(/^thumb-icon-(?:row-)?(.+)$/);
  if (!m) return;
  const id = m[1];
  if (wnThumbSeen.has(id)) return;
  const f = wnThumbById.get(id);
  if (!f || !wnThumbEligible(f)) return;
  wnThumbSeen.add(id);
  wnThumbQueue.push(f);
  wnPumpThumbs();
}

/* files: 今回対象にするファイル（無限スクロールでは新規追加分だけ渡す）
   reset: true ならobserverを作り直して1ページ目から観測しなおす（フィルタ変更等） */
function loadFileThumbnails(files = allFiles, { reset = true } = {}) {
  if (reset) {
    if (wnThumbObserver) { wnThumbObserver.disconnect(); wnThumbObserver = null; }
    wnThumbQueue.length = 0;
    wnThumbById = new Map();
    wnThumbSeen = new Set();
  }
  files.forEach(f => wnThumbById.set(String(f.id), f));

  const icons = [];
  files.forEach(f => {
    const c = document.getElementById(`thumb-icon-${f.id}`);
    const r = document.getElementById(`thumb-icon-row-${f.id}`);
    if (c) icons.push(c);
    if (r) icons.push(r);
  });

  if (typeof IntersectionObserver !== 'function') {
    icons.forEach(wnThumbTrigger);   // 非対応環境は全件（従来動作）
    return;
  }
  if (!wnThumbObserver) {
    wnThumbObserver = new IntersectionObserver((entries, obs) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        obs.unobserve(e.target);
        wnThumbTrigger(e.target);
      }
    }, { rootMargin: '400px 0px' });
  }
  icons.forEach(el => wnThumbObserver.observe(el));
}

/* ────────────────────────────────
   PDFページ数バッジ（複数ページある場合のみ表示）
   file-card / file-row / ig-post が画面内に入ったら pdf.js で
   ドキュメント構造だけ読み、numPages をキャッシュして反映する。
   ──────────────────────────────── */
function wnIsPdfFile(f) {
  const ext = (f.file_name || '').split('.').pop().toLowerCase();
  return f.mime_type === 'application/pdf' || ext === 'pdf';
}

function wnPageCountTrigger(el) {
  const id = el.dataset.fileId;
  if (!id || wnPageCountSeen.has(id)) return;
  const f = wnPageCountById.get(id);
  if (!f || !wnIsPdfFile(f)) return;
  wnPageCountSeen.add(id);
  loadOnePageCount(f);
}

function loadFilePageCounts(files = allFiles, { reset = true } = {}) {
  if (reset) {
    if (wnPageCountObserver) { wnPageCountObserver.disconnect(); wnPageCountObserver = null; }
    wnPageCountById = new Map();
    wnPageCountSeen = new Set();
  }
  files.forEach(f => wnPageCountById.set(String(f.id), f));

  const els = files.flatMap(f => Array.from(document.querySelectorAll(`[data-file-id="${f.id}"]`)));

  if (typeof IntersectionObserver !== 'function') {
    els.forEach(wnPageCountTrigger);
    return;
  }
  if (!wnPageCountObserver) {
    wnPageCountObserver = new IntersectionObserver((entries, obs) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        obs.unobserve(e.target);
        wnPageCountTrigger(e.target);
      }
    }, { rootMargin: '400px 0px' });
  }
  els.forEach(el => wnPageCountObserver.observe(el));
}

async function loadOnePageCount(f) {
  const cacheKey = `wn_pdf_pages_${f.id}_${f.updated_at ?? f.created_at ?? ''}`;
  let count = null;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) count = parseInt(cached, 10);
  } catch {}

  if (!count) {
    if (typeof pdfjsLib === 'undefined') return;
    await wnGenSem.acquire();
    try {
      const pdf = await pdfjsLib.getDocument({ url: wnPublicViewUrl(f.id) }).promise;
      count = pdf.numPages;
      pdf.destroy?.();
      try { localStorage.setItem(cacheKey, String(count)); } catch {}
    } catch { return; } finally {
      wnGenSem.release();
    }
  }

  if (!count || count <= 1) return;
  document.querySelectorAll(`[data-page-count-id="${f.id}"]`).forEach(el => {
    el.hidden = false;
    const cnt = el.querySelector('.cnt');
    if (cnt) cnt.textContent = count;
  });
}

function pageCountBadgeHtml(f, extraClass) {
  if (!wnIsPdfFile(f)) return '';
  return `<span class="wn-page-count-badge${extraClass ? ' ' + extraClass : ''}" data-page-count-id="${f.id}" hidden title="ページ数">
    <i class="fa-regular fa-copy"></i><span class="cnt"></span>
  </span>`;
}

async function loadOneThumbnail(f) {
  const iconId = `thumb-icon-${f.id}`;
  if (!document.getElementById(iconId) && !document.getElementById(`thumb-icon-row-${f.id}`)) return;

  const ext      = (f.file_name || '').split('.').pop().toLowerCase();
  const mime     = f.mime_type ?? '';
  /* 世代(WN_THUMB_GEN)も含める: サーバー世代を上げた時に古いIDBエントリも確実に無効化する */
  const gen      = (typeof WN_THUMB_GEN !== 'undefined') ? WN_THUMB_GEN : '';
  const cacheKey = `thumb_${f.id}_${f.updated_at ?? f.created_at ?? ''}_${THUMB_VER}_${gen}`;

  /* 文書系 (PDF/Excel/Word) は先頭(タイトル付近)を見せたいので object-position:top */
  const isDoc = (mime === 'application/pdf' || ext === 'pdf'
              || ['xlsx','xls','xlsm','docx','docm'].includes(ext));
  const appendOpts = isDoc ? { anchor: 'top' } : {};

  /* ── 画像ファイルのハイブリッド表示 ──
     PC: 原画像URLを直接表示（詳細画面と同じURL＝向き・内容が常に一致し確実）。
     モバイル: 下の統合フロー（IDB→サーバー400pxサムネ→クライアント生成）へ流し、
     フル解像度の原画像（数MB）ではなく極小サムネを使って帯域を大幅削減する。
     CSS(object-fit:cover)がトリミングを担う。遅延ロード済みなので画面外は取得しない。 */
  const isRawImage = mime.startsWith('image/')
    || ['png','jpg','jpeg','gif','webp','heic','heif','svg'].includes(ext);
  const isSvg  = ext === 'svg' || mime === 'image/svg+xml';
  const isHeic = ['heic','heif'].includes(ext) || mime === 'image/heic' || mime === 'image/heif';
  /* 原画像URLを直接表示する条件:
       PC: SVG/HEIC 以外の画像（JPEG/PNG等はブラウザが確実に表示できる）
       モバイル: SVG のみ（ベクター・極小でサーバーGD非対応）
     HEIC は Windows Chrome/Edge 等が <img> でデコードできずアイコン化するため、
     全環境で統合フロー（クライアント heic2any/ネイティブ生成→JPEG化）へ通す。 */
  if (isRawImage && !isHeic && (!WN_IS_MOBILE || isSvg)) {
    appendImg(iconId, wnPublicViewUrl(f.id));
    return;
  }

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

    /* ── サーバー保存型サムネイル確認（画像/Office等）──
       保存済みなら極小JPEGを取得し、IndexedDB へも保存して再訪をゼロ通信化する。
       404（pdf/video/dxf/HEIC の未生成）なら下のクライアント生成へ進む。 */
    const serverBlob = await wnFetchServerThumb(f.id, f.updated_at ?? f.created_at);
    if (serverBlob) {
      await ThumbCache.evictOld(f.id).catch(() => {});
      await ThumbCache.set(cacheKey, serverBlob).catch(() => {});  // 永続化＝次回IDBヒット
      const url = URL.createObjectURL(serverBlob);
      thumbMemCache[cacheKey] = url;
      appendImg(iconId, url, appendOpts);
      return;
    }

    /* ── サーバーに無い → クライアント生成（生成後はサーバーへ保存して次回以降即配信） ──
       重いcanvas処理はモバイルでメモリを食うため wnGenSem で同時実行数を絞る。 */
    let blob = null;

    const directUrl = wnPublicViewUrl(f.id);

    await wnGenSem.acquire();
    try {
    if (['heic','heif'].includes(ext) || mime === 'image/heic' || mime === 'image/heif') {
      const res = await fetch(directUrl);
      if (!res.ok) return;
      const srcBlob = await res.blob();

      /* iOS Safari は HEIC をネイティブデコードできる。重い heic2any(WASM,
         数十MB) を避けて createImageBitmap で直接縮小し、モバイルOOMを防ぐ。
         失敗時（Android 等ネイティブ非対応）は heic2any にフォールバック。 */
      if (typeof createImageBitmap === 'function') {
        try {
          const bmp = await createImageBitmap(srcBlob, { imageOrientation: 'from-image' });
          const c = document.createElement('canvas');
          c.width = bmp.width; c.height = bmp.height;
          c.getContext('2d').drawImage(bmp, 0, 0);
          bmp.close?.();
          const out = wnShrinkCanvas(c, wnThumbTargetLong());
          blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.85));
          wnFreeCanvas(c, out);
        } catch { blob = null; }
      }

      if (!blob) {
        if (typeof heic2any === 'undefined') return;
        const buffer = await srcBlob.arrayBuffer();
        let b = await heic2any({ blob: new Blob([buffer], { type: 'image/heic' }), toType: 'image/jpeg', quality: 0.70 });
        b = Array.isArray(b) ? b[0] : b;
        blob = await wnNormalizeImageBlob(b);   // EXIF 回転を焼き込み
      }

    } else if (mime.startsWith('image/') || ['png','jpg','jpeg','gif','webp','svg'].includes(ext)) {
      const res = await fetch(directUrl);
      if (!res.ok) return;
      blob = await res.blob();
      if (['jpg','jpeg'].includes(ext) || mime === 'image/jpeg') {
        blob = await wnNormalizeImageBlob(blob);  // EXIF 回転を焼き込み
      }

    } else if (mime === 'application/pdf' || ext === 'pdf') {
      if (typeof pdfjsLib === 'undefined') return;
      const pdf      = await pdfjsLib.getDocument({
        url: directUrl,
        cMapUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/standard_fonts/',
      }).promise;
      const page     = await pdf.getPage(1);
      /* 大きめに描画（スーパーサンプリング）してから高品質縮小で保存サイズへ落とす。
         モバイルは getImageData/blur のメモリが致命的なので長辺を絞る（1400px）。 */
      const ssLong = WN_IS_MOBILE ? 1400 : 2600;
      const base   = page.getViewport({ scale: 1 });
      const scale  = Math.min(WN_IS_MOBILE ? 2 : 4, Math.max(1.5, ssLong / Math.max(base.width, base.height)));
      const viewport = page.getViewport({ scale });
      const canvas   = document.createElement('canvas');
      canvas.width   = Math.round(viewport.width);
      canvas.height  = Math.round(viewport.height);
      const pdfCtx   = canvas.getContext('2d');
      pdfCtx.fillStyle = '#ffffff'; // 白背景を必ず塗る（透過PDFをJPEG化すると黒になるため）
      pdfCtx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: pdfCtx, viewport }).promise;
      /* 余白カット → 高品質縮小 → 線画強調 の順で内容を最大限大きく写す */
      const trimmed = wnTrimMargins(canvas);
      const out = wnShrinkCanvas(trimmed, wnThumbTargetLong());
      wnEnhanceLineArt(out);
      blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.90));
      wnFreeCanvas(canvas, trimmed, out);
      pdf.destroy?.();   // pdf.js のデコードバッファ・Workerメモリを解放

    } else if (mime.startsWith('video/') || ['mp4','mov','avi','webm'].includes(ext)) {
      blob = await new Promise(resolve => {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.muted = true; video.defaultMuted = true;
        video.playsInline = true; video.preload = 'auto';
        // iOS Safari は属性が無いとミュート自動再生を許可しないため属性も付与
        video.setAttribute('muted', '');
        video.setAttribute('playsinline', '');
        // display:none だと iOS Safari が動画データを読み込まないため画面外に配置する
        video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:320px;height:180px;opacity:0.001;pointer-events:none;';
        document.body.appendChild(video);

        let captured = false;
        const finish = (b) => {
          if (captured) return;
          captured = true;
          clearTimeout(timer);
          try {
            // video.src を空にしてデコーダーバッファを即解放（iOS Safariのメモリ対策）
            try { video.pause(); } catch {}
            video.removeAttribute('src');
            video.src = '';
            video.load();
            document.body.removeChild(video);
          } catch {}
          resolve(b);
        };
        // 大容量動画のストリーミングを考慮し10秒でタイムアウト
        const timer = setTimeout(() => finish(null), 10000);

        const capture = () => {
          if (captured) return;
          try {
            const canvas = document.createElement('canvas');
            canvas.width  = video.videoWidth  || 320;
            canvas.height = video.videoHeight || 180;
            canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(b => { wnFreeCanvas(canvas); finish(b); }, 'image/jpeg', 0.80);
          } catch { finish(null); }
        };
        // rAF×2 でフレーム描画完了を待ってからキャプチャ（直後は黒になる端末がある）
        const captureSoon = () => requestAnimationFrame(() => requestAnimationFrame(capture));

        // iOS Safari は「再生」しないと canvas に黒しか描画されない。
        // ミュート自動再生で実フレームをデコードさせ、currentTime が進んだら
        // キャプチャして一時停止する。自動再生が拒否された場合は seek にフォールバック。
        video.addEventListener('loadedmetadata', () => {
          const seekTo = Math.min(0.5, (video.duration || 1) / 3);
          const p = video.play();
          if (p && typeof p.catch === 'function') {
            p.catch(() => { try { video.currentTime = seekTo; } catch {} });
          }
        });
        // 再生が 0.1 秒以上進んだ実フレームをキャプチャ（正常系・iOS含む）
        video.addEventListener('timeupdate', () => {
          if (!captured && video.currentTime >= 0.1) {
            try { video.pause(); } catch {}
            captureSoon();
          }
        });
        // seek 経路（自動再生フォールバック / 一部デスクトップ）
        video.addEventListener('seeked', captureSoon, { once: true });
        video.addEventListener('error', () => finish(null), { once: true });
        video.src = directUrl;
      });

    } else if (ext === 'dxf') {
      if (typeof wnDxfThumbnail !== 'function') return;
      const text = await wnFetchDxfText(f.id);
      if (!text) return;
      /* 大きめに描画してから高品質縮小（線を濃く残すスーパーサンプリング） */
      const canvas = document.createElement('canvas');
      canvas.width = 2048; canvas.height = 1024;
      if (!wnDxfThumbnail(canvas, text)) return;
      const out = wnShrinkCanvas(canvas, wnThumbTargetLong());
      wnEnhanceLineArt(out);
      blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.90));
      wnFreeCanvas(canvas, out);

    } else if (['xlsx','xls','xlsm'].includes(ext)) {
      if (typeof XLSX === 'undefined') return;
      const res = await fetch(directUrl);
      if (!res.ok) return;
      const buffer = await res.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
      const canvas = document.createElement('canvas');
      canvas.width = 360 * THUMB_SS; canvas.height = 480 * THUMB_SS;
      if (!drawExcelThumbnail(canvas, wb)) return;
      blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));

    } else if (['docx','docm'].includes(ext)) {
      if (typeof mammoth === 'undefined') return;
      const res = await fetch(directUrl);
      if (!res.ok) return;
      const buffer = await res.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      const canvas = document.createElement('canvas');
      canvas.width = 360 * THUMB_SS; canvas.height = 480 * THUMB_SS;
      if (!drawWordThumbnail(canvas, result.value || '')) return;
      blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));

    } else if (['pptx','ppt','pptm'].includes(ext)) {
      /* PowerPoint: サーバー変換済みPDF（preview-pdf）の1ページ目をサムネイル化。
         アップロード時にプリキャッシュ済みなので通常は即返る */
      if (typeof pdfjsLib === 'undefined') return;
      const res = await wnFetch(`/wn/files/${f.id}/preview-pdf`);
      if (!res || !res.ok) return;
      const buffer   = await res.arrayBuffer();
      const pdf      = await pdfjsLib.getDocument({ data: buffer }).promise;
      const page     = await pdf.getPage(1);
      const ssLong   = WN_IS_MOBILE ? 1400 : 2600;
      const base     = page.getViewport({ scale: 1 });
      const scale    = Math.min(WN_IS_MOBILE ? 2 : 4, Math.max(1.5, ssLong / Math.max(base.width, base.height)));
      const viewport = page.getViewport({ scale });
      const canvas   = document.createElement('canvas');
      canvas.width   = Math.round(viewport.width);
      canvas.height  = Math.round(viewport.height);
      const pptCtx   = canvas.getContext('2d');
      pptCtx.fillStyle = '#ffffff';
      pptCtx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: pptCtx, viewport }).promise;
      /* スライドは全面デザインが多いので余白カット・線画強調はかけない */
      const out = wnShrinkCanvas(canvas, wnThumbTargetLong());
      blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.90));
      wnFreeCanvas(canvas, out);
      pdf.destroy?.();
    }
    } finally {
      wnGenSem.release();   // 生成セマフォを必ず解放
    }

    if (!blob) return;

    /* ── IndexedDBに保存（同一端末の次回用） ── */
    await ThumbCache.evictOld(f.id).catch(() => {});
    await ThumbCache.set(cacheKey, blob).catch(() => {});

    /* ── サーバーへも保存（全端末・全ユーザーの次回を即配信化） ── */
    wnUploadThumb(f.id, blob);

    /* ── 表示 ── */
    const objUrl = URL.createObjectURL(blob);
    thumbMemCache[cacheKey] = objUrl;
    appendImg(iconId, objUrl, appendOpts);

  } catch(e) { console.warn('thumb error:', f.file_name, e); }
}

/* サーバー保存型サムネイルを fetch で取得して blob を返す（404・例外・タイムアウトは null）。
   blob を返すことで呼び出し側が IndexedDB へ永続化でき、再訪をゼロ通信化できる。
   URLは g(世代)+t(更新時刻) を含むのでHTTPキャッシュも効く。サーバーが画像/Officeを
   その場生成する場合に時間がかかることがあるため 8 秒で諦めてクライアント生成へ。 */
async function wnFetchServerThumb(fileId, updatedAt) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(wnThumbUrl(fileId, updatedAt), { signal: ctl.signal });
    if (!res.ok) return null;               // 404 → クライアント生成へ
    const blob = await res.blob();
    return blob && blob.size > 0 ? blob : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

  /* 論理座標 (360x480) で描き、THUMB_SS 倍で高解像度ラスタライズ */
  const W = canvas.width / THUMB_SS;
  const H = canvas.height / THUMB_SS;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(THUMB_SS, 0, 0, THUMB_SS, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  /* 上部: Excelタイトルバー */
  const headerH = 22;
  ctx.fillStyle = '#107c41';
  ctx.fillRect(0, 0, W, headerH);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('Excel', 8, headerH / 2);

  /* 表領域 */
  const tableY = headerH;
  const tableH = H - tableY;
  const cellW = W / cols;
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
  /* 論理座標 (360x480) で描き、THUMB_SS 倍で高解像度ラスタライズ */
  const W = canvas.width / THUMB_SS;
  const H = canvas.height / THUMB_SS;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(THUMB_SS, 0, 0, THUMB_SS, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  /* 上部: Wordタイトルバー */
  const headerH = 22;
  ctx.fillStyle = '#2b579a';
  ctx.fillRect(0, 0, W, headerH);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('Word', 8, headerH / 2);

  /* 本文を行に分割して描画 */
  const padding = 14;
  const startY = headerH + 16;
  const lineH = 12;
  const maxWidth = W - padding * 2;
  ctx.font = '10px "Yu Gothic","Hiragino Sans","Meiryo",sans-serif';
  ctx.fillStyle = '#222';
  ctx.textBaseline = 'top';

  const lines = (text || '').split(/\n+/).filter(l => l.trim()).slice(0, 40);
  let y = startY;
  for (const line of lines) {
    if (y + lineH > H - 4) break;
    /* 長すぎる行は折り返し */
    let remaining = line.trim();
    while (remaining && y + lineH <= H - 4) {
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
  /* 文書系 (PDF/Excel/Word/DXF) は contain で全体を表示し白背景。
     画像/動画は中央クロップ (cover) のまま。 */
  const isDoc = opts.anchor === 'top';
  const objectFit      = isDoc ? 'contain' : 'cover';
  const objectPosition = isDoc ? 'top center' : 'center';

  /* カードビュー */
  const iconEl = document.getElementById(iconId);
  if (iconEl) {
    const thumb = iconEl.closest('.file-card-thumb');
    if (thumb) {
      if (isDoc) thumb.style.background = '#fff';
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';   // メインスレッドのデコード待ちを避ける
      img.style.cssText = `width:100%;height:100%;object-fit:${objectFit};object-position:${objectPosition};display:block;position:absolute;inset:0;border-radius:4px 4px 0 0;`;
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
      if (isDoc) rowThumb.style.background = '#fff';
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.style.cssText = `width:100%;height:100%;object-fit:${objectFit};object-position:${objectPosition};display:block;border-radius:4px;`;
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
                || ['xlsx','xls','xlsm','docx','docm','pptx','ppt','pptm'].includes(ext);
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
    <div class="file-card-thumb"><span class="wn-select-check" data-check-id="${f.id}"><i class="fa-regular fa-circle"></i></span>${thumbHtml}</div>
    ${vBadge ? `<div class="file-card-badge">${vBadge}</div>` : ''}
    <div class="file-card-body">
      <div class="file-card-name" title="${h(f.file_name)}">${h(f.file_name)}</div>
      ${apBadgeHtml ? `<div style="margin-bottom:4px;">${apBadgeHtml}</div>` : ''}
      <div class="file-card-meta">
        <span>${wnFormatDate(f.created_at)}</span>
        <span>${wnFormatSize(f.file_size)}</span>
        ${ext ? `<span class="file-card-ext">${ext.toUpperCase()}</span>` : ''}
      </div>
      ${f.uploader?.name ? `<div class="file-card-uploader"><i class="fa-regular fa-user"></i>${h(f.uploader.name)}</div>` : ''}
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
                onmouseenter="prefetchEmailShare(${f.id})"
                onclick="event.stopPropagation();openEmailModal([{id:${f.id},name:'${h(f.file_name)}'}])">
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
        ${pageCountBadgeHtml(f)}
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
                || ['xlsx','xls','xlsm','docx','docm','pptx','ppt','pptm'].includes(ext);
  const iconContent = hasThumb
    ? `<i class="fa-solid ${icon} ${cls}" id="thumb-icon-row-${f.id}"></i>`
    : `<i class="fa-solid ${icon} ${cls}"></i>`;
  const approvalBadge = (() => {
    const s = f.approval_status ?? 'none';
    if (s === 'none') return '';
    const b = wnApprovalBadge(s);
    return `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;color:${b.color};background:${b.bg};">${b.label}</span>`;
  })();
  const fnameSafe = h(f.file_name);
  return `
  <div class="file-row" data-file-id="${f.id}">
    <div class="file-row-thumb"><span class="wn-select-check" data-check-id="${f.id}"><i class="fa-regular fa-circle"></i></span>${iconContent}</div>
    <div class="file-row-name">
      <div class="file-row-filename">${fnameSafe}</div>
      <div class="file-row-tags">${(f.tags || []).slice(0, 5).map(t =>
        `<span class="tag" style="font-size:10px;padding:2px 7px;line-height:1.4;">${h(t.name)}</span>`
      ).join('')}</div>
      <div class="file-row-meta">
        ${f.version > 1 ? `<span class="file-card-version">v${f.version}</span>` : ''}
        ${approvalBadge}
        <span class="file-row-size">${wnFormatSize(f.file_size)}</span>
        <span class="file-row-date">${wnFormatDate(f.created_at)}</span>
        ${f.uploader?.name ? `<span class="file-row-uploader"><i class="fa-regular fa-user"></i>${h(f.uploader.name)}</span>` : ''}
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
                onmouseenter="prefetchEmailShare(${f.id})"
                onclick="event.stopPropagation();openEmailModal([{id:${f.id},name:'${fnameSafe}'}])">
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
        ${pageCountBadgeHtml(f)}
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
                || ['xlsx','xls','xlsm','docx','docm','pptx','ppt','pptm'].includes(ext);
  const placeholderIcon = hasThumb
    ? `<i class="fa-solid ${icon} ${cls}" id="thumb-icon-row-${f.id}"></i>`
    : `<i class="fa-solid ${icon} ${cls}"></i>`;

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
        `<span class="tag${''}">${h(t.name)}</span>`
      ).join('')}</div>`
    : '';

  const likeCount = f.like_count ?? 0;
  const viewCount = f.view_count ?? 0;
  const cmtCount  = f.comment_count ?? 0;

  return `
  <article class="ig-post" data-file-id="${f.id}">
    <div class="file-row-thumb">
      <span class="wn-select-check" data-check-id="${f.id}"><i class="fa-regular fa-circle"></i></span>
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
                onmouseenter="prefetchEmailShare(${f.id})"
                onclick="event.stopPropagation();openEmailModal([{id:${f.id},name:'${fnameSafe}'}])">
          <i class="fa-regular fa-envelope"></i>
        </button>
        <button class="file-action-btn" title="ダウンロード"
                onclick="event.stopPropagation();wnDownload(${f.id})">
          <i class="fa-solid fa-download"></i>
        </button>
        ${pageCountBadgeHtml(f, 'ig-page-count')}
      </div>
      <div class="right">
        <button class="file-action-btn file-action-delete" title="削除"
                onclick="event.stopPropagation();confirmDeleteFile(${f.id},'${fnameSafe}')">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>

    <div class="ig-post-date">
      <i class="fa-regular fa-clock"></i>${wnFormatDate(f.created_at)}
      ${f.uploader?.name ? `<span class="ig-post-uploader"><i class="fa-regular fa-user"></i>${h(f.uploader.name)}</span>` : ''}
    </div>

    <div class="ig-post-caption">
      <span class="filename">${fnameSafe}</span>
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
    `<span class="tag tag-draggable${selectedTags.includes(String(t.id)) ? ' active' : ''}"
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
    `<span class="tag tag-draggable${selectedTags.includes(String(t.id)) ? ' active' : ''}"
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
        `<span class="tag tag-draggable${selectedTags.includes(String(t.id)) ? ' active' : ''}"
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
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';
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
    if (selectedIds.length > 0) return; // ファイル選択中はスキル入力モード（検索しない）
    clearTimeout(timer);
    timer = setTimeout(loadFiles, 400);
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
    input.placeholder = selectedIds.length > 0 ? 'やりたいことを話してください…' : '話してください…';
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

    // ファイル選択中は音声入力をスキルとして実行
    if (selectedIds.length > 0) {
      runSkill(raw);
      return;
    }

    // 音声入力の正規化
    let q = normalizeVoiceQuery(raw);

    // ファジーマッチで実在ファイル名・タグ名に補正
    const corrected = fuzzyCorrectVoiceQuery(q);
    if (corrected && corrected !== q) {
      wnShowToast(`「${q}」→「${corrected}」に補正して検索します`, 'info');
      q = corrected;
    }
    if (q !== raw) input.value = q;

    if (!corrected) wnShowToast(`「${q}」で検索します`, 'success');
    loadFiles();
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

/* クリップボード貼り付けでアップロード
   PC: コピーした画像/ファイルやスクショ(Win+Shift+S)を、どの画面でも Ctrl+V で即取込。
   Webメールの添付画像をコピー→貼り付けで保存、といったダウンロード不要の最短導線。 */
function initPasteUpload() {
  document.addEventListener('paste', e => {
    const dt = e.clipboardData;
    if (!dt) return;

    let files = [];
    if (dt.files && dt.files.length) {
      files = Array.from(dt.files);
    } else if (dt.items && dt.items.length) {
      for (const it of dt.items) {
        if (it.kind === 'file') {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
    }
    /* ファイルが無ければ通常のテキスト貼り付け（検索欄・スキルバー等）を妨げない */
    if (!files.length) return;
    e.preventDefault();

    /* スクショ等は名前が無い/重複しがちなので分かりやすい名前を付与 */
    const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    const stamped = files.map((f, idx) => {
      if (f.name && f.name !== 'image.png' && f.name !== 'blob') return f;
      const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const suffix = files.length > 1 ? `-${idx + 1}` : '';
      return new File([f], `pasted-${ts}${suffix}.${ext}`, { type: f.type });
    });

    openUploadModal(stamped);
    wnShowToast(`${stamped.length}件を貼り付けました。確認して保存してください`, 'success');
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

  if (failCount === 0) {
    wnShowToast('アップロードが完了しました', 'success');
  }
}

/* ────────────────────────────────
   タグ管理パネル（管理者専用）
   ──────────────────────────────── */
function initTagManagePanel() {
  const btn = document.getElementById('tagManageBtn');
  if (!btn) return;
  if (!isAdmin(currentUser)) { btn.style.display = 'none'; return; }

  btn.addEventListener('click', () => {
    const panel = document.getElementById('tagManagePanel');
    const isOpen = panel.style.display !== 'none' && panel.style.display !== '';
    panel.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) renderTagManageList();
  });

  document.getElementById('tagManageCreateBtn').addEventListener('click', createTagFromPanel);
  document.getElementById('tagManageInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') createTagFromPanel();
  });

  document.addEventListener('click', e => {
    const panel = document.getElementById('tagManagePanel');
    if (!panel || !btn) return;
    if (!panel.contains(e.target) && !btn.contains(e.target)) {
      panel.style.display = 'none';
    }
  });
}

async function createTagFromPanel() {
  const input = document.getElementById('tagManageInput');
  const name = input.value.trim();
  if (!name) return;
  input.disabled = true;
  const tag = await wnCreateTag(name);
  input.disabled = false;
  if (!tag) { wnShowToast('タグの作成に失敗しました', 'danger'); return; }
  input.value = '';
  allTags = await wnGetTags();
  renderTagFilter();
  renderTagManageList();
  wnShowToast(`「${tag.name}」を作成しました`, 'success');
}

function renderTagManageList() {
  const list = document.getElementById('tagManageList');
  if (!allTags.length) {
    list.innerHTML = '<p style="font-size:12px;color:var(--muted);margin:0;">タグがありません</p>';
    return;
  }
  list.innerHTML = allTags.map(t => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:13px;">${h(t.name)}</span>
      <span style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:11px;color:var(--muted);">${t.files_count ?? 0}件</span>
        <button class="btn btn-ghost btn-sm tag-manage-delete" data-tag-id="${t.id}" data-tag-name="${h(t.name)}" data-files-count="${t.files_count ?? 0}"
                style="padding:2px 6px;font-size:11px;color:var(--danger,#e53e3e);">
          <i class="fa-solid fa-trash"></i>
        </button>
      </span>
    </div>
  `).join('');

  list.querySelectorAll('.tag-manage-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tagId     = Number(btn.dataset.tagId);
      const tagName   = btn.dataset.tagName;
      const filesCount = Number(btn.dataset.filesCount);
      const msg = filesCount > 0
        ? `「${tagName}」は${filesCount}件のファイルに使用中です。削除しますか？`
        : `「${tagName}」を削除しますか？`;
      if (!confirm(msg)) return;
      const ok = await wnDeleteTag(tagId);
      if (!ok) { wnShowToast('削除に失敗しました', 'danger'); return; }
      allTags = await wnGetTags();
      renderTagFilter();
      renderTagManageList();
      wnShowToast(`「${tagName}」を削除しました`, 'success');
    });
  });
}

/* ────────────────────────────────
   一括タグ付け
   ──────────────────────────────── */
function initBulkTag() {
  let bulkAllTags = [];

  document.getElementById('bulkTagBtn').addEventListener('click', async () => {
    const panel = document.getElementById('bulkTagPickerPanel');
    const isOpen = panel.style.display !== 'none';
    if (isOpen) { panel.style.display = 'none'; return; }
    if (!bulkAllTags.length) bulkAllTags = await wnGetTags();
    renderBulkTagList(bulkAllTags);
    document.getElementById('bulkTagSearch').value = '';
    panel.style.display = 'block';
    document.getElementById('bulkTagSearch').focus();
  });

  document.getElementById('bulkTagSearch').addEventListener('input', () => {
    const q = document.getElementById('bulkTagSearch').value.toLowerCase();
    renderBulkTagList(bulkAllTags.filter(t => t.name.toLowerCase().includes(q)));
  });

  document.addEventListener('click', e => {
    const panel = document.getElementById('bulkTagPickerPanel');
    const btn   = document.getElementById('bulkTagBtn');
    if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
      panel.style.display = 'none';
    }
  });
}

function renderBulkTagList(tags) {
  const list = document.getElementById('bulkTagList');
  if (!tags.length) {
    list.innerHTML = '<span style="font-size:12px;color:var(--muted);">タグがありません</span>';
    return;
  }
  list.innerHTML = tags.map(t =>
    `<span class="tag tag-selectable" data-tag-id="${t.id}" style="cursor:pointer;margin:2px;">${h(t.name)}</span>`
  ).join('');
  list.querySelectorAll('.tag-selectable').forEach(el => {
    el.addEventListener('click', async () => {
      const tagId   = Number(el.dataset.tagId);
      const tagName = el.textContent.trim();
      document.getElementById('bulkTagPickerPanel').style.display = 'none';
      const targets = [...selectedIds];
      let ok = 0;
      await Promise.all(targets.map(async fid => {
        const res = await wnAddTag(fid, tagId);
        if (res) ok++;
      }));
      wnShowToast(`${ok}件のファイルに「${tagName}」を追加しました`, ok ? 'success' : 'danger');
      loadFiles();
    });
  });
}

/* ────────────────────────────────
   タグ付きURL共有
   ──────────────────────────────── */
function initTagShare() {
  document.getElementById('tagShareBtn')?.addEventListener('click', () => {
    if (!selectedTags.length) {
      wnShowToast('タグを選択してからコピーしてください', 'info');
      return;
    }
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('tags', selectedTags.join(','));
    navigator.clipboard.writeText(url.toString())
      .then(() => wnShowToast('リンクをコピーしました', 'success'))
      .catch(() => wnShowToast('コピーに失敗しました', 'danger'));
  });
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
    if (wnTotalCount > 0) wnTotalCount--;
    renderFiles();
  } else {
    wnShowToast('削除に失敗しました', 'danger');
  }
}

/* ────────────────────────────────
   行内コメント表示
   ──────────────────────────────── */
const WN_ROW_COMMENTS_CONCURRENCY = 6; // 同一トークンでの同時リクエスト数を抑え、サーバー側の詰まりを防ぐ

async function loadRowComments(files = allFiles) {
  // コメント0件のファイルはAPIを叩かず空表示にする（一覧の comment_count を利用）。
  const targets = files.filter(f => {
    const el = document.getElementById(`row-comments-${f.id}`);
    if (!el) return false;
    if (!f.comment_count) { renderRowComments(el, f.id, []); return false; }
    return true;
  });

  // 同時実行数を絞りつつ順次処理（1画面数十件でも一斉リクエストにしない）
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const f = targets[cursor++];
      const el = document.getElementById(`row-comments-${f.id}`);
      if (!el) continue;
      const comments = await wnGetComments(f.id);
      renderRowComments(el, f.id, comments);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(WN_ROW_COMMENTS_CONCURRENCY, targets.length) }, worker)
  );
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
let emailModalFiles    = [];   // [{ id, name }]
let emailPregenShares  = null; // [{ id, name, url }] | null
const emailShareCache  = new Map(); // fileId → Promise<share>（hover先行発行キャッシュ）

// TO/CC/BCC 共通のチップ状態・要素ID定義
const emailFieldChips = { to: [], cc: [], bcc: [] }; // field → { email: string }[]
const EMAIL_FIELD_IDS = {
  to:  { input: 'emailInput',    addBtn: 'emailAddBtn',    chipList: 'emailChipList',    suggest: 'emailSuggestList',    err: 'emailInputError',    errText: 'emailInputErrorText',    label: '送信先' },
  cc:  { input: 'emailCcInput',  addBtn: 'emailCcAddBtn',  chipList: 'emailCcChipList',  suggest: 'emailCcSuggestList',  err: 'emailCcInputError',  errText: 'emailCcInputErrorText',  label: 'CC' },
  bcc: { input: 'emailBccInput', addBtn: 'emailBccAddBtn', chipList: 'emailBccChipList', suggest: 'emailBccSuggestList', err: 'emailBccInputError', errText: 'emailBccInputErrorText', label: 'BCC' },
};

function initEmailModal() {
  const overlay   = document.getElementById('emailModal');
  const closeBtn  = document.getElementById('emailModalClose');
  const cancelBtn = document.getElementById('emailCancelBtn');
  const msgArea   = document.getElementById('emailMessage');
  const msgCount  = document.getElementById('emailMsgCount');

  closeBtn.addEventListener('click',  closeEmailModal);
  cancelBtn.addEventListener('click', closeEmailModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeEmailModal();
  });

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

  msgArea.addEventListener('input', () => {
    msgCount.textContent = msgArea.value.length;
    if (msgArea.value.length > 500) {
      msgArea.value = msgArea.value.slice(0, 500);
      msgCount.textContent = 500;
    }
  });

  document.getElementById('emailCopyLinkBtn')?.addEventListener('click', () => {
    if (!emailPregenShares?.length) return;
    const text = emailPregenShares.length === 1
      ? emailPregenShares[0].url
      : emailPregenShares.map(s => `■ ${s.name}\n${s.url}`).join('\n\n');
    navigator.clipboard.writeText(text)
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

/* メールボタン hover 時に共有リンクを先行発行してキャッシュ */
function prefetchEmailShare(fileId) {
  if (emailShareCache.has(fileId)) return;
  emailShareCache.set(fileId, wnCreateShare(fileId, { expiresDays: 30 }));
}

function openEmailModal(files, prefillEmail = null) {
  emailModalFiles   = Array.isArray(files) ? files : (files ? [files] : []);
  emailPregenShares = null;
  emailFieldChips.to  = prefillEmail ? [{ email: prefillEmail }] : [];
  emailFieldChips.cc  = [];
  emailFieldChips.bcc = [];

  const hasFiles = emailModalFiles.length > 0;
  document.getElementById('emailFileSection').style.display = hasFiles ? 'block' : 'none';

  document.getElementById('emailMessage').value  = '';
  document.getElementById('emailMsgCount').textContent = '0';
  document.getElementById('emailSigEditArea').style.display = 'none';
  document.getElementById('emailCcSection').classList.add('hidden');
  document.getElementById('emailBccSection').classList.add('hidden');
  document.getElementById('emailCcBccToggleBtn').classList.remove('hidden');
  for (const field of Object.keys(EMAIL_FIELD_IDS)) {
    const ids = EMAIL_FIELD_IDS[field];
    document.getElementById(ids.input).value = '';
    document.getElementById(ids.err).style.display = 'none';
    renderEmailChips(field);
    _emailHideSuggest(field);
  }
  _emailRenderSigPreview();
  wnGetContacts().then(list => { allContactsCache = list; }).catch(() => {});

  if (!hasFiles) {
    emailPregenShares = [];
    setEmailBtnsLoading(false);
    document.getElementById('emailModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('emailInput').focus(), 100);
    return;
  }

  // ファイルリスト表示
  const listEl = document.getElementById('emailModalFileList');
  if (listEl) {
    if (emailModalFiles.length === 1) {
      listEl.innerHTML = `<i class="fa-solid fa-file" style="margin-right:4px;"></i>${h(emailModalFiles[0].name)}`;
    } else {
      listEl.innerHTML = `<div style="margin-bottom:4px;"><i class="fa-solid fa-copy" style="margin-right:4px;"></i><strong>${emailModalFiles.length}件のファイル</strong></div>`
        + emailModalFiles.map(f => `<div style="padding-left:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${h(f.name)}</div>`).join('');
    }
  }

  // リンク生成中の表示
  _emailLinkShowLoading();
  setEmailBtnsLoading(true);

  // 全ファイルの共有リンクを並行生成（hoverキャッシュがあれば再利用）
  const promises = emailModalFiles.map(f => {
    const p = emailShareCache.has(f.id)
      ? emailShareCache.get(f.id)
      : wnCreateShare(f.id, { expiresDays: 30 });
    if (!emailShareCache.has(f.id)) emailShareCache.set(f.id, p);
    return p.then(share => ({ id: f.id, name: f.name, url: share?.url ?? null }));
  });

  Promise.all(promises).then(results => {
    const failed = results.filter(r => !r.url);
    if (failed.length > 0) {
      failed.forEach(r => emailShareCache.delete(r.id));
      setEmailBtnsLoading(false);
      _emailLinkShowError();
      wnShowToast('共有リンクの発行に失敗しました', 'danger');
      return;
    }
    emailPregenShares = results;
    setEmailBtnsLoading(false);
    if (emailPregenShares.length === 1) {
      _emailLinkShowReady(emailPregenShares[0].url);
    } else {
      _emailLinkShowReadyMulti(emailPregenShares.length);
    }
  }).catch(() => {
    emailModalFiles.forEach(f => emailShareCache.delete(f.id));
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
  if (el)  el.style.display  = 'none';
  if (rd)  rd.style.display  = 'flex';
  if (txt) txt.textContent   = url;
}
function _emailLinkShowError() {
  const el = document.getElementById('emailLinkLoading');
  if (el) { el.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#E17055;"></i> リンクの生成に失敗しました'; }
}
function _emailLinkShowReadyMulti(count) {
  const el  = document.getElementById('emailLinkLoading');
  const rd  = document.getElementById('emailLinkReady');
  const txt = document.getElementById('emailLinkUrl');
  if (el)  el.style.display  = 'none';
  if (rd)  rd.style.display  = 'flex';
  if (txt) txt.textContent   = `${count}件の共有リンクを生成しました`;
}

function closeEmailModal() {
  document.getElementById('emailModal').classList.add('hidden');
  emailModalFiles     = [];
  emailPregenShares   = null;
  emailFieldChips.to  = [];
  emailFieldChips.cc  = [];
  emailFieldChips.bcc = [];
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
  // スキル経由で宛先(TO)を手入力した場合は、次回から自動解決できるよう連絡先に保存
  if (field === 'to' && skillPendingName) {
    const nm = skillPendingName;
    skillPendingName = '';
    wnSaveContact(nm, val).catch(() => {});
  }
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
  const candidates = allContactsCache.filter(c => !addedEmails.has(c.email));
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
        style="background:none;border:none;cursor:pointer;color:#1565C0;font-size:12px;padding:0;line-height:1;display:flex;align-items:center;">
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

/* 宛先・件名・本文を同期で組み立てる */
function _buildEmailContent() {
  if (emailModalFiles.length > 0 && !emailPregenShares?.length) return null;

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

  const to      = emailFieldChips.to.map(c => c.email).join(',');
  const cc      = emailFieldChips.cc.map(c => c.email).join(',');
  const bcc     = emailFieldChips.bcc.map(c => c.email).join(',');
  const sig     = localStorage.getItem(WN_MAIL_SIG_KEY) || '';
  const sigText = sig ? `\r\n\r\n--\r\n${sig}` : '';
  const message = document.getElementById('emailMessage').value.trim();

  if (emailModalFiles.length === 0) {
    return { to, cc, bcc, subject: '', body: message + sigText };
  }

  const subject = emailModalFiles.length === 1
    ? `【What'sNo】${emailModalFiles[0].name} を共有します`
    : `【What'sNo】${emailModalFiles.length}件のファイルを共有します`;
  const lines = [];
  if (message) { lines.push(message, ''); }
  lines.push('▼ ファイルはこちらからご確認ください');
  for (const s of emailPregenShares) {
    lines.push('');
    lines.push(`■ ${s.name}`);
    lines.push(s.url);
  }
  lines.push('');
  lines.push('※ リンクからダウンロードできます（有効期限：発行から30日）');
  return { to, cc, bcc, subject, body: lines.join('\r\n') + sigText };
}

/* Gmail の作成画面を開く */
function doSendEmailGmail() {
  const m = _buildEmailContent();
  if (!m) { wnShowToast('共有リンクを生成中です。少々お待ちください', 'info'); return; }
  wnSetMailerPref('gmail');   // 次回スキルから自動でGmailを起動

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
  wnSetMailerPref('mailto');   // 次回スキルから自動で既定メールアプリを起動
  const url = `mailto:${m.to}`
    + `?${m.cc  ? `cc=${encodeURIComponent(m.cc)}&`   : ''}`
    + `${m.bcc ? `bcc=${encodeURIComponent(m.bcc)}&` : ''}`
    + `subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
  window.location.href = url;
  wnShowToast('メールアプリを起動しました', 'success');
  closeEmailModal();
}

/* ────────────────────────────────
   PDF結合（選択モード＋結合モーダル）
   ──────────────────────────────── */
let mergeBusy = false;   // 結合処理の実行中フラグ（多重実行・途中閉じ防止）

function wnIsPdf(f) {
  const ext = (f.file_name || '').split('.').pop().toLowerCase();
  return ext === 'pdf' || f.mime_type === 'application/pdf';
}

function initMergeSelect() {
  document.getElementById('selectModeBtn')?.addEventListener('click', toggleSelectMode);
  document.getElementById('mergeCancelBtn')?.addEventListener('click', () => { if (selectMode) toggleSelectMode(); });
  document.getElementById('mergeOpenBtn')?.addEventListener('click', openMergeModal);
  document.getElementById('mergeModalClose')?.addEventListener('click', closeMergeModal);
  document.getElementById('mergeModalCancelBtn')?.addEventListener('click', closeMergeModal);
  document.getElementById('mergeExecBtn')?.addEventListener('click', executeMerge);
  document.getElementById('emailSelBtn')?.addEventListener('click', () => {
    const files = selectedIds.map(id => {
      const f = allFiles.find(f => String(f.id) === String(id));
      return f ? { id: f.id, name: f.file_name } : null;
    }).filter(Boolean);
    if (files.length > 0) openEmailModal(files);
  });
  document.getElementById('aaPostSelBtn')?.addEventListener('click', () => {
    const files = selectedIds.map(id => {
      const f = allFiles.find(f => String(f.id) === String(id));
      return f ? { id: f.id, name: f.file_name } : null;
    }).filter(Boolean);
    if (files.length > 0) openAaPostModal(files);
  });
  document.getElementById('aaPostModalClose')?.addEventListener('click', closeAaPostModal);
  document.getElementById('aaPostModalCancelBtn')?.addEventListener('click', closeAaPostModal);
  document.getElementById('aaPostExecBtn')?.addEventListener('click', () => {
    const btn = document.getElementById('aaPostExecBtn');
    if (btn.dataset.mode === 'done') closeAaPostModal();
    else executeAaPost();
  });
  document.getElementById('aaPostViewBtn')?.addEventListener('click', wnOpenAaInNewTab);
}

function toggleSelectMode() {
  selectMode = !selectMode;
  document.body.classList.toggle('select-mode', selectMode);
  const label = document.getElementById('selectModeBtnLabel');
  if (label) label.textContent = selectMode ? '選択解除' : '選択';
  document.getElementById('mergeActionBar')?.classList.toggle('hidden', !selectMode);
  // 選択モード中はmergeActionBarと位置が被るのでスクロールトップボタンを退避
  updateScrollTopButtonVisibility();
  if (!selectMode) {
    selectedIds.forEach(id => applySelectedVisual(id, false));
    selectedIds = [];
  }
  updateMergeActionBar();
}

function toggleMergeSelect(fileId) {
  // 「選択」はスキル対象・結合の共通選択。種別を問わず選べる（結合はPDFのみ有効化）。
  const id = String(fileId);
  const f  = allFiles.find(x => String(x.id) === id);
  if (!f) return;
  const idx = selectedIds.indexOf(id);
  if (idx >= 0) selectedIds.splice(idx, 1);
  else selectedIds.push(id);
  applySelectedVisual(id, idx < 0);
  updateMergeActionBar();
}

function applySelectedVisual(fileId, on) {
  // グリッドとリストの両方が同時にDOMに存在するため全要素に適用
  document.querySelectorAll(`[data-file-id="${fileId}"]`).forEach(el => {
    el.classList.toggle('wn-selected', on);
    const icon = el.querySelector('.wn-select-check i');
    if (icon) icon.className = on ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle';
  });
}

function updateMergeActionBar() {
  const count    = document.getElementById('mergeSelCount');
  const btn      = document.getElementById('mergeOpenBtn');
  const lbl      = document.getElementById('mergeOpenLabel');
  const emailBtn = document.getElementById('emailSelBtn');
  // 結合は「2件以上 かつ 全てPDF」のときだけ有効
  const sel    = selectedIds.map(id => allFiles.find(f => String(f.id) === String(id))).filter(Boolean);
  const allPdf = sel.length >= 2 && sel.every(wnIsPdf);
  if (count) count.textContent = `${selectedIds.length}件選択中`;
  if (btn) {
    btn.disabled = !allPdf;
    btn.title    = allPdf ? '' : 'PDFを2つ以上選択すると結合できます';
  }
  if (lbl)      lbl.textContent = allPdf ? `${sel.length}件を結合` : '結合';
  if (emailBtn) emailBtn.disabled = selectedIds.length === 0;
  const bulkTagBtn = document.getElementById('bulkTagBtn');
  if (bulkTagBtn) bulkTagBtn.disabled = selectedIds.length === 0;
  const aaBtn = document.getElementById('aaPostSelBtn');
  if (aaBtn) aaBtn.disabled = selectedIds.length === 0;

  // ファイル選択中はスキル入力モードとしてプレースホルダーを切り替え
  const si = document.getElementById('searchInput');
  if (si) {
    si.placeholder = selectedIds.length > 0
      ? 'やりたいことを入力して送信（例: 向後さんにメールして）…'
      : '検索、またはやりたいことを入力…';
  }
}

/* ── 結合モーダル ── */

function mergeDefaultName() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `結合_${ymd}.pdf`;
}

function openMergeModal() {
  if (selectedIds.length < 2) return;
  // 防御: 非PDFが混ざっていたら結合しない（ボタン無効化の二重チェック）
  const sel = selectedIds.map(id => allFiles.find(f => String(f.id) === String(id))).filter(Boolean);
  if (!sel.every(wnIsPdf)) {
    wnShowToast('結合できるのはPDFファイルのみです', 'warning');
    return;
  }
  mergeOrder = [...selectedIds];
  document.getElementById('mergeFileName').value = mergeDefaultName();
  const prog = document.getElementById('mergeProgress');
  prog.style.display = 'none';
  document.getElementById('mergeProgressBar').style.width = '0%';
  document.getElementById('mergeProgressText').textContent = '';
  setMergeModalBusy(false);
  renderMergeList();
  document.getElementById('mergeModal').classList.remove('hidden');
}

function closeMergeModal() {
  if (mergeBusy) return;   // 結合中は閉じない
  document.getElementById('mergeModal').classList.add('hidden');
}

function renderMergeList() {
  const list = document.getElementById('mergeFileList');
  list.innerHTML = mergeOrder.map((id, i) => {
    const f = allFiles.find(x => String(x.id) === id);
    if (!f) return '';
    const cacheKey = `thumb_${f.id}_${f.updated_at ?? f.created_at ?? ''}_${THUMB_VER}`;
    const { icon, cls } = wnFileIcon(f.file_name, f.mime_type);
    const thumb = thumbMemCache[cacheKey]
      ? `<img class="merge-item-thumb" src="${thumbMemCache[cacheKey]}" alt="">`
      : `<span class="merge-item-icon"><i class="fa-solid ${icon} ${cls}"></i></span>`;
    return `
    <div class="merge-item">
      <span class="merge-item-num">${i + 1}</span>
      ${thumb}
      <span class="merge-item-name" title="${h(f.file_name)}">${h(f.file_name)}</span>
      <span class="merge-item-btns">
        <button title="上へ" onclick="mergeMoveItem(${i},-1)" ${i === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-up"></i></button>
        <button title="下へ" onclick="mergeMoveItem(${i},1)" ${i === mergeOrder.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-down"></i></button>
        <button title="リストから外す" onclick="mergeRemoveItem(${i})"><i class="fa-solid fa-xmark"></i></button>
      </span>
    </div>`;
  }).join('');
  document.getElementById('mergeExecBtn').disabled = mergeBusy || mergeOrder.length < 2;
}

function mergeMoveItem(i, dir) {
  if (mergeBusy) return;
  const j = i + dir;
  if (j < 0 || j >= mergeOrder.length) return;
  [mergeOrder[i], mergeOrder[j]] = [mergeOrder[j], mergeOrder[i]];
  renderMergeList();
}

function mergeRemoveItem(i) {
  if (mergeBusy) return;
  mergeOrder.splice(i, 1);
  renderMergeList();
}

function setMergeModalBusy(busy) {
  mergeBusy = busy;
  const exec = document.getElementById('mergeExecBtn');
  exec.disabled = busy || mergeOrder.length < 2;
  exec.innerHTML = busy
    ? '<i class="fa-solid fa-spinner fa-spin"></i> 結合中…'
    : '<i class="fa-solid fa-object-group"></i> 結合する';
  document.getElementById('mergeModalClose').disabled     = busy;
  document.getElementById('mergeModalCancelBtn').disabled = busy;
  document.getElementById('mergeFileName').disabled       = busy;
  document.querySelectorAll('input[name="mergeSaveMode"]').forEach(r => r.disabled = busy);
}

function setMergeProgress(pct, text) {
  document.getElementById('mergeProgress').style.display = 'block';
  document.getElementById('mergeProgressBar').style.width = `${Math.min(100, Math.round(pct))}%`;
  document.getElementById('mergeProgressText').textContent = text;
}

/* ── 結合実行 ──
   進捗配分: ダウンロード 0〜70% / PDF生成 70〜80% / アップロード 80〜100%
   元ファイルの削除（replaceモード）はアップロード成功後にのみ行う */
async function executeMerge() {
  if (mergeBusy || mergeOrder.length < 2) return;

  const nameInput = document.getElementById('mergeFileName');
  let finalName = nameInput.value.trim() || mergeDefaultName();
  if (!/\.pdf$/i.test(finalName)) finalName += '.pdf';
  nameInput.value = finalName;

  const saveMode = document.querySelector('input[name="mergeSaveMode"]:checked')?.value ?? 'keep';
  const order = [...mergeOrder];
  const nameOf = id => allFiles.find(x => String(x.id) === id)?.file_name ?? `ID:${id}`;

  setMergeModalBusy(true);
  try {
    const merged = await PDFLib.PDFDocument.create();

    // 直列処理（メモリ消費と単一ワーカーAPIの保護のため並列にしない）
    for (let i = 0; i < order.length; i++) {
      const id   = order[i];
      const name = nameOf(id);
      const base = (i / order.length) * 70;
      const span = 70 / order.length;
      setMergeProgress(base, `(${i + 1}/${order.length}) 「${name}」を取得中…`);

      const buf = await wnFetchFileBuffer(id, {
        onProgress: pct => setMergeProgress(base + span * pct / 100, `(${i + 1}/${order.length}) 「${name}」を取得中… ${pct}%`),
      });
      if (!buf) throw new Error(`「${name}」の取得に失敗しました。通信環境を確認して再試行してください`);

      let src;
      try {
        src = await PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
      } catch (e) {
        console.error('[executeMerge] load failed', name, e);
        throw new Error(`「${name}」を読み込めませんでした（破損または対応外のPDF）`);
      }
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach(p => merged.addPage(p));
      src = null;   // 参照を切ってGC可能に
    }

    setMergeProgress(72, '結合PDFを生成中…');
    const bytes = await merged.save();
    if (bytes.length > 100 * 1024 * 1024) {
      throw new Error('結合後のサイズが100MBを超えるため保存できません');
    }

    setMergeProgress(80, 'アップロード中…');
    const outFile = new File([bytes], finalName, { type: 'application/pdf' });
    const result  = await wnUploadFile(outFile, {
      onProgress: pct => setMergeProgress(80 + pct * 0.2, `アップロード中… ${pct}%`),
    });

    // ここまで来たら結合ファイルは保存済み。replaceモードのみ元ファイルを削除
    if (saveMode === 'replace') {
      setMergeProgress(100, '元ファイルを削除中…');
      const failNames = [];
      for (const id of order) {
        const ok = await wnDeleteFile(id);
        if (!ok) failNames.push(nameOf(id));
      }
      if (failNames.length) {
        wnShowToast(`結合は成功しましたが、${failNames.length}件の元ファイルを削除できませんでした`, 'warning');
      }
    }

    setMergeProgress(100, '完了');
    mergeBusy = false;
    closeMergeModal();
    if (selectMode) toggleSelectMode();
    wnShowToast(`${order.length}件のPDFを結合しました`, 'success');

    await loadFiles();
  } catch (err) {
    console.error('[executeMerge]', err);
    wnShowToast(err.message || 'PDFの結合に失敗しました', 'danger');
    setMergeModalBusy(false);   // モーダルは開いたまま＝設定を保持してリトライ可能
    document.getElementById('mergeProgressText').textContent = '';
  }
}

/* ────────────────────────────────
   a.aへ投稿（選択ファイルを1件=1投稿でa.aへ公開）
   ──────────────────────────────── */
let aaPostBusy = false;
let aaPostTargets = [];   // [{id, name}]

async function openAaPostModal(files) {
  if (!files || files.length === 0) return;

  // 事前会員チェック（フロント側のUX目的。バックエンドfromWnも同様のチェックで二重防御）
  const t = await wnGetAaTicket();
  if (!t || !t.is_member) {
    wnShowToast('この会社はまだa.aに参加していません', 'warning');
    return;
  }

  aaPostTargets = files;
  aaPostBusy = false;
  document.getElementById('aaPostFileList').innerHTML =
    files.map(f => `<div><i class="fa-solid fa-file"></i> ${h(f.name)}</div>`).join('');
  document.getElementById('aaPostCategory').value = '';
  document.getElementById('aaPostBody').value = '';
  document.getElementById('aaPostProgress').style.display = 'none';
  document.getElementById('aaPostProgressBar').style.width = '0%';
  document.getElementById('aaPostProgressText').textContent = '';
  document.getElementById('aaPostErrorList').style.display = 'none';
  document.getElementById('aaPostErrorList').innerHTML = '';
  document.getElementById('aaPostResultActions').style.display = 'none';
  document.getElementById('aaPostExecBtn').dataset.mode = 'post';
  setAaPostModalBusy(false);
  document.getElementById('aaPostModal').classList.remove('hidden');
}

function closeAaPostModal() {
  if (aaPostBusy) return;   // 投稿中は閉じない
  document.getElementById('aaPostModal').classList.add('hidden');
}

function setAaPostModalBusy(busy) {
  aaPostBusy = busy;
  const exec = document.getElementById('aaPostExecBtn');
  exec.disabled = busy;
  exec.textContent = busy ? '投稿中…' : '投稿する';
  document.getElementById('aaPostModalClose').disabled = busy;
  document.getElementById('aaPostModalCancelBtn').disabled = busy;
  document.getElementById('aaPostCategory').disabled = busy;
  document.getElementById('aaPostBody').disabled = busy;
}

async function executeAaPost() {
  if (aaPostBusy) return;
  const category = document.getElementById('aaPostCategory').value;
  if (!category) {
    wnShowToast('カテゴリを選択してください', 'warning');
    return;
  }
  const body = document.getElementById('aaPostBody').value.trim();

  setAaPostModalBusy(true);
  const progress = document.getElementById('aaPostProgress');
  progress.style.display = 'block';
  const errList = document.getElementById('aaPostErrorList');
  errList.style.display = 'none';
  errList.innerHTML = '';

  const total = aaPostTargets.length;
  let okCount = 0;
  const failed = [];

  for (let i = 0; i < total; i++) {
    const f = aaPostTargets[i];
    document.getElementById('aaPostProgressBar').style.width = `${Math.round((i / total) * 100)}%`;
    document.getElementById('aaPostProgressText').textContent = `(${i + 1}/${total}) 「${f.name}」を投稿中…`;
    try {
      await wnPostToAa(f.id, { category, body });
      okCount++;
    } catch (e) {
      failed.push({ name: f.name, message: e.message || '投稿に失敗しました' });
    }
  }

  document.getElementById('aaPostProgressBar').style.width = '100%';
  document.getElementById('aaPostProgressText').textContent = `${okCount}/${total}件 投稿完了`;

  if (failed.length > 0) {
    errList.style.display = 'block';
    errList.innerHTML = failed.map(f => `<div>${h(f.name)}: ${h(f.message)}</div>`).join('');
    wnShowToast('一部の投稿に失敗しました', 'warning');
  } else {
    wnShowToast('a.aへの投稿が完了しました', 'success');
  }

  if (okCount > 0) {
    document.getElementById('aaPostResultActions').style.display = 'block';
  }

  setAaPostModalBusy(false);
  const exec = document.getElementById('aaPostExecBtn');
  exec.textContent = '閉じる';
  exec.dataset.mode = 'done';
}

/* ────────────────────────────────
   デスクトップ連携 トークン自動同期
   ダッシュボード読み込み時に whatsno:// プロトコル経由で
   config.json を最新トークンで更新する（アカウント切り替え対応）
   ──────────────────────────────── */
async function syncDesktopToken() {
  const token = localStorage.getItem('space_token');
  if (!token) return;

  // 主: ローカル同期サーバー経由（ログイン時に自動起動 / ユーザー操作不要）
  try {
    const res = await fetch('http://localhost:39876/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) return;
  } catch {}

  // 副: whatsno:// プロトコル（サーバー未起動時のフォールバック）
  try {
    const a = document.createElement('a');
    a.href = `whatsno://sync?token=${encodeURIComponent(token)}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { if (a.parentNode) a.parentNode.removeChild(a); }, 500);
  } catch {}
}

/* ────────────────────────────────
   デスクトップ連携モーダル
   ──────────────────────────────── */
function initDesktopIntegrationModal() {
  const modal      = document.getElementById('desktopModal');
  const navBtn     = document.getElementById('navDesktop');
  const closeX     = document.getElementById('desktopModalClose');
  const closeBtn   = document.getElementById('desktopCloseBtn');
  const cmdPreview = document.getElementById('desktopCmdPreview');
  const copyBtn    = document.getElementById('desktopTokenCopy');

  function buildCommand() {
    const token = localStorage.getItem('space_token') || '';
    return `powershell -ExecutionPolicy Bypass -File ".\\wn-install.ps1" -Token "${token}"`;
  }

  function openModal() {
    cmdPreview.textContent = buildCommand();
    modal.classList.remove('hidden');
  }
  function closeModal() {
    modal.classList.add('hidden');
  }

  navBtn?.addEventListener('click', openModal);
  closeX?.addEventListener('click', closeModal);
  closeBtn?.addEventListener('click', closeModal);
  modal?.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  copyBtn?.addEventListener('click', async () => {
    const cmd = buildCommand();
    await navigator.clipboard.writeText(cmd);
    copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> コピー済み';
    setTimeout(() => { copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> コピー'; }, 2000);
  });
}
