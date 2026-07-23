// マイページのフォームから呼ぶクライアント側アクション
// 旧Server Action(my/actions.ts)を、Bearerトークン付きfetchでRoute Handlerを叩く形に置き換えたもの。

import { apiFetch } from "@/lib/auth/api-fetch";
import type { MyActionState } from "./types";

export async function createCorrectionAction(
  _prev: MyActionState,
  formData: FormData,
): Promise<MyActionState> {
  const res = await apiFetch("/api/my/correction", { method: "POST", body: formData });
  return res.json();
}

export async function cancelCorrectionAction(
  _prev: MyActionState,
  formData: FormData,
): Promise<MyActionState> {
  const res = await apiFetch("/api/my/correction/cancel", { method: "POST", body: formData });
  return res.json();
}

export async function selfSaveAttendanceAction(
  _prev: MyActionState,
  formData: FormData,
): Promise<MyActionState> {
  const res = await apiFetch("/api/my/attendance", { method: "POST", body: formData });
  return res.json();
}

export async function saveMyReasonAction(
  _prev: MyActionState,
  formData: FormData,
): Promise<MyActionState> {
  const res = await apiFetch("/api/my/reason", { method: "POST", body: formData });
  return res.json();
}
