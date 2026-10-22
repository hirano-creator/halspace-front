import { describe, expect, it } from 'vitest';
import { can, type Action, type Actor, type Role } from '@tenq/shared';
import { T, call } from './helpers';

/**
 * 権限表（requirements §3-2）どおりに API が許可・拒否するかの総当たり（T-02）。
 * 期待値は shared の can() から作るので、権限表を変えるとこのテストも追従する。
 * 条件付き（担当設備・自分の点検中など）の操作は、それぞれの機能のテストで確かめている。
 */

const USERS: { token: string; role: Role | null; label: string }[] = [
  { token: T.worker, role: 'worker', label: '一般社員' },
  { token: T.staff, role: 'equipment_staff', label: '設備担当者' },
  { token: T.manager, role: 'factory_manager', label: '工場長' },
  { token: T.admin, role: 'system_admin', label: 'システム管理者' },
  { token: T.norole, role: null, label: 'ロール未設定' },
];

let seq = 0;
/** 操作ごとの代表の API。成功時の状態コードと、そのための本体 */
const CASES: { action: Action; method: string; path: string; body?: () => unknown; ok: number }[] = [
  { action: 'equipment.view', method: 'GET', path: '/equipment', ok: 200 },
  { action: 'equipment.create', method: 'POST', path: '/equipment', body: () => ({ factory_id: 'fac-1a', equipment_code: `PM-${++seq}`, name: '権限テスト' }), ok: 201 },
  { action: 'board.view', method: 'GET', path: '/board?factory=fac-1a', ok: 200 },
  { action: 'inspection.viewOwn', method: 'GET', path: '/inspections', ok: 200 },
  { action: 'abnormality.report', method: 'GET', path: '/abnormalities', ok: 200 },
  { action: 'qr.issue', method: 'GET', path: '/qr-labels?factory=fac-1a', ok: 200 },
  { action: 'template.edit', method: 'POST', path: '/templates', body: () => ({ name: `権限テスト ${++seq}`, items: [{ label: '外観' }] }), ok: 201 },
  { action: 'layout.edit', method: 'PUT', path: '/areas/layout', body: () => ({ factory_id: 'fac-1a', areas: [], equipment: [] }), ok: 200 },
  { action: 'export', method: 'GET', path: '/exports/equipment.csv', ok: 200 },
  { action: 'audit.view', method: 'GET', path: '/audit-logs', ok: 200 },
  { action: 'users.manage', method: 'GET', path: '/users', ok: 200 },
  { action: 'settings.manage', method: 'GET', path: '/settings', ok: 200 },
];

describe('権限表の総当たり（T-02）', () => {
  for (const u of USERS) {
    const actor: Actor = { id: 'x', role: u.role, factoryIds: ['fac-1a'] };
    for (const cse of CASES) {
      const allowed = can(actor, cse.action, { factoryId: 'fac-1a' });
      it(`${u.label} × ${cse.action} → ${allowed ? '可' : '不可'}`, async () => {
        const r = await call(cse.method, cse.path, u.token, cse.body?.());
        expect(r.status).toBe(allowed ? cse.ok : 403);
      });
    }
  }

  it('利用停止中の人はどの操作も 403、トークンなしは 401', async () => {
    for (const cse of CASES) {
      expect((await call(cse.method, cse.path, T.suspended, cse.body?.())).status).toBe(403);
      expect((await call(cse.method, cse.path, undefined, cse.body?.())).status).toBe(401);
    }
  });
});
