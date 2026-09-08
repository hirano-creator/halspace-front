"use client";

// 商品マスタ
//
// 購入明細は商品名のスナップショットを持つので、ここで名前を変えても
// 過去の購入履歴の表示は変わらない。削除はせず無効化する。

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, apiFetchJson } from "@/lib/auth/api-fetch";
import { useAuth } from "@/lib/auth/client";
import { can } from "@/lib/auth/roles";
import { formatYen } from "@/lib/display";
import {
  Empty,
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
  labelClass,
} from "@/components/ui";
import type { ProductItem, ProductListResponse } from "./types";

export default function ProductsPage() {
  const { user, status } = useAuth();
  const [q, setQ] = useState("");
  const [data, setData] = useState<ProductListResponse | null>(null);
  const [editing, setEditing] = useState<ProductItem | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (status !== "authenticated") return;
    apiFetchJson<ProductListResponse>(`/api/products?q=${encodeURIComponent(q)}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [status, q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const canEdit = user ? can(user.role, "master.edit") : false;

  return (
    <div className="pb-10">
      <div className="flex items-start justify-between gap-3 px-5 pt-6 sm:px-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">商品</h1>
          <p className="mt-1.5 text-xs text-gray-soft sm:text-[13px]">
            よく売れる商品を登録しておくと、購入登録が速くなります
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => setEditing("new")} className={buttonPrimaryClass}>
            ＋ 商品登録
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-y border-line bg-card px-5 py-3 sm:px-8">
        <input
          className={`${inputClass} max-w-[320px]`}
          placeholder="商品名・ブランドで検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Link href="/products/purchases" className="text-[13px] font-medium text-accent hover:underline">
          購入履歴を見る →
        </Link>
      </div>

      {error && <p className="px-5 py-3 text-[13px] text-danger sm:px-8">{error}</p>}

      {!data ? (
        <Empty>読み込んでいます…</Empty>
      ) : data.products.length === 0 ? (
        <Empty>
          商品がまだ登録されていません。
          <br />
          登録しなくても購入登録はできます（その場合は商品名を直接入力します）。
        </Empty>
      ) : (
        <div className="border-b border-line bg-card">
          {data.products.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-3 border-b border-line-2 px-5 py-3.5 last:border-b-0 sm:px-8"
            >
              <div className="min-w-0">
                <span className="text-[14.5px] font-semibold">{p.name}</span>
                <p className="mt-0.5 text-[12px] text-gray-soft">
                  {[p.categoryName, p.brand].filter(Boolean).join("／") || "—"}
                </p>
              </div>
              <div className="flex flex-none items-center gap-3">
                <span className="tabular text-[14px] font-semibold">
                  {p.price != null ? formatYen(p.price) : "—"}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setEditing(p)}
                    className={`${buttonSecondaryClass} text-[13px]`}
                  >
                    編集
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && data && (
        <ProductDialog
          product={editing === "new" ? null : editing}
          categories={data.categories}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ProductDialog({
  product,
  categories,
  onClose,
  onSaved,
}: {
  product: ProductItem | null;
  categories: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(product?.name ?? "");
  const [brand, setBrand] = useState(product?.brand ?? "");
  const [price, setPrice] = useState(product?.price != null ? String(product.price) : "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    setError(null);
    if (!name.trim()) return setError("商品名を入力してください");

    setPending(true);
    try {
      const body = new FormData();
      body.set("name", name.trim());
      body.set("brand", brand);
      body.set("price", price);
      body.set("categoryId", categoryId);

      const res = await apiFetch(product ? `/api/products/${product.id}` : "/api/products", {
        method: product ? "PATCH" : "POST",
        body,
      });
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

  async function remove() {
    if (!product) return;
    if (!confirm("この商品を一覧から外します。よろしいですか？\n（過去の購入履歴は残ります）")) return;
    const res = await apiFetch(`/api/products/${product.id}`, { method: "DELETE" });
    if (res.ok) onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div className="w-full max-w-[420px] rounded-lg bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{product ? "商品の編集" : "商品登録"}</h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-xl text-gray-soft">
            ×
          </button>
        </div>

        <div className="py-3">
          <label className={labelClass}>
            商品名<span className="ml-1.5 text-[10.5px] font-normal text-accent">必須</span>
          </label>
          <input
            className={inputClass}
            placeholder="セミドライ ウェットスーツ"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 py-3">
          <div>
            <label className={labelClass}>ブランド</label>
            <input className={inputClass} value={brand} onChange={(e) => setBrand(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>価格（円）</label>
            <input
              className={inputClass}
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
        </div>

        <div className="py-3">
          <label className={labelClass}>カテゴリー</label>
          <select
            className={`${inputClass} appearance-none`}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">未分類</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="mt-1 text-[13px] font-medium text-danger">{error}</p>}

        <div className="mt-4 flex gap-2.5">
          {product && (
            <button type="button" onClick={remove} className={`${buttonSecondaryClass} text-danger`}>
              削除
            </button>
          )}
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
