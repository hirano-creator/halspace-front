// ログイン画面
// ログイン済みの場合は勤怠一覧へリダイレクトする
// （以前はmiddlewareで行っていたが、proxy化に伴いページ側でチェックする形にした）

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/attendance");

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-primary">TimeCalc</h1>
          <p className="mt-2 text-sm text-muted">勤怠時間計算システム</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-xs text-muted">株式会社ヒラノ</p>
      </div>
    </main>
  );
}
