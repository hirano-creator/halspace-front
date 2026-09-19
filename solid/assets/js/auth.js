'use strict';
/* Space認証チェック共通モジュール
   各アプリページの先頭で読み込む */

function getSpaceUser() {
  const raw = sessionStorage.getItem('space_user');
  return raw ? JSON.parse(raw) : null;
}

/* このファイル専用の最小限のAPI呼び出し。
   SOLID用のapi.js（JSONをparseしてエラーはthrow）とWhat'sNo用のwn-api.js（生Responseを返す、
   throwしない）は返り値の形が違うため共有できない。auth.jsは両方から読み込まれる共通ファイルなので、
   どちらの流儀にも依存しない自前実装をここに持つ。 */
function spaceApiBase() {
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.test')) return 'http://127.0.0.1:8000/api';
  return 'https://halspace-api-production.up.railway.app/api';
}
async function spaceApiPost(path, body) {
  const token = sessionStorage.getItem('space_token');
  const res = await fetch(spaceApiBase() + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) { spaceLogout(); return null; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

/* What'sNo拡張オプション（メール送信/比較・並べる/マニュアル/連絡先/Knowl/注釈）は
   6機能セットで一括契約の会社限定機能。ログイン時のuser情報に含まれるフラグで判定する。
   ここでの判定はUIの出し分けにしか使わない — 実際のアクセス制御は必ずAPI側(403)で行う。 */
function wnHasExtendedOptions() {
  return !!(getSpaceUser()?.wn_extended_options_enabled);
}

/* 拡張オプション専用のUI要素を、存在するものだけまとめて隠す。
   ページごとに使わないidは無視されるだけなので、どのページの初期化からでも安全に呼べる。 */
function wnApplyExtendedOptionsUi() {
  if (wnHasExtendedOptions()) return;
  [
    'navManuals', 'navBrainSidebar', 'bnBrain', 'contactsOpenBtn',
    'emailSelBtn', 'alignSelBtn', 'compareSelBtn',
    'emailShareBtn', 'annotateBtn',
    'lineSendBtn', 'lineSelBtn', 'lineShareBtn',   // メール送信と同じ拡張オプション扱い
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

/* 拡張オプション専用ページの入口ガード。未契約なら一覧へ戻す
   （リンクは隠しているが、直接URLアクセス・古いブックマーク対策として二重に防ぐ）。 */
function wnRequireExtendedOptions() {
  if (wnHasExtendedOptions()) return true;
  location.href = 'dashboard.html';
  return false;
}
/* このファイルはWhat'sNo/MeetLog等からも直接importされる共通ファイルのため、
   ログイン画面のリダイレクト先は実行中のページがSOLID配下かどうかで分岐する。
   SOLIDページ（solid/app/*.html）はSOLID独自ログイン（solid/login.html）へ、
   それ以外のアプリは従来通りSpace.appのログイン画面へ。 */
function loginUrl() {
  return location.pathname.includes('/solid/') ? '../login.html' : '../../space/login.html';
}
function requireSpaceAuth() {
  const user = getSpaceUser();
  if (!user) {
    location.href = loginUrl();
    return null;
  }
  initPasswordChangeModal();
  return user;
}
function spaceLogout() {
  sessionStorage.removeItem('space_token');
  sessionStorage.removeItem('space_user');
  sessionStorage.removeItem('solid_standalone');
  location.href = loginUrl();
}
/* SOLIDアプリから抜けてSpaceアプリ選択画面に戻る（トークンはそのまま残す） */
function solidLogout() {
  location.href = '../../space/apps.html';
}
/* solid/login.htmlから直接ログインしたタブかどうか（Space.app経由なら false） */
function isStandaloneLogin() {
  return sessionStorage.getItem('solid_standalone') === '1';
}

/* Space.appを経由せず直接SOLIDにログインできるURLをクリップボードにコピー。
   社外パートナー等への共有用。ページ側にtoast基盤が無くても動くよう自前で表示する。 */
function copyStandaloneUrl() {
  const url = location.origin + '/solid/login.html';
  const done = ok => solidToast(ok ? 'SOLIDの独立ログインURLをコピーしました' : ('コピーに失敗しました。手動でコピーしてください: ' + url), ok);

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(() => done(true)).catch(() => done(false));
  } else {
    done(false);
  }
}
function solidToast(msg, ok = true) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `
    position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
    background: ${ok ? '#1a1a2e' : '#e53e3e'}; color: #fff;
    padding: 10px 18px; border-radius: 8px; font-size: 13px;
    box-shadow: 0 4px 20px rgba(0,0,0,.25); z-index: 9999;
    max-width: 90vw; text-align: center;
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
/* ログイン情報はタブごとに独立したsessionStorageに保存しているため、
   別タブで別アカウントにログインしても、このタブのセッションには影響しない。 */

/* ロールチェック（role=サイト権限、solid_type=発注者/モデラー種別） */
function isAdmin(user)   { return ['admin','super_admin'].includes(user?.role); }
function isSuperAdmin(user) { return user?.role === 'super_admin'; }
function isModeler(user) { return user?.solid_type === 'id_modeler'; }
/* HaLSpace運営会社（発注者とモデラーの中間役）に所属しているか */
function isOperator(user) { return !!user?.is_operator; }
/* admin相当の全権限（全プロジェクト閲覧、発注者/モデラー両チャンネル閲覧等）を持つか。
   role=admin/super_adminに加え、HaLSpace運営会社所属者はrole=generalでも同等に扱う。 */
function hasAdminLevelAccess(user) { return isAdmin(user) || isOperator(user); }
/* 社内側（HaLSpace運営会社・スーパー管理者）の管理者か。
   発注者会社の管理者(role=admin)は外部なので含めない。納期回答や検査など
   「社内 → 発注者」の操作は hasAdminLevelAccess ではなくこちらで判定する。
   バックエンドの User::isInternalAdmin() と揃えること。 */
function isInternalAdmin(user) { return isSuperAdmin(user) || isOperator(user); }
/* 発注者側（クライアント）か。社内側・モデラー側のどちらでもなければ発注者として扱う
   （solid_typeが未設定の既存ユーザーでも安全側に倒す）。バックエンドの
   User::isClientSide()と揃えること。誤ってfalse判定になると、3Dモデル・制作データの
   検査依頼前ファイルが発注者に見えてしまう（プロジェクト詳細の可視性フィルタ参照）。 */
function isClient(user)  { return !isInternalAdmin(user) && !isModeler(user); }

/* チャット画面を使えるユーザーか。
   発注者（お客様）には出さない。社内側（HaLSpace運営会社・サイト管理者）と
   モデラーのみ。バックエンドの SolidChatController::canUseChat() と揃えること。 */
function canUseChat(user) { return isInternalAdmin(user) || isModeler(user); }

/* サイドバーの「チャット」を出し入れする。未読バッジもここで更新する。
   各ページの renderSidebarUser() から呼ばれる。 */
function applyChatNav(user) {
  const link = document.getElementById('navChat');
  if (!link) return;
  if (!canUseChat(user)) {
    link.style.display = 'none';
    return;
  }
  link.style.display = 'flex';

  /* チャット画面自身は自前でバッジを更新するので、ここでは他ページのぶんだけ取りに行く */
  if (document.body.classList.contains('chat-page')) return;
  const badge = document.getElementById('navChatBadge');
  if (!badge || typeof api === 'undefined') return;
  api.get('/chat/unread').then(d => {
    const n = d?.unread ?? 0;
    badge.textContent = n > 99 ? '99+' : n;
    badge.style.display = n > 0 ? 'grid' : 'none';
  }).catch(() => { /* バッジが出ないだけなので黙って諦める */ });
}

/* ハンバーガーメニュー（モバイル用サイドバー開閉） */
function initMobileMenu() {
  const toggle  = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!toggle || !sidebar || !overlay) return;

  function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  toggle.addEventListener('click', () => {
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  });
  overlay.addEventListener('click', closeSidebar);

  // サイドバー内のリンクをタップしたら閉じる
  sidebar.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', closeSidebar);
  });
}

/* サイドバーにユーザー情報を描画 */
function renderSidebarUser(user) {
  const el = document.getElementById('sidebarUser');
  if (!el || !user) return;
  el.innerHTML = `
    <div class="sidebar-avatar">${user.name.charAt(0)}</div>
    <div class="sidebar-user-info">
      <span class="sidebar-user-name">${user.name}</span>
      <span class="sidebar-user-role">${roleLabel(user.role, user.solid_type)}</span>
    </div>`;

  /* 独立URLから直接ログインした場合は「アプリ選択に戻る」に意味が無いため、
     ログアウトボタンに差し替える */
  const back   = document.getElementById('btnBackToApps');
  const logout = document.getElementById('btnStandaloneLogout');
  if (back && logout) {
    const standalone = isStandaloneLogin();
    back.style.display   = standalone ? 'none' : '';
    logout.style.display = standalone ? '' : 'none';
  }

  /* 「チャット」は発注者には出さない */
  applyChatNav(user);
}
/* role=サイト権限、solidType=発注者/モデラー種別（solidアプリ内でのみ意味を持つ） */
function roleLabel(role, solidType) {
  if (role === 'super_admin') return 'スーパー管理者';
  if (role === 'admin') {
    if (solidType === 'id_modeler') return 'モデラー管理者';
    if (solidType === 'jp_client') return '発注担当管理者';
    return '管理者';
  }
  if (solidType === 'jp_client') return '発注担当';
  if (solidType === 'id_modeler') return 'モデラー一般会員';
  return '一般会員';
}

/* パスワード変更モーダル。
   このファイルはSOLID/What'sNo等の全ページから共有読み込みされる（requireSpaceAuth()経由で
   認証済みページ全部から呼ばれる）ため、ここに置けばサイドバーのあるページ全部に一括で出せる。
   これまで自分でパスワードを変えられる場所はSpaceのアプリ選択画面（apps.html）にしか無く、
   SOLID独自ログイン（solid/login.html、Space.appを経由しないURL）で直接ログインした利用者は
   apps.htmlを一度も経由しないため、初期パスワードのまま変更する手段が無かった。
   サイドバーが無いページ（viewer.html等）や#sidebarUserを描画しないページでは
   何もしない（下のガードで安全に無視される）。 */
function initPasswordChangeModal() {
  if (document.getElementById('pwChangeModal')) return; // 二重挿入防止（再認証チェック等で複数回呼ばれても安全に）
  const anchor = document.getElementById('sidebarUser');
  if (!anchor) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-sidebar-logout';
  btn.id = 'btnChangePassword';
  btn.innerHTML = '<i class="fa-solid fa-key"></i> パスワード変更';
  anchor.insertAdjacentElement('afterend', btn);

  const modal = document.createElement('div');
  modal.className = 'modal-overlay hidden';
  modal.id = 'pwChangeModal';
  modal.innerHTML = `
    <div class="modal" style="max-width:420px;">
      <div class="modal-header">
        <span class="modal-title"><i class="fa-solid fa-key"></i> パスワード変更</span>
        <button type="button" class="modal-close" id="pwChangeModalClose"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <p style="font-size:12px;color:var(--muted);margin:-8px 0 16px;">現在のパスワードを確認のうえ、新しいパスワード（8文字以上）を設定します。</p>
      <form id="pwChangeForm" autocomplete="off">
        <!-- <form>で囲わず入力欄だけを置くと、ブラウザがページ内の無関係なテキスト欄
             （例: What'sNoの検索窓）を「ユーザー名欄」とみなして紐付け、保存後に自動入力して
             ページの検索が勝手に走る不具合があった。username欄を明示して自分自身の中で完結させる。 -->
        <input type="email" id="pwChangeUsername" name="username" autocomplete="username" class="pw-visually-hidden" tabindex="-1" aria-hidden="true">
        <div class="form-group">
          <label class="form-label">現在のパスワード</label>
          <div class="pw-field">
            <input type="password" class="form-input" id="pwChangeCurrent" autocomplete="current-password" placeholder="現在のパスワード">
            <button type="button" class="pw-eye-btn" data-target="pwChangeCurrent" tabindex="-1" aria-label="パスワードを表示"><i class="fa-regular fa-eye"></i></button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">新しいパスワード</label>
          <div class="pw-field">
            <input type="password" class="form-input" id="pwChangeNew" autocomplete="new-password" placeholder="8文字以上">
            <button type="button" class="pw-eye-btn" data-target="pwChangeNew" tabindex="-1" aria-label="パスワードを表示"><i class="fa-regular fa-eye"></i></button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">新しいパスワード（確認）</label>
          <div class="pw-field">
            <input type="password" class="form-input" id="pwChangeConfirm" autocomplete="new-password" placeholder="もう一度入力">
            <button type="button" class="pw-eye-btn" data-target="pwChangeConfirm" tabindex="-1" aria-label="パスワードを表示"><i class="fa-regular fa-eye"></i></button>
          </div>
        </div>
        <div class="pw-msg pw-msg-error" id="pwChangeError"></div>
        <div class="pw-msg pw-msg-success" id="pwChangeSuccess"></div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" id="pwChangeCancel">キャンセル</button>
          <button type="button" class="btn btn-primary" id="pwChangeSubmit"><i class="fa-solid fa-check"></i> パスワードを変更</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);
  const usernameField = document.getElementById('pwChangeUsername');
  if (usernameField) usernameField.value = getSpaceUser()?.email ?? '';
  // 送信ボタンはtype="button"でJSから呼ぶが、<form>内でEnter押下すると既定のsubmitが走り
  // ページ全体がリロードされてしまうため、submitイベント自体を止めておく
  document.getElementById('pwChangeForm').addEventListener('submit', e => e.preventDefault());

  const fields  = ['pwChangeCurrent', 'pwChangeNew', 'pwChangeConfirm'].map(id => document.getElementById(id));
  const errEl   = document.getElementById('pwChangeError');
  const okEl    = document.getElementById('pwChangeSuccess');
  const saveBtn = document.getElementById('pwChangeSubmit');

  const showError = msg => { okEl.classList.remove('show'); errEl.textContent = msg; errEl.classList.add('show'); };
  const clearMsgs = () => { errEl.classList.remove('show'); okEl.classList.remove('show'); };

  function open() {
    fields.forEach(f => { f.value = ''; f.type = 'password'; });
    modal.querySelectorAll('.pw-eye-btn i').forEach(i => { i.className = 'fa-regular fa-eye'; });
    clearMsgs();
    saveBtn.disabled = false;
    modal.classList.remove('hidden');
    fields[0].focus();
  }
  function close() { modal.classList.add('hidden'); }

  btn.addEventListener('click', open);
  document.getElementById('pwChangeModalClose').addEventListener('click', close);
  document.getElementById('pwChangeCancel').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) close(); });

  modal.querySelectorAll('.pw-eye-btn').forEach(eyeBtn => {
    eyeBtn.addEventListener('click', () => {
      const input = document.getElementById(eyeBtn.dataset.target);
      const show  = input.type === 'password';
      input.type  = show ? 'text' : 'password';
      eyeBtn.querySelector('i').className = show ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
    });
  });

  saveBtn.addEventListener('click', async () => {
    const [cur, nw, conf] = fields.map(f => f.value);
    clearMsgs();
    if (!cur || !nw) { showError('現在のパスワードと新しいパスワードを入力してください'); return; }
    if (nw.length < 8) { showError('新しいパスワードは8文字以上で入力してください'); return; }
    if (nw !== conf)   { showError('新しいパスワードが一致しません'); return; }
    if (nw === cur)    { showError('現在のパスワードと同じです。別のパスワードを入力してください'); return; }

    saveBtn.disabled = true;
    try {
      const res = await spaceApiPost('/auth/change-password', { current_password: cur, new_password: nw });
      if (res === null) return; // 401は既にログイン画面へ遷移させている
      fields.forEach(f => { f.value = ''; });
      okEl.textContent = 'パスワードを変更しました。次回から新しいパスワードでログインしてください。';
      okEl.classList.add('show');
      setTimeout(close, 1800);
    } catch (err) {
      showError(err.message || 'パスワードの変更に失敗しました');
    } finally {
      saveBtn.disabled = false;
    }
  });
}

/* DOMロード後にモバイルメニューを自動初期化 */
document.addEventListener('DOMContentLoaded', initMobileMenu);
