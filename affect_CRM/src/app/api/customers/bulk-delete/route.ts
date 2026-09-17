import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import type { CustomerBulkDeleteResponse } from "@/app/(app)/customers/types";

/** 一度に消せる上限。一覧 1 ページ分で足りるが、余裕を持たせておく */
const MAX_IDS = 100;

/**
 * 顧客の一括削除（論理削除）
 *
 * 一覧でチェックを付けた分をまとめて deletedAt を立てる。単体削除（[id]/route.ts の DELETE）と
 * 同じく実データは消さず、来店・購入などの履歴もそのまま残す。
 * 監査ログは 1 件ずつ残す（個人情報は入れない）。
 */
export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "customer.delete");
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? Array.from(new Set(body.ids.filter((v): v is string => typeof v === "string" && v !== "")))
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "削除する顧客を選んでください" }, { status: 400 });
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json(
      { error: `一度に削除できるのは ${MAX_IDS} 名までです` },
      { status: 400 },
    );
  }

  // 既に削除済みのものは数えない
  const targets = await prisma.customer.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true },
  });
  const targetIds = targets.map((c) => c.id);

  if (targetIds.length > 0) {
    await prisma.$transaction([
      prisma.customer.updateMany({
        where: { id: { in: targetIds } },
        data: { deletedAt: new Date() },
      }),
      prisma.auditLog.createMany({
        data: targetIds.map((id) => ({
          staffId: auth.user.id,
          action: "customer.delete",
          targetType: "Customer",
          targetId: id,
        })),
      }),
    ]);
  }

  const res: CustomerBulkDeleteResponse = { deleted: targetIds.length };
  return NextResponse.json(res);
}
