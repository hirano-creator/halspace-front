"use client";

// CSV取込画面（取込UI＋取込履歴）

import { useCallback, useEffect, useState } from "react";
import { useRequireAuth } from "@/lib/auth/client";
import { apiFetchJson } from "@/lib/auth/api-fetch";
import { Card, PageHeader, tdClass, thClass } from "@/components/ui";
import { ImportClient } from "./import-client";
import { DeleteHistoryButton } from "./delete-history-button";
import type { ImportPageResponse } from "./types";

export default function ImportPage() {
  const { status: authStatus } = useRequireAuth();
  const [data, setData] = useState<ImportPageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    let cancelled = false;
    apiFetchJson<ImportPageResponse>("/api/import")
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
        title="CSV取込"
        description="Squareからダウンロードしたタイムカードを取り込みます。未登録の社員は自動で登録されます（同じ社員・日付のデータは上書き）"
      />

      <ImportClient initialMapping={data.mapping} onImported={refetch} />

      <Card className="mt-6 overflow-x-auto p-0">
        <h2 className="px-6 py-4 text-base font-semibold">取込履歴</h2>
        <table className="w-full min-w-[560px] border-t border-border">
          <thead className="bg-gray-50/50">
            <tr>
              <th className={thClass}>日時</th>
              <th className={thClass}>ファイル名</th>
              <th className={thClass}>実行者</th>
              <th className={`${thClass} text-right`}>取込件数</th>
              <th className={`${thClass} text-right`}>エラー</th>
              <th className={`${thClass} text-right`}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.histories.length === 0 ? (
              <tr>
                <td colSpan={6} className={`${tdClass} py-8 text-center text-muted`}>
                  取込履歴はまだありません
                </td>
              </tr>
            ) : (
              data.histories.map((h) => (
                <tr key={h.id}>
                  <td className={`${tdClass} whitespace-nowrap`}>{h.createdAtLabel}</td>
                  <td className={tdClass}>{h.fileName}</td>
                  <td className={`${tdClass} text-muted`}>{h.importedByName ?? "-"}</td>
                  <td className={`${tdClass} text-right text-emerald-600`}>{h.rowCount}件</td>
                  <td className={`${tdClass} text-right`}>
                    {h.errorCount > 0 ? (
                      <details className="inline-block text-left">
                        <summary className="cursor-pointer text-red-600">{h.errorCount}件</summary>
                        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-red-600">
                          {h.errors.map((err, i) => (
                            <li key={i}>{err}</li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      <span className="text-muted">0件</span>
                    )}
                  </td>
                  <td className={`${tdClass} text-right`}>
                    <DeleteHistoryButton historyId={h.id} onDeleted={refetch} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
