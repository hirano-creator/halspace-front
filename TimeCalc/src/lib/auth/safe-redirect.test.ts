import { describe, expect, it } from "vitest";
import { safeRedirect } from "./safe-redirect";

const ORIGIN = "https://timecalc-app.pages.dev";

describe("safeRedirect", () => {
  it("同一オリジンの相対パスはそのまま返す（クエリ・ハッシュも保持）", () => {
    expect(safeRedirect("/clock?dept=abc&kind=attend", ORIGIN)).toBe("/clock?dept=abc&kind=attend");
    expect(safeRedirect("/my#today", ORIGIN)).toBe("/my#today");
  });

  it("未指定・空・相対でない値は / に落とす", () => {
    expect(safeRedirect(null, ORIGIN)).toBe("/");
    expect(safeRedirect("", ORIGIN)).toBe("/");
    expect(safeRedirect("https://evil.example/", ORIGIN)).toBe("/");
    expect(safeRedirect("clock", ORIGIN)).toBe("/");
  });

  it("別オリジンへ抜ける書き方はすべて / に落とす", () => {
    expect(safeRedirect("//evil.example/", ORIGIN)).toBe("/");
    expect(safeRedirect("/\\evil.example/", ORIGIN)).toBe("/");
    expect(safeRedirect("/\\\\evil.example", ORIGIN)).toBe("/");
    expect(safeRedirect("/clock\\@evil.example", ORIGIN)).toBe("/");
    // パーセントエンコード済みの \ は URL 解決で復号されず、単なるパスとして扱われる
    expect(safeRedirect("/%5Cevil.example", ORIGIN)).toBe("/%5Cevil.example");
  });

  it("制御文字を含む値は通さない", () => {
    expect(safeRedirect("/clock\r\nSet-Cookie: x", ORIGIN)).toBe("/");
  });
});
