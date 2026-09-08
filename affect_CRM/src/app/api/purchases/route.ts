import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { recalcCustomerStats } from "@/lib/customer-stats";
import { trimOrNull } from "@/lib/normalize";
import { parseJstDateTime } from "@/lib/utils/time";

interface ItemInput {
  productName: string;
  categoryId: string | null;
  unitPrice: number;
  quantity: number;
  size: string | null;
  subtotal: number;
}

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const customerId = trimOrNull(form.get("customerId"));
  if (!customerId) {
    return NextResponse.json({ error: "顧客を選んでください" }, { status: 400 });
  }

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true },
  });
  if (!customer) {
    return NextResponse.json({ error: "顧客が見つかりません" }, { status: 400 });
  }

  const purchasedAtRaw = trimOrNull(form.get("purchasedAt"));
  const purchasedAt = purchasedAtRaw ? parseJstDateTime(purchasedAtRaw) : new Date();
  if (!purchasedAt) {
    return NextResponse.json({ error: "購入日は「2026-08-31」の形式で入力してください" }, { status: 400 });
  }

  // 明細は productName[] / unitPrice[] ... の並び順で対応させる
  const names = form.getAll("productName").map(String);
  const categoryIds = form.getAll("categoryId").map(String);
  const prices = form.getAll("unitPrice").map(String);
  const quantities = form.getAll("quantity").map(String);
  const sizes = form.getAll("size").map(String);

  const items: ItemInput[] = [];
  for (let i = 0; i < names.length; i++) {
    const productName = names[i]?.trim();
    if (!productName) continue;

    const unitPrice = Number(prices[i] ?? "0");
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return NextResponse.json({ error: `${productName} の金額を数字で入力してください` }, { status: 400 });
    }
    const quantity = Number(quantities[i] ?? "1");
    if (!Number.isInteger(quantity) || quantity < 1) {
      return NextResponse.json({ error: `${productName} の数量を 1 以上で入力してください` }, { status: 400 });
    }

    items.push({
      productName,
      categoryId: categoryIds[i]?.trim() || null,
      unitPrice: Math.round(unitPrice),
      quantity,
      size: sizes[i]?.trim() || null,
      subtotal: Math.round(unitPrice) * quantity,
    });
  }

  if (items.length === 0) {
    return NextResponse.json({ error: "購入した商品を 1 つ以上入力してください" }, { status: 400 });
  }

  const totalAmount = items.reduce((sum, i) => sum + i.subtotal, 0);

  const purchase = await prisma.purchase.create({
    data: {
      customerId,
      visitId: trimOrNull(form.get("visitId")),
      purchasedAt,
      totalAmount,
      staffId: auth.user.id,
      note: trimOrNull(form.get("note")),
      items: { create: items },
    },
    select: { id: true },
  });

  await recalcCustomerStats(customerId);

  return NextResponse.json({ purchase });
}
