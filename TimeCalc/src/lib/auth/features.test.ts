import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEATURES,
  HOME_SCREEN_PATHS,
  resolveFeatures,
  serializeFeatures,
  toHomeScreen,
  type FeatureSettings,
} from "./features";

describe("homeScreen", () => {
  it("デフォルトは clock（ログイン直後は打刻画面）", () => {
    expect(DEFAULT_FEATURES.homeScreen).toBe("clock");
  });

  it("resolveFeatures はキーが無ければデフォルト値(clock)にする（既存データとの後方互換）", () => {
    expect(resolveFeatures(null).homeScreen).toBe("clock");
    expect(resolveFeatures("{}").homeScreen).toBe("clock");
  });

  it("serializeFeatures → resolveFeatures で homeScreen が往復する", () => {
    for (const homeScreen of ["my", "scan"] as const) {
      const features: FeatureSettings = { ...DEFAULT_FEATURES, homeScreen };
      const json = serializeFeatures(features);
      expect(json).not.toBeNull();
      expect(resolveFeatures(json).homeScreen).toBe(homeScreen);
    }
  });

  it("デフォルトと同じ値は保存されない（overridesに含まれない）", () => {
    const json = serializeFeatures({ ...DEFAULT_FEATURES, homeScreen: "clock" });
    expect(json).toBeNull();
  });

  it("不正なhomeScreen値はデフォルトに落ちる", () => {
    expect(resolveFeatures(JSON.stringify({ homeScreen: "bogus" })).homeScreen).toBe("clock");
  });

  it("toHomeScreen は不正値をデフォルトに丸める", () => {
    expect(toHomeScreen("clock")).toBe("clock");
    expect(toHomeScreen("scan")).toBe("scan");
    expect(toHomeScreen("my")).toBe("my");
    expect(toHomeScreen("invalid")).toBe("clock");
    expect(toHomeScreen(undefined)).toBe("clock");
  });

  it("HOME_SCREEN_PATHS は全てのhomeScreenの遷移先を持つ", () => {
    expect(HOME_SCREEN_PATHS).toEqual({ clock: "/clock", my: "/my", scan: "/clock/scan" });
  });
});
