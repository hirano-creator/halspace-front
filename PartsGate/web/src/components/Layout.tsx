import { useState, type ReactNode } from 'react';
import type { Action } from '@partsgate/shared';
import { useAuth } from '../auth/AuthContext';
import { SPACE_APPS_URL, isStandalone } from '../auth/session';

/**
 * ログイン後の外枠。PC は左のダークグレーのメニュー、スマホは上の帯＋開くメニュー。
 * メニューの下部は Space.app 共通（スキル space-app-shell）: 利用者の名前とロール → 「アプリ選択に戻る」。
 * PARTS GATE のログイン画面から直接入ったタブだけ「ログアウト」。
 */

interface NavItem { to: string; label: string; icon: string; action?: Action }
interface NavGroup { label?: string; items: NavItem[] }

const NAV: NavGroup[] = [
  { items: [{ to: '/', label: 'ホーム', icon: '⌂' }] },
  { label: '業務', items: [
    { to: '/scan', label: 'バーコード読み取り', icon: '▣', action: 'scan' },
    { to: '/orders', label: '注文データ', icon: '☷', action: 'orders.view' },
    { to: '/scan-logs', label: '読み取り履歴', icon: '⌕', action: 'orders.view' },
    { to: '/imports/new', label: 'CSV 取込', icon: '⇪', action: 'import' },
    { to: '/imports', label: '取込履歴', icon: '↺', action: 'import' },
    { to: '/analytics', label: 'データ分析', icon: '▤', action: 'analytics.view' },
  ] },
  { label: 'マスター', items: [
    { to: '/staff', label: '担当者', icon: '◉', action: 'master.view' },
    { to: '/locations', label: '置場', icon: '▦', action: 'master.view' },
    { to: '/destinations', label: '納品先', icon: '⚑', action: 'master.view' },
  ] },
  { label: '管理', items: [
    { to: '/users', label: 'ユーザー', icon: '☺', action: 'users.manage' },
    { to: '/settings', label: 'システム設定', icon: '⚙', action: 'settings.manage' },
    { to: '/audit', label: '操作の記録', icon: '☰', action: 'audit.view' },
    { to: '/admin/companies', label: '企業管理', icon: '▣', action: 'companies.manage' },
  ] },
];

export function Layout({ path, children }: { path: string; children: ReactNode }) {
  const { me, can, logout } = useAuth();
  // 開いているかを、開いたときの画面と組で持つ（画面が変わったら自然に閉じる）
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === path;
  const standalone = isStandalone();
  const active = (to: string) => {
    if (to === '/') return path === '/';
    if (to === '/imports') return path === '/imports' || (path.startsWith('/imports/') && path !== '/imports/new');
    return path === to || path.startsWith(to + '/');
  };
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((n) => !n.action || can(n.action)) })).filter((g) => g.items.length);

  const nav = (
    <nav aria-label="メニュー" className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex-1 px-2 py-2">
        {groups.map((g, i) => (
          <div key={i} className="mb-2">
            {g.label && <p className="px-3 pt-3 pb-1 text-[11px] font-bold tracking-wider text-slate-500">{g.label}</p>}
            {g.items.map((n) => (
              <a key={n.to} href={`#${n.to}`} aria-current={active(n.to) ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm ${active(n.to) ? 'bg-slate-700 font-bold text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
                <span aria-hidden="true" className="w-5 text-center">{n.icon}</span>{n.label}
              </a>
            ))}
          </div>
        ))}
      </div>
      <div className="sidebar-bottom">
        <div className="sidebar-user">
          <span className="sidebar-avatar" aria-hidden="true">{me?.user.name.charAt(0)}</span>
          <span className="min-w-0">
            <span className="sidebar-user-name truncate">{me?.user.name}</span>
            <span className="sidebar-user-role">{me?.user.roleLabel}{me?.operator ? '・運営' : ''}</span>
          </span>
        </div>
        {standalone
          ? <button type="button" className="btn-sidebar-back" onClick={logout}><span aria-hidden="true">⎋</span>ログアウト</button>
          : <a href={SPACE_APPS_URL} className="btn-sidebar-back"><span aria-hidden="true">←</span>アプリ選択に戻る</a>}
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      {/* PC: 左のメニュー */}
      <aside className="sticky top-0 hidden h-dvh w-56 flex-none flex-col bg-rail lg:flex">
        <a href="#/" className="block px-4 pt-4 pb-2 text-white">
          <span className="block text-[15px] font-extrabold tracking-[0.14em]">PARTS GATE</span>
          <span className="block truncate text-[11px] text-slate-400">{me?.company?.name}</span>
        </a>
        {nav}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* スマホ・タブレット: 上の帯 */}
        <header className="sticky top-0 z-20 flex items-center gap-3 bg-rail px-4 py-2.5 text-white lg:hidden">
          <button type="button" className="flex h-11 w-11 items-center justify-center rounded-lg text-xl hover:bg-slate-700" aria-label="メニューを開く" aria-expanded={open}
            onClick={() => setOpenAt(open ? null : path)}>☰</button>
          <span className="font-extrabold tracking-[0.12em]">PARTS GATE</span>
          <span className="ml-auto truncate text-xs text-slate-400">{me?.company?.name}</span>
        </header>
        {open && (
          <div className="fixed inset-0 z-30 lg:hidden" role="dialog" aria-label="メニュー">
            <button type="button" className="absolute inset-0 bg-slate-900/50" aria-label="メニューを閉じる" onClick={() => setOpenAt(null)} />
            <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-rail">
              <p className="px-4 pt-4 pb-2 font-extrabold tracking-[0.14em] text-white">PARTS GATE</p>
              {nav}
            </div>
          </div>
        )}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
