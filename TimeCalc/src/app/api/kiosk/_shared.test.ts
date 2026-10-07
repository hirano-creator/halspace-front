import { describe, expect, it } from "vitest";
import type { ClockStatus } from "@/lib/attendance/clock-service";
import { allowedTypesOf } from "./_shared";

function status(flags: Partial<ClockStatus>): ClockStatus {
  return {
    lastEventType: null,
    phase: "beforeWork",
    canClockIn: false,
    canClockOut: false,
    canOutStart: false,
    canOutEnd: false,
    lastEvent: null,
    ...flags,
  };
}

describe("allowedTypesOf", () => {
  it("勤務前は出勤のみ", () => {
    expect(allowedTypesOf(status({ canClockIn: true }))).toEqual(["IN"]);
  });
  it("勤務中は退勤と外出", () => {
    expect(allowedTypesOf(status({ phase: "working", canClockOut: true, canOutStart: true }))).toEqual([
      "OUT",
      "OUT_START",
    ]);
  });
  it("外出中は退勤と戻り", () => {
    expect(allowedTypesOf(status({ phase: "outing", canClockOut: true, canOutEnd: true }))).toEqual([
      "OUT",
      "OUT_END",
    ]);
  });
});
