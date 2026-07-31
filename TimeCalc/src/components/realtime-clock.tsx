"use client";

// リアルタイム時計（秒単位で更新されるデジタル時計＋日付・曜日）
// 打刻画面と部署QR表示画面（管理者・キオスク共通）で使う。

import { useSyncExternalStore } from "react";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// 現在時刻（秒精度）を外部ストアとして購読する。
// サーバースナップショットは 0 を返し、ハイドレーション不一致を避ける
// （マウント後の最初の購読で実時刻に切り替わる）。
function subscribe(onTick: () => void): () => void {
  const timer = setInterval(onTick, 250);
  return () => clearInterval(timer);
}
const getSeconds = () => Math.floor(Date.now() / 1000);
const getServerSeconds = () => 0;

export function RealtimeClock() {
  const seconds = useSyncExternalStore(subscribe, getSeconds, getServerSeconds);
  const now = seconds === 0 ? null : new Date(seconds * 1000);

  return (
    <div className="text-center" aria-live="off">
      <p className="text-sm text-muted">
        {now
          ? `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（${WEEKDAYS[now.getDay()]}）`
          : " "}
      </p>
      <p className="mt-1 font-mono text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl">
        {now ? (
          <>
            {pad(now.getHours())}:{pad(now.getMinutes())}
            <span className="text-2xl text-muted sm:text-3xl">:{pad(now.getSeconds())}</span>
          </>
        ) : (
          "--:--"
        )}
      </p>
    </div>
  );
}
