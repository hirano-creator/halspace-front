import { describe, expect, it } from "vitest";
import { buildScannedClockPath, parseClockQrText } from "./qr-scan";

const ORIGIN = "https://example.com";

describe("parseClockQrText", () => {
  it("正常な打刻URL（絶対URL）を解釈できる", () => {
    expect(parseClockQrText(`${ORIGIN}/clock?dept=dept-1&kind=attend&token=abc123`, ORIGIN)).toEqual({
      dept: "dept-1",
      kind: "attend",
      token: "abc123",
    });
  });

  it("kind・tokenなしの標準QRも解釈できる", () => {
    expect(parseClockQrText(`${ORIGIN}/clock?dept=dept-1`, ORIGIN)).toEqual({
      dept: "dept-1",
      kind: null,
      token: null,
    });
  });

  it("相対URLも解釈できる", () => {
    expect(parseClockQrText("/clock?dept=dept-1&kind=outing", ORIGIN)).toEqual({
      dept: "dept-1",
      kind: "outing",
      token: null,
    });
  });

  it("他オリジンのURLは弾く", () => {
    expect(parseClockQrText("https://evil.example/clock?dept=dept-1", ORIGIN)).toBeNull();
  });

  it("/clock以外のパスは弾く", () => {
    expect(parseClockQrText(`${ORIGIN}/settings?dept=dept-1`, ORIGIN)).toBeNull();
  });

  it("deptが欠落していれば弾く", () => {
    expect(parseClockQrText(`${ORIGIN}/clock?kind=attend`, ORIGIN)).toBeNull();
  });

  it("不正なkindはnullに落とす（弾かない）", () => {
    expect(parseClockQrText(`${ORIGIN}/clock?dept=dept-1&kind=bogus`, ORIGIN)).toEqual({
      dept: "dept-1",
      kind: null,
      token: null,
    });
  });

  it("URLとして解析不能な文字列は弾く", () => {
    expect(parseClockQrText("これはQRコードではありません", ORIGIN)).toBeNull();
  });
});

describe("buildScannedClockPath", () => {
  it("dept/kind/tokenをクエリに組み立てる", () => {
    expect(buildScannedClockPath({ dept: "dept-1", kind: "attend", token: "abc123" })).toBe(
      "/clock?dept=dept-1&kind=attend&token=abc123",
    );
  });

  it("kind・tokenがnullなら省略する", () => {
    expect(buildScannedClockPath({ dept: "dept-1", kind: null, token: null })).toBe(
      "/clock?dept=dept-1",
    );
  });
});
