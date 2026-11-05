import { describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { T, get, post, put, sql, versionOf } from './helpers';

/**
 * 企業間のデータ分離テスト（docs/security.md §1-3）。最重要。
 * 会社 A の利用者が、会社 B のデータを見る・変える・作ることができないことを API ごとに確かめる。
 * API を足したら下の COVERED にも足す（足し忘れると最後のテストが失敗する）。
 */

// 会社 B のデータの ID（api/seed/dev-seed.sql）
const B = { staff: 11, location: 11, destination: 11, user: 12 };

const COVERED = new Set<string>([
  'GET /api/me',
  'GET /api/settings', 'PUT /api/settings',
  'GET /api/users', 'PUT /api/users/:id',
  'GET /api/staff', 'POST /api/staff', 'PUT /api/staff/:id',
  'GET /api/locations', 'POST /api/locations', 'PUT /api/locations/:id',
  'GET /api/destinations', 'POST /api/destinations', 'PUT /api/destinations/:id', 'POST /api/destinations/bulk',
  // 取込は imports.test.ts の「取込のテナント分離」で確かめている
  'POST /api/imports/lookup', 'POST /api/imports', 'POST /api/imports/:id/rows', 'POST /api/imports/:id/commit', 'POST /api/imports/:id/abort',
  'GET /api/imports', 'GET /api/imports/:id', 'GET /api/imports/:id/rows', 'GET /api/imports/:id/file',
  // 照合は scans.test.ts の「照合のテナント分離」で確かめている
  'POST /api/work-sessions', 'POST /api/work-sessions/:id/end', 'POST /api/scans', 'GET /api/scans/today',
  'GET /api/scan-board/dates', 'GET /api/scan-board',
  // 履歴・注文・分析は reports.test.ts の「履歴・分析のテナント分離」で確かめている
  'GET /api/scan-logs', 'POST /api/scan-logs/:id/corrections', 'GET /api/orders/items', 'GET /api/orders/items/:id', 'POST /api/orders/items/:id/resolve',
  'GET /api/dashboard', 'GET /api/analytics/scans', 'GET /api/analytics/orders', 'GET /api/analytics/customers/:code',
  'GET /api/audit-logs',
  'GET /api/admin/companies', 'PUT /api/admin/companies/:id',
]);

describe('会社 A から会社 B のデータは見えない', () => {
  it.each([
    ['/staff', B.staff],
    ['/locations', B.location],
    ['/destinations', B.destination],
  ])('%s の一覧に B のデータが出ない', async (path, bId) => {
    const r = await get(`${path}?limit=200`, T.adminA);
    expect(r.status).toBe(200);
    expect(r.body.items.map((x: { id: number }) => x.id)).not.toContain(bId);
    expect(r.body.items.length).toBeGreaterThan(0);
  });

  it('利用者の一覧に B の人が出ない', async () => {
    const r = await get('/users', T.adminA);
    const ids = r.body.items.map((x: { id: number }) => x.id);
    expect(ids).not.toContain(11);
    expect(ids).not.toContain(12);
  });

  it('監査ログに B の記録が出ない', async () => {
    await put(`/staff/${B.staff}`, T.adminB, { name: '他社 作業者', version: await versionOf('staff', B.staff) });
    const r = await get('/audit-logs?limit=200', T.adminA);
    expect(r.status).toBe(200);
    const rows = await sql<{ id: number }>('SELECT id FROM audit_logs WHERE company_id = 2');
    const bIds = rows.map((x) => x.id);
    expect(bIds.length).toBeGreaterThan(0);
    expect(r.body.items.some((x: { id: number }) => bIds.includes(x.id))).toBe(false);
  });

  it('検索で B の名前を探しても出ない', async () => {
    const r = await get(`/staff?q=${encodeURIComponent('他社')}`, T.adminA);
    expect(r.body.items).toEqual([]);
  });
});

describe('会社 A から会社 B のデータは変えられない（404 で存在も知らせない）', () => {
  it.each([
    ['staff', '/staff', B.staff, { name: '乗っ取り' }],
    ['locations', '/locations', B.location, { name: '乗っ取り' }],
    ['destinations', '/destinations', B.destination, { name: '乗っ取り' }],
    ['users', '/users', B.user, { role: 'admin' }],
  ])('PUT %s', async (table, path, id, body) => {
    const v = await versionOf(table, id);
    const r = await put(`${path}/${id}`, T.adminA, { ...body, version: v });
    expect(r.status).toBe(404);
    expect(await versionOf(table, id)).toBe(v);
  });

  it('本文に company_id を入れても自分の会社に登録される', async () => {
    const r = await post('/staff', T.adminA, { code: 'TENANT1', name: 'テナント確認', company_id: 2 });
    expect(r.status).toBe(201);
    const [row] = await sql<{ company_id: number }>('SELECT company_id FROM staff WHERE id = ?', r.body.id);
    expect(row?.company_id).toBe(1);
  });

  it('同じコードは会社が違えば登録できる（コードの重複は会社ごと）', async () => {
    const r = await post('/locations', T.adminB, { code: '0053', name: 'B 社の 0053' });
    expect(r.status).toBe(201);
  });

  it('まとめて登録も自分の会社だけに入る', async () => {
    const r = await post('/destinations/bulk', T.adminB, { items: [{ customer_code: '100001', code: 'S00001', name: 'B 社の同じコード', company_id: 1 }] });
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(1);
    const rows = await sql<{ company_id: number }>("SELECT company_id FROM destinations WHERE customer_code = '100001' AND code = 'S00001' ORDER BY company_id");
    expect(rows.map((x) => x.company_id)).toEqual([1, 2]);
  });

  it('設定は自分の会社のものだけが変わる', async () => {
    const s = (await get('/settings', T.adminB)).body;
    const r = await put('/settings', T.adminB, { ...s, scans_per_item: 'quantity' });
    expect(r.status).toBe(200);
    expect((await get('/settings', T.adminA)).body.scans_per_item).toBe('one');
    await put('/settings', T.adminB, { ...r.body, scans_per_item: 'one' });
  });
});

describe('企業管理は運営者だけ', () => {
  it('一般・他社の管理者は 403', async () => {
    expect((await get('/admin/companies', T.generalA)).status).toBe(403);
    expect((await get('/admin/companies', T.adminB)).status).toBe(403);
    expect((await put('/admin/companies/1', T.adminB, { name: 'x', version: 1 })).status).toBe(403);
  });

  it('運営者は会社の一覧を見られる', async () => {
    const r = await get('/admin/companies', T.adminA);
    expect(r.status).toBe(200);
    expect(r.body.items.map((x: { id: number }) => x.id)).toEqual([1, 2, 3]);
  });

  it('運営者は自分の会社を停止できない', async () => {
    const r = await put('/admin/companies/1', T.adminA, { status: 'suspended', version: await versionOf('companies', 1) });
    expect(r.status).toBe(422);
  });
});

describe('テストの網羅', () => {
  it('ログインが必要な API はすべてこのファイルで分離を確かめている', () => {
    const routes = new Set(app.routes
      .filter((r) => r.path.startsWith('/api/') && r.path !== '/api/health' && r.method !== 'ALL')
      .map((r) => `${r.method} ${r.path}`));
    const missing = [...routes].filter((r) => !COVERED.has(r));
    expect(missing, `テナント分離テストのない API: ${missing.join(', ')}`).toEqual([]);
  });
});
