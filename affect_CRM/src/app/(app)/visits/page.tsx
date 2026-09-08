"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetchJson } from "@/lib/auth/api-fetch";
import { useAuth } from "@/lib/auth/client";
import { Empty, StatusDot, buttonPrimaryClass, filterClass, thClass, tdClass } from "@/components/ui";
import type { VisitListResponse } from "./types";

const FILTERS = [
  { key: "", label: "すべて" },
  { key: "purchased=yes", label: "購入" },
  { key: "purchased=no", label: "未購入" },
  { key: "named=no", label: "お名前不明" },
];

function VisitsList() {
  const { status } = useAuth();
  const params = useSearchParams();
  const [filter, setFilter] = useState("");
  const [data, setData] = useState<VisitListResponse | null>(null);
  const [saved, setSaved] = useState(params.get("saved") === "1");

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    apiFetchJson<VisitListResponse>(`/api/visits?${filter}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [status, filter]);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 4000);
    return () => clearTimeout(t);
  }, [saved]);

  return (
    <div className="pb-8">
      <div className="flex items-start justify-between gap-4 px-5 pt-6 sm:px-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">来店管理</h1>
          <p className="mt-1.5 text-xs text-gray-soft sm:text-[13px]">
            {data ? `${data.total} 件` : "　"}
          </p>
        </div>
        <Link href="/visits/quick" className={buttonPrimaryClass}>
          ＋ 来店登録
        </Link>
      </div>

      {saved && (
        <p className="mx-5 mt-4 rounded-md bg-accent-soft px-4 py-2.5 text-[13px] text-accent sm:mx-8">
          来店を登録しました
        </p>
      )}

      <div className="mt-4 flex gap-1.5 overflow-x-auto px-5 pb-1 sm:px-8">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={filterClass(filter === f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!data ? (
        <Empty>読み込んでいます…</Empty>
      ) : data.visits.length === 0 ? (
        <Empty>該当する来店の記録がありません</Empty>
      ) : (
        <>
          {/* PC: テーブル */}
          <div className="mt-4 hidden border-y border-line bg-card lg:block">
            <table className="w-full">
              <thead className="border-b border-line-2">
                <tr>
                  <th className={thClass}>日時</th>
                  <th className={thClass}>顧客</th>
                  <th className={thClass}>目的</th>
                  <th className={thClass}>経路</th>
                  <th className={thClass}>興味</th>
                  <th className={thClass}>購入</th>
                  <th className={thClass}>担当</th>
                  <th className={thClass}></th>
                </tr>
              </thead>
              <tbody>
                {data.visits.map((v) => (
                  <tr key={v.id} className="border-b border-line-2 last:border-b-0">
                    <td className={`${tdClass} tabular whitespace-nowrap text-gray-soft`}>
                      {v.date} {v.time}
                    </td>
                    <td className={tdClass}>
                      {v.customerId ? (
                        <Link
                          href={`/customers/${v.customerId}`}
                          className="font-semibold hover:underline"
                        >
                          {v.displayName}
                        </Link>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-gray-soft">
                          <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-dashed border-gray-faint" />
                          {v.displayName}
                        </span>
                      )}
                    </td>
                    <td className={`${tdClass} text-gray-soft`}>{v.purposeLabel ?? "—"}</td>
                    <td className={`${tdClass} text-gray-soft`}>{v.channelLabel ?? "—"}</td>
                    <td className={`${tdClass} text-gray-soft`}>
                      {v.interestNames.join("・") || "—"}
                    </td>
                    <td className={tdClass}>
                      <StatusDot tone={v.purchased ? "ok" : "off"}>
                        {v.purchased ? "購入" : (v.noPurchaseReasonLabel ?? "未購入")}
                      </StatusDot>
                    </td>
                    <td className={`${tdClass} text-gray-soft`}>{v.staffName ?? "—"}</td>
                    <td className={`${tdClass} text-right whitespace-nowrap`}>
                      <Link href={`/visits/${v.id}`} className="text-[12.5px] text-accent hover:underline">
                        詳細・編集
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* スマホ・タブレット: カード（テーブルを横スクロールさせない） */}
          <div className="mt-4 border-y border-line bg-card lg:hidden">
            {data.visits.map((v) => (
              <div key={v.id} className="border-b border-line-2 px-5 py-3.5 last:border-b-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {v.customerId ? (
                      <Link
                        href={`/customers/${v.customerId}`}
                        className="inline-flex items-center py-1 -my-1 text-[15px] font-semibold hover:underline"
                      >
                        {v.displayName}
                      </Link>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[15px] text-gray-soft">
                        <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-dashed border-gray-faint" />
                        {v.displayName}
                      </span>
                    )}
                    <p className="tabular mt-1 text-[11.5px] text-gray-soft">
                      {v.date} {v.time}
                      {v.staffName && `／担当 ${v.staffName}`}
                    </p>
                  </div>
                  <StatusDot tone={v.purchased ? "ok" : "off"}>
                    {v.purchased ? "購入" : "未購入"}
                  </StatusDot>
                </div>
                <p className="mt-1.5 text-[12.5px] text-gray-soft">
                  {[
                    v.purposeLabel && `目的：${v.purposeLabel}`,
                    v.channelLabel && `経路：${v.channelLabel}`,
                    v.interestNames.length > 0 && `興味：${v.interestNames.join("・")}`,
                    !v.purchased && v.noPurchaseReasonLabel && `理由：${v.noPurchaseReasonLabel}`,
                  ]
                    .filter(Boolean)
                    .join("／") || "—"}
                </p>
                <Link
                  href={`/visits/${v.id}`}
                  className="mt-1.5 inline-flex items-center py-1.5 text-[12.5px] text-accent hover:underline"
                >
                  詳細・編集 →
                </Link>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function VisitsPage() {
  return (
    <Suspense fallback={null}>
      <VisitsList />
    </Suspense>
  );
}
