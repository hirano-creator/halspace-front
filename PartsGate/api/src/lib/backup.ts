import type { Env } from '../env';
import { TABLES, type TableSpec } from '../../../scripts/lib/backup-tables.mjs';

/**
 * バックアップ（docs/development-plan.md §4）。D1 の Time Travel（無料 7 日）に加え、R2 に NDJSON で残す。
 *  - incremental（毎日の Cron）: 前回のバックアップ以降に増えた・変わった行だけ。1 日分は数百行なので無料プランの CPU に収まる
 *  - full: 全部の行（テストと、データの少ない初回用）。本番の全体バックアップは `wrangler d1 export` を月 1 回手で行う
 * 保存先: R2 `backups/<日付>/<kind>-<回の ID>/<表>.ndjson` と manifest.json
 *
 * ここは会社をまたいで DB 全体を読む（バックアップのため）。API からは呼ばない。scoped() の例外。
 */

const PAGE = 500;

interface Manifest {
  kind: 'full' | 'incremental';
  run_id: number;
  from_at: string | null;
  to_at: string;
  tables: Record<string, { rows: number; max_id: number | null }>;
}

async function lastRun(db: D1Database): Promise<{ to_at: string; maxIds: Record<string, number | null> } | null> {
  const r = await db.prepare("SELECT to_at, row_counts_json FROM backup_runs WHERE status = 'done' ORDER BY id DESC LIMIT 1")
    .first<{ to_at: string; row_counts_json: string }>();
  if (!r) return null;
  const tables = (JSON.parse(r.row_counts_json) as Manifest['tables']) ?? {};
  return { to_at: r.to_at, maxIds: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.max_id])) };
}

/** その表の「前回以降」の条件。id で追う表（追記だけの表）と、更新日時で追う表がある */
function sinceWhere(t: TableSpec, since: string, maxId: number | null): { sql: string; params: unknown[] } {
  if (t.since === 'id') return { sql: 'id > ?', params: [maxId ?? 0] };
  if (t.since === 'day') return { sql: 'day >= ?', params: [new Date(Date.parse(since) + 9 * 3_600_000 - 86_400_000).toISOString().slice(0, 10)] };
  const cols = t.since.split('|');
  return { sql: `(${cols.map((col) => `${col} >= ?`).join(' OR ')})`, params: cols.map(() => since) };
}

export async function runBackup(env: Env, kind: 'full' | 'incremental', now = new Date()): Promise<Manifest> {
  const db = env.DB;
  const toAt = now.toISOString();
  const prev = kind === 'incremental' ? await lastRun(db) : null;
  // 前回がなければ全部を書き出す（初回）
  const effective: Manifest['kind'] = kind === 'incremental' && prev ? 'incremental' : 'full';
  const fromAt = effective === 'incremental' ? prev!.to_at : null;
  const run = await db.prepare("INSERT INTO backup_runs (kind, from_at, to_at, status, created_at) VALUES (?, ?, ?, 'running', ?) RETURNING id")
    .bind(effective === 'full' ? 'manual_full' : 'daily_incremental', fromAt, toAt, toAt).first<{ id: number }>();
  const runId = run!.id;
  const prefix = `backups/${toAt.slice(0, 10)}/${effective}-${runId}`;
  const manifest: Manifest = { kind: effective, run_id: runId, from_at: fromAt, to_at: toAt, tables: {} };
  try {
    for (const t of TABLES) {
      const cond = effective === 'incremental' ? sinceWhere(t, fromAt!, prev!.maxIds[t.name] ?? null) : { sql: '1 = 1', params: [] };
      const lines: string[] = [];
      let offsetKey: unknown[] | null = null;
      // キーの順に PAGE 行ずつ読む（OFFSET を使わない）
      for (;;) {
        const keyCond: string = offsetKey ? ` AND (${t.key.join(', ')}) > (${t.key.map(() => '?').join(', ')})` : '';
        const page: D1Result<Record<string, unknown>> = await db.prepare(`SELECT * FROM ${t.name} WHERE ${cond.sql}${keyCond} ORDER BY ${t.key.join(', ')} LIMIT ${PAGE}`)
          .bind(...cond.params, ...(offsetKey ?? [])).all<Record<string, unknown>>();
        const results: Record<string, unknown>[] = page.results;
        for (const r of results) lines.push(JSON.stringify(r));
        if (results.length < PAGE) break;
        const last: Record<string, unknown> = results[results.length - 1]!;
        offsetKey = t.key.map((k: string): unknown => last[k]);
      }
      const maxRow = t.key.length === 1 && t.key[0] === 'id'
        ? await db.prepare(`SELECT MAX(id) AS m FROM ${t.name}`).first<{ m: number | null }>()
        : null;
      manifest.tables[t.name] = { rows: lines.length, max_id: maxRow ? maxRow.m : null };
      if (lines.length) await env.FILES.put(`${prefix}/${t.name}.ndjson`, lines.join('\n') + '\n', { httpMetadata: { contentType: 'application/x-ndjson' } });
    }
    await env.FILES.put(`${prefix}/manifest.json`, JSON.stringify(manifest, null, 2), { httpMetadata: { contentType: 'application/json' } });
    await db.prepare("UPDATE backup_runs SET status = 'done', r2_prefix = ?, row_counts_json = ? WHERE id = ?").bind(prefix, JSON.stringify(manifest.tables), runId).run();
    return manifest;
  } catch (e) {
    await db.prepare("UPDATE backup_runs SET status = 'failed', error = ? WHERE id = ?").bind(String(e instanceof Error ? e.message : e).slice(0, 500), runId).run();
    throw e;
  }
}

/** Cron（wrangler.toml の triggers）から呼ばれる。毎日、日本時間 3 時 */
export async function scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(runBackup(env, 'incremental').then(() => undefined));
}
