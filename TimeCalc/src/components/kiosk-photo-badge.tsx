"use client";

// 「店舗端末で打刻」バッジ（スマホを忘れたスタッフが店舗タブレットで打刻した日に表示）
// 押すと、その日の店舗端末打刻と撮影写真をモーダルで表示する。
// 写真APIは Bearer 認証なので <img src> に直接URLは渡せず、apiFetch で取得して blob URL で表示する。

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth/api-fetch";
import { CLOCK_EVENT_LABELS, type ClockEventType } from "@/lib/attendance/clock";

export interface KioskPunchInfo {
  eventId: string;
  type: ClockEventType;
  time: string;
  hasPhoto: boolean;
}

function KioskPhoto({ eventId }: { eventId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    apiFetch(`/api/clock-events/${eventId}/photo`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "写真を表示できませんでした");
        }
        const blob = await res.blob();
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "写真を表示できませんでした");
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [eventId]);

  if (error) return <p className="text-sm text-muted">{error}</p>;
  if (!src) return <p className="text-sm text-muted">読み込み中...</p>;
  // blob URL のため next/image は使えない
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="打刻時の写真" className="max-h-72 w-auto rounded-lg border border-border" />;
}

export function KioskPhotoBadge({ punches, dateLabel }: { punches: KioskPunchInfo[]; dateLabel: string }) {
  const [open, setOpen] = useState(false);
  if (punches.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-700 hover:bg-sky-200 print:hidden"
        title="スマホを忘れて店舗の端末で打刻した日です。押すと写真を確認できます"
      >
        📷 店舗端末
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:hidden"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">{dateLabel} 店舗端末での打刻</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-sm text-primary underline">
                閉じる
              </button>
            </div>
            <ul className="space-y-4">
              {punches.map((p) => (
                <li key={p.eventId}>
                  <p className="mb-1 text-sm font-medium">
                    {CLOCK_EVENT_LABELS[p.type]} {p.time}
                  </p>
                  {p.hasPhoto ? (
                    <KioskPhoto eventId={p.eventId} />
                  ) : (
                    <p className="text-sm text-muted">写真なし（保存に失敗しました）</p>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted">写真は撮影から90日で自動削除されます。</p>
          </div>
        </div>
      )}
    </>
  );
}
