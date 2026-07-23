// アプリケーション設定の読み書き
//
// 勤務ルール・権限表示名・表示設定は「会社ごと」に保存できる。
// - 共通設定: Setting テーブル（key-value、値はJSON文字列）
// - 会社別設定: CompanySetting テーブル（companyId + key）
// 解決順: デフォルト値 ← 共通設定 ← 会社別設定（未保存のキーは下位にフォールバック）
// CSV列マッピングは全社共通のまま（Setting テーブルのみ）。

import { prisma } from "@/lib/db";
import {
  DEFAULT_CSV_MAPPING,
  DEFAULT_WORK_RULES,
  type CsvMappingSettings,
  type WorkRuleSettings,
} from "@/lib/attendance/types";
import { DEFAULT_ROLE_LABELS, type Role } from "@/lib/auth/roles";
import {
  COMPANY_SETTING_KEYS,
  KEY_CSV_MAPPING,
  KEY_DISPLAY,
  KEY_ROLE_LABELS,
  KEY_WORK_RULES,
  type CompanySettingKey,
} from "@/lib/settings-keys";

export { COMPANY_SETTING_KEYS, type CompanySettingKey };

/** 表示設定（設定画面から変更可能） */
export interface DisplaySettings {
  /**
   * 金額（時給・残業代・支給額）を画面・CSVに表示するか。
   * false でもデータ（時給・計算ロジック）は温存され、ONに戻すと再表示される。
   */
  showMoney: boolean;
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  showMoney: false,
};

/** JSON文字列のレイヤーを順にデフォルトへマージする（後のレイヤーが優先） */
function mergeJsonLayers<T>(defaults: T, ...layers: (string | null | undefined)[]): T {
  let result = { ...defaults };
  for (const layer of layers) {
    if (!layer) continue;
    try {
      result = { ...result, ...(JSON.parse(layer) as Partial<T>) };
    } catch {
      console.error("設定JSONが不正です。該当レイヤーを無視します。");
    }
  }
  return result;
}

/** 共通設定 ← 会社別設定 の順で解決した設定値を返す（companyId 未指定は共通設定のみ） */
async function getJsonSetting<T>(
  key: string,
  defaults: T,
  companyId?: string | null,
): Promise<T> {
  const [globalRow, companyRow] = await Promise.all([
    prisma.setting.findUnique({ where: { key } }),
    companyId
      ? prisma.companySetting.findUnique({
          where: { companyId_key: { companyId, key } },
        })
      : Promise.resolve(null),
  ]);
  return mergeJsonLayers(defaults, globalRow?.value, companyRow?.value);
}

/** 設定を保存する（companyId 指定時は会社別設定、未指定は共通設定へ） */
async function setJsonSetting<T>(key: string, value: T, companyId?: string | null): Promise<void> {
  const json = JSON.stringify(value);
  if (companyId) {
    await prisma.companySetting.upsert({
      where: { companyId_key: { companyId, key } },
      update: { value: json },
      create: { companyId, key, value: json },
    });
    return;
  }
  await prisma.setting.upsert({
    where: { key },
    update: { value: json },
    create: { key, value: json },
  });
}

/** 会社別の上書き設定を削除し、共通設定へのフォールバックに戻す */
export async function deleteCompanySetting(
  companyId: string,
  key: CompanySettingKey,
): Promise<void> {
  await prisma.companySetting.deleteMany({ where: { companyId, key } });
}

/** 勤務ルール設定を取得する */
export function getWorkRules(companyId?: string | null): Promise<WorkRuleSettings> {
  return getJsonSetting(KEY_WORK_RULES, DEFAULT_WORK_RULES, companyId);
}

/** 勤務ルール設定を保存する */
export function saveWorkRules(
  rules: WorkRuleSettings,
  companyId?: string | null,
): Promise<void> {
  return setJsonSetting(KEY_WORK_RULES, rules, companyId);
}

/** 全社分の勤務ルール（会社ID → 解決済みルール）と共通設定の解決値 */
export interface CompanyWorkRules {
  /** 会社別設定を保存している会社の解決済みルール */
  byCompany: Map<string, WorkRuleSettings>;
  /** 共通設定（会社未所属・会社別保存なしのフォールバック） */
  fallback: WorkRuleSettings;
}

/** 全社分の勤務ルールを2クエリでまとめて取得する（勤怠計算のように横断で使う場面用） */
export async function getAllWorkRules(): Promise<CompanyWorkRules> {
  const [globalRow, companyRows] = await Promise.all([
    prisma.setting.findUnique({ where: { key: KEY_WORK_RULES } }),
    prisma.companySetting.findMany({ where: { key: KEY_WORK_RULES } }),
  ]);
  const fallback = mergeJsonLayers(DEFAULT_WORK_RULES, globalRow?.value);
  const byCompany = new Map(
    companyRows.map((row) => [row.companyId, mergeJsonLayers(fallback, row.value)]),
  );
  return { byCompany, fallback };
}

/** 会社IDに対応する勤務ルールを取り出す（会社別保存がなければ共通設定） */
export function workRulesFor(
  all: CompanyWorkRules,
  companyId: string | null | undefined,
): WorkRuleSettings {
  return (companyId ? all.byCompany.get(companyId) : undefined) ?? all.fallback;
}

/** 部署IDから所属会社IDを引く（部署未設定・未所属は null） */
export async function getCompanyIdForDepartment(
  departmentId: string | null | undefined,
): Promise<string | null> {
  if (!departmentId) return null;
  const dept = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { companyId: true },
  });
  return dept?.companyId ?? null;
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
export function getRoleLabels(companyId?: string | null): Promise<Record<Role, string>> {
  return getJsonSetting(KEY_ROLE_LABELS, DEFAULT_ROLE_LABELS, companyId);
}

/** 権限の表示名を保存する */
export function saveRoleLabels(
  labels: Record<Role, string>,
  companyId?: string | null,
): Promise<void> {
  return setJsonSetting(KEY_ROLE_LABELS, labels, companyId);
}

/** 表示設定を取得する */
export function getDisplaySettings(companyId?: string | null): Promise<DisplaySettings> {
  return getJsonSetting(KEY_DISPLAY, DEFAULT_DISPLAY_SETTINGS, companyId);
}

/** 表示設定を保存する */
export function saveDisplaySettings(
  settings: DisplaySettings,
  companyId?: string | null,
): Promise<void> {
  return setJsonSetting(KEY_DISPLAY, settings, companyId);
}
