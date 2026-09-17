"use client";

// 顧客管理（一覧）
//
// 各行の左にチェックボックスを出し、まとめて削除（論理削除）できるようにする。
// 削除できるかは権限 customer.delete で判定する（API 側でも requireApiPermission で止める）。

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetchJson } from "@/lib/auth/api-fetch";
import { useAuth } from "@/lib/auth/client";
import { can } from "@/lib/auth/roles";
import { formatYen } from "@/lib/display";
import { GENDER_LABELS, type Gender } from "@/lib/constants";
import { formatJstDate } from "@/lib/utils/time";
import {
  Empty,
  buttonDangerClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
  tdClass,
  thClass,
} from "@/components/ui";
import type { CustomerBulkDeleteResponse, CustomerListResponse, MastersResponse } from "./types";

const SORTS = [
  { key: "lastVisit", label: "最終来店が新しい順" },
  { key: "visitCount", label: "来店回数が多い順" },
  { key: "purchaseTotal", label: "累計購入が多い順" },
  { key: "name", label: "名前順" },
];

/** チェックボックスは小さいので、周囲を含めて 44px の指が届く領域にする */
const checkboxCellClass = "flex h-11 w-11 items-center justify-center -m-3 cursor-pointer";
const checkboxClass = "h-4 w-4 cursor-pointer accent-accent";

export default function CustomersPage() {
  const { user, status } = useAuth();
  const [q, setQ] = useState("");
  const [gender, setGender] = useState("");
  const [tagId, setTagId] = useState("");
  const [purchased, setPurchased] = useState("");
  const [school, setSchool] = useState("");
  const [sort, setSort] = useState("lastVisit");
  const [page, setPage] = useState(1);
  // 削除後に一覧を取り直すためのカウンタ
  const [reloadKey, setReloadKey] = useState(0);

  const [masters, setMasters] = useState<MastersResponse | null>(null);
  const [data, setData] = useState<CustomerListResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 一括削除の選択状態
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState(false);

  const canDelete = user ? can(user.role, "customer.delete") : false;

  useEffect(() => {
    if (status !== "authenticated") return;
    apiFetchJson<MastersResponse>("/api/masters").then(setMasters).catch(() => {});
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ sort, page: String(page) });
      if (q.trim()) params.set("q", q.trim());
      if (gender) params.set("gender", gender);
      if (tagId) params.set("tagId", tagId);
      if (purchased) params.set("purchased", purchased);
      if (school) params.set("school", school);
      apiFetchJson<CustomerListResponse>(`/api/customers?${params}`)
        .then((res) => {
          if (cancelled) return;
          setData(res);
          // 消えた行・ページ外の行を選択から外す
          setSelected((prev) => {
            const ids = new Set(res.customers.map((c) => c.id));
            return new Set([...prev].filter((id) => ids.has(id)));
          });
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status, q, gender, tagId, purchased, school, sort, page, reloadKey]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visibleIds = data?.customers.map((c) => c.id) ?? [];
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(visibleIds));
  }

  async function removeSelected() {
    // 応答待ちの間に絞り込みが変わっていても、いま見えている行だけを消す
    const ids = visibleIds.filter((id) => selected.has(id));
    if (ids.length === 0) return;
    if (
      !confirm(
        `選択した ${ids.length} 名の顧客を削除します。よろしいですか？\n（来店・購入などの履歴は残ります）`,
      )
    ) {
      return;
    }

    setError(null);
    setNotice(null);
    setDeleting(true);
    try {
      const res = await apiFetchJson<CustomerBulkDeleteResponse>("/api/customers/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      setNotice(`${res.deleted} 名の顧客を削除しました`);
      setSelected(new Set());
      setReloadKey((k) => k + 1);
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
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">顧客管理</h1>
          <p className="mt-1.5 text-xs text-gray-soft sm:text-[13px]">
            {data ? `${data.total} 名` : "　"}
          </p>
        </div>
        <Link href="/customers/new" className={buttonPrimaryClass}>
          ＋ 顧客登録
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

      {/* 検索。スマホでは 1 カラムに畳む */}
      <div className="mt-4 border-y border-line bg-card px-5 py-4 sm:px-8">
        <input
          className={inputClass}
          placeholder="氏名・カナ・電話番号・顧客番号で検索"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Select value={gender} onChange={setGender} label="性別">
            <option value="">性別（すべて）</option>
            <option value="MALE">男性</option>
            <option value="FEMALE">女性</option>
            <option value="OTHER">その他</option>
          </Select>
          <Select value={tagId} onChange={setTagId} label="タグ">
            <option value="">タグ（すべて）</option>
            {masters?.tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Select value={purchased} onChange={setPurchased} label="購入">
            <option value="">購入（すべて）</option>
            <option value="yes">購入あり</option>
            <option value="no">購入なし</option>
          </Select>
          <Select value={school} onChange={setSchool} label="スクール">
            <option value="">スクール（すべて）</option>
            <option value="yes">参加あり</option>
            <option value="no">参加なし</option>
          </Select>
          <Select value={sort} onChange={setSort} label="並び順">
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {!data ? (
        <Empty>読み込んでいます…</Empty>
      ) : data.customers.length === 0 ? (
        <Empty>該当する顧客がいません</Empty>
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
                          aria-label="表示中の顧客をすべて選択"
                        />
                      </label>
                    </th>
                  )}
                  <th className={thClass}>顧客番号</th>
                  <th className={thClass}>氏名</th>
                  <th className={thClass}>性別・年齢</th>
                  <th className={thClass}>居住地</th>
                  <th className={thClass}>タグ</th>
                  <th className={thClass}>来店</th>
                  <th className={thClass}>最終来店</th>
                  <th className={thClass}>累計購入</th>
                </tr>
              </thead>
              <tbody>
                {data.customers.map((c) => (
                  <tr
                    key={c.id}
                    className={`border-b border-line-2 last:border-b-0 ${
                      selected.has(c.id) ? "bg-accent-soft/40" : ""
                    }`}
                  >
                    {canDelete && (
                      <td className={`${tdClass} w-12 pr-0`}>
                        <label className={checkboxCellClass}>
                          <input
                            type="checkbox"
                            className={checkboxClass}
                            checked={selected.has(c.id)}
                            onChange={() => toggle(c.id)}
                            aria-label={`${c.name} を選択`}
                          />
                        </label>
                      </td>
                    )}
                    <td className={`${tdClass} tabular text-gray-soft`}>{c.code}</td>
                    <td className={tdClass}>
                      <Link href={`/customers/${c.id}`} className="font-semibold hover:underline">
                        {c.name}
                      </Link>
                      {c.nameKana && (
                        <span className="ml-2 text-[11px] text-gray-faint">{c.nameKana}</span>
                      )}
                    </td>
                    <td className={`${tdClass} text-gray-soft`}>
                      {[c.gender ? GENDER_LABELS[c.gender as Gender] : null, c.age ? `${c.age}歳` : null]
                        .filter(Boolean)
                        .join("・") || "—"}
                    </td>
                    <td className={`${tdClass} text-gray-soft`}>{c.prefecture ?? "—"}</td>
                    <td className={tdClass}>
                      {c.tags.length === 0 ? (
                        <span className="text-gray-faint">—</span>
                      ) : (
                        c.tags.map((t) => (
                          <span
                            key={t.id}
                            className="mr-1 inline-block rounded-sm bg-accent-soft px-1.5 py-0.5 text-[10.5px] text-accent"
                          >
                            {t.name}
                          </span>
                        ))
                      )}
                    </td>
                    <td className={`${tdClass} tabular`}>{c.visitCount} 回</td>
                    <td className={`${tdClass} tabular text-gray-soft`}>
                      {c.lastVisitAt ? formatJstDate(new Date(c.lastVisitAt)) : "—"}
                    </td>
                    <td className={`${tdClass} tabular font-semibold`}>
                      {c.purchaseTotal > 0 ? formatYen(c.purchaseTotal) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* スマホ: 顧客カード（チェックボックスはカードのリンクの外に置く） */}
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
                表示中の顧客をすべて選択
              </label>
            )}
            {data.customers.map((c) => (
              <div
                key={c.id}
                className={`flex gap-3 border-b border-line-2 px-5 last:border-b-0 ${
                  selected.has(c.id) ? "bg-accent-soft/40" : ""
                }`}
              >
                {canDelete && (
                  <label className={`${checkboxCellClass} mt-4 flex-none`}>
                    <input
                      type="checkbox"
                      className={checkboxClass}
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      aria-label={`${c.name} を選択`}
                    />
                  </label>
                )}
                <Link href={`/customers/${c.id}`} className="block min-w-0 flex-1 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-[15px] font-semibold">{c.name}</span>
                      <span className="tabular ml-2 text-[11px] text-gray-faint">{c.code}</span>
                      <p className="mt-1 text-[11.5px] text-gray-soft">
                        {[
                          c.gender ? GENDER_LABELS[c.gender as Gender] : null,
                          c.age ? `${c.age}歳` : null,
                          c.prefecture,
                        ]
                          .filter(Boolean)
                          .join("・") || "—"}
                      </p>
                    </div>
                    <div className="flex-none text-right">
                      <p className="tabular text-[13px] font-semibold">{c.visitCount} 回</p>
                      <p className="tabular mt-0.5 text-[11px] text-gray-soft">
                        {c.lastVisitAt ? formatJstDate(new Date(c.lastVisitAt)) : "未来店"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <span
                          key={t.id}
                          className="inline-block rounded-sm bg-accent-soft px-1.5 py-0.5 text-[10.5px] text-accent"
                        >
                          {t.name}
                        </span>
                      ))}
                    </div>
                    {c.purchaseTotal > 0 && (
                      <span className="tabular flex-none text-[13px] font-semibold">
                        {formatYen(c.purchaseTotal)}
                      </span>
                    )}
                  </div>
                </Link>
              </div>
            ))}
          </div>
        </>
      )}

      {data && totalPages > 1 && (
        <div className="mt-5 flex items-center justify-center gap-3 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="min-h-10 px-3 text-gray-soft disabled:opacity-40"
          >
            前へ
          </button>
          <span className="tabular text-gray-soft">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="min-h-10 px-3 text-gray-soft disabled:opacity-40"
          >
            次へ
          </button>
        </div>
      )}

      {/* 選択中だけ出す操作バー（詳細ページの保存バーと同じ位置） */}
      {canDelete && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-[58px] z-20 border-t border-line bg-card px-5 py-2.5 md:bottom-0 md:ml-[206px] sm:px-8">
          <div className="flex items-center gap-2.5">
            <span className="flex-1 text-[13px] font-semibold">{selected.size} 名選択中</span>
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

function Select({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <select
      aria-label={label}
      className={`${inputClass} appearance-none bg-card`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  );
}
