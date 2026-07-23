// /api/corrections/* の各Route Handlerが共有するロジック

import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { can } from "@/lib/auth/roles";
import type { SessionUser } from "@/lib/auth/session";
import { toJst } from "@/lib/utils/time";

export function formatDateTime(d: Date): string {
  // UTC保存の日時を JST で表示する（サーバーのTZに依存しない）
  const j = toJst(d);
  return `${j.getUTCFullYear()}/${j.getUTCMonth() + 1}/${j.getUTCDate()} ${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`;
}

/** 申請を取得し、レビュー可能か検証する（店長は自部署のみ） */
export async function findReviewable(request: Request, requestId: string) {
  const auth = await requireApiPermission(request, "editAttendance");
  if (!auth.ok) return { ok: false as const, response: auth.response };
  const viewer: SessionUser = auth.user;

  const correctionRequest = await prisma.correctionRequest.findUnique({
    where: { id: requestId },
    include: { user: true },
  });
  if (!correctionRequest) {
    return { ok: false as const, error: "対象の申請が見つかりません" };
  }
  if (correctionRequest.status !== "PENDING") {
    return { ok: false as const, error: "この申請は処理済みです" };
  }
  if (
    !can(viewer.role, "viewAllEmployees") &&
    (!viewer.departmentId || viewer.departmentId !== correctionRequest.user.departmentId)
  ) {
    return { ok: false as const, error: "自部署以外の申請は処理できません" };
  }
  return { ok: true as const, viewer, request: correctionRequest };
}
