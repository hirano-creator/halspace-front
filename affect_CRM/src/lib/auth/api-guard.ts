// Route Handler（Bearer トークン方式）用の認可ガード
//
// すべての Route Handler の先頭でこれを通す。
// 画面のボタンを隠すだけの制御はしない（API を直接叩かれたら素通りになるため）。

import { NextResponse } from "next/server";
import { verifySessionToken, type SessionUser } from "./session";
import { can, type Permission } from "./roles";

export type ApiGuardResult =
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse };

/** Authorization ヘッダーからトークンを取り出して検証する（未ログインは null） */
export async function getBearerUser(request: Request): Promise<SessionUser | null> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  return verifySessionToken(token);
}

/** ログイン必須。未ログインなら 401 を返す */
export async function requireApiUser(request: Request): Promise<ApiGuardResult> {
  const user = await getBearerUser(request);
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "ログインが必要です" }, { status: 401 }),
    };
  }
  return { ok: true, user };
}

/** 指定権限が必須。権限がなければ 403 を返す */
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
