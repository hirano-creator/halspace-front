// 社員登録・編集フォーム共通の選択肢データ取得API（GET）

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { getCompanyIdForDepartment, getDisplaySettings, getRoleLabels } from "@/lib/settings";
import type { FormOptionsResponse } from "@/app/(app)/employees/types";

export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "manageEmployees");
  if (!auth.ok) return auth.response;
  const viewer = auth.user;

  const viewerCompanyId = await getCompanyIdForDepartment(viewer.departmentId);
  const [departments, roleLabels, display] = await Promise.all([
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    getRoleLabels(viewerCompanyId),
    getDisplaySettings(viewerCompanyId),
  ]);

  const body: FormOptionsResponse = {
    departments: departments.map((d) => ({ id: d.id, name: d.name })),
    roleLabels,
    showMoney: display.showMoney,
  };
  return NextResponse.json(body);
}
