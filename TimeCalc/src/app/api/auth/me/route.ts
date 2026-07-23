// 現在のBearerトークンからユーザー情報を返すAPI（GET）
// AuthProviderがマウント時の検証・リロード時の復元に使う。

import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api-guard";

export async function GET(request: Request) {
  const result = await requireApiUser(request);
  if (!result.ok) return result.response;
  return NextResponse.json({ user: result.user });
}
