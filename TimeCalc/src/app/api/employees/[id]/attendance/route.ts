// 勤怠の追加・更新API（POST、同一社員・同一日付は上書き）
// 旧 employees/[id]/actions.ts の saveAttendanceAction をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeDate, nowTimeString, timeToMinutes, todayString } from "@/lib/utils/time";
import type { AttendanceEditState } from "@/app/(app)/employees/[id]/types";
import { attendanceSnapshot, checkEditable } from "./_shared";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: userId } = await params;
  const check = await checkEditable(request, userId);
  if (!check.ok) {
    if ("response" in check) return check.response;
    return NextResponse.json<AttendanceEditState>({ error: check.error, success: false });
  }

  const formData = await request.formData();
  const rawDate = String(formData.get("date") ?? "");
  const clockIn = String(formData.get("clockIn") ?? "").trim();
  const clockOutRaw = String(formData.get("clockOut") ?? "").trim();
  const breakMinutes = Number(formData.get("breakMinutes") ?? 0);
  const note = String(formData.get("note") ?? "").trim() || null;

  const date = normalizeDate(rawDate);
  if (!date) return NextResponse.json<AttendanceEditState>({ error: "日付の形式が不正です", success: false });
  const inMinutes = timeToMinutes(clockIn);
  if (inMinutes === null) {
    return NextResponse.json<AttendanceEditState>({
      error: "出勤時刻は HH:mm 形式で入力してください",
      success: false,
    });
  }
  // 退勤はまだ確定していない日（退勤前に出勤のみ修正したい等）を考慮し、未入力を許容する
  const clockOut = clockOutRaw || null;
  const outMinutes = timeToMinutes(clockOut);
  if (clockOut !== null && outMinutes === null) {
    return NextResponse.json<AttendanceEditState>({
      error: "退勤時刻は HH:mm 形式で入力してください",
      success: false,
    });
  }
  if (date === todayString()) {
    const nowMinutes = timeToMinutes(nowTimeString())!;
    if (inMinutes > nowMinutes || (outMinutes !== null && outMinutes > nowMinutes)) {
      return NextResponse.json<AttendanceEditState>({
        error: "本日のまだ来ていない時刻は指定できません",
        success: false,
      });
    }
  }
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 480) {
    return NextResponse.json<AttendanceEditState>({
      error: "休憩時間は0〜480分で入力してください",
      success: false,
    });
  }

  try {
    const before = await prisma.attendance.findUnique({ where: { userId_date: { userId, date } } });
    await prisma.$transaction([
      prisma.attendance.upsert({
        where: { userId_date: { userId, date } },
        update: { clockIn, clockOut, breakMinutes, note },
        create: { userId, date, clockIn, clockOut, breakMinutes, note },
      }),
      prisma.attendanceLog.create({
        data: {
          userId,
          date,
          actorId: check.viewerId,
          action: "EDIT",
          before: before ? attendanceSnapshot(before) : null,
          after: attendanceSnapshot({ clockIn, clockOut, breakMinutes }),
          note,
        },
      }),
    ]);
  } catch (e) {
    console.error("勤怠保存エラー:", e);
    return NextResponse.json<AttendanceEditState>({ error: "勤怠の保存に失敗しました", success: false });
  }

  return NextResponse.json<AttendanceEditState>({ error: null, success: true });
}
