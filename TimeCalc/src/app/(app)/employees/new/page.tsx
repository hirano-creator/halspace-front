"use client";

// 社員の新規登録 ※管理者のみ

import { useEffect, useState } from "react";
import { useRequireAuth } from "@/lib/auth/client";
import { apiFetchJson } from "@/lib/auth/api-fetch";
import { Card, PageHeader } from "@/components/ui";
import { EmployeeForm } from "../employee-form";
import type { FormOptionsResponse } from "../types";

export default function NewEmployeePage() {
  const { status: authStatus } = useRequireAuth();
  const [options, setOptions] = useState<FormOptionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    let cancelled = false;
    apiFetchJson<FormOptionsResponse>("/api/employees/form-options")
      .then((res) => {
        if (!cancelled) setOptions(res);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus]);

  if (authStatus === "unauthenticated") return null;
  if (authStatus === "loading" || !options) {
    return <p className="py-8 text-center text-sm text-muted">読み込み中...</p>;
  }
  if (error) {
    return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>;
  }

  return (
    <>
      <PageHeader title="社員を登録" />
      <Card className="max-w-2xl">
        <EmployeeForm departments={options.departments} roleLabels={options.roleLabels} showMoney={options.showMoney} />
      </Card>
    </>
  );
}
