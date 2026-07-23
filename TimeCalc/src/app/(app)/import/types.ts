// CSV取込ページの共有型（Route Handler / クライアントコンポーネント両方から使う）

import type { CsvMappingSettings } from "@/lib/attendance/types";

export interface DeleteHistoryState {
  error: string | null;
}

/** クライアントでマッピング適用済みの1行 */
export interface ImportRow {
  /** 元CSVの行番号（エラー表示用、1始まり） */
  line: number;
  employeeCode: string;
  name: string;
  date: string;
  clockIn: string;
  clockOut: string;
  breakMinutes: string;
}

export interface ImportPayload {
  fileName: string;
  rows: ImportRow[];
  /** 今回使用した列マッピング（次回のデフォルトとして保存する） */
  mapping: CsvMappingSettings;
}

export interface ImportResult {
  ok: boolean;
  message: string;
  importedCount: number;
  /** 自動登録された新規社員（社員番号と氏名） */
  createdEmployees: { employeeCode: string; name: string }[];
  errors: string[];
}

export interface ImportHistoryRow {
  id: string;
  createdAtLabel: string;
  fileName: string;
  importedByName: string | null;
  rowCount: number;
  errorCount: number;
  errors: string[];
}

export interface ImportPageResponse {
  mapping: CsvMappingSettings;
  histories: ImportHistoryRow[];
}
