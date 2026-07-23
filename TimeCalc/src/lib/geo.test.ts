import { describe, expect, it } from "vitest";
import { distanceMeters, isWithinRadius } from "./geo";

describe("distanceMeters", () => {
  it("同一地点は0m", () => {
    expect(distanceMeters(35.681236, 139.767125, 35.681236, 139.767125)).toBe(0);
  });

  it("東京駅〜新宿駅は約6.4km", () => {
    // 東京駅 35.681236, 139.767125 / 新宿駅 35.690921, 139.700258
    const d = distanceMeters(35.681236, 139.767125, 35.690921, 139.700258);
    expect(d).toBeGreaterThan(6000);
    expect(d).toBeLessThan(6800);
  });
});

describe("isWithinRadius", () => {
  it("半径ちょうどは範囲内（<=）", () => {
    // 緯度1度分(約111,000m)からわずかに超える距離を作り、半径をその手前に設定
    const d = distanceMeters(35.0, 139.0, 35.001, 139.0);
    expect(isWithinRadius(35.0, 139.0, 35.001, 139.0, Math.ceil(d))).toBe(true);
  });

  it("半径を超えると範囲外", () => {
    const d = distanceMeters(35.0, 139.0, 35.01, 139.0);
    expect(isWithinRadius(35.0, 139.0, 35.01, 139.0, Math.floor(d) - 1)).toBe(false);
  });
});
