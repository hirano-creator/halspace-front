// 出勤・退勤QRのスキャン即打刻API（POST、「スキャン即打刻」設定のスタッフ専用）
// 旧 clock/actions.ts の autoPunchAction をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { resolveFeatures } from "@/lib/auth/features";
import { todayString, nowTimeString } from "@/lib/utils/time";
import { phaseOfLastEvent, CLOCK_EVENT_LABELS, type ClockEventType } from "@/lib/attendance/clock";
import { deriveAndSaveAttendance } from "@/lib/attendance/clock-service";
import { resolveClockDepartment, checkGps, calcLateMinutes } from "../_shared";
import type { AutoPunchState } from "@/app/(app)/clock/types";

const emptyAutoState: Omit<AutoPunchState, "error" | "success"> = {
  punchedLabel: null,
  punchedTime: null,
  lateMinutes: 0,
  eventId: null,
  alreadyPunched: false,
  confirmOut: false,
};

/** 直近の打刻からこの時間内は自動打刻を実行しない（リロード等による誤打刻防止） */
const AUTO_PUNCH_GUARD_MS = 2 * 60 * 1000;

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;
  const viewer = auth.user;

  const formData = await request.formData();

  const me = await prisma.user.findUnique({ where: { id: viewer.id } });
  if (!me || !me.isActive) {
    return NextResponse.json<AutoPunchState>({
      error: "アカウントが無効です",
      success: false,
      ...emptyAutoState,
    });
  }
  const features = resolveFeatures(me.featureOverrides);
  if (features.clockMode !== "qrScan") {
    return NextResponse.json<AutoPunchState>({
      error: "この操作は「スキャン即打刻」設定のスタッフのみ利用できます",
      success: false,
      ...emptyAutoState,
    });
  }

  const requestedDepartmentId = String(formData.get("departmentId") ?? "").trim() || null;
  const token = String(formData.get("token") ?? "").trim() || null;
  const force = formData.get("force") === "on";
  const confirmed = formData.get("confirm") === "on";

  const ctx = await resolveClockDepartment(
    features.clockMode,
    requestedDepartmentId,
    requestedDepartmentId,
    token,
  );
  if (!ctx.ok) {
    return NextResponse.json<AutoPunchState>({ error: ctx.error, success: false, ...emptyAutoState });
  }
  const { department } = ctx;

  const last = await prisma.clockEvent.findFirst({
    where: { userId: viewer.id },
    orderBy: { timestamp: "desc" },
  });

  if (last && !force && Date.now() - last.timestamp.getTime() < AUTO_PUNCH_GUARD_MS) {
    return NextResponse.json<AutoPunchState>({
      error: null,
      success: false,
      punchedLabel: CLOCK_EVENT_LABELS[last.type as ClockEventType],
      punchedTime: last.time,
      lateMinutes: 0,
      eventId: last.id,
      alreadyPunched: true,
      confirmOut: false,
    });
  }

  const phase = phaseOfLastEvent((last?.type as ClockEventType | undefined) ?? null);
  let type: ClockEventType;
  if (phase === "beforeWork" || phase === "offWork") {
    type = "IN";
  } else if (phase === "working") {
    type = "OUT";
  } else {
    // 外出中: 退勤の意図か戻り忘れかを機械的に判断できないため、確認を挟む
    if (!confirmed) {
      return NextResponse.json<AutoPunchState>({
        error: null,
        success: false,
        ...emptyAutoState,
        confirmOut: true,
      });
    }
    type = "OUT";
  }

  const latRaw = formData.get("lat");
  const lngRaw = formData.get("lng");
  const lat = latRaw !== null && latRaw !== "" ? Number(latRaw) : null;
  const lng = lngRaw !== null && lngRaw !== "" ? Number(lngRaw) : null;

  const gps = checkGps(me, department, lat, lng);
  if (!gps.ok) {
    return NextResponse.json<AutoPunchState>({ error: gps.error, success: false, ...emptyAutoState });
  }

  const time = nowTimeString();
  const date = todayString();

  let eventId: string | null = null;
  try {
    const created = await prisma.clockEvent.create({
      data: {
        userId: viewer.id,
        type,
        reason: null,
        date,
        time,
        latitude: lat,
        longitude: lng,
        distanceMeters: gps.distance,
        departmentId: requestedDepartmentId,
      },
    });
    eventId = created.id;
    await deriveAndSaveAttendance(viewer.id, date);
  } catch (e) {
    console.error("自動打刻エラー:", e);
    return NextResponse.json<AutoPunchState>({
      error: "打刻に失敗しました",
      success: false,
      ...emptyAutoState,
    });
  }

  const lateMinutes = type === "IN" ? await calcLateMinutes(viewer.id, date, time, department) : 0;

  return NextResponse.json<AutoPunchState>({
    error: null,
    success: true,
    punchedLabel: CLOCK_EVENT_LABELS[type],
    punchedTime: time,
    lateMinutes,
    eventId,
    alreadyPunched: false,
    confirmOut: false,
  });
}
