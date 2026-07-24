"use client";

// 修正申請の承認画面（管理者・店長のみ。店長は自部署の申請のみ表示）

import { useCallback, useEffect, useState } from "react";
import { useRequireAuth } from "@/lib/auth/client";
import { apiFetchJson } from "@/lib/auth/api-fetch";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ReviewList } from "./review-list";
import type { CorrectionsPageResponse } from "./types";

export default function CorrectionsPage() {
  const { status: authStatus } = useRequireAuth();
  const [data, setData] = useState<CorrectionsPageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    let cancelled = false;
    apiFetchJson<CorrectionsPageResponse>("/api/corrections")
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, refreshKey]);

  if (authStatus === "unauthenticated") return null;
  if (authStatus === "loading" || !data) {
    return <p className="py-8 text-center text-sm text-muted">読み込み中...</p>;
  }
  if (error) {
    return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>;
  }

  return (
    <>
      <PageHeader
        title="修正申請"
        description="押し忘れ・誤打刻の修正申請を承認すると勤怠に反映されます（修正履歴が残ります）"
      />

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-muted">承認待ち（{data.pending.length}件）</h2>
        <ReviewList rows={data.pending} onResolved={refetch} />
      </Card>

      <Card className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-muted">処理済み（直近20件）</h2>
        {data.resolved.length === 0 ? (
          <p className="text-sm text-muted">処理済みの申請はありません</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.resolved.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                <span className="font-medium">{r.userName}</span>
                <span>{r.date}</span>
                <span className="font-mono text-xs tabular-nums text-muted">
                  {r.clockIn ?? "未出勤"}〜{r.clockOut ?? "未退勤"}・休憩{r.breakMinutes}分
                </span>
                <Badge tone={r.status === "APPROVED" ? "green" : "red"}>
                  {r.status === "APPROVED" ? "承認済み" : "却下"}
                </Badge>
                <span className="text-xs text-muted">
                  {r.reviewedByName ?? "-"}
                  {r.reviewedAtLabel ? ` ・ ${r.reviewedAtLabel}` : ""}
                </span>
                {r.reviewNote && <span className="text-xs text-muted">（{r.reviewNote}）</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
