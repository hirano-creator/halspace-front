"use client";

// 社員詳細の日別勤怠テーブル
// 「日付・実出勤・実退勤・出勤時間・退勤時間・勤務時間・早出残業・残業時間・金額・残業代・支給額」を1行で見せる表。
// 編集権限がある場合は行の修正・追加・削除が可能。

import { useActionState, useEffect, useRef, useState } from "react";
import { deleteAttendanceAction, saveAttendanceAction } from "./client-actions";
import type { AttendanceEditState } from "./types";
import { Badge, buttonPrimaryClass, buttonSecondaryClass, inputClass } from "@/components/ui";

// 列数が多いため、共通のtdClass/thClassより余白を詰めた専用クラスを使う。
// text-align はデフォルトの左寄せに任せ、中央/右寄せにしたい列だけ
// text-center / text-right を個別に足す（ここに text-left を入れると
// 後続の text-center 指定と衝突して中央揃えが効かなくなる）。
const th = "px-2 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted";
const td = "px-2 py-2 text-sm whitespace-nowrap";

// 列幅。table-fixed と組み合わせて、ヘッダーとデータ行の列位置を確実に一致させる
// （table-layout:auto のままだと列幅がブラウザ任せになり、ヘッダーと中身がずれる）。
// 金額3列（金額/残業代/支給額）の有無で列数が変わるため2パターン持つ。合計は各100%。
const COL_WIDTHS = [
  "w-[8%]", // 日付
  "w-[7%]", // 実出勤
  "w-[7%]", // 実退勤
  "w-[7%]", // 出勤
  "w-[7%]", // 退勤
  "w-[6%]", // 外出
  "w-[6%]", // 戻り
  "w-[7%]", // 実外出
  "w-[8%]", // 控除外出
  "w-[8%]", // 勤務時間
  "w-[7%]", // 早出残業
  "w-[6%]", // 残業
  "w-[9%]", // 備考
  "w-[7%]", // 操作
];
const COL_WIDTHS_WITH_MONEY = [
  "w-[7%]", // 日付
  "w-[6%]", // 実出勤
  "w-[6%]", // 実退勤
  "w-[6%]", // 出勤
  "w-[6%]", // 退勤
  "w-[5%]", // 外出
  "w-[5%]", // 戻り
  "w-[6%]", // 実外出
  "w-[7%]", // 控除外出
  "w-[7%]", // 勤務時間
  "w-[6%]", // 早出残業
  "w-[5%]", // 残業
  "w-[6%]", // 備考
  "w-[6%]", // 金額
  "w-[5%]", // 残業代
  "w-[5%]", // 支給額
  "w-[6%]", // 操作
];

export interface DailyRow {
  attendanceId: string | null; // 打刻がない日は null
  date: string; // "YYYY-MM-DD"
  dayLabel: string; // "1(水)" など
  isWeekend: boolean;
  clockIn: string; // 実出勤（編集フォームの初期値にも使用）
  clockOut: string; // 実退勤（編集フォームの初期値にも使用）。未退勤の日は空文字
  breakMinutes: number;
  note: string | null;
  /** 出勤時間（実出勤に丸めルールを適用した時刻）の表示。データなしは "-" */
  roundedClockInLabel: string;
  /** 退勤時間（実退勤に丸めルールを適用した時刻）の表示。データなしは "-" */
  roundedClockOutLabel: string;
  /** 外出（複数回ある日は最初の外出開始。"12:00(2回)"のように回数付き）。データなしは "-" */
  outingStartLabel: string;
  /** 戻り（複数回ある日は最後の戻り）。データなしは "-" */
  outingEndLabel: string;
  /** 実外出（実際に外出していた時間）の表示。データなしは "-" */
  actualOutingLabel: string;
  /** 控除外出（休憩時間帯との重複を除き、勤務時間から差し引かれる時間）の表示。データなしは "-" */
  deductibleOutingLabel: string;
  /** 勤務時間（早出残業・残業を除いた実働。マイページの「勤務時間」列と揃えた値） */
  workLabel: string;
  /** 早出残業（18:00以降まで勤務した日の早出時間）の表示。対象外の日は "0:00" */
  earlyOvertimeLabel: string;
  /** 残業時間（18:00以降の丸め後時間）の表示 例 "1:30" */
  overtimeLabel: string;
  /** 遅刻時間（分）。0なら遅刻なし */
  lateMinutes: number;
  /** 早退時間（分）。0なら早退なし */
  earlyLeaveMinutes: number;
  lateReason: string | null;
  earlyLeaveReason: string | null;
  /** 打刻はあるが退勤が確定していない過去日（押し忘れ疑い） */
  isOpen: boolean;
  isToday: boolean;
  /** この日の承認待ち修正申請があるか */
  hasPendingRequest: boolean;
  /** 金額（通常時給分）の表示 例 "¥9,060" */
  baseAmountLabel: string;
  /** 残業代（割増分）の表示 例 "¥1,500" */
  premiumAmountLabel: string;
  /** 支給額（金額＋残業代）の表示 例 "¥10,560" */
  totalPayLabel: string;
  error: string | null;
}

const initialState: AttendanceEditState = { error: null, success: false };

/** 1行分の編集フォーム（修正・追加の両方で使用） */
function RowEditForm({
  userId,
  row,
  columnCount,
  onClose,
  onSaved,
}: {
  userId: string;
  row: DailyRow;
  columnCount: number;
  onClose: () => void;
  /** 保存成功後に呼ぶ（一覧の再取得トリガー用） */
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveAttendanceAction, initialState);
  const clockOutRef = useRef<HTMLInputElement>(null);

  // 保存成功時に編集モードを閉じる
  useEffect(() => {
    if (state.success) {
      onSaved?.();
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success, onClose]);

  // 本日分は、まだ来ていない時刻を選べないようブラウザの現在時刻を上限にする
  const now = new Date();
  const isToday =
    row.date ===
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const maxTime = isToday
    ? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    : undefined;

  return (
    <td colSpan={columnCount} className="bg-violet-50/40 px-4 py-3">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="date" value={row.date} />
        <div>
          <label className="mb-1 block text-xs text-muted">実出勤</label>
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
          <label className="mb-1 flex items-center justify-between gap-2 text-xs text-muted">
            <span>実退勤</span>
            <button
              type="button"
              onClick={() => {
                if (clockOutRef.current) clockOutRef.current.value = "";
              }}
              className="text-primary hover:underline"
            >
              未退勤にする
            </button>
          </label>
          <input
            ref={clockOutRef}
            type="time"
            name="clockOut"
            defaultValue={row.clockOut}
            max={maxTime}
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
function DeleteButton({
  userId,
  attendanceId,
  onDeleted,
}: {
  userId: string;
  attendanceId: string;
  /** 削除成功後に呼ぶ（一覧の再取得トリガー用） */
  onDeleted?: () => void;
}) {
  const [state, formAction, pending] = useActionState(deleteAttendanceAction, initialState);

  useEffect(() => {
    if (state.success) onDeleted?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm("この日の勤怠を削除しますか？")) e.preventDefault();
      }}
      className="inline"
    >
      <input type="hidden" name="userId" value={userId} />
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
  showMoney,
  onChanged,
}: {
  userId: string;
  rows: DailyRow[];
  editable: boolean;
  /** 金額列（金額・残業代・支給額）を表示するか */
  showMoney: boolean;
  /** 保存・削除成功後に呼ぶ（一覧の再取得トリガー用） */
  onChanged?: () => void;
}) {
  const [editingDate, setEditingDate] = useState<string | null>(null);
  // マイページと同じ列構成に統一：
  // 日付/実出勤/実退勤/出勤/退勤/外出/戻り/実外出/控除外出/勤務時間/早出残業/残業/備考/(金額/残業代/支給額)/操作
  const columnCount = showMoney ? 17 : 14;

  return (
    <table
      className={`w-full table-fixed text-sm ${showMoney ? "min-w-[1240px]" : "min-w-[960px]"}`}
    >
      <colgroup>
        {(showMoney ? COL_WIDTHS_WITH_MONEY : COL_WIDTHS).map((w, i) => (
          <col key={i} className={w} />
        ))}
      </colgroup>
      <thead className="border-b border-border bg-gray-50/50">
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
          {showMoney && <th className={`${th} text-right`}>金額</th>}
          {showMoney && <th className={`${th} text-right`}>残業代</th>}
          {showMoney && <th className={`${th} text-right`}>支給額</th>}
          <th className={`${th} text-center`}>{editable ? "操作" : ""}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((row) => (
          <tr
            key={row.date}
            className={row.isWeekend ? "bg-gray-50/60" : "transition hover:bg-gray-50/60"}
          >
            {editingDate === row.date ? (
              <RowEditForm
                userId={userId}
                row={row}
                columnCount={columnCount}
                onClose={() => setEditingDate(null)}
                onSaved={onChanged}
              />
            ) : (
              <>
                <td className={`${td} text-center ${row.isWeekend ? "text-muted" : ""}`}>
                  {row.dayLabel}
                </td>
                <td className={`${td} text-right font-mono tabular-nums`}>
                  {row.attendanceId ? row.clockIn : "-"}
                </td>
                <td className={`${td} text-right font-mono tabular-nums`}>
                  {row.attendanceId && row.clockOut ? row.clockOut : "-"}
                </td>
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
                <td className={`${td} max-w-56 whitespace-normal text-center text-xs text-muted`}>
                  <span className="flex flex-wrap items-center justify-center gap-1">
                    {row.isOpen && <Badge tone="red">未退勤</Badge>}
                    {row.isToday && !row.attendanceId && !row.isOpen && (
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
                {showMoney && <td className={`${td} text-right`}>{row.baseAmountLabel}</td>}
                {showMoney && <td className={`${td} text-right`}>{row.premiumAmountLabel}</td>}
                {showMoney && (
                  <td className={`${td} text-right font-semibold`}>{row.totalPayLabel}</td>
                )}
                <td className={`${td} text-center`}>
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
                          <DeleteButton
                            userId={userId}
                            attendanceId={row.attendanceId}
                            onDeleted={onChanged}
                          />
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
