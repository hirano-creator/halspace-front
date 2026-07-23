// キオスク表示URLの発行・無効化API（POST=発行/再発行, DELETE=無効化）
// 旧 settings/qr/actions.ts の issueKioskKeyAction / revokeKioskKeyAction をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { generateKioskKey } from "@/lib/qr";
import type { QrKeyActionState } from "@/app/(app)/settings/qr/types";

/** キオスクURLを発行する（発行済みの場合は再発行になり、旧URLは自動的に無効化される） */
export async function POST(request: Request, { params }: { params: Promise<{ departmentId: string }> }) {
  const auth = await requireApiPermission(request, "manageSettings");
  if (!auth.ok) return auth.response;

  const { departmentId } = await params;
  try {
    await prisma.department.update({ where: { id: departmentId }, data: { kioskKey: generateKioskKey() } });
  } catch (e) {
    console.error("キオスクURL発行エラー:", e);
    return NextResponse.json<QrKeyActionState>({ error: "キオスクURLの発行に失敗しました", success: false });
  }

  return NextResponse.json<QrKeyActionState>({ error: null, success: true });
}

/** キオスクURLを無効化する（既存のURLは以後アクセスできなくなる） */
export async function DELETE(request: Request, { params }: { params: Promise<{ departmentId: string }> }) {
  const auth = await requireApiPermission(request, "manageSettings");
  if (!auth.ok) return auth.response;

  const { departmentId } = await params;
  try {
    await prisma.department.update({ where: { id: departmentId }, data: { kioskKey: null } });
  } catch (e) {
    console.error("キオスクURL無効化エラー:", e);
    return NextResponse.json<QrKeyActionState>({
      error: "キオスクURLの無効化に失敗しました",
      success: false,
    });
  }

  return NextResponse.json<QrKeyActionState>({ error: null, success: true });
}
