import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { scoped } from '../lib/db';
import { authorize, idParam } from '../lib/guard';
import { HttpError, Validator, conflict, notFound, readJson } from '../lib/http';
import { auditStatement } from '../lib/audit';
import { decodeCursor, encodeCursor } from '../lib/cursor';
import { likeEscape } from '../lib/master';
import { nowIso } from '../lib/crypto';
import { jstDay } from './scans';

/**
 * 履歴・注文データ・ダッシュボード・分析（STEP 7）。
 * 無料プランの読み取り上限（1 日 500 万行・アカウント全体）に収めるため:
 *  - 読み取りの件数は集計表 daily_scan_stats から読む（scan_logs を数えない）
 *  - 一覧・集計は必ず日付の範囲（最長 1 年）を付け、索引で範囲を絞ってから数える
 *  - 一覧はキーセットのページ送り。CSV 出力は画面が 500 件ずつ読んで組み立てる
 */
export const reportRoutes = new Hono<AppEnv>();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

/** 日付の範囲（必須・最長 1 年） */
function range(from?: string, to?: string): { from: string; to: string } {
  if (!from || !to || !DATE.test(from) || !DATE.test(to)) throw new HttpError(422, '期間（from・to）を YYYY-MM-DD で指定してください。');
  if (from > to) throw new HttpError(422, '期間の始まりが終わりより後になっています。');
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_RANGE_DAYS) throw new HttpError(422, '期間は 1 年以内にしてください。');
  return { from, to };
}

const limitOf = (v: string | undefined, def: number, max: number) => Math.min(Math.max(Number(v ?? def) || def, 1), max);

// ===================== 読み取り履歴 =====================

reportRoutes.get('/scan-logs', async (c) => {
  authorize(c, 'orders.view');
  const db = scoped(c);
  const q = c.req.query();
  const { from, to } = range(q.from, q.to);
  const limit = limitOf(q.limit, 50, 500);
  const params: unknown[] = [];
  const bind = (v: unknown) => { params.push(v); return `?${params.length + 1}`; };
  const where = [`s.company_id = ?1`, `s.day BETWEEN ${bind(from)} AND ${bind(to)}`];
  if (q.staff_id) where.push(`s.staff_id = ${bind(Number(q.staff_id))}`);
  const RESULTS = ['ok', 'not_found', 'duplicate', 'over_quantity', 'review', 'error'];
  if (q.result && RESULTS.includes(q.result)) where.push(`s.result = ${bind(q.result)}`);
  if (q.result === 'problem') where.push("s.result <> 'ok'");
  if (q.location_id) where.push(`s.location_id = ${bind(Number(q.location_id))}`);
  if (q.barcode) where.push(`s.barcode LIKE ${bind(`${likeEscape(q.barcode.trim().toUpperCase())}%`)} ESCAPE '\\'`);
  if (q.q) {
    const like = `%${likeEscape(q.q.trim().slice(0, 50))}%`;
    where.push(`(oi.product_code LIKE ${bind(like)} ESCAPE '\\' OR oi.customer_name LIKE ${bind(like)} ESCAPE '\\' OR oi.destination_name LIKE ${bind(like)} ESCAPE '\\')`);
  }
  if (q.cursor) {
    const [d, id] = decodeCursor(q.cursor, 2);
    where.push(`(s.day, s.id) < (${bind(d)}, ${bind(Number(id))})`);
  }
  const rows = await db.all<{ id: number; day: string }>(
    `SELECT s.id, s.day, s.scanned_at, s.staff_name, s.barcode, s.raw_value, s.input, s.result, s.reason, s.device_id, w.device_label,
            oi.id AS order_item_id, oi.global_no, oi.product_code, oi.customer_name, oi.destination_name, oi.quantity, oi.location_code,
            l.name AS location_name, u.name AS user_name,
            (SELECT c2.reason FROM scan_corrections c2 WHERE c2.company_id = s.company_id AND c2.scan_log_id = s.id AND c2.action = 'void') AS void_reason
       FROM scan_logs s
       LEFT JOIN order_items oi ON oi.company_id = s.company_id AND oi.id = s.order_item_id
       LEFT JOIN locations l ON l.company_id = s.company_id AND l.id = s.location_id
       LEFT JOIN work_sessions w ON w.company_id = s.company_id AND w.id = s.work_session_id
       LEFT JOIN users u ON u.company_id = s.company_id AND u.id = s.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY s.day DESC, s.id DESC LIMIT ${bind(limit + 1)}`, ...params);
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return c.json({ items, next_cursor: more && last ? encodeCursor([last.day, String(last.id)]) : null });
});

/** 読み取りの取消（訂正は追記。元の記録は消さない。docs/database.md scan_corrections） */
reportRoutes.post('/scan-logs/:id/corrections', async (c) => {
  authorize(c, 'scan.correct');
  const db = scoped(c);
  const id = idParam(c);
  const v = new Validator(await readJson(c.req.raw));
  v.oneOf('action', ['void'] as const, { required: true, label: '訂正の種類' });
  const reason = v.str('reason', { required: true, max: 500, label: '理由' });
  v.done();
  const log = await db.first<{ id: number; result: string }>('SELECT id, result FROM scan_logs WHERE company_id = ?1 AND id = ?2', id);
  if (!log) throw notFound();
  const now = nowIso();
  try {
    await db.batch([
      db.stmt("INSERT INTO scan_corrections (company_id, scan_log_id, user_id, action, reason, created_at) VALUES (?1, ?2, ?3, 'void', ?4, ?5)",
        id, c.get('auth').user.id, reason, now),
      auditStatement(c, { action: 'scan.void', targetType: 'scan_log', targetId: id, detail: { result: log.result, reason } }),
    ]);
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint failed/i.test(e.message)) throw conflict('この読み取りはすでに取り消されています。');
    throw e;
  }
  return c.json({ ok: true });
});

// ===================== 注文データ =====================

const ITEM_STATUSES = ['pending', 'matched', 'review', 'cancelled'];

reportRoutes.get('/orders/items', async (c) => {
  authorize(c, 'orders.view');
  const db = scoped(c);
  const q = c.req.query();
  const { from, to } = range(q.from, q.to);
  const dateCol = q.date === 'ssd' ? 'ssd' : 'vrd';
  const limit = limitOf(q.limit, 50, 500);
  const params: unknown[] = [];
  const bind = (v: unknown) => { params.push(v); return `?${params.length + 1}`; };
  const where = ['oi.company_id = ?1', `oi.${dateCol} BETWEEN ${bind(from)} AND ${bind(to)}`];
  if (q.status && ITEM_STATUSES.includes(q.status)) where.push(`oi.status = ${bind(q.status)}`);
  if (q.status === 'open') where.push("oi.status IN ('pending', 'review')");
  if (q.location_id) where.push(`oi.location_id = ${bind(Number(q.location_id))}`);
  if (q.customer_code) where.push(`oi.customer_code = ${bind(q.customer_code)}`);
  if (q.q) {
    const t = q.q.trim().slice(0, 50);
    const like = `%${likeEscape(t)}%`;
    where.push(`(oi.global_no LIKE ${bind(`${likeEscape(t.toUpperCase())}%`)} ESCAPE '\\' OR oi.product_code LIKE ${bind(like)} ESCAPE '\\'
              OR oi.product_name LIKE ${bind(like)} ESCAPE '\\' OR oi.customer_name LIKE ${bind(like)} ESCAPE '\\' OR oi.destination_name LIKE ${bind(like)} ESCAPE '\\')`);
  }
  if (q.cursor) {
    const [d, id] = decodeCursor(q.cursor, 2);
    where.push(`(oi.${dateCol}, oi.id) > (${bind(d)}, ${bind(Number(id))})`);
  }
  const rows = await db.all<{ id: number; vrd: string; ssd: string }>(
    `SELECT oi.id, oi.global_no, oi.barcode_global_no, oi.product_code, oi.product_name, oi.quantity, oi.customer_code, oi.customer_name,
            oi.destination_name, oi.ssd, oi.vrd, oi.ship_method, oi.export_type, oi.location_code, l.name AS location_name, oi.status,
            oi.matched_at, s.name AS matched_staff_name, oi.total_weight, o.slip_no, oi.created_at
       FROM order_items oi
       JOIN orders o ON o.company_id = oi.company_id AND o.id = oi.order_id
       LEFT JOIN locations l ON l.company_id = oi.company_id AND l.id = oi.location_id
       LEFT JOIN staff s ON s.company_id = oi.company_id AND s.id = oi.matched_staff_id
      WHERE ${where.join(' AND ')}
      ORDER BY oi.${dateCol}, oi.id LIMIT ${bind(limit + 1)}`, ...params);
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1] as Record<string, unknown> | undefined;
  return c.json({ items, next_cursor: more && last ? encodeCursor([String(last[dateCol] ?? ''), String(last.id)]) : null });
});

reportRoutes.get('/orders/items/:id', async (c) => {
  authorize(c, 'orders.view');
  const db = scoped(c);
  const id = idParam(c);
  const item = await db.first<{ order_id: number; last_import_id: number }>(
    `SELECT oi.*, o.slip_no, o.item_count AS slip_total, o.matched_count AS slip_matched, l.name AS location_name, s.name AS matched_staff_name,
            d.name AS destination_master_name, b.file_name AS last_import_file, b.created_at AS last_import_at
       FROM order_items oi
       JOIN orders o ON o.company_id = oi.company_id AND o.id = oi.order_id
       LEFT JOIN locations l ON l.company_id = oi.company_id AND l.id = oi.location_id
       LEFT JOIN staff s ON s.company_id = oi.company_id AND s.id = oi.matched_staff_id
       LEFT JOIN destinations d ON d.company_id = oi.company_id AND d.id = oi.destination_id
       LEFT JOIN import_batches b ON b.company_id = oi.company_id AND b.id = oi.last_import_id
      WHERE oi.company_id = ?1 AND oi.id = ?2`, id);
  if (!item) throw notFound();
  const scans = await db.all(
    `SELECT s.id, s.scanned_at, s.staff_name, s.result, s.reason, s.input, w.device_label,
            (SELECT c2.reason FROM scan_corrections c2 WHERE c2.company_id = s.company_id AND c2.scan_log_id = s.id AND c2.action = 'void') AS void_reason
       FROM scan_logs s LEFT JOIN work_sessions w ON w.company_id = s.company_id AND w.id = s.work_session_id
      WHERE s.company_id = ?1 AND s.order_item_id = ?2 ORDER BY s.id LIMIT 200`, id);
  const slip = await db.all(
    `SELECT id, global_no, product_code, quantity, status FROM order_items WHERE company_id = ?1 AND order_id = ?2 ORDER BY global_no LIMIT 100`, item.order_id);
  return c.json({ item, scans, slip });
});

/**
 * 要確認の明細などを管理者が解決する（理由必須・監査ログに残す。docs/scan-matching.md §7）。
 *  - match: 照合済みにする（読み取りはしていないので、読み取り履歴には残らない。理由と監査ログで追う）
 *  - cancel: 取消にする（読み取ると「要確認」になる）
 *  - reopen: 照合待ちに戻す（照合済みを戻すときは、正常の読み取りを取り消す方法を使う）
 */
reportRoutes.post('/orders/items/:id/resolve', async (c) => {
  authorize(c, 'scan.correct');
  const db = scoped(c);
  const id = idParam(c);
  const v = new Validator(await readJson(c.req.raw));
  const action = v.oneOf('action', ['match', 'cancel', 'reopen'] as const, { required: true, label: '操作' });
  const reason = v.str('reason', { required: true, max: 500, label: '理由' });
  v.done();
  const item = await db.first<{ status: string; scan_count: number }>('SELECT status, scan_count FROM order_items WHERE company_id = ?1 AND id = ?2', id);
  if (!item) throw notFound();
  const allowed: Record<string, string[]> = { match: ['pending', 'review'], cancel: ['pending', 'review'], reopen: ['review', 'cancelled'] };
  if (!allowed[action!]!.includes(item.status)) throw new HttpError(409, 'この明細の今の状態では、その操作はできません。画面を読み込み直してください。');
  const now = nowIso();
  const to = action === 'match' ? 'matched' : action === 'cancel' ? 'cancelled' : 'pending';
  const [res] = await db.batch([
    db.stmt(`UPDATE order_items SET status = ?3, matched_at = CASE WHEN ?3 = 'matched' THEN ?4 ELSE matched_at END, updated_at = ?4
              WHERE company_id = ?1 AND id = ?2 AND status = ?5`, id, to, now, item.status),
    db.stmt(`UPDATE orders SET matched_count = (SELECT COUNT(*) FROM order_items x WHERE x.company_id = orders.company_id AND x.order_id = orders.id AND x.status = 'matched')
              WHERE company_id = ?1 AND id = (SELECT order_id FROM order_items WHERE company_id = ?1 AND id = ?2)`, id),
    auditStatement(c, { action: `order_item.${action}`, targetType: 'order_item', targetId: id, detail: { from: item.status, to, reason } }),
  ]);
  if (!res?.meta.changes) throw conflict();
  return c.json({ ok: true, status: to });
});

// ===================== ダッシュボード =====================

reportRoutes.get('/dashboard', async (c) => {
  authorize(c, 'orders.view');
  const db = scoped(c);
  const day = jstDay();
  const from7 = jstDay(Date.now() - 6 * 86_400_000);
  const [orders, open, scanByResult, byStaff, byLocation, daily] = await Promise.all([
    // 今日出荷（メーカー出荷日が今日）の明細
    db.first<{ total: number; matched: number }>(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'matched' THEN 1 ELSE 0 END) AS matched FROM order_items WHERE company_id = ?1 AND ssd = ?2 AND status <> 'cancelled'", day),
    // 出荷日を過ぎても照合されていない明細（未確認）
    db.first<{ n: number }>("SELECT COUNT(*) AS n FROM order_items WHERE company_id = ?1 AND status IN ('pending', 'review') AND ssd <= ?2 AND ssd >= ?3", day, jstDay(Date.now() - 30 * 86_400_000)),
    db.all<{ result: string; n: number }>('SELECT result, SUM(count) AS n FROM daily_scan_stats WHERE company_id = ?1 AND day = ?2 GROUP BY result', day),
    db.all<{ staff_id: number; name: string | null; n: number; ok: number }>(
      `SELECT d.staff_id, s.name, SUM(d.count) AS n, SUM(CASE WHEN d.result = 'ok' THEN d.count ELSE 0 END) AS ok
         FROM daily_scan_stats d LEFT JOIN staff s ON s.company_id = d.company_id AND s.id = d.staff_id
        WHERE d.company_id = ?1 AND d.day = ?2 GROUP BY d.staff_id ORDER BY ok DESC`, day),
    db.all<{ location_id: number | null; code: string | null; name: string | null; total: number; matched: number }>(
      `SELECT oi.location_id, l.code, l.name, COUNT(*) AS total, SUM(CASE WHEN oi.status = 'matched' THEN 1 ELSE 0 END) AS matched
         FROM order_items oi LEFT JOIN locations l ON l.company_id = oi.company_id AND l.id = oi.location_id
        WHERE oi.company_id = ?1 AND oi.ssd = ?2 AND oi.status <> 'cancelled' GROUP BY oi.location_id ORDER BY l.code`, day),
    db.all<{ day: string; result: string; n: number }>(
      'SELECT day, result, SUM(count) AS n FROM daily_scan_stats WHERE company_id = ?1 AND day BETWEEN ?2 AND ?3 GROUP BY day, result ORDER BY day', from7, day),
  ]);
  const n = (r: string) => scanByResult.find((x) => x.result === r)?.n ?? 0;
  return c.json({
    day,
    orders: { total: orders?.total ?? 0, matched: orders?.matched ?? 0 },
    open: open?.n ?? 0,
    scans: { total: scanByResult.reduce((s, r) => s + r.n, 0), ok: n('ok'), duplicate: n('duplicate') + n('over_quantity'), review: n('review'), error: n('not_found') + n('error') },
    by_staff: byStaff, by_location: byLocation, daily,
  });
});

// ===================== 分析 =====================

/** 読み取りの集計（集計表から）。group = day | month | staff | location */
reportRoutes.get('/analytics/scans', async (c) => {
  authorize(c, 'analytics.view');
  const db = scoped(c);
  const q = c.req.query();
  const { from, to } = range(q.from, q.to);
  const group = q.group ?? 'day';
  const key = group === 'month' ? 'substr(d.day, 1, 7)' : group === 'staff' ? 'd.staff_id' : group === 'location' ? 'd.location_id' : 'd.day';
  const label = group === 'staff' ? 's.name' : group === 'location' ? "(l.code || ' ' || l.name)" : key;
  const rows = await db.all(
    `SELECT ${key} AS k, ${label} AS label, d.result, SUM(d.count) AS n
       FROM daily_scan_stats d
       LEFT JOIN staff s ON s.company_id = d.company_id AND s.id = d.staff_id
       LEFT JOIN locations l ON l.company_id = d.company_id AND l.id = d.location_id
      WHERE d.company_id = ?1 AND d.day BETWEEN ?2 AND ?3
      GROUP BY ${key}, d.result ORDER BY ${key}`, from, to);
  return c.json({ from, to, group, rows });
});

/** 注文の集計（ミスミ納期の範囲）。group = customer | location | product | month | day */
reportRoutes.get('/analytics/orders', async (c) => {
  authorize(c, 'analytics.view');
  const db = scoped(c);
  const q = c.req.query();
  const { from, to } = range(q.from, q.to);
  const group = q.group ?? 'customer';
  const cols: Record<string, { k: string; label: string; join?: string }> = {
    customer: { k: 'oi.customer_code', label: 'MAX(oi.customer_name)' },
    location: { k: 'oi.location_id', label: "MAX(l.code || ' ' || l.name)", join: 'LEFT JOIN locations l ON l.company_id = oi.company_id AND l.id = oi.location_id' },
    product: { k: 'oi.product_code', label: 'MAX(oi.product_name)' },
    month: { k: 'substr(oi.vrd, 1, 7)', label: 'substr(oi.vrd, 1, 7)' },
    day: { k: 'oi.vrd', label: 'oi.vrd' },
  };
  const g = cols[group];
  if (!g) throw new HttpError(422, '集計の単位が正しくありません。');
  const limit = limitOf(q.limit, 200, 500);
  const rows = await db.all(
    `SELECT ${g.k} AS k, ${g.label} AS label, COUNT(*) AS items, COUNT(DISTINCT oi.order_id) AS slips, SUM(oi.quantity) AS qty,
            ROUND(COALESCE(SUM(oi.total_weight), 0) / 1000.0, 1) AS kg,
            SUM(CASE WHEN oi.status = 'matched' THEN 1 ELSE 0 END) AS matched,
            SUM(CASE WHEN oi.status IN ('pending', 'review') THEN 1 ELSE 0 END) AS open,
            COUNT(DISTINCT oi.destination_code) AS destinations,
            MAX(oi.location_code) AS main_location
       FROM order_items oi ${g.join ?? ''}
      WHERE oi.company_id = ?1 AND oi.vrd BETWEEN ?2 AND ?3 AND oi.status <> 'cancelled'
      GROUP BY ${g.k} ORDER BY ${group === 'month' || group === 'day' ? 'k' : 'items DESC'} LIMIT ?4`, from, to, limit);
  return c.json({ from, to, group, rows });
});

/** 得意先 1 社の内訳（日別・置場別・納品先・よく出る商品） */
reportRoutes.get('/analytics/customers/:code', async (c) => {
  authorize(c, 'analytics.view');
  const db = scoped(c);
  const q = c.req.query();
  const { from, to } = range(q.from, q.to);
  const code = c.req.param('code');
  const base = "oi.company_id = ?1 AND oi.customer_code = ?2 AND oi.vrd BETWEEN ?3 AND ?4 AND oi.status <> 'cancelled'";
  const [byDay, byLocation, byDestination, byProduct] = await Promise.all([
    db.all(`SELECT oi.vrd AS k, COUNT(*) AS items FROM order_items oi WHERE ${base} GROUP BY oi.vrd ORDER BY oi.vrd`, code, from, to),
    db.all(`SELECT oi.location_code AS k, MAX(l.name) AS label, COUNT(*) AS items FROM order_items oi LEFT JOIN locations l ON l.company_id = oi.company_id AND l.id = oi.location_id
             WHERE ${base} GROUP BY oi.location_code ORDER BY items DESC`, code, from, to),
    db.all(`SELECT oi.destination_code AS k, MAX(oi.destination_name) AS label, COUNT(*) AS items FROM order_items oi WHERE ${base}
             GROUP BY oi.destination_code ORDER BY items DESC LIMIT 20`, code, from, to),
    db.all(`SELECT oi.product_code AS k, COUNT(*) AS items, SUM(oi.quantity) AS qty FROM order_items oi WHERE ${base}
             GROUP BY oi.product_code ORDER BY items DESC LIMIT 10`, code, from, to),
  ]);
  return c.json({ code, from, to, by_day: byDay, by_location: byLocation, by_destination: byDestination, by_product: byProduct });
});
