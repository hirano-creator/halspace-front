// 勤怠一覧（社員検索・部署検索・月検索 → 社員別月次集計）

import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guard";
import { can } from "@/lib/auth/roles";
import { getMonthlySummaries } from "@/lib/attendance/service";
import { formatYen } from "@/lib/attendance/calculator";
import { getWorkRules } from "@/lib/settings";
import {
  currentPeriod,
  formatMinutes,
  formatPeriodRange,
  periodRange,
} from "@/lib/utils/time";
import {
  Card,
  PageHeader,
  buttonSecondaryClass,
  inputClass,
  tdClass,
  thClass,
} from "@/components/ui";
import { MonthPicker } from "@/components/month-picker";

export const dynamic = "force-dynamic";

interface SearchParams {
  month?: string;
  q?: string;
  department?: string;
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const rules = await getWorkRules();
  const month = /^\d{4}-\d{2}$/.test(params.month ?? "")
    ? params.month!
    : currentPeriod(rules.closingDay);
  const period = periodRange(month, rules.closingDay);
  const query = params.q?.trim() || undefined;
  const departmentId = params.department || undefined;

  const [summaries, departments] = await Promise.all([
    getMonthlySummaries(user, month, { departmentId, query }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
  ]);
  const [year, monthNum] = month.split("-").map(Number);

  const canExport = can(user.role, "exportCsv");
  const showDepartmentFilter = can(user.role, "viewAllEmployees");

  const exportUrl = `/api/export?month=${month}${departmentId ? `&department=${departmentId}` : ""}${query ? `&q=${encodeURIComponent(query)}` : ""}`;

  return (
    <>
      <PageHeader
        title="勤怠一覧"
        description={`${year}年${monthNum}月度（${formatPeriodRange(period)}・締め${rules.closingDay}日）の社員別集計`}
        action={
          canExport ? (
            <div className="flex gap-2">
              <a href={exportUrl} className={buttonSecondaryClass}>
                集計CSV出力
              </a>
              <a href={`${exportUrl}&type=daily`} className={buttonSecondaryClass}>
                明細CSV出力
              </a>
            </div>
          ) : undefined
        }
      />

      <Card className="mb-6">
        <form method="get" className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="month" className="mb-1 block text-xs font-medium text-muted">
              対象月度（選ぶと自動で切り替え）
            </label>
            <MonthPicker defaultValue={month} />
          </div>
          <div>
            <label htmlFor="q" className="mb-1 block text-xs font-medium text-muted">
              社員検索
            </label>
            <input
              id="q"
              type="text"
              name="q"
              defaultValue={query ?? ""}
              placeholder="氏名・社員番号"
              className={inputClass}
            />
          </div>
          {showDepartmentFilter && (
            <div>
              <label htmlFor="department" className="mb-1 block text-xs font-medium text-muted">
                部署
              </label>
              <select
                id="department"
                name="department"
                defaultValue={departmentId ?? ""}
                className={inputClass}
              >
                <option value="">すべての部署</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button type="submit" className={buttonSecondaryClass}>
            検索
          </button>
        </form>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[860px]">
          <thead className="border-b border-border bg-gray-50/50">
            <tr>
              <th className={thClass}>社員番号</th>
              <th className={thClass}>氏名</th>
              <th className={thClass}>部署</th>
              <th className={`${thClass} text-right`}>勤務日数</th>
              <th className={`${thClass} text-right`}>勤務時間</th>
              <th className={`${thClass} text-right`}>早出残業</th>
              <th className={`${thClass} text-right`}>残業時間</th>
              <th className={`${thClass} text-right`}>支給額（概算）</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {summaries.length === 0 ? (
              <tr>
                <td colSpan={8} className={`${tdClass} py-10 text-center text-muted`}>
                  該当する勤怠データがありません
                </td>
              </tr>
            ) : (
              summaries.map((s) => (
                <tr key={s.userId} className="transition hover:bg-gray-50/60">
                  <td className={tdClass}>{s.employeeCode}</td>
                  <td className={tdClass}>
                    <Link
                      href={`/employees/${s.userId}?month=${month}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {s.userName}
                    </Link>
                  </td>
                  <td className={`${tdClass} text-muted`}>{s.departmentName ?? "-"}</td>
                  <td className={`${tdClass} whitespace-nowrap text-right`}>
                    {s.summary.workDays}日
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-right`}>
                    {formatMinutes(
                      s.summary.normalMinutes +
                        (s.summary.earlyMinutes - s.summary.earlyOvertimeMinutes),
                    )}
                  </td>
                  <td
                    className={`${tdClass} whitespace-nowrap text-right ${
                      s.summary.earlyOvertimeMinutes > 0
                        ? "font-medium text-amber-600"
                        : "text-muted"
                    }`}
                  >
                    {formatMinutes(s.summary.earlyOvertimeMinutes)}
                  </td>
                  <td
                    className={`${tdClass} whitespace-nowrap text-right ${
                      s.summary.overtimeMinutes > 0 ? "font-medium text-amber-600" : "text-muted"
                    }`}
                  >
                    {formatMinutes(s.summary.overtimeMinutes)}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-right font-semibold`}>
                    {s.hourlyWage > 0 ? (
                      formatYen(s.pay.totalPay)
                    ) : (
                      <span className="text-xs font-normal text-amber-600">時給未設定</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
