// 社員詳細（締め期間の日別勤務・残業・金額の一覧と月度合計）

import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser, canViewEmployee } from "@/lib/auth/guard";
import { can, toRole } from "@/lib/auth/roles";
import { calcDaily, calcDailyPay, formatYen, summarize } from "@/lib/attendance/calculator";
import { getRoleLabels, getWorkRules } from "@/lib/settings";
import {
  currentPeriod,
  datesInRange,
  formatMinutes,
  formatPeriodRange,
  minutesToHHMM,
  periodRange,
} from "@/lib/utils/time";
import { Badge, Card, PageHeader, StatCard } from "@/components/ui";
import { MonthPicker } from "@/components/month-picker";
import { AttendanceEditor, type DailyRow } from "./attendance-editor";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const viewer = await requireUser();
  const { id } = await params;
  const sp = await searchParams;

  // DB往復を減らすため、互いに依存しない取得は並列で行う
  const [employee, rules, roleLabels] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      include: { department: true },
    }),
    getWorkRules(),
    getRoleLabels(),
  ]);
  if (!employee) notFound();
  if (!canViewEmployee(viewer, employee)) redirect("/attendance");

  // 編集可否: 権限 + （店長は自部署のみ）
  const editable =
    can(viewer.role, "editAttendance") &&
    (can(viewer.role, "viewAllEmployees") ||
      (viewer.departmentId !== null && viewer.departmentId === employee.departmentId));
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "")
    ? sp.month!
    : currentPeriod(rules.closingDay);
  const period = periodRange(month, rules.closingDay);

  const records = await prisma.attendance.findMany({
    where: { userId: id, date: { gte: period.start, lte: period.end } },
    orderBy: { date: "asc" },
  });

  const recordByDate = new Map(records.map((r) => [r.date, r]));

  // 締め期間の全日についてカレンダー行を作る（打刻がない日は空行）
  const rows: DailyRow[] = [];
  const calcResults = [];
  const payTotal = { basePay: 0, premiumPay: 0, totalPay: 0 };
  // カード集計用: 勤務時間は早出残業・残業を含まない（＝通常勤務＋割増なしの早出）
  const monthTotal = { workMinutes: 0, earlyOvertimeMinutes: 0, overtimeMinutes: 0 };

  for (const date of datesInRange(period.start, period.end)) {
    const [y, m, d] = date.split("-").map(Number);
    const weekday = new Date(y, m - 1, d).getDay();
    const record = recordByDate.get(date);
    const calc = record
      ? calcDaily(
          {
            date,
            clockIn: record.clockIn,
            clockOut: record.clockOut,
            breakMinutes: record.breakMinutes,
          },
          rules,
        )
      : null;
    const pay = calc ? calcDailyPay(calc, employee.hourlyWage, rules) : null;
    const ok = calc && !calc.error;
    if (calc) calcResults.push(calc);
    if (pay && ok) {
      payTotal.basePay += pay.basePay;
      payTotal.premiumPay += pay.premiumPay;
      payTotal.totalPay += pay.totalPay;
    }
    if (calc && ok) {
      const earlyOvertime = calc.earlyPremiumApplies ? calc.earlyMinutes : 0;
      monthTotal.earlyOvertimeMinutes += earlyOvertime;
      monthTotal.overtimeMinutes += calc.overtimeMinutes;
      // 勤務時間 = 通常勤務 ＋ 割増対象外の早出（早出残業・残業は含まない）
      monthTotal.workMinutes += calc.normalMinutes + (calc.earlyMinutes - earlyOvertime);
    }

    rows.push({
      attendanceId: record?.id ?? null,
      date,
      dayLabel: `${m}/${d}(${WEEKDAYS[weekday]})`,
      isWeekend: weekday === 0 || weekday === 6,
      clockIn: record?.clockIn ?? "08:00",
      clockOut: record?.clockOut ?? "17:00",
      breakMinutes: record?.breakMinutes ?? 60,
      note: record?.note ?? null,
      roundedClockInLabel: record ? (ok ? calc.roundedClockIn : "-") : "-",
      roundedClockOutLabel: record ? (ok ? calc.roundedClockOut : "-") : "-",
      workLabel: ok ? minutesToHHMM(calc.totalMinutes) : "-",
      earlyOvertimeLabel: ok
        ? minutesToHHMM(calc.earlyPremiumApplies ? calc.earlyMinutes : 0)
        : "-",
      overtimeLabel: ok ? minutesToHHMM(calc.overtimeMinutes) : "-",
      baseAmountLabel: pay && ok ? formatYen(pay.basePay) : "-",
      premiumAmountLabel: pay && ok ? formatYen(pay.premiumPay) : "-",
      totalPayLabel: pay && ok ? formatYen(pay.totalPay) : "-",
      error: calc?.error ?? null,
    });
  }

  const summary = summarize(calcResults);
  const [year, monthNum] = month.split("-").map(Number);

  return (
    <>
      <PageHeader
        title={employee.name}
        description={`社員番号 ${employee.employeeCode} ・ ${employee.department?.name ?? "部署未設定"} ・ 時給 ${formatYen(employee.hourlyWage)}`}
        action={
          <form method="get">
            <MonthPicker defaultValue={month} />
          </form>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={employee.isActive ? "green" : "red"}>
          {employee.isActive ? "在籍中" : "退職済"}
        </Badge>
        <Badge tone="purple">{roleLabels[toRole(employee.role)]}</Badge>
        <Badge tone="gray">
          {year}年{monthNum}月度（{formatPeriodRange(period)}・締め{rules.closingDay}日）
        </Badge>
        {employee.hourlyWage === 0 && (
          <Badge tone="amber">時給未設定（金額は¥0になります）</Badge>
        )}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="勤務日数" value={`${summary.workDays}日`} />
        <StatCard label="勤務時間" value={formatMinutes(monthTotal.workMinutes)} />
        <StatCard
          label="早出残業"
          value={formatMinutes(monthTotal.earlyOvertimeMinutes)}
          tone="amber"
        />
        <StatCard
          label="残業時間"
          value={formatMinutes(monthTotal.overtimeMinutes)}
          tone="amber"
        />
        <StatCard
          label="支給額（概算）"
          value={formatYen(payTotal.totalPay)}
          sub={`金額 ${formatYen(payTotal.basePay)} ＋ 残業代 ${formatYen(payTotal.premiumPay)}`}
          tone="primary"
        />
      </div>

      <Card className="overflow-x-auto p-0">
        <AttendanceEditor userId={employee.id} rows={rows} editable={editable} />
      </Card>
    </>
  );
}
