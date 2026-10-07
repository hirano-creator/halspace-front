// スマホ忘れ打刻（店舗端末）で撮影した写真の配信（GET）
// 閲覧できるのは本人と、その社員の勤怠を閲覧できる人（社員詳細と同じ判定）だけ。

import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api-guard";
import { canViewEmployee } from "@/lib/auth/guard";
import { getPhoto, isPhotoExpired } from "@/lib/storage/photo-storage";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const event = await prisma.clockEvent.findUnique({
    where: { id },
    include: { user: { select: { id: true, departmentId: true, department: { select: { companyId: true } } } } },
  });
  if (!event) return NextResponse.json({ error: "打刻が見つかりません" }, { status: 404 });

  const target = {
    id: event.user.id,
    departmentId: event.user.departmentId,
    companyId: event.user.department?.companyId ?? null,
  };
  if (!canViewEmployee(auth.user, target)) {
    return NextResponse.json({ error: "この写真を閲覧する権限がありません" }, { status: 403 });
  }

  if (!event.photoKey) return NextResponse.json({ error: "写真がありません" }, { status: 404 });
  if (isPhotoExpired(event.timestamp)) {
    return NextResponse.json({ error: "保存期間（90日）を過ぎたため削除されました" }, { status: 410 });
  }

  const bytes = await getPhoto(event.photoKey).catch((e) => {
    console.error("写真の読み出しエラー:", e);
    return null;
  });
  if (!bytes) return NextResponse.json({ error: "写真を読み出せませんでした" }, { status: 404 });

  return new Response(bytes as BodyInit, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" },
  });
}
