import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { recalcCustomerStats } from "@/lib/customer-stats";

type Ctx = { params: Promise<{ id: string }> };

/** スクール参加履歴の削除は管理者のみ（顧客の参加回数が変わるため） */
export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await requireApiPermission(request, "data.delete");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const attendance = await prisma.schoolAttendance.findUnique({
    where: { id },
    select: { id: true, customerId: true, reservationId: true },
  });
  if (!attendance) {
    return NextResponse.json({ error: "参加履歴が見つかりません" }, { status: 404 });
  }

  await prisma.schoolAttendance.delete({ where: { id } });

  // 予約から作られた履歴なら、予約のステータスも「参加済」から戻す
  // （参加済なのに履歴が無い、という食い違いを残さない）
  if (attendance.reservationId) {
    await prisma.reservation.update({
      where: { id: attendance.reservationId },
      data: { status: "CONFIRMED" },
    });
  }

  await recalcCustomerStats(attendance.customerId);

  await prisma.auditLog.create({
    data: {
      staffId: auth.user.id,
      action: "attendance.delete",
      targetType: "SchoolAttendance",
      targetId: id,
    },
  });

  return NextResponse.json({ ok: true });
}
