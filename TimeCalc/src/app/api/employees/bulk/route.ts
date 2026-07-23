// 社員CSV一括登録API（POST）
// 旧 employees/bulk/actions.ts の bulkCreateEmployeesAction をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { hashPassword } from "@/lib/auth/password";
import { ROLES, toRole, type Role } from "@/lib/auth/roles";
import { getCompanyIdForDepartment, getRoleLabels } from "@/lib/settings";
import type { BulkResult, BulkRow, BulkRowResult } from "@/app/(app)/employees/bulk/types";

/** 英数字のランダムパスワードを生成する（紛らわしい文字は除外） */
function randomPassword(length = 10): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  for (let i = 0; i < length; i++) out += chars[values[i] % chars.length];
  return out;
}

/** 権限キーまたは表示名（設定で変更可）から Role を解決する */
function parseRole(input: string, roleLabels: Record<Role, string>): Role | null {
  const v = input.trim();
  if (!v) return "EMPLOYEE";
  if ((ROLES as readonly string[]).includes(v.toUpperCase())) return toRole(v.toUpperCase());
  const byLabel = ROLES.find((r) => roleLabels[r] === v);
  return byLabel ?? null;
}

/** CSVの行データから社員を一括登録する（既存の社員番号はスキップ） */
export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "manageEmployees");
  if (!auth.ok) return auth.response;
  const viewer = auth.user;

  const body = (await request.json().catch(() => null)) as { rows?: BulkRow[] } | null;
  const rows = body?.rows;

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json<BulkResult>({ ok: false, message: "登録する行がありません", rows: [] });
  }
  if (rows.length > 500) {
    return NextResponse.json<BulkResult>({
      ok: false,
      message: "一度に登録できるのは500行までです",
      rows: [],
    });
  }

  const [roleLabels, departments, existingUsers] = await Promise.all([
    getRoleLabels(await getCompanyIdForDepartment(viewer.departmentId)),
    prisma.department.findMany(),
    prisma.user.findMany({ select: { employeeCode: true, email: true } }),
  ]);
  const departmentByName = new Map(departments.map((d) => [d.name, d.id]));
  const existingCodes = new Set(existingUsers.map((u) => u.employeeCode));
  const existingEmails = new Set(existingUsers.map((u) => u.email).filter(Boolean) as string[]);

  const results: BulkRowResult[] = [];
  const seenCodes = new Set<string>();

  for (const row of rows) {
    const employeeCode = String(row.employeeCode ?? "").trim();
    const name = String(row.name ?? "").trim();
    const email = String(row.email ?? "").trim() || null;
    const base: Omit<BulkRowResult, "status" | "message"> = {
      employeeCode,
      name,
      generatedPassword: null,
    };

    if (!employeeCode || !name) {
      results.push({ ...base, status: "error", message: "社員番号と氏名は必須です" });
      continue;
    }
    if (seenCodes.has(employeeCode)) {
      results.push({ ...base, status: "error", message: "CSV内で社員番号が重複しています" });
      continue;
    }
    seenCodes.add(employeeCode);
    if (existingCodes.has(employeeCode)) {
      results.push({ ...base, status: "skipped", message: "既に登録済みの社員番号です" });
      continue;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      results.push({ ...base, status: "error", message: "メールアドレスの形式が不正です" });
      continue;
    }
    if (email && existingEmails.has(email)) {
      results.push({ ...base, status: "error", message: "既に使われているメールアドレスです" });
      continue;
    }

    const role = parseRole(String(row.role ?? ""), roleLabels);
    if (!role) {
      results.push({
        ...base,
        status: "error",
        message: `権限「${row.role}」を解釈できません（${ROLES.map((r) => roleLabels[r]).join("/")}）`,
      });
      continue;
    }

    const departmentName = String(row.department ?? "").trim();
    const departmentId = departmentName ? (departmentByName.get(departmentName) ?? null) : null;
    if (departmentName && !departmentId) {
      results.push({
        ...base,
        status: "error",
        message: `部署「${departmentName}」が見つかりません（設定画面で先に登録してください）`,
      });
      continue;
    }

    const wageRaw = String(row.hourlyWage ?? "").trim();
    const hourlyWage = wageRaw ? Number(wageRaw) : 0;
    if (!Number.isInteger(hourlyWage) || hourlyWage < 0 || hourlyWage > 100000) {
      results.push({ ...base, status: "error", message: "時給は0〜100,000円の整数で入力してください" });
      continue;
    }

    let password = String(row.password ?? "").trim();
    let generatedPassword: string | null = null;
    if (!password) {
      generatedPassword = randomPassword();
      password = generatedPassword;
    } else if (password.length < 8) {
      results.push({ ...base, status: "error", message: "パスワードは8文字以上にしてください" });
      continue;
    }

    try {
      await prisma.user.create({
        data: {
          employeeCode,
          name,
          email,
          role,
          hourlyWage,
          departmentId,
          passwordHash: await hashPassword(password),
        },
      });
      existingCodes.add(employeeCode);
      if (email) existingEmails.add(email);
      results.push({ ...base, status: "created", message: "登録しました", generatedPassword });
    } catch (e) {
      console.error("一括登録エラー:", e);
      results.push({ ...base, status: "error", message: "登録に失敗しました" });
    }
  }

  const created = results.filter((r) => r.status === "created").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const errors = results.filter((r) => r.status === "error").length;

  return NextResponse.json<BulkResult>({
    ok: errors === 0,
    message: `登録 ${created}件 / スキップ ${skipped}件 / エラー ${errors}件`,
    rows: results,
  });
}
