'use strict';
/* Space認証チェック共通モジュール
   各アプリページの先頭で読み込む */

function getSpaceUser() {
  const raw = sessionStorage.getItem('space_user');
  return raw ? JSON.parse(raw) : null;
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
function isClient(user)  { return user?.solid_type === 'jp_client'; }
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

/* DOMロード後にモバイルメニューを自動初期化 */
document.addEventListener('DOMContentLoaded', initMobileMenu);
