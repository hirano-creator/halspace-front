// セッション管理（JWT）
//
// jose による署名付きJWTを発行・検証する。トークンはクライアント側で
// sessionStorage に保持され、タブごとに独立したセッションになる
// （Route Handler は Authorization: Bearer ヘッダーで受け取る）。
//
// トークンに入っている role 等は「ログイン時点の値」でしかない。APIの認可判定は
// api-guard.ts がリクエストごとにDBの最新値で組み直した SessionUser を使う
// （退職・降格・異動を即時に効かせるため）。トークン側の値は表示の初期値程度に扱う。

import { SignJWT, jwtVerify } from "jose";
import type { Role } from "./roles";
import { toRole } from "./roles";
import { resolveFeatures, toHomeScreen, type HomeScreen } from "./features";

const SESSION_DURATION_SEC = 60 * 60 * 12; // 12時間

export interface SessionUser {
  /** User.id */
  id: string;
  employeeCode: string;
  name: string;
  role: Role;
  departmentId: string | null;
  /** 所属部署が属するグループ会社のID（会社単位の勤怠閲覧範囲の判定に使う） */
  companyId: string | null;
  /** false ならこのユーザーは打刻時のGPS判定をスキップする */
  gpsCheckEnabled: boolean;
  /** true なら同じ会社の他スタッフの勤怠を閲覧・修正できる（ロールに依らず個別付与） */
  companyAttendance: boolean;
  /** アプリを開いた直後に表示する画面 */
  homeScreen: HomeScreen;
  /** true の間はパスワード変更以外のAPIを受け付けない（初期パスワードのまま使わせないため） */
  mustChangePassword: boolean;
}

/** buildSessionUser が必要とする User の列（Prisma の User 行をそのまま渡せる） */
export interface SessionUserSource {
  id: string;
  employeeCode: string;
  name: string;
  role: string;
  departmentId: string | null;
  gpsCheckEnabled: boolean;
  featureOverrides: string | null;
  mustChangePassword: boolean;
}

/**
 * DBのユーザー行から SessionUser を組み立てる。
 * ログイン時のトークン発行と、APIガードでのリクエストごとの再検証の両方がこれを使う
 * （組み立て方が2か所に分かれると、片方だけ新しい項目を忘れて権限がズレる）。
 */
export function buildSessionUser(user: SessionUserSource, companyId: string | null): SessionUser {
  const features = resolveFeatures(user.featureOverrides);
  return {
    id: user.id,
    employeeCode: user.employeeCode,
    name: user.name,
    role: toRole(user.role),
    departmentId: user.departmentId,
    companyId,
    gpsCheckEnabled: user.gpsCheckEnabled,
    companyAttendance: features.companyAttendance,
    homeScreen: features.homeScreen,
    mustChangePassword: user.mustChangePassword,
  };
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
    companyId: user.companyId,
    gpsCheckEnabled: user.gpsCheckEnabled,
    companyAttendance: user.companyAttendance,
    homeScreen: user.homeScreen,
    mustChangePassword: user.mustChangePassword,
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
      companyId: payload.companyId ? String(payload.companyId) : null,
      gpsCheckEnabled: payload.gpsCheckEnabled !== false,
      companyAttendance: payload.companyAttendance === true,
      homeScreen: toHomeScreen(payload.homeScreen),
      mustChangePassword: payload.mustChangePassword === true,
    };
  } catch {
    return null;
  }
}
