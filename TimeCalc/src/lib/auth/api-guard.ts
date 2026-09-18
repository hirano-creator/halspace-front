// Route Handler（Bearerトークン方式）用の認可ガード
//
// Cookieを使わず、クライアントが sessionStorage に保持するトークンを
// Authorization: Bearer <token> で送ってくる前提の検証ヘルパー。
//
// トークンは「誰か（sub）」を証明するだけに使い、role・所属・機能設定は
// リクエストごとにDBから読み直す。トークンの中身を信じると、退職処理（isActive=false）や
// 管理者の降格・部署異動がトークン期限（12時間）まで効かないため。
// 1リクエストにつき User を1件引く分のコストは掛かるが、単一行のPK検索なので許容する。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifySessionToken, buildSessionUser, type SessionUser } from "./session";
import { can, type Permission } from "./roles";
import { PASSWORD_CHANGE_REQUIRED_CODE } from "./password-policy";

export type ApiGuardResult =
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse };

export interface RequireApiUserOptions {
  /**
   * true にすると、パスワード変更が必要な状態（mustChangePassword）のユーザーも通す。
   * /api/auth/me と /api/my/password のように「変更を済ませるために必要なAPI」だけが指定する。
   */
  allowPasswordChangeRequired?: boolean;
}

/** Authorizationヘッダーからトークンを取り出して検証する（未ログインは null）。中身はログイン時点の値 */
export async function getBearerUser(request: Request): Promise<SessionUser | null> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * トークンの sub をDBで引き直し、現在の値で SessionUser を組み立てる。
 * 存在しない・無効化済み（isActive=false）なら null＝未ログイン扱い。
 */
async function loadCurrentUser(id: string): Promise<SessionUser | null> {
  const row = await prisma.user.findUnique({
    where: { id },
    include: { department: { select: { companyId: true } } },
  });
  if (!row || !row.isActive) return null;
  return buildSessionUser(row, row.department?.companyId ?? null);
}

/** ログイン必須。未ログイン・無効化済みなら401レスポンスを返す */
export async function requireApiUser(
  request: Request,
  options: RequireApiUserOptions = {},
): Promise<ApiGuardResult> {
  const claims = await getBearerUser(request);
  const user = claims ? await loadCurrentUser(claims.id) : null;
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "ログインが必要です" }, { status: 401 }),
    };
  }
  if (user.mustChangePassword && !options.allowPasswordChangeRequired) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "初期パスワードのままです。先にパスワードを変更してください",
          code: PASSWORD_CHANGE_REQUIRED_CODE,
        },
        { status: 403 },
      ),
    };
  }
  return { ok: true, user };
}

/** 指定権限が必須。権限がなければ403レスポンスを返す */
export async function requireApiPermission(
  request: Request,
  permission: Permission,
): Promise<ApiGuardResult> {
  const result = await requireApiUser(request);
  if (!result.ok) return result;
  if (!can(result.user.role, permission)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "権限がありません" }, { status: 403 }),
    };
  }
  return result;
}
