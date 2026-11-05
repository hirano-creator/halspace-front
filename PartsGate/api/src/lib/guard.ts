import type { Context } from 'hono';
import { can, type Action } from '@partsgate/shared';
import type { AppEnv } from '../types';
import { forbidden, notFound } from './http';

/** 権限がなければ 403。判定は shared の権限表（docs/security.md §3）だけを見る */
export function authorize(c: Context<AppEnv>, action: Action): void {
  if (!can(c.get('auth').actor, action)) throw forbidden();
}

/** URL の :id を数字として読む。数字でなければ 404（存在を知らせない） */
export function idParam(c: Context<AppEnv>, name = 'id'): number {
  const v = Number(c.req.param(name));
  if (!Number.isSafeInteger(v) || v <= 0) throw notFound();
  return v;
}
