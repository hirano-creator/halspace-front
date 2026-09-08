"use client";

// スクールのコース管理
//
// コースは削除せず無効化する（過去の開催枠・参加履歴の表示を壊さないため）。

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
import { ChipMultiGroup } from "@/components/chips";
import type { CourseItem, CourseListResponse } from "./types";

export default function SchoolsPage() {
  const { user, status } = useAuth();
  const [data, setData] = useState<CourseListResponse | null>(null);
  const [editing, setEditing] = useState<CourseItem | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (status !== "authenticated") return;
    apiFetchJson<CourseListResponse>("/api/schools/courses")
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [status]);

  useEffect(load, [load]);

  const canEdit = user ? can(user.role, "master.edit") : false;

  return (
    <div className="pb-10">
      <div className="flex items-start justify-between gap-3 px-5 pt-6 sm:px-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">スクール</h1>
          <p className="mt-1.5 text-xs text-gray-soft sm:text-[13px]">
            コースを登録すると、予約カレンダーで開催枠を作れます
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => setEditing("new")} className={buttonPrimaryClass}>
            ＋ コース登録
          </button>
        )}
      </div>

      {error && <p className="px-5 py-3 text-[13px] text-danger sm:px-8">{error}</p>}

      {!data ? (
        <Empty>読み込んでいます…</Empty>
      ) : data.courses.length === 0 ? (
        <Empty>
          まだコースがありません。
          {canEdit ? "「＋ コース登録」から追加してください。" : "管理者が登録すると表示されます。"}
        </Empty>
      ) : (
        <div className="mt-4 border-y border-line bg-card">
          {data.courses.map((c) => (
            <div key={c.id} className="border-b border-line-2 px-5 py-4 last:border-b-0 sm:px-8">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[15px] font-semibold">{c.name}</span>
                    {c.levelLabel && (
                      <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-[10.5px] text-accent">
                        {c.levelLabel}
                      </span>
                    )}
                    {!c.isPublished && (
                      <span className="rounded-sm bg-line-2 px-1.5 py-0.5 text-[10.5px] text-gray-soft">
                        非公開
                      </span>
                    )}
                  </div>
                  <p className="tabular mt-1 text-[12.5px] text-gray-soft">
                    {c.durationMinutes} 分／{formatYen(c.price)}／定員 {c.capacity} 名
                    {c.staffNames.length > 0 && `／担当 ${c.staffNames.join("・")}`}
                  </p>
                  {c.description && (
                    <p className="mt-1.5 text-[13px] text-ink-2">{c.description}</p>
                  )}
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setEditing(c)}
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

      <div className="px-5 py-5 sm:px-8">
        <Link href="/calendar" className="text-[13px] font-medium text-accent hover:underline">
          予約カレンダーで開催枠を作る →
        </Link>
      </div>

      {editing && data && (
        <CourseDialog
          course={editing === "new" ? null : editing}
          staffs={data.staffs}
          levels={data.levels}
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

function CourseDialog({
  course,
  staffs,
  levels,
  onClose,
  onSaved,
}: {
  course: CourseItem | null;
  staffs: { id: string; name: string }[];
  levels: { code: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(course?.name ?? "");
  const [description, setDescription] = useState(course?.description ?? "");
  const [duration, setDuration] = useState(String(course?.durationMinutes ?? 90));
  const [price, setPrice] = useState(String(course?.price ?? 0));
  const [capacity, setCapacity] = useState(String(course?.capacity ?? 5));
  const [level, setLevel] = useState(course?.level ?? "");
  const [isPublished, setIsPublished] = useState(course?.isPublished ?? false);
  const [staffIds, setStaffIds] = useState<string[]>(course?.staffIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    setError(null);
    if (!name.trim()) return setError("コース名を入力してください");

    setPending(true);
    try {
      const body = new FormData();
      body.set("name", name.trim());
      body.set("description", description);
      body.set("durationMinutes", duration);
      body.set("price", price);
      body.set("capacity", capacity);
      if (level) body.set("level", level);
      body.set("isPublished", isPublished ? "1" : "0");
      for (const id of staffIds) body.append("staffIds", id);

      const res = await apiFetch(course ? `/api/schools/courses/${course.id}` : "/api/schools/courses", {
        method: course ? "PATCH" : "POST",
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
    if (!course) return;
    if (!confirm("このコースを一覧から外します。よろしいですか？\n（過去の開催枠・参加履歴は残ります）")) return;
    const res = await apiFetch(`/api/schools/courses/${course.id}`, { method: "DELETE" });
    if (res.ok) onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div className="max-h-[86vh] w-full max-w-[500px] overflow-y-auto rounded-lg bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{course ? "コースの編集" : "コース登録"}</h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-xl text-gray-soft">
            ×
          </button>
        </div>

        <div className="py-3">
          <label className={labelClass}>
            コース名<span className="ml-1.5 text-[10.5px] font-normal text-accent">必須</span>
          </label>
          <input
            className={inputClass}
            placeholder="初心者スクール"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="py-3">
          <label className={labelClass}>説明</label>
          <textarea
            className={`${inputClass} min-h-[64px] py-2.5`}
            placeholder="はじめての方向け。ボード・ウェットのレンタル込みです。"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-3 gap-2 py-3">
          <div>
            <label className={labelClass}>所要時間（分）</label>
            <input
              className={inputClass}
              inputMode="numeric"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>料金（円）</label>
            <input
              className={inputClass}
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>定員</label>
            <input
              className={inputClass}
              inputMode="numeric"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </div>
        </div>

        <div className="py-3">
          <label className={labelClass}>対象レベル</label>
          <select
            className={`${inputClass} appearance-none`}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            <option value="">指定なし</option>
            {levels.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        <div className="py-3">
          <label className={labelClass}>担当できるスタッフ</label>
          <ChipMultiGroup
            options={staffs.map((s) => ({ code: s.id, label: s.name }))}
            values={staffIds}
            onChange={setStaffIds}
          />
        </div>

        <label className="flex min-h-11 items-center gap-2.5 text-[13px]">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={isPublished}
            onChange={(e) => setIsPublished(e.target.checked)}
          />
          ホームページの予約ページに出す
        </label>

        {error && <p className="mt-2 text-[13px] font-medium text-danger">{error}</p>}

        <div className="mt-4 flex gap-2.5">
          {course && (
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
