// 顧客の集計キャッシュの再計算
//
// visitCount / purchaseTotal などは顧客一覧の検索・並べ替えのための補助であり、
// 正はあくまで履歴テーブル。来店・購入・スクール参加を登録／更新／削除したら
// 同じ処理の中でこれを呼んで作り直す。

import { prisma } from "@/lib/db";

export async function recalcCustomerStats(customerId: string): Promise<void> {
  const [visitAgg, firstVisit, lastVisit, purchaseAgg, lastPurchase, schoolCount] =
    await Promise.all([
      prisma.visit.count({ where: { customerId } }),
      prisma.visit.findFirst({
        where: { customerId },
        orderBy: { visitedAt: "asc" },
        select: { visitedAt: true },
      }),
      prisma.visit.findFirst({
        where: { customerId },
        orderBy: { visitedAt: "desc" },
        select: { visitedAt: true },
      }),
      prisma.purchase.aggregate({
        where: { customerId },
        _sum: { totalAmount: true },
        _count: true,
      }),
      prisma.purchase.findFirst({
        where: { customerId },
        orderBy: { purchasedAt: "desc" },
        select: { purchasedAt: true },
      }),
      prisma.schoolAttendance.count({ where: { customerId } }),
    ]);

  await prisma.customer.update({
    where: { id: customerId },
    data: {
      visitCount: visitAgg,
      firstVisitAt: firstVisit?.visitedAt ?? null,
      lastVisitAt: lastVisit?.visitedAt ?? null,
      purchaseTotal: purchaseAgg._sum.totalAmount ?? 0,
      purchaseCount: purchaseAgg._count,
      lastPurchaseAt: lastPurchase?.purchasedAt ?? null,
      schoolCount,
    },
  });
}
