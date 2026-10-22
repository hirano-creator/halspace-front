import { Hono, type Context } from 'hono';
import { STAFF_EDITABLE_EQUIPMENT_FIELDS, can } from '@tenq/shared';
import type { AppEnv } from '../types';
import { auditStatement, diff, updatedBy } from '../lib/audit';
import { QR_TOKEN_PATTERN, newId, newQrToken, nowIso } from '../lib/crypto';
import { authorize } from '../lib/guard';
import { HttpError, Validator, conflict, forbidden, notFound, readJson } from '../lib/http';
import { inFactoryScope, scopeWhere } from '../lib/scope';

export const equipmentRoutes = new Hono<AppEnv>();

const STATUSES = ['active', 'stopped', 'retired'] as const;
const FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;

export interface EquipmentRow {
  id: string; company_id: number; factory_id: string; equipment_code: string; name: string;
  location: string | null; category: string | null; maker: string | null; model: string | null;
  manager_user_id: string | null; area_id: string | null; board_order: number;
  status: (typeof STATUSES)[number]; status_reason: string | null; frequency: (typeof FREQUENCIES)[number];
  template_id: string | null; notes: string | null; retired_at: string | null;
  created_at: string; updated_at: string; version: number;
}

const DETAIL_SELECT = `
  SELECT e.*, f.code AS factory_code, f.name AS factory_name, a.name AS area_name, m.name AS manager_name,
         t.name AS template_name, q.token AS qr_token, q.issued_at AS qr_issued_at
  FROM equipment e
  JOIN factories f ON f.id = e.factory_id
  LEFT JOIN areas a ON a.id = e.area_id
  LEFT JOIN users m ON m.id = e.manager_user_id
  LEFT JOIN inspection_templates t ON t.id = e.template_id
  LEFT JOIN equipment_qr_tokens q ON q.equipment_id = e.id AND q.revoked_at IS NULL`;

/** スコープ内の設備を1件取る。範囲外・存在しないものは 404 */
async function loadScoped(c: Context<AppEnv>, id: string): Promise<EquipmentRow> {
  const s = scopeWhere(c.get('auth'), 'e');
  const row = await c.env.DB.prepare(`SELECT e.* FROM equipment e WHERE e.id = ? AND ${s.sql}`).bind(id, ...s.params).first<EquipmentRow>();
  if (!row) throw notFound();
  return row;
}

/** 一覧（キーセットページング。並びは設備番号順） */
equipmentRoutes.get('/equipment', async (c) => {
  authorize(c, 'equipment.view');
  const auth = c.get('auth');
  const q = c.req.query();
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
  const where: string[] = [];
  const params: unknown[] = [];
  const s = scopeWhere(auth, 'e');
  where.push(s.sql); params.push(...s.params);
  if (q.factory) { where.push('e.factory_id = ?'); params.push(q.factory); }
  if (q.status && (STATUSES as readonly string[]).includes(q.status)) { where.push('e.status = ?'); params.push(q.status); }
  else if (q.status !== 'all') { where.push("e.status <> 'retired'"); }
  if (q.area === 'none') where.push('e.area_id IS NULL');
  else if (q.area) { where.push('e.area_id = ?'); params.push(q.area); }
  if (q.q) {
    const kw = `%${q.q.slice(0, 50).replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    where.push("(e.equipment_code LIKE ? ESCAPE '\\' OR e.name LIKE ? ESCAPE '\\' OR e.location LIKE ? ESCAPE '\\')");
    params.push(kw, kw, kw);
  }
  if (q.cursor) {
    const [code, id] = decodeCursor(q.cursor);
    where.push('(e.equipment_code > ? OR (e.equipment_code = ? AND e.id > ?))');
    params.push(code, code, id);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.factory_id, f.name AS factory_name, e.equipment_code, e.name, e.location, e.category, e.status,
            e.frequency, e.area_id, a.name AS area_name, e.manager_user_id, m.name AS manager_name, e.version
     FROM equipment e JOIN factories f ON f.id = e.factory_id
     LEFT JOIN areas a ON a.id = e.area_id LEFT JOIN users m ON m.id = e.manager_user_id
     WHERE ${where.join(' AND ')} ORDER BY e.equipment_code, e.id LIMIT ?`,
  ).bind(...params, limit + 1).all<{ id: string; equipment_code: string }>();
  const items = results.slice(0, limit);
  const last = items[items.length - 1];
  return c.json({ items, nextCursor: results.length > limit && last ? encodeCursor(last.equipment_code, last.id) : null });
});

equipmentRoutes.get('/equipment/:id', async (c) => {
  authorize(c, 'equipment.view');
  const auth = c.get('auth');
  const s = scopeWhere(auth, 'e');
  const row = await c.env.DB.prepare(`${DETAIL_SELECT} WHERE e.id = ? AND ${s.sql}`).bind(c.req.param('id'), ...s.params).first<EquipmentRow & { qr_token: string | null }>();
  if (!row) throw notFound();
  const target = { factoryId: row.factory_id, equipmentManagerId: row.manager_user_id };
  // 画面のボタン表示用。最終判定は各 API で行う
  const permissions = {
    edit: can(auth.actor, 'equipment.edit', target),
    editAll: can(auth.actor, 'equipment.create', target),
    stop: can(auth.actor, 'equipment.stop', target),
    retire: can(auth.actor, 'equipment.retire', target),
    qr: can(auth.actor, 'qr.issue', target),
  };
  return c.json({ item: row, permissions });
});

/** 登録（工場長・システム管理者）。登録と同時に QR トークンを発行する */
equipmentRoutes.post('/equipment', async (c) => {
  const auth = c.get('auth');
  const v = new Validator(await readJson(c.req.raw));
  const f = await readFields(c, v, true);
  v.done();
  authorize(c, 'equipment.create', { factoryId: f.factory_id });
  await checkReferences(c, v, f.factory_id!, f);
  if (await c.env.DB.prepare('SELECT 1 FROM equipment WHERE factory_id = ? AND equipment_code = ?').bind(f.factory_id, f.equipment_code).first()) {
    v.fail('equipment_code', 'この設備番号は同じ工場ですでに使われています。');
  }
  v.done();

  const id = newId();
  const token = newQrToken();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO equipment (id, company_id, factory_id, equipment_code, name, location, category, maker, model, manager_user_id, area_id,
        status, frequency, template_id, notes, created_at, created_by, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, auth.companyId, f.factory_id, f.equipment_code, f.name, f.location ?? null, f.category ?? null, f.maker ?? null, f.model ?? null,
        f.manager_user_id ?? null, f.area_id ?? null, f.frequency ?? 'daily', f.template_id ?? null, f.notes ?? null, now, auth.user.id, now, auth.user.id),
    c.env.DB.prepare('INSERT INTO equipment_qr_tokens (token, equipment_id, company_id, issued_at, issued_by) VALUES (?, ?, ?, ?, ?)')
      .bind(token, id, auth.companyId, now, auth.user.id),
    auditStatement(c, { action: 'equipment.create', targetType: 'equipment', targetId: id, factoryId: f.factory_id, detail: { ...f } }),
  ]);
  return c.json({ id }, 201);
});

/** 編集。設備担当者は担当設備の一部の項目だけ（requirements §3-2） */
equipmentRoutes.patch('/equipment/:id', async (c) => {
  const auth = c.get('auth');
  const before = await loadScoped(c, c.req.param('id'));
  if (before.status === 'retired') throw new HttpError(409, '廃止した設備は編集できません。');
  const target = { factoryId: before.factory_id, equipmentManagerId: before.manager_user_id };
  authorize(c, 'equipment.edit', target);
  const full = can(auth.actor, 'equipment.create', target);

  const body = await readJson(c.req.raw);
  if (!full) {
    const extra = Object.keys(body).filter((k) => k !== 'version' && !(STAFF_EDITABLE_EQUIPMENT_FIELDS as readonly string[]).includes(k));
    if (extra.length) throw forbidden(`設備担当者が変更できるのは 設置場所・メーカー・型式・備考 だけです（変更できない項目: ${extra.join(', ')}）。`);
  }
  const v = new Validator(body);
  const version = v.version();
  const f = await readFields(c, v, false);
  if ('factory_id' in body) v.fail('factory_id', '工場は変更できません。別の工場へ移す場合は、新しく登録してください。');
  v.done();
  await checkReferences(c, v, before.factory_id, f);
  if (f.equipment_code && f.equipment_code !== before.equipment_code &&
      await c.env.DB.prepare('SELECT 1 FROM equipment WHERE factory_id = ? AND equipment_code = ? AND id <> ?').bind(before.factory_id, f.equipment_code, before.id).first()) {
    v.fail('equipment_code', 'この設備番号は同じ工場ですでに使われています。');
  }
  v.done();

  const changes = diff(before as unknown as Record<string, unknown>, f);
  if (!Object.keys(changes).length) return c.json({ version: before.version });
  const cols = Object.keys(changes);
  const now = nowIso();
  const [upd] = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE equipment SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ? AND version = ?`)
      .bind(...cols.map((k) => (f as Record<string, unknown>)[k] ?? null), now, auth.user.id, before.id, version),
    auditStatement(c, { action: 'equipment.update', targetType: 'equipment', targetId: before.id, factoryId: before.factory_id, detail: { changes } },
      updatedBy('equipment', before.id, version, now, auth.user.id)),
  ]);
  if (!upd?.meta.changes) throw conflict();
  return c.json({ version: version + 1 });
});

/** 停止・再開・廃止。廃止は元に戻せない */
equipmentRoutes.post('/equipment/:id/status', async (c) => {
  const auth = c.get('auth');
  const before = await loadScoped(c, c.req.param('id'));
  const v = new Validator(await readJson(c.req.raw));
  const version = v.version();
  const status = v.oneOf('status', STATUSES, { required: true, label: '使用状態' });
  const reason = v.str('reason', { required: status !== 'active', max: 200, label: '理由' });
  v.done();
  const target = { factoryId: before.factory_id, equipmentManagerId: before.manager_user_id };
  authorize(c, status === 'retired' ? 'equipment.retire' : 'equipment.stop', target);
  if (before.status === 'retired') throw new HttpError(409, '廃止した設備の状態は変えられません。');
  if (before.status === status) return c.json({ version: before.version });

  const now = nowIso();
  const [upd] = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE equipment SET status = ?, status_reason = ?, retired_at = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ? AND version = ?`)
      .bind(status, reason ?? null, status === 'retired' ? now : null, now, auth.user.id, before.id, version),
    auditStatement(c, { action: `equipment.${status === 'active' ? 'resume' : status === 'stopped' ? 'stop' : 'retire'}`, targetType: 'equipment', targetId: before.id,
      factoryId: before.factory_id, detail: { from: before.status, to: status, reason } }, updatedBy('equipment', before.id, version, now, auth.user.id)),
  ]);
  if (!upd?.meta.changes) throw conflict();
  return c.json({ version: version + 1 });
});

/** QR の再発行（汚損・紛失）。旧トークンは無効になり、読むと「再発行済み」と案内する */
equipmentRoutes.post('/equipment/:id/qr', async (c) => {
  const auth = c.get('auth');
  const eq = await loadScoped(c, c.req.param('id'));
  authorize(c, 'qr.issue', { factoryId: eq.factory_id });
  if (eq.status === 'retired') throw new HttpError(409, '廃止した設備の QR コードは発行できません。');
  const v = new Validator(await readJson(c.req.raw));
  const reason = v.str('reason', { required: true, max: 200, label: '再発行の理由' });
  v.done();

  const token = newQrToken();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE equipment_qr_tokens SET revoked_at = ?, revoked_by = ?, revoke_reason = ? WHERE equipment_id = ? AND revoked_at IS NULL')
      .bind(now, auth.user.id, reason, eq.id),
    c.env.DB.prepare('INSERT INTO equipment_qr_tokens (token, equipment_id, company_id, issued_at, issued_by) VALUES (?, ?, ?, ?, ?)')
      .bind(token, eq.id, auth.companyId, now, auth.user.id),
    auditStatement(c, { action: 'qr.reissue', targetType: 'equipment', targetId: eq.id, factoryId: eq.factory_id, detail: { reason } }),
  ]);
  return c.json({ token }, 201);
});

/** QR ラベル印刷用の一覧（有効なトークン付き） */
equipmentRoutes.get('/qr-labels', async (c) => {
  const auth = c.get('auth');
  const factoryId = c.req.query('factory');
  if (!factoryId) throw new HttpError(400, '工場を指定してください。');
  authorize(c, 'qr.issue', { factoryId });
  const ids = (c.req.query('ids') ?? '').split(',').filter(Boolean).slice(0, 90);
  const s = scopeWhere(auth, 'e');
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.equipment_code, e.name, e.location, a.name AS area_name, q.token
     FROM equipment e JOIN equipment_qr_tokens q ON q.equipment_id = e.id AND q.revoked_at IS NULL
     LEFT JOIN areas a ON a.id = e.area_id
     WHERE ${s.sql} AND e.factory_id = ? AND e.status <> 'retired' ${ids.length ? `AND e.id IN (${ids.map(() => '?').join(',')})` : ''}
     ORDER BY e.equipment_code`,
  ).bind(...s.params, factoryId, ...ids).all();
  return c.json({ items: results });
});

/** QR を読んだときの設備の特定。ログインと工場の権限が必要（QR だけでは何も見えない） */
equipmentRoutes.get('/qr/:token', async (c) => {
  const auth = c.get('auth');
  const token = c.req.param('token').toUpperCase();
  if (!QR_TOKEN_PATTERN.test(token)) throw notFound('この QR コードは TENQ に登録されていません。');
  const row = await c.env.DB.prepare(
    `SELECT q.revoked_at, e.id, e.factory_id, e.equipment_code, e.name, e.status
     FROM equipment_qr_tokens q JOIN equipment e ON e.id = q.equipment_id WHERE q.token = ? AND q.company_id = ?`,
  ).bind(token, auth.companyId).first<{ revoked_at: string | null; id: string; factory_id: string; equipment_code: string; name: string; status: string }>();
  if (!row) throw notFound('この QR コードは TENQ に登録されていません。');
  if (!inFactoryScope(auth, row.factory_id)) throw forbidden('この設備の工場は、あなたの所属工場ではありません。');
  if (row.revoked_at) throw new HttpError(410, `この QR コードは再発行済みで使えません（${row.equipment_code} ${row.name}）。設備担当者に新しいラベルへの張り替えを依頼してください。`, { equipmentId: row.id });
  return c.json({ equipmentId: row.id, equipment_code: row.equipment_code, name: row.name, status: row.status });
});

// ===== 入力の読み取りと参照の確認 =====

interface Fields {
  factory_id?: string; equipment_code?: string; name?: string; location?: string | null; category?: string | null;
  maker?: string | null; model?: string | null; manager_user_id?: string | null; area_id?: string | null;
  frequency?: (typeof FREQUENCIES)[number]; template_id?: string | null; notes?: string | null;
}

async function readFields(_c: Context<AppEnv>, v: Validator, creating: boolean): Promise<Fields> {
  const f: Fields = {
    equipment_code: v.str('equipment_code', { required: creating, max: 30, label: '設備番号' }),
    name: v.str('name', { required: creating, max: 60, label: '設備名' }),
    location: v.nullableStr('location', { max: 100, label: '設置場所' }),
    category: v.nullableStr('category', { max: 40, label: '設備分類' }),
    maker: v.nullableStr('maker', { max: 60, label: 'メーカー' }),
    model: v.nullableStr('model', { max: 60, label: '型式' }),
    manager_user_id: v.nullableStr('manager_user_id', { max: 64, label: '管理担当者' }),
    area_id: v.nullableStr('area_id', { max: 64, label: 'エリア' }),
    frequency: v.oneOf('frequency', FREQUENCIES, { required: false, label: '点検頻度' }),
    template_id: v.nullableStr('template_id', { max: 64, label: '点検基準' }),
    notes: v.nullableStr('notes', { max: 1000, label: '備考' }),
  };
  if (creating) f.factory_id = v.str('factory_id', { required: true, max: 64, label: '工場' });
  return f;
}

/** 担当者・エリア・点検基準が同じ会社（エリアは同じ工場）のものか */
async function checkReferences(c: Context<AppEnv>, v: Validator, factoryId: string, f: Fields): Promise<void> {
  const db = c.env.DB;
  const companyId = c.get('auth').companyId;
  if (!await db.prepare("SELECT 1 FROM factories WHERE id = ? AND company_id = ? AND status = 'active'").bind(factoryId, companyId).first()) v.fail('factory_id', '工場が見つかりません。');
  if (f.manager_user_id && !await db.prepare("SELECT 1 FROM users WHERE id = ? AND company_id = ? AND status = 'active'").bind(f.manager_user_id, companyId).first()) v.fail('manager_user_id', '管理担当者が見つかりません。');
  if (f.area_id && !await db.prepare("SELECT 1 FROM areas WHERE id = ? AND factory_id = ? AND status = 'active'").bind(f.area_id, factoryId).first()) v.fail('area_id', 'この工場のエリアではありません。');
  if (f.template_id && !await db.prepare("SELECT 1 FROM inspection_templates WHERE id = ? AND company_id = ? AND status = 'active'").bind(f.template_id, companyId).first()) v.fail('template_id', '点検基準が見つかりません。');
}

function encodeCursor(code: string, id: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify([code, id]));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeCursor(cursor: string): [string, string] {
  try {
    const bin = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
    const v: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
    if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string')) return v as [string, string];
  } catch { /* 下で 400 */ }
  throw new HttpError(400, 'ページの指定が正しくありません。');
}
