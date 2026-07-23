// サイドバー・ドロワーのナビゲーション用データ取得API（GET）
// 旧 (app)/layout.tsx（Server Component）が行っていた roleLabels・未処理修正申請件数の取得を移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { can } from "@/lib/auth/roles";
import { getCompanyIdForDepartment, getRoleLabels } from "@/lib/settings";
import { visibleUsersWhere } from "@/lib/attendance/service";
import type { NavResponse } from "@/app/(app)/types";

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const companyId = await getCompanyIdForDepartment(user.departmentId);
  const [roleLabels, pendingCorrections] = await Promise.all([
    getRoleLabels(companyId),
    can(user.role, "editAttendance")
      ? prisma.correctionRequest.count({ where: { status: "PENDING", user: visibleUsersWhere(user) } })
      : Promise.resolve(0),
  ]);

  const body: NavResponse = { roleLabels, pendingCorrections };
  return NextResponse.json(body);
}
