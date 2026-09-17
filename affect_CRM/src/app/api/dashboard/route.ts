import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import {
  formatJstLong,
  formatJstShort,
  formatJstTime,
  jstDayRange,
  jstMonthRange,
  toJst,
} from "@/lib/utils/time";
import { guestLabel } from "@/lib/display";
import { channelLabel } from "@/lib/visit-channel";
import { ACTIVE_RESERVATION_STATUSES } from "@/lib/constants";
import type { DashboardDailyPoint, DashboardResponse } from "@/app/(app)/types";

/** 指定した JST の年月（month は 0 始まり）の日数 */
function daysInJstMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** 指定した JST の年月日（month は 0 始まり）の曜日（0=日 〜 6=土） */
function jstWeekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month, day)).getUTCDay();
}

/**
 * 来店レコードを JST の日にちごとに件数集計する。
 * maxDay を指定すると、当月の「今日まで」のように途中までしか集計しない。
 */
function aggregateDailyVisits(
  rows: { visitedAt: Date }[],
  year: number,
  month: number,
  maxDay: number,
): DashboardDailyPoint[] {
  const counts = new Array(maxDay + 1).fill(0);
  for (const row of rows) {
    const jst = toJst(row.visitedAt);
    if (jst.getUTCFullYear() !== year || jst.getUTCMonth() !== month) continue;
    const day = jst.getUTCDate();
    if (day >= 1 && day <= maxDay) counts[day] += 1;
  }
  const points: DashboardDailyPoint[] = [];
  for (let day = 1; day <= maxDay; day++) {
    points.push({
      day,
      weekday: jstWeekday(year, month, day),
      count: counts[day],
    });
  }
  return points;
}

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const now = new Date();
  const today = jstDayRange(now);
  const month = jstMonthRange(now);
  // 今月の初日の 1ms 前 = 前月末日なので、そこから前月の範囲が求まる
  const prevMonth = jstMonthRange(new Date(month.start.getTime() - 1));

  // クエリの本数を増やさない。
  // 「今日／今月」「来店数／購入数」は同じ月の来店から出せるので、1 回の取得にまとめて
  // JS 側で数える（3 列だけなので件数が増えても転送は軽い）。
  const [
    monthVisitRows,
    prevMonthVisitRows,
    monthNewCustomers,
    monthSalesAgg,
    monthSchoolAttendees,
    todayReservationRows,
    todayFollowUpRows,
    recentVisitRows,
    recentPurchaseRows,
    masterOptions,
  ] = await Promise.all([
    prisma.visit.findMany({
      where: { visitedAt: { gte: month.start, lt: month.end } },
      select: { visitedAt: true, customerId: true, purchased: true },
    }),
    prisma.visit.findMany({
      where: { visitedAt: { gte: prevMonth.start, lt: prevMonth.end } },
      select: { visitedAt: true },
    }),
    prisma.customer.count({
      where: { createdAt: { gte: month.start, lt: month.end }, deletedAt: null },
    }),
    prisma.purchase.aggregate({
      where: { purchasedAt: { gte: month.start, lt: month.end } },
      _sum: { totalAmount: true },
      _count: true,
    }),
    prisma.schoolAttendance.count({
      where: { attendedAt: { gte: month.start, lt: month.end } },
    }),
    prisma.reservation.findMany({
      where: {
        status: { in: ACTIVE_RESERVATION_STATUSES },
        session: { date: { gte: today.start, lt: today.end } },
      },
      include: {
        session: { include: { course: true, staff: true } },
        customer: { select: { name: true } },
      },
      orderBy: { session: { startTime: "asc" } },
      take: 10,
    }),
    prisma.followUp.findMany({
      where: { status: { in: ["PENDING", "IN_PROGRESS"] }, dueDate: { lt: today.end } },
      include: { customer: { select: { id: true, name: true } } },
      orderBy: { dueDate: "asc" },
      take: 8,
    }),
    prisma.visit.findMany({
      orderBy: { visitedAt: "desc" },
      take: 6,
      include: {
        customer: { select: { id: true, name: true, visitCount: true } },
        guests: { select: { ageGroup: true, gender: true } },
      },
    }),
    prisma.purchase.findMany({
      orderBy: { purchasedAt: "desc" },
      take: 5,
      include: {
        customer: { select: { id: true, name: true, visitCount: true } },
        items: { select: { productName: true, size: true } },
      },
    }),
    prisma.masterOption.findMany({
      where: { type: { in: ["VISIT_PURPOSE", "VISIT_CHANNEL"] } },
      select: { type: true, code: true, label: true },
    }),
  ]);

  const labelOf = (type: string, code: string | null) =>
    code ? (masterOptions.find((m) => m.type === type && m.code === code)?.label ?? code) : null;

  const monthSales = monthSalesAgg._sum.totalAmount ?? 0;
  const purchaseCount = monthSalesAgg._count;

  const monthVisits = monthVisitRows.length;
  const monthPurchasedVisits = monthVisitRows.filter((v) => v.purchased).length;
  const todayRows = monthVisitRows.filter(
    (v) => v.visitedAt >= today.start && v.visitedAt < today.end,
  );
  const todayVisits = todayRows.length;
  const todayNamedVisits = todayRows.filter((v) => v.customerId).length;

  const curJst = toJst(month.start);
  const curYear = curJst.getUTCFullYear();
  const curMonthIndex = curJst.getUTCMonth();
  const prevJst = toJst(prevMonth.start);
  const prevYear = prevJst.getUTCFullYear();
  const prevMonthIndex = prevJst.getUTCMonth();
  const todayDay = toJst(now).getUTCDate();
  const currentMonthTotalDays = daysInJstMonth(curYear, curMonthIndex);

  const visitTrend: DashboardResponse["visitTrend"] = {
    currentMonthNumber: curMonthIndex + 1,
    previousMonthNumber: prevMonthIndex + 1,
    currentMonthTotalDays,
    todayDay,
    currentWeekdays: Array.from({ length: currentMonthTotalDays }, (_, i) =>
      jstWeekday(curYear, curMonthIndex, i + 1),
    ),
    current: aggregateDailyVisits(monthVisitRows, curYear, curMonthIndex, todayDay),
    previous: aggregateDailyVisits(
      prevMonthVisitRows,
      prevYear,
      prevMonthIndex,
      daysInJstMonth(prevYear, prevMonthIndex),
    ),
  };

  const body: DashboardResponse = {
    date: formatJstLong(now),
    visitTrend,
    stats: {
      todayVisits,
      todayNamedVisits,
      todayAnonymousVisits: todayVisits - todayNamedVisits,
      todayReservations: todayReservationRows.length,
      todaySchoolReservations: todayReservationRows.length,
      monthVisits,
      monthNewCustomers,
      monthPurchasedVisits,
      monthUnpurchasedVisits: monthVisits - monthPurchasedVisits,
      monthPurchaseRate: monthVisits === 0 ? 0 : Math.round((monthPurchasedVisits / monthVisits) * 100),
      monthSales,
      monthAverageSpend: purchaseCount === 0 ? 0 : Math.round(monthSales / purchaseCount),
      monthSchoolAttendees,
    },
    todayReservations: todayReservationRows.map((r) => ({
      id: r.id,
      startTime: r.session.startTime,
      courseName: r.session.course.name,
      customerName: r.customer.name,
      headcount: r.headcount,
      staffName: r.session.staff?.name ?? null,
      status: r.status,
      source: r.source,
    })),
    todayFollowUps: todayFollowUpRows.map((f) => ({
      id: f.id,
      customerId: f.customer.id,
      customerName: f.customer.name,
      content: f.content,
      memo: f.memo,
      overdue: f.dueDate < today.start,
    })),
    recentVisits: recentVisitRows.map((v) => ({
      id: v.id,
      date: formatJstShort(v.visitedAt),
      time: formatJstTime(v.visitedAt),
      displayName: v.customer?.name ?? guestLabel(v),
      customerId: v.customerId,
      visitCount: v.customer?.visitCount ?? null,
      purposeLabel: labelOf("VISIT_PURPOSE", v.purposeCode),
      channelLabel: channelLabel(v.channelCode, (c) => labelOf("VISIT_CHANNEL", c)),
      purchased: v.purchased,
    })),
    recentPurchases: recentPurchaseRows.map((p) => ({
      id: p.id,
      date: formatJstShort(p.purchasedAt),
      customerId: p.customer.id,
      customerName: p.customer.name,
      visitCount: p.customer.visitCount,
      items: p.items
        .map((i) => (i.size ? `${i.productName}／${i.size}` : i.productName))
        .join(" ／ "),
      totalAmount: p.totalAmount,
    })),
  };

  return NextResponse.json(body);
}
