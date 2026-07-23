// 表示設定（金額表示のON/OFF）の保存API（POST）
// 旧 settings/actions.ts の saveDisplaySettingsAction をそのまま移植

import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { saveDisplaySettings } from "@/lib/settings";
import type { SettingsFormState } from "@/app/(app)/settings/types";
import { resolveCompanyId } from "../_shared";

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "manageSettings");
  if (!auth.ok) return auth.response;

  const formData = await request.formData();
  const companyId = await resolveCompanyId(formData);
  if (companyId === "invalid") {
    return NextResponse.json<SettingsFormState>({ error: "対象の会社が見つかりません", success: false });
  }

  await saveDisplaySettings({ showMoney: formData.get("showMoney") === "on" }, companyId);

  return NextResponse.json<SettingsFormState>({ error: null, success: true });
}
