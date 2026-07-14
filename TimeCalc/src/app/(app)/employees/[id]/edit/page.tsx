// 社員情報の編集 ※管理者のみ

import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guard";
import { toRole } from "@/lib/auth/roles";
import { getRoleLabels } from "@/lib/settings";
import { Card, PageHeader } from "@/components/ui";
import { EmployeeForm } from "../../employee-form";

export const dynamic = "force-dynamic";

export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("manageEmployees");
  const { id } = await params;

  const [employee, departments, roleLabels] = await Promise.all([
    prisma.user.findUnique({ where: { id } }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    getRoleLabels(),
  ]);
  if (!employee) notFound();

  return (
    <>
      <PageHeader title="社員情報を編集" description={`社員番号 ${employee.employeeCode}`} />
      <Card className="max-w-2xl">
        <EmployeeForm
          departments={departments}
          roleLabels={roleLabels}
          values={{
            id: employee.id,
            employeeCode: employee.employeeCode,
            name: employee.name,
            email: employee.email ?? "",
            role: toRole(employee.role),
            hourlyWage: employee.hourlyWage,
            departmentId: employee.departmentId ?? "",
            isActive: employee.isActive,
          }}
        />
      </Card>
    </>
  );
}
