// 打刻直後の理由追記API（POST、本人の当日イベントのみ）
// 旧 clock/actions.ts の saveEventReasonAction をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { todayString } from "@/lib/utils/time";
import { deriveAndSaveAttendance } from "@/lib/attendance/clock-service";
import type { ReasonState } from "@/app/(app)/clock/types";

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;
  const viewer = auth.user;

  const formData = await request.formData();
  const eventId = String(formData.get("eventId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200);
  if (!reason) {
    return NextResponse.json<ReasonState>({ error: "理由を入力してください", success: false });
  }

  const event = await prisma.clockEvent.findUnique({ where: { id: eventId } });
  if (!event || event.userId !== viewer.id || event.date !== todayString()) {
    return NextResponse.json<ReasonState>({ error: "対象の打刻が見つかりません", success: false });
  }

  try {
    await prisma.clockEvent.update({ where: { id: eventId }, data: { reason } });
    // Attendance に既に書き戻し済みなら理由も反映し直す
    await deriveAndSaveAttendance(viewer.id, event.date);
  } catch (e) {
    console.error("理由保存エラー:", e);
    return NextResponse.json<ReasonState>({ error: "理由の保存に失敗しました", success: false });
  }

  return NextResponse.json<ReasonState>({ error: null, success: true });
}
