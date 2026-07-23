"use client";

// 認証済みエリアの共通シェル（サイドバー＋メイン）
//
// 旧 (app)/layout.tsx（Server Component）から移植。CSR化に伴い、
// 未ログイン検知・リダイレクトをここで一元的に行う（各ページ個別の requireUser() は不要）。

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useRequireAuth } from "@/lib/auth/client";
import { apiFetchJson } from "@/lib/auth/api-fetch";
import { can } from "@/lib/auth/roles";
import { SidebarNav, type NavItem } from "@/components/sidebar";
import { MobileNav } from "@/components/mobile-nav";
import type { NavResponse } from "./types";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, status, logout } = useRequireAuth();
  const router = useRouter();
  const [nav, setNav] = useState<NavResponse | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    apiFetchJson<NavResponse>("/api/nav")
      .then((res) => {
        if (!cancelled) setNav(res);
      })
      .catch(() => {
        /* ナビの付帯情報が取れなくても画面は表示する（バッジ・呼称が既定値になるだけ） */
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  if (status === "unauthenticated") return null;
  if (status === "loading" || !user) {
    return <p className="py-8 text-center text-sm text-muted">読み込み中...</p>;
  }

  const roleLabels = nav?.roleLabels;
  const pendingCorrections = nav?.pendingCorrections ?? 0;

  const items: NavItem[] = [
    { href: "/my", label: "マイページ", icon: "🏠" },
    { href: "/clock", label: "打刻", icon: "⏱" },
  ];
  if (can(user.role, "viewDepartment")) {
    items.push({ href: "/attendance", label: "勤怠一覧", icon: "🗓" });
    items.push({ href: "/corrections", label: "修正申請", icon: "📝", badge: pendingCorrections });
  }
  if (can(user.role, "importCsv")) {
    items.push({ href: "/import", label: "CSV取込", icon: "📥" });
  }
  if (can(user.role, "manageEmployees")) {
    items.push({ href: "/employees", label: "社員管理", icon: "👥" });
  }
  if (can(user.role, "manageSettings")) {
    items.push({ href: "/settings/qr", label: "QRコード", icon: "📱" });
    items.push({ href: "/settings", label: "設定", icon: "⚙" });
  }

  function handleLogout() {
    logout();
    router.replace("/login");
  }

  const userFooter = (
    <>
      <div className="px-3 pb-3">
        <p className="text-sm font-medium">{user.name}</p>
        <p className="text-xs text-muted">
          {user.employeeCode} ・ {roleLabels?.[user.role] ?? user.role}
        </p>
      </div>
      <button
        type="button"
        onClick={handleLogout}
        className="w-full rounded-lg px-3 py-2 text-left text-sm text-muted transition hover:bg-gray-100 hover:text-foreground"
      >
        ログアウト
      </button>
    </>
  );

  return (
    <div className="min-h-screen">
      {/* モバイルヘッダー（md未満のみ表示。ハンバーガーからドロワーを開く） */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-surface px-4 py-2 md:hidden">
        <span className="text-lg font-bold tracking-tight text-primary">TimeCalc</span>
        <MobileNav items={items} footer={userFooter} />
      </header>

      {/* サイドバー（md以上のみ表示） */}
      <aside className="fixed inset-y-0 left-0 hidden w-44 flex-col border-r border-border bg-surface px-3 py-6 md:flex">
        <div className="mb-8 px-3">
          <span className="text-xl font-bold tracking-tight text-primary">TimeCalc</span>
        </div>

        <SidebarNav items={items} />

        <div className="mt-auto border-t border-border pt-4">{userFooter}</div>
      </aside>

      <main className="min-w-0 px-4 py-6 md:ml-44 md:px-6 md:py-8">
        <div className="mx-auto max-w-[1600px]">{children}</div>
      </main>
    </div>
  );
}
