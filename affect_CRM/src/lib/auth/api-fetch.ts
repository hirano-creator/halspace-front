// Bearer トークンを自動付与する fetch ラッパー（クライアント専用）
//
// 401 を受けたらトークンが無効・期限切れとみなし、sessionStorage をクリアして
// /login へ戻す。
//
// Cloudflare Workers では負荷が重なった一瞬だけ応答を返せずランタイム側で
// 打ち切られて 500 になることがある。実際には次の試行で通るため、取得系（GET）に
// 限り自動で数回リトライして画面にエラーを出さずに回復させる。

import { TOKEN_STORAGE_KEY } from "./client";

function redirectToLogin() {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  const redirect = encodeURIComponent(window.location.pathname + window.location.search);
  // router.push ではなく完全なページ遷移にする。トークンが無効になった以上、
  // 各画面が持っている取得済みデータごと破棄したいため。
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `/login?redirect=${redirect}`;
}

const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
const RETRY_DELAYS = [700, 2000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 副作用のない取得系のみリトライする（POST 等を再送すると二重登録になる） */
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
      if (RETRYABLE_STATUS.has(res.status) && attempt < retries) continue;
      return res;
    } catch (e) {
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

/** Content-Disposition のファイル名を尊重して Blob をダウンロードさせる（CSV 出力） */
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
