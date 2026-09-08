"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetchJson } from "@/lib/auth/api-fetch";
import { useAuth } from "@/lib/auth/client";
import { formatYen } from "@/lib/display";
import { GENDER_LABELS, type Gender } from "@/lib/constants";
import { formatJstDate } from "@/lib/utils/time";
import {
  Empty,
  buttonPrimaryClass,
  inputClass,
  tdClass,
  thClass,
} from "@/components/ui";
import type { CustomerListResponse, MastersResponse } from "./types";

const SORTS = [
  { key: "lastVisit", label: "最終来店が新しい順" },
  { key: "visitCount", label: "来店回数が多い順" },
  { key: "purchaseTotal", label: "累計購入が多い順" },
  { key: "name", label: "名前順" },
];

export default function CustomersPage() {
  const { status } = useAuth();
  const [q, setQ] = useState("");
  const [gender, setGender] = useState("");
  const [tagId, setTagId] = useState("");
  const [purchased, setPurchased] = useState("");
  const [school, setSchool] = useState("");
  const [sort, setSort] = useState("lastVisit");
  const [page, setPage] = useState(1);

  const [masters, setMasters] = useState<MastersResponse | null>(null);
  const [data, setData] = useState<CustomerListResponse | null>(null);

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
          if (!cancelled) setData(res);
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status, q, gender, tagId, purchased, school, sort, page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;

  return (
    <div className="pb-8">
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
                  <tr key={c.id} className="border-b border-line-2 last:border-b-0">
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

          {/* スマホ: 顧客カード */}
          <div className="mt-4 border-y border-line bg-card lg:hidden">
            {data.customers.map((c) => (
              <Link
                key={c.id}
                href={`/customers/${c.id}`}
                className="block border-b border-line-2 px-5 py-3.5 last:border-b-0"
              >
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
