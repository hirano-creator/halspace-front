"use client";

// ログイン画面
// ログイン済みの場合はマイページ（またはredirect指定先）へリダイレクトする

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/client";
import { LoginForm } from "./login-form";

/** オープンリダイレクト対策: "/"始まりの相対パスのみ許可する */
function safeRedirect(target: string | null): string {
  if (target && target.startsWith("/") && !target.startsWith("//")) return target;
  return "/my";
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const { status } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = safeRedirect(searchParams.get("redirect"));

  useEffect(() => {
    if (status === "authenticated") router.replace(redirectTo);
  }, [status, router, redirectTo]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-primary">TimeCalc</h1>
          <p className="mt-2 text-sm text-muted">勤怠時間計算システム</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">
          <LoginForm redirectTo={redirectTo} />
        </div>

        <p className="mt-6 text-center text-xs text-muted">株式会社ヒラノ</p>
      </div>
    </main>
  );
}
