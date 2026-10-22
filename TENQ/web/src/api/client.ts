/**
 * tenq-api の呼び出し口。画面からの API 呼び出しは必ずここを通す。
 * GET だけ再試行する（POST 等を再送すると二重登録になるため。二重登録は冪等キーで防ぐ）。
 */

const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

// 本番の API の URL は Workers を作成したあと web/.env.production の VITE_TENQ_API に設定する（第7段階）
export const API_BASE: string =
  import.meta.env.VITE_TENQ_API ??
  (LOCAL_HOSTS.includes(location.hostname) ? 'http://127.0.0.1:8787/api' : '');

const TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function apiGet<T>(path: string, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(API_BASE + path, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
      if (res.ok) return (await res.json()) as T;
      if (res.status < 500 || attempt >= retries) throw new ApiError(res.status, await messageOf(res));
    } catch (e) {
      if (e instanceof ApiError || attempt >= retries) throw e;
    }
    await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
  }
}

async function messageOf(res: Response): Promise<string> {
  try { return ((await res.json()) as { message?: string }).message ?? `エラー (${res.status})`; }
  catch { return `エラー (${res.status})`; }
}
