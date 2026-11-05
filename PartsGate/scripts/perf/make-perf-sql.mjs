// 性能テスト用の大量のダミーデータを作る SQL を書き出す（docs/development-plan.md §3「性能」）。値はすべて架空。
//   node scripts/perf/make-perf-sql.mjs <出力先.sql> [明細の件数=360000]
// 性能テスト専用のローカル D1（--persist-to .wrangler/perf）にだけ流す。普段の開発用 DB・遠隔の D1 には流さない。
//
// できるもの（会社 A = id 1。dev-seed.sql の置場・担当者・利用者を使う）:
//  - 注文の明細 N 件（10 年分。ミスミ納期は 1 日あたり N/3650 件）、伝票 N×0.61 件
//  - 読み取り履歴: 照合済みの明細ごとに正常 1 件 ＋ 30% に読み取り済み 1 件、ほかに未登録 2% → 約 1.3N 件
//  - 集計表 daily_scan_stats は読み取り履歴から作る
// 数え終わった状態で入れるので、その間だけ数え上げのトリガーを外し、最後に作り直す。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { triggerCreateSql, COUNT_TRIGGERS } from '../lib/backup-tables.mjs';

const out = process.argv[2];
const N = Number(process.argv[3] ?? 360000);
if (!out) { console.error('使い方: node scripts/perf/make-perf-sql.mjs <出力先.sql> [件数]'); process.exit(1); }
const SLIPS = Math.round(N * 0.61);
const DAYS = 3650;
const perDay = N / DAYS;
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'api', 'migrations');
const migrationSql = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join(migDir, f), 'utf8')).join('\n');
// 今日（日本時間）までの 10 年。最後の 2 日分は照合待ちにする
const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
const start = new Date(Date.parse(today) - (DAYS - 1) * 86_400_000).toISOString().slice(0, 10);

const sql = `
${COUNT_TRIGGERS.map((t) => `DROP TRIGGER IF EXISTS ${t};`).join('\n')}
INSERT INTO import_batches (id, company_id, file_name, file_sha256, r2_key, encoding, status, created_by, created_at, committed_at)
VALUES (90000, 1, 'perf.csv', '${'0'.repeat(64)}', 'perf', 'utf-8', 'committed', 1, '${start}T00:00:00.000Z', '${start}T00:00:00.000Z');
INSERT INTO work_sessions (id, company_id, user_id, staff_id, staff_name, device_id, device_label, started_at)
VALUES (90000, 1, 2, 1, '山田 太郎', 'perf-device-0001', '性能テスト', '${start}T00:00:00.000Z');

-- 伝票
WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < ${SLIPS})
INSERT INTO orders (id, company_id, slip_no, customer_code, customer_name, item_count, matched_count, created_at, updated_at)
SELECT 1000000 + x, 1, printf('PF%010d', x), printf('C%05d', x % 300), printf('得意先%03d（株）', x % 300), 0, 0, '${start}T00:00:00.000Z', '${start}T00:00:00.000Z' FROM n;

-- 明細（明細 x は伝票 floor((x-1) * SLIPS / N) + 1 に入る）
WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < ${N}),
d AS (SELECT x, date('${start}', '+' || CAST((x - 1) / ${perDay} AS INTEGER) || ' days') AS vrd, ((x - 1) * ${SLIPS} / ${N}) + 1 AS slip FROM n)
INSERT INTO order_items (id, company_id, order_id, global_no, barcode_global_no, product_code, product_name, quantity, required_scans,
  customer_code, customer_name, destination_code, destination_name, location_id, location_code, ssd, vrd, ship_method, export_type,
  unit_weight, total_weight, data_kind, row_hash, status, scan_count, matched_at, matched_staff_id, last_import_id, created_at, updated_at)
SELECT 2000000 + x, 1, 1000000 + slip, printf('5PF%011d', x), printf('5PF%011d', x), printf('MVSHM-PERF%05d-AAA', x % 5000), 'MEVIY SHEET METAL',
  1 + (x % 4), 1, printf('C%05d', slip % 300), printf('得意先%03d（株）', slip % 300), printf('D%04d', x % 900), printf('納品先%03d', x % 900),
  1 + (x % 4), CASE x % 4 WHEN 0 THEN '0052' WHEN 1 THEN '0053' WHEN 2 THEN '0055' ELSE '0056' END,
  date(vrd, '-1 day'), vrd, 'センター納入', CASE WHEN x % 30 = 0 THEN 'E' ELSE 'D' END,
  100 + (x % 900), (100 + (x % 900)) * (1 + (x % 4)), 'F', printf('%064d', x),
  CASE WHEN vrd >= date('${today}', '-1 day') THEN 'pending' ELSE 'matched' END,
  CASE WHEN vrd >= date('${today}', '-1 day') THEN 0 ELSE 1 END,
  CASE WHEN vrd >= date('${today}', '-1 day') THEN NULL ELSE date(vrd, '-1 day') || 'T01:00:00.000Z' END,
  CASE WHEN vrd >= date('${today}', '-1 day') THEN NULL ELSE 1 + (x % 3) END,
  90000, date(vrd, '-5 days') || 'T00:00:00.000Z', date(vrd, '-1 day') || 'T01:00:00.000Z'
FROM d;

-- 読み取り: 照合済みの明細に正常 1 件
INSERT INTO scan_logs (id, company_id, client_scan_id, work_session_id, user_id, staff_id, staff_name, raw_value, barcode, input, order_item_id, result, location_id, scanned_at, day, device_id)
SELECT id, 1, 'perf-ok-' || id, 90000, 2, matched_staff_id, '担当者' || matched_staff_id, global_no, global_no, 'scanner', id, 'ok', location_id, matched_at, ssd, 'perf-device-0001'
  FROM order_items WHERE company_id = 1 AND status = 'matched';
-- 30% に読み取り済み（二度読み）
INSERT INTO scan_logs (id, company_id, client_scan_id, work_session_id, user_id, staff_id, staff_name, raw_value, barcode, input, order_item_id, result, location_id, scanned_at, day, device_id)
SELECT id + 1000000, 1, 'perf-dup-' || id, 90000, 2, 1 + (id % 3), '担当者' || (1 + (id % 3)), global_no, global_no, 'scanner', id, 'duplicate', location_id, matched_at, ssd, 'perf-device-0001'
  FROM order_items WHERE company_id = 1 AND status = 'matched' AND id % 10 < 3;
-- 2% に未登録
INSERT INTO scan_logs (id, company_id, client_scan_id, work_session_id, user_id, staff_id, staff_name, raw_value, barcode, input, order_item_id, result, location_id, scanned_at, day, device_id)
SELECT id + 2000000, 1, 'perf-nf-' || id, 90000, 2, 1, '担当者1', '5PZZ' || id, '5PZZ' || id, 'scanner', NULL, 'not_found', NULL, matched_at, ssd, 'perf-device-0001'
  FROM order_items WHERE company_id = 1 AND status = 'matched' AND id % 50 = 0;

-- 集計表と伝票の件数
INSERT INTO daily_scan_stats (company_id, day, staff_id, location_id, result, count)
SELECT company_id, day, staff_id, COALESCE(location_id, 0), result, COUNT(*) FROM scan_logs WHERE company_id = 1 GROUP BY company_id, day, staff_id, COALESCE(location_id, 0), result;
UPDATE orders SET
  item_count = (SELECT COUNT(*) FROM order_items x WHERE x.company_id = 1 AND x.order_id = orders.id),
  matched_count = (SELECT COUNT(*) FROM order_items x WHERE x.company_id = 1 AND x.order_id = orders.id AND x.status = 'matched')
 WHERE company_id = 1 AND id > 1000000;

${triggerCreateSql(migrationSql).join('\n\n')}
`;
writeFileSync(out, sql, 'utf8');
console.log(`${out}: 明細 ${N.toLocaleString()} 件・伝票 ${SLIPS.toLocaleString()} 件（${start} 〜 ${today}）`);
