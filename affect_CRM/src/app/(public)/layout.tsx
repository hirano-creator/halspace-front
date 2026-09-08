// 公開ページ（ホームページからの予約）のレイアウト。
//
// 管理画面とはトーンを変える。業務効率よりブランドの見え方を優先し、
// 認証も不要なのでサイドバー・下部ナビは出さない。

import type { Metadata } from "next";
import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "スクール予約 | affect",
  description: "サーフショップ affect のスクール予約ページです。",
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="border-b border-line px-6 py-5">
        <div className="mx-auto flex max-w-[860px] items-center justify-between">
          <Logo size={22} />
          <span className="text-[11px] tracking-[0.2em] text-gray-faint">SCHOOL BOOKING</span>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-line px-6 py-8">
        <p className="mx-auto max-w-[860px] text-[11.5px] text-gray-faint">
          © affect
        </p>
      </footer>
    </div>
  );
}
