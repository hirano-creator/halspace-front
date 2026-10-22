import { Hono } from 'hono';
import { ABNORMALITY_STATUS_LABELS, SEVERITY_LABELS, isOverdue, localDate, type AbnormalityStatus, type InspectionExportItem, type InspectionExportPage, type InspectionExportRow, type Severity } from '@tenq/shared';
import type { AppEnv } from '../types';
import { auditStatement, diff } from '../lib/audit';
import { decodeCursor, encodeCursor } from '../lib/cursor';
import { CSV_MAX_ROWS, csvResponse } from '../lib/csv';
import { nowIso } from '../lib/crypto';
import { inspectionFilter } from '../lib/filters';
import { authorize } from '../lib/guard';
import { HttpError, Validator, notFound, readJson } from '../lib/http';
import { scopeWhere } from '../lib/scope';
import { SETTING_DEFAULTS, loadSettings } from '../lib/settings';

/**
 * 出力・帳票・集計・監査ログ・システム設定（requirements F-7・F-8・F-10・F-11）。
 * 出力はすべて監査ログに残す（誰が・いつ・どの条件で・何件）。
 */
export const reportRoutes = new Hono<AppEnv>();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EQUIPMENT_STATUS: Record<string, string> = { active: '稼働', stopped: '停止中', retired: '廃止' };
const FREQUENCY: Record<string, string> = { daily: '毎日', weekly: '毎週', monthly: '毎月' };

/**
 * 日時は日本時間の「YYYY-MM-DD HH:MM」で出す（保存は UTC）。
 * 日本時間は夏時間がなく常に +9 時間なので、Intl を使わずに計算する（行ごとの Intl は CPU 時間がかかる）
 */
const jst = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? '' : new Date(t + 9 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
};
const today = () => localDate(new Date(), 'Asia/Tokyo');

function tooMany(): never {
  throw new HttpError(422, `出力できるのは1回 ${CSV_MAX_ROWS.toLocaleString()} 行までです。期間を分けて出力してください。`);
}

// ===== CSV =====

/**
 * 点検記録（CSV は画面が組み立てる。1行 = 1点検項目の結果、訂正がある場合は最新の版）。
 * 行数が多く、Worker で CSV にすると無料プランの CPU 時間（1 回 10ms）を超えるため、点検 300 件ずつの JSON で返す。
 * 最初のページで行数の上限を確かめ、監査ログを書く（出力の開始を記録する）。
 */
const EXPORT_PAGE = 300;
reportRoutes.get('/exports/inspections', async (c) => {
  authorize(c, 'export');
  const db = c.env.DB;
  const q = c.req.query();
  const { where, params } = inspectionFilter(c);
  let total: number | undefined;
  if (q.cursor) {
    const [at, id] = decodeCursor(q.cursor, 2);
    where.push('(i.started_at > ? OR (i.started_at = ? AND i.id > ?))');
    params.push(at, at, id);
  } else {
    const n = await db.prepare(
      `SELECT COUNT(*) AS n FROM inspections i JOIN equipment e ON e.id = i.equipment_id
       LEFT JOIN inspection_items it ON it.template_version_id = i.template_version_id WHERE ${where.join(' AND ')}`,
    ).bind(...params).first<{ n: number }>();
    total = n?.n ?? 0;
    if (total > CSV_MAX_ROWS) tooMany();
    await db.batch([auditStatement(c, { action: 'export.csv', targetType: 'inspections', detail: { kind: 'inspections', filters: q, rows: total } })]);
  }
  const { results } = await db.prepare(
    `SELECT i.id, i.inspection_date, f.name AS factory, e.equipment_code, e.name AS equipment, t.name AS template, v.version_no, i.template_version_id,
            u.name AS inspector, i.status, i.overall_result, i.started_at, i.completed_at, i.current_revision, i.comment
     FROM inspections i JOIN equipment e ON e.id = i.equipment_id JOIN factories f ON f.id = i.factory_id JOIN users u ON u.id = i.inspector_user_id
     JOIN inspection_template_versions v ON v.id = i.template_version_id JOIN inspection_templates t ON t.id = v.template_id
     WHERE ${where.join(' AND ')} ORDER BY i.started_at, i.id LIMIT ?`,
  ).bind(...params, EXPORT_PAGE + 1).all<InspectionExportRow>();
  const page = results.slice(0, EXPORT_PAGE);
  const ids = JSON.stringify(page.map((i) => i.id));
  const versions = JSON.stringify([...new Set(page.map((i) => i.template_version_id))]);
  // 点検 ID はスコープで絞った上の結果から取るので、ここで会社・工場を絞り直す必要はない
  const [items, res] = await db.batch([
    db.prepare('SELECT id, template_version_id, sort_order, label, criteria FROM inspection_items WHERE template_version_id IN (SELECT value FROM json_each(?))').bind(versions),
    db.prepare(`SELECT r.inspection_id, r.item_id, r.judgment, r.note FROM inspection_results r JOIN inspections i ON i.id = r.inspection_id AND r.revision = i.current_revision
                WHERE r.inspection_id IN (SELECT value FROM json_each(?))`).bind(ids),
  ]);
  const last = page[page.length - 1];
  const body: InspectionExportPage = {
    total,
    inspections: page,
    items: (items?.results ?? []) as InspectionExportItem[],
    results: ((res?.results ?? []) as { inspection_id: string; item_id: string; judgment: string | null; note: string | null }[]).map((r) => [r.inspection_id, r.item_id, r.judgment, r.note]),
    nextCursor: results.length > EXPORT_PAGE && last ? encodeCursor([last.started_at, last.id]) : null,
  };
  return c.json(body);
});

/** 設備台帳 */
reportRoutes.get('/exports/equipment.csv', async (c) => {
  authorize(c, 'export');
  const q = c.req.query();
  const s = scopeWhere(c.get('auth'), 'e');
  const where = [s.sql];
  const params: unknown[] = [...s.params];
  if (q.factory) { where.push('e.factory_id = ?'); params.push(q.factory); }
  if (q.status !== 'all') where.push("e.status <> 'retired'");
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, f.name AS factory, e.equipment_code, e.name, e.location, a.name AS area, e.category, e.maker, e.model, m.name AS manager,
            e.status, e.status_reason, e.frequency, t.name AS template, e.notes, e.created_at, e.updated_at, e.retired_at
     FROM equipment e JOIN factories f ON f.id = e.factory_id LEFT JOIN areas a ON a.id = e.area_id
     LEFT JOIN users m ON m.id = e.manager_user_id LEFT JOIN inspection_templates t ON t.id = e.template_id
     WHERE ${where.join(' AND ')} ORDER BY f.code, e.equipment_code LIMIT ?`,
  ).bind(...params, CSV_MAX_ROWS + 1).all<Record<string, string | null>>();
  if (results.length > CSV_MAX_ROWS) tooMany();
  await c.env.DB.batch([auditStatement(c, { action: 'export.csv', targetType: 'equipment', detail: { kind: 'equipment', filters: q, rows: results.length } })]);
  return csvResponse(`TENQ_設備台帳_${today()}.csv`,
    ['設備ID', '工場', '設備番号', '設備名', '設置場所', 'エリア', '設備分類', 'メーカー', '型式', '管理担当者', '使用状態', '状態の理由', '点検頻度', '点検基準', '備考', '登録日時', '更新日時', '廃止日時'],
    results.map((r) => [r.id, r.factory, r.equipment_code, r.name, r.location, r.area, r.category, r.maker, r.model, r.manager,
      EQUIPMENT_STATUS[r.status ?? ''] ?? r.status, r.status_reason, FREQUENCY[r.frequency ?? ''] ?? r.frequency, r.template, r.notes,
      jst(r.created_at), jst(r.updated_at), jst(r.retired_at)]));
});

/** 異常・是正処置（1行 = 1件の異常。是正処置は件内でまとめる） */
reportRoutes.get('/exports/abnormalities.csv', async (c) => {
  authorize(c, 'export');
  const q = c.req.query();
  const v = new Validator(q);
  const from = v.str('from', { max: 10, label: '開始日' });
  const to = v.str('to', { max: 10, label: '終了日' });
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) v.fail('from', '期間の形式が正しくありません。');
  v.done();
  const s = scopeWhere(c.get('auth'), 'a');
  const where = [s.sql];
  const params: unknown[] = [...s.params];
  // 発見日は日本時間の日付で比べる
  if (from) { where.push("date(a.found_at, '+9 hours') >= ?"); params.push(from); }
  if (to) { where.push("date(a.found_at, '+9 hours') <= ?"); params.push(to); }
  if (q.factory) { where.push('a.factory_id = ?'); params.push(q.factory); }
  if (q.open === '1') where.push("a.status <> 'closed'");
  const { results } = await c.env.DB.prepare(
    `SELECT a.report_no, f.name AS factory, e.equipment_code, e.name AS equipment, a.title, a.description, a.severity, a.status, a.found_at,
            r.name AS reporter, a.emergency_action, a.equipment_stopped, s.name AS assignee, a.due_date, a.corrected_date,
            vb.name AS verifier, a.verified_at, ab.name AS approver, a.approved_at,
            (SELECT group_concat(COALESCE(ca.performed_at, '') || ' ' || ca.description, ' / ') FROM corrective_actions ca WHERE ca.abnormality_id = a.id) AS actions,
            (SELECT group_concat(ca.cause, ' / ') FROM corrective_actions ca WHERE ca.abnormality_id = a.id AND ca.cause IS NOT NULL) AS causes
     FROM abnormalities a JOIN equipment e ON e.id = a.equipment_id JOIN factories f ON f.id = a.factory_id JOIN users r ON r.id = a.reported_by
     LEFT JOIN users s ON s.id = a.assignee_user_id LEFT JOIN users vb ON vb.id = a.verified_by LEFT JOIN users ab ON ab.id = a.approved_by
     WHERE ${where.join(' AND ')} ORDER BY a.found_at LIMIT ?`,
  ).bind(...params, CSV_MAX_ROWS + 1).all<Record<string, string | number | null>>();
  if (results.length > CSV_MAX_ROWS) tooMany();
  await c.env.DB.batch([auditStatement(c, { action: 'export.csv', targetType: 'abnormalities', detail: { kind: 'abnormalities', filters: q, rows: results.length } })]);
  const t = today();
  return csvResponse(`TENQ_異常・是正処置_${t}.csv`,
    ['報告番号', '工場', '設備番号', '設備名', '異常の内容', '詳しい内容', '危険度', '状態', '発見日時', '報告者', '応急処置', '使用停止', '対応担当者', '対応期限', '期限超過', '修理・是正の内容', '原因', '対応完了日', '再確認者', '再確認日時', '承認者', '承認日時'],
    results.map((r) => [r.report_no, r.factory, r.equipment_code, r.equipment, r.title, r.description, SEVERITY_LABELS[r.severity as Severity]?.label ?? r.severity,
      ABNORMALITY_STATUS_LABELS[r.status as AbnormalityStatus] ?? r.status, jst(r.found_at as string), r.reporter, r.emergency_action, r.equipment_stopped ? 'あり' : '',
      r.assignee, r.due_date, isOverdue(r.status as AbnormalityStatus, r.due_date as string | null, t) ? '超過' : '', r.actions, r.causes, r.corrected_date,
      r.verifier, jst(r.verified_at as string), r.approver, jst(r.approved_at as string)]));
});

// ===== 帳票 =====

/** 設備ごとの月間点検表（紙の点検表に近い形。行 = 点検項目、列 = 日） */
reportRoutes.get('/reports/monthly-sheet', async (c) => {
  authorize(c, 'inspection.viewFactory');
  const auth = c.get('auth');
  const q = c.req.query();
  if (!q.equipment || !/^\d{4}-\d{2}$/.test(q.month ?? '')) throw new HttpError(400, '設備と月（YYYY-MM）を指定してください。');
  const s = scopeWhere(auth, 'e');
  const eq = await c.env.DB.prepare(
    `SELECT e.id, e.equipment_code, e.name, e.location, e.category, e.frequency, f.name AS factory_name, m.name AS manager_name
     FROM equipment e JOIN factories f ON f.id = e.factory_id LEFT JOIN users m ON m.id = e.manager_user_id WHERE e.id = ? AND ${s.sql}`,
  ).bind(q.equipment, ...s.params).first();
  if (!eq) throw notFound();
  const [inspections, results, abnormalities] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT i.id, i.inspection_date, i.status, i.overall_result, i.completed_at, i.current_revision, u.name AS inspector, v.version_no
                      FROM inspections i JOIN users u ON u.id = i.inspector_user_id JOIN inspection_template_versions v ON v.id = i.template_version_id
                      WHERE i.equipment_id = ? AND i.status = 'completed' AND i.inspection_date LIKE ? ORDER BY i.inspection_date`).bind(q.equipment, `${q.month}-%`),
    c.env.DB.prepare(`SELECT i.inspection_date, it.sort_order, it.label, it.criteria, r.judgment, r.note
                      FROM inspections i JOIN inspection_results r ON r.inspection_id = i.id AND r.revision = i.current_revision
                      JOIN inspection_items it ON it.id = r.item_id
                      WHERE i.equipment_id = ? AND i.status = 'completed' AND i.inspection_date LIKE ? ORDER BY it.sort_order`).bind(q.equipment, `${q.month}-%`),
    c.env.DB.prepare(`SELECT report_no, title, severity, status, found_at FROM abnormalities WHERE equipment_id = ? AND date(found_at, '+9 hours') LIKE ? ORDER BY found_at`)
      .bind(q.equipment, `${q.month}-%`),
  ]);
  // 月の途中で点検基準の版が変わっても、項目名で1行にまとめる（並びは最初に出てきた順）
  const rows = new Map<string, { label: string; criteria: string | null; cells: Record<string, { judgment: string; note: string | null }> }>();
  for (const r of (results?.results ?? []) as { inspection_date: string; label: string; criteria: string | null; judgment: string; note: string | null }[]) {
    const row = rows.get(r.label) ?? { label: r.label, criteria: r.criteria, cells: {} };
    row.cells[r.inspection_date] = { judgment: r.judgment, note: r.note };
    rows.set(r.label, row);
  }
  await c.env.DB.batch([auditStatement(c, { action: 'report.print', targetType: 'equipment', targetId: q.equipment, detail: { kind: 'monthly-sheet', month: q.month } })]);
  return c.json({ equipment: eq, month: q.month, inspections: inspections?.results ?? [], rows: [...rows.values()], abnormalities: abnormalities?.results ?? [], generatedAt: nowIso(), generatedBy: auth.user.name });
});

/** ISO 監査向けの期間指定記録一覧（点検の実施状況・訂正の履歴・点検基準の版・異常と是正） */
reportRoutes.get('/reports/audit-pack', async (c) => {
  authorize(c, 'export');
  const auth = c.get('auth');
  const q = c.req.query();
  if (!q.factory || !DATE.test(q.from ?? '') || !DATE.test(q.to ?? '') || q.from! > q.to!) throw new HttpError(400, '工場と期間（開始日・終了日）を指定してください。');
  authorize(c, 'export', { factoryId: q.factory });
  const db = c.env.DB;
  const factory = await db.prepare('SELECT id, code, name FROM factories WHERE id = ? AND company_id = ?').bind(q.factory, auth.companyId).first();
  if (!factory) throw notFound();
  const [summary, byEquipment, corrections, versions, abnormalities, voided] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS total, SUM(status = 'completed') AS completed, SUM(status = 'completed' AND overall_result = 'ng') AS ng,
                       SUM(status = 'voided') AS voided, SUM(current_revision > 1) AS corrected
                FROM inspections WHERE factory_id = ? AND inspection_date BETWEEN ? AND ?`).bind(q.factory, q.from, q.to),
    db.prepare(`SELECT e.equipment_code, e.name, e.frequency, e.status, COUNT(i.id) AS completed, SUM(i.overall_result = 'ng') AS ng,
                       MIN(i.inspection_date) AS first_date, MAX(i.inspection_date) AS last_date
                FROM equipment e LEFT JOIN inspections i ON i.equipment_id = e.id AND i.status = 'completed' AND i.inspection_date BETWEEN ? AND ?
                WHERE e.factory_id = ? AND e.status <> 'retired' GROUP BY e.id ORDER BY e.equipment_code`).bind(q.from, q.to, q.factory),
    db.prepare(`SELECT i.inspection_date, e.equipment_code, e.name AS equipment, c.to_revision, c.reason, c.diff_json, c.corrected_at, u.name AS corrected_by
                FROM inspection_corrections c JOIN inspections i ON i.id = c.inspection_id JOIN equipment e ON e.id = i.equipment_id JOIN users u ON u.id = c.corrected_by
                WHERE i.factory_id = ? AND i.inspection_date BETWEEN ? AND ? ORDER BY c.corrected_at`).bind(q.factory, q.from, q.to),
    // 使われた版を先に絞ってから項目数を数える（点検 1 件ごとに数えると読み取り行数が点検数 × 項目数になる）
    db.prepare(`SELECT t.name AS template, v.version_no, v.change_reason, v.published_at, u.name AS published_by,
                       (SELECT COUNT(*) FROM inspection_items it WHERE it.template_version_id = v.id) AS items
                FROM (SELECT DISTINCT template_version_id FROM inspections WHERE factory_id = ? AND inspection_date BETWEEN ? AND ?) x
                JOIN inspection_template_versions v ON v.id = x.template_version_id JOIN inspection_templates t ON t.id = v.template_id
                LEFT JOIN users u ON u.id = v.published_by ORDER BY t.name, v.version_no`).bind(q.factory, q.from, q.to),
    db.prepare(`SELECT a.report_no, e.equipment_code, a.title, a.severity, a.status, a.found_at, a.due_date, a.corrected_date,
                       s.name AS assignee, vb.name AS verifier, a.verified_at, ab.name AS approver, a.approved_at,
                       (SELECT group_concat(ca.description, ' / ') FROM corrective_actions ca WHERE ca.abnormality_id = a.id) AS actions
                FROM abnormalities a JOIN equipment e ON e.id = a.equipment_id LEFT JOIN users s ON s.id = a.assignee_user_id
                LEFT JOIN users vb ON vb.id = a.verified_by LEFT JOIN users ab ON ab.id = a.approved_by
                WHERE a.factory_id = ? AND date(a.found_at, '+9 hours') BETWEEN ? AND ? ORDER BY a.found_at`).bind(q.factory, q.from, q.to),
    db.prepare(`SELECT i.inspection_date, e.equipment_code, i.voided_reason, i.voided_at, u.name AS voided_by
                FROM inspections i JOIN equipment e ON e.id = i.equipment_id LEFT JOIN users u ON u.id = i.voided_by
                WHERE i.factory_id = ? AND i.status = 'voided' AND i.inspection_date BETWEEN ? AND ? ORDER BY i.voided_at`).bind(q.factory, q.from, q.to),
  ]);
  await db.batch([auditStatement(c, { action: 'report.print', targetType: 'factory', targetId: q.factory, factoryId: q.factory, detail: { kind: 'audit-pack', from: q.from, to: q.to } })]);
  const t = today();
  return c.json({
    factory, from: q.from, to: q.to, generatedAt: nowIso(), generatedBy: auth.user.name,
    summary: summary?.results[0] ?? {},
    equipment: byEquipment?.results ?? [],
    corrections: ((corrections?.results ?? []) as { diff_json: string }[]).map(({ diff_json, ...r }) => ({ ...r, diff: JSON.parse(diff_json) })),
    versions: versions?.results ?? [],
    abnormalities: ((abnormalities?.results ?? []) as { status: AbnormalityStatus; due_date: string | null }[]).map((a) => ({ ...a, overdue: isOverdue(a.status, a.due_date, t) })),
    voided: voided?.results ?? [],
  });
});

// ===== 集計 =====

/** 点検者別・設備分類別・日別の集計（期間・工場） */
reportRoutes.get('/stats', async (c) => {
  authorize(c, 'inspection.viewFactory');
  const q = c.req.query();
  const from = DATE.test(q.from ?? '') ? q.from! : localDate(new Date(Date.now() - 29 * 86_400_000), 'Asia/Tokyo');
  const to = DATE.test(q.to ?? '') ? q.to! : today();
  const s = scopeWhere(c.get('auth'), 'i');
  const base = [s.sql, "i.status = 'completed'", 'i.inspection_date BETWEEN ? AND ?'];
  const params: unknown[] = [...s.params, from, to];
  if (q.factory) { base.push('i.factory_id = ?'); params.push(q.factory); }
  const w = base.join(' AND ');
  const db = c.env.DB;
  const [byInspector, byCategory, byDate, byFactory] = await db.batch([
    db.prepare(`SELECT u.name, COUNT(*) AS completed, SUM(i.overall_result = 'ng') AS ng, COUNT(DISTINCT i.inspection_date) AS days
                FROM inspections i JOIN users u ON u.id = i.inspector_user_id WHERE ${w} GROUP BY u.id ORDER BY completed DESC`).bind(...params),
    db.prepare(`SELECT COALESCE(e.category, '（未分類）') AS category, COUNT(*) AS completed, SUM(i.overall_result = 'ng') AS ng, COUNT(DISTINCT e.id) AS equipment
                FROM inspections i JOIN equipment e ON e.id = i.equipment_id WHERE ${w} GROUP BY e.category ORDER BY completed DESC`).bind(...params),
    db.prepare(`SELECT i.inspection_date AS date, COUNT(*) AS completed, SUM(i.overall_result = 'ng') AS ng FROM inspections i WHERE ${w} GROUP BY i.inspection_date ORDER BY i.inspection_date`).bind(...params),
    db.prepare(`SELECT f.name, COUNT(*) AS completed, SUM(i.overall_result = 'ng') AS ng FROM inspections i JOIN factories f ON f.id = i.factory_id WHERE ${w} GROUP BY f.id ORDER BY f.code`).bind(...params),
  ]);
  return c.json({ from, to, byInspector: byInspector?.results ?? [], byCategory: byCategory?.results ?? [], byDate: byDate?.results ?? [], byFactory: byFactory?.results ?? [] });
});

// ===== 監査ログ =====

reportRoutes.get('/audit-logs', async (c) => {
  authorize(c, 'audit.view');
  const auth = c.get('auth');
  const q = c.req.query();
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
  const where = ['l.company_id = ?'];
  const params: unknown[] = [auth.companyId];
  // 工場長は所属工場の記録だけ（工場に結びつかない会社全体の操作はシステム管理者だけが見る）
  if (auth.actor.role !== 'system_admin') {
    const ids = auth.actor.factoryIds;
    where.push(ids.length ? `l.factory_id IN (${ids.map(() => '?').join(',')})` : '1 = 0');
    params.push(...ids);
  }
  if (DATE.test(q.from ?? '')) { where.push("date(l.created_at, '+9 hours') >= ?"); params.push(q.from); }
  if (DATE.test(q.to ?? '')) { where.push("date(l.created_at, '+9 hours') <= ?"); params.push(q.to); }
  if (q.action) { where.push('l.action LIKE ?'); params.push(`${q.action.replace(/[%_]/g, '')}%`); }
  if (q.actor) { where.push('l.actor_user_id = ?'); params.push(q.actor); }
  if (q.target) { where.push('l.target_id = ?'); params.push(q.target); }
  if (q.cursor) { const [id] = decodeCursor(q.cursor, 1); where.push('l.id < ?'); params.push(Number(id)); }
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.created_at, l.action, l.target_type, l.target_id, l.detail_json, l.ip, u.name AS actor_name, f.name AS factory_name
     FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_user_id LEFT JOIN factories f ON f.id = l.factory_id
     WHERE ${where.join(' AND ')} ORDER BY l.id DESC LIMIT ?`,
  ).bind(...params, limit + 1).all<{ id: number; detail_json: string | null }>();
  const items = results.slice(0, limit).map(({ detail_json, ...r }) => ({ ...r, detail: detail_json ? JSON.parse(detail_json) : null }));
  const last = items[items.length - 1];
  return c.json({ items, nextCursor: results.length > limit && last ? encodeCursor([String(last.id)]) : null });
});

// ===== システム設定 =====

/** 画面から変えられる設定と、その範囲（qr_base_url は印刷済み QR に関わるので画面からは変えない） */
const EDITABLE: Record<string, { kind: 'int'; min: number; max: number; label: string } | { kind: 'time'; label: string } | { kind: 'text'; max: number; label: string }> = {
  retention_years: { kind: 'int', min: 1, max: 30, label: '記録の保存期間（年）' },
  late_threshold: { kind: 'time', label: '「遅れ」と判定する時刻' },
  board_refresh_seconds: { kind: 'int', min: 10, max: 600, label: 'カード一覧の自動更新（秒）' },
  photo_max_count: { kind: 'int', min: 1, max: 30, label: '写真の枚数（1件あたり）' },
  device_login_days: { kind: 'int', min: 1, max: 90, label: 'ログインを記憶する日数' },
  reauth_hours: { kind: 'int', min: 1, max: 72, label: '再ログインまでの時間' },
  high_severity_message: { kind: 'text', max: 300, label: '危険度「高」の案内文' },
};

reportRoutes.get('/settings', async (c) => {
  authorize(c, 'settings.manage');
  const settings = await loadSettings(c.env.DB, c.get('auth').companyId);
  return c.json({ settings, defaults: SETTING_DEFAULTS, editable: Object.fromEntries(Object.entries(EDITABLE).map(([k, v]) => [k, v])) });
});

reportRoutes.put('/settings', async (c) => {
  authorize(c, 'settings.manage');
  const auth = c.get('auth');
  const body = await readJson(c.req.raw);
  const v = new Validator(body);
  const next: Record<string, number | string> = {};
  for (const [key, spec] of Object.entries(EDITABLE)) {
    if (!(key in body)) continue;
    if (spec.kind === 'int') { const n = v.int(key, { required: true, min: spec.min, max: spec.max, label: spec.label }); if (n !== undefined) next[key] = n; }
    else if (spec.kind === 'time') { const t = v.str(key, { required: true, max: 5, label: spec.label }); if (t && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) v.fail(key, '時刻は 08:30 のように入力してください。'); else if (t) next[key] = t; }
    else { const t = v.str(key, { required: true, max: spec.max, label: spec.label }); if (t) next[key] = t; }
  }
  for (const key of Object.keys(body)) if (!(key in EDITABLE)) v.fail(key, 'この設定は画面から変更できません。');
  v.done();
  const before = await loadSettings(c.env.DB, auth.companyId);
  const changes = diff(before, next);
  if (!Object.keys(changes).length) return c.json({ ok: true });
  const now = nowIso();
  await c.env.DB.batch([
    ...Object.keys(changes).map((key) => c.env.DB.prepare(
      `INSERT INTO system_settings (company_id, key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(company_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).bind(auth.companyId, key, JSON.stringify(next[key]), now, auth.user.id)),
    auditStatement(c, { action: 'settings.update', targetType: 'settings', detail: { changes } }),
  ]);
  return c.json({ ok: true });
});
