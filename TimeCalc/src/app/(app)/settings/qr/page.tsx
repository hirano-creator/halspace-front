"use client";

// 打刻QR一覧 ※管理者のみ
// 部署ごとに管理者用QR表示ページへのリンクと、キオスク表示URL（ログイン不要）の発行・管理を行う。

import { useCallback, useEffect, useState } from "react";
import { useRequireAuth } from "@/lib/auth/client";
import { apiFetchJson } from "@/lib/auth/api-fetch";
import { PageHeader } from "@/components/ui";
import { QrList } from "./qr-list";
import type { QrListResponse } from "./types";

export default function QrListPage() {
  const { status: authStatus } = useRequireAuth();
  const [data, setData] = useState<QrListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    let cancelled = false;
    apiFetchJson<QrListResponse>("/api/settings/qr")
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
        title="打刻QRコード"
        description="店舗ごとの打刻QR表示ページと、ログイン不要のキオスク表示URLを管理します"
      />
      <QrList departments={data.departments} baseUrl={data.baseUrl} onChanged={refetch} />
    </>
  );
}
