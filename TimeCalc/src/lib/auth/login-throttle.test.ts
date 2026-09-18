import { describe, expect, it } from "vitest";
import { LoginThrottle, clientIp } from "./login-throttle";

const RULE = { maxFailures: 3, windowMs: 60_000 };

function throttleAt(start = 0) {
  let now = start;
  const t = new LoginThrottle(RULE, () => now);
  return { t, advance: (ms: number) => (now += ms) };
}

describe("LoginThrottle", () => {
  it("上限未満の失敗ではロックしない", () => {
    const { t } = throttleAt();
    expect(t.recordFailure("a")).toBe(false);
    expect(t.recordFailure("a")).toBe(false);
    expect(t.lockedFor("a")).toBeNull();
  });

  it("上限に達するとロックし、残り秒数を返す", () => {
    const { t, advance } = throttleAt();
    t.recordFailure("a");
    t.recordFailure("a");
    expect(t.recordFailure("a")).toBe(true);
    expect(t.lockedFor("a")).toBe(60);
    advance(45_000);
    expect(t.lockedFor("a")).toBe(15);
  });

  it("ロック時間が過ぎれば解除され、数え直しになる", () => {
    const { t, advance } = throttleAt();
    for (let i = 0; i < 3; i++) t.recordFailure("a");
    advance(60_001);
    expect(t.lockedFor("a")).toBeNull();
    expect(t.recordFailure("a")).toBe(false);
  });

  it("窓を過ぎた古い失敗は数えない", () => {
    const { t, advance } = throttleAt();
    t.recordFailure("a");
    t.recordFailure("a");
    advance(61_000);
    expect(t.recordFailure("a")).toBe(false); // 数え直しの1回目
    expect(t.lockedFor("a")).toBeNull();
  });

  it("成功すると失敗の記録が消える", () => {
    const { t } = throttleAt();
    t.recordFailure("a");
    t.recordFailure("a");
    t.recordSuccess("a");
    expect(t.recordFailure("a")).toBe(false);
    expect(t.recordFailure("a")).toBe(false);
    expect(t.lockedFor("a")).toBeNull();
  });

  it("キーごとに独立して数える", () => {
    const { t } = throttleAt();
    for (let i = 0; i < 3; i++) t.recordFailure("a");
    expect(t.lockedFor("a")).not.toBeNull();
    expect(t.lockedFor("b")).toBeNull();
  });
});

describe("clientIp", () => {
  it("cf-connecting-ip を最優先にする", () => {
    const req = new Request("http://localhost/", {
      headers: { "cf-connecting-ip": "203.0.113.5", "x-forwarded-for": "198.51.100.1, 10.0.0.1" },
    });
    expect(clientIp(req)).toBe("203.0.113.5");
  });

  it("x-forwarded-for は先頭のIPを使う", () => {
    const req = new Request("http://localhost/", {
      headers: { "x-forwarded-for": "198.51.100.1, 10.0.0.1" },
    });
    expect(clientIp(req)).toBe("198.51.100.1");
  });

  it("どちらも無ければ unknown", () => {
    expect(clientIp(new Request("http://localhost/"))).toBe("unknown");
  });
});
