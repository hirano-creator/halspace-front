// セッション管理（JWT）
//
// jose による署名付きJWTを発行・検証する。トークンはクライアント側で
// sessionStorage に保持され、タブごとに独立したセッションになる
// （Route Handler は Authorization: Bearer ヘッダーで受け取る）。

import { SignJWT, jwtVerify } from "jose";
import type { Role } from "./roles";
import { toRole } from "./roles";

const SESSION_DURATION_SEC = 60 * 60 * 12; // 12時間

export interface SessionUser {
  /** User.id */
  id: string;
  employeeCode: string;
  name: string;
  role: Role;
  departmentId: string | null;
  /** false ならこのユーザーは打刻時のGPS判定をスキップする */
  gpsCheckEnabled: boolean;
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
    gpsCheckEnabled: user.gpsCheckEnabled,
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
      gpsCheckEnabled: payload.gpsCheckEnabled !== false,
    };
  } catch {
    return null;
  }
}
