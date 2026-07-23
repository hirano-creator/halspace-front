// 認証済みエリアの共通レイアウト（AppShellへの薄いラッパー）
// 実体は AppShell（Client Component）が担う。CSR化に伴い、未ログイン検知・
// ナビメニュー組み立てはすべてそちら側で一元的に行う。

import { AppShell } from "./app-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
