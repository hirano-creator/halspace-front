import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { formatJstDate, jstMonthRange } from "@/lib/utils/time";
import type { PurchaseListResponse } from "@/app/(app)/products/types";

/** 購入履歴の一覧（期間で絞り込み、合計も返す） */
export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const scope = new URL(request.url).searchParams.get("scope") ?? "month";
  const month = jstMonthRange(new Date());
  const where = scope === "month" ? { purchasedAt: { gte: month.start, lt: month.end } } : {};

  const [rows, agg] = await Promise.all([
    prisma.purchase.findMany({
      where,
      orderBy: { purchasedAt: "desc" },
      take: 100,
      include: {
        customer: { select: { id: true, name: true } },
        staff: { select: { name: true } },
        items: { select: { productName: true, size: true, quantity: true, subtotal: true } },
      },
    }),
    prisma.purchase.aggregate({ where, _sum: { totalAmount: true }, _count: true }),
  ]);

  const body: PurchaseListResponse = {
    purchases: rows.map((p) => ({
      id: p.id,
      purchasedAt: formatJstDate(p.purchasedAt),
      customerId: p.customer.id,
      customerName: p.customer.name,
      totalAmount: p.totalAmount,
      staffName: p.staff?.name ?? null,
      items: p.items.map((i) => ({
        productName: i.productName,
        size: i.size,
        quantity: i.quantity,
        subtotal: i.subtotal,
      })),
    })),
    total: agg._sum.totalAmount ?? 0,
    count: agg._count,
  };

  return NextResponse.json(body);
}
