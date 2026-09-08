import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission, requireApiUser } from "@/lib/auth/api-guard";
import { ACTIVE_RESERVATION_STATUSES, SESSION_STATUSES, toEnum } from "@/lib/constants";
import { trimOrNull } from "@/lib/normalize";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const form = await request.formData();
  const status = toEnum(SESSION_STATUSES, form.get("status"));
  const capacityRaw = trimOrNull(form.get("capacity"));

  if (capacityRaw !== null) {
    const capacity = Number(capacityRaw);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
      return NextResponse.json({ error: "定員は 1〜100 の数字で入力してください" }, { status: 400 });
    }
    // すでに入っている予約より少ない定員には変更させない
    const agg = await prisma.reservation.aggregate({
      where: { sessionId: id, status: { in: ACTIVE_RESERVATION_STATUSES } },
      _sum: { headcount: true },
    });
    const reserved = agg._sum.headcount ?? 0;
    if (capacity < reserved) {
      return NextResponse.json(
        { error: `すでに ${reserved} 名の予約が入っているため、定員を ${capacity} 名にはできません` },
        { status: 400 },
      );
    }
  }

  await prisma.schoolSession.update({
    where: { id },
    data: {
      ...(status ? { status } : {}),
      ...(capacityRaw !== null ? { capacity: Number(capacityRaw) } : {}),
      ...(form.has("isPublished") ? { isPublished: form.get("isPublished") === "1" } : {}),
      ...(form.has("staffId") ? { staffId: trimOrNull(form.get("staffId")) } : {}),
      ...(form.has("note") ? { note: trimOrNull(form.get("note")) } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}

/** 枠の削除は管理者のみ。予約が入っている枠は消さない */
export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await requireApiPermission(request, "data.delete");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const count = await prisma.reservation.count({
    where: { sessionId: id, status: { in: ACTIVE_RESERVATION_STATUSES } },
  });
  if (count > 0) {
    return NextResponse.json(
      { error: "予約が入っているため削除できません。中止にする場合はステータスを変更してください" },
      { status: 400 },
    );
  }

  await prisma.schoolSession.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
