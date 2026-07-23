// 修正申請一覧の取得API（GET、管理者・店長のみ。店長は自部署の申請のみ）
// 旧 corrections/page.tsx（Server Component）が行っていたデータ取得をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { visibleUsersWhere } from "@/lib/attendance/service";
import type { ReviewRow } from "@/app/(app)/corrections/review-list";
import type { CorrectionsPageResponse, ResolvedRow } from "@/app/(app)/corrections/types";
import { formatDateTime } from "./_shared";

export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "editAttendance");
  if (!auth.ok) return auth.response;
  const viewer = auth.user;

  const [pending, resolved] = await Promise.all([
    prisma.correctionRequest.findMany({
      where: { status: "PENDING", user: visibleUsersWhere(viewer) },
      include: { user: { include: { department: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.correctionRequest.findMany({
      where: { status: { not: "PENDING" }, user: visibleUsersWhere(viewer) },
      include: { user: { include: { department: true } }, reviewedBy: true },
      orderBy: { reviewedAt: "desc" },
      take: 20,
    }),
  ]);

  const currents =
    pending.length === 0
      ? []
      : await prisma.attendance.findMany({
          where: { OR: pending.map((r) => ({ userId: r.userId, date: r.date })) },
        });
  const currentByKey = new Map(currents.map((a) => [`${a.userId}:${a.date}`, a]));

  const pendingRows: ReviewRow[] = pending.map((r) => {
    const current = currentByKey.get(`${r.userId}:${r.date}`);
    return {
      id: r.id,
      userName: r.user.name,
      employeeCode: r.user.employeeCode,
      departmentName: r.user.department?.name ?? null,
      date: r.date,
      clockIn: r.clockIn,
      clockOut: r.clockOut,
      breakMinutes: r.breakMinutes,
      reason: r.reason,
      createdAt: formatDateTime(r.createdAt),
      current: current
        ? { clockIn: current.clockIn, clockOut: current.clockOut, breakMinutes: current.breakMinutes }
        : null,
    };
  });

  const resolvedRows: ResolvedRow[] = resolved.map((r) => ({
    id: r.id,
    userName: r.user.name,
    date: r.date,
    clockIn: r.clockIn,
    clockOut: r.clockOut,
    breakMinutes: r.breakMinutes,
    status: r.status,
    reviewedByName: r.reviewedBy?.name ?? null,
    reviewedAtLabel: r.reviewedAt ? formatDateTime(r.reviewedAt) : null,
    reviewNote: r.reviewNote,
  }));

  const body: CorrectionsPageResponse = { pending: pendingRows, resolved: resolvedRows };
  return NextResponse.json(body);
}
