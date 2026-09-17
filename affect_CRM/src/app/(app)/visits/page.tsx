"use client";

// 来店管理（一覧）
//
// 管理者には各行の左にチェックボックスを出し、まとめて削除できるようにする。
// 削除は集計が動くため管理者のみ（API 側でも requireApiPermission で止める）。
// 購入記録が紐づく来店は消せないので、消せなかった件数を結果に出す。

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetchJson } from "@/lib/auth/api-fetch";
import { useAuth } from "@/lib/auth/client";
import { can } from "@/lib/auth/roles";
import {
  Empty,
  StatusDot,
  buttonDangerClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  filterClass,
  thClass,
  tdClass,
} from "@/components/ui";
import type { VisitBulkDeleteResponse, VisitListResponse } from "./types";

const FILTERS = [
  { key: "", label: "すべて" },
  { key: "purchased=yes", label: "購入" },
  { key: "purchased=no", label: "未購入" },
  { key: "named=no", label: "お名前不明" },
];

/** チェックボックスは小さいので、周囲を含めて 44px の指が届く領域にする */
const checkboxCellClass = "flex h-11 w-11 items-center justify-center -m-3 cursor-pointer";
const checkboxClass = "h-4 w-4 cursor-pointer accent-accent";

function VisitsList() {
  const { user, status } = useAuth();
  const params = useSearchParams();
  const [filter, setFilter] = useState("");
  const [data, setData] = useState<VisitListResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(
    params.get("saved") === "1" ? "来店を登録しました" : null,
  );
  const [error, setError] = useState<string | null>(null);

  // 一括削除の選択状態
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState(false);

  const canDelete = user ? can(user.role, "data.delete") : false;

  // 絞り込みを素早く切り替えたとき、古い応答で新しい表示を上書きしないための連番
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    if (status !== "authenticated") return;
    const seq = ++requestSeq.current;
    const res = await apiFetchJson<VisitListResponse>(`/api/visits?${filter}`);
    if (seq !== requestSeq.current) return;
    setData(res);
    // 消えた行・ページ外の行を選択から外す
    setSelected((prev) => {
      const ids = new Set(res.visits.map((v) => v.id));
      return new Set([...prev].filter((id) => ids.has(id)));
    });
  }, [status, filter]);

  useEffect(() => {
    // 再取得に失敗しても表示中の内容は消さない
    load().catch(() => {});
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // 絞り込みを変えたら選択はやり直し（見えていない行を消さないため）
  function changeFilter(key: string) {
    setFilter(key);
    setSelected(new Set());
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visibleIds = data?.visits.map((v) => v.id) ?? [];
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(visibleIds));
  }

  async function removeSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (
      !confirm(
        `選択した ${ids.length} 件の来店記録を削除します。よろしいですか？\n（顧客の来店回数・最終来店日も計算し直されます）`,
      )
    ) {
      return;
    }

    setError(null);
    setNotice(null);
    setDeleting(true);
    try {
      const res = await apiFetchJson<VisitBulkDeleteResponse>("/api/visits/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const parts = [`${res.deleted} 件の来店記録を削除しました`];
      if (res.skipped > 0) {
        parts.push(
          `${res.skipped} 件は購入記録があるため削除できませんでした（先に購入記録を削除してください）`,
        );
      }
      setNotice(parts.join("。"));
      setSelected(new Set());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除できませんでした");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className={selected.size > 0 ? "pb-32" : "pb-8"}>
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

      {notice && (
        <p className="mx-5 mt-4 rounded-md bg-accent-soft px-4 py-2.5 text-[13px] text-accent sm:mx-8">
          {notice}
        </p>
      )}
      {error && (
        <p className="mx-5 mt-4 rounded-md bg-red-50 px-4 py-2.5 text-[13px] font-medium text-danger sm:mx-8">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-1.5 overflow-x-auto px-5 pb-1 sm:px-8">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => changeFilter(f.key)}
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
                  {canDelete && (
                    <th className={`${thClass} w-12 pr-0`}>
                      <label className={checkboxCellClass}>
                        <input
                          type="checkbox"
                          className={checkboxClass}
                          checked={allSelected}
                          onChange={toggleAll}
                          aria-label="表示中の来店をすべて選択"
                        />
                      </label>
                    </th>
                  )}
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
                  <tr
                    key={v.id}
                    className={`border-b border-line-2 last:border-b-0 ${
                      selected.has(v.id) ? "bg-accent-soft/40" : ""
                    }`}
                  >
                    {canDelete && (
                      <td className={`${tdClass} w-12 pr-0`}>
                        <label className={checkboxCellClass}>
                          <input
                            type="checkbox"
                            className={checkboxClass}
                            checked={selected.has(v.id)}
                            onChange={() => toggle(v.id)}
                            aria-label={`${v.date} ${v.time} ${v.displayName} を選択`}
                          />
                        </label>
                      </td>
                    )}
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
            {canDelete && (
              <label className="flex min-h-11 items-center gap-3 border-b border-line-2 px-5 text-[13px] text-gray-soft">
                <span className={checkboxCellClass}>
                  <input
                    type="checkbox"
                    className={checkboxClass}
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                </span>
                表示中の来店をすべて選択
              </label>
            )}
            {data.visits.map((v) => (
              <div
                key={v.id}
                className={`flex gap-3 border-b border-line-2 px-5 py-3.5 last:border-b-0 ${
                  selected.has(v.id) ? "bg-accent-soft/40" : ""
                }`}
              >
                {canDelete && (
                  <label className={`${checkboxCellClass} mt-0.5 flex-none`}>
                    <input
                      type="checkbox"
                      className={checkboxClass}
                      checked={selected.has(v.id)}
                      onChange={() => toggle(v.id)}
                      aria-label={`${v.date} ${v.time} ${v.displayName} を選択`}
                    />
                  </label>
                )}
                <div className="min-w-0 flex-1">
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
              </div>
            ))}
          </div>
        </>
      )}

      {/* 選択中だけ出す操作バー（詳細ページの保存バーと同じ位置） */}
      {canDelete && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-[58px] z-20 border-t border-line bg-card px-5 py-2.5 md:bottom-0 md:ml-[206px] sm:px-8">
          <div className="flex items-center gap-2.5">
            <span className="flex-1 text-[13px] font-semibold">{selected.size} 件選択中</span>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={deleting}
              className={buttonSecondaryClass}
            >
              選択解除
            </button>
            <button
              type="button"
              onClick={removeSelected}
              disabled={deleting}
              className={buttonDangerClass}
            >
              {deleting ? "削除しています…" : "削除"}
            </button>
          </div>
        </div>
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
