// 社員の新規登録 ※管理者のみ

import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guard";
import { getRoleLabels } from "@/lib/settings";
import { Card, PageHeader } from "@/components/ui";
import { EmployeeForm } from "../employee-form";

export const dynamic = "force-dynamic";

export default async function NewEmployeePage() {
  await requirePermission("manageEmployees");

  const [departments, roleLabels] = await Promise.all([
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    getRoleLabels(),
  ]);

  return (
    <>
      <PageHeader title="社員を登録" />
      <Card className="max-w-2xl">
        <EmployeeForm departments={departments} roleLabels={roleLabels} />
      </Card>
    </>
  );
}
