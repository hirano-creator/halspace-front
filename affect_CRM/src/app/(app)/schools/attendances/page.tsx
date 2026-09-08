"use client";

// スクール参加履歴と評価
//
// 予約を「参加済」にすると参加履歴が自動で作られる。ここではその履歴に
// 評価（パドル・テイクオフ・波選び・ライディング・総合）とコメントを書き足す。

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, apiFetchJson } from "@/lib/auth/api-fetch";
import { useAuth } from "@/lib/auth/client";
import { can } from "@/lib/auth/roles";
import { Empty, buttonPrimaryClass, buttonSecondaryClass, inputClass, labelClass } from "@/components/ui";
import type { AttendanceItem, AttendanceListResponse } from "./types";

const EVALS = [
  { key: "evalPaddle", label: "パドル" },
  { key: "evalTakeoff", label: "テイクオフ" },
  { key: "evalWaveSelection", label: "波選び" },
  { key: "evalRiding", label: "ライディング" },
  { key: "evalTotal", label: "総合評価" },
] as const;

export default function AttendancesPage() {
  const { user, status } = useAuth();
  const [data, setData] = useState<AttendanceListResponse | null>(null);
  const [editing, setEditing] = useState<AttendanceItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (status !== "authenticated") return;
    apiFetchJson<AttendanceListResponse>("/api/schools/attendances")
      .then(setData)
      .catch(() => {});
  }, [status]);

  useEffect(load, [load]);

  /** 参加回数が変わるので確認してから消す。予約から作られた履歴なら予約も「確定」に戻る */
  async function remove(a: AttendanceItem) {
    if (
      !confirm(
        `${a.customerName} 様の参加履歴（${a.attendedAt}）を削除します。よろしいですか？\n（顧客のスクール参加回数も計算し直されます）`,
      )
    ) {
      return;
    }
    const res = await apiFetch(`/api/schools/attendances/${a.id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(j?.error ?? "削除できませんでした");
      return;
    }
    load();
  }

  return (
    <div className="pb-10">
      <div className="px-5 pt-6 sm:px-8">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">スクール参加履歴</h1>
        <p className="mt-1.5 text-xs text-gray-soft sm:text-[13px]">
          予約カレンダーで予約を「参加済」にすると、ここに履歴が作られます
        </p>
      </div>

      {error && <p className="px-5 py-3 text-[13px] text-danger sm:px-8">{error}</p>}

      {!data ? (
        <Empty>読み込んでいます…</Empty>
      ) : data.attendances.length === 0 ? (
        <Empty>
          まだ参加履歴がありません。
          <br />
          <Link href="/calendar" className="text-accent hover:underline">
            予約カレンダー
          </Link>
          で予約を「参加済」にすると作られます。
        </Empty>
      ) : (
        <div className="mt-4 border-y border-line bg-card">
          {data.attendances.map((a) => (
            <div key={a.id} className="border-b border-line-2 px-5 py-4 last:border-b-0 sm:px-8">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="tabular text-[12.5px] text-gray-soft">{a.attendedAt}</span>
                  <Link
                    href={`/customers/${a.customerId}`}
                    className="ml-2.5 text-[15px] font-semibold hover:underline"
                  >
                    {a.customerName}
                  </Link>
                  <p className="mt-1 text-[12.5px] text-gray-soft">
                    {[a.courseName, a.staffName && `担当 ${a.staffName}`].filter(Boolean).join("／") || "—"}
                  </p>
                  {a.hasEvaluation && (
                    <p className="tabular mt-1.5 text-[12.5px]">
                      {EVALS.map((e) => {
                        const v = a[e.key];
                        return v ? `${e.label} ${v}` : null;
                      })
                        .filter(Boolean)
                        .join("／")}
                    </p>
                  )}
                  {a.comment && <p className="mt-1.5 text-[13px]">{a.comment}</p>}
                  {a.nextRecommendation && (
                    <p className="mt-1 text-[12.5px] text-accent">
                      次回おすすめ：{a.nextRecommendation}
                    </p>
                  )}
                </div>
                <div className="flex flex-none flex-col items-end gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing(a)}
                    className={`${buttonSecondaryClass} text-[13px]`}
                  >
                    {a.hasEvaluation ? "評価を編集" : "評価を入力"}
                  </button>
                  {user && can(user.role, "data.delete") && (
                    <button
                      type="button"
                      onClick={() => remove(a)}
                      className="py-1 text-[12px] text-danger hover:underline"
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

      {editing && (
        <EvaluationDialog
          attendance={editing}
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

function EvaluationDialog({
  attendance,
  onClose,
  onSaved,
}: {
  attendance: AttendanceItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [scores, setScores] = useState<Record<string, number | null>>({
    evalPaddle: attendance.evalPaddle,
    evalTakeoff: attendance.evalTakeoff,
    evalWaveSelection: attendance.evalWaveSelection,
    evalRiding: attendance.evalRiding,
    evalTotal: attendance.evalTotal,
  });
  const [comment, setComment] = useState(attendance.comment ?? "");
  const [next, setNext] = useState(attendance.nextRecommendation ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("attendanceId", attendance.id);
      for (const [k, v] of Object.entries(scores)) if (v) body.set(k, String(v));
      body.set("comment", comment);
      body.set("nextRecommendation", next);

      const res = await apiFetch("/api/schools/attendances", { method: "POST", body });
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
          <h2 className="text-base font-semibold">{attendance.customerName} 様の評価</h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-xl text-gray-soft">
            ×
          </button>
        </div>
        <p className="mt-1 text-[12.5px] text-gray-soft">
          {attendance.attendedAt}
          {attendance.courseName && `／${attendance.courseName}`}
        </p>

        {EVALS.map((e) => (
          <div key={e.key} className="py-3">
            <label className={labelClass}>{e.label}</label>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() =>
                    setScores((s) => ({ ...s, [e.key]: s[e.key] === n ? null : n }))
                  }
                  className={`min-h-11 flex-1 rounded-md border text-sm font-semibold ${
                    scores[e.key] === n
                      ? "border-navy bg-navy text-white"
                      : "border-line bg-card text-ink-2"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="py-3">
          <label className={labelClass}>コメント</label>
          <textarea
            className={`${inputClass} min-h-[74px] py-2.5`}
            placeholder="立ち上がりが安定してきた。次は波待ちの位置を意識できると良い。"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>

        <div className="py-3">
          <label className={labelClass}>次回のおすすめ</label>
          <input
            className={inputClass}
            placeholder="初級スクール／ボードのサイズ相談"
            value={next}
            onChange={(e) => setNext(e.target.value)}
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
