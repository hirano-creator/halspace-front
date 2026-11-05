/** 履歴・分析の画面で使う小さな関数 */
import { toCsv } from '@partsgate/shared';
import { apiGet, saveBlob, type Page } from '../api/client';

/** 日本時間の今日から days 日ずらした日（YYYY-MM-DD） */
export function jstDay(days = 0): string {
  return new Date(Date.now() + 9 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
}
/** その月の 1 日（YYYY-MM-01） */
export const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
/** 月を months だけずらした 1 日 */
export function addMonths(day: string, months: number): string {
  const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1 + months, 1));
  return d.toISOString().slice(0, 10);
}
export const md = (day: string | null | undefined) => (day ? `${day.slice(5, 7)}/${day.slice(8, 10)}` : '—');

/** UTC の日時を日本時間の「MM/DD HH:mm:ss」にする */
export function fmtScanTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(Date.parse(iso) + 9 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/**
 * 一覧 API を最後のページまで読んで CSV にして保存する（docs/architecture.md §8: 行数の多い CSV は画面で組み立てる）。
 * 読みすぎを防ぐため max 行で止め、止めたことを返す。
 */
export async function exportPaged<T>(
  basePath: string, fileName: string, header: string[], toRow: (r: T) => unknown[], onProgress?: (n: number) => void, max = 20_000,
): Promise<{ rows: number; truncated: boolean }> {
  const all: T[] = [];
  let cursor: string | null = null;
  do {
    const sep = basePath.includes('?') ? '&' : '?';
    const r: Page<T> = await apiGet<Page<T>>(`${basePath}${sep}limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    all.push(...r.items);
    cursor = r.next_cursor;
    onProgress?.(all.length);
  } while (cursor && all.length < max);
  saveBlob(fileName, new Blob([toCsv(header, all.map(toRow))], { type: 'text/csv' }));
  return { rows: all.length, truncated: !!cursor };
}

export const RESULT_TEXT: Record<string, { label: string; cls: string; icon: string }> = {
  ok: { label: '正常', cls: 'pill-ok', icon: '✔' },
  duplicate: { label: '読み取り済み', cls: 'pill-warn', icon: '⚠' },
  over_quantity: { label: '数量超過', cls: 'pill-ng', icon: '✖' },
  review: { label: '要確認', cls: 'pill-warn', icon: '⚠' },
  not_found: { label: '未登録', cls: 'pill-ng', icon: '✖' },
  error: { label: 'エラー', cls: 'pill-ng', icon: '✖' },
};

export const STATUS_TEXT: Record<string, { label: string; cls: string }> = {
  pending: { label: '照合待ち', cls: 'pill-gray' },
  matched: { label: '✔ 照合済み', cls: 'pill-ok' },
  review: { label: '⚠ 要確認', cls: 'pill-warn' },
  cancelled: { label: '取消', cls: 'pill-gray' },
  shipped: { label: '出荷済み', cls: 'pill-info' },
};
