// 取込履歴の削除API（DELETE）
// 旧 import/actions.ts の deleteImportHistoryAction をそのまま移植
// これは履歴の記録を消すだけで、その取込で登録された勤怠データ自体は削除されない

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import type { DeleteHistoryState } from "@/app/(app)/import/types";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiPermission(request, "importCsv");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  try {
    await prisma.importHistory.delete({ where: { id } });
  } catch (e) {
    console.error("取込履歴削除エラー:", e);
    return NextResponse.json<DeleteHistoryState>({ error: "履歴の削除に失敗しました" });
  }

  return NextResponse.json<DeleteHistoryState>({ error: null });
}
