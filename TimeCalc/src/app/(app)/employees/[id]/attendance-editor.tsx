"use client";

// 社員詳細の日別勤怠テーブル
// 「日付・実出勤・実退勤・出勤時間・退勤時間・勤務時間・早出残業・残業時間・金額・残業代・支給額」を1行で見せる表。
// 編集権限がある場合は行の修正・追加・削除が可能。

import { Fragment, useActionState, useEffect, useRef, useState } from "react";
import { deleteAttendanceAction, saveAttendanceAction } from "./client-actions";
import type { AttendanceEditState } from "./types";
import { Badge, buttonPrimaryClass, buttonSecondaryClass, inputClass } from "@/components/ui";
import { WeekSubtotalRow, groupRowsByWeek } from "@/components/weekly-summary";
import type { WeeklyBucket } from "@/lib/attendance/types";

// 列数が多いため、共通のtdClass/thClassより余白を詰めた専用クラスを使う。
// text-align はデフォルトの左寄せに任せ、中央/右寄せにしたい列だけ
// text-center / text-right を個別に足す（ここに text-left を入れると
// 後続の text-center 指定と衝突して中央揃えが効かなくなる）。
// 下線は thead ではなく各thの内側shadowで引く。border-collapse下のsticky theadは
// スクロール時にborderが描かれず、線が消えてしまうため。
const th =
  "px-2 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted shadow-[inset_0_-1px_0_var(--border)]";
const td = "px-2 py-2 text-sm whitespace-nowrap";

// 列幅。table-fixed と組み合わせて、ヘッダーとデータ行の列位置を確実に一致させる
// （table-layout:auto のままだと列幅がブラウザ任せになり、ヘッダーと中身がずれる）。
// 金額3列（金額/残業代/支給額）の有無で列数が変わるため2パターン持つ。合計は各100%。
const COL_WIDTHS = [
  "w-[8%]", // 日付
  "w-[6%]", // 実出勤
  "w-[6%]", // 実退勤
  "w-[6%]", // 出勤
  "w-[6%]", // 退勤
  "w-[6%]", // 外出
  "w-[6%]", // 戻り
  "w-[6%]", // 実外出
  "w-[7%]", // 控除時間
  "w-[7%]", // 勤務時間
  "w-[8%]", // 法定外残業
  "w-[7%]", // 早出残業
  "w-[6%]", // 残業
  "w-[8%]", // 備考
  "w-[7%]", // 操作
];
const COL_WIDTHS_WITH_MONEY = [
  "w-[7%]", // 日付
  "w-[5%]", // 実出勤
  "w-[5%]", // 実退勤
  "w-[5%]", // 出勤
  "w-[5%]", // 退勤
  "w-[5%]", // 外出
  "w-[5%]", // 戻り
  "w-[5%]", // 実外出
  "w-[6%]", // 控除時間
  "w-[6%]", // 勤務時間
  "w-[7%]", // 法定外残業
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
  /** この日の打刻ログ（ClockEvent）が残っているか。Attendance が無くても削除ボタンを出す判定に使う */
  hasClockEvents: boolean;
  date: string; // "YYYY-MM-DD"
  dayLabel: string; // "1(水)" など
  isWeekend: boolean;
  clockIn: string; // 実出勤（編集フォームの初期値にも使用）。未出勤の日は空文字
  clockOut: string; // 実退勤（編集フォームの初期値にも使用）。未退勤の日は空文字
  breakMinutes: number;
  note: string | null;
  /**
   * 実出勤の表示。データなしは "-"。
   * 退勤前で Attendance が未確定の日は打刻ログ（ClockEvent）から補完するため、
   * 編集フォーム初期値の clockIn とは別に表示専用で持つ。
   */
  actualClockInLabel: string;
  /** 実退勤の表示。データなし・未退勤は "-" */
  actualClockOutLabel: string;
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
  /** 控除時間（実外出 ＋ 遅刻 ＋ 早退）の表示。データなしは "-" */
  deductionLabel: string;
  /** 勤務時間（早出残業・残業を除いた実働。マイページの「勤務時間」列と揃えた値） */
  workLabel: string;
  /**
   * 法定外残業（法定勤務時間を超えた分）の表示。符号つき 例 "+1:30"。
   * 超過のない日は "0:00"、出勤のない日・エラーの日は "-"
   */
  legalOvertimeLabel: string;
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
  /** 出勤打刻済みで退勤前（勤務中・外出中）。当日ならリアルタイムに「出勤中」を示す */
  isClockedIn: boolean;
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
  const clockInRef = useRef<HTMLInputElement>(null);
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
          <label className="mb-1 flex items-center justify-between gap-2 text-xs text-muted">
            <span>実出勤</span>
            <button
              type="button"
              onClick={() => {
                if (clockInRef.current) clockInRef.current.value = "";
              }}
              className="text-primary hover:underline"
            >
              未出勤にする
            </button>
          </label>
          <input
            ref={clockInRef}
            type="time"
            name="clockIn"
            defaultValue={row.clockIn}
            max={maxTime}
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
  date,
  hasClockEvents,
  onDeleted,
}: {
  userId: string;
  /** 削除対象の日付 "YYYY-MM-DD"（Attendanceが無く打刻ログだけの日も消せるよう日付で指定する） */
  date: string;
  /** 打刻ログも一緒に消えることを確認ダイアログで伝えるためのフラグ */
  hasClockEvents: boolean;
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
        const message = hasClockEvents
          ? "この日の勤怠を打刻ログごと削除しますか？"
          : "この日の勤怠を削除しますか？";
        if (!confirm(message)) e.preventDefault();
      }}
      className="inline"
    >
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="date" value={date} />
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
  weeks = [],
  onChanged,
}: {
  userId: string;
  rows: DailyRow[];
  editable: boolean;
  /** 金額列（金額・残業代・支給額）を表示するか */
  showMoney: boolean;
  /**
   * 週別集計。週単位管理の会社のみ渡される。
   * 渡されると日別行の間に週の小計行が挟まり、「早出残業」「残業」列が
   * 「所定超〜法定内」「法定超」に切り替わる（値は週行のみが持つ）。
   */
  weeks?: WeeklyBucket[];
  /** 保存・削除成功後に呼ぶ（一覧の再取得トリガー用） */
  onChanged?: () => void;
}) {
  const [editingDate, setEditingDate] = useState<string | null>(null);
  // マイページと同じ列構成に統一：
  // 日付/実出勤/実退勤/出勤/退勤/外出/戻り/実外出/控除時間/勤務時間/法定外残業/早出残業/残業/備考/(金額/残業代/支給額)/操作
  const columnCount = showMoney ? 18 : 15;
  const weekly = weeks.length > 0;
  const { groups, ungrouped } = groupRowsByWeek(rows, weeks);

  return (
    <table
      className={`w-full table-fixed text-sm ${showMoney ? "min-w-[1340px]" : "min-w-[1040px]"}`}
    >
      <colgroup>
        {(showMoney ? COL_WIDTHS_WITH_MONEY : COL_WIDTHS).map((w, i) => (
          <col key={i} className={w} />
        ))}
      </colgroup>
      {/* 表を下にたどっても列名を見失わないよう、スクロール領域の上端に固定する
          （半透明だと下の行が透けるので、固定する分ここは不透明にする） */}
      <thead className="sticky top-0 z-10 bg-gray-50">
        <tr>
          <th className={`${th} text-center`}>日付</th>
          <th className={`${th} text-right`}>実出勤</th>
          <th className={`${th} text-right`}>実退勤</th>
          <th className={`${th} text-right`}>出勤</th>
          <th className={`${th} text-right`}>退勤</th>
          <th className={`${th} text-right`}>外出</th>
          <th className={`${th} text-right`}>戻り</th>
          <th className={`${th} text-right`}>実外出</th>
          <th className={`${th} text-right`} title="実外出 ＋ 遅刻 ＋ 早退の合計">
            控除時間
          </th>
          <th className={`${th} text-right`}>勤務時間</th>
          <th
            className={`${th} text-right`}
            title="法定勤務時間（設定値・既定8時間）を超えた実働時間。8時間に満たない日は0。早出残業・残業も実働に含めて判定します"
          >
            法定外残業
          </th>
          <th className={`${th} text-right`}>{weekly ? "36H超44H以内" : "早出残業"}</th>
          <th className={`${th} text-right`}>{weekly ? "44H超" : "残業"}</th>
          <th className={`${th} text-center`}>備考</th>
          {showMoney && <th className={`${th} text-right`}>金額</th>}
          {showMoney && <th className={`${th} text-right`}>残業代</th>}
          {showMoney && <th className={`${th} text-right`}>支給額</th>}
          <th className={`${th} text-center`}>{editable ? "操作" : ""}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {weekly &&
          groups.map((group) => (
            <Fragment key={group.week.start}>
              <WeekSubtotalRow week={group.week} showMoney={showMoney} />
              {group.rows.map(renderRow)}
            </Fragment>
          ))}
        {(weekly ? ungrouped : rows).map(renderRow)}
      </tbody>
    </table>
  );

  function renderRow(row: DailyRow) {
    return (
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
                  {row.actualClockInLabel}
                </td>
                <td className={`${td} text-right font-mono tabular-nums`}>
                  {row.actualClockOutLabel}
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
                <td className={`${td} text-right`}>{row.deductionLabel}</td>
                <td className={`${td} text-right`}>
                  {row.error ? (
                    <span className="text-xs text-red-600" title={row.error}>
                      エラー
                    </span>
                  ) : (
                    row.workLabel
                  )}
                </td>
                {/* 法定外残業（法定勤務時間を超えた分。不足の日は0で止める） */}
                <td
                  className={`${td} text-right ${
                    row.legalOvertimeLabel.startsWith("+") ? "font-medium text-orange-600" : ""
                  }`}
                >
                  {row.legalOvertimeLabel}
                </td>
                {/* 週単位管理では残業の区分が週行にしかないため、日別行は空欄にする */}
                <td
                  className={`${td} text-right ${
                    !weekly && row.earlyOvertimeLabel !== "-" && row.earlyOvertimeLabel !== "0:00"
                      ? "font-medium text-amber-600"
                      : ""
                  }`}
                >
                  {weekly ? "" : row.earlyOvertimeLabel}
                </td>
                <td
                  className={`${td} text-right ${
                    !weekly && row.overtimeLabel !== "-" && row.overtimeLabel !== "0:00"
                      ? "font-medium text-amber-600"
                      : ""
                  }`}
                >
                  {weekly ? "" : row.overtimeLabel}
                </td>
                <td className={`${td} max-w-56 whitespace-normal text-center text-xs text-muted`}>
                  <span className="flex flex-wrap items-center justify-center gap-1">
                    {row.isOpen && <Badge tone="red">退勤未打刻</Badge>}
                    {row.isClockedIn && !row.isOpen && <Badge tone="green">出勤中</Badge>}
                    {row.isToday && !row.attendanceId && !row.isOpen && !row.isClockedIn && (
                      <span className="text-xs text-muted">本日</span>
                    )}
                    {row.lateMinutes > 0 && <Badge tone="amber">遅刻</Badge>}
                    {row.earlyLeaveMinutes > 0 && <Badge tone="amber">早退</Badge>}
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
                      {/* Attendanceが無くても打刻ログだけ残っている日は消せるようにする
                          （実出勤・実退勤が表示されているのに削除できない状態を作らない） */}
                      {(row.attendanceId || row.hasClockEvents) && (
                        <span className="ml-2">
                          <DeleteButton
                            userId={userId}
                            date={row.date}
                            hasClockEvents={row.hasClockEvents}
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
    );
  }
}
