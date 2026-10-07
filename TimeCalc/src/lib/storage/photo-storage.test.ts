import { describe, expect, it } from "vitest";
import { PHOTO_RETENTION_DAYS, isJpeg, isPhotoExpired, photoKeyFor } from "./photo-storage";

describe("photoKeyFor", () => {
  it("撮影月ごとのフォルダに打刻IDで保存する", () => {
    expect(photoKeyFor("clx123abc", "2026-10-06")).toBe("clock-photos/2026-10/clx123abc.jpg");
  });
});

describe("isJpeg", () => {
  it("JPEGの先頭バイトを判定する", () => {
    expect(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false); // PNG
    expect(isJpeg(new Uint8Array([0xff, 0xd8]))).toBe(false);
  });
});

describe("isPhotoExpired", () => {
  const takenAt = new Date("2026-01-01T09:00:00+09:00");
  const day = 24 * 60 * 60 * 1000;
  it(`${PHOTO_RETENTION_DAYS}日以内は保存期間内`, () => {
    expect(isPhotoExpired(takenAt, new Date(takenAt.getTime() + PHOTO_RETENTION_DAYS * day))).toBe(false);
  });
  it(`${PHOTO_RETENTION_DAYS}日を過ぎたら期限切れ`, () => {
    expect(isPhotoExpired(takenAt, new Date(takenAt.getTime() + PHOTO_RETENTION_DAYS * day + 1))).toBe(true);
  });
});
