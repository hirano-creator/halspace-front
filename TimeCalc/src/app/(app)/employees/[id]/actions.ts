"use server";

// 勤怠修正の Server Action（追加・更新・削除）

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guard";
import { can } from "@/lib/auth/roles";
import { normalizeDate, timeToMinutes } from "@/lib/utils/time";

export interface AttendanceEditState {
  error: string | null;
  success: boolean;
}

/** 対象社員の勤怠を編集できるか検証する（不可なら理由を返す） */
async function checkEditable(targetUserId: string): Promise<string | null> {
  const viewer = await requireUser();
  if (!can(viewer.role, "editAttendance")) return "勤怠を修正する権限がありません";

  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) return "対象の社員が見つかりません";

  // 店長は自部署のみ修正可能
  if (!can(viewer.role, "viewAllEmployees")) {
    if (!viewer.departmentId || viewer.departmentId !== target.departmentId) {
      return "自部署以外の勤怠は修正できません";
    }
  }
  return null;
}

/** 勤怠を追加・更新する（同一社員・同一日付は上書き） */
export async function saveAttendanceAction(
  _prev: AttendanceEditState,
  formData: FormData,
): Promise<AttendanceEditState> {
  const userId = String(formData.get("userId") ?? "");
  const rawDate = String(formData.get("date") ?? "");
  const clockIn = String(formData.get("clockIn") ?? "").trim();
  const clockOut = String(formData.get("clockOut") ?? "").trim();
  const breakMinutes = Number(formData.get("breakMinutes") ?? 0);
  const note = String(formData.get("note") ?? "").trim() || null;

  const authError = await checkEditable(userId);
  if (authError) return { error: authError, success: false };

  const date = normalizeDate(rawDate);
  if (!date) return { error: "日付の形式が不正です", success: false };
  if (timeToMinutes(clockIn) === null || timeToMinutes(clockOut) === null) {
    return { error: "時刻は HH:mm 形式で入力してください", success: false };
  }
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 480) {
    return { error: "休憩時間は0〜480分で入力してください", success: false };
  }

  try {
    await prisma.attendance.upsert({
      where: { userId_date: { userId, date } },
      update: { clockIn, clockOut, breakMinutes, note },
      create: { userId, date, clockIn, clockOut, breakMinutes, note },
    });
  } catch (e) {
    console.error("勤怠保存エラー:", e);
    return { error: "勤怠の保存に失敗しました", success: false };
  }

  revalidatePath(`/employees/${userId}`);
  revalidatePath("/attendance");
  return { error: null, success: true };
}

/** 勤怠を削除する */
export async function deleteAttendanceAction(
  _prev: AttendanceEditState,
  formData: FormData,
): Promise<AttendanceEditState> {
  const attendanceId = String(formData.get("attendanceId") ?? "");

  const record = await prisma.attendance.findUnique({ where: { id: attendanceId } });
  if (!record) return { error: "対象の勤怠が見つかりません", success: false };

  const authError = await checkEditable(record.userId);
  if (authError) return { error: authError, success: false };

  try {
    await prisma.attendance.delete({ where: { id: attendanceId } });
  } catch (e) {
    console.error("勤怠削除エラー:", e);
    return { error: "勤怠の削除に失敗しました", success: false };
  }

  revalidatePath(`/employees/${record.userId}`);
  revalidatePath("/attendance");
  return { error: null, success: true };
}
