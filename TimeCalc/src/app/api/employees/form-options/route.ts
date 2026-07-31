// 社員登録・編集フォーム共通の選択肢データ取得API（GET）

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { getCompanyIdForDepartment, getDisplaySettings, getRoleLabels } from "@/lib/settings";
import { nextEmployeeCode } from "@/lib/employee-code";
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

  // 部署を選んだときに社員番号へ自動入力する「次の番号」を会社ごとに1度だけ求め、
  // 部署IDから引けるようにして返す（部署未設定は接頭辞なしの既定ルール）。
  const companyIds = [...new Set(departments.map((d) => d.companyId).filter((id) => id !== null))];
  const nextCodeByCompany = new Map(
    await Promise.all(companyIds.map(async (id) => [id, await nextEmployeeCode(id)] as const)),
  );
  const nextCodeByDepartment: Record<string, string> = {};
  for (const d of departments) {
    const code = d.companyId ? nextCodeByCompany.get(d.companyId) : undefined;
    if (code) nextCodeByDepartment[d.id] = code;
  }

  const body: FormOptionsResponse = {
    departments: departments.map((d) => ({ id: d.id, name: d.name })),
    roleLabels,
    showMoney: display.showMoney,
    nextCodeByDepartment,
    defaultNextCode: await nextEmployeeCode(null),
  };
  return NextResponse.json(body);
}
