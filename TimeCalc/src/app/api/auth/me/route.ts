// 現在のBearerトークンからユーザー情報を返すAPI（GET）
// AuthProviderがマウント時の検証・リロード時の復元に使う。
// ガードがDBの最新値で組み直した SessionUser を返すので、権限や所属の変更はリロードで画面に反映される。
// パスワード変更が必要な状態でも通す（クライアントが /password へ誘導するために本人情報が要る）。

import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api-guard";

export async function GET(request: Request) {
  const result = await requireApiUser(request, { allowPasswordChangeRequired: true });
  if (!result.ok) return result.response;
  return NextResponse.json({ user: result.user });
}
