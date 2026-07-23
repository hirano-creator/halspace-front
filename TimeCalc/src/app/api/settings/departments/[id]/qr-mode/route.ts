// 部署の日替わりQRモード切り替えAPI（PATCH）
// 旧 settings/actions.ts の updateDepartmentQrModeAction をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import type { SettingsFormState } from "@/app/(app)/settings/types";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiPermission(request, "manageSettings");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const formData = await request.formData();
  const dailyQrEnabled = formData.get("dailyQrEnabled") === "on";

  try {
    await prisma.department.update({ where: { id }, data: { dailyQrEnabled } });
  } catch (e) {
    console.error("部署QR設定エラー:", e);
    return NextResponse.json<SettingsFormState>({ error: "QR設定の保存に失敗しました", success: false });
  }

  return NextResponse.json<SettingsFormState>({ error: null, success: true });
}
