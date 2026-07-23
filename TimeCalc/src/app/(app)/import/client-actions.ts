// CSV取込画面から呼ぶクライアント側アクション
// 旧Server Action(import/actions.ts)を、Bearerトークン付きfetchでRoute Handlerを叩く形に置き換えたもの。

import { apiFetch } from "@/lib/auth/api-fetch";
import type { DeleteHistoryState, ImportPayload, ImportResult } from "./types";

export async function importCsvAction(payload: ImportPayload): Promise<ImportResult> {
  const res = await apiFetch("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function deleteImportHistoryAction(
  _prev: DeleteHistoryState,
  formData: FormData,
): Promise<DeleteHistoryState> {
  const id = String(formData.get("id") ?? "");
  const res = await apiFetch(`/api/import/history/${id}`, { method: "DELETE" });
  return res.json();
}
