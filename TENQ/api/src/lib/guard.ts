import type { Context } from 'hono';
import { can, type Action, type Target } from '@tenq/shared';
import type { AppEnv } from '../types';
import { forbidden } from './http';

/** 権限がなければ 403。判定は shared の権限表（requirements §3-2）だけを見る */
export function authorize(c: Context<AppEnv>, action: Action, target: Target = {}): void {
  if (!can(c.get('auth').actor, action, target)) throw forbidden();
}
