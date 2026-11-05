/**
 * CSV の読み書き（docs/csv-import.md §2）。画面（取込のプレビュー）と API（テスト）で同じものを使う。
 */

export type CsvEncoding = 'shift_jis' | 'utf-8';

/**
 * 文字コードを判定して文字列にする。
 *  - BOM 付き UTF-8 → UTF-8
 *  - それ以外は UTF-8 として厳密に読み、失敗したら Shift-JIS（CP932）
 *  - どちらでも置換文字（U+FFFD）が出るなら読めないものとして null
 */
export function decodeCsv(bytes: Uint8Array): { text: string; encoding: CsvEncoding } | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes), encoding: 'utf-8' };
  } catch { /* Shift-JIS を試す */ }
  const text = new TextDecoder('shift_jis').decode(bytes);
  if (text.includes('�')) return null;
  return { text, encoding: 'shift_jis' };
}

/** 先頭に NUL 文字がある（Excel ファイルなど CSV でないもの） */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 4096);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

/**
 * RFC 4180 の CSV を行の配列にする。ダブルクォート内のカンマ・改行・"" に対応。
 * 改行は CRLF / LF のどちらでもよい。末尾の空行は捨てる。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { quoted = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  // 空行（列が 1 つで空）を除く
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/**
 * CSV 出力用の 1 セル。Excel で数式として実行されないよう = + - @ で始まる値に ' を付ける（docs/security.md §4）。
 */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** BOM 付き UTF-8・CRLF の CSV 文字列（Excel でそのまま開ける） */
export function toCsv(header: string[], rows: unknown[][]): string {
  return '\uFEFF' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
