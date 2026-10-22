import { Hono, type Context } from 'hono';
import { boardStatus, can, type Frequency } from '@tenq/shared';
import type { AppEnv } from '../types';
import { auditStatement } from '../lib/audit';
import { newId, nowIso } from '../lib/crypto';
import { authorize } from '../lib/guard';
import { HttpError, Validator, conflict, notFound, readJson } from '../lib/http';
import { todayFor } from '../lib/period';
import { scopeWhere } from '../lib/scope';
import { loadSettings } from '../lib/settings';
import { decodeCursor, encodeCursor } from '../lib/cursor';
import { inspectionFilter } from '../lib/filters';

/**
 * 日常点検（requirements F-5、architecture §9-2・§9-3）。
 *  - 同じ設備・同じ点検期間の有効な点検は1件（DB の部分一意索引で保証）
 *  - 完了は Idempotency-Key で冪等（通信の再送・連打で二重にならない）
 *  - 完了した結果は書き換えず、訂正は revision を増やして追加する
 */
export const inspectionRoutes = new Hono<AppEnv>();

interface EquipmentForInspection {
  id: string; company_id: number; factory_id: string; equipment_code: string; name: string; status: string; frequency: Frequency;
  manager_user_id: string | null; template_id: string | null; current_version_id: string | null; timezone: string; working_days: string;
}
interface InspectionRow {
  id: string; company_id: number; factory_id: string; equipment_id: string; template_version_id: string; period_key: string; inspection_date: string;
  status: 'in_progress' | 'completed' | 'voided'; inspector_user_id: string; started_at: string; completed_at: string | null;
  overall_result: 'ok' | 'ng' | null; comment: string | null; current_revision: number; completion_key: string | null; version: number;
}
interface ItemRow { id: string; sort_order: number; group_label: string | null; label: string; criteria: string | null; required: number; allow_na: number }
type Judgment = 'ok' | 'ng' | 'na';

async function loadEquipment(c: Context<AppEnv>, id: string): Promise<EquipmentForInspection> {
  const s = scopeWhere(c.get('auth'), 'e');
  const row = await c.env.DB.prepare(
    `SELECT e.id, e.company_id, e.factory_id, e.equipment_code, e.name, e.status, e.frequency, e.manager_user_id, e.template_id,
            t.current_version_id, f.timezone, f.working_days
     FROM equipment e JOIN factories f ON f.id = e.factory_id LEFT JOIN inspection_templates t ON t.id = e.template_id
     WHERE e.id = ? AND ${s.sql}`,
  ).bind(id, ...s.params).first<EquipmentForInspection>();
  if (!row) throw notFound();
  return row;
}

async function loadInspection(c: Context<AppEnv>, id: string): Promise<InspectionRow & { manager_user_id: string | null }> {
  const s = scopeWhere(c.get('auth'), 'i');
  const row = await c.env.DB.prepare(
    `SELECT i.*, e.manager_user_id FROM inspections i JOIN equipment e ON e.id = i.equipment_id WHERE i.id = ? AND ${s.sql}`,
  ).bind(id, ...s.params).first<InspectionRow & { manager_user_id: string | null }>();
  if (!row) throw notFound();
  return row;
}

const itemsOf = async (db: D1Database, versionId: string) =>
  (await db.prepare('SELECT id, sort_order, group_label, label, criteria, required, allow_na FROM inspection_items WHERE template_version_id = ? ORDER BY sort_order').bind(versionId).all<ItemRow>()).results;

const resultsOf = async (db: D1Database, inspectionId: string, revision: number) =>
  (await db.prepare('SELECT item_id, judgment, note, abnormality_id FROM inspection_results WHERE inspection_id = ? AND revision = ?').bind(inspectionId, revision)
    .all<{ item_id: string; judgment: Judgment; note: string | null; abnormality_id: string | null }>()).results;

async function activeInspection(db: D1Database, equipmentId: string, periodKey: string) {
  return db.prepare(
    `SELECT i.*, u.name AS inspector_name FROM inspections i JOIN users u ON u.id = i.inspector_user_id
     WHERE i.equipment_id = ? AND i.period_key = ? AND i.status <> 'voided'`,
  ).bind(equipmentId, periodKey).first<InspectionRow & { inspector_name: string }>();
}

/** 点検画面を開いたときの情報（今日の点検期間・点検表・進行中/完了した点検） */
inspectionRoutes.get('/equipment/:id/today', async (c) => {
  const auth = c.get('auth');
  const eq = await loadEquipment(c, c.req.param('id'));
  authorize(c, 'inspection.viewFactory', { factoryId: eq.factory_id });
  const today = todayFor(eq);
  const periodKey = today.keys[eq.frequency];
  const inspection = await activeInspection(c.env.DB, eq.id, periodKey);
  const versionId = inspection?.template_version_id ?? eq.current_version_id;
  return c.json({
    equipment: { id: eq.id, equipment_code: eq.equipment_code, name: eq.name, status: eq.status, frequency: eq.frequency, factory_id: eq.factory_id },
    date: today.date,
    periodKey,
    isDue: eq.frequency !== 'daily' || today.workingDay,
    inspection: inspection && {
      id: inspection.id, status: inspection.status, inspector_user_id: inspection.inspector_user_id, inspector_name: inspection.inspector_name,
      started_at: inspection.started_at, completed_at: inspection.completed_at, overall_result: inspection.overall_result, comment: inspection.comment,
      current_revision: inspection.current_revision, version: inspection.version, mine: inspection.inspector_user_id === auth.user.id,
    },
    items: versionId ? await itemsOf(c.env.DB, versionId) : [],
    results: inspection?.status === 'completed' ? await resultsOf(c.env.DB, inspection.id, inspection.current_revision) : [],
    canPerform: can(auth.actor, 'inspection.perform', { factoryId: eq.factory_id }),
  });
});

/** 点検の開始。すでに点検中なら自分のものは続きから、他人のものは確認のうえ引き継ぐ */
inspectionRoutes.post('/equipment/:id/inspections', async (c) => {
  const auth = c.get('auth');
  const eq = await loadEquipment(c, c.req.param('id'));
  authorize(c, 'inspection.perform', { factoryId: eq.factory_id });
  const body = await readJson(c.req.raw);
  const takeover = body.takeover === true;
  if (eq.status !== 'active') throw new HttpError(409, 'この設備は停止中または廃止のため、点検の対象外です。');
  if (!eq.current_version_id) throw new HttpError(409, 'この設備には点検基準が設定されていません。設備担当者または工場長に設定を依頼してください。');

  const db = c.env.DB;
  const today = todayFor(eq);
  const periodKey = today.keys[eq.frequency];

  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await activeInspection(db, eq.id, periodKey);
    if (existing) {
      if (existing.status === 'completed') {
        throw new HttpError(409, `この設備の今回の点検は、${existing.inspector_name} さんが完了しています。`, { code: 'completed', inspectionId: existing.id });
      }
      if (existing.inspector_user_id === auth.user.id) return c.json({ inspectionId: existing.id, resumed: true });
      if (!takeover) {
        throw new HttpError(409, `${existing.inspector_name} さんが点検中です。`, {
          code: 'in_progress_by_other', inspectionId: existing.id, inspectorName: existing.inspector_name, startedAt: existing.started_at,
        });
      }
      const now = nowIso();
      const [upd] = await db.batch([
        db.prepare("UPDATE inspections SET inspector_user_id = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'in_progress' AND version = ?")
          .bind(auth.user.id, now, existing.id, existing.version),
        auditStatement(c, { action: 'inspection.takeover', targetType: 'inspection', targetId: existing.id, factoryId: eq.factory_id, detail: { from: existing.inspector_name } },
          { sql: 'SELECT 1 FROM inspections WHERE id = ? AND inspector_user_id = ? AND version = ?', params: [existing.id, auth.user.id, existing.version + 1] }),
      ]);
      if (!upd?.meta.changes) throw conflict();
      return c.json({ inspectionId: existing.id, takenOver: true });
    }

    const id = newId();
    const now = nowIso();
    try {
      await db.batch([
        db.prepare(`INSERT INTO inspections (id, company_id, factory_id, equipment_id, template_version_id, period_key, inspection_date, status, inspector_user_id, started_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress', ?, ?, ?, ?)`)
          .bind(id, eq.company_id, eq.factory_id, eq.id, eq.current_version_id, periodKey, today.date, auth.user.id, now, now, now),
        auditStatement(c, { action: 'inspection.start', targetType: 'inspection', targetId: id, factoryId: eq.factory_id, detail: { equipment: eq.equipment_code, period: periodKey } }),
      ]);
      return c.json({ inspectionId: id }, 201);
    } catch (e) {
      // 同時に開始された（一意索引に当たった）。もう一度、既存の点検として扱う
      if (!String(e).includes('UNIQUE')) throw e;
    }
  }
  throw conflict('ほかの人が同時に点検を始めました。画面を読み込み直してください。');
});

/** 点検の完了（冪等）。必須項目がそろっていなければ 422 */
inspectionRoutes.post('/inspections/:id/complete', async (c) => {
  const auth = c.get('auth');
  const key = c.req.header('Idempotency-Key') ?? '';
  if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) throw new HttpError(400, 'Idempotency-Key を指定してください。');
  const ins = await loadInspection(c, c.req.param('id'));
  authorize(c, 'inspection.perform', { factoryId: ins.factory_id });

  // 同じキーの再送は、前回の結果をそのまま返す
  if (ins.completion_key === key) return c.json({ inspectionId: ins.id, overall_result: ins.overall_result, repeated: true });
  if (ins.status === 'completed') throw new HttpError(409, 'この点検はすでに完了しています。', { code: 'completed' });
  if (ins.status !== 'in_progress') throw new HttpError(409, 'この点検は取り消されています。');
  if (ins.inspector_user_id !== auth.user.id) throw new HttpError(409, 'この点検はほかの人に引き継がれました。', { code: 'taken_over' });

  const body = await readJson(c.req.raw);
  const v = new Validator(body);
  const comment = v.str('comment', { max: 1000, label: 'コメント' }) ?? null;
  const items = await itemsOf(c.env.DB, ins.template_version_id);
  const answers = readAnswers(v, body.results, items);
  for (const it of items) if (it.required && !answers.has(it.id)) v.fail(`item.${it.id}`, `「${it.label}」を選んでください。`);
  v.done();

  const overall = [...answers.values()].some((a) => a.judgment === 'ng') ? 'ng' : 'ok';
  const now = nowIso();
  const rows = [...answers.entries()].map(([item_id, a]) => ({ id: newId(), item_id, judgment: a.judgment, note: a.note }));
  const db = c.env.DB;
  const guard = { sql: 'SELECT 1 FROM inspections WHERE id = ? AND completion_key = ?', params: [ins.id, key] };
  let upd: D1Result | undefined;
  try {
    [upd] = await db.batch([
      db.prepare(`UPDATE inspections SET status = 'completed', completed_at = ?, overall_result = ?, comment = ?, completion_key = ?, updated_at = ?, version = version + 1
                  WHERE id = ? AND status = 'in_progress' AND inspector_user_id = ?`)
        .bind(now, overall, comment, key, now, ins.id, auth.user.id),
      insertResults(db, ins.id, 1, rows, now, auth.user.id, guard),
      auditStatement(c, { action: 'inspection.complete', targetType: 'inspection', targetId: ins.id, factoryId: ins.factory_id,
        detail: { overall, answered: rows.length, ng: rows.filter((r) => r.judgment === 'ng').length } }, guard),
    ]);
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new HttpError(409, '同じ完了操作が別の点検に使われています。画面を読み込み直してください。');
    throw e;
  }
  if (!upd?.meta.changes) throw conflict('この点検はほかの操作で変更されました。画面を読み込み直してください。');
  return c.json({ inspectionId: ins.id, overall_result: overall, ngItems: rows.filter((r) => r.judgment === 'ng').map((r) => r.item_id) });
});

/** 取消（誤って開始した・別の設備だった等）。記録は消さず voided として残す */
inspectionRoutes.post('/inspections/:id/void', async (c) => {
  const ins = await loadInspection(c, c.req.param('id'));
  authorize(c, 'inspection.void', { factoryId: ins.factory_id, inspectorId: ins.inspector_user_id, inspectionStatus: ins.status });
  if (ins.status === 'voided') return c.json({ ok: true });
  const v = new Validator(await readJson(c.req.raw));
  const reason = v.str('reason', { required: true, max: 200, label: '取消の理由' });
  v.done();
  const auth = c.get('auth');
  const now = nowIso();
  const [upd] = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE inspections SET status = 'voided', voided_reason = ?, voided_by = ?, voided_at = ?, updated_at = ?, version = version + 1
                      WHERE id = ? AND status = ? AND version = ?`).bind(reason, auth.user.id, now, now, ins.id, ins.status, ins.version),
    auditStatement(c, { action: 'inspection.void', targetType: 'inspection', targetId: ins.id, factoryId: ins.factory_id, detail: { from: ins.status, reason } },
      { sql: "SELECT 1 FROM inspections WHERE id = ? AND status = 'voided' AND version = ?", params: [ins.id, ins.version + 1] }),
  ]);
  if (!upd?.meta.changes) throw conflict();
  return c.json({ ok: true });
});

/** 点検記録の詳細（最新の版の結果・訂正履歴） */
inspectionRoutes.get('/inspections/:id', async (c) => {
  const auth = c.get('auth');
  const ins = await loadInspection(c, c.req.param('id'));
  const mine = ins.inspector_user_id === auth.user.id;
  if (!mine) authorize(c, 'inspection.viewFactory', { factoryId: ins.factory_id });
  const db = c.env.DB;
  const [meta, items, results, corrections] = await Promise.all([
    db.prepare(
      `SELECT e.equipment_code, e.name AS equipment_name, u.name AS inspector_name, v.version_no, t.name AS template_name, vb.name AS voided_by_name
       FROM inspections i JOIN equipment e ON e.id = i.equipment_id JOIN users u ON u.id = i.inspector_user_id
       JOIN inspection_template_versions v ON v.id = i.template_version_id JOIN inspection_templates t ON t.id = v.template_id
       LEFT JOIN users vb ON vb.id = i.voided_by WHERE i.id = ?`,
    ).bind(ins.id).first(),
    itemsOf(db, ins.template_version_id),
    resultsOf(db, ins.id, ins.current_revision),
    db.prepare(`SELECT c.from_revision, c.to_revision, c.reason, c.diff_json, c.corrected_at, u.name AS corrected_by_name
                FROM inspection_corrections c JOIN users u ON u.id = c.corrected_by WHERE c.inspection_id = ? ORDER BY c.to_revision`).bind(ins.id).all(),
  ]);
  const target = { factoryId: ins.factory_id, equipmentManagerId: ins.manager_user_id, inspectorId: ins.inspector_user_id, inspectionStatus: ins.status };
  const { completion_key: _k, manager_user_id: _m, ...inspection } = ins;
  return c.json({
    inspection: { ...inspection, ...meta },
    items, results,
    corrections: corrections.results.map((r) => ({ ...r, diff: JSON.parse(String(r.diff_json)), diff_json: undefined })),
    permissions: { correct: ins.status === 'completed' && can(auth.actor, 'inspection.correct', target), void: ins.status !== 'voided' && can(auth.actor, 'inspection.void', target) },
  });
});

/** 訂正。元の記録を残し、新しい版（revision）として追加する。理由は必須 */
inspectionRoutes.post('/inspections/:id/corrections', async (c) => {
  const auth = c.get('auth');
  const ins = await loadInspection(c, c.req.param('id'));
  authorize(c, 'inspection.correct', { factoryId: ins.factory_id, equipmentManagerId: ins.manager_user_id });
  if (ins.status !== 'completed') throw new HttpError(409, '完了した点検だけ訂正できます。');
  const body = await readJson(c.req.raw);
  const v = new Validator(body);
  const version = v.version();
  const reason = v.str('reason', { required: true, max: 300, label: '訂正の理由' });
  const db = c.env.DB;
  const items = await itemsOf(db, ins.template_version_id);
  const changes = readAnswers(v, body.changes, items);
  if (!changes.size) v.fail('changes', '訂正する項目を選んでください。');
  v.done();
  if (version !== ins.version) throw conflict();

  const current = new Map((await resultsOf(db, ins.id, ins.current_revision)).map((r) => [r.item_id, r]));
  const diff: Record<string, { label: string; before: [string | null, string | null]; after: [string, string | null] }> = {};
  for (const [itemId, a] of changes) {
    const before = current.get(itemId);
    if (before?.judgment === a.judgment && (before?.note ?? null) === a.note) continue;
    diff[itemId] = { label: items.find((i) => i.id === itemId)?.label ?? itemId, before: [before?.judgment ?? null, before?.note ?? null], after: [a.judgment, a.note] };
  }
  if (!Object.keys(diff).length) { v.fail('changes', '変更がありません。'); v.done(); }

  const merged = new Map(current);
  for (const [itemId, a] of changes) merged.set(itemId, { item_id: itemId, judgment: a.judgment, note: a.note, abnormality_id: current.get(itemId)?.abnormality_id ?? null });
  const missing = items.filter((it) => it.required && !merged.has(it.id));
  if (missing.length) { v.fail('changes', `必須項目「${missing[0]?.label}」が未入力になります。`); v.done(); }

  const next = ins.current_revision + 1;
  const overall = [...merged.values()].some((r) => r.judgment === 'ng') ? 'ng' : 'ok';
  const now = nowIso();
  const rows = [...merged.values()].map((r) => ({ id: newId(), item_id: r.item_id, judgment: r.judgment, note: r.note, abnormality_id: r.abnormality_id }));
  const guard = { sql: 'SELECT 1 FROM inspections WHERE id = ? AND current_revision = ? AND version = ?', params: [ins.id, next, version + 1] };
  const [upd] = await db.batch([
    db.prepare('UPDATE inspections SET current_revision = ?, overall_result = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND current_revision = ?')
      .bind(next, overall, now, ins.id, version, ins.current_revision),
    insertResults(db, ins.id, next, rows, now, auth.user.id, guard),
    db.prepare(`INSERT INTO inspection_corrections (id, inspection_id, from_revision, to_revision, reason, diff_json, corrected_by, corrected_at)
                SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (${guard.sql})`)
      .bind(newId(), ins.id, ins.current_revision, next, reason, JSON.stringify(diff), auth.user.id, now, ...guard.params),
    auditStatement(c, { action: 'inspection.correct', targetType: 'inspection', targetId: ins.id, factoryId: ins.factory_id, detail: { reason, revision: next, diff } }, guard),
  ]);
  if (!upd?.meta.changes) throw conflict();
  return c.json({ revision: next, overall_result: overall, version: version + 1 });
});

/** 点検の履歴（設備ごと・新しい順。本格的な検索は第6段階） */
inspectionRoutes.get('/inspections', async (c) => {
  authorize(c, 'inspection.viewOwn');
  const q = c.req.query();
  const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 100);
  const { where, params } = inspectionFilter(c);
  if (q.cursor) {
    const [at, id] = decodeCursor(q.cursor, 2);
    where.push('(i.started_at < ? OR (i.started_at = ? AND i.id < ?))');
    params.push(at, at, id);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT i.id, i.equipment_id, e.equipment_code, e.name AS equipment_name, e.category, f.name AS factory_name, i.inspection_date, i.period_key,
            i.status, i.overall_result, i.started_at, i.completed_at, i.current_revision, u.name AS inspector_name,
            (SELECT COUNT(*) FROM abnormalities a WHERE a.inspection_id = i.id) AS abnormality_count
     FROM inspections i JOIN equipment e ON e.id = i.equipment_id JOIN factories f ON f.id = i.factory_id JOIN users u ON u.id = i.inspector_user_id
     WHERE ${where.join(' AND ')} ORDER BY i.started_at DESC, i.id DESC LIMIT ?`,
  ).bind(...params, limit + 1).all<{ id: string; started_at: string }>();
  const items = results.slice(0, limit);
  const last = items[items.length - 1];
  return c.json({ items, nextCursor: results.length > limit && last ? encodeCursor([last.started_at, last.id]) : null });
});

/**
 * 今日の点検状況（工場ごと）。スマホのホームの未点検一覧と、PC のエリア別カード一覧（第6段階）で使う。
 * 状態の判定は shared の boardStatus だけで行う。
 */
inspectionRoutes.get('/board', async (c) => {
  const auth = c.get('auth');
  const factoryId = c.req.query('factory');
  if (!factoryId) throw new HttpError(400, '工場を指定してください。');
  authorize(c, 'board.view', { factoryId });
  const db = c.env.DB;
  const factory = await db.prepare("SELECT id, name, timezone, working_days FROM factories WHERE id = ? AND company_id = ?").bind(factoryId, auth.companyId)
    .first<{ id: string; name: string; timezone: string; working_days: string }>();
  if (!factory) throw notFound();
  const settings = await loadSettings(db, auth.companyId);
  const today = todayFor(factory);
  const keys = Object.values(today.keys);

  const [areas, equipment, inspections, abnormalities] = await db.batch([
    db.prepare("SELECT id, name, grid_row, grid_col, col_span, sort_order FROM areas WHERE factory_id = ? AND status = 'active' ORDER BY sort_order, name").bind(factoryId),
    db.prepare(`SELECT e.id, e.equipment_code, e.name, e.status, e.frequency, e.area_id, e.board_order, e.manager_user_id, m.name AS manager_name
                FROM equipment e LEFT JOIN users m ON m.id = e.manager_user_id
                WHERE e.factory_id = ? AND e.company_id = ? AND e.status <> 'retired' ORDER BY e.board_order, e.equipment_code`).bind(factoryId, auth.companyId),
    db.prepare(`SELECT i.id, i.equipment_id, i.period_key, i.status, i.overall_result, i.started_at, i.completed_at, u.name AS inspector_name
                FROM inspections i JOIN users u ON u.id = i.inspector_user_id
                WHERE i.factory_id = ? AND i.status <> 'voided' AND i.period_key IN (?, ?, ?)`).bind(factoryId, ...keys),
    db.prepare(`SELECT equipment_id, COUNT(*) AS n FROM abnormalities WHERE factory_id = ? AND status <> 'closed' GROUP BY equipment_id`).bind(factoryId),
  ]);

  type Eq = { id: string; equipment_code: string; name: string; status: 'active' | 'stopped' | 'retired'; frequency: Frequency; area_id: string | null; board_order: number; manager_name: string | null };
  type Ins = { id: string; equipment_id: string; period_key: string; status: 'in_progress' | 'completed'; overall_result: 'ok' | 'ng' | null; started_at: string; completed_at: string | null; inspector_name: string };
  const insMap = new Map<string, Ins>();
  for (const i of inspections?.results as Ins[]) insMap.set(`${i.equipment_id}|${i.period_key}`, i);
  const abnMap = new Map((abnormalities?.results as { equipment_id: string; n: number }[]).map((a) => [a.equipment_id, a.n]));

  const items = (equipment?.results as Eq[]).map((e) => {
    const ins = insMap.get(`${e.id}|${today.keys[e.frequency]}`) ?? null;
    const status = boardStatus({
      equipmentStatus: e.status,
      inspection: ins && { status: ins.status, overallResult: ins.overall_result },
      isDue: e.frequency !== 'daily' || today.workingDay,
      isPastDeadline: e.frequency === 'daily' && today.pastDeadline(settings.late_threshold),
    });
    return { ...e, board_status: status, inspection: ins, open_abnormalities: abnMap.get(e.id) ?? 0 };
  });
  const counts = items.reduce<Record<string, number>>((acc, it) => ({ ...acc, [it.board_status]: (acc[it.board_status] ?? 0) + 1 }), {});
  return c.json({ factory: { id: factory.id, name: factory.name }, date: today.date, workingDay: today.workingDay, lateThreshold: settings.late_threshold, areas: areas?.results ?? [], items, counts });
});

// ===== 共通 =====

/** 判定の入力を読む。点検表にない項目・対象外を許可していない項目の「対象外」は 422 */
function readAnswers(v: Validator, raw: unknown, items: ItemRow[]): Map<string, { judgment: Judgment; note: string | null }> {
  const out = new Map<string, { judgment: Judgment; note: string | null }>();
  if (!Array.isArray(raw) || raw.length > 200) { v.fail('results', '点検結果の形式が正しくありません。'); return out; }
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const r of raw) {
    const x = (r && typeof r === 'object' ? r : {}) as { item_id?: unknown; judgment?: unknown; note?: unknown };
    const item = typeof x.item_id === 'string' ? byId.get(x.item_id) : undefined;
    if (!item) { v.fail('results', 'この点検表にない項目が含まれています。'); continue; }
    if (x.judgment !== 'ok' && x.judgment !== 'ng' && x.judgment !== 'na') { v.fail(`item.${item.id}`, `「${item.label}」の判定が正しくありません。`); continue; }
    if (x.judgment === 'na' && !item.allow_na) { v.fail(`item.${item.id}`, `「${item.label}」は対象外にできません。`); continue; }
    if (x.note !== undefined && x.note !== null && (typeof x.note !== 'string' || x.note.length > 500)) { v.fail(`item.${item.id}`, `「${item.label}」のコメントは500文字以内にしてください。`); continue; }
    if (out.has(item.id)) { v.fail('results', '同じ項目が2回含まれています。'); continue; }
    out.set(item.id, { judgment: x.judgment, note: typeof x.note === 'string' && x.note.trim() ? x.note.trim() : null });
  }
  return out;
}

/** 結果をまとめて1文で入れる（json_each）。guard が成り立つときだけ入る */
function insertResults(db: D1Database, inspectionId: string, revision: number,
  rows: { id: string; item_id: string; judgment: Judgment; note: string | null; abnormality_id?: string | null }[],
  now: string, userId: string, guard: { sql: string; params: unknown[] }): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO inspection_results (id, inspection_id, revision, item_id, judgment, note, abnormality_id, created_at, created_by)
     SELECT json_extract(j.value, '$.id'), ?, ?, json_extract(j.value, '$.item_id'), json_extract(j.value, '$.judgment'),
            json_extract(j.value, '$.note'), json_extract(j.value, '$.abnormality_id'), ?, ?
     FROM json_each(?) j WHERE EXISTS (${guard.sql})`,
  ).bind(inspectionId, revision, now, userId, JSON.stringify(rows), ...guard.params);
}

