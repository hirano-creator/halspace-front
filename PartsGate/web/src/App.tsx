import { Suspense, lazy, useEffect, type ReactNode } from 'react';
import type { Action } from '@partsgate/shared';
import { useAuth, AuthProvider } from './auth/AuthContext';
import { navigate, usePath } from './router';
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

/** 画面の一覧（docs/screens.md §1）。action は画面を開ける権限（最終判定は API） */
const ROUTES: { path: string; action?: Action; render: () => ReactNode }[] = [
  { path: '/', render: () => <HomePage /> },
  { path: '/staff', action: 'master.view', render: () => <StaffPage /> },
  { path: '/locations', action: 'master.view', render: () => <LocationsPage /> },
  { path: '/destinations', action: 'master.view', render: () => <DestinationsPage /> },
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

  const route = ROUTES.find((r) => r.path === path);
  let body: ReactNode;
  if (!route) body = <div className="p-5"><Alert kind="warn">ページが見つかりません。<a className="underline" href="#/">ホームへ</a></Alert></div>;
  else if (route.action && !can(route.action)) body = <div className="p-5"><Alert kind="warn">この画面を開く権限がありません。</Alert></div>;
  else body = <Suspense fallback={<Loading />}>{route.render()}</Suspense>;
  return <Layout path={path}>{body}</Layout>;
}

export function App() {
  return <AuthProvider><Screen /></AuthProvider>;
}
