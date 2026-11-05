import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { APP_NAME } from '@partsgate/shared';
import type { AppEnv } from './types';
import { HttpError } from './lib/http';
import { requireAuth } from './middleware/auth';
import { auditRoutes } from './routes/audit';
import { companyRoutes } from './routes/companies';
import { destinationRoutes, locationRoutes, staffRoutes } from './routes/masters';
import { importRoutes } from './routes/imports';
import { scanRoutes } from './routes/scans';
import { meRoutes } from './routes/me';
import { settingsRoutes } from './routes/settings';
import { userRoutes } from './routes/users';

const app = new Hono<AppEnv>();

app.use('*', secureHeaders({ xFrameOptions: 'DENY', referrerPolicy: 'same-origin' }));

// Bearer トークンのみで Cookie を使わないので credentials は許可しない（CSRF の対象外にする）
app.use('/api/*', (c, next) => cors({
  origin: (origin) => (c.env.ALLOWED_ORIGINS.split(',').includes(origin) ? origin : null),
  // X-File-* / X-Encoding は CSV 取込の元ファイルの送信に使う（足し忘れるとブラウザが送信の前に止める）
  allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-File-Name', 'X-File-Sha256', 'X-Encoding'],
  allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  maxAge: 600,
})(c, next));

// API のレスポンスはキャッシュさせない（会社ごと・人ごとのデータのため）
app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

app.get('/api/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ ok: true, app: APP_NAME, env: c.env.APP_ENV });
  } catch {
    return c.json({ ok: false, message: 'データベースに接続できません。' }, 503);
  }
});

// ここから下はログイン必須。会社 ID は requireAuth がログイン情報から決める
const api = new Hono<AppEnv>();
api.use('*', requireAuth);
api.route('/', meRoutes);
api.route('/', settingsRoutes);
api.route('/', userRoutes);
api.route('/', staffRoutes);
api.route('/', locationRoutes);
api.route('/', destinationRoutes);
api.route('/', importRoutes);
api.route('/', scanRoutes);
api.route('/', auditRoutes);
api.route('/', companyRoutes);
app.route('/api', api);

app.notFound((c) => c.json({ message: '見つかりません。' }, 404));

// 想定したエラーは内容を返し、想定外の例外は内容を返さない（ログにだけ出す）
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ message: err.message, ...err.extra }, err.status);
  console.error(err);
  if (err instanceof Error && /D1_ERROR|SQLITE_BUSY|network/i.test(err.message)) {
    return c.json({ message: 'データベースに接続できません。しばらくしてから、もう一度お試しください。' }, 503);
  }
  return c.json({ message: 'サーバーでエラーが発生しました。' }, 500);
});

export default app;
