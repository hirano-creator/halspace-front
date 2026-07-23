"use client";

// モバイル用ナビゲーション（ハンバーガーボタン → 右からのドロワー）
// デスクトップは従来のサイドバー（sidebar.tsx）を使い、md未満でのみ表示する。

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { getActiveHref, type NavItem } from "./sidebar";

export function MobileNav({
  items,
  footer,
}: {
  items: NavItem[];
  /** ユーザー情報＋ログアウトフォームなど、ドロワー下部に表示する要素 */
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const activeHref = getActiveHref(pathname, items);

  return (
    <>
      <button
        type="button"
        aria-label="メニューを開く"
        onClick={() => setOpen(true)}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition hover:bg-gray-100"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M3 5h14M3 10h14M3 15h14"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* 背景オーバーレイ（タップで閉じる） */}
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setOpen(false)}
            aria-hidden
          />

          <div className="absolute inset-y-0 right-0 flex w-64 flex-col bg-surface p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-lg font-bold tracking-tight text-primary">TimeCalc</span>
              <button
                type="button"
                aria-label="メニューを閉じる"
                onClick={() => setOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-muted transition hover:bg-gray-100"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                  <path
                    d="M4 4l10 10M14 4L4 14"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <nav className="space-y-1">
              {items.map((item) => {
                const active = item.href === activeHref;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                      active
                        ? "bg-violet-50 text-primary"
                        : "text-muted hover:bg-gray-100 hover:text-foreground"
                    }`}
                  >
                    <span aria-hidden className="w-5 text-center">
                      {item.icon}
                    </span>
                    <span className="flex-1">{item.label}</span>
                    {item.badge != null && item.badge > 0 && (
                      <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>

            {footer && <div className="mt-auto border-t border-border pt-4">{footer}</div>}
          </div>
        </div>
      )}
    </>
  );
}
