import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { scoped } from '../lib/db';
import { authorize } from '../lib/guard';
import { decodeCursor, encodeCursor } from '../lib/cursor';

/** 監査ログ（新しい順・キーセットのページ送り） */
export const auditRoutes = new Hono<AppEnv>();

auditRoutes.get('/audit-logs', async (c) => {
  authorize(c, 'audit.view');
  const db = scoped(c);
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50) || 50, 1), 200);
  const cursor = c.req.query('cursor');
  const after = cursor ? decodeCursor(cursor, 2) : null;
  const rows = await db.all<{ id: number; created_at: string }>(
    `SELECT a.id, a.action, a.target_type, a.target_id, a.detail_json, a.created_at, u.name AS user_name
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id AND u.company_id = a.company_id
      WHERE a.company_id = ?1 ${after ? 'AND (a.created_at, a.id) < (?3, ?4)' : ''}
      ORDER BY a.created_at DESC, a.id DESC LIMIT ?2`,
    limit + 1, ...(after ? [after[0], Number(after[1])] : []),
  );
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return c.json({ items, next_cursor: more && last ? encodeCursor([last.created_at, String(last.id)]) : null });
});
