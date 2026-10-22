import { Hono } from 'hono';
import { ROLES } from '@tenq/shared';
import type { AppEnv } from '../types';
import { auditStatement, updatedBy } from '../lib/audit';
import { nowIso } from '../lib/crypto';
import { authorize } from '../lib/guard';
import { HttpError, Validator, conflict, notFound, readJson } from '../lib/http';

/**
 * 利用者の TENQ ロール・所属工場・利用停止（system_admin）。
 * アカウントの作成・削除・パスワードは Space.app 側で行う。
 */
export const userRoutes = new Hono<AppEnv>();

interface UserRow { id: string; name: string; role: string | null; status: string; version: number }

userRoutes.get('/users', async (c) => {
  authorize(c, 'users.manage');
  const auth = c.get('auth');
  const now = nowIso();
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.hs_user_id, u.name, u.email, u.role, u.status, u.suspended_reason, u.last_seen_at, u.version,
            (SELECT group_concat(uf.factory_id) FROM user_factories uf WHERE uf.user_id = u.id) AS factory_ids,
            (SELECT COUNT(*) FROM device_sessions d WHERE d.user_id = u.id AND d.revoked_at IS NULL AND d.expires_at > ?) AS active_devices
     FROM users u WHERE u.company_id = ? ORDER BY u.status, u.role IS NULL DESC, u.name`,
  ).bind(now, auth.companyId).all<Record<string, unknown> & { factory_ids: string | null }>();
  return c.json({ items: results.map((r) => ({ ...r, factory_ids: r.factory_ids ? r.factory_ids.split(',') : [] })) });
});

/** 選択肢用の名簿（管理担当者・異常の担当者を選ぶとき） */
userRoutes.get('/users/directory', async (c) => {
  authorize(c, 'equipment.view');
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, role FROM users WHERE company_id = ? AND status = 'active' AND role IS NOT NULL ORDER BY name",
  ).bind(c.get('auth').companyId).all();
  return c.json({ items: results });
});

userRoutes.patch('/users/:id', async (c) => {
  authorize(c, 'users.manage');
  const auth = c.get('auth');
  const before = await c.env.DB.prepare('SELECT id, name, role, status, version FROM users WHERE id = ? AND company_id = ?')
    .bind(c.req.param('id'), auth.companyId).first<UserRow>();
  if (!before) throw notFound();

  const body = await readJson(c.req.raw);
  const v = new Validator(body);
  const version = v.version();
  const role = 'role' in body && body.role === null ? null : v.oneOf('role', ROLES, { label: 'ロール' });
  const status = v.oneOf('status', ['active', 'suspended'] as const, { label: '利用状態' });
  const reason = v.str('suspended_reason', { required: status === 'suspended' && before.status !== 'suspended', max: 200, label: '停止の理由' });
  const factoryIds = v.strArray('factory_ids', { max: 50, label: '所属工場' });
  v.done();

  // 自分を締め出さない
  if (before.id === auth.user.id && ((role !== undefined && role !== 'system_admin') || status === 'suspended')) {
    throw new HttpError(409, '自分自身のシステム管理者の権限は外せません。ほかのシステム管理者に依頼してください。');
  }
  if (factoryIds?.length) {
    const { results } = await c.env.DB.prepare(`SELECT id FROM factories WHERE company_id = ? AND id IN (${factoryIds.map(() => '?').join(',')})`)
      .bind(auth.companyId, ...factoryIds).all();
    if (results.length !== factoryIds.length) { v.fail('factory_ids', '所属工場に、この会社の工場ではないものが含まれています。'); v.done(); }
  }

  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`UPDATE users SET role = CASE WHEN ? THEN ? ELSE role END, status = COALESCE(?, status),
        suspended_reason = CASE WHEN ? = 'active' THEN NULL WHEN ? IS NOT NULL THEN ? ELSE suspended_reason END,
        updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ? AND version = ?`)
      .bind(role !== undefined ? 1 : 0, role ?? null, status ?? null, status ?? null, reason ?? null, reason ?? null, now, auth.user.id, before.id, version),
  ];
  const guard = updatedBy('users', before.id, version, now, auth.user.id);
  if (factoryIds) {
    // 楽観ロックが効いたときだけ所属工場を入れ替える
    statements.push(c.env.DB.prepare(`DELETE FROM user_factories WHERE user_id = ? AND EXISTS (${guard.sql})`).bind(before.id, ...guard.params));
    for (const fid of factoryIds) {
      statements.push(c.env.DB.prepare(`INSERT INTO user_factories (user_id, factory_id, created_at, created_by) SELECT ?, ?, ?, ? WHERE EXISTS (${guard.sql})`)
        .bind(before.id, fid, now, auth.user.id, ...guard.params));
    }
  }
  if (status === 'suspended') {
    // 利用停止したら端末のログイン記憶もすべて取り消す（security.md §8）
    statements.push(c.env.DB.prepare(`UPDATE device_sessions SET revoked_at = ?, revoked_by = ?, revoke_reason = 'user_suspended' WHERE user_id = ? AND revoked_at IS NULL AND EXISTS (${guard.sql})`)
      .bind(now, auth.user.id, before.id, ...guard.params));
  }
  statements.push(auditStatement(c, { action: 'user.update', targetType: 'user', targetId: before.id,
    detail: { name: before.name, role: role !== undefined ? [before.role, role] : undefined, status: status ? [before.status, status] : undefined, reason, factory_ids: factoryIds } }, guard));

  const [upd] = await c.env.DB.batch(statements);
  if (!upd?.meta.changes) throw conflict();
  return c.json({ version: version + 1 });
});

/** その利用者の端末のログイン記憶をすべて取り消す（端末紛失時。security.md §8） */
userRoutes.post('/users/:id/revoke-devices', async (c) => {
  const auth = c.get('auth');
  const target = await c.env.DB.prepare('SELECT id FROM users WHERE id = ? AND company_id = ?').bind(c.req.param('id'), auth.companyId).first<{ id: string }>();
  if (!target) throw notFound();
  authorize(c, 'device.revoke', { deviceOwnerId: target.id });
  const [res] = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE device_sessions SET revoked_at = ?, revoked_by = ?, revoke_reason = 'revoked_by_admin' WHERE user_id = ? AND revoked_at IS NULL")
      .bind(nowIso(), auth.user.id, target.id),
    auditStatement(c, { action: 'device.revoke_all', targetType: 'user', targetId: target.id }),
  ]);
  return c.json({ revoked: res?.meta.changes ?? 0 });
});
