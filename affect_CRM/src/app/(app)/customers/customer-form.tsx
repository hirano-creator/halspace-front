"use client";

// 顧客の登録・編集フォーム（新規と編集で共有する）
//
// 入力項目は多いので、サーフィン情報は折りたためるようにして、
// 最初の画面で聞くのは基本情報だけにしている。

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, apiFetchJson } from "@/lib/auth/api-fetch";
import { useAuth } from "@/lib/auth/client";
import { ChipGroup, ChipMultiGroup } from "@/components/chips";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
  labelClass,
} from "@/components/ui";
import type { CustomerDetailResponse, DuplicateCandidate, MastersResponse } from "./types";

export interface CustomerFormValues {
  name: string;
  nameKana: string;
  nickname: string;
  gender: string | null;
  birthday: string;
  phone: string;
  email: string;
  prefecture: string;
  city: string;
  addressLine: string;
  lineId: string;
  instagram: string;
  rank: string | null;
  note: string;
  tagIds: string[];
  experienceYears: string;
  surfLevel: string | null;
  boardType: string | null;
  boardSize: string;
  wetsuitSize: string | null;
  surfFrequency: string | null;
  favoritePoints: string;
  interestedCategories: string[];
}

const EMPTY: CustomerFormValues = {
  name: "",
  nameKana: "",
  nickname: "",
  gender: null,
  birthday: "",
  phone: "",
  email: "",
  prefecture: "",
  city: "",
  addressLine: "",
  lineId: "",
  instagram: "",
  rank: null,
  note: "",
  tagIds: [],
  experienceYears: "",
  surfLevel: null,
  boardType: null,
  boardSize: "",
  wetsuitSize: null,
  surfFrequency: null,
  favoritePoints: "",
  interestedCategories: [],
};

const GENDER_OPTIONS = [
  { code: "MALE", label: "男性" },
  { code: "FEMALE", label: "女性" },
  { code: "OTHER", label: "その他" },
  { code: "UNKNOWN", label: "不明" },
];

export function CustomerForm({ customerId }: { customerId?: string }) {
  const router = useRouter();
  const { status } = useAuth();
  const [values, setValues] = useState<CustomerFormValues>(EMPTY);
  const [masters, setMasters] = useState<MastersResponse | null>(null);
  const [surfOpen, setSurfOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(!customerId);

  const set = <K extends keyof CustomerFormValues>(key: K, value: CustomerFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  useEffect(() => {
    if (status !== "authenticated") return;
    apiFetchJson<MastersResponse>("/api/masters").then(setMasters).catch(() => {});
  }, [status]);

  // 編集時は既存の値を読み込む
  useEffect(() => {
    if (status !== "authenticated" || !customerId) return;
    apiFetchJson<CustomerDetailResponse>(`/api/customers/${customerId}/detail`)
      .then((res) => {
        const h = res.header;
        setValues({
          name: h.name,
          nameKana: h.nameKana ?? "",
          nickname: h.nickname ?? "",
          gender: h.gender,
          birthday: h.birthday ? h.birthday.slice(0, 10) : "",
          phone: h.phone ?? "",
          email: h.email ?? "",
          prefecture: h.prefecture ?? "",
          city: h.city ?? "",
          addressLine: h.addressLine ?? "",
          lineId: h.lineId ?? "",
          instagram: h.instagram ?? "",
          rank: h.rank,
          note: h.note ?? "",
          tagIds: h.tags.map((t) => t.id),
          experienceYears: h.surf?.experienceYears != null ? String(h.surf.experienceYears) : "",
          surfLevel: null,
          boardType: null,
          boardSize: h.surf?.boardSize ?? "",
          wetsuitSize: null,
          surfFrequency: null,
          favoritePoints: h.surf?.favoritePoints ?? "",
          interestedCategories: [],
        });
        setLoaded(true);
      })
      .catch((e: Error) => setError(e.message));
  }, [status, customerId]);

  async function submit(confirmDuplicate: boolean) {
    setError(null);
    if (!values.name.trim()) {
      setError("氏名を入力してください");
      return;
    }

    setPending(true);
    try {
      const form = new FormData();
      form.set("name", values.name.trim());
      form.set("nameKana", values.nameKana);
      form.set("nickname", values.nickname);
      if (values.gender) form.set("gender", values.gender);
      form.set("birthday", values.birthday);
      form.set("phone", values.phone);
      form.set("email", values.email);
      form.set("prefecture", values.prefecture);
      form.set("city", values.city);
      form.set("addressLine", values.addressLine);
      form.set("lineId", values.lineId);
      form.set("instagram", values.instagram);
      if (values.rank) form.set("rank", values.rank);
      form.set("note", values.note);
      for (const id of values.tagIds) form.append("tagIds", id);
      form.set("experienceYears", values.experienceYears);
      if (values.surfLevel) form.set("surfLevel", values.surfLevel);
      if (values.boardType) form.set("boardType", values.boardType);
      form.set("boardSize", values.boardSize);
      if (values.wetsuitSize) form.set("wetsuitSize", values.wetsuitSize);
      if (values.surfFrequency) form.set("surfFrequency", values.surfFrequency);
      form.set("favoritePoints", values.favoritePoints);
      for (const id of values.interestedCategories) form.append("interestedCategories", id);
      if (confirmDuplicate) form.set("confirmDuplicate", "1");

      const url = customerId ? `/api/customers/${customerId}` : "/api/customers";
      const res = await apiFetch(url, { method: customerId ? "PATCH" : "POST", body: form });

      if (res.status === 409) {
        const data = (await res.json()) as { duplicates: DuplicateCandidate[] };
        setDuplicates(data.duplicates);
        return;
      }

      const data = (await res.json().catch(() => null)) as
        | { customer?: { id: string }; ok?: boolean; error?: string }
        | null;

      if (!res.ok) {
        setError(data?.error ?? "保存できませんでした");
        return;
      }

      router.push(customerId ? `/customers/${customerId}` : `/customers/${data?.customer?.id ?? ""}`);
    } catch {
      setError("通信に失敗しました。もう一度お試しください");
    } finally {
      setPending(false);
    }
  }

  if (!loaded) return <p className="px-5 py-10 text-sm text-gray-soft">読み込んでいます…</p>;

  return (
    <div className="pb-32">
      <div className="mx-auto max-w-[640px] bg-card px-5 sm:px-6">
        <Section title="基本情報">
          <Row label="氏名" required>
            <input
              className={inputClass}
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Row>
          <Row label="フリガナ">
            <input
              className={inputClass}
              placeholder="ヤマダ タロウ"
              value={values.nameKana}
              onChange={(e) => set("nameKana", e.target.value)}
            />
          </Row>
          <Row label="ニックネーム">
            <input
              className={inputClass}
              value={values.nickname}
              onChange={(e) => set("nickname", e.target.value)}
            />
          </Row>
          <Row label="性別">
            <ChipGroup options={GENDER_OPTIONS} value={values.gender} onChange={(v) => set("gender", v)} />
          </Row>
          <Row label="生年月日">
            <input
              type="date"
              className={inputClass}
              value={values.birthday}
              onChange={(e) => set("birthday", e.target.value)}
            />
          </Row>
          <Row label="電話番号">
            <input
              className={inputClass}
              inputMode="tel"
              placeholder="090-1234-5678"
              value={values.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </Row>
          <Row label="メールアドレス">
            <input
              className={inputClass}
              inputMode="email"
              value={values.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Row>
          <Row label="居住地">
            <div className="grid grid-cols-2 gap-2">
              <input
                className={inputClass}
                placeholder="都道府県"
                value={values.prefecture}
                onChange={(e) => set("prefecture", e.target.value)}
              />
              <input
                className={inputClass}
                placeholder="市区町村"
                value={values.city}
                onChange={(e) => set("city", e.target.value)}
              />
            </div>
          </Row>
          <Row label="LINE / Instagram">
            <div className="grid grid-cols-2 gap-2">
              <input
                className={inputClass}
                placeholder="LINE ID"
                value={values.lineId}
                onChange={(e) => set("lineId", e.target.value)}
              />
              <input
                className={inputClass}
                placeholder="@instagram"
                value={values.instagram}
                onChange={(e) => set("instagram", e.target.value)}
              />
            </div>
          </Row>
          <Row label="顧客ランク">
            <ChipGroup
              options={masters?.options.CUSTOMER_RANK ?? []}
              value={values.rank}
              onChange={(v) => set("rank", v)}
            />
          </Row>
          <Row label="タグ">
            <ChipMultiGroup
              options={(masters?.tags ?? []).map((t) => ({ code: t.id, label: t.name }))}
              values={values.tagIds}
              onChange={(v) => set("tagIds", v)}
            />
          </Row>
          <Row label="備考">
            <textarea
              className={`${inputClass} min-h-[74px] py-2.5`}
              value={values.note}
              onChange={(e) => set("note", e.target.value)}
            />
          </Row>
        </Section>

        <section className="border-b border-line">
          <button
            type="button"
            onClick={() => setSurfOpen((o) => !o)}
            className="flex min-h-14 w-full items-center justify-between text-left"
          >
            <span className="text-sm font-semibold">サーフィン情報</span>
            <span className="text-xs text-gray-soft">{surfOpen ? "閉じる" : "入力する"}</span>
          </button>
          {surfOpen && (
            <div className="pb-2">
              <Row label="サーフィン歴（年）">
                <input
                  className={inputClass}
                  inputMode="numeric"
                  value={values.experienceYears}
                  onChange={(e) => set("experienceYears", e.target.value)}
                />
              </Row>
              <Row label="サーフィンレベル">
                <ChipGroup
                  options={masters?.options.SURF_LEVEL ?? []}
                  value={values.surfLevel}
                  onChange={(v) => set("surfLevel", v)}
                />
              </Row>
              <Row label="ボードタイプ">
                <ChipGroup
                  options={masters?.options.BOARD_TYPE ?? []}
                  value={values.boardType}
                  onChange={(v) => set("boardType", v)}
                />
              </Row>
              <Row label="ボードサイズ">
                <input
                  className={inputClass}
                  placeholder={`5'10"`}
                  value={values.boardSize}
                  onChange={(e) => set("boardSize", e.target.value)}
                />
              </Row>
              <Row label="ウェットスーツサイズ">
                <ChipGroup
                  options={masters?.options.WETSUIT_SIZE ?? []}
                  value={values.wetsuitSize}
                  onChange={(v) => set("wetsuitSize", v)}
                />
              </Row>
              <Row label="サーフィン頻度">
                <ChipGroup
                  options={masters?.options.SURF_FREQUENCY ?? []}
                  value={values.surfFrequency}
                  onChange={(v) => set("surfFrequency", v)}
                />
              </Row>
              <Row label="よく行くポイント">
                <input
                  className={inputClass}
                  value={values.favoritePoints}
                  onChange={(e) => set("favoritePoints", e.target.value)}
                />
              </Row>
              <Row label="興味のある商品">
                <ChipMultiGroup
                  options={(masters?.categories ?? []).map((c) => ({ code: c.id, label: c.name }))}
                  values={values.interestedCategories}
                  onChange={(v) => set("interestedCategories", v)}
                />
              </Row>
            </div>
          )}
        </section>
      </div>

      {/* 重複候補。勝手に統合せず、スタッフに判断してもらう */}
      {duplicates && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
          <div className="w-full max-w-[460px] rounded-lg bg-card p-5">
            <h2 className="text-base font-semibold">同じ連絡先の顧客がいます</h2>
            <p className="mt-1.5 text-[13px] text-gray-soft">
              同じ方であれば既存の顧客を開いてください。別の方であれば、このまま登録できます。
            </p>
            <ul className="mt-3.5 divide-y divide-line-2 border-y border-line-2">
              {duplicates.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{d.name}</span>
                    <span className="block text-[11px] text-gray-soft">
                      {d.code}／{d.reason}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => router.push(`/customers/${d.id}`)}
                    className="flex-none text-[13px] font-medium text-accent"
                  >
                    開く
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={() => setDuplicates(null)}
                className={`${buttonSecondaryClass} flex-1`}
              >
                入力に戻る
              </button>
              <button
                type="button"
                onClick={() => {
                  setDuplicates(null);
                  submit(true);
                }}
                className={`${buttonPrimaryClass} flex-1`}
              >
                別の方として登録
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-[58px] z-20 border-t border-line bg-card px-4 py-2.5 md:bottom-0 md:ml-[206px] md:px-6">
        <div className="mx-auto flex max-w-[640px] items-center gap-2.5">
          <button
            type="button"
            onClick={() => router.back()}
            className={`${buttonSecondaryClass} w-[92px] flex-none`}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => submit(false)}
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line py-2">
      <h2 className="pt-3 pb-1 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Row({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="py-3">
      <label className={labelClass}>
        {label}
        {required && <span className="ml-1.5 text-[10.5px] font-normal text-accent">必須</span>}
      </label>
      {children}
    </div>
  );
}
