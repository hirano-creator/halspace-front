import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { recalcCustomerStats } from "@/lib/customer-stats";
import { trimOrNull } from "@/lib/normalize";
import { formatJstDate, parseJstDateTime } from "@/lib/utils/time";
import type { AttendanceListResponse } from "@/app/(app)/schools/attendances/types";

/** 参加履歴の一覧（新しい順） */
export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const rows = await prisma.schoolAttendance.findMany({
    orderBy: { attendedAt: "desc" },
    take: 50,
    include: {
      customer: { select: { id: true, name: true } },
      course: { select: { name: true } },
      staff: { select: { name: true } },
    },
  });

  const body: AttendanceListResponse = {
    attendances: rows.map((a) => ({
      id: a.id,
      customerId: a.customer.id,
      customerName: a.customer.name,
      courseName: a.course?.name ?? null,
      attendedAt: formatJstDate(a.attendedAt),
      staffName: a.staff?.name ?? null,
      evalPaddle: a.evalPaddle,
      evalTakeoff: a.evalTakeoff,
      evalWaveSelection: a.evalWaveSelection,
      evalRiding: a.evalRiding,
      evalTotal: a.evalTotal,
      comment: a.comment,
      nextRecommendation: a.nextRecommendation,
      hasEvaluation: a.evalTotal != null,
    })),
  };

  return NextResponse.json(body);
}

const evalValue = (form: FormData, key: string): number | null => {
  const raw = trimOrNull(form.get(key));
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
};

/** 参加結果の登録（予約から自動生成された履歴に評価を追記する場合もここを使う） */
export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const attendanceId = trimOrNull(form.get("attendanceId"));

  const data = {
    surfLevel: trimOrNull(form.get("surfLevel")),
    evalPaddle: evalValue(form, "evalPaddle"),
    evalTakeoff: evalValue(form, "evalTakeoff"),
    evalWaveSelection: evalValue(form, "evalWaveSelection"),
    evalRiding: evalValue(form, "evalRiding"),
    evalTotal: evalValue(form, "evalTotal"),
    comment: trimOrNull(form.get("comment")),
    nextRecommendation: trimOrNull(form.get("nextRecommendation")),
    staffId: auth.user.id,
  };

  // 既存の参加履歴に評価を書き足す
  if (attendanceId) {
    await prisma.schoolAttendance.update({ where: { id: attendanceId }, data });
    return NextResponse.json({ ok: true });
  }

  // 予約を通さずに参加履歴を直接作る場合
  const customerId = trimOrNull(form.get("customerId"));
  if (!customerId) return NextResponse.json({ error: "顧客を選んでください" }, { status: 400 });

  const attendedAtRaw = trimOrNull(form.get("attendedAt"));
  const attendedAt = attendedAtRaw ? parseJstDateTime(attendedAtRaw) : new Date();
  if (!attendedAt) {
    return NextResponse.json({ error: "参加日は「2026-09-05」の形式で入力してください" }, { status: 400 });
  }

  const attendance = await prisma.schoolAttendance.create({
    data: {
      ...data,
      customerId,
      courseId: trimOrNull(form.get("courseId")),
      attendedAt,
    },
    select: { id: true },
  });

  await recalcCustomerStats(customerId);

  return NextResponse.json({ attendance });
}
