"use client";

// 来店記録の詳細・編集
//
// クイック登録では聞かなかった項目（来店日時・人数・何を見て来たか・次回提案・
// フォロー予定日）を、あとからここで補える。
// 誤入力を直せないと記録そのものが続かないので、編集はスタッフにも開放する。
// 削除だけは集計が動くため管理者のみ。

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, apiFetchJson } from "@/lib/auth/api-fetch";
import { useAuth } from "@/lib/auth/client";
import { can } from "@/lib/auth/roles";
import { formatYen } from "@/lib/display";
import { AGE_GROUPS, AGE_GROUP_LABELS, PREFECTURES } from "@/lib/constants";
import { ChipGroup, ChipMultiGroup } from "@/components/chips";
import { GuestBreakdownEditor } from "@/components/guest-breakdown";
import {
  Empty,
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
  labelClass,
} from "@/components/ui";
import type { MastersResponse } from "../../customers/types";
import type { GuestBreakdownRow, VisitDetailResponse } from "../types";

const AGE_OPTIONS = AGE_GROUPS.map((code) => ({ code, label: AGE_GROUP_LABELS[code] }));
const GENDER_OPTIONS = [
  { code: "MALE", label: "男性" },
  { code: "FEMALE", label: "女性" },
  { code: "UNKNOWN", label: "不明" },
];

export default function VisitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, status } = useAuth();

  const [visit, setVisit] = useState<VisitDetailResponse | null>(null);
  const [masters, setMasters] = useState<MastersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  // 編集中の値
  const [visitedAt, setVisitedAt] = useState("");
  const [partySize, setPartySize] = useState("1");
  const [ageGroup, setAgeGroup] = useState<string | null>(null);
  const [gender, setGender] = useState<string | null>(null);
  const [guestBreakdown, setGuestBreakdown] = useState<GuestBreakdownRow[]>([]);
  const [purpose, setPurpose] = useState<string | null>(null);
  const [channel, setChannel] = useState<string | null>(null);
  const [referrer, setReferrer] = useState<string | null>(null);
  const [prefecture, setPrefecture] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [purchased, setPurchased] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [reasonComment, setReasonComment] = useState("");
  const [conversation, setConversation] = useState("");
  const [nextProposal, setNextProposal] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");

  const load = useCallback(() => {
    if (status !== "authenticated") return;
    apiFetchJson<VisitDetailResponse>(`/api/visits/${id}`)
      .then((v) => {
        setVisit(v);
        setVisitedAt(v.visitedAt);
        setPartySize(String(v.partySize));
        setAgeGroup(v.guestAgeGroup);
        setGender(v.guestGender);
        setGuestBreakdown(v.guestBreakdown);
        setPurpose(v.purposeCode);
        setChannel(v.channelCode);
        setReferrer(v.referrerCode);
        setPrefecture(v.prefectureCode);
        setInterests(v.interestCategoryIds);
        setPurchased(v.purchased);
        setReason(v.noPurchaseReasonCode);
        setReasonComment(v.noPurchaseComment ?? "");
        setConversation(v.conversation ?? "");
        setNextProposal(v.nextProposal ?? "");
        setFollowUpDate(v.followUpDate ?? "");
      })
      .catch((e: Error) => setError(e.message));
  }, [status, id]);

  useEffect(load, [load]);

  useEffect(() => {
    if (status !== "authenticated") return;
    apiFetchJson<MastersResponse>("/api/masters").then(setMasters).catch(() => {});
  }, [status]);

  async function save() {
    setError(null);
    setSaved(false);
    if (purchased === null) return setError("購入／未購入を選んでください");

    setPending(true);
    try {
      const form = new FormData();
      if (visit?.customerId) form.set("customerId", visit.customerId);
      form.set("visitedAt", visitedAt);
      form.set("partySize", partySize);
      if (!visit?.customerId) {
        if (ageGroup) form.set("guestAgeGroup", ageGroup);
        if (gender) form.set("guestGender", gender);
        for (const g of guestBreakdown) {
          form.append("guestBreakdownAgeGroup", g.ageGroup ?? "");
          form.append("guestBreakdownGender", g.gender ?? "");
        }
      }
      if (purpose) form.set("purposeCode", purpose);
      if (channel) form.set("channelCode", channel);
      if (referrer) form.set("referrerCode", referrer);
      if (prefecture) form.set("prefectureCode", prefecture);
      for (const c of interests) form.append("interestCategoryIds", c);
      form.set("purchased", purchased ? "yes" : "no");
      if (!purchased && reason) form.set("noPurchaseReasonCode", reason);
      if (!purchased) form.set("noPurchaseComment", reasonComment);
      form.set("conversation", conversation);
      form.set("nextProposal", nextProposal);
      form.set("followUpDate", followUpDate);

      const res = await apiFetch(`/api/visits/${id}`, { method: "PATCH", body: form });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(j?.error ?? "保存できませんでした");
        return;
      }
      setSaved(true);
      load();
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (
      !confirm(
        "この来店記録を削除します。よろしいですか？\n（顧客の来店回数・最終来店日も計算し直されます）",
      )
    ) {
      return;
    }
    const res = await apiFetch(`/api/visits/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/visits");
      return;
    }
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    setError(j?.error ?? "削除できませんでした");
  }

  if (!visit) {
    return <Empty>{error ? `読み込めませんでした（${error}）` : "読み込んでいます…"}</Empty>;
  }

  const canDelete = user ? can(user.role, "data.delete") : false;

  return (
    <div className="pb-32">
      <div className="border-b border-line bg-card px-5 pt-6 pb-4 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">来店記録</h1>
            <p className="mt-1.5 text-[13px] text-gray-soft">
              {visit.customerId ? (
                <Link href={`/customers/${visit.customerId}`} className="text-accent hover:underline">
                  {visit.displayName}
                </Link>
              ) : (
                visit.displayName
              )}
              {visit.isFirstVisit && "／初回来店"}
              {visit.staffName && `／担当 ${visit.staffName}`}
            </p>
          </div>
          {canDelete && (
            <button type="button" onClick={remove} className={`${buttonSecondaryClass} text-danger`}>
              削除
            </button>
          )}
        </div>

        {visit.purchases.length > 0 && (
          <p className="mt-3 rounded-md bg-accent-soft px-3.5 py-2.5 text-[12.5px] text-gray-soft">
            この来店の購入：
            {visit.purchases.map((p) => formatYen(p.totalAmount)).join("、")}

            <Link href="/products/purchases" className="font-medium text-accent hover:underline">
              購入履歴を見る
            </Link>
          </p>
        )}
      </div>

      <div className="mx-auto max-w-[640px] bg-card px-5 sm:px-6">
        <section className="border-b border-line py-4">
          <label className={labelClass}>来店日時</label>
          <input
            type="datetime-local"
            className={inputClass}
            value={visitedAt}
            onChange={(e) => setVisitedAt(e.target.value)}
          />
        </section>

        <section className="border-b border-line py-4">
          <label className={labelClass}>来店人数</label>
          <input
            className={inputClass}
            inputMode="numeric"
            value={partySize}
            onChange={(e) => setPartySize(e.target.value)}
          />
        </section>

        {/* お名前が分からない来店のときだけ、推定の年代・性別を持つ */}
        {!visit.customerId && (
          <>
            <section className="border-b border-line py-4">
              <label className={labelClass}>
                {Number(partySize) > 1 ? "だいたいの年代（代表）" : "だいたいの年代"}
              </label>
              <ChipGroup options={AGE_OPTIONS} value={ageGroup} onChange={setAgeGroup} />
            </section>
            <section className="border-b border-line py-4">
              <label className={labelClass}>{Number(partySize) > 1 ? "性別（代表）" : "性別"}</label>
              <ChipGroup options={GENDER_OPTIONS} value={gender} onChange={setGender} />
              {Number(partySize) > 1 && (
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
          <label className={labelClass}>何を見て来たか</label>
          <ChipGroup
            options={masters?.options.REFERRER ?? []}
            value={referrer}
            onChange={setReferrer}
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
          <label className={labelClass}>興味のある商品</label>
          <ChipMultiGroup
            options={(masters?.categories ?? []).map((c) => ({ code: c.id, label: c.name }))}
            values={interests}
            onChange={setInterests}
          />
        </section>

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
          {purchased === false && visit.purchases.length > 0 && (
            <p className="mt-2 text-[12px] text-danger">
              この来店には購入記録が残っています。「未購入」にする場合は、先に購入記録を削除してください。
            </p>
          )}
        </section>

        {purchased === false && (
          <>
            <section className="border-b border-line py-4">
              <label className={labelClass}>未購入の理由</label>
              <ChipGroup
                options={masters?.options.NO_PURCHASE_REASON ?? []}
                value={reason}
                onChange={setReason}
              />
            </section>
            <section className="border-b border-line py-4">
              <label className={labelClass}>未購入についてのメモ</label>
              <input
                className={inputClass}
                placeholder="来月のボーナスで検討したいとのこと"
                value={reasonComment}
                onChange={(e) => setReasonComment(e.target.value)}
              />
            </section>
          </>
        )}

        <section className="border-b border-line py-4">
          <label className={labelClass}>会話内容</label>
          <textarea
            className={`${inputClass} min-h-[74px] py-2.5`}
            value={conversation}
            onChange={(e) => setConversation(e.target.value)}
          />
        </section>

        <section className="border-b border-line py-4">
          <label className={labelClass}>次回提案</label>
          <input
            className={inputClass}
            placeholder="セミドライの入荷時に連絡する"
            value={nextProposal}
            onChange={(e) => setNextProposal(e.target.value)}
          />
        </section>

        <section className="py-4">
          <label className={labelClass}>フォロー予定日</label>
          <input
            type="date"
            className={inputClass}
            value={followUpDate}
            onChange={(e) => setFollowUpDate(e.target.value)}
          />
          <p className="mt-1.5 text-[11px] text-gray-soft">
            日付を入れると、フォロー管理とダッシュボードに予定として出ます。
          </p>
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-[58px] z-20 border-t border-line bg-card px-4 py-2.5 md:bottom-0 md:ml-[206px] md:px-6">
        <div className="mx-auto flex max-w-[640px] items-center gap-2.5">
          <button
            type="button"
            onClick={() => router.push("/visits")}
            className={`${buttonSecondaryClass} w-[92px] flex-none`}
          >
            戻る
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className={`${buttonPrimaryClass} flex-1`}
          >
            {pending ? "保存しています…" : "保存する"}
          </button>
        </div>
        {saved && (
          <p className="mx-auto mt-2 max-w-[640px] text-[13px] font-medium text-accent">
            保存しました
          </p>
        )}
        {error && (
          <p className="mx-auto mt-2 max-w-[640px] text-[13px] font-medium text-danger">{error}</p>
        )}
      </div>
    </div>
  );
}
