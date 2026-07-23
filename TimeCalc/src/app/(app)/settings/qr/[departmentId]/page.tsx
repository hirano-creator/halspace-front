"use client";

// 店舗ごとの打刻用QRコード表示 ※管理者のみ

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useRequireAuth } from "@/lib/auth/client";
import { apiFetchJson } from "@/lib/auth/api-fetch";
import { PageHeader } from "@/components/ui";
import { DepartmentQrPanelClient } from "./department-qr-panel-client";
import type { DepartmentQrDetailResponse } from "../types";

export default function DepartmentQrPage() {
  const { status: authStatus } = useRequireAuth();
  const params = useParams<{ departmentId: string }>();

  const [data, setData] = useState<DepartmentQrDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    let cancelled = false;
    apiFetchJson<DepartmentQrDetailResponse>(`/api/settings/qr/${params.departmentId}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, params.departmentId, refreshKey]);

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
        title={`${data.departmentName} の打刻QR`}
        description="店舗に掲示し、社員のスマホで読み取ってもらってください"
      />
      <DepartmentQrPanelClient data={data} onRefresh={refetch} />
    </>
  );
}
