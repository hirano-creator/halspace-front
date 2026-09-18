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
import { parseEmployeeForm, isUniqueViolation } from "../_shared";

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

  // 自分自身の在籍オフと、最後の管理者の降格・在籍オフは拒否する（誰も社員管理・設定を触れなくなる）
  if (target.id === auth.user.id && !input.isActive) {
    return NextResponse.json<EmployeeFormState>({ error: "自分自身を在籍オフにはできません" });
  }
  const losesAdmin =
    toRole(target.role) === "ADMIN" && (toRole(input.role) !== "ADMIN" || !input.isActive);
  if (losesAdmin && (await countOtherActiveAdmins(id)) === 0) {
    return NextResponse.json<EmployeeFormState>({
      error: "最後の管理者の権限・在籍は変更できません（先に別の管理者を登録してください）",
    });
  }

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

  try {
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
        // 管理者がパスワードを再設定した場合は、本人に次回ログイン時の変更を求める
        ...(input.password
          ? { passwordHash: await hashPassword(input.password), mustChangePassword: true }
          : {}),
      },
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return NextResponse.json<EmployeeFormState>({
        error: "同じ社員番号またはメールアドレスが既に登録されています",
      });
    }
    console.error("社員更新エラー:", e);
    return NextResponse.json<EmployeeFormState>({ error: "社員の更新に失敗しました" }, { status: 500 });
  }

  return NextResponse.json<EmployeeFormState>({ error: null, success: true });
}

/** 指定した社員以外に、在籍中の管理者が何人いるか */
function countOtherActiveAdmins(excludeId: string): Promise<number> {
  return prisma.user.count({ where: { role: "ADMIN", isActive: true, id: { not: excludeId } } });
}

/**
 * 社員を削除する。
 * 削除すると、その社員の勤怠データもすべて削除される（データベースの外部キー制約による連動削除）ため、
 * 勤怠・打刻の記録が1件でもある社員は削除させず「在籍オフ」を案内する
 * （退職者の給与計算の根拠が消えるのを防ぐ。登録直後の入力ミスなど記録のない社員だけ削除できる）。
 * 安全のため、自分自身の削除・最後の管理者の削除も拒否する。
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

  if (toRole(target.role) === "ADMIN" && (await countOtherActiveAdmins(id)) === 0) {
    return NextResponse.json<EmployeeDeleteState>({ error: "最後の管理者は削除できません" });
  }

  const [attendanceCount, clockEventCount] = await Promise.all([
    prisma.attendance.count({ where: { userId: id } }),
    prisma.clockEvent.count({ where: { userId: id } }),
  ]);
  if (attendanceCount > 0 || clockEventCount > 0) {
    return NextResponse.json<EmployeeDeleteState>({
      error:
        "勤怠・打刻の記録がある社員は削除できません。退職者は編集画面で「在籍」をオフにしてください（記録は保持されます）",
    });
  }

  try {
    await prisma.user.delete({ where: { id } });
  } catch (e) {
    console.error("社員削除エラー:", e);
    return NextResponse.json<EmployeeDeleteState>({ error: "社員の削除に失敗しました" }, { status: 500 });
  }

  return NextResponse.json<EmployeeDeleteState>({ error: null });
}
