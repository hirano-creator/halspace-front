import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { calcAge } from "@/lib/utils/time";
import type { CustomerDetailResponse } from "@/app/(app)/customers/types";

type Ctx = { params: Promise<{ id: string }> };

/** 顧客カルテ用。ヘッダーと各タブの中身をまとめて返す */
export async function GET(request: Request, { params }: Ctx) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const customer = await prisma.customer.findFirst({
    where: { id, deletedAt: null },
    include: {
      surfProfile: true,
      tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
    },
  });
  if (!customer) {
    return NextResponse.json({ error: "顧客が見つかりません" }, { status: 404 });
  }

  const [visits, purchases, followUps, notes, attendances, reservations, masters, categories] =
    await Promise.all([
      prisma.visit.findMany({
        where: { customerId: id },
        orderBy: { visitedAt: "desc" },
        include: {
          staff: { select: { name: true } },
          interests: { include: { category: { select: { name: true } }, product: { select: { name: true } } } },
        },
      }),
      prisma.purchase.findMany({
        where: { customerId: id },
        orderBy: { purchasedAt: "desc" },
        include: { staff: { select: { name: true } }, items: true },
      }),
      prisma.followUp.findMany({
        where: { customerId: id },
        orderBy: { dueDate: "desc" },
        include: { assignee: { select: { name: true } } },
      }),
      prisma.customerNote.findMany({
        where: { customerId: id },
        orderBy: { createdAt: "desc" },
        include: { staff: { select: { name: true } } },
      }),
      prisma.schoolAttendance.findMany({
        where: { customerId: id },
        orderBy: { attendedAt: "desc" },
        include: { course: { select: { name: true } } },
      }),
      prisma.reservation.findMany({
        where: { customerId: id },
        orderBy: { createdAt: "desc" },
        include: { session: { include: { course: { select: { name: true } } } } },
      }),
      prisma.masterOption.findMany({ select: { type: true, code: true, label: true } }),
      prisma.productCategory.findMany({ select: { id: true, name: true } }),
    ]);

  const labelOf = (type: string, code: string | null) =>
    code ? (masters.find((m) => m.type === type && m.code === code)?.label ?? code) : null;

  const surf = customer.surfProfile;
  const interestedIds = surf?.interestedCategories?.split(",").filter(Boolean) ?? [];

  const body: CustomerDetailResponse = {
    header: {
      id: customer.id,
      code: customer.code,
      name: customer.name,
      nameKana: customer.nameKana,
      nickname: customer.nickname,
      gender: customer.gender,
      age: calcAge(customer.birthday),
      birthday: customer.birthday?.toISOString() ?? null,
      phone: customer.phone,
      email: customer.email,
      prefecture: customer.prefecture,
      city: customer.city,
      addressLine: customer.addressLine,
      lineId: customer.lineId,
      instagram: customer.instagram,
      rank: customer.rank,
      rankLabel: labelOf("CUSTOMER_RANK", customer.rank),
      note: customer.note,
      visitCount: customer.visitCount,
      lastVisitAt: customer.lastVisitAt?.toISOString() ?? null,
      purchaseTotal: customer.purchaseTotal,
      purchaseCount: customer.purchaseCount,
      lastPurchaseAt: customer.lastPurchaseAt?.toISOString() ?? null,
      schoolCount: customer.schoolCount,
      tags: customer.tags.map((t) => t.tag),
      surf: surf
        ? {
            experienceYears: surf.experienceYears,
            levelLabel: labelOf("SURF_LEVEL", surf.level),
            boardTypeLabel: labelOf("BOARD_TYPE", surf.boardType),
            boardSize: surf.boardSize,
            wetsuitSizeLabel: labelOf("WETSUIT_SIZE", surf.wetsuitSize),
            favoritePoints: surf.favoritePoints,
            frequencyLabel: labelOf("SURF_FREQUENCY", surf.frequency),
            interestedCategoryNames: interestedIds
              .map((cid) => categories.find((c) => c.id === cid)?.name)
              .filter((n): n is string => Boolean(n)),
          }
        : null,
    },
    visits: visits.map((v) => ({
      id: v.id,
      visitedAt: v.visitedAt.toISOString(),
      purposeLabel: labelOf("VISIT_PURPOSE", v.purposeCode),
      channelLabel: labelOf("VISIT_CHANNEL", v.channelCode),
      purchased: v.purchased,
      noPurchaseReasonLabel: labelOf("NO_PURCHASE_REASON", v.noPurchaseReasonCode),
      noPurchaseComment: v.noPurchaseComment,
      interestNames: v.interests
        .map((i) => i.product?.name ?? i.category?.name)
        .filter((n): n is string => Boolean(n)),
      conversation: v.conversation,
      nextProposal: v.nextProposal,
      staffName: v.staff?.name ?? null,
    })),
    purchases: purchases.map((p) => ({
      id: p.id,
      purchasedAt: p.purchasedAt.toISOString(),
      totalAmount: p.totalAmount,
      items: p.items.map((i) => ({
        productName: i.productName,
        size: i.size,
        quantity: i.quantity,
        subtotal: i.subtotal,
      })),
      staffName: p.staff?.name ?? null,
    })),
    followUps: followUps.map((f) => ({
      id: f.id,
      content: f.content,
      dueDate: f.dueDate.toISOString(),
      status: f.status,
      memo: f.memo,
      assigneeName: f.assignee?.name ?? null,
    })),
    notes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      staffName: n.staff?.name ?? null,
    })),
    schools: attendances.map((a) => ({
      id: a.id,
      attendedAt: a.attendedAt.toISOString(),
      courseName: a.course?.name ?? null,
      evalTotal: a.evalTotal,
    })),
    reservations: reservations.map((r) => ({
      id: r.id,
      date: r.session.date.toISOString(),
      startTime: r.session.startTime,
      courseName: r.session.course.name,
      status: r.status,
    })),
  };

  return NextResponse.json(body);
}
