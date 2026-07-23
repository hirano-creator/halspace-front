// 部署ごとの打刻用QRコード表示（サーバーコンポーネント）
// 管理者画面（/settings/qr/[departmentId]）と公開キオスクページ（/qr/[kioskKey]）の両方から使う。

import { headers } from "next/headers";
import Image from "next/image";
import { buildClockUrl, dailyQrToken, generateQrDataUrl, type QrKind } from "@/lib/qr";
import { todayString } from "@/lib/utils/time";
import { Card } from "@/components/ui";
import { RealtimeClock } from "@/components/realtime-clock";
import { PrintButton } from "./print-button";
import { DailyAutoRefresh } from "./daily-auto-refresh";

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

function QrCard({
  label,
  description,
  dataUrl,
  url,
}: {
  label: string;
  description: string;
  dataUrl: string;
  url: string;
}) {
  return (
    <Card className="w-96 shrink-0 print:break-inside-avoid print:break-after-page">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-lg font-semibold">{label}</p>
        <p className="text-xs text-muted">{description}</p>
        <Image
          src={dataUrl}
          alt={`${label}のQRコード`}
          width={320}
          height={320}
          unoptimized
          className="rounded-lg border border-border"
        />
        <p className="break-all text-xs text-muted">{url}</p>
      </div>
    </Card>
  );
}

export async function DepartmentQrPanel({
  department,
  variant,
}: {
  department: DepartmentForQr;
  /** admin=管理者画面（設定の補足説明・印刷ボタンあり） / kiosk=公開キオスクページ（表示専用でシンプルに） */
  variant: "admin" | "kiosk";
}) {
  const isAdmin = variant === "admin";
  const baseUrl = await getBaseUrl();
  const today = todayString();
  const token = department.dailyQrEnabled ? dailyQrToken(department.id, today) : undefined;

  async function buildQr(kind?: QrKind) {
    const url = buildClockUrl(baseUrl, department.id, token, kind);
    return { url, dataUrl: await generateQrDataUrl(url) };
  }

  const noneEnabled =
    !department.standardQrEnabled && !department.attendQrEnabled && !department.outingQrEnabled;
  const gpsUnset =
    department.latitude == null || department.longitude == null || department.allowedRadiusMeters == null;

  const [standard, attend, outing] = await Promise.all([
    department.standardQrEnabled ? buildQr() : null,
    department.attendQrEnabled ? buildQr("attend") : null,
    department.outingQrEnabled ? buildQr("outing") : null,
  ]);

  return (
    <>
      {department.dailyQrEnabled && <DailyAutoRefresh />}

      <div className="mx-auto max-w-5xl space-y-8">
        <RealtimeClock size="large" />

        {noneEnabled && (
          <p className="mx-auto max-w-md rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-700 print:hidden">
            表示するQRコードが設定されていません。
            {isAdmin ? "下の「表示するQR」から表示したい種類を選んでください。" : "管理者に設定を確認してください。"}
          </p>
        )}

        {isAdmin && (
          <div className="mx-auto max-w-md space-y-2 print:hidden">
            {gpsUnset && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-700">
                GPS座標が未設定のため、位置情報チェックなしで打刻できます
              </p>
            )}
            {department.dailyQrEnabled ? (
              <p className="rounded-lg bg-violet-50 px-3 py-2 text-center text-xs text-primary">
                このQRコードは本日（{today}）限り有効です。印刷ではなく、この画面を常設のタブレット/モニタで表示し続けてください
              </p>
            ) : (
              <p className="rounded-lg bg-gray-50 px-3 py-2 text-center text-xs text-muted">
                「スキャン即打刻」のスタッフがいる店舗は、日替わりQR（部署編集画面）の併用がおすすめです
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-start justify-center gap-6 print:flex-col print:items-center">
          {standard && (
            <QrCard
              label="標準QR"
              description="タップ打刻用（出勤・退勤・外出・戻りの4ボタンから選んで打刻）"
              dataUrl={standard.dataUrl}
              url={standard.url}
            />
          )}
          {attend && (
            <QrCard
              label="出勤・退勤QR"
              description="「スキャン即打刻」設定のスタッフは読み取った瞬間に自動打刻されます"
              dataUrl={attend.dataUrl}
              url={attend.url}
            />
          )}
          {outing && (
            <QrCard
              label="外出・戻りQR"
              description="外出・戻りはこのQRを読み取ってからボタンで打刻します"
              dataUrl={outing.dataUrl}
              url={outing.url}
            />
          )}
        </div>

        {isAdmin && !department.dailyQrEnabled && !noneEnabled && (
          <div className="text-center print:hidden">
            <PrintButton />
          </div>
        )}
      </div>
    </>
  );
}
