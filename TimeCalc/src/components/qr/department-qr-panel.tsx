// 部署ごとの打刻用QRコード表示（サーバーコンポーネント）
// 管理者画面（/settings/qr/[departmentId]）と公開キオスクページ（/qr/[kioskKey]）の両方から使う。

import { headers } from "next/headers";
import { buildClockUrl, dailyQrToken, generateQrDataUrl, type QrKind } from "@/lib/qr";
import { todayString } from "@/lib/utils/time";
import { getCompanyIdForDepartment, getWorkRules } from "@/lib/settings";
import { DailyAutoRefresh } from "./daily-auto-refresh";
import { QrBoard } from "./qr-board";

type DepartmentForQr = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  allowedRadiusMeters: number | null;
  dailyQrEnabled: boolean;
  standardQrEnabled: boolean;
  attendQrEnabled: boolean;
  outingQrEnabled: boolean;
};

/** リクエストヘッダーからベースURL（プロトコル+ホスト）を組み立てる */
export async function getBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function DepartmentQrPanel({
  department,
  variant,
}: {
  department: DepartmentForQr;
  /** admin=管理者画面（設定の補足説明・印刷ボタンあり） / kiosk=公開キオスクページ（表示専用でシンプルに） */
  variant: "admin" | "kiosk";
}) {
  const baseUrl = await getBaseUrl();
  const today = todayString();
  const token = department.dailyQrEnabled ? dailyQrToken(department.id, today) : undefined;

  // 標準QR・出勤退勤QRは主役として大きく表示される可能性があるため720pxで生成する
  // （220px表示に収まる外出・戻りQRは既定の320pxのまま）
  async function buildQr(label: string, description: string, kind?: QrKind, width?: number) {
    const url = buildClockUrl(baseUrl, department.id, token, kind);
    return { label, description, url, dataUrl: await generateQrDataUrl(url, width) };
  }

  const noneEnabled =
    !department.standardQrEnabled && !department.attendQrEnabled && !department.outingQrEnabled;
  const gpsUnset =
    department.latitude == null || department.longitude == null || department.allowedRadiusMeters == null;

  const companyId = await getCompanyIdForDepartment(department.id);
  const rules = await getWorkRules(companyId);
  const { workStart, workEnd } = rules;

  const [standard, attend, outing] = await Promise.all([
    department.standardQrEnabled
      ? buildQr("標準QR", "タップ打刻用（出勤・退勤・外出・戻りの4ボタンから選んで打刻）", undefined, 720)
      : null,
    department.attendQrEnabled
      ? buildQr(
          "出勤・退勤QR",
          "「スキャン即打刻」設定のスタッフは読み取った瞬間に自動打刻されます",
          "attend",
          720,
        )
      : null,
    department.outingQrEnabled
      ? buildQr("外出・戻りQR", "外出・戻りはこのQRを読み取ってからボタンで打刻します", "outing")
      : null,
  ]);

  return (
    <>
      {department.dailyQrEnabled && <DailyAutoRefresh />}
      <QrBoard
        qrs={{ standard, attend, outing }}
        workStart={workStart}
        workEnd={workEnd}
        variant={variant}
        dailyQrEnabled={department.dailyQrEnabled}
        today={today}
        gpsUnset={gpsUnset}
        noneEnabled={noneEnabled}
      />
    </>
  );
}
