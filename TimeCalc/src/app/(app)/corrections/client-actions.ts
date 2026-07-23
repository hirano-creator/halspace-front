// 修正申請の承認・却下フォームから呼ぶクライアント側アクション
// 旧Server Action(corrections/actions.ts)を、Bearerトークン付きfetchでRoute Handlerを叩く形に置き換えたもの。

import { apiFetch } from "@/lib/auth/api-fetch";
import type { ReviewState } from "./types";

export async function approveCorrectionAction(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const id = String(formData.get("id") ?? "");
  const res = await apiFetch(`/api/corrections/${id}/approve`, { method: "POST", body: formData });
  return res.json();
}

export async function rejectCorrectionAction(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const id = String(formData.get("id") ?? "");
  const res = await apiFetch(`/api/corrections/${id}/reject`, { method: "POST", body: formData });
  return res.json();
}
