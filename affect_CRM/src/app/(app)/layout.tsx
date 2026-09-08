// 管理画面のレイアウト。実体は AppShell（Client Component）が担う。
// 認証は sessionStorage + Bearer 方式なので、データ取得は各ページの
// クライアント側から /api/* を叩く。

import { AppShell } from "./app-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
