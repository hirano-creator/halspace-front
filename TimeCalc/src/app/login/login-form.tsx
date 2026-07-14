"use client";

// ログインフォーム（クライアント側の状態管理のみ担当）

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";
import { buttonPrimaryClass, inputClass, labelClass } from "@/components/ui";

const initialState: LoginState = { error: null };

export function LoginForm() {
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
