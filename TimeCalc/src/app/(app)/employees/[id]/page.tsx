"use client";

// 社員詳細（締め期間の日別勤務・残業・金額の一覧と月度合計）

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useRequireAuth } from "@/lib/auth/client";
import { apiFetchJson } from "@/lib/auth/api-fetch";
import { formatYen } from "@/lib/attendance/calculator";
import { formatMinutes } from "@/lib/utils/time";
import { Badge, Card, PageHeader, StatCard } from "@/components/ui";
import { MonthPicker } from "@/components/month-picker";
import { AttendanceEditor } from "./attendance-editor";
import type { EmployeeDetailResponse } from "./types";

/** 修正履歴の変更内容を「前 → 後」で表示する */
function formatLogChange(before: string | null, after: string | null): string {
  const fmt = (json: string | null): string => {
    if (!json) return "なし";
    try {
      const v = JSON.parse(json) as { clockIn?: string; clockOut?: string; breakMinutes?: number };
      return `${v.clockIn ?? "?"}〜${v.clockOut ?? "?"}・休憩${v.breakMinutes ?? 0}分`;
    } catch {
      return "?";
    }
  };
  return `${fmt(before)} → ${fmt(after)}`;
}

export default function EmployeeDetailPage() {
  const { status: authStatus } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const month = searchParams.get("month") ?? "";

  const [data, setData] = useState<EmployeeDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    const qs = new URLSearchParams();
    if (month) qs.set("month", month);

    let cancelled = false;
    apiFetchJson<EmployeeDetailResponse>(`/api/employees/${params.id}/detail?${qs.toString()}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, params.id, month, refreshKey]);

  if (authStatus === "unauthenticated") return null;
  if (authStatus === "loading" || !data) {
    return <p className="py-8 text-center text-sm text-muted">読み込み中...</p>;
  }
  if (error) {
    return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>;
  }

  const showMoney = data.showMoney;

  return (
    <>
      <PageHeader
        title={data.employee.name}
        description={`社員番号 ${data.employee.employeeCode} ・ ${data.employee.departmentName ?? "部署未設定"}${showMoney ? ` ・ 時給 ${formatYen(data.employee.hourlyWage)}` : ""}`}
        action={
          <form method="get">
            <MonthPicker defaultValue={data.month} />
          </form>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={data.employee.isActive ? "green" : "red"}>
          {data.employee.isActive ? "在籍中" : "退職済"}
        </Badge>
        <Badge tone="purple">{data.roleLabels[data.employee.role]}</Badge>
        <Badge tone="gray">
          {data.year}年{data.monthNum}月度（{data.periodRangeLabel}・締め{data.closingDay}日）
        </Badge>
        {showMoney && data.employee.hourlyWage === 0 && (
          <Badge tone="amber">時給未設定（金額は¥0になります）</Badge>
        )}
      </div>

      <div
        className={`mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 ${showMoney ? "lg:grid-cols-6" : "lg:grid-cols-5"}`}
      >
        <StatCard label="勤務日数" value={`${data.summary.workDays}日`} />
        <StatCard label="勤務時間" value={formatMinutes(data.monthTotal.workMinutes)} />
        <StatCard label="早出残業" value={formatMinutes(data.monthTotal.earlyOvertimeMinutes)} tone="amber" />
        <StatCard label="残業時間" value={formatMinutes(data.monthTotal.overtimeMinutes)} tone="amber" />
        <StatCard
          label="遅刻・早退"
          value={`${data.summary.lateCount}・${data.summary.earlyLeaveCount}回`}
          sub={
            data.summary.lateMinutes + data.summary.earlyLeaveMinutes > 0
              ? `計${formatMinutes(data.summary.lateMinutes + data.summary.earlyLeaveMinutes)}`
              : undefined
          }
          tone={data.summary.lateCount + data.summary.earlyLeaveCount > 0 ? "amber" : "default"}
        />
        {showMoney && (
          <StatCard
            label="支給額（概算）"
            value={formatYen(data.payTotal.totalPay)}
            sub={`金額 ${formatYen(data.payTotal.basePay)} ＋ 残業代 ${formatYen(data.payTotal.premiumPay)}`}
            tone="primary"
          />
        )}
      </div>

      <Card className="overflow-x-auto p-0">
        <AttendanceEditor
          userId={data.employee.id}
          rows={data.rows}
          editable={data.editable}
          showMoney={showMoney}
          onChanged={refetch}
        />
      </Card>

      {data.logs.length > 0 && (
        <Card className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-muted">修正履歴（この月度・直近30件）</h2>
          <ul className="divide-y divide-border">
            {data.logs.map((log) => (
              <li key={log.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="font-medium">{log.date}</span>
                <Badge
                  tone={
                    log.action === "DELETE" || log.action === "REJECT"
                      ? "red"
                      : log.action === "APPROVE"
                        ? "green"
                        : "gray"
                  }
                >
                  {log.action === "EDIT"
                    ? "修正"
                    : log.action === "DELETE"
                      ? "削除"
                      : log.action === "APPROVE"
                        ? "申請承認"
                        : "申請却下"}
                </Badge>
                <span className="font-mono text-xs tabular-nums text-muted">
                  {formatLogChange(log.before, log.after)}
                </span>
                <span className="text-xs text-muted">
                  {log.actorName ?? "（削除済みユーザー）"} ・ {log.createdAtLabel}
                </span>
                {log.note && <span className="text-xs text-muted">（{log.note}）</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
