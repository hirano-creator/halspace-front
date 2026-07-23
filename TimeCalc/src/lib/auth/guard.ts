// 認可判定の純粋関数
// ログイン必須チェック・権限チェックは Route Handler 側の requireApiUser/requireApiPermission
// （src/lib/auth/api-guard.ts）が担う。ここには複数箇所から使う判定ロジックのみ残す。

import { can } from "./roles";
import type { SessionUser } from "./session";

/**
 * 対象社員の勤怠を閲覧できるか判定する。
 * 管理者: 全員 / 店長: 自部署のみ / 一般社員・アルバイト: 自分のみ
 */
export function canViewEmployee(
  viewer: SessionUser,
  target: { id: string; departmentId: string | null },
): boolean {
  if (viewer.id === target.id) return true;
  if (can(viewer.role, "viewAllEmployees")) return true;
  if (can(viewer.role, "viewDepartment")) {
    return viewer.departmentId !== null && viewer.departmentId === target.departmentId;
  }
  return false;
}
