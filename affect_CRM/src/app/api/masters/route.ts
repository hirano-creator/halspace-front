import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";

/** 選択肢マスタ・タグ・商品カテゴリをまとめて返す（入力画面が最初に 1 回だけ叩く） */
export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const [options, tags, categories] = await Promise.all([
    prisma.masterOption.findMany({
      where: { isActive: true },
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
      select: { type: true, code: true, label: true },
    }),
    prisma.tag.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, color: true },
    }),
    prisma.productCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // type ごとにまとめて返す（画面側で filter しなくて済むように）
  const grouped: Record<string, { code: string; label: string }[]> = {};
  for (const o of options) {
    (grouped[o.type] ??= []).push({ code: o.code, label: o.label });
  }

  return NextResponse.json({ options: grouped, tags, categories });
}
