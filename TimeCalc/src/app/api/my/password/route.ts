// 本人によるパスワード変更API（POST）
//
// 現在のパスワードを確認したうえで新しいパスワードに置き換え、mustChangePassword を解除する。
// パスワード変更が必要な状態（初期パスワードのまま）のユーザーが唯一使えるAPIなので、
// ガードは allowPasswordChangeRequired で通す。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { hashPassword, verifyPassword, validateNewPassword } from "@/lib/auth/password";
import type { PasswordChangeState } from "@/app/(app)/password/types";

export async function POST(request: Request) {
  const auth = await requireApiUser(request, { allowPasswordChangeRequired: true });
  if (!auth.ok) return auth.response;
  const viewer = auth.user;

  const body = (await request.json().catch(() => null)) as
    | { currentPassword?: unknown; newPassword?: unknown }
    | null;
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

  if (!currentPassword || !newPassword) {
    return NextResponse.json<PasswordChangeState>(
      { error: "現在のパスワードと新しいパスワードを入力してください" },
      { status: 400 },
    );
  }
  const invalid = validateNewPassword(newPassword);
  if (invalid) {
    return NextResponse.json<PasswordChangeState>({ error: invalid }, { status: 400 });
  }
  if (newPassword === currentPassword) {
    return NextResponse.json<PasswordChangeState>(
      { error: "新しいパスワードは現在のパスワードと別のものにしてください" },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({ where: { id: viewer.id } });
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    return NextResponse.json<PasswordChangeState>(
      { error: "現在のパスワードが正しくありません" },
      { status: 400 },
    );
  }

  await prisma.user.update({
    where: { id: viewer.id },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
  });

  return NextResponse.json<PasswordChangeState>({ error: null, success: true });
}
