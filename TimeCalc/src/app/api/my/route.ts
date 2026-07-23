// マイページの初期データ取得API（GET）
// 旧 my/page.tsx（Server Component）が行っていたデータ取得・集計をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { resolveFeatures } from "@/lib/auth/features";
import { calcDaily, summarize } from "@/lib/attendance/calculator";
import {
  deriveDailyFromEvents,
  fixedBreakMinutesOf,
  outingsFromEvents,
  outingIntervalsFromEvents,
  totalOutingMinutes,
  type ClockEventType,
} from "@/lib/attendance/clock";
import { getAllWorkRules, workRulesFor } from "@/lib/settings";
import {
  currentPeriod,
  datesInRange,
  formatPeriodRange,
  minutesToHHMM,
  periodRange,
  timeToMinutes,
  todayString,
} from "@/lib/utils/time";
import type { MyDailyRow } from "@/app/(app)/my/my-attendance-table";
import type { MyRequestRow } from "@/app/(app)/my/my-requests";
import type { MyPageResponse } from "@/app/(app)/my/types";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;
  const viewer = auth.user;

  const url = new URL(request.url);
  const monthParam = url.searchParams.get("month");

  const [me, allRules] = await Promise.all([
    prisma.user.findUnique({ where: { id: viewer.id }, include: { department: true } }),
    getAllWorkRules(),
  ]);
  if (!me) return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 404 });
  const features = resolveFeatures(me.featureOverrides);
  const rules = workRulesFor(allRules, me.department?.companyId);

  const month = /^\d{4}-\d{2}$/.test(monthParam ?? "") ? monthParam! : currentPeriod(rules.closingDay);
  const period = periodRange(month, rules.closingDay);
  const today = todayString();
  const visibleEnd = period.end < today ? period.end : today;

  const [records, events, requests] = await Promise.all([
    prisma.attendance.findMany({
      where: { userId: viewer.id, date: { gte: period.start, lte: period.end } },
      orderBy: { date: "asc" },
    }),
    prisma.clockEvent.findMany({
      where: { userId: viewer.id, date: { gte: period.start, lte: period.end } },
      orderBy: { timestamp: "asc" },
    }),
    prisma.correctionRequest.findMany({
      where: { userId: viewer.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const recordByDate = new Map(records.map((r) => [r.date, r]));
  const eventsByDate = new Map<string, { type: ClockEventType; time: string }[]>();
  for (const e of events) {
    const list = eventsByDate.get(e.date) ?? [];
    list.push({ type: e.type as ClockEventType, time: e.time });
    eventsByDate.set(e.date, list);
  }
  const pendingDates = new Set(requests.filter((r) => r.status === "PENDING").map((r) => r.date));

  const rows: MyDailyRow[] = [];
  const calcResults = [];
  let openCount = 0;

  for (const date of datesInRange(period.start, visibleEnd)) {
    const [y, m, d] = date.split("-").map(Number);
    const weekday = new Date(y, m - 1, d).getDay();
    const record = recordByDate.get(date);
    const calc = record
      ? calcDaily(
          { date, clockIn: record.clockIn, clockOut: record.clockOut, breakMinutes: record.breakMinutes },
          rules,
        )
      : null;
    if (calc) calcResults.push(calc);
    const ok = calc && !calc.error;

    const derived = record ? null : deriveDailyFromEvents(eventsByDate.get(date) ?? []);
    const isOpen = !record && derived?.status === "open" && date < today;
    if (isOpen) openCount++;

    const openIn = derived?.status === "open" ? derived.clockInSoFar : null;

    // 外出・戻りは「確定記録（Attendance）」と「打刻の生ログ（ClockEvent）」の2系統ある。
    // 本人修正・CSV取込（source !== "CLOCK"）で確定済みの日は、その確定値のみを表示する
    // （ClockEventの生ログを混ぜると、外出時間欄がbreakMinutesと食い違って見えるため）。
    // レコードが未確定の日（打刻のみ・退勤前など）はClockEventベースで表示する。
    let outingStartLabel: string;
    let outingEndLabel: string;
    if (record && record.source !== "CLOCK") {
      outingStartLabel = record.outingStart ?? "-";
      outingEndLabel = record.outingEnd ?? "-";
    } else {
      const outing = outingsFromEvents(eventsByDate.get(date) ?? []);
      outingStartLabel =
        outing.count > 0
          ? outing.count > 1
            ? `${outing.firstStart}(${outing.count}回)`
            : outing.firstStart!
          : "-";
      outingEndLabel = outing.count > 0 ? outing.lastEnd! : "-";
    }
    const earlyOvertimeMinutes = ok && calc.earlyPremiumApplies ? calc.earlyMinutes : 0;
    const overtimeMinutes = ok ? calc.overtimeMinutes : 0;
    // 「実外出」欄は実際に外出した時間をそのまま見せる。実測値は打刻ログ・
    // 本人修正フォームの入力値から直接求める（breakMinutesからの逆算はしない）。
    // 「控除外出」欄は休憩時間帯との重複を除いた、勤務時間の計算に使う分
    // （= record.breakMinutes から固定休憩を引いた残り）を見せる。
    // CSV取込は休憩・外出の実測値がそのままbreakMinutesのため、両欄とも同じ値になる
    let actualOutingMinutes = 0;
    let deductibleOutingMinutes = 0;
    if (record) {
      if (record.source === "CSV") {
        actualOutingMinutes = record.breakMinutes;
        deductibleOutingMinutes = record.breakMinutes;
      } else {
        deductibleOutingMinutes = Math.max(0, record.breakMinutes - fixedBreakMinutesOf(rules));
        if (record.source === "CLOCK") {
          actualOutingMinutes = totalOutingMinutes(
            outingIntervalsFromEvents(eventsByDate.get(date) ?? []),
          );
        } else if (record.outingStart && record.outingEnd) {
          const start = timeToMinutes(record.outingStart) ?? 0;
          const end = timeToMinutes(record.outingEnd) ?? 0;
          actualOutingMinutes = Math.max(0, end - start);
        }
      }
    }

    rows.push({
      date,
      dayLabel: `${m}/${d}(${WEEKDAYS[weekday]})`,
      isWeekend: weekday === 0 || weekday === 6,
      hasRecord: !!record,
      clockIn: record?.clockIn ?? openIn ?? "09:00",
      clockOut: record?.clockOut ?? "18:00",
      breakMinutes: record?.breakMinutes ?? 60,
      outingStart: record?.outingStart ?? "",
      outingEnd: record?.outingEnd ?? "",
      clockInLabel: record?.clockIn ?? openIn ?? "-",
      clockOutLabel: record?.clockOut ?? "-",
      roundedClockInLabel: ok ? calc.roundedClockIn : "-",
      roundedClockOutLabel: ok ? calc.roundedClockOut : "-",
      outingStartLabel,
      outingEndLabel,
      actualOutingLabel: record ? minutesToHHMM(actualOutingMinutes) : "-",
      deductibleOutingLabel: record ? minutesToHHMM(deductibleOutingMinutes) : "-",
      workLabel: ok
        ? minutesToHHMM(calc.normalMinutes + (calc.earlyPremiumApplies ? 0 : calc.earlyMinutes))
        : "-",
      earlyOvertimeMinutes,
      earlyOvertimeLabel: ok ? minutesToHHMM(earlyOvertimeMinutes) : "-",
      overtimeMinutes,
      overtimeLabel: ok ? minutesToHHMM(overtimeMinutes) : "-",
      lateMinutes: ok ? calc.lateMinutes : 0,
      earlyLeaveMinutes: ok ? calc.earlyLeaveMinutes : 0,
      lateReason: record?.lateReason ?? null,
      earlyLeaveReason: record?.earlyLeaveReason ?? null,
      isOpen,
      isToday: date === today,
      hasPendingRequest: pendingDates.has(date),
      error: calc?.error ?? null,
    });
  }
  rows.reverse();

  const summary = summarize(calcResults);
  const [year, monthNum] = month.split("-").map(Number);

  const requestRows: MyRequestRow[] = requests.map((r) => ({
    id: r.id,
    date: r.date,
    clockIn: r.clockIn,
    clockOut: r.clockOut,
    breakMinutes: r.breakMinutes,
    reason: r.reason,
    status: r.status,
    reviewNote: r.reviewNote,
  }));

  const body: MyPageResponse = {
    me: { name: me.name, departmentName: me.department?.name ?? null },
    month,
    year,
    monthNum,
    periodRangeLabel: formatPeriodRange(period),
    openCount,
    showMonthlySummary: features.showMonthlySummary,
    selfEditMode: features.selfEdit,
    summary,
    rows,
    requests: requestRows,
  };

  return NextResponse.json(body);
}
