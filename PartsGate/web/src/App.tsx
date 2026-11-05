import { Suspense, lazy, useEffect, type ReactNode } from 'react';
import type { Action } from '@partsgate/shared';
import { useAuth, AuthProvider } from './auth/AuthContext';
import { match, navigate, usePath } from './router';
import { Layout } from './components/Layout';
import { Alert, Loading } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';

// 管理系の画面は開いたときに読み込む（最初に読む JS を小さくするため）
const masterConfig = (name: 'STAFF' | 'LOCATIONS' | 'DESTINATIONS') => lazy(async () => {
  const { MasterPage, [name]: config } = await import('./pages/MasterPage');
  return { default: () => <MasterPage key={config.path} config={config} /> };
});
const StaffPage = masterConfig('STAFF');
const LocationsPage = masterConfig('LOCATIONS');
const DestinationsPage = masterConfig('DESTINATIONS');
const admin = (name: 'UsersPage' | 'SettingsPage' | 'AuditPage' | 'CompaniesPage') =>
  lazy(() => import('./pages/AdminPages').then((m) => ({ default: m[name] })));
const UsersPage = admin('UsersPage');
const SettingsPage = admin('SettingsPage');
const AuditPage = admin('AuditPage');
const CompaniesPage = admin('CompaniesPage');
const ScanPage = lazy(() => import('./pages/ScanPage').then((m) => ({ default: m.ScanPage })));
const ScanLogsPage = lazy(() => import('./pages/ScanLogsPage').then((m) => ({ default: m.ScanLogsPage })));
const OrdersPage = lazy(() => import('./pages/OrdersPage').then((m) => ({ default: m.OrdersPage })));
const OrderDetailPage = lazy(() => import('./pages/OrdersPage').then((m) => ({ default: m.OrderDetailPage })));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
const ImportPage = lazy(() => import('./pages/ImportPage').then((m) => ({ default: m.ImportPage })));
const ImportHistoryPage = lazy(() => import('./pages/ImportHistoryPage').then((m) => ({ default: m.ImportHistoryPage })));
const ImportDetailPage = lazy(() => import('./pages/ImportHistoryPage').then((m) => ({ default: m.ImportDetailPage })));

/** 画面の一覧（docs/screens.md §1）。action は画面を開ける権限（最終判定は API） */
const ROUTES: { path: string; action?: Action; render: (p: Record<string, string>) => ReactNode }[] = [
  { path: '/', render: () => <HomePage /> },
  { path: '/staff', action: 'master.view', render: () => <StaffPage /> },
  { path: '/locations', action: 'master.view', render: () => <LocationsPage /> },
  { path: '/destinations', action: 'master.view', render: () => <DestinationsPage /> },
  { path: '/scan', action: 'scan', render: () => <ScanPage /> },
  { path: '/orders', action: 'orders.view', render: () => <OrdersPage /> },
  { path: '/orders/:id', action: 'orders.view', render: (p) => <OrderDetailPage key={p.id} id={p.id ?? ''} /> },
  { path: '/scan-logs', action: 'orders.view', render: () => <ScanLogsPage /> },
  { path: '/analytics', action: 'analytics.view', render: () => <AnalyticsPage /> },
  { path: '/imports/new', action: 'import', render: () => <ImportPage /> },
  { path: '/imports', action: 'import', render: () => <ImportHistoryPage /> },
  { path: '/imports/:id', action: 'import', render: (p) => <ImportDetailPage key={p.id} id={p.id ?? ''} /> },
  { path: '/users', action: 'users.manage', render: () => <UsersPage /> },
  { path: '/settings', action: 'settings.manage', render: () => <SettingsPage /> },
  { path: '/audit', action: 'audit.view', render: () => <AuditPage /> },
  { path: '/admin/companies', action: 'companies.manage', render: () => <CompaniesPage /> },
];

function Screen() {
  const path = usePath();
  const { me, loading, can } = useAuth();

  // ログイン済みでログイン画面にいたらホームへ
  useEffect(() => { if (me && path === '/login') navigate('/', true); }, [me, path]);

  if (loading) return <Loading />;
  if (!me) return <LoginPage />;

  // 固定のパスを先に、:id のようなパターンはあとで照合する（/imports/new が /imports/:id に当たらないように）
  let params: Record<string, string> = {};
  const route = ROUTES.find((r) => r.path === path) ?? ROUTES.find((r) => { const m = r.path.includes(':') ? match(r.path, path) : null; if (m) params = m; return !!m; });
  let body: ReactNode;
  if (!route) body = <div className="p-5"><Alert kind="warn">ページが見つかりません。<a className="underline" href="#/">ホームへ</a></Alert></div>;
  else if (route.action && !can(route.action)) body = <div className="p-5"><Alert kind="warn">この画面を開く権限がありません。</Alert></div>;
  else body = <Suspense fallback={<Loading />}>{route.render(params)}</Suspense>;
  return <Layout path={path}>{body}</Layout>;
}

export function App() {
  return <AuthProvider><Screen /></AuthProvider>;
}
