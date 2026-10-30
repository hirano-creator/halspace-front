import { Hono, type Context } from 'hono';
import {
  ABNORMALITY_ACTIONS, ABNORMALITY_STATUSES, ABNORMALITY_TRANSITIONS, OPEN_UNHANDLED, OPEN_UNRESOLVED, SEVERITIES,
  can, isOverdue, localDate, nextStatus, type AbnormalityAction, type AbnormalityStatus, type Target,
} from '@tenq/shared';
import type { AppEnv } from '../types';
import { auditStatement } from '../lib/audit';
import { newId, nowIso } from '../lib/crypto';
import { authorize } from '../lib/guard';
import { HttpError, Validator, conflict, forbidden, notFound, readJson } from '../lib/http';
import { scopeWhere } from '../lib/scope';

/**
 * 異常報告と是正処置（requirements F-6）。
 * 状態の遷移は shared の ABNORMALITY_TRANSITIONS だけを正とし、遷移ごとに権限表を確認する。
 * 遷移はすべて abnormality_events に残る（発生から完了まで追跡できる）。
 */
export const abnormalityRoutes = new Hono<AppEnv>();

const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface AbnormalityRow {
  id: string; company_id: number; factory_id: string; equipment_id: string; inspection_id: string | null; inspection_item_id: string | null;
  report_no: string; title: string; description: string | null; found_at: string; reported_by: string; severity: string;
  emergency_action: string | null; equipment_stopped: number; status: AbnormalityStatus; assignee_user_id: string | null;
  due_date: string | null; corrected_date: string | null; verified_by: string | null; verified_at: string | null;
  approved_by: string | null; approved_at: string | null; created_at: string; updated_at: string; version: number;
  manager_user_id: string | null; timezone: string;
}

async function loadScoped(c: Context<AppEnv>, id: string): Promise<AbnormalityRow> {
  const s = scopeWhere(c.get('auth'), 'a');
  const row = await c.env.DB.prepare(
    `SELECT a.*, e.manager_user_id, f.timezone FROM abnormalities a
     JOIN equipment e ON e.id = a.equipment_id JOIN factories f ON f.id = a.factory_id
     WHERE a.id = ? AND ${s.sql}`,
  ).bind(id, ...s.params).first<AbnormalityRow>();
  if (!row) throw notFound();
  return row;
}

async function fixerIds(db: D1Database, abnormalityId: string): Promise<string[]> {
  const { results } = await db.prepare('SELECT DISTINCT COALESCE(performed_by, created_by) AS id FROM corrective_actions WHERE abnormality_id = ?')
    .bind(abnormalityId).all<{ id: string }>();
  return results.map((r) => r.id);
}

function targetOf(a: AbnormalityRow, fixers: string[]): Target {
  return { factoryId: a.factory_id, equipmentManagerId: a.manager_user_id, assigneeId: a.assignee_user_id, fixerIds: fixers };
}

/** 異常の報告（全員）。危険度「高」で設備を止めたと報告し、停止の権限があれば設備も停止中にする */
abnormalityRoutes.post('/abnormalities', async (c) => {
  const auth = c.get('auth');
  const body = await readJson(c.req.raw);
  const v = new Validator(body);
  const equipmentId = v.str('equipment_id', { required: true, max: 64, label: '設備' });
  const inspectionId = v.str('inspection_id', { max: 64, label: '点検' }) ?? null;
  const itemId = v.str('inspection_item_id', { max: 64, label: '点検項目' }) ?? null;
  const title = v.str('title', { required: true, max: 100, label: '異常の内容' });
  const description = v.str('description', { max: 2000, label: '詳しい内容' }) ?? null;
  const severity = v.oneOf('severity', SEVERITIES, { required: true, label: '危険度' });
  const emergency = v.str('emergency_action', { max: 1000, label: '応急処置' }) ?? null;
  const stopped = body.equipment_stopped === true;
  v.done();

  const db = c.env.DB;
  const s = scopeWhere(auth, 'e');
  const eq = await db.prepare(
    `SELECT e.id, e.factory_id, e.equipment_code, e.status, e.manager_user_id, f.code AS factory_code, f.timezone
     FROM equipment e JOIN factories f ON f.id = e.factory_id WHERE e.id = ? AND ${s.sql}`,
  ).bind(equipmentId, ...s.params).first<{ id: string; factory_id: string; equipment_code: string; status: string; manager_user_id: string | null; factory_code: string; timezone: string }>();
  if (!eq) throw notFound();
  authorize(c, 'abnormality.report', { factoryId: eq.factory_id });
  if (inspectionId) {
    const ok = await db.prepare(`SELECT 1 FROM inspections i ${itemId ? 'JOIN inspection_items it ON it.template_version_id = i.template_version_id AND it.id = ?' : ''}
                                 WHERE i.id = ? AND i.equipment_id = ?`).bind(...(itemId ? [itemId] : []), inspectionId, eq.id).first();
    if (!ok) { v.fail('inspection_id', '点検の記録と設備が一致しません。'); v.done(); }
  }

  // 設備を止めたと報告された場合、停止の権限がある人なら設備の状態も「停止中」にする
  const canStop = can(auth.actor, 'equipment.stop', { factoryId: eq.factory_id, equipmentManagerId: eq.manager_user_id });
  const year = localDate(new Date(), eq.timezone).slice(0, 4);
  const now = nowIso();
  for (let attempt = 0; attempt < 3; attempt++) {
    const prefix = `${eq.factory_code}-${year}-`;
    const last = await db.prepare('SELECT report_no FROM abnormalities WHERE company_id = ? AND report_no LIKE ? ORDER BY report_no DESC LIMIT 1')
      .bind(auth.companyId, `${prefix}%`).first<{ report_no: string }>();
    const reportNo = `${prefix}${String((Number(last?.report_no.slice(prefix.length)) || 0) + 1).padStart(4, '0')}`;
    const id = newId();
    const statements: D1PreparedStatement[] = [
      db.prepare(`INSERT INTO abnormalities (id, company_id, factory_id, equipment_id, inspection_id, inspection_item_id, report_no, title, description, found_at,
          reported_by, severity, emergency_action, equipment_stopped, status, created_at, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reported', ?, ?, ?)`)
        .bind(id, auth.companyId, eq.factory_id, eq.id, inspectionId, itemId, reportNo, title, description, now, auth.user.id, severity, emergency, stopped ? 1 : 0, now, now, auth.user.id),
      db.prepare("INSERT INTO abnormality_events (id, abnormality_id, from_status, to_status, comment, actor_user_id, created_at) VALUES (?, ?, NULL, 'reported', ?, ?, ?)")
        .bind(newId(), id, stopped ? '設備の使用を止めた' : null, auth.user.id, now),
      auditStatement(c, { action: 'abnormality.report', targetType: 'abnormality', targetId: id, factoryId: eq.factory_id, detail: { report_no: reportNo, severity, equipment: eq.equipment_code, stopped } }),
    ];
    if (stopped && canStop && eq.status === 'active') {
      statements.push(
        db.prepare("UPDATE equipment SET status = 'stopped', status_reason = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ? AND status = 'active'")
          .bind(`異常 ${reportNo}: ${title}`, now, auth.user.id, eq.id),
        auditStatement(c, { action: 'equipment.stop', targetType: 'equipment', targetId: eq.id, factoryId: eq.factory_id, detail: { from: 'active', to: 'stopped', reason: `異常 ${reportNo}` } }),
      );
    }
    try {
      await db.batch(statements);
      return c.json({ id, report_no: reportNo, equipmentStatusChanged: stopped && canStop && eq.status === 'active' }, 201);
    } catch (e) {
      if (!String(e).includes('UNIQUE')) throw e; // 同時に報告されて番号が重なった。採番し直す
    }
  }
  throw conflict('報告番号を決められませんでした。もう一度お試しください。');
});

/** 一覧。view=unhandled（未対応）/ open（完了していないもの）/ overdue（期限超過）/ all */
abnormalityRoutes.get('/abnormalities', async (c) => {
  authorize(c, 'abnormality.report');
  const auth = c.get('auth');
  const q = c.req.query();
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
  const s = scopeWhere(auth, 'a');
  const where = [s.sql];
  const params: unknown[] = [...s.params];
  const inList = (xs: readonly string[]) => `(${xs.map(() => '?').join(',')})`;
  const view = q.view ?? 'open';
  if (view === 'unhandled') { where.push(`a.status IN ${inList(OPEN_UNHANDLED)}`); params.push(...OPEN_UNHANDLED); }
  else if (view === 'open') { where.push("a.status <> 'closed'"); }
  else if (view === 'overdue') {
    // 期限は工場ごとの日付だが、日本国内の工場が前提なので今日（Asia/Tokyo）で比べ、行ごとの判定は下で shared の isOverdue で揃える
    where.push(`a.status IN ${inList(OPEN_UNRESOLVED)} AND a.due_date IS NOT NULL AND a.due_date < ?`);
    params.push(...OPEN_UNRESOLVED, localDate(new Date(), 'Asia/Tokyo'));
  } else if ((ABNORMALITY_STATUSES as readonly string[]).includes(view)) { where.push('a.status = ?'); params.push(view); }
  if (q.factory) { where.push('a.factory_id = ?'); params.push(q.factory); }
  if (q.equipment) { where.push('a.equipment_id = ?'); params.push(q.equipment); }
  if (q.assignee === 'me') { where.push('a.assignee_user_id = ?'); params.push(auth.user.id); }
  if (q.before) { where.push('a.found_at < ?'); params.push(q.before); }
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.report_no, a.title, a.severity, a.status, a.found_at, a.due_date, a.equipment_stopped, a.factory_id, f.name AS factory_name, f.timezone,
            e.id AS equipment_id, e.equipment_code, e.name AS equipment_name, r.name AS reporter_name, s.name AS assignee_name,
            (SELECT COUNT(*) FROM attachments t WHERE t.owner_type = 'abnormality' AND t.owner_id = a.id AND t.deleted_at IS NULL) AS photo_count
     FROM abnormalities a JOIN equipment e ON e.id = a.equipment_id JOIN factories f ON f.id = a.factory_id
     JOIN users r ON r.id = a.reported_by LEFT JOIN users s ON s.id = a.assignee_user_id
     WHERE ${where.join(' AND ')} ORDER BY a.found_at DESC LIMIT ?`,
  ).bind(...params, limit + 1).all<{ status: AbnormalityStatus; due_date: string | null; timezone: string; found_at: string }>();
  const items = results.slice(0, limit).map(({ timezone, ...r }) => ({ ...r, overdue: isOverdue(r.status, r.due_date, localDate(new Date(), timezone)) }));
  return c.json({ items, nextBefore: results.length > limit ? items[items.length - 1]?.found_at ?? null : null });
});

/** 件数（ホーム・メニュー用） */
abnormalityRoutes.get('/abnormalities/summary', async (c) => {
  authorize(c, 'abnormality.report');
  const auth = c.get('auth');
  const s = scopeWhere(auth, 'a');
  const today = localDate(new Date(), 'Asia/Tokyo');
  const row = await c.env.DB.prepare(
    `SELECT SUM(a.status IN ('reported','assigned')) AS unhandled,
            SUM(a.status <> 'closed') AS open,
            SUM(a.status IN ('reported','assigned','in_progress') AND a.due_date IS NOT NULL AND a.due_date < ?) AS overdue,
            SUM(a.assignee_user_id = ? AND a.status IN ('assigned','in_progress')) AS mine,
            SUM(a.status = 'corrected') AS to_verify,
            SUM(a.status = 'verified') AS to_approve
     FROM abnormalities a WHERE ${s.sql}`,
  ).bind(today, auth.user.id, ...s.params).first<Record<string, number | null>>();
  return c.json(Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [k, v ?? 0])));
});

abnormalityRoutes.get('/abnormalities/:id', async (c) => {
  const auth = c.get('auth');
  const a = await loadScoped(c, c.req.param('id'));
  authorize(c, 'abnormality.report', { factoryId: a.factory_id });
  const db = c.env.DB;
  const [meta, events, actions, photos, fixers] = await Promise.all([
    db.prepare(
      `SELECT e.equipment_code, e.name AS equipment_name, e.status AS equipment_status, f.name AS factory_name, r.name AS reporter_name,
              s.name AS assignee_name, vb.name AS verified_by_name, ab.name AS approved_by_name, it.label AS item_label, i.inspection_date
       FROM abnormalities a JOIN equipment e ON e.id = a.equipment_id JOIN factories f ON f.id = a.factory_id JOIN users r ON r.id = a.reported_by
       LEFT JOIN users s ON s.id = a.assignee_user_id LEFT JOIN users vb ON vb.id = a.verified_by LEFT JOIN users ab ON ab.id = a.approved_by
       LEFT JOIN inspection_items it ON it.id = a.inspection_item_id LEFT JOIN inspections i ON i.id = a.inspection_id
       WHERE a.id = ?`,
    ).bind(a.id).first(),
    db.prepare('SELECT ev.from_status, ev.to_status, ev.comment, ev.created_at, u.name AS actor_name FROM abnormality_events ev JOIN users u ON u.id = ev.actor_user_id WHERE ev.abnormality_id = ? ORDER BY ev.created_at, ev.rowid').bind(a.id).all(),
    db.prepare(`SELECT ca.id, ca.kind, ca.cause, ca.description, ca.performed_at, ca.created_at, COALESCE(p.name, cb.name) AS performed_by_name
                FROM corrective_actions ca LEFT JOIN users p ON p.id = ca.performed_by JOIN users cb ON cb.id = ca.created_by
                WHERE ca.abnormality_id = ? ORDER BY ca.created_at`).bind(a.id).all(),
    db.prepare(`SELECT t.id, t.owner_type, t.owner_id, t.content_type, t.size_bytes, t.original_name, t.uploaded_at, u.name AS uploaded_by_name, t.uploaded_by
                FROM attachments t JOIN users u ON u.id = t.uploaded_by
                WHERE t.deleted_at IS NULL AND ((t.owner_type = 'abnormality' AND t.owner_id = ?) OR (t.owner_type = 'corrective_action' AND t.owner_id IN (SELECT id FROM corrective_actions WHERE abnormality_id = ?)))
                ORDER BY t.uploaded_at`).bind(a.id, a.id).all(),
    fixerIds(db, a.id),
  ]);
  const target = targetOf(a, fixers);
  const allowed = Object.fromEntries(ABNORMALITY_ACTIONS.map((act) => [act, nextStatus(act, a.status) !== null && can(auth.actor, ABNORMALITY_TRANSITIONS[act].permission, target)]));
  const { manager_user_id: _m, timezone, ...abnormality } = a;
  return c.json({
    abnormality: { ...abnormality, ...meta, overdue: isOverdue(a.status, a.due_date, localDate(new Date(), timezone)) },
    events: events.results, actions: actions.results, photos: photos.results,
    permissions: { ...allowed, addPhoto: a.status !== 'closed' },
  });
});

/** 状態の遷移。直した（ふだんはこれだけ）、担当・期限、着手、是正の記録、再確認、差し戻し、承認 */
abnormalityRoutes.post('/abnormalities/:id/transition', async (c) => {
  const auth = c.get('auth');
  const a = await loadScoped(c, c.req.param('id'));
  const body = await readJson(c.req.raw);
  const v = new Validator(body);
  const version = v.version();
  const action = v.oneOf('action', ABNORMALITY_ACTIONS, { required: true, label: '操作' }) as AbnormalityAction;
  v.done();

  const db = c.env.DB;
  const fixers = await fixerIds(db, a.id);
  const t = ABNORMALITY_TRANSITIONS[action];
  if (!can(auth.actor, t.permission, targetOf(a, fixers))) {
    throw forbidden(action === 'verify' || action === 'reject'
      ? '再確認は、是正を記録した人とは別の人が行います（自分で直したものは自分で確認しない）。'
      : 'この操作を行う権限がありません。');
  }
  const to = nextStatus(action, a.status);
  if (!to) throw new HttpError(409, `「${t.label}」は今の状態ではできません。画面を読み込み直してください。`);
  if (version !== a.version) throw conflict();

  const now = nowIso();
  const sets: string[] = ['status = ?'];
  const vals: unknown[] = [to];
  const extra: D1PreparedStatement[] = [];
  let comment: string | null;
  let correctiveId: string | null = null;
  const detail: Record<string, unknown> = { action, from: a.status, to };

  if (action === 'assign') {
    const assignee = v.str('assignee_user_id', { required: true, max: 64, label: '対応担当者' });
    const due = v.str('due_date', { required: true, max: 10, label: '対応期限' });
    if (due && !DATE.test(due)) v.fail('due_date', '対応期限の形式が正しくありません。');
    v.done();
    const person = await db.prepare(
      `SELECT u.name FROM users u WHERE u.id = ? AND u.company_id = ? AND u.status = 'active' AND u.role IN ('equipment_staff','factory_manager','system_admin')
         AND (u.role = 'system_admin' OR EXISTS (SELECT 1 FROM user_factories uf WHERE uf.user_id = u.id AND uf.factory_id = ?))`,
    ).bind(assignee, auth.companyId, a.factory_id).first<{ name: string }>();
    if (!person) { v.fail('assignee_user_id', 'この工場の設備担当者・工場長から選んでください。'); v.done(); }
    sets.push('assignee_user_id = ?', 'due_date = ?'); vals.push(assignee, due);
    comment = `担当: ${person!.name} ／ 期限: ${due}`;
    Object.assign(detail, { assignee: person!.name, due });
  } else if (action === 'correct') {
    const description = v.str('description', { required: true, max: 2000, label: '修理・是正の内容' });
    const cause = v.str('cause', { max: 1000, label: '原因' }) ?? null;
    const kind = v.oneOf('kind', ['temporary', 'permanent', 'other'] as const, { label: '処置の種類' }) ?? 'permanent';
    const done = v.str('corrected_date', { required: true, max: 10, label: '対応完了日' });
    if (done && !DATE.test(done)) v.fail('corrected_date', '対応完了日の形式が正しくありません。');
    v.done();
    sets.push('corrected_date = ?'); vals.push(done);
    extra.push(db.prepare(`INSERT INTO corrective_actions (id, abnormality_id, kind, cause, description, performed_by, performed_at, created_at, created_by, updated_at)
                           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM abnormalities WHERE id = ? AND version = ?)`)
      .bind(newId(), a.id, kind, cause, description, auth.user.id, done, now, auth.user.id, now, a.id, version + 1));
    comment = description!.slice(0, 200);
    Object.assign(detail, { kind, cause, description, corrected_date: done });
  } else if (action === 'verify') {
    comment = v.str('comment', { max: 500, label: 'コメント' }) ?? null;
    v.done();
    sets.push('verified_by = ?', 'verified_at = ?'); vals.push(auth.user.id, now);
  } else if (action === 'reject') {
    comment = v.str('comment', { required: true, max: 500, label: '差し戻しの理由' }) ?? null;
    v.done();
  } else if (action === 'approve') {
    comment = v.str('comment', { max: 500, label: 'コメント' }) ?? null;
    const resume = body.resume_equipment === true;
    v.done();
    sets.push('approved_by = ?', 'approved_at = ?'); vals.push(auth.user.id, now);
    if (resume) extra.push(...await resumeEquipment(c, a, version, now, detail));
  } else if (action === 'resolve') {
    // 「直した」: 何をして直したかを是正処置として残し、そのまま完了にする（別の人の確認はしない。requirements §10 Q-5）
    const description = v.str('description', { required: true, max: 500, label: '何をして直したか' });
    const resume = body.resume_equipment === true;
    v.done();
    const done = localDate(new Date(), a.timezone);
    sets.push('corrected_date = ?'); vals.push(done);
    correctiveId = newId();
    extra.push(db.prepare(`INSERT INTO corrective_actions (id, abnormality_id, kind, cause, description, performed_by, performed_at, created_at, created_by, updated_at)
                           SELECT ?, ?, 'permanent', NULL, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM abnormalities WHERE id = ? AND version = ?)`)
      .bind(correctiveId, a.id, description, auth.user.id, done, now, auth.user.id, now, a.id, version + 1));
    if (resume) extra.push(...await resumeEquipment(c, a, version, now, detail));
    comment = description!.slice(0, 200);
    Object.assign(detail, { description });
  } else {
    comment = v.str('comment', { max: 500, label: 'コメント' }) ?? null;
    v.done();
  }

  const guard = { sql: 'SELECT 1 FROM abnormalities WHERE id = ? AND version = ? AND updated_at = ?', params: [a.id, version + 1, now] };
  const [upd] = await db.batch([
    db.prepare(`UPDATE abnormalities SET ${sets.join(', ')}, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ? AND version = ? AND status = ?`)
      .bind(...vals, now, auth.user.id, a.id, version, a.status),
    db.prepare(`INSERT INTO abnormality_events (id, abnormality_id, from_status, to_status, comment, actor_user_id, created_at)
                SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (${guard.sql})`).bind(newId(), a.id, a.status, to, comment, auth.user.id, now, ...guard.params),
    ...extra,
    auditStatement(c, { action: `abnormality.${action}`, targetType: 'abnormality', targetId: a.id, factoryId: a.factory_id, detail: { report_no: a.report_no, ...detail, comment } }, guard),
  ]);
  if (!upd?.meta.changes) throw conflict();
  return c.json({ status: to, version: version + 1, correctiveActionId: correctiveId });
});

/** 異常で止めていた設備を、完了と同時に稼働へ戻す文（停止の権限がある人だけ。異常の更新が効いたときだけ実行される） */
async function resumeEquipment(c: Context<AppEnv>, a: AbnormalityRow, version: number, now: string, detail: Record<string, unknown>): Promise<D1PreparedStatement[]> {
  const auth = c.get('auth');
  const db = c.env.DB;
  const eq = await db.prepare('SELECT status, manager_user_id FROM equipment WHERE id = ?').bind(a.equipment_id).first<{ status: string; manager_user_id: string | null }>();
  if (eq?.status !== 'stopped' || !can(auth.actor, 'equipment.stop', { factoryId: a.factory_id, equipmentManagerId: eq.manager_user_id })) return [];
  detail.resumed = true;
  return [
    db.prepare(`UPDATE equipment SET status = 'active', status_reason = NULL, updated_at = ?, updated_by = ?, version = version + 1
                WHERE id = ? AND status = 'stopped' AND EXISTS (SELECT 1 FROM abnormalities WHERE id = ? AND version = ?)`).bind(now, auth.user.id, a.equipment_id, a.id, version + 1),
    auditStatement(c, { action: 'equipment.resume', targetType: 'equipment', targetId: a.equipment_id, factoryId: a.factory_id, detail: { reason: `異常 ${a.report_no} の完了` } },
      { sql: 'SELECT 1 FROM abnormalities WHERE id = ? AND version = ?', params: [a.id, version + 1] }),
  ];
}
