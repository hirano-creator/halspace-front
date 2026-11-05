import { Hono } from 'hono';
import { ROLES } from '@partsgate/shared';
import type { AppEnv } from '../types';
import { scoped } from '../lib/db';
import { authorize, idParam } from '../lib/guard';
import { HttpError, Validator, conflict, notFound, readJson } from '../lib/http';
import { auditStatement, diff, updated } from '../lib/audit';
import { nowIso } from '../lib/crypto';

/**
 * PARTS GATE の利用者（アカウント本体は Space.app）。ここで変えられるのは PARTS GATE 内のロールと利用停止だけ。
 * 利用者は、Space.app で PARTS GATE の利用を有効にした人が初めて開いたときに自動で登録される。
 */
export const userRoutes = new Hono<AppEnv>();

const COLS = 'id, hs_user_id, name, email, role, status, last_seen_at, created_at, updated_at, version';

userRoutes.get('/users', async (c) => {
  authorize(c, 'users.manage');
  const items = await scoped(c).all(`SELECT ${COLS} FROM users WHERE company_id = ?1 ORDER BY status, role, name, id LIMIT 500`);
  return c.json({ items });
});

userRoutes.put('/users/:id', async (c) => {
  authorize(c, 'users.manage');
  const db = scoped(c);
  const id = idParam(c);
  const v = new Validator(await readJson(c.req.raw));
  const role = v.oneOf('role', ROLES, { label: 'ロール' });
  const status = v.oneOf('status', ['active', 'suspended'] as const, { label: '利用状態' });
  const version = v.version();
  v.done();

  const before = await db.first<{ role: string; status: string }>(`SELECT ${COLS} FROM users WHERE company_id = ?1 AND id = ?2`, id);
  if (!before) throw notFound();
  const me = c.get('auth').user;
  if (id === me.id && ((role && role !== before.role) || (status && status !== before.status))) {
    throw new HttpError(422, '自分のロールと利用状態は変えられません。ほかの管理者に依頼してください。');
  }
  // 管理者が 1 人もいなくならないようにする
  const losesAdmin = before.role === 'admin' && before.status === 'active' && (role === 'general' || status === 'suspended');
  if (losesAdmin) {
    const others = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE company_id = ?1 AND role = 'admin' AND status = 'active' AND id <> ?2", id);
    if (!others?.n) throw new HttpError(422, '管理者が 1 人もいなくなるため変更できません。先にほかの人を管理者にしてください。');
  }

  const after = { role: role ?? before.role, status: status ?? before.status };
  const now = nowIso();
  const [res] = await db.batch([
    db.stmt('UPDATE users SET role = ?3, status = ?4, updated_at = ?5, version = version + 1 WHERE company_id = ?1 AND id = ?2 AND version = ?6',
      id, after.role, after.status, now, version),
    auditStatement(c, { action: 'user.update', targetType: 'user', targetId: id, detail: diff(before, after) }, updated('users', db.companyId, id, version + 1, now)),
  ]);
  if (!res?.meta.changes) throw conflict();
  return c.json(await db.first(`SELECT ${COLS} FROM users WHERE company_id = ?1 AND id = ?2`, id));
});
