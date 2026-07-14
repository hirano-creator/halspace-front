import { describe, expect, it } from "vitest";
import {
  datesInRange,
  isInMonthDayRange,
  normalizeDate,
  periodOfDate,
  periodRange,
  timeToMinutes,
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

describe("isInMonthDayRange", () => {
  it("通常の範囲", () => {
    expect(isInMonthDayRange("2026-07-01", "04-01", "10-31")).toBe(true);
    expect(isInMonthDayRange("2026-11-15", "04-01", "10-31")).toBe(false);
  });
  it("年跨ぎの範囲", () => {
    expect(isInMonthDayRange("2026-01-15", "11-01", "03-31")).toBe(true);
    expect(isInMonthDayRange("2026-07-01", "11-01", "03-31")).toBe(false);
  });
});
