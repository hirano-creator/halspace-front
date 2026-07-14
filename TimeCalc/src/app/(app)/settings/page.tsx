// 設定画面（勤務ルール・部署管理）※管理者のみ
// CSV列マッピングはCSV取込画面で変更でき、自動保存されます。

import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guard";
import { getRoleLabels, getWorkRules } from "@/lib/settings";
import { PageHeader } from "@/components/ui";
import { DepartmentManager, RoleLabelsForm, WorkRulesForm } from "./settings-forms";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requirePermission("manageSettings");

  const [rules, roleLabels, departments] = await Promise.all([
    getWorkRules(),
    getRoleLabels(),
    prisma.department.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { users: true } } },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="設定"
        description="勤務ルール・権限の呼び方・部署を管理します（CSV列マッピングはCSV取込画面で設定できます）"
      />

      <div className="space-y-6">
        <WorkRulesForm rules={rules} />
        <RoleLabelsForm roleLabels={roleLabels} />
        <DepartmentManager
          departments={departments.map((d) => ({
            id: d.id,
            name: d.name,
            userCount: d._count.users,
          }))}
        />
      </div>
    </>
  );
}
