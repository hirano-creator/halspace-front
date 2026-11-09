import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from './helpers';

/**
 * スキーマ（api/migrations）のテスト。照合の数え上げは scan_logs への 1 回の INSERT とトリガーで行う
 * （docs/scan-matching.md §5）。ここで同時読み取り・再送・訂正の動きを DB だけで確かめる。
 */

const NOW = '2026-11-05T01:00:00.000Z';

/** 照合 API（STEP 6）が使う予定の INSERT 文と同じ形。結果は「この瞬間の明細の状態」から同じ文の中で決める */
const SCAN_SQL = `
INSERT INTO scan_logs (company_id, client_scan_id, work_session_id, user_id, staff_id, staff_name, raw_value, barcode, order_item_id, result, location_id, scanned_at, day, device_id)
SELECT ?1, ?2, 1, 1, 1, '山田 太郎', ?3, ?3, oi.id,
       CASE WHEN oi.status = 'pending' AND oi.scan_count < oi.required_scans THEN 'ok' ELSE 'duplicate' END,
       oi.location_id, ?4, '2026-11-05', 'dev-pc'
  FROM order_items oi WHERE oi.company_id = ?1 AND oi.barcode_global_no = ?3
ON CONFLICT (company_id, client_scan_id) DO NOTHING`;

const scan = (clientId: string, barcode: string, companyId = 1) =>
  env.DB.prepare(SCAN_SQL).bind(companyId, clientId, barcode, NOW).run();

beforeAll(async () => {
  await sql("INSERT INTO import_batches (id, company_id, file_name, file_sha256, r2_key, encoding, status, created_by, created_at) VALUES (800, 1, 's.csv', 'x', 'k', 'utf-8', 'uploading', 1, ?)", NOW);
  await sql("INSERT INTO orders (id, company_id, slip_no, item_count, created_at, updated_at) VALUES (800, 1, 'SLIP-S', 2, ?, ?)", NOW, NOW);
  for (const [g, req] of [['G-ONE', 1], ['G-TWO', 1], ['G-QTY', 3]] as const) {
    await sql(`INSERT INTO order_items (company_id, order_id, global_no, barcode_global_no, product_code, quantity, required_scans, location_id, location_code, row_hash, last_import_id, created_at, updated_at)
               VALUES (1, 800, ?, ?, 'P', ?, ?, 3, '0055', 'h', 800, ?, ?)`, g, g, req, req, NOW, NOW);
  }
  await sql("INSERT INTO work_sessions (id, company_id, user_id, staff_id, staff_name, device_id, started_at) VALUES (1, 1, 1, 1, '山田 太郎', 'dev-pc', ?)", NOW);
  // 行ごとのトリガーは対象の行がないと動かないので、書き換え拒否の確認用に 1 件入れておく
  await sql("INSERT INTO audit_logs (company_id, action, created_at) VALUES (1, 'test.seed', ?)", NOW);
});

describe('読み取りの数え上げ', () => {
  it('同じラベルを 20 台で同時に読んでも、正常は 1 回だけ', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => scan(`c-one-${i}`, 'G-ONE')));
    const rows = await sql<{ result: string; n: number }>("SELECT result, COUNT(*) AS n FROM scan_logs WHERE barcode = 'G-ONE' GROUP BY result ORDER BY result");
    expect(rows).toEqual([{ result: 'duplicate', n: 19 }, { result: 'ok', n: 1 }]);
    const [item] = await sql<{ scan_count: number; status: string }>("SELECT scan_count, status FROM order_items WHERE global_no = 'G-ONE'");
    expect(item).toEqual({ scan_count: 1, status: 'matched' });
  });

  it('同じ読み取りの再送が同時に 10 本届いても、記録は 1 件で二重に数えない', async () => {
    await Promise.all(Array.from({ length: 10 }, () => scan('c-retry', 'G-TWO')));
    expect(await sql("SELECT id FROM scan_logs WHERE client_scan_id = 'c-retry'")).toHaveLength(1);
    const [item] = await sql<{ scan_count: number }>("SELECT scan_count FROM order_items WHERE global_no = 'G-TWO'");
    expect(item?.scan_count).toBe(1);
  });

  it('数量分ラベルがある明細は、必要回数を超えて数えない', async () => {
    await Promise.all(Array.from({ length: 6 }, (_, i) => scan(`c-qty-${i}`, 'G-QTY')));
    const [item] = await sql<{ scan_count: number; status: string }>("SELECT scan_count, status FROM order_items WHERE global_no = 'G-QTY'");
    expect(item).toEqual({ scan_count: 3, status: 'matched' });
  });

  it('伝票の照合済み数と、集計表が合っている', async () => {
    const [o] = await sql<{ matched_count: number }>('SELECT matched_count FROM orders WHERE id = 800');
    expect(o?.matched_count).toBe(3);
    const stats = await sql<{ result: string; count: number }>("SELECT result, count FROM daily_scan_stats WHERE company_id = 1 AND day = '2026-11-05' ORDER BY result");
    const logs = await sql<{ result: string; n: number }>("SELECT result, COUNT(*) AS n FROM scan_logs WHERE company_id = 1 AND day = '2026-11-05' GROUP BY result ORDER BY result");
    expect(stats.map((s) => [s.result, s.count])).toEqual(logs.map((l) => [l.result, l.n]));
  });

  it('他社の番号は自分の会社の明細に当たらない', async () => {
    const r = await scan('c-other', 'G-ONE', 2);
    expect(r.meta.changes).toBe(0); // 会社 2 に G-ONE はない（照合 API では「未登録」として記録する）
  });

  it('正常だった読み取りを取り消すと、明細の数が戻る（訂正は追記）', async () => {
    const [ok] = await sql<{ id: number }>("SELECT id FROM scan_logs WHERE barcode = 'G-ONE' AND result = 'ok'");
    await sql("INSERT INTO scan_corrections (company_id, scan_log_id, user_id, action, reason, created_at) VALUES (1, ?, 1, 'void', '読み間違い', ?)", ok!.id, NOW);
    const [item] = await sql<{ scan_count: number; status: string }>("SELECT scan_count, status FROM order_items WHERE global_no = 'G-ONE'");
    expect(item).toEqual({ scan_count: 0, status: 'pending' });
    // 同じ読み取りを 2 回取り消すことはできない
    await expect(sql("INSERT INTO scan_corrections (company_id, scan_log_id, user_id, action, reason, created_at) VALUES (1, ?, 1, 'void', '二重', ?)", ok!.id, NOW)).rejects.toThrow();
  });
});

describe('書き換え・削除の拒否', () => {
  it.each([
    ['UPDATE scan_logs SET result = \'ok\''],
    ['DELETE FROM scan_logs'],
    ['UPDATE audit_logs SET action = \'x\''],
    ['DELETE FROM audit_logs'],
    ['DELETE FROM scan_corrections'],
    ['DELETE FROM order_items'],
    ['DELETE FROM orders'],
    ['DELETE FROM staff'],
    ['DELETE FROM users'],
    ['DELETE FROM companies'],
  ])('%s は拒否される', async (q) => {
    await expect(sql(q)).rejects.toThrow();
  });

  it('会社をまたぐ参照は外部キーで拒否される（会社 1 の明細に会社 2 の置場）', async () => {
    await expect(sql(`INSERT INTO order_items (company_id, order_id, global_no, barcode_global_no, product_code, quantity, location_id, location_code, row_hash, last_import_id, created_at, updated_at)
                      VALUES (1, 800, 'G-FK', 'G-FK', 'P', 1, 11, 'A1', 'h', 800, ?, ?)`, NOW, NOW)).rejects.toThrow();
  });
});

describe('索引（全件走査をしない）', () => {
  it.each([
    ["SELECT id FROM order_items WHERE company_id = 1 AND barcode_global_no = 'x'"],
    ["SELECT id FROM order_items WHERE company_id = 1 AND vrd = '2026-11-06' AND location_id = 3"],
    // 置場別チェックの一覧（読み取りのたびに読む）。並べ替えの索引に引っ張られて会社の全件を読んでいた（migrations/0004）
    ["SELECT oi.id FROM order_items oi WHERE oi.company_id = 1 AND oi.ssd = '2026-11-06' AND oi.location_id = 3 AND oi.status <> 'cancelled' ORDER BY oi.global_no LIMIT 2000"],
    // 一覧のタブ（メーカー納期ごとの置場別件数）と、選べるメーカー納期（2026-11-09 にミスミ納期からメーカー納期へ変更。migrations/0005）
    ["SELECT oi.location_id, COUNT(*) FROM order_items oi WHERE oi.company_id = 1 AND oi.ssd = '2026-11-06' AND oi.status <> 'cancelled' GROUP BY oi.location_id"],
    ["SELECT ssd, COUNT(*) FROM order_items WHERE company_id = 1 AND ssd >= '2026-11-01' GROUP BY ssd ORDER BY ssd LIMIT 30"],
    ["SELECT id FROM order_items WHERE company_id = 1 AND vrd BETWEEN '2026-10-01' AND '2026-10-31' ORDER BY vrd, id LIMIT 101"],
    ["SELECT id FROM scan_logs WHERE company_id = 1 AND day BETWEEN '2026-10-01' AND '2026-10-31' ORDER BY day DESC, id DESC LIMIT 101"],
    ["SELECT id FROM order_items WHERE company_id = 1 AND status = 'pending' AND ssd <= '2026-11-05'"],
    ["SELECT id FROM scan_logs WHERE company_id = 1 AND day = '2026-11-05' ORDER BY id"],
    ["SELECT id FROM staff WHERE company_id = 1 ORDER BY sort_order, code, id"],
  ])('%s', async (q) => {
    const plan = await sql<{ detail: string }>(`EXPLAIN QUERY PLAN ${q}`);
    const scans = plan.filter((p) => /^SCAN /.test(p.detail) && !/USING (COVERING )?INDEX/.test(p.detail));
    expect(scans, plan.map((p) => p.detail).join(' / ')).toEqual([]);
    // 件数が増え続ける表（明細・読み取り履歴）を「会社だけ」で索引から引くのは、会社の全件を読むのと同じ（SCAN と表示されないので別に調べる）
    const companyOnly = plan.filter((p) => /^SEARCH (order_items|scan_logs|oi|s) /.test(p.detail) && /\((?:\w+\.)?company_id=\?\)/.test(p.detail));
    expect(companyOnly, plan.map((p) => p.detail).join(' / ')).toEqual([]);
  });
});
