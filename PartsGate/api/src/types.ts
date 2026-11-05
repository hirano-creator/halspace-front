import type { Actor, Role } from '@partsgate/shared';
import type { Env } from './env';

export interface PgUser {
  id: number;
  company_id: number;
  hs_user_id: number;
  name: string;
  email: string | null;
  role: Role;
  status: 'active' | 'suspended';
  version: number;
}

export interface AuthContext {
  user: PgUser;
  /** 権限判定（shared の can()）に渡す形 */
  actor: Actor;
  /**
   * 会社。**必ずログイン情報（Space.app の /auth/me）から決める**。画面から送られた値は使わない。
   * SQL では直接使わず、lib/db.ts の scoped() を通す（docs/security.md §1）
   */
  companyId: number;
  via: 'space' | 'dev-stub';
}

export type AppEnv = { Bindings: Env; Variables: { auth: AuthContext } };
