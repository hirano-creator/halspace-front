"use client";

// ログインフォーム
//
// タブごとに独立したセッションにするため、Server Action(Cookie依存)ではなく
// /api/auth/login をfetchで叩き、トークンをAuthProvider経由でsessionStorageに保存する。

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/client";
import type { SessionUser } from "@/lib/auth/session";
import { buttonPrimaryClass, inputClass, labelClass } from "@/components/ui";

interface LoginState {
  error: string | null;
}

const initialState: LoginState = { error: null };

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const router = useRouter();
  const { login } = useAuth();

  async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
    const identifier = String(formData.get("identifier") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    if (!identifier || !password) {
      return { error: "社員番号（またはメールアドレス）とパスワードを入力してください" };
    }

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    const data = (await res.json()) as { error?: string; token: string; user: SessionUser };

    if (!res.ok) {
      return { error: data.error ?? "ログインに失敗しました" };
    }

    login(data.token, data.user);
    router.push(redirectTo ?? "/my");
    return { error: null };
  }

  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
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
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
      )}

      <button type="submit" disabled={pending} className={`${buttonPrimaryClass} w-full`}>
        {pending ? "ログイン中..." : "ログイン"}
      </button>
    </form>
  );
}
