// 「実外出」と「控除時間」を確定記録（Attendance）と打刻ログ（ClockEvent）から求める。
//
// 控除時間そのものの計算式は calculator.ts の calcDeductionMinutes にあるが、その入力
// （外出区間をどこから取るか）は Attendance.source ごとに変わる。この分岐が画面ごとに
// コピーされていると勤怠一覧・社員詳細・マイページで値がずれるため、ここに1本化する。

import { calcDeductionMinutes } from "./calculator";
import {
  outingIntervalsFromEvents,
  totalOutingMinutes,
  type OutingInterval,
  type RawClockEvent,
} from "./clock";
import type { WorkRuleSettings } from "./types";

/** 控除時間の算出に必要な確定記録（Attendance）の項目 */
export interface DeductionRecord {
  source: string;
  clockIn: string | null;
  clockOut: string | null;
  breakMinutes: number;
  outingStart: string | null;
  outingEnd: string | null;
}

/** その日の外出の解決結果 */
export interface OutingResolution {
  /** 外出区間（時刻が判る経路のみ。CSV取込は時刻が残っていないため空配列） */
  intervals: OutingInterval[];
  /** 実外出時間（分・丸めない） */
  actualMinutes: number;
  /** intervals が空のときに実外出として扱う分数（CSV取込用） */
  fallbackMinutes: number;
}

/**
 * その日の外出を Attendance.source ごとに解決する。
 * - CLOCK:  打刻ログ（ClockEvent）から区間を復元する
 * - CSV:    区間の時刻が残っていないため breakMinutes をそのまま実外出として扱う
 *           （休憩時間帯との重複は時刻がないと判定できないので差し引かない）
 * - MANUAL: outingStart/outingEnd の1区間。外出欄のない管理者修正の日は外出なし
 */
export function resolveOuting(
  record: DeductionRecord,
  dayEvents: RawClockEvent[],
): OutingResolution {
  if (record.source === "CSV") {
    return {
      intervals: [],
      actualMinutes: record.breakMinutes,
      fallbackMinutes: record.breakMinutes,
    };
  }
  const intervals: OutingInterval[] =
    record.source === "CLOCK"
      ? outingIntervalsFromEvents(dayEvents)
      : record.outingStart && record.outingEnd
        ? [{ start: record.outingStart, end: record.outingEnd }]
        : [];
  return { intervals, actualMinutes: totalOutingMinutes(intervals), fallbackMinutes: 0 };
}

/**
 * その日の控除時間（分）。実外出・遅刻・早退それぞれから休憩時間帯との重複を除き、
 * 項目ごとに丸め単位で切り上げてから合計する（calcDeductionMinutes）。
 *
 * 遅刻・早退は丸め前の実打刻で判定するため、計算エラーの日（hasValidWork=false）は
 * 打刻を渡さず外出分だけを見る。
 */
export function dailyDeductionMinutes(
  record: DeductionRecord,
  outing: OutingResolution,
  hasValidWork: boolean,
  rules: WorkRuleSettings,
): number {
  return calcDeductionMinutes(
    {
      outingIntervals: outing.intervals,
      outingMinutesFallback: outing.fallbackMinutes,
      rawClockIn: hasValidWork ? record.clockIn : null,
      rawClockOut: hasValidWork ? record.clockOut : null,
    },
    rules,
  );
}
