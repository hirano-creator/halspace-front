// 勤怠の削除API（DELETE、日付単位）
// Attendance（確定記録）と ClockEvent（打刻ログ）の両方を消す。
// Attendance だけ消すと、打刻ログ由来の「実出勤・実退勤」が画面に残り続け、
// レコードが無いので削除ボタンも出ない（＝二度と消せない）状態になるため。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeDate } from "@/lib/utils/time";
import type { AttendanceEditState } from "@/app/(app)/employees/[id]/types";
import { attendanceSnapshot, checkEditable } from "../_shared";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; date: string }> },
) {
  const { id: userId, date: rawDate } = await params;

  const date = normalizeDate(decodeURIComponent(rawDate));
  if (!date) {
    return NextResponse.json<AttendanceEditState>({ error: "日付の形式が不正です", success: false });
  }

  const check = await checkEditable(request, userId);
  if (!check.ok) {
    if ("response" in check) return check.response;
    return NextResponse.json<AttendanceEditState>({ error: check.error, success: false });
  }

  const [record, eventCount] = await Promise.all([
    prisma.attendance.findUnique({ where: { userId_date: { userId, date } } }),
    prisma.clockEvent.count({ where: { userId, date } }),
  ]);
  if (!record && eventCount === 0) {
    return NextResponse.json<AttendanceEditState>({ error: "対象の勤怠が見つかりません", success: false });
  }

  try {
    await prisma.$transaction([
      prisma.attendance.deleteMany({ where: { userId, date } }),
      prisma.clockEvent.deleteMany({ where: { userId, date } }),
      prisma.attendanceLog.create({
        data: {
          userId,
          date,
          actorId: check.viewerId,
          action: "DELETE",
          before: record ? attendanceSnapshot(record) : null,
          after: null,
          note: eventCount > 0 ? `打刻ログ${eventCount}件も削除` : null,
        },
      }),
    ]);
  } catch (e) {
    console.error("勤怠削除エラー:", e);
    return NextResponse.json<AttendanceEditState>({ error: "勤怠の削除に失敗しました", success: false });
  }

  return NextResponse.json<AttendanceEditState>({ error: null, success: true });
}
