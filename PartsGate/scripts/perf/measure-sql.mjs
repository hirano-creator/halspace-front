// 性能テスト用 DB で、主な処理の SQL が「何行読むか（rows_read）」と時間を測る。
//   node scripts/perf/measure-sql.mjs  （api フォルダで性能テスト用 DB を作ってから）
// SQL は API と同じ形（値だけ固定）。結果は表で出す。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'api');
const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
const day = (n) => new Date(Date.parse(today) + n * 86_400_000).toISOString().slice(0, 10);
const month1 = `${today.slice(0, 7)}-01`;
const year1 = day(-365);

const CASES = [
  ['照合: バーコードで明細を探す', "SELECT id, status, scan_count, required_scans FROM order_items WHERE company_id = 1 AND barcode_global_no = '5PF00000180000'"],
  ['照合: 再送の確認（client_scan_id）', "SELECT * FROM scan_logs WHERE company_id = 1 AND client_scan_id = 'perf-ok-2180000'"],
  ['置場別チェック: タブ（1 日分）', `SELECT oi.location_id, COUNT(*), SUM(CASE WHEN oi.status = 'matched' THEN 1 ELSE 0 END) FROM order_items oi WHERE oi.company_id = 1 AND oi.vrd = '${day(-3)}' AND oi.status <> 'cancelled' GROUP BY oi.location_id`],
  ['置場別チェック: 一覧（1 日・1 置場）', `SELECT oi.id, oi.global_no, s.name FROM order_items oi LEFT JOIN staff s ON s.company_id = oi.company_id AND s.id = oi.matched_staff_id WHERE oi.company_id = 1 AND oi.vrd = '${day(-3)}' AND oi.location_id = 3 AND oi.status <> 'cancelled' ORDER BY oi.global_no LIMIT 2000`],
  ['今日の件数（集計表）', `SELECT result, SUM(count) FROM daily_scan_stats WHERE company_id = 1 AND day = '${day(-3)}' GROUP BY result`],
  ['ダッシュボード: 未確認（30 日）', `SELECT COUNT(*) FROM order_items WHERE company_id = 1 AND status IN ('pending', 'review') AND ssd <= '${today}' AND ssd >= '${day(-30)}'`],
  ['読み取り履歴: 1 日（100 件）', `SELECT s.id FROM scan_logs s LEFT JOIN order_items oi ON oi.company_id = s.company_id AND oi.id = s.order_item_id WHERE s.company_id = 1 AND s.day BETWEEN '${day(-3)}' AND '${day(-3)}' ORDER BY s.day DESC, s.id DESC LIMIT 101`],
  ['読み取り履歴: 1 か月・正常以外（100 件）', `SELECT s.id FROM scan_logs s WHERE s.company_id = 1 AND s.day BETWEEN '${day(-33)}' AND '${day(-3)}' AND s.result <> 'ok' ORDER BY s.day DESC, s.id DESC LIMIT 101`],
  ['読み取り履歴: 1 か月・得意先名の部分一致', `SELECT s.id FROM scan_logs s LEFT JOIN order_items oi ON oi.company_id = s.company_id AND oi.id = s.order_item_id WHERE s.company_id = 1 AND s.day BETWEEN '${day(-33)}' AND '${day(-3)}' AND oi.customer_name LIKE '%得意先12%' ORDER BY s.day DESC, s.id DESC LIMIT 101`],
  ['注文データ: 3 週間（100 件）', `SELECT oi.id FROM order_items oi WHERE oi.company_id = 1 AND oi.vrd BETWEEN '${day(-7)}' AND '${day(14)}' ORDER BY oi.vrd, oi.id LIMIT 101`],
  ['注文データ: 1 年・グローバル番号の前方一致', `SELECT oi.id FROM order_items oi WHERE oi.company_id = 1 AND oi.vrd BETWEEN '${year1}' AND '${today}' AND (oi.global_no LIKE '5PF0000035%' OR oi.product_code LIKE '%5PF0000035%') ORDER BY oi.vrd, oi.id LIMIT 101`],
  ['分析: 読み取り 1 か月（日別・集計表）', `SELECT day, result, SUM(count) FROM daily_scan_stats WHERE company_id = 1 AND day BETWEEN '${month1}' AND '${today}' GROUP BY day, result`],
  ['分析: 得意先別 1 か月', `SELECT customer_code, COUNT(*), COUNT(DISTINCT order_id), SUM(quantity) FROM order_items WHERE company_id = 1 AND vrd BETWEEN '${month1}' AND '${today}' AND status <> 'cancelled' GROUP BY customer_code ORDER BY 2 DESC LIMIT 200`],
  ['分析: 得意先別 1 年', `SELECT customer_code, COUNT(*), COUNT(DISTINCT order_id), SUM(quantity) FROM order_items WHERE company_id = 1 AND vrd BETWEEN '${year1}' AND '${today}' AND status <> 'cancelled' GROUP BY customer_code ORDER BY 2 DESC LIMIT 200`],
  ['取込: 照会 500 件', `SELECT global_no, row_hash, status FROM order_items WHERE company_id = 1 AND global_no IN (SELECT printf('5PF%011d', value) FROM json_each('[${Array.from({ length: 500 }, (_, i) => 100000 + i).join(',')}]'))`],
];

const rows = [];
const tmp = mkdtempSync(join(tmpdir(), 'pg-perf-'));
for (const [i, [name, sql]] of CASES.entries()) {
  // SQL は引数で渡すと空白・引用符が崩れるので、ファイルにして渡す
  const file = join(tmp, `q${i}.sql`);
  writeFileSync(file, `${sql};\n`, 'utf8');
  const outText = execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--env', 'dev', '--persist-to', '.wrangler/perf', '--json', '--file', JSON.stringify(file)],
    { cwd: apiDir, encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const res = JSON.parse(outText.slice(outText.indexOf('[')));
  const meta = res[0]?.meta ?? {};
  // 実行計画（ローカルの D1 は読んだ行数を返さないので、どの索引をどう使ったかで判断する）
  writeFileSync(file, `EXPLAIN QUERY PLAN ${sql};\n`, 'utf8');
  const planText = execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--env', 'dev', '--persist-to', '.wrangler/perf', '--json', '--file', JSON.stringify(file)],
    { cwd: apiDir, encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const plan = JSON.parse(planText.slice(planText.indexOf('[')))[0]?.results?.map((p) => p.detail).filter((d) => /^(SCAN|SEARCH)/.test(d)) ?? [];
  rows.push({ 処理: name, 返した行: res[0]?.results?.length, 'DB 時間(ms)': Math.round((meta.duration ?? 0) * 10) / 10, 実行計画: plan.join(' / ').slice(0, 90) });
}
console.table(rows);
