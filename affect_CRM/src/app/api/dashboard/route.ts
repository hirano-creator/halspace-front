import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { formatJstLong, formatJstTime, jstDayRange, jstMonthRange } from "@/lib/utils/time";
import { guestLabel } from "@/lib/display";
import { ACTIVE_RESERVATION_STATUSES } from "@/lib/constants";
import type { DashboardResponse } from "@/app/(app)/types";

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const now = new Date();
  const today = jstDayRange(now);
  const month = jstMonthRange(now);

  // D1 はクエリを 1 本ずつ処理するため、Promise.all で並べてもクエリ数だけ時間がかかる。
  // 「今日／今月」「来店数／購入数」は同じ月の来店から出せるので、1 回の取得にまとめて
  // JS 側で数える（3 列だけなので件数が増えても転送は軽い）。
  const [
    monthVisitRows,
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
        customer: { select: { id: true, name: true } },
        guests: { select: { ageGroup: true, gender: true } },
      },
    }),
    prisma.purchase.findMany({
      orderBy: { purchasedAt: "desc" },
      take: 5,
      include: {
        customer: { select: { id: true, name: true } },
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

  const body: DashboardResponse = {
    date: formatJstLong(now),
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
      time: formatJstTime(v.visitedAt),
      displayName: v.customer?.name ?? guestLabel(v),
      customerId: v.customerId,
      purposeLabel: labelOf("VISIT_PURPOSE", v.purposeCode),
      channelLabel: labelOf("VISIT_CHANNEL", v.channelCode),
      purchased: v.purchased,
    })),
    recentPurchases: recentPurchaseRows.map((p) => ({
      id: p.id,
      customerId: p.customer.id,
      customerName: p.customer.name,
      items: p.items
        .map((i) => (i.size ? `${i.productName}／${i.size}` : i.productName))
        .join(" ／ "),
      totalAmount: p.totalAmount,
    })),
  };

  return NextResponse.json(body);
}
