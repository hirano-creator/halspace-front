// 勤怠一覧の取得API（GET）
// 旧 attendance/page.tsx（Server Component）が行っていたデータ取得をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { can } from "@/lib/auth/roles";
import { attendanceScope } from "@/lib/auth/guard";
import { getMonthlySummaries } from "@/lib/attendance/service";
import { getAllWorkRules, getCompanyIdForDepartment, getDisplaySettings, workRulesFor } from "@/lib/settings";
import { currentPeriod, formatPeriodRange, periodRange } from "@/lib/utils/time";
import type { AttendancePageResponse } from "@/app/(app)/attendance/types";

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const url = new URL(request.url);
  const monthParam = url.searchParams.get("month");
  const query = url.searchParams.get("q")?.trim() || undefined;
  const departmentId = url.searchParams.get("department") || undefined;
  const companyId = url.searchParams.get("company") || undefined;

  const viewerCompanyId = await getCompanyIdForDepartment(user.departmentId);
  // 会社/部署の絞り込みフィルタは、複数人を横断して見られる範囲のときだけ出す。
  // 一覧もその範囲に限る（全社の会社・部署名を、閲覧範囲が自部署や自分だけの人に返さない）
  const scope = attendanceScope(user);
  const showFilters = scope === "all" || scope === "company";
  const orgWhere = scope === "all" ? {} : { id: viewerCompanyId ?? "" };
  const [allRules, display, companies, departments] = await Promise.all([
    getAllWorkRules(),
    getDisplaySettings(viewerCompanyId),
    showFilters ? prisma.company.findMany({ where: orgWhere, orderBy: { name: "asc" } }) : [],
    showFilters
      ? prisma.department.findMany({
          where: scope === "all" ? {} : { companyId: viewerCompanyId ?? "" },
          orderBy: { name: "asc" },
          include: { company: true },
        })
      : [],
  ]);

  const rules = workRulesFor(allRules, companyId ?? null);
  const month = /^\d{4}-\d{2}$/.test(monthParam ?? "") ? monthParam! : currentPeriod(rules.closingDay);
  const period = periodRange(month, rules.closingDay);

  const summaries = await getMonthlySummaries(user, month, { departmentId, companyId, query }, allRules);
  const [year, monthNum] = month.split("-").map(Number);

  const body: AttendancePageResponse = {
    month,
    year,
    monthNum,
    periodRangeLabel: formatPeriodRange(period),
    closingDay: rules.closingDay,
    hasCompanyRules: allRules.byCompany.size > 0,
    canExport: can(user.role, "exportCsv"),
    showFilters,
    showMoney: display.showMoney,
    companies: companies.map((c) => ({ id: c.id, name: c.name })),
    departments: departments.map((d) => ({
      id: d.id,
      name: d.name,
      companyName: d.company?.name ?? null,
    })),
    summaries,
  };

  return NextResponse.json(body);
}
