import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { countSeats } from "@/lib/reservation";
import { recalcCustomerStats } from "@/lib/customer-stats";
import { nextCustomerCode } from "@/app/api/customers/_shared";
import { normalizeEmail, normalizePhone, trimOrNull } from "@/lib/normalize";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { formatJstDate } from "@/lib/utils/time";

/** 同一 IP からの連続作成を防ぐ（1 時間に 10 件まで） */
const RATE_LIMIT_COUNT = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * ホームページからの予約（認証不要）。
 *
 * 既存顧客は電話・メールで名寄せして紐付け、いなければ顧客を作る。
 * 予約は「仮予約」で受け、店舗が確定する運用にしている。
 */
export async function POST(request: Request) {
  if (!(await checkRateLimit(`reserve:${clientIp(request)}`, RATE_LIMIT_COUNT, RATE_LIMIT_WINDOW_MS))) {
    return NextResponse.json(
      { error: "しばらく時間をおいてからお試しください" },
      { status: 429 },
    );
  }

  const form = await request.formData();
  const sessionId = trimOrNull(form.get("sessionId"));
  const name = String(form.get("name") ?? "").trim();
  const phone = trimOrNull(form.get("phone"));
  const email = trimOrNull(form.get("email"));

  if (!sessionId) return NextResponse.json({ error: "予約枠を選んでください" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "お名前を入力してください" }, { status: 400 });
  if (!phone && !email) {
    return NextResponse.json(
      { error: "電話番号かメールアドレスのどちらかを入力してください" },
      { status: 400 },
    );
  }

  const headcount = Number(trimOrNull(form.get("headcount")) ?? "1");
  if (!Number.isInteger(headcount) || headcount < 1 || headcount > 10) {
    return NextResponse.json({ error: "人数は 1〜10 名で選んでください" }, { status: 400 });
  }

  const session = await prisma.schoolSession.findFirst({
    where: { id: sessionId, status: "OPEN", isPublished: true },
    include: { course: { select: { name: true } } },
  });
  if (!session) {
    return NextResponse.json({ error: "この予約枠は受付を終了しました" }, { status: 400 });
  }

  // 確定の直前に残席を数え直す
  const seats = await countSeats(sessionId);
  if (!seats || headcount > seats.remaining) {
    return NextResponse.json(
      { error: "満席になりました。他の日程をお選びください" },
      { status: 409 },
    );
  }

  const phoneDigits = normalizePhone(phone);
  const emailLower = normalizeEmail(email);

  // 既存顧客の名寄せ。連絡先が一致し、かつ氏名も一致する場合だけ自動で紐付ける。
  // 断定できない場合は新規として作り、統合はスタッフの判断に委ねる（企画書 4-3）。
  const candidates = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      OR: [...(phoneDigits ? [{ phoneDigits }] : []), ...(emailLower ? [{ emailLower }] : [])],
    },
    select: { id: true, name: true },
    take: 5,
  });
  const matched = candidates.find((c) => c.name.replace(/\s/g, "") === name.replace(/\s/g, ""));

  let customerId = matched?.id ?? null;
  if (!customerId) {
    const code = await nextCustomerCode();
    const created = await prisma.customer.create({
      data: {
        code,
        name,
        phone,
        phoneDigits,
        email,
        emailLower,
        note: candidates.length > 0 ? "Web 予約から登録（同じ連絡先の顧客あり・要確認）" : null,
      },
      select: { id: true },
    });
    customerId = created.id;
  }

  const reservation = await prisma.reservation.create({
    data: {
      sessionId,
      customerId,
      headcount,
      status: "TENTATIVE",
      source: "WEB",
      note: trimOrNull(form.get("note")),
    },
    select: { id: true },
  });

  await recalcCustomerStats(customerId);

  return NextResponse.json({
    reservation: {
      reservationId: reservation.id,
      courseName: session.course.name,
      date: formatJstDate(session.date),
      startTime: session.startTime,
      headcount,
    },
  });
}
