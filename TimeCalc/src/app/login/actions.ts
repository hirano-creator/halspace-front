"use server";

// ログイン / ログアウトの Server Action

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth/session";
import { toRole } from "@/lib/auth/roles";

export interface LoginState {
  error: string | null;
}

/**
 * ログイン処理。
 * 識別子は社員番号・メールアドレスのどちらでも受け付ける。
 */
export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!identifier || !password) {
    return { error: "社員番号（またはメールアドレス）とパスワードを入力してください" };
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ employeeCode: identifier }, { email: identifier }],
    },
  });

  // ユーザー不存在とパスワード不一致でメッセージを変えない（列挙攻撃対策）
  if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "社員番号またはパスワードが正しくありません" };
  }

  await setSessionCookie({
    id: user.id,
    employeeCode: user.employeeCode,
    name: user.name,
    role: toRole(user.role),
    departmentId: user.departmentId,
  });

  redirect("/attendance");
}

/** ログアウト処理 */
export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}
