// 勤怠計算のコアロジック（純粋関数）
//
// 打刻の生データと勤務ルール設定のみから計算する。
// DBには計算結果を保存しないため、設定変更だけで全期間の計算結果が変わる。

import {
  datesInRange,
  dayOfWeek,
  minutesToTime,
  timeToMinutes,
  weeksInPeriod,
} from "@/lib/utils/time";
import type {
  DailyAttendanceInput,
  DailyCalcResult,
  DailyPay,
  MonthlySummary,
  WeeklyBucket,
  WeeklyPay,
  WeeklyTotals,
  WorkRuleSettings,
} from "./types";

/** 2つの時間帯 [aStart, aEnd) と [bStart, bEnd) の重なり（分）を返す */
function overlapMinutes(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
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
  error: string,
  rawClockIn: string | null,
  rawClockOut: string | null,
): DailyCalcResult => ({
  earlyMinutes: 0,
  earlyRawMinutes: 0,
  normalMinutes: 0,
  overtimeMinutes: 0,
  overtimeRawMinutes: 0,
  earlyPremiumApplies: false,
  roundedClockIn: rawClockIn ?? "",
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
 * 終業(例: 16:00)〜残業開始(18:00)は通常勤務扱いのため、
 * 通常勤務の上限は終業時刻ではなく残業開始時刻とする。
 *
 * 実働8時間ルール:
 * 残業開始時刻以降の勤務（残業候補）は、早出・通常勤務との合計が
 * overtimeThresholdMinutes（既定8時間=480分）を超えた分だけを残業として扱う。
 * 超えない場合は残業候補を通常勤務に繰り入れる
 * （例: 11:00〜19:00 休憩60分 → 実働7時間のため残業なし）。
 *
 * 週単位管理（weekly.enabled）:
 * 日単位では残業を判定せず、実働時間をすべて通常勤務に集約する。
 * 残業の区分は週合計に対して calcWeekly が行う。
 */
export function calcDaily(input: DailyAttendanceInput, rules: WorkRuleSettings): DailyCalcResult {
  const clockInRaw = timeToMinutes(input.clockIn);
  const clockOutRaw = timeToMinutes(input.clockOut);
  const workStart = timeToMinutes(rules.workStart);
  const overtimeStart = timeToMinutes(rules.overtimeStart);
  const earlyWorkStart = timeToMinutes(rules.earlyWorkStart);

  // 未入力（null・空欄）と、入力はあるが形式が不正なケースは分けて知らせる
  if (input.clockIn === null || input.clockIn === "") {
    return emptyResult("出勤時刻が未入力です", input.clockIn, input.clockOut);
  }
  if (input.clockOut === null || input.clockOut === "") {
    return emptyResult("退勤時刻が未入力です", input.clockIn, input.clockOut);
  }
  if (clockInRaw === null || clockOutRaw === null) {
    return emptyResult("打刻時刻の形式が不正です", input.clockIn, input.clockOut);
  }
  if (workStart === null || overtimeStart === null || earlyWorkStart === null) {
    return emptyResult("勤務ルール設定の時刻形式が不正です", input.clockIn, input.clockOut);
  }
  if (clockOutRaw <= clockInRaw) {
    return emptyResult("退勤時刻が出勤時刻以前です", input.clockIn, input.clockOut);
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

  // 遅刻・早退の自動判定（丸め前の実打刻と始業・終業時刻を比較する）。
  // 終業時刻の設定が不正な場合は早退判定をスキップする（勤務計算は続行）
  const workEnd = timeToMinutes(rules.workEnd);
  const lateMinutes = Math.max(0, clockInRaw - workStart);
  const earlyLeaveMinutes = workEnd === null ? 0 : Math.max(0, workEnd - clockOutRaw);

  const base = {
    earlyRawMinutes,
    overtimeRawMinutes,
    roundedClockIn: minutesToTime(clockIn),
    roundedClockOut: minutesToTime(clockOut),
    lateMinutes,
    earlyLeaveMinutes,
    error: null,
  };

  // 週単位管理では日単位の残業・早出割増を判定しない。
  // 実働時間をすべて通常勤務に集約し、残業の区分は週集計（calcWeekly）に委ねる。
  if (rules.weekly.enabled) {
    return {
      ...base,
      earlyMinutes: 0,
      normalMinutes: workedMinutes,
      overtimeMinutes: 0,
      earlyPremiumApplies: false,
      totalMinutes: workedMinutes,
    };
  }

  return {
    ...base,
    earlyMinutes,
    normalMinutes,
    overtimeMinutes,
    earlyPremiumApplies,
    totalMinutes: earlyMinutes + normalMinutes + overtimeMinutes,
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

/**
 * 1日分の法定外残業（分）を返す。
 *
 * 法定勤務時間（既定8時間）に対する過不足で、実働がそれに満たない日はマイナスになる
 * （例: 実働6時間・法定8時間 → -120）。月合計はこの差分をそのまま足し込んだ値になる。
 *
 * 基準にする実働は calcDaily の totalMinutes（休憩・控除外出を引いた総勤務時間）。
 * 週単位管理の会社では画面の「勤務時間」列と同じ値になり、日単位管理の会社では
 * 「勤務時間 ＋ 早出残業 ＋ 残業」の合計＝その日の実働と一致する。
 *
 * 出勤のない日・計算エラーの日は対象外（0を返す。呼び出し側は「-」を表示する）。
 */
export function calcLegalOvertime(calc: DailyCalcResult, rules: WorkRuleSettings): number {
  if (calc.error) return 0;
  return calc.totalMinutes - rules.legalDailyMinutes;
}

/** 金額を「¥12,345」形式にフォーマットする */
export function formatYen(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

/**
 * 週単位管理の会社の勤怠を週ごとに集計する。
 *
 * 締め期間を起算曜日（例: 金曜）で区切り、週ごとの総労働時間を3層に配分する:
 * - 所定内:       〜 standardMinutes（例 36H）
 * - 所定超法定内:  standardMinutes超 〜 legalMinutes以内（例 36H超44H以内）
 * - 法定超:       legalMinutes超（例 44H超）
 * この3つの合計は必ず週の総労働時間と一致する。
 *
 * 月度の先頭・末尾は7日に満たない端数週になるが、しきい値は按分せずそのまま適用する
 * （例: 1日だけの週は 6:00 なのですべて所定内）。
 *
 * 定休日（例: 木曜）の勤務も週の労働時間に合算し、closedDayWorkDates で区別できるようにする。
 * 表示用のラベル（labelStart / labelEnd）は勤務実績のある日でトリムするため、
 * 木曜が定休で勤務なしの週は「8/28〜9/2」、木曜に出勤した週は「9/18〜9/24」になる。
 */
export function calcWeekly(
  days: { date: string; calc: DailyCalcResult }[],
  period: { start: string; end: string },
  rules: WorkRuleSettings,
): WeeklyBucket[] {
  const w = rules.weekly;
  const byDate = new Map(days.map((d) => [d.date, d.calc]));

  return weeksInPeriod(period.start, period.end, w.startDayOfWeek).map((block) => {
    const dates = datesInRange(block.start, block.end);
    const worked = dates.filter((date) => {
      const calc = byDate.get(date);
      return calc !== undefined && calc.error === null;
    });

    const totalMinutes = worked.reduce((sum, date) => sum + byDate.get(date)!.totalMinutes, 0);
    const standardMinutes = Math.min(totalMinutes, w.standardMinutes);
    const withinLegalOvertimeMinutes = Math.max(
      0,
      Math.min(totalMinutes, w.legalMinutes) - w.standardMinutes,
    );
    const overLegalOvertimeMinutes = Math.max(0, totalMinutes - w.legalMinutes);

    // 表示ラベルは勤務実績のある日でトリムする（勤務ゼロの週は区間そのもの）
    const labelStart = worked[0] ?? block.start;
    const labelEnd = worked[worked.length - 1] ?? block.end;

    return {
      start: block.start,
      end: block.end,
      labelStart,
      labelEnd,
      isPartial: block.isPartial,
      workDays: worked.length,
      totalMinutes,
      standardMinutes,
      withinLegalOvertimeMinutes,
      overLegalOvertimeMinutes,
      closedDayWorkDates: worked.filter((date) => w.closedDays.includes(dayOfWeek(date))),
    };
  });
}

/** 週別集計を月度合計にまとめる */
export function summarizeWeeks(weeks: WeeklyBucket[]): WeeklyTotals {
  return {
    totalMinutes: weeks.reduce((sum, w) => sum + w.totalMinutes, 0),
    standardMinutes: weeks.reduce((sum, w) => sum + w.standardMinutes, 0),
    withinLegalOvertimeMinutes: weeks.reduce((sum, w) => sum + w.withinLegalOvertimeMinutes, 0),
    overLegalOvertimeMinutes: weeks.reduce((sum, w) => sum + w.overLegalOvertimeMinutes, 0),
    closedDayWorkCount: weeks.reduce((sum, w) => sum + w.closedDayWorkDates.length, 0),
  };
}

/**
 * 週単位管理での割増額を計算する（円未満は区分ごとに四捨五入）。
 *
 * 週次モードでは calcDaily が残業を0にするため、日次の金額は基本給（basePay）のみになる。
 * 割増はここで週合計に対して計算し、月度の支給額は「日次 basePay の合計 ＋ premiumPay」になる。
 */
export function calcWeeklyPay(
  totals: WeeklyTotals,
  hourlyWage: number,
  rules: WorkRuleSettings,
): WeeklyPay {
  if (hourlyWage <= 0) return { withinLegalPay: 0, overLegalPay: 0, premiumPay: 0 };
  const perMinute = hourlyWage / 60;
  const withinLegalPay = Math.round(
    totals.withinLegalOvertimeMinutes * perMinute * rules.weekly.withinLegalPremiumRate,
  );
  const overLegalPay = Math.round(
    totals.overLegalOvertimeMinutes * perMinute * rules.weekly.overLegalPremiumRate,
  );
  return { withinLegalPay, overLegalPay, premiumPay: withinLegalPay + overLegalPay };
}

/** 複数日の計算結果を月次集計する（エラー行は勤務日数に含めない） */
export function summarize(results: DailyCalcResult[], rules: WorkRuleSettings): MonthlySummary {
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
    // 日ごとの過不足（8時間との差）をそのまま累計する。不足分はマイナスとして相殺される
    legalOvertimeMinutes: valid.reduce((sum, r) => sum + calcLegalOvertime(r, rules), 0),
    lateCount: valid.filter((r) => r.lateMinutes > 0).length,
    lateMinutes: valid.reduce((sum, r) => sum + r.lateMinutes, 0),
    earlyLeaveCount: valid.filter((r) => r.earlyLeaveMinutes > 0).length,
    earlyLeaveMinutes: valid.reduce((sum, r) => sum + r.earlyLeaveMinutes, 0),
  };
}
