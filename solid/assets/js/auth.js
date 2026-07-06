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

/* ロールチェック（role=サイト権限、solid_type=発注者/モデラー種別） */
function isAdmin(user)   { return ['admin','super_admin'].includes(user?.role); }
function isModeler(user) { return user?.solid_type === 'id_modeler'; }
function isClient(user)  { return user?.solid_type === 'jp_client'; }

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
}
/* role=サイト権限、solidType=発注者/モデラー種別（solidアプリ内でのみ意味を持つ） */
function roleLabel(role, solidType) {
  if (role === 'super_admin') return 'スーパー管理者';
  if (role === 'admin') return '管理者';
  if (solidType === 'jp_client') return '発注担当';
  if (solidType === 'id_modeler') return 'モデラー';
  return '一般会員';
}

/* DOMロード後にモバイルメニューを自動初期化 */
document.addEventListener('DOMContentLoaded', initMobileMenu);
