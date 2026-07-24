// 打刻イベント（複数回の出退勤・外出）から1日分の勤怠データを導出する
//
// 既存の calcDaily は1日分の { clockIn, clockOut, breakMinutes } を前提とした
// 純粋関数のため、打刻機能でも中抜け・外出をここで合算してから
// 既存の入力形式に変換する。calcDaily 自体は改修しない。

import { timeToMinutes } from "@/lib/utils/time";

/**
 * その日に控除する固定休憩時間（分）を算出する。
 *
 * 会社の休憩時間帯（breakStart〜breakEnd）と、その日の勤務時間帯（clockIn〜clockOut）が
 * 重なった分だけを控除する。休憩時間帯にかからない勤務（例: 休憩12:00〜13:00に対して
 * 7:30〜11:00の半日勤務）は休憩を取っていないため控除しない。一部だけ重なる場合
 * （例: 9:00〜12:30）は重なった分（30分）のみ控除する。
 * 退勤が未確定（clockOut が null）の日は0を返す（その日は勤務時間を計算しないため）。
 */
export function fixedBreakMinutesFor(
  rules: { breakStart: string; breakEnd: string },
  clockIn: string,
  clockOut: string | null,
): number {
  const breakStart = timeToMinutes(rules.breakStart);
  const breakEnd = timeToMinutes(rules.breakEnd);
  const workStart = timeToMinutes(clockIn);
  const workEnd = timeToMinutes(clockOut);
  if (breakStart === null || breakEnd === null || workStart === null || workEnd === null) return 0;
  return Math.max(0, Math.min(workEnd, breakEnd) - Math.max(workStart, breakStart));
}

export type ClockEventType = "IN" | "OUT" | "OUT_START" | "OUT_END";

export const CLOCK_EVENT_LABELS: Record<ClockEventType, string> = {
  IN: "出勤",
  OUT: "退勤",
  OUT_START: "外出",
  OUT_END: "戻り",
};

/** 文字列を ClockEventType として検証する（不正値は null） */
export function toClockEventType(value: string): ClockEventType | null {
  return value === "IN" || value === "OUT" || value === "OUT_START" || value === "OUT_END"
    ? value
    : null;
}

export interface RawClockEvent {
  type: ClockEventType;
  time: string; // "HH:mm"
}

/** その日の就業フェーズ（打刻ボタンの活性判定・状態表示に使う） */
export type ClockPhase = "beforeWork" | "working" | "outing" | "offWork";

export type DailyClockDerivation =
  | { status: "empty" }
  | { status: "open"; clockInSoFar: string; phase: "working" | "outing" }
  | { status: "closed"; clockIn: string; clockOut: string; breakMinutes: number };

/**
 * 直近の打刻種別からその日のフェーズを判定する。
 * - null / OUT      → 勤務外（出勤可）
 * - IN / OUT_END    → 出勤中（退勤・外出可）
 * - OUT_START       → 外出中（戻り・退勤可）
 */
export function phaseOfLastEvent(lastEventType: ClockEventType | null): ClockPhase {
  if (lastEventType === null) return "beforeWork";
  if (lastEventType === "OUT") return "offWork";
  if (lastEventType === "OUT_START") return "outing";
  return "working";
}

/**
 * 打刻の生イベント列（timestamp昇順）から1日分の勤怠を導出する。
 *
 * 「開始」（IN・OUT_END）と「停止」（OUT・OUT_START）の対で勤務区間を組み立てる:
 * - 勤務中でないときの開始のみ受理し、勤務中の停止のみ受理する（多重タップは無視）
 * - 外出（OUT_START）〜戻り（OUT_END）の空白と、退勤→再出勤の空白（中抜け）は
 *   どちらも breakMinutes に合算される
 * - 外出中に退勤（OUT）が来た場合は「外出したまま戻らず勤務終了」とみなし、
 *   勤務終了時刻は外出時刻のまま日を確定する（外出時間は勤務に含めない）
 * - 退勤（OUT）で終わっていない日は "open"（勤務中または外出中）を返し、
 *   呼び出し側は Attendance への書き戻しを行わない
 */
export function deriveDailyFromEvents(events: RawClockEvent[]): DailyClockDerivation {
  type Interval = { start: string; end: string };
  const intervals: Interval[] = [];

  let phase: ClockPhase = "beforeWork";
  let openStart: string | null = null;

  for (const ev of events) {
    const working = phase === "working";
    if (ev.type === "IN" || ev.type === "OUT_END") {
      if (!working) {
        openStart = ev.time;
        phase = "working";
      }
    } else if (ev.type === "OUT_START") {
      if (working && openStart !== null) {
        intervals.push({ start: openStart, end: ev.time });
        openStart = null;
        phase = "outing";
      }
    } else {
      // OUT
      if (working && openStart !== null) {
        intervals.push({ start: openStart, end: ev.time });
        openStart = null;
        phase = "offWork";
      } else if (phase === "outing") {
        // 外出したまま退勤 → 勤務終了は外出時刻のまま日を確定する
        phase = "offWork";
      }
    }
  }

  if (intervals.length === 0 && openStart === null) return { status: "empty" };

  if (phase === "working" || phase === "outing") {
    return {
      status: "open",
      clockInSoFar: intervals[0]?.start ?? openStart ?? "",
      phase,
    };
  }

  const clockIn = intervals[0].start;
  const clockOut = intervals[intervals.length - 1].end;

  const spanMinutes = (timeToMinutes(clockOut) ?? 0) - (timeToMinutes(clockIn) ?? 0);
  const workedMinutes = intervals.reduce((sum, itv) => {
    const start = timeToMinutes(itv.start) ?? 0;
    const end = timeToMinutes(itv.end) ?? 0;
    return sum + (end - start);
  }, 0);

  return {
    status: "closed",
    clockIn,
    clockOut,
    breakMinutes: Math.max(0, spanMinutes - workedMinutes),
  };
}

export interface OutingSummary {
  /** 最初の外出開始時刻（外出がない日は null） */
  firstStart: string | null;
  /** 最後の戻り時刻（外出がない日、または外出したまま退勤した日は null） */
  lastEnd: string | null;
  /** 外出〜戻りが確定した回数 */
  count: number;
}

export interface OutingInterval {
  start: string;
  end: string;
}

/**
 * 打刻の生イベント列から外出（OUT_START〜OUT_END）区間をすべて抽出する。
 * 外出したまま退勤した日は戻りが確定しないため、その外出は含めない。
 */
export function outingIntervalsFromEvents(events: RawClockEvent[]): OutingInterval[] {
  const outings: OutingInterval[] = [];
  let phase: ClockPhase = "beforeWork";
  let outingStart: string | null = null;

  for (const ev of events) {
    if (ev.type === "IN" || ev.type === "OUT_END") {
      if (phase === "outing" && outingStart !== null) {
        outings.push({ start: outingStart, end: ev.time });
        outingStart = null;
      }
      phase = "working";
    } else if (ev.type === "OUT_START") {
      if (phase === "working") {
        outingStart = ev.time;
        phase = "outing";
      }
    } else {
      // OUT
      phase = "offWork";
    }
  }

  return outings;
}

/**
 * 打刻の生イベント列から外出（OUT_START〜OUT_END）区間を抽出する。
 * 1日に複数回の外出がある場合は最初の開始〜最後の戻りをまとめて返す
 * （マイページの「外出」「戻り」列は1日1組しか表示しないため）。
 */
export function outingsFromEvents(events: RawClockEvent[]): OutingSummary {
  const outings = outingIntervalsFromEvents(events);
  if (outings.length === 0) return { firstStart: null, lastEnd: null, count: 0 };
  return {
    firstStart: outings[0].start,
    lastEnd: outings[outings.length - 1].end,
    count: outings.length,
  };
}

/** 外出区間の合計時間（分）を返す（実外出時間） */
export function totalOutingMinutes(intervals: OutingInterval[]): number {
  return intervals.reduce((sum, itv) => {
    const start = timeToMinutes(itv.start) ?? 0;
    const end = timeToMinutes(itv.end) ?? 0;
    return sum + Math.max(0, end - start);
  }, 0);
}

/**
 * 外出区間の実測合計（実外出時間）と、休憩時間帯（breakStart〜breakEnd）との
 * 重なりを除いた控除対象時間（勤務時間の計算に使う分）を算出する。
 * 外出が休憩時間帯と重なる場合、その重なった分は固定休憩と二重に控除しない
 * （例: 休憩12:00〜13:00・外出11:00〜13:50 → 実外出2時間50分・控除対象1時間50分）。
 */
export function splitOutingMinutes(
  intervals: OutingInterval[],
  breakStart: string,
  breakEnd: string,
): { actualMinutes: number; deductibleMinutes: number } {
  const bStart = timeToMinutes(breakStart);
  const bEnd = timeToMinutes(breakEnd);
  let actualMinutes = 0;
  let overlapWithBreak = 0;

  for (const itv of intervals) {
    const start = timeToMinutes(itv.start) ?? 0;
    const end = timeToMinutes(itv.end) ?? 0;
    actualMinutes += Math.max(0, end - start);
    if (bStart !== null && bEnd !== null) {
      overlapWithBreak += Math.max(0, Math.min(end, bEnd) - Math.max(start, bStart));
    }
  }

  return { actualMinutes, deductibleMinutes: Math.max(0, actualMinutes - overlapWithBreak) };
}
