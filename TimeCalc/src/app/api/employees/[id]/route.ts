// 社員1件の取得API（GET、編集フォーム用）・更新API（PATCH）・削除API（DELETE）
// 旧 employees/[id]/edit/page.tsx（Server Component）・ employees/actions.ts の
// updateEmployeeAction / deleteEmployeeAction をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { hashPassword } from "@/lib/auth/password";
import { toRole } from "@/lib/auth/roles";
import { resolveFeatures } from "@/lib/auth/features";
import type { EmployeeDeleteState, EmployeeDetailValues, EmployeeFormState } from "@/app/(app)/employees/types";
import { parseEmployeeForm } from "../_shared";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiPermission(request, "manageEmployees");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const employee = await prisma.user.findUnique({ where: { id } });
  if (!employee) return NextResponse.json({ error: "対象の社員が見つかりません" }, { status: 404 });

  const body: EmployeeDetailValues = {
    id: employee.id,
    employeeCode: employee.employeeCode,
    name: employee.name,
    email: employee.email ?? "",
    role: toRole(employee.role),
    hourlyWage: employee.hourlyWage,
    departmentId: employee.departmentId ?? "",
    isActive: employee.isActive,
    gpsCheckEnabled: employee.gpsCheckEnabled,
    features: resolveFeatures(employee.featureOverrides),
  };
  return NextResponse.json(body);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiPermission(request, "manageEmployees");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const formData = await request.formData();
  const input = parseEmployeeForm(formData);
  if (typeof input === "string") {
    return NextResponse.json<EmployeeFormState>({ error: input });
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json<EmployeeFormState>({ error: "対象の社員が見つかりません" });

  const dup = await prisma.user.findFirst({
    where: {
      id: { not: id },
      OR: [{ employeeCode: input.employeeCode }, ...(input.email ? [{ email: input.email }] : [])],
    },
  });
  if (dup) {
    return NextResponse.json<EmployeeFormState>({
      error: "同じ社員番号またはメールアドレスが既に登録されています",
    });
  }

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
      gpsCheckEnabled: input.gpsCheckEnabled,
      featureOverrides: input.featureOverrides,
      ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
    },
  });

  return NextResponse.json<EmployeeFormState>({ error: null, success: true });
}

/**
 * 社員を削除する。
 * 削除すると、その社員の勤怠データもすべて削除される（データベースの外部キー制約による連動削除）。
 * 安全のため、自分自身の削除・最後の管理者の削除は拒否する。
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiPermission(request, "manageEmployees");
  if (!auth.ok) return auth.response;
  const viewer = auth.user;

  const { id } = await params;
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json<EmployeeDeleteState>({ error: "対象の社員が見つかりません" });

  if (target.id === viewer.id) {
    return NextResponse.json<EmployeeDeleteState>({ error: "自分自身は削除できません" });
  }

  if (toRole(target.role) === "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) {
      return NextResponse.json<EmployeeDeleteState>({ error: "最後の管理者は削除できません" });
    }
  }

  try {
    await prisma.user.delete({ where: { id } });
  } catch (e) {
    console.error("社員削除エラー:", e);
    return NextResponse.json<EmployeeDeleteState>({ error: "社員の削除に失敗しました" });
  }

  return NextResponse.json<EmployeeDeleteState>({ error: null });
}
