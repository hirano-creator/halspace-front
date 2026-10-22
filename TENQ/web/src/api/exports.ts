import { INSPECTION_CSV_HEADER, inspectionCsvRows, localDate, toCsv, type InspectionExportPage } from '@tenq/shared';
import { apiGet, saveBlob } from './client';

/**
 * 点検記録の CSV を端末で組み立てて保存する。
 * API（Workers）で CSV にすると無料プランの CPU 時間を超えるため、点検 300 件ずつの JSON を集めてここで CSV にする。
 * query は検索条件（from・to・factory など）。出力したことは最初のページで API が監査ログに残す。
 */
export async function downloadInspectionsCsv(query: string): Promise<number> {
  const pages: InspectionExportPage[] = [];
  let cursor: string | null = null;
  do {
    const page: InspectionExportPage = await apiGet<InspectionExportPage>(`/exports/inspections?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor);
  const rows = inspectionCsvRows(pages);
  saveBlob(`TENQ_点検記録_${localDate(new Date(), 'Asia/Tokyo')}.csv`, new Blob([toCsv(INSPECTION_CSV_HEADER, rows)], { type: 'text/csv;charset=utf-8' }));
  return rows.length;
}
