// 表示名の組み立て
//
// 匿名来店（お名前が分からないお客様）を画面にどう出すかを 1 か所に集約する。

import { AGE_GROUP_LABELS, GENDER_LABELS, type AgeGroup, type Gender } from "./constants";

export interface GuestLike {
  guestAgeGroup: string | null;
  guestGender: string | null;
  partySize: number;
  /** グループ内の年代・性別が一様でないときだけ入る内訳（VisitGuest） */
  guests?: { ageGroup: string | null; gender: string | null }[];
}

function ageGenderLabel(age: string | null, gender: string | null): string {
  const parts: string[] = [];
  if (age && age !== "UNKNOWN") parts.push(AGE_GROUP_LABELS[age as AgeGroup] ?? "");
  if (gender && gender !== "UNKNOWN") parts.push(GENDER_LABELS[gender as Gender] ?? "");
  return parts.filter(Boolean).join("・");
}

/**
 * 匿名来店の表示名を作る。
 *   例) "お名前不明（20代・男性）" / "お名前不明（30代・女性 2名）" / "お名前不明"
 *   内訳が一様でない場合  ) "お名前不明（3名・年代/性別混在）"
 */
export function guestLabel(visit: GuestLike): string {
  const guests = visit.guests ?? [];

  if (guests.length > 0) {
    const distinct = new Set(guests.map((g) => `${g.ageGroup ?? ""}:${g.gender ?? ""}`));
    if (distinct.size > 1) {
      return `お名前不明（${visit.partySize}名・年代/性別混在）`;
    }
    // 内訳を分けたが結果的に全員同じだった場合は、通常の表示に合わせる
    const [only] = guests;
    const who = ageGenderLabel(only.ageGroup, only.gender);
    const count = visit.partySize > 1 ? ` ${visit.partySize}名` : "";
    return who || count ? `お名前不明（${who}${count}）` : "お名前不明";
  }

  const who = ageGenderLabel(visit.guestAgeGroup, visit.guestGender);
  const count = visit.partySize > 1 ? ` ${visit.partySize}名` : "";

  return who || count ? `お名前不明（${who}${count}）` : "お名前不明";
}

/** 金額表示 "¥68,000" */
export function formatYen(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

/** 顧客番号の採番（A-0001）。既存の最大値 + 1 を渡す */
export function formatCustomerCode(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}
