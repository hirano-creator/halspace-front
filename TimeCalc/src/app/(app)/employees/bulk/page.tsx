"use client";

// 社員CSV一括登録 ※管理者のみ

import { useRequireAuth } from "@/lib/auth/client";
import { PageHeader } from "@/components/ui";
import { BulkClient } from "./bulk-client";

export default function BulkEmployeesPage() {
  const { status: authStatus } = useRequireAuth();

  if (authStatus === "unauthenticated") return null;
  if (authStatus === "loading") {
    return <p className="py-8 text-center text-sm text-muted">読み込み中...</p>;
  }

  return (
    <>
      <PageHeader
        title="社員の一括登録"
        description="CSVファイルから社員をまとめて登録します（100人規模の初期セットアップ用）"
      />
      <BulkClient />
    </>
  );
}
