// /api/corrections/* の各Route Handlerが共有するロジック

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { canEditOthersAttendance, canViewEmployee } from "@/lib/auth/guard";
import type { SessionUser } from "@/lib/auth/session";
import { toJst } from "@/lib/utils/time";

export function formatDateTime(d: Date): string {
  // UTC保存の日時を JST で表示する（サーバーのTZに依存しない）
  const j = toJst(d);
  return `${j.getUTCFullYear()}/${j.getUTCMonth() + 1}/${j.getUTCDate()} ${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`;
}

/** 申請を取得し、レビュー可能か検証する（店長は自部署のみ・会社権限者は自社のみ） */
export async function findReviewable(request: Request, requestId: string) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return { ok: false as const, response: auth.response };
  const viewer: SessionUser = auth.user;
  if (!canEditOthersAttendance(viewer)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "権限がありません" }, { status: 403 }),
    };
  }

  const correctionRequest = await prisma.correctionRequest.findUnique({
    where: { id: requestId },
    include: { user: { include: { department: true } } },
  });
  if (!correctionRequest) {
    return { ok: false as const, error: "対象の申請が見つかりません" };
  }
  if (correctionRequest.status !== "PENDING") {
    return { ok: false as const, error: "この申請は処理済みです" };
  }
  const target = correctionRequest.user;
  if (
    !canViewEmployee(viewer, {
      id: target.id,
      departmentId: target.departmentId,
      companyId: target.department?.companyId ?? null,
    })
  ) {
    return { ok: false as const, error: "担当範囲外の申請は処理できません" };
  }
  return { ok: true as const, viewer, request: correctionRequest };
}
