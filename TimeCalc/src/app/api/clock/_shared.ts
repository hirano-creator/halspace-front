// /api/clock/* の各Route Handlerが共有するロジック
// （route.ts以外はNext.jsのルーティング対象にならないため、ここに集約する）

import type { Department, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { ClockMode } from "@/lib/auth/features";
import { distanceMeters } from "@/lib/geo";
import { todayString, timeToMinutes } from "@/lib/utils/time";
import { dailyQrToken } from "@/lib/qr";
import { getWorkRules } from "@/lib/settings";

/**
 * 打刻先の部署を解決し、QR経由必須の設定・日替わりQRトークンを検証する。
 * requestedDepartmentId は QR の URL（?dept=）で指定された店舗、homeDepartmentId は本人の所属部署。
 * 打刻先は「QRで指定された店舗、無ければ所属部署」。
 *
 * QRで指定された店舗は本人の所属部署と同じ会社のものに限る。制限しないと、GPS判定や
 * 日替わりQRが無効な別部署のIDをフォームに入れて送るだけで、自分の店舗の判定を素通りできてしまう
 * （部署IDは QR画面に表示されるURLから誰でも読める）。複数店舗の掛け持ちは同じ会社内を想定。
 * 所属部署が無いスタッフ（本社スタッフ等）は会社で縛れないため、存在する部署ならどこでも打刻できる。
 */
export async function resolveClockDepartment(
  clockMode: ClockMode,
  requestedDepartmentId: string | null,
  homeDepartmentId: string | null,
  token: string | null,
): Promise<{ ok: true; department: Department | null } | { ok: false; error: string }> {
  // QR経由必須の設定のスタッフは、店舗QRのURL（?dept=）以外を拒否する
  if (clockMode !== "free" && !requestedDepartmentId) {
    return { ok: false, error: "このアカウントは店舗のQRコードからのみ打刻できます" };
  }

  let department: Department | null = null;
  if (requestedDepartmentId) {
    department = await prisma.department.findUnique({ where: { id: requestedDepartmentId } });
    if (!department) {
      return { ok: false, error: "QRコードの店舗が見つかりません。店舗に表示されている最新のQRコードを読み取ってください" };
    }
    if (homeDepartmentId && homeDepartmentId !== department.id) {
      const home = await prisma.department.findUnique({ where: { id: homeDepartmentId } });
      const sameCompany =
        home?.companyId != null && department.companyId != null && home.companyId === department.companyId;
      if (!sameCompany) {
        return { ok: false, error: "所属している会社以外の店舗QRコードでは打刻できません" };
      }
    }
  } else if (homeDepartmentId) {
    department = await prisma.department.findUnique({ where: { id: homeDepartmentId } });
  }

  // 自由打刻の設定で、かつQR経由（requestedDepartmentId）でアクセスしていない場合は、
  // 所属部署の日替わりQR設定があっても個人設定（自由打刻）を優先し、トークン検証を行わない
  const bypassDailyQrCheck = clockMode === "free" && !requestedDepartmentId;

  // 日替わりQRが有効な部署は、フォーム送信時にも当日分のトークンを再検証する
  // （クライアント側の表示チェックだけでは、URLを保存して翌日以降に直接送信されると素通りしてしまうため）
  if (!bypassDailyQrCheck && department?.dailyQrEnabled) {
    if (!token) {
      return {
        ok: false,
        error: "店舗の「出勤・退勤」または「外出・戻り」QRコードを読み取ってください",
      };
    }
    if (token !== dailyQrToken(department.id, todayString())) {
      return {
        ok: false,
        error:
          "このQRコードは本日分ではありません。店舗に表示されている最新のQRコードを読み取ってください",
      };
    }
  }

  return { ok: true, department };
}

/**
 * 同じユーザーの打刻処理をトランザクション内で直列化する（PostgreSQL の advisory lock）。
 * 同じキーで待っている別のトランザクションは、先行側がコミット/ロールバックするまで進めない。
 * ロックはトランザクション終了で自動的に外れる。行ロックと違い対象行が無くても（初回の打刻でも）効く。
 */
export async function lockUserForPunch(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  // pg_advisory_xact_lock は void を返し $queryRaw では読み取れない（P2010）ので $executeRaw で実行する
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
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
  const workStart = timeToMinutes(rules.workStart);
  const now = timeToMinutes(time);
  return workStart !== null && now !== null ? Math.max(0, now - workStart) : 0;
}
