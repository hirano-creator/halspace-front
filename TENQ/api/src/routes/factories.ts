import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { auditStatement, diff, updatedBy } from '../lib/audit';
import { newId, nowIso } from '../lib/crypto';
import { authorize } from '../lib/guard';
import { Validator, conflict, notFound, readJson } from '../lib/http';
import { scopeWhere } from '../lib/scope';

export const factoryRoutes = new Hono<AppEnv>();

const WORKING_DAYS = /^[1-7](,[1-7]){0,6}$/;

interface FactoryRow { id: string; code: string; name: string; address: string | null; working_days: string; status: string; version: number }

factoryRoutes.get('/factories', async (c) => {
  // 工場自体は factory_id 列を持たないので id で絞る
  const s = scopeWhere(c.get('auth'), '', 'id');
  const { results } = await c.env.DB.prepare(`SELECT id, code, name, address, timezone, working_days, status, version FROM factories WHERE ${s.sql} ORDER BY code`)
    .bind(...s.params).all();
  return c.json({ items: results });
});

factoryRoutes.post('/factories', async (c) => {
  authorize(c, 'settings.manage');
  const auth = c.get('auth');
  const v = new Validator(await readJson(c.req.raw));
  const code = v.str('code', { required: true, max: 20, label: '工場コード' });
  const name = v.str('name', { required: true, max: 60, label: '工場名' });
  const address = v.str('address', { max: 200, label: '所在地' });
  const workingDays = v.str('working_days', { max: 13, label: '稼働曜日' }) ?? '1,2,3,4,5';
  if (!WORKING_DAYS.test(workingDays)) v.fail('working_days', '稼働曜日の形式が正しくありません。');
  if (code && await c.env.DB.prepare('SELECT 1 FROM factories WHERE company_id = ? AND code = ?').bind(auth.companyId, code).first()) {
    v.fail('code', 'この工場コードはすでに使われています。');
  }
  v.done();

  const id = newId();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO factories (id, company_id, code, name, address, working_days, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, auth.companyId, code, name, address ?? null, workingDays, now, auth.user.id, now, auth.user.id),
    auditStatement(c, { action: 'factory.create', targetType: 'factory', targetId: id, factoryId: id, detail: { code, name } }),
  ]);
  return c.json({ id }, 201);
});

factoryRoutes.patch('/factories/:id', async (c) => {
  authorize(c, 'settings.manage');
  const auth = c.get('auth');
  const before = await c.env.DB.prepare('SELECT * FROM factories WHERE id = ? AND company_id = ?').bind(c.req.param('id'), auth.companyId).first<FactoryRow>();
  if (!before) throw notFound();

  const v = new Validator(await readJson(c.req.raw));
  const version = v.version();
  const after = {
    name: v.str('name', { max: 60, label: '工場名' }),
    address: v.nullableStr('address', { max: 200, label: '所在地' }),
    working_days: v.str('working_days', { max: 13, label: '稼働曜日' }),
    status: v.oneOf('status', ['active', 'inactive'] as const, { label: '状態' }),
  };
  if (after.working_days && !WORKING_DAYS.test(after.working_days)) v.fail('working_days', '稼働曜日の形式が正しくありません。');
  v.done();

  const changes = diff(before as unknown as Record<string, unknown>, after);
  if (!Object.keys(changes).length) return c.json({ version: before.version });
  const now = nowIso();
  const [upd] = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE factories SET name = COALESCE(?, name), address = CASE WHEN ? THEN ? ELSE address END,
        working_days = COALESCE(?, working_days), status = COALESCE(?, status), updated_at = ?, updated_by = ?, version = version + 1
      WHERE id = ? AND version = ?`)
      .bind(after.name ?? null, after.address !== undefined ? 1 : 0, after.address ?? null, after.working_days ?? null, after.status ?? null, now, auth.user.id, before.id, version),
    auditStatement(c, { action: 'factory.update', targetType: 'factory', targetId: before.id, factoryId: before.id, detail: { changes } },
      updatedBy('factories', before.id, version, now, auth.user.id)),
  ]);
  if (!upd?.meta.changes) throw conflict();
  return c.json({ version: version + 1 });
});
