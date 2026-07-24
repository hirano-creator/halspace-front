"use client";

// 修正申請の承認・却下リスト

import { useActionState, useEffect, useState } from "react";
import { approveCorrectionAction, rejectCorrectionAction } from "./client-actions";
import type { ReviewState } from "./types";
import { Badge, buttonPrimaryClass, buttonSecondaryClass, inputClass } from "@/components/ui";

export interface ReviewRow {
  id: string;
  userName: string;
  employeeCode: string;
  departmentName: string | null;
  date: string;
  /** 未出勤として申請した場合は null */
  clockIn: string | null;
  /** 未退勤のまま出勤のみ修正申請した場合は null */
  clockOut: string | null;
  breakMinutes: number;
  reason: string;
  createdAt: string; // 表示用
  /** 現在の勤怠（比較表示用。なければ null = 未退勤・打刻なし日の申請） */
  current: { clockIn: string | null; clockOut: string | null; breakMinutes: number } | null;
}

const initialState: ReviewState = { error: null, success: false };

function ReviewCard({ row, onResolved }: { row: ReviewRow; onResolved?: () => void }) {
  const [approveState, approveAction, approvePending] = useActionState(
    approveCorrectionAction,
    initialState,
  );
  const [rejectState, rejectAction, rejectPending] = useActionState(
    rejectCorrectionAction,
    initialState,
  );
  const [rejecting, setRejecting] = useState(false);

  const busy = approvePending || rejectPending;
  const error = approveState.error ?? rejectState.error;

  useEffect(() => {
    if (approveState.success || rejectState.success) onResolved?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveState.success, rejectState.success]);

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{row.userName}</span>
        <span className="text-xs text-muted">
          {row.employeeCode}
          {row.departmentName ? ` ・ ${row.departmentName}` : ""}
        </span>
        <Badge tone="amber">承認待ち</Badge>
        <span className="text-xs text-muted">申請日時 {row.createdAt}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span className="font-medium">{row.date}</span>
        <span>
          <span className="text-xs text-muted">現在: </span>
          <span className="font-mono tabular-nums">
            {row.current
              ? `${row.current.clockIn ?? "未出勤"}〜${row.current.clockOut ?? "未退勤"}・休憩${row.current.breakMinutes}分`
              : "記録なし（未退勤・打刻漏れ）"}
          </span>
        </span>
        <span>
          <span className="text-xs text-muted">申請: </span>
          <span className="font-mono font-semibold tabular-nums text-primary">
            {row.clockIn ?? "未出勤"}〜{row.clockOut ?? "未退勤"}・休憩{row.breakMinutes}分
          </span>
        </span>
      </div>

      <p className="mt-1 text-sm text-muted">理由: {row.reason}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!rejecting ? (
          <>
            <form action={approveAction}>
              <input type="hidden" name="id" value={row.id} />
              <button type="submit" disabled={busy} className={buttonPrimaryClass}>
                {approvePending ? "処理中..." : "承認して反映"}
              </button>
            </form>
            <button
              type="button"
              onClick={() => setRejecting(true)}
              disabled={busy}
              className={buttonSecondaryClass}
            >
              却下...
            </button>
          </>
        ) : (
          <form action={rejectAction} className="flex w-full flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={row.id} />
            <input
              type="text"
              name="reviewNote"
              placeholder="却下理由（本人に表示されます）"
              required
              maxLength={500}
              className={`${inputClass} max-w-md flex-1`}
            />
            <button type="submit" disabled={busy} className={buttonPrimaryClass}>
              {rejectPending ? "処理中..." : "却下する"}
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className={buttonSecondaryClass}
            >
              キャンセル
            </button>
          </form>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </li>
  );
}

export function ReviewList({ rows, onResolved }: { rows: ReviewRow[]; onResolved?: () => void }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted">承認待ちの申請はありません</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <ReviewCard key={r.id} row={r} onResolved={onResolved} />
      ))}
    </ul>
  );
}
