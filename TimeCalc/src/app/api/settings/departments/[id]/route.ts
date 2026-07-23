// 部署の削除API（DELETE、所属社員は「未設定」になる）
// 旧 settings/actions.ts の deleteDepartmentAction をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import type { SettingsFormState } from "@/app/(app)/settings/types";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiPermission(request, "manageSettings");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  try {
    await prisma.department.delete({ where: { id } });
  } catch (e) {
    console.error("部署削除エラー:", e);
    return NextResponse.json<SettingsFormState>({ error: "部署の削除に失敗しました", success: false });
  }
  return NextResponse.json<SettingsFormState>({ error: null, success: true });
}
