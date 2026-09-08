"use client";

// 顧客カルテ
//
// 上部に要約（誰なのか・どれくらい来ているか・いくら買っているか）を固定し、
// その下をタブで切り替える。

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, apiFetchJson } from "@/lib/auth/api-fetch";
import { useAuth } from "@/lib/auth/client";
import { can } from "@/lib/auth/roles";
import { formatYen } from "@/lib/display";
import {
  GENDER_LABELS,
  FOLLOW_UP_STATUS_LABELS,
  RESERVATION_STATUS_LABELS,
  type FollowUpStatus,
  type Gender,
  type ReservationStatus,
} from "@/lib/constants";
import { formatJstDate, formatJstDateTime } from "@/lib/utils/time";
import { Empty, StatusDot, buttonSecondaryClass } from "@/components/ui";
import type { CustomerDetailResponse } from "../types";

const TABS = [
  { key: "profile", label: "基本情報" },
  { key: "visits", label: "来店履歴" },
  { key: "purchases", label: "購入履歴" },
  { key: "schools", label: "スクール履歴" },
  { key: "reservations", label: "予約履歴" },
  { key: "notes", label: "会話メモ" },
  { key: "followUps", label: "フォロー履歴" },
] as const;

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, status } = useAuth();
  const [data, setData] = useState<CustomerDetailResponse | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("profile");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    apiFetchJson<CustomerDetailResponse>(`/api/customers/${id}/detail`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [status, id]);

  /** 購入を消すと売上と累計購入金額が変わるので、確認してから消す */
  async function deletePurchase(purchaseId: string) {
    if (!confirm("この購入記録を削除します。よろしいですか？\n（売上と累計購入金額も計算し直されます）")) {
      return;
    }
    const res = await apiFetch(`/api/purchases/${purchaseId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "削除できませんでした");
      return;
    }
    // 集計が変わるのでカルテを取り直す
    apiFetchJson<CustomerDetailResponse>(`/api/customers/${id}/detail`).then(setData).catch(() => {});
  }

  async function onDelete() {
    if (!confirm("この顧客を削除します。よろしいですか？\n（履歴は残りますが、一覧には表示されなくなります）")) {
      return;
    }
    const res = await apiFetch(`/api/customers/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/customers");
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "削除できませんでした");
    }
  }

  if (!data) {
    return <Empty>{error ? `読み込めませんでした（${error}）` : "読み込んでいます…"}</Empty>;
  }

  const h = data.header;

  return (
    <div className="pb-10">
      {/* ---- 要約ヘッダー ---- */}
      <div className="border-b border-line bg-card px-5 pt-6 pb-4 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{h.name}</h1>
              {h.nameKana && <span className="text-xs text-gray-faint">{h.nameKana}</span>}
              <span className="tabular text-xs text-gray-faint">{h.code}</span>
            </div>
            <p className="mt-1.5 text-[13px] text-gray-soft">
              {[
                h.gender ? GENDER_LABELS[h.gender as Gender] : null,
                h.age != null ? `${h.age}歳` : null,
                [h.prefecture, h.city].filter(Boolean).join("") || null,
                h.rankLabel,
              ]
                .filter(Boolean)
                .join("・") || "—"}
            </p>
            {h.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {h.tags.map((t) => (
                  <span
                    key={t.id}
                    className="inline-block rounded-sm bg-accent-soft px-1.5 py-0.5 text-[10.5px] text-accent"
                  >
                    {t.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-none gap-2">
            <Link href={`/customers/${id}/edit`} className={buttonSecondaryClass}>
              編集
            </Link>
            {user && can(user.role, "customer.delete") && (
              <button type="button" onClick={onDelete} className={`${buttonSecondaryClass} text-danger`}>
                削除
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line-2 pt-4 sm:grid-cols-4">
          <Summary label="最終来店" value={h.lastVisitAt ? formatJstDate(new Date(h.lastVisitAt)) : "—"} />
          <Summary label="来店回数" value={`${h.visitCount} 回`} />
          <Summary label="累計購入金額" value={formatYen(h.purchaseTotal)} accent />
          <Summary label="スクール参加" value={`${h.schoolCount} 回`} />
        </div>
      </div>

      {/* ---- タブ ---- */}
      <div className="flex gap-1 overflow-x-auto border-b border-line bg-card px-5 sm:px-8">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`min-h-11 flex-none border-b-2 px-3 text-[13px] ${
              tab === t.key
                ? "border-accent font-semibold text-accent"
                : "border-transparent text-gray-soft"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-card">
        {tab === "profile" && (
          <dl className="divide-y divide-line-2 px-5 sm:px-8">
            <Info label="ニックネーム" value={h.nickname} />
            <Info label="電話番号" value={h.phone} />
            <Info label="メールアドレス" value={h.email} />
            <Info label="住所" value={[h.prefecture, h.city, h.addressLine].filter(Boolean).join(" ")} />
            <Info label="LINE" value={h.lineId} />
            <Info label="Instagram" value={h.instagram} />
            <Info label="サーフィン歴" value={h.surf?.experienceYears != null ? `${h.surf.experienceYears} 年` : null} />
            <Info label="サーフィンレベル" value={h.surf?.levelLabel ?? null} />
            <Info label="ボード" value={[h.surf?.boardTypeLabel, h.surf?.boardSize].filter(Boolean).join(" ")} />
            <Info label="ウェットサイズ" value={h.surf?.wetsuitSizeLabel ?? null} />
            <Info label="サーフィン頻度" value={h.surf?.frequencyLabel ?? null} />
            <Info label="よく行くポイント" value={h.surf?.favoritePoints ?? null} />
            <Info label="興味のある商品" value={h.surf?.interestedCategoryNames.join("・") ?? null} />
            <Info label="備考" value={h.note} />
          </dl>
        )}

        {tab === "visits" &&
          (data.visits.length === 0 ? (
            <Empty>まだ来店の記録がありません</Empty>
          ) : (
            <ul className="divide-y divide-line-2 px-5 sm:px-8">
              {data.visits.map((v) => (
                <li key={v.id} className="py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="tabular text-[13px] font-semibold">
                      {formatJstDateTime(new Date(v.visitedAt))}
                    </span>
                    <StatusDot tone={v.purchased ? "ok" : "off"}>
                      {v.purchased ? "購入" : (v.noPurchaseReasonLabel ?? "未購入")}
                    </StatusDot>
                  </div>
                  <p className="mt-1 text-[12.5px] text-gray-soft">
                    {[
                      v.purposeLabel && `目的：${v.purposeLabel}`,
                      v.channelLabel && `経路：${v.channelLabel}`,
                      v.interestNames.length > 0 && `興味：${v.interestNames.join("・")}`,
                      v.staffName && `担当：${v.staffName}`,
                    ]
                      .filter(Boolean)
                      .join("／")}
                  </p>
                  {v.conversation && <p className="mt-1.5 text-[13px]">{v.conversation}</p>}
                  {v.nextProposal && (
                    <p className="mt-1 text-[12.5px] text-accent">次回提案：{v.nextProposal}</p>
                  )}
                  {v.noPurchaseComment && (
                    <p className="mt-1 text-[12.5px] text-gray-soft">{v.noPurchaseComment}</p>
                  )}
                  <Link
                    href={`/visits/${v.id}`}
                    className="mt-1.5 inline-flex items-center py-1.5 text-[12px] text-accent hover:underline"
                  >
                    詳細・編集 →
                  </Link>
                </li>
              ))}
            </ul>
          ))}

        {tab === "purchases" &&
          (data.purchases.length === 0 ? (
            <Empty>まだ購入の記録がありません</Empty>
          ) : (
            <ul className="divide-y divide-line-2 px-5 sm:px-8">
              {data.purchases.map((p) => (
                <li key={p.id} className="py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="tabular text-[13px] font-semibold">
                      {formatJstDate(new Date(p.purchasedAt))}
                    </span>
                    <span className="tabular text-sm font-semibold">{formatYen(p.totalAmount)}</span>
                  </div>
                  <ul className="mt-1 text-[12.5px] text-gray-soft">
                    {p.items.map((i, idx) => (
                      <li key={idx}>
                        {i.productName}
                        {i.size && `／${i.size}`}
                        {i.quantity > 1 && ` ×${i.quantity}`}
                      </li>
                    ))}
                  </ul>
                  {user && can(user.role, "data.delete") && (
                    <button
                      type="button"
                      onClick={() => deletePurchase(p.id)}
                      className="mt-1.5 inline-flex items-center py-1.5 text-[12px] text-danger hover:underline"
                    >
                      この購入を削除
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ))}

        {tab === "schools" &&
          (data.schools.length === 0 ? (
            <Empty>まだスクールの参加記録がありません</Empty>
          ) : (
            <ul className="divide-y divide-line-2 px-5 sm:px-8">
              {data.schools.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-3.5 text-[13px]">
                  <span className="tabular">{formatJstDate(new Date(s.attendedAt))}</span>
                  <span>{s.courseName ?? "—"}</span>
                  <span className="text-gray-soft">
                    {s.evalTotal != null ? `総合 ${s.evalTotal}` : "—"}
                  </span>
                </li>
              ))}
            </ul>
          ))}

        {tab === "reservations" &&
          (data.reservations.length === 0 ? (
            <Empty>まだ予約がありません</Empty>
          ) : (
            <ul className="divide-y divide-line-2 px-5 sm:px-8">
              {data.reservations.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-3.5 text-[13px]">
                  <span className="tabular">
                    {formatJstDate(new Date(r.date))} {r.startTime}
                  </span>
                  <span>{r.courseName}</span>
                  <span className="text-gray-soft">
                    {RESERVATION_STATUS_LABELS[r.status as ReservationStatus] ?? r.status}
                  </span>
                </li>
              ))}
            </ul>
          ))}

        {tab === "notes" &&
          (data.notes.length === 0 ? (
            <Empty>まだ会話メモがありません</Empty>
          ) : (
            <ul className="divide-y divide-line-2 px-5 sm:px-8">
              {data.notes.map((n) => (
                <li key={n.id} className="py-3.5">
                  <p className="text-[13px]">{n.body}</p>
                  <p className="tabular mt-1 text-[11px] text-gray-soft">
                    {formatJstDateTime(new Date(n.createdAt))}
                    {n.staffName && `／${n.staffName}`}
                  </p>
                </li>
              ))}
            </ul>
          ))}

        {tab === "followUps" &&
          (data.followUps.length === 0 ? (
            <Empty>まだフォローの記録がありません</Empty>
          ) : (
            <ul className="divide-y divide-line-2 px-5 sm:px-8">
              {data.followUps.map((f) => (
                <li key={f.id} className="py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[13px] font-semibold">{f.content}</span>
                    <span className="text-[11px] text-gray-soft">
                      {FOLLOW_UP_STATUS_LABELS[f.status as FollowUpStatus] ?? f.status}
                    </span>
                  </div>
                  <p className="tabular mt-1 text-[11.5px] text-gray-soft">
                    予定日 {formatJstDate(new Date(f.dueDate))}
                    {f.assigneeName && `／担当 ${f.assigneeName}`}
                  </p>
                  {f.memo && <p className="mt-1 text-[12.5px] text-gray-soft">{f.memo}</p>}
                </li>
              ))}
            </ul>
          ))}
      </div>
    </div>
  );
}

function Summary({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] text-gray-soft">{label}</dt>
      <dd className={`tabular mt-1 text-lg font-semibold ${accent ? "text-accent" : ""}`}>{value}</dd>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-4 py-3 text-[13px]">
      <dt className="w-[136px] flex-none text-gray-soft">{label}</dt>
      <dd className="min-w-0 flex-1">{value || <span className="text-gray-faint">—</span>}</dd>
    </div>
  );
}
