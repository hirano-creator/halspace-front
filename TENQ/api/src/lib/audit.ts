import type { Context } from 'hono';
import type { AppEnv } from '../types';
import { nowIso } from './crypto';

export interface AuditEntry {
  action: string;
  targetType?: string;
  targetId?: string;
  factoryId?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * 監査ログの INSERT 文を作る。業務の更新と同じ db.batch() に入れて、片方だけ残ることを防ぐ。
 * 追記専用（トリガーで UPDATE / DELETE を拒否している）。
 */
export function auditStatement(c: Context<AppEnv>, e: AuditEntry, when?: { sql: string; params: unknown[] }): D1PreparedStatement {
  const auth = c.get('auth');
  // when を渡すと、その条件が成り立つとき（＝直前の更新が実際に効いたとき）だけ記録する
  return c.env.DB.prepare(
    `INSERT INTO audit_logs (company_id, factory_id, actor_user_id, actor_hs_user_id, action, target_type, target_id, detail_json, ip, user_agent, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? ${when ? `WHERE EXISTS (${when.sql})` : ''}`,
  ).bind(
    auth.companyId,
    e.factoryId ?? null,
    auth.user.id,
    auth.user.hs_user_id,
    e.action,
    e.targetType ?? null,
    e.targetId ?? null,
    e.detail ? JSON.stringify(e.detail) : null,
    c.req.header('CF-Connecting-IP') ?? null,
    (c.req.header('User-Agent') ?? '').slice(0, 255),
    nowIso(),
    ...(when?.params ?? []),
  );
}

/**
 * 楽観ロック付き UPDATE が効いたかを確かめる条件（auditStatement の when に渡す）。
 * 更新後は version が1つ増え、updated_at / updated_by が自分の値になっている。
 */
export function updatedBy(table: string, id: string, oldVersion: number, at: string, userId: string): { sql: string; params: unknown[] } {
  return { sql: `SELECT 1 FROM ${table} WHERE id = ? AND version = ? AND updated_at = ? AND updated_by = ?`, params: [id, oldVersion + 1, at, userId] };
}

/** 変わった項目だけの { 項目: [前, 後] } を作る */
export function diff(before: object, after: object): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  const b = before as Record<string, unknown>;
  for (const [k, v] of Object.entries(after)) {
    if (v !== undefined && b[k] !== v) out[k] = [b[k] ?? null, v];
  }
  return out;
}
