import type { Context } from 'hono';
import type { AppEnv } from '../types';
import { nowIso } from './crypto';

export interface AuditEntry {
  action: string;
  targetType?: string;
  targetId?: string | number;
  detail?: Record<string, unknown>;
}

/**
 * 監査ログの INSERT 文。業務の更新と同じ db.batch() に入れて、片方だけ残ることを防ぐ（追記専用）。
 * when を渡すと、その条件が成り立つとき（＝直前の更新が実際に効いたとき）だけ記録する。
 * 会社 ID はログイン情報から入れる（画面の値は使わない）。
 */
export function auditStatement(c: Context<AppEnv>, e: AuditEntry, when?: { sql: string; params: unknown[] }): D1PreparedStatement {
  const auth = c.get('auth');
  return c.env.DB.prepare(
    `INSERT INTO audit_logs (company_id, user_id, hs_user_id, action, target_type, target_id, detail_json, ip, user_agent, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? ${when ? `WHERE EXISTS (${when.sql})` : ''}`,
  ).bind(
    auth.companyId,
    auth.user.id,
    auth.user.hs_user_id,
    e.action,
    e.targetType ?? null,
    e.targetId === undefined ? null : String(e.targetId),
    e.detail ? JSON.stringify(e.detail) : null,
    c.req.header('CF-Connecting-IP') ?? null,
    (c.req.header('User-Agent') ?? '').slice(0, 255),
    nowIso(),
    ...(when?.params ?? []),
  );
}

/**
 * 楽観ロック付き UPDATE が効いたかを確かめる条件（auditStatement の when に渡す）。
 * 更新後は version が 1 つ増え、updated_at が今回の時刻になっている。
 */
export function updated(table: string, companyId: number, id: number, newVersion: number, at: string): { sql: string; params: unknown[] } {
  return { sql: `SELECT 1 FROM ${table} WHERE company_id = ? AND id = ? AND version = ? AND updated_at = ?`, params: [companyId, id, newVersion, at] };
}

/** 変わった項目だけの { 項目: [前, 後] } */
export function diff(before: object, after: object): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  const b = before as Record<string, unknown>;
  for (const [k, v] of Object.entries(after)) {
    if (v !== undefined && b[k] !== v) out[k] = [b[k] ?? null, v];
  }
  return out;
}
