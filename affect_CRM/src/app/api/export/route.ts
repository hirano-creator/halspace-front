import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { can } from "@/lib/auth/roles";
import { csvResponse } from "@/lib/csv";
import { resolvePeriod } from "@/lib/analytics-period";
import { guestLabel } from "@/lib/display";
import {
  AGE_GROUP_LABELS,
  FOLLOW_UP_STATUS_LABELS,
  GENDER_LABELS,
  RESERVATION_STATUS_LABELS,
  type AgeGroup,
  type FollowUpStatus,
  type Gender,
  type ReservationStatus,
} from "@/lib/constants";
import { calcAge, formatJstDate, formatJstDateTime } from "@/lib/utils/time";

/** 個人情報（氏名・連絡先）を含む出力は管理者のみ */
const PERSONAL_TYPES = new Set(["customers", "visits", "purchases", "reservations", "follow-ups"]);

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "";
  const period = resolvePeriod(
    url.searchParams.get("period") ?? "month",
    url.searchParams.get("from"),
    url.searchParams.get("to"),
  );
  const range = { gte: period.start, lt: period.end };
  const stamp = formatJstDate(period.start);

  if (PERSONAL_TYPES.has(type) && !can(auth.user.role, "export.personal")) {
    return NextResponse.json(
      { error: "この出力は管理者のみ可能です" },
      { status: 403 },
    );
  }

  // 誰が何を出したかを記録する（顧客情報の持ち出しになるため）
  const audit = () =>
    prisma.auditLog.create({
      data: { staffId: auth.user.id, action: "export.csv", targetType: type, detail: period.key },
    });

  const masters = await prisma.masterOption.findMany({ select: { type: true, code: true, label: true } });
  const labelOf = (t: string, code: string | null) =>
    code ? (masters.find((m) => m.type === t && m.code === code)?.label ?? code) : "";

  switch (type) {
    case "customers": {
      const rows = await prisma.customer.findMany({
        where: { deletedAt: null },
        orderBy: { code: "asc" },
        include: { tags: { include: { tag: { select: { name: true } } } } },
      });
      await audit();
      return csvResponse(
        [
          [
            "顧客番号", "氏名", "フリガナ", "性別", "年齢", "電話番号", "メールアドレス",
            "都道府県", "市区町村", "顧客ランク", "タグ", "来店回数", "最終来店日",
            "累計購入金額", "購入回数", "最終購入日", "スクール参加回数", "登録日",
          ],
          ...rows.map((c) => [
            c.code,
            c.name,
            c.nameKana,
            c.gender ? (GENDER_LABELS[c.gender as Gender] ?? c.gender) : "",
            calcAge(c.birthday) ?? "",
            c.phone,
            c.email,
            c.prefecture,
            c.city,
            labelOf("CUSTOMER_RANK", c.rank),
            c.tags.map((t) => t.tag.name).join("・"),
            c.visitCount,
            c.lastVisitAt ? formatJstDate(c.lastVisitAt) : "",
            c.purchaseTotal,
            c.purchaseCount,
            c.lastPurchaseAt ? formatJstDate(c.lastPurchaseAt) : "",
            c.schoolCount,
            formatJstDate(c.createdAt),
          ]),
        ],
        `affect_customers_${stamp}.csv`,
      );
    }

    case "visits": {
      const rows = await prisma.visit.findMany({
        where: { visitedAt: range },
        orderBy: { visitedAt: "asc" },
        include: {
          customer: { select: { code: true, name: true, gender: true, birthday: true, prefecture: true } },
          staff: { select: { name: true } },
          interests: { include: { category: { select: { name: true } } } },
          guests: { select: { ageGroup: true, gender: true } },
        },
      });
      await audit();
      return csvResponse(
        [
          [
            "来店日時", "顧客番号", "顧客名", "お名前判明", "性別", "年代", "年代・性別の内訳",
            "都道府県", "人数", "来店目的", "来店経路", "何を見て来たか", "興味商品", "購入",
            "未購入理由", "未購入コメント", "会話内容", "次回提案", "担当",
          ],
          ...rows.map((v) => {
            const age = calcAge(v.customer?.birthday ?? null);
            const ageGroup = v.customerId
              ? age != null
                ? `${Math.floor(age / 10) * 10}代`
                : ""
              : v.guestAgeGroup
                ? (AGE_GROUP_LABELS[v.guestAgeGroup as AgeGroup] ?? "")
                : "";
            const gender = v.customer?.gender ?? v.guestGender;
            // グループ内訳（VisitGuest）を分けて登録した匿名来店のときだけ埋まる
            const breakdown = v.guests
              .map((g) => {
                const a = g.ageGroup ? (AGE_GROUP_LABELS[g.ageGroup as AgeGroup] ?? "") : "";
                const s = g.gender ? (GENDER_LABELS[g.gender as Gender] ?? "") : "";
                return [a, s].filter(Boolean).join("");
              })
              .filter(Boolean)
              .join("、");
            return [
              formatJstDateTime(v.visitedAt),
              v.customer?.code ?? "",
              v.customer?.name ?? guestLabel(v),
              v.customerId ? "あり" : "不明",
              gender ? (GENDER_LABELS[gender as Gender] ?? gender) : "",
              ageGroup,
              breakdown,
              v.customer?.prefecture ?? "",
              v.partySize,
              labelOf("VISIT_PURPOSE", v.purposeCode),
              labelOf("VISIT_CHANNEL", v.channelCode),
              labelOf("REFERRER", v.referrerCode),
              v.interests.map((i) => i.category?.name).filter(Boolean).join("・"),
              v.purchased ? "購入" : "未購入",
              labelOf("NO_PURCHASE_REASON", v.noPurchaseReasonCode),
              v.noPurchaseComment,
              v.conversation,
              v.nextProposal,
              v.staff?.name ?? "",
            ];
          }),
        ],
        `affect_visits_${stamp}.csv`,
      );
    }

    case "purchases": {
      const rows = await prisma.purchase.findMany({
        where: { purchasedAt: range },
        orderBy: { purchasedAt: "asc" },
        include: {
          customer: { select: { code: true, name: true } },
          staff: { select: { name: true } },
          items: { include: { category: { select: { name: true } } } },
        },
      });
      await audit();
      // 明細 1 行 = CSV 1 行にする（表計算で集計しやすいため）
      return csvResponse(
        [
          ["購入日", "顧客番号", "顧客名", "商品名", "カテゴリー", "サイズ", "単価", "数量", "小計", "購入合計", "担当", "備考"],
          ...rows.flatMap((p) =>
            p.items.map((i) => [
              formatJstDate(p.purchasedAt),
              p.customer.code,
              p.customer.name,
              i.productName,
              i.category?.name ?? "",
              i.size,
              i.unitPrice,
              i.quantity,
              i.subtotal,
              p.totalAmount,
              p.staff?.name ?? "",
              p.note,
            ]),
          ),
        ],
        `affect_purchases_${stamp}.csv`,
      );
    }

    case "schools": {
      const rows = await prisma.schoolAttendance.findMany({
        where: { attendedAt: range },
        orderBy: { attendedAt: "asc" },
        include: {
          customer: { select: { code: true, name: true } },
          course: { select: { name: true } },
          staff: { select: { name: true } },
        },
      });
      await audit();
      return csvResponse(
        [
          [
            "参加日", "顧客番号", "顧客名", "コース", "担当", "レベル",
            "パドル", "テイクオフ", "波選び", "ライディング", "総合", "コメント", "次回おすすめ",
          ],
          ...rows.map((a) => [
            formatJstDate(a.attendedAt),
            a.customer.code,
            a.customer.name,
            a.course?.name ?? "",
            a.staff?.name ?? "",
            labelOf("SURF_LEVEL", a.surfLevel),
            a.evalPaddle ?? "",
            a.evalTakeoff ?? "",
            a.evalWaveSelection ?? "",
            a.evalRiding ?? "",
            a.evalTotal ?? "",
            a.comment,
            a.nextRecommendation,
          ]),
        ],
        `affect_schools_${stamp}.csv`,
      );
    }

    case "reservations": {
      const rows = await prisma.reservation.findMany({
        where: { session: { date: range } },
        orderBy: { createdAt: "asc" },
        include: {
          customer: { select: { code: true, name: true, phone: true } },
          session: { include: { course: { select: { name: true } }, staff: { select: { name: true } } } },
        },
      });
      await audit();
      return csvResponse(
        [
          ["開催日", "開始", "終了", "コース", "顧客番号", "顧客名", "電話番号", "人数", "ステータス", "予約経路", "担当", "備考"],
          ...rows.map((r) => [
            formatJstDate(r.session.date),
            r.session.startTime,
            r.session.endTime,
            r.session.course.name,
            r.customer.code,
            r.customer.name,
            r.customer.phone,
            r.headcount,
            RESERVATION_STATUS_LABELS[r.status as ReservationStatus] ?? r.status,
            r.source === "WEB" ? "ホームページ" : r.source === "PHONE" ? "電話" : "店舗",
            r.session.staff?.name ?? "",
            r.note,
          ]),
        ],
        `affect_reservations_${stamp}.csv`,
      );
    }

    case "follow-ups": {
      const rows = await prisma.followUp.findMany({
        where: { dueDate: range },
        orderBy: { dueDate: "asc" },
        include: {
          customer: { select: { code: true, name: true, phone: true } },
          assignee: { select: { name: true } },
        },
      });
      await audit();
      return csvResponse(
        [
          ["予定日", "顧客番号", "顧客名", "電話番号", "フォロー内容", "ステータス", "担当", "メモ", "完了日"],
          ...rows.map((f) => [
            formatJstDate(f.dueDate),
            f.customer.code,
            f.customer.name,
            f.customer.phone,
            f.content,
            FOLLOW_UP_STATUS_LABELS[f.status as FollowUpStatus] ?? f.status,
            f.assignee?.name ?? "",
            f.memo,
            f.completedAt ? formatJstDate(f.completedAt) : "",
          ]),
        ],
        `affect_followups_${stamp}.csv`,
      );
    }

    default:
      return NextResponse.json({ error: "出力する種類を指定してください" }, { status: 400 });
  }
}
