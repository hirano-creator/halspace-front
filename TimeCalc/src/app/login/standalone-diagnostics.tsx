"use client";

// 一時的な診断表示。iOSのホーム画面アプリ（standalone表示）でだけ、入力欄への
// タッチ/フォーカスがどこまで届いているかを画面に出す。原因が判明したら丸ごと削除する。

import { useState, useSyncExternalStore, type SyntheticEvent } from "react";

interface Diagnostics {
  standalone: boolean;
  ua: string;
  events: string[];
}

const subscribeNever = () => () => {};

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

export function useStandaloneDiagnostics() {
  // サーバー描画時は false / "" にしてハイドレーション差分を出さない
  const standalone = useSyncExternalStore(subscribeNever, isStandalone, () => false);
  const ua = useSyncExternalStore(subscribeNever, () => navigator.userAgent, () => "");
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

  return { standalone, ua, events, handlers };
}

export function StandaloneDiagnostics({ standalone, ua, events, note }: Diagnostics & { note?: string }) {
  if (!standalone) return null;
  return (
    <div className="mt-4 rounded-md bg-gray-100 p-2 font-mono text-[10px] leading-snug break-all text-gray-600">
      <p className="font-semibold">診断（ホーム画面アプリ）{note ? ` ${note}` : ""}</p>
      <p>{ua}</p>
      {events.length === 0 ? (
        <p>入力欄をタップすると記録が出ます</p>
      ) : (
        events.map((line, i) => <p key={i}>{line}</p>)
      )}
    </div>
  );
}
