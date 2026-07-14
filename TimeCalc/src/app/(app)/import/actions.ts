"use server";

// CSV取込の Server Action

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission, requireUser } from "@/lib/auth/guard";
import { hashPassword } from "@/lib/auth/password";
import { can } from "@/lib/auth/roles";
import { saveCsvMapping } from "@/lib/settings";
import { normalizeDate, timeToMinutes, minutesToTime } from "@/lib/utils/time";
import type { CsvMappingSettings } from "@/lib/attendance/types";

export interface DeleteHistoryState {
  error: string | null;
}

/**
 * 取込履歴のログ1件を削除する。
 * これは履歴の記録を消すだけで、その取込で登録された勤怠データ自体は削除されない
 * （取込履歴と勤怠データの間に紐付けがなく、取り消しはできない設計のため）。
 */
export async function deleteImportHistoryAction(
  _prev: DeleteHistoryState,
  formData: FormData,
): Promise<DeleteHistoryState> {
  await requirePermission("importCsv");

  const id = String(formData.get("id") ?? "");
  try {
    await prisma.importHistory.delete({ where: { id } });
  } catch (e) {
    console.error("取込履歴削除エラー:", e);
    return { error: "履歴の削除に失敗しました" };
  }

  revalidatePath("/import");
  return { error: null };
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

const MAX_ROWS = 5000;

/**
 * CSVの行データを検証して勤怠として取り込む。
 * 同一社員・同一日付の既存データは上書きする。
 */
export async function importCsvAction(payload: ImportPayload): Promise<ImportResult> {
  const user = await requireUser();
  if (!can(user.role, "importCsv")) {
    return { ok: false, message: "CSV取込の権限がありません", importedCount: 0, createdEmployees: [], errors: [] };
  }

  if (!payload.rows.length) {
    return { ok: false, message: "取込対象の行がありません", importedCount: 0, createdEmployees: [], errors: [] };
  }
  if (payload.rows.length > MAX_ROWS) {
    return {
      ok: false,
      message: `一度に取り込めるのは${MAX_ROWS}行までです`,
      importedCount: 0,
      createdEmployees: [],
      errors: [],
    };
  }

  const errors: string[] = [];

  // 社員番号 → ユーザーID の対応表を先に引いておく
  const SKIP_CODES = ["合計", "総計"]; // Squareエクスポート末尾の集計行
  const codes = [
    ...new Set(
      payload.rows
        .map((r) => r.employeeCode.trim())
        .filter((c) => c && !SKIP_CODES.includes(c)),
    ),
  ];
  const users = await prisma.user.findMany({
    where: { employeeCode: { in: codes } },
    select: { id: true, employeeCode: true },
  });
  const userIdByCode = new Map(users.map((u) => [u.employeeCode, u.id]));

  // 未登録の社員番号はCSVの氏名で自動登録する（一般社員・時給未設定）
  // パスワードはランダム値で作成し、ログインさせる場合は社員管理で設定し直す
  const createdEmployees: { employeeCode: string; name: string }[] = [];
  for (const code of codes) {
    if (userIdByCode.has(code)) continue;
    const name =
      payload.rows.find((r) => r.employeeCode.trim() === code && r.name.trim())?.name.trim() ??
      `社員 ${code}`;
    try {
      const created = await prisma.user.create({
        data: {
          employeeCode: code,
          name,
          role: "EMPLOYEE",
          hourlyWage: 0,
          passwordHash: await hashPassword(crypto.randomUUID()),
        },
      });
      userIdByCode.set(code, created.id);
      createdEmployees.push({ employeeCode: code, name });
    } catch (e) {
      console.error(`社員自動登録エラー（${code}）:`, e);
      errors.push(`社員番号「${code}」（${name}）の自動登録に失敗しました`);
    }
  }

  const validRows: {
    userId: string;
    date: string;
    clockIn: string;
    clockOut: string;
    breakMinutes: number;
  }[] = [];

  for (const row of payload.rows) {
    const code = row.employeeCode.trim();
    const date = normalizeDate(row.date);
    const inMin = timeToMinutes(row.clockIn);
    const outMin = timeToMinutes(row.clockOut);

    // Squareエクスポート末尾の集計行はスキップ（エラー扱いにしない）
    if (SKIP_CODES.includes(code)) continue;

    if (!code) {
      errors.push(`${row.line}行目: 社員番号が空です`);
      continue;
    }
    const userId = userIdByCode.get(code);
    if (!userId) {
      errors.push(`${row.line}行目: 社員番号「${code}」が登録されていません（${row.name}）`);
      continue;
    }
    if (!date) {
      errors.push(`${row.line}行目: 日付「${row.date}」を解釈できません`);
      continue;
    }
    if (inMin === null || outMin === null) {
      errors.push(
        `${row.line}行目: 時刻「${row.clockIn}〜${row.clockOut}」を解釈できません`,
      );
      continue;
    }

    // 休憩の解釈: 整数=分（例 "60"）、小数=時間（例 "0.5" → 30分）、
    // "HH:mm" 形式も許容。空は0分
    let breakMinutes = 0;
    const rawBreak = row.breakMinutes.trim();
    if (rawBreak) {
      if (/^\d+$/.test(rawBreak)) {
        breakMinutes = Number(rawBreak);
      } else if (/^\d+\.\d+$/.test(rawBreak)) {
        breakMinutes = Math.round(Number(rawBreak) * 60);
      } else {
        const asTime = timeToMinutes(rawBreak);
        if (asTime === null) {
          errors.push(`${row.line}行目: 休憩「${rawBreak}」を解釈できません`);
          continue;
        }
        breakMinutes = asTime;
      }
    }

    validRows.push({
      userId,
      date,
      clockIn: minutesToTime(inMin),
      clockOut: minutesToTime(outMin),
      breakMinutes,
    });
  }

  // 取込実行（同一社員・同一日付は上書き）
  let importedCount = 0;
  try {
    for (const row of validRows) {
      await prisma.attendance.upsert({
        where: { userId_date: { userId: row.userId, date: row.date } },
        update: {
          clockIn: row.clockIn,
          clockOut: row.clockOut,
          breakMinutes: row.breakMinutes,
        },
        create: row,
      });
      importedCount++;
    }
  } catch (e) {
    console.error("CSV取込エラー:", e);
    return {
      ok: false,
      message: `取込中にエラーが発生しました（${importedCount}件まで取込済み）`,
      importedCount,
      createdEmployees,
      errors,
    };
  }

  // 履歴を記録し、使用したマッピングを次回デフォルトとして保存
  await prisma.importHistory.create({
    data: {
      fileName: payload.fileName,
      rowCount: importedCount,
      errorCount: errors.length,
      errors: errors.length ? JSON.stringify(errors) : null,
      importedById: user.id,
    },
  });
  await saveCsvMapping(payload.mapping);

  revalidatePath("/attendance");
  revalidatePath("/import");
  revalidatePath("/employees");

  const parts = [`${importedCount}件を取り込みました`];
  if (createdEmployees.length) parts.push(`新規社員${createdEmployees.length}名を自動登録`);
  if (errors.length) parts.push(`${errors.length}件はエラーのためスキップ`);

  return {
    ok: true,
    message: parts.length > 1 ? `${parts[0]}（${parts.slice(1).join("・")}）` : parts[0],
    importedCount,
    createdEmployees,
    errors,
  };
}
