import { useState, type ReactNode } from 'react';
import type { Action } from '@tenq/shared';
import { useAuth } from '../auth/AuthContext';
import { Logo } from './Logo';

/** ログイン後の外枠。PC は左のメニュー、スマホは上のメニュー（開閉） */

interface NavItem { to: string; label: string; icon: ReactNode; action?: Action }

const I = {
  home: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-6.5 8 6.5v9h-5.5v-5.5h-5V20H4z" /></svg>,
  tool: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5a4 4 0 0 0 4.9 4.9L11 18.8a2.1 2.1 0 0 1-3-3l8.4-8.4a4 4 0 0 0-1.9-1.9z" /></svg>,
  qr: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="6" height="6" rx="1" /><rect x="14.5" y="3.5" width="6" height="6" rx="1" /><rect x="3.5" y="14.5" width="6" height="6" rx="1" /><path d="M14.5 14.5h2.5v2.5M20.5 14.5v6h-3.5" /></svg>,
  user: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c1.2-3.5 3.8-5 7-5s5.8 1.5 7 5" /></svg>,
  factory: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 20.5V10l5 3V10l5 3V5.5h7v15z" /></svg>,
  device: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M11 18h2" /></svg>,
};

const NAV: NavItem[] = [
  { to: '/', label: 'ホーム', icon: I.home },
  { to: '/equipment', label: '設備台帳', icon: I.tool, action: 'equipment.view' },
  { to: '/qr', label: 'QRラベル印刷', icon: I.qr, action: 'qr.issue' },
  { to: '/admin/factories', label: '工場・エリア', icon: I.factory, action: 'layout.edit' },
  { to: '/admin/users', label: 'ユーザー管理', icon: I.user, action: 'users.manage' },
  { to: '/devices', label: 'ログインした端末', icon: I.device },
];

export function Layout({ path, children }: { path: string; children: ReactNode }) {
  const { me, can, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((n) => !n.action || can(n.action));
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
          <button type="button" className="nav-logout" onClick={() => void logout()}>ログアウト</button>
        </nav>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
