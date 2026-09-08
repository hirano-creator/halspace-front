"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, apiFetchJson } from "@/lib/auth/api-fetch";
import { useAuth } from "@/lib/auth/client";
import { can } from "@/lib/auth/roles";
import { formatYen } from "@/lib/display";
import { Empty, StatCard, filterClass } from "@/components/ui";
import type { PurchaseListResponse } from "../types";

export default function PurchasesPage() {
  const { user, status } = useAuth();
  const [scope, setScope] = useState<"month" | "all">("month");
  const [data, setData] = useState<PurchaseListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (status !== "authenticated") return;
    apiFetchJson<PurchaseListResponse>(`/api/purchases/list?scope=${scope}`)
      .then(setData)
      .catch(() => {});
  }, [status, scope]);

  useEffect(load, [load]);

  async function remove(purchaseId: string) {
    if (!confirm("この購入記録を削除します。よろしいですか？\n（売上と累計購入金額も計算し直されます）")) {
      return;
    }
    const res = await apiFetch(`/api/purchases/${purchaseId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "削除できませんでした");
      return;
    }
    load();
  }

  return (
    <div className="pb-10">
      <div className="px-5 pt-6 sm:px-8">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">購入履歴</h1>
        <p className="mt-1.5 text-xs text-gray-soft sm:text-[13px]">
          購入の登録は、来店登録で「購入した」を選ぶと続けて行えます
        </p>
      </div>

      <div className="mt-4 flex gap-1.5 border-y border-line bg-card px-5 py-3 sm:px-8">
        {(
          [
            ["month", "今月"],
            ["all", "すべて"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setScope(k)}
            className={filterClass(scope === k)}
          >
            {label}
          </button>
        ))}
      </div>

      {data && (
        <div className="grid grid-cols-2 border-b border-line bg-card">
          <StatCard label="売上" value={formatYen(data.total)} highlight />
          <StatCard
            label="件数"
            value={data.count}
            unit="件"
            sub={data.count > 0 ? `平均 ${formatYen(Math.round(data.total / data.count))}` : undefined}
          />
        </div>
      )}

      {error && <p className="px-5 py-3 text-[13px] text-danger sm:px-8">{error}</p>}

      {!data ? (
        <Empty>読み込んでいます…</Empty>
      ) : data.purchases.length === 0 ? (
        <Empty>
          {scope === "month" ? (
            <>
              今月の購入はまだありません。
              <br />
              過去の記録は「すべて」に切り替えると見られます。
            </>
          ) : (
            "購入の記録がまだありません"
          )}
        </Empty>
      ) : (
        <div className="border-b border-line bg-card">
          {data.purchases.map((p) => (
            <div key={p.id} className="border-b border-line-2 px-5 py-3.5 last:border-b-0 sm:px-8">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="tabular text-[12.5px] text-gray-soft">{p.purchasedAt}</span>
                  <Link
                    href={`/customers/${p.customerId}`}
                    className="ml-2.5 text-[15px] font-semibold hover:underline"
                  >
                    {p.customerName}
                  </Link>
                  <p className="mt-1 text-[12.5px] text-gray-soft">
                    {p.items
                      .map(
                        (i) =>
                          `${i.productName}${i.size ? `／${i.size}` : ""}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`,
                      )
                      .join(" ／ ")}
                  </p>
                  {p.staffName && (
                    <p className="mt-0.5 text-[11.5px] text-gray-faint">担当 {p.staffName}</p>
                  )}
                </div>
                <div className="flex-none text-right">
                  <span className="tabular text-[15px] font-semibold">
                    {formatYen(p.totalAmount)}
                  </span>
                  {user && can(user.role, "data.delete") && (
                    <button
                      type="button"
                      onClick={() => remove(p.id)}
                      className="mt-1 block w-full py-1 text-[12px] text-danger hover:underline"
                    >
                      削除
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
