// /api/employees/[id]/attendance/* の各Route Handlerが共有するロジック

import type { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { can } from "@/lib/auth/roles";

export type EditableCheck =
  | { ok: true; viewerId: string }
  | { ok: false; response: NextResponse }
  | { ok: false; error: string };

/** 対象社員の勤怠を編集できるか検証する（可なら操作者IDを、不可ならレスポンスかエラー理由を返す） */
export async function checkEditable(request: Request, targetUserId: string): Promise<EditableCheck> {
  const auth = await requireApiPermission(request, "editAttendance");
  if (!auth.ok) return { ok: false, response: auth.response };
  const viewer = auth.user;

  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) return { ok: false, error: "対象の社員が見つかりません" };

  if (!can(viewer.role, "viewAllEmployees")) {
    if (!viewer.departmentId || viewer.departmentId !== target.departmentId) {
      return { ok: false, error: "自部署以外の勤怠は修正できません" };
    }
  }
  return { ok: true, viewerId: viewer.id };
}

/** 修正履歴用に勤怠の主要項目をJSON化する */
export function attendanceSnapshot(a: { clockIn: string; clockOut: string | null; breakMinutes: number }): string {
  return JSON.stringify({ clockIn: a.clockIn, clockOut: a.clockOut, breakMinutes: a.breakMinutes });
}
