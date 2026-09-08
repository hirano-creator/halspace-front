"use client";

// フォロー管理
//
// 「今日フォローする顧客」はダッシュボードにも出る。ここでは期限切れを含めて
// 対応すべきものを一覧し、ステータスをその場で変えられるようにする。

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, apiFetchJson } from "@/lib/auth/api-fetch";
import { useAuth } from "@/lib/auth/client";
import { can } from "@/lib/auth/roles";
import { FOLLOW_UP_STATUS_LABELS } from "@/lib/constants";
import { formatJstDate } from "@/lib/utils/time";
import {
  Empty,
  buttonPrimaryClass,
  buttonSecondaryClass,
  filterClass,
  inputClass,
  labelClass,
} from "@/components/ui";
import type { FollowUpItem, FollowUpListResponse } from "./types";
import type { CustomerSuggestion } from "../visits/types";

const FILTERS = [
  { key: "open", scope: "", label: "未完了" },
  { key: "open", scope: "today", label: "今日まで" },
  { key: "DONE", scope: "", label: "完了" },
  { key: "all", scope: "", label: "すべて" },
];

export default function FollowUpsPage() {
  const { user, status: authStatus } = useAuth();
  const [filter, setFilter] = useState(0);
  const [assigneeId, setAssigneeId] = useState("");
  const [data, setData] = useState<FollowUpListResponse | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (authStatus !== "authenticated") return;
    const f = FILTERS[filter];
    const params = new URLSearchParams({ status: f.key });
    if (f.scope) params.set("scope", f.scope);
    if (assigneeId) params.set("assigneeId", assigneeId);
    apiFetchJson<FollowUpListResponse>(`/api/follow-ups?${params}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [authStatus, filter, assigneeId]);

  useEffect(load, [load]);

  /** 記録として残す必要がないもの（登録間違いなど）を消す。管理者のみ */
  async function remove(item: FollowUpItem) {
    if (!confirm(`「${item.content}」のフォロー予定を削除します。よろしいですか？`)) return;
    const res = await apiFetch(`/api/follow-ups/${item.id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(j?.error ?? "削除できませんでした");
      return;
    }
    load();
  }

  async function changeStatus(item: FollowUpItem, next: string) {
    const body = new FormData();
    body.set("status", next);
    const res = await apiFetch(`/api/follow-ups/${item.id}`, { method: "PATCH", body });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(j?.error ?? "変更できませんでした");
    }
    load();
  }

  return (
    <div className="pb-10">
      <div className="flex items-start justify-between gap-3 px-5 pt-6 sm:px-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">フォロー管理</h1>
          <p className="mt-1.5 text-xs text-gray-soft sm:text-[13px]">
            {data ? `${data.followUps.length} 件` : "　"}
          </p>
        </div>
        <button type="button" onClick={() => setAdding(true)} className={buttonPrimaryClass}>
          ＋ フォロー登録
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-y border-line bg-card px-5 py-3 sm:px-8">
        <div className="flex gap-1.5 overflow-x-auto">
          {FILTERS.map((f, i) => (
            <button
              key={`${f.key}-${f.scope}`}
              type="button"
              onClick={() => setFilter(i)}
              className={filterClass(filter === i)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          aria-label="担当者"
          className={`${inputClass} ml-auto w-auto min-w-[140px] appearance-none`}
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
        >
          <option value="">担当者（すべて）</option>
          {data?.staffs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="px-5 py-3 text-[13px] text-danger sm:px-8">{error}</p>}

      {!data ? (
        <Empty>読み込んでいます…</Empty>
      ) : data.followUps.length === 0 ? (
        <Empty>
          該当するフォローがありません。
          <br />
          来店登録でフォロー予定日を入れると、ここに自動で追加されます。
        </Empty>
      ) : (
        <div className="border-b border-line bg-card">
          {data.followUps.map((f) => (
            <div key={f.id} className="border-b border-line-2 px-5 py-4 last:border-b-0 sm:px-8">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Link
                      href={`/customers/${f.customerId}`}
                      className="inline-flex items-center py-1 -my-1 text-[15px] font-semibold hover:underline"
                    >
                      {f.customerName}
                    </Link>
                    <span className={`tabular text-[12px] ${f.overdue ? "font-semibold text-danger" : "text-gray-soft"}`}>
                      {f.dueDate}
                      {f.overdue && " 期限切れ"}
                    </span>
                    {f.customerPhone && (
                      <a
                        href={`tel:${f.customerPhone.replace(/\D/g, "")}`}
                        className="tabular inline-flex items-center py-2 -my-2 text-[12px] text-accent hover:underline"
                      >
                        {f.customerPhone}
                      </a>
                    )}
                  </div>
                  <p className="mt-1 text-[13px]">{f.content}</p>
                  {f.memo && <p className="mt-1 text-[12.5px] text-gray-soft">{f.memo}</p>}
                  {f.assigneeName && (
                    <p className="mt-1 text-[11.5px] text-gray-faint">担当 {f.assigneeName}</p>
                  )}
                </div>

                <div className="flex flex-none items-center gap-2">
                  <select
                    aria-label="ステータス"
                    className="min-h-10 rounded-md border border-line bg-card px-2.5 text-[13px]"
                    value={f.status}
                    onChange={(e) => changeStatus(f, e.target.value)}
                  >
                    {Object.entries(FOLLOW_UP_STATUS_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  {(f.status === "PENDING" || f.status === "IN_PROGRESS") && (
                    <button
                      type="button"
                      onClick={() => changeStatus(f, "DONE")}
                      className={`${buttonSecondaryClass} text-[13px]`}
                    >
                      完了
                    </button>
                  )}
                  {user && can(user.role, "data.delete") && (
                    <button
                      type="button"
                      onClick={() => remove(f)}
                      className="min-h-10 px-2 text-[12.5px] text-danger hover:underline"
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

      {adding && (
        <FollowUpDialog
          staffs={data?.staffs ?? []}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function FollowUpDialog({
  staffs,
  onClose,
  onSaved,
}: {
  staffs: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<CustomerSuggestion[]>([]);
  const [customer, setCustomer] = useState<CustomerSuggestion | null>(null);
  const [content, setContent] = useState("");
  const [dueDate, setDueDate] = useState(formatJstDate(new Date()));
  const [assigneeId, setAssigneeId] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (customer) return;
    let cancelled = false;
    const t = setTimeout(() => {
      apiFetchJson<{ customers: CustomerSuggestion[] }>(
        `/api/customers/search?q=${encodeURIComponent(query)}`,
      )
        .then((r) => {
          if (!cancelled) setSuggestions(r.customers);
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, customer]);

  async function save() {
    setError(null);
    if (!customer) return setError("顧客を選んでください");
    if (!content.trim()) return setError("フォロー内容を入力してください");

    setPending(true);
    try {
      const body = new FormData();
      body.set("customerId", customer.id);
      body.set("content", content.trim());
      body.set("dueDate", dueDate);
      if (assigneeId) body.set("assigneeId", assigneeId);
      body.set("memo", memo);

      const res = await apiFetch("/api/follow-ups", { method: "POST", body });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(j?.error ?? "保存できませんでした");
        return;
      }
      onSaved();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div className="max-h-[86vh] w-full max-w-[460px] overflow-y-auto rounded-lg bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">フォロー登録</h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-xl text-gray-soft">
            ×
          </button>
        </div>

        <div className="py-3">
          <label className={labelClass}>顧客</label>
          {customer ? (
            <div className="flex min-h-11 items-center justify-between rounded-md border border-accent px-3">
              <span className="font-semibold">{customer.name}</span>
              <button
                type="button"
                onClick={() => setCustomer(null)}
                className="text-[12.5px] text-accent"
              >
                変更
              </button>
            </div>
          ) : (
            <>
              <input
                className={inputClass}
                placeholder="名前・電話番号で検索"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <ul className="mt-2 max-h-44 overflow-y-auto rounded-md border border-line">
                {suggestions.length === 0 && (
                  <li className="px-3 py-3 text-center text-[13px] text-gray-soft">
                    該当する顧客がいません
                  </li>
                )}
                {suggestions.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setCustomer(c)}
                      className="w-full border-b border-line-2 px-3 py-2.5 text-left text-[13px] last:border-b-0 hover:bg-bg"
                    >
                      {c.name}
                      <span className="ml-2 text-[11px] text-gray-soft">{c.code}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="py-3">
          <label className={labelClass}>
            フォロー内容<span className="ml-1.5 text-[10.5px] font-normal text-accent">必須</span>
          </label>
          <input
            className={inputClass}
            placeholder="ウェットの入荷連絡"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 py-3">
          <div>
            <label className={labelClass}>予定日</label>
            <input
              type="date"
              className={inputClass}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>担当者</label>
            <select
              className={`${inputClass} appearance-none`}
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">自分</option>
              {staffs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="py-3">
          <label className={labelClass}>メモ</label>
          <textarea
            className={`${inputClass} min-h-[64px] py-2.5`}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>

        {error && <p className="mt-1 text-[13px] font-medium text-danger">{error}</p>}

        <div className="mt-4 flex gap-2.5">
          <button type="button" onClick={onClose} className={`${buttonSecondaryClass} flex-1`}>
            キャンセル
          </button>
          <button type="button" onClick={save} disabled={pending} className={`${buttonPrimaryClass} flex-1`}>
            {pending ? "保存しています…" : "保存する"}
          </button>
        </div>
      </div>
    </div>
  );
}
