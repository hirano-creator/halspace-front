// アプリケーション設定の読み書き
// Setting テーブルに key-value（値はJSON文字列）で保存する。
// 未設定の場合はデフォルト値を返すため、初期セットアップなしでも動作する。

import { prisma } from "@/lib/db";
import {
  DEFAULT_CSV_MAPPING,
  DEFAULT_WORK_RULES,
  type CsvMappingSettings,
  type WorkRuleSettings,
} from "@/lib/attendance/types";
import { DEFAULT_ROLE_LABELS, type Role } from "@/lib/auth/roles";

const KEY_WORK_RULES = "workRules";
const KEY_CSV_MAPPING = "csvMapping";
const KEY_ROLE_LABELS = "roleLabels";

async function getJsonSetting<T>(key: string, defaults: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return defaults;
  try {
    // デフォルトとマージし、設定項目追加時に欠損キーで壊れないようにする
    return { ...defaults, ...(JSON.parse(row.value) as Partial<T>) };
  } catch {
    console.error(`設定 ${key} のJSONが不正です。デフォルト値を使用します。`);
    return defaults;
  }
}

async function setJsonSetting<T>(key: string, value: T): Promise<void> {
  const json = JSON.stringify(value);
  await prisma.setting.upsert({
    where: { key },
    update: { value: json },
    create: { key, value: json },
  });
}

/** 勤務ルール設定を取得する */
export function getWorkRules(): Promise<WorkRuleSettings> {
  return getJsonSetting(KEY_WORK_RULES, DEFAULT_WORK_RULES);
}

/** 勤務ルール設定を保存する */
export function saveWorkRules(rules: WorkRuleSettings): Promise<void> {
  return setJsonSetting(KEY_WORK_RULES, rules);
}

/** CSV列マッピング設定を取得する */
export function getCsvMapping(): Promise<CsvMappingSettings> {
  return getJsonSetting(KEY_CSV_MAPPING, DEFAULT_CSV_MAPPING);
}

/** CSV列マッピング設定を保存する */
export function saveCsvMapping(mapping: CsvMappingSettings): Promise<void> {
  return setJsonSetting(KEY_CSV_MAPPING, mapping);
}

/** 権限の表示名を取得する（未設定の権限はデフォルト名を使う） */
export function getRoleLabels(): Promise<Record<Role, string>> {
  return getJsonSetting(KEY_ROLE_LABELS, DEFAULT_ROLE_LABELS);
}

/** 権限の表示名を保存する */
export function saveRoleLabels(labels: Record<Role, string>): Promise<void> {
  return setJsonSetting(KEY_ROLE_LABELS, labels);
}
