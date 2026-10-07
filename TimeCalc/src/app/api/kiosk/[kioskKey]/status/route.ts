// スマホ忘れ打刻：選択したスタッフの現在の状態と押せる打刻種別（GET ?userId=）

import { NextResponse } from "next/server";
import { getClockStatus, getTodayTimeline } from "@/lib/attendance/clock-service";
import type { ClockEventType } from "@/lib/attendance/clock";
import { allowedTypesOf, findKioskStaff, resolveKioskDepartment } from "../../_shared";
import type { KioskStatusResponse } from "@/app/qr/[kioskKey]/punch/types";

export async function GET(request: Request, { params }: { params: Promise<{ kioskKey: string }> }) {
  const { kioskKey } = await params;
  const ctx = await resolveKioskDepartment(kioskKey);
  if (!ctx.ok) return ctx.response;

  const userId = new URL(request.url).searchParams.get("userId")?.trim() ?? "";
  const user = await findKioskStaff(ctx.department, userId);
  if (!user) {
    return NextResponse.json({ error: "このスタッフはこの店舗では打刻できません" }, { status: 404 });
  }

  const [status, timeline] = await Promise.all([getClockStatus(user.id), getTodayTimeline(user.id)]);
  const body: KioskStatusResponse = {
    name: user.name,
    phase: status.phase,
    allowedTypes: allowedTypesOf(status),
    events: timeline.map((e) => ({ type: e.type as ClockEventType, time: e.time })),
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
