import { describe, expect, it } from "vitest";
import {
  deriveDailyFromEvents,
  fixedBreakMinutesOf,
  outingIntervalsFromEvents,
  splitOutingMinutes,
} from "./clock";

describe("deriveDailyFromEvents", () => {
  it("イベント0件は empty", () => {
    expect(deriveDailyFromEvents([])).toEqual({ status: "empty" });
  });

  it("出勤のみ（未退勤）は open", () => {
    const r = deriveDailyFromEvents([{ type: "IN", time: "09:00" }]);
    expect(r).toEqual({ status: "open", clockInSoFar: "09:00", phase: "working" });
  });

  it("出退勤1回のみ（中抜けなし） → breakMinutes 0", () => {
    const r = deriveDailyFromEvents([
      { type: "IN", time: "09:00" },
      { type: "OUT", time: "18:00" },
    ]);
    expect(r).toEqual({
      status: "closed",
      clockIn: "09:00",
      clockOut: "18:00",
      breakMinutes: 0,
    });
  });

  it("中抜け1回 → 空白時間がbreakMinutesに合算される", () => {
    // 9:00〜12:00, 13:00〜18:00 → 勤務枠9:00-18:00(540分), 実働 180+300=480分, 中抜け60分
    const r = deriveDailyFromEvents([
      { type: "IN", time: "09:00" },
      { type: "OUT", time: "12:00" },
      { type: "IN", time: "13:00" },
      { type: "OUT", time: "18:00" },
    ]);
    expect(r).toEqual({
      status: "closed",
      clockIn: "09:00",
      clockOut: "18:00",
      breakMinutes: 60,
    });
  });

  it("中抜け複数回 → すべて合算される", () => {
    // 9:00-12:00, 13:00-15:00, 15:30-18:00 → 勤務枠540分, 実働180+120+150=450分, 中抜け90分
    const r = deriveDailyFromEvents([
      { type: "IN", time: "09:00" },
      { type: "OUT", time: "12:00" },
      { type: "IN", time: "13:00" },
      { type: "OUT", time: "15:00" },
      { type: "IN", time: "15:30" },
      { type: "OUT", time: "18:00" },
    ]);
    expect(r).toEqual({
      status: "closed",
      clockIn: "09:00",
      clockOut: "18:00",
      breakMinutes: 90,
    });
  });

  it("多重タップ耐性: 出勤中に再度「出勤」を送っても無視される", () => {
    const r = deriveDailyFromEvents([
      { type: "IN", time: "09:00" },
      { type: "IN", time: "09:01" }, // 誤タップ・通信リトライ想定、無視される
      { type: "OUT", time: "18:00" },
    ]);
    expect(r).toEqual({
      status: "closed",
      clockIn: "09:00",
      clockOut: "18:00",
      breakMinutes: 0,
    });
  });

  it("多重タップ耐性: 退勤直後に再度「退勤」を送っても無視され、次のINから再開する", () => {
    const r = deriveDailyFromEvents([
      { type: "IN", time: "09:00" },
      { type: "OUT", time: "12:00" },
      { type: "OUT", time: "12:01" }, // 誤タップ、無視される
      { type: "IN", time: "13:00" },
      { type: "OUT", time: "18:00" },
    ]);
    expect(r).toEqual({
      status: "closed",
      clockIn: "09:00",
      clockOut: "18:00",
      breakMinutes: 60,
    });
  });

  it("外出〜戻りの時間は breakMinutes に合算される", () => {
    // 9:00-12:00, 外出12:00-13:30, 13:30-18:00 → 実働 180+270=450分, 外出90分
    const r = deriveDailyFromEvents([
      { type: "IN", time: "09:00" },
      { type: "OUT_START", time: "12:00" },
      { type: "OUT_END", time: "13:30" },
      { type: "OUT", time: "18:00" },
    ]);
    expect(r).toEqual({
      status: "closed",
      clockIn: "09:00",
      clockOut: "18:00",
      breakMinutes: 90,
    });
  });

  it("外出と中抜け（退勤→再出勤）の混在も合算される", () => {
    // 9:00-11:00, 外出11:00-11:30, 11:30-12:00, 退勤→13:00再出勤, 13:00-18:00
    const r = deriveDailyFromEvents([
      { type: "IN", time: "09:00" },
      { type: "OUT_START", time: "11:00" },
      { type: "OUT_END", time: "11:30" },
      { type: "OUT", time: "12:00" },
      { type: "IN", time: "13:00" },
      { type: "OUT", time: "18:00" },
    ]);
    expect(r).toEqual({
      status: "closed",
      clockIn: "09:00",
      clockOut: "18:00",
      breakMinutes: 90,
    });
  });

  it("外出中は open（外出フェーズ）として書き戻し対象にしない", () => {
    const r = deriveDailyFromEvents([
      { type: "IN", time: "09:00" },
      { type: "OUT_START", time: "12:00" },
    ]);
    expect(r).toEqual({ status: "open", clockInSoFar: "09:00", phase: "outing" });
  });

  it("外出したまま退勤 → 勤務終了は外出時刻で確定し、外出時間は含めない", () => {
    const r = deriveDailyFromEvents([
      { type: "IN", time: "09:00" },
      { type: "OUT_START", time: "17:00" },
      { type: "OUT", time: "17:45" }, // 外出先からそのまま退勤
    ]);
    expect(r).toEqual({
      status: "closed",
      clockIn: "09:00",
      clockOut: "17:00",
      breakMinutes: 0,
    });
  });

  it("出勤前の外出・退勤は無視され、戻りは勤務開始として扱う（前日からの外出戻り対応）", () => {
    // 先頭の外出は無視。戻り08:30は「前日外出したまま日をまたいだ復帰」とみなし勤務開始
    const r = deriveDailyFromEvents([
      { type: "OUT_START", time: "08:00" },
      { type: "OUT_END", time: "08:30" },
      { type: "OUT", time: "08:40" },
    ]);
    expect(r).toEqual({
      status: "closed",
      clockIn: "08:30",
      clockOut: "08:40",
      breakMinutes: 0,
    });
  });

  it("退勤のみの日は empty（出勤なしでは何も確定しない）", () => {
    expect(deriveDailyFromEvents([{ type: "OUT", time: "18:00" }])).toEqual({ status: "empty" });
  });

  it("多重タップ耐性: 外出中の再「外出」・勤務中の「戻り」は無視される", () => {
    const r = deriveDailyFromEvents([
      { type: "IN", time: "09:00" },
      { type: "OUT_END", time: "09:30" }, // 勤務中の戻り → 無視
      { type: "OUT_START", time: "12:00" },
      { type: "OUT_START", time: "12:01" }, // 外出中の再外出 → 無視
      { type: "OUT_END", time: "13:00" },
      { type: "OUT", time: "18:00" },
    ]);
    expect(r).toEqual({
      status: "closed",
      clockIn: "09:00",
      clockOut: "18:00",
      breakMinutes: 60,
    });
  });
});

describe("fixedBreakMinutesOf", () => {
  it("休憩開始・終了から分数を算出する", () => {
    expect(fixedBreakMinutesOf({ breakStart: "12:00", breakEnd: "13:00" })).toBe(60);
  });
});

describe("outingIntervalsFromEvents", () => {
  it("外出したまま退勤した区間は含めない", () => {
    const intervals = outingIntervalsFromEvents([
      { type: "IN", time: "09:00" },
      { type: "OUT_START", time: "17:00" },
      { type: "OUT", time: "17:45" },
    ]);
    expect(intervals).toEqual([]);
  });

  it("複数回の外出をすべて返す", () => {
    const intervals = outingIntervalsFromEvents([
      { type: "IN", time: "09:00" },
      { type: "OUT_START", time: "11:00" },
      { type: "OUT_END", time: "13:50" },
      { type: "OUT_START", time: "15:00" },
      { type: "OUT_END", time: "15:30" },
      { type: "OUT", time: "18:00" },
    ]);
    expect(intervals).toEqual([
      { start: "11:00", end: "13:50" },
      { start: "15:00", end: "15:30" },
    ]);
  });
});

describe("splitOutingMinutes（外出時間と休憩時間帯の重複除去）", () => {
  it("外出が休憩時間帯を完全に内包する → 実外出時間はそのまま、控除対象は休憩重複分を除く", () => {
    // 実外出2時間50分（11:00-13:50）、休憩12:00-13:00と60分重なる → 控除対象1時間50分
    const { actualMinutes, deductibleMinutes } = splitOutingMinutes(
      [{ start: "11:00", end: "13:50" }],
      "12:00",
      "13:00",
    );
    expect(actualMinutes).toBe(170);
    expect(deductibleMinutes).toBe(110);
  });

  it("外出が休憩時間帯と重ならない → 実外出時間と控除対象は同じ", () => {
    const { actualMinutes, deductibleMinutes } = splitOutingMinutes(
      [{ start: "15:00", end: "16:00" }],
      "12:00",
      "13:00",
    );
    expect(actualMinutes).toBe(60);
    expect(deductibleMinutes).toBe(60);
  });

  it("外出が休憩時間帯に完全に収まる → 控除対象は0", () => {
    const { actualMinutes, deductibleMinutes } = splitOutingMinutes(
      [{ start: "12:15", end: "12:45" }],
      "12:00",
      "13:00",
    );
    expect(actualMinutes).toBe(30);
    expect(deductibleMinutes).toBe(0);
  });

  it("複数回の外出それぞれの重複を合算する", () => {
    // 11:30-12:15（休憩と15分重複）, 12:45-13:15（休憩と15分重複）→ 重複合計30分
    const { actualMinutes, deductibleMinutes } = splitOutingMinutes(
      [
        { start: "11:30", end: "12:15" },
        { start: "12:45", end: "13:15" },
      ],
      "12:00",
      "13:00",
    );
    expect(actualMinutes).toBe(75);
    expect(deductibleMinutes).toBe(45);
  });
});
