import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { APP_NAME } from '@tenq/shared';
import type { AppEnv } from './types';
import { HttpError } from './lib/http';
import { requireAuth } from './middleware/auth';
import { abnormalityRoutes } from './routes/abnormalities';
import { areaRoutes } from './routes/areas';
import { attachmentRoutes } from './routes/attachments';
import { authRoutes } from './routes/auth';
import { equipmentRoutes } from './routes/equipment';
import { factoryRoutes } from './routes/factories';
import { inspectionRoutes } from './routes/inspections';
import { templateRoutes } from './routes/templates';
import { userRoutes } from './routes/users';

const app = new Hono<AppEnv>();

app.use('*', secureHeaders({ xFrameOptions: 'DENY', referrerPolicy: 'same-origin' }));

// Bearer トークンのみで Cookie を使わないので credentials は許可しない（CSRF の対象外にする）
app.use('/api/*', (c, next) => cors({
  origin: (origin) => (c.env.ALLOWED_ORIGINS.split(',').includes(origin) ? origin : null),
  allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-File-Name'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  maxAge: 600,
})(c, next));

// API のレスポンスはブラウザ・中継でキャッシュさせない（個人ごとのデータのため）
app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

app.get('/api/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM factories').first<{ n: number }>();
  return c.json({ ok: true, app: APP_NAME, env: c.env.APP_ENV, factories: row?.n ?? 0 });
});

// ここから下はログイン必須
const api = new Hono<AppEnv>();
api.use('*', requireAuth);
api.route('/', authRoutes);
api.route('/', factoryRoutes);
api.route('/', areaRoutes);
api.route('/', equipmentRoutes);
api.route('/', userRoutes);
api.route('/', templateRoutes);
api.route('/', inspectionRoutes);
api.route('/', abnormalityRoutes);
api.route('/', attachmentRoutes);
app.route('/api', api);

app.notFound((c) => c.json({ message: '見つかりません。' }, 404));

// 想定したエラーは内容を返し、想定外の例外は内容を返さない（ログにだけ出す）
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ message: err.message, ...err.extra }, err.status);
  console.error(err);
  return c.json({ message: 'サーバーでエラーが発生しました。' }, 500);
});

export default app;
