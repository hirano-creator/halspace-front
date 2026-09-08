import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { recalcCustomerStats } from "@/lib/customer-stats";
import { guestLabel } from "@/lib/display";
import { formatJstDate, formatJstTime } from "@/lib/utils/time";
import { parseVisitForm } from "./_shared";
import type { VisitListResponse } from "@/app/(app)/visits/types";

const PER_PAGE = 30;

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const purchased = url.searchParams.get("purchased") ?? "";
  const named = url.searchParams.get("named") ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);

  const where = {
    ...(purchased === "yes" ? { purchased: true } : {}),
    ...(purchased === "no" ? { purchased: false } : {}),
    ...(named === "yes" ? { customerId: { not: null } } : {}),
    ...(named === "no" ? { customerId: null } : {}),
  };

  const [total, rows, masters] = await Promise.all([
    prisma.visit.count({ where }),
    prisma.visit.findMany({
      where,
      orderBy: { visitedAt: "desc" },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        customer: { select: { id: true, name: true } },
        staff: { select: { name: true } },
        interests: { include: { category: { select: { name: true } } } },
        guests: { select: { ageGroup: true, gender: true } },
      },
    }),
    prisma.masterOption.findMany({ select: { type: true, code: true, label: true } }),
  ]);

  const labelOf = (type: string, code: string | null) =>
    code ? (masters.find((m) => m.type === type && m.code === code)?.label ?? code) : null;

  const body: VisitListResponse = {
    total,
    page,
    perPage: PER_PAGE,
    visits: rows.map((v) => ({
      id: v.id,
      date: formatJstDate(v.visitedAt),
      time: formatJstTime(v.visitedAt),
      customerId: v.customerId,
      displayName: v.customer?.name ?? guestLabel(v),
      isAnonymous: !v.customerId,
      partySize: v.partySize,
      purposeLabel: labelOf("VISIT_PURPOSE", v.purposeCode),
      channelLabel: labelOf("VISIT_CHANNEL", v.channelCode),
      purchased: v.purchased,
      noPurchaseReasonLabel: labelOf("NO_PURCHASE_REASON", v.noPurchaseReasonCode),
      interestNames: v.interests
        .map((i) => i.category?.name)
        .filter((n): n is string => Boolean(n)),
      staffName: v.staff?.name ?? null,
    })),
  };

  return NextResponse.json(body);
}

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const input = parseVisitForm(form);
  if (typeof input === "string") {
    return NextResponse.json({ error: input }, { status: 400 });
  }

  if (input.customerId) {
    const exists = await prisma.customer.findFirst({
      where: { id: input.customerId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) {
      return NextResponse.json({ error: "顧客が見つかりません" }, { status: 400 });
    }
  }

  // 新規／リピーターの分析用に、来店時点の事実として保存しておく
  const isFirstVisit = input.customerId
    ? (await prisma.visit.count({ where: { customerId: input.customerId } })) === 0
    : false;

  const visit = await prisma.visit.create({
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
      isFirstVisit,
      staffId: auth.user.id,
      interests: {
        create: input.interestCategoryIds.map((categoryId) => ({ categoryId })),
      },
      guests: {
        create: input.guestBreakdown.map((g) => ({ ageGroup: g.ageGroup, gender: g.gender })),
      },
    },
    select: { id: true, customerId: true },
  });

  // 会話メモは顧客カルテの「会話メモ」にも残す
  if (input.customerId && input.conversation) {
    await prisma.customerNote.create({
      data: {
        customerId: input.customerId,
        visitId: visit.id,
        body: input.conversation,
        staffId: auth.user.id,
      },
    });
  }

  // フォロー予定日が入っていれば、そのままフォロー予定を作る
  if (input.customerId && input.followUpDate) {
    await prisma.followUp.create({
      data: {
        customerId: input.customerId,
        visitId: visit.id,
        content: input.nextProposal ?? "来店時のフォロー",
        dueDate: input.followUpDate,
        assigneeId: auth.user.id,
        status: "PENDING",
      },
    });
  }

  if (visit.customerId) {
    await recalcCustomerStats(visit.customerId);
  }

  return NextResponse.json({ visit: { id: visit.id, customerId: visit.customerId } });
}
