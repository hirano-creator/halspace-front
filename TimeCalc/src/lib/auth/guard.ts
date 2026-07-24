// 認可判定の純粋関数
// ログイン必須チェック・権限チェックは Route Handler 側の requireApiUser/requireApiPermission
// （src/lib/auth/api-guard.ts）が担う。ここには複数箇所から使う判定ロジックのみ残す。

import { can } from "./roles";
import type { SessionUser } from "./session";

/** 勤怠の閲覧範囲。all: 全社員 / company: 同じ会社 / department: 自部署 / self: 自分のみ */
export type AttendanceScope = "all" | "company" | "department" | "self";

/**
 * 閲覧者の勤怠閲覧範囲を判定する。
 * 管理者: 全員 / 会社閲覧権限あり: 同じ会社 / 店長: 自部署 / それ以外: 自分のみ。
 * （会社閲覧権限は features.companyAttendance で個別付与。所属会社が未設定なら自部署/自分に縮退する）
 */
export function attendanceScope(viewer: SessionUser): AttendanceScope {
  if (can(viewer.role, "viewAllEmployees")) return "all";
  if (viewer.companyAttendance && viewer.companyId) return "company";
  if (can(viewer.role, "viewDepartment")) return "department";
  return "self";
}

/** 対象社員の勤怠を閲覧できるか判定する。 */
export function canViewEmployee(
  viewer: SessionUser,
  target: { id: string; departmentId: string | null; companyId: string | null },
): boolean {
  if (viewer.id === target.id) return true;
  switch (attendanceScope(viewer)) {
    case "all":
      return true;
    case "company":
      return viewer.companyId !== null && viewer.companyId === target.companyId;
    case "department":
      return viewer.departmentId !== null && viewer.departmentId === target.departmentId;
    case "self":
      return false;
  }
}

/**
 * 他人の勤怠を修正（直接編集・修正申請の承認）できるか判定する。
 * 店長・管理者に加え、会社閲覧・修正権限を個別付与されたスタッフも対象。
 * 実際に修正できる相手は canViewEmployee（＝閲覧範囲）と同じ範囲に限られる。
 */
export function canEditOthersAttendance(viewer: SessionUser): boolean {
  if (can(viewer.role, "editAttendance")) return true;
  return viewer.companyAttendance && viewer.companyId !== null;
}
