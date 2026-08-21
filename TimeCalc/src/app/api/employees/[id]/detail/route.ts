// 社員詳細画面のデータ取得API（GET、締め期間の日別勤務・残業・金額の一覧と月度合計）
// 旧 employees/[id]/page.tsx（Server Component）をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { canEditOthersAttendance, canViewEmployee } from "@/lib/auth/guard";
import { toRole } from "@/lib/auth/roles";
import {
  calcDaily,
  calcDailyPay,
  calcDeductionMinutes,
  calcLegalOvertime,
  calcWeekly,
  calcWeeklyPay,
  formatYen,
  summarize,
  summarizeWeeks,
} from "@/lib/attendance/calculator";
import type { DailyCalcResult } from "@/lib/attendance/types";
import {
  deriveDailyFromEvents,
  outingsFromEvents,
  outingIntervalsFromEvents,
  totalOutingMinutes,
  type ClockEventType,
} from "@/lib/attendance/clock";
import {
  getAllWorkRules,
  getCompanyIdForDepartment,
  getDisplaySettings,
  getRoleLabels,
  workRulesFor,
} from "@/lib/settings";
import {
  currentPeriod,
  datesInRange,
  formatPeriodRange,
  minutesToHHMM,
  periodRange,
  signedMinutesToHHMM,
  toJst,
  todayString,
} from "@/lib/utils/time";
import type { DailyRow } from "@/app/(app)/employees/[id]/attendance-editor";
import type { AttendanceLogRow, EmployeeDetailResponse } from "@/app/(app)/employees/[id]/types";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;
  const viewer = auth.user;

  const { id } = await params;
  const url = new URL(request.url);
  const monthParam = url.searchParams.get("month");

  const viewerCompanyId = await getCompanyIdForDepartment(viewer.departmentId);
  const [employee, allRules, roleLabels, display] = await Promise.all([
    prisma.user.findUnique({ where: { id }, include: { department: true } }),
    getAllWorkRules(),
    getRoleLabels(viewerCompanyId),
    getDisplaySettings(viewerCompanyId),
  ]);
  if (!employee) return NextResponse.json({ error: "対象の社員が見つかりません" }, { status: 404 });

  const employeeCompanyId = employee.department?.companyId ?? null;
  const targetScope = {
    id: employee.id,
    departmentId: employee.departmentId,
    companyId: employeeCompanyId,
  };
  if (!canViewEmployee(viewer, targetScope)) {
    return NextResponse.json({ error: "この社員の勤怠を閲覧する権限がありません" }, { status: 403 });
  }

  const rules = workRulesFor(allRules, employee.department?.companyId);
  const showMoney = display.showMoney;

  const editable = canEditOthersAttendance(viewer) && canViewEmployee(viewer, targetScope);
  const month = /^\d{4}-\d{2}$/.test(monthParam ?? "") ? monthParam! : currentPeriod(rules.closingDay);
  const period = periodRange(month, rules.closingDay);

  const [records, events, requests, logs] = await Promise.all([
    prisma.attendance.findMany({
      where: { userId: id, date: { gte: period.start, lte: period.end } },
      orderBy: { date: "asc" },
    }),
    prisma.clockEvent.findMany({
      where: { userId: id, date: { gte: period.start, lte: period.end } },
      orderBy: { timestamp: "asc" },
    }),
    prisma.correctionRequest.findMany({
      where: { userId: id, date: { gte: period.start, lte: period.end } },
    }),
    prisma.attendanceLog.findMany({
      where: { userId: id, date: { gte: period.start, lte: period.end } },
      include: { actor: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  const recordByDate = new Map(records.map((r) => [r.date, r]));
  const eventsByDate = new Map<string, { type: ClockEventType; time: string }[]>();
  for (const e of events) {
    const list = eventsByDate.get(e.date) ?? [];
    list.push({ type: e.type as ClockEventType, time: e.time });
    eventsByDate.set(e.date, list);
  }
  const pendingDates = new Set(
    requests.filter((r) => r.status === "PENDING").map((r) => r.date),
  );
  const today = todayString();

  const rows: DailyRow[] = [];
  const calcResults = [];
  // 週別集計用（日付つきで持つ）。週単位管理でない会社では使わない
  const dailyCalcs: { date: string; calc: DailyCalcResult }[] = [];
  const payTotal = { basePay: 0, premiumPay: 0, totalPay: 0 };
  const monthTotal = { workMinutes: 0, earlyOvertimeMinutes: 0, overtimeMinutes: 0, deductionMinutes: 0 };

  for (const date of datesInRange(period.start, period.end)) {
    const [y, m, d] = date.split("-").map(Number);
    const weekday = new Date(y, m - 1, d).getDay();
    const record = recordByDate.get(date);
    const calc = record
      ? calcDaily(
          { date, clockIn: record.clockIn, clockOut: record.clockOut, breakMinutes: record.breakMinutes },
          rules,
        )
      : null;
    const pay = calc ? calcDailyPay(calc, employee.hourlyWage, rules) : null;
    const ok = calc && !calc.error;
    if (calc) {
      calcResults.push(calc);
      dailyCalcs.push({ date, calc });
    }
    if (pay && ok) {
      payTotal.basePay += pay.basePay;
      payTotal.premiumPay += pay.premiumPay;
      payTotal.totalPay += pay.totalPay;
    }
    if (calc && ok) {
      const earlyOvertime = calc.earlyPremiumApplies ? calc.earlyMinutes : 0;
      monthTotal.earlyOvertimeMinutes += earlyOvertime;
      monthTotal.overtimeMinutes += calc.overtimeMinutes;
      monthTotal.workMinutes += calc.normalMinutes + (calc.earlyMinutes - earlyOvertime);
    }

    // 外出・戻り・実外出・控除時間・未退勤の算出はマイページ（/api/my）と同一ロジック。
    // 確定記録（source !== "CLOCK"）はその確定値、打刻のみの日は ClockEvent から求める。
    const dayEvents = eventsByDate.get(date) ?? [];
    const derived = record ? null : deriveDailyFromEvents(dayEvents);
    const isOpen = !record && derived?.status === "open" && date < today;
    // 出勤打刻済みで退勤前（勤務中・外出中）の日
    const isClockedIn = !record && derived?.status === "open";

    // deriveAndSaveAttendance は退勤するまで Attendance を作らないため、
    // record だけを見ていると出勤直後の行が丸ごと空になり、管理者から打刻が見えない。
    // 実出勤・実退勤は Attendance が未確定でも打刻ログ（ClockEvent）から補完する。
    const actualClockInLabel = record
      ? (record.clockIn ?? "-")
      : derived?.status === "open"
        ? derived.clockInSoFar
        : derived?.status === "closed"
          ? derived.clockIn
          : "-";
    const actualClockOutLabel = record
      ? (record.clockOut ?? "-")
      : derived?.status === "closed"
        ? derived.clockOut
        : "-";

    let outingStartLabel: string;
    let outingEndLabel: string;
    if (record && record.source !== "CLOCK") {
      outingStartLabel = record.outingStart ?? "-";
      outingEndLabel = record.outingEnd ?? "-";
    } else {
      const outing = outingsFromEvents(dayEvents);
      outingStartLabel =
        outing.count > 0
          ? outing.count > 1
            ? `${outing.firstStart}(${outing.count}回)`
            : outing.firstStart!
          : "-";
      outingEndLabel = outing.count > 0 ? outing.lastEnd! : "-";
    }

    // 「実外出」＝実際に外出した時間（丸めない）。
    // 「控除時間」＝実外出・遅刻・早退それぞれ休憩時間帯との重複を除いて丸め単位で
    // 切り上げたものの合計（calcDeductionMinutes）。CSV取込は外出区間の時刻が不明なため
    // 休憩重複は判定できず、breakMinutesをそのまま実外出として扱う。
    let actualOutingMinutes = 0;
    let outingIntervals: { start: string; end: string }[] = [];
    if (record) {
      if (record.source === "CSV") {
        actualOutingMinutes = record.breakMinutes;
      } else if (record.source === "CLOCK") {
        outingIntervals = outingIntervalsFromEvents(dayEvents);
        actualOutingMinutes = totalOutingMinutes(outingIntervals);
      } else if (record.outingStart && record.outingEnd) {
        outingIntervals = [{ start: record.outingStart, end: record.outingEnd }];
        actualOutingMinutes = totalOutingMinutes(outingIntervals);
      }
    }
    const deductionMinutes = record
      ? calcDeductionMinutes(
          {
            outingIntervals,
            outingMinutesFallback: record.source === "CSV" ? record.breakMinutes : 0,
            rawClockIn: ok ? record.clockIn : null,
            rawClockOut: ok ? record.clockOut : null,
          },
          rules,
        )
      : 0;
    if (record) monthTotal.deductionMinutes += deductionMinutes;

    rows.push({
      attendanceId: record?.id ?? null,
      hasClockEvents: dayEvents.length > 0,
      date,
      dayLabel: `${m}/${d}(${WEEKDAYS[weekday]})`,
      isWeekend: weekday === 0 || weekday === 6,
      // 出退勤が未確定（record側がnull）の日は編集フォームを空欄のままにする
      clockIn: record ? (record.clockIn ?? "") : "08:00",
      clockOut: record ? (record.clockOut ?? "") : "17:00",
      breakMinutes: record?.breakMinutes ?? 60,
      note: record?.note ?? null,
      actualClockInLabel,
      actualClockOutLabel,
      roundedClockInLabel: record ? (ok ? calc.roundedClockIn : "-") : "-",
      roundedClockOutLabel: record ? (ok ? calc.roundedClockOut : "-") : "-",
      outingStartLabel,
      outingEndLabel,
      actualOutingLabel: record ? minutesToHHMM(actualOutingMinutes) : "-",
      deductionLabel: record ? minutesToHHMM(deductionMinutes) : "-",
      workLabel: ok
        ? minutesToHHMM(calc.normalMinutes + (calc.earlyPremiumApplies ? 0 : calc.earlyMinutes))
        : "-",
      // 法定勤務時間（既定8時間）を超えた分。不足の日は0、出勤のない日・エラーの日は対象外
      legalOvertimeLabel: ok ? signedMinutesToHHMM(calcLegalOvertime(calc, rules)) : "-",
      earlyOvertimeLabel: ok ? minutesToHHMM(calc.earlyPremiumApplies ? calc.earlyMinutes : 0) : "-",
      overtimeLabel: ok ? minutesToHHMM(calc.overtimeMinutes) : "-",
      lateMinutes: ok ? calc.lateMinutes : 0,
      earlyLeaveMinutes: ok ? calc.earlyLeaveMinutes : 0,
      lateReason: record?.lateReason ?? null,
      earlyLeaveReason: record?.earlyLeaveReason ?? null,
      isOpen,
      isClockedIn,
      isToday: date === today,
      hasPendingRequest: pendingDates.has(date),
      baseAmountLabel: pay && ok ? formatYen(pay.basePay) : "-",
      premiumAmountLabel: pay && ok ? formatYen(pay.premiumPay) : "-",
      totalPayLabel: pay && ok ? formatYen(pay.totalPay) : "-",
      error: calc?.error ?? null,
    });
  }

  const summary = summarize(calcResults, rules);
  const [year, monthNum] = month.split("-").map(Number);

  // 週単位管理の会社は、週ごとに「所定内 / 36H超44H以内 / 44H超」を出す。
  // 日次では残業を0にしているため、割増は週合計から計算して支給額に足す。
  const weeks = rules.weekly.enabled ? calcWeekly(dailyCalcs, period, rules) : [];
  const weeklyTotals = weeks.length > 0 ? summarizeWeeks(weeks) : null;
  if (weeklyTotals) {
    const weeklyPay = calcWeeklyPay(weeklyTotals, employee.hourlyWage, rules);
    payTotal.premiumPay += weeklyPay.premiumPay;
    payTotal.totalPay += weeklyPay.premiumPay;
  }

  const logRows: AttendanceLogRow[] = logs.map((log) => ({
    id: log.id,
    date: log.date,
    action: log.action,
    before: log.before,
    after: log.after,
    note: log.note,
    actorName: log.actor?.name ?? null,
    createdAtLabel: (() => { const j = toJst(log.createdAt); return `${j.getUTCFullYear()}/${j.getUTCMonth() + 1}/${j.getUTCDate()}`; })(),
  }));

  const body: EmployeeDetailResponse = {
    employee: {
      id: employee.id,
      name: employee.name,
      employeeCode: employee.employeeCode,
      departmentName: employee.department?.name ?? null,
      hourlyWage: employee.hourlyWage,
      isActive: employee.isActive,
      role: toRole(employee.role),
    },
    roleLabels,
    showMoney,
    editable,
    month,
    year,
    monthNum,
    periodRangeLabel: formatPeriodRange(period),
    closingDay: rules.closingDay,
    rows,
    summary: {
      workDays: summary.workDays,
      legalOvertimeMinutes: summary.legalOvertimeMinutes,
      lateCount: summary.lateCount,
      earlyLeaveCount: summary.earlyLeaveCount,
      lateMinutes: summary.lateMinutes,
      earlyLeaveMinutes: summary.earlyLeaveMinutes,
    },
    monthTotal,
    payTotal,
    weeklyEnabled: rules.weekly.enabled,
    weeks,
    weeklyTotals,
    logs: logRows,
  };

  return NextResponse.json(body);
}
