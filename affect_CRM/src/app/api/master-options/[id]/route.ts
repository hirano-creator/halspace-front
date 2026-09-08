import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 表示名（label）と並び順・有効無効だけを変更できる。
 * code は分析の集計キーなので変更させない（変えると過去データの集計が壊れる）。
 */
export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireApiPermission(request, "master.edit");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const form = await request.formData();
  const data: Record<string, unknown> = {};

  if (form.has("label")) {
    const label = String(form.get("label") ?? "").trim();
    if (!label) return NextResponse.json({ error: "表示名を入力してください" }, { status: 400 });
    data.label = label;
  }
  if (form.has("isActive")) data.isActive = form.get("isActive") === "1";
  if (form.has("sortOrder")) data.sortOrder = Number(form.get("sortOrder")) || 0;

  await prisma.masterOption.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

/** 削除はしない。過去データの集計を壊さないため無効化に倒す */
export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await requireApiPermission(request, "master.edit");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  await prisma.masterOption.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true, deactivated: true });
}
