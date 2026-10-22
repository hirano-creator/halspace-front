/**
 * ログイン状態の保存（docs/security.md §2）。
 *  - Space.app のトークン: sessionStorage の space_token / space_user（Space.app・SOLID・What'sNo と共通。タブごとに独立）
 *  - TENQ の端末記憶トークン: localStorage の tenq_device_token（TENQ でしか使えない。30 日）
 * Space.app のトークンを localStorage に置かないこと。
 */

const SPACE_TOKEN = 'space_token';
const SPACE_USER = 'space_user';
const DEVICE_TOKEN = 'tenq_device_token';
const PENDING_QR = 'tenq_pending_qr';
const LOGIN_AT = 'tenq_login_at';

// プライベートモードなどで Storage が使えなくても落とさない
function read(store: () => Storage, key: string): string | null {
  try { return store().getItem(key); } catch { return null; }
}
function write(store: () => Storage, key: string, value: string | null): void {
  try { if (value === null) store().removeItem(key); else store().setItem(key, value); } catch { /* 何もしない */ }
}
const ss = () => sessionStorage;
const ls = () => localStorage;

export interface SpaceUser {
  id: number; name: string; email: string; role: string; company: string | null; company_id: number | null; apps: string[]; token: string;
}

/** API に付けるトークン。このタブで Space.app にログインしていればそれを、なければ端末記憶を使う */
export function currentToken(): string | null {
  return read(ss, SPACE_TOKEN) ?? read(ls, DEVICE_TOKEN);
}

export function saveSpaceSession(token: string, user: SpaceUser): void {
  write(ss, SPACE_TOKEN, token);
  write(ss, SPACE_USER, JSON.stringify(user));
  write(ss, LOGIN_AT, String(Date.now()));
}

/**
 * Space.app のトークンは期限がない（docs/security.md §2-2）ので、TENQ では一定時間ごとに再ログインしてもらう。
 * Space.app から開いた場合は、TENQ で最初に確認した時刻から数える。端末記憶のログインは対象外（別に 30 日の期限がある）。
 */
export function spaceSessionExpired(reauthHours: number): boolean {
  if (!read(ss, SPACE_TOKEN)) return false;
  const at = Number(read(ss, LOGIN_AT));
  if (!at) { write(ss, LOGIN_AT, String(Date.now())); return false; }
  return Date.now() - at > reauthHours * 3_600_000;
}

export function saveDeviceToken(token: string): void { write(ls, DEVICE_TOKEN, token); }
export function hasDeviceToken(): boolean { return read(ls, DEVICE_TOKEN) !== null; }

export function clearSession(): void {
  write(ss, SPACE_TOKEN, null);
  write(ss, SPACE_USER, null);
  write(ss, LOGIN_AT, null);
  write(ls, DEVICE_TOKEN, null);
}

/** 未ログインで QR を読んだとき、ログイン後に戻る先として覚えておく */
export function setPendingQr(token: string | null): void { write(ss, PENDING_QR, token); }
export function takePendingQr(): string | null {
  const t = read(ss, PENDING_QR);
  write(ss, PENDING_QR, null);
  return t;
}
