import { describe, expect, it } from "vitest";
import { calcDaily, calcDailyPay, roundOvertime, seasonOf, summarize } from "./calculator";
import { DEFAULT_WORK_RULES } from "./types";

const rules = DEFAULT_WORK_RULES;

describe("seasonOf", () => {
  it("4月〜10月は夏季", () => {
    expect(seasonOf("2026-04-01", rules)).toBe("summer");
    expect(seasonOf("2026-07-15", rules)).toBe("summer");
    expect(seasonOf("2026-10-31", rules)).toBe("summer");
  });
  it("11月〜3月は冬季（年跨ぎ）", () => {
    expect(seasonOf("2026-11-01", rules)).toBe("winter");
    expect(seasonOf("2026-01-15", rules)).toBe("winter");
    expect(seasonOf("2026-03-31", rules)).toBe("winter");
  });
});

describe("roundOvertime（30分単位切り捨て）", () => {
  it("89分 → 60分", () => expect(roundOvertime(89, 30)).toBe(60));
  it("90分 → 90分", () => expect(roundOvertime(90, 30)).toBe(90));
  it("125分 → 120分", () => expect(roundOvertime(125, 30)).toBe(120));
  it("150分 → 150分", () => expect(roundOvertime(150, 30)).toBe(150));
  it("179分 → 150分", () => expect(roundOvertime(179, 30)).toBe(150));
  it("30分未満は0", () => expect(roundOvertime(29, 30)).toBe(0));
});

describe("calcDaily 夏季（定時9:00〜18:00、18:00以降残業）", () => {
  it("定時勤務 9:00〜18:00 休憩60分 → 通常8時間・早出/残業なし", () => {
    const r = calcDaily(
      { date: "2026-07-01", clockIn: "09:00", clockOut: "18:00", breakMinutes: 60 },
      rules,
    );
    expect(r.error).toBeNull();
    expect(r.season).toBe("summer");
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

describe("calcDaily 冬季（定時9:00〜16:00、16:00〜18:00は通常扱い）", () => {
  it("9:00〜18:00 休憩60分 → 全て通常勤務8時間・残業0", () => {
    const r = calcDaily(
      { date: "2026-01-15", clockIn: "09:00", clockOut: "18:00", breakMinutes: 60 },
      rules,
    );
    expect(r.season).toBe("winter");
    expect(r.normalMinutes).toBe(8 * 60);
    expect(r.overtimeMinutes).toBe(0);
  });

  it("9:00〜20:05 休憩60分 → 残業は18:00以降を丸めて2時間", () => {
    const r = calcDaily(
      { date: "2026-01-15", clockIn: "09:00", clockOut: "20:05", breakMinutes: 60 },
      rules,
    );
    expect(r.overtimeRawMinutes).toBe(125);
    expect(r.overtimeMinutes).toBe(120);
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
