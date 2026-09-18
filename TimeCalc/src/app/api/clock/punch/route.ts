// 出勤・退勤・外出・戻りの打刻API（POST）
// 旧 clock/actions.ts の punchAction をそのまま移植
//
// 「現在の状態を確認 → 打刻を登録 → 1日分の勤怠を導出」は、ユーザー単位の advisory lock を
// 取った1つのトランザクションで行う。二重タップや2台の端末から同時に送られても、
// 後の方は更新後の状態で検証されるので「出勤が2件」のような重複が入らない。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { resolveFeatures } from "@/lib/auth/features";
import { todayString, nowTimeString } from "@/lib/utils/time";
import { toQrKind } from "@/lib/qr";
import { toClockEventType, CLOCK_EVENT_LABELS } from "@/lib/attendance/clock";
import { getClockStatus, validatePunch, deriveAndSaveAttendance } from "@/lib/attendance/clock-service";
import { resolveClockDepartment, checkGps, calcLateMinutes, lockUserForPunch } from "../_shared";
import type { PunchState } from "@/app/(app)/clock/types";

const emptyState: Omit<PunchState, "error" | "success"> = {
  punchedLabel: null,
  punchedTime: null,
  lateMinutes: 0,
  eventId: null,
};

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;
  const viewer = auth.user;

  const formData = await request.formData();

  const type = toClockEventType(String(formData.get("type") ?? ""));
  if (!type) {
    return NextResponse.json<PunchState>({ error: "不正な打刻種別です", success: false, ...emptyState });
  }

  // 機能設定（スタッフ単位）はセッションではなくDBの最新値で判定する
  const me = await prisma.user.findUnique({ where: { id: viewer.id } });
  if (!me || !me.isActive) {
    return NextResponse.json<PunchState>({ error: "アカウントが無効です", success: false, ...emptyState });
  }
  const features = resolveFeatures(me.featureOverrides);

  // QRコードの種類（出勤・退勤用/外出・戻り用）と打刻種別の整合を確認する
  const kind = toQrKind(formData.get("kind"));
  if (kind === "attend" && type !== "IN" && type !== "OUT") {
    return NextResponse.json<PunchState>({
      error: "このQRコードでは出勤・退勤のみ打刻できます",
      success: false,
      ...emptyState,
    });
  }
  if (kind === "outing" && type !== "OUT_START" && type !== "OUT_END") {
    return NextResponse.json<PunchState>({
      error: "このQRコードでは外出・戻りのみ打刻できます",
      success: false,
      ...emptyState,
    });
  }
  if (features.clockMode === "qrScan" && !kind) {
    return NextResponse.json<PunchState>({
      error: "店舗のQRコードを読み取ってから打刻してください",
      success: false,
      ...emptyState,
    });
  }

  const requestedDepartmentId = String(formData.get("departmentId") ?? "").trim() || null;
  const token = String(formData.get("token") ?? "").trim() || null;

  const ctx = await resolveClockDepartment(features.clockMode, requestedDepartmentId, me.departmentId, token);
  if (!ctx.ok) {
    return NextResponse.json<PunchState>({ error: ctx.error, success: false, ...emptyState });
  }
  const { department } = ctx;
  // 打刻に記録する部署（QR経由なら店舗、それ以外は所属部署）
  const departmentId = department?.id ?? null;

  const latRaw = formData.get("lat");
  const lngRaw = formData.get("lng");
  const lat = latRaw !== null && latRaw !== "" ? Number(latRaw) : null;
  const lng = lngRaw !== null && lngRaw !== "" ? Number(lngRaw) : null;

  const gps = checkGps(me, department, lat, lng);
  if (!gps.ok) {
    return NextResponse.json<PunchState>({ error: gps.error, success: false, ...emptyState });
  }

  const time = nowTimeString();
  const date = todayString();
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200) || null;

  // トランザクション内で打刻を拒否した場合はその理由、登録できた場合は打刻IDを返す
  type Outcome = { punchError: string } | { eventId: string };

  let eventId: string;
  try {
    const outcome = await prisma.$transaction<Outcome>(
      async (tx) => {
        await lockUserForPunch(tx, viewer.id);
        const status = await getClockStatus(viewer.id, date, tx);
        const punchError = validatePunch(status, type);
        if (punchError) return { punchError };

        const created = await tx.clockEvent.create({
          data: {
            userId: viewer.id,
            type,
            reason,
            date,
            time,
            latitude: lat,
            longitude: lng,
            distanceMeters: gps.distance,
            departmentId,
          },
        });
        await deriveAndSaveAttendance(viewer.id, date, tx);
        return { eventId: created.id };
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
    if ("punchError" in outcome) {
      return NextResponse.json<PunchState>({ error: outcome.punchError, success: false, ...emptyState });
    }
    eventId = outcome.eventId;
  } catch (e) {
    console.error("打刻エラー:", e);
    return NextResponse.json<PunchState>({ error: "打刻に失敗しました", success: false, ...emptyState }, { status: 500 });
  }

  const lateMinutes = type === "IN" ? await calcLateMinutes(viewer.id, date, time, department) : 0;

  return NextResponse.json<PunchState>({
    error: null,
    success: true,
    punchedLabel: CLOCK_EVENT_LABELS[type],
    punchedTime: time,
    lateMinutes,
    eventId,
  });
}
