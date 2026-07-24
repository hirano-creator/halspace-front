// 勤怠計算のコアロジック（純粋関数）
//
// 打刻の生データと勤務ルール設定のみから計算する。
// DBには計算結果を保存しないため、設定変更だけで全期間の計算結果が変わる。

import { isInMonthDayRange, minutesToTime, timeToMinutes } from "@/lib/utils/time";
import type {
  DailyAttendanceInput,
  DailyCalcResult,
  DailyPay,
  MonthlySummary,
  SeasonRule,
  WorkRuleSettings,
} from "./types";

/** 2つの時間帯 [aStart, aEnd) と [bStart, bEnd) の重なり（分）を返す */
function overlapMinutes(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/** 日付に適用する季節を判定する（夏季期間に含まれなければ冬季） */
export function seasonOf(date: string, rules: WorkRuleSettings): "summer" | "winter" {
  return isInMonthDayRange(date, rules.summer.startMonthDay, rules.summer.endMonthDay)
    ? "summer"
    : "winter";
}

/** 分数を丸め単位（分）で切り捨てる（例: 30分単位 → 89分→60分、95分→90分） */
export function roundOvertime(rawMinutes: number, unitMinutes: number): number {
  if (unitMinutes <= 0) return rawMinutes;
  return Math.floor(rawMinutes / unitMinutes) * unitMinutes;
}

/** 0時からの経過分を丸め単位で切り捨てる（例: 30分単位 → 16:11→16:00, 16:32→16:30） */
function floorToUnit(minutes: number, unitMinutes: number): number {
  if (unitMinutes <= 0) return minutes;
  return Math.floor(minutes / unitMinutes) * unitMinutes;
}

/** 0時からの経過分を丸め単位で切り上げる（例: 30分単位 → 8:19→8:30, 8:31→9:00） */
function ceilToUnit(minutes: number, unitMinutes: number): number {
  if (unitMinutes <= 0) return minutes;
  return Math.ceil(minutes / unitMinutes) * unitMinutes;
}

const emptyResult = (
  season: "summer" | "winter",
  error: string,
  rawClockIn: string,
  rawClockOut: string | null,
): DailyCalcResult => ({
  season,
  earlyMinutes: 0,
  earlyRawMinutes: 0,
  normalMinutes: 0,
  overtimeMinutes: 0,
  overtimeRawMinutes: 0,
  earlyPremiumApplies: false,
  roundedClockIn: rawClockIn,
  roundedClockOut: rawClockOut ?? "",
  totalMinutes: 0,
  lateMinutes: 0,
  earlyLeaveMinutes: 0,
  error,
});

/**
 * 1日分の勤怠を計算する。
 *
 * 30分ルール（丸め単位で設定変更可）:
 * - 出勤: 始業より前に打刻した場合のみ、始業に寄せて切り上げる（例: 始業9:00・実出勤8:19 → 8:30）
 * - 退勤: 常に切り捨てる（例: 16:11 → 16:00、16:32 → 16:30）。始業〜残業開始の間の退勤・
 *   残業開始以降の退勤のどちらでも同じルールを適用する。
 * 丸め後の出退勤時刻をもとに、以降の早出・通常勤務・残業をすべて計算する
 * （表の「出勤時間」「退勤時間」列と「勤務時間」「金額」が必ず一致するようにするため）。
 *
 * 時間帯の区分:
 * - 早出:   earlyWorkStart 〜 始業        の勤務
 * - 通常:   始業           〜 残業開始    の勤務（休憩を控除）
 * - 残業:   残業開始       〜 退勤        の勤務
 *
 * 冬季の終業(16:00)〜残業開始(18:00)は通常勤務扱いのため、
 * 通常勤務の上限は季節の終業時刻ではなく残業開始時刻とする。
 *
 * 実働8時間ルール:
 * 残業開始時刻以降の勤務（残業候補）は、早出・通常勤務との合計が
 * overtimeThresholdMinutes（既定8時間=480分）を超えた分だけを残業として扱う。
 * 超えない場合は残業候補を通常勤務に繰り入れる
 * （例: 11:00〜19:00 休憩60分 → 実働7時間のため残業なし）。
 */
export function calcDaily(input: DailyAttendanceInput, rules: WorkRuleSettings): DailyCalcResult {
  const season = seasonOf(input.date, rules);
  const seasonRule: SeasonRule = rules[season];

  const clockInRaw = timeToMinutes(input.clockIn);
  const clockOutRaw = timeToMinutes(input.clockOut);
  const workStart = timeToMinutes(seasonRule.workStart);
  const overtimeStart = timeToMinutes(rules.overtimeStart);
  const earlyWorkStart = timeToMinutes(rules.earlyWorkStart);

  if (clockOutRaw === null) {
    return emptyResult(season, "退勤時刻が未入力です", input.clockIn, input.clockOut);
  }
  if (clockInRaw === null) {
    return emptyResult(season, "打刻時刻の形式が不正です", input.clockIn, input.clockOut);
  }
  if (workStart === null || overtimeStart === null || earlyWorkStart === null) {
    return emptyResult(
      season,
      "勤務ルール設定の時刻形式が不正です",
      input.clockIn,
      input.clockOut,
    );
  }
  if (clockOutRaw <= clockInRaw) {
    return emptyResult(season, "退勤時刻が出勤時刻以前です", input.clockIn, input.clockOut);
  }

  const unit = rules.overtimeRoundingMinutes;
  // 出勤: 始業より前の打刻のみ、始業側へ切り上げる（早出時間を丸め単位で減らす）
  const clockIn = clockInRaw < workStart ? ceilToUnit(clockInRaw, unit) : clockInRaw;
  // 退勤: 常に切り捨てる
  const clockOut = floorToUnit(clockOutRaw, unit);

  // 丸めた結果、退勤が出勤以前になってしまう極端な短時間勤務は0扱いにする
  const valid = clockOut > clockIn;

  const earlyRawMinutes = overlapMinutes(earlyWorkStart, workStart, clockInRaw, clockOutRaw);
  const earlyMinutes = valid ? overlapMinutes(earlyWorkStart, workStart, clockIn, clockOut) : 0;

  // 通常勤務: 始業〜残業開始。休憩は通常勤務から控除する（マイナスにはしない）
  const normalRaw = valid ? overlapMinutes(workStart, overtimeStart, clockIn, clockOut) : 0;
  const breakMinutes = Math.max(0, input.breakMinutes || 0);
  const normalBeforeThreshold = Math.max(0, normalRaw - breakMinutes);

  const overtimeRawMinutes = overlapMinutes(overtimeStart, 48 * 60, clockInRaw, clockOutRaw);
  const overtimeCandidateMinutes = valid
    ? overlapMinutes(overtimeStart, 48 * 60, clockIn, clockOut)
    : 0;

  // 実働8時間ルール: 早出・通常・残業候補（休憩控除後）の合計が
  // overtimeThresholdMinutes を超えた分だけを残業として扱う。超えなければ
  // 残業候補（残業開始時刻以降の勤務）も通常勤務に繰り入れる
  // （例: 11:00〜19:00 休憩60分 → 実働7時間のため残業なし）。
  const workedMinutes = earlyMinutes + normalBeforeThreshold + overtimeCandidateMinutes;
  const overtimeMinutes = Math.max(
    0,
    Math.min(overtimeCandidateMinutes, workedMinutes - rules.overtimeThresholdMinutes),
  );
  const normalMinutes = normalBeforeThreshold + (overtimeCandidateMinutes - overtimeMinutes);

  // 早出の割増は「丸め後の退勤が残業開始時刻（18:00）以降の日」のみ適用。
  // 例: 8:00〜18:05 → 早出1時間は割増 / 8:00〜16:00 → 早出1時間は通常時給
  const earlyPremiumApplies = clockOut >= overtimeStart;

  // 遅刻・早退の自動判定（丸め前の実打刻と季節の始業・終業時刻を比較する）。
  // 終業時刻の設定が不正な場合は早退判定をスキップする（勤務計算は続行）
  const workEnd = timeToMinutes(seasonRule.workEnd);
  const lateMinutes = Math.max(0, clockInRaw - workStart);
  const earlyLeaveMinutes = workEnd === null ? 0 : Math.max(0, workEnd - clockOutRaw);

  return {
    season,
    earlyMinutes,
    earlyRawMinutes,
    normalMinutes,
    overtimeMinutes,
    overtimeRawMinutes,
    earlyPremiumApplies,
    roundedClockIn: minutesToTime(clockIn),
    roundedClockOut: minutesToTime(clockOut),
    totalMinutes: earlyMinutes + normalMinutes + overtimeMinutes,
    lateMinutes,
    earlyLeaveMinutes,
    error: null,
  };
}

/**
 * 1日分の金額を計算する（円未満は区分ごとに四捨五入）。
 *
 * - 通常勤務: 時給そのまま
 * - 早出:     退勤が残業開始時刻（18:00）以降の日は 時給 ×（1 + 早出割増率）、
 *             それ以外の日は通常時給
 * - 残業:     時給 ×（1 + 残業割増率）
 *
 * 「金額」＝通常時給分（通常勤務＋割増なしの早出）、
 * 「残業代」＝割増分（割増ありの早出＋残業）と表示を分けるため、
 * basePay / premiumPay としても返す（basePay + premiumPay = totalPay、二重計上なし）。
 *
 * 月合計は日額の合計とする（画面の表と合計が必ず一致するようにするため）。
 */
export function calcDailyPay(
  calc: DailyCalcResult,
  hourlyWage: number,
  rules: WorkRuleSettings,
): DailyPay {
  if (calc.error || hourlyWage <= 0) {
    return { normalPay: 0, earlyPay: 0, overtimePay: 0, totalPay: 0, basePay: 0, premiumPay: 0 };
  }
  const perMinute = hourlyWage / 60;
  const earlyRate = calc.earlyPremiumApplies ? 1 + rules.earlyPremiumRate : 1;
  const normalPay = Math.round(calc.normalMinutes * perMinute);
  const earlyPay = Math.round(calc.earlyMinutes * perMinute * earlyRate);
  const overtimePay = Math.round(
    calc.overtimeMinutes * perMinute * (1 + rules.overtimePremiumRate),
  );
  const basePay = normalPay + (calc.earlyPremiumApplies ? 0 : earlyPay);
  const premiumPay = (calc.earlyPremiumApplies ? earlyPay : 0) + overtimePay;
  return {
    normalPay,
    earlyPay,
    overtimePay,
    totalPay: normalPay + earlyPay + overtimePay,
    basePay,
    premiumPay,
  };
}

/** 金額を「¥12,345」形式にフォーマットする */
export function formatYen(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

/** 複数日の計算結果を月次集計する（エラー行は勤務日数に含めない） */
export function summarize(results: DailyCalcResult[]): MonthlySummary {
  const valid = results.filter((r) => r.error === null);
  return {
    workDays: valid.length,
    earlyMinutes: valid.reduce((sum, r) => sum + r.earlyMinutes, 0),
    earlyOvertimeMinutes: valid.reduce(
      (sum, r) => sum + (r.earlyPremiumApplies ? r.earlyMinutes : 0),
      0,
    ),
    normalMinutes: valid.reduce((sum, r) => sum + r.normalMinutes, 0),
    overtimeMinutes: valid.reduce((sum, r) => sum + r.overtimeMinutes, 0),
    totalMinutes: valid.reduce((sum, r) => sum + r.totalMinutes, 0),
    lateCount: valid.filter((r) => r.lateMinutes > 0).length,
    lateMinutes: valid.reduce((sum, r) => sum + r.lateMinutes, 0),
    earlyLeaveCount: valid.filter((r) => r.earlyLeaveMinutes > 0).length,
    earlyLeaveMinutes: valid.reduce((sum, r) => sum + r.earlyLeaveMinutes, 0),
  };
}
