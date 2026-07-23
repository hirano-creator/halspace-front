"use client";

// サイドバーナビゲーション（現在ページのハイライト付き）

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  icon: string; // 絵文字アイコン（最小限のアイコン方針）
  /** 未処理件数などの通知バッジ（0や未指定なら非表示） */
  badge?: number;
}

/**
 * 現在地に最も一致するナビ項目のhrefを返す。
 * 「/settings/qr」閲覧中に「設定」(/settings)と「QRコード」(/settings/qr)が
 * 両方startsWithマッチしてしまうケースを避けるため、最長一致のみを採用する。
 */
export function getActiveHref(pathname: string, items: NavItem[]): string | null {
  let best: string | null = null;
  for (const item of items) {
    const matches = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
    if (matches && (best === null || item.href.length > best.length)) {
      best = item.href;
    }
  }
  return best;
}

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const activeHref = getActiveHref(pathname, items);

  return (
    <nav className="space-y-1">
      {items.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
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
  );
}
