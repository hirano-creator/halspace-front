// 権限
//
// ロール文字列を直接比較せず、必ず can() を通す。
// 将来「閲覧のみのアルバイト」などを足すとき、表 1 枚の変更で済むようにするため。

export const ROLES = ["ADMIN", "STAFF"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "管理者",
  STAFF: "スタッフ",
};

/** 機能単位の権限 */
export type Permission =
  /** 顧客の削除（論理削除） */
  | "customer.delete"
  /** 来店記録の削除 */
  | "visit.delete"
  /** 購入・スクール参加・フォロー・予約枠など、売上や予定に関わる履歴の削除 */
  | "data.delete"
  /** 商品・コース・タグ・選択肢マスタの編集 */
  | "master.edit"
  /** スタッフの追加・権限変更・無効化 */
  | "staff.manage"
  /** 店舗設定の変更 */
  | "settings.edit"
  /** 個人情報を含む CSV の出力 */
  | "export.personal";

const ADMIN_PERMISSIONS: Permission[] = [
  "customer.delete",
  "visit.delete",
  "data.delete",
  "master.edit",
  "staff.manage",
  "settings.edit",
  "export.personal",
];

/** ロールごとの権限表。ここを見れば誰が何をできるか分かる */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: ADMIN_PERMISSIONS,
  // スタッフは日常業務（顧客・来店・購入・予約・フォローの閲覧／登録／編集）が中心。
  // それらは権限チェック不要なのでここには書かない。
  // 店舗では日々スタッフのアカウントで操作するため、顧客・来店の削除（誤登録の整理）は
  // スタッフにも開放している（2026-09-17）。売上に関わる購入などの削除は管理者のみのまま。
  STAFF: ["customer.delete", "visit.delete"],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** 不正な値は最小権限へフォールバックする */
export function toRole(value: unknown): Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value)
    ? (value as Role)
    : "STAFF";
}
