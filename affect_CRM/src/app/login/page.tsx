"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/client";
import type { SessionUser } from "@/lib/auth/session";
import { Logo } from "@/components/logo";
import { buttonPrimaryClass, inputClass, labelClass } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { login, status } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const redirect = params.get("redirect") || "/";

  // すでにログイン済みならそのまま業務画面へ
  useEffect(() => {
    if (status === "authenticated") router.replace(redirect);
  }, [status, redirect, router]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!email.trim()) return setError("メールアドレスを入力してください");
    if (!password) return setError("パスワードを入力してください");

    setPending(true);
    try {
      const body = new FormData();
      body.set("email", email);
      body.set("password", password);
      const res = await fetch("/api/auth/login", { method: "POST", body });
      const data = (await res.json().catch(() => null)) as
        | { token: string; user: SessionUser }
        | { error: string }
        | null;

      if (!res.ok || !data || !("token" in data)) {
        setError((data && "error" in data && data.error) || "ログインできませんでした");
        return;
      }
      login(data.token, data.user);
      router.replace(redirect);
    } catch {
      setError("通信に失敗しました。電波の状況を確認してもう一度お試しください");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 text-center">
          <div className="flex justify-center">
            <Logo size={30} />
          </div>
          <p className="mt-2 text-[10px] tracking-[0.3em] text-gray-faint">SURF CRM</p>
        </div>

        <form onSubmit={onSubmit} className="rounded-lg border border-line bg-card p-6">
          <div className="mb-4">
            <label htmlFor="email" className={labelClass}>
              メールアドレス
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="mb-6">
            <label htmlFor="password" className={labelClass}>
              パスワード
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                className={`${inputClass} pr-11`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {/* 目のマーク: 押している間ではなくトグル式（スマホで片手でも確認できる） */}
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "パスワードを隠す" : "パスワードを表示"}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-gray-faint hover:text-ink focus:outline-none focus-visible:text-accent"
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </div>

          {error && (
            <p className="mb-4 rounded-md bg-red-50 px-3 py-2.5 text-[13px] text-danger">{error}</p>
          )}

          <button type="submit" disabled={pending} className={`${buttonPrimaryClass} w-full`}>
            {pending ? "確認しています…" : "ログイン"}
          </button>
        </form>
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7c1.6 0 3 .4 4.3 1M22 12s-3.5 7-10 7c-1.6 0-3-.4-4.3-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
