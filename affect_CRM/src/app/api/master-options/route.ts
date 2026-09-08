import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission, requireApiUser } from "@/lib/auth/api-guard";
import { MASTER_TYPES, toEnum } from "@/lib/constants";

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const options = await prisma.masterOption.findMany({
    orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
    select: { id: true, type: true, code: true, label: true, sortOrder: true, isActive: true },
  });

  return NextResponse.json({ options });
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "master.edit");
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const type = toEnum(MASTER_TYPES, form.get("type"));
  if (!type) return NextResponse.json({ error: "種別が正しくありません" }, { status: 400 });

  const label = String(form.get("label") ?? "").trim();
  if (!label) return NextResponse.json({ error: "表示名を入力してください" }, { status: 400 });

  // code は分析の集計キー。日本語の表示名からは作れないので、
  // 指定がなければ CUSTOM1, CUSTOM2… の連番にする（後から見て分かる形にするため）。
  const explicit = String(form.get("code") ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "");

  let code = explicit;
  if (!code) {
    const count = await prisma.masterOption.count({ where: { type } });
    code = `CUSTOM${count + 1}`;
  }

  // 万一ぶつかったら連番を足してずらす
  for (let i = 2; i < 100; i++) {
    const dup = await prisma.masterOption.findUnique({
      where: { type_code: { type, code } },
      select: { id: true },
    });
    if (!dup) break;
    code = `${explicit || "CUSTOM"}${i}`;
  }

  const max = await prisma.masterOption.findFirst({
    where: { type },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const option = await prisma.masterOption.create({
    data: { type, code, label, sortOrder: (max?.sortOrder ?? 0) + 1 },
    select: { id: true, code: true },
  });

  return NextResponse.json({ option });
}
