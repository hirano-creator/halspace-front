// 勤務ルール設定・勤怠計算の型定義

/** 季節ごとの勤務時間帯設定 */
export interface SeasonRule {
  /** 期間開始（"MM-DD"） */
  startMonthDay: string;
  /** 期間終了（"MM-DD"） */
  endMonthDay: string;
  /** 始業時刻（"HH:mm"） */
  workStart: string;
  /** 終業時刻（"HH:mm"）。終業後〜残業開始までは通常勤務扱い */
  workEnd: string;
}

/** 勤務ルール設定（設定画面から変更可能） */
export interface WorkRuleSettings {
  /** 夏季勤務 */
  summer: SeasonRule;
  /** 冬季勤務 */
  winter: SeasonRule;
  /** 残業開始時刻（"HH:mm"）。この時刻以降の勤務が残業 */
  overtimeStart: string;
  /** 残業割増率（例: 0.25 = 25%） */
  overtimePremiumRate: number;
  /** 早出割増率（例: 0.25 = 25%） */
  earlyPremiumRate: number;
  /** 残業時間の丸め単位（分）。単位未満は切り捨て */
  overtimeRoundingMinutes: number;
  /** 早出の計算対象開始時刻（"HH:mm"）。これより前の勤務は集計対象外 */
  earlyWorkStart: string;
  /**
   * 締め日（1〜31）。「6月」= 前月締め日翌日〜当月締め日 の期間になる。
   * 例: 25 → 6月度 = 5/26〜6/25。31を指定すると暦月（1日〜末日）扱い。
   */
  closingDay: number;
}

/** 勤務ルールの初期値 */
export const DEFAULT_WORK_RULES: WorkRuleSettings = {
  summer: {
    startMonthDay: "04-01",
    endMonthDay: "10-31",
    workStart: "09:00",
    workEnd: "18:00",
  },
  winter: {
    startMonthDay: "11-01",
    endMonthDay: "03-31",
    workStart: "09:00",
    workEnd: "16:00",
  },
  overtimeStart: "18:00",
  overtimePremiumRate: 0.25,
  earlyPremiumRate: 0.25,
  overtimeRoundingMinutes: 30,
  earlyWorkStart: "05:00",
  closingDay: 25,
};

/** 1日分の金額計算結果（すべて円・整数） */
export interface DailyPay {
  /** 通常勤務分（時給そのまま） */
  normalPay: number;
  /** 早出分（割増が適用される日は割増込み、適用されない日は通常時給） */
  earlyPay: number;
  /** 残業分（割増込み） */
  overtimePay: number;
  /** 合計 */
  totalPay: number;
  /**
   * 「金額」欄に表示する基本給部分。
   * 通常勤務分 ＋（早出に割増が適用されない日はその早出分も含む）。
   * 割増が適用される早出・残業は premiumPay 側に計上するため、
   * basePay + premiumPay は totalPay と一致し、二重計上にはならない。
   */
  basePay: number;
  /** 「残業代」欄に表示する割増部分（割増適用の早出＋残業） */
  premiumPay: number;
}

/** 月次の金額集計 */
export interface MonthlyPaySummary extends DailyPay {}

/** 1日分の勤怠計算入力 */
export interface DailyAttendanceInput {
  /** 日付 "YYYY-MM-DD" */
  date: string;
  /** 出勤時刻 "HH:mm" */
  clockIn: string;
  /** 退勤時刻 "HH:mm" */
  clockOut: string;
  /** 休憩時間（分） */
  breakMinutes: number;
}

/** 1日分の勤怠計算結果（すべて分単位） */
export interface DailyCalcResult {
  /** 適用季節 */
  season: "summer" | "winter";
  /** 早出時間（丸め後）。「出勤時間」表示にも使う */
  earlyMinutes: number;
  /** 早出時間（丸め前・参考値） */
  earlyRawMinutes: number;
  /** 通常勤務時間（休憩控除後） */
  normalMinutes: number;
  /** 残業時間（丸め後）。「退勤時間」表示にも使う */
  overtimeMinutes: number;
  /** 残業時間（丸め前・参考値） */
  overtimeRawMinutes: number;
  /**
   * 早出に割増が適用されるか。
   * 退勤が残業開始時刻（18:00）以降の日のみ true。
   * false の日の早出は通常時給で計算される。
   */
  earlyPremiumApplies: boolean;
  /** 丸め適用後の出勤時刻（"HH:mm"）。実出勤が始業より前の日のみ丸められる */
  roundedClockIn: string;
  /** 丸め適用後の退勤時刻（"HH:mm"）。実退勤が残業開始時刻より後の日のみ丸められる */
  roundedClockOut: string;
  /** 総勤務時間（早出＋通常＋残業、すべて丸め後） */
  totalMinutes: number;
  /** 入力不備等のエラー（正常時はnull） */
  error: string | null;
}

/** 月次集計結果 */
export interface MonthlySummary {
  /** 勤務日数 */
  workDays: number;
  /** 早出時間（分・割増の有無を問わず全日分の合計） */
  earlyMinutes: number;
  /**
   * 早出残業（分）。18:00以降まで働いた日の早出時間のみの合計（割増対象分）。
   * 「勤務時間」からはこの分を除いて表示する。
   */
  earlyOvertimeMinutes: number;
  /** 通常勤務時間（分） */
  normalMinutes: number;
  /** 残業時間（分） */
  overtimeMinutes: number;
  /** 総勤務時間（分） */
  totalMinutes: number;
}

/** CSV列マッピング設定（Square CSVの列名 → システム項目） */
export interface CsvMappingSettings {
  /** 社員番号の列名 */
  employeeCode: string;
  /** 氏名（または姓）の列名 */
  name: string;
  /** 氏名の2列目（名）の列名。Squareは姓・名が分割されているため（任意） */
  name2: string;
  /** 日付の列名 */
  date: string;
  /** 出勤時間の列名 */
  clockIn: string;
  /** 退勤時間の列名 */
  clockOut: string;
  /** 休憩時間の列名（任意。整数=分、小数=時間として解釈） */
  breakMinutes: string;
}

/** CSV列マッピングの初期値（Squareタイムカードエクスポートの実列名） */
export const DEFAULT_CSV_MAPPING: CsvMappingSettings = {
  employeeCode: "従業員ID",
  name: "姓",
  name2: "名",
  date: "出勤日",
  clockIn: "出勤時間",
  clockOut: "退勤時間",
  breakMinutes: "無給の休憩",
};
