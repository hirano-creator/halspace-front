"use client";

// ログイン画面

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";
import { buttonPrimaryClass, inputClass, labelClass } from "@/components/ui";

const initialState: LoginState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-primary">TimeCalc</h1>
          <p className="mt-2 text-sm text-muted">勤怠時間計算システム</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">
          <form action={formAction} className="space-y-5">
            <div>
              <label htmlFor="identifier" className={labelClass}>
                社員番号 または メールアドレス
              </label>
              <input
                id="identifier"
                name="identifier"
                type="text"
                autoComplete="username"
                required
                className={inputClass}
                placeholder="0001"
              />
            </div>
            <div>
              <label htmlFor="password" className={labelClass}>
                パスワード
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className={inputClass}
              />
            </div>

            {state.error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {state.error}
              </p>
            )}

            <button type="submit" disabled={pending} className={`${buttonPrimaryClass} w-full`}>
              {pending ? "ログイン中..." : "ログイン"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-muted">株式会社ヒラノ</p>
      </div>
    </main>
  );
}
