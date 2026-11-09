import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { scoped, type Scoped } from '../lib/db';
import { authorize, idParam } from '../lib/guard';
import { HttpError, Validator, readJson } from '../lib/http';
import { nowIso } from '../lib/crypto';
import { readSettings } from './settings';

/**
 * バーコード照合（docs/scan-matching.md）。
 *  - 作業セッション: ログインした PC で作業担当者を選んだ状態。読み取りのたびに API で確かめる
 *  - 照合: 判定・記録・数え上げは scan_logs への 1 回の INSERT とトリガー（migrations/0001）で行う。
 *    複数の PC が同時に同じラベルを読んでも「正常」は 1 回だけ。同じ client_scan_id の再送は記録 1 件のまま
 *  - 置場別チェックの一覧（scan-board）: 画面の一覧（ミスミ納期 × 置場）
 */
export const scanRoutes = new Hono<AppEnv>();

/** 日本時間の今日（YYYY-MM-DD）。業務日はこれで数える */
export const jstDay = (at = Date.now()) => new Date(at + 9 * 3_600_000).toISOString().slice(0, 10);

const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const CLIENT_SCAN_ID = /^[A-Za-z0-9_-]{8,64}$/;

// ---------- 作業セッション（担当者の選択） ----------

scanRoutes.post('/work-sessions', async (c) => {
  authorize(c, 'scan');
  const db = scoped(c);
  const auth = c.get('auth');
  const v = new Validator(await readJson(c.req.raw));
  const staffId = v.int('staff_id', { required: true, min: 1, label: '担当者' });
  const deviceId = v.str('device_id', { required: true, max: 64, label: '端末' });
  const deviceLabel = v.nullableStr('device_label', { max: 50, label: 'PC の名前' }) ?? null;
  if (deviceId && !DEVICE_ID.test(deviceId)) v.fail('device_id', '端末の識別子が正しくありません。');
  v.done();
  const staff = await db.first<{ id: number; name: string; code: string }>(
    "SELECT id, name, code FROM staff WHERE company_id = ?1 AND id = ?2 AND status = 'active'", staffId);
  if (!staff) throw new HttpError(422, 'この担当者は選べません（利用停止中か、登録されていません）。担当者管理を確認してください。');
  const now = nowIso();
  // 同じ人・同じ端末の開いたままのセッションは閉じる（担当者を変えた・画面を開き直した）
  const [, ins] = await db.batch([
    db.stmt('UPDATE work_sessions SET ended_at = ?4 WHERE company_id = ?1 AND user_id = ?2 AND device_id = ?3 AND ended_at IS NULL', auth.user.id, deviceId, now),
    db.stmt(`INSERT INTO work_sessions (company_id, user_id, staff_id, staff_name, device_id, device_label, user_agent, started_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`,
      auth.user.id, staff.id, staff.name, deviceId, deviceLabel, (c.req.header('User-Agent') ?? '').slice(0, 255), now),
  ]);
  const id = (ins?.results?.[0] as { id: number } | undefined)?.id;
  return c.json({ id, staff, started_at: now }, 201);
});

scanRoutes.post('/work-sessions/:id/end', async (c) => {
  authorize(c, 'scan');
  const db = scoped(c);
  const res = await db.run('UPDATE work_sessions SET ended_at = ?4 WHERE company_id = ?1 AND id = ?2 AND user_id = ?3 AND ended_at IS NULL',
    idParam(c), c.get('auth').user.id, nowIso());
  return c.json({ ended: (res.meta.changes ?? 0) > 0 });
});

// ---------- 照合 ----------

interface Session { id: number; staff_id: number; staff_name: string; device_id: string; ended_at: string | null; user_id: number; staff_status: string }
interface ScanRow {
  id: number; result: string; reason: string | null; barcode: string; raw_value: string; input: string; order_item_id: number | null;
  scanned_at: string; staff_name: string;
}

/** 読み取り値を整える（docs/scan-matching.md §3）。全角→半角 → 前後の空白・制御文字 → 設定の前後の文字 → 大文字 */
export function normalizeBarcode(raw: string, prefix: string, suffix: string): string {
  // 日本語入力がオンのままリーダーで読むと「５K9…」のように全角が混ざるので、先に半角へそろえる
  // eslint-disable-next-line no-control-regex
  let s = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (prefix && s.startsWith(prefix)) s = s.slice(prefix.length);
  if (suffix && s.endsWith(suffix)) s = s.slice(0, -suffix.length);
  return s.trim().toUpperCase();
}
const BARCODE_PATTERN = /^[A-Z0-9\-_.]{4,40}$/;

const MESSAGES: Record<string, string> = {
  ok: '注文データと一致しました',
  not_found: 'この番号の注文データがありません。ラベルと今日の CSV を確認してください',
  duplicate: 'すでに読み取り済みです',
  over_quantity: '必要な枚数をすでに読み取っています（数量超過）',
};

async function itemSummary(db: Scoped, itemId: number) {
  return db.first<Record<string, unknown>>(
    `SELECT oi.id, oi.global_no, oi.barcode_global_no, oi.product_code, oi.product_name, oi.quantity, oi.required_scans, oi.scan_count, oi.status,
            oi.customer_name, oi.destination_name, oi.ssd, oi.vrd, oi.export_type, oi.location_id, oi.location_code, l.name AS location_name,
            oi.matched_at, s.name AS matched_staff_name, o.slip_no, o.item_count AS slip_total, o.matched_count AS slip_matched
       FROM order_items oi
       JOIN orders o ON o.company_id = oi.company_id AND o.id = oi.order_id
       LEFT JOIN locations l ON l.company_id = oi.company_id AND l.id = oi.location_id
       LEFT JOIN staff s ON s.company_id = oi.company_id AND s.id = oi.matched_staff_id
      WHERE oi.company_id = ?1 AND oi.id = ?2`, itemId);
}

scanRoutes.post('/scans', async (c) => {
  authorize(c, 'scan');
  const db = scoped(c);
  const auth = c.get('auth');
  const v = new Validator(await readJson(c.req.raw));
  const sessionId = v.int('work_session_id', { required: true, min: 1, label: '作業セッション' });
  const clientScanId = v.str('client_scan_id', { required: true, max: 64, label: '読み取り ID' });
  const rawValue = v.str('raw_value', { required: true, max: 200, label: '読み取り値' });
  const input = v.oneOf('input', ['scanner', 'manual'] as const, { label: '入力の方法' }) ?? 'scanner';
  const clientAt = v.str('client_scanned_at', { max: 30, label: '読み取り日時' }) ?? null;
  // 画面で選んでいるメーカー納期。出荷日の確認（Q-6）はこの日と比べる。送られてこなければ今日と比べる
  const boardSsd = v.str('ssd', { max: 10, label: 'メーカー納期' }) ?? null;
  if (boardSsd && !/^\d{4}-\d{2}-\d{2}$/.test(boardSsd)) v.fail('ssd', 'メーカー納期の指定が正しくありません。');
  if (clientScanId && !CLIENT_SCAN_ID.test(clientScanId)) v.fail('client_scan_id', '読み取り ID の形式が正しくありません。');
  v.done();

  // 担当者が正しく選ばれているか（API でも毎回確かめる。docs/scan-matching.md §2）
  const session = await db.first<Session>(
    `SELECT w.id, w.staff_id, w.staff_name, w.device_id, w.ended_at, w.user_id, s.status AS staff_status
       FROM work_sessions w JOIN staff s ON s.company_id = w.company_id AND s.id = w.staff_id
      WHERE w.company_id = ?1 AND w.id = ?2`, sessionId);
  if (!session || session.user_id !== auth.user.id) throw new HttpError(409, '担当者を選び直してください。', { code: 'STAFF_NOT_SELECTED' });
  if (session.ended_at) throw new HttpError(409, '担当者の選択が終わっています。担当者を選び直してください。', { code: 'SESSION_ENDED' });
  if (session.staff_status !== 'active') throw new HttpError(409, 'この担当者は利用停止になりました。担当者を選び直してください。', { code: 'STAFF_NOT_SELECTED' });

  const already = await db.first<ScanRow>('SELECT * FROM scan_logs WHERE company_id = ?1 AND client_scan_id = ?2', clientScanId);
  if (!already) {
    const settings = await readSettings(db);
    const barcode = normalizeBarcode(rawValue!, settings.barcode_strip_prefix, settings.barcode_strip_suffix);
    const now = nowIso();
    const day = jstDay();
    const base = [clientScanId, session.id, auth.user.id, session.staff_id, session.staff_name, rawValue!.slice(0, 200), barcode.slice(0, 64) || '(空)', input, now, clientAt, day, session.device_id];
    // ?2〜?13 は共通の値。照合 SQL では ?14 以降を使う
    const COLS = 'company_id, client_scan_id, work_session_id, user_id, staff_id, staff_name, raw_value, barcode, input, scanned_at, client_scanned_at, day, device_id';
    const VALS = '?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13';
    if (!BARCODE_PATTERN.test(barcode)) {
      await db.run(`INSERT INTO scan_logs (${COLS}, result, reason) VALUES (${VALS}, 'error', ?14) ON CONFLICT (company_id, client_scan_id) DO NOTHING`,
        ...base, '読み取り値の形式が正しくありません（英数字 4〜40 文字）');
    } else {
      const col = settings.match_field === 'global_no' ? 'global_no' : 'barcode_global_no';
      // 結果は「この瞬間の明細の状態」から同じ文の中で決める（docs/scan-matching.md §5）。明細がなければ 0 行
      const r = await db.run(
        `INSERT INTO scan_logs (${COLS}, order_item_id, location_id, result, reason)
         SELECT ${VALS}, oi.id, oi.location_id,
                CASE WHEN oi.status IN ('review', 'cancelled') THEN 'review'
                     WHEN ?15 = 1 AND oi.ssd IS NOT NULL AND oi.ssd <> ?16 AND oi.status = 'pending' THEN 'review'
                     WHEN oi.status = 'pending' AND oi.scan_count < oi.required_scans THEN 'ok'
                     WHEN oi.required_scans = 1 THEN 'duplicate'
                     ELSE 'over_quantity' END,
                CASE WHEN oi.status = 'cancelled' THEN '取消になった明細です。管理者に確認してください'
                     WHEN oi.status = 'review' THEN '要確認の明細です。管理者に確認してください'
                     WHEN ?15 = 1 AND oi.ssd IS NOT NULL AND oi.ssd <> ?16 AND oi.status = 'pending'
                       THEN 'メーカー納期が ' || substr(oi.ssd, 6, 2) || '/' || substr(oi.ssd, 9, 2) || ' の明細です。選んでいる日（'
                            || substr(?16, 6, 2) || '/' || substr(?16, 9, 2) || '）の出荷か確認してください'
                     ELSE NULL END
           FROM order_items oi WHERE oi.company_id = ?1 AND oi.${col} = ?14
         ON CONFLICT (company_id, client_scan_id) DO NOTHING`,
        ...base, barcode, settings.warn_ship_date_mismatch ? 1 : 0, boardSsd ?? day,
      );
      if (!r.meta.changes) {
        // 明細がない（または同時に届いた再送が先に記録した）。未登録として記録する
        await db.run(`INSERT INTO scan_logs (${COLS}, result) VALUES (${VALS}, 'not_found') ON CONFLICT (company_id, client_scan_id) DO NOTHING`, ...base);
      }
    }
  }

  // 確定した記録を読み直して返す（再送なら前回の結果）
  const log = already ?? await db.first<ScanRow>('SELECT * FROM scan_logs WHERE company_id = ?1 AND client_scan_id = ?2', clientScanId);
  if (!log) throw new Error('scan log not found after insert');
  const item = log.order_item_id ? await itemSummary(db, log.order_item_id) : null;
  // 読み取り済みのときは、最初に照合した日時と担当者を出す
  const previous = log.result === 'duplicate' || log.result === 'over_quantity'
    ? await db.first<{ scanned_at: string; staff_name: string }>(
      "SELECT scanned_at, staff_name FROM scan_logs WHERE company_id = ?1 AND order_item_id = ?2 AND result = 'ok' ORDER BY id LIMIT 1", log.order_item_id)
    : null;
  return c.json({
    scan_id: log.id, result: log.result, message: log.reason ?? MESSAGES[log.result] ?? '', barcode: log.barcode, input: log.input,
    scanned_at: log.scanned_at, staff_name: log.staff_name, replay: !!already, item, previous,
  });
});

// ---------- 置場別チェック（画面の一覧） ----------

/** 選べるメーカー納期（メーカー出荷日 SSD。今日の 7 日前から先、最大 30 日分）。現場はメーカー納期で管理している */
scanRoutes.get('/scan-board/dates', async (c) => {
  authorize(c, 'orders.view');
  const db = scoped(c);
  const from = jstDay(Date.now() - 7 * 86_400_000);
  const rows = await db.all<{ ssd: string; total: number; pending: number }>(
    `SELECT ssd, COUNT(*) AS total, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM order_items WHERE company_id = ?1 AND ssd >= ?2 GROUP BY ssd ORDER BY ssd LIMIT 30`, from);
  return c.json({ today: jstDay(), items: rows });
});

const BOARD_MAX = 2000;

scanRoutes.get('/scan-board', async (c) => {
  authorize(c, 'orders.view');
  const db = scoped(c);
  const ssd = c.req.query('ssd') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ssd)) throw new HttpError(422, 'メーカー納期の指定が正しくありません。');
  const locationId = Number(c.req.query('location_id') ?? 0) || 0;
  // 置場ごとの件数（タブ）。照合済み = matched
  const tabs = await db.all<{ location_id: number | null; code: string | null; name: string | null; total: number; done: number; qty: number; weight: number }>(
    `SELECT oi.location_id, l.code, l.name, COUNT(*) AS total, SUM(CASE WHEN oi.status = 'matched' THEN 1 ELSE 0 END) AS done,
            SUM(oi.quantity) AS qty, COALESCE(SUM(oi.total_weight), 0) AS weight
       FROM order_items oi LEFT JOIN locations l ON l.company_id = oi.company_id AND l.id = oi.location_id
      WHERE oi.company_id = ?1 AND oi.ssd = ?2 AND oi.status <> 'cancelled'
      GROUP BY oi.location_id ORDER BY l.code`, ssd);
  // 利用中の置場は、その日の注文がなくてもタブに出す（0 / 0）
  const locations = await db.all<{ id: number; code: string; name: string }>("SELECT id, code, name FROM locations WHERE company_id = ?1 AND status = 'active' ORDER BY code");
  const merged = locations.map((l) => {
    const t = tabs.find((x) => x.location_id === l.id);
    return { location_id: l.id, code: l.code, name: l.name, total: t?.total ?? 0, done: t?.done ?? 0, qty: t?.qty ?? 0, weight: t?.weight ?? 0 };
  });
  const selected = locationId || merged.find((m) => m.total > m.done)?.location_id || merged.find((m) => m.total)?.location_id || merged[0]?.location_id || 0;
  const items = selected ? await db.all(
    `SELECT oi.id, oi.global_no, oi.barcode_global_no, oi.ssd, oi.vrd, oi.ship_method, oi.product_code, oi.product_name, oi.location_code,
            oi.quantity, oi.unit_weight, oi.total_weight, oi.status, oi.scan_count, oi.required_scans, oi.customer_name, oi.destination_name,
            oi.matched_at, s.name AS matched_staff_name
       FROM order_items oi LEFT JOIN staff s ON s.company_id = oi.company_id AND s.id = oi.matched_staff_id
      WHERE oi.company_id = ?1 AND oi.ssd = ?2 AND oi.location_id = ?3 AND oi.status <> 'cancelled'
      ORDER BY oi.global_no LIMIT ?4`, ssd, selected, BOARD_MAX) : [];
  return c.json({ ssd, location_id: selected, tabs: merged, items, truncated: items.length >= BOARD_MAX });
});

/** 今日の件数（読み取りバーの下・ホーム）。集計表から読むので軽い */
scanRoutes.get('/scans/today', async (c) => {
  authorize(c, 'scan');
  const db = scoped(c);
  const rows = await db.all<{ result: string; n: number }>(
    'SELECT result, SUM(count) AS n FROM daily_scan_stats WHERE company_id = ?1 AND day = ?2 GROUP BY result', jstDay());
  const n = (r: string) => rows.find((x) => x.result === r)?.n ?? 0;
  return c.json({ day: jstDay(), total: rows.reduce((s, r) => s + r.n, 0), ok: n('ok'), duplicate: n('duplicate') + n('over_quantity'), review: n('review'), error: n('not_found') + n('error') });
});
