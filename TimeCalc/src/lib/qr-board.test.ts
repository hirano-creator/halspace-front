import { describe, expect, it } from "vitest";
import { resolveQrBoardState } from "./qr-board";

const WORK_START = "09:00"; // 540分
const WORK_END = "18:00"; // 1080分

describe("resolveQrBoardState", () => {
  it("nowMinutesがnull（ハイドレーション前）は working 扱いで折りたたみ", () => {
    const state = resolveQrBoardState({ nowMinutes: null, workStart: WORK_START, workEnd: WORK_END });
    expect(state.phase).toBe("working");
    expect(state.outingExpanded).toBe(false);
    expect(state.notice).toBeNull();
  });

  it("始業前は beforeWork、外出は折りたたみ、noticeは残り時間", () => {
    const state = resolveQrBoardState({ nowMinutes: 480, workStart: WORK_START, workEnd: WORK_END }); // 08:00
    expect(state.phase).toBe("beforeWork");
    expect(state.primaryHeading).toBe("出勤の打刻");
    expect(state.outingExpanded).toBe(false);
    expect(state.notice).toEqual({ tone: "info", text: "始業 09:00 まで あと1時間" });
  });

  it("始業ちょうどは lateWindow の開始（0分経過）", () => {
    const state = resolveQrBoardState({ nowMinutes: 540, workStart: WORK_START, workEnd: WORK_END }); // 09:00
    expect(state.phase).toBe("lateWindow");
    expect(state.outingExpanded).toBe(false);
    expect(state.notice?.tone).toBe("warn");
  });

  it("始業から12分後は遅刻警告、外出はまだ折りたたみ", () => {
    const state = resolveQrBoardState({ nowMinutes: 552, workStart: WORK_START, workEnd: WORK_END }); // 09:12
    expect(state.phase).toBe("lateWindow");
    expect(state.outingExpanded).toBe(false);
    expect(state.notice).toEqual({
      tone: "warn",
      text: "⚠ 始業 09:00 を12分過ぎています（遅刻の打刻になります）",
    });
  });

  it("始業から30分後は外出・戻りQRが自動展開される", () => {
    const state = resolveQrBoardState({ nowMinutes: 570, workStart: WORK_START, workEnd: WORK_END }); // 09:30
    expect(state.phase).toBe("lateWindow");
    expect(state.outingExpanded).toBe(true);
  });

  it("始業から60分後は working フェーズに切り替わる", () => {
    const state = resolveQrBoardState({ nowMinutes: 600, workStart: WORK_START, workEnd: WORK_END }); // 10:00
    expect(state.phase).toBe("working");
    expect(state.primaryHeading).toBe("出勤・退勤の打刻");
    expect(state.outingExpanded).toBe(true);
    expect(state.notice).toEqual({ tone: "info", text: "勤務時間中（終業 18:00 まで あと8時間）" });
  });

  it("終業60分前ちょうどは evening フェーズ", () => {
    const state = resolveQrBoardState({ nowMinutes: 1020, workStart: WORK_START, workEnd: WORK_END }); // 17:00
    expect(state.phase).toBe("evening");
    expect(state.primaryHeading).toBe("退勤の打刻");
    expect(state.outingExpanded).toBe(true);
    expect(state.notice).toEqual({ tone: "info", text: "終業 18:00 まで あと1時間" });
  });

  it("終業1分前は evening フェーズのまま", () => {
    const state = resolveQrBoardState({ nowMinutes: 1079, workStart: WORK_START, workEnd: WORK_END }); // 17:59
    expect(state.phase).toBe("evening");
  });

  it("終業以降は afterWork、外出は折りたたみ", () => {
    const state = resolveQrBoardState({ nowMinutes: 1080, workStart: WORK_START, workEnd: WORK_END }); // 18:00
    expect(state.phase).toBe("afterWork");
    expect(state.primaryHeading).toBe("退勤の打刻");
    expect(state.outingExpanded).toBe(false);
    expect(state.notice).toEqual({ tone: "info", text: "終業 18:00 を過ぎています" });
  });

  it("workEnd <= workStart のような不正値は working フォールバック", () => {
    const state = resolveQrBoardState({ nowMinutes: 600, workStart: "18:00", workEnd: "09:00" });
    expect(state.phase).toBe("working");
    expect(state.outingExpanded).toBe(false);
    expect(state.notice).toBeNull();
  });

  it("time文字列が不正な場合も working フォールバック", () => {
    const state = resolveQrBoardState({ nowMinutes: 600, workStart: "invalid", workEnd: WORK_END });
    expect(state.phase).toBe("working");
    expect(state.notice).toBeNull();
  });
});
