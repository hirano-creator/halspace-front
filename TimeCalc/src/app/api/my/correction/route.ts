// 打刻の修正申請API（POST、管理者・店長の承認後に勤怠へ反映される）
// 旧 my/actions.ts の createCorrectionAction をそのまま移植

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
  if (!features || features.selfEdit === "none") {
    return NextResponse.json<MyActionState>({
      error: "このアカウントは勤怠の修正申請ができません",
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

  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  if (!reason) {
    return NextResponse.json<MyActionState>({ error: "申請理由を入力してください", success: false });
  }

  const pending = await prisma.correctionRequest.findFirst({
    where: { userId: viewer.id, date: parsed.date, status: "PENDING" },
  });
  if (pending) {
    return NextResponse.json<MyActionState>({
      error: "この日の修正申請は既に承認待ちです",
      success: false,
    });
  }

  try {
    await prisma.correctionRequest.create({ data: { userId: viewer.id, ...parsed, reason } });
  } catch (e) {
    console.error("修正申請エラー:", e);
    return NextResponse.json<MyActionState>({ error: "修正申請の送信に失敗しました", success: false });
  }

  return NextResponse.json<MyActionState>({ error: null, success: true });
}
