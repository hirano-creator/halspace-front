// マイページの初期データ取得API（GET）
// 旧 my/page.tsx（Server Component）が行っていたデータ取得・集計をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { resolveFeatures } from "@/lib/auth/features";
import {
  calcDaily,
  calcDeductionMinutes,
  calcLegalOvertime,
  calcWeekly,
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
import { getAllWorkRules, workRulesFor } from "@/lib/settings";
import {
  currentPeriod,
  datesInRange,
  formatPeriodRange,
  minutesToHHMM,
  periodRange,
  signedMinutesToHHMM,
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
  // 週別集計用（日付つきで持つ）。週単位管理でない会社では使わない
  const dailyCalcs: { date: string; calc: DailyCalcResult }[] = [];
  // 月度合計（社員詳細画面と同じく日別の合計を積み上げる）
  const monthTotal = { workMinutes: 0, earlyOvertimeMinutes: 0, overtimeMinutes: 0 };
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
    if (calc) {
      calcResults.push(calc);
      dailyCalcs.push({ date, calc });
    }
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
    if (calc && ok) {
      monthTotal.earlyOvertimeMinutes += earlyOvertimeMinutes;
      monthTotal.overtimeMinutes += overtimeMinutes;
      monthTotal.workMinutes += calc.normalMinutes + (calc.earlyMinutes - earlyOvertimeMinutes);
    }
    // 「実外出」欄は実際に外出した時間をそのまま見せる（丸めない）。実測値は打刻ログ・
    // 本人修正フォームの入力値から直接求める（breakMinutesからの逆算はしない）。
    // 「控除時間」欄は実外出・遅刻・早退それぞれ休憩時間帯との重複を除いて丸め単位で
    // 切り上げたものの合計（calcDeductionMinutes）。CSV取込は外出区間の時刻が不明なため
    // 休憩重複は判定できず、breakMinutesをそのまま実外出として扱う。
    let actualOutingMinutes = 0;
    let outingIntervals: { start: string; end: string }[] = [];
    if (record) {
      if (record.source === "CSV") {
        actualOutingMinutes = record.breakMinutes;
      } else if (record.source === "CLOCK") {
        outingIntervals = outingIntervalsFromEvents(eventsByDate.get(date) ?? []);
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

    rows.push({
      date,
      dayLabel: `${m}/${d}(${WEEKDAYS[weekday]})`,
      isWeekend: weekday === 0 || weekday === 6,
      hasRecord: !!record,
      // 出退勤が未確定（record側がnull）の日は、編集フォームに架空の時刻を埋めず
      // 空欄のままにする（記録が全く無い日のみ典型的な始業・終業時刻を仮置きする）
      clockIn: record ? (record.clockIn ?? "") : (openIn ?? "09:00"),
      clockOut: record ? (record.clockOut ?? "") : "18:00",
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
      deductionLabel: record ? minutesToHHMM(deductionMinutes) : "-",
      workLabel: ok
        ? minutesToHHMM(calc.normalMinutes + (calc.earlyPremiumApplies ? 0 : calc.earlyMinutes))
        : "-",
      // 法定勤務時間（既定8時間）を超えた分。不足の日は0、出勤のない日・エラーの日は対象外
      legalOvertimeMinutes: ok ? calcLegalOvertime(calc, rules) : 0,
      legalOvertimeLabel: ok ? signedMinutesToHHMM(calcLegalOvertime(calc, rules)) : "-",
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

  const summary = summarize(calcResults, rules);
  const [year, monthNum] = month.split("-").map(Number);

  // 週単位管理の会社のみ週別集計を返す。
  // 表示は今日までなので週の区切りも visibleEnd までとし、
  // rows が新しい順（reverse 済み）なので週も同じ並びに揃える。
  const weeks = rules.weekly.enabled
    ? calcWeekly(dailyCalcs, { start: period.start, end: visibleEnd }, rules).reverse()
    : [];
  const weeklyTotals = weeks.length > 0 ? summarizeWeeks(weeks) : null;

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
    monthTotal,
    rows,
    weeks,
    weeklyTotals,
    requests: requestRows,
  };

  return NextResponse.json(body);
}
