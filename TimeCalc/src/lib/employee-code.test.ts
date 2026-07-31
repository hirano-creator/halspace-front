import { describe, expect, it } from "vitest";
import {
  DEFAULT_CODE_RULE,
  formatEmployeeCode,
  normalizeCodeRule,
  sequenceOfCode,
} from "./employee-code";

describe("normalizeCodeRule", () => {
  it("接頭辞の前後空白を落とす", () => {
    expect(normalizeCodeRule("  A ", 4)).toEqual({ prefix: "A", digits: 4 });
  });
  it("接頭辞なし・桁数未設定は既定（4桁）にする", () => {
    expect(normalizeCodeRule(null, null)).toEqual(DEFAULT_CODE_RULE);
  });
  it("範囲外の桁数は既定に寄せる", () => {
    expect(normalizeCodeRule("A", 0).digits).toBe(4);
    expect(normalizeCodeRule("A", 99).digits).toBe(4);
    expect(normalizeCodeRule("A", 2.5).digits).toBe(4);
  });
});

describe("formatEmployeeCode", () => {
  it("接頭辞＋ゼロ埋めした連番になる", () => {
    expect(formatEmployeeCode({ prefix: "A", digits: 4 }, 1)).toBe("A0001");
    expect(formatEmployeeCode({ prefix: "H", digits: 4 }, 14)).toBe("H0014");
    expect(formatEmployeeCode({ prefix: "", digits: 4 }, 1)).toBe("0001");
  });
  it("桁数を超える連番はそのまま伸ばす（採番を止めない）", () => {
    expect(formatEmployeeCode({ prefix: "A", digits: 4 }, 12345)).toBe("A12345");
  });
});

describe("sequenceOfCode", () => {
  const rule = { prefix: "A", digits: 4 };

  it("接頭辞が一致する番号から連番を取り出す", () => {
    expect(sequenceOfCode(rule, "A0001")).toBe(1);
    expect(sequenceOfCode(rule, "A0042")).toBe(42);
  });
  it("接頭辞が違う番号は対象外", () => {
    expect(sequenceOfCode(rule, "H0001")).toBeNull();
    expect(sequenceOfCode(rule, "0001")).toBeNull();
  });
  it("体系外の番号（数字以外が混ざる）は対象外にして採番を壊さない", () => {
    expect(sequenceOfCode(rule, "A00X1")).toBeNull();
    expect(sequenceOfCode(rule, "A")).toBeNull();
  });
  it("接頭辞なしのルールでは数字だけの番号を拾う", () => {
    expect(sequenceOfCode(DEFAULT_CODE_RULE, "0004")).toBe(4);
    expect(sequenceOfCode(DEFAULT_CODE_RULE, "A0001")).toBeNull();
  });
});
