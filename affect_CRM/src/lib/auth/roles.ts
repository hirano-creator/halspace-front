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
  /** 来店・購入など履歴データの削除 */
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
  "data.delete",
  "master.edit",
  "staff.manage",
  "settings.edit",
  "export.personal",
];

/** ロールごとの権限表。ここを見れば誰が何をできるか分かる */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: ADMIN_PERMISSIONS,
  // スタッフは日常業務（顧客・来店・購入・予約・フォローの閲覧／登録／編集）のみ。
  // それらは権限チェック不要なのでここは空でよい。
  STAFF: [],
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
