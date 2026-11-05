/**
 * Space.app（halspace-api）へのログインと2段階認証。
 * 仕様は space/assets/js/mfa.js と同じ。2段階認証の「信頼済み端末」は Space.app と同じ
 * localStorage のキー（space_device_tokens）を使うので、同じブラウザなら Space.app と共有される。
 */

const LOCAL_HOSTS = ['localhost', '127.0.0.1'];
export const SPACE_API = LOCAL_HOSTS.includes(location.hostname) || location.hostname.endsWith('.test')
  ? 'http://127.0.0.1:8000/api'
  : 'https://halspace-api-production.up.railway.app/api';

const MFA_DEVICE_STORE_KEY = 'space_device_tokens';

/** メールアドレスを平文で保存しないための短いダイジェスト（mfa.js の mfaEmailKey と同じ FNV-1a） */
function emailKey(email: string): string {
  let h = 0x811c9dc5;
  const s = email.trim().toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function readStore(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(MFA_DEVICE_STORE_KEY) ?? '{}') as Record<string, string>; } catch { return {}; }
}
function writeStore(store: Record<string, string>): void {
  try { localStorage.setItem(MFA_DEVICE_STORE_KEY, JSON.stringify(store)); } catch { /* 何もしない */ }
}

export interface SpaceLoginResult {
  token: string;
  user: { id: number; name: string; email: string; role: string; company_name: string | null; company_id: number | null; apps_enabled: string[] | null };
  device_token?: string;
}

export type LoginStep =
  | { mode: 'done'; data: SpaceLoginResult }
  | { mode: 'mfa'; challenge: string; maskedEmail: string; resendAfter: number };

export class SpaceLoginError extends Error {
  constructor(message: string, readonly status: number, readonly restart: boolean) { super(message); }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(SPACE_API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new SpaceLoginError('ログインの確認先に接続できません。通信状況を確かめて、もう一度お試しください。', 0, false);
  }
  let data: Record<string, unknown> = {};
  try { data = (await res.json()) as Record<string, unknown>; } catch { /* 502 などで HTML が返る場合 */ }
  if (!res.ok) throw new SpaceLoginError(String(data.message ?? 'ログインに失敗しました。'), res.status, Boolean(data.restart));
  return data as T;
}

export async function spaceLogin(email: string, password: string): Promise<LoginStep> {
  const data = await post<SpaceLoginResult & { mfa_required?: boolean; challenge?: string; masked_email?: string; resend_after?: number }>(
    '/auth/login', { email, password, device_token: readStore()[emailKey(email)] ?? null });
  if (data.mfa_required) {
    return { mode: 'mfa', challenge: data.challenge ?? '', maskedEmail: data.masked_email ?? '', resendAfter: data.resend_after ?? 60 };
  }
  return { mode: 'done', data };
}

export async function spaceVerify(email: string, challenge: string, code: string, rememberDevice: boolean): Promise<SpaceLoginResult> {
  const data = await post<SpaceLoginResult>('/auth/login/verify', { challenge, code, remember_device: rememberDevice });
  if (data.device_token) {
    const store = readStore();
    store[emailKey(email)] = data.device_token;
    writeStore(store);
  }
  return data;
}

export async function spaceResend(challenge: string): Promise<void> {
  await post('/auth/login/resend', { challenge });
}
