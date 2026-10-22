/**
 * CSV の組み立て（requirements F-8、docs/security.md §4）。API と画面で共通。
 *  - UTF-8（BOM 付き）・CRLF。Excel で開いても文字化けしない
 *  - = + - @ タブ CR で始まるセルは先頭に ' を付け、Excel に数式として実行させない
 * 点検記録の CSV は行数が多く Workers 無料プランの CPU 時間（1 回 10ms）に収まらないため、
 * API はページに分けた JSON を返し、画面がここで CSV にする（docs/architecture.md §5）。
 */
import { localDateTime } from './period';

/** 1 回の出力の上限（超える場合は期間を分けてもらう） */
export const CSV_MAX_ROWS = 10_000;

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

// ===== 点検記録の CSV（GET /api/exports/inspections のページを集めて作る） =====

export interface InspectionExportRow {
  id: string; inspection_date: string; factory: string; equipment_code: string; equipment: string; template: string; version_no: number;
  template_version_id: string; inspector: string; status: string; overall_result: 'ok' | 'ng' | null;
  started_at: string; completed_at: string | null; current_revision: number; comment: string | null;
}
export interface InspectionExportItem { id: string; template_version_id: string; sort_order: number; label: string; criteria: string | null }
/** 点検結果（その点検の最新の版）: [点検ID, 項目ID, 判定, 項目コメント] */
export type InspectionExportResult = [string, string, string | null, string | null];

export interface InspectionExportPage {
  /** 最初のページだけ: 出力される行数（上限の確認と画面の表示用） */
  total?: number;
  inspections: InspectionExportRow[];
  items: InspectionExportItem[];
  results: InspectionExportResult[];
  nextCursor: string | null;
}

export const INSPECTION_CSV_HEADER = ['点検ID', '点検日', '工場', '設備番号', '設備名', '点検基準', '版', '点検者', '状態', '総合判定', '開始', '完了', '訂正回数', '項目番号', '点検項目', '判定基準', '判定', '項目コメント', '全体コメント'];

const JUDGE: Record<string, string> = { ok: '正常', ng: '異常', na: '対象外' };
const INSPECTION_STATUS: Record<string, string> = { in_progress: '点検中', completed: '完了', voided: '取消' };
/** 日時は日本時間の「YYYY-MM-DD HH:MM」で出す（保存は UTC） */
const jst = (iso: string | null) => (iso ? localDateTime(new Date(iso), 'Asia/Tokyo') : '');

/** 1行 = 1点検項目の結果。並びは点検日 → 設備番号 → 開始時刻 → 項目番号（項目のない点検も1行出す） */
export function inspectionCsvRows(pages: InspectionExportPage[]): unknown[][] {
  const items = new Map<string, InspectionExportItem[]>();
  const results = new Map<string, InspectionExportResult>();
  const inspections: InspectionExportRow[] = [];
  for (const p of pages) {
    for (const it of p.items) {
      const list = items.get(it.template_version_id) ?? [];
      if (!list.some((x) => x.id === it.id)) list.push(it);
      items.set(it.template_version_id, list);
    }
    for (const r of p.results) results.set(`${r[0]}|${r[1]}`, r);
    inspections.push(...p.inspections);
  }
  for (const list of items.values()) list.sort((a, b) => a.sort_order - b.sort_order);
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  inspections.sort((a, b) => cmp(a.inspection_date, b.inspection_date) || cmp(a.equipment_code, b.equipment_code) || cmp(a.started_at, b.started_at) || cmp(a.id, b.id));

  const rows: unknown[][] = [];
  for (const i of inspections) {
    const head = [i.id, i.inspection_date, i.factory, i.equipment_code, i.equipment, i.template, i.version_no, i.inspector,
      INSPECTION_STATUS[i.status] ?? i.status, i.overall_result ? (i.overall_result === 'ng' ? '異常あり' : '異常なし') : '',
      jst(i.started_at), jst(i.completed_at), i.current_revision - 1];
    const list = items.get(i.template_version_id) ?? [];
    if (list.length === 0) { rows.push([...head, '', '', '', '', '', i.comment]); continue; }
    for (const it of list) {
      const r = results.get(`${i.id}|${it.id}`);
      rows.push([...head, it.sort_order, it.label, it.criteria, r?.[2] ? JUDGE[r[2]] : '', r?.[3] ?? null, i.comment]);
    }
  }
  return rows;
}
