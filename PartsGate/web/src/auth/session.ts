/**
 * ログイン状態の保存（docs/security.md §2、スキル space-app-shell）。
 *  - Space.app のトークン: sessionStorage の space_token / space_user（Space.app・SOLID・What'sNo・TENQ と共通。タブごとに独立）
 *  - localStorage には置かない（別タブで別アカウントにログインしたときに混ざらないようにするため）
 */

const SPACE_TOKEN = 'space_token';
const SPACE_USER = 'space_user';
const LOGIN_AT = 'pg_login_at';
const STANDALONE = 'partsgate_standalone';

// プライベートモードなどで Storage が使えなくても落とさない
function read(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null): void {
  try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value); } catch { /* 何もしない */ }
}

export interface SpaceUser {
  id: number; name: string; email: string; role: string; company: string | null; company_id: number | null; apps: string[]; token: string;
}

export function currentToken(): string | null {
  return read(SPACE_TOKEN);
}

export function saveSpaceSession(token: string, user: SpaceUser): void {
  write(SPACE_TOKEN, token);
  write(SPACE_USER, JSON.stringify(user));
  write(LOGIN_AT, String(Date.now()));
}

/**
 * Space.app のトークンは期限がないので、PARTS GATE では一定時間ごとに再ログインしてもらう（会社の設定 reauth_hours）。
 * Space.app から開いた場合は、PARTS GATE で最初に確認した時刻から数える。
 */
export function sessionExpired(reauthHours: number): boolean {
  if (!read(SPACE_TOKEN)) return false;
  const at = Number(read(LOGIN_AT));
  if (!at) { write(LOGIN_AT, String(Date.now())); return false; }
  return Date.now() - at > reauthHours * 3_600_000;
}

export function clearSession(): void {
  write(SPACE_TOKEN, null);
  write(SPACE_USER, null);
  write(LOGIN_AT, null);
  write(STANDALONE, null);
}

/** Space.app のアプリ選択画面（PartsGate/app/ から 2 つ上の space/）。ログインは保ったまま移動する */
export const SPACE_APPS_URL = '../../space/apps.html';

/** PARTS GATE のログイン画面から入ったタブ。メニューに「アプリ選択に戻る」ではなく「ログアウト」を出す */
export function markStandalone(): void { write(STANDALONE, '1'); }
export function isStandalone(): boolean { return read(STANDALONE) === '1'; }
