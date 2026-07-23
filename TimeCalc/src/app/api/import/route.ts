// CSV取込画面の初期データ取得（GET）と取込実行（POST）
// 旧 import/page.tsx（Server Component）・ import/actions.ts の importCsvAction をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { hashPassword } from "@/lib/auth/password";
import { getCsvMapping, saveCsvMapping } from "@/lib/settings";
import { normalizeDate, timeToMinutes, minutesToTime } from "@/lib/utils/time";
import type {
  ImportHistoryRow,
  ImportPageResponse,
  ImportPayload,
  ImportResult,
} from "@/app/(app)/import/types";

export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "importCsv");
  if (!auth.ok) return auth.response;

  const [mapping, histories] = await Promise.all([
    getCsvMapping(),
    prisma.importHistory.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { importedBy: true },
    }),
  ]);

  const historyRows: ImportHistoryRow[] = histories.map((h) => {
    let errors: string[] = [];
    try {
      errors = h.errors ? (JSON.parse(h.errors) as string[]) : [];
    } catch {
      /* 不正なJSONは無視 */
    }
    return {
      id: h.id,
      createdAtLabel: h.createdAt.toLocaleString("ja-JP"),
      fileName: h.fileName,
      importedByName: h.importedBy?.name ?? null,
      rowCount: h.rowCount,
      errorCount: h.errorCount,
      errors,
    };
  });

  const body: ImportPageResponse = { mapping, histories: historyRows };
  return NextResponse.json(body);
}

const MAX_ROWS = 5000;

/**
 * CSVの行データを検証して勤怠として取り込む。
 * 同一社員・同一日付の既存データは上書きする。
 */
export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "importCsv");
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const payload = (await request.json().catch(() => null)) as ImportPayload | null;
  if (!payload || !Array.isArray(payload.rows)) {
    return NextResponse.json<ImportResult>({
      ok: false,
      message: "リクエストの形式が不正です",
      importedCount: 0,
      createdEmployees: [],
      errors: [],
    });
  }

  if (!payload.rows.length) {
    return NextResponse.json<ImportResult>({
      ok: false,
      message: "取込対象の行がありません",
      importedCount: 0,
      createdEmployees: [],
      errors: [],
    });
  }
  if (payload.rows.length > MAX_ROWS) {
    return NextResponse.json<ImportResult>({
      ok: false,
      message: `一度に取り込めるのは${MAX_ROWS}行までです`,
      importedCount: 0,
      createdEmployees: [],
      errors: [],
    });
  }

  const errors: string[] = [];

  // 社員番号 → ユーザーID の対応表を先に引いておく
  const SKIP_CODES = ["合計", "総計"]; // Squareエクスポート末尾の集計行
  const codes = [
    ...new Set(payload.rows.map((r) => r.employeeCode.trim()).filter((c) => c && !SKIP_CODES.includes(c))),
  ];
  const users = await prisma.user.findMany({
    where: { employeeCode: { in: codes } },
    select: { id: true, employeeCode: true },
  });
  const userIdByCode = new Map(users.map((u) => [u.employeeCode, u.id]));

  // 未登録の社員番号はCSVの氏名で自動登録する（一般社員・時給未設定）
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

  const validRows: { userId: string; date: string; clockIn: string; clockOut: string; breakMinutes: number }[] =
    [];

  for (const row of payload.rows) {
    const code = row.employeeCode.trim();
    const date = normalizeDate(row.date);
    const inMin = timeToMinutes(row.clockIn);
    const outMin = timeToMinutes(row.clockOut);

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
      errors.push(`${row.line}行目: 時刻「${row.clockIn}〜${row.clockOut}」を解釈できません`);
      continue;
    }

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

    validRows.push({ userId, date, clockIn: minutesToTime(inMin), clockOut: minutesToTime(outMin), breakMinutes });
  }

  let importedCount = 0;
  try {
    for (const row of validRows) {
      await prisma.attendance.upsert({
        where: { userId_date: { userId: row.userId, date: row.date } },
        update: { clockIn: row.clockIn, clockOut: row.clockOut, breakMinutes: row.breakMinutes },
        create: row,
      });
      importedCount++;
    }
  } catch (e) {
    console.error("CSV取込エラー:", e);
    return NextResponse.json<ImportResult>({
      ok: false,
      message: `取込中にエラーが発生しました（${importedCount}件まで取込済み）`,
      importedCount,
      createdEmployees,
      errors,
    });
  }

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

  const parts = [`${importedCount}件を取り込みました`];
  if (createdEmployees.length) parts.push(`新規社員${createdEmployees.length}名を自動登録`);
  if (errors.length) parts.push(`${errors.length}件はエラーのためスキップ`);

  return NextResponse.json<ImportResult>({
    ok: true,
    message: parts.length > 1 ? `${parts[0]}（${parts.slice(1).join("・")}）` : parts[0],
    importedCount,
    createdEmployees,
    errors,
  });
}
