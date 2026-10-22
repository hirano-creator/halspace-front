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
}

export function saveDeviceToken(token: string): void { write(ls, DEVICE_TOKEN, token); }
export function hasDeviceToken(): boolean { return read(ls, DEVICE_TOKEN) !== null; }

export function clearSession(): void {
  write(ss, SPACE_TOKEN, null);
  write(ss, SPACE_USER, null);
  write(ls, DEVICE_TOKEN, null);
}

/** 未ログインで QR を読んだとき、ログイン後に戻る先として覚えておく */
export function setPendingQr(token: string | null): void { write(ss, PENDING_QR, token); }
export function takePendingQr(): string | null {
  const t = read(ss, PENDING_QR);
  write(ss, PENDING_QR, null);
  return t;
}
