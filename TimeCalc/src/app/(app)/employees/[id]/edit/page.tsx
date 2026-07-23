"use client";

// 社員情報の編集 ※管理者のみ

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useRequireAuth } from "@/lib/auth/client";
import { apiFetchJson } from "@/lib/auth/api-fetch";
import { Card, PageHeader } from "@/components/ui";
import { EmployeeForm } from "../../employee-form";
import type { EmployeeDetailValues, FormOptionsResponse } from "../../types";

export default function EditEmployeePage() {
  const { status: authStatus } = useRequireAuth();
  const params = useParams<{ id: string }>();

  const [options, setOptions] = useState<FormOptionsResponse | null>(null);
  const [employee, setEmployee] = useState<EmployeeDetailValues | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    let cancelled = false;
    Promise.all([
      apiFetchJson<FormOptionsResponse>("/api/employees/form-options"),
      apiFetchJson<EmployeeDetailValues>(`/api/employees/${params.id}`),
    ])
      .then(([opt, emp]) => {
        if (cancelled) return;
        setOptions(opt);
        setEmployee(emp);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, params.id]);

  if (authStatus === "unauthenticated") return null;
  if (authStatus === "loading" || !options || !employee) {
    return <p className="py-8 text-center text-sm text-muted">読み込み中...</p>;
  }
  if (error) {
    return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>;
  }

  return (
    <>
      <PageHeader title="社員情報を編集" description={`社員番号 ${employee.employeeCode}`} />
      <Card className="max-w-2xl">
        <EmployeeForm
          departments={options.departments}
          roleLabels={options.roleLabels}
          showMoney={options.showMoney}
          values={employee}
        />
      </Card>
    </>
  );
}
