import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission, requireApiUser } from "@/lib/auth/api-guard";
import { recalcCustomerStats } from "@/lib/customer-stats";
import { guestLabel } from "@/lib/display";
import { formatJstDate, nowForDateTimeInput } from "@/lib/utils/time";
import { parseVisitForm } from "../_shared";
import type { VisitDetailResponse } from "@/app/(app)/visits/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const visit = await prisma.visit.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, code: true, name: true, visitCount: true } },
      staff: { select: { name: true } },
      interests: { select: { categoryId: true } },
      purchases: { select: { id: true, totalAmount: true } },
      guests: { select: { ageGroup: true, gender: true } },
    },
  });
  if (!visit) {
    return NextResponse.json({ error: "来店記録が見つかりません" }, { status: 404 });
  }

  const body: VisitDetailResponse = {
    id: visit.id,
    customerId: visit.customerId,
    customerName: visit.customer?.name ?? null,
    customerCode: visit.customer?.code ?? null,
    displayName: visit.customer?.name ?? guestLabel(visit),
    guestAgeGroup: visit.guestAgeGroup,
    guestGender: visit.guestGender,
    guestMemo: visit.guestMemo,
    guestBreakdown: visit.guests.map((g) => ({ ageGroup: g.ageGroup, gender: g.gender })),
    // datetime-local 入力にそのまま入れられる形式で返す
    visitedAt: nowForDateTimeInput(visit.visitedAt),
    partySize: visit.partySize,
    purposeCode: visit.purposeCode,
    channelCode: visit.channelCode,
    referrerCode: visit.referrerCode,
    prefectureCode: visit.prefectureCode,
    purchased: visit.purchased,
    noPurchaseReasonCode: visit.noPurchaseReasonCode,
    noPurchaseComment: visit.noPurchaseComment,
    conversation: visit.conversation,
    nextProposal: visit.nextProposal,
    followUpDate: visit.followUpDate ? formatJstDate(visit.followUpDate) : null,
    interestCategoryIds: visit.interests
      .map((i) => i.categoryId)
      .filter((v): v is string => Boolean(v)),
    isFirstVisit: visit.isFirstVisit,
    staffName: visit.staff?.name ?? null,
    purchases: visit.purchases.map((p) => ({ id: p.id, totalAmount: p.totalAmount })),
  };

  return NextResponse.json(body);
}

/** 来店内容の修正。誤入力をその場で直せないと記録が続かないので、スタッフも編集できる */
export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const existing = await prisma.visit.findUnique({
    where: { id },
    select: { id: true, customerId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "来店記録が見つかりません" }, { status: 404 });
  }

  const form = await request.formData();
  const input = parseVisitForm(form);
  if (typeof input === "string") {
    return NextResponse.json({ error: input }, { status: 400 });
  }

  await prisma.visit.update({
    where: { id },
    data: {
      customerId: input.customerId,
      guestAgeGroup: input.guestAgeGroup,
      guestGender: input.guestGender,
      guestMemo: input.guestMemo,
      visitedAt: input.visitedAt,
      partySize: input.partySize,
      purposeCode: input.purposeCode,
      channelCode: input.channelCode,
      referrerCode: input.referrerCode,
      prefectureCode: input.prefectureCode,
      purchased: input.purchased,
      noPurchaseReasonCode: input.noPurchaseReasonCode,
      noPurchaseComment: input.noPurchaseComment,
      conversation: input.conversation,
      nextProposal: input.nextProposal,
      followUpDate: input.followUpDate,
      // 興味商品・内訳は入れ替え
      interests: {
        deleteMany: {},
        create: input.interestCategoryIds.map((categoryId) => ({ categoryId })),
      },
      guests: {
        deleteMany: {},
        create: input.guestBreakdown.map((g) => ({ ageGroup: g.ageGroup, gender: g.gender })),
      },
    },
  });

  // 顧客の紐付けが変わった場合は、元の顧客と新しい顧客の両方を数え直す
  const targets = new Set(
    [existing.customerId, input.customerId].filter((v): v is string => Boolean(v)),
  );
  for (const customerId of targets) {
    await recalcCustomerStats(customerId);
  }

  return NextResponse.json({ ok: true });
}

/** 来店記録の削除は管理者のみ */
export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await requireApiPermission(request, "data.delete");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const visit = await prisma.visit.findUnique({
    where: { id },
    select: { id: true, customerId: true, purchases: { select: { id: true } } },
  });
  if (!visit) {
    return NextResponse.json({ error: "来店記録が見つかりません" }, { status: 404 });
  }

  // 購入が紐づいたまま消すと売上だけが宙に浮くので、先に購入を消してもらう
  if (visit.purchases.length > 0) {
    return NextResponse.json(
      {
        error: `この来店には購入記録が ${visit.purchases.length} 件あります。先に購入記録を削除してください`,
      },
      { status: 400 },
    );
  }

  // この来店から作られた会話メモも消す（来店を消したのにメモだけ残ると重複して見える）
  await prisma.customerNote.deleteMany({ where: { visitId: id } });
  await prisma.visit.delete({ where: { id } });

  if (visit.customerId) {
    await recalcCustomerStats(visit.customerId);
  }

  // 個人情報は記録しない。誰が何を消したかだけ残す
  await prisma.auditLog.create({
    data: { staffId: auth.user.id, action: "visit.delete", targetType: "Visit", targetId: id },
  });

  return NextResponse.json({ ok: true });
}
