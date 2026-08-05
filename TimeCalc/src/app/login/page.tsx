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
  // "/" にすることで、以後の振り分け（起動時の画面設定）をルートページの1箇所に集約する
  return "/";
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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-5 py-12">
      {/* 背景の淡いブランドカラー。文字を読みづらくしない程度にごく薄く敷く */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[60vh] bg-[radial-gradient(48rem_28rem_at_50%_-6rem,rgba(99,91,255,0.13),transparent_70%)]"
      />

      <div className="relative w-full max-w-[25rem]">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/25">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-7 w-7 text-white"
              aria-hidden
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7.5V12l3 1.8" />
            </svg>
          </div>
          <h1 className="mt-5 text-[1.75rem] leading-none font-semibold tracking-tight">TimeCalc</h1>
          <p className="mt-2.5 text-sm text-muted">勤怠時間計算システム</p>
        </div>

        <div className="mt-8 rounded-2xl border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(26,31,54,0.04),0_16px_40px_-20px_rgba(26,31,54,0.22)] sm:p-8">
          <LoginForm redirectTo={redirectTo} />
        </div>
      </div>
    </main>
  );
}
