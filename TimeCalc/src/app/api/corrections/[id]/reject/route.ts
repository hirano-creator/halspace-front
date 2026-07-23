// 修正申請の却下API（POST）
// 旧 corrections/actions.ts の rejectCorrectionAction をそのまま移植

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
  const reviewNote = String(formData.get("reviewNote") ?? "").trim().slice(0, 500);
  if (!reviewNote) {
    return NextResponse.json<ReviewState>({ error: "却下理由を入力してください", success: false });
  }

  try {
    await prisma.$transaction([
      prisma.correctionRequest.update({
        where: { id: correctionRequest.id },
        data: { status: "REJECTED", reviewedById: viewer.id, reviewNote, reviewedAt: new Date() },
      }),
      prisma.attendanceLog.create({
        data: {
          userId: correctionRequest.userId,
          date: correctionRequest.date,
          actorId: viewer.id,
          action: "REJECT",
          before: null,
          after: null,
          note: `却下理由: ${reviewNote}（申請理由: ${correctionRequest.reason}）`,
        },
      }),
    ]);
  } catch (e) {
    console.error("申請却下エラー:", e);
    return NextResponse.json<ReviewState>({ error: "申請の却下に失敗しました", success: false });
  }

  return NextResponse.json<ReviewState>({ error: null, success: true });
}
