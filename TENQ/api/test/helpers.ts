import { env } from 'cloudflare:workers';
import app from '../src/index';

/** ダミーデータの利用者（開発用の簡易ログイン "dev-<hs_user_id>"） */
export const T = {
  worker: 'dev-900001',     // 山本（一般社員・第1工場）
  staff: 'dev-900002',      // 佐藤（設備担当・第1工場。P-01〜L-07・CR-1/2 の担当）
  staff2: 'dev-900003',     // 鈴木（設備担当・第1工場。M-04 などの担当）
  manager: 'dev-900004',    // 中村（工場長・第1工場）
  admin: 'dev-900005',      // 高橋（システム管理者）
  worker2: 'dev-900006',    // 田中（一般社員・第2工場）
  norole: 'dev-900007',     // ロール未設定
  suspended: 'dev-900008',  // 利用停止中
  other: 'dev-900101',      // 他社の工場長
} as const;

export interface Res<T = any> { status: number; body: T; headers: Headers }

export async function call<T = any>(method: string, path: string, token?: string, body?: unknown, envOverride: Partial<typeof env> = {}): Promise<Res<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await app.request(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, { ...env, ...envOverride });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

export const get = <T = any>(path: string, token?: string) => call<T>('GET', path, token);
export const post = <T = any>(path: string, token: string, body: unknown = {}) => call<T>('POST', path, token, body);
export const patch = <T = any>(path: string, token: string, body: unknown) => call<T>('PATCH', path, token, body);
export const del = <T = any>(path: string, token: string) => call<T>('DELETE', path, token);

export async function auditCount(action: string, targetId: string): Promise<number> {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE action = ? AND target_id = ?').bind(action, targetId).first<{ n: number }>();
  return r?.n ?? 0;
}

export async function version(table: string, id: string): Promise<number> {
  const r = await env.DB.prepare(`SELECT version FROM ${table} WHERE id = ?`).bind(id).first<{ version: number }>();
  return r?.version ?? 0;
}
