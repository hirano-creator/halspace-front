import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { RawItem } from '@partsgate/shared';
import { runBackup } from '../src/lib/backup';
import { TABLES, restoreStatements } from '../../scripts/lib/backup-tables.mjs';
import { jstDay } from '../src/routes/scans';
import { T, post, put, sql, upload, versionOf } from './helpers';

/**
 * バックアップから実際に復元できるか（STEP 8・指示書 §14）。
 * 本物の DB で取込・読み取り・取消・マスター変更をしてから、全体 → 差分の順にバックアップし、
 * 空の DB（RESTORE_DB）に復元して、すべての表の中身が一致することを確かめる。
 */

const ymd = jstDay().replace(/-/g, '');
const row = (line: number, g: string, slip = 'BK0000000001'): RawItem => ({
  line_no: line, global_no: g, barcode_global_no: g, slip_no: slip, product_code: `P-${g}`, quantity: '1',
  customer_code: '100001', destination_code: 'S00001', location_code: '0055', ssd: ymd, vrd: ymd, data_kind: 'F',
});

async function snapshot(db: D1Database): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of TABLES) out[t.name] = (await db.prepare(`SELECT * FROM ${t.name} ORDER BY ${t.key.join(', ')}`).all()).results;
  return out;
}

/** R2 に書き出したバックアップを読む */
async function readBackup(prefix: string): Promise<Record<string, Record<string, unknown>[]>> {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const t of TABLES) {
    const obj = await env.FILES.get(`${prefix}/${t.name}.ndjson`);
    out[t.name] = obj ? (await obj.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : [];
  }
  return out;
}

async function restore(backups: Record<string, Record<string, unknown>[]>[]) {
  const stmts = restoreStatements(backups, env.TEST_INIT_SQL);
  // 50 文ずつまとめて実行（D1 の batch はトランザクション）
  for (let i = 0; i < stmts.length; i += 50) await env.RESTORE_DB.batch(stmts.slice(i, i + 50).map((s) => env.RESTORE_DB.prepare(s)));
}

let session = 0;
const scan = (raw: string, id: string) => post('/scans', T.generalA, { work_session_id: session, client_scan_id: id, raw_value: raw });

beforeAll(async () => {
  await applyD1Migrations(env.RESTORE_DB, env.TEST_MIGRATIONS);
  const b = await upload(T.adminA, 'backup test');
  await post(`/imports/${b.body.id}/rows`, T.adminA, { rows: [row(2, '5PBK00000001'), row(3, '5PBK00000002'), row(4, '5PBK00000003')] });
  await post(`/imports/${b.body.id}/commit`, T.adminA, { expected_rows: 3 });
  session = (await post('/work-sessions', T.generalA, { staff_id: 1, device_id: 'bk-device-0001' })).body.id;
  await scan('5PBK00000001', 'bk-scan-0001');
  await scan('5PBK00000001', 'bk-scan-0002'); // 読み取り済み
});

describe('バックアップと復元', () => {
  it('全体バックアップから、空の DB にすべての表を同じ中身で復元できる', async () => {
    const m = await runBackup(env, 'full', new Date(Date.now() - 1000));
    expect(m.kind).toBe('full');
    expect(m.tables.order_items!.rows).toBeGreaterThanOrEqual(3);
    const full = await readBackup(`backups/${m.to_at.slice(0, 10)}/full-${m.run_id}`);
    await restore([full]);
    const a = await snapshot(env.DB);
    const r = await snapshot(env.RESTORE_DB);
    for (const t of TABLES) expect(r[t.name], t.name).toEqual(a[t.name]);
  });

  it('その後の変更は差分バックアップに入り、全体＋差分で今の状態に戻せる（読み取りを二重に数えない）', async () => {
    // バックアップ後の変更: 読み取り・取消・マスター変更・取込
    await scan('5PBK00000002', 'bk-scan-0003');
    const [ok] = await sql<{ id: number }>("SELECT id FROM scan_logs WHERE client_scan_id = 'bk-scan-0003'");
    await post(`/scan-logs/${ok!.id}/corrections`, T.adminA, { action: 'void', reason: 'バックアップのテスト' });
    await scan('5PBK00000003', 'bk-scan-0004');
    await put('/staff/2', T.adminA, { name: '佐藤 花子（変更）', version: await versionOf('staff', 2) });
    const b = await upload(T.adminA, 'backup test 2');
    // 別の伝票にする（読み取りだけで照合済みの数が変わった伝票 BK0000000001 が、差分に入ることを確かめるため）
    await post(`/imports/${b.body.id}/rows`, T.adminA, { rows: [row(2, '5PBK00000004', 'BK0000000002')] });
    await post(`/imports/${b.body.id}/commit`, T.adminA, { expected_rows: 1 });

    const m = await runBackup(env, 'incremental');
    expect(m.kind).toBe('incremental');
    expect(m.tables.scan_logs!.rows).toBe(2);         // 前回以降の読み取りだけ
    expect(m.tables.order_items!.rows).toBeGreaterThanOrEqual(3); // 照合・取消で変わった明細と新しい明細
    expect(m.tables.staff!.rows).toBeGreaterThanOrEqual(1);
    expect(m.tables.orders!.rows).toBe(2); // 読み取りで照合済みの数が変わった伝票 ＋ 新しい伝票
    const inc = await readBackup(`backups/${m.to_at.slice(0, 10)}/incremental-${m.run_id}`);
    await restore([inc]);
    const a = await snapshot(env.DB);
    const r = await snapshot(env.RESTORE_DB);
    for (const t of TABLES) expect(r[t.name], t.name).toEqual(a[t.name]);
    // 復元のあとも数え上げのトリガーは元どおり動く
    const trig = await env.RESTORE_DB.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('trg_scan_count', 'trg_scan_stats', 'trg_correction_void')").all();
    expect(trig.results).toHaveLength(3);
  });

  it('変更がなければ、差分バックアップは空', async () => {
    const m = await runBackup(env, 'incremental');
    const nonEmpty = Object.entries(m.tables).filter(([name, v]) => v.rows > 0 && name !== 'daily_scan_stats' && name !== 'users');
    expect(nonEmpty).toEqual([]);
    const runs = await sql<{ status: string }>("SELECT status FROM backup_runs ORDER BY id");
    expect(runs.every((r) => r.status === 'done')).toBe(true);
  });
});
