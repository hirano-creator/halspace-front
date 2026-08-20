// Bearerトークンを自動付与するfetchラッパー（クライアント専用）
//
// 401を受け取った場合はトークンが無効・期限切れとみなし、sessionStorageを
// クリアして /login へ強制的に戻す。
//
// Cloudflare Workers 上では、負荷が重なった一瞬だけリクエストが応答を返せず
// ランタイム側で打ち切られ 500 になることがある（「リクエストに失敗しました (500)」）。
// 実際には次の試行で通るため、取得系（GET）に限り自動で数回リトライして
// 画面にエラーを出さずに回復させる。

import { TOKEN_STORAGE_KEY } from "./client";

function redirectToLogin() {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  const redirect = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login?redirect=${redirect}`;
}

/** 一時的な失敗とみなして再試行するステータス（サーバー側の瞬断・過負荷） */
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
/** リトライ間隔（ms）。長さぶんだけ再試行する */
const RETRY_DELAYS = [700, 2000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 副作用のない取得系のみリトライする（POST等を再送すると二重登録になるため） */
function isRetryableRequest(init: RequestInit): boolean {
  const method = (init.method ?? "GET").toUpperCase();
  return method === "GET" || method === "HEAD";
}

export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = sessionStorage.getItem(TOKEN_STORAGE_KEY);
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const retries = isRetryableRequest(init) ? RETRY_DELAYS.length : 0;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS[attempt - 1]);
    try {
      const res = await fetch(url, { ...init, headers });
      if (res.status === 401) {
        redirectToLogin();
        return res;
      }
      // 一時的なサーバーエラーは、まだ試行が残っていれば黙って再試行する
      if (RETRYABLE_STATUS.has(res.status) && attempt < retries) continue;
      return res;
    } catch (e) {
      // 通信断・タイムアウトも同様に再試行し、使い切ったら呼び出し元へ投げる
      lastError = e;
      if (attempt >= retries) throw e;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("リクエストに失敗しました");
}

export async function apiFetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(
      (body && typeof body.error === "string" && body.error) ||
        `リクエストに失敗しました (${res.status})`,
    );
  }
  return res.json();
}

/** Content-Dispositionのファイル名を尊重してBlobをダウンロードさせる（CSVエクスポート等） */
export async function downloadFile(url: string): Promise<void> {
  const res = await apiFetch(url);
  if (!res.ok) throw new Error("ダウンロードに失敗しました");

  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "export.csv";

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
}
