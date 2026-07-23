// 打刻フォームから呼ぶクライアント側アクション
// 旧Server Action(clock/actions.ts)を、Bearerトークン付きfetchでRoute Handlerを叩く形に置き換えたもの。
// useActionState({fn}, formData) にそのまま渡せるよう、シグネチャは元のServer Actionと揃えている。

import { apiFetch } from "@/lib/auth/api-fetch";
import type { PunchState, AutoPunchState, ReasonState } from "./types";

export async function punchAction(_prev: PunchState, formData: FormData): Promise<PunchState> {
  const res = await apiFetch("/api/clock/punch", { method: "POST", body: formData });
  return res.json();
}

export async function autoPunchAction(
  _prev: AutoPunchState,
  formData: FormData,
): Promise<AutoPunchState> {
  const res = await apiFetch("/api/clock/auto-punch", { method: "POST", body: formData });
  return res.json();
}

export async function saveEventReasonAction(
  _prev: ReasonState,
  formData: FormData,
): Promise<ReasonState> {
  const res = await apiFetch("/api/clock/reason", { method: "POST", body: formData });
  return res.json();
}
