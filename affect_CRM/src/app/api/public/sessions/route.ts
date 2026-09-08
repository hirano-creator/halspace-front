import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { countSeatsBySession } from "@/lib/reservation";
import { formatJstDate, startOfJstDay } from "@/lib/utils/time";
import type { PublicSession } from "@/app/(public)/reserve/types";

/**
 * ホームページの予約ページに出す枠の一覧（認証不要）。
 *
 * CRM を予約のマスターとし、公開ページは同じ SchoolSession / Reservation を参照する。
 * 別 DB や同期処理は作らない（同期ズレを構造的に発生させないため）。
 */
export async function GET() {
  const today = startOfJstDay(new Date());
  const until = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 日先まで

  const sessions = await prisma.schoolSession.findMany({
    where: {
      date: { gte: today, lt: until },
      status: "OPEN",
      isPublished: true,
      course: { isPublished: true, isActive: true },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    include: {
      course: { select: { id: true, name: true, description: true, price: true, durationMinutes: true } },
    },
  });

  const seatMap = await countSeatsBySession(sessions.map((s) => s.id));

  // 個人情報は一切返さない（予約者名などは公開ページに出さない）
  const body: PublicSession[] = sessions.map((s) => {
    const reserved = seatMap.get(s.id) ?? 0;
    return {
      id: s.id,
      date: formatJstDate(s.date),
      startTime: s.startTime,
      endTime: s.endTime,
      courseName: s.course.name,
      courseDescription: s.course.description,
      price: s.course.price,
      durationMinutes: s.course.durationMinutes,
      capacity: s.capacity,
      reserved,
      remaining: Math.max(0, s.capacity - reserved),
    };
  });

  return NextResponse.json({ sessions: body });
}
