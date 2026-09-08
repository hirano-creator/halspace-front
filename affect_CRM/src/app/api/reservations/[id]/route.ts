import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { countSeats } from "@/lib/reservation";
import { recalcCustomerStats } from "@/lib/customer-stats";
import { RESERVATION_STATUSES, toEnum } from "@/lib/constants";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 予約のステータス変更。
 * 「参加済」にしたときは、そのままスクール参加履歴を作る（二重入力を避けるため）。
 */
export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const form = await request.formData();
  const status = toEnum(RESERVATION_STATUSES, form.get("status"));
  if (!status) return NextResponse.json({ error: "ステータスを選んでください" }, { status: 400 });

  const reservation = await prisma.reservation.findUnique({
    where: { id },
    include: { session: { select: { id: true, courseId: true, date: true } }, attendance: true },
  });
  if (!reservation) {
    return NextResponse.json({ error: "予約が見つかりません" }, { status: 404 });
  }

  // 仮予約→確定など、席を消費する向きに変わるときは残席を数え直す
  const wasActive = ["TENTATIVE", "CONFIRMED", "ATTENDED"].includes(reservation.status);
  const willBeActive = ["TENTATIVE", "CONFIRMED", "ATTENDED"].includes(status);
  if (!wasActive && willBeActive) {
    const seats = await countSeats(reservation.sessionId);
    if (seats && reservation.headcount > seats.remaining) {
      return NextResponse.json(
        { error: `残り ${seats.remaining} 名のため戻せません` },
        { status: 409 },
      );
    }
  }

  await prisma.reservation.update({
    where: { id },
    data: {
      status,
      cancelledAt: status === "CANCELLED" || status === "NO_SHOW" ? new Date() : null,
    },
  });

  if (status === "ATTENDED" && !reservation.attendance) {
    await prisma.schoolAttendance.create({
      data: {
        reservationId: reservation.id,
        sessionId: reservation.session.id,
        customerId: reservation.customerId,
        courseId: reservation.session.courseId,
        attendedAt: reservation.session.date,
        staffId: auth.user.id,
      },
    });
    await recalcCustomerStats(reservation.customerId);
  }

  // 参加済を取り消した場合は参加履歴も取り消す
  if (status !== "ATTENDED" && reservation.attendance) {
    await prisma.schoolAttendance.delete({ where: { id: reservation.attendance.id } });
    await recalcCustomerStats(reservation.customerId);
  }

  return NextResponse.json({ ok: true });
}
