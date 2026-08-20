// apiFetch のリトライ挙動（Workers 側の一時的な500からの自動回復）

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// api-fetch はブラウザ専用（sessionStorage / window.location）のため、最小限のスタブを置く
const store = new Map<string, string>();
const locationStub = { pathname: "/employees", search: "", href: "" };

beforeEach(() => {
  store.clear();
  store.set("timecalc_token", "dummy-token");
  locationStub.href = "";
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("window", { location: locationStub });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** 待機（リトライ間隔）を進めながら、リクエストの完了を待つ */
async function runWithTimers<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.then(
    (v) => ({ ok: true as const, v }),
    (e) => ({ ok: false as const, e }),
  );
  await vi.runAllTimersAsync();
  const result = await settled;
  if (!result.ok) throw result.e;
  return result.v;
}

const res = (status: number) => new Response(status === 200 ? "{}" : "", { status });

describe("apiFetch のリトライ", () => {
  it("GETが500を返しても、次の試行で成功すればその結果を返す", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(500))
      .mockResolvedValueOnce(res(200));
    vi.stubGlobal("fetch", fetchMock);
    const { apiFetch } = await import("./api-fetch");

    const result = await runWithTimers(apiFetch("/api/employees"));
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("500が続いたら最後のレスポンスを返す（無限には再試行しない）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(500));
    vi.stubGlobal("fetch", fetchMock);
    const { apiFetch } = await import("./api-fetch");

    const result = await runWithTimers(apiFetch("/api/employees"));
    expect(result.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 初回 + リトライ2回
  });

  it("通信エラーも再試行し、回復すれば成功として返す", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(res(200));
    vi.stubGlobal("fetch", fetchMock);
    const { apiFetch } = await import("./api-fetch");

    const result = await runWithTimers(apiFetch("/api/employees"));
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("POSTは再試行しない（二重登録を避ける）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(500));
    vi.stubGlobal("fetch", fetchMock);
    const { apiFetch } = await import("./api-fetch");

    const result = await runWithTimers(
      apiFetch("/api/employees", { method: "POST", body: "x" }),
    );
    expect(result.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("401は再試行せずログイン画面へ戻す", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(401));
    vi.stubGlobal("fetch", fetchMock);
    const { apiFetch } = await import("./api-fetch");

    const result = await runWithTimers(apiFetch("/api/employees"));
    expect(result.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.get("timecalc_token")).toBeUndefined();
    expect(locationStub.href).toContain("/login?redirect=");
  });

  it("成功したら1回で返す", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200));
    vi.stubGlobal("fetch", fetchMock);
    const { apiFetch } = await import("./api-fetch");

    const result = await runWithTimers(apiFetch("/api/employees"));
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
