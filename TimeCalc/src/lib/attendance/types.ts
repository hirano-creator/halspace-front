// 勤務ルール設定・勤怠計算の型定義

/** 勤務ルール設定（設定画面から変更可能） */
export interface WorkRuleSettings {
  /** 始業時刻（"HH:mm"）。会社ごとに設定する（例: ヒラノ 08:00 / affect 09:00） */
  workStart: string;
  /** 終業時刻（"HH:mm"）。終業後〜残業開始までは通常勤務扱い。遅刻・早退の判定基準にもなる */
  workEnd: string;
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
   * 残業が発生する実働時間のしきい値（分）。早出・通常・残業候補（休憩控除後）の
   * 合計がこの時間を超えた分だけを残業として扱い、超えなければ残業候補も通常勤務に
   * 繰り入れる（例: 定時8時間・8:00→ しきい値480分の場合、11:00〜19:00 休憩60分は
   * 実働7時間のため残業なし。9:00〜19:00 休憩60分は実働9時間のため1時間が残業）。
   * 0を指定すると、残業開始時刻（overtimeStart）以降の勤務をすべて残業として扱う
   * 従来どおりの判定になる。
   */
  overtimeThresholdMinutes: number;
  /**
   * 法定勤務時間（分/日）。8時間 = 480。
   * 日別の「法定外残業」＝ その日の実働（休憩・控除外出を引いた勤務時間）− この時間。
   * この時間に満たない日は0で止める（マイナスにしない）ため、月合計は超過分だけの累計になる。
   * 残業の金額計算には使わない（表示専用の指標）。
   */
  legalDailyMinutes: number;
  /**
   * 締め日（1〜31）。「6月」= 前月締め日翌日〜当月締め日 の期間になる。
   * 例: 25 → 6月度 = 5/26〜6/25。31を指定すると暦月（1日〜末日）扱い。
   */
  closingDay: number;
  /**
   * 休憩開始時刻（"HH:mm"）。打刻・本人修正・修正申請で1日の休憩・外出（分）を
   * 算出する際、休憩時間帯（breakStart〜breakEnd）に「固定休憩＋外出時間」として
   * 加算される。外出がこの時間帯と重なる場合は重なった分を控除対象から除き、
   * 休憩と外出を二重に差し引かないようにする。
   * CSV取込データ（列の実測値をそのまま使う）には適用しない。
   */
  breakStart: string;
  /** 休憩終了時刻（"HH:mm"） */
  breakEnd: string;
  /** 週単位の労働時間管理 */
  weekly: WeeklyRule;
}

/**
 * 週単位の労働時間管理設定。
 * enabled にすると、その会社では日単位の残業判定（overtimeStart / overtimeThresholdMinutes）を
 * 行わず、週合計を「所定内」「所定超〜法定内」「法定超」の3層に分けて残業を区分する。
 */
export interface WeeklyRule {
  /** 週単位管理を使うか。false なら従来どおり日単位で残業を判定する */
  enabled: boolean;
  /** 週の起算曜日（0=日 … 6=土）。金曜起算 = 5 */
  startDayOfWeek: number;
  /**
   * 定休日（0=日 … 6=土）の配列。木曜定休 = [4]。
   * 定休日に勤務があった場合も週の労働時間には合算し、表示上のみ区別する。
   */
  closedDays: number[];
  /** 所定労働時間（分/週）。6H×6日 = 36H = 2160 */
  standardMinutes: number;
  /** 法定労働時間（分/週）。44H = 2640。所定以上の値であること */
  legalMinutes: number;
  /** 所定超〜法定内（例: 36H超44H以内）の割増率（0.25 = 25%） */
  withinLegalPremiumRate: number;
  /** 法定超（例: 44H超）の割増率 */
  overLegalPremiumRate: number;
}

/** 勤務ルールの初期値 */
export const DEFAULT_WORK_RULES: WorkRuleSettings = {
  workStart: "08:00",
  workEnd: "17:00",
  overtimeStart: "18:00",
  overtimePremiumRate: 0.25,
  earlyPremiumRate: 0.25,
  overtimeRoundingMinutes: 30,
  earlyWorkStart: "05:00",
  overtimeThresholdMinutes: 480,
  legalDailyMinutes: 480,
  closingDay: 25,
  breakStart: "12:00",
  breakEnd: "13:00",
  // 既定はOFF。既存の会社は従来どおり日単位で残業を判定する
  weekly: {
    enabled: false,
    startDayOfWeek: 5, // 金曜
    closedDays: [4], // 木曜
    standardMinutes: 36 * 60,
    legalMinutes: 44 * 60,
    withinLegalPremiumRate: 0,
    overLegalPremiumRate: 0.25,
  },
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
export type MonthlyPaySummary = DailyPay;

/** 1日分の勤怠計算入力 */
export interface DailyAttendanceInput {
  /** 日付 "YYYY-MM-DD" */
  date: string;
  /** 出勤時刻 "HH:mm"。未出勤（未入力）の日は null */
  clockIn: string | null;
  /** 退勤時刻 "HH:mm"。未退勤（未入力）の日は null */
  clockOut: string | null;
  /** 休憩時間（分） */
  breakMinutes: number;
}

/** 1日分の勤怠計算結果（すべて分単位） */
export interface DailyCalcResult {
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
  /**
   * 遅刻時間（分）。実出勤が季節の始業時刻より後の場合のみ正の値。
   * 判定は丸め前の実打刻で行う（16:11→16:00等の丸めの影響を受けない）。
   */
  lateMinutes: number;
  /** 早退時間（分）。実退勤が季節の終業時刻より前の場合のみ正の値。判定は実打刻基準 */
  earlyLeaveMinutes: number;
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
  /**
   * 法定外残業（分）。日ごとの「実働 − 法定勤務時間（legalDailyMinutes）」のうち
   * 超過分だけの累計。不足の日は0で止めるため、負にはならない。
   */
  legalOvertimeMinutes: number;
  /** 遅刻回数（日数） */
  lateCount: number;
  /** 遅刻時間の合計（分） */
  lateMinutes: number;
  /** 早退回数（日数） */
  earlyLeaveCount: number;
  /** 早退時間の合計（分） */
  earlyLeaveMinutes: number;
}

/**
 * 1週分の集計結果（週単位管理が有効な会社のみ生成される）。
 * 週の区間は起算曜日から7日間だが、月度の先頭・末尾では締め期間で切り詰められる（端数週）。
 */
export interface WeeklyBucket {
  /** 週区間の開始日 "YYYY-MM-DD"（締め期間で切り詰め後） */
  start: string;
  /** 週区間の終了日 "YYYY-MM-DD"（締め期間で切り詰め後） */
  end: string;
  /** 表示用の開始日。勤務実績のある日でトリムする（例: 8/28〜9/3 → 8/28） */
  labelStart: string;
  /** 表示用の終了日。木曜が定休で勤務なしなら水曜まで縮む（例: 8/28〜9/3 → 9/2） */
  labelEnd: string;
  /** 7日に満たない端数週か（月度の先頭・末尾で発生） */
  isPartial: boolean;
  /** 勤務日数（計算エラーのない日） */
  workDays: number;
  /** 週の総労働時間（分） */
  totalMinutes: number;
  /** 所定内（〜standardMinutes） */
  standardMinutes: number;
  /** 所定超〜法定内（standardMinutes超〜legalMinutes以内） */
  withinLegalOvertimeMinutes: number;
  /** 法定超（legalMinutes超） */
  overLegalOvertimeMinutes: number;
  /** 定休日に勤務があった日付 "YYYY-MM-DD" */
  closedDayWorkDates: string[];
}

/** 週別集計の月度合計 */
export interface WeeklyTotals {
  totalMinutes: number;
  standardMinutes: number;
  withinLegalOvertimeMinutes: number;
  overLegalOvertimeMinutes: number;
  /** 定休日に勤務した日数 */
  closedDayWorkCount: number;
}

/** 週単位管理での割増額（円・整数） */
export interface WeeklyPay {
  /** 所定超〜法定内の割増分 */
  withinLegalPay: number;
  /** 法定超の割増分 */
  overLegalPay: number;
  /** 割増合計（日次の basePay に加算して支給額になる） */
  premiumPay: number;
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
