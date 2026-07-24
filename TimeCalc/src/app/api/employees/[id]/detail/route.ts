// 社員詳細画面のデータ取得API（GET、締め期間の日別勤務・残業・金額の一覧と月度合計）
// 旧 employees/[id]/page.tsx（Server Component）をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { canViewEmployee } from "@/lib/auth/guard";
import { can, toRole } from "@/lib/auth/roles";
import { calcDaily, calcDailyPay, formatYen, summarize } from "@/lib/attendance/calculator";
import {
  deriveDailyFromEvents,
  fixedBreakMinutesOf,
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
  timeToMinutes,
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

  if (!canViewEmployee(viewer, employee)) {
    return NextResponse.json({ error: "この社員の勤怠を閲覧する権限がありません" }, { status: 403 });
  }

  const rules = workRulesFor(allRules, employee.department?.companyId);
  const showMoney = display.showMoney;

  const editable =
    can(viewer.role, "editAttendance") &&
    (can(viewer.role, "viewAllEmployees") ||
      (viewer.departmentId !== null && viewer.departmentId === employee.departmentId));
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
  const fixedBreak = fixedBreakMinutesOf(rules);

  const rows: DailyRow[] = [];
  const calcResults = [];
  const payTotal = { basePay: 0, premiumPay: 0, totalPay: 0 };
  const monthTotal = { workMinutes: 0, earlyOvertimeMinutes: 0, overtimeMinutes: 0 };

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
      monthTotal.workMinutes += calc.normalMinutes + (calc.earlyMinutes - earlyOvertime);
    }

    // 外出・戻り・実外出・控除外出・未退勤の算出はマイページ（/api/my）と同一ロジック。
    // 確定記録（source !== "CLOCK"）はその確定値、打刻のみの日は ClockEvent から求める。
    const dayEvents = eventsByDate.get(date) ?? [];
    const derived = record ? null : deriveDailyFromEvents(dayEvents);
    const isOpen = !record && derived?.status === "open" && date < today;

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

    // 「実外出」＝実際に外出した時間、「控除外出」＝勤務時間から差し引く分（固定休憩を除いた残り）。
    let actualOutingMinutes = 0;
    let deductibleOutingMinutes = 0;
    if (record) {
      if (record.source === "CSV") {
        actualOutingMinutes = record.breakMinutes;
        deductibleOutingMinutes = record.breakMinutes;
      } else {
        deductibleOutingMinutes = Math.max(0, record.breakMinutes - fixedBreak);
        if (record.source === "CLOCK") {
          actualOutingMinutes = totalOutingMinutes(outingIntervalsFromEvents(dayEvents));
        } else if (record.outingStart && record.outingEnd) {
          const start = timeToMinutes(record.outingStart) ?? 0;
          const end = timeToMinutes(record.outingEnd) ?? 0;
          actualOutingMinutes = Math.max(0, end - start);
        }
      }
    }

    rows.push({
      attendanceId: record?.id ?? null,
      date,
      dayLabel: `${m}/${d}(${WEEKDAYS[weekday]})`,
      isWeekend: weekday === 0 || weekday === 6,
      clockIn: record?.clockIn ?? "08:00",
      // 退勤が未確定（record.clockOutがnull）の日は編集フォームを空欄のままにする
      clockOut: record ? (record.clockOut ?? "") : "17:00",
      breakMinutes: record?.breakMinutes ?? 60,
      note: record?.note ?? null,
      roundedClockInLabel: record ? (ok ? calc.roundedClockIn : "-") : "-",
      roundedClockOutLabel: record ? (ok ? calc.roundedClockOut : "-") : "-",
      outingStartLabel,
      outingEndLabel,
      actualOutingLabel: record ? minutesToHHMM(actualOutingMinutes) : "-",
      deductibleOutingLabel: record ? minutesToHHMM(deductibleOutingMinutes) : "-",
      workLabel: ok
        ? minutesToHHMM(calc.normalMinutes + (calc.earlyPremiumApplies ? 0 : calc.earlyMinutes))
        : "-",
      earlyOvertimeLabel: ok ? minutesToHHMM(calc.earlyPremiumApplies ? calc.earlyMinutes : 0) : "-",
      overtimeLabel: ok ? minutesToHHMM(calc.overtimeMinutes) : "-",
      lateMinutes: ok ? calc.lateMinutes : 0,
      earlyLeaveMinutes: ok ? calc.earlyLeaveMinutes : 0,
      lateReason: record?.lateReason ?? null,
      earlyLeaveReason: record?.earlyLeaveReason ?? null,
      isOpen,
      isToday: date === today,
      hasPendingRequest: pendingDates.has(date),
      baseAmountLabel: pay && ok ? formatYen(pay.basePay) : "-",
      premiumAmountLabel: pay && ok ? formatYen(pay.premiumPay) : "-",
      totalPayLabel: pay && ok ? formatYen(pay.totalPay) : "-",
      error: calc?.error ?? null,
    });
  }

  const summary = summarize(calcResults);
  const [year, monthNum] = month.split("-").map(Number);

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
      lateCount: summary.lateCount,
      earlyLeaveCount: summary.earlyLeaveCount,
      lateMinutes: summary.lateMinutes,
      earlyLeaveMinutes: summary.earlyLeaveMinutes,
    },
    monthTotal,
    payTotal,
    logs: logRows,
  };

  return NextResponse.json(body);
}
