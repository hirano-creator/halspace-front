"use client";

// マイページ（本人の勤怠確認）
// 全社員がログイン後すぐ自分の勤怠を確認できるページ。
// 当月の日別一覧・遅刻/早退/未退勤バッジ・月次集計・修正申請の入口を集約する。

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRequireAuth } from "@/lib/auth/client";
import { apiFetchJson } from "@/lib/auth/api-fetch";
import { formatMinutes } from "@/lib/utils/time";
import { Card, PageHeader, StatCard, buttonPrimaryClass } from "@/components/ui";
import { MonthPicker } from "@/components/month-picker";
import { MyAttendanceTable } from "./my-attendance-table";
import { MyRequests } from "./my-requests";
import type { MyPageResponse } from "./types";

export default function MyPage() {
  const { status: authStatus } = useRequireAuth();
  const searchParams = useSearchParams();
  const monthParam = searchParams.get("month") ?? "";

  const [data, setData] = useState<MyPageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    const qs = new URLSearchParams();
    if (monthParam) qs.set("month", monthParam);

    let cancelled = false;
    apiFetchJson<MyPageResponse>(`/api/my?${qs.toString()}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, monthParam, refreshKey]);

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
        title="マイページ"
        description={`${data.me.name} ・ ${data.me.departmentName ?? "部署未設定"} ・ ${data.year}年${data.monthNum}月度（${data.periodRangeLabel}）`}
        action={
          <div className="flex items-center gap-2">
            <form method="get">
              <MonthPicker defaultValue={data.month} />
            </form>
            <Link href="/clock" className={buttonPrimaryClass}>
              打刻する
            </Link>
          </div>
        }
      />

      {data.openCount > 0 && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          退勤打刻のない日が{data.openCount}日あります。下の一覧から
          {data.selfEditMode === "direct" ? "修正" : "修正申請"}してください。
        </div>
      )}

      {data.showMonthlySummary && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="出勤日数" value={`${data.summary.workDays}日`} />
          <StatCard
            label="勤務時間"
            value={formatMinutes(
              data.summary.normalMinutes + (data.summary.earlyMinutes - data.summary.earlyOvertimeMinutes),
            )}
          />
          <StatCard
            label="早出残業"
            value={formatMinutes(data.summary.earlyOvertimeMinutes)}
            tone={data.summary.earlyOvertimeMinutes > 0 ? "amber" : "default"}
          />
          <StatCard label="残業時間" value={formatMinutes(data.summary.overtimeMinutes)} tone="amber" />
          <StatCard
            label="遅刻"
            value={`${data.summary.lateCount}回`}
            sub={data.summary.lateMinutes > 0 ? `計${formatMinutes(data.summary.lateMinutes)}` : undefined}
            tone={data.summary.lateCount > 0 ? "amber" : "default"}
          />
          <StatCard
            label="早退"
            value={`${data.summary.earlyLeaveCount}回`}
            sub={
              data.summary.earlyLeaveMinutes > 0
                ? `計${formatMinutes(data.summary.earlyLeaveMinutes)}`
                : undefined
            }
            tone={data.summary.earlyLeaveCount > 0 ? "amber" : "default"}
          />
        </div>
      )}

      <Card className="overflow-x-auto p-0">
        <MyAttendanceTable rows={data.rows} selfEditMode={data.selfEditMode} onSaved={refetch} />
      </Card>

      <Card className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-muted">修正申請の履歴</h2>
        <MyRequests requests={data.requests} onCancelled={refetch} />
      </Card>
    </>
  );
}
