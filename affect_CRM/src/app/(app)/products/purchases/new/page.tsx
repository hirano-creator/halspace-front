"use client";

// 購入登録
//
// クイック来店登録で「購入した」を選んだあと、そのまま流れてくる画面。
// 来店記録の「購入内容を登録する」からも来る。
// お名前不明の来店（customerId なし）でも登録できる。購入は来店に紐づけて残し、
// あとで来店を顧客に紐付けたときに一緒に顧客へ付け替わる。
// 明細は 1 行から入力でき、合計はその場で計算して見せる。

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, apiFetchJson } from "@/lib/auth/api-fetch";
import { useAuth } from "@/lib/auth/client";
import { formatYen } from "@/lib/display";
import { nowForDateTimeInput } from "@/lib/utils/time";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
  labelClass,
} from "@/components/ui";
import type { CustomerDetailResponse, MastersResponse } from "../../../customers/types";
import type { VisitDetailResponse } from "../../../visits/types";

interface ItemRow {
  productName: string;
  categoryId: string;
  unitPrice: string;
  quantity: string;
  size: string;
}

const EMPTY_ROW: ItemRow = { productName: "", categoryId: "", unitPrice: "", quantity: "1", size: "" };

function PurchaseForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { status } = useAuth();

  const paramCustomerId = params.get("customerId") ?? "";
  const visitId = params.get("visitId") ?? "";

  const [masters, setMasters] = useState<MastersResponse | null>(null);
  // 見出しに出す相手。来店があれば来店側の顧客を正とする（URL の customerId と食い違わないように）
  const [who, setWho] = useState<{ customerId: string | null; label: string } | null>(null);
  const [purchasedAt, setPurchasedAt] = useState(nowForDateTimeInput().slice(0, 10));
  const [rows, setRows] = useState<ItemRow[]>([{ ...EMPTY_ROW }]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const customerId = who?.customerId ?? paramCustomerId;

  useEffect(() => {
    if (status !== "authenticated") return;
    apiFetchJson<MastersResponse>("/api/masters").then(setMasters).catch(() => {});

    if (visitId) {
      // 来店日を購入日の既定値にする（過去の来店を後から登録するときに日付を直さなくて済む）
      apiFetchJson<VisitDetailResponse>(`/api/visits/${visitId}`)
        .then((v) => {
          setWho({ customerId: v.customerId, label: v.displayName });
          setPurchasedAt(v.visitedAt.slice(0, 10));
        })
        .catch(() => {});
    } else if (paramCustomerId) {
      apiFetchJson<CustomerDetailResponse>(`/api/customers/${paramCustomerId}/detail`)
        .then((res) => setWho({ customerId: res.header.id, label: res.header.name }))
        .catch(() => {});
    }
  }, [status, visitId, paramCustomerId]);

  const total = rows.reduce((sum, r) => {
    const price = Number(r.unitPrice) || 0;
    const qty = Number(r.quantity) || 0;
    return sum + price * qty;
  }, 0);

  const setRow = (index: number, key: keyof ItemRow, value: string) =>
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, [key]: value } : r)));

  // 保存後・「あとで」の戻り先。顧客がいれば顧客カルテ、お名前不明なら来店記録
  const backHref = customerId
    ? `/customers/${customerId}`
    : visitId
      ? `/visits/${visitId}`
      : "/visits";

  async function onSave() {
    setError(null);
    if (!customerId && !visitId) return setError("顧客か来店記録が指定されていません");
    if (!rows.some((r) => r.productName.trim())) {
      return setError("購入した商品を 1 つ以上入力してください");
    }

    setPending(true);
    try {
      const form = new FormData();
      if (customerId) form.set("customerId", customerId);
      if (visitId) form.set("visitId", visitId);
      form.set("purchasedAt", purchasedAt);
      form.set("note", note);
      for (const r of rows) {
        if (!r.productName.trim()) continue;
        form.append("productName", r.productName.trim());
        form.append("categoryId", r.categoryId);
        form.append("unitPrice", r.unitPrice || "0");
        form.append("quantity", r.quantity || "1");
        form.append("size", r.size);
      }

      const res = await apiFetch("/api/purchases", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "保存できませんでした");
        return;
      }
      router.push(backHref);
    } catch {
      setError("通信に失敗しました。もう一度お試しください");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="pb-32">
      <div className="border-b border-line bg-card px-5 py-4 sm:px-8">
        <h1 className="text-lg font-semibold sm:text-xl">購入登録</h1>
        <p className="mt-1 text-xs text-gray-soft">
          {who
            ? `${who.customerId ? `${who.label} 様` : who.label}の購入内容を登録します`
            : "顧客の購入内容を登録します"}
        </p>
        {who && !who.customerId && (
          <p className="mt-2 rounded bg-accent-soft px-3 py-2 text-[11.5px] leading-relaxed text-gray-soft">
            お名前不明のまま売上として記録します。あとで来店記録を顧客に紐付けると、購入履歴も顧客に付け替わります。
          </p>
        )}
      </div>

      <div className="mx-auto max-w-[640px] bg-card px-5 sm:px-6">
        <div className="border-b border-line py-4">
          <label className={labelClass}>購入日</label>
          <input
            type="date"
            className={inputClass}
            value={purchasedAt}
            onChange={(e) => setPurchasedAt(e.target.value)}
          />
        </div>

        <div className="border-b border-line py-4">
          <label className={labelClass}>購入した商品</label>
          <div className="space-y-3">
            {rows.map((r, i) => (
              <div key={i} className="rounded-md border border-line p-3">
                <input
                  className={inputClass}
                  placeholder="商品名"
                  value={r.productName}
                  onChange={(e) => setRow(i, "productName", e.target.value)}
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <select
                    aria-label="カテゴリー"
                    className={`${inputClass} appearance-none`}
                    value={r.categoryId}
                    onChange={(e) => setRow(i, "categoryId", e.target.value)}
                  >
                    <option value="">カテゴリー</option>
                    {masters?.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className={inputClass}
                    inputMode="numeric"
                    placeholder="金額（円）"
                    value={r.unitPrice}
                    onChange={(e) => setRow(i, "unitPrice", e.target.value)}
                  />
                  <input
                    className={inputClass}
                    inputMode="numeric"
                    placeholder="数量"
                    value={r.quantity}
                    onChange={(e) => setRow(i, "quantity", e.target.value)}
                  />
                  <input
                    className={inputClass}
                    placeholder="サイズ（任意）"
                    value={r.size}
                    onChange={(e) => setRow(i, "size", e.target.value)}
                  />
                </div>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                    className="mt-2 text-[12.5px] text-danger"
                  >
                    この行を削除
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, { ...EMPTY_ROW }])}
            className={`${buttonSecondaryClass} mt-3 w-full`}
          >
            ＋ 商品を追加
          </button>
        </div>

        <div className="flex items-center justify-between border-b border-line py-4">
          <span className="text-sm font-semibold">合計</span>
          <span className="tabular text-xl font-semibold text-accent">{formatYen(total)}</span>
        </div>

        <div className="py-4">
          <label className={labelClass}>備考</label>
          <textarea
            className={`${inputClass} min-h-[74px] py-2.5`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-[58px] z-20 border-t border-line bg-card px-4 py-2.5 md:bottom-0 md:ml-[206px] md:px-6">
        <div className="mx-auto flex max-w-[640px] items-center gap-2.5">
          <button
            type="button"
            onClick={() => router.push(backHref)}
            className={`${buttonSecondaryClass} w-[92px] flex-none`}
          >
            あとで
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={pending}
            className={`${buttonPrimaryClass} flex-1`}
          >
            {pending ? "保存しています…" : "保存する"}
          </button>
        </div>
        {error && (
          <p className="mx-auto mt-2 max-w-[640px] text-[13px] font-medium text-danger">{error}</p>
        )}
      </div>
    </div>
  );
}

export default function NewPurchasePage() {
  return (
    <Suspense fallback={null}>
      <PurchaseForm />
    </Suspense>
  );
}
