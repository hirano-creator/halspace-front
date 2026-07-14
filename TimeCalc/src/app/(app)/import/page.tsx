// CSV取込画面（取込UI＋取込履歴）

import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guard";
import { getCsvMapping } from "@/lib/settings";
import { Card, PageHeader, tdClass, thClass } from "@/components/ui";
import { ImportClient } from "./import-client";
import { DeleteHistoryButton } from "./delete-history-button";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  await requirePermission("importCsv");

  const [mapping, histories] = await Promise.all([
    getCsvMapping(),
    prisma.importHistory.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { importedBy: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="CSV取込"
        description="Squareからダウンロードしたタイムカードを取り込みます。未登録の社員は自動で登録されます（同じ社員・日付のデータは上書き）"
      />

      <ImportClient initialMapping={mapping} />

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
            {histories.length === 0 ? (
              <tr>
                <td colSpan={6} className={`${tdClass} py-8 text-center text-muted`}>
                  取込履歴はまだありません
                </td>
              </tr>
            ) : (
              histories.map((h) => {
                let errors: string[] = [];
                try {
                  errors = h.errors ? (JSON.parse(h.errors) as string[]) : [];
                } catch {
                  /* 不正なJSONは無視 */
                }
                return (
                  <tr key={h.id}>
                    <td className={`${tdClass} whitespace-nowrap`}>
                      {h.createdAt.toLocaleString("ja-JP")}
                    </td>
                    <td className={tdClass}>{h.fileName}</td>
                    <td className={`${tdClass} text-muted`}>{h.importedBy?.name ?? "-"}</td>
                    <td className={`${tdClass} text-right text-emerald-600`}>{h.rowCount}件</td>
                    <td className={`${tdClass} text-right`}>
                      {h.errorCount > 0 ? (
                        <details className="inline-block text-left">
                          <summary className="cursor-pointer text-red-600">
                            {h.errorCount}件
                          </summary>
                          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-red-600">
                            {errors.map((err, i) => (
                              <li key={i}>{err}</li>
                            ))}
                          </ul>
                        </details>
                      ) : (
                        <span className="text-muted">0件</span>
                      )}
                    </td>
                    <td className={`${tdClass} text-right`}>
                      <DeleteHistoryButton historyId={h.id} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
