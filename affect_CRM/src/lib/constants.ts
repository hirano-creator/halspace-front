// 状態を表す値の定義
//
// D1(SQLite) には enum がないため、DB 上は String で持ち、値の正しさは
// ここの as const タプル（→ union 型）と入力時の検証で担保する。

export const GENDERS = ["MALE", "FEMALE", "OTHER", "UNKNOWN"] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<Gender, string> = {
  MALE: "男性",
  FEMALE: "女性",
  OTHER: "その他",
  UNKNOWN: "不明",
};

/** 匿名来店で使う推定性別（その他は使わない） */
export const GUEST_GENDERS = ["MALE", "FEMALE", "UNKNOWN"] as const;

export const AGE_GROUPS = ["10S", "20S", "30S", "40S", "50S", "60S", "UNKNOWN"] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];
export const AGE_GROUP_LABELS: Record<AgeGroup, string> = {
  "10S": "10代",
  "20S": "20代",
  "30S": "30代",
  "40S": "40代",
  "50S": "50代",
  "60S": "60代〜",
  UNKNOWN: "不明",
};

/** 来店エリア（都道府県）。値が変わらない固定ドメインのため MasterOption ではなくここで持つ */
export const PREFECTURES = [
  "北海道",
  "青森県",
  "岩手県",
  "宮城県",
  "秋田県",
  "山形県",
  "福島県",
  "茨城県",
  "栃木県",
  "群馬県",
  "埼玉県",
  "千葉県",
  "東京都",
  "神奈川県",
  "新潟県",
  "富山県",
  "石川県",
  "福井県",
  "山梨県",
  "長野県",
  "岐阜県",
  "静岡県",
  "愛知県",
  "三重県",
  "滋賀県",
  "京都府",
  "大阪府",
  "兵庫県",
  "奈良県",
  "和歌山県",
  "鳥取県",
  "島根県",
  "岡山県",
  "広島県",
  "山口県",
  "徳島県",
  "香川県",
  "愛媛県",
  "高知県",
  "福岡県",
  "佐賀県",
  "長崎県",
  "熊本県",
  "大分県",
  "宮崎県",
  "鹿児島県",
  "沖縄県",
] as const;

/** 選択肢マスタの種別 */
export const MASTER_TYPES = [
  "VISIT_PURPOSE",
  "VISIT_CHANNEL",
  "REFERRER",
  "NO_PURCHASE_REASON",
  "CUSTOMER_RANK",
  "SURF_LEVEL",
  "BOARD_TYPE",
  "WETSUIT_SIZE",
  "SURF_POINT",
  "SURF_FREQUENCY",
] as const;
export type MasterType = (typeof MASTER_TYPES)[number];
export const MASTER_TYPE_LABELS: Record<MasterType, string> = {
  VISIT_PURPOSE: "来店目的",
  VISIT_CHANNEL: "来店経路",
  REFERRER: "何を見て来たか",
  NO_PURCHASE_REASON: "未購入理由",
  CUSTOMER_RANK: "顧客ランク",
  SURF_LEVEL: "サーフィンレベル",
  BOARD_TYPE: "ボードタイプ",
  WETSUIT_SIZE: "ウェットサイズ",
  SURF_POINT: "よく行くポイント",
  SURF_FREQUENCY: "サーフィン頻度",
};

export const RESERVATION_STATUSES = [
  "TENTATIVE",
  "CONFIRMED",
  "ATTENDED",
  "CANCELLED",
  "NO_SHOW",
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  TENTATIVE: "仮予約",
  CONFIRMED: "予約確定",
  ATTENDED: "参加済",
  CANCELLED: "キャンセル",
  NO_SHOW: "無断キャンセル",
};
/** 定員の消費に数える予約ステータス */
export const ACTIVE_RESERVATION_STATUSES: ReservationStatus[] = [
  "TENTATIVE",
  "CONFIRMED",
  "ATTENDED",
];

export const RESERVATION_SOURCES = ["WEB", "STAFF", "PHONE"] as const;
export type ReservationSource = (typeof RESERVATION_SOURCES)[number];

export const FOLLOW_UP_STATUSES = ["PENDING", "IN_PROGRESS", "DONE", "UNNECESSARY"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];
export const FOLLOW_UP_STATUS_LABELS: Record<FollowUpStatus, string> = {
  PENDING: "未対応",
  IN_PROGRESS: "対応中",
  DONE: "完了",
  UNNECESSARY: "不要",
};

export const SESSION_STATUSES = ["OPEN", "CLOSED", "CANCELLED"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** 値が候補に含まれるか検査し、含まれなければ null を返す */
export function toEnum<T extends string>(
  candidates: readonly T[],
  value: unknown,
): T | null {
  return typeof value === "string" && (candidates as readonly string[]).includes(value)
    ? (value as T)
    : null;
}
