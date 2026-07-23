"use client";

// 設定画面（グループ会社管理＋会社ごとの設定）※管理者のみ
//
// 上部で会社を選択し、部署管理（GPS打刻・QR）・勤務ルール・権限の呼び方・表示設定を
// 会社ごとに管理する。「共通」タブは全社のデフォルト（会社別に保存がない場合の
// フォールバック）と、どの会社にも属さない部署を管理する。
// CSV列マッピングはCSV取込画面で変更でき、自動保存されます。

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRequireAuth } from "@/lib/auth/client";
import { apiFetchJson } from "@/lib/auth/api-fetch";
import {
  KEY_DISPLAY,
  KEY_ROLE_LABELS,
  KEY_WORK_RULES,
} from "@/lib/settings-keys";
import { PageHeader } from "@/components/ui";
import {
  CompanyManager,
  DepartmentManager,
  DisplaySettingsForm,
  RoleLabelsForm,
  WorkRulesForm,
  type CompanyScope,
} from "./settings-forms";
import type { SettingsPageResponse } from "./types";

const COMMON_LABEL = "共通（全社のデフォルト）";

export default function SettingsPage() {
  const { status: authStatus } = useRequireAuth();
  const searchParams = useSearchParams();
  const companyParam = searchParams.get("company") ?? "";

  const [data, setData] = useState<SettingsPageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    const qs = new URLSearchParams();
    if (companyParam) qs.set("company", companyParam);

    let cancelled = false;
    apiFetchJson<SettingsPageResponse>(`/api/settings?${qs.toString()}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, companyParam, refreshKey]);

  if (authStatus === "unauthenticated") return null;
  if (authStatus === "loading" || !data) {
    return <p className="py-8 text-center text-sm text-muted">読み込み中...</p>;
  }
  if (error) {
    return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>;
  }

  const companyId = data.selectedCompanyId;
  const overrideKeys = new Set(data.overrideKeys);

  const scopeFor = (key: string): CompanyScope => ({
    companyId,
    companyName: data.selectedCompanyName ?? COMMON_LABEL,
    hasOverride: overrideKeys.has(key),
  });

  const tabBase = "rounded-full border px-4 py-1.5 text-sm transition whitespace-nowrap";
  const tabActive = `${tabBase} border-[var(--primary)] bg-[var(--primary)] text-white`;
  const tabInactive = `${tabBase} border-border bg-surface text-muted hover:text-foreground`;

  return (
    <>
      <PageHeader
        title="設定"
        description="会社を選択して、部署（GPS打刻・QR）・勤務ルール・権限の呼び方・表示設定を会社ごとに管理します（CSV列マッピングはCSV取込画面で設定できます）"
      />

      <div className="space-y-6">
        <CompanyManager companies={data.companies} onSaved={refetch} />

        <nav className="flex flex-wrap items-center gap-2" aria-label="設定対象の会社">
          <Link href="/settings" className={companyId === null ? tabActive : tabInactive}>
            共通
          </Link>
          {data.companies.map((c) => (
            <Link
              key={c.id}
              href={`/settings?company=${c.id}`}
              className={c.id === companyId ? tabActive : tabInactive}
            >
              {c.name}
            </Link>
          ))}
        </nav>

        {companyId === null && data.companies.length > 0 && (
          <p className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-muted">
            「共通」の設定は、会社別に保存されていない項目のデフォルトとして全社に適用されます。
            会社ごとに変えたい場合は上のタブから会社を選択してください。
          </p>
        )}

        <DepartmentManager
          key={`dept-${companyId ?? "common"}`}
          scope={scopeFor("")}
          companies={data.companies}
          departments={data.departments}
          onSaved={refetch}
        />
        <WorkRulesForm
          key={`rules-${companyId ?? "common"}`}
          rules={data.rules}
          scope={scopeFor(KEY_WORK_RULES)}
          onSaved={refetch}
        />
        <RoleLabelsForm
          key={`roles-${companyId ?? "common"}`}
          roleLabels={data.roleLabels}
          scope={scopeFor(KEY_ROLE_LABELS)}
          onSaved={refetch}
        />
        <DisplaySettingsForm
          key={`display-${companyId ?? "common"}`}
          showMoney={data.showMoney}
          scope={scopeFor(KEY_DISPLAY)}
          onSaved={refetch}
        />
      </div>
    </>
  );
}
