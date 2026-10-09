"use client";

// 店舗掲示用の大きな時計（打刻QR画面・スマホ忘れ打刻画面の色面に置く）
// 文字サイズは置き場所（色面）の幅に合わせる。親に @container を付けること。

import { formatJaDate, useNowSeconds } from "@/components/realtime-clock";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function BigClock({ size = "xl" }: { size?: "xl" | "lg" }) {
  const now = useNowSeconds();
  const sizeClass =
    size === "xl" ? "text-[clamp(64px,24cqw,168px)]" : "text-[clamp(56px,20cqw,120px)]";

  return (
    <div aria-live="off">
      <p className="text-base font-medium opacity-90 sm:text-lg">{now ? formatJaDate(now) : " "}</p>
      <p className={`mt-1 font-bold leading-[0.9] tracking-[-0.04em] tabular-nums ${sizeClass}`}>
        {now ? (
          <>
            {now.getHours()}:{pad(now.getMinutes())}
            <span className="ml-[0.08em] text-[0.36em] font-medium opacity-55">:{pad(now.getSeconds())}</span>
          </>
        ) : (
          "--:--"
        )}
      </p>
    </div>
  );
}
