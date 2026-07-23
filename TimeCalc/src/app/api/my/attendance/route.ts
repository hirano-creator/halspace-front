// 本人による勤怠直接修正API（POST、「本人直接修正可」設定のスタッフのみ）
// 旧 my/actions.ts の selfSaveAttendanceAction をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { myFeatures, myWorkRules, parseCorrectionForm } from "../_shared";
import type { MyActionState } from "@/app/(app)/my/types";

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;
  const viewer = auth.user;

  const formData = await request.formData();
  const [features, rules] = await Promise.all([myFeatures(viewer.id), myWorkRules(viewer.id)]);
  if (!features || features.selfEdit !== "direct") {
    return NextResponse.json<MyActionState>({
      error: "このアカウントは勤怠を直接修正できません",
      success: false,
    });
  }
  if (!rules) {
    return NextResponse.json<MyActionState>({ error: "ユーザーが見つかりません", success: false });
  }

  const parsed = parseCorrectionForm(formData, rules);
  if (typeof parsed === "string") {
    return NextResponse.json<MyActionState>({ error: parsed, success: false });
  }

  const note = String(formData.get("reason") ?? "").trim().slice(0, 500) || null;

  try {
    const before = await prisma.attendance.findUnique({
      where: { userId_date: { userId: viewer.id, date: parsed.date } },
    });
    const after = await prisma.attendance.upsert({
      where: { userId_date: { userId: viewer.id, date: parsed.date } },
      update: {
        clockIn: parsed.clockIn,
        clockOut: parsed.clockOut,
        breakMinutes: parsed.breakMinutes,
        outingStart: parsed.outingStart,
        outingEnd: parsed.outingEnd,
        source: "MANUAL",
      },
      create: {
        userId: viewer.id,
        date: parsed.date,
        clockIn: parsed.clockIn,
        clockOut: parsed.clockOut,
        breakMinutes: parsed.breakMinutes,
        outingStart: parsed.outingStart,
        outingEnd: parsed.outingEnd,
        source: "MANUAL",
      },
    });
    await prisma.attendanceLog.create({
      data: {
        userId: viewer.id,
        date: parsed.date,
        actorId: viewer.id,
        action: "EDIT",
        before: before
          ? JSON.stringify({
              clockIn: before.clockIn,
              clockOut: before.clockOut,
              breakMinutes: before.breakMinutes,
            })
          : null,
        after: JSON.stringify({
          clockIn: after.clockIn,
          clockOut: after.clockOut,
          breakMinutes: after.breakMinutes,
        }),
        note,
      },
    });
  } catch (e) {
    console.error("本人修正エラー:", e);
    return NextResponse.json<MyActionState>({ error: "勤怠の修正に失敗しました", success: false });
  }

  return NextResponse.json<MyActionState>({ error: null, success: true });
}
