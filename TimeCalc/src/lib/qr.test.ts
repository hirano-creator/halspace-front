import { describe, expect, it, beforeAll } from "vitest";
import { buildClockUrl, buildKioskUrl, dailyQrToken, generateKioskKey } from "./qr";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-for-qr-token";
});

describe("dailyQrToken", () => {
  it("同じ部署・同じ日付なら同じトークンになる", () => {
    const a = dailyQrToken("dept-1", "2026-07-16");
    const b = dailyQrToken("dept-1", "2026-07-16");
    expect(a).toBe(b);
  });

  it("日付が変わるとトークンも変わる", () => {
    const a = dailyQrToken("dept-1", "2026-07-16");
    const b = dailyQrToken("dept-1", "2026-07-17");
    expect(a).not.toBe(b);
  });

  it("部署が違うとトークンも変わる", () => {
    const a = dailyQrToken("dept-1", "2026-07-16");
    const b = dailyQrToken("dept-2", "2026-07-16");
    expect(a).not.toBe(b);
  });
});

describe("buildClockUrl", () => {
  it("tokenなしなら?dept=のみ", () => {
    expect(buildClockUrl("https://example.com", "dept-1")).toBe(
      "https://example.com/clock?dept=dept-1",
    );
  });

  it("tokenありなら&token=も付く", () => {
    expect(buildClockUrl("https://example.com", "dept-1", "abc123")).toBe(
      "https://example.com/clock?dept=dept-1&token=abc123",
    );
  });
});

describe("generateKioskKey", () => {
  it("32文字のhex文字列を生成する", () => {
    expect(generateKioskKey()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("2回呼ぶと異なる値になる", () => {
    const a = generateKioskKey();
    const b = generateKioskKey();
    expect(a).not.toBe(b);
  });
});

describe("buildKioskUrl", () => {
  it("baseUrlとkeyからURLを組み立てる", () => {
    expect(buildKioskUrl("https://example.com", "a".repeat(32))).toBe(
      `https://example.com/qr/${"a".repeat(32)}`,
    );
  });

  it("baseUrlの末尾スラッシュを除去する", () => {
    expect(buildKioskUrl("https://example.com/", "a".repeat(32))).toBe(
      `https://example.com/qr/${"a".repeat(32)}`,
    );
  });
});
