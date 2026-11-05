/**
 * マスター（担当者・置場・納品先）と会社設定の型・入力ルール。画面と API で同じものを使う。
 */

export const MASTER_STATUSES = ['active', 'inactive'] as const;
export type MasterStatus = (typeof MASTER_STATUSES)[number];
export const MASTER_STATUS_LABELS: Record<MasterStatus, string> = { active: '利用中', inactive: '利用停止' };

/**
 * コード類（担当者コード・置場コード・得意先コード・直送先コード）の形式。
 * CSV の値をそのまま使うので、先頭の 0 を落とさないよう文字列で扱う（置場 0053 など）。
 */
export const CODE_PATTERN = /^[A-Za-z0-9_\-.]{1,32}$/;
export const CODE_RULE_TEXT = '英数字と - _ . で 32 文字まで';

export interface Staff {
  id: number;
  code: string;
  name: string;
  department: string | null;
  factory: string | null;
  sort_order: number;
  status: MasterStatus;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Location {
  id: number;
  code: string;
  name: string;
  description: string | null;
  status: MasterStatus;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Destination {
  id: number;
  customer_code: string;
  code: string;
  name: string;
  postal_code: string | null;
  address: string | null;
  phone: string | null;
  note: string | null;
  status: MasterStatus;
  version: number;
  created_at: string;
  updated_at: string;
}

/** 照合に使う列（docs/scan-matching.md §4） */
export const MATCH_FIELDS = ['barcode_global_no', 'global_no'] as const;
export type MatchField = (typeof MATCH_FIELDS)[number];
export const MATCH_FIELD_LABELS: Record<MatchField, string> = {
  barcode_global_no: 'バーコード用グローバル番号',
  global_no: 'グローバル番号',
};

/** 1 行に必要な読み取り回数（one = ラベル 1 枚、quantity = 数量分） */
export const SCANS_PER_ITEM = ['one', 'quantity'] as const;
export type ScansPerItem = (typeof SCANS_PER_ITEM)[number];
export const SCANS_PER_ITEM_LABELS: Record<ScansPerItem, string> = {
  one: '1 行につきラベル 1 枚（1 回読めば照合完了）',
  quantity: '数量の分だけラベルがある（数量の回数読む）',
};

export interface CompanySettings {
  match_field: MatchField;
  barcode_strip_prefix: string;
  barcode_strip_suffix: string;
  scans_per_item: ScansPerItem;
  warn_ship_date_mismatch: boolean;
  /** 最後の操作から何時間で再ログインしてもらうか（Space.app のトークンは無期限のため） */
  reauth_hours: number;
  version: number;
}
