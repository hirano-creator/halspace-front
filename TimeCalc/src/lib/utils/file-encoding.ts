// アップロードファイルの文字コード自動判定（クライアント側で使用）

/**
 * 文字コードを自動判定して読み込む。
 * SquareのエクスポートはUTF-16 LE（BOM付き・タブ区切り）のため、
 * BOMを最優先で判定し、なければUTF-8→Shift_JISの順に試す。
 * ExcelのCSV（Shift_JIS）にも対応する。
 */
export async function readFileWithEncoding(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // BOMによる判定（UTF-16 LE / UTF-16 BE / UTF-8）
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buffer);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer);
  }

  const utf8 = new TextDecoder("utf-8").decode(buffer);
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("shift_jis").decode(buffer);
  } catch {
    return utf8; // Shift_JIS非対応環境ではUTF-8の結果を使う
  }
}
