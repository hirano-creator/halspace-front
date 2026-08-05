"use client";

// ログインフォーム
//
// タブごとに独立したセッションにするため、Server Action(Cookie依存)ではなく
// /api/auth/login をfetchで叩き、トークンをAuthProvider経由でsessionStorageに保存する。

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/client";
import type { SessionUser } from "@/lib/auth/session";

interface LoginState {
  error: string | null;
}

const initialState: LoginState = { error: null };

/**
 * ログイン画面の入力欄（他画面より縦を厚くしてタップしやすくする）
 * 文字サイズはiOS Safariのフォーカス時オートズームを避けるため16px（text-base）を下回らないこと
 */
const fieldClass =
  "h-11 w-full rounded-lg border border-border bg-surface px-3.5 text-base text-foreground outline-none transition placeholder:text-muted/60 focus:border-primary focus:ring-4 focus:ring-primary/15";

const fieldLabelClass = "mb-1.5 block text-[0.8125rem] font-semibold text-foreground";

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const router = useRouter();
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  // action実行後にフォームが自動リセットされる（React 19）ため、
  // ログイン失敗時に入力が消えないよう制御コンポーネントにしている
  const [identifierValue, setIdentifierValue] = useState("");
  const [passwordValue, setPasswordValue] = useState("");

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
    router.push(redirectTo ?? "/");
    return { error: null };
  }

  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="identifier" className={fieldLabelClass}>
          社員番号 または メールアドレス
        </label>
        <input
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          autoFocus
          required
          value={identifierValue}
          onChange={(e) => setIdentifierValue(e.target.value)}
          className={fieldClass}
          placeholder="H0001"
        />
      </div>

      <div>
        <label htmlFor="password" className={fieldLabelClass}>
          パスワード
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={passwordValue}
            onChange={(e) => setPasswordValue(e.target.value)}
            /* 目のアイコンに文字が重ならないよう右側だけ余白を広げる */
            className={`${fieldClass} pr-11`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "パスワードを隠す" : "パスワードを表示"}
            aria-pressed={showPassword}
            className="absolute top-1/2 right-1.5 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted transition hover:bg-gray-100 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
          >
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      </div>

      {state.error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[0.8125rem] leading-relaxed text-red-700"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            className="mt-px h-4 w-4 shrink-0"
            aria-hidden
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4.5M12 16h.01" />
          </svg>
          {state.error}
        </p>
      )}

      {/* 入力欄同士より一段広く空けて、入力とアクションの区切りを見せる */}
      <div className="pt-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[0.9375rem] font-semibold text-white shadow-sm shadow-primary/25 transition hover:bg-primary-hover active:scale-[0.995] focus-visible:ring-4 focus-visible:ring-primary/30 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
        >
          {pending && (
            <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" aria-hidden>
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeOpacity={0.3}
              />
              <path
                d="M21 12a9 9 0 0 0-9-9"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
              />
            </svg>
          )}
          {pending ? "ログイン中..." : "ログイン"}
        </button>
      </div>
    </form>
  );
}

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[1.125rem] w-[1.125rem]"
      aria-hidden
    >
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[1.125rem] w-[1.125rem]"
      aria-hidden
    >
      <path d="M9.9 5.8A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 4.1M6.3 7.9A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1.5 0 2.8-.4 4-1" />
      <path d="M10 10a3 3 0 0 0 4 4" />
      <path d="M3 3l18 18" />
    </svg>
  );
}
