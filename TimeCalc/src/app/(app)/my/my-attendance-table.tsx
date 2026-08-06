"use client";

// マイページの日別勤怠テーブル
// 遅刻・早退・未退勤のバッジ表示と、修正申請（または本人直接修正）・理由記入の入口を兼ねる。

import { Fragment, useActionState, useEffect, useId, useRef, useState } from "react";
import {
  createCorrectionAction,
  saveMyReasonAction,
  selfSaveAttendanceAction,
} from "./client-actions";
import type { MyActionState } from "./types";
import type { SelfEditMode } from "@/lib/auth/features";
import {
  Badge,
  buttonPrimaryClass,
  buttonSecondaryClass,
  controlHeightClass,
  inputClass,
} from "@/components/ui";
import { WeekSubtotalBar, WeekSubtotalRow, groupRowsByWeek } from "@/components/weekly-summary";
import type { WeeklyBucket } from "@/lib/attendance/types";

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
  clockIn: string; // 編集フォームの初期値（未出勤の日は空文字）
  clockOut: string; // 同上（未退勤の日は空文字）
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

/**
 * 表示に値があるか。API側は列の高さを揃えるため未入力を "-"、0分を "0:00" で返すが、
 * スマホのカードでは行そのものを省きたいので、この2つは「値なし」として扱う。
 */
function hasValue(label: string): boolean {
  return label !== "" && label !== "-" && label !== "0:00";
}

/**
 * 時刻入力の見た目。
 *
 * `appearance-none` が要点で、これを外すとiOS Safariはネイティブの時刻コントロールを
 * 描画する。その状態では padding も width も無視されるため、値が枠線に食い込んだり
 * 指定より広がって右にはみ出したりする（実機でのみ再現する）。
 * 文字サイズを16px以上にしているのは、iOSがフォーカス時に画面を自動ズームするのを
 * 防ぐため（PCは sm: で従来の14pxに戻す）。
 */
// PCで少し広げるのは、Chromeが右端に時計アイコンを描くぶんの余白を確保するため。
const timeInputClass = `time-input w-[6.5rem] ${controlHeightClass} appearance-none rounded-lg border border-border bg-white px-2 text-center font-mono text-base tabular-nums outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 sm:w-32 sm:text-sm`;

/** クリア操作（未出勤/未退勤にする）。主導線の「保存」から色を奪わないよう控えめにする */
const clearButtonClass =
  "justify-self-start py-0.5 text-xs text-muted underline underline-offset-2 hover:text-foreground";

interface TimeFieldSpec {
  label: string;
  name: string;
  defaultValue: string;
  /** 値を空にするボタンの文言。省略するとボタンを出さない */
  clearLabel?: string;
}

/**
 * 「開始 → 終了」の時刻ペア入力。
 * ラベル・入力欄・クリアボタンを3行×3列のグリッドに載せることで、横方向（ラベルと入力欄）も
 * 縦方向（左右の欄どうし）も揃う。矢印を挟むのは、一覧の「07:26 → 16:06」と同じ読み方に
 * するため（2つの独立した欄ではなく、1つの勤務時間帯として読ませる）。
 */
function TimeRangeFields({
  start,
  end,
  max,
}: {
  start: TimeFieldSpec;
  end: TimeFieldSpec;
  max?: string;
}) {
  const startId = useId();
  const endId = useId();
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const showClearRow = Boolean(start.clearLabel || end.clearLabel);

  return (
    <div className="grid w-fit grid-cols-[auto_auto_auto] items-center gap-x-2 gap-y-1">
      <label htmlFor={startId} className="text-xs font-medium text-muted">
        {start.label}
      </label>
      <span />
      <label htmlFor={endId} className="text-xs font-medium text-muted">
        {end.label}
      </label>

      <input
        id={startId}
        ref={startRef}
        type="time"
        name={start.name}
        defaultValue={start.defaultValue}
        max={max}
        className={timeInputClass}
      />
      <span aria-hidden className="text-sm text-muted">
        →
      </span>
      <input
        id={endId}
        ref={endRef}
        type="time"
        name={end.name}
        defaultValue={end.defaultValue}
        max={max}
        className={timeInputClass}
      />

      {showClearRow && (
        <>
          {start.clearLabel ? (
            <button
              type="button"
              onClick={() => {
                if (startRef.current) startRef.current.value = "";
              }}
              className={clearButtonClass}
            >
              {start.clearLabel}
            </button>
          ) : (
            <span />
          )}
          <span />
          {end.clearLabel ? (
            <button
              type="button"
              onClick={() => {
                if (endRef.current) endRef.current.value = "";
              }}
              className={clearButtonClass}
            >
              {end.clearLabel}
            </button>
          ) : (
            <span />
          )}
        </>
      )}
    </div>
  );
}

/**
 * 行の展開フォーム（時刻の修正申請/直接修正＋遅刻・早退理由の記入）。
 * PCはテーブルのセル内、スマホはカード内に置くため、入れ物は呼び出し側が用意する。
 */
function RowDetailFields({
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
  const reasonInputId = useId();
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
  // 既に外出の記録がある日は、畳んだままだと見落とすので開いた状態で出す
  const hasOuting = row.outingStart !== "" || row.outingEnd !== "";
  // 本日分は、まだ来ていない時刻を選べないようブラウザの現在時刻を上限にする
  const maxTime = row.isToday
    ? (() => {
        const d = new Date();
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      })()
    : undefined;

  return (
    <div className="space-y-4">
      {selfEditMode !== "none" && (
        <form action={editFormAction} className="space-y-3">
          <input type="hidden" name="date" value={row.date} />
          {/* 見出しと補足を分ける（1行に詰めるとスマホで折り返して読みにくい） */}
          <div>
            <p className="text-sm font-semibold">
              {selfEditMode === "direct" ? "時刻の修正" : "時刻の修正申請"}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {selfEditMode === "direct"
                ? "保存するとすぐ反映されます（修正履歴が残ります）"
                : "管理者の承認後に反映されます"}
            </p>
          </div>

          {/* 出勤・退勤は毎回使うので常に表示 */}
          <TimeRangeFields
            start={{
              label: "出勤",
              name: "clockIn",
              defaultValue: row.clockIn,
              clearLabel: "未出勤にする",
            }}
            end={{
              label: "退勤",
              name: "clockOut",
              defaultValue: row.clockOut,
              clearLabel: "未退勤にする",
            }}
            max={maxTime}
          />

          {/* 外出・戻りは外出した日だけの入力なので、値がない日は畳んでおく */}
          <details
            open={hasOuting}
            className="rounded-lg border border-border bg-white/70 px-3 sm:max-w-md"
          >
            {/* 縦の余白は summary 側で持つ。閉じているときの帯の高さが、
                入力欄・ボタン（controlHeightClass）と揃うようにするため */}
            <summary className="cursor-pointer py-3 text-sm font-medium text-muted sm:py-2.5">
              外出・戻り（外出した日のみ）
            </summary>
            <div className="mt-1">
              <TimeRangeFields
                start={{ label: "外出", name: "outingStart", defaultValue: row.outingStart }}
                end={{ label: "戻り", name: "outingEnd", defaultValue: row.outingEnd }}
                max={maxTime}
              />
            </div>
            <p className="mt-2 pb-3 text-xs leading-relaxed text-muted">
              休憩は設定画面の勤務ルール（休憩開始〜終了）から自動で勤務時間に反映されます。外出がこの休憩時間帯と重なる場合は「控除外出」で重複分を除いた時間を差し引きます。
            </p>
          </details>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <label htmlFor={reasonInputId} className="mb-1 block text-xs text-muted">
                理由{selfEditMode === "request" ? "（必須）" : ""}
              </label>
              <input
                id={reasonInputId}
                type="text"
                name="reason"
                placeholder="例: 退勤の押し忘れのため"
                required={selfEditMode === "request"}
                maxLength={500}
                className={inputClass}
              />
            </div>
            <button
              type="submit"
              disabled={editPending}
              className={`${buttonPrimaryClass} w-full sm:w-auto`}
            >
              {editPending ? "送信中..." : selfEditMode === "direct" ? "保存" : "申請する"}
            </button>
          </div>
          {editState.error && <p className="text-sm text-red-600">{editState.error}</p>}
        </form>
      )}

      {showReasonForm && (
        <form action={reasonFormAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="date" value={row.date} />
          <p className="w-full text-xs font-semibold text-muted">遅刻・早退理由の記入</p>
          {row.lateMinutes > 0 && (
            <div className="min-w-48 flex-1">
              <label className="mb-1 block text-xs text-muted">遅刻理由</label>
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
              <label className="mb-1 block text-xs text-muted">早退理由</label>
              <input
                type="text"
                name="earlyLeaveReason"
                defaultValue={row.earlyLeaveReason ?? ""}
                maxLength={200}
                className={inputClass}
              />
            </div>
          )}
          <button
            type="submit"
            disabled={reasonPending}
            className={`${buttonSecondaryClass} w-full sm:w-auto`}
          >
            {reasonPending ? "保存中..." : "理由を保存"}
          </button>
          {reasonState.error && (
            <p className="w-full text-sm text-red-600">{reasonState.error}</p>
          )}
        </form>
      )}

      {/* 保存の下に置くので、色でも大きさでも主導線と競わない見せ方にする */}
      <button
        type="button"
        onClick={onClose}
        className="flex min-h-11 w-full items-center justify-center text-xs text-muted hover:underline sm:min-h-0 sm:w-auto sm:justify-start sm:px-1"
      >
        閉じる
      </button>
    </div>
  );
}

export function MyAttendanceTable({
  rows,
  selfEditMode,
  weeks = [],
  onSaved,
}: {
  rows: MyDailyRow[];
  selfEditMode: SelfEditMode;
  /**
   * 週別集計。週単位管理の会社に所属している場合のみ渡される。
   * 社員詳細と同じく、日別行の間に週の小計行が挟まる。
   */
  weeks?: WeeklyBucket[];
  /** 保存・申請成功後に呼ぶ（一覧の再取得トリガー用） */
  onSaved?: () => void;
}) {
  const [openDate, setOpenDate] = useState<string | null>(null);
  const weekly = weeks.length > 0;
  const { groups, ungrouped } = groupRowsByWeek(rows, weeks);

  return (
    <>
      {/* スマホ（md未満）: 14列の表は画面に収まらないため、日ごとのカードに積み替える */}
      <ul className="divide-y divide-border md:hidden">
        {weekly &&
          groups.map((group) => (
            <Fragment key={group.week.start}>
              <li>
                <WeekSubtotalBar week={group.week} />
              </li>
              {group.rows.map(renderCard)}
            </Fragment>
          ))}
        {(weekly ? ungrouped : rows).map(renderCard)}
      </ul>

      <table className="hidden w-full min-w-[960px] table-fixed text-sm md:table">
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
          <th className={`${th} text-right`}>{weekly ? "36H超44H以内" : "早出残業"}</th>
          <th className={`${th} text-right`}>{weekly ? "44H超" : "残業"}</th>
          <th className={`${th} text-center`}>備考</th>
          <th className={`${th} text-center`}>操作</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {weekly &&
          groups.map((group) => (
            <Fragment key={group.week.start}>
              <WeekSubtotalRow week={group.week} showMoney={false} />
              {group.rows.map(renderRow)}
            </Fragment>
          ))}
        {(weekly ? ungrouped : rows).map(renderRow)}
      </tbody>
      </table>
    </>
  );

  /** スマホ用の1日カード。表の14列から、その日の判断に要る項目だけを残す */
  function renderCard(row: MyDailyRow) {
    if (openDate === row.date) {
      return (
        <li key={row.date} className="bg-violet-50/40 px-4 py-3">
          <p className="mb-3 text-sm font-semibold">{row.dayLabel}</p>
          <RowDetailFields
            row={row}
            selfEditMode={selfEditMode}
            onClose={() => setOpenDate(null)}
            onSaved={onSaved}
          />
        </li>
      );
    }

    const badges = (
      <>
        {row.isOpen && <Badge tone="red">退勤未打刻</Badge>}
        {row.lateMinutes > 0 && <Badge tone="amber">遅刻</Badge>}
        {row.earlyLeaveMinutes > 0 && <Badge tone="amber">早退</Badge>}
        {row.hasPendingRequest && <Badge tone="purple">申請中</Badge>}
        {row.isToday && !row.hasRecord && !row.isOpen && (
          <span className="text-xs text-muted">本日</span>
        )}
      </>
    );
    const reason = [row.lateReason, row.earlyLeaveReason].filter(Boolean).join(" / ");
    const punched = hasValue(row.clockInLabel) || hasValue(row.clockOutLabel);
    const canOpen =
      selfEditMode !== "none" ||
      (row.hasRecord && (row.lateMinutes > 0 || row.earlyLeaveMinutes > 0));

    return (
      <li key={row.date} className={`px-4 py-3 ${row.isWeekend ? "bg-gray-50/60" : ""}`}>
        <div className="flex items-baseline justify-between gap-2">
          <span className={`text-sm font-semibold ${row.isWeekend ? "text-muted" : ""}`}>
            {row.dayLabel}
          </span>
          <span className="flex flex-wrap items-center justify-end gap-1">{badges}</span>
        </div>

        {punched ? (
          <>
            <div className="mt-1.5 flex items-baseline gap-2 font-mono text-base tabular-nums">
              <span>{row.clockInLabel}</span>
              <span className="text-xs text-muted">→</span>
              <span>{row.clockOutLabel}</span>
              {row.error ? (
                <span className="font-sans text-xs text-red-600">{row.error}</span>
              ) : (
                <span className="ml-auto font-sans text-sm">
                  勤務 <span className="font-mono tabular-nums">{row.workLabel}</span>
                </span>
              )}
            </div>

            {/* 丸め後の時刻・外出・残業は、値がある日だけ補足として出す */}
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
              {(hasValue(row.roundedClockInLabel) || hasValue(row.roundedClockOutLabel)) && (
                <span>
                  丸め後 {row.roundedClockInLabel}〜{row.roundedClockOutLabel}
                </span>
              )}
              {hasValue(row.actualOutingLabel) && <span>実外出 {row.actualOutingLabel}</span>}
              {hasValue(row.deductibleOutingLabel) && (
                <span>控除外出 {row.deductibleOutingLabel}</span>
              )}
              {!weekly && row.earlyOvertimeMinutes > 0 && (
                <span className="text-amber-600">早出残業 {row.earlyOvertimeLabel}</span>
              )}
              {!weekly && row.overtimeMinutes > 0 && (
                <span className="text-amber-600">残業 {row.overtimeLabel}</span>
              )}
              {reason && <span>{reason}</span>}
            </div>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">打刻なし</p>
        )}

        {canOpen && (
          <button
            type="button"
            onClick={() => setOpenDate(row.date)}
            className="mt-2 text-xs text-primary hover:underline"
          >
            {selfEditMode === "direct" ? "修正・理由を記入" : "申請・理由を記入"}
          </button>
        )}
      </li>
    );
  }

  function renderRow(row: MyDailyRow) {
    return (
          <tr
            key={row.date}
            className={row.isWeekend ? "bg-gray-50/60" : "transition hover:bg-gray-50/60"}
          >
            {openDate === row.date ? (
              <td colSpan={COLUMN_COUNT} className="bg-violet-50/40 px-4 py-3">
                <RowDetailFields
                  row={row}
                  selfEditMode={selfEditMode}
                  onClose={() => setOpenDate(null)}
                  onSaved={onSaved}
                />
              </td>
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
                {/* 週単位管理では残業の区分が週行にしかないため、日別行は空欄にする */}
                <td
                  className={`${td} text-right ${
                    !weekly && row.earlyOvertimeMinutes > 0
                      ? "font-medium text-amber-600"
                      : "text-muted"
                  }`}
                >
                  {weekly ? "" : row.earlyOvertimeLabel}
                </td>
                <td
                  className={`${td} text-right ${
                    !weekly && row.overtimeMinutes > 0 ? "font-medium text-amber-600" : "text-muted"
                  }`}
                >
                  {weekly ? "" : row.overtimeLabel}
                </td>
                <td className={`${td} max-w-56 whitespace-normal text-center text-xs text-muted`}>
                  <span className="flex flex-wrap items-center justify-center gap-1">
                    {row.isOpen && <Badge tone="red">退勤未打刻</Badge>}
                    {row.isToday && !row.hasRecord && !row.isOpen && (
                      <span className="text-xs text-muted">本日</span>
                    )}
                    {row.lateMinutes > 0 && <Badge tone="amber">遅刻</Badge>}
                    {row.earlyLeaveMinutes > 0 && <Badge tone="amber">早退</Badge>}
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
    );
  }
}
