import type { MiddlewareHandler } from 'hono';
import type { Role } from '@tenq/shared';
import type { Env } from '../env';
import type { AppEnv, AuthContext, TenqUser } from '../types';
import { HttpError, forbidden, unauthorized } from '../lib/http';
import { newId, nowIso, sha256Hex } from '../lib/crypto';

/**
 * 認証（docs/architecture.md §4、docs/security.md §2）。
 *  - "tq_..."  : TENQ の端末記憶トークン（D1 の device_sessions で照合。Space.app には問い合わせない）
 *  - "dev-<n>" : 開発用の簡易ログイン（APP_ENV=dev かつ DEV_AUTH_STUB=1 のときだけ）
 *  - それ以外  : Space.app のトークン（halspace-api /auth/me で確認し、60 秒キャッシュ）
 */

const SPACE_CACHE_MS = 60_000;
const DEVICE_TOUCH_MS = 10 * 60_000;

interface SpaceMe {
  id: number;
  name: string;
  email: string | null;
  role: string;
  company_id: number | null;
  apps_enabled: string[] | null;
}

/** isolate ごとのメモリキャッシュ。キーはトークンの SHA-256（トークン本体は持たない） */
const spaceCache = new Map<string, { me: SpaceMe; until: number }>();

async function fetchSpaceMe(env: Env, token: string): Promise<SpaceMe> {
  const key = await sha256Hex(token);
  const hit = spaceCache.get(key);
  if (hit && hit.until > Date.now()) return hit.me;

  let res: Response;
  try {
    res = await fetch(`${env.HALSPACE_API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new HttpError(502, 'ログインの確認先（Space.app）に接続できません。しばらくしてから、もう一度お試しください。');
  }
  if (res.status === 401) throw unauthorized();
  if (!res.ok) throw new HttpError(502, 'ログインの確認に失敗しました。しばらくしてから、もう一度お試しください。');

  const me = ((await res.json()) as { user: SpaceMe }).user;
  if (spaceCache.size > 500) spaceCache.clear();
  spaceCache.set(key, { me, until: Date.now() + SPACE_CACHE_MS });
  return me;
}

/** テスト用: キャッシュを空にする */
export function clearSpaceCache(): void { spaceCache.clear(); }

/** Space.app の利用者を TENQ の users に写す（氏名・メールは毎回更新、ロールは TENQ 側で管理） */
async function upsertFromSpace(db: D1Database, me: SpaceMe): Promise<TenqUser> {
  if (!me.company_id) throw forbidden('会社に所属していないアカウントでは TENQ を利用できません。');
  const existing = await db.prepare('SELECT * FROM users WHERE hs_user_id = ?').bind(me.id).first<TenqUser>();
  const now = nowIso();
  if (existing) {
    if (existing.company_id !== me.company_id) throw forbidden('所属会社が変わったため、TENQ の管理者に利用者の設定を依頼してください。');
    if (existing.name !== me.name || existing.email !== me.email) {
      await db.prepare('UPDATE users SET name = ?, email = ?, last_seen_at = ?, updated_at = ? WHERE id = ?')
        .bind(me.name, me.email, now, now, existing.id).run();
    }
    return { ...existing, name: me.name, email: me.email };
  }

  // 初回アクセス。会社に TENQ のシステム管理者がまだおらず、Space.app の管理者なら system_admin にする（requirements Q-13）
  let role: Role | null = null;
  if (me.role === 'admin' || me.role === 'super_admin') {
    const admin = await db.prepare("SELECT 1 FROM users WHERE company_id = ? AND role = 'system_admin' LIMIT 1").bind(me.company_id).first();
    if (!admin) role = 'system_admin';
  }
  const user: TenqUser = { id: newId(), hs_user_id: me.id, company_id: me.company_id, name: me.name, email: me.email, role, status: 'active', version: 1 };
  await db.batch([
    db.prepare('INSERT INTO users (id, hs_user_id, company_id, name, email, role, status, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(user.id, user.hs_user_id, user.company_id, user.name, user.email, user.role, 'active', now, now, now),
    db.prepare(`INSERT INTO audit_logs (company_id, actor_user_id, actor_hs_user_id, action, target_type, target_id, detail_json, created_at)
                VALUES (?, ?, ?, 'user.first_access', 'user', ?, ?, ?)`)
      .bind(user.company_id, user.id, user.hs_user_id, user.id, JSON.stringify({ role }), now),
  ]);
  return user;
}

async function fromDeviceToken(db: D1Database, token: string): Promise<{ user: TenqUser; sessionId: string }> {
  const hash = await sha256Hex(token);
  const row = await db.prepare(
    `SELECT s.id AS session_id, s.expires_at, s.revoked_at, s.last_used_at, u.*
     FROM device_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  ).bind(hash).first<TenqUser & { session_id: string; expires_at: string; revoked_at: string | null; last_used_at: string | null }>();
  if (!row || row.revoked_at || row.expires_at <= nowIso()) throw unauthorized();

  // 最終利用日時の更新は 10 分に 1 回まで（書き込みと行ロックを減らす）
  if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > DEVICE_TOUCH_MS) {
    await db.prepare('UPDATE device_sessions SET last_used_at = ? WHERE id = ?').bind(nowIso(), row.session_id).run();
  }
  const { session_id, expires_at: _e, revoked_at: _r, last_used_at: _l, ...user } = row;
  return { user: user as TenqUser, sessionId: session_id };
}

async function factoryIdsOf(db: D1Database, user: TenqUser): Promise<string[]> {
  const sql = user.role === 'system_admin'
    ? 'SELECT id FROM factories WHERE company_id = ? AND status = \'active\''
    : 'SELECT uf.factory_id AS id FROM user_factories uf JOIN factories f ON f.id = uf.factory_id WHERE uf.user_id = ? AND f.status = \'active\'';
  const { results } = await db.prepare(sql).bind(user.role === 'system_admin' ? user.company_id : user.id).all<{ id: string }>();
  return results.map((r) => r.id);
}

export const devStubEnabled = (env: Env): boolean => env.APP_ENV === 'dev' && env.DEV_AUTH_STUB === '1';

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token.length > 512) throw unauthorized();

  let user: TenqUser;
  let via: AuthContext['via'];
  let deviceSessionId: string | undefined;

  if (token.startsWith('tq_')) {
    const r = await fromDeviceToken(c.env.DB, token);
    user = r.user; via = 'device'; deviceSessionId = r.sessionId;
  } else if (token.startsWith('dev-')) {
    if (!devStubEnabled(c.env)) throw unauthorized();
    const hsId = Number(token.slice(4));
    const u = Number.isInteger(hsId) ? await c.env.DB.prepare('SELECT * FROM users WHERE hs_user_id = ?').bind(hsId).first<TenqUser>() : null;
    if (!u) throw unauthorized();
    user = u; via = 'dev-stub';
  } else {
    const me = await fetchSpaceMe(c.env, token);
    if (!(me.apps_enabled ?? []).includes('tenq')) throw forbidden('このアカウントでは TENQ を利用できません。管理者にお問い合わせください。');
    user = await upsertFromSpace(c.env.DB, me);
    via = 'space';
  }

  if (user.status !== 'active') throw forbidden('このアカウントは TENQ の利用を停止されています。管理者にお問い合わせください。');

  const factoryIds = await factoryIdsOf(c.env.DB, user);
  c.set('auth', { user, actor: { id: user.id, role: user.role, factoryIds }, companyId: user.company_id, via, deviceSessionId });
  await next();
};
