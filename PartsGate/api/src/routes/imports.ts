import { Hono } from 'hono';
import {
  IMPORT_CHUNK, IMPORT_FIELDS, IMPORT_MAX_BYTES, LOOKUP_CHUNK, classify, normalizeItem, rowHash,
  type ExistingItem, type ImportItem, type ImportKind, type RawItem,
} from '@partsgate/shared';
import type { AppEnv } from '../types';
import { scoped, type Scoped } from '../lib/db';
import { authorize, idParam } from '../lib/guard';
import { HttpError, conflict, notFound, readJson } from '../lib/http';
import { auditStatement } from '../lib/audit';
import { decodeCursor, encodeCursor } from '../lib/cursor';
import { nowIso } from '../lib/crypto';
import { readSettings } from './settings';

/**
 * CSV 取込（docs/csv-import.md）。
 *  ① 画面が CSV を読んで検証し、POST /imports/lookup で登録済みの明細を照会してプレビューを出す（DB には書かない）
 *  ② 確定したら POST /imports で元のファイルを R2 に保存し、取込回を作る
 *  ③ POST /imports/:id/rows に 200 行ずつ送る。API は検証と区分の判定をやり直してから登録する（画面の結果を信用しない）
 *  ④ POST /imports/:id/commit で件数を確定する
 *
 * 無料プランの制限（CPU 1 回 10ms・D1 の問い合わせ 1 回 50 本）に収めるため、200 行を json_each で数本の SQL にまとめる。
 * 読み取り履歴（scan_logs）には一切触れない。取り込み直しても読み取りの記録は変わらない。
 */
export const importRoutes = new Hono<AppEnv>();

/** 放置された「登録中」の取込回を中止扱いにするまでの時間 */
const STALE_MS = 30 * 60_000;

/** 照会で返す列（取り込む項目＋変更の判定に使う値）。伝票番号だけは orders にある */
const LOOKUP_COLS = [
  ...IMPORT_FIELDS.map((f) => (f === 'slip_no' ? 'o.slip_no' : `oi.${f}`)),
  'oi.row_hash', 'oi.status',
].join(', ');

interface ExistingFull extends ExistingItem { [k: string]: unknown }

async function lookupExisting(db: Scoped, globalNos: string[], barcodes: string[]) {
  const [byGlobal, byBarcode] = await Promise.all([
    db.all<ExistingFull>(
      `SELECT ${LOOKUP_COLS}
         FROM order_items oi JOIN orders o ON o.company_id = oi.company_id AND o.id = oi.order_id
        WHERE oi.company_id = ?1 AND oi.global_no IN (SELECT value FROM json_each(?2))`,
      JSON.stringify(globalNos),
    ),
    db.all<{ barcode_global_no: string; global_no: string }>(
      'SELECT barcode_global_no, global_no FROM order_items WHERE company_id = ?1 AND barcode_global_no IN (SELECT value FROM json_each(?2))',
      JSON.stringify(barcodes),
    ),
  ]);
  return {
    existing: new Map(byGlobal.map((r) => [r.global_no, r])),
    barcodeOwner: new Map(byBarcode.map((r) => [r.barcode_global_no, r.global_no])),
  };
}

async function activeLocationCodes(db: Scoped): Promise<Set<string>> {
  const rows = await db.all<{ code: string }>("SELECT code FROM locations WHERE company_id = ?1 AND status = 'active'");
  return new Set(rows.map((r) => r.code));
}

function strArray(v: unknown, max: number, label: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max || v.some((x) => typeof x !== 'string' || x.length > 64)) {
    throw new HttpError(422, `${label}の形式が正しくありません（${max} 件まで）。`);
  }
  return [...new Set(v as string[])];
}

// ---------- ① 照会（プレビュー用。DB には書かない） ----------
importRoutes.post('/imports/lookup', async (c) => {
  authorize(c, 'import');
  const db = scoped(c);
  const body = await readJson(c.req.raw);
  const globalNos = strArray(body.global_nos, LOOKUP_CHUNK, 'グローバル番号');
  const barcodes = strArray(body.barcodes, LOOKUP_CHUNK, 'バーコード用グローバル番号');
  const pairs = body.destinations;
  if (pairs !== undefined && (!Array.isArray(pairs) || pairs.length > LOOKUP_CHUNK || pairs.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((x) => typeof x !== 'string')))) {
    throw new HttpError(422, `納品先の形式が正しくありません（${LOOKUP_CHUNK} 件まで）。`);
  }
  const { existing, barcodeOwner } = await lookupExisting(db, globalNos, barcodes);
  const dests = pairs?.length
    ? await db.all<{ customer_code: string; code: string }>(
      `SELECT customer_code, code FROM destinations WHERE company_id = ?1 AND status = 'active'
          AND (customer_code, code) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?2))`,
      JSON.stringify(pairs),
    )
    : [];
  return c.json({
    items: [...existing.values()],
    barcode_owners: [...barcodeOwner.entries()].map(([barcode_global_no, global_no]) => ({ barcode_global_no, global_no })),
    destinations: dests,
    locations: [...await activeLocationCodes(db)],
  });
});

// ---------- ② 取込回を作る（元のファイルを R2 に保存） ----------
importRoutes.post('/imports', async (c) => {
  authorize(c, 'import');
  const db = scoped(c);
  const auth = c.get('auth');
  const fileName = decodeURIComponent(c.req.header('X-File-Name') ?? '').slice(0, 200);
  const sha = (c.req.header('X-File-Sha256') ?? '').toLowerCase();
  const encoding = c.req.header('X-Encoding');
  const length = Number(c.req.header('Content-Length') ?? 0);
  if (!fileName || !/\.csv$/i.test(fileName)) throw new HttpError(422, 'CSV ファイル（.csv）を選んでください。');
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new HttpError(422, 'ファイルの確認用の値が正しくありません。画面を読み込み直してください。');
  if (encoding !== 'shift_jis' && encoding !== 'utf-8') throw new HttpError(422, '文字コードの指定が正しくありません。');
  if (!length) throw new HttpError(422, 'ファイルが空です。');
  if (length > IMPORT_MAX_BYTES) throw new HttpError(413, 'ファイルが大きすぎます（10MB まで）。');

  // 30 分以上放置された「登録中」は中止扱いにする。それ以外の「登録中」があれば、同時に 2 つは取り込ませない
  const now = nowIso();
  await db.run("UPDATE import_batches SET status = 'aborted' WHERE company_id = ?1 AND status = 'uploading' AND created_at < ?2",
    new Date(Date.now() - STALE_MS).toISOString());
  const busy = await db.first<{ id: number }>("SELECT id FROM import_batches WHERE company_id = ?1 AND status = 'uploading' LIMIT 1");
  if (busy) throw new HttpError(409, 'ほかの取込が進行中です。終わってから、もう一度お試しください（30 分たつと自動で中止になります）。');

  const key = `imports/${auth.companyId}/${now.slice(0, 4)}/${crypto.randomUUID()}.csv`;
  if (!c.req.raw.body) throw new HttpError(422, 'ファイルが空です。');
  await c.env.FILES.put(key, c.req.raw.body, {
    httpMetadata: { contentType: encoding === 'shift_jis' ? 'text/csv; charset=Shift_JIS' : 'text/csv; charset=utf-8' },
    customMetadata: { fileName: encodeURIComponent(fileName), companyId: String(auth.companyId) },
  });
  const [ins] = await db.batch([
    db.stmt(`INSERT INTO import_batches (company_id, file_name, file_sha256, r2_key, encoding, status, created_by, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'uploading', ?6, ?7) RETURNING id`, fileName, sha, key, encoding, auth.user.id, now),
  ]);
  const id = (ins?.results?.[0] as { id: number } | undefined)?.id;
  if (!id) throw new Error('import batch insert failed');
  return c.json({ id }, 201);
});

// ---------- ③ 200 行ずつ登録 ----------
interface RowResult { line_no: number; global_no: string | null; kind: ImportKind; message: string | null; diff: Record<string, [unknown, unknown]> | null }

importRoutes.post('/imports/:id/rows', async (c) => {
  authorize(c, 'import');
  const db = scoped(c);
  const batchId = idParam(c);
  const body = await readJson(c.req.raw);
  const raws = body.rows;
  if (!Array.isArray(raws) || raws.length === 0 || raws.length > IMPORT_CHUNK) {
    throw new HttpError(422, `行は 1〜${IMPORT_CHUNK} 行ずつ送ってください。`);
  }
  const batch = await db.first<{ status: string }>('SELECT status FROM import_batches WHERE company_id = ?1 AND id = ?2', batchId);
  if (!batch) throw notFound();
  if (batch.status !== 'uploading') throw new HttpError(409, 'この取込はすでに確定または中止されています。');

  // 1. 検証（画面と同じ関数でやり直す）
  const results: RowResult[] = [];
  const valid: { item: ImportItem; hash: string }[] = [];
  const seenGlobal = new Set<string>();
  const seenBarcode = new Map<string, string>();
  for (const r of raws as unknown[]) {
    const raw = (r && typeof r === 'object' ? r : {}) as RawItem;
    const lineNo = Number(raw.line_no);
    if (!Number.isInteger(lineNo) || lineNo < 1) throw new HttpError(422, '行番号が正しくありません。');
    const clean: RawItem = { line_no: lineNo };
    for (const f of IMPORT_FIELDS) { const v = (raw as Record<string, unknown>)[f]; if (typeof v === 'string') clean[f] = v.slice(0, 300); }
    const { item, errors } = normalizeItem(clean);
    if (!item) { results.push({ line_no: lineNo, global_no: clean.global_no ?? null, kind: 'error', message: errors.join(' / '), diff: null }); continue; }
    // 同じ回の中での重複（ファイル全体の重複は画面でも確かめている）
    const owner = seenBarcode.get(item.barcode_global_no);
    if (seenGlobal.has(item.global_no) || (owner && owner !== item.global_no)) {
      results.push({ line_no: lineNo, global_no: item.global_no, kind: 'error', message: '同じファイルの中で、グローバル番号またはバーコード用グローバル番号が重複しています', diff: null });
      continue;
    }
    seenGlobal.add(item.global_no);
    seenBarcode.set(item.barcode_global_no, item.global_no);
    valid.push({ item, hash: await rowHash(item) });
  }

  // 2. 登録済みの明細・置場・設定を照会して区分を決める
  const { existing, barcodeOwner } = await lookupExisting(db, valid.map((v) => v.item.global_no), valid.map((v) => v.item.barcode_global_no));
  const locations = await activeLocationCodes(db);
  const settings = await readSettings(db);
  const upserts: (ImportItem & { row_hash: string; required_scans: number })[] = [];
  for (const { item, hash } of valid) {
    const ex = existing.get(item.global_no);
    const { kind, message } = classify(item, hash, ex, barcodeOwner.get(item.barcode_global_no), locations);
    let diff: RowResult['diff'] = null;
    if (kind === 'updated' || (kind === 'review' && ex)) {
      diff = {};
      for (const f of IMPORT_FIELDS) {
        const before = ex?.[f] ?? null;
        const after = item[f] ?? null;
        if (before !== after) diff[f] = [before, after];
      }
    }
    results.push({ line_no: item.line_no, global_no: item.global_no, kind, message, diff });
    if (kind === 'new' || kind === 'updated') {
      upserts.push({ ...item, row_hash: hash, required_scans: settings.scans_per_item === 'quantity' ? item.quantity : 1 });
    }
  }

  // 3. まとめて登録（伝票 → 明細 → 伝票の件数 → 行ごとの記録）
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  if (upserts.length) {
    const slips = new Map<string, { slip_no: string; customer_code: string; customer_name: string | null }>();
    for (const u of upserts) slips.set(u.slip_no, { slip_no: u.slip_no, customer_code: u.customer_code, customer_name: u.customer_name });
    statements.push(db.stmt(
      `INSERT INTO orders (company_id, slip_no, customer_code, customer_name, created_at, updated_at)
       SELECT ?1, json_extract(value, '$.slip_no'), json_extract(value, '$.customer_code'), json_extract(value, '$.customer_name'), ?3, ?3
         FROM json_each(?2) WHERE true
       ON CONFLICT (company_id, slip_no) DO UPDATE SET customer_code = excluded.customer_code, customer_name = excluded.customer_name, updated_at = excluded.updated_at`,
      JSON.stringify([...slips.values()]), now,
    ));
    const j = (f: string) => `json_extract(value, '$.${f}')`;
    statements.push(db.stmt(
      `INSERT INTO order_items (company_id, order_id, global_no, barcode_global_no, product_code, product_name, quantity, required_scans,
          customer_code, customer_name, destination_id, destination_code, destination_name, customer_order_no, location_id, location_code,
          ssd, vrd, order_date, ship_method, export_type, unit_weight, total_weight, packing_line, data_kind, row_hash, last_import_id, created_at, updated_at)
       SELECT ?1,
              (SELECT o.id FROM orders o WHERE o.company_id = ?1 AND o.slip_no = ${j('slip_no')}),
              ${j('global_no')}, ${j('barcode_global_no')}, ${j('product_code')}, ${j('product_name')}, ${j('quantity')}, ${j('required_scans')},
              ${j('customer_code')}, ${j('customer_name')},
              (SELECT d.id FROM destinations d WHERE d.company_id = ?1 AND d.customer_code = ${j('customer_code')} AND d.code = ${j('destination_code')}),
              ${j('destination_code')}, ${j('destination_name')}, ${j('customer_order_no')},
              (SELECT l.id FROM locations l WHERE l.company_id = ?1 AND l.code = ${j('location_code')}),
              ${j('location_code')}, ${j('ssd')}, ${j('vrd')}, ${j('order_date')}, ${j('ship_method')}, ${j('export_type')},
              ${j('unit_weight')}, ${j('total_weight')}, ${j('packing_line')}, ${j('data_kind')}, ${j('row_hash')}, ?3, ?4, ?4
         FROM json_each(?2) WHERE true
       ON CONFLICT (company_id, global_no) DO UPDATE SET
          order_id = excluded.order_id, barcode_global_no = excluded.barcode_global_no, product_code = excluded.product_code, product_name = excluded.product_name,
          quantity = excluded.quantity, required_scans = excluded.required_scans, customer_code = excluded.customer_code, customer_name = excluded.customer_name,
          destination_id = excluded.destination_id, destination_code = excluded.destination_code, destination_name = excluded.destination_name,
          customer_order_no = excluded.customer_order_no, location_id = excluded.location_id, location_code = excluded.location_code,
          ssd = excluded.ssd, vrd = excluded.vrd, order_date = excluded.order_date, ship_method = excluded.ship_method, export_type = excluded.export_type,
          unit_weight = excluded.unit_weight, total_weight = excluded.total_weight, packing_line = excluded.packing_line, data_kind = excluded.data_kind,
          row_hash = excluded.row_hash, last_import_id = excluded.last_import_id, updated_at = excluded.updated_at
        WHERE order_items.status = 'pending' AND order_items.row_hash <> excluded.row_hash`,
      JSON.stringify(upserts), batchId, now,
    ));
    // 伝票の明細数・照合済み数を数え直す（伝票番号が変わった明細の元の伝票も含める）
    const oldSlips = upserts.map((u) => existing.get(u.global_no)?.slip_no).filter((s): s is string => typeof s === 'string');
    statements.push(db.stmt(
      `UPDATE orders SET
          item_count = (SELECT COUNT(*) FROM order_items x WHERE x.company_id = orders.company_id AND x.order_id = orders.id),
          matched_count = (SELECT COUNT(*) FROM order_items x WHERE x.company_id = orders.company_id AND x.order_id = orders.id AND x.status = 'matched'),
          updated_at = ?3
        WHERE company_id = ?1 AND slip_no IN (SELECT value FROM json_each(?2))`,
      JSON.stringify([...new Set([...slips.keys(), ...oldSlips])]), now,
    ));
  }
  // 行ごとの記録。再送された行は最初の記録を残す（件数を二重に数えない）
  statements.push(db.stmt(
    `INSERT INTO import_rows (company_id, batch_id, line_no, global_no, kind, message, diff_json)
     SELECT ?1, ?2, json_extract(value, '$.line_no'), json_extract(value, '$.global_no'), json_extract(value, '$.kind'),
            json_extract(value, '$.message'), json_extract(value, '$.diff')
       FROM json_each(?3) WHERE true
     ON CONFLICT (batch_id, line_no) DO NOTHING`,
    batchId, JSON.stringify(results.map((r) => ({ ...r, diff: r.diff && Object.keys(r.diff).length ? JSON.stringify(r.diff) : null }))),
  ));
  try {
    await db.batch(statements);
  } catch (e) {
    // 別の取込・画面で同時にバーコードが登録された場合など
    if (e instanceof Error && /UNIQUE constraint failed/i.test(e.message)) {
      throw new HttpError(409, 'ほかの操作と重なったため登録できませんでした。もう一度「確認する」からやり直してください。');
    }
    throw e;
  }
  const counts = Object.fromEntries(['new', 'updated', 'unchanged', 'review', 'error'].map((k) => [k, results.filter((r) => r.kind === k).length]));
  return c.json({ counts, rows: results.filter((r) => r.kind === 'error' || r.kind === 'review') });
});

// ---------- ④ 確定・中止 ----------
const BATCH_COLS = `b.id, b.file_name, b.file_sha256, b.encoding, b.status, b.row_total, b.row_new, b.row_updated, b.row_unchanged, b.row_error, b.row_review,
  b.created_at, b.committed_at, u.name AS created_by_name`;

async function getBatch(db: Scoped, id: number) {
  return db.first<Record<string, unknown>>(
    `SELECT ${BATCH_COLS} FROM import_batches b LEFT JOIN users u ON u.company_id = b.company_id AND u.id = b.created_by WHERE b.company_id = ?1 AND b.id = ?2`, id);
}

importRoutes.post('/imports/:id/commit', async (c) => {
  authorize(c, 'import');
  const db = scoped(c);
  const id = idParam(c);
  const body = await readJson(c.req.raw);
  const expected = Number(body.expected_rows);
  if (!Number.isInteger(expected) || expected < 1) throw new HttpError(422, '行数の指定が正しくありません。');
  const batch = await db.first<{ status: string }>('SELECT status FROM import_batches WHERE company_id = ?1 AND id = ?2', id);
  if (!batch) throw notFound();
  if (batch.status !== 'uploading') throw new HttpError(409, 'この取込はすでに確定または中止されています。');
  const rows = await db.all<{ kind: ImportKind; n: number }>('SELECT kind, COUNT(*) AS n FROM import_rows WHERE company_id = ?1 AND batch_id = ?2 GROUP BY kind', id);
  const n = (k: ImportKind) => rows.find((r) => r.kind === k)?.n ?? 0;
  const total = rows.reduce((s, r) => s + r.n, 0);
  if (total !== expected) {
    throw new HttpError(409, `送った行の一部が届いていません（${expected} 行のうち ${total} 行）。もう一度「登録する」を押してください。`);
  }
  const now = nowIso();
  const [res] = await db.batch([
    db.stmt(`UPDATE import_batches SET status = 'committed', row_total = ?3, row_new = ?4, row_updated = ?5, row_unchanged = ?6, row_error = ?7, row_review = ?8, committed_at = ?9
              WHERE company_id = ?1 AND id = ?2 AND status = 'uploading'`, id, total, n('new'), n('updated'), n('unchanged'), n('error'), n('review'), now),
    auditStatement(c, { action: 'import.commit', targetType: 'import', targetId: id, detail: { total, new: n('new'), updated: n('updated'), unchanged: n('unchanged'), review: n('review'), error: n('error') } },
      { sql: "SELECT 1 FROM import_batches WHERE company_id = ? AND id = ? AND status = 'committed' AND committed_at = ?", params: [db.companyId, id, now] }),
  ]);
  if (!res?.meta.changes) throw conflict('この取込はすでに確定または中止されています。');
  return c.json(await getBatch(db, id));
});

importRoutes.post('/imports/:id/abort', async (c) => {
  authorize(c, 'import');
  const db = scoped(c);
  const id = idParam(c);
  const res = await db.run("UPDATE import_batches SET status = 'aborted' WHERE company_id = ?1 AND id = ?2 AND status = 'uploading'", id);
  if (!res.meta.changes) {
    if (!(await db.first('SELECT 1 FROM import_batches WHERE company_id = ?1 AND id = ?2', id))) throw notFound();
    throw new HttpError(409, 'この取込はすでに確定または中止されています。');
  }
  // 途中まで登録した明細はそのまま残る（1 行ずつ冪等なので、同じ CSV を取り込み直せば続きから登録される）
  return c.json(await getBatch(db, id));
});

// ---------- 取込履歴 ----------
importRoutes.get('/imports', async (c) => {
  authorize(c, 'import');
  const db = scoped(c);
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 30) || 30, 1), 100);
  const sha = (c.req.query('sha') ?? '').toLowerCase();
  const cursor = c.req.query('cursor');
  const after = cursor ? decodeCursor(cursor, 2) : null;
  const params: unknown[] = [];
  const bind = (v: unknown) => { params.push(v); return `?${params.length + 1}`; };
  const where = ['b.company_id = ?1'];
  if (/^[0-9a-f]{64}$/.test(sha)) where.push(`b.file_sha256 = ${bind(sha)} AND b.status = 'committed'`);
  if (after) where.push(`(b.created_at, b.id) < (${bind(after[0])}, ${bind(Number(after[1]))})`);
  const rows = await db.all<{ id: number; created_at: string }>(
    `SELECT ${BATCH_COLS} FROM import_batches b LEFT JOIN users u ON u.company_id = b.company_id AND u.id = b.created_by
      WHERE ${where.join(' AND ')} ORDER BY b.created_at DESC, b.id DESC LIMIT ${bind(limit + 1)}`, ...params);
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return c.json({ items, next_cursor: more && last ? encodeCursor([last.created_at, String(last.id)]) : null });
});

importRoutes.get('/imports/:id', async (c) => {
  authorize(c, 'import');
  const b = await getBatch(scoped(c), idParam(c));
  if (!b) throw notFound();
  return c.json(b);
});

importRoutes.get('/imports/:id/rows', async (c) => {
  authorize(c, 'import');
  const db = scoped(c);
  const id = idParam(c);
  if (!(await db.first('SELECT 1 FROM import_batches WHERE company_id = ?1 AND id = ?2', id))) throw notFound();
  const kind = c.req.query('kind');
  const after = Number(c.req.query('after') ?? 0) || 0;
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100) || 100, 1), 500);
  const kinds = ['new', 'updated', 'unchanged', 'review', 'error'];
  const rows = await db.all<{ line_no: number }>(
    `SELECT line_no, global_no, kind, message, diff_json FROM import_rows
      WHERE company_id = ?1 AND batch_id = ?2 ${kind && kinds.includes(kind) ? 'AND kind = ?5' : ''} AND line_no > ?3
      ORDER BY line_no LIMIT ?4`,
    id, after, limit + 1, ...(kind && kinds.includes(kind) ? [kind] : []),
  );
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  return c.json({ items, next_after: more ? items[items.length - 1]!.line_no : null });
});

importRoutes.get('/imports/:id/file', async (c) => {
  authorize(c, 'import');
  const db = scoped(c);
  // R2 のキーは画面から受け取らず、会社で絞った取込回から引く（docs/security.md §1-1）
  const b = await db.first<{ r2_key: string; file_name: string }>('SELECT r2_key, file_name FROM import_batches WHERE company_id = ?1 AND id = ?2', idParam(c));
  if (!b) throw notFound();
  const obj = await c.env.FILES.get(b.r2_key);
  if (!obj) throw notFound('元のファイルが見つかりません。');
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'text/csv',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(b.file_name)}`,
      'Cache-Control': 'no-store',
    },
  });
});
