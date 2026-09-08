import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { countSeatsBySession } from "@/lib/reservation";
import { formatJstDate, parseJstDateTime } from "@/lib/utils/time";
import type { CalendarResponse } from "@/app/(app)/schools/types";

/**
 * 期間内の開催枠と予約をまとめて返す。
 * from / to は JST の日付（"2026-09-01"）。to はその日を含む。
 */
export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const fromRaw = url.searchParams.get("from") ?? formatJstDate(new Date());
  const toRaw = url.searchParams.get("to") ?? fromRaw;

  const from = parseJstDateTime(fromRaw);
  const to = parseJstDateTime(toRaw);
  if (!from || !to) {
    return NextResponse.json({ error: "日付の指定が正しくありません" }, { status: 400 });
  }
  // to の当日を含めるため翌日 0:00 を上限にする
  const toEnd = new Date(to.getTime() + 24 * 60 * 60 * 1000);

  const [sessions, courses, staffs] = await Promise.all([
    prisma.schoolSession.findMany({
      where: { date: { gte: from, lt: toEnd } },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      include: {
        course: { select: { id: true, name: true } },
        staff: { select: { id: true, name: true } },
        reservations: {
          orderBy: { createdAt: "asc" },
          include: { customer: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.schoolCourse.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, durationMinutes: true, capacity: true },
    }),
    prisma.staff.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const seatMap = await countSeatsBySession(sessions.map((s) => s.id));

  const body: CalendarResponse = {
    from: fromRaw,
    to: toRaw,
    sessions: sessions.map((s) => {
      const reserved = seatMap.get(s.id) ?? 0;
      return {
        id: s.id,
        date: formatJstDate(s.date),
        startTime: s.startTime,
        endTime: s.endTime,
        courseId: s.course.id,
        courseName: s.course.name,
        capacity: s.capacity,
        reserved,
        remaining: Math.max(0, s.capacity - reserved),
        staffId: s.staff?.id ?? null,
        staffName: s.staff?.name ?? null,
        status: s.status,
        isPublished: s.isPublished,
        note: s.note,
        reservations: s.reservations.map((r) => ({
          id: r.id,
          customerId: r.customer.id,
          customerName: r.customer.name,
          headcount: r.headcount,
          status: r.status,
          source: r.source,
          note: r.note,
        })),
      };
    }),
    courses,
    staffs,
  };

  return NextResponse.json(body);
}
