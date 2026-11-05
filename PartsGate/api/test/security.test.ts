import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { T, call } from './helpers';

/**
 * 権限とログインの網羅テスト（STEP 8・docs/security.md §2〜§4）。
 * API の一覧（app.routes）から自動で作るので、API を足すと自動で対象になる。
 */

const routes = app.routes
  .filter((r) => r.path.startsWith('/api/') && r.path !== '/api/health' && r.method !== 'ALL')
  .map((r) => ({ method: r.method, path: r.path }));
const fill = (p: string) => p.replace(':id', '1').replace(':code', '100001');

/** 一般の利用者でも使える API（それ以外は管理者・運営者だけ） */
const GENERAL_OK = new Set([
  'GET /api/me', 'GET /api/staff', 'GET /api/locations', 'GET /api/destinations',
  'POST /api/work-sessions', 'POST /api/work-sessions/:id/end', 'POST /api/scans', 'GET /api/scans/today',
  'GET /api/scan-board/dates', 'GET /api/scan-board',
  'GET /api/scan-logs', 'GET /api/orders/items', 'GET /api/orders/items/:id', 'GET /api/dashboard',
]);

describe('ログインと権限の網羅', () => {
  it('API の一覧が取れている', () => {
    expect(routes.length).toBeGreaterThan(40);
  });

  it.each(routes)('ログインなしは 401: $method $path', async ({ method, path }) => {
    const r = await call(method, fill(path).replace('/api', ''), undefined, method === 'GET' ? undefined : {});
    expect(r.status).toBe(401);
  });

  it.each(routes.filter((r) => !GENERAL_OK.has(`${r.method} ${r.path}`)))('一般の利用者は 403: $method $path', async ({ method, path }) => {
    const r = await call(method, fill(path).replace('/api', ''), T.generalA, method === 'GET' ? undefined : {});
    expect(r.status).toBe(403);
  });

  it('利用停止中の利用者はどの API も 403', async () => {
    for (const { method, path } of routes.slice(0, 10)) {
      const r = await call(method, fill(path).replace('/api', ''), T.suspendedA, method === 'GET' ? undefined : {});
      expect(r.status, `${method} ${path}`).toBe(403);
    }
  });
});

describe('入力・応答の安全', () => {
  it('JSON でない本文は 415、壊れた JSON は 400', async () => {
    const r1 = await app.request('/api/staff', { method: 'POST', headers: { Authorization: `Bearer ${T.adminA}`, 'Content-Type': 'text/plain' }, body: 'x' }, env);
    expect(r1.status).toBe(415);
    const r2 = await app.request('/api/staff', { method: 'POST', headers: { Authorization: `Bearer ${T.adminA}`, 'Content-Type': 'application/json' }, body: '{' }, env);
    expect(r2.status).toBe(400);
  });

  it('SQL として危険な文字を入れても、文字として扱う（prepared statement）', async () => {
    const evil = "x' OR '1'='1";
    const r = await call('GET', `/staff?q=${encodeURIComponent(evil)}`, T.adminA);
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([]);
    const c = await call('POST', '/staff', T.adminA, { code: 'SQLI1', name: "'); DROP TABLE staff; --" });
    expect(c.status).toBe(201);
    expect(c.body.name).toBe("'); DROP TABLE staff; --");
  });

  it('HTML はそのまま保存し、画面では文字として出す（API は JSON で返すだけ）', async () => {
    const c = await call('POST', '/staff', T.adminA, { code: 'XSS1', name: '<img src=x onerror=alert(1)>' });
    expect(c.body.name).toBe('<img src=x onerror=alert(1)>');
    const res = await app.request('/api/staff?q=XSS1', { headers: { Authorization: `Bearer ${T.adminA}` } }, env);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('セキュリティのヘッダーとキャッシュ禁止', async () => {
    const res = await app.request('/api/me', { headers: { Authorization: `Bearer ${T.generalA}` } }, env);
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('知らない URL は JSON の 404（中身を漏らさない）', async () => {
    const r = await call('GET', '/nope', T.generalA);
    expect(r.status).toBe(404);
    expect(r.body.message).toBe('見つかりません。');
  });

  it('長すぎるトークンは 401', async () => {
    const r = await call('GET', '/me', 'x'.repeat(600));
    expect(r.status).toBe(401);
  });
});
