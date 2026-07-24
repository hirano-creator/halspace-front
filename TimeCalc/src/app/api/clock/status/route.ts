// 打刻画面の初期状態取得API（GET）
// 旧 clock/page.tsx（Server Component）が行っていたデータ取得・判定をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { resolveFeatures } from "@/lib/auth/features";
import { getClockStatus, getTimelineWithCorrections } from "@/lib/attendance/clock-service";
import { todayString } from "@/lib/utils/time";
import { dailyQrToken, toQrKind } from "@/lib/qr";
import type { ClockStatusResponse } from "@/app/(app)/clock/types";

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;
  const viewer = auth.user;

  const url = new URL(request.url);
  const deptParam = url.searchParams.get("dept");
  const tokenParam = url.searchParams.get("token");
  const kindParam = url.searchParams.get("kind");

  const requestedDeptId = deptParam?.trim() || null;
  const departmentId = requestedDeptId ?? viewer.departmentId;
  const qrKind = toQrKind(kindParam);

  const [status, events, department, me] = await Promise.all([
    getClockStatus(viewer.id),
    getTimelineWithCorrections(viewer.id, todayString()),
    departmentId ? prisma.department.findUnique({ where: { id: departmentId } }) : null,
    prisma.user.findUnique({ where: { id: viewer.id } }),
  ]);
  const features = resolveFeatures(me?.featureOverrides);

  // 自由打刻の設定で、かつQR経由（?dept=）でアクセスしていない場合は、
  // 所属部署の日替わりQR設定があっても個人設定（自由打刻）を優先し、トークン検証を行わない
  const bypassDailyQrCheck = features.clockMode === "free" && !requestedDeptId;

  // 日替わりQRが有効な部署は、当日分のトークンと一致しない限り打刻させない
  const qrTokenError =
    !bypassDailyQrCheck &&
    department?.dailyQrEnabled &&
    (!tokenParam || tokenParam !== dailyQrToken(department.id, todayString()))
      ? "このQRコードは本日分ではありません。店舗に表示されている最新のQRコードを読み取ってください"
      : null;

  // QR経由必須の設定（qrTap/qrScan）は、店舗QR（dept+kindが揃ったURL）からのアクセスのみ許可する
  const needsGuidance = features.clockMode !== "free" && (!qrKind || !requestedDeptId);

  const body: ClockStatusResponse = {
    viewer: { id: viewer.id, name: viewer.name },
    department: department ? { id: department.id, name: department.name } : null,
    status: {
      phase: status.phase,
      canClockIn: status.canClockIn,
      canClockOut: status.canClockOut,
      canOutStart: status.canOutStart,
      canOutEnd: status.canOutEnd,
    },
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      time: e.time,
      reason: e.reason,
      corrected: e.corrected,
      cancelled: e.cancelled,
    })),
    qrKind,
    requestedDeptId,
    qrTokenError,
    needsGuidance,
    clockMode: features.clockMode,
  };

  return NextResponse.json(body);
}
