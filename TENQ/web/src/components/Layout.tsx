import { useEffect, useState, type ReactNode } from 'react';
import type { Action } from '@tenq/shared';
import { useAuth } from '../auth/AuthContext';
import { SPACE_APPS_URL, isStandalone } from '../auth/session';
import { Logo } from './Logo';

/** ログイン後の外枠。上の帯にメニューを 3 つだけ置く（PC・スマホ共通） */

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

/**
 * メニューの中身（2026-11-03 見直し。requirements §10 Q-15）。上の帯に「工場（ホーム）」「記録」「⚙」の 3 つだけ。
 * 設備・建屋のことは見取り図の上で設備・建屋を押して出る小窓からする。⚙ には設定と、どこからも行けない画面を入れる。
 * 一般社員は点検に使うものだけ（記録は「点検の記録」だけなので、押すとそのまま開く）。
 */
const RECORDS: NavItem[] = [
  { to: '/inspections', label: '点検の記録', icon: I.search, action: 'inspection.viewOwn' },
  { to: '/abnormalities', label: '異常の記録', icon: I.warn, action: 'abnormality.resolve' },
  { to: '/reports', label: 'CSV・帳票', icon: I.file, action: 'export' },
];
const SETTINGS: NavItem[] = [
  { to: '/equipment', label: '設備の一覧（台帳）', icon: I.tool, action: 'qr.issue' },
  { to: '/templates', label: '点検する項目（点検基準）', icon: I.list, action: 'template.edit' },
  { to: '/qr', label: 'QRラベル印刷', icon: I.qr, action: 'qr.issue' },
  { to: '/admin/factories', label: '工場・建屋', icon: I.factory, action: 'layout.edit' },
  { to: '/admin/users', label: 'ユーザー管理', icon: I.user, action: 'users.manage' },
  { to: '/admin/audit', label: '操作の記録', icon: I.eye, action: 'audit.view' },
  { to: '/admin/settings', label: 'システム設定', icon: I.gear, action: 'settings.manage' },
  { to: '/devices', label: 'ログインした端末', icon: I.device },
];

export function Layout({ path, children }: { path: string; children: ReactNode }) {
  const { me, can, logout } = useAuth();
  // 開いているメニューは、開いたときの画面と組で持つ（画面が変わったら自然に閉じる）
  const [openAt, setOpenAt] = useState<{ key: 'records' | 'settings'; path: string } | null>(null);
  const open = openAt?.path === path ? openAt.key : null;
  const setOpen = (f: (o: typeof open) => typeof open) => setOpenAt(() => { const k = f(open); return k ? { key: k, path } : null; });
  const records = RECORDS.filter((n) => !n.action || can(n.action));
  const settings = SETTINGS.filter((n) => !n.action || can(n.action));
  // Space.app のアプリ共通のメニュー下部（SOLID・What'sNo と同じ。スキル space-app-shell）:
  // 利用者の名前とロール → 「アプリ選択に戻る」。TENQ のログイン画面・端末記憶で直接入ったタブだけ「ログアウト」
  const standalone = isStandalone();
  const active = (to: string) => path === to || path.startsWith(to + '/');
  const isHome = path === '/' || path === '/board';
  const homeLabel = me?.user.role && me.user.role !== 'worker' ? '工場' : 'ホーム';

  // 外を押したとき・Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!(e.target as Element).closest('.nav-drop-wrap')) setOpenAt(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenAt(null); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const link = (n: NavItem) => (
    <a key={n.to} href={`#${n.to}`} className={active(n.to) ? 'on' : ''} aria-current={active(n.to) ? 'page' : undefined}>
      {n.icon}<span>{n.label}</span>
    </a>
  );

  return (
    <div className="shell">
      <header className="app-header">
        <a href="#/" className="brand" aria-label="TENQ ホーム"><Logo /></a>
        <nav className="top-nav" aria-label="メニュー">
          <a href="#/" className={`top-tab ${isHome ? 'on' : ''}`} aria-current={isHome ? 'page' : undefined}>{I.factory}<span>{homeLabel}</span></a>
          {records.length === 1 && <a href={`#${records[0]!.to}`} className={`top-tab ${active(records[0]!.to) ? 'on' : ''}`}>{I.search}<span>記録</span></a>}
          {records.length > 1 && (
            <div className="nav-drop-wrap">
              <button type="button" className={`top-tab ${records.some((n) => active(n.to)) ? 'on' : ''}`} aria-expanded={open === 'records'} aria-controls="nav-records"
                onClick={() => setOpen((o) => (o === 'records' ? null : 'records'))}>{I.search}<span>記録</span><i aria-hidden="true">▾</i></button>
              {open === 'records' && <div id="nav-records" className="nav-drop">{records.map(link)}</div>}
            </div>
          )}
          <div className="nav-drop-wrap right">
            <button type="button" className={`top-tab ${settings.some((n) => active(n.to)) ? 'on' : ''}`} aria-label="設定とアカウント" aria-expanded={open === 'settings'} aria-controls="nav-settings"
              onClick={() => setOpen((o) => (o === 'settings' ? null : 'settings'))}>
              {I.gear}<span className="hide-sm">{me?.user.name}</span><i aria-hidden="true">▾</i>
            </button>
            {open === 'settings' && (
              <div id="nav-settings" className="nav-drop">
                {settings.map(link)}
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
              </div>
            )}
          </div>
        </nav>
      </header>
      <main className={`content ${isHome ? 'wide' : ''}`}>{children}</main>
    </div>
  );
}
