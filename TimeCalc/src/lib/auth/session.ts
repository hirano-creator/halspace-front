// セッション管理（JWT + httpOnly Cookie）
//
// jose による署名付きJWTをCookieに保持する。
// middleware（Edgeランタイム）からも利用するため、Node専用APIは使わない。

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { Role } from "./roles";
import { toRole } from "./roles";

export const SESSION_COOKIE = "timecalc_session";
const SESSION_DURATION_SEC = 60 * 60 * 12; // 12時間

export interface SessionUser {
  /** User.id */
  id: string;
  employeeCode: string;
  name: string;
  role: Role;
  departmentId: string | null;
}

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("環境変数 SESSION_SECRET が設定されていません");
  }
  return new TextEncoder().encode(secret);
}

/** セッショントークン（JWT）を生成する */
export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({
    employeeCode: user.employeeCode,
    name: user.name,
    role: user.role,
    departmentId: user.departmentId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SEC}s`)
    .sign(getSecret());
}

/** トークンを検証しセッションユーザーを取り出す（不正・期限切れは null） */
export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub) return null;
    return {
      id: payload.sub,
      employeeCode: String(payload.employeeCode ?? ""),
      name: String(payload.name ?? ""),
      role: toRole(String(payload.role ?? "")),
      departmentId: payload.departmentId ? String(payload.departmentId) : null,
    };
  } catch {
    return null;
  }
}

/** ログイン成功時にセッションCookieを設定する */
export async function setSessionCookie(user: SessionUser): Promise<void> {
  const token = await createSessionToken(user);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DURATION_SEC,
    path: "/",
  });
}

/** セッションCookieを破棄する（ログアウト） */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/** 現在のリクエストのセッションユーザーを取得する（未ログインは null） */
export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
