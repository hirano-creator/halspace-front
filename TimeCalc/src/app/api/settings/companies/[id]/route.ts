// 会社の削除API（DELETE、所属部署は「未所属」になる）
// 旧 settings/actions.ts の deleteCompanyAction をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import type { SettingsFormState } from "@/app/(app)/settings/types";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiPermission(request, "manageSettings");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  try {
    await prisma.company.delete({ where: { id } });
  } catch (e) {
    console.error("会社削除エラー:", e);
    return NextResponse.json<SettingsFormState>({ error: "会社の削除に失敗しました", success: false });
  }
  return NextResponse.json<SettingsFormState>({ error: null, success: true });
}
