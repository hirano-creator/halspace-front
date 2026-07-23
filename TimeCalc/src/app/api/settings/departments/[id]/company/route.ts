// 部署の所属会社の変更API（PATCH、空文字 = 未所属）
// 旧 settings/actions.ts の updateDepartmentCompanyAction をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import type { SettingsFormState } from "@/app/(app)/settings/types";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiPermission(request, "manageSettings");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const formData = await request.formData();
  const companyId = String(formData.get("companyId") ?? "") || null;

  try {
    await prisma.department.update({ where: { id }, data: { companyId } });
  } catch (e) {
    console.error("部署の会社設定エラー:", e);
    return NextResponse.json<SettingsFormState>({ error: "所属会社の保存に失敗しました", success: false });
  }

  return NextResponse.json<SettingsFormState>({ error: null, success: true });
}
