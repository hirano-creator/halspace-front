"use client";

// 店舗ごとの打刻用QRコード表示（管理者画面用）
// QRコード画像生成・日替わりトークン・勤務ルールの計算はサーバー専用のため、
// /api/settings/qr/[departmentId] が返す完成済みデータをそのまま QrBoard に渡すだけのコンポーネント。
// 公開キオスクページ（/qr/[kioskKey]）は Server Component 版（components/qr/department-qr-panel.tsx）を引き続き使う。

import Link from "next/link";
import { QrBoard } from "@/components/qr/qr-board";
import { DailyAutoRefresh } from "@/components/qr/daily-auto-refresh";
import { buttonSecondaryClass } from "@/components/ui";
import type { DepartmentQrDetailResponse } from "../types";

/**
 * PCや店舗タブレットのホーム画面にショートカットを作るための導線。
 * 「ホーム画面に追加」自体はブラウザの仕様上、追加先のページ（キオスク画面）でしか実行できないため、
 * ここではキオスク画面を新しいタブで開くだけに留め、実際の追加ボタンは向こう側（InstallShortcutButton）に任せる。
 */
function KioskShortcutLink({ kioskUrl }: { kioskUrl: string | null }) {
  if (!kioskUrl) {
    return (
      <p className="mx-auto max-w-md rounded-lg bg-gray-50 px-3 py-2 text-center text-xs text-muted print:hidden">
        ホーム画面へのショートカットを作るには、先に
        <Link href="/settings/qr" className="text-primary underline underline-offset-2">
          キオスクURLを発行
        </Link>
        してください。
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-md text-center print:hidden">
      <a
        href={kioskUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonSecondaryClass}
      >
        🖥️ ホーム画面にショートカットを追加する
      </a>
      <p className="mt-1 text-xs text-muted">
        ログイン不要のキオスク画面が新しいタブで開きます。表示されたボタンで追加できます。
      </p>
    </div>
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
      <div className="mb-3">
        <KioskShortcutLink kioskUrl={data.kioskUrl} />
      </div>
      <QrBoard
        qrs={{ standard: data.standard, attend: data.attend, outing: data.outing }}
        workStart={data.workStart}
        workEnd={data.workEnd}
        variant="admin"
        dailyQrEnabled={data.dailyQrEnabled}
        today={data.today}
        gpsUnset={data.gpsUnset}
        noneEnabled={data.noneEnabled}
      />
    </>
  );
}
