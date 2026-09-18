// 修正申請の承認API（POST、勤怠へ反映し修正履歴を記録する）
// 旧 corrections/actions.ts の approveCorrectionAction をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { ReviewState } from "@/app/(app)/corrections/types";
import { findReviewable } from "../../_shared";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await findReviewable(request, id);
  if (!found.ok) {
    if ("response" in found) return found.response;
    return NextResponse.json<ReviewState>({ error: found.error, success: false });
  }
  const { viewer, request: correctionRequest } = found;

  const formData = await request.formData();
  const reviewNote = String(formData.get("reviewNote") ?? "").trim().slice(0, 500) || null;

  try {
    // 「PENDING のものだけを APPROVED にする」更新を同じトランザクションの先頭で行い、
    // 0件なら他の承認者が先に処理済みなので勤怠には触らずに終える
    // （findReviewable の status 確認はトランザクション外なので、同時クリックの二重反映はここで防ぐ）
    const applied = await prisma.$transaction(async (tx) => {
      const claimed = await tx.correctionRequest.updateMany({
        where: { id: correctionRequest.id, status: "PENDING" },
        data: { status: "APPROVED", reviewedById: viewer.id, reviewNote, reviewedAt: new Date() },
      });
      if (claimed.count === 0) return false;

      const before = await tx.attendance.findUnique({
        where: { userId_date: { userId: correctionRequest.userId, date: correctionRequest.date } },
      });
      await tx.attendance.upsert({
        where: { userId_date: { userId: correctionRequest.userId, date: correctionRequest.date } },
        update: {
          clockIn: correctionRequest.clockIn,
          clockOut: correctionRequest.clockOut,
          breakMinutes: correctionRequest.breakMinutes,
          outingStart: correctionRequest.outingStart,
          outingEnd: correctionRequest.outingEnd,
          source: "MANUAL",
        },
        create: {
          userId: correctionRequest.userId,
          date: correctionRequest.date,
          clockIn: correctionRequest.clockIn,
          clockOut: correctionRequest.clockOut,
          breakMinutes: correctionRequest.breakMinutes,
          outingStart: correctionRequest.outingStart,
          outingEnd: correctionRequest.outingEnd,
          source: "MANUAL",
        },
      });
      await tx.attendanceLog.create({
        data: {
          userId: correctionRequest.userId,
          date: correctionRequest.date,
          actorId: viewer.id,
          action: "APPROVE",
          before: before
            ? JSON.stringify({
                clockIn: before.clockIn,
                clockOut: before.clockOut,
                breakMinutes: before.breakMinutes,
              })
            : null,
          after: JSON.stringify({
            clockIn: correctionRequest.clockIn,
            clockOut: correctionRequest.clockOut,
            breakMinutes: correctionRequest.breakMinutes,
          }),
          note: `申請理由: ${correctionRequest.reason}`,
        },
      });
      return true;
    });
    if (!applied) {
      return NextResponse.json<ReviewState>({ error: "この申請は処理済みです", success: false });
    }
  } catch (e) {
    console.error("申請承認エラー:", e);
    return NextResponse.json<ReviewState>({ error: "申請の承認に失敗しました", success: false });
  }

  return NextResponse.json<ReviewState>({ error: null, success: true });
}
