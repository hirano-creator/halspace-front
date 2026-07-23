// Bearerトークンを自動付与するfetchラッパー（クライアント専用）
//
// 401を受け取った場合はトークンが無効・期限切れとみなし、sessionStorageを
// クリアして /login へ強制的に戻す。

import { TOKEN_STORAGE_KEY } from "./client";

function redirectToLogin() {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  const redirect = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login?redirect=${redirect}`;
}

export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = sessionStorage.getItem(TOKEN_STORAGE_KEY);
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    redirectToLogin();
  }
  return res;
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
