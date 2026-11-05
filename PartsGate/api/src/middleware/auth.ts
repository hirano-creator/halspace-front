import type { MiddlewareHandler } from 'hono';
import { APP_KEY, type Role } from '@partsgate/shared';
import type { Env } from '../env';
import type { AppEnv, AuthContext, PgUser } from '../types';
import { HttpError, forbidden, unauthorized } from '../lib/http';
import { nowIso, sha256Hex } from '../lib/crypto';

/**
 * 認証（docs/architecture.md §4、docs/security.md §2）。TENQ の api/src/middleware/auth.ts をもとにしている。
 *  - Space.app のトークン: halspace-api の /auth/me で確認し、60 秒キャッシュ
 *  - "dev-<n>": 開発用の簡易ログイン（APP_ENV=dev かつ DEV_AUTH_STUB=1 のときだけ）
 *
 * **会社 ID はここで決めたものだけを使う**。画面から送られた company_id は一切読まない。
 */

const SPACE_CACHE_MS = 60_000;
const SEEN_TOUCH_MS = 10 * 60_000;

interface SpaceMe {
  id: number;
  name: string;
  email: string | null;
  role: string;
  is_operator?: boolean;
  company_id: number | null;
  company_name?: string | null;
  company_slug?: string | null;
  apps_enabled: string[] | null;
}

/** isolate ごとのメモリキャッシュ。キーはトークンの SHA-256（トークン本体は持たない） */
const spaceCache = new Map<string, { me: SpaceMe; until: number }>();
export function clearSpaceCache(): void { spaceCache.clear(); }

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

/**
 * Space.app の利用者を PARTS GATE の users に写す。会社がまだなければ会社と設定も作る。
 * 氏名・メールは毎回 Space.app に合わせ、ロールは PARTS GATE 側で管理する。
 */
async function upsertFromSpace(db: D1Database, me: SpaceMe): Promise<PgUser> {
  if (!me.company_id) throw forbidden('会社に所属していないアカウントでは PARTS GATE を利用できません。');
  const now = nowIso();
  const existing = await db.prepare('SELECT * FROM users WHERE hs_user_id = ?').bind(me.id).first<PgUser & { last_seen_at: string | null }>();
  if (existing) {
    if (existing.company_id !== me.company_id) throw forbidden('所属会社が変わったため、PARTS GATE の管理者に利用者の設定を依頼してください。');
    const stale = !existing.last_seen_at || Date.now() - Date.parse(existing.last_seen_at) > SEEN_TOUCH_MS;
    if (existing.name !== me.name || existing.email !== me.email || stale) {
      // 最終利用日時の更新は 10 分に 1 回まで（書き込みを減らす。HaLSpace の行ロック障害の教訓）
      await db.prepare('UPDATE users SET name = ?, email = ?, last_seen_at = ?, updated_at = ? WHERE id = ?')
        .bind(me.name, me.email, now, now, existing.id).run();
    }
    return { ...existing, name: me.name, email: me.email };
  }

  // 初めての会社なら、会社と設定を作る（会社名・コードは Space.app の値。あとで企業管理で変えられる）
  await db.batch([
    db.prepare('INSERT INTO companies (id, name, code, status, created_at, updated_at) VALUES (?, ?, ?, \'active\', ?, ?) ON CONFLICT (id) DO NOTHING')
      .bind(me.company_id, me.company_name ?? `会社 ${me.company_id}`, me.company_slug || `company-${me.company_id}`, now, now),
    db.prepare('INSERT INTO company_settings (company_id, updated_at) VALUES (?, ?) ON CONFLICT (company_id) DO NOTHING').bind(me.company_id, now),
  ]);

  // 会社に PARTS GATE の管理者がまだいなければ、Space.app の管理者を管理者にする。ほかは一般
  let role: Role = 'general';
  if (me.role === 'admin' || me.role === 'super_admin') {
    const admin = await db.prepare("SELECT 1 FROM users WHERE company_id = ? AND role = 'admin' AND status = 'active' LIMIT 1").bind(me.company_id).first();
    if (!admin) role = 'admin';
  }
  const [, inserted] = await db.batch([
    db.prepare('INSERT INTO users (company_id, hs_user_id, name, email, role, status, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, \'active\', ?, ?, ?) ON CONFLICT (hs_user_id) DO NOTHING')
      .bind(me.company_id, me.id, me.name, me.email, role, now, now, now),
    db.prepare('SELECT * FROM users WHERE hs_user_id = ?').bind(me.id),
  ]);
  const user = (inserted?.results?.[0] ?? null) as PgUser | null;
  if (!user) throw new HttpError(502, '利用者の登録に失敗しました。もう一度お試しください。');
  await db.prepare(`INSERT INTO audit_logs (company_id, user_id, hs_user_id, action, target_type, target_id, detail_json, created_at)
                    VALUES (?, ?, ?, 'user.first_access', 'user', ?, ?, ?)`)
    .bind(user.company_id, user.id, user.hs_user_id, String(user.id), JSON.stringify({ role: user.role }), now).run();
  return user;
}

export const devStubEnabled = (env: Env): boolean => env.APP_ENV === 'dev' && env.DEV_AUTH_STUB === '1';

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token.length > 512) throw unauthorized();

  let user: PgUser;
  let operator: boolean;
  let via: AuthContext['via'];

  if (token.startsWith('dev-')) {
    if (!devStubEnabled(c.env)) throw unauthorized();
    const hsId = Number(token.slice(4));
    const u = Number.isInteger(hsId) ? await c.env.DB.prepare('SELECT * FROM users WHERE hs_user_id = ?').bind(hsId).first<PgUser>() : null;
    if (!u) throw unauthorized();
    user = u;
    operator = (c.env.DEV_OPERATOR_IDS ?? '').split(',').map((s) => s.trim()).includes(String(hsId));
    via = 'dev-stub';
  } else {
    const me = await fetchSpaceMe(c.env, token);
    if (!(me.apps_enabled ?? []).includes(APP_KEY)) throw forbidden('このアカウントでは PARTS GATE を利用できません。管理者にお問い合わせください。');
    user = await upsertFromSpace(c.env.DB, me);
    operator = me.is_operator === true;
    via = 'space';
  }

  if (user.status !== 'active') throw forbidden('このアカウントは PARTS GATE の利用を停止されています。管理者にお問い合わせください。');
  const company = await c.env.DB.prepare('SELECT status FROM companies WHERE id = ?').bind(user.company_id).first<{ status: string }>();
  // 運営者は自分の会社が停止中でも企業管理を開けるようにする（停止の解除ができなくなるため）
  if (company?.status !== 'active' && !operator) {
    throw forbidden('この会社の PARTS GATE は利用を停止しています。管理者にお問い合わせください。');
  }

  c.set('auth', { user, actor: { role: user.role, operator }, companyId: user.company_id, via });
  await next();
};
