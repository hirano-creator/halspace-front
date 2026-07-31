import { describe, expect, it } from "vitest";
import {
  datesInRange,
  dayOfWeek,
  formatDateWithWeekday,
  normalizeDate,
  periodOfDate,
  periodRange,
  timeToMinutes,
  weeksInPeriod,
} from "./time";

describe("timeToMinutes", () => {
  it("HH:mm 形式", () => {
    expect(timeToMinutes("08:00")).toBe(480);
    expect(timeToMinutes("8:00")).toBe(480);
    expect(timeToMinutes("18:30")).toBe(1110);
  });
  it("Squareエクスポート形式（秒・タイムゾーン付き）", () => {
    expect(timeToMinutes("8:19:25 JST")).toBe(8 * 60 + 19);
    expect(timeToMinutes("16:04:51 JST")).toBe(16 * 60 + 4);
  });
  it("不正な形式は null", () => {
    expect(timeToMinutes("abc")).toBeNull();
    expect(timeToMinutes("8:99")).toBeNull();
    expect(timeToMinutes("")).toBeNull();
  });
});

describe("normalizeDate", () => {
  it("各種形式を YYYY-MM-DD に正規化", () => {
    expect(normalizeDate("2026/05/26")).toBe("2026-05-26");
    expect(normalizeDate("2026-5-6")).toBe("2026-05-06");
    expect(normalizeDate("20260526")).toBe("2026-05-26");
  });
  it("不正な形式は null", () => {
    expect(normalizeDate("26/05/2026")).toBeNull();
    expect(normalizeDate("2026/13/01")).toBeNull();
  });
});

describe("periodRange（締め日25日）", () => {
  it("6月度 = 5/26〜6/25", () => {
    expect(periodRange("2026-06", 25)).toEqual({ start: "2026-05-26", end: "2026-06-25" });
  });
  it("1月度 = 前年12/26〜1/25（年跨ぎ）", () => {
    expect(periodRange("2026-01", 25)).toEqual({ start: "2025-12-26", end: "2026-01-25" });
  });
  it("3月度 = 2/26〜3/25（2月の日数に依存しない）", () => {
    expect(periodRange("2026-03", 25)).toEqual({ start: "2026-02-26", end: "2026-03-25" });
  });
  it("締め日31 = 暦月（1日〜末日）", () => {
    expect(periodRange("2026-07", 31)).toEqual({ start: "2026-07-01", end: "2026-07-31" });
    expect(periodRange("2026-02", 31)).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });
});

describe("periodOfDate（締め日25日）", () => {
  it("締め日以前は当月度", () => {
    expect(periodOfDate("2026-07-12", 25)).toBe("2026-07");
    expect(periodOfDate("2026-07-25", 25)).toBe("2026-07");
  });
  it("締め日の翌日以降は翌月度", () => {
    expect(periodOfDate("2026-07-26", 25)).toBe("2026-08");
    expect(periodOfDate("2026-12-26", 25)).toBe("2027-01");
  });
});

describe("datesInRange", () => {
  it("月を跨いで列挙する", () => {
    const dates = datesInRange("2026-05-26", "2026-06-25");
    expect(dates.length).toBe(31);
    expect(dates[0]).toBe("2026-05-26");
    expect(dates[dates.length - 1]).toBe("2026-06-25");
  });
});

describe("dayOfWeek / formatDateWithWeekday", () => {
  it("曜日を数値と表示名で返す", () => {
    expect(dayOfWeek("2026-08-26")).toBe(3); // 水
    expect(dayOfWeek("2026-08-28")).toBe(5); // 金
    expect(formatDateWithWeekday("2026-08-28")).toBe("8/28（金）");
    expect(formatDateWithWeekday("2026-09-03")).toBe("9/3（木）");
  });
});

describe("weeksInPeriod（金曜起算 = 5）", () => {
  const FRI = 5;

  it("2026年9月度（8/26〜9/25）は 8/26単独の端数週で始まり 9/25の端数週で終わる", () => {
    const weeks = weeksInPeriod("2026-08-26", "2026-09-25", FRI);
    expect(weeks).toEqual([
      { start: "2026-08-26", end: "2026-08-27", isPartial: true },
      { start: "2026-08-28", end: "2026-09-03", isPartial: false },
      { start: "2026-09-04", end: "2026-09-10", isPartial: false },
      { start: "2026-09-11", end: "2026-09-17", isPartial: false },
      { start: "2026-09-18", end: "2026-09-24", isPartial: false },
      { start: "2026-09-25", end: "2026-09-25", isPartial: true },
    ]);
  });

  it("開始日が起算曜日ちょうどなら先頭は端数週にならない", () => {
    const weeks = weeksInPeriod("2026-08-28", "2026-09-10", FRI);
    expect(weeks).toEqual([
      { start: "2026-08-28", end: "2026-09-03", isPartial: false },
      { start: "2026-09-04", end: "2026-09-10", isPartial: false },
    ]);
  });

  it("1日だけの期間も1つの端数週になる", () => {
    expect(weeksInPeriod("2026-09-25", "2026-09-25", FRI)).toEqual([
      { start: "2026-09-25", end: "2026-09-25", isPartial: true },
    ]);
  });

  it("起算曜日を変えると区切り位置が変わる（日曜起算）", () => {
    const weeks = weeksInPeriod("2026-08-26", "2026-09-10", 0);
    expect(weeks[0]).toEqual({ start: "2026-08-26", end: "2026-08-29", isPartial: true });
    expect(weeks[1]).toEqual({ start: "2026-08-30", end: "2026-09-05", isPartial: false });
  });
});
