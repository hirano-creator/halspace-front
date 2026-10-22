/**
 * CSV の応答（組み立ては shared/src/csv.ts。BOM・CRLF・数式セルの ' 前置もそちら）。
 * 点検記録の CSV は行数が多いので API では作らず、画面が組み立てる（GET /api/exports/inspections）。
 */
import { toCsv } from '@tenq/shared';

export { CSV_MAX_ROWS } from '@tenq/shared';

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
