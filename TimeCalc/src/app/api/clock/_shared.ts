// /api/clock/* の各Route Handlerが共有するロジック
// （route.ts以外はNext.jsのルーティング対象にならないため、ここに集約する）

import type { Department } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { ClockMode } from "@/lib/auth/features";
import { distanceMeters } from "@/lib/geo";
import { todayString, timeToMinutes } from "@/lib/utils/time";
import { dailyQrToken } from "@/lib/qr";
import { seasonOf } from "@/lib/attendance/calculator";
import { getWorkRules } from "@/lib/settings";

/**
 * 打刻先の部署を解決し、QR経由必須の設定・日替わりQRトークンを検証する。
 * departmentId は「表示に使う部署（requestedDepartmentIdが無ければ所属部署）」を渡す。
 */
export async function resolveClockDepartment(
  clockMode: ClockMode,
  requestedDepartmentId: string | null,
  departmentId: string | null,
  token: string | null,
): Promise<{ ok: true; department: Department | null } | { ok: false; error: string }> {
  // QR経由必須の設定のスタッフは、店舗QRのURL（?dept=）以外を拒否する
  if (clockMode !== "free" && !requestedDepartmentId) {
    return { ok: false, error: "このアカウントは店舗のQRコードからのみ打刻できます" };
  }

  const department = departmentId
    ? await prisma.department.findUnique({ where: { id: departmentId } })
    : null;

  // 日替わりQRが有効な部署は、フォーム送信時にも当日分のトークンを再検証する
  // （クライアント側の表示チェックだけでは、URLを保存して翌日以降に直接送信されると素通りしてしまうため）
  if (department?.dailyQrEnabled) {
    if (!token || token !== dailyQrToken(department.id, todayString())) {
      return {
        ok: false,
        error:
          "このQRコードは本日分ではありません。店舗に表示されている最新のQRコードを読み取ってください",
      };
    }
  }

  return { ok: true, department };
}

/** GPS必須（スタッフのgpsCheckEnabled かつ 部署に座標設定あり）の場合に現在地を検証する */
export function checkGps(
  me: { gpsCheckEnabled: boolean },
  department: Department | null,
  lat: number | null,
  lng: number | null,
): { ok: true; distance: number | null } | { ok: false; error: string } {
  if (
    !me.gpsCheckEnabled ||
    department?.latitude == null ||
    department?.longitude == null ||
    department?.allowedRadiusMeters == null
  ) {
    return { ok: true, distance: null };
  }
  if (lat === null || lng === null || Number.isNaN(lat) || Number.isNaN(lng)) {
    return { ok: false, error: "位置情報を取得できませんでした。位置情報の利用を許可してください" };
  }
  const distance = distanceMeters(department.latitude, department.longitude, lat, lng);
  if (distance > department.allowedRadiusMeters) {
    return {
      ok: false,
      error: `店舗から離れすぎています（現在地との距離: 約${Math.round(distance)}m）`,
    };
  }
  return { ok: true, distance };
}

/** 出勤打刻が所定始業より遅い場合の遅刻分数を計算する（その日最初のINのみ） */
export async function calcLateMinutes(
  userId: string,
  date: string,
  time: string,
  department: Department | null,
): Promise<number> {
  const todayInCount = await prisma.clockEvent.count({
    where: { userId, date, type: "IN" },
  });
  if (todayInCount !== 1) return 0;
  // 遅刻判定は打刻先部署（QR経由なら店舗、それ以外は所属部署）の会社の勤務ルールで行う
  const rules = await getWorkRules(department?.companyId ?? null);
  const workStart = timeToMinutes(rules[seasonOf(date, rules)].workStart);
  const now = timeToMinutes(time);
  return workStart !== null && now !== null ? Math.max(0, now - workStart) : 0;
}
