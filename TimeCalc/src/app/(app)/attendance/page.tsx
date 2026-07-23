"use client";

// 勤怠一覧（会社・部署・社員・月検索 → 社員別月次集計）

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRequireAuth } from "@/lib/auth/client";
import { apiFetchJson, downloadFile } from "@/lib/auth/api-fetch";
import { formatYen } from "@/lib/attendance/calculator";
import { formatMinutes } from "@/lib/utils/time";
import {
  Card,
  PageHeader,
  buttonSecondaryClass,
  inputClass,
  tdClass,
  thClass,
} from "@/components/ui";
import { MonthPicker } from "@/components/month-picker";
import type { AttendancePageResponse } from "./types";

export default function AttendancePage() {
  const { status: authStatus } = useRequireAuth();
  const searchParams = useSearchParams();
  const month = searchParams.get("month") ?? "";
  const query = searchParams.get("q") ?? "";
  const departmentId = searchParams.get("department") ?? "";
  const companyId = searchParams.get("company") ?? "";

  const [data, setData] = useState<AttendancePageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<"summary" | "daily" | null>(null);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    const qs = new URLSearchParams();
    if (month) qs.set("month", month);
    if (query) qs.set("q", query);
    if (departmentId) qs.set("department", departmentId);
    if (companyId) qs.set("company", companyId);

    let cancelled = false;
    apiFetchJson<AttendancePageResponse>(`/api/attendance?${qs.toString()}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, month, query, departmentId, companyId]);

  if (authStatus === "unauthenticated") return null;
  if (authStatus === "loading" || !data) {
    return <p className="py-8 text-center text-sm text-muted">読み込み中...</p>;
  }
  if (error) {
    return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>;
  }

  const exportParams = new URLSearchParams({ month: data.month });
  if (departmentId) exportParams.set("department", departmentId);
  if (companyId) exportParams.set("company", companyId);
  if (query) exportParams.set("q", query);
  const exportUrl = `/api/export?${exportParams.toString()}`;

  async function handleDownload(type: "summary" | "daily") {
    setDownloading(type);
    try {
      await downloadFile(type === "daily" ? `${exportUrl}&type=daily` : exportUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ダウンロードに失敗しました");
    } finally {
      setDownloading(null);
    }
  }

  const showMoney = data.showMoney;
  const columnCount = showMoney ? 10 : 9;

  return (
    <>
      <PageHeader
        title="勤怠一覧"
        description={`${data.year}年${data.monthNum}月度（${data.periodRangeLabel}・締め${data.closingDay}日）の社員別集計${
          !companyId && data.hasCompanyRules
            ? "。会社別に勤務ルールを設定している場合、各社員はその会社のルール・締め期間で計算されます"
            : ""
        }`}
        action={
          data.canExport ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleDownload("summary")}
                disabled={downloading !== null}
                className={buttonSecondaryClass}
              >
                {downloading === "summary" ? "出力中..." : "集計CSV出力"}
              </button>
              <button
                type="button"
                onClick={() => handleDownload("daily")}
                disabled={downloading !== null}
                className={buttonSecondaryClass}
              >
                {downloading === "daily" ? "出力中..." : "明細CSV出力"}
              </button>
            </div>
          ) : undefined
        }
      />

      <Card className="mb-6">
        <form method="get" className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="month" className="mb-1 block text-xs font-medium text-muted">
              対象月度（選ぶと自動で切り替え）
            </label>
            <MonthPicker defaultValue={data.month} />
          </div>
          <div>
            <label htmlFor="q" className="mb-1 block text-xs font-medium text-muted">
              社員検索
            </label>
            <input
              id="q"
              type="text"
              name="q"
              defaultValue={query}
              placeholder="氏名・社員番号"
              className={inputClass}
            />
          </div>
          {data.showFilters && data.companies.length > 0 && (
            <div>
              <label htmlFor="company" className="mb-1 block text-xs font-medium text-muted">
                会社
              </label>
              <select id="company" name="company" defaultValue={companyId} className={inputClass}>
                <option value="">すべての会社</option>
                {data.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {data.showFilters && (
            <div>
              <label htmlFor="department" className="mb-1 block text-xs font-medium text-muted">
                部署
              </label>
              <select id="department" name="department" defaultValue={departmentId} className={inputClass}>
                <option value="">すべての部署</option>
                {data.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.companyName ? `${d.companyName} / ${d.name}` : d.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button type="submit" className={buttonSecondaryClass}>
            検索
          </button>
        </form>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[860px]">
          <thead className="border-b border-border bg-gray-50/50">
            <tr>
              <th className={thClass}>社員番号</th>
              <th className={thClass}>氏名</th>
              <th className={thClass}>部署</th>
              <th className={`${thClass} text-right`}>勤務日数</th>
              <th className={`${thClass} text-right`}>勤務時間</th>
              <th className={`${thClass} text-right`}>早出残業</th>
              <th className={`${thClass} text-right`}>残業時間</th>
              <th className={`${thClass} text-right`}>遅刻</th>
              <th className={`${thClass} text-right`}>早退</th>
              {showMoney && <th className={`${thClass} text-right`}>支給額（概算）</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.summaries.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className={`${tdClass} py-10 text-center text-muted`}>
                  該当する勤怠データがありません
                </td>
              </tr>
            ) : (
              data.summaries.map((s) => (
                <tr key={s.userId} className="transition hover:bg-gray-50/60">
                  <td className={tdClass}>{s.employeeCode}</td>
                  <td className={tdClass}>
                    <Link
                      href={`/employees/${s.userId}?month=${data.month}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {s.userName}
                    </Link>
                  </td>
                  <td className={`${tdClass} text-muted`}>{s.departmentName ?? "-"}</td>
                  <td className={`${tdClass} whitespace-nowrap text-right`}>{s.summary.workDays}日</td>
                  <td className={`${tdClass} whitespace-nowrap text-right`}>
                    {formatMinutes(s.summary.normalMinutes + (s.summary.earlyMinutes - s.summary.earlyOvertimeMinutes))}
                  </td>
                  <td
                    className={`${tdClass} whitespace-nowrap text-right ${
                      s.summary.earlyOvertimeMinutes > 0 ? "font-medium text-amber-600" : "text-muted"
                    }`}
                  >
                    {formatMinutes(s.summary.earlyOvertimeMinutes)}
                  </td>
                  <td
                    className={`${tdClass} whitespace-nowrap text-right ${
                      s.summary.overtimeMinutes > 0 ? "font-medium text-amber-600" : "text-muted"
                    }`}
                  >
                    {formatMinutes(s.summary.overtimeMinutes)}
                  </td>
                  <td
                    className={`${tdClass} whitespace-nowrap text-right ${
                      s.summary.lateCount > 0 ? "font-medium text-amber-600" : "text-muted"
                    }`}
                  >
                    {s.summary.lateCount}回
                  </td>
                  <td
                    className={`${tdClass} whitespace-nowrap text-right ${
                      s.summary.earlyLeaveCount > 0 ? "font-medium text-amber-600" : "text-muted"
                    }`}
                  >
                    {s.summary.earlyLeaveCount}回
                  </td>
                  {showMoney && (
                    <td className={`${tdClass} whitespace-nowrap text-right font-semibold`}>
                      {s.hourlyWage > 0 ? (
                        formatYen(s.pay.totalPay)
                      ) : (
                        <span className="text-xs font-normal text-amber-600">時給未設定</span>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
