// 会社別の上書き設定を削除し、共通設定に戻すAPI（POST）
// 旧 settings/actions.ts の resetCompanySettingAction をそのまま移植

import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { COMPANY_SETTING_KEYS, deleteCompanySetting, type CompanySettingKey } from "@/lib/settings";
import type { SettingsFormState } from "@/app/(app)/settings/types";

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "manageSettings");
  if (!auth.ok) return auth.response;

  const formData = await request.formData();
  const companyId = String(formData.get("companyId") ?? "").trim();
  const key = String(formData.get("key") ?? "");
  if (!companyId || !(COMPANY_SETTING_KEYS as readonly string[]).includes(key)) {
    return NextResponse.json<SettingsFormState>({ error: "対象の設定が不正です", success: false });
  }

  try {
    await deleteCompanySetting(companyId, key as CompanySettingKey);
  } catch (e) {
    console.error("会社別設定リセットエラー:", e);
    return NextResponse.json<SettingsFormState>({
      error: "共通設定への切り戻しに失敗しました",
      success: false,
    });
  }

  return NextResponse.json<SettingsFormState>({ error: null, success: true });
}
