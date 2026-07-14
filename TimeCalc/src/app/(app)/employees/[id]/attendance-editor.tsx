"use client";

// 社員詳細の日別勤怠テーブル
// 「日付・実出勤・実退勤・出勤時間・退勤時間・勤務時間・早出残業・残業時間・金額・残業代・支給額」を1行で見せる表。
// 編集権限がある場合は行の修正・追加・削除が可能。

import { useActionState, useEffect, useState } from "react";
import {
  deleteAttendanceAction,
  saveAttendanceAction,
  type AttendanceEditState,
} from "./actions";
import { buttonPrimaryClass, buttonSecondaryClass, inputClass } from "@/components/ui";

// 列数が多いため、共通のtdClass/thClassより余白を詰めた専用クラスを使う
const th = "px-2 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted";
const td = "px-2 py-2 text-sm whitespace-nowrap";

export interface DailyRow {
  attendanceId: string | null; // 打刻がない日は null
  date: string; // "YYYY-MM-DD"
  dayLabel: string; // "1(水)" など
  isWeekend: boolean;
  clockIn: string; // 実出勤（編集フォームの初期値にも使用）
  clockOut: string; // 実退勤（編集フォームの初期値にも使用）
  breakMinutes: number;
  note: string | null;
  /** 出勤時間（実出勤に丸めルールを適用した時刻）の表示。データなしは "-" */
  roundedClockInLabel: string;
  /** 退勤時間（実退勤に丸めルールを適用した時刻）の表示。データなしは "-" */
  roundedClockOutLabel: string;
  /** 勤務時間（出勤時間〜退勤時間、丸め後の合計）の表示 例 "7:33" */
  workLabel: string;
  /** 早出残業（18:00以降まで勤務した日の早出時間）の表示。対象外の日は "0:00" */
  earlyOvertimeLabel: string;
  /** 残業時間（18:00以降の丸め後時間）の表示 例 "1:30" */
  overtimeLabel: string;
  /** 金額（通常時給分）の表示 例 "¥9,060" */
  baseAmountLabel: string;
  /** 残業代（割増分）の表示 例 "¥1,500" */
  premiumAmountLabel: string;
  /** 支給額（金額＋残業代）の表示 例 "¥10,560" */
  totalPayLabel: string;
  error: string | null;
}

const initialState: AttendanceEditState = { error: null, success: false };

const COLUMN_COUNT = 12;

/** 1行分の編集フォーム（修正・追加の両方で使用） */
function RowEditForm({
  userId,
  row,
  onClose,
}: {
  userId: string;
  row: DailyRow;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveAttendanceAction, initialState);

  // 保存成功時に編集モードを閉じる
  useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  return (
    <td colSpan={COLUMN_COUNT} className="bg-violet-50/40 px-4 py-3">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="date" value={row.date} />
        <div>
          <label className="mb-1 block text-xs text-muted">実出勤</label>
          <input
            type="time"
            name="clockIn"
            defaultValue={row.clockIn}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">実退勤</label>
          <input
            type="time"
            name="clockOut"
            defaultValue={row.clockOut}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">休憩(分)</label>
          <input
            type="number"
            name="breakMinutes"
            defaultValue={row.breakMinutes}
            min={0}
            max={480}
            className={`${inputClass} w-24`}
          />
        </div>
        <div className="min-w-40 flex-1">
          <label className="mb-1 block text-xs text-muted">備考</label>
          <input type="text" name="note" defaultValue={row.note ?? ""} className={inputClass} />
        </div>
        <button type="submit" disabled={pending} className={buttonPrimaryClass}>
          {pending ? "保存中..." : "保存"}
        </button>
        <button type="button" onClick={onClose} className={buttonSecondaryClass}>
          キャンセル
        </button>
        {state.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
      </form>
    </td>
  );
}

/** 削除ボタン（確認ダイアログ付き） */
function DeleteButton({ attendanceId }: { attendanceId: string }) {
  const [state, formAction, pending] = useActionState(deleteAttendanceAction, initialState);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm("この日の勤怠を削除しますか？")) e.preventDefault();
      }}
      className="inline"
    >
      <input type="hidden" name="attendanceId" value={attendanceId} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-red-500 hover:underline disabled:opacity-50"
        title={state.error ?? undefined}
      >
        削除
      </button>
    </form>
  );
}

export function AttendanceEditor({
  userId,
  rows,
  editable,
}: {
  userId: string;
  rows: DailyRow[];
  editable: boolean;
}) {
  const [editingDate, setEditingDate] = useState<string | null>(null);

  return (
    <table className="w-full text-sm">
      <thead className="border-b border-border bg-gray-50/50">
        <tr>
          <th className={th}>日付</th>
          <th className={th}>実出勤</th>
          <th className={th}>実退勤</th>
          <th className={th}>出勤</th>
          <th className={th}>退勤</th>
          <th className={`${th} text-right`}>勤務</th>
          <th className={`${th} text-right`}>早出残業</th>
          <th className={`${th} text-right`}>残業</th>
          <th className={`${th} text-right`}>金額</th>
          <th className={`${th} text-right`}>残業代</th>
          <th className={`${th} text-right`}>支給額</th>
          <th className={`${th} text-right`}>{editable ? "操作" : ""}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((row) => (
          <tr
            key={row.date}
            className={row.isWeekend ? "bg-gray-50/60" : "transition hover:bg-gray-50/60"}
          >
            {editingDate === row.date ? (
              <RowEditForm userId={userId} row={row} onClose={() => setEditingDate(null)} />
            ) : (
              <>
                <td className={`${td} ${row.isWeekend ? "text-muted" : ""}`}>{row.dayLabel}</td>
                <td className={td}>{row.attendanceId ? row.clockIn : "-"}</td>
                <td className={td}>{row.attendanceId ? row.clockOut : "-"}</td>
                <td className={td}>{row.roundedClockInLabel}</td>
                <td className={td}>{row.roundedClockOutLabel}</td>
                <td className={`${td} text-right`}>
                  {row.error ? (
                    <span className="text-xs text-red-600" title={row.error}>
                      エラー
                    </span>
                  ) : (
                    row.workLabel
                  )}
                </td>
                <td
                  className={`${td} text-right ${
                    row.earlyOvertimeLabel !== "-" && row.earlyOvertimeLabel !== "0:00"
                      ? "font-medium text-amber-600"
                      : ""
                  }`}
                >
                  {row.earlyOvertimeLabel}
                </td>
                <td
                  className={`${td} text-right ${
                    row.overtimeLabel !== "-" && row.overtimeLabel !== "0:00"
                      ? "font-medium text-amber-600"
                      : ""
                  }`}
                >
                  {row.overtimeLabel}
                </td>
                <td className={`${td} text-right`}>{row.baseAmountLabel}</td>
                <td className={`${td} text-right`}>{row.premiumAmountLabel}</td>
                <td className={`${td} text-right font-semibold`}>{row.totalPayLabel}</td>
                <td className={`${td} text-right`}>
                  {editable && (
                    <span className="whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setEditingDate(row.date)}
                        className="text-xs text-primary hover:underline"
                      >
                        {row.attendanceId ? "修正" : "追加"}
                      </button>
                      {row.attendanceId && (
                        <span className="ml-2">
                          <DeleteButton attendanceId={row.attendanceId} />
                        </span>
                      )}
                    </span>
                  )}
                </td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
