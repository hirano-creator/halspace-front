import { Suspense, lazy, useEffect, type ReactNode } from 'react';
import type { Action } from '@tenq/shared';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { currentToken, setPendingQr, takePendingQr } from './auth/session';
import { Layout } from './components/Layout';
import { Alert, Button, Loading } from './components/ui';
import { match, navigate, usePath } from './router';

// 画面ごとに分けて、開いたときに読み込む（初回の読み込みを軽くする）
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const EquipmentListPage = lazy(() => import('./pages/EquipmentListPage').then((m) => ({ default: m.EquipmentListPage })));
const EquipmentDetailPage = lazy(() => import('./pages/EquipmentDetailPage').then((m) => ({ default: m.EquipmentDetailPage })));
const EquipmentFormPage = lazy(() => import('./pages/EquipmentFormPage').then((m) => ({ default: m.EquipmentFormPage })));
const QrPrintPage = lazy(() => import('./pages/QrPrintPage').then((m) => ({ default: m.QrPrintPage })));
const QrResolvePage = lazy(() => import('./pages/QrResolvePage').then((m) => ({ default: m.QrResolvePage })));
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const FactoriesPage = lazy(() => import('./pages/FactoriesPage').then((m) => ({ default: m.FactoriesPage })));
const DevicesPage = lazy(() => import('./pages/DevicesPage').then((m) => ({ default: m.DevicesPage })));

interface Route { pattern: string; action?: Action; render: (p: Record<string, string>) => ReactNode }

const ROUTES: Route[] = [
  { pattern: '/', render: () => <HomePage /> },
  { pattern: '/equipment', action: 'equipment.view', render: () => <EquipmentListPage /> },
  { pattern: '/equipment/new', action: 'equipment.create', render: () => <EquipmentFormPage /> },
  { pattern: '/equipment/:id', action: 'equipment.view', render: (p) => <EquipmentDetailPage id={p.id ?? ''} /> },
  { pattern: '/equipment/:id/edit', action: 'equipment.view', render: (p) => <EquipmentFormPage id={p.id} /> },
  { pattern: '/qr', action: 'qr.issue', render: () => <QrPrintPage /> },
  { pattern: '/q/:token', render: (p) => <QrResolvePage token={p.token ?? ''} /> },
  { pattern: '/admin/users', action: 'users.manage', render: () => <UsersPage /> },
  { pattern: '/admin/factories', action: 'layout.edit', render: () => <FactoriesPage /> },
  { pattern: '/devices', render: () => <DevicesPage /> },
];

function Routes() {
  const path = usePath();
  const { me, loading, error, can, reload } = useAuth();
  const qr = match('/q/:token', path);

  // 未ログインなら、QR のトークンを覚えてからログイン画面へ（ログイン後に元の設備へ戻す）
  useEffect(() => {
    if (loading || me || path === '/login' || error) return;
    if (qr?.token) setPendingQr(qr.token);
    navigate('/login', true);
  }, [loading, me, path, error, qr?.token]);

  // ログインできたら、覚えておいた QR の設備へ（なければホームへ）。移動先はここ1か所で決める
  useEffect(() => {
    if (!me || path !== '/login') return;
    const pending = takePendingQr();
    navigate(pending ? `/q/${pending}` : '/', true);
  }, [me, path]);

  if (path === '/login' && !me) return <Suspense fallback={<Loading />}><LoginPage /></Suspense>;
  if (loading) return <Loading label="TENQ を開いています…" />;
  if (error && !me) {
    return (
      <div className="center-box">
        <Alert kind="error">{error}</Alert>
        <div className="button-row"><Button onClick={() => void reload()}>もう一度読み込む</Button>{currentToken() && <Button onClick={() => navigate('/login')}>ログイン画面へ</Button>}</div>
      </div>
    );
  }
  if (!me) return null;

  let content: ReactNode = <Alert kind="error">ページが見つかりません。<a href="#/">ホームへ</a></Alert>;
  for (const r of ROUTES) {
    const params = match(r.pattern, path);
    if (!params) continue;
    content = r.action && !can(r.action) ? <Alert kind="error">この画面を開く権限がありません。</Alert> : r.render(params);
    break;
  }
  return <Layout path={path}><Suspense fallback={<Loading />}>{content}</Suspense></Layout>;
}

export function App() {
  return <AuthProvider><Routes /></AuthProvider>;
}
