import { Hono } from 'hono';
import { ROLE_LABELS } from '@partsgate/shared';
import type { AppEnv } from '../types';
import { scoped } from '../lib/db';
import { readSettings } from './settings';

/** ログイン中の利用者・会社・設定の要約。画面は最初にこれを読む */
export const meRoutes = new Hono<AppEnv>();

meRoutes.get('/me', async (c) => {
  const auth = c.get('auth');
  // companies は会社そのものの表（company_id 列はなく id が会社 ID）。ログイン情報の会社 ID だけで読む
  const company = await c.env.DB.prepare('SELECT id, name, code, status FROM companies WHERE id = ?')
    .bind(auth.companyId).first<{ id: number; name: string; code: string; status: string }>();
  return c.json({
    user: { id: auth.user.id, name: auth.user.name, email: auth.user.email, role: auth.user.role, roleLabel: ROLE_LABELS[auth.user.role] },
    company,
    operator: auth.actor.operator,
    via: auth.via,
    settings: await readSettings(scoped(c)),
  });
});
