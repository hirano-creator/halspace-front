// 会社（グループ会社）の追加API（POST）
// 旧 settings/actions.ts の addCompanyAction をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import type { SettingsFormState } from "@/app/(app)/settings/types";

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "manageSettings");
  if (!auth.ok) return auth.response;

  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return NextResponse.json<SettingsFormState>({ error: "会社名を入力してください", success: false });

  const dup = await prisma.company.findUnique({ where: { name } });
  if (dup) {
    return NextResponse.json<SettingsFormState>({ error: "同じ名前の会社が既に存在します", success: false });
  }

  await prisma.company.create({ data: { name } });
  return NextResponse.json<SettingsFormState>({ error: null, success: true });
}
