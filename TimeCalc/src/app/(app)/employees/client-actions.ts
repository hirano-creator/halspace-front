// 社員登録・編集・削除フォームから呼ぶクライアント側アクション
// 旧Server Action(employees/actions.ts)を、Bearerトークン付きfetchでRoute Handlerを叩く形に置き換えたもの。

import { apiFetch } from "@/lib/auth/api-fetch";
import type { EmployeeDeleteState, EmployeeFormState } from "./types";

export async function createEmployeeAction(
  _prev: EmployeeFormState,
  formData: FormData,
): Promise<EmployeeFormState> {
  const res = await apiFetch("/api/employees", { method: "POST", body: formData });
  return res.json();
}

export async function updateEmployeeAction(
  _prev: EmployeeFormState,
  formData: FormData,
): Promise<EmployeeFormState> {
  const id = String(formData.get("id") ?? "");
  const res = await apiFetch(`/api/employees/${id}`, { method: "PATCH", body: formData });
  return res.json();
}

export async function deleteEmployeeAction(
  _prev: EmployeeDeleteState,
  formData: FormData,
): Promise<EmployeeDeleteState> {
  const id = String(formData.get("id") ?? "");
  const res = await apiFetch(`/api/employees/${id}`, { method: "DELETE" });
  return res.json();
}
