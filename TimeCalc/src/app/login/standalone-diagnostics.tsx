"use client";

// 一時的な診断表示。iOSのホーム画面アプリ（standalone表示）でだけ、入力欄への
// タッチ/フォーカスがどこまで届いているかを画面に出す。原因が判明したら丸ごと削除する。

import { useState, useSyncExternalStore, type SyntheticEvent } from "react";
import { isStandaloneDisplay } from "@/lib/auth/client";

interface Diagnostics {
  standalone: boolean;
  ua: string;
  events: string[];
}

const subscribeNever = () => () => {};

/** この画面に「通常のページ読み込み」で来たか「アプリ内遷移」で来たかを示す */
function describeArrival(): string {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return `arrived: load=${nav?.name ?? "?"} now=${location.pathname}${location.search}`;
}

export function useStandaloneDiagnostics() {
  // サーバー描画時は false / "" にしてハイドレーション差分を出さない
  const standalone = useSyncExternalStore(subscribeNever, isStandaloneDisplay, () => false);
  const ua = useSyncExternalStore(subscribeNever, () => navigator.userAgent, () => "");
  const arrival = useSyncExternalStore(subscribeNever, describeArrival, () => "");
  const [events, setEvents] = useState<string[]>([]);

  const record = (name: string) => (e: SyntheticEvent) => {
    const target = e.target as HTMLElement;
    const active = document.activeElement as HTMLElement | null;
    const vvHeight = window.visualViewport ? Math.round(window.visualViewport.height) : "-";
    const line = `${name} ${target.id || target.tagName} active=${active?.id || active?.tagName || "-"} vv=${vvHeight} inner=${window.innerHeight}`;
    setEvents((prev) => [...prev.slice(-9), line]);
  };

  const handlers = {
    onPointerDown: record("pointerdown"),
    onTouchStart: record("touchstart"),
    onTouchEnd: record("touchend"),
    onClick: record("click"),
    onFocus: record("focus"),
    onBlur: record("blur"),
  };

  return { standalone, ua, arrival, events, handlers };
}

export function StandaloneDiagnostics({
  standalone,
  ua,
  arrival,
  events,
  note,
}: Diagnostics & { arrival: string; note?: string }) {
  if (!standalone) return null;
  // 画面下部に固定し、記録が増えてもフォームの位置が動かないようにする（タップ判定への影響を排除）
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 max-h-[38vh] overflow-hidden bg-gray-100/95 p-2 font-mono text-[10px] leading-snug break-all text-gray-600">
      <p className="font-semibold">診断（ホーム画面アプリ）{note ? ` ${note}` : ""}</p>
      <p>{ua}</p>
      <p>{arrival}</p>
      {events.length === 0 ? (
        <p>入力欄をタップすると記録が出ます</p>
      ) : (
        events.map((line, i) => <p key={i}>{line}</p>)
      )}
    </div>
  );
}
