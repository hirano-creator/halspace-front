// 社員管理（一覧）※管理者のみ

import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guard";
import { toRole } from "@/lib/auth/roles";
import { getRoleLabels } from "@/lib/settings";
import {
  Badge,
  Card,
  PageHeader,
  buttonPrimaryClass,
  tdClass,
  thClass,
} from "@/components/ui";
import { DeleteEmployeeButton } from "./delete-button";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  const viewer = await requirePermission("manageEmployees");

  const [employees, roleLabels] = await Promise.all([
    prisma.user.findMany({
      include: { department: true },
      orderBy: { employeeCode: "asc" },
    }),
    getRoleLabels(),
  ]);

  return (
    <>
      <PageHeader
        title="社員管理"
        description={`全${employees.length}名`}
        action={
          <Link href="/employees/new" className={buttonPrimaryClass}>
            社員を登録
          </Link>
        }
      />

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px]">
          <thead className="border-b border-border bg-gray-50/50">
            <tr>
              <th className={thClass}>社員番号</th>
              <th className={thClass}>氏名</th>
              <th className={thClass}>メール</th>
              <th className={thClass}>部署</th>
              <th className={thClass}>権限</th>
              <th className={`${thClass} text-right`}>時給</th>
              <th className={thClass}>状態</th>
              <th className={thClass}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {employees.map((e) => (
              <tr key={e.id} className="transition hover:bg-gray-50/60">
                <td className={tdClass}>{e.employeeCode}</td>
                <td className={tdClass}>
                  <Link
                    href={`/employees/${e.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {e.name}
                  </Link>
                </td>
                <td className={`${tdClass} text-muted`}>{e.email ?? "-"}</td>
                <td className={`${tdClass} text-muted`}>{e.department?.name ?? "-"}</td>
                <td className={tdClass}>
                  <Badge tone="purple">{roleLabels[toRole(e.role)]}</Badge>
                </td>
                <td className={`${tdClass} text-right`}>
                  {e.hourlyWage > 0 ? (
                    `¥${e.hourlyWage.toLocaleString("ja-JP")}`
                  ) : (
                    <span className="text-xs text-amber-600">未設定</span>
                  )}
                </td>
                <td className={tdClass}>
                  <Badge tone={e.isActive ? "green" : "red"}>
                    {e.isActive ? "在籍中" : "退職済"}
                  </Badge>
                </td>
                <td className={`${tdClass} text-right`}>
                  <span className="whitespace-nowrap">
                    <Link
                      href={`/employees/${e.id}/edit`}
                      className="text-sm text-primary hover:underline"
                    >
                      編集
                    </Link>
                    {e.id !== viewer.id && (
                      <span className="ml-3">
                        <DeleteEmployeeButton employeeId={e.id} employeeName={e.name} />
                      </span>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
