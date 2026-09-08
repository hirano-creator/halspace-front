"use client";

// 管理画面の共通シェル
//   PC   : 左サイドバー固定
//   スマホ: 下部固定ナビ（中央の「＋来店」を最も大きく）＋ スライドメニュー
//
// 未ログイン検知もここで一元的に行う。

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRequireAuth } from "@/lib/auth/client";
import { Logo } from "@/components/logo";
import { getActiveHref, navGroups } from "@/components/nav-items";
import { IconCalendar, IconClose, IconCustomer, IconHome, IconMenu } from "@/components/icons";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, status, logout } = useRequireAuth();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  if (status !== "authenticated" || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-gray-soft">
        読み込んでいます…
      </div>
    );
  }

  const [main, admin] = navGroups(user.role);
  const activeHref = getActiveHref(pathname, [...main, ...admin]);

  const navLink = (href: string, label: string, Icon: React.ComponentType<{ className?: string }>) => {
    const on = activeHref === href;
    return (
      <Link
        key={href}
        href={href}
        onClick={() => setMenuOpen(false)}
        className={`flex items-center gap-3 border-l-2 px-5 py-2.5 text-[13px] ${
          on
            ? "border-accent font-semibold text-navy"
            : "border-transparent text-gray-soft hover:text-ink"
        }`}
      >
        <Icon className={`h-4 w-4 flex-none ${on ? "text-accent" : "text-gray-faint"}`} />
        {label}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-bg">
      {/* ===== PC: サイドバー ===== */}
      <aside className="fixed inset-y-0 left-0 hidden w-[206px] flex-col border-r border-line bg-card md:flex">
        <div className="border-b border-line-2 px-5 py-5">
          <Logo />
          <p className="mt-1.5 text-[9.5px] tracking-[0.3em] text-gray-faint">SURF CRM</p>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {main.map((i) => navLink(i.href, i.label, i.Icon))}
          {admin.length > 0 && <div className="mx-5 my-3 h-px bg-line-2" />}
          {admin.map((i) => navLink(i.href, i.label, i.Icon))}
        </nav>
        <div className="border-t border-line-2 px-5 py-3">
          <p className="truncate text-xs font-medium">{user.name}</p>
          <button
            type="button"
            onClick={logout}
            className="mt-1 text-[11px] text-gray-soft underline-offset-2 hover:underline"
          >
            ログアウト
          </button>
        </div>
      </aside>

      {/* ===== スマホ: 上部バー ===== */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-card px-4 py-3 md:hidden">
        <Logo size={18} />
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="メニューを開く"
          className="flex h-11 w-11 items-center justify-center text-gray-soft"
        >
          <IconMenu className="h-5 w-5" />
        </button>
      </header>

      {/* ===== スマホ: スライドメニュー ===== */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 right-0 flex w-[260px] flex-col bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-line-2 px-5 py-4">
              <Logo size={18} />
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="メニューを閉じる"
                className="flex h-11 w-11 items-center justify-center text-gray-soft"
              >
                <IconClose className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto py-2">
              {main.map((i) => navLink(i.href, i.label, i.Icon))}
              {admin.length > 0 && <div className="mx-5 my-3 h-px bg-line-2" />}
              {admin.map((i) => navLink(i.href, i.label, i.Icon))}
            </nav>
            <div className="border-t border-line-2 px-5 py-4">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <button
                type="button"
                onClick={logout}
                className="mt-1.5 text-xs text-gray-soft underline-offset-2 hover:underline"
              >
                ログアウト
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 本文 ===== */}
      <main className="pb-[72px] md:ml-[206px] md:pb-0">
        <div className="mx-auto max-w-[1600px]">{children}</div>
      </main>

      {/* ===== スマホ: 下部固定ナビ ===== */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid h-[58px] grid-cols-5 items-center border-t border-line bg-card md:hidden">
        <BottomTab href="/" label="ホーム" active={activeHref === "/"}>
          <IconHome className="h-[18px] w-[18px]" />
        </BottomTab>
        <BottomTab href="/customers" label="顧客" active={activeHref === "/customers"}>
          <IconCustomer className="h-[18px] w-[18px]" />
        </BottomTab>
        {/* 一番使う導線なので中央に大きく置く */}
        <Link href="/visits/quick" className="grid justify-items-center gap-1">
          <span className="-mt-[21px] grid h-[46px] w-[46px] place-items-center rounded-full bg-accent text-2xl leading-none font-light text-white shadow-lg shadow-accent/35">
            ＋
          </span>
          <span className="text-[10px] font-semibold text-accent">来店</span>
        </Link>
        <BottomTab href="/calendar" label="予約" active={activeHref === "/calendar"}>
          <IconCalendar className="h-[18px] w-[18px]" />
        </BottomTab>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="grid h-full justify-items-center gap-1 text-gray-faint"
        >
          <IconMenu className="h-[18px] w-[18px]" />
          <span className="text-[10px]">メニュー</span>
        </button>
      </nav>
    </div>
  );
}

function BottomTab({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`grid h-full justify-items-center gap-1 pt-2 ${active ? "text-accent" : "text-gray-faint"}`}
    >
      {children}
      <span className="text-[10px]">{label}</span>
    </Link>
  );
}
