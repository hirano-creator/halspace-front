import type { Actor, Role } from '@tenq/shared';
import type { Env } from './env';

export interface TenqUser {
  id: string;
  hs_user_id: number;
  company_id: number;
  name: string;
  email: string | null;
  role: Role | null;
  status: 'active' | 'suspended';
  version: number;
}

export interface AuthContext {
  user: TenqUser;
  /** 権限判定（shared の can()）に渡す形 */
  actor: Actor;
  companyId: number;
  /** どのトークンで認証したか。端末記憶は Space.app に問い合わせていない */
  via: 'space' | 'device' | 'dev-stub';
  deviceSessionId?: string;
}

export type AppEnv = { Bindings: Env; Variables: { auth: AuthContext } };
