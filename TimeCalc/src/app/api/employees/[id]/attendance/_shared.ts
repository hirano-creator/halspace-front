// /api/employees/[id]/attendance/* の各Route Handlerが共有するロジック

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { canEditOthersAttendance, canViewEmployee } from "@/lib/auth/guard";

export type EditableCheck =
  | { ok: true; viewerId: string }
  | { ok: false; response: NextResponse }
  | { ok: false; error: string };

/** 対象社員の勤怠を編集できるか検証する（可なら操作者IDを、不可ならレスポンスかエラー理由を返す） */
export async function checkEditable(request: Request, targetUserId: string): Promise<EditableCheck> {
  const auth = await requireApiUser(request);
  if (!auth.ok) return { ok: false, response: auth.response };
  const viewer = auth.user;
  if (!canEditOthersAttendance(viewer)) {
    return { ok: false, response: NextResponse.json({ error: "権限がありません" }, { status: 403 }) };
  }

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    include: { department: true },
  });
  if (!target) return { ok: false, error: "対象の社員が見つかりません" };

  if (
    !canViewEmployee(viewer, {
      id: target.id,
      departmentId: target.departmentId,
      companyId: target.department?.companyId ?? null,
    })
  ) {
    return { ok: false, error: "担当範囲外の勤怠は修正できません" };
  }
  return { ok: true, viewerId: viewer.id };
}

/** 修正履歴用に勤怠の主要項目をJSON化する */
export function attendanceSnapshot(a: { clockIn: string; clockOut: string | null; breakMinutes: number }): string {
  return JSON.stringify({ clockIn: a.clockIn, clockOut: a.clockOut, breakMinutes: a.breakMinutes });
}
