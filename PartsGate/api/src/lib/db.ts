import type { Context } from 'hono';
import type { AppEnv } from '../types';

/**
 * 会社で絞った DB 呼び出し口（docs/security.md §1-2）。
 *
 * 業務データの SQL は**必ずこれを通す**。company_id を手書きで bind しない（HaLSpace では手書きの
 * WHERE で会社スコープが漏れた前例がある）。
 *  - SQL の中で会社は必ず `?1` で書く（例: `WHERE company_id = ?1 AND id = ?2`、`VALUES (?1, ?2, ...)`）
 *  - ?1 にはログイン情報の会社 ID が自動で入る。残りの値は ?2 以降に順に入る
 *  - `?1` と `company_id` を含まない SQL は実行前に例外にする（書き忘れをテストで必ず拾う）
 */
export function assertScoped(sql: string): void {
  if (!/\bcompany_id\b/.test(sql) || !/\?1(?!\d)/.test(sql)) {
    throw new Error(`会社で絞っていない SQL です: ${sql.replace(/\s+/g, ' ').slice(0, 120)}`);
  }
}

export interface Scoped {
  /** batch に入れる文を作る */
  stmt(sql: string, ...params: unknown[]): D1PreparedStatement;
  first<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  run(sql: string, ...params: unknown[]): Promise<D1Result>;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
  companyId: number;
}

export function scoped(c: Context<AppEnv>): Scoped {
  const companyId = c.get('auth').companyId;
  const db = c.env.DB;
  const stmt = (sql: string, ...params: unknown[]) => {
    assertScoped(sql);
    return db.prepare(sql).bind(companyId, ...params);
  };
  return {
    stmt,
    first: <T>(sql: string, ...params: unknown[]) => stmt(sql, ...params).first<T>(),
    all: async <T>(sql: string, ...params: unknown[]) => (await stmt(sql, ...params).all<T>()).results,
    run: (sql: string, ...params: unknown[]) => stmt(sql, ...params).run(),
    batch: (statements: D1PreparedStatement[]) => db.batch(statements),
    companyId,
  };
}
