import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { APP_NAME } from '@tenq/shared';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

app.use('*', secureHeaders({ xFrameOptions: 'DENY', referrerPolicy: 'same-origin' }));

// Bearer トークンのみで Cookie を使わないので credentials は許可しない（CSRF の対象外にする）
app.use('/api/*', (c, next) => cors({
  origin: (origin) => (c.env.ALLOWED_ORIGINS.split(',').includes(origin) ? origin : null),
  allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  maxAge: 600,
})(c, next));

app.get('/api/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM factories').first<{ n: number }>();
  return c.json({ ok: true, app: APP_NAME, env: c.env.APP_ENV, factories: row?.n ?? 0 });
});

app.notFound((c) => c.json({ message: '見つかりません。' }, 404));

// 内部の例外内容は返さない（ログにだけ出す）
app.onError((err, c) => {
  console.error(err);
  return c.json({ message: 'サーバーでエラーが発生しました。' }, 500);
});

export default app;
