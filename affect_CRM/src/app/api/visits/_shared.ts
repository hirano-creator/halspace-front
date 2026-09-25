// 来店記録の入力パース

import { AGE_GROUPS, GUEST_GENDERS, toEnum } from "@/lib/constants";
import { trimOrNull } from "@/lib/normalize";
import { ageToGroup, parseJstDateTime } from "@/lib/utils/time";

export interface GuestBreakdownRow {
  ageGroup: string | null;
  gender: string | null;
}

export interface VisitInput {
  customerId: string | null;
  /** 来店時点の年代。顧客が分かっている来店でも持つ */
  guestAgeGroup: string | null;
  /** 来店時点の正確な年齢（任意）。入っていれば年代はここから決める */
  guestAge: number | null;
  guestGender: string | null;
  guestMemo: string | null;
  /**
   * グループ内の年代・性別が一様でないときだけ使う、1人ずつの内訳。
   * 匿名来店（customerId なし）でのみ意味を持つ。partySize 分すべて埋める必要はない。
   */
  guestBreakdown: GuestBreakdownRow[];
  visitedAt: Date;
  partySize: number;
  purposeCode: string | null;
  /** 来店経路。複数選択なので配列で受け、保存時にカンマ区切りへ寄せる */
  channelCodes: string[];
  referrerCode: string | null;
  prefectureCode: string | null;
  purchased: boolean;
  noPurchaseReasonCode: string | null;
  noPurchaseComment: string | null;
  conversation: string | null;
  nextProposal: string | null;
  followUpDate: Date | null;
  interestCategoryIds: string[];
}

/**
 * フォームを検証して入力値に変換する。
 * 顧客は任意（お名前が分からない来店も記録するため）。購入／未購入は必須。
 */
export function parseVisitForm(form: FormData): VisitInput | string {
  const customerId = trimOrNull(form.get("customerId"));

  const purchasedRaw = form.get("purchased");
  if (purchasedRaw !== "yes" && purchasedRaw !== "no") {
    return "購入／未購入を選んでください";
  }
  const purchased = purchasedRaw === "yes";

  const visitedAtRaw = trimOrNull(form.get("visitedAt"));
  const visitedAt = visitedAtRaw ? parseJstDateTime(visitedAtRaw) : new Date();
  if (!visitedAt) return "来店日時は「2026-08-31 14:20」の形式で入力してください";

  const partySizeRaw = trimOrNull(form.get("partySize")) ?? "1";
  const partySize = Number(partySizeRaw);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 50) {
    return "来店人数は 1〜50 の数字で入力してください";
  }

  // 正確な年齢が分かるときは、年代は年齢から決める（選んだ年代と食い違わないように）
  const ageRaw = trimOrNull(form.get("guestAge"));
  let guestAge: number | null = null;
  if (ageRaw) {
    guestAge = Number(ageRaw);
    if (!Number.isInteger(guestAge) || guestAge < 0 || guestAge > 120) {
      return "年齢は 0〜120 の数字で入力してください";
    }
  }
  const guestAgeGroup = guestAge !== null ? ageToGroup(guestAge) : toEnum(AGE_GROUPS, form.get("guestAgeGroup"));

  const followUpRaw = trimOrNull(form.get("followUpDate"));
  let followUpDate: Date | null = null;
  if (followUpRaw) {
    followUpDate = parseJstDateTime(followUpRaw);
    if (!followUpDate) return "フォロー予定日は「2026-09-10」の形式で入力してください";
  }

  // 内訳は「お一人ずつ分けて入力する」を開いたときだけ送られてくる。
  // guestBreakdownAgeGroup[] と guestBreakdownGender[] は同じ人の分を同じ index に対応させて送る
  // （クライアント側は空でも必ず両方セットで append し、ずれないようにする）。
  const breakdownAges = form.getAll("guestBreakdownAgeGroup").map(String);
  const breakdownGenders = form.getAll("guestBreakdownGender").map(String);
  const guestBreakdown: GuestBreakdownRow[] = customerId
    ? []
    : breakdownAges
        .map((raw, i) => ({
          ageGroup: toEnum(AGE_GROUPS, raw),
          gender: toEnum(GUEST_GENDERS, breakdownGenders[i]),
        }))
        // 両方とも未選択の行は記録しない（空データを増やさない）
        .filter((row) => row.ageGroup || row.gender);

  return {
    customerId,
    guestAgeGroup,
    guestAge,
    // 以下は匿名のときだけ意味を持つ項目。顧客が特定できている場合は顧客側の情報を使う
    guestGender: customerId ? null : toEnum(GUEST_GENDERS, form.get("guestGender")),
    guestMemo: customerId ? null : trimOrNull(form.get("guestMemo")),
    guestBreakdown,
    visitedAt,
    partySize,
    purposeCode: trimOrNull(form.get("purposeCode")),
    channelCodes: form.getAll("channelCodes").map(String).filter(Boolean),
    referrerCode: trimOrNull(form.get("referrerCode")),
    prefectureCode: trimOrNull(form.get("prefectureCode")),
    purchased,
    noPurchaseReasonCode: purchased ? null : trimOrNull(form.get("noPurchaseReasonCode")),
    noPurchaseComment: purchased ? null : trimOrNull(form.get("noPurchaseComment")),
    conversation: trimOrNull(form.get("conversation")),
    nextProposal: trimOrNull(form.get("nextProposal")),
    followUpDate,
    interestCategoryIds: form.getAll("interestCategoryIds").map(String).filter(Boolean),
  };
}
