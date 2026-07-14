// 認証済みエリアの共通レイアウト（サイドバー＋メイン）

import { requireUser } from "@/lib/auth/guard";
import { can } from "@/lib/auth/roles";
import { getRoleLabels } from "@/lib/settings";
import { logoutAction } from "@/app/login/actions";
import { SidebarNav, type NavItem } from "@/components/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const roleLabels = await getRoleLabels();

  // ロールに応じて表示するメニューを絞る
  const items: NavItem[] = [{ href: "/attendance", label: "勤怠一覧", icon: "🗓" }];
  if (can(user.role, "importCsv")) {
    items.push({ href: "/import", label: "CSV取込", icon: "📥" });
  }
  if (can(user.role, "manageEmployees")) {
    items.push({ href: "/employees", label: "社員管理", icon: "👥" });
  }
  if (can(user.role, "manageSettings")) {
    items.push({ href: "/settings", label: "設定", icon: "⚙" });
  }

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 flex w-44 flex-col border-r border-border bg-surface px-3 py-6">
        <div className="mb-8 px-3">
          <span className="text-xl font-bold tracking-tight text-primary">TimeCalc</span>
        </div>

        <SidebarNav items={items} />

        <div className="mt-auto border-t border-border pt-4">
          <div className="px-3 pb-3">
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-xs text-muted">
              {user.employeeCode} ・ {roleLabels[user.role]}
            </p>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-muted transition hover:bg-gray-100 hover:text-foreground"
            >
              ログアウト
            </button>
          </form>
        </div>
      </aside>

      <main className="ml-44 min-w-0 flex-1 px-6 py-8">
        <div className="mx-auto max-w-[1600px]">{children}</div>
      </main>
    </div>
  );
}
