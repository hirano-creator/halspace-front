// 勤怠の削除API（DELETE）
// 旧 employees/[id]/actions.ts の deleteAttendanceAction をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { AttendanceEditState } from "@/app/(app)/employees/[id]/types";
import { attendanceSnapshot, checkEditable } from "../_shared";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; attendanceId: string }> },
) {
  const { id: userId, attendanceId } = await params;

  const record = await prisma.attendance.findUnique({ where: { id: attendanceId } });
  if (!record || record.userId !== userId) {
    return NextResponse.json<AttendanceEditState>({ error: "対象の勤怠が見つかりません", success: false });
  }

  const check = await checkEditable(request, record.userId);
  if (!check.ok) {
    if ("response" in check) return check.response;
    return NextResponse.json<AttendanceEditState>({ error: check.error, success: false });
  }

  try {
    await prisma.$transaction([
      prisma.attendance.delete({ where: { id: attendanceId } }),
      prisma.attendanceLog.create({
        data: {
          userId: record.userId,
          date: record.date,
          actorId: check.viewerId,
          action: "DELETE",
          before: attendanceSnapshot(record),
          after: null,
        },
      }),
    ]);
  } catch (e) {
    console.error("勤怠削除エラー:", e);
    return NextResponse.json<AttendanceEditState>({ error: "勤怠の削除に失敗しました", success: false });
  }

  return NextResponse.json<AttendanceEditState>({ error: null, success: true });
}
