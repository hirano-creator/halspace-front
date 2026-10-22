import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { auditStatement, diff, updatedBy } from '../lib/audit';
import { newId, nowIso } from '../lib/crypto';
import { authorize } from '../lib/guard';
import { HttpError, Validator, conflict, notFound, readJson } from '../lib/http';
import { scopeWhere } from '../lib/scope';

/** エリア（PC のカード一覧の枠。requirements F-12）。配置のドラッグ編集は第6段階 */
export const areaRoutes = new Hono<AppEnv>();

interface AreaRow { id: string; factory_id: string; name: string; grid_row: number; grid_col: number; col_span: number; sort_order: number; status: string; version: number }

areaRoutes.get('/areas', async (c) => {
  const auth = c.get('auth');
  const factoryId = c.req.query('factory');
  if (!factoryId) throw new HttpError(400, '工場を指定してください。');
  authorize(c, 'board.view', { factoryId });
  const s = scopeWhere(auth, '');
  const { results } = await c.env.DB.prepare(
    `SELECT id, factory_id, name, grid_row, grid_col, col_span, sort_order, status, version FROM areas WHERE ${s.sql} AND factory_id = ? ORDER BY sort_order, name`,
  ).bind(...s.params, factoryId).all();
  return c.json({ items: results });
});

areaRoutes.post('/areas', async (c) => {
  const auth = c.get('auth');
  const v = new Validator(await readJson(c.req.raw));
  const factoryId = v.str('factory_id', { required: true, max: 64, label: '工場' });
  const name = v.str('name', { required: true, max: 40, label: 'エリア名' });
  const gridRow = v.int('grid_row', { min: 0, max: 50, label: '行' }) ?? 0;
  const gridCol = v.int('grid_col', { min: 0, max: 11, label: '列' }) ?? 0;
  const colSpan = v.int('col_span', { min: 2, max: 12, label: '横幅' }) ?? 4;
  const sortOrder = v.int('sort_order', { min: 0, max: 9999, label: '並び順' }) ?? 0;
  v.done();
  authorize(c, 'layout.edit', { factoryId });
  const factory = await c.env.DB.prepare('SELECT id FROM factories WHERE id = ? AND company_id = ?').bind(factoryId, auth.companyId).first();
  if (!factory) throw notFound();
  if (await c.env.DB.prepare('SELECT 1 FROM areas WHERE factory_id = ? AND name = ?').bind(factoryId, name).first()) {
    v.fail('name', '同じ名前のエリアがすでにあります。');
    v.done();
  }

  const id = newId();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO areas (id, company_id, factory_id, name, grid_row, grid_col, col_span, sort_order, created_at, created_by, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, auth.companyId, factoryId, name, gridRow, gridCol, colSpan, sortOrder, now, auth.user.id, now, auth.user.id),
    auditStatement(c, { action: 'area.create', targetType: 'area', targetId: id, factoryId, detail: { name } }),
  ]);
  return c.json({ id }, 201);
});

areaRoutes.patch('/areas/:id', async (c) => {
  const auth = c.get('auth');
  const before = await c.env.DB.prepare('SELECT * FROM areas WHERE id = ? AND company_id = ?').bind(c.req.param('id'), auth.companyId).first<AreaRow>();
  if (!before) throw notFound();
  authorize(c, 'layout.edit', { factoryId: before.factory_id });

  const v = new Validator(await readJson(c.req.raw));
  const version = v.version();
  const after = {
    name: v.str('name', { max: 40, label: 'エリア名' }),
    grid_row: v.int('grid_row', { min: 0, max: 50, label: '行' }),
    grid_col: v.int('grid_col', { min: 0, max: 11, label: '列' }),
    col_span: v.int('col_span', { min: 2, max: 12, label: '横幅' }),
    sort_order: v.int('sort_order', { min: 0, max: 9999, label: '並び順' }),
    status: v.oneOf('status', ['active', 'inactive'] as const, { label: '状態' }),
  };
  v.done();

  const changes = diff(before as unknown as Record<string, unknown>, after);
  if (!Object.keys(changes).length) return c.json({ version: before.version });
  const now = nowIso();
  const [upd] = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE areas SET name = COALESCE(?, name), grid_row = COALESCE(?, grid_row), grid_col = COALESCE(?, grid_col),
        col_span = COALESCE(?, col_span), sort_order = COALESCE(?, sort_order), status = COALESCE(?, status),
        updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ? AND version = ?`)
      .bind(after.name ?? null, after.grid_row ?? null, after.grid_col ?? null, after.col_span ?? null, after.sort_order ?? null, after.status ?? null,
        now, auth.user.id, before.id, version),
    auditStatement(c, { action: 'area.update', targetType: 'area', targetId: before.id, factoryId: before.factory_id, detail: { changes } },
      updatedBy('areas', before.id, version, now, auth.user.id)),
  ]);
  if (!upd?.meta.changes) throw conflict();
  return c.json({ version: version + 1 });
});

/**
 * カード一覧の配置をまとめて保存（エリアの位置・幅・並び、設備の置き場所・並び）。
 * 配置は見た目の情報で記録の内容には関わらないため、楽観ロックはせず後から保存した内容を正とする（監査ログには残す）。
 */
areaRoutes.put('/areas/layout', async (c) => {
  const auth = c.get('auth');
  const body = await readJson(c.req.raw);
  const v = new Validator(body);
  const factoryId = v.str('factory_id', { required: true, max: 64, label: '工場' });
  v.done();
  authorize(c, 'layout.edit', { factoryId });
  const areas = Array.isArray(body.areas) ? body.areas as Record<string, unknown>[] : [];
  const equipment = Array.isArray(body.equipment) ? body.equipment as Record<string, unknown>[] : [];
  if (areas.length > 100 || equipment.length > 2000) throw new HttpError(422, '配置の件数が多すぎます。');
  const int = (x: unknown, min: number, max: number) => typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;
  for (const a of areas) {
    if (typeof a.id !== 'string' || !int(a.grid_row, 0, 50) || !int(a.grid_col, 0, 11) || !int(a.col_span, 2, 12) || !int(a.sort_order, 0, 9999)) {
      throw new HttpError(422, 'エリアの配置の値が正しくありません。');
    }
    if ((a.grid_col as number) + (a.col_span as number) > 12) throw new HttpError(422, 'エリアが横にはみ出しています（列＋横幅は12まで）。');
  }
  for (const e of equipment) {
    if (typeof e.id !== 'string' || !(e.area_id === null || typeof e.area_id === 'string') || !int(e.board_order, 0, 99999)) {
      throw new HttpError(422, '設備の配置の値が正しくありません。');
    }
  }
  const db = c.env.DB;
  // すべてこの工場のものか（他工場・他社の ID が混ざっていたら拒否）
  const ids = (xs: Record<string, unknown>[]) => JSON.stringify(xs.map((x) => x.id));
  const areaIds = new Set([...areas.map((a) => a.id as string), ...equipment.map((e) => e.area_id).filter((x): x is string => typeof x === 'string')]);
  const [aOk, eOk] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM areas WHERE factory_id = ? AND company_id = ? AND id IN (SELECT value FROM json_each(?))').bind(factoryId, auth.companyId, JSON.stringify([...areaIds])),
    db.prepare('SELECT COUNT(*) AS n FROM equipment WHERE factory_id = ? AND company_id = ? AND id IN (SELECT value FROM json_each(?))').bind(factoryId, auth.companyId, ids(equipment)),
  ]);
  if ((aOk?.results[0] as { n: number }).n !== areaIds.size || (eOk?.results[0] as { n: number }).n !== equipment.length) throw new HttpError(422, 'この工場のものではないエリア・設備が含まれています。');

  const now = nowIso();
  await db.batch([
    db.prepare(`UPDATE areas SET grid_row = j.grid_row, grid_col = j.grid_col, col_span = j.col_span, sort_order = j.sort_order, updated_at = ?, updated_by = ?, version = version + 1
                FROM (SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.grid_row') AS grid_row, json_extract(value, '$.grid_col') AS grid_col,
                             json_extract(value, '$.col_span') AS col_span, json_extract(value, '$.sort_order') AS sort_order FROM json_each(?)) AS j
                WHERE areas.id = j.id AND areas.factory_id = ?`).bind(now, auth.user.id, JSON.stringify(areas), factoryId),
    db.prepare(`UPDATE equipment SET area_id = j.area_id, board_order = j.board_order, updated_at = ?, updated_by = ?, version = version + 1
                FROM (SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.area_id') AS area_id, json_extract(value, '$.board_order') AS board_order FROM json_each(?)) AS j
                WHERE equipment.id = j.id AND equipment.factory_id = ? AND (equipment.area_id IS NOT j.area_id OR equipment.board_order <> j.board_order)`)
      .bind(now, auth.user.id, JSON.stringify(equipment), factoryId),
    auditStatement(c, { action: 'layout.update', targetType: 'factory', targetId: factoryId, factoryId, detail: { areas: areas.length, equipment: equipment.length } }),
  ]);
  return c.json({ ok: true });
});
