// ログインAPI（POST）
//
// クライアントはこのAPIが返す token を sessionStorage に保存し、
// 以降のAPIリクエストで Authorization: Bearer <token> として送る（タブごとに独立したセッションになる）。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSessionToken, type SessionUser } from "@/lib/auth/session";
import { toRole } from "@/lib/auth/roles";
import { resolveFeatures } from "@/lib/auth/features";
import { getCompanyIdForDepartment } from "@/lib/settings";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { identifier?: unknown; password?: unknown }
    | null;
  const identifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!identifier || !password) {
    return NextResponse.json(
      { error: "社員番号（またはメールアドレス）とパスワードを入力してください" },
      { status: 400 },
    );
  }

  const user = await prisma.user.findFirst({
    where: { OR: [{ employeeCode: identifier }, { email: identifier }] },
  });

  // ユーザー不存在とパスワード不一致でメッセージを変えない（列挙攻撃対策）
  if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json(
      { error: "社員番号またはパスワードが正しくありません" },
      { status: 401 },
    );
  }

  const sessionUser: SessionUser = {
    id: user.id,
    employeeCode: user.employeeCode,
    name: user.name,
    role: toRole(user.role),
    departmentId: user.departmentId,
    companyId: await getCompanyIdForDepartment(user.departmentId),
    gpsCheckEnabled: user.gpsCheckEnabled,
    companyAttendance: resolveFeatures(user.featureOverrides).companyAttendance,
  };

  const token = await createSessionToken(sessionUser);

  return NextResponse.json({ token, user: sessionUser });
}
