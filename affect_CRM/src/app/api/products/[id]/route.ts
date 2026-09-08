import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { parseProductForm } from "../route";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireApiPermission(request, "master.edit");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const form = await request.formData();
  const parsed = parseProductForm(form);
  if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });

  await prisma.product.update({ where: { id }, data: parsed });
  return NextResponse.json({ ok: true });
}

/** 商品は削除せず無効化する（購入明細は商品名のスナップショットを持つので表示は壊れない） */
export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await requireApiPermission(request, "master.edit");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  await prisma.product.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
