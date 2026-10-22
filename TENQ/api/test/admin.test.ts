import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { T, auditCount, get, patch, post, version } from './helpers';

describe('利用者管理', () => {
  it('システム管理者以外は一覧を見られない', async () => {
    expect((await get('/users', T.manager)).status).toBe(403);
    const r = await get('/users', T.admin);
    expect(r.status).toBe(200);
    expect(r.body.items.some((u: { id: string }) => u.id === 'usr-other')).toBe(false);
  });

  it('ロールと所属工場を変えられ、監査ログが残る', async () => {
    const v = await version('users', 'usr-tanaka');
    const r = await patch('/users/usr-tanaka', T.admin, { version: v, role: 'equipment_staff', factory_ids: ['fac-1a', 'fac-1b'] });
    expect(r.status).toBe(200);
    const me = await get('/me', T.worker2);
    expect(me.body.user.role).toBe('equipment_staff');
    expect(me.body.factories.length).toBe(2);
    expect(await auditCount('user.update', 'usr-tanaka')).toBe(1);
  });

  it('他社の工場は所属にできない', async () => {
    const v = await version('users', 'usr-tanaka');
    expect((await patch('/users/usr-tanaka', T.admin, { version: v, factory_ids: ['fac-2a'] })).status).toBe(422);
  });

  it('自分自身の管理者権限は外せない・停止できない', async () => {
    const v = await version('users', 'usr-takahashi');
    expect((await patch('/users/usr-takahashi', T.admin, { version: v, role: 'worker' })).status).toBe(409);
    expect((await patch('/users/usr-takahashi', T.admin, { version: v, status: 'suspended', suspended_reason: 'x' })).status).toBe(409);
  });

  it('利用停止すると、その人の端末のログイン記憶もすべて取り消される（端末紛失の手順）', async () => {
    const device = await post('/auth/device', T.staff, {});
    expect((await get('/me', device.body.token)).status).toBe(200);
    const v = await version('users', 'usr-sato');
    expect((await patch('/users/usr-sato', T.admin, { version: v, status: 'suspended' })).status).toBe(422);
    expect((await patch('/users/usr-sato', T.admin, { version: v, status: 'suspended', suspended_reason: '端末紛失' })).status).toBe(200);
    expect((await get('/me', device.body.token)).status).toBe(401);
    expect((await get('/me', T.staff)).status).toBe(403);
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM device_sessions WHERE user_id = 'usr-sato' AND revoked_at IS NULL").first<{ n: number }>();
    expect(left?.n).toBe(0);
    // 戻しておく
    expect((await patch('/users/usr-sato', T.admin, { version: v + 1, status: 'active' })).status).toBe(200);
  });

  it('名簿は同じ会社のロール設定済みの人だけ', async () => {
    const r = await get('/users/directory', T.worker);
    const names = r.body.items.map((u: { name: string }) => u.name);
    expect(names).toContain('中村 誠');
    expect(names).not.toContain('他社 工場長');
    expect(names).not.toContain('伊藤 未設定');
  });
});

describe('工場・エリア', () => {
  it('工場の追加はシステム管理者だけ。コード重複は 422', async () => {
    expect((await post('/factories', T.manager, { code: 'F09', name: 'x' })).status).toBe(403);
    expect((await post('/factories', T.admin, { code: 'F09', name: '第9工場', working_days: '1,2,3,4,5,6' })).status).toBe(201);
    expect((await post('/factories', T.admin, { code: 'F09', name: '重複' })).status).toBe(422);
    expect((await post('/factories', T.admin, { code: 'F10', name: 'x', working_days: '8' })).status).toBe(422);
  });

  it('工場長は所属工場にだけエリアを作れる', async () => {
    expect((await post('/areas', T.manager, { factory_id: 'fac-1a', name: '検査室', grid_row: 2, col_span: 3 })).status).toBe(201);
    expect((await post('/areas', T.manager, { factory_id: 'fac-1b', name: '検査室' })).status).toBe(403);
    expect((await post('/areas', T.staff2, { factory_id: 'fac-1a', name: '倉庫' })).status).toBe(403);
    expect((await post('/areas', T.manager, { factory_id: 'fac-1a', name: '検査室' })).status).toBe(422);
  });

  it('エリア一覧は所属工場のみ', async () => {
    expect((await get('/areas?factory=fac-1a', T.worker)).body.items.length).toBeGreaterThanOrEqual(4);
    expect((await get('/areas?factory=fac-1a', T.other)).status).toBe(403);
  });

  it('入力の形式違い（JSON 以外）は 415、壊れた JSON は 400', async () => {
    const { default: app } = await import('../src/index');
    const r1 = await app.request('/api/factories', { method: 'POST', headers: { Authorization: `Bearer ${T.admin}`, 'Content-Type': 'text/plain' }, body: 'x' }, env);
    expect(r1.status).toBe(415);
    const r2 = await app.request('/api/factories', { method: 'POST', headers: { Authorization: `Bearer ${T.admin}`, 'Content-Type': 'application/json' }, body: '{' }, env);
    expect(r2.status).toBe(400);
  });
});
