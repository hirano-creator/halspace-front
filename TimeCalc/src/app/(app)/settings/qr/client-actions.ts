// 打刻QR画面のフォームから呼ぶクライアント側アクション
// 旧Server Action(settings/qr/actions.ts)を、Bearerトークン付きfetchでRoute Handlerを叩く形に置き換えたもの。

import { apiFetch } from "@/lib/auth/api-fetch";
import type { QrKeyActionState } from "./types";

export async function issueKioskKeyAction(
  _prev: QrKeyActionState,
  formData: FormData,
): Promise<QrKeyActionState> {
  const departmentId = String(formData.get("departmentId") ?? "");
  const res = await apiFetch(`/api/settings/qr/${departmentId}/kiosk-key`, { method: "POST" });
  return res.json();
}

export async function revokeKioskKeyAction(
  _prev: QrKeyActionState,
  formData: FormData,
): Promise<QrKeyActionState> {
  const departmentId = String(formData.get("departmentId") ?? "");
  const res = await apiFetch(`/api/settings/qr/${departmentId}/kiosk-key`, { method: "DELETE" });
  return res.json();
}
