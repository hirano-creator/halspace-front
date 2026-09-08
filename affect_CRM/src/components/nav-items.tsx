// ナビゲーション項目の定義（サイドバーとスマホのドロワーで共有する）

import type { ComponentType } from "react";
import {
  IconCalendar,
  IconChart,
  IconCustomer,
  IconFollow,
  IconHome,
  IconProduct,
  IconSchool,
  IconSettings,
  IconStaff,
  IconVisit,
} from "./icons";
import type { Permission, Role } from "@/lib/auth/roles";
import { can } from "@/lib/auth/roles";

export interface NavItem {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  /** 指定があれば、その権限を持つ人にだけ出す */
  permission?: Permission;
}

const MAIN: NavItem[] = [
  { href: "/", label: "ダッシュボード", Icon: IconHome },
  { href: "/customers", label: "顧客管理", Icon: IconCustomer },
  { href: "/visits", label: "来店管理", Icon: IconVisit },
  { href: "/schools", label: "スクール", Icon: IconSchool },
  { href: "/calendar", label: "予約カレンダー", Icon: IconCalendar },
  { href: "/products", label: "商品・購入", Icon: IconProduct },
  { href: "/follow-ups", label: "フォロー管理", Icon: IconFollow },
  { href: "/analytics", label: "データ分析", Icon: IconChart },
];

const ADMIN: NavItem[] = [
  { href: "/staff", label: "スタッフ管理", Icon: IconStaff, permission: "staff.manage" },
  { href: "/settings", label: "設定", Icon: IconSettings, permission: "settings.edit" },
];

/** ロールに応じたナビ項目を返す（区切り線の前後で 2 グループ） */
export function navGroups(role: Role): [NavItem[], NavItem[]] {
  const allowed = (items: NavItem[]) =>
    items.filter((item) => !item.permission || can(role, item.permission));
  return [allowed(MAIN), allowed(ADMIN)];
}

/**
 * 現在パスに対応するナビ項目の href を返す。
 * 最長一致で選ぶ（"/customers" と "/customers/new" が二重にアクティブにならないようにするため）。
 */
export function getActiveHref(pathname: string, items: NavItem[]): string {
  let active = "/";
  for (const item of items) {
    if (item.href === "/") continue;
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (item.href.length > active.length) active = item.href;
    }
  }
  return active;
}
