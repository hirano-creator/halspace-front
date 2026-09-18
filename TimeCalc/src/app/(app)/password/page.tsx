"use client";

// パスワード変更（本人用）
//
// 通常はサイドバーの「パスワード変更」から任意に開く。
// 初期パスワードのまま（mustChangePassword）の人はログイン直後にここへ誘導され、
// 変更が済むまで他の画面・APIが使えない（AppShell と api-guard が両側で止める）。

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/client";
import { apiFetchJson } from "@/lib/auth/api-fetch";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";
import { Card, PageHeader, buttonPrimaryClass, inputClass, labelClass } from "@/components/ui";
import type { PasswordChangeState } from "./types";

export default function PasswordPage() {
  const { user, token, login } = useAuth();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const required = user?.mustChangePassword === true;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("新しいパスワード（確認）が一致しません");
      return;
    }
    setPending(true);
    try {
      await apiFetchJson<PasswordChangeState>("/api/my/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      // 認証コンテキストの「変更が必要」フラグを下ろす（トークン自体はそのまま使える）
      if (user && token) login(token, { ...user, mustChangePassword: false });
      setDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      if (required) router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "パスワードの変更に失敗しました");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader
        title="パスワード変更"
        description={
          required
            ? "初期パスワードのままです。ご自身のパスワードに変更してから利用を開始してください。"
            : "ログインに使うパスワードを変更します。"
        }
      />

      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="currentPassword" className={labelClass}>
              現在のパスワード
            </label>
            <input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="newPassword" className={labelClass}>
              新しいパスワード（{PASSWORD_MIN_LENGTH}文字以上）
            </label>
            <input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="confirmPassword" className={labelClass}>
              新しいパスワード（確認）
            </label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          {done && !error && (
            <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              パスワードを変更しました
            </p>
          )}

          <div className="pt-2">
            <button type="submit" disabled={pending} className={`${buttonPrimaryClass} w-full`}>
              {pending ? "変更中..." : "パスワードを変更する"}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
