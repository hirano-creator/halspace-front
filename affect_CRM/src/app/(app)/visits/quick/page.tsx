"use client";

// クイック来店登録
//
// スタッフが接客の合間に、スマホで、キーボードをほとんど開かずに記録を終えられることが最優先。
// 保存に必要なのは「購入／未購入」だけ。あとから来店一覧で補える。

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, apiFetchJson } from "@/lib/auth/api-fetch";
import { useAuth } from "@/lib/auth/client";
import { ChipGroup, ChipMultiGroup } from "@/components/chips";
import { GuestBreakdownEditor } from "@/components/guest-breakdown";
import { AGE_GROUPS, AGE_GROUP_LABELS, PREFECTURES } from "@/lib/constants";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
  labelClass,
} from "@/components/ui";
import type { MastersResponse } from "../../customers/types";
import type { CustomerSuggestion, GuestBreakdownRow } from "../types";

type CustomerMode = "none" | "selected" | "new" | "anonymous";

const AGE_OPTIONS = AGE_GROUPS.map((code) => ({ code, label: AGE_GROUP_LABELS[code] }));
const GENDER_OPTIONS = [
  { code: "MALE", label: "男性" },
  { code: "FEMALE", label: "女性" },
  { code: "UNKNOWN", label: "不明" },
];
const PARTY_OPTIONS = [
  { code: "1", label: "1人" },
  { code: "2", label: "2人" },
  { code: "3", label: "3人" },
  { code: "4", label: "4人以上" },
];

export default function QuickVisitPage() {
  const router = useRouter();
  const { status } = useAuth();

  const [masters, setMasters] = useState<MastersResponse | null>(null);

  // 顧客
  const [mode, setMode] = useState<CustomerMode>("none");
  const [customer, setCustomer] = useState<CustomerSuggestion | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<CustomerSuggestion[]>([]);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  // 匿名
  const [partySize, setPartySize] = useState("1");
  const [ageGroup, setAgeGroup] = useState<string | null>(null);
  const [gender, setGender] = useState<string | null>(null);
  const [guestBreakdown, setGuestBreakdown] = useState<GuestBreakdownRow[]>([]);

  // 来店内容
  const [purpose, setPurpose] = useState<string | null>(null);
  const [channel, setChannel] = useState<string | null>(null);
  const [prefecture, setPrefecture] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [purchased, setPurchased] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [memo, setMemo] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    apiFetchJson<MastersResponse>("/api/masters").then(setMasters).catch(() => {});
  }, [status]);

  // 顧客検索（検索欄が空でも最近来た人を出す）
  useEffect(() => {
    if (!searchOpen) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      apiFetchJson<{ customers: CustomerSuggestion[] }>(
        `/api/customers/search?q=${encodeURIComponent(query)}`,
      )
        .then((res) => {
          if (!cancelled) setSuggestions(res.customers);
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, searchOpen]);

  const categoryOptions = (masters?.categories ?? []).map((c) => ({ code: c.id, label: c.name }));

  async function onSave() {
    setError(null);

    if (purchased === null) return setError("購入／未購入を選んでください");
    if (mode === "new" && !newName.trim()) return setError("氏名を入力してください");
    if (mode === "none") return setError("顧客を選ぶか「名前不明で記録」を選んでください");

    setPending(true);
    try {
      let customerId = mode === "selected" ? (customer?.id ?? null) : null;

      // 新規顧客はその場で作る（名前だけで登録できる。詳細は後から編集する）
      if (mode === "new") {
        const cf = new FormData();
        cf.set("name", newName.trim());
        if (newPhone.trim()) cf.set("phone", newPhone.trim());
        cf.set("confirmDuplicate", "1"); // クイック登録では重複確認を挟まず、後で統合できるようにする
        const res = await apiFetch("/api/customers", { method: "POST", body: cf });
        const data = (await res.json().catch(() => null)) as
          | { customer: { id: string } }
          | { error: string }
          | null;
        if (!res.ok || !data || !("customer" in data)) {
          setError((data && "error" in data && data.error) || "顧客を登録できませんでした");
          return;
        }
        customerId = data.customer.id;
      }

      const form = new FormData();
      if (customerId) form.set("customerId", customerId);
      if (mode === "anonymous") {
        form.set("partySize", partySize === "4" ? "4" : partySize);
        if (ageGroup) form.set("guestAgeGroup", ageGroup);
        if (gender) form.set("guestGender", gender);
        // 内訳は年代・性別を必ず対で送る（片方だけ未選択でも空文字で埋めて index をずらさない）
        for (const g of guestBreakdown) {
          form.append("guestBreakdownAgeGroup", g.ageGroup ?? "");
          form.append("guestBreakdownGender", g.gender ?? "");
        }
      }
      if (purpose) form.set("purposeCode", purpose);
      if (channel) form.set("channelCode", channel);
      if (prefecture) form.set("prefectureCode", prefecture);
      for (const id of interests) form.append("interestCategoryIds", id);
      form.set("purchased", purchased ? "yes" : "no");
      if (!purchased && reason) form.set("noPurchaseReasonCode", reason);
      if (memo.trim()) form.set("conversation", memo.trim());

      const res = await apiFetch("/api/visits", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as
        | { visit: { id: string; customerId: string | null } }
        | { error: string }
        | null;

      if (!res.ok || !data || !("visit" in data)) {
        setError((data && "error" in data && data.error) || "保存できませんでした");
        return;
      }

      // 購入があった場合は、そのまま購入内容の登録へ進めるようにする
      if (purchased && data.visit.customerId) {
        router.push(`/products/purchases/new?visitId=${data.visit.id}&customerId=${data.visit.customerId}`);
      } else {
        router.push("/visits?saved=1");
      }
    } catch {
      setError("通信に失敗しました。電波の状況を確認してもう一度お試しください");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="pb-32">
      <div className="flex items-center gap-3 border-b-2 border-accent bg-card px-4 py-3.5 sm:px-6">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="閉じる"
          className="text-xl text-gray-soft"
        >
          ×
        </button>
        <h1 className="text-base font-semibold">クイック来店登録</h1>
      </div>

      <div className="mx-auto max-w-[560px] bg-card px-4 sm:px-6">
        {/* ---------- 顧客 ---------- */}
        <section className="border-b border-line py-4">
          <label className={labelClass}>顧客</label>

          {mode === "selected" && customer && (
            <div className="flex min-h-11 items-center justify-between rounded-md border border-accent px-3">
              <span className="font-semibold">{customer.name}</span>
              <span className="text-xs text-gray-soft">
                {customer.visitCount > 0 ? `来店 ${customer.visitCount + 1} 回目` : "初回来店"}
              </span>
            </div>
          )}

          {mode === "anonymous" && (
            <div className="flex min-h-11 items-center justify-between rounded-md border border-dashed border-gray-faint bg-bg px-3">
              <span className="font-semibold text-ink-2">お名前不明のまま記録</span>
              <span className="text-xs text-gray-soft">あとで紐付け可</span>
            </div>
          )}

          {mode === "new" && (
            <div className="space-y-2.5">
              <input
                className={inputClass}
                placeholder="氏名"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <input
                className={inputClass}
                placeholder="電話番号（任意）"
                inputMode="tel"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
              />
            </div>
          )}

          {mode === "none" && !searchOpen && (
            <p className="text-sm text-gray-soft">下から選んでください</p>
          )}

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <ModeButton
              on={searchOpen || mode === "selected"}
              onClick={() => {
                setSearchOpen(true);
                setMode(mode === "selected" ? "selected" : "none");
              }}
            >
              顧客を検索
            </ModeButton>
            <ModeButton
              on={mode === "new"}
              onClick={() => {
                setMode("new");
                setSearchOpen(false);
              }}
            >
              新規登録
            </ModeButton>
            <ModeButton
              on={mode === "anonymous"}
              onClick={() => {
                setMode("anonymous");
                setSearchOpen(false);
                setCustomer(null);
              }}
            >
              名前不明で記録
            </ModeButton>
          </div>

          {searchOpen && (
            <div className="mt-3 rounded-md border border-line">
              <input
                autoFocus
                className="w-full min-h-11 border-b border-line px-3 text-base outline-none sm:text-sm"
                placeholder="名前・電話番号で検索"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <ul className="max-h-64 overflow-y-auto">
                {suggestions.length === 0 && (
                  <li className="px-3 py-4 text-center text-sm text-gray-soft">
                    該当する顧客がいません
                  </li>
                )}
                {suggestions.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomer(c);
                        setMode("selected");
                        setSearchOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-3 border-b border-line-2 px-3 py-3 text-left last:border-b-0 hover:bg-bg"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{c.name}</span>
                        <span className="block text-[11px] text-gray-soft">
                          {c.code}
                          {c.phone && `／${c.phone}`}
                          {c.lastVisitLabel && `／最終来店 ${c.lastVisitLabel}`}
                        </span>
                      </span>
                      <span className="tabular flex-none text-[11px] text-gray-soft">
                        {c.visitCount} 回
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* ---------- 匿名のときだけ聞く ---------- */}
        {mode === "anonymous" && (
          <>
            <section className="border-b border-line py-4">
              <label className={labelClass}>人数</label>
              <ChipGroup
                options={PARTY_OPTIONS}
                value={partySize}
                onChange={(v) => {
                  const next = v ?? "1";
                  setPartySize(next);
                  // 1人に戻したら内訳も意味を持たないので消す
                  if (next === "1") setGuestBreakdown([]);
                }}
              />
            </section>
            <section className="border-b border-line py-4">
              <label className={labelClass}>
                {partySize === "1" ? "だいたいの年代" : "だいたいの年代（代表）"}
              </label>
              <ChipGroup options={AGE_OPTIONS} value={ageGroup} onChange={setAgeGroup} />
            </section>
            <section className="border-b border-line py-4">
              <label className={labelClass}>{partySize === "1" ? "性別" : "性別（代表）"}</label>
              <ChipGroup options={GENDER_OPTIONS} value={gender} onChange={setGender} />
              {partySize !== "1" && (
                <GuestBreakdownEditor
                  rows={guestBreakdown}
                  onChange={setGuestBreakdown}
                  groupAgeGroup={ageGroup}
                  groupGender={gender}
                />
              )}
            </section>
          </>
        )}

        {/* ---------- 来店内容 ---------- */}
        <section className="border-b border-line py-4">
          <label className={labelClass}>来店目的</label>
          <ChipGroup
            options={masters?.options.VISIT_PURPOSE ?? []}
            value={purpose}
            onChange={setPurpose}
          />
        </section>

        <section className="border-b border-line py-4">
          <label className={labelClass}>来店経路</label>
          <ChipGroup
            options={masters?.options.VISIT_CHANNEL ?? []}
            value={channel}
            onChange={setChannel}
          />
        </section>

        <section className="border-b border-line py-4">
          <label className={labelClass}>来店エリア</label>
          <select
            className={inputClass}
            value={prefecture ?? ""}
            onChange={(e) => setPrefecture(e.target.value || null)}
          >
            <option value="">選択してください</option>
            {PREFECTURES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </section>

        <section className="border-b border-line py-4">
          <label className={labelClass}>
            {mode === "anonymous" ? "見ていた商品" : "興味のある商品"}
          </label>
          <ChipMultiGroup options={categoryOptions} values={interests} onChange={setInterests} />
        </section>

        {/* 記録の中で最も重要な項目なので、他より大きく置く */}
        <section className="border-b border-line py-4">
          <label className={labelClass}>
            購入 / 未購入
            <span className="ml-1.5 text-[10.5px] font-normal text-accent">必須</span>
          </label>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setPurchased(true)}
              className={`grid min-h-[60px] place-items-center rounded-md text-base font-semibold ${
                purchased === true
                  ? "border-2 border-accent bg-accent-soft text-accent"
                  : "border border-line bg-card text-gray-soft"
              }`}
            >
              購入した
            </button>
            <button
              type="button"
              onClick={() => setPurchased(false)}
              className={`grid min-h-[60px] place-items-center rounded-md text-base font-semibold ${
                purchased === false
                  ? "border-2 border-navy bg-card text-navy"
                  : "border border-line bg-card text-gray-soft"
              }`}
            >
              未購入
            </button>
          </div>
        </section>

        {purchased === false && (
          <section className="border-b border-line py-4">
            <label className={labelClass}>未購入の理由</label>
            <ChipGroup
              options={masters?.options.NO_PURCHASE_REASON ?? []}
              value={reason}
              onChange={setReason}
            />
          </section>
        )}

        <section className="py-4">
          <label className={labelClass}>メモ</label>
          <textarea
            className={`${inputClass} min-h-[74px] py-2.5`}
            placeholder="会話の内容、気になっていた商品など"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
          {mode === "anonymous" && (
            <p className="mt-2.5 rounded bg-accent-soft px-3 py-2.5 text-[11.5px] leading-relaxed text-gray-soft">
              この記録は<b className="text-ink">来店数・年代別・経路別の分析に反映されます</b>
              。あとで同じ方だと分かったら、顧客に紐付けられます。
            </p>
          )}
        </section>
      </div>

      {/* 固定の保存バー（スマホでは下部ナビの上に置く） */}
      <div className="fixed inset-x-0 bottom-[58px] z-20 border-t border-line bg-card px-4 py-2.5 md:bottom-0 md:ml-[206px] md:px-6">
        <div className="mx-auto flex max-w-[560px] items-center gap-2.5">
          <button
            type="button"
            onClick={() => router.back()}
            className={`${buttonSecondaryClass} w-[92px] flex-none`}
          >
            キャンセル
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
          <p className="mx-auto mt-2 max-w-[560px] text-[13px] font-medium text-danger">{error}</p>
        )}
      </div>
    </div>
  );
}

function ModeButton({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-9 items-center rounded-md border px-3 text-[12.5px] ${
        on ? "border-navy bg-bg font-semibold text-navy" : "border-line bg-card text-gray-soft"
      }`}
    >
      {children}
    </button>
  );
}
