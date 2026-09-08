import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission, requireApiUser } from "@/lib/auth/api-guard";
import { trimOrNull } from "@/lib/normalize";

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const tags = await prisma.tag.findMany({
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }],
    include: { _count: { select: { customers: true } } },
  });

  return NextResponse.json({
    tags: tags.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      sortOrder: t.sortOrder,
      isActive: t.isActive,
      customerCount: t._count.customers,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "master.edit");
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return NextResponse.json({ error: "タグ名を入力してください" }, { status: 400 });

  const exists = await prisma.tag.findUnique({ where: { name }, select: { id: true } });
  if (exists) {
    return NextResponse.json({ error: "同じ名前のタグがすでにあります" }, { status: 400 });
  }

  const max = await prisma.tag.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });

  const tag = await prisma.tag.create({
    data: {
      name,
      color: trimOrNull(form.get("color")),
      sortOrder: (max?.sortOrder ?? 0) + 1,
    },
    select: { id: true },
  });

  return NextResponse.json({ tag });
}
