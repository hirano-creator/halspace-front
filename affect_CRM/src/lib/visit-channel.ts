// 来店経路（複数選択）の保存形式
//
// Visit.channelCode には MasterOption(type="VISIT_CHANNEL") の code を
// カンマ区切りで持つ（例: "INSTAGRAM,REFERRAL"）。
// 「Instagram を見て、紹介でも聞いていた」のように経路は重なることが普通にあるため、
// 1 つに絞らせず複数選べるようにしている。読み書きは必ずここを通す。

/** DB の値を code の配列にする。空・null は [] */
export function splitChannelCodes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

/** code の配列を DB の値にする。空なら null（空文字を DB に混ぜない） */
export function joinChannelCodes(codes: string[]): string | null {
  const unique = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  return unique.length ? unique.join(",") : null;
}

/**
 * 一覧・CSV 用の表示ラベル。複数あれば「Instagram・紹介」のように「・」で繋ぐ。
 * labelOf は code → label（見つからなければ null か code そのもの）を返す関数。
 */
export function channelLabel(
  raw: string | null | undefined,
  labelOf: (code: string) => string | null,
): string | null {
  const labels = splitChannelCodes(raw)
    .map(labelOf)
    .filter((l): l is string => Boolean(l));
  return labels.length ? labels.join("・") : null;
}
