"use client";

// 日替わりQRの自動更新（常設タブレット/モニタ向け）
// 日付が変わった瞬間にページを再取得し、当日分のトークン付きQRへ自動的に切り替える。
// 加えて、タブレットのスリープ復帰でsetTimeoutが遅延・消失するケースの保険として、
// 復帰イベント（visibilitychange）と定期チェック（60秒間隔）でも日付のズレを検知する。

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** ローカル日付を "YYYY-MM-DD" 文字列にする（比較用。表示フォーマットは他の日付ユーティリティと揃えない簡易実装） */
function localDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function DailyAutoRefresh({ onRefresh }: { onRefresh?: () => void }) {
  const router = useRouter();
  // CSR化されたページ（クライアント側fetchで表示している）ではrouter.refresh()が
  // 効かないため、onRefreshが指定されていればそちらを使う（管理者画面用）
  const refresh = onRefresh ?? (() => router.refresh());

  useEffect(() => {
    const now = new Date();
    // 日付境界の判定ズレを避けるため、日付が変わった5秒後に更新する
    const nextRefresh = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      5,
    );
    const ms = nextRefresh.getTime() - now.getTime();
    const timer = setTimeout(refresh, ms);

    // 保険: マウント時点の日付を記録し、スリープ復帰・定期チェックで不一致を検知したら更新する
    const mountedDate = localDateString(now);
    const checkDateChanged = () => {
      if (localDateString(new Date()) !== mountedDate) refresh();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") checkDateChanged();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const interval = setInterval(checkDateChanged, 60_000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
