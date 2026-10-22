import type { AuthContext } from '../types';

/**
 * 会社・工場のスコープ（docs/security.md §3）。
 * 業務データの SQL は必ずこれを通して WHERE を作る。手書きで company_id を付けない。
 *
 * 返す SQL 片は「AND」で他の条件とつなげられる形。alias はテーブル別名（例: 'e'）。
 */
export function scopeWhere(auth: AuthContext, alias: string, factoryColumn = 'factory_id'): { sql: string; params: unknown[] } {
  const a = alias ? `${alias}.` : '';
  if (auth.actor.role === 'system_admin') {
    return { sql: `${a}company_id = ?`, params: [auth.companyId] };
  }
  const ids = auth.actor.factoryIds;
  if (ids.length === 0) return { sql: '1 = 0', params: [] };
  return {
    sql: `${a}company_id = ? AND ${a}${factoryColumn} IN (${ids.map(() => '?').join(',')})`,
    params: [auth.companyId, ...ids],
  };
}

/** 工場 ID が利用者の範囲内か（会社が一致することは呼び出し側の SQL で確認する） */
export function inFactoryScope(auth: AuthContext, factoryId: string): boolean {
  return auth.actor.role === 'system_admin' || auth.actor.factoryIds.includes(factoryId);
}
