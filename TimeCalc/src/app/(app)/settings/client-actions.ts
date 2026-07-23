// 設定画面のフォームから呼ぶクライアント側アクション
// 旧Server Action(settings/actions.ts)を、Bearerトークン付きfetchでRoute Handlerを叩く形に置き換えたもの。

import { apiFetch } from "@/lib/auth/api-fetch";
import type { SettingsFormState } from "./types";

async function postForm(url: string, formData: FormData): Promise<SettingsFormState> {
  const res = await apiFetch(url, { method: "POST", body: formData });
  return res.json();
}

async function patchForm(url: string, formData: FormData): Promise<SettingsFormState> {
  const res = await apiFetch(url, { method: "PATCH", body: formData });
  return res.json();
}

async function deleteForm(url: string): Promise<SettingsFormState> {
  const res = await apiFetch(url, { method: "DELETE" });
  return res.json();
}

export async function saveWorkRulesAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  return postForm("/api/settings/work-rules", formData);
}

export async function saveRoleLabelsAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  return postForm("/api/settings/role-labels", formData);
}

export async function saveDisplaySettingsAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  return postForm("/api/settings/display", formData);
}

export async function resetCompanySettingAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  return postForm("/api/settings/company-setting/reset", formData);
}

export async function addCompanyAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  return postForm("/api/settings/companies", formData);
}

export async function deleteCompanyAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const id = String(formData.get("id") ?? "");
  return deleteForm(`/api/settings/companies/${id}`);
}

export async function addDepartmentAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  return postForm("/api/settings/departments", formData);
}

export async function deleteDepartmentAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const id = String(formData.get("id") ?? "");
  return deleteForm(`/api/settings/departments/${id}`);
}

export async function updateDepartmentGpsAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const id = String(formData.get("id") ?? "");
  return patchForm(`/api/settings/departments/${id}/gps`, formData);
}

export async function updateDepartmentQrModeAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const id = String(formData.get("id") ?? "");
  return patchForm(`/api/settings/departments/${id}/qr-mode`, formData);
}

export async function updateDepartmentQrKindsAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const id = String(formData.get("id") ?? "");
  return patchForm(`/api/settings/departments/${id}/qr-kinds`, formData);
}

export async function updateDepartmentCompanyAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const id = String(formData.get("id") ?? "");
  return patchForm(`/api/settings/departments/${id}/company`, formData);
}
