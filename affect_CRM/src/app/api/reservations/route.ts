import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { countSeats } from "@/lib/reservation";
import { RESERVATION_SOURCES, toEnum } from "@/lib/constants";
import { trimOrNull } from "@/lib/normalize";

/** 店舗側からの予約登録 */
export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const sessionId = trimOrNull(form.get("sessionId"));
  const customerId = trimOrNull(form.get("customerId"));
  if (!sessionId) return NextResponse.json({ error: "予約枠を選んでください" }, { status: 400 });
  if (!customerId) return NextResponse.json({ error: "顧客を選んでください" }, { status: 400 });

  const headcount = Number(trimOrNull(form.get("headcount")) ?? "1");
  if (!Number.isInteger(headcount) || headcount < 1 || headcount > 20) {
    return NextResponse.json({ error: "人数は 1〜20 の数字で入力してください" }, { status: 400 });
  }

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true },
  });
  if (!customer) return NextResponse.json({ error: "顧客が見つかりません" }, { status: 400 });

  // 確定の直前に残席を数え直す（D1 では厳密なロックが取れないため）
  const seats = await countSeats(sessionId);
  if (!seats) return NextResponse.json({ error: "予約枠が見つかりません" }, { status: 400 });
  if (headcount > seats.remaining) {
    return NextResponse.json(
      { error: `残り ${seats.remaining} 名です。人数を調整してください` },
      { status: 409 },
    );
  }

  const reservation = await prisma.reservation.create({
    data: {
      sessionId,
      customerId,
      headcount,
      status: form.get("status") === "TENTATIVE" ? "TENTATIVE" : "CONFIRMED",
      source: toEnum(RESERVATION_SOURCES, form.get("source")) ?? "STAFF",
      staffId: auth.user.id,
      note: trimOrNull(form.get("note")),
    },
    select: { id: true },
  });

  return NextResponse.json({ reservation });
}
