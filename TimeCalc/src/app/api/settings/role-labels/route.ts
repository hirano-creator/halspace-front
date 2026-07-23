// 権限の表示名の保存API（POST）
// 旧 settings/actions.ts の saveRoleLabelsAction をそのまま移植

import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { saveRoleLabels } from "@/lib/settings";
import { ROLES, type Role } from "@/lib/auth/roles";
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

  const labels = {} as Record<Role, string>;
  for (const role of ROLES) {
    const label = String(formData.get(`label_${role}`) ?? "").trim();
    if (!label) {
      return NextResponse.json<SettingsFormState>({
        error: "権限の表示名はすべて入力してください",
        success: false,
      });
    }
    labels[role] = label;
  }

  await saveRoleLabels(labels, companyId);

  return NextResponse.json<SettingsFormState>({ error: null, success: true });
}
