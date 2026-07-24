"use client";

// マイページの日別勤怠テーブル
// 遅刻・早退・未退勤のバッジ表示と、修正申請（または本人直接修正）・理由記入の入口を兼ねる。

import { useActionState, useEffect, useState } from "react";
import {
  createCorrectionAction,
  saveMyReasonAction,
  selfSaveAttendanceAction,
} from "./client-actions";
import type { MyActionState } from "./types";
import type { SelfEditMode } from "@/lib/auth/features";
import { Badge, buttonPrimaryClass, buttonSecondaryClass, inputClass } from "@/components/ui";

// ヘッダー共通クラス。text-align はデフォルトの左寄せに任せ、中央/右寄せにしたい
// 列だけ text-center / text-right を個別に足す（ここに text-left を入れると
// 後続の text-center 指定と衝突し、中央揃えが効かなくなる）。
const th =
  "sticky top-0 z-10 border-b border-border bg-gray-50 px-2 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted";
const td = "px-2 py-2 text-sm whitespace-nowrap";
const COLUMN_COUNT = 14;

export interface MyDailyRow {
  date: string;
  dayLabel: string; // "7/1(水)" など
  isWeekend: boolean;
  hasRecord: boolean;
  clockIn: string; // 編集フォームの初期値
  clockOut: string;
  breakMinutes: number;
  /** 外出・戻りの編集フォーム初期値（未入力は空文字）。ClockEvent由来の日は空文字のまま */
  outingStart: string;
  outingEnd: string;
  /** 実出勤（打刻・登録の生値） */
  clockInLabel: string;
  /** 実退勤（打刻・登録の生値） */
  clockOutLabel: string;
  /** 出勤（30分単位に丸め後） */
  roundedClockInLabel: string;
  /** 退勤（30分単位に丸め後） */
  roundedClockOutLabel: string;
  /** 外出（複数回ある日は最初の外出開始。"12:00(2回)"のように回数付き） */
  outingStartLabel: string;
  /** 戻り（複数回ある日は最後の戻り） */
  outingEndLabel: string;
  /** 実外出（実際に外出していた時間） */
  actualOutingLabel: string;
  /** 控除外出（休憩時間帯との重複を除いた、勤務時間から差し引かれる時間） */
  deductibleOutingLabel: string;
  /** 勤務時間（早出残業・残業を除いた実働。月次一覧の「勤務時間」列と揃えた値） */
  workLabel: string;
  earlyOvertimeMinutes: number;
  earlyOvertimeLabel: string;
  overtimeMinutes: number;
  overtimeLabel: string;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  lateReason: string | null;
  earlyLeaveReason: string | null;
  /** 打刻はあるが退勤が確定していない過去日（押し忘れ疑い） */
  isOpen: boolean;
  isToday: boolean;
  /** この日の承認待ち修正申請があるか */
  hasPendingRequest: boolean;
  error: string | null;
}

const initialState: MyActionState = { error: null, success: false };

/** 行の展開フォーム（時刻の修正申請/直接修正＋遅刻・早退理由の記入） */
function RowDetailForm({
  row,
  selfEditMode,
  onClose,
  onSaved,
}: {
  row: MyDailyRow;
  selfEditMode: SelfEditMode;
  onClose: () => void;
  /** 保存・申請成功後に呼ぶ（一覧の再取得トリガー用） */
  onSaved?: () => void;
}) {
  const editAction = selfEditMode === "direct" ? selfSaveAttendanceAction : createCorrectionAction;
  const [editState, editFormAction, editPending] = useActionState(editAction, initialState);
  const [reasonState, reasonFormAction, reasonPending] = useActionState(
    saveMyReasonAction,
    initialState,
  );

  useEffect(() => {
    if (editState.success || reasonState.success) {
      onSaved?.();
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editState.success, reasonState.success, onClose]);

  const showReasonForm = row.hasRecord && (row.lateMinutes > 0 || row.earlyLeaveMinutes > 0);
  // 本日分は、まだ来ていない時刻を選べないようブラウザの現在時刻を上限にする
  const maxTime = row.isToday
    ? (() => {
        const d = new Date();
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      })()
    : undefined;

  return (
    <td colSpan={COLUMN_COUNT} className="bg-violet-50/40 px-4 py-3">
      <div className="space-y-4">
        {selfEditMode !== "none" && (
          <form action={editFormAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="date" value={row.date} />
            <p className="w-full text-xs font-semibold text-muted">
              {selfEditMode === "direct"
                ? "時刻の修正（保存するとすぐ反映されます・修正履歴が残ります）"
                : "時刻の修正申請（管理者の承認後に反映されます）"}
            </p>
            <div>
              <label className="mb-1 block text-xs text-muted">出勤</label>
              <input
                type="time"
                name="clockIn"
                defaultValue={row.clockIn}
                max={maxTime}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">退勤</label>
              <input
                type="time"
                name="clockOut"
                defaultValue={row.clockOut}
                max={maxTime}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">外出</label>
              <input
                type="time"
                name="outingStart"
                defaultValue={row.outingStart}
                max={maxTime}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">戻り</label>
              <input
                type="time"
                name="outingEnd"
                defaultValue={row.outingEnd}
                max={maxTime}
                className={inputClass}
              />
            </div>
            <p className="w-full text-xs text-muted">
              休憩は設定画面の勤務ルール（休憩開始〜終了）から自動で勤務時間に反映されます。外出がこの休憩時間帯と重なる場合は「控除外出」で重複分を除いた時間を差し引きます。外出した場合のみ入力してください
            </p>
            <div className="min-w-48 flex-1">
              <label className="mb-1 block text-xs text-muted">
                理由{selfEditMode === "request" ? "（必須）" : ""}
              </label>
              <input
                type="text"
                name="reason"
                placeholder="例: 退勤の押し忘れのため"
                required={selfEditMode === "request"}
                maxLength={500}
                className={inputClass}
              />
            </div>
            <button type="submit" disabled={editPending} className={buttonPrimaryClass}>
              {editPending ? "送信中..." : selfEditMode === "direct" ? "保存" : "申請する"}
            </button>
            {editState.error && <p className="w-full text-sm text-red-600">{editState.error}</p>}
          </form>
        )}

        {showReasonForm && (
          <form action={reasonFormAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="date" value={row.date} />
            <p className="w-full text-xs font-semibold text-muted">遅刻・早退理由の記入</p>
            {row.lateMinutes > 0 && (
              <div className="min-w-48 flex-1">
                <label className="mb-1 block text-xs text-muted">
                  遅刻理由（{row.lateMinutes}分）
                </label>
                <input
                  type="text"
                  name="lateReason"
                  defaultValue={row.lateReason ?? ""}
                  maxLength={200}
                  className={inputClass}
                />
              </div>
            )}
            {row.earlyLeaveMinutes > 0 && (
              <div className="min-w-48 flex-1">
                <label className="mb-1 block text-xs text-muted">
                  早退理由（{row.earlyLeaveMinutes}分）
                </label>
                <input
                  type="text"
                  name="earlyLeaveReason"
                  defaultValue={row.earlyLeaveReason ?? ""}
                  maxLength={200}
                  className={inputClass}
                />
              </div>
            )}
            <button type="submit" disabled={reasonPending} className={buttonSecondaryClass}>
              {reasonPending ? "保存中..." : "理由を保存"}
            </button>
            {reasonState.error && (
              <p className="w-full text-sm text-red-600">{reasonState.error}</p>
            )}
          </form>
        )}

        <button type="button" onClick={onClose} className="text-xs text-muted hover:underline">
          閉じる
        </button>
      </div>
    </td>
  );
}

export function MyAttendanceTable({
  rows,
  selfEditMode,
  onSaved,
}: {
  rows: MyDailyRow[];
  selfEditMode: SelfEditMode;
  /** 保存・申請成功後に呼ぶ（一覧の再取得トリガー用） */
  onSaved?: () => void;
}) {
  const [openDate, setOpenDate] = useState<string | null>(null);

  return (
    <table className="w-full min-w-[960px] table-fixed text-sm">
      <colgroup>
        <col className="w-[8%]" />
        <col className="w-[7%]" />
        <col className="w-[7%]" />
        <col className="w-[7%]" />
        <col className="w-[7%]" />
        <col className="w-[6%]" />
        <col className="w-[6%]" />
        <col className="w-[7%]" />
        <col className="w-[8%]" />
        <col className="w-[8%]" />
        <col className="w-[8%]" />
        <col className="w-[7%]" />
        <col className="w-[9%]" />
        <col className="w-[5%]" />
      </colgroup>
      <thead>
        <tr>
          <th className={`${th} text-center`}>日付</th>
          <th className={`${th} text-right`}>実出勤</th>
          <th className={`${th} text-right`}>実退勤</th>
          <th className={`${th} text-right`}>出勤</th>
          <th className={`${th} text-right`}>退勤</th>
          <th className={`${th} text-right`}>外出</th>
          <th className={`${th} text-right`}>戻り</th>
          <th className={`${th} text-right`}>実外出</th>
          <th className={`${th} text-right`}>控除外出</th>
          <th className={`${th} text-right`}>勤務時間</th>
          <th className={`${th} text-right`}>早出残業</th>
          <th className={`${th} text-right`}>残業</th>
          <th className={`${th} text-center`}>備考</th>
          <th className={`${th} text-center`}>操作</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((row) => (
          <tr
            key={row.date}
            className={row.isWeekend ? "bg-gray-50/60" : "transition hover:bg-gray-50/60"}
          >
            {openDate === row.date ? (
              <RowDetailForm
                row={row}
                selfEditMode={selfEditMode}
                onClose={() => setOpenDate(null)}
                onSaved={onSaved}
              />
            ) : (
              <>
                <td className={`${td} text-center ${row.isWeekend ? "text-muted" : ""}`}>
                  {row.dayLabel}
                </td>
                <td className={`${td} text-right font-mono tabular-nums`}>{row.clockInLabel}</td>
                <td className={`${td} text-right font-mono tabular-nums`}>{row.clockOutLabel}</td>
                <td className={`${td} text-right font-mono tabular-nums text-muted`}>
                  {row.roundedClockInLabel}
                </td>
                <td className={`${td} text-right font-mono tabular-nums text-muted`}>
                  {row.roundedClockOutLabel}
                </td>
                <td className={`${td} text-right font-mono tabular-nums text-muted`}>
                  {row.outingStartLabel}
                </td>
                <td className={`${td} text-right font-mono tabular-nums text-muted`}>
                  {row.outingEndLabel}
                </td>
                <td className={`${td} text-right`}>{row.actualOutingLabel}</td>
                <td className={`${td} text-right`}>{row.deductibleOutingLabel}</td>
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
                    row.earlyOvertimeMinutes > 0 ? "font-medium text-amber-600" : "text-muted"
                  }`}
                >
                  {row.earlyOvertimeLabel}
                </td>
                <td
                  className={`${td} text-right ${
                    row.overtimeMinutes > 0 ? "font-medium text-amber-600" : "text-muted"
                  }`}
                >
                  {row.overtimeLabel}
                </td>
                <td className={`${td} max-w-56 whitespace-normal text-center text-xs text-muted`}>
                  <span className="flex flex-wrap items-center justify-center gap-1">
                    {row.isOpen && <Badge tone="red">未退勤</Badge>}
                    {row.isToday && !row.hasRecord && !row.isOpen && (
                      <span className="text-xs text-muted">本日</span>
                    )}
                    {row.lateMinutes > 0 && <Badge tone="amber">遅刻 {row.lateMinutes}分</Badge>}
                    {row.earlyLeaveMinutes > 0 && (
                      <Badge tone="amber">早退 {row.earlyLeaveMinutes}分</Badge>
                    )}
                    {row.hasPendingRequest && <Badge tone="purple">申請中</Badge>}
                    <span>{[row.lateReason, row.earlyLeaveReason].filter(Boolean).join(" / ")}</span>
                  </span>
                </td>
                <td className={`${td} text-center`}>
                  {(selfEditMode !== "none" ||
                    (row.hasRecord && (row.lateMinutes > 0 || row.earlyLeaveMinutes > 0))) && (
                    <button
                      type="button"
                      onClick={() => setOpenDate(row.date)}
                      className="text-xs text-primary hover:underline"
                    >
                      {selfEditMode === "direct" ? "修正・理由" : "申請・理由"}
                    </button>
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
