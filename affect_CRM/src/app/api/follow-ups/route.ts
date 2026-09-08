import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { FOLLOW_UP_STATUSES, toEnum } from "@/lib/constants";
import { trimOrNull } from "@/lib/normalize";
import { endOfJstDay, formatJstDate, parseJstDateTime, startOfJstDay } from "@/lib/utils/time";
import type { FollowUpListResponse } from "@/app/(app)/follow-ups/types";

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "open";
  const assigneeId = url.searchParams.get("assigneeId") ?? "";
  const scope = url.searchParams.get("scope") ?? "";

  const today = startOfJstDay(new Date());
  const todayEnd = endOfJstDay(new Date());

  const where = {
    ...(status === "open"
      ? { status: { in: ["PENDING", "IN_PROGRESS"] } }
      : status && status !== "all"
        ? { status }
        : {}),
    ...(assigneeId ? { assigneeId } : {}),
    // 「今日まで」＝期限切れを含む、対応すべきもの
    ...(scope === "today" ? { dueDate: { lt: todayEnd } } : {}),
  };

  const [rows, staffs] = await Promise.all([
    prisma.followUp.findMany({
      where,
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      take: 100,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        assignee: { select: { id: true, name: true } },
        visit: { select: { noPurchaseReasonCode: true } },
      },
    }),
    prisma.staff.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const body: FollowUpListResponse = {
    followUps: rows.map((f) => ({
      id: f.id,
      customerId: f.customer.id,
      customerName: f.customer.name,
      customerPhone: f.customer.phone,
      content: f.content,
      dueDate: formatJstDate(f.dueDate),
      overdue: f.dueDate < today && (f.status === "PENDING" || f.status === "IN_PROGRESS"),
      status: f.status,
      memo: f.memo,
      assigneeId: f.assignee?.id ?? null,
      assigneeName: f.assignee?.name ?? null,
    })),
    staffs,
  };

  return NextResponse.json(body);
}

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const customerId = trimOrNull(form.get("customerId"));
  if (!customerId) return NextResponse.json({ error: "顧客を選んでください" }, { status: 400 });

  const content = String(form.get("content") ?? "").trim();
  if (!content) return NextResponse.json({ error: "フォロー内容を入力してください" }, { status: 400 });

  const dueRaw = trimOrNull(form.get("dueDate"));
  const dueDate = dueRaw ? parseJstDateTime(dueRaw) : null;
  if (!dueDate) {
    return NextResponse.json({ error: "フォロー予定日を選んでください" }, { status: 400 });
  }

  const followUp = await prisma.followUp.create({
    data: {
      customerId,
      content,
      dueDate,
      assigneeId: trimOrNull(form.get("assigneeId")) ?? auth.user.id,
      status: toEnum(FOLLOW_UP_STATUSES, form.get("status")) ?? "PENDING",
      memo: trimOrNull(form.get("memo")),
    },
    select: { id: true },
  });

  return NextResponse.json({ followUp });
}
