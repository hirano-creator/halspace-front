"use client";

// 社員管理（一覧・検索・ページング）※管理者のみ

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRequireAuth } from "@/lib/auth/client";
import { apiFetchJson } from "@/lib/auth/api-fetch";
import {
  Badge,
  Card,
  PageHeader,
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
  tdClass,
  thClass,
} from "@/components/ui";
import { DeleteEmployeeButton } from "./delete-button";
import type { EmployeesPageResponse } from "./types";

export default function EmployeesPage() {
  const { status: authStatus } = useRequireAuth();
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const departmentId = searchParams.get("department") ?? "";
  const status = searchParams.get("status") ?? "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const [data, setData] = useState<EmployeesPageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    const qs = new URLSearchParams();
    if (query) qs.set("q", query);
    if (departmentId) qs.set("department", departmentId);
    if (status) qs.set("status", status);
    if (page > 1) qs.set("page", String(page));

    let cancelled = false;
    apiFetchJson<EmployeesPageResponse>(`/api/employees?${qs.toString()}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, query, departmentId, status, page, refreshKey]);

  if (authStatus === "unauthenticated") return null;
  if (authStatus === "loading" || !data) {
    return <p className="py-8 text-center text-sm text-muted">読み込み中...</p>;
  }
  if (error) {
    return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>;
  }

  const pageUrl = (p: number) => {
    const qs = new URLSearchParams();
    if (query) qs.set("q", query);
    if (departmentId) qs.set("department", departmentId);
    if (status) qs.set("status", status);
    if (p > 1) qs.set("page", String(p));
    const s = qs.toString();
    return `/employees${s ? `?${s}` : ""}`;
  };

  const showMoney = data.showMoney;

  return (
    <>
      <PageHeader
        title="社員管理"
        description={`全${data.total}名${data.totalPages > 1 ? `（${data.page}/${data.totalPages}ページ）` : ""}`}
        action={
          <div className="flex gap-2">
            <Link href="/employees/bulk" className={buttonSecondaryClass}>
              CSV一括登録
            </Link>
            <Link href="/employees/new" className={buttonPrimaryClass}>
              社員を登録
            </Link>
          </div>
        }
      />

      <Card className="mb-6">
        <form method="get" className="flex flex-wrap items-end gap-4">
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
          <div>
            <label htmlFor="department" className="mb-1 block text-xs font-medium text-muted">
              部署
            </label>
            <select id="department" name="department" defaultValue={departmentId} className={inputClass}>
              <option value="">すべての部署</option>
              {data.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="status" className="mb-1 block text-xs font-medium text-muted">
              在籍状況
            </label>
            <select id="status" name="status" defaultValue={status} className={inputClass}>
              <option value="">すべて</option>
              <option value="active">在籍中のみ</option>
              <option value="inactive">退職済のみ</option>
            </select>
          </div>
          <button type="submit" className={buttonSecondaryClass}>
            検索
          </button>
        </form>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px]">
          <thead className="border-b border-border bg-gray-50/50">
            <tr>
              <th className={thClass}>社員番号</th>
              <th className={thClass}>氏名</th>
              <th className={thClass}>メール</th>
              <th className={thClass}>部署</th>
              <th className={thClass}>権限</th>
              {showMoney && <th className={`${thClass} text-right`}>時給</th>}
              <th className={thClass}>状態</th>
              <th className={thClass}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.employees.length === 0 && (
              <tr>
                <td colSpan={showMoney ? 8 : 7} className={`${tdClass} py-10 text-center text-muted`}>
                  該当する社員がいません
                </td>
              </tr>
            )}
            {data.employees.map((e) => (
              <tr key={e.id} className="transition hover:bg-gray-50/60">
                <td className={tdClass}>{e.employeeCode}</td>
                <td className={tdClass}>
                  <Link href={`/employees/${e.id}`} className="font-medium text-primary hover:underline">
                    {e.name}
                  </Link>
                </td>
                <td className={`${tdClass} text-muted`}>{e.email ?? "-"}</td>
                <td className={`${tdClass} text-muted`}>{e.departmentLabel ?? "-"}</td>
                <td className={tdClass}>
                  <Badge tone="purple">{data.roleLabels[e.role]}</Badge>
                </td>
                {showMoney && (
                  <td className={`${tdClass} text-right`}>
                    {e.hourlyWage > 0 ? (
                      `¥${e.hourlyWage.toLocaleString("ja-JP")}`
                    ) : (
                      <span className="text-xs text-amber-600">未設定</span>
                    )}
                  </td>
                )}
                <td className={tdClass}>
                  <Badge tone={e.isActive ? "green" : "red"}>{e.isActive ? "在籍中" : "退職済"}</Badge>
                </td>
                <td className={`${tdClass} text-right`}>
                  <span className="whitespace-nowrap">
                    <Link href={`/employees/${e.id}/edit`} className="text-sm text-primary hover:underline">
                      編集
                    </Link>
                    {e.id !== data.viewerId && (
                      <span className="ml-3">
                        <DeleteEmployeeButton employeeId={e.id} employeeName={e.name} onDeleted={refetch} />
                      </span>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          {data.page > 1 ? (
            <Link href={pageUrl(data.page - 1)} className={buttonSecondaryClass}>
              前へ
            </Link>
          ) : (
            <span className={`${buttonSecondaryClass} pointer-events-none opacity-40`}>前へ</span>
          )}
          <span className="text-muted">
            {data.page} / {data.totalPages}
          </span>
          {data.page < data.totalPages ? (
            <Link href={pageUrl(data.page + 1)} className={buttonSecondaryClass}>
              次へ
            </Link>
          ) : (
            <span className={`${buttonSecondaryClass} pointer-events-none opacity-40`}>次へ</span>
          )}
        </div>
      )}
    </>
  );
}
