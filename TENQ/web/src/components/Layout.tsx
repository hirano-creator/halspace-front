import { useState, type ReactNode } from 'react';
import type { Action } from '@tenq/shared';
import { useAuth } from '../auth/AuthContext';
import { SPACE_APPS_URL, isStandalone } from '../auth/session';
import { Logo } from './Logo';

/** ログイン後の外枠。PC は左のメニュー、スマホは上のメニュー（開閉） */

interface NavItem { to: string; label: string; icon: ReactNode; action?: Action }

const I = {
  home: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-6.5 8 6.5v9h-5.5v-5.5h-5V20H4z" /></svg>,
  tool: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5a4 4 0 0 0 4.9 4.9L11 18.8a2.1 2.1 0 0 1-3-3l8.4-8.4a4 4 0 0 0-1.9-1.9z" /></svg>,
  qr: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="6" height="6" rx="1" /><rect x="14.5" y="3.5" width="6" height="6" rx="1" /><rect x="3.5" y="14.5" width="6" height="6" rx="1" /><path d="M14.5 14.5h2.5v2.5M20.5 14.5v6h-3.5" /></svg>,
  user: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c1.2-3.5 3.8-5 7-5s5.8 1.5 7 5" /></svg>,
  factory: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 20.5V10l5 3V10l5 3V5.5h7v15z" /></svg>,
  scan: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h16" /></svg>,
  list: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4.5 6l1 1 2-2M4.5 12l1 1 2-2M4.5 18l1 1 2-2" /></svg>,
  warn: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5L21.5 20h-19z" /><path d="M12 10v4.5M12 17.2v.3" /></svg>,
  grid: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></svg>,
  search: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></svg>,
  file: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8l4 4V20.5H6z" /><path d="M14 3.5v4h4M9 13h6M9 16.5h6" /></svg>,
  eye: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></svg>,
  gear: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></svg>,
  back: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>,
  logout: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15M10 16l4-4-4-4M14 12H4" /></svg>,
  device: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M11 18h2" /></svg>,
};

const NAV: NavItem[] = [
  { to: '/', label: 'ホーム', icon: I.home },
  { to: '/board', label: 'カード一覧', icon: I.grid, action: 'board.view' },
  { to: '/scan', label: 'QRを読み取る', icon: I.scan, action: 'inspection.perform' },
  { to: '/abnormalities', label: '異常・是正処置', icon: I.warn, action: 'abnormality.report' },
  { to: '/equipment', label: '設備台帳', icon: I.tool, action: 'equipment.view' },
  { to: '/inspections', label: '点検履歴・検索', icon: I.search, action: 'inspection.viewOwn' },
  { to: '/reports', label: 'CSV・帳票', icon: I.file, action: 'export' },
  { to: '/templates', label: '点検基準', icon: I.list, action: 'template.edit' },
  { to: '/qr', label: 'QRラベル印刷', icon: I.qr, action: 'qr.issue' },
  { to: '/admin/factories', label: '工場・エリア', icon: I.factory, action: 'layout.edit' },
  { to: '/admin/users', label: 'ユーザー管理', icon: I.user, action: 'users.manage' },
  { to: '/admin/audit', label: '操作の記録', icon: I.eye, action: 'audit.view' },
  { to: '/admin/settings', label: 'システム設定', icon: I.gear, action: 'settings.manage' },
  { to: '/devices', label: 'ログインした端末', icon: I.device },
];

export function Layout({ path, children }: { path: string; children: ReactNode }) {
  const { me, can, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((n) => !n.action || can(n.action));
  // Space.app のアプリ共通のメニュー下部（SOLID・What'sNo と同じ。スキル space-app-shell）:
  // 利用者の名前とロール → 「アプリ選択に戻る」。TENQ のログイン画面・端末記憶で直接入ったタブだけ「ログアウト」
  const standalone = isStandalone();
  const active = (to: string) => (to === '/' ? path === '/' : path === to || path.startsWith(to + '/'));

  return (
    <div className="shell">
      <header className="app-header">
        <a href="#/" className="brand" aria-label="TENQ ホーム"><Logo /></a>
        <div className="header-user">
          <span className="header-name">{me?.user.name}</span>
          <span className="header-role">{me?.user.roleLabel ?? 'ロール未設定'}</span>
        </div>
        <button type="button" className="menu-toggle" aria-expanded={open} aria-controls="nav" onClick={() => setOpen((o) => !o)}>
          {open ? '閉じる' : 'メニュー'}
        </button>
      </header>
      <div className="shell-body">
        <nav id="nav" className={`side-nav ${open ? 'open' : ''}`} aria-label="メニュー">
          {items.map((n) => (
            <a key={n.to} href={`#${n.to}`} className={active(n.to) ? 'on' : ''} aria-current={active(n.to) ? 'page' : undefined} onClick={() => setOpen(false)}>
              {n.icon}<span>{n.label}</span>
            </a>
          ))}
          <div className="sidebar-bottom">
            <div className="sidebar-user">
              <span className="sidebar-avatar" aria-hidden="true">{me?.user.name.charAt(0)}</span>
              <span className="sidebar-user-info">
                <span className="sidebar-user-name">{me?.user.name}</span>
                <span className="sidebar-user-role">{me?.user.roleLabel ?? 'ロール未設定'}</span>
              </span>
            </div>
            {standalone
              ? <button type="button" className="btn-sidebar-back" onClick={() => void logout()}>{I.logout}<span>ログアウト</span></button>
              : <a href={SPACE_APPS_URL} className="btn-sidebar-back">{I.back}<span>アプリ選択に戻る</span></a>}
          </div>
        </nav>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
