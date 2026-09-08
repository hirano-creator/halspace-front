import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { recalcCustomerStats } from "@/lib/customer-stats";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 購入記録の削除は管理者のみ。
 * 売上・客単価・顧客の累計購入金額が変わるため、スタッフには開放しない。
 */
export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await requireApiPermission(request, "data.delete");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const purchase = await prisma.purchase.findUnique({
    where: { id },
    select: { id: true, customerId: true, visitId: true },
  });
  if (!purchase) {
    return NextResponse.json({ error: "購入記録が見つかりません" }, { status: 404 });
  }

  // 明細は onDelete: Cascade で一緒に消える
  await prisma.purchase.delete({ where: { id } });

  // この来店の購入がすべて無くなったら、来店側も「未購入」に戻す
  // （購入したことになっているのに購入記録が無い、という状態を作らない）
  if (purchase.visitId) {
    const remaining = await prisma.purchase.count({ where: { visitId: purchase.visitId } });
    if (remaining === 0) {
      await prisma.visit.update({
        where: { id: purchase.visitId },
        data: { purchased: false },
      });
    }
  }

  await recalcCustomerStats(purchase.customerId);

  await prisma.auditLog.create({
    data: { staffId: auth.user.id, action: "purchase.delete", targetType: "Purchase", targetId: id },
  });

  return NextResponse.json({ ok: true });
}
