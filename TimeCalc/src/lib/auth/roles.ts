// ロール（権限）定義と認可判定
//
// ADMIN:      管理者     … 全機能
// MANAGER:    店長       … 自部署（自店舗）のみ勤怠閲覧・勤怠修正
// EMPLOYEE:   一般社員   … 自分のみ勤怠閲覧
// PART_TIME:  アルバイト … 自分のみ勤怠閲覧（EMPLOYEEと同じ権限、区分表示のみ異なる）

export const ROLES = ["ADMIN", "MANAGER", "EMPLOYEE", "PART_TIME"] as const;
export type Role = (typeof ROLES)[number];

/**
 * 権限の表示名の初期値。
 * 実際の表示名は設定画面から変更でき、Settingテーブルに保存される
 * （src/lib/settings.ts の getRoleLabels/saveRoleLabels 経由）。
 * ここでの値は「保存済み設定がない場合のデフォルト」として使う。
 */
export const DEFAULT_ROLE_LABELS: Record<Role, string> = {
  ADMIN: "管理者",
  MANAGER: "店長",
  EMPLOYEE: "一般社員",
  PART_TIME: "アルバイト",
};

/** 操作権限の種類 */
export type Permission =
  | "viewAllEmployees" // 全社員の勤怠閲覧
  | "viewDepartment" // 自部署の勤怠閲覧
  | "importCsv" // CSV取込
  | "exportCsv" // CSV出力
  | "editAttendance" // 勤怠修正
  | "manageEmployees" // 社員登録・編集
  | "manageSettings"; // 設定変更・権限管理

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: [
    "viewAllEmployees",
    "viewDepartment",
    "importCsv",
    "exportCsv",
    "editAttendance",
    "manageEmployees",
    "manageSettings",
  ],
  MANAGER: ["viewDepartment", "editAttendance"],
  EMPLOYEE: [],
  PART_TIME: [],
};

/** 指定ロールが操作権限を持つか判定する */
export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** 文字列を Role として検証する（不正値は EMPLOYEE 扱い） */
export function toRole(value: string): Role {
  return (ROLES as readonly string[]).includes(value) ? (value as Role) : "EMPLOYEE";
}
