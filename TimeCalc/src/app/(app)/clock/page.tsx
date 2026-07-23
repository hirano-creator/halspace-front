"use client";

// 打刻画面（PC/スマホ共通、QRコード経由の ?dept=&token= クエリにも対応）
// タイムレコーダーの体験を再現する: リアルタイム時計を見ながらワンタップで打刻する。

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRequireAuth } from "@/lib/auth/client";
import { apiFetchJson } from "@/lib/auth/api-fetch";
import type { ClockPhase } from "@/lib/attendance/clock";
import { Card } from "@/components/ui";
import { ClockButtons } from "./clock-buttons";
import { AutoPunch } from "./auto-punch";
import { RealtimeClock } from "@/components/realtime-clock";
import { Timeline } from "./timeline";
import type { ClockStatusResponse } from "./types";

/** フェーズごとの状態表示（ラベルと色） */
function phaseBadge(phase: ClockPhase, hasEventsToday: boolean) {
  switch (phase) {
    case "working":
      return { label: "出勤中", className: "bg-emerald-100 text-emerald-700" };
    case "outing":
      return { label: "外出中", className: "bg-amber-100 text-amber-700" };
    case "offWork":
      return hasEventsToday
        ? { label: "退勤済み", className: "bg-violet-100 text-violet-700" }
        : { label: "未出勤", className: "bg-gray-100 text-gray-600" };
    default:
      return { label: "未出勤", className: "bg-gray-100 text-gray-600" };
  }
}

export default function ClockPage() {
  const { status: authStatus } = useRequireAuth();
  const searchParams = useSearchParams();
  const dept = searchParams.get("dept") ?? "";
  const token = searchParams.get("token") ?? "";
  const kind = searchParams.get("kind") ?? "";

  const [data, setData] = useState<ClockStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    const qs = new URLSearchParams();
    if (dept) qs.set("dept", dept);
    if (token) qs.set("token", token);
    if (kind) qs.set("kind", kind);

    let cancelled = false;
    apiFetchJson<ClockStatusResponse>(`/api/clock/status?${qs.toString()}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, dept, token, kind, refreshKey]);

  if (authStatus === "unauthenticated") return null;
  if (authStatus === "loading" || !data) {
    return <p className="py-8 text-center text-sm text-muted">読み込み中...</p>;
  }
  if (error) {
    return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>;
  }

  const badge = phaseBadge(data.status.phase, data.events.length > 0);

  return (
    <div className="mx-auto max-w-md">
      <Card className="space-y-6">
        <RealtimeClock />

        <div className="flex items-center justify-center gap-3">
          <p className="text-sm font-medium">{data.viewer.name}さん</p>
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${badge.className}`}
          >
            {badge.label}
          </span>
        </div>
        {data.department && (
          <p className="-mt-4 text-center text-xs text-muted">{data.department.name}</p>
        )}

        {data.qrTokenError ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{data.qrTokenError}</p>
        ) : data.needsGuidance ? (
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-muted">
            店舗の「出勤・退勤」または「外出・戻り」QRコードを読み取ってください
          </p>
        ) : data.clockMode === "qrScan" && data.qrKind === "attend" ? (
          <AutoPunch
            departmentId={data.requestedDeptId as string}
            token={token || null}
            onPunched={refetch}
          />
        ) : (
          <ClockButtons
            departmentId={data.requestedDeptId}
            token={token || null}
            kind={data.qrKind}
            mode={data.qrKind ?? "full"}
            canClockIn={data.status.canClockIn}
            canClockOut={data.status.canClockOut}
            canOutStart={data.status.canOutStart}
            canOutEnd={data.status.canOutEnd}
            onPunched={refetch}
          />
        )}
      </Card>

      <Card className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-muted">本日の打刻</h2>
        <Timeline events={data.events} />
      </Card>
    </div>
  );
}
