// セッション管理（JWT）
//
// jose による署名付き JWT を発行・検証する。トークンはクライアント側で
// sessionStorage に保持され、タブごとに独立したセッションになる
// （Route Handler は Authorization: Bearer ヘッダーで受け取る）。
//
// Cookie を使わないので CSRF 対策は構造的に不要になる。

import { SignJWT, jwtVerify } from "jose";
import { toRole, type Role } from "./roles";

const SESSION_DURATION_SEC = 60 * 60 * 12; // 12時間

export interface SessionUser {
  /** Staff.id */
  id: string;
  email: string;
  name: string;
  role: Role;
}

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("環境変数 SESSION_SECRET が設定されていません");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SEC}s`)
    .sign(getSecret());
}

/** トークンを検証してセッションユーザーを取り出す（不正・期限切れは null） */
export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub) return null;
    return {
      id: payload.sub,
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      role: toRole(payload.role),
    };
  } catch {
    return null;
  }
}
