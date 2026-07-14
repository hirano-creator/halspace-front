// 認証ミドルウェア
// ログイン画面以外のすべてのページでセッションを検証する

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await verifySessionToken(token) : null;

  if (pathname === "/login") {
    // ログイン済みなら勤怠一覧へ
    if (user) {
      return NextResponse.redirect(new URL("/attendance", request.url));
    }
    return NextResponse.next();
  }

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // 静的ファイル・Next内部パスは除外
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|ico)$).*)"],
};
