// ログインAPI（POST）
//
// クライアントはこのAPIが返す token を sessionStorage に保存し、
// 以降のAPIリクエストで Authorization: Bearer <token> として送る（タブごとに独立したセッションになる）。
//
// 総当たり対策として、識別子ごと・接続元IPごとに失敗回数を数え、上限を超えたら 429 で一定時間拒否する
// （src/lib/auth/login-throttle.ts）。ユーザーが存在しない場合も bcrypt 相当の時間を使い、
// 応答時間から社員番号の有無を推測できないようにする。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, burnPasswordCheck } from "@/lib/auth/password";
import { createSessionToken, buildSessionUser } from "@/lib/auth/session";
import { getCompanyIdForDepartment } from "@/lib/settings";
import { loginThrottle, clientIp } from "@/lib/auth/login-throttle";

/** 識別子は失敗ログにそのまま出さない（メールアドレス＝個人情報がログに溜まるのを避ける） */
function maskIdentifier(identifier: string): string {
  if (identifier.length <= 2) return "**";
  return `${identifier.slice(0, 2)}${"*".repeat(Math.min(identifier.length - 2, 8))}`;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { identifier?: unknown; password?: unknown }
    | null;
  const identifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  // 実機でしか再現しない不具合の切り分け用。LOGIN_DEBUG_LOG=1 のときだけ全試行を記録する
  // （既定では失敗のみ、識別子はマスクして出す）
  const debug = process.env.LOGIN_DEBUG_LOG === "1";
  const log = (result: string) => {
    if (!debug && result === "ok") return;
    const shown = debug ? JSON.stringify(identifier) : maskIdentifier(identifier);
    const ua = debug ? ` ua=${request.headers.get("user-agent") ?? ""}` : "";
    console.log(`[auth/login] ${result} identifier=${shown}${ua}`);
  };

  if (!identifier || !password) {
    log("bad_request");
    return NextResponse.json(
      { error: "社員番号（またはメールアドレス）とパスワードを入力してください" },
      { status: 400 },
    );
  }

  // 識別子は大文字小文字を区別せずに同じ枠で数える（H0001 と h0001 で枠を分けない）
  const identifierKey = identifier.toLowerCase();
  const ip = clientIp(request);
  const lockedSeconds =
    loginThrottle.byIdentifier.lockedFor(identifierKey) ?? loginThrottle.byIp.lockedFor(ip);
  if (lockedSeconds !== null) {
    log("locked");
    return NextResponse.json(
      {
        error: `ログインの失敗が続いたため、しばらく受け付けを停止しています。約${Math.ceil(lockedSeconds / 60)}分後にもう一度お試しください`,
      },
      { status: 429, headers: { "Retry-After": String(lockedSeconds) } },
    );
  }

  const user = await prisma.user.findFirst({
    where: { OR: [{ employeeCode: identifier }, { email: identifier }] },
  });

  // ユーザー不存在とパスワード不一致でメッセージも応答時間も変えない（列挙攻撃対策）
  const passwordOk =
    user && user.isActive
      ? await verifyPassword(password, user.passwordHash)
      : await burnPasswordCheck(password);
  if (!user || !user.isActive || !passwordOk) {
    const locked = loginThrottle.byIdentifier.recordFailure(identifierKey);
    loginThrottle.byIp.recordFailure(ip);
    log(locked ? "invalid_locked" : "invalid");
    return NextResponse.json(
      { error: "社員番号またはパスワードが正しくありません" },
      { status: 401 },
    );
  }
  loginThrottle.byIdentifier.recordSuccess(identifierKey);
  log("ok");

  const sessionUser = buildSessionUser(user, await getCompanyIdForDepartment(user.departmentId));
  const token = await createSessionToken(sessionUser);

  return NextResponse.json({ token, user: sessionUser });
}
