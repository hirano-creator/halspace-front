import { env } from 'cloudflare:workers';
import { app } from '../src/index';

/** ダミーデータの利用者（開発用の簡易ログイン "dev-<hs_user_id>"。api/seed/dev-seed.sql） */
export const T = {
  adminA: 'dev-900001',     // 会社 A の管理者（運営者でもある）
  generalA: 'dev-900002',   // 会社 A の一般（出荷場 PC）
  suspendedA: 'dev-900003', // 会社 A の利用停止中
  admin2A: 'dev-900004',    // 会社 A のもう 1 人の管理者
  adminB: 'dev-900101',     // 会社 B の管理者
  generalB: 'dev-900102',   // 会社 B の一般
  adminC: 'dev-900201',     // 停止中の会社の管理者
} as const;

export interface Res<T = any> { status: number; body: T; headers: Headers }

export async function call<T = any>(method: string, path: string, token?: string, body?: unknown): Promise<Res<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await app.request(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
  const text = await res.text();
  let parsed: unknown = null;
  if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
  return { status: res.status, body: parsed as T, headers: res.headers };
}

/** CSV の本体をそのまま送る（取込の POST /imports） */
export async function upload(token: string, text: string, headers: Record<string, string> = {}): Promise<Res> {
  const body = new TextEncoder().encode(text);
  const res = await app.request('/api/imports', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'text/csv', 'Content-Length': String(body.length),
      'X-File-Name': encodeURIComponent('test.csv'), 'X-File-Sha256': 'a'.repeat(64), 'X-Encoding': 'utf-8', ...headers,
    },
    body,
  }, env);
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : null, headers: res.headers };
}

export const get = <T = any>(path: string, token?: string) => call<T>('GET', path, token);
export const post = <T = any>(path: string, token: string, body: unknown = {}) => call<T>('POST', path, token, body);
export const put = <T = any>(path: string, token: string, body: unknown) => call<T>('PUT', path, token, body);

export async function sql<T = any>(query: string, ...params: unknown[]): Promise<T[]> {
  return (await env.DB.prepare(query).bind(...params).all<T>()).results;
}

export async function auditCount(action: string, targetId?: string | number): Promise<number> {
  const r = targetId === undefined
    ? await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE action = ?').bind(action).first<{ n: number }>()
    : await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE action = ? AND target_id = ?').bind(action, String(targetId)).first<{ n: number }>();
  return r?.n ?? 0;
}

export async function versionOf(table: string, id: number): Promise<number> {
  const r = await env.DB.prepare(`SELECT version FROM ${table} WHERE id = ?`).bind(id).first<{ version: number }>();
  return r?.version ?? 0;
}
