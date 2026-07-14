"use server";

// 社員管理の Server Action（登録・更新）※管理者のみ

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guard";
import { hashPassword } from "@/lib/auth/password";
import { ROLES, toRole } from "@/lib/auth/roles";

export interface EmployeeFormState {
  error: string | null;
}

export interface EmployeeDeleteState {
  error: string | null;
}

interface EmployeeInput {
  employeeCode: string;
  name: string;
  email: string | null;
  role: string;
  hourlyWage: number;
  departmentId: string | null;
  isActive: boolean;
  password: string; // 空なら変更しない（新規時は必須）
}

function parseEmployeeForm(formData: FormData): EmployeeInput | string {
  const employeeCode = String(formData.get("employeeCode") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || null;
  const role = String(formData.get("role") ?? "EMPLOYEE");
  const hourlyWage = Number(formData.get("hourlyWage") ?? 0);
  const departmentId = String(formData.get("departmentId") ?? "") || null;
  const isActive = formData.get("isActive") === "on";
  const password = String(formData.get("password") ?? "");

  if (!employeeCode) return "社員番号を入力してください";
  if (!name) return "氏名を入力してください";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "メールアドレスの形式が不正です";
  }
  if (!(ROLES as readonly string[]).includes(role)) return "権限の指定が不正です";
  if (!Number.isInteger(hourlyWage) || hourlyWage < 0 || hourlyWage > 100000) {
    return "時給は0〜100,000円の整数で入力してください";
  }
  if (password && password.length < 8) return "パスワードは8文字以上にしてください";

  return { employeeCode, name, email, role, hourlyWage, departmentId, isActive, password };
}

/** 社員を新規登録する */
export async function createEmployeeAction(
  _prev: EmployeeFormState,
  formData: FormData,
): Promise<EmployeeFormState> {
  await requirePermission("manageEmployees");

  const input = parseEmployeeForm(formData);
  if (typeof input === "string") return { error: input };
  if (!input.password) return { error: "初期パスワードを入力してください" };

  const dup = await prisma.user.findFirst({
    where: {
      OR: [
        { employeeCode: input.employeeCode },
        ...(input.email ? [{ email: input.email }] : []),
      ],
    },
  });
  if (dup) return { error: "同じ社員番号またはメールアドレスが既に登録されています" };

  await prisma.user.create({
    data: {
      employeeCode: input.employeeCode,
      name: input.name,
      email: input.email,
      role: toRole(input.role),
      hourlyWage: input.hourlyWage,
      departmentId: input.departmentId,
      isActive: input.isActive,
      passwordHash: await hashPassword(input.password),
    },
  });

  revalidatePath("/employees");
  redirect("/employees");
}

/**
 * 社員を削除する。
 * 削除すると、その社員の勤怠データもすべて削除される（データベースの外部キー制約による連動削除）。
 * 安全のため、自分自身の削除・最後の管理者の削除は拒否する。
 */
export async function deleteEmployeeAction(
  _prev: EmployeeDeleteState,
  formData: FormData,
): Promise<EmployeeDeleteState> {
  const viewer = await requirePermission("manageEmployees");

  const id = String(formData.get("id") ?? "");
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return { error: "対象の社員が見つかりません" };

  if (target.id === viewer.id) {
    return { error: "自分自身は削除できません" };
  }

  if (toRole(target.role) === "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) {
      return { error: "最後の管理者は削除できません" };
    }
  }

  try {
    await prisma.user.delete({ where: { id } });
  } catch (e) {
    console.error("社員削除エラー:", e);
    return { error: "社員の削除に失敗しました" };
  }

  revalidatePath("/employees");
  return { error: null };
}

/** 社員情報を更新する（パスワードは入力時のみ変更） */
export async function updateEmployeeAction(
  _prev: EmployeeFormState,
  formData: FormData,
): Promise<EmployeeFormState> {
  await requirePermission("manageEmployees");

  const id = String(formData.get("id") ?? "");
  const input = parseEmployeeForm(formData);
  if (typeof input === "string") return { error: input };

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return { error: "対象の社員が見つかりません" };

  const dup = await prisma.user.findFirst({
    where: {
      id: { not: id },
      OR: [
        { employeeCode: input.employeeCode },
        ...(input.email ? [{ email: input.email }] : []),
      ],
    },
  });
  if (dup) return { error: "同じ社員番号またはメールアドレスが既に登録されています" };

  await prisma.user.update({
    where: { id },
    data: {
      employeeCode: input.employeeCode,
      name: input.name,
      email: input.email,
      role: toRole(input.role),
      hourlyWage: input.hourlyWage,
      departmentId: input.departmentId,
      isActive: input.isActive,
      ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
    },
  });

  revalidatePath("/employees");
  redirect("/employees");
}
