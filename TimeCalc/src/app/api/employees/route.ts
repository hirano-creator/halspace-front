// 社員一覧の取得API（GET）と新規登録API（POST）
// 旧 employees/page.tsx（Server Component）・ employees/actions.ts の createEmployeeAction をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { hashPassword } from "@/lib/auth/password";
import { toRole } from "@/lib/auth/roles";
import { getCompanyIdForDepartment, getDisplaySettings, getRoleLabels } from "@/lib/settings";
import type { Prisma } from "@/generated/prisma/client";
import type { EmployeeFormState, EmployeesPageResponse } from "@/app/(app)/employees/types";
import { parseEmployeeForm } from "./_shared";

const PAGE_SIZE = 50;

export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "manageEmployees");
  if (!auth.ok) return auth.response;
  const viewer = auth.user;

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() || undefined;
  const departmentId = url.searchParams.get("department") || undefined;
  const statusParam = url.searchParams.get("status");
  const status = statusParam === "active" || statusParam === "inactive" ? statusParam : "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const where: Prisma.UserWhereInput = {
    AND: [
      query ? { OR: [{ name: { contains: query } }, { employeeCode: { contains: query } }] } : {},
      departmentId ? { departmentId } : {},
      status === "active" ? { isActive: true } : {},
      status === "inactive" ? { isActive: false } : {},
    ],
  };

  const viewerCompanyId = await getCompanyIdForDepartment(viewer.departmentId);
  const [employees, total, departments, roleLabels, display] = await Promise.all([
    prisma.user.findMany({
      where,
      include: { department: { include: { company: true } } },
      orderBy: { employeeCode: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.user.count({ where }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    getRoleLabels(viewerCompanyId),
    getDisplaySettings(viewerCompanyId),
  ]);

  const body: EmployeesPageResponse = {
    viewerId: viewer.id,
    employees: employees.map((e) => ({
      id: e.id,
      employeeCode: e.employeeCode,
      name: e.name,
      email: e.email,
      departmentLabel: e.department
        ? e.department.company
          ? `${e.department.company.name} / ${e.department.name}`
          : e.department.name
        : null,
      role: toRole(e.role),
      hourlyWage: e.hourlyWage,
      isActive: e.isActive,
    })),
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    page,
    departments: departments.map((d) => ({ id: d.id, name: d.name })),
    roleLabels,
    showMoney: display.showMoney,
  };

  return NextResponse.json(body);
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "manageEmployees");
  if (!auth.ok) return auth.response;

  const formData = await request.formData();
  const input = parseEmployeeForm(formData);
  if (typeof input === "string") {
    return NextResponse.json<EmployeeFormState>({ error: input });
  }
  if (!input.password) {
    return NextResponse.json<EmployeeFormState>({ error: "初期パスワードを入力してください" });
  }

  const dup = await prisma.user.findFirst({
    where: {
      OR: [{ employeeCode: input.employeeCode }, ...(input.email ? [{ email: input.email }] : [])],
    },
  });
  if (dup) {
    return NextResponse.json<EmployeeFormState>({
      error: "同じ社員番号またはメールアドレスが既に登録されています",
    });
  }

  await prisma.user.create({
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
      passwordHash: await hashPassword(input.password),
    },
  });

  return NextResponse.json<EmployeeFormState>({ error: null, success: true });
}
