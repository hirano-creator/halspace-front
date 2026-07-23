// 社員CSV一括登録画面から呼ぶクライアント側アクション
// 旧Server Action(employees/bulk/actions.ts)を、Bearerトークン付きfetchでRoute Handlerを叩く形に置き換えたもの。

import { apiFetch } from "@/lib/auth/api-fetch";
import type { BulkResult, BulkRow } from "./types";

export async function bulkCreateEmployeesAction(rows: BulkRow[]): Promise<BulkResult> {
  const res = await apiFetch("/api/employees/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  return res.json();
}
