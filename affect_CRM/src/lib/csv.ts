// CSV 生成
//
// Excel で開いたときに文字化けさせないため、UTF-8 の先頭に BOM を付ける。
// 改行は CRLF。

import { NextResponse } from "next/server";

/** カンマ・引用符・改行を含むときだけ引用符で囲む */
function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return (
    // BOM。これがないと Excel が Shift_JIS として開いて文字化けする
    "﻿" + rows.map((row) => row.map(csvField).join(",")).join("\r\n")
  );
}

/**
 * CSV をダウンロードさせるレスポンスを返す。
 * ファイル名はローマ字にする（日本語だと filename*=UTF-8'' のエンコードが必要になるため）。
 */
export function csvResponse(rows: (string | number | null | undefined)[][], fileName: string) {
  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
