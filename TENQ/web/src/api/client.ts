/**
 * tenq-api の呼び出し口。画面からの API 呼び出しは必ずここを通す。
 * GET だけ再試行する（POST 等を再送すると二重登録になるため。二重登録は冪等キーで防ぐ）。
 */
import { clearSession, currentToken } from '../auth/session';

const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

// 本番の API の URL は Workers を作成したあと web/.env.production の VITE_TENQ_API に設定する（第7段階）
export const API_BASE: string =
  import.meta.env.VITE_TENQ_API ??
  (LOCAL_HOSTS.includes(location.hostname) ? 'http://127.0.0.1:8787/api' : '');

const TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly errors: Record<string, string> = {}) { super(message); }
}

/** 401 を受けたらログイン画面へ（ログイン情報は消す） */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void): void { onUnauthorized = fn; }

function headers(json: boolean, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json', ...extra };
  const token = currentToken();
  if (token) h.Authorization = `Bearer ${token}`;
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { message?: string; errors?: Record<string, string> };
    return new ApiError(res.status, body.message ?? `エラー (${res.status})`, body.errors ?? {});
  } catch {
    return new ApiError(res.status, `エラー (${res.status})`);
  }
}

function handle401(res: Response): void {
  if (res.status === 401) { clearSession(); onUnauthorized(); }
}

export async function apiGet<T>(path: string, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(API_BASE + path, { headers: headers(false), signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) return (await res.json()) as T;
      handle401(res);
      if (res.status < 500 || attempt >= retries) throw await toError(res);
    } catch (e) {
      if (e instanceof ApiError || attempt >= retries) {
        throw e instanceof ApiError ? e : new ApiError(0, '通信できませんでした。電波の届く場所で、もう一度お試しください。');
      }
    }
    await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
  }
}

/** POST / PATCH / PUT / DELETE。自動では再送しない（二重登録を防ぐのは冪等キーの役目） */
export async function apiSend<T = unknown>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: headers(body !== undefined, extraHeaders),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(0, '通信できませんでした。保存されたか分からないため、画面を読み込み直して確かめてください。');
  }
  if (!res.ok) { handle401(res); throw await toError(res); }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
