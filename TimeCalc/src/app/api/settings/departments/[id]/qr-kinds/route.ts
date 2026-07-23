// 部署のQR表示画面に表示するQR種類の設定API（PATCH）
// 旧 settings/actions.ts の updateDepartmentQrKindsAction をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import type { SettingsFormState } from "@/app/(app)/settings/types";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiPermission(request, "manageSettings");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const formData = await request.formData();
  const standardQrEnabled = formData.get("standardQrEnabled") === "on";
  const attendQrEnabled = formData.get("attendQrEnabled") === "on";
  const outingQrEnabled = formData.get("outingQrEnabled") === "on";

  try {
    await prisma.department.update({
      where: { id },
      data: { standardQrEnabled, attendQrEnabled, outingQrEnabled },
    });
  } catch (e) {
    console.error("部署QR種類設定エラー:", e);
    return NextResponse.json<SettingsFormState>({ error: "QR種類の保存に失敗しました", success: false });
  }

  return NextResponse.json<SettingsFormState>({ error: null, success: true });
}
