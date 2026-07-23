// 遅刻・早退の理由記入API（POST、本人の勤怠のみ）
// 旧 my/actions.ts の saveMyReasonAction をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { normalizeDate } from "@/lib/utils/time";
import type { MyActionState } from "@/app/(app)/my/types";

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;
  const viewer = auth.user;

  const formData = await request.formData();
  const date = normalizeDate(String(formData.get("date") ?? ""));
  if (!date) {
    return NextResponse.json<MyActionState>({ error: "日付の形式が不正です", success: false });
  }

  const lateReason = String(formData.get("lateReason") ?? "").trim().slice(0, 200) || null;
  const earlyLeaveReason =
    String(formData.get("earlyLeaveReason") ?? "").trim().slice(0, 200) || null;

  const record = await prisma.attendance.findUnique({
    where: { userId_date: { userId: viewer.id, date } },
  });
  if (!record) {
    return NextResponse.json<MyActionState>({ error: "この日の勤怠データがありません", success: false });
  }

  try {
    await prisma.attendance.update({
      where: { id: record.id },
      data: { lateReason, earlyLeaveReason },
    });
  } catch (e) {
    console.error("理由記入エラー:", e);
    return NextResponse.json<MyActionState>({ error: "理由の保存に失敗しました", success: false });
  }

  return NextResponse.json<MyActionState>({ error: null, success: true });
}
