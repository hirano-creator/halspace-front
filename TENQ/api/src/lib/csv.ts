/**
 * CSV 出力（requirements F-8、docs/security.md §4）。
 *  - UTF-8（BOM 付き）・CRLF。Excel で開いても文字化けしない
 *  - = + - @ タブ CR で始まるセルは先頭に ' を付け、Excel に数式として実行させない
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function csvResponse(fileName: string, header: string[], rows: unknown[][]): Response {
  return new Response(toCsv(header, rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tenq.csv"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** 1 回の出力の上限（Workers の CPU 時間を超えないように。超える場合は期間を分けてもらう） */
export const CSV_MAX_ROWS = 10_000;
