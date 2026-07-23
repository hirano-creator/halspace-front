// 部署の追加API（POST）
// 旧 settings/actions.ts の addDepartmentAction をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
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

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return NextResponse.json<SettingsFormState>({ error: "部署名を入力してください", success: false });

  const dup = await prisma.department.findUnique({ where: { name } });
  if (dup) {
    return NextResponse.json<SettingsFormState>({ error: "同じ名前の部署が既に存在します", success: false });
  }

  await prisma.department.create({ data: { name, companyId } });
  return NextResponse.json<SettingsFormState>({ error: null, success: true });
}
