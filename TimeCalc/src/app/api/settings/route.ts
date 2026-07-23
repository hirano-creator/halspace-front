// 設定画面の初期データ取得API（GET）
// 旧 settings/page.tsx（Server Component）が行っていたデータ取得をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { getDisplaySettings, getRoleLabels, getWorkRules } from "@/lib/settings";
import { COMPANY_SETTING_KEYS } from "@/lib/settings-keys";
import type { SettingsPageResponse } from "@/app/(app)/settings/types";

export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "manageSettings");
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const companyParam = url.searchParams.get("company");

  const companies = await prisma.company.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { departments: true } } },
  });

  const selectedCompany = companies.find((c) => c.id === companyParam) ?? null;
  const companyId = selectedCompany?.id ?? null;

  const [rules, roleLabels, display, departments, overrideRows] = await Promise.all([
    getWorkRules(companyId),
    getRoleLabels(companyId),
    getDisplaySettings(companyId),
    prisma.department.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
      include: { _count: { select: { users: true } } },
    }),
    companyId
      ? prisma.companySetting.findMany({
          where: { companyId, key: { in: [...COMPANY_SETTING_KEYS] } },
          select: { key: true },
        })
      : Promise.resolve([]),
  ]);

  const body: SettingsPageResponse = {
    companies: companies.map((c) => ({ id: c.id, name: c.name, departmentCount: c._count.departments })),
    selectedCompanyId: companyId,
    selectedCompanyName: selectedCompany?.name ?? null,
    rules,
    roleLabels,
    showMoney: display.showMoney,
    departments: departments.map((d) => ({
      id: d.id,
      name: d.name,
      userCount: d._count.users,
      companyId: d.companyId,
      latitude: d.latitude,
      longitude: d.longitude,
      allowedRadiusMeters: d.allowedRadiusMeters,
      dailyQrEnabled: d.dailyQrEnabled,
      standardQrEnabled: d.standardQrEnabled,
      attendQrEnabled: d.attendQrEnabled,
      outingQrEnabled: d.outingQrEnabled,
    })),
    overrideKeys: overrideRows.map((row) => row.key),
  };

  return NextResponse.json(body);
}
