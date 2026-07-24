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
  const clockInRaw = String(formData.get("clockIn") ?? "").trim();
  const clockOutRaw = String(formData.get("clockOut") ?? "").trim();
  const breakMinutes = Number(formData.get("breakMinutes") ?? 0);
  const note = String(formData.get("note") ?? "").trim() || null;

  const date = normalizeDate(rawDate);
  if (!date) return NextResponse.json<AttendanceEditState>({ error: "日付の形式が不正です", success: false });
  // まだ確定していない日（退勤前に出勤のみ修正したい、誤打刻を取り消したい等）を考慮し、
  // 出勤・退勤とも未入力を許容する。ただし両方空では記録として意味がないため拒否する
  if (!clockInRaw && !clockOutRaw) {
    return NextResponse.json<AttendanceEditState>({
      error: "出勤・退勤のどちらも未入力です（記録を消す場合は削除してください）",
      success: false,
    });
  }
  const clockIn = clockInRaw || null;
  const clockOut = clockOutRaw || null;
  const inMinutes = timeToMinutes(clockIn);
  if (clockIn !== null && inMinutes === null) {
    return NextResponse.json<AttendanceEditState>({
      error: "出勤時刻は HH:mm 形式で入力してください",
      success: false,
    });
  }
  const outMinutes = timeToMinutes(clockOut);
  if (clockOut !== null && outMinutes === null) {
    return NextResponse.json<AttendanceEditState>({
      error: "退勤時刻は HH:mm 形式で入力してください",
      success: false,
    });
  }
  if (date === todayString()) {
    const nowMinutes = timeToMinutes(nowTimeString())!;
    if ((inMinutes !== null && inMinutes > nowMinutes) || (outMinutes !== null && outMinutes > nowMinutes)) {
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
        // 人が直した記録は打刻由来（CLOCK）ではなくなるため source も更新する
        // （打刻画面が「修正で取り消された打刻」を判別するのに使う）
        update: { clockIn, clockOut, breakMinutes, note, source: "MANUAL" },
        create: { userId, date, clockIn, clockOut, breakMinutes, note, source: "MANUAL" },
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
