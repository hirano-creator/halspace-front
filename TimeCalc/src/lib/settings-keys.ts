// 設定のキー定義（クライアント・サーバー共用）
// 実際の読み書きは src/lib/settings.ts（サーバー専用）が行う。

export const KEY_WORK_RULES = "workRules";
export const KEY_CSV_MAPPING = "csvMapping";
export const KEY_ROLE_LABELS = "roleLabels";
export const KEY_DISPLAY = "displaySettings";

/** 会社別に上書きできる設定キー */
export const COMPANY_SETTING_KEYS = [KEY_WORK_RULES, KEY_ROLE_LABELS, KEY_DISPLAY] as const;
export type CompanySettingKey = (typeof COMPANY_SETTING_KEYS)[number];
