import { describe, expect, it } from "vitest";
import {
  calcDaily,
  calcDailyPay,
  calcWeekly,
  calcWeeklyPay,
  roundOvertime,
  summarize,
  summarizeWeeks,
} from "./calculator";
import { DEFAULT_WORK_RULES } from "./types";
import type { DailyCalcResult, WorkRuleSettings } from "./types";

// 計算仕様の基準ルール（始業9:00・終業18:00）。
// 既定値そのものではなく、テストが前提とする勤務時間を明示するために上書きしている。
const rules: WorkRuleSettings = {
  ...DEFAULT_WORK_RULES,
  workStart: "09:00",
  workEnd: "18:00",
};

describe("roundOvertime（30分単位切り捨て）", () => {
  it("89分 → 60分", () => expect(roundOvertime(89, 30)).toBe(60));
  it("90分 → 90分", () => expect(roundOvertime(90, 30)).toBe(90));
  it("125分 → 120分", () => expect(roundOvertime(125, 30)).toBe(120));
  it("150分 → 150分", () => expect(roundOvertime(150, 30)).toBe(150));
  it("179分 → 150分", () => expect(roundOvertime(179, 30)).toBe(150));
  it("30分未満は0", () => expect(roundOvertime(29, 30)).toBe(0));
});

describe("calcDaily（定時9:00〜18:00、18:00以降残業）", () => {
  it("定時勤務 9:00〜18:00 休憩60分 → 通常8時間・早出/残業なし", () => {
    const r = calcDaily(
      { date: "2026-07-01", clockIn: "09:00", clockOut: "18:00", breakMinutes: 60 },
      rules,
    );
    expect(r.error).toBeNull();
    expect(r.earlyMinutes).toBe(0);
    expect(r.normalMinutes).toBe(8 * 60);
    expect(r.overtimeMinutes).toBe(0);
    expect(r.totalMinutes).toBe(8 * 60);
    expect(r.roundedClockIn).toBe("09:00");
    expect(r.roundedClockOut).toBe("18:00");
  });

  it("残業あり 9:00〜19:29 → 残業は丸めて1時間、退勤時間は19:00", () => {
    const r = calcDaily(
      { date: "2026-07-01", clockIn: "09:00", clockOut: "19:29", breakMinutes: 60 },
      rules,
    );
    expect(r.overtimeRawMinutes).toBe(89);
    expect(r.overtimeMinutes).toBe(60);
    expect(r.roundedClockOut).toBe("19:00");
  });

  it("【例1】8:00〜18:05 → 早出1時間・割増あり、出勤時間は8:00（実早出60分がちょうど丸め単位）", () => {
    const r = calcDaily(
      { date: "2026-07-01", clockIn: "08:00", clockOut: "18:05", breakMinutes: 60 },
      rules,
    );
    expect(r.earlyRawMinutes).toBe(60);
    expect(r.earlyMinutes).toBe(60);
    expect(r.earlyPremiumApplies).toBe(true); // 18:00以降まで働いたので割増
    expect(r.normalMinutes).toBe(8 * 60);
    expect(r.overtimeMinutes).toBe(0); // 5分は30分未満切り捨て
    expect(r.roundedClockIn).toBe("08:00");
    expect(r.roundedClockOut).toBe("18:00"); // 5分は切り捨てられ実退勤どおりにはならない
  });

  it("【例2】8:00〜16:00 → 早出1時間・割増なし（通常時給）", () => {
    const r = calcDaily(
      { date: "2026-07-01", clockIn: "08:00", clockOut: "16:00", breakMinutes: 60 },
      rules,
    );
    expect(r.earlyMinutes).toBe(60);
    expect(r.earlyPremiumApplies).toBe(false); // 18:00より前に退勤したので割増なし
    expect(r.normalMinutes).toBe(6 * 60); // 9:00〜16:00 − 休憩60分
    expect(r.roundedClockOut).toBe("16:00"); // 残業なしなので実退勤のまま
  });

  it("実出勤8:19（41分早出）→ 30分単位で丸めて30分、出勤時間は8:30", () => {
    const r = calcDaily(
      { date: "2026-07-01", clockIn: "08:19", clockOut: "16:04", breakMinutes: 0 },
      rules,
    );
    expect(r.earlyRawMinutes).toBe(41);
    expect(r.earlyMinutes).toBe(30);
    expect(r.roundedClockIn).toBe("08:30");
  });

  it("退勤16:11（残業開始前）→ 30分単位で切り捨てて16:00", () => {
    const r = calcDaily(
      { date: "2026-07-01", clockIn: "09:00", clockOut: "16:11", breakMinutes: 60 },
      rules,
    );
    expect(r.roundedClockOut).toBe("16:00");
    // 9:00〜16:00 − 休憩60分 = 6時間
    expect(r.normalMinutes).toBe(6 * 60);
    expect(r.earlyPremiumApplies).toBe(false);
  });

  it("退勤16:32（残業開始前）→ 30分単位で切り捨てて16:30", () => {
    const r = calcDaily(
      { date: "2026-07-01", clockIn: "09:00", clockOut: "16:32", breakMinutes: 60 },
      rules,
    );
    expect(r.roundedClockOut).toBe("16:30");
    expect(r.normalMinutes).toBe(6 * 60 + 30);
  });

  it("ちょうど18:00退勤は割増あり", () => {
    const r = calcDaily(
      { date: "2026-07-01", clockIn: "08:00", clockOut: "18:00", breakMinutes: 60 },
      rules,
    );
    expect(r.earlyPremiumApplies).toBe(true);
  });

  it("早出計算対象開始（5:00）より前の勤務は集計しない", () => {
    const r = calcDaily(
      { date: "2026-07-01", clockIn: "04:00", clockOut: "18:00", breakMinutes: 60 },
      rules,
    );
    expect(r.earlyMinutes).toBe(4 * 60); // 5:00〜9:00 のみ
  });
});

describe("calcDaily 終業が早い会社（定時9:00〜16:00、16:00〜18:00は通常扱い）", () => {
  const earlyEndRules: WorkRuleSettings = { ...rules, workEnd: "16:00" };

  it("9:00〜18:00 休憩60分 → 終業後も残業開始までは通常勤務8時間・残業0", () => {
    const r = calcDaily(
      { date: "2026-01-15", clockIn: "09:00", clockOut: "18:00", breakMinutes: 60 },
      earlyEndRules,
    );
    expect(r.normalMinutes).toBe(8 * 60);
    expect(r.overtimeMinutes).toBe(0);
    expect(r.earlyLeaveMinutes).toBe(0);
  });

  it("9:00〜20:05 休憩60分 → 残業は18:00以降を丸めて2時間", () => {
    const r = calcDaily(
      { date: "2026-01-15", clockIn: "09:00", clockOut: "20:05", breakMinutes: 60 },
      earlyEndRules,
    );
    expect(r.overtimeRawMinutes).toBe(125);
    expect(r.overtimeMinutes).toBe(120);
  });
});

describe("calcDaily 実働8時間ルール（overtimeThresholdMinutes、既定480分）", () => {
  it("9:00〜19:00 休憩60分 → 実働9時間のため1時間残業", () => {
    const r = calcDaily(
      { date: "2026-07-01", clockIn: "09:00", clockOut: "19:00", breakMinutes: 60 },
      rules,
    );
    expect(r.normalMinutes).toBe(8 * 60);
    expect(r.overtimeMinutes).toBe(60);
    expect(r.totalMinutes).toBe(9 * 60);
  });

  it("11:00〜19:00 休憩60分 → 実働7時間のため残業なし（18:00以降勤務があっても通常勤務に繰り入れ）", () => {
    const r = calcDaily(
      { date: "2026-07-01", clockIn: "11:00", clockOut: "19:00", breakMinutes: 60 },
      rules,
    );
    expect(r.overtimeMinutes).toBe(0);
    expect(r.normalMinutes).toBe(7 * 60);
    expect(r.totalMinutes).toBe(7 * 60);
  });

  it("しきい値を0にすると従来どおり残業開始時刻以降を常に残業扱いにする", () => {
    const noThresholdRules = { ...rules, overtimeThresholdMinutes: 0 };
    const r = calcDaily(
      { date: "2026-07-01", clockIn: "11:00", clockOut: "19:00", breakMinutes: 60 },
      noThresholdRules,
    );
    expect(r.overtimeMinutes).toBe(60);
    expect(r.normalMinutes).toBe(6 * 60);
  });
});

describe("calcDaily 異常系", () => {
  it("退勤が出勤以前ならエラー", () => {
    const r = calcDaily(
      { date: "2026-07-01", clockIn: "18:00", clockOut: "08:00", breakMinutes: 0 },
      rules,
    );
    expect(r.error).not.toBeNull();
    expect(r.totalMinutes).toBe(0);
  });
  it("時刻形式が不正ならエラー", () => {
    const r = calcDaily(
      { date: "2026-07-01", clockIn: "abc", clockOut: "18:00", breakMinutes: 0 },
      rules,
    );
    expect(r.error).not.toBeNull();
  });

  it("未出勤（出勤が未入力）は未確定として扱い、未入力である旨を知らせる", () => {
    const r = calcDaily(
      { date: "2026-07-01", clockIn: null, clockOut: "18:00", breakMinutes: 0 },
      rules,
    );
    expect(r.error).toBe("出勤時刻が未入力です");
    expect(r.totalMinutes).toBe(0);
    expect(r.roundedClockIn).toBe("");
  });

  it("未退勤（退勤が未入力）は未確定として扱い、未入力である旨を知らせる", () => {
    const r = calcDaily(
      { date: "2026-07-01", clockIn: "09:00", clockOut: null, breakMinutes: 0 },
      rules,
    );
    expect(r.error).toBe("退勤時刻が未入力です");
    expect(r.totalMinutes).toBe(0);
    expect(r.roundedClockOut).toBe("");
  });
});

describe("calcDailyPay（時給1200円・割増25%、金額＝基本給／残業代＝割増分で二重計上なし）", () => {
  it("定時 9:00〜18:00 休憩60分 → 金額¥9,600・残業代¥0", () => {
    const calc = calcDaily(
      { date: "2026-07-01", clockIn: "09:00", clockOut: "18:00", breakMinutes: 60 },
      rules,
    );
    const pay = calcDailyPay(calc, 1200, rules);
    expect(pay.basePay).toBe(9600);
    expect(pay.premiumPay).toBe(0);
    expect(pay.totalPay).toBe(9600);
  });

  it("【例1】8:00〜18:05 → 早出1時間は残業代側で割増¥1,500、金額は通常8時間分¥9,600のみ（重複なし）", () => {
    const calc = calcDaily(
      { date: "2026-07-01", clockIn: "08:00", clockOut: "18:05", breakMinutes: 60 },
      rules,
    );
    const pay = calcDailyPay(calc, 1200, rules);
    expect(pay.basePay).toBe(9600); // 早出分は含まない
    expect(pay.premiumPay).toBe(1500); // 1h × 1200 × 1.25
    expect(pay.totalPay).toBe(9600 + 1500);
  });

  it("【例2】8:00〜16:00 → 早出1時間は通常時給として金額側に含まれ、残業代は¥0", () => {
    const calc = calcDaily(
      { date: "2026-07-01", clockIn: "08:00", clockOut: "16:00", breakMinutes: 60 },
      rules,
    );
    const pay = calcDailyPay(calc, 1200, rules);
    expect(pay.basePay).toBe(1200 + 6 * 1200); // 早出1h(通常時給)＋通常6h
    expect(pay.premiumPay).toBe(0);
    expect(pay.totalPay).toBe(1200 + 7200);
  });

  it("残業1時間30分 → 残業代 1.5h × 1200 × 1.25 = ¥2,250", () => {
    const calc = calcDaily(
      { date: "2026-07-01", clockIn: "09:00", clockOut: "19:30", breakMinutes: 60 },
      rules,
    );
    const pay = calcDailyPay(calc, 1200, rules);
    expect(pay.overtimePay).toBe(2250);
    expect(pay.premiumPay).toBe(2250);
  });

  it("basePay + premiumPay は常に totalPay と一致する（二重計上チェック）", () => {
    const cases = [
      { clockIn: "08:00", clockOut: "18:05" },
      { clockIn: "08:00", clockOut: "16:00" },
      { clockIn: "08:19", clockOut: "20:05" },
    ];
    for (const c of cases) {
      const calc = calcDaily({ date: "2026-07-01", ...c, breakMinutes: 60 }, rules);
      const pay = calcDailyPay(calc, 1200, rules);
      expect(pay.basePay + pay.premiumPay).toBe(pay.totalPay);
    }
  });

  it("時給0円・エラー行は全て0円", () => {
    const ok = calcDaily(
      { date: "2026-07-01", clockIn: "09:00", clockOut: "18:00", breakMinutes: 60 },
      rules,
    );
    expect(calcDailyPay(ok, 0, rules).totalPay).toBe(0);
    const err = calcDaily(
      { date: "2026-07-01", clockIn: "18:00", clockOut: "08:00", breakMinutes: 0 },
      rules,
    );
    expect(calcDailyPay(err, 1200, rules).totalPay).toBe(0);
  });
});

describe("summarize", () => {
  it("エラー行を除いて集計する", () => {
    const results = [
      calcDaily({ date: "2026-07-01", clockIn: "09:00", clockOut: "18:00", breakMinutes: 60 }, rules),
      calcDaily({ date: "2026-07-02", clockIn: "09:00", clockOut: "19:30", breakMinutes: 60 }, rules),
      calcDaily({ date: "2026-07-03", clockIn: "bad", clockOut: "18:00", breakMinutes: 0 }, rules),
    ];
    const s = summarize(results);
    expect(s.workDays).toBe(2);
    expect(s.normalMinutes).toBe(16 * 60);
    expect(s.overtimeMinutes).toBe(90);
  });
});

// ------------------------------------------------------------------
// 週単位管理（affect: 定時9:00〜16:00・金曜起算・木曜定休・所定36H/法定44H）
// ------------------------------------------------------------------

const weeklyRules: WorkRuleSettings = {
  ...DEFAULT_WORK_RULES,
  workStart: "09:00",
  workEnd: "16:00",
  weekly: {
    enabled: true,
    startDayOfWeek: 5, // 金
    closedDays: [4], // 木
    standardMinutes: 36 * 60,
    legalMinutes: 44 * 60,
    withinLegalPremiumRate: 0,
    overLegalPremiumRate: 0.25,
  },
};

/** 週次テスト用に「その日は clockIn〜clockOut・休憩60分」で計算した1日分を作る */
function day(date: string, clockIn: string, clockOut: string) {
  return {
    date,
    calc: calcDaily({ date, clockIn, clockOut, breakMinutes: 60 }, weeklyRules),
  };
}

describe("calcDaily 週単位モード（日単位では残業を判定しない）", () => {
  it("9:00〜16:00 休憩60分 → 実働6時間がすべて通常勤務", () => {
    const r = calcDaily(
      { date: "2026-08-26", clockIn: "09:00", clockOut: "16:00", breakMinutes: 60 },
      weeklyRules,
    );
    expect(r.normalMinutes).toBe(6 * 60);
    expect(r.overtimeMinutes).toBe(0);
    expect(r.earlyMinutes).toBe(0);
    expect(r.totalMinutes).toBe(6 * 60);
  });

  it("残業開始時刻(18:00)を超えて働いても日単位の残業は0のまま", () => {
    const r = calcDaily(
      { date: "2026-09-11", clockIn: "09:00", clockOut: "19:00", breakMinutes: 60 },
      weeklyRules,
    );
    expect(r.overtimeMinutes).toBe(0);
    expect(r.earlyPremiumApplies).toBe(false);
    expect(r.normalMinutes).toBe(9 * 60);
    expect(r.totalMinutes).toBe(9 * 60);
  });

  it("始業前の早出も区別せず労働時間に合算する", () => {
    const r = calcDaily(
      { date: "2026-09-11", clockIn: "08:00", clockOut: "16:00", breakMinutes: 60 },
      weeklyRules,
    );
    expect(r.earlyMinutes).toBe(0);
    expect(r.normalMinutes).toBe(7 * 60);
    expect(r.totalMinutes).toBe(7 * 60);
  });

  it("30分丸めは週次モードでも従来どおり適用する（8:47→9:00 / 19:07→19:00）", () => {
    const r = calcDaily(
      { date: "2026-09-12", clockIn: "08:47", clockOut: "19:07", breakMinutes: 60 },
      weeklyRules,
    );
    expect(r.roundedClockIn).toBe("09:00");
    expect(r.roundedClockOut).toBe("19:00");
    expect(r.totalMinutes).toBe(9 * 60);
  });

  it("遅刻・早退の判定は従来どおり実打刻と定時で行う", () => {
    const late = calcDaily(
      { date: "2026-09-22", clockIn: "09:12", clockOut: "16:00", breakMinutes: 60 },
      weeklyRules,
    );
    expect(late.lateMinutes).toBe(12);
    expect(late.totalMinutes).toBe(5 * 60 + 48);
  });
});

describe("calcWeekly（36H超44H以内 / 44H超の区分）", () => {
  const period = { start: "2026-08-26", end: "2026-09-25" };

  it("6H×6日=36:00 はすべて所定内", () => {
    const days = ["2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]
      .map((d) => day(d, "09:00", "16:00"));
    const week = calcWeekly(days, period, weeklyRules).find((w) => w.start === "2026-08-28")!;
    expect(week.workDays).toBe(6);
    expect(week.totalMinutes).toBe(36 * 60);
    expect(week.standardMinutes).toBe(36 * 60);
    expect(week.withinLegalOvertimeMinutes).toBe(0);
    expect(week.overLegalOvertimeMinutes).toBe(0);
  });

  it("ちょうど44:00 の週は 36H超44H以内が8時間・44H超は0（境界）", () => {
    const days = [
      day("2026-09-04", "09:00", "18:00"), // 8:00
      day("2026-09-05", "09:00", "18:00"), // 8:00
      day("2026-09-06", "09:00", "16:00"), // 6:00
      day("2026-09-07", "09:00", "18:00"), // 8:00
      day("2026-09-08", "09:00", "18:00"), // 8:00
      day("2026-09-09", "09:00", "16:00"), // 6:00
    ];
    const week = calcWeekly(days, period, weeklyRules).find((w) => w.start === "2026-09-04")!;
    expect(week.totalMinutes).toBe(44 * 60);
    expect(week.standardMinutes).toBe(36 * 60);
    expect(week.withinLegalOvertimeMinutes).toBe(8 * 60);
    expect(week.overLegalOvertimeMinutes).toBe(0);
  });

  it("9H×6日=54:00 は 36H + 8H(36-44帯) + 10H(44H超) に割れる", () => {
    const days = ["2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16"]
      .map((d) => day(d, "09:00", "19:00"));
    const week = calcWeekly(days, period, weeklyRules).find((w) => w.start === "2026-09-11")!;
    expect(week.totalMinutes).toBe(54 * 60);
    expect(week.standardMinutes).toBe(36 * 60);
    expect(week.withinLegalOvertimeMinutes).toBe(8 * 60);
    expect(week.overLegalOvertimeMinutes).toBe(10 * 60);
  });

  it("端数週はしきい値を按分せずそのまま適用する（1日6:00は全て所定内）", () => {
    const weeks = calcWeekly([day("2026-08-26", "09:00", "16:00")], period, weeklyRules);
    const first = weeks[0];
    expect(first.isPartial).toBe(true);
    expect(first.workDays).toBe(1);
    expect(first.totalMinutes).toBe(6 * 60);
    expect(first.standardMinutes).toBe(6 * 60);
    expect(first.withinLegalOvertimeMinutes).toBe(0);
  });

  it("表示ラベルは勤務実績のある日でトリムする（木曜が定休なら水曜まで）", () => {
    const days = ["2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]
      .map((d) => day(d, "09:00", "16:00"));
    const week = calcWeekly(days, period, weeklyRules).find((w) => w.start === "2026-08-28")!;
    expect(week.end).toBe("2026-09-03"); // 区間は木曜まで
    expect(week.labelStart).toBe("2026-08-28");
    expect(week.labelEnd).toBe("2026-09-02"); // ラベルは水曜まで
  });

  it("定休日（木）に勤務があればラベルが木曜まで伸び、労働時間にも合算される", () => {
    const days = [
      day("2026-09-18", "09:00", "16:00"),
      day("2026-09-19", "09:00", "16:00"),
      day("2026-09-21", "09:00", "16:00"),
      day("2026-09-22", "09:12", "16:00"), // 遅刻12分 → 5:48
      day("2026-09-23", "09:00", "16:00"),
      day("2026-09-24", "09:00", "16:00"), // 木曜（定休日）に出勤
    ];
    const week = calcWeekly(days, period, weeklyRules).find((w) => w.start === "2026-09-18")!;
    expect(week.labelEnd).toBe("2026-09-24");
    expect(week.closedDayWorkDates).toEqual(["2026-09-24"]);
    expect(week.workDays).toBe(6);
    expect(week.totalMinutes).toBe(35 * 60 + 48);
  });

  it("勤務のない週も区間として残り、すべて0になる", () => {
    const weeks = calcWeekly([], period, weeklyRules);
    expect(weeks).toHaveLength(6);
    for (const w of weeks) {
      expect(w.workDays).toBe(0);
      expect(w.totalMinutes).toBe(0);
      expect(w.labelStart).toBe(w.start);
      expect(w.labelEnd).toBe(w.end);
    }
  });

  it("所定内 + 36H超44H以内 + 44H超 は必ず週合計と一致する（不変条件）", () => {
    const patterns: [string, string][] = [
      ["09:00", "16:00"], // 6:00
      ["09:00", "18:00"], // 8:00
      ["09:00", "19:00"], // 9:00
      ["09:00", "21:00"], // 11:00
    ];
    for (const [clockIn, clockOut] of patterns) {
      const days = [
        "2026-09-11",
        "2026-09-12",
        "2026-09-13",
        "2026-09-14",
        "2026-09-15",
        "2026-09-16",
      ].map((d) => day(d, clockIn, clockOut));
      for (const w of calcWeekly(days, period, weeklyRules)) {
        expect(
          w.standardMinutes + w.withinLegalOvertimeMinutes + w.overLegalOvertimeMinutes,
        ).toBe(w.totalMinutes);
      }
    }
  });
});

describe("summarizeWeeks / calcWeeklyPay（2026年9月度の通し計算）", () => {
  const period = { start: "2026-08-26", end: "2026-09-25" };
  // UIモック（docs/affect-weekly-mock.html）と同じ打刻データ
  const days = [
    day("2026-08-26", "09:00", "16:00"),
    day("2026-08-28", "09:00", "16:00"),
    day("2026-08-29", "09:00", "16:00"),
    day("2026-08-30", "09:00", "16:00"),
    day("2026-08-31", "09:00", "15:30"), // 早退30分 → 5:30
    day("2026-09-01", "09:00", "16:00"),
    day("2026-09-02", "09:00", "16:00"),
    day("2026-09-04", "09:00", "18:00"),
    day("2026-09-05", "09:00", "18:00"),
    day("2026-09-06", "09:00", "16:00"),
    day("2026-09-07", "09:00", "18:00"),
    day("2026-09-08", "09:00", "18:00"),
    day("2026-09-09", "09:00", "16:00"),
    day("2026-09-11", "09:00", "19:00"),
    day("2026-09-12", "08:47", "19:07"), // 丸めて 9:00〜19:00
    day("2026-09-13", "09:00", "19:00"),
    day("2026-09-14", "09:00", "19:00"),
    day("2026-09-15", "09:00", "19:00"),
    day("2026-09-16", "09:00", "19:00"),
    day("2026-09-18", "09:00", "16:00"),
    day("2026-09-19", "09:00", "16:00"),
    day("2026-09-21", "09:00", "16:00"),
    day("2026-09-22", "09:12", "16:00"), // 遅刻12分 → 5:48
    day("2026-09-23", "09:00", "16:00"),
    day("2026-09-24", "09:00", "16:00"), // 定休日出勤
    day("2026-09-25", "09:00", "16:00"),
  ];

  const weeks = calcWeekly(days, period, weeklyRules);
  const totals = summarizeWeeks(weeks);

  it("週ごとの合計がモックの値と一致する", () => {
    expect(weeks.map((w) => w.totalMinutes)).toEqual([
      6 * 60,
      35 * 60 + 30,
      44 * 60,
      54 * 60,
      35 * 60 + 48,
      6 * 60,
    ]);
    expect(weeks.map((w) => w.workDays)).toEqual([1, 6, 6, 6, 6, 1]);
  });

  it("月度合計は 26日 / 181:18、内訳は 所定内155:18・36-44H 16:00・44H超 10:00", () => {
    expect(weeks.reduce((sum, w) => sum + w.workDays, 0)).toBe(26);
    expect(totals.totalMinutes).toBe(181 * 60 + 18);
    expect(totals.standardMinutes).toBe(155 * 60 + 18);
    expect(totals.withinLegalOvertimeMinutes).toBe(16 * 60);
    expect(totals.overLegalOvertimeMinutes).toBe(10 * 60);
    expect(totals.closedDayWorkCount).toBe(1);
  });

  it("月度合計でも 所定内 + 36-44H + 44H超 = 総労働時間", () => {
    expect(
      totals.standardMinutes +
        totals.withinLegalOvertimeMinutes +
        totals.overLegalOvertimeMinutes,
    ).toBe(totals.totalMinutes);
  });

  it("割増は 36-44H帯が0%・44H超が25% なので 44H超10時間分のみ発生する", () => {
    const pay = calcWeeklyPay(totals, 1200, weeklyRules);
    expect(pay.withinLegalPay).toBe(0);
    expect(pay.overLegalPay).toBe(10 * 1200 * 0.25);
    expect(pay.premiumPay).toBe(3000);
  });

  it("日次は基本給のみになるため、週の割増と足しても二重計上にならない", () => {
    const basePay = days.reduce((sum, d) => sum + calcDailyPay(d.calc, 1200, weeklyRules).basePay, 0);
    const premium = calcWeeklyPay(totals, 1200, weeklyRules).premiumPay;
    // 基本給は総労働時間ぶん、割増は44H超に対する上乗せぶんのみ
    expect(basePay).toBe(Math.round((181 * 60 + 18) * (1200 / 60)));
    expect(basePay + premium).toBe(basePay + 3000);
  });
});

describe("遅刻・早退の自動判定（実打刻基準）", () => {
  it("始業ちょうど・終業ちょうどは遅刻・早退なし", () => {
    const r = calcDaily(
      { date: "2026-07-01", clockIn: "09:00", clockOut: "18:00", breakMinutes: 60 },
      rules,
    );
    expect(r.lateMinutes).toBe(0);
    expect(r.earlyLeaveMinutes).toBe(0);
  });

  it("9:12出勤 → 遅刻12分（丸めの影響を受けない）", () => {
    const r = calcDaily(
      { date: "2026-07-01", clockIn: "09:12", clockOut: "18:00", breakMinutes: 60 },
      rules,
    );
    expect(r.lateMinutes).toBe(12);
    expect(r.earlyLeaveMinutes).toBe(0);
  });

  it("早出（始業前打刻）は遅刻にならない", () => {
    const r = calcDaily(
      { date: "2026-07-01", clockIn: "08:19", clockOut: "18:00", breakMinutes: 60 },
      rules,
    );
    expect(r.lateMinutes).toBe(0);
  });

  it("夏季17:30退勤 → 早退30分（終業18:00基準）", () => {
    const r = calcDaily(
      { date: "2026-07-01", clockIn: "09:00", clockOut: "17:30", breakMinutes: 60 },
      rules,
    );
    expect(r.earlyLeaveMinutes).toBe(30);
  });

  it("終業16:00の会社なら15:00退勤で早退60分、16:30退勤は早退なし", () => {
    const earlyEndRules: WorkRuleSettings = { ...rules, workEnd: "16:00" };
    const early = calcDaily(
      { date: "2026-12-01", clockIn: "09:00", clockOut: "15:00", breakMinutes: 60 },
      earlyEndRules,
    );
    expect(early.earlyLeaveMinutes).toBe(60);
    const onTime = calcDaily(
      { date: "2026-12-01", clockIn: "09:00", clockOut: "16:30", breakMinutes: 60 },
      earlyEndRules,
    );
    expect(onTime.earlyLeaveMinutes).toBe(0);
  });

  it("summarize が遅刻・早退の回数と時間を集計する", () => {
    const results = [
      calcDaily({ date: "2026-07-01", clockIn: "09:12", clockOut: "18:00", breakMinutes: 60 }, rules),
      calcDaily({ date: "2026-07-02", clockIn: "09:30", clockOut: "17:00", breakMinutes: 60 }, rules),
      calcDaily({ date: "2026-07-03", clockIn: "09:00", clockOut: "18:00", breakMinutes: 60 }, rules),
    ];
    const s = summarize(results);
    expect(s.lateCount).toBe(2);
    expect(s.lateMinutes).toBe(42);
    expect(s.earlyLeaveCount).toBe(1);
    expect(s.earlyLeaveMinutes).toBe(60);
  });
});
