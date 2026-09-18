// 出勤・退勤QRのスキャン即打刻API（POST、「スキャン即打刻」設定のスタッフ専用）
// 旧 clock/actions.ts の autoPunchAction をそのまま移植
//
// 状態の確認から打刻の登録・導出までは punch と同じくユーザー単位の advisory lock 付き
// トランザクションで行う（QR画面を続けて2回開いた場合などの同時送信で重複しないように）。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { resolveFeatures } from "@/lib/auth/features";
import { todayString, nowTimeString } from "@/lib/utils/time";
import { CLOCK_EVENT_LABELS, type ClockEventType } from "@/lib/attendance/clock";
import { deriveAndSaveAttendance, getClockStatus } from "@/lib/attendance/clock-service";
import { resolveClockDepartment, checkGps, calcLateMinutes, lockUserForPunch } from "../_shared";
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

  const ctx = await resolveClockDepartment(features.clockMode, requestedDepartmentId, me.departmentId, token);
  if (!ctx.ok) {
    return NextResponse.json<AutoPunchState>({ error: ctx.error, success: false, ...emptyAutoState });
  }
  const { department } = ctx;

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

  // トランザクション内で「打刻しない」と判断した場合の応答（そのまま返す）
  type Outcome = { response: AutoPunchState } | { eventId: string; type: ClockEventType };

  let eventId: string;
  let type: ClockEventType;
  try {
    const outcome = await prisma.$transaction<Outcome>(
      async (tx) => {
        await lockUserForPunch(tx, viewer.id);

        // 打刻忘れで日付が変わった場合も当日は「勤務外」から始まるため（getClockStatus 参照）、
        // 前日の未退勤を引きずって初回スキャンが退勤になることはない
        const status = await getClockStatus(viewer.id, date, tx);
        const last = status.lastEvent;

        if (last && !force && Date.now() - last.timestamp.getTime() < AUTO_PUNCH_GUARD_MS) {
          return {
            response: {
              error: null,
              success: false,
              punchedLabel: CLOCK_EVENT_LABELS[last.type],
              punchedTime: last.time,
              lateMinutes: 0,
              eventId: last.id,
              alreadyPunched: true,
              confirmOut: false,
            },
          };
        }

        const phase = status.phase;
        let nextType: ClockEventType;
        if (phase === "beforeWork" || phase === "offWork") {
          nextType = "IN";
        } else if (phase === "working") {
          nextType = "OUT";
        } else {
          // 外出中: 退勤の意図か戻り忘れかを機械的に判断できないため、確認を挟む
          if (!confirmed) {
            return { response: { error: null, success: false, ...emptyAutoState, confirmOut: true } };
          }
          nextType = "OUT";
        }

        const created = await tx.clockEvent.create({
          data: {
            userId: viewer.id,
            type: nextType,
            reason: null,
            date,
            time,
            latitude: lat,
            longitude: lng,
            distanceMeters: gps.distance,
            departmentId: department?.id ?? null,
          },
        });
        await deriveAndSaveAttendance(viewer.id, date, tx);
        return { eventId: created.id, type: nextType };
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
    if ("response" in outcome) return NextResponse.json<AutoPunchState>(outcome.response);
    eventId = outcome.eventId;
    type = outcome.type;
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
