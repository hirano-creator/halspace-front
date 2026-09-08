// 予約枠の残席計算
//
// D1 では厳密なロックが取りにくいため、予約を作る直前に必ずここで数え直す。
// それでも同時に最後の 1 枠を取り合う可能性は残るので、Web 予約は「仮予約」で受け、
// 店舗が確定する運用にしている（企画書 4-8）。

import { prisma } from "@/lib/db";
import { ACTIVE_RESERVATION_STATUSES } from "@/lib/constants";

export interface SeatCount {
  capacity: number;
  reserved: number;
  remaining: number;
}

/** 枠 1 件の残席を数える */
export async function countSeats(sessionId: string): Promise<SeatCount | null> {
  const session = await prisma.schoolSession.findUnique({
    where: { id: sessionId },
    select: { capacity: true },
  });
  if (!session) return null;

  const agg = await prisma.reservation.aggregate({
    where: { sessionId, status: { in: ACTIVE_RESERVATION_STATUSES } },
    _sum: { headcount: true },
  });
  const reserved = agg._sum.headcount ?? 0;

  return {
    capacity: session.capacity,
    reserved,
    remaining: Math.max(0, session.capacity - reserved),
  };
}

/** 複数の枠の予約人数をまとめて数える（カレンダー・公開予約ページ用） */
export async function countSeatsBySession(
  sessionIds: string[],
): Promise<Map<string, number>> {
  if (sessionIds.length === 0) return new Map();

  const rows = await prisma.reservation.groupBy({
    by: ["sessionId"],
    where: { sessionId: { in: sessionIds }, status: { in: ACTIVE_RESERVATION_STATUSES } },
    _sum: { headcount: true },
  });

  return new Map(rows.map((r) => [r.sessionId, r._sum.headcount ?? 0]));
}
