// スマホ忘れ打刻：店舗タブレットからの顔写真つき打刻（POST multipart: userId, type, photo）
//
// 本人の端末ではないので、代わりの打刻の抑止として撮影写真を必須にする（顔の照合はしない）。
// 打刻そのものは /api/clock/punch と同じく、ユーザー単位の advisory lock を取った1つの
// トランザクションで「状態確認→登録→導出」を行う。時刻はサーバー時刻。
// 写真はコミット後に保存し、保存に失敗しても打刻は成立させる（photoKey=null で「写真なし」と表示）。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/auth/login-throttle";
import { todayString, nowTimeString } from "@/lib/utils/time";
import { toClockEventType, CLOCK_EVENT_LABELS } from "@/lib/attendance/clock";
import { getClockStatus, validatePunch, deriveAndSaveAttendance } from "@/lib/attendance/clock-service";
import { MAX_PHOTO_BYTES, isJpeg, photoKeyFor, putPhoto } from "@/lib/storage/photo-storage";
import { calcLateMinutes, lockUserForPunch } from "../../../clock/_shared";
import { findKioskStaff, kioskPunchThrottle, resolveKioskDepartment } from "../../_shared";
import type { KioskPunchResponse } from "@/app/qr/[kioskKey]/punch/types";

function fail(error: string, status = 200) {
  return NextResponse.json<KioskPunchResponse>(
    { error, success: false, punchedLabel: null, punchedTime: null, lateMinutes: 0, photoFailed: false },
    { status },
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ kioskKey: string }> }) {
  const ip = clientIp(request);
  const lockedFor = kioskPunchThrottle.lockedFor(ip);
  if (lockedFor !== null) {
    return fail(`打刻が続けて行われたため一時的に受け付けを停止しています。約${Math.ceil(lockedFor / 60)}分後にお試しください`, 429);
  }
  kioskPunchThrottle.recordFailure(ip);

  const { kioskKey } = await params;
  const ctx = await resolveKioskDepartment(kioskKey);
  if (!ctx.ok) return ctx.response;
  const { department } = ctx;

  const formData = await request.formData();
  const type = toClockEventType(String(formData.get("type") ?? ""));
  if (!type) return fail("不正な打刻種別です", 400);

  const photo = formData.get("photo");
  if (!(photo instanceof Blob) || photo.size === 0) {
    return fail("写真を撮影してから打刻してください", 400);
  }
  if (photo.size > MAX_PHOTO_BYTES) return fail("写真のサイズが大きすぎます", 400);
  const photoBytes = new Uint8Array(await photo.arrayBuffer());
  if (!isJpeg(photoBytes)) return fail("写真の形式が正しくありません", 400);

  const user = await findKioskStaff(department, String(formData.get("userId") ?? "").trim());
  if (!user) return fail("このスタッフはこの店舗では打刻できません", 403);

  const time = nowTimeString();
  const date = todayString();

  type Outcome = { punchError: string } | { eventId: string };
  let eventId: string;
  try {
    const outcome = await prisma.$transaction<Outcome>(
      async (tx) => {
        await lockUserForPunch(tx, user.id);
        const status = await getClockStatus(user.id, date, tx);
        const punchError = validatePunch(status, type);
        if (punchError) return { punchError };

        const created = await tx.clockEvent.create({
          data: {
            userId: user.id,
            type,
            date,
            time,
            departmentId: department.id,
            via: "KIOSK",
          },
        });
        await deriveAndSaveAttendance(user.id, date, tx);
        return { eventId: created.id };
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
    if ("punchError" in outcome) return fail(outcome.punchError);
    eventId = outcome.eventId;
  } catch (e) {
    console.error("キオスク打刻エラー:", e);
    return fail("打刻に失敗しました", 500);
  }

  let photoFailed = false;
  try {
    const key = photoKeyFor(eventId, date);
    await putPhoto(key, photoBytes);
    await prisma.clockEvent.update({ where: { id: eventId }, data: { photoKey: key } });
  } catch (e) {
    console.error("キオスク打刻の写真保存エラー:", e);
    photoFailed = true;
  }

  const lateMinutes = type === "IN" ? await calcLateMinutes(user.id, date, time, department) : 0;

  return NextResponse.json<KioskPunchResponse>({
    error: null,
    success: true,
    punchedLabel: CLOCK_EVENT_LABELS[type],
    punchedTime: time,
    lateMinutes,
    photoFailed,
  });
}
