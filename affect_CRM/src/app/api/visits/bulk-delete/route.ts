import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { recalcCustomerStats } from "@/lib/customer-stats";
import type { VisitBulkDeleteResponse } from "@/app/(app)/visits/types";

/** 一度に消せる上限。一覧 1 ページ分（30 件）で足りるが、余裕を持たせておく */
const MAX_IDS = 100;

/**
 * 来店記録の一括削除（管理者のみ）
 *
 * 一覧でチェックを付けた分をまとめて消す。ルールは単体削除（[id]/route.ts の DELETE）と同じ:
 *   - 購入記録が紐づく来店は消さない（売上だけが宙に浮くため）。消せなかった件数を返す
 *   - この来店から作られた会話メモも一緒に消す
 *   - 影響した顧客の来店回数・最終来店日を数え直す
 *   - 監査ログは 1 件ずつ残す（個人情報は入れない）
 */
export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "data.delete");
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? Array.from(new Set(body.ids.filter((v): v is string => typeof v === "string" && v !== "")))
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "削除する来店記録を選んでください" }, { status: 400 });
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json(
      { error: `一度に削除できるのは ${MAX_IDS} 件までです` },
      { status: 400 },
    );
  }

  const visits = await prisma.visit.findMany({
    where: { id: { in: ids } },
    select: { id: true, customerId: true, _count: { select: { purchases: true } } },
  });

  const deletable = visits.filter((v) => v._count.purchases === 0);
  const deleteIds = deletable.map((v) => v.id);
  const skipped = visits.length - deletable.length;

  if (deleteIds.length > 0) {
    await prisma.$transaction([
      prisma.customerNote.deleteMany({ where: { visitId: { in: deleteIds } } }),
      prisma.visit.deleteMany({ where: { id: { in: deleteIds } } }),
      prisma.auditLog.createMany({
        data: deleteIds.map((id) => ({
          staffId: auth.user.id,
          action: "visit.delete",
          targetType: "Visit",
          targetId: id,
        })),
      }),
    ]);

    const customerIds = new Set(
      deletable.map((v) => v.customerId).filter((v): v is string => Boolean(v)),
    );
    for (const customerId of customerIds) {
      await recalcCustomerStats(customerId);
    }
  }

  const res: VisitBulkDeleteResponse = { deleted: deleteIds.length, skipped };
  return NextResponse.json(res);
}
