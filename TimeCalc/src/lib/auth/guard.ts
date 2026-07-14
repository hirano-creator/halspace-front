// サーバーコンポーネント / Server Action 用の認可ガード

import { redirect } from "next/navigation";
import { can, type Permission } from "./roles";
import { getSessionUser, type SessionUser } from "./session";

/** ログイン必須。未ログインならログイン画面へリダイレクトする */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** 指定権限が必須。権限がなければ勤怠一覧へリダイレクトする */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) redirect("/attendance");
  return user;
}

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
