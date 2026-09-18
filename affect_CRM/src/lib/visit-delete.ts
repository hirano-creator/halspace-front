// 来店記録の削除（単体削除・一括削除で共通）
//
// 来店に紐づく購入記録（明細ごと）・フォロー予定・会話メモも一緒に消す。
// 来店を消したのに購入だけ残ると売上が宙に浮き、予定やメモだけ残ると重複して見えるため。
// 消したあと、影響した顧客の来店回数・累計購入額を数え直すところまで行う。

import { prisma } from "@/lib/db";
import { recalcCustomerStats } from "@/lib/customer-stats";

export interface VisitDeleteResult {
  /** 消した来店の数（存在しない ID は数えない） */
  visits: number;
  /** 一緒に消した購入記録の数 */
  purchases: number;
  /** 一緒に消したフォロー予定の数 */
  followUps: number;
}

export async function deleteVisits(ids: string[], staffId: string): Promise<VisitDeleteResult> {
  const empty: VisitDeleteResult = { visits: 0, purchases: 0, followUps: 0 };
  if (ids.length === 0) return empty;

  const visits = await prisma.visit.findMany({
    where: { id: { in: ids } },
    select: { id: true, customerId: true },
  });
  const visitIds = visits.map((v) => v.id);
  if (visitIds.length === 0) return empty;

  // 監査ログと顧客集計のために、消す前に購入記録を控えておく
  const purchases = await prisma.purchase.findMany({
    where: { visitId: { in: visitIds } },
    select: { id: true, visitId: true, customerId: true },
  });

  const [, followUpsDeleted] = await prisma.$transaction([
    // 明細（PurchaseItem）は onDelete: Cascade で一緒に消える
    prisma.purchase.deleteMany({ where: { visitId: { in: visitIds } } }),
    prisma.followUp.deleteMany({ where: { visitId: { in: visitIds } } }),
    prisma.customerNote.deleteMany({ where: { visitId: { in: visitIds } } }),
    // 興味商品（VisitInterest）・人数内訳（VisitGuest）は onDelete: Cascade
    prisma.visit.deleteMany({ where: { id: { in: visitIds } } }),
    // 個人情報は記録しない。誰が何を消したかだけ残す
    prisma.auditLog.createMany({
      data: [
        ...visitIds.map((id) => ({
          staffId,
          action: "visit.delete",
          targetType: "Visit",
          targetId: id,
        })),
        ...purchases.map((p) => ({
          staffId,
          action: "purchase.delete",
          targetType: "Purchase",
          targetId: p.id,
          detail: `来店 ${p.visitId} の削除に伴う`,
        })),
      ],
    }),
  ]);

  const customerIds = new Set<string>();
  for (const v of visits) if (v.customerId) customerIds.add(v.customerId);
  for (const p of purchases) if (p.customerId) customerIds.add(p.customerId);
  for (const customerId of customerIds) {
    await recalcCustomerStats(customerId);
  }

  return { visits: visitIds.length, purchases: purchases.length, followUps: followUpsDeleted.count };
}
