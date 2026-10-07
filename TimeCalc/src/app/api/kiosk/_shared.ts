// /api/kiosk/* （スマホ忘れ打刻）の各Route Handlerが共有するロジック
//
// キオスクはログイン不要の画面なので、認証の代わりに kioskKey（推測不能な32文字hex）で
// 店舗を特定する。kioskKey を知っている＝店舗に置いたタブレットである、という前提。
// 打刻できるのはその店舗と同じ会社に所属する在籍スタッフだけ。

import { NextResponse } from "next/server";
import type { Department } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { isPhotoStorageReady } from "@/lib/storage/photo-storage";
import { LoginThrottle } from "@/lib/auth/login-throttle";
import type { ClockStatus } from "@/lib/attendance/clock-service";
import type { ClockEventType } from "@/lib/attendance/clock";

const KIOSK_KEY_RE = /^[0-9a-f]{32}$/;

/**
 * kioskKey から店舗を解決し、スマホ忘れ打刻が使える状態かを確認する。
 * 未知のキーは 404（キーの存在を秘匿する既存キオスク画面と同じ扱い）、機能OFF・保存先未設定は 503。
 */
export async function resolveKioskDepartment(
  kioskKey: string,
): Promise<{ ok: true; department: Department } | { ok: false; response: NextResponse }> {
  const department = KIOSK_KEY_RE.test(kioskKey)
    ? await prisma.department.findUnique({ where: { kioskKey } })
    : null;
  if (!department) {
    return { ok: false, response: NextResponse.json({ error: "見つかりません" }, { status: 404 }) };
  }
  if (!department.kioskPunchEnabled || !isPhotoStorageReady()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "この店舗ではスマホを忘れた方の打刻は利用できません" },
        { status: 503 },
      ),
    };
  }
  return { ok: true, department };
}

/**
 * キオスクで選べるスタッフの絞り込み条件。
 * 店舗の所属スタッフ＋（店舗に会社が設定されていれば）同じ会社の他部署の在籍スタッフ。
 */
export function kioskStaffWhere(department: Department) {
  return {
    isActive: true,
    OR: [
      { departmentId: department.id },
      ...(department.companyId ? [{ department: { companyId: department.companyId } }] : []),
    ],
  };
}

/** 指定スタッフがこの店舗のキオスクで打刻できるなら、その社員を返す */
export async function findKioskStaff(department: Department, userId: string) {
  if (!userId) return null;
  return prisma.user.findFirst({ where: { id: userId, ...kioskStaffWhere(department) } });
}

/** いま押せる打刻種別（validatePunch と同じ判定） */
export function allowedTypesOf(status: ClockStatus): ClockEventType[] {
  const types: ClockEventType[] = [];
  if (status.canClockIn) types.push("IN");
  if (status.canClockOut) types.push("OUT");
  if (status.canOutStart) types.push("OUT_START");
  if (status.canOutEnd) types.push("OUT_END");
  return types;
}

/**
 * 打刻APIの回数制限（接続元IPごと）。1店舗20人×1日4回程度を想定し、15分に60回まで。
 * ログイン試行の制限と同じ仕組み（プロセス内メモリ）を、成功・失敗を問わない回数制限として使う。
 */
const globalForKiosk = globalThis as unknown as { __timecalcKioskThrottle?: LoginThrottle };
export const kioskPunchThrottle =
  globalForKiosk.__timecalcKioskThrottle ??
  (globalForKiosk.__timecalcKioskThrottle = new LoginThrottle({
    maxFailures: 60,
    windowMs: 15 * 60 * 1000,
  }));
