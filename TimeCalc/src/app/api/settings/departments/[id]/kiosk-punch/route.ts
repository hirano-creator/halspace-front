// 部署ごとのスマホ忘れ打刻（店舗タブレットで顔写真つき打刻）のON/OFF設定API（PATCH）

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import type { SettingsFormState } from "@/app/(app)/settings/types";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiPermission(request, "manageSettings");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const formData = await request.formData();
  const kioskPunchEnabled = formData.get("kioskPunchEnabled") === "on";

  try {
    await prisma.department.update({ where: { id }, data: { kioskPunchEnabled } });
  } catch (e) {
    console.error("部署スマホ忘れ打刻設定エラー:", e);
    return NextResponse.json<SettingsFormState>(
      { error: "スマホ忘れ打刻の設定の保存に失敗しました", success: false },
      { status: 500 },
    );
  }

  return NextResponse.json<SettingsFormState>({ error: null, success: true });
}
