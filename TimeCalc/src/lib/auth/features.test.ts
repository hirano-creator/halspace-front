import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEATURES,
  resolveFeatures,
  serializeFeatures,
  toHomeScreen,
  type FeatureSettings,
} from "./features";

describe("homeScreen", () => {
  it("デフォルトは my", () => {
    expect(DEFAULT_FEATURES.homeScreen).toBe("my");
  });

  it("resolveFeatures はキーが無ければデフォルト値(my)にする（既存データとの後方互換）", () => {
    expect(resolveFeatures(null).homeScreen).toBe("my");
    expect(resolveFeatures("{}").homeScreen).toBe("my");
  });

  it("serializeFeatures → resolveFeatures で homeScreen が往復する", () => {
    const features: FeatureSettings = { ...DEFAULT_FEATURES, homeScreen: "scan" };
    const json = serializeFeatures(features);
    expect(json).not.toBeNull();
    expect(resolveFeatures(json).homeScreen).toBe("scan");
  });

  it("デフォルトと同じ値は保存されない（overridesに含まれない）", () => {
    const json = serializeFeatures({ ...DEFAULT_FEATURES, homeScreen: "my" });
    expect(json).toBeNull();
  });

  it("不正なhomeScreen値はデフォルトに落ちる", () => {
    expect(resolveFeatures(JSON.stringify({ homeScreen: "bogus" })).homeScreen).toBe("my");
  });

  it("toHomeScreen は不正値をデフォルトに丸める", () => {
    expect(toHomeScreen("scan")).toBe("scan");
    expect(toHomeScreen("my")).toBe("my");
    expect(toHomeScreen("invalid")).toBe("my");
    expect(toHomeScreen(undefined)).toBe("my");
  });
});
