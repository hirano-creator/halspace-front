"use client";

// 店舗ごとの打刻用QRコード表示（管理者画面用）
// QRコード画像生成・日替わりトークンの計算はサーバー専用のため、
// /api/settings/qr/[departmentId] が返す完成済みデータをそのまま表示するだけのコンポーネント。
// 公開キオスクページ（/qr/[kioskKey]）は Server Component 版（components/qr/department-qr-panel.tsx）を引き続き使う。

import Image from "next/image";
import { Card } from "@/components/ui";
import { RealtimeClock } from "@/components/realtime-clock";
import { PrintButton } from "@/components/qr/print-button";
import { DailyAutoRefresh } from "@/components/qr/daily-auto-refresh";
import type { DepartmentQrDetailResponse, QrCodeData } from "../types";

function QrCard({ label, description, dataUrl, url }: QrCodeData) {
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

export function DepartmentQrPanelClient({
  data,
  onRefresh,
}: {
  data: DepartmentQrDetailResponse;
  /** 日替わりQRの自動更新タイミングで呼ぶ（再取得トリガー用） */
  onRefresh?: () => void;
}) {
  return (
    <>
      {data.dailyQrEnabled && <DailyAutoRefresh onRefresh={onRefresh} />}

      <div className="mx-auto max-w-5xl space-y-8">
        <RealtimeClock size="large" />

        {data.noneEnabled && (
          <p className="mx-auto max-w-md rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-700 print:hidden">
            表示するQRコードが設定されていません。下の「表示するQR」から表示したい種類を選んでください。
          </p>
        )}

        <div className="mx-auto max-w-md space-y-2 print:hidden">
          {data.gpsUnset && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-700">
              GPS座標が未設定のため、位置情報チェックなしで打刻できます
            </p>
          )}
          {data.dailyQrEnabled ? (
            <p className="rounded-lg bg-violet-50 px-3 py-2 text-center text-xs text-primary">
              このQRコードは本日（{data.today}）限り有効です。印刷ではなく、この画面を常設のタブレット/モニタで表示し続けてください
            </p>
          ) : (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-center text-xs text-muted">
              「スキャン即打刻」のスタッフがいる店舗は、日替わりQR（部署編集画面）の併用がおすすめです
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-start justify-center gap-6 print:flex-col print:items-center">
          {data.standard && <QrCard {...data.standard} />}
          {data.attend && <QrCard {...data.attend} />}
          {data.outing && <QrCard {...data.outing} />}
        </div>

        {!data.dailyQrEnabled && !data.noneEnabled && (
          <div className="text-center print:hidden">
            <PrintButton />
          </div>
        )}
      </div>
    </>
  );
}
