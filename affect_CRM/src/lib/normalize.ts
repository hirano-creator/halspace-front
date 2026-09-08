// 重複顧客の検知に使う正規化
//
// 正規化した値には index を張るが unique にはしない。
// 電話番号を持たない顧客や、家族で番号を共有するケースが実在するため、
// 制約で弾くと登録そのものができなくなる。検知して「候補」を出すに留める。

/** 全角数字を半角にし、数字以外を落とす。空なら null */
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const half = value.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const digits = half.replace(/\D/g, "");
  return digits || null;
}

/** 前後の空白を落として小文字化。空なら null */
export function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

/** 入力文字列を整える。空文字は null にして DB に空文字を混ぜない */
export function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}
