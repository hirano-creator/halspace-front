'use strict';
/* Space認証チェック共通モジュール
   各アプリページの先頭で読み込む */

function getSpaceUser() {
  const raw = localStorage.getItem('space_user');
  return raw ? JSON.parse(raw) : null;
}
function requireSpaceAuth() {
  const user = getSpaceUser();
  if (!user) {
    location.href = '../../space/login.html';
    return null;
  }
  return user;
}
function spaceLogout() {
  localStorage.removeItem('space_token');
  localStorage.removeItem('space_user');
  location.href = '../../space/login.html';
}
/* SOLIDアプリから抜けてSpaceアプリ選択画面に戻る（トークンはそのまま残す） */
function solidLogout() {
  location.href = '../../space/apps.html';
}

/* ロールチェック */
function isAdmin(user)   { return ['jp_admin','super_admin'].includes(user?.role); }
function isModeler(user) { return user?.role === 'id_modeler'; }
function isClient(user)  { return user?.role === 'jp_client'; }

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
      <span class="sidebar-user-role">${roleLabel(user.role)}</span>
    </div>`;
}
function roleLabel(role) {
  return { jp_client:'発注担当', id_modeler:'モデラー',
           jp_admin:'管理者', super_admin:'スーパー管理者' }[role] || role;
}

/* DOMロード後にモバイルメニューを自動初期化 */
document.addEventListener('DOMContentLoaded', initMobileMenu);
