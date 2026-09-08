import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { trimOrNull } from "@/lib/normalize";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireApiPermission(request, "master.edit");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const form = await request.formData();
  const data: Record<string, unknown> = {};

  if (form.has("name")) {
    const name = String(form.get("name") ?? "").trim();
    if (!name) return NextResponse.json({ error: "タグ名を入力してください" }, { status: 400 });
    const dup = await prisma.tag.findFirst({ where: { name, NOT: { id } }, select: { id: true } });
    if (dup) return NextResponse.json({ error: "同じ名前のタグがすでにあります" }, { status: 400 });
    data.name = name;
  }
  if (form.has("color")) data.color = trimOrNull(form.get("color"));
  if (form.has("isActive")) data.isActive = form.get("isActive") === "1";
  if (form.has("sortOrder")) data.sortOrder = Number(form.get("sortOrder")) || 0;

  await prisma.tag.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

/**
 * タグは削除ではなく無効化する（顧客に付いているタグの表示が消えないように）。
 * 誰にも付いていないタグだけ、実際に削除できる。
 */
export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await requireApiPermission(request, "master.edit");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const used = await prisma.customerTag.count({ where: { tagId: id } });
  if (used > 0) {
    await prisma.tag.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ ok: true, deactivated: true, used });
  }

  await prisma.tag.delete({ where: { id } });
  return NextResponse.json({ ok: true, deactivated: false });
}
