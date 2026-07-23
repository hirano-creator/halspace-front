// 承認待ちの修正申請を取り下げるAPI（POST、本人のみ）
// 旧 my/actions.ts の cancelCorrectionAction をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import type { MyActionState } from "@/app/(app)/my/types";

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;
  const viewer = auth.user;

  const formData = await request.formData();
  const id = String(formData.get("id") ?? "");

  const correctionRequest = await prisma.correctionRequest.findUnique({ where: { id } });
  if (!correctionRequest || correctionRequest.userId !== viewer.id) {
    return NextResponse.json<MyActionState>({ error: "対象の申請が見つかりません", success: false });
  }
  if (correctionRequest.status !== "PENDING") {
    return NextResponse.json<MyActionState>({
      error: "処理済みの申請は取り下げできません",
      success: false,
    });
  }

  try {
    await prisma.correctionRequest.delete({ where: { id } });
  } catch (e) {
    console.error("申請取り下げエラー:", e);
    return NextResponse.json<MyActionState>({ error: "申請の取り下げに失敗しました", success: false });
  }

  return NextResponse.json<MyActionState>({ error: null, success: true });
}
