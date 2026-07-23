import { describe, expect, it, beforeAll } from "vitest";
import { createSessionToken, type SessionUser } from "./session";
import { getBearerUser, requireApiUser, requireApiPermission } from "./api-guard";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-for-api-guard";
});

const adminUser: SessionUser = {
  id: "user-admin",
  employeeCode: "0001",
  name: "管理者",
  role: "ADMIN",
  departmentId: null,
  gpsCheckEnabled: true,
};

const employeeUser: SessionUser = {
  id: "user-employee",
  employeeCode: "0002",
  name: "一般社員",
  role: "EMPLOYEE",
  departmentId: "dept-1",
  gpsCheckEnabled: true,
};

function requestWithToken(token?: string): Request {
  const headers: HeadersInit = token ? { authorization: `Bearer ${token}` } : {};
  return new Request("http://localhost/api/dummy", { headers });
}

describe("getBearerUser", () => {
  it("Authorizationヘッダーがなければ null", async () => {
    expect(await getBearerUser(requestWithToken())).toBeNull();
  });

  it("正しいトークンならユーザーを返す", async () => {
    const token = await createSessionToken(adminUser);
    expect(await getBearerUser(requestWithToken(token))).toEqual(adminUser);
  });

  it("不正なトークンなら null", async () => {
    expect(await getBearerUser(requestWithToken("invalid-token"))).toBeNull();
  });
});

describe("requireApiUser", () => {
  it("未ログインなら401", async () => {
    const result = await requireApiUser(requestWithToken());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("ログイン済みならユーザーを返す", async () => {
    const token = await createSessionToken(employeeUser);
    const result = await requireApiUser(requestWithToken(token));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user).toEqual(employeeUser);
  });
});

describe("requireApiPermission", () => {
  it("権限を持たないロールなら403", async () => {
    const token = await createSessionToken(employeeUser);
    const result = await requireApiPermission(requestWithToken(token), "manageSettings");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("権限を持つロールならユーザーを返す", async () => {
    const token = await createSessionToken(adminUser);
    const result = await requireApiPermission(requestWithToken(token), "manageSettings");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user).toEqual(adminUser);
  });

  it("未ログインなら401（権限チェック以前）", async () => {
    const result = await requireApiPermission(requestWithToken(), "manageSettings");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });
});
