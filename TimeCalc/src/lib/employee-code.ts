// 社員番号の会社別採番
//
// 社員番号は全社で一意（User.employeeCode の @unique）のまま運用する。
// 会社ごとに変えるのは「番号の体系」だけで、Company.codePrefix / codeDigits から
// 新規登録時の既定値を作る（例: 接頭辞 "A"・4桁 → A0001）。
// この方式なら、社員番号でのログインもCSV取込の名寄せも従来どおり動く。

import { prisma } from "@/lib/db";

/** 会社の採番ルール */
export interface CodeRule {
  prefix: string;
  digits: number;
}

/** 採番ルールの既定値（接頭辞なし・4桁） */
export const DEFAULT_CODE_RULE: CodeRule = { prefix: "", digits: 4 };

/** 桁数の上限。社員番号は表示・CSV連携の都合で短く保つ */
const MAX_DIGITS = 10;

/** 採番ルールを正規化する（不正な桁数は既定に寄せる） */
export function normalizeCodeRule(
  prefix: string | null | undefined,
  digits: number | null | undefined,
): CodeRule {
  const d = Number(digits);
  return {
    prefix: (prefix ?? "").trim(),
    digits: Number.isInteger(d) && d >= 1 && d <= MAX_DIGITS ? d : DEFAULT_CODE_RULE.digits,
  };
}

/** 連番から社員番号を組み立てる（例: prefix "A"・4桁・4 → "A0004"） */
export function formatEmployeeCode(rule: CodeRule, sequence: number): string {
  return `${rule.prefix}${String(sequence).padStart(rule.digits, "0")}`;
}

/**
 * 社員番号から連番部分を取り出す。
 * 接頭辞が一致し、残りが数字だけの場合のみ数値を返す（それ以外は null）。
 * 手入力で体系外の番号（例: "臨時01"）が混ざっていても採番が壊れないようにするため。
 */
export function sequenceOfCode(rule: CodeRule, code: string): number | null {
  if (!code.startsWith(rule.prefix)) return null;
  const rest = code.slice(rule.prefix.length);
  if (!/^\d+$/.test(rest)) return null;
  return Number(rest);
}

/**
 * 会社の次の社員番号を返す。会社未指定・未登録の場合は共通の既定ルール（接頭辞なし）で採番する。
 * 既存の最大連番の次を使うため、途中の欠番は埋めない。
 */
export async function nextEmployeeCode(companyId: string | null | undefined): Promise<string> {
  const company = companyId
    ? await prisma.company.findUnique({
        where: { id: companyId },
        select: { codePrefix: true, codeDigits: true },
      })
    : null;
  const rule = company
    ? normalizeCodeRule(company.codePrefix, company.codeDigits)
    : DEFAULT_CODE_RULE;

  // 接頭辞つきの番号だけを見て最大の連番を探す（他社の番号は接頭辞が違うので自然に除外される）
  const candidates = await prisma.user.findMany({
    where: rule.prefix ? { employeeCode: { startsWith: rule.prefix } } : {},
    select: { employeeCode: true },
  });

  let max = 0;
  for (const { employeeCode } of candidates) {
    const seq = sequenceOfCode(rule, employeeCode);
    if (seq !== null && seq > max) max = seq;
  }
  return formatEmployeeCode(rule, max + 1);
}
