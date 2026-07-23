"use client";

// 自分の修正申請一覧（承認待ちは取り下げ可能）

import { useActionState, useEffect } from "react";
import { cancelCorrectionAction } from "./client-actions";
import type { MyActionState } from "./types";
import { Badge } from "@/components/ui";

export interface MyRequestRow {
  id: string;
  date: string;
  clockIn: string;
  clockOut: string;
  breakMinutes: number;
  reason: string;
  status: string; // "PENDING" | "APPROVED" | "REJECTED"
  reviewNote: string | null;
}

const initialState: MyActionState = { error: null, success: false };

const STATUS_BADGE: Record<string, { label: string; tone: "amber" | "green" | "red" }> = {
  PENDING: { label: "承認待ち", tone: "amber" },
  APPROVED: { label: "承認済み", tone: "green" },
  REJECTED: { label: "却下", tone: "red" },
};

function CancelButton({ id, onCancelled }: { id: string; onCancelled?: () => void }) {
  const [state, formAction, pending] = useActionState(cancelCorrectionAction, initialState);

  useEffect(() => {
    if (state.success) onCancelled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm("この申請を取り下げますか？")) e.preventDefault();
      }}
      className="inline"
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-red-500 hover:underline disabled:opacity-50"
        title={state.error ?? undefined}
      >
        取り下げ
      </button>
    </form>
  );
}

export function MyRequests({
  requests,
  onCancelled,
}: {
  requests: MyRequestRow[];
  onCancelled?: () => void;
}) {
  if (requests.length === 0) {
    return <p className="text-sm text-muted">修正申請はありません</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {requests.map((r) => {
        const badge = STATUS_BADGE[r.status] ?? { label: r.status, tone: "amber" as const };
        return (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
            <span className="font-medium">{r.date}</span>
            <span className="font-mono text-xs tabular-nums text-muted">
              {r.clockIn}〜{r.clockOut}・休憩{r.breakMinutes}分
            </span>
            <Badge tone={badge.tone}>{badge.label}</Badge>
            <span className="min-w-0 flex-1 truncate text-xs text-muted">{r.reason}</span>
            {r.status === "REJECTED" && r.reviewNote && (
              <span className="text-xs text-red-600">却下理由: {r.reviewNote}</span>
            )}
            {r.status === "PENDING" && <CancelButton id={r.id} onCancelled={onCancelled} />}
          </li>
        );
      })}
    </ul>
  );
}
