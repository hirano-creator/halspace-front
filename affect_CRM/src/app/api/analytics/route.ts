import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { resolvePeriod } from "@/lib/analytics-period";
import { guestLabel } from "@/lib/display";
import {
  AGE_GROUPS,
  AGE_GROUP_LABELS,
  GENDER_LABELS,
  type AgeGroup,
  type Gender,
} from "@/lib/constants";
import {
  ageToGroup,
  calcAge,
  endOfJstDay,
  formatJstDate,
  jstHour,
  jstWeekday,
} from "@/lib/utils/time";
import { splitChannelCodes } from "@/lib/visit-channel";
import type {
  AmountBucket,
  AnalyticsResponse,
  Bucket,
  HourBucket,
  RateBucket,
  WeekdayAmountBucket,
  WeekdayBucket,
} from "@/app/(app)/analytics/types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 件数を数えて多い順に並べる */
function tally(values: (string | null)[], labelOf?: (v: string) => string): Bucket[] {
  const map = new Map<string, number>();
  for (const v of values) {
    const key = v ?? "未設定";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label: labelOf && label !== "未設定" ? labelOf(label) : label, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 年代別は件数順ではなく若い順に並べる（縦棒グラフで年代の並びを読めるようにする）。
 * 不明・未設定はラベルの一覧に無いので末尾に回る。
 */
const AGE_ORDER = AGE_GROUPS.map((g) => AGE_GROUP_LABELS[g]);
function sortByAgeOrder<T extends { label: string }>(rows: T[]): T[] {
  const indexOf = (label: string) => {
    const i = AGE_ORDER.indexOf(label);
    return i === -1 ? AGE_ORDER.length : i;
  };
  return [...rows].sort((a, b) => indexOf(a.label) - indexOf(b.label));
}

/** 時間帯別（24 要素）と曜日別（7 要素）、曜日×時間帯の格子。日時は必ず JST に直してから数える */
function tallyByTime(dates: Date[]): {
  byHour: HourBucket[];
  byWeekday: number[];
  byWeekdayHour: number[][];
} {
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  const byWeekday = Array.from({ length: 7 }, () => 0);
  const byWeekdayHour = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const d of dates) {
    const h = jstHour(d);
    const w = jstWeekday(d);
    byHour[h].count += 1;
    byWeekday[w] += 1;
    byWeekdayHour[w][h] += 1;
  }
  return { byHour, byWeekday, byWeekdayHour };
}

/**
 * 期間内に各曜日が何日あるか（「今月」「今年」のように未来を含む期間は今日まで）。
 * 曜日別の 1 日平均を出す分母にする。期間の開始は常に JST の 0:00 なので 1 日ずつ進めてよい。
 */
function countWeekdaysInPeriod(start: Date, end: Date, now: Date): number[] {
  const days = Array.from({ length: 7 }, () => 0);
  const last = Math.min(end.getTime(), endOfJstDay(now).getTime());
  for (let t = start.getTime(); t < last; t += DAY_MS) {
    days[jstWeekday(new Date(t))] += 1;
  }
  return days;
}

/** 分母と該当数から率を出す */
function rate(hit: number, total: number): number {
  return total === 0 ? 0 : Math.round((hit / total) * 100);
}

function rateBy(
  rows: { key: string | null; hit: boolean }[],
  labelOf?: (v: string) => string,
): RateBucket[] {
  const map = new Map<string, { total: number; hit: number }>();
  for (const r of rows) {
    const key = r.key ?? "未設定";
    const cur = map.get(key) ?? { total: 0, hit: 0 };
    cur.total += 1;
    if (r.hit) cur.hit += 1;
    map.set(key, cur);
  }
  return [...map.entries()]
    .map(([key, v]) => ({
      label: labelOf && key !== "未設定" ? labelOf(key) : key,
      total: v.total,
      hit: v.hit,
      rate: rate(v.hit, v.total),
    }))
    .sort((a, b) => b.total - a.total);
}

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const period = resolvePeriod(
    url.searchParams.get("period") ?? "month",
    url.searchParams.get("from"),
    url.searchParams.get("to"),
  );
  const range = { gte: period.start, lt: period.end };

  const [visits, purchases, attendances, reservations, sessions, masters] = await Promise.all([
    prisma.visit.findMany({
      where: { visitedAt: range },
      include: {
        customer: {
          select: { id: true, name: true, gender: true, birthday: true, prefecture: true, phone: true },
        },
        interests: { include: { category: { select: { name: true } } } },
        guests: { select: { ageGroup: true, gender: true } },
      },
    }),
    prisma.purchase.findMany({
      where: { purchasedAt: range },
      include: {
        items: { include: { category: { select: { name: true } } } },
      },
    }),
    prisma.schoolAttendance.findMany({
      where: { attendedAt: range },
      include: {
        course: { select: { name: true } },
        staff: { select: { name: true } },
      },
    }),
    prisma.reservation.findMany({
      where: { session: { date: range } },
      select: { status: true, headcount: true, customerId: true },
    }),
    prisma.schoolSession.findMany({
      where: { date: range },
      select: { id: true, capacity: true },
    }),
    prisma.masterOption.findMany({ select: { type: true, code: true, label: true } }),
  ]);

  const labelOf = (type: string) => (code: string) =>
    masters.find((m) => m.type === type && m.code === code)?.label ?? code;

  // 年代は来店時に入力したもの（年代・年齢）を優先し、無ければ顧客の生年月日から求める。
  // 来店時の入力はその時点の事実なので、生年月日からの現在年齢より正確に「来店した年代」を表す。
  const visitAgeGroup = (v: (typeof visits)[number]): string | null => {
    if (v.guestAgeGroup) return v.guestAgeGroup;
    if (!v.customerId || !v.customer?.birthday) return null;
    return ageToGroup(calcAge(v.customer.birthday));
  };

  // --- 来店 -------------------------------------------------------
  // 匿名来店も必ず含める。性別は顧客がいれば顧客側、いなければ来店時の推定値を使う。
  const visitRows = visits.map((v) => {
    return {
      id: v.id,
      customerId: v.customerId,
      name: v.customer?.name ?? guestLabel(v),
      phone: v.customer?.phone ?? null,
      visitedAt: v.visitedAt,
      isNamed: !!v.customerId,
      isFirstVisit: v.isFirstVisit,
      gender: (v.customer?.gender ?? v.guestGender ?? null) as string | null,
      ageGroup: visitAgeGroup(v),
      prefecture: v.customer?.prefecture ?? null,
      purposeCode: v.purposeCode,
      channelCodes: splitChannelCodes(v.channelCode),
      referrerCode: v.referrerCode,
      purchased: v.purchased,
      noPurchaseReasonCode: v.noPurchaseReasonCode,
      noPurchaseComment: v.noPurchaseComment,
      interestNames: v.interests
        .map((i) => i.category?.name)
        .filter((n): n is string => Boolean(n)),
    };
  });

  const total = visitRows.length;
  const named = visitRows.filter((v) => v.isNamed).length;

  // いつ来店が多いか（時間帯・曜日）。スタッフの配置を決める材料になる
  const visitTime = tallyByTime(visitRows.map((v) => v.visitedAt));
  const weekdayDays = countWeekdaysInPeriod(period.start, period.end, new Date());
  const byWeekday: WeekdayBucket[] = visitTime.byWeekday.map((count, weekday) => ({
    weekday,
    count,
    days: weekdayDays[weekday],
  }));

  // 来店経路は複数選べるので、経路別の集計は「来店 × 選んだ経路」を 1 件として数える。
  // （2 経路選んだ来店は両方の経路に 1 件ずつ入る。未選択は「未設定」1 件）
  const byChannelRows = visitRows.flatMap((v) =>
    (v.channelCodes.length ? v.channelCodes : [null]).map((channelCode) => ({
      channelCode,
      purchased: v.purchased,
    })),
  );

  const genderLabel = (code: string) => GENDER_LABELS[code as Gender] ?? code;
  const ageLabel = (code: string) => AGE_GROUP_LABELS[code as AgeGroup] ?? code;

  // 男女比・年代別は「来店（組）」ではなく「人」を単位にする。
  // 内訳（VisitGuest）があればそれを使い、なければ次のルールで数える。
  //   - 匿名グループ：代表の年代・性別を人数分（partySize）として数える
  //     （グループの内訳を分けなかった＝同質とみなす、という運用上の約束）
  //   - 名前がわかる来店：本人 1 人分だけを数える
  //     （同伴者の年代・性別は実際には分からないため、水増ししない）
  const guestCounts: { ageGroup: string | null; gender: string | null }[] = visits.flatMap((v) => {
    if (v.guests.length > 0) {
      return v.guests.map((g) => ({ ageGroup: g.ageGroup, gender: g.gender }));
    }
    if (v.customerId) {
      return [{ ageGroup: visitAgeGroup(v), gender: v.customer?.gender ?? null }];
    }
    return Array.from({ length: v.partySize }, () => ({
      ageGroup: v.guestAgeGroup,
      gender: v.guestGender,
    }));
  });

  // --- 購入 -------------------------------------------------------
  const purchasedVisits = visitRows.filter((v) => v.purchased).length;
  const sales = purchases.reduce((s, p) => s + p.totalAmount, 0);

  const categoryMap = new Map<string, { amount: number; count: number }>();
  const productMap = new Map<string, { amount: number; count: number }>();
  for (const p of purchases) {
    for (const i of p.items) {
      const c = i.category?.name ?? "未分類";
      const cur = categoryMap.get(c) ?? { amount: 0, count: 0 };
      categoryMap.set(c, { amount: cur.amount + i.subtotal, count: cur.count + i.quantity });

      const cur2 = productMap.get(i.productName) ?? { amount: 0, count: 0 };
      productMap.set(i.productName, { amount: cur2.amount + i.subtotal, count: cur2.count + i.quantity });
    }
  }
  const toAmountBuckets = (m: Map<string, { amount: number; count: number }>): AmountBucket[] =>
    [...m.entries()]
      .map(([label, v]) => ({ label, amount: v.amount, count: v.count }))
      .sort((a, b) => b.amount - a.amount);

  // 曜日別の売上（購入日時ベース）
  const salesByWeekday: WeekdayAmountBucket[] = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    amount: 0,
    count: 0,
  }));
  for (const p of purchases) {
    const w = jstWeekday(p.purchasedAt);
    salesByWeekday[w].amount += p.totalAmount;
    salesByWeekday[w].count += 1;
  }

  // --- 未購入 -----------------------------------------------------
  const noPurchaseRows = visitRows.filter((v) => !v.purchased);
  // 「検討中」で帰られた方をワンクリックで出せるようにする（このシステムの肝）
  const considering = noPurchaseRows
    .filter((v) => v.noPurchaseReasonCode === "CONSIDERING")
    .sort((a, b) => b.visitedAt.getTime() - a.visitedAt.getTime())
    .slice(0, 50)
    .map((v) => ({
      visitId: v.id,
      customerId: v.customerId,
      name: v.name,
      visitedAt: formatJstDate(v.visitedAt),
      interestNames: v.interestNames,
      comment: v.noPurchaseComment,
      phone: v.phone,
    }));

  // --- スクール ---------------------------------------------------
  const attendeeCustomerIds = attendances.map((a) => a.customerId);
  // 期間より前に参加したことがある人を「リピーター」とする
  const pastAttendees =
    attendeeCustomerIds.length === 0
      ? []
      : await prisma.schoolAttendance.findMany({
          where: { customerId: { in: attendeeCustomerIds }, attendedAt: { lt: period.start } },
          select: { customerId: true },
          distinct: ["customerId"],
        });
  const pastSet = new Set(pastAttendees.map((a) => a.customerId));
  const repeatAttendees = attendances.filter((a) => pastSet.has(a.customerId)).length;

  const capacity = sessions.reduce((s, x) => s + x.capacity, 0);
  const cancelled = reservations.filter((r) => r.status === "CANCELLED").length;
  const noShow = reservations.filter((r) => r.status === "NO_SHOW").length;

  // --- 行動（ファネル）--------------------------------------------
  const visitedCustomerIds = [...new Set(visitRows.map((v) => v.customerId).filter(Boolean))] as string[];
  const purchasedCustomerIds = new Set(
    visitRows.filter((v) => v.purchased && v.customerId).map((v) => v.customerId as string),
  );
  const schoolCustomerIds = new Set(attendances.map((a) => a.customerId));

  // 期間内に「未購入」で帰った人が、その後に購入したか
  const noPurchaseCustomerIds = [
    ...new Set(noPurchaseRows.map((v) => v.customerId).filter(Boolean)),
  ] as string[];
  const laterPurchases =
    noPurchaseCustomerIds.length === 0
      ? []
      : await prisma.purchase.findMany({
          where: { customerId: { in: noPurchaseCustomerIds }, purchasedAt: { gte: period.start } },
          select: { customerId: true },
          distinct: ["customerId"],
        });
  const laterPurchaseSet = new Set(laterPurchases.map((p) => p.customerId));

  // 初回来店の人が、その後もう一度来たか
  const firstVisitCustomerIds = [
    ...new Set(visitRows.filter((v) => v.isFirstVisit && v.customerId).map((v) => v.customerId as string)),
  ];
  const revisits =
    firstVisitCustomerIds.length === 0
      ? []
      : await prisma.visit.groupBy({
          by: ["customerId"],
          where: { customerId: { in: firstVisitCustomerIds } },
          _count: { _all: true },
        });
  const revisitedSet = new Set(
    revisits.filter((r) => r._count._all >= 2).map((r) => r.customerId as string),
  );

  const schoolThenPurchase = [...schoolCustomerIds].filter((id) => purchasedCustomerIds.has(id)).length;

  const body: AnalyticsResponse = {
    period: {
      key: period.key,
      label: period.label,
      from: formatJstDate(period.start),
      to: formatJstDate(new Date(period.end.getTime() - 1)),
    },
    visit: {
      total,
      named,
      anonymous: total - named,
      namedRate: rate(named, total),
      newCustomers: visitRows.filter((v) => v.isFirstVisit).length,
      repeaters: visitRows.filter((v) => v.isNamed && !v.isFirstVisit).length,
      byGender: tally(guestCounts.map((g) => g.gender), genderLabel),
      byAgeGroup: sortByAgeOrder(tally(guestCounts.map((g) => g.ageGroup), ageLabel)),
      byPrefecture: tally(visitRows.map((v) => v.prefecture)),
      byPurpose: tally(visitRows.map((v) => v.purposeCode), labelOf("VISIT_PURPOSE")),
      byChannel: tally(byChannelRows.map((v) => v.channelCode), labelOf("VISIT_CHANNEL")),
      byReferrer: tally(visitRows.map((v) => v.referrerCode), labelOf("REFERRER")),
      byHour: visitTime.byHour,
      byWeekday,
      byWeekdayHour: visitTime.byWeekdayHour,
    },
    purchase: {
      purchasedVisits,
      unpurchasedVisits: total - purchasedVisits,
      purchaseRate: rate(purchasedVisits, total),
      sales,
      purchaseCount: purchases.length,
      averageSpend: purchases.length === 0 ? 0 : Math.round(sales / purchases.length),
      byCategory: toAmountBuckets(categoryMap),
      byProduct: toAmountBuckets(productMap).slice(0, 20),
      rateByAgeGroup: sortByAgeOrder(
        rateBy(
          visitRows.map((v) => ({ key: v.ageGroup, hit: v.purchased })),
          ageLabel,
        ),
      ),
      rateByGender: rateBy(
        visitRows.map((v) => ({ key: v.gender, hit: v.purchased })),
        genderLabel,
      ),
      rateByChannel: rateBy(
        byChannelRows.map((v) => ({ key: v.channelCode, hit: v.purchased })),
        labelOf("VISIT_CHANNEL"),
      ),
      byWeekday: salesByWeekday,
    },
    noPurchase: {
      count: noPurchaseRows.length,
      rate: rate(noPurchaseRows.length, total),
      byReason: tally(
        noPurchaseRows.map((v) => v.noPurchaseReasonCode),
        labelOf("NO_PURCHASE_REASON"),
      ),
      byInterest: tally(noPurchaseRows.flatMap((v) => (v.interestNames.length ? v.interestNames : [null]))),
      rateByChannel: rateBy(
        byChannelRows.map((v) => ({ key: v.channelCode, hit: !v.purchased })),
        labelOf("VISIT_CHANNEL"),
      ),
      rateByAgeGroup: sortByAgeOrder(
        rateBy(
          visitRows.map((v) => ({ key: v.ageGroup, hit: !v.purchased })),
          ageLabel,
        ),
      ),
      considering,
    },
    school: {
      sessions: sessions.length,
      attendees: attendances.length,
      newAttendees: attendances.length - repeatAttendees,
      repeatAttendees,
      averagePerSession:
        sessions.length === 0 ? 0 : Math.round((attendances.length / sessions.length) * 10) / 10,
      capacity,
      fillRate: rate(attendances.length, capacity),
      cancelled,
      noShow,
      cancelRate: rate(cancelled + noShow, reservations.length),
      byCourse: tally(attendances.map((a) => a.course?.name ?? null)),
      byStaff: tally(attendances.map((a) => a.staff?.name ?? null)),
    },
    funnel: {
      visitToPurchase: {
        label: "来店 → 購入",
        total,
        hit: purchasedVisits,
        rate: rate(purchasedVisits, total),
      },
      visitToSchool: {
        label: "来店 → スクール参加",
        total: visitedCustomerIds.length,
        hit: visitedCustomerIds.filter((id) => schoolCustomerIds.has(id)).length,
        rate: rate(
          visitedCustomerIds.filter((id) => schoolCustomerIds.has(id)).length,
          visitedCustomerIds.length,
        ),
      },
      schoolToPurchase: {
        label: "スクール参加 → 商品購入",
        total: schoolCustomerIds.size,
        hit: schoolThenPurchase,
        rate: rate(schoolThenPurchase, schoolCustomerIds.size),
      },
      firstToSecondVisit: {
        label: "初回来店 → 再来店",
        total: firstVisitCustomerIds.length,
        hit: revisitedSet.size,
        rate: rate(revisitedSet.size, firstVisitCustomerIds.length),
      },
      noPurchaseToLaterPurchase: {
        label: "未購入 → 後日購入",
        total: noPurchaseCustomerIds.length,
        hit: laterPurchaseSet.size,
        rate: rate(laterPurchaseSet.size, noPurchaseCustomerIds.length),
      },
    },
  };

  return NextResponse.json(body);
}
